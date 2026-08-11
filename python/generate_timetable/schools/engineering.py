"""Engineering-school timetable parser."""

import re
from types import SimpleNamespace

from ..config import (
    COURSES_HEADER_BATCH_ONLY_RE,
    COURSES_HEADER_DEPT_BATCH_RE,
    COURSES_HEADER_MSPHD_RE,
    COURSES_HEADER_SEMESTER_RE,
    COURSES_SECTION_COLS,
    ENGINEERING_PROGRAMS,
    FSE_SECTION_RE,
    FSE_SUFFIX_RE,
    FSE_VALID_SECTIONS,
    REGRESSION_FORBIDDEN_COURSES,
    REGRESSION_WATCH_BATCH,
    REGRESSION_WATCH_DAY,
    REGRESSION_WATCH_DEPT,
    REPEAT_ANNOTATION_RE,
    REPEAT_ANNOTATION_STOPWORDS,
    REPEAT_BATCH_KEY,
    SCHOOLS,
)
from ..google_sheets import fetch_sheet_with_colours, get_sheet_tab_names
from ..helpers import (
    add_course,
    clean,
    dlog,
    dlog_error,
    dlog_warn,
    normalise_room,
    one_line,
)

COMMON = SimpleNamespace(
    dlog=dlog,
    dlog_error=dlog_error,
    dlog_warn=dlog_warn,
    one_line=one_line,
    clean=clean,
    fetch_sheet_with_colours=fetch_sheet_with_colours,
    normalise_room=normalise_room,
    add_course=add_course,
    DAYS=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    REPEAT_BATCH_KEY=REPEAT_BATCH_KEY,
)

def normalize_course_name(name):
    """
    Normalize a course title for cross-referencing between the schedule
    grid (titles only) and the Courses SP-26 tab (titles + codes + repeat
    annotations). Case/punctuation/whitespace differences between the two
    tabs are common, so this intentionally strips all of that.
    """
    n = (name or "").strip().lower()
    n = n.replace("&", "and")
    n = re.sub(r'[.,]', '', n)
    n = re.sub(r'\s+', ' ', n)
    return n.strip()


def normalizeDay(raw):
    """Match a raw day string to canonical weekday name, or return None."""
    if not raw:
        return None
    raw = raw.strip().capitalize()
    DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
    if raw in DAYS:
        return raw
    abbr = {"Mon": "Monday", "Tue": "Tuesday", "Tues": "Tuesday", "Wed": "Wednesday",
            "Thu": "Thursday", "Thur": "Thursday", "Fri": "Friday"}
    return abbr.get(raw)


def parse_repeat_annotation(title):
    """
    Split a Courses-tab title into (is_repeat, other_depts_mentioned, clean_title).

    "Applied Calculus (EE & CE Repeat)" -> (True, ["EE", "CE"], "Applied Calculus")
    "Object Oriented Data Structures (Repeat)" -> (True, [], "Object Oriented Data Structures")
    "Linear Circuit Analysis" -> (False, [], "Linear Circuit Analysis")

    other_depts_mentioned lists depts named *inside* the annotation besides
    stopwords like "Repeat"/"and" — these are the depts for which this row
    is a repeat/shared opportunity, as opposed to their normal curriculum.
    A bare "(Repeat)" with no dept named means it's a repeat purely within
    the row's own home dept/batch (a retake section for that same batch).
    """
    m = REPEAT_ANNOTATION_RE.search(title)
    if not m:
        return False, [], title
    annotation = m.group(1)
    clean_title = (title[:m.start()] + title[m.end():]).strip()
    clean_title = re.sub(r'\s+', ' ', clean_title).strip()
    tokens = re.findall(r'\b[A-Za-z]{2,4}\b', annotation)
    other_depts = [t.upper() for t in tokens if t.upper() not in REPEAT_ANNOTATION_STOPWORDS]
    return True, other_depts, clean_title


# ---------------------------------------------------------------------------
# Schedule-grid cell parsing (Classes Schedule FSE SP-26 tab)
# ---------------------------------------------------------------------------

