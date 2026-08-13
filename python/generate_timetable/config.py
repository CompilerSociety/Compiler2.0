"""Shared configuration constants for timetable generation."""

import re
from collections import OrderedDict

SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]
SERVICE_ACCOUNT_FILE = "service-account.json"
DEBUG_LOG_FILE = "python/generate_timetable/runtime/debug.log"

SCHOOLS = OrderedDict([
    ("computing", OrderedDict([
        ("id", "1vlTuotLw34fedME3gNQj09cZw-todVomxAiu5P1wZ6Q"),
        ("tabs", ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]),
    ])),
    ("business", OrderedDict([
        ("id", "1AnFQQhv9lu4grESE2ypbDG7E1QOPGgGCRiejem5ocPw"),
        ("tabs", ["Timetable"]),
    ])),
    ("engineering", OrderedDict([
        ("id", "1fL2TWhPgbPc2d66vm_KywTpdsGBIaBLqlmz4JLPudCw"),
        ("tabs", ["Classes Schedule FA26 (In Progress)"]),
        # Structural source of truth for dept/batch/repeat status — see schools/engineering.py
        ("courses_tab", "Course Allocation FA26"),
    ])),
])

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

# ---------------------------------------------------------------------------
# COLOUR_BATCH_MAP
#
# Auto-populated at runtime by build_colour_map().
# No manual editing needed — the script reads header cells like
# 'BS CS (2025)' or 'MS (CS)' to infer which colour = which batch.
#
# Shape: (R, G, B) -> [(dept_code, batch), ...]
#
# It is a LIST because the computing sheet paints more than one legend with
# the same fill — 'MS (AI)' and 'BS CS (2023)' share (1.0, 0.9, 0.6). Keeping
# only the first legend filed that entire CS cohort under MS. Each entry
# records the programme the legend named (None if it named none), and
# colour_to_batch() picks between them using the department code in the
# cell's own text. See colour_mapper.add_colour_entry / colour_to_batch.
# ---------------------------------------------------------------------------

COLOUR_BATCH_MAP = {}  # filled automatically at runtime

# Batch key used for yellow-highlighted "repeat" classes. Yellow is the
# authoritative repeat signal (per the source sheet's convention), so it
# overrides year-suffix / colour-map batch resolution — see resolve_batch.
REPEAT_BATCH_KEY = "REPEAT"

# Section key for batch-wide cells that name a department and year but no
# section letter (e.g. "Project (AI/DS)"). Stored once under this key; the
# frontend merges it into whichever section the student selects.
ALL_SECTIONS = "ALL"

# A doctoral cohort has no entry year, so "UHQ-I & II (PHD-A)" has no batch to
# resolve. Left to the normal path it became department "BS PHD" at batch
# "2023" — a BS cohort that does not exist. Give PhD its own department and
# batch key, the way the MS programmes have theirs.
PHD_DEPT_KEY = "PhD"
PHD_BATCH_KEY = "PhD"
PHD_CODES = {"PHD", "PHDCS", "PHDSE"}

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BATCH_MAP = {"26": "2026", "25": "2025", "24": "2024", "23": "2023", "22": "2022"}
COMPUTING_PROGRAM_CODES = {"AI", "CS", "CY", "DS", "SE"}

CELL_RE = re.compile(
    r"(.+?)\s*\(([A-Z]+(?:\s*[/,]\s*(?!GP?\b)[A-Z]+)*)(?:-([A-Z]+)(\d+)?)?"
    r"(?:,\s*(?:Gp?-([IV]+)|(\d{2})))?\s*\)",
    re.IGNORECASE
)

# A time written after the closing paren overrides the column's slot time,
# e.g. "PF (SE-E) 09:30-10:50" runs 09:30-10:50, not the column's 08:30-09:50.
CELL_TIME_OVERRIDE_RE = re.compile(r"(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})")

# A parenthetical holding nothing but a section letter (optionally a subgroup
# digit), e.g. "Web Comp (A)". The department then comes from the column header.
SECTION_ONLY_RE = re.compile(r"^([A-H])(\d)?$", re.IGNORECASE)

SLOT_COLS = {
    1: "08:30-09:50", 6: "10:00-11:20", 11: "11:30-12:50",
    16: "01:00-02:20", 21: "02:30-03:50", 26: "03:55-05:15",
    31: "05:20-06:40", 36: "06:45-08:05"
}

