"""Engineering-school timetable parser."""

import re
from collections import defaultdict
from types import SimpleNamespace

from ..config import (
    COURSES_BATCH_CELL_RE,
    COURSES_CODE_HEADERS,
    COURSES_FALLBACK_LAYOUT,
    COURSES_HEADER_BATCH_ONLY_RE,
    COURSES_HEADER_DEPT_BATCH_RE,
    COURSES_HEADER_DEPT_ONLY_RE,
    COURSES_HEADER_MS_RE,
    COURSES_HEADER_SEMESTER_RE,
    COURSES_SECTION_HEADER_RE,
    ENGINEERING_PROGRAMS,
    FSE_BATCH_ANNOTATION_RE,
    FSE_CELL_TIME_RE,
    FSE_MULTI_SECTION_RE,
    FSE_SECTION_RE,
    FSE_SUFFIX_RE,
    FSE_TRAILING_NOISE_RES,
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
    DAYS=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    REPEAT_BATCH_KEY=REPEAT_BATCH_KEY,
)

def normalize_course_name(name):
    """
    Normalize a course title for cross-referencing between the schedule
    grid (titles only) and the courses tab (titles + codes + repeat
    annotations). Case/punctuation/whitespace differences between the two
    tabs are common, so this intentionally strips all of that.
    """
    n = (name or "").strip().lower()
    n = n.replace("&", "and")
    n = re.sub(r'[.,]', '', n)
    n = re.sub(r'\s+', ' ', n)
    return n.strip()


# Words that carry no identifying weight and that the two tabs disagree
# about: the grid writes "A & Digital Comm.", the courses tab writes
# "Analogue and Digital Communication".
CONNECTOR_TOKENS = {"and"}


def title_tokens(name):
    """
    Split a course title into comparison tokens.

    Splitting the RAW title on non-alphanumerics is the point: the sheet's
    own punctuation is what separates words, so "Computer Org.Architecture"
    becomes ["computer", "org", "architecture"] instead of gluing
    "org.architecture" into one unmatchable token.
    """
    raw = str(name or "")
    toks = [t.lower() for t in re.split(r'[^A-Za-z0-9]+', raw) if t]
    return [t for t in toks if t not in CONNECTOR_TOKENS]


def token_key(name):
    """
    Lookup key built from title_tokens, used on BOTH sides of the courses-tab
    lookup so that punctuation differences collide instead of missing:
    "Applications of ICT - Lab" and "Applications of ICT Lab" produce the
    same key.
    """
    return " ".join(title_tokens(name))


def _is_subsequence(short, long):
    """True if every character of `short` appears in `long`, in order."""
    it = iter(long)
    return all(ch in it for ch in short)


def tokens_match(grid_tok, course_tok):
    """
    Decide whether one grid token refers to the same word as one courses-tab
    token.

    Prefix match in EITHER direction, because the tabs disagree about
    plurals and spellings ("Variables"/"Variable", "Analogue"/"Analog") and
    because the grid abbreviates ("Comm."/"Communication").

    Failing that, for tokens of 3+ characters that share a first letter, an
    in-order subsequence match — which absorbs dropped vowels and outright
    typos ("netwks"/"networks", "strucures"/"structures"). The length and
    first-letter guards keep two-letter stubs like "mp" from matching half
    the catalogue.
    """
    if grid_tok == course_tok:
        return True
    if grid_tok.startswith(course_tok) or course_tok.startswith(grid_tok):
        return True
    if (len(grid_tok) >= 3 and len(course_tok) >= 3
            and grid_tok[0] == course_tok[0]):
        return (_is_subsequence(grid_tok, course_tok)
                or _is_subsequence(course_tok, grid_tok))
    # A two-letter stub against a long word: "MP Inter. & Prog" for
    # "Microprocessor Interfacing & Programming". Restricted to a genuinely
    # long target and a shared first letter so "mp" can't reach half the
    # catalogue — and every other token still has to match too.
    if (len(grid_tok) == 2 and len(course_tok) >= 6
            and grid_tok[0] == course_tok[0]):
        return _is_subsequence(grid_tok, course_tok)
    return False