def parse_fse_course_title(title):
    """
    Parse an FSE engineering course title to extract:
      - base course name
      - program codes: ["EE"], ["CE"], ["EE","CE"], [], ["Int"], etc.
      - section letter: "A", "B", "C", "D"

    Returns (course_name, programs, section) or None if unparseable.

    Examples:
      "Linear Circuit Analysis A"       -> ("Linear Circuit Analysis", [], "A")
      "Prog. Fundamentals CE-A"         -> ("Prog. Fundamentals", ["CE"], "A")
      "Applied Calculus EE-CE-A"        -> ("Applied Calculus", ["EE", "CE"], "A")
      "Signal & Systems Lab CE-B"       -> ("Signal & Systems Lab", ["CE"], "B")
      "Applications of ICT Int-A"       -> ("Applications of ICT", ["Int"], "A")
      "Under. of Holy Quran I & II  A"  -> ("Under. of Holy Quran I & II", [], "A")
      "Digital Logic Design Lab CE- A"  -> ("Digital Logic Design Lab", ["CE"], "A")
      "Probability and Statistics CE/A" -> ("Probability and Statistics", ["CE"], "A")
    """
    if not title:
        return None
    t = re.sub(r"\s+", " ", str(title).replace("\u00a0", " ")).strip()
    if not t:
        return None

    # Skip non-course entries
    skip_words = ("reserved", "fsm", "fse faculty", "quiz", "pf quiz")
    if any(t.lower().startswith(w) for w in skip_words):
        return None
    # Skip time-only or location-only notes
    if re.match(r'^\d{1,2}:\d{2}', t) or re.match(r'^Room\b', t, re.IGNORECASE):
        return None

    m = FSE_SECTION_RE.match(t)
    if not m:
        return None

    course_name = m.group(1).strip()
    suffix_raw = m.group(2).strip()
    section = m.group(3).upper()

    if section not in FSE_VALID_SECTIONS:
        return None

    # Parse programs from the suffix (everything before the section letter)
    sm = FSE_SUFFIX_RE.match(suffix_raw)
    programs = []
    if sm:
        prog_part = sm.group(1)
        if prog_part:
            progs = [p.strip().upper() for p in re.split(r'[-/]', prog_part) if p.strip()]
            programs = progs

    # Validate: if the "course_name" is too short or looks like just a
    # program code, this is probably a mis-parse
    if len(course_name) < 3:
        return None

    return {
        "course": course_name,
        "programs": programs,
        "section": section,
    }


# ---------------------------------------------------------------------------
# Fallback heuristics (used ONLY when the Courses SP-26 tab has no matching
# row — kept as a safety net so the parser degrades gracefully rather than
# dropping the class entirely, but every use is logged via dlog_warn so
# gaps are visible instead of being silently guessed forever).
# ---------------------------------------------------------------------------

def fse_resolve_departments_fallback(parsed):
    """
    Map parsed FSE programs to department keys, purely from the schedule
    cell's own suffix — no Courses-tab cross-reference. This is the old
    (pre-fix) behaviour, retained only as a last-resort fallback.
    """
    programs = parsed.get("programs", [])
    if not programs:
        return ["BS EE"]

    depts = []
    for p in programs:
        p_upper = p.upper()
        if p_upper == "EE":
            depts.append("BS EE")
        elif p_upper == "CE":
            depts.append("BS CE")
        elif p_upper == "INT":
            depts.append("BS EE")
        else:
            depts.append("BS EE")
    return list(dict.fromkeys(depts))