CLASSROOM_LEFT = {
    "room_col": 0, "end_col": 30,
    "slot_cols": [1, 6, 11, 16, 21, 26],
    "slot_map": {
        1: "08:30-09:50", 6: "10:00-11:20", 11: "11:30-12:50",
        16: "01:00-02:20", 21: "02:30-03:50", 26: "03:55-05:15"
    }
}
CLASSROOM_RIGHT = {
    "room_col": 30, "end_col": None,
    "slot_cols": [31, 36],
    "slot_map": {31: "05:20-06:40", 36: "06:45-08:05"},
    # The evening block has its own Room column (30), separate from the
    # daytime block's column 0 — and the rooms genuinely differ (Wednesday
    # row 9 is C-305 in col 0 but D-305 in col 30), so col 0 must never be
    # substituted here. The sheet only fills column 30 on Wednesday, which
    # made parse_matrix_block drop every Mon/Tue/Thu evening class: ~39
    # entries, essentially the whole MS evening programme. Emit them with
    # an unknown room instead of losing them. Scoped to THIS block only —
    # a blank room in the daytime or lab blocks still skips the row.
    # The real fix is upstream: fill column 30 on the other day tabs.
    "blank_room_fallback": "TBA",
}
LAB_BLOCK = {
    "room_col": 0, "end_col": None,
    "slot_cols": [1, 11, 21, 31],
    "slot_map": {
        1: "08:30-11:15", 11: "11:30-02:15",
        21: "02:30-05:15", 31: "05:20-08:05"
    }
}

# ---------------------------------------------------------------------------

FSM_SLOT_STARTS = [3, 12, 21, 30, 39, 48]

FSM_COURSE_RE = re.compile(r'^([A-Za-z]{2,4}\s?\d{4,5})\s*')

FSM_TIME_OVERRIDE_RE = re.compile(
    r'\((\d{1,2}:\d{2}\s*(?:AM|PM)?\s*-\s*\d{1,2}:\d{2}\s*(?:AM|PM)?)\)\s*$', re.IGNORECASE)

FSM_SECTION_RE = re.compile(r'^([A-Z]{2,5})(\d{2})([A-Z])(\d)?$')

FSM_COMBINED_RE = re.compile(r'^([A-Z]{2,5}\d{2})\s*([A-Z](?:\s*[/&]\s*[A-Z])+)$')

FSM_DAY_RE = re.compile(r'^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)$', re.IGNORECASE)

FSM_PROGRAM_MAP = {
    "FT": "BS Fintech",
    "BSFT": "BS Fintech",
    "BA": "BS Business Analytics",
    "BSBA": "BS Business Analytics",
    "BBA": "BS Business Administration",
    "AF": "BS Accounting & Finance",
}

ENGINEERING_PROGRAMS = {"EE", "CE"}

#   "... Int-A"     -> programs=["Int"], section="A"  (treated specially)
#   "... CE/A"      -> programs=["CE"], section="A"
#   "... CE- A"     -> programs=["CE"], section="A"  (space-tolerant)
FSE_SECTION_RE = re.compile(
    r'^(.*?)\s+'                       # course name (greedy until last whitespace block)
    r'('
    r'(?:[A-Z][A-Za-z]*[-/])*'         # zero or more PROG- or PROG/ prefixes
    r'(?:\s*)'                          # optional space (handles "CE- A")
    r'([A-Z])'                          # single trailing section letter
    r')\s*$'
)

# More structured regex for the suffix itself — used after splitting
FSE_SUFFIX_RE = re.compile(
    r'^((?:[A-Z][A-Za-z]*[-/])*)\s*([A-Z])$'
)

# Known section letters for validation. E is real: the Course Allocation tab
# lists sections A–E for the EE 2026 labs, and pinning this to "ABCD" dropped
# every "EE-E" cell in the schedule.
FSE_VALID_SECTIONS = set("ABCDE")

# One cell covering several sections at once:
#   "Civics and Community Engagement CE-A, CE-B"
#   "Understanding of Holy Quran I/Ethics I & II A,B"
#   "Ocp. Health & Safety EE-A,B,C"
# Requires at least one comma, so single-section titles still take the
# FSE_SECTION_RE path.
FSE_MULTI_SECTION_RE = re.compile(
    r'^(?P<course>.+?)\s+(?P<suffix>'
    r'(?:[A-Za-z]+\s*[-/]\s*)?[A-Z]'
    r'(?:\s*,\s*(?:[A-Za-z]+\s*[-/]\s*)?[A-Z])+'
    r')\s*$'
)

# A batch the cell states outright, e.g. "Applied Physics A (Batch 2025)".
# Left in place it defeated the section suffix and the cell was dropped.
FSE_BATCH_ANNOTATION_RE = re.compile(r'\(\s*Batch\s*(\d{4})\s*\)\s*$', re.IGNORECASE)

