"""Trace generated business courses, days, rooms and times to cached source cells.

Usage: python python/tools/timetable_audit/audit_business.py CACHE_DIR REPO_DIR
Reads local generated JSON. This checks output against source cells; it does
not independently prove cohort routing or completeness of section expansion.
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

cache, repo = map(Path, sys.argv[1:3])
rows = json.loads((cache / 'business__Timetable.json').read_text(encoding='utf-8'))['text']
tt = json.loads((repo / 'db/timetables/business.json').read_text(encoding='utf-8'))['tt']
index = defaultdict(list)
day, headers = None, {}
time_re = re.compile(r'(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})')


def norm(value):
    return re.sub(r'\W', '', value).lower()


for row in rows:
    if row and row[0].strip() in ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'):
        day = row[0].strip()
    if len(row) > 2 and row[2].strip().lower() == 'room':
        headers = {i: value.strip() for i, value in enumerate(row) if time_re.fullmatch(value.strip())}
        continue
    if not day or len(row) < 3:
        continue
    for col, cell in enumerate(row[3:], 3):
        preceding = [h for h in headers if h <= col]
        if not cell.strip() or not preceding:
            continue
        match = time_re.search(cell)
        time = ('{:02}:{}-{:02}:{}'.format(int(match[1]), match[2], int(match[3]), match[4])
                if match else headers[max(preceding)])
        index[(day, norm(row[2]))].append((norm(cell), time))

missing, total = [], 0
for batches in tt.values():
    for sections in batches.values():
        for days in sections.values():
            for day, entries in days.items():
                for entry in entries:
                    total += 1
                    codes = re.findall(r'\(([A-Z]{2}\d{4}(?:/[A-Z]{2}\d{4})?)\)', entry['name'])
                    title = norm(entry['name'].split(' (')[0])
                    candidates = index[(day, norm(entry['location']))]
                    if not any((any(norm(code) in text for code in codes) or title in text)
                               and time == entry['time'] for text, time in candidates):
                        missing.append({'day': day, **entry})

print(f'Business course/day/room/time matches: {total - len(missing)}/{total}')
if missing:
    print(json.dumps(missing, indent=2))
sys.exit(bool(missing))