def infer_fse_batch_fallback(course_name):
    """
    Infer batch year for an FSE engineering course using course-name
    keywords. FALLBACK ONLY (Phase 2) — the structural Courses-tab lookup
    (resolve_fse_entry) is the primary mechanism; this only fires when a
    course has no matching row in the Courses SP-26 tab.

    Spring 2026 semester mapping (engineering):
      Semester 2 (batch 2025): Linear Circuit Analysis, Prog. for Engineers,
                               Differential Equations, Linear Algebra,
                               Pakistan Studies, Applied Physics, Applied Calculus,
                               Civics, Understanding of Holy Quran, Applications of ICT,
                               Prog. Fundamentals (CE 2nd-sem), English Language
      Semester 4 (batch 2024): Signal & Systems, Digital Logic, Data Structures,
                               Probability, Communication Skills, Object Oriented,
                               Electrical Network Anal., Basic Mech. Engg,
                               Tech. Comm. Skills, Prob. & Random Prs.
      Semester 6 (batch 2023): Engineering Economics, Analog & Digital, Computer Arch,
                               Entrepreneurship, Operating Systems, Electro-Mechanical,
                               Network Programming, Feedback Control, Introduction to IOT,
                               Engineering Workshop
      Semester 8 (batch 2022): Power Electronics, Digital Signal Processing, VLSI,
                               Industrial Processes, Deep Learning, Computational Stat
    """
    name = (course_name or "").upper()

    if re.search(
        r'\b(LINEAR\s+CIRCUIT\s+ANALYSIS|PROG\.?\s+FOR\s+ENGINEERS|'
        r'DIFFERENTIAL\s+EQU|LINEAR\s+ALGEBRA|PAKISTAN\s+STUD|'
        r'APPLIED\s+PHYSICS|APPLIED\s+CALCULUS|'
        r'CIVICS|COMMUNITY\s+ENGAGEMENT|UNDERSTANDING\s+OF\s+HOLY|'
        r'APPLICATIONS\s+OF\s+ICT|PROG\.?\s+FUNDAMENTALS|'
        r'ENGLISH\s+LANGUAGE)', name):
        return "2025"

    if re.search(
        r'\b(SIGNAL\s+.?\s*SYSTEMS?|DIGITAL\s+LOGIC|DATA\s+STRUCT|'
        r'PROBABILITY|PROB\.?\s+.?\s*RANDOM|COMMUNICATION\s+SKILLS?|'
        r'OBJECT\s+ORIENTED|ELECTRICAL\s+NETWORK|'
        r'BASIC\s+MECH|TECH\.?\s+COMM)', name):
        return "2024"

    if re.search(
        r'\b(ENGINEERING\s+ECONOMICS|ANALOG|COMPUTER\s+ARCH|'
        r'ENTREPRENEURSHIP|OPERATING\s+SYSTEMS?|ELECTRO.?MECHANICAL|'
        r'NETWORK\s+PROGRAM|FEEDBACK\s+CONTROL|INTRODUCTION\s+TO\s+IOT|'
        r'ENGINEERING\s+WORKSHOP)', name):
        return "2023"

    if re.search(
        r'\b(POWER\s+ELECTRONICS?|DIGITAL\s+SIGNAL|VLSI|'
        r'INDUSTRIAL\s+PROC|DEEP\s+LEARN|COMPUTATIONAL\s+STAT)', name):
        return "2022"

    return "2024"  # safe middle-ground default


# ---------------------------------------------------------------------------
# Phase 2 — Courses SP-26 tab parsing (structural source of truth)
# ---------------------------------------------------------------------------

