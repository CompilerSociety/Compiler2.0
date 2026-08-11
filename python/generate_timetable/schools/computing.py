"""Computing-school timetable parser."""

import re

from ..colour_mapper import colour_to_batch, is_yellow
from ..config import (
    BATCH_MAP,
    CELL_RE,
    CLASSROOM_LEFT,
    CLASSROOM_RIGHT,
    COMPUTING_PROGRAM_CODES,
    DAYS,
    LAB_BLOCK,
    REPEAT_BATCH_KEY,
    SCHOOLS,
    SLOT_COLS,
)
from ..google_sheets import fetch_sheet_with_colours, get_sheet_tab_names
from ..helpers import (
    add_course,
    dlog,
    dlog_error,
    dlog_warn,
    extract_dept_from_header,
    normalize_dept_key,
    normalise_room,
    one_line,
)

def parse_timetable_cell(text):
    if not text:
        return None
    t = one_line(text)
    paren = t.find(")")
    core = t[:paren + 1] if paren >= 0 else t
    m = CELL_RE.match(core)
    if not m:
        return None
    course  = m.group(1).strip()
    dept_str = m.group(2)
    section  = m.group(3)
    subgroup = m.group(4)
    group = m.group(5)
    depts = [d.strip().upper() for d in re.split(r"\s*[/,]\s*", dept_str) if d.strip()]
    # Reject single-letter codes that aren't valid department codes (e.g. "G" from "G-I")
    depts = [d for d in depts if len(d) >= 2]
    if not depts:
        return None
    if not section and group:
        section = f"G-{group.upper()}"
    if subgroup:
        # Label with the actual section letter + subgroup digit (e.g. "G1", "B1")
        # instead of a generic "Gp 1" that's indistinguishable across sections.
        sub_label = f"{section}{subgroup}" if section else f"Gp {subgroup}"
        course = f"{course} ({sub_label})"
    return {
        "course": course,
        "depts": depts,
        "section": section,
        "has_section": bool(section),
    }

def is_ms_context(batch, dept):
    return batch == "MS" or str(dept or "").startswith("MS")

def resolve_departments_for_cell(parsed, header_dept, batch):
    """
    Decide whether a parsed code like DS means BS DS or MS (DS).

    BS cells include explicit sections like (DS-A). MS timetable cells often omit
    sections and use forms like (DS), (SE), or comma-separated electives.

    IMPORTANT: for the computing-school matrix, the "BS CS (2025)" / "BS DS (2025)"
    / etc. rows above the Room/time header are only a colour LEGEND used to map
    background colour -> batch year (see build_colour_map / COLOUR_BATCH_MAP).
    They are NOT reliably aligned to department per column — a cell physically
    sitting under the "BS AI (2025)" legend can still legitimately contain
    "Civics (CS-G)". So whenever the cell text itself encodes a department
    (e.g. "(CS-G)"), that must win over the column's header_dept. header_dept
    is only used as a fallback when the cell doesn't specify a department at all.
    """
    parsed_depts = parsed["depts"]
    if is_ms_context(batch, header_dept) and (
            not parsed["has_section"] or is_ms_context(batch, header_dept)):
        ms_depts = [f"MS ({dept})" for dept in parsed_depts if dept in COMPUTING_PROGRAM_CODES]
        if ms_depts:
            return ms_depts
        if header_dept and is_ms_context(batch, header_dept):
            return [header_dept]
        return []
    # Prefer the department encoded directly in the cell text over the
    # column's positional header — the cell is the source of truth.
    if parsed_depts:
        return [normalize_dept_key(dept) for dept in parsed_depts]
    if header_dept:
        return [header_dept]
    return []

# ---------------------------------------------------------------------------
# Batch inference (fallback only — used when cell has no mapped colour)
# ---------------------------------------------------------------------------