def _ordered_match_count(grid_toks, course_toks):
    """How many grid tokens the course title accounts for, in order."""
    best = [0] * (len(course_toks) + 1)
    for gt in grid_toks:
        prev = 0
        for j, ct in enumerate(course_toks, 1):
            carry = best[j]
            best[j] = prev + 1 if tokens_match(gt, ct) else max(best[j], best[j - 1])
            prev = carry
    return best[-1]


def title_token_match(grid_toks, course_toks, max_unmatched=0):
    """
    True if every grid token is accounted for, in order, by the course
    title's tokens. The course title may carry EXTRA words the grid dropped
    ("Obj. Oriented Data Struct." vs "Object Oriented Data Structures and
    Algorithms").

    `max_unmatched` lets the GRID carry words of its own that the course
    title lacks — "Fund. Database Systems" for "Database Systems", "Prog
    Fundamentals & Eng." for "Programming Fundamentals". Used only as a
    second pass, and never to the point where fewer than two tokens carry
    the match.
    """
    if not grid_toks:
        return False
    matched = _ordered_match_count(grid_toks, course_toks)
    if len(grid_toks) - matched > max_unmatched:
        return False
    return matched >= min(2, len(grid_toks)) if max_unmatched else matched == len(grid_toks)


def match_abbreviated_title(grid_title, course_lookup, common, sections=None):
    """
    Find the courses-tab title that a heavily abbreviated grid title refers
    to. Tried ONLY after an exact-key miss.

    The schedule grid abbreviates hard and the courses tab spells out, so
    exact-name lookup misses most of the sheet: "A & Digital Comm.",
    "Elect. Netwk. Analysis", "Obj. Oriented Data Struct.",
    "Computer Org.Architecture", plus typos like "Discrete Strucures".

    Returns (matched_key, records) or (None, []). Ambiguity is NEVER guessed
    at — more than one surviving candidate logs a warning and falls back to
    the keyword heuristic.
    """
    grid_toks = title_tokens(grid_title)
    if not grid_toks:
        return None, []

    def match(max_unmatched):
        return [key for key in course_lookup
                if title_token_match(grid_toks, key.split(" "), max_unmatched)]

    def offers(keys):
        """Do any of these rows offer every section the cell names?"""
        if not sections:
            return True
        return any(set(sections) <= set(rec.get("sections") or [])
                   for key in keys for rec in course_lookup[key])

    candidates = match(0)
    # An exact-word match that doesn't offer the cell's sections is the wrong
    # row. "Understanding of Holy Quran I/Ethics I & II A,B" matches the MS
    # block word for word, but only the 2025 block runs a section B — so let
    # the grid keep a word of its own and look again.
    if candidates and not offers(candidates):
        covering = [k for k in match(1) if offers([k])]
        if covering:
            candidates = covering
    if not candidates:
        candidates = match(1)
    if not candidates:
        return None, []

    if len(candidates) > 1:
        # A course and its lab share every other word, so the only thing
        # separating them is whether the grid title says "lab".
        wants_lab = "lab" in grid_toks
        filtered = [k for k in candidates if ("lab" in k.split(" ")) == wants_lab]
        if filtered:
            candidates = filtered

    if len(candidates) > 1:
        # Prefer the title that invents the fewest words of its own.
        fewest = min(len(k.split(" ")) for k in candidates)
        candidates = [k for k in candidates if len(k.split(" ")) == fewest]

    if len(candidates) > 1:
        # Titles that all resolve to the same dept, batch and repeat status
        # are not ambiguous in any way that matters — SS1021 and SS1022 are
        # two halves of one class, both EE 2025. Merge and carry on.
        merged, signatures = [], set()
        for key in candidates:
            for rec in course_lookup[key]:
                sig = (rec["dept"], rec["batch"], rec["is_repeat"])
                signatures.add(sig)
                if sig not in {(r["dept"], r["batch"], r["is_repeat"]) for r in merged}:
                    merged.append(rec)
        if len(signatures) == 1:
            return candidates[0], merged

        common.dlog_warn(
            f"  FSE: '{grid_title}' matches {len(candidates)} courses-tab "
            f"titles ambiguously ({sorted(candidates)}) — refusing to guess, "
            f"falling back to keyword heuristic"
        )
        return None, []

    key = candidates[0]
    return key, course_lookup[key]