def parse_courses_tab(text_grid, common):
    """
    Parse the "Courses SP-26" tab into a lookup:
        normalized_course_name -> [record, ...]
    where each record is:
        {dept, batch, semester, is_repeat, code, raw_title, sections}

    dept is "EE" / "CE" / None (None = shared block, applies to both —
    used by the later, non-dept-split semesters e.g. "6th Semester Batch 2023").

    Also returns the flat list of all records, for cross-validation.
    """
    dlog = common.dlog
    one_line = common.one_line

    lookup = {}
    all_entries = []
    current_dept = None
    current_batch = None
    current_semester = None

    for row in text_grid:
        if not row:
            continue

        header_raw = one_line(row[0] if len(row) > 0 else "")
        if header_raw:
            header_norm = re.sub(r'\s+', ' ', header_raw).strip()
            m = COURSES_HEADER_DEPT_BATCH_RE.search(header_norm)
            if m:
                current_dept = m.group(1).upper()
                current_batch = m.group(2)
            else:
                m2 = COURSES_HEADER_MSPHD_RE.search(header_norm)
                if m2:
                    current_dept = m2.group(1).upper()
                    current_batch = "MS"
                else:
                    m3 = COURSES_HEADER_BATCH_ONLY_RE.search(header_norm)
                    if m3:
                        current_dept = None  # shared across EE & CE
                        current_batch = m3.group(1)
            sem_m = COURSES_HEADER_SEMESTER_RE.match(header_norm)
            if sem_m:
                current_semester = sem_m.group(1)

        code = one_line(row[1] if len(row) > 1 else "")
        title_raw = one_line(row[2] if len(row) > 2 else "")
        if not title_raw or not code:
            continue
        if title_raw.lower() in ("course/lab", "course", "lab"):
            continue

        is_repeat_annotated, other_depts, clean_title = parse_repeat_annotation(title_raw)

        # Two distinct meanings of a "(...Repeat)" annotation:
        #   "(Repeat)" alone (no dept named)      -> this row IS a repeat/
        #     retake offering for its OWN home dept/batch (some batch
        #     members are retaking a previous-semester course).
        #   "(EE & CE Repeat)" (other dept named) -> this row is the HOME
        #     dept's normal, non-repeat, current-semester course; it just
        #     also happens to serve as a repeat/retake opportunity for the
        #     OTHER named dept(s). The home dept's own listing is NOT a
        #     repeat for the home dept itself.
        # This distinction is exactly what fixes the Applied-Calculus bug:
        # EE gets it as a normal 2025 course, CE gets it as a REPEAT entry.
        home_is_repeat = is_repeat_annotated and not other_depts

        sections = []
        for idx, letter in COURSES_SECTION_COLS:
            val = one_line(row[idx] if len(row) > idx else "")
            if val:
                sections.append(letter)

        norm_name = normalize_course_name(clean_title)
        if not norm_name:
            continue

        record = {
            "dept": current_dept,
            "batch": current_batch,
            "semester": current_semester,
            "is_repeat": home_is_repeat,
            "code": code,
            "raw_title": title_raw,
            "sections": sections,
        }
        lookup.setdefault(norm_name, []).append(record)
        all_entries.append(record)

        # Any dept explicitly named inside the repeat annotation besides the
        # row's own home dept is a genuine repeat/shared applicability for
        # that dept — NOT that dept's normal batch curriculum. (Phase 1 + 3)
        for od in other_depts:
            if od == current_dept or od not in ENGINEERING_PROGRAMS:
                continue
            extra = {
                "dept": od,
                "batch": current_batch,
                "semester": current_semester,
                "is_repeat": True,
                "code": code,
                "raw_title": title_raw,
                "sections": sections,
            }
            lookup.setdefault(norm_name, []).append(extra)
            all_entries.append(extra)

    dlog(f"  FSE: Courses tab parsed — {len(all_entries)} rows, {len(lookup)} unique course names")
    return lookup, all_entries


def build_course_lookup(service, school_info, common):
    """
    Fetch and parse the "Courses SP-26" tab (configured via
    school_info['courses_tab']) into the structural lookup used by
    resolve_fse_entry(). Returns {} (with a warning logged) if the tab is
    missing or empty — callers must be able to run on the old keyword
    fallback in that case.
    """
    dlog = common.dlog
    dlog_warn = common.dlog_warn
    dlog_error = common.dlog_error

    courses_tab = school_info.get("courses_tab", "Courses SP-26")
    dlog(f"  FSE: fetching courses tab '{courses_tab}' for structural lookup")
    try:
        courses_text_grid, _ = common.fetch_sheet_with_colours(
            service, school_info["id"], courses_tab
        )
    except Exception as e:
        dlog_error(f"  FSE: could not fetch courses tab '{courses_tab}': {e}")
        courses_text_grid = []

    if not courses_text_grid:
        dlog_warn(
            f"  FSE: '{courses_tab}' returned empty/missing — "
            f"parsing will fall back to keyword heuristics for every course"
        )
        return {}

    lookup, _all_entries = parse_courses_tab(courses_text_grid, common)
    return lookup