def infer_batch_from_course(course_name):
    name = (course_name or "").upper()
    if re.search(
        r"\b(CAPSTONE|FYP|SENIOR\s+PROJECT|FINAL\s+YEAR\s+PROJECT|"
        r"TECH\s+STARTUP|TECH\s+ENTREPRENEURSHIP|INNOVATION\s+LAB|"
        r"RESEARCH\s+METHODS|AI\s+ETHICS|DIGITAL\s+FORENSICS|"
        r"ETHICAL\s+HACK|MALWARE|BIG\s+DATA|BDA|AUTONOMOUS\s+VEHICLES|"
        r"ROBOTICS|IOT|PROFESSIONAL\s+ETHICS|BUSINESS\s+COMMUNICATION|"
        r"ENTRE|TECH\s+MGT|COMP\s+VISION|COMPUTER\s+VISION)\b", name):
        return "2022"
    if re.search(
        r"\b(COMPILER|COMP\s+CONST|PDC|PARALLEL|"
        r"ARTIFICIAL\s+INTELLIGENCE|\bAI\b|MACHINE\s+LEARNING|\bML\b|"
        r"DEEP\s+LEARN|DEEP\s+LEARNING|COMPUTER\s+NETWORKS|\bCN\b|"
        r"COMP\s+NET|SOFTWARE\s+ENGINEERING|\bSE\b|SPM|"
        r"PROJECT\s+MANAGEMENT|INFO\s+SEC|INFORMATION\s+SECURITY|PPIT|"
        r"PROFESSIONAL\s+PRACTICES|IMAGE\s+PROCESSING|\bDIP\b|"
        r"NATURAL\s+LANGUAGE|NLP|CLOUD\s+COMP|METRIC|GEN\s+AI|"
        r"GENERATIVE\s+AI|PRODUCT\s+DEV|GAME\s+DEV|MOBILE\s+APP|"
        r"STAT\s+MODELING|DIGITAL\s+MKTG|FIN\s+MGT)\b", name):
        return "2023"
    if re.search(
        r"\b(DATA\s+ST|DATA\s+STRUCTURES|OPERATING\s+SYSTEMS|\bOS\b|"
        r"DATABASE|\bDB\b|REQUIREMENTS|SRE|DESIGN\s+&\s+ARCHITECTURE|"
        r"SDA|COMPUTER\s+ORGANIZATION|COAL|PROBABILITY|PROB\s+&\s+STATS|"
        r"STATS\s+FOR\s+ML|LINEAR\s+ALGEBRA|DATA\s+ANALYSIS)\b", name):
        return "2024"
    if re.search(
        r"\b(OBJECT|OOP|DISCRETE|DIGITAL\s+LOGIC|DLD|MULTIVARIABLE|"
        r"MV\s+CALCULUS|APPLIED\s+PHYSICS|\bAP\b|PAK\s+STUDIES|"
        r"PAKISTAN|FUNCTIONAL\s+ENGLISH|EXP\s+WRITING|EXPOSITORY|"
        r"SEERAH|ISLAMIC|CIVICS|PROGRAMMING|\bPF\b|"
        r"INTRO\s+TO\s+COMPUTING|ITC|CALCULUS|COMPOSITION)\b", name):
        return "2025"
    return None

def resolve_batch(cell_colour, cell_text, course_name):
    """
    Three-tier batch resolution for a single data cell:

    1. Explicit year suffix in cell text:  "(CS-A, 25)"  → "2025"
       Most reliable — directly encoded in the cell.

    2. Cell background colour → COLOUR_BATCH_MAP lookup
       Reliable once COLOUR_BATCH_MAP is filled in from --discover output.
       This is THE primary mechanism for the computing school matrix format.

    3. Course-name inference (last resort)
       Fragile — only works for courses with distinctive names.
       Falls back to "2023" if nothing matches.
    """
    # Tier 1 — explicit suffix
    m = re.search(r",\s*(\d{2})\s*\)", cell_text)
    if m:
        short = m.group(1)
        return BATCH_MAP.get(short, "20" + short)

    # Tier 2 — colour lookup
    batch = colour_to_batch(cell_colour)
    if batch:
        return batch

    # Tier 3 — course name inference, with "2023" as final default
    return infer_batch_from_course(course_name) or "2023"

