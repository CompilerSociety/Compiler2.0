"""Business-school timetable parser."""

import re

from ..config import (
    FSM_COMBINED_RE,
    FSM_COURSE_RE,
    FSM_DAY_RE,
    FSM_PROGRAM_MAP,
    FSM_SECTION_RE,
    FSM_SLOT_STARTS,
    FSM_TIME_OVERRIDE_RE,
    SCHOOLS,
)
from ..google_sheets import fetch_sheet_with_colours, get_sheet_tab_names
from ..helpers import (
    add_course,
    dlog,
    dlog_error,
    dlog_warn,
    normalize_dept_key,
    normalise_room,
    one_line,
)

def _normalise_slot_time(text):
    """Normalize an override time to 12-hour zero-padded slot labels, mirroring
    api/timetable.js normalizeTimeSlot, e.g. '8:30 - 10:20' -> '08:30-10:20'."""
    m = re.match(
        r'(\d{1,2})[:.](\d{2})\s*(AM|PM)?\s*(?:-|to)\s*'
        r'(\d{1,2})[:.](\d{2})\s*(AM|PM)?',
        one_line(text or ''), re.IGNORECASE)
    if not m:
        return one_line(text or '')

    def pad(h, minute, ampm):
        hour = int(h)
        ap = (ampm or '').upper()
        if ap == 'PM' and hour < 12:
            hour += 12
        if ap == 'AM' and hour == 12:
            hour = 0
        if not ap and 1 <= hour <= 6:
            hour += 12
        if hour > 12:
            hour -= 12
        if hour == 0:
            hour = 12
        return f'{hour:02d}:{int(minute):02d}'

    start = pad(m.group(1), m.group(2), m.group(3) or m.group(6))
    end = pad(m.group(4), m.group(5), m.group(6) or m.group(3))
    return f'{start}-{end}'


def parse_fsm_course_name(raw):
    raw = one_line(raw or "")
    if not raw:
        return None, None, None

    time_override = None
    tm = FSM_TIME_OVERRIDE_RE.search(raw)
    if tm:
        time_override = _normalise_slot_time(tm.group(1))
        raw = raw[:tm.start()].strip()

    code = None
    title = raw
    cm = FSM_COURSE_RE.match(raw)
    if cm:
        code = cm.group(1).replace(" ", "")
        title = raw[cm.end():].strip()

    return code, title, time_override


def parse_fsm_section_code(raw):
    raw = one_line(raw or "").upper().replace(" ", "")
    if not raw:
        return None

    combo = FSM_COMBINED_RE.match(raw)
    if combo:
        base = combo.group(1)
        letters_str = re.sub(r'[/&]', ' ', combo.group(2))
        letters = letters_str.strip().split()
        results = []
        for i, l in enumerate(letters):
            code = base if i == 0 else base[:-1] + l
            m = FSM_SECTION_RE.match(code)
            if m:
                results.append({
                    "program": m.group(1),
                    "semester": m.group(2),
                    "section": m.group(3),
                    "sub_section": m.group(4) or None,
                    "full": code,
                })
        return results if results else None

    m = FSM_SECTION_RE.match(raw)
    if m:
        return [{
            "program": m.group(1),
            "semester": m.group(2),
            "section": m.group(3),
            "sub_section": m.group(4) or None,
            "full": raw,
        }]
    return None