# ---------------------------------------------------------------------------
# Phase 2/3 — structural resolution of dept + batch + repeat status
# ---------------------------------------------------------------------------

def resolve_fse_entry(parsed, course_lookup, common):
    """
    Resolve department(s) + batch + repeat-status for a parsed FSE schedule
    cell, using the Courses SP-26 tab as the structural source of truth
    (Phase 2) instead of keyword-based inference (infer_fse_batch_fallback).

    Returns a list of (dept_key, batch, is_repeat) tuples, e.g.:
      [("BS EE", "2025", False)]
      [("BS EE", "2025", False), ("BS CE", "2025", True)]   # repeat for CE
    """
    dlog_warn = common.dlog_warn
    norm_name = normalize_course_name(parsed["course"])
    candidates = course_lookup.get(norm_name, [])

    results = []
    programs = parsed.get("programs", [])

    if programs:
        for p in programs:
            p_upper = p.upper()
            if p_upper == "INT":
                # Integrated-programme rows aren't in the Courses tab under
                # a dept code — no structural signal available, fall back.
                results.append(("BS EE", infer_fse_batch_fallback(parsed["course"]), False))
                continue

            match = next((c for c in candidates if c["dept"] == p_upper), None)
            if not match:
                # Shared/general Courses-tab rows (dept=None, e.g. 6th/8th
                # semester blocks) apply equally to EE and CE.
                match = next((c for c in candidates if c["dept"] is None), None)

            if match:
                results.append((f"BS {p_upper}", match["batch"], match["is_repeat"]))
            else:
                dlog_warn(
                    f"  FSE: no Courses-tab match for '{parsed['course']}' "
                    f"(dept {p_upper}) — falling back to keyword heuristic"
                )
                results.append((f"BS {p_upper}", infer_fse_batch_fallback(parsed["course"]), False))
    else:
        # No program suffix on the cell (e.g. "Linear Circuit Analysis A").
        distinct_depts = {c["dept"] for c in candidates if c["dept"]}
        if len(distinct_depts) == 1:
            dept = next(iter(distinct_depts))
            match = next(c for c in candidates if c["dept"] == dept)
            results.append((f"BS {dept}", match["batch"], match["is_repeat"]))
        elif len(distinct_depts) > 1:
            section = parsed.get("section")
            picked = [c for c in candidates if c["dept"] and section in c.get("sections", [])]
            if len(picked) == 1:
                c = picked[0]
                results.append((f"BS {c['dept']}", c["batch"], c["is_repeat"]))
            else:
                dlog_warn(
                    f"  FSE: ambiguous dept for '{parsed['course']}' section "
                    f"{section} (candidates: {sorted(distinct_depts)}) — defaulting to BS EE"
                )
                results.append(("BS EE", infer_fse_batch_fallback(parsed["course"]), False))
        else:
            dlog_warn(
                f"  FSE: no Courses-tab match for '{parsed['course']}' — "
                f"falling back to keyword heuristic (BS EE)"
            )
            results.append(("BS EE", infer_fse_batch_fallback(parsed["course"]), False))

    return results


# ---------------------------------------------------------------------------
# Main grid parser (Classes Schedule FSE SP-26 tab)
# ---------------------------------------------------------------------------