# ---------------------------------------------------------------------------
# Room normalisation
# ---------------------------------------------------------------------------

def normalise_room(room):
    r = one_line(room).upper()
    r = re.sub(r"\s+", " ", r)
    r = re.sub(r"-{2,}", "-", r)
    r = re.sub(r"\b([A-D])\s+(\d{3})\b", r"\1-\2", r)
    m = re.match(
        r"([A-D])\s*-\s*(\d{3}|IT\s*LAB\s*\d+|MARGALA\s*\d*|"
        r"RAWAL\s*\d*|GPU\s*LAB|MEHRAN\s*\d*|CALL-\d+|DIGITAL\b)", r)
    if m:
        return f"{m.group(1).upper()}-{m.group(2).strip()}"
    return r

# ---------------------------------------------------------------------------
# Timetable accumulator
# ---------------------------------------------------------------------------

def add_course(tt, dept, batch, section, day, course, room, time):
    if not all([dept, batch, section, day, course, room, time]):
        return False
    depts = dept if isinstance(dept, list) else [dept]
    added = False
    for d in depts:
        tt.setdefault(d, {})
        tt[d].setdefault(batch, {})
        tt[d][batch].setdefault(section, {})
        tt[d][batch][section].setdefault(day, [])
        arr = tt[d][batch][section][day]
        if not any(x["c"] == course and x["l"] == room and x["t"] == time for x in arr):
            arr.append({"c": course, "l": room, "t": time})
            added = True
    return added

# ---------------------------------------------------------------------------
# Sheet structure helpers
# ---------------------------------------------------------------------------

def find_header_row(text_grid):
    for r in range(min(len(text_grid), 10)):
        cell = one_line(text_grid[r][0] if text_grid[r] else "")
        if "room" in cell.lower():
            slots_found = sum(
                1 for c_idx in SLOT_COLS
                if c_idx < len(text_grid[r]) and re.match(r"\d{1,2}:\d{2}", one_line(text_grid[r][c_idx] or ""))
            )
            if slots_found >= 4:
                return r
    return -1

def find_lab_header_row(text_grid, after_row):
    for r in range(after_row, len(text_grid)):
        col_a = one_line(text_grid[r][0] if text_grid[r] else "").lower()
        if "lab" in col_a:
            return r
        if len(text_grid[r]) > 1:
            col_b = one_line(text_grid[r][1] or "")
            if re.match(r"^\d{1,2}:\d{2}-(?:1[0-5]|0\d|2[0-3]):\d{2}$", col_b):
                if sum(1 for c in text_grid[r] if one_line(c)) <= 6:
                    return r
    return -1

def build_col_dept_map(header_rows):
    """
    Build a mapping from column index to department prefix string.
    
    From header rows like:
      [Room, BS CS (2025), BS CS (2025), ..., MS (CS), MS (CS), ...]
    
    Extract and store the department string for each column (after the room column).
    Fills merged-cell gaps so that columns between headers inherit from the last header.
    """
    col_dept = {}

    if not header_rows:
        return col_dept
    if header_rows and not isinstance(header_rows[0], list):
        header_rows = [header_rows]

    max_cols = max((len(row) for row in header_rows), default=0)

    for row in header_rows:
        dept_starts = []
        for col, header_text in enumerate(row):
            dept = extract_dept_from_header(header_text)
            if dept:
                dept_starts.append((col, dept))

        for idx, (start_col, dept) in enumerate(dept_starts):
            end_col = dept_starts[idx + 1][0] if idx + 1 < len(dept_starts) else max_cols
            for col in range(max(1, start_col), end_col):
                col_dept[col] = dept
    
    return col_dept

# ---------------------------------------------------------------------------
# Matrix block parser — now receives both text_grid and colour_grid
# ---------------------------------------------------------------------------

