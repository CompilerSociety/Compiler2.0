"""Computing-school timetable parser."""

import re

from ..colour_mapper import colour_dept_label, colour_to_batch, is_yellow
from ..config import (
    ALL_SECTIONS,
    BATCH_MAP,
    CELL_RE,
    CELL_TIME_OVERRIDE_RE,
    SECTION_ONLY_RE,
    CLASSROOM_LEFT,
    CLASSROOM_RIGHT,
    DAYS,
    LAB_BLOCK,
    PHD_BATCH_KEY,
    PHD_CODES,
    PHD_DEPT_KEY,
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

# A cell that is just a course title — no "(DEPT-SECTION)" parenthetical at
# all, e.g. "Fund of SPM", "PPIT Seminar", "Securing Cloud". These were
# dropped outright; they are real classes whose department has to be inferred
# from context instead (see flush_bare).
BARE_COURSE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9&/.,'’\- ]{2,}$")

# Things written in a class cell that are not classes. Word-anchored so a
# real title keeps its place — "admin" must not reject "Administration".
NOT_A_CLASS_RE = re.compile(
    r"\b(?:reserved|reseved|resrved|tutorial|meeting|lunch|holiday|travel|admin)\b"
    r"|^(?:fsm|fsa|fcss|fyp|ee)$",
    re.IGNORECASE)

# The sheet writes its banners letter-spaced ("P R A Y E R  B R E A K"), so
# these are matched against the text with whitespace removed.
BANNER_RE = re.compile(r"prayer|break", re.IGNORECASE)
def status_note(text):
    """Return the only two timetable-change notes supported by the UI."""
    value = one_line(text)
    if re.search(r"\bcancel", value, re.IGNORECASE):
        return "Cancelled"
    if re.search(r"\bresch\b|reschedul", value, re.IGNORECASE):
        return "Rescheduled"
    return ""


def parse_bare_course_cell(text):
    """A cell naming a course but no department. None if it isn't a class."""
    if not BARE_COURSE_RE.match(text):
        return None
    if NOT_A_CLASS_RE.search(text) or BANNER_RE.search(re.sub(r"\s+", "", text)):
        return None
    return {
        "course": text,
        "note": status_note(text),
        "depts": [],
        "section": None,
        "has_section": False,
        "time_override": None,
        "bare": True,
    }


def parse_timetable_cell(text):
    if not text:
        return None
    t = one_line(text)
    paren = t.find(")")
    core = t[:paren + 1] if paren >= 0 else t
    tail = t[paren + 1:] if paren >= 0 else ""
    # Anything after the closing paren may carry an explicit time for this
    # class, which takes precedence over the column it sits in.
    ov = CELL_TIME_OVERRIDE_RE.search(tail)
    time_override = f"{ov.group(1)}-{ov.group(2)}" if ov else None
    m = CELL_RE.match(core)
    if not m:
        return parse_bare_course_cell(t)
    course  = m.group(1).strip()
    dept_str = m.group(2)
    section  = m.group(3)
    subgroup = m.group(4)
    group = m.group(5)
    raw_codes = [d.strip().upper() for d in re.split(r"\s*[/,]\s*", dept_str) if d.strip()]
    # Reject single-letter codes that aren't valid department codes (e.g. "G" from "G-I")
    depts = [d for d in raw_codes if len(d) >= 2]
    if not depts:
        # "Web Comp (A)" — the parenthetical is a bare section letter, not a
        # department. Keep the cell and let the column header supply the dept.
        if len(raw_codes) == 1 and SECTION_ONLY_RE.match(raw_codes[0]) and not section:
            section = raw_codes[0].upper()
        else:
            return None
    # "UHQ-I & II (MS-SE)" names the degree first and the programme where a
    # section letter would normally go. Read as-is it produced department
    # "MS" with section "SE", which the accumulator then filed as a BS
    # department holding sections named after programmes. The programme is
    # the department here, and the cell names no section.
    if depts == ["MS"] and section and len(section) >= 2:
        depts, section = [section.upper()], None
    if not section and group:
        section = f"G-{group.upper()}"
    if subgroup:
        # Label with the actual section letter + subgroup digit (e.g. "G1", "B1")
        # instead of a generic "Gp 1" that's indistinguishable across sections.
        sub_label = f"{section}{subgroup}" if section else f"Gp {subgroup}"
        course = f"{course} ({sub_label})"
    return {
        "course": course,
        # Keep this separate from the title. The API already uses the same
        # trailing-cell convention; persisting it lets notification jobs read
        # the durable snapshot rather than relying on a live API response.
        "note": status_note(tail),
        "depts": depts,
        "section": section,
        "has_section": bool(section),
        "time_override": time_override,
        "bare": False,
    }

# A programme code as the sheet writes it inside a cell: "CS", "AIHS", "CI".
PROGRAMME_CODE_RE = re.compile(r"^[A-Z]{2,5}$")


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
    if any(dept in PHD_CODES for dept in parsed_depts):
        return [PHD_DEPT_KEY]
    if is_ms_context(batch, header_dept) and (
            not parsed["has_section"] or is_ms_context(batch, header_dept)):
        # The code written in the cell is the programme, whether or not it is
        # one of the five BS programmes: the school also runs MS Computational
        # Intelligence and MS AI in Health Sciences. Restricting this to
        # COMPUTING_PROGRAM_CODES sent every "(CI)" and "(AIHS)" cell to
        # whatever the column header said, which parked both programmes in
        # "BS SE" — a BS department holding MS courses.
        ms_depts = [f"MS ({dept})" for dept in parsed_depts
                    if PROGRAMME_CODE_RE.match(dept)]
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

def resolve_batch(cell_colour, cell_text, course_name, dept_codes=None):
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

    dept_codes are the department codes parsed from the cell text (e.g.
    ["CS"] from "Cloud Comp (CS-A)"). They only matter for tier 2, and only
    for the handful of fills the sheet reuses across two cohorts — see
    colour_to_batch().
    """
    # Tier 0 — a doctoral cell has no entry year to resolve at all.
    if dept_codes and any(d in PHD_CODES for d in dept_codes):
        return PHD_BATCH_KEY

    # Tier 1 — explicit suffix
    m = re.search(r",\s*(\d{2})\s*\)", cell_text)
    if m:
        short = m.group(1)
        return BATCH_MAP.get(short, "20" + short)

    # Tier 2 — colour lookup
    batch = colour_to_batch(cell_colour, dept_codes)
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
    # Names written without their block letter. The sheet has the same room as
    # "C-Rawal 3", "Rawal 3 (GPU)" and "Rawal-3"; left alone they became three
    # different rooms, so Free Rooms showed one of them idle while a class was
    # actually in it. The Margala and Rawal labs are all C block.
    m = re.match(r"(MARGALA|RAWAL)\s*-?\s*(\d+)\b", r)
    if m:
        return f"C-{m.group(1)} {m.group(2)}"
    return r

# ---------------------------------------------------------------------------
# Timetable accumulator
# ---------------------------------------------------------------------------

def add_course(tt, dept, batch, section, day, course, room, time, note=""):
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
        existing = next((x for x in arr
                         if x["c"] == course and x["l"] == room and x["t"] == time), None)
        if existing is None:
            entry = {"c": course, "l": room, "t": time}
            if note:
                entry["n"] = note
            arr.append(entry)
            added = True
        elif note and existing.get("n") != note:
            # Duplicate cells occasionally occur in a slot band. Preserve the
            # class count, but never discard a change note found in a later
            # copy of the same class.
            existing["n"] = note
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

# A header cell's time label, e.g. "08:30-09:50" or the lab row's
# "05:20 - 08:05 (inc. 10 min. break)".
TIME_LABEL_RE = re.compile(r"(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})")


def _slot_labels(row):
    """{column: 'HH:MM-HH:MM'} for every time label in one header row."""
    labels = {}
    for col, value in enumerate(row):
        m = TIME_LABEL_RE.match(one_line(value))
        if m:
            labels[col] = f"{m.group(1)}-{m.group(2)}"
    return labels


# The header cell that opens a block of rooms. Matched as a prefix, not by
# equality: on 15 Aug 2026 the sheet renamed the daytime header on all six day
# tabs from "Room" to "Room/ Time". An equality test stopped seeing column 0 as
# a Room column, detect_blocks built a single block on the evening Room column
# instead, and the whole daytime timetable — 814 classes, every 08:30–05:15
# slot — vanished from the JSON while labs and evening classes still came
# through, so the run still looked like it had worked.
ROOM_HEADER_RE = re.compile(r"^rooms?\b", re.IGNORECASE)


def _room_cols(row):
    return [c for c, v in enumerate(row) if ROOM_HEADER_RE.match(one_line(v))]


def detect_blocks(text_grid, header_row, lab_row):
    """
    Read this tab's block geometry from its own header rows.

    Every "Room" column opens a block, and the time labels to its right — up
    to the next Room column — are that block's slots, each spanning until the
    next label. The classroom header row describes the daytime and evening
    blocks; the lab header row describes the lab block.

    Friday is why this is detected rather than assumed. Its day slots sit at
    columns 1, 6, 11, 16, 19, 24 (not 21, 26), its evening Room column is 28
    (not 30), and its labs have two slots, not four. Read through the
    hardcoded config columns, 17 Friday classes were stored at the wrong time
    — the labs three hours early — and four evening classes landed in the
    afternoon band wearing the daytime room.

    Returns a list of blocks shaped like the config constants, so
    parse_matrix_block does not care where they came from. Falls back to the
    config geometry for a tab whose headers can't be read.
    """
    blocks = []

    def build(name, labels_row, room_col, first_col, stop_col, rows):
        labels = _slot_labels(text_grid[labels_row])
        cols = sorted(c for c in labels
                      if first_col <= c and (stop_col is None or c < stop_col))
        if not cols:
            return None
        return {
            "name": name,
            "room_col": room_col,
            "end_col": stop_col,
            "slot_cols": cols,
            "slot_map": {c: labels[c] for c in cols},
            "rows": rows,
        }

    classroom_end = lab_row if lab_row > 0 else len(text_grid)
    room_cols = _room_cols(text_grid[header_row]) if header_row < len(text_grid) else []
    for i, room_col in enumerate(room_cols):
        stop = room_cols[i + 1] if i + 1 < len(room_cols) else None
        block = build("classroom" if i == 0 else "evening", header_row,
                      room_col, room_col + 1, stop, (header_row + 1, classroom_end))
        if not block:
            continue
        if i > 0:
            # The evening block has its own Room column, and the rooms genuinely
            # differ from the daytime ones (Wednesday row 9 is C-305 in the day
            # column but D-305 in the evening one), so the daytime column must
            # never be substituted here. The sheet only fills the evening Room
            # column on Wednesday, which dropped every Mon/Tue/Thu evening class
            # — essentially the whole MS programme. Emit them with an unknown
            # room instead of losing them. The real fix is upstream: fill the
            # evening Room column on the other day tabs.
            block["blank_room_fallback"] = "TBA"
        blocks.append(block)

    # Every time label in the header row has to belong to some block. A label
    # left uncovered means a Room column the sheet moved or renamed, and the
    # slot under it is read by nobody — which is how the "Room/ Time" rename
    # above emptied the daytime timetable without failing the run.
    header_labels = (_slot_labels(text_grid[header_row])
                     if header_row < len(text_grid) else {})
    uncovered = sorted(set(header_labels) - {c for b in blocks for c in b["slot_cols"]})
    if uncovered:
        dlog_warn(
            "  header row has time columns that no Room column opens a block "
            "for: " + ", ".join(f"col {c} ({header_labels[c]})" for c in uncovered)
            + " — those slots will not be read. Check the Room header cells.")

    if not blocks:
        dlog_warn("  no Room columns found in the header row — using config geometry")
        blocks = [dict(CLASSROOM_LEFT, name="classroom",
                       rows=(header_row + 1, classroom_end)),
                  dict(CLASSROOM_RIGHT, name="evening",
                       rows=(header_row + 1, classroom_end))]

    if lab_row > 0:
        lab_room_cols = _room_cols(text_grid[lab_row]) or [0]
        lab_blocks = []
        for i, room_col in enumerate(lab_room_cols):
            stop = lab_room_cols[i + 1] if i + 1 < len(lab_room_cols) else None
            block = build("lab" if i == 0 else f"lab-{i}", lab_row, room_col,
                          room_col + 1, stop, (lab_row + 1, len(text_grid)))
            if block:
                lab_blocks.append(block)
        if not lab_blocks:
            lab_blocks = [dict(LAB_BLOCK, name="lab",
                               rows=(lab_row + 1, len(text_grid)))]
        blocks.extend(lab_blocks)

    return blocks


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

def parse_matrix_block(text_grid, colour_grid, start_row, end_row, block, day, tt,
                       col_dept_map=None, pending=None, bare=None):
    """
    Parse one rectangular block of the computing school matrix.

    For each data cell:
      - text comes from text_grid[r][col]
      - background colour comes from colour_grid[r][col]
      - batch is resolved via resolve_batch(colour, text, course_name)
      - department comes from the header column via col_dept_map (if available)

    `bare` collects the cells that name a course but no department, together
    with the evidence needed to place them later — see flush_bare.
    """
    if col_dept_map is None:
        col_dept_map = {}
    if pending is None:
        pending = []

    added = 0
    for r in range(start_row, min(end_row, len(text_grid))):
        row = text_grid[r]
        if not row:
            continue
        room = normalise_room(one_line(row[block["room_col"]] if len(row) > block["room_col"] else ""))
        if not room:
            # A blank room column normally means the row isn't a class row.
            # The evening block is the exception — see "blank_room_fallback"
            # in config.CLASSROOM_RIGHT. Any class cells on this row are
            # emitted with an unknown room rather than dropped; rows with no
            # parseable cells still add nothing.
            fallback = block.get("blank_room_fallback")
            if not fallback:
                continue
            room = fallback
        elif (len(room) < 2 or
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

                # An explicit time in the cell beats the column's slot.
                slot_time = parsed["time_override"] or block["slot_map"][time_col]

                if parsed.get("bare"):
                    # A course title with no department — "Fund of SPM",
                    # "Securing Cloud". Nothing on the cell says whose class
                    # it is, so hold it until the whole week has been read and
                    # place it from context (flush_bare).
                    if bare is not None:
                        bare["cells"].append({
                            "row_key": (day, block["name"], r),
                            "course": parsed["course"], "day": day,
                            "room": room, "time": slot_time, "colour": cell_colour,
                            "note": parsed.get("note", ""),
                        })
                    continue

                batch = resolve_batch(cell_colour, cell_text, parsed["course"],
                                      parsed["depts"])
                if not batch:
                    continue

                header_dept = col_dept_map.get(col)
                depts_to_add = resolve_departments_for_cell(parsed, header_dept, batch)
                section = parsed["section"]
                if not section and any(is_ms_context(batch, dept) for dept in depts_to_add):
                    section = "A"

                # Yellow cells are repeat classes: route them to a dedicated
                # REPEAT bucket (regardless of the year they'd otherwise map
                # to) so they surface under the frontend's "Repeat Courses"
                # department instead of polluting a normal batch.
                store_batch = REPEAT_BATCH_KEY if is_yellow(cell_colour) else batch

                if bare is not None:
                    # Evidence for the dept-less cells: what this row, and
                    # this course, resolved to elsewhere.
                    for dept_key in depts_to_add:
                        bare["row"].setdefault((day, block["name"], r), []).append(
                            (dept_key, store_batch))
                        bare["course"].setdefault(
                            course_key(parsed["course"]), []).append(
                                (dept_key, store_batch))

                if not section:
                    # Cells like "Project (AI/DS)" or "HCI (SE, 22)" name no
                    # section because they apply to the whole batch. Dropping
                    # them silently emptied the final-year timetables, so hold
                    # them here and fan them out across that batch's sections
                    # once every day has been read (see flush_sectionless).
                    pending.append({
                        "depts": depts_to_add, "batch": store_batch, "day": day,
                        "course": parsed["course"], "room": room, "time": slot_time,
                        "note": parsed.get("note", ""),
                    })
                    continue

                for dept_key in depts_to_add:
                    if add_course(tt, dept_key, store_batch, section,
                                  day, parsed["course"], room, slot_time,
                                  parsed.get("note", "")):
                        added += 1
                # Keep scanning: a slot band can hold more than one class.
                # Stopping at the first cell lost every second class in a
                # shared band — "Ideology of Pak (AI-C) 12:30-02:15" sitting
                # beside another class under the same 11:30-12:50 label.

    return added

def parse_grid_to_tt(text_grid, colour_grid, day, tt, pending=None, bare=None):
    hr = find_header_row(text_grid)
    if hr < 0:
        return 0
    lr = find_lab_header_row(text_grid, hr + 1)

    # Department labels are usually merged cells in the rows above the Room/time header.
    dept_header_rows = text_grid[max(0, hr - 3):hr + 1]
    col_dept_map = build_col_dept_map(dept_header_rows)

    added = 0
    for block in detect_blocks(text_grid, hr, lr):
        start_row, end_row = block["rows"]
        added += parse_matrix_block(text_grid, colour_grid, start_row, end_row,
                                    block, day, tt, col_dept_map, pending, bare)
    return added


def flush_sectionless(tt, pending):
    """
    Place the cells that named no section.

    These are batch-wide listings — "Project (AI/DS)", "HCI (SE, 22)" — where
    the sheet gives a department and year but no section letter. Previously
    they were dropped, which left the final-year timetables nearly empty.

    They are stored ONCE under the reserved ALL_SECTIONS key rather than copied
    into every section. Copying would both inflate the file and assert
    something the sheet does not say: a single lab cannot hold an entire batch,
    so "every section attends this" would be a fabrication. The frontend merges
    ALL_SECTIONS into whichever section the student picks (see loadTT), so the
    class is visible to the whole batch while the data stays truthful about
    what the sheet actually states.
    """
    added = 0
    for item in pending:
        for dept in item["depts"]:
            if add_course(tt, dept, item["batch"], ALL_SECTIONS, item["day"],
                          item["course"], item["room"], item["time"], item.get("note", "")):
                added += 1
    return added


def course_key(name):
    """Comparison key for a course title, ignoring case/punctuation/spacing."""
    return re.sub(r"[^a-z0-9]+", " ", one_line(name).lower()).strip()


def _depts_from(evidence):
    """The distinct department keys in a list of (dept, batch) pairs.

    Only the department is taken. A row can mix batches — D-504 holds
    "Blockchain (CY-A)" from one cohort and "Web Prog (CY-A)" from another —
    and copying a cell into both would assert something the sheet does not
    say. The batch comes from the cell's own fill instead.
    """
    out = []
    for dept, _batch in evidence or []:
        if dept not in out:
            out.append(dept)
    return out


def flush_bare(tt, bare):
    """
    Place the cells that named a course but no department.

    "Fund of SPM", "PPIT Seminar", "Securing Cloud" — the sheet writes these
    with no "(DEPT-SECTION)" parenthetical at all, and they were dropped, so
    14 real classes never reached the JSON. Nothing on the cell identifies the
    cohort, so it is read the way a person reads the sheet, best evidence
    first:

      1. the rest of the cell's own row in the same block — "Fund of SPM"
         sits in D-404 beside "App HCI (CS-A)" and "App HCI (CS-B)", so it is
         that row's cohort;
      2. the same course elsewhere in the week, for a row that offers no other
         cell (Wednesday's "Fund of SPM" is alone in its row, but Monday's is
         not);
      3. the legend that owns the cell's fill — this is what places the
         evening electives, whose swatch reads "MS Electives (All Prgrms)".

    A cell that survives all three has nothing left to attribute it to and is
    dropped, with a warning naming it.
    """
    added = 0
    # Two passes: a cell placed from its row also teaches us where that course
    # belongs, which is the only evidence available to the same course on a
    # row where it sits alone (Wednesday's "Fund of SPM" has no neighbours;
    # Monday's has two).
    for use_course_evidence in (False, True):
        for cell in bare["cells"]:
            if cell.get("placed"):
                continue
            depts = _depts_from(bare["row"].get(cell["row_key"]))
            if not depts and use_course_evidence:
                depts = _depts_from(bare["course"].get(course_key(cell["course"])))
            if not depts and use_course_evidence:
                # Nothing but the fill is left. This is what places the evening
                # electives, whose swatch reads "MS Electives (All Prgrms)".
                label = colour_dept_label(cell["colour"])
                depts = [label] if label else []
            if not depts:
                continue

            # A repeat fill outranks everything: a retake offering is not part
            # of the cohort whose row it happens to sit in.
            codes = [re.sub(r"^(BS|MS)\s*", "", d).strip("() ") for d in depts]
            batch = (REPEAT_BATCH_KEY if is_yellow(cell["colour"])
                     else resolve_batch(cell["colour"], "", cell["course"], codes))

            cell["placed"] = True
            for dept in depts:
                bare["course"].setdefault(
                    course_key(cell["course"]), []).append((dept, batch))
                if add_course(tt, dept, batch, ALL_SECTIONS, cell["day"],
                              cell["course"], cell["room"], cell["time"], cell.get("note", "")):
                    added += 1

    for cell in bare["cells"]:
        if cell.get("placed"):
            continue
        # The sheet still establishes a real room occupancy even when it omits
        # the cohort label. Preserve the class under an explicit unassigned
        # bucket rather than guessing a department or falsely exposing the room
        # as free. The fill still supplies the batch where available.
        batch = resolve_batch(cell["colour"], "", cell["course"], []) or "Unknown"
        if add_course(tt, "Unassigned", batch, ALL_SECTIONS, cell["day"],
                      cell["course"], cell["room"], cell["time"], cell.get("note", "")):
            added += 1
        dlog_warn(f"  {cell['day']}: preserved unassigned class '{cell['course']}' "
                  f"in {cell['room']} at {cell['time']}")
    return added


def generate(service):
    school_name = "computing"
    school_info = SCHOOLS[school_name]
    tt = {}
    total = 0
    pending = []   # cells naming no section; placed once every day is read
    # cells naming no department; placed from context once every day is read
    bare = {"cells": [], "row": {}, "course": {}}

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

        added = parse_grid_to_tt(text_grid, colour_grid, day, tt, pending, bare)
        total += added
        print(f"{added} entries")
        dlog(f"  {school_name}/{tab}: {added} entries parsed")

    if pending:
        fanned = flush_sectionless(tt, pending)
        total += fanned
        dlog(f"  {school_name}: {len(pending)} section-less cells -> {fanned} entries")

    if bare["cells"]:
        placed = flush_bare(tt, bare)
        total += placed
        dlog(f"  {school_name}: {len(bare['cells'])} department-less cells "
             f"-> {placed} entries")

    dlog(f"  {school_name} total: {total} entries, {len(tt)} depts")
    return tt, total
