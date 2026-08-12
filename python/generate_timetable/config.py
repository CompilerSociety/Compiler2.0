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
        ("id", "1m5yFyi0QgWx0JhdEicQQL2JOEpSmcmVDOIi15_4p9Dw"),
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
# ---------------------------------------------------------------------------

COLOUR_BATCH_MAP = {}  # filled automatically at runtime

# Batch key used for yellow-highlighted "repeat" classes. Yellow is the
# authoritative repeat signal (per the source sheet's convention), so it
# overrides year-suffix / colour-map batch resolution — see resolve_batch.
REPEAT_BATCH_KEY = "REPEAT"

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
    "slot_map": {31: "05:20-06:40", 36: "06:45-08:05"}
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
FSM_SECTION_OFFSET = 7

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

# Known section letters for validation
FSE_VALID_SECTIONS = set("ABCD")

# Regexes used to pull dept + batch out of a courses-tab block header. The
# header text is everything left of the Code column, joined and whitespace-
# normalized, so these must cope with both layouts the sheet has used:
#   "Courses SP-26":        one cell — "2nd Semester   Batch BS(EE) 2025"
#   "Course Allocation FA26": split — "BS CE 1st Semester Courses/Labs" on the
#                            block row, then "Batch BS(CE) 2026" on the row of
#                            that block's first course.
COURSES_HEADER_DEPT_BATCH_RE = re.compile(
    r'Batch\s+BS\s*\(\s*([A-Za-z]+)\s*\)\s+(\d{4})', re.IGNORECASE
)
# Shared/general block, no dept split, e.g. "6th Semester   Batch 2023"
COURSES_HEADER_BATCH_ONLY_RE = re.compile(r'Batch\s+(\d{4})', re.IGNORECASE)
# MS/PhD block. Covers "MS/PhD EE", "MS/PhD (EE) Courses", "MS EE",
# "MS(EE) - IC Design". The captured token is only trusted when it names a
# known programme — otherwise "MS Electives" would read as dept "Ele".
COURSES_HEADER_MSPHD_RE = re.compile(
    r'\bMS(?:\s*/\s*PhD)?\s*\(?\s*([A-Za-z]{2,3})\b\)?', re.IGNORECASE
)
COURSES_HEADER_SEMESTER_RE = re.compile(r'(\d+)\w{2}\s+Semester', re.IGNORECASE)
# Block header that names the dept but not the batch, e.g.
# "BS CE 1st Semester Courses/Labs". Requires "Semester" so ordinary course
# rows can't be mistaken for block boundaries.
COURSES_HEADER_BLOCK_DEPT_RE = re.compile(
    r'\bBS\s+([A-Za-z]{2,3})\b(?=.*Semester)', re.IGNORECASE
)
# Batch given as a bare year, optionally flagged as a repeat block:
# "2025 (Repeat)" sitting in the batch column of a repeat offering.
COURSES_HEADER_BARE_BATCH_RE = re.compile(r'(?<!\d)(20\d{2})(?!\d)')
# Column header naming a section on a courses tab: "Section-A" / "Section A".
COURSES_SECTION_HEADER_RE = re.compile(r'^Section\s*-?\s*([A-Za-z])$', re.IGNORECASE)
# How far down a courses tab to look for the Code/Course/Section header row.
COURSES_LAYOUT_SCAN_ROWS = 12

# Parenthetical annotation on a Courses-tab title that marks a repeat /
# retake offering, e.g. "Applied Calculus (EE & CE Repeat)", "OOP (Repeat)".
REPEAT_ANNOTATION_RE = re.compile(r'\(([^)]*repeat[^)]*)\)', re.IGNORECASE)
REPEAT_ANNOTATION_STOPWORDS = {"REPEAT", "AND", "FOR", "OF", "THE"}

# Section-letter columns (Section-A/B/C/D) on the Courses SP-26 tab, 0-indexed.
COURSES_SECTION_COLS = list(zip(range(6, 10), "ABCD"))

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