def parse_matrix_block(text_grid, colour_grid, start_row, end_row, block, day, tt, col_dept_map=None):
    """
    Parse one rectangular block of the computing school matrix.

    For each data cell:
      - text comes from text_grid[r][col]
      - background colour comes from colour_grid[r][col]
      - batch is resolved via resolve_batch(colour, text, course_name)
      - department comes from the header column via col_dept_map (if available)
    """
    if col_dept_map is None:
        col_dept_map = {}
    
    added = 0
    for r in range(start_row, min(end_row, len(text_grid))):
        row = text_grid[r]
        if not row:
            continue
        room = normalise_room(one_line(row[block["room_col"]] if len(row) > block["room_col"] else ""))
        if (not room or len(room) < 2 or
                re.search(r"reserved|tutorial|fsm|fsa|fcss|fyp|travel|admin|room",
                          room, re.IGNORECASE)):
            continue

        sc = block["slot_cols"]
        for i in range(len(sc)):
            time_col = sc[i]
            next_col = sc[i + 1] if i + 1 < len(sc) else block.get("end_col") or len(row)
            scan_end = min(next_col, len(row)) if next_col else len(row)

            for col in range(time_col, scan_end):
                cell_text = one_line(row[col] if col < len(row) else "")
                if not cell_text:
                    continue
                parsed = parse_timetable_cell(cell_text)
                if not parsed:
                    continue

                # Pull this cell's background colour from colour_grid
                cell_colour = None
                if r < len(colour_grid) and col < len(colour_grid[r]):
                    cell_colour = colour_grid[r][col]

                batch = resolve_batch(cell_colour, cell_text, parsed["course"])
                if not batch:
                    continue

                header_dept = col_dept_map.get(col)
                depts_to_add = resolve_departments_for_cell(parsed, header_dept, batch)
                section = parsed["section"]
                if not section and any(is_ms_context(batch, dept) for dept in depts_to_add):
                    section = "A"
                if not section:
                    continue
                
                # Yellow cells are repeat classes: route them to a dedicated
                # REPEAT bucket (regardless of the year they'd otherwise map
                # to) so they surface under the frontend's "Repeat Courses"
                # department instead of polluting a normal batch.
                store_batch = REPEAT_BATCH_KEY if is_yellow(cell_colour) else batch
                for dept_key in depts_to_add:
                    if add_course(tt, dept_key, store_batch, section,
                                  day, parsed["course"], room,
                                  block["slot_map"][time_col]):
                        added += 1
                break  # found the cell for this slot, move to next slot

    return added

def parse_grid_to_tt(text_grid, colour_grid, day, tt):
    hr = find_header_row(text_grid)
    if hr < 0:
        return 0
    lr = find_lab_header_row(text_grid, hr + 1)
    classroom_end = lr if lr > 0 else len(text_grid)
    
    # Department labels are usually merged cells in the rows above the Room/time header.
    dept_header_rows = text_grid[max(0, hr - 3):hr + 1]
    col_dept_map = build_col_dept_map(dept_header_rows)
    
    added = 0
    added += parse_matrix_block(text_grid, colour_grid, hr + 1, classroom_end, CLASSROOM_LEFT,  day, tt, col_dept_map)
    added += parse_matrix_block(text_grid, colour_grid, hr + 1, classroom_end, CLASSROOM_RIGHT, day, tt, col_dept_map)
    if lr > 0:
        added += parse_matrix_block(text_grid, colour_grid, lr + 1, len(text_grid), LAB_BLOCK, day, tt, col_dept_map)
    return added


def generate(service):
    school_name = "computing"
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
        day = tab.strip().capitalize()
        if day not in DAYS:
            dlog_warn(f"  Tab '{tab}' does not map to a valid day ??? skipping")
            continue

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

        added = parse_grid_to_tt(text_grid, colour_grid, day, tt)
        total += added
        print(f"{added} entries")
        dlog(f"  {school_name}/{tab}: {added} entries parsed")

    dlog(f"  {school_name} total: {total} entries, {len(tt)} depts")
    return tt, total