def parse_engineering_grid(text_grid, colour_grid, tt, course_lookup, common):
    """
    Parse the FSE engineering timetable.

    The sheet has ALL five weekdays on a single tab. Structure per day:
      - Header row: [_, _, Room, time1, ..., time6]   (times at cols ~3,21,39,57,75,93)
      - Classes block: rooms in col 2, courses in time-slot columns
      - LABS header row: [_, Labs, LABS, time1, ..., time6]
      - Labs block: lab-type names in col 2, courses in time-slot columns
      - Each course entry uses two rows: course title, then instructor name

    Day labels appear in column 0 at the start of each day's section.

    Department + batch + repeat-status now come from resolve_fse_entry(),
    backed by the Courses SP-26 tab (Phase 2), not course-name keyword
    guessing. Repeat / shared-with-other-dept offerings are written into a
    REPEAT bucket instead of merged into the primary batch bucket
    (Phase 1 + Phase 3), so they no longer contaminate e.g. BS CE/2025/A.

    Returns (added_count, matched_records) where matched_records is a set
    of (normalized_course_name, bare_dept) pairs that were successfully
    resolved via the Courses tab — used by cross_validate() (Phase 5).
    """
    dlog = common.dlog
    dlog_warn = common.dlog_warn
    one_line = common.one_line
    normalise_room = common.normalise_room
    add_course = common.add_course
    DAYS = common.DAYS
    REPEAT_BATCH_KEY = common.REPEAT_BATCH_KEY

    added = 0
    matched_records = set()
    total_rows = len(text_grid)
    if total_rows < 5:
        return 0, matched_records

    # ── Pre-pass: map every row to its active day based on col 0 ────────────
    row_days = [None] * total_rows
    curr_day = None
    for r in range(total_rows):
        row = text_grid[r]
        if row and len(row) > 0:
            col0 = one_line(row[0]).strip()
            nd = normalizeDay(col0) if col0 else None
            if nd:
                curr_day = nd
        row_days[r] = curr_day

    # ── First pass: find all header rows and time-slot column positions ────
    header_rows = []  # (row_index, is_labs, slot_map)
    for r in range(total_rows):
        row = text_grid[r]
        if not row or len(row) < 3:
            continue

        col2 = one_line(row[2]).strip().upper()
        if col2 in ("ROOM", "LABS"):
            slot_map = {}
            for c in range(3, len(row)):
                cell = one_line(row[c] if c < len(row) else "").strip()
                tm = re.match(r'(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})', cell)
                if tm:
                    slot_map[c] = cell.replace(" ", "")
            if len(slot_map) >= 3:
                is_labs = (col2 == "LABS")
                header_rows.append((r, is_labs, slot_map))

    if not header_rows:
        dlog_warn("  FSE: no header rows found")
        return 0, matched_records

    dlog(f"  FSE: found {len(header_rows)} header rows")

    # ── Second pass: parse data rows between headers ────────────────────────
    for hi in range(len(header_rows)):
        h_row, is_labs, slot_map = header_rows[hi]

        data_end = header_rows[hi + 1][0] if hi + 1 < len(header_rows) else total_rows
        for r in range(h_row + 1, data_end):
            if r < total_rows and text_grid[r] and one_line(text_grid[r][0]).strip().lower() == "keys":
                data_end = r
                break

        slot_cols = sorted(slot_map.keys())

        r = h_row + 1
        while r < data_end:
            row = text_grid[r] if r < total_rows else []
            if not row:
                r += 1
                continue

            room_raw = one_line(row[2] if len(row) > 2 else "").strip()
            if not room_raw:
                r += 1
                continue

            if re.search(r'reserved|room|labs', room_raw, re.IGNORECASE):
                r += 2
                continue

            room = normalise_room(room_raw)

            for si, sc in enumerate(slot_cols):
                next_sc = slot_cols[si + 1] if si + 1 < len(slot_cols) else len(row)
                time_label = slot_map[sc]

                course_text = None
                course_col = None
                for c in range(sc, min(next_sc, len(row))):
                    cell = one_line(row[c] if c < len(row) else "")
                    if cell and not re.match(r'^\s*$', cell):
                        course_text = cell
                        course_col = c
                        break

                if not course_text:
                    continue

                effective_time = time_label
                instr_row = text_grid[r + 1] if r + 1 < total_rows else []
                if instr_row and course_col is not None:
                    instr_text = one_line(instr_row[course_col] if course_col < len(instr_row) else "")
                    tm_override = re.search(r'(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})', instr_text)
                    if tm_override:
                        effective_time = tm_override.group(0).replace(" ", "")

                parsed = parse_fse_course_title(course_text)
                if not parsed:
                    continue

                resolved = resolve_fse_entry(parsed, course_lookup, common)

                is_ms = False
                if instr_row and course_col is not None:
                    instr_text = one_line(instr_row[course_col] if course_col < len(instr_row) else "")
                    if re.search(r'\bPhd\b|\bMS\s+EE\b', instr_text, re.IGNORECASE):
                        is_ms = True
                        resolved = [("MS EE", "MS", False)]

                section = parsed["section"]
                day = row_days[r]
                if not day:
                    continue

                norm_name = normalize_course_name(parsed["course"])
                for dept, batch, is_repeat in resolved:
                    store_batch = REPEAT_BATCH_KEY if is_repeat else batch
                    bare_dept = dept.split(" ")[-1]
                    matched_records.add((norm_name, bare_dept))
                    if add_course(tt, dept, store_batch, section, day,
                                  parsed["course"], room, effective_time):
                        added += 1

            r += 2  # skip to next course row (past instructor row)

    return added, matched_records