def normalizeDay(raw):
    """Match a raw day string to canonical weekday name, or return None."""
    if not raw:
        return None
    raw = raw.strip().capitalize()
    DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    if raw in DAYS:
        return raw
    abbr = {"Mon": "Monday", "Tue": "Tuesday", "Tues": "Tuesday", "Wed": "Wednesday",
            "Thu": "Thursday", "Thur": "Thursday", "Fri": "Friday",
            "Sat": "Saturday"}
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

def _split_multi_suffix(suffix):
    """
    Read a multi-section suffix into (programs, sections).

      "CE-A, CE-B"  -> (["CE"], ["A", "B"])
      "A,B"         -> ([],     ["A", "B"])
      "EE-A,B,C"    -> (["EE"], ["A", "B", "C"])

    A programme named once applies to the whole list — the sheet writes
    "EE-A,B,C", not "EE-A, EE-B, EE-C". Returns None if any part isn't a
    section the school offers, so a stray capital can't invent one.
    """
    programs, sections = [], []
    for part in re.split(r'\s*,\s*', suffix):
        m = FSE_SUFFIX_RE.match(re.sub(r'\s*([-/])\s*', r'\1', part.strip()))
        if not m:
            return None
        letter = m.group(2).upper()
        if letter not in FSE_VALID_SECTIONS or letter in sections:
            return None
        sections.append(letter)
        for p in re.split(r'[-/]', m.group(1) or ""):
            p = p.strip().upper()
            if p and p not in programs:
                programs.append(p)
    return programs, sections


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

    # A batch the cell states outright sits after the section suffix and hid
    # it: "Applied Physics A (Batch 2025)" parsed as nothing at all.
    batch_hint = None
    bm = FSE_BATCH_ANNOTATION_RE.search(t)
    if bm:
        batch_hint = bm.group(1)
        t = t[:bm.start()].strip()

    parsed = _read_section_suffix(t)
    if not parsed:
        # Still unreadable — the instructor, time or venue the grid appends is
        # standing between the title and its section suffix. Strip that and
        # try once more. Deliberately a fallback: the same rules applied
        # up-front cost "Physics for Engr. EE-A" its own name.
        stripped = t
        for noise in FSE_TRAILING_NOISE_RES:
            stripped = noise.sub("", stripped).strip(" ,-")
        if stripped and stripped != t:
            parsed = _read_section_suffix(stripped)
    if not parsed:
        return None

    # A time written into the cell beats the column's slot, exactly as one on
    # the instructor row does.
    tm = FSE_CELL_TIME_RE.search(t[len(parsed["course"]):])
    parsed["time_override"] = (f"{tm.group(1)}-{tm.group(2)}" if tm else None)
    parsed["batch_hint"] = batch_hint
    return parsed


