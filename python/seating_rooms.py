"""Extract exam room bookings from PDF headers, independently of student rows.

CLI: python python/seating_rooms.py PLAN.pdf --date 2025-12-15 --time 10:00
     --rooms C-301 C-302 C-306
Without --date/--time, prints the machine-readable occupancy document.
"""
from __future__ import annotations

import argparse
import io
import json
import re
from datetime import datetime
from pathlib import Path

import pdfplumber

DATE = re.compile(r"\b([A-Za-z]{3,9}\s+\d{1,2},?\s+20\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\s+20\d{2}|20\d{2}-\d{2}-\d{2})\b")
TIME = re.compile(r"\b(\d{1,2}:\d{2})\s*(AM|PM)?\s*(?:to|[-–—])\s*(\d{1,2}:\d{2})\s*(AM|PM)?\b", re.I)
ROOM = re.compile(r"(?:Room\s*No\.?\s*:?|Venue\s*:)\s*(.+?)(?=\s+\d+(?:st|nd|rd|th)\s+Floor|\n|$)", re.I)
STUDENT = re.compile(r"^\d+\s+(\d{2}[A-Za-z]-\d{4})\s+(.+?)\s+(C\d+R\d+|Chair\s*\d+|\d+)\s*$", re.I)


def iso_date(value):
    value = value.replace(',', '')
    for fmt in ('%b %d %Y', '%B %d %Y', '%d %B %Y', '%d %b %Y', '%Y-%m-%d'):
        try:
            return datetime.strptime(value, fmt).date().isoformat()
        except ValueError:
            pass
    raise ValueError(f'Unrecognized exam date: {value}')


def time_range(match):
    """Infer the omitted AM in '9:00 to 12:00 PM', never turn it into 9 PM."""
    start, ap, end, bp = match.groups()
    def minutes(s, period):
        h, m = map(int, s.split(':'))
        if m > 59 or h > 23 or (period and not 1 <= h <= 12):
            raise ValueError('Invalid exam time')
        return ((h % 12 + (12 if period.upper() == 'PM' else 0)) if period else h) * 60 + m
    end_min = minutes(end, bp or '')
    candidates = [minutes(start, ap)] if ap else [minutes(start, p) for p in (['AM', 'PM'] if bp else [''])]
    valid = [s for s in candidates if 0 < end_min - s <= 6 * 60]
    if len(valid) != 1:
        raise ValueError(f'Ambiguous exam time: {match.group(0)}')
    return valid[0], end_min


def normalize_room(value):
    return re.sub(r'\s*-\s*', '-', re.sub(r'\s+', ' ', value).strip()).upper()


def parse_pages(texts):
    bookings, students, ignored, errors = [], [], [], []
    schools = set()
    for number, text in enumerate(texts, 1):
        header = '\n'.join(text.splitlines()[:12])
        room = ROOM.search(header)
        # Cover/separator pages are dates only, and must NOT imply coverage.
        if not room and not re.search(r'Attendance List|Roll\s+No|Venue:|Room\s*No', text, re.I):
            if not text.strip() or len(text.splitlines()) > 3:
                errors.append({'page': number, 'reason': 'Unreadable or unrecognized page'})
            else:
                ignored.append(number)
            continue
        date, slot = DATE.search(header), TIME.search(header)
        if not (room and date and slot):
            errors.append({'page': number, 'reason': 'Missing room, date or time header'})
            continue
        try:
            start, end = time_range(slot)
            date = iso_date(date.group(0))
        except ValueError as error:
            errors.append({'page': number, 'reason': str(error)})
            continue
        venue = normalize_room(room.group(1))
        paper_line = next((line for line in text.splitlines() if re.match(r'^[A-Z]{2,3}\d{3,4}\s*[-,]', line)), '')
        paper = ROOM.split(paper_line)[0].strip()
        codes = re.findall(r'\b[BM](CS|AI|DS|CY|SE|EE|CE|BA|AF|FT|BAI)\s*-', paper)
        schools.update('engineering' if code in ('EE', 'CE') else 'business' if code in ('BA', 'AF', 'FT', 'BAI') else 'computing' for code in codes)
        bookings.append({'date': date, 'start': start, 'end': end, 'room': venue, 'course': paper or 'Exam', 'page': number})
        for line in text.splitlines():
            rec = STUDENT.match(line)
            if rec:
                students.append({'nuid': rec[1].upper(), 'name': rec[2], 'seat': rec[3],
                                 'class': venue, 'room': venue, 'paper': paper, 'date': date,
                                 'time': f'{start // 60:02}:{start % 60:02}-{end // 60:02}:{end % 60:02}'})
    unique = {}
    for booking in bookings:
        key = (booking['date'], booking['room'], booking['start'], booking['end'])
        if key not in unique:
            unique[key] = {**booking, 'pages': [booking['page']]}
            del unique[key]['page']
        else:
            unique[key]['pages'].append(booking['page'])
    return {'version': 1, 'complete': bool(bookings) and not errors,
            'dates': sorted({b['date'] for b in bookings}), 'schools': sorted(schools),
            'bookings': list(unique.values()), 'parsed_pages': len(bookings),
            'ignored_pages': ignored, 'errors': errors}, students


def parse_pdf(payload):
    with pdfplumber.open(io.BytesIO(payload)) as pdf:
        return parse_pages([page.extract_text() or '' for page in pdf.pages])


def free_rooms(plan, rooms, date, minute):
    if not plan['complete'] or date not in plan['dates']:
        return {'date': date, 'status': 'unknown', 'free': [], 'occupied': [], 'reason': 'No complete seating plan for this date'}
    busy = {b['room'] for b in plan['bookings'] if b['date'] == date and b['start'] <= minute < b['end']}
    inventory = sorted({normalize_room(room) for room in rooms})
    return {'date': date, 'minute': minute, 'status': 'ok',
            'free': [r for r in inventory if r not in busy], 'occupied': [r for r in inventory if r in busy]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf', type=Path)
    parser.add_argument('--date')
    parser.add_argument('--time', help='Campus local time in 24-hour HH:MM')
    parser.add_argument('--rooms', nargs='+', help='Candidate rooms; defaults to the app’s campus room inventory')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    plan, _ = parse_pdf(args.pdf.read_bytes())
    if args.date or args.time or args.rooms:
        if not (args.date and args.time):
            parser.error('--date and --time must be supplied together')
        rooms = args.rooms
        if not rooms:
            # Read only the literal inventory, never execute JavaScript or derive
            # an inventory from occupied rooms (which would omit every free room).
            app = (Path(__file__).resolve().parents[1] / 'web/js/app.js').read_text(encoding='utf-8')
            inventory = re.search(r'const DEFAULT_BLOCK_FLOORS=\{(.*?)\n\};', app, re.S)
            if not inventory:
                parser.error('Cannot read the app room inventory; supply --rooms')
            rooms = re.findall(r'"([A-D]-[^"\n]+)"', inventory[1])
            known = {normalize_room(r) for r in rooms}
            if any(b['room'] not in known for b in plan['bookings']):
                plan['complete'] = False
        moment = datetime.strptime(args.time, '%H:%M')
        result = free_rooms(plan, rooms, iso_date(args.date), moment.hour * 60 + moment.minute)
        result['schools'] = plan['schools']
    else:
        result = plan
    output = json.dumps(result, indent=2)
    if args.output:
        args.output.write_text(output + '\n', encoding='utf-8')
    else:
        print(output)


if __name__ == '__main__':
    main()
