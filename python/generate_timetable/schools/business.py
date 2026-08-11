"""Business-school timetable parser."""

import re

from ..config import (
    FSM_COMBINED_RE,
    FSM_COURSE_RE,
    FSM_DAY_RE,
    FSM_PROGRAM_MAP,
    FSM_SECTION_OFFSET,
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

def parse_fsm_course_name(raw):
    raw = one_line(raw or "")
    if not raw:
        return None, None, None

    time_override = None
    tm = FSM_TIME_OVERRIDE_RE.search(raw)
    if tm:
        time_override = tm.group(1)
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

        slot_starts = sorted(header_times.keys())
        for si, sc in enumerate(slot_starts):
            time = header_times[sc]
            s_end = slot_starts[si + 1] if si + 1 < len(slot_starts) else sc + 9
            section_col = sc + FSM_SECTION_OFFSET

            course_raw = one_line(row[sc] if sc < len(row) else "")
            if not course_raw:
                continue

            course_code, course_title, time_override = parse_fsm_course_name(course_raw)
            if not course_title:
                continue

            # Find section code
            section_raw = ""
            for c in range(section_col, min(s_end, len(row))):
                cell = one_line(row[c] or "")
                if cell:
                    section_raw = cell
                    break
            if not section_raw:
                continue

            # Skip non-section entries
            if len(section_raw) < 4 and not re.search(r'\d', section_raw):
                continue

            parsed_sections = parse_fsm_section_code(section_raw)
            if not parsed_sections:
                continue

            course_label = f"{course_title} ({course_code})" if course_code else course_title
            effective_time = time_override if time_override else time

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