def _read_section_suffix(t):
    """Course name + programmes + sections from a title, or None."""
    # One cell, several sections: "CE-A, CE-B", "A,B", "EE-A,B,C".
    mm = FSE_MULTI_SECTION_RE.match(t)
    if mm:
        split = _split_multi_suffix(mm.group("suffix"))
        if split and len(mm.group("course").strip()) >= 3:
            programs, sections = split
            return {"course": mm.group("course").strip(),
                    "programs": programs,
                    "section": sections[0], "sections": sections}

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
        "sections": [section],
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
    course has no matching row in the courses tab.

    Fall 2026 semester mapping (engineering). The school has moved on a
    semester since these tiers were written for Spring-2026, so every tier
    shifted by one year and a 1st-semester tier was added — without it the
    function could not return "2026" at all, and the whole freshman batch
    landed in whichever older bucket its course names happened to hit.

      Semester 1 (batch 2026): Applied Calculus, Applications of ICT,
                               Physics for Engineers, Pakistan Studies,
                               English Language Skills, Occupational Health
                               and Safety, Engineering Drawing,
                               Prog. Fundamentals
      Semester 3 (batch 2025): Linear Circuit Analysis, Prog. for Engineers,
                               Differential Equations, Linear Algebra,
                               Applied Physics, Civics, Understanding of Holy
                               Quran, Digital Logic Design, Object Oriented
      Semester 5 (batch 2024): Signal & Systems, Data Structures, Probability,
                               Communication Skills, Electrical Network Anal.,
                               Basic Mech. Engg, Tech. Comm. Skills,
                               Analog & Digital Comm., Computer Architecture,
                               Microprocessor Interfacing, Database Systems
      Semester 7 (batch 2023): Engineering Economics, Entrepreneurship,
                               Operating Systems, Electro-Mechanical, Network
                               Programming, Feedback Control, IOT, Engineering
                               Workshop, Power Electronics, DSP, VLSI,
                               Industrial Processes, Deep Learning
    """
    name = (course_name or "").upper()

    if re.search(
        r'\b(APPLIED\s+CALCULUS|APPLICATIONS\s+OF\s+ICT|'
        r'PHYSICS\s+FOR\s+ENGR|PHYSICS\s+FOR\s+ENGINEER|'
        r'PAKISTAN\s+STUD|ENGLISH\s+LANGUAGE|'
        r'OCCUPATIONAL\s+HEALTH|ENGINEERING\s+DRAWING|'
        r'PROG\.?\s+FUNDAMENTALS|PROGRAMMING\s+FUNDAMENTALS)', name):
        return "2026"

    if re.search(
        r'\b(LINEAR\s+CIRCUIT\s+ANALYSIS|PROG\.?\s+FOR\s+ENGINEERS|'
        r'DIFFERENTIAL\s+EQU|LINEAR\s+ALGEBRA|'
        r'APPLIED\s+PHYSICS|CIVICS|COMMUNITY\s+ENGAGEMENT|'
        r'UNDERSTANDING\s+OF\s+HOLY|DIGITAL\s+LOGIC|OBJECT\s+ORIENTED)', name):
        return "2025"

    if re.search(
        r'\b(SIGNAL\s+.?\s*SYSTEMS?|DATA\s+STRUCT|'
        r'PROBABILITY|PROB\.?\s+.?\s*RANDOM|COMMUNICATION\s+SKILLS?|'
        r'ELECTRICAL\s+NETWORK|ELECT\.?\s+NETWK|'
        r'BASIC\s+MECH|TECH\.?\s+COMM|ANALOG|COMPUTER\s+ARCH|'
        r'COMPUTER\s+ORG|DATABASE|MICROPROCESSOR)', name):
        return "2024"

    if re.search(
        r'\b(ENGINEERING\s+ECONOMICS|ENTREPRENEURSHIP|'
        r'OPERATING\s+SYSTEMS?|ELECTRO.?MECHANICAL|'
        r'NETWORK\s+PROGRAM|FEEDBACK\s+CONTROL|INTRODUCTION\s+TO\s+IOT|'
        r'ENGINEERING\s+WORKSHOP|POWER\s+ELECTRONICS?|DIGITAL\s+SIGNAL|'
        r'VLSI|INDUSTRIAL\s+PROC|DEEP\s+LEARN|COMPUTATIONAL\s+STAT)', name):
        return "2023"

    return "2024"  # safe middle-ground default


# ---------------------------------------------------------------------------
# Phase 2 — Courses SP-26 tab parsing (structural source of truth)
# ---------------------------------------------------------------------------

def detect_courses_layout(text_grid, common):
    """
    Work out where the courses tab keeps its Code / Course / Section columns.

    The tab has been re-laid-out between semesters and hardcoded indices
    silently stopped matching — only 8 of ~81 rows parsed, which pushed
    nearly every class onto keyword guessing. So find the header row by
    what it says rather than where it sits:

        Courses SP-26      row 1: [_, Code, Course/Lab, ...,  Section-A..D at 6-9]
        Course Allocation  row 2: [_, _, Code, Course/Lab, ..., Section-A..E at 7-11]
        FA26

    Returns a layout dict {header_row, code_col, title_col, section_cols}.
    Falls back to COURSES_FALLBACK_LAYOUT (the SP-26 positions) when no
    header row is recognisable, so an unexpected tab still parses something.
    """
    one_line = common.one_line

    for r, row in enumerate(text_grid[:12]):
        if not row:
            continue
        cells = [one_line(c).strip() for c in row]

        code_col = next(
            (c for c, cell in enumerate(cells)
             if cell.lower() in COURSES_CODE_HEADERS), None)
        if code_col is None:
            continue

        title_col = next(
            (c for c, cell in enumerate(cells)
             if c != code_col and cell.lower().startswith("course")), None)
        if title_col is None:
            continue

        section_cols = []
        for c, cell in enumerate(cells):
            m = COURSES_SECTION_HEADER_RE.match(cell)
            if m:
                section_cols.append((c, m.group(1).upper()))

        if not section_cols:
            section_cols = COURSES_FALLBACK_LAYOUT["section_cols"]

        return {
            "header_row": r,
            "code_col": code_col,
            "title_col": title_col,
            "section_cols": section_cols,
        }

    common.dlog_warn(
        "  FSE: no Code/Course header row found on the courses tab — "
        f"falling back to the old fixed layout {COURSES_FALLBACK_LAYOUT}"
    )
    return dict(COURSES_FALLBACK_LAYOUT)


def interpret_block_header(text):
    """
    Read one block-header cell into whatever it declares.

    Returns a dict with any of: dept, batch, is_repeat, semester — plus
    "matched" telling the caller whether anything was recognised at all.
    A dept WITHOUT a batch ("BS CE 1st Semester Courses/Labs") opens a
    block: the caller sets the dept and clears the batch, and the batch
    fills in when its own cell turns up a row later.

    A dept value of None means "shared block, applies to EE and CE alike".
    """
    out = {"matched": False}
    if not text:
        return out
    norm = re.sub(r'\s+', ' ', text).strip()

    sem_m = COURSES_HEADER_SEMESTER_RE.search(norm)
    if sem_m:
        out["semester"] = sem_m.group(1)
        out["matched"] = True

    # "Batch BS(CE) 2026" — dept and batch in one cell.
    m = COURSES_HEADER_DEPT_BATCH_RE.search(norm)
    if m:
        code = m.group(1).upper()
        out["dept"] = code if code in ENGINEERING_PROGRAMS else None
        out["batch"] = m.group(2)
        out["is_repeat"] = bool(re.search(r'repeat', norm, re.IGNORECASE))
        out["matched"] = True
        return out

    # "MS/PhD (EE) Courses" / "MS EE" / "MS(EE) - IC Design" / "MS Electives".
    m = COURSES_HEADER_MS_RE.search(norm)
    if m:
        code = m.group(1).upper()
        # Only trust the captured token when it actually names a programme —
        # otherwise "MS Electives" would register a department called "Ele".
        out["dept"] = code if code in ENGINEERING_PROGRAMS else None
        out["batch"] = "MS"
        out["matched"] = True
        return out

    # "6th Semester  Batch 2023" — shared across EE and CE.
    m = COURSES_HEADER_BATCH_ONLY_RE.search(norm)
    if m:
        out["dept"] = None
        out["batch"] = m.group(1)
        out["is_repeat"] = bool(re.search(r'repeat', norm, re.IGNORECASE))
        out["matched"] = True
        return out

    # A bare batch cell, possibly flagged: "2026", "2025 (Repeat)".
    m = COURSES_BATCH_CELL_RE.match(norm)
    if m:
        out["batch"] = m.group(1)
        out["is_repeat"] = bool(m.group(2) and re.search(r'repeat', m.group(2), re.IGNORECASE))
        out["matched"] = True
        return out

    # Dept-only header that opens a block ahead of its batch cell.
    m = COURSES_HEADER_DEPT_ONLY_RE.search(norm)
    if m:
        code = m.group(1).upper()
        if code in ENGINEERING_PROGRAMS:
            out["dept"] = code
            out["opens_block"] = True
            out["matched"] = True
    return out


def parse_courses_tab(text_grid, common):
    """
    Parse the courses tab into a lookup:
        normalized_course_name -> [record, ...]
    where each record is:
        {dept, batch, semester, is_repeat, code, raw_title, sections}

    dept is "EE" / "CE" / None (None = shared block, applies to both —
    used by the later, non-dept-split semesters e.g. "6th Semester Batch 2023").

    Block headers are read from EVERY cell left of the Code column, because
    the FA26 tab splits them: the dept sits in column 0 on the row that opens
    the block, and the batch in column 1 on the block's FIRST COURSE ROW.

    Also returns the flat list of all records, for cross-validation.
    """
    dlog = common.dlog
    dlog_warn = common.dlog_warn
    one_line = common.one_line

    layout = detect_courses_layout(text_grid, common)
    code_col = layout["code_col"]
    title_col = layout["title_col"]
    section_cols = layout["section_cols"]
    dlog(f"  FSE: courses-tab layout {layout}")

    lookup = {}
    all_entries = []
    current_dept = None
    current_batch = None
    current_semester = None
    current_block_repeat = False
    skipped_no_batch = 0

    for r, row in enumerate(text_grid):
        if not row:
            continue
        if r <= layout["header_row"]:
            continue

        # Every cell left of the Code column can carry block-header text.
        for c in range(0, min(code_col, len(row))):
            info = interpret_block_header(one_line(row[c]))
            if not info["matched"]:
                continue
            if "semester" in info:
                current_semester = info["semester"]
            if "batch" in info:
                current_batch = info["batch"]
                current_block_repeat = info.get("is_repeat", False)
                if "dept" in info:
                    current_dept = info["dept"]
            elif info.get("opens_block"):
                # Dept named but no batch yet — open the block and wait for
                # the batch cell rather than inheriting the previous block's.
                current_dept = info.get("dept")
                current_batch = None
                current_block_repeat = False

        code = one_line(row[code_col] if len(row) > code_col else "")
        title_raw = one_line(row[title_col] if len(row) > title_col else "")
        if not title_raw or not code:
            continue
        if title_raw.lower() in ("course/lab", "course", "lab"):
            continue

        if not current_batch:
            # No batch in scope — filing this under a null batch would put it
            # in a bucket nothing can ever select. Skip and count instead.
            skipped_no_batch += 1
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
        # A block-level "(Repeat)" on the batch cell applies to every row in
        # the block, on top of the per-title annotation handled above.
        home_is_repeat = (is_repeat_annotated and not other_depts) or current_block_repeat

        sections = []
        for idx, letter in section_cols:
            val = one_line(row[idx] if len(row) > idx else "")
            if val:
                sections.append(letter)

        # Keyed on tokens, not raw text, so that punctuation differences
        # between the two tabs collide instead of missing — see token_key.
        norm_name = token_key(clean_title)
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
    if skipped_no_batch:
        dlog_warn(
            f"  FSE: {skipped_no_batch} courses-tab row(s) skipped — a course "
            f"row appeared with no batch in scope (block header not recognised?)"
        )
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

def fse_dept_key(code, batch):
    """
    Department key for a programme code and the batch it resolved to.

    A batch of "MS" is a degree, not an entry year, so the department is
    "MS EE" — the key the MS rows already use. Built as "BS MS" instead, a
    postgraduate course landed in a BS department named after a degree.
    """
    return f"{'MS' if batch == 'MS' else 'BS'} {code}"


def resolve_fse_entry(parsed, course_lookup, common, aliases=None):
    """
    Resolve department(s) + batch + repeat-status for a parsed FSE schedule
    cell, using the courses tab as the structural source of truth (Phase 2)
    instead of keyword-based inference (infer_fse_batch_fallback).

    Returns a list of (dept_key, batch, is_repeat) tuples, e.g.:
      [("BS EE", "2025", False)]
      [("BS EE", "2025", False), ("BS CE", "2025", True)]   # repeat for CE

    `aliases` collects grid-title-key -> courses-tab-key for titles resolved
    by abbreviation matching, so cross_validate() can still tell that the
    courses-tab entry reached the schedule under its abbreviated name.
    """
    dlog_warn = common.dlog_warn
    norm_name = token_key(parsed["course"])
    candidates = course_lookup.get(norm_name, [])

    sections = parsed.get("sections") or ([parsed["section"]] if parsed.get("section") else [])
    if not candidates:
        matched_key, candidates = match_abbreviated_title(
            parsed["course"], course_lookup, common, sections)
        if matched_key and aliases is not None:
            aliases[norm_name] = matched_key

    results = []
    programs = [p for p in parsed.get("programs", []) if p.upper() != "MS"]

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
                results.append((fse_dept_key(p_upper, match["batch"]),
                                match["batch"], match["is_repeat"]))
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
            results.append((fse_dept_key(dept, match["batch"]),
                            match["batch"], match["is_repeat"]))
        elif len(distinct_depts) > 1:
            section = parsed.get("section")
            picked = [c for c in candidates if c["dept"] and section in c.get("sections", [])]
            if len(picked) == 1:
                c = picked[0]
                results.append((fse_dept_key(c["dept"], c["batch"]),
                                c["batch"], c["is_repeat"]))
            else:
                # Which department owns the cell is unclear, but that does not
                # make the batch unclear. MT2003 is 2025 for EE and for CE
                # alike, and giving up here filed six "Comp. Variables &
                # Trans." classes under 2024 on a course-name guess. When the
                # candidates agree on batch and repeat status, the course is
                # genuinely shared: record it for each department that offers it.
                offerings = {(c["dept"], c["batch"], c["is_repeat"])
                             for c in (picked or candidates) if c["dept"]}
                if len({b for _d, b, _rp in offerings}) == 1:
                    # Flagged speculative: filing one cell under several
                    # departments is right for a genuinely joint class and wrong
                    # for two same-code offerings that only share a title.
                    # prune_speculative_clashes() settles which, once the whole
                    # grid is in and the impossible copies can be seen.
                    speculative = len(offerings) > 1
                    for dept, batch, is_repeat in sorted(offerings):
                        results.append((fse_dept_key(dept, batch), batch,
                                        is_repeat, speculative))
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

    # Every path above yields (dept, batch, is_repeat); only the ambiguous
    # fan-out adds the speculative flag. Pad the rest so callers unpack one shape.
    return [r if len(r) == 4 else (r[0], r[1], r[2], False) for r in results]


# ---------------------------------------------------------------------------
# Main grid parser (Classes Schedule FSE SP-26 tab)
# ---------------------------------------------------------------------------

def _fse_minutes(hhmm):
    """'02:20' -> minutes past midnight, using the sheet's unlabelled 12-hour
    convention (1-7 afternoon, 8-11 morning, 12 noon)."""
    m = re.match(r'^\s*(\d{1,2})[:.](\d{2})\s*$', hhmm or '')
    if not m:
        return None
    hour, minute = int(m.group(1)), int(m.group(2))
    if hour == 12:
        return 12 * 60 + minute
    if 8 <= hour < 12:
        return hour * 60 + minute
    if 1 <= hour < 8:
        return (hour + 12) * 60 + minute
    return None


def _fse_bounds(slot):
    parts = str(slot or '').split('-')
    if len(parts) != 2:
        return None
    start, end = _fse_minutes(parts[0]), _fse_minutes(parts[1])
    if start is None or end is None:
        return None
    return (start, end + 720) if end < start else (start, end)


def prune_speculative_clashes(tt, speculative_entries, common):
    """Drop shared-course copies that make a section's day impossible.

    resolve_fse_entry() files a cell whose department is ambiguous under every
    department that offers the course, because the batch is knowable even when
    the department is not. That is correct for a genuinely joint class, and
    wrong when two programmes merely run same-code offerings of their own: it
    put MT2003 into BS CE at the same hour as Discrete Structures, which is
    CE-only, so a CE section had two lectures at once in two rooms.

    A speculative copy that collides with a class whose department was never in
    doubt is the copy that does not belong. Nothing is dropped when the clash is
    with another speculative entry, or when there is no clash at all — a joint
    class survives untouched.
    """
    dlog = common.dlog
    dlog_warn = common.dlog_warn
    if not speculative_entries:
        return 0

    spec_keys = {(d, b, s, day, c, r, t)
                 for d, b, s, day, c, r, t in speculative_entries}

    # One sheet cell becomes one copy per candidate department. Group them so a
    # copy is only ever dropped while a sibling survives — if every copy clashes,
    # the conflict is in the sheet, not in our guess, and dropping them all would
    # erase the class from the timetable entirely.
    groups = defaultdict(list)
    for dept, batch, section, day, course, room, time in speculative_entries:
        groups[(day, course, room, time, section, batch)].append(dept)

    def clashes_with_certain(dept, batch, section, day, course, room, time):
        arr = tt.get(dept, {}).get(batch, {}).get(section, {}).get(day)
        if not arr:
            return None
        mine = _fse_bounds(time)
        if not mine:
            return None
        for other in arr:
            if other["c"] == course and other["l"] == room and other["t"] == time:
                continue
            if (dept, batch, section, day, other["c"], other["l"], other["t"]) in spec_keys:
                continue          # both sides speculative — no basis to choose
            theirs = _fse_bounds(other["t"])
            if theirs and mine[0] < theirs[1] and theirs[0] < mine[1]:
                return other
        return None

    dropped = 0
    for (day, course, room, time, section, batch), depts in groups.items():
        verdicts = {d: clashes_with_certain(d, batch, section, day, course, room, time)
                    for d in depts}
        losers = [d for d, conflict in verdicts.items() if conflict]
        if not losers:
            continue
        if len(losers) == len(depts):
            dlog_warn(
                f"  FSE: '{course}' {batch}-{section} {day} {time} clashes in every "
                f"department that offers it ({', '.join(sorted(depts))}) — keeping "
                f"all copies; this looks like a conflict in the sheet itself")
            continue
        for dept in losers:
            arr = tt[dept][batch][section][day]
            for i, x in enumerate(arr):
                if x["c"] == course and x["l"] == room and x["t"] == time:
                    arr.pop(i)
                    dropped += 1
                    dlog(f"  FSE: dropped shared-course copy '{course}' from "
                         f"{dept} {batch}-{section} {day} {time} — clashes with "
                         f"'{verdicts[dept]['c']}' ({verdicts[dept]['t']}), "
                         f"which is not shared")
                    break
    if dropped:
        dlog(f"  FSE: pruned {dropped} speculative cross-listed entries")
    return dropped


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
    # Cells filed under more than one department because the department was
    # ambiguous — settled by prune_speculative_clashes() once the grid is in.
    speculative_entries = []
    # Grid title key -> courses-tab title key, for titles the grid abbreviates.
    aliases = {}
    structural_hits = 0
    structural_misses = 0
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

                # A time in the course cell itself, not just the instructor
                # row below it — "... CE-A, CE-B Ms. Maria Mazhar 12:45 - 02:40".
                if parsed.get("time_override"):
                    effective_time = parsed["time_override"]

                resolved = resolve_fse_entry(parsed, course_lookup, common, aliases)
                grid_key = token_key(parsed["course"])
                if grid_key in course_lookup or grid_key in aliases:
                    structural_hits += 1
                else:
                    structural_misses += 1

                is_ms = False
                if instr_row and course_col is not None:
                    instr_text = one_line(instr_row[course_col] if course_col < len(instr_row) else "")
                    if re.search(r'\bPhd\b|\bMS\s+EE\b', instr_text, re.IGNORECASE):
                        is_ms = True
                        resolved = [("MS EE", "MS", False, False)]

                day = row_days[r]
                if not day:
                    continue

                # Credit the courses-tab spelling, not the grid's abbreviation,
                # so cross_validate() sees the entry as scheduled.
                norm_name = aliases.get(grid_key, grid_key)
                for dept, batch, is_repeat, speculative in resolved:
                    store_batch = REPEAT_BATCH_KEY if is_repeat else batch
                    bare_dept = dept.split(" ")[-1]
                    matched_records.add((norm_name, bare_dept))
                    # One cell can name several sections ("EE-A,B,C"); each is
                    # a real class for that section.
                    for section in parsed.get("sections") or [parsed["section"]]:
                        if add_course(tt, dept, store_batch, section, day,
                                      parsed["course"], room, effective_time):
                            added += 1
                            if speculative:
                                speculative_entries.append(
                                    (dept, store_batch, section, day,
                                     parsed["course"], room, effective_time))

            r += 2  # skip to next course row (past instructor row)

    resolved_total = structural_hits + structural_misses
    dlog(f"  FSE: structural resolution {structural_hits}/{resolved_total} "
         f"schedule entries ({len(aliases)} via abbreviation matching); "
         f"{structural_misses} on the keyword fallback")

    added -= prune_speculative_clashes(tt, speculative_entries, common)

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