# ---------------------------------------------------------------------------
# Phase 5 — cross-validation
# ---------------------------------------------------------------------------

def cross_validate(course_lookup, matched_records, common):
    """
    Walk every Courses SP-26 tab entry and confirm it appeared somewhere in
    the parsed schedule output. Flags Courses-tab rows that never showed up
    in the schedule (different spelling between tabs, or genuinely not yet
    scheduled). The reverse direction — schedule entries with no Courses-tab
    backing — is already logged live via the dlog_warn calls inside
    resolve_fse_entry().
    """
    dlog = common.dlog
    dlog_warn = common.dlog_warn

    missing = []
    for norm_name, records in course_lookup.items():
        for rec in records:
            if not rec["dept"]:
                continue  # shared/general rows aren't tied to a single dept bucket
            key = (norm_name, rec["dept"])
            if key not in matched_records:
                missing.append(f"{rec['raw_title']} [{rec['dept']} {rec['batch']}, code {rec['code']}]")

    if missing:
        dlog_warn(f"  FSE cross-validation: {len(missing)} Courses-tab entries not found in schedule output:")
        for m in missing[:50]:
            dlog_warn(f"    - {m}")
        if len(missing) > 50:
            dlog_warn(f"    ... and {len(missing) - 50} more")
    else:
        dlog("  FSE cross-validation: every Courses-tab entry was matched in the schedule output")

    return missing


# ---------------------------------------------------------------------------
# Phase 6 — regression guard
# ---------------------------------------------------------------------------

def run_regression_check(tt, common):
    """
    Guard against the exact bug this refactor fixes: EE-repeat courses
    leaking into BS CE's normal 2025 batch schedule. Run after every parse.
    """
    dlog = common.dlog
    dlog_error = common.dlog_error

    sections = tt.get(REGRESSION_WATCH_DEPT, {}).get(REGRESSION_WATCH_BATCH, {})
    offenders = []
    for section, days in sections.items():
        for entry in days.get(REGRESSION_WATCH_DAY, []):
            name = normalize_course_name(entry["c"])
            if name in REGRESSION_FORBIDDEN_COURSES:
                offenders.append(
                    f"{REGRESSION_WATCH_DEPT}/{REGRESSION_WATCH_BATCH}/{section}/"
                    f"{REGRESSION_WATCH_DAY}: {entry['c']}"
                )

    if offenders:
        dlog_error(f"  FSE regression check FAILED — {len(offenders)} repeat-course leak(s) detected:")
        for o in offenders:
            dlog_error(f"    - {o}")
    else:
        dlog(f"  FSE regression check passed — no repeat-course leaks in "
             f"{REGRESSION_WATCH_DEPT}/{REGRESSION_WATCH_BATCH}")

    return offenders


def generate(service):
    school_name = "engineering"
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

        course_lookup = build_course_lookup(service, school_info, common=COMMON)
        added, matched_records = parse_engineering_grid(
            text_grid, colour_grid, tt, course_lookup, common=COMMON
        )
        if course_lookup:
            cross_validate(course_lookup, matched_records, common=COMMON)
        run_regression_check(tt, common=COMMON)

        total += added
        print(f"{added} entries")
        dlog(f"  {school_name}/{tab}: {added} entries parsed")

    dlog(f"  {school_name} total: {total} entries, {len(tt)} depts")
    return tt, total