def fsm_semester_to_batch(semester):
    try:
        sem = int(semester)
    except (ValueError, TypeError):
        return None
    current_year = 2026
    return str(current_year - sem // 2)


def parse_business_grid(text_grid, day, tt):
    added = 0

    # Find header row
    header_row = -1
    for r in range(min(len(text_grid), 5)):
        cell = one_line(text_grid[r][2] if len(text_grid[r]) > 2 else "")
        if "room" in cell.lower():
            slot_count = 0
            for sc in FSM_SLOT_STARTS:
                if sc < len(text_grid[r]):
                    if re.match(r'\d{1,2}:\d{2}', one_line(text_grid[r][sc] or "")):
                        slot_count += 1
            if slot_count >= 3:
                header_row = r
                break
    if header_row < 0:
        return 0

    # Detect time labels from header row
    header_times = {}
    for sc in FSM_SLOT_STARTS:
        if sc < len(text_grid[header_row]):
            raw = one_line(text_grid[header_row][sc] or "")
            m = re.match(r'(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})', raw)
            if m:
                header_times[sc] = raw
    if len(header_times) < 3:
        return 0

    # Walk data rows
    current_day = day
    current_type = "Classes"
    processed_keys = set()

    for r in range(header_row + 1, len(text_grid)):
        row = text_grid[r]
        if not row:
            continue

        day_cell = one_line(row[0] if len(row) > 0 else "")
        day_m = FSM_DAY_RE.match(day_cell)
        if day_m:
            current_day = day_m.group(1)

        type_cell = one_line(row[1] if len(row) > 1 else "")
        if type_cell in ("Classes", "Labs"):
            current_type = type_cell

        raw_room = one_line(row[2] if len(row) > 2 else "")
        if not raw_room or len(raw_room) < 2:
            continue
        room = normalise_room(raw_room)
        if re.search(r"reserved|tutorial|fsm|fsa|fcss|fyp|travel|admin|room", room, re.IGNORECASE):
            continue
        if len(room) < 2:
            continue

        # Skip labs header rows
        if current_type == "Labs" and type_cell == "Labs" and not raw_room:
            continue

        # Walk the row left→right. Merged cells (a course carrying a time
        # override) push the section code 7–13 columns right and can shift the
        # course itself off its slot-start column, so pair each section code
        # with the nearest preceding course cell instead of reading a fixed +7
        # offset. Keep in step with api/timetable.js parseBusinessGrid.
        slot_starts = sorted(header_times.keys())
        max_col = (slot_starts[-1] if slot_starts else 48) + 9
        if len(row) <= max_col:
            row = row + [''] * (max_col + 1 - len(row))

        pending = None  # (code, title, time_override, slot_time, col)
        for c in range(3, max_col):
            cell = one_line(row[c] or "")
            if not cell:
                continue

            parsed_sections = parse_fsm_section_code(cell)
            if parsed_sections:
                # A section code pairs with the pending course; anything
                # further away than one slot band belongs to a course we
                # already emitted (or none).
                if not pending or c - pending[4] > 16:
                    pending = None
                    continue
                course_code, course_title, time_override, slot_time, _ = pending
                pending = None
                if not course_title:
                    continue

                course_label = f"{course_title} ({course_code})" if course_code else course_title
                effective_time = time_override if time_override else slot_time

                for ps in parsed_sections:
                    dept = FSM_PROGRAM_MAP.get(ps["program"])
                    if not dept:
                        dept = normalize_dept_key(ps["program"])
                    batch = fsm_semester_to_batch(ps["semester"])
                    if not batch:
                        batch = "2025"

                    sec = ps["section"]

                    dedup_key = f"{dept}|{batch}|{sec}|{current_day}|{course_label}|{room}|{effective_time}"
                    if dedup_key in processed_keys:
                        continue
                    processed_keys.add(dedup_key)

                    if add_course(tt, dept, batch, sec, current_day, course_label, room, effective_time):
                        added += 1
                continue

            # Not a section code — a course cell (may be a stray "CS"/"MS", a
            # time label, or a Jumma/Seminar note; skip those so they never
            # become a pending course that swallows the real entry after it).
            course_code, course_title, time_override = parse_fsm_course_name(cell)
            if not course_title:
                continue
            if re.match(r'^(jumm[ae]|seminar|break\b)', course_title, re.IGNORECASE):
                continue
            if re.match(r'^\d{1,2}:\d{2}', course_title):
                continue
            if not course_code and len(course_title) < 6:
                continue

            # A new course that starts more than one band after the pending one
            # means the pending course had no section — drop it and start fresh.
            if pending and c - pending[4] > 12:
                pending = None
            if pending:
                continue  # previous course still awaiting its section

            band = None
            for i, sc in enumerate(slot_starts):
                end = slot_starts[i + 1] if i + 1 < len(slot_starts) else sc + 9
                if sc <= c < end:
                    band = sc
                    break
            if band is None:
                continue
            pending = (course_code, course_title, time_override, header_times[band], c)

    return added


def generate(service):
    school_name = "business"
    school_info = SCHOOLS[school_name]
    tt = {}
    total = 0

    sheet_url = f"https://docs.google.com/spreadsheets/d/{school_info['id']}"
    dlog(f"--- {school_name.upper()} --- sheet: {sheet_url}")
    actual_tabs = get_sheet_tab_names(service, school_info["id"])
    dlog(f"  Actual tabs in sheet: {actual_tabs}")
    configured_tabs = school_info["tabs"]
    dlog(f"  Configured tabs    : {configured_tabs}")

    missing = [t for t in configured_tabs if t not in actual_tabs]
    if missing:
        dlog_error(
            f"  MISMATCH: tabs {missing} not found in sheet. Available: {actual_tabs}"
        )
        dlog_warn(
            f"  Fix: update SCHOOLS['{school_name}']['tabs'] to match one of: {actual_tabs}"
        )

    for tab in configured_tabs:
        day = None
        print(f"  Fetching {school_name}/{tab}...", end=" ", flush=True)

        try:
            text_grid, colour_grid = fetch_sheet_with_colours(
                service, school_info["id"], tab
            )
        except Exception as e:
            print(f"ERROR: {e}")
            dlog_error(f"  fetch failed for {school_name}/{tab}: {e}")
            continue

        if not text_grid:
            print("empty ??? skipped")
            dlog_warn(f"  {school_name}/{tab} returned empty grid")
            continue

        added = parse_business_grid(text_grid, day, tt)
        total += added
        print(f"{added} entries")
        dlog(f"  {school_name}/{tab}: {added} entries parsed")

    dlog(f"  {school_name} total: {total} entries, {len(tt)} depts")
    return tt, total