# The grid appends the instructor, the time and sometimes the venue to a cell
# ("... CE-A, CE-B Ms. Maria Mazhar 12:45 - 02:40 (Main Auditoriam"). None of
# it is part of the title, and all of it hid the section suffix.
#
# Applied ONLY to cells that don't parse as they stand — see
# parse_fse_course_title. Course titles abbreviate too, and "Physics for
# Engr. EE-A" loses its own name to an honorific rule that fires too eagerly.
# Hence "Engr" is absent below, and the honorific must be followed by a
# capitalised name.
FSE_TRAILING_NOISE_RES = [
    re.compile(r'\s*\(\s*(?:main|d\s*block)[^)]*\)?\s*$', re.IGNORECASE),
    re.compile(r'\s*\b(?:teacher|instructor)\s*:.*$', re.IGNORECASE),
    re.compile(r'\s*\b(?:Mr|Ms|Mrs|Dr|Prof)\b\.?\s+[A-Z].*$'),
    re.compile(r'\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}.*$'),
]

# A time the cell states for itself, which beats the column's slot.
FSE_CELL_TIME_RE = re.compile(r'(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})')

# --- Courses-tab block headers ---------------------------------------------
# The FSE courses tab changed shape between semesters, so these are matched
# against every cell to the LEFT of the Code column rather than against a
# fixed cell. See engineering.detect_courses_layout / parse_courses_tab.
#
#   Courses SP-26        one combined cell: "2nd Semester  Batch BS(EE) 2025"
#   Course Allocation    split over two cells and two rows:
#   FA26                   col 0  "BS CE 1st Semester Courses/Labs"
#                          col 1  "Batch BS(CE) 2026"   (on the first course row)
#
# Dept + batch together, e.g. "Batch BS(EE) 2025". Whitespace is normalized
# to single spaces before matching.
COURSES_HEADER_DEPT_BATCH_RE = re.compile(
    r'Batch\s+BS\s*\(\s*([A-Za-z]+)\s*\)\s*(\d{4})', re.IGNORECASE
)
# Shared/general block, no dept split, e.g. "6th Semester   Batch 2023"
COURSES_HEADER_BATCH_ONLY_RE = re.compile(r'Batch\s+(\d{4})', re.IGNORECASE)
# MS/PhD block in any of the forms the sheet uses:
#   "MS/PhD (EE) Courses"   "MS/PhD EE"   "MS EE"   "MS(EE) - IC Design"
#   "MS Electives"  -> captures "Electives", which is NOT a programme, so the
#                      caller drops it rather than inventing a dept "Ele".
COURSES_HEADER_MS_RE = re.compile(
    r'\bMS\b(?:\s*/\s*PhD)?\s*\(?\s*([A-Za-z]{2,9})', re.IGNORECASE
)
# Dept-only header that OPENS a block before its batch cell shows up, e.g.
# "BS CE 1st Semester Courses/Labs".
COURSES_HEADER_DEPT_ONLY_RE = re.compile(
    r'\bBS\s*\(?\s*([A-Za-z]{2,3})\s*\)?', re.IGNORECASE
)
# A bare batch cell, optionally carrying a block-level annotation:
#   "2026"            -> batch 2026
#   "2025 (Repeat)"   -> batch 2025, whole block is a repeat offering
COURSES_BATCH_CELL_RE = re.compile(r'^(\d{4})\s*(?:\(\s*([^)]*?)\s*\))?$')
COURSES_HEADER_SEMESTER_RE = re.compile(r'(\d+)\w{2}\s+Semester', re.IGNORECASE)

# Courses-tab column layout. Detected per-tab by detect_courses_layout();
# these are the "Courses SP-26" positions, kept only as a fallback for when
# detection finds no recognisable header row.
COURSES_FALLBACK_LAYOUT = {
    "header_row": 1,
    "code_col": 1,
    "title_col": 2,
    # Section-letter columns (Section-A/B/C/D), 0-indexed.
    "section_cols": list(zip(range(6, 10), "ABCD")),
}
COURSES_CODE_HEADERS = ("code", "course code")
COURSES_SECTION_HEADER_RE = re.compile(r'^section\s*[-\s]?\s*([A-Z])$', re.IGNORECASE)

# Parenthetical annotation on a Courses-tab title that marks a repeat /
# retake offering, e.g. "Applied Calculus (EE & CE Repeat)", "OOP (Repeat)".
REPEAT_ANNOTATION_RE = re.compile(r'\(([^)]*repeat[^)]*)\)', re.IGNORECASE)
REPEAT_ANNOTATION_STOPWORDS = {"REPEAT", "AND", "FOR", "OF", "THE"}

# --- Phase 6: regression guard --------------------------------------------
# Course names that are known EE-repeat offerings (per the bug that
# motivated this refactor) and must NEVER show up in CE's *normal* batch
# bucket — they belong in the REPEAT bucket instead.
REGRESSION_WATCH_DEPT = "BS CE"
REGRESSION_WATCH_BATCH = "2025"
REGRESSION_WATCH_DAY = "Monday"
REGRESSION_FORBIDDEN_COURSES = {
    "applied calculus",
    "applications of ict",
    "applications of ict lab",
    "applied physics",
    "applied physics lab",
}

