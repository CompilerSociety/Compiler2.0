"""Generic helpers shared by timetable generators."""

import re
from datetime import datetime

from .config import DEBUG_LOG_FILE

# ---------------------------------------------------------------------------
# Debug logger
# ---------------------------------------------------------------------------

_debug_lines = []

def dlog(msg, level="INFO"):
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{stamp}] [{level}] {msg}"
    _debug_lines.append(line)
    print(line)

def dlog_error(msg):
    dlog(msg, level="ERROR")

def dlog_warn(msg):
    dlog(msg, level="WARN")

def flush_debug_log():
    from pathlib import Path
    Path(DEBUG_LOG_FILE).parent.mkdir(parents=True, exist_ok=True)
    with open(DEBUG_LOG_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(_debug_lines) + "\n")
    print(f"\nDebug log written to: {DEBUG_LOG_FILE}")

# ---------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------

def clean(v):
    return str(v or "").replace("\u00a0", " ").strip()

def one_line(v):
    return re.sub(r"\s+", " ", clean(v))

def extract_dept_from_header(header_text):
    """
    Extract department prefix from a column header like:
      'BS CS (2025)' -> 'BS CS'
      'BS AI (2023)' -> 'BS AI'
      'MS (CS)' -> 'MS (CS)'
      'PhD' -> 'PhD'
    
    Returns the department prefix, or None if can't extract.
    """
    if not header_text:
        return None
    
    text = one_line(header_text).strip()
    if not text:
        return None

    text = re.sub(r"\s+", " ", text)
    
    # Pattern 1: Degree + code + optional year.
    # Handles both spaced and compact sheet labels, e.g. "BS CS (2025)" and "BSCS (2025)".
    m = re.match(r'^(BS|FT|BA|BBA|AF)\s*([A-Za-z][A-Za-z& ]*?)\s*(?:\(\d{4}\))?$', text, re.IGNORECASE)
    if m:
        prefix = m.group(1).upper()
        code = m.group(2).strip()
        code = code.upper() if code.isupper() or len(code) <= 3 else code
        return f"{prefix} {code}"
    
    # Pattern 2: MS with code in parens  e.g. "MS (CS)", "MS (DS)"
    m = re.match(r'^MS\s*\(([A-Za-z]+)\)\s*(?:\(\d{4}\))?$', text, re.IGNORECASE)
    if m:
        code = m.group(1).upper()
        return f"MS ({code})"
    
    # Pattern 3: MS with plain/compact code  e.g. "MS CS", "MSCS"
    m = re.match(r'^MS\s*([A-Za-z]{2,4})\s*(?:\(\d{4}\))?$', text, re.IGNORECASE)
    if m:
        code = m.group(1).upper()
        return f"MS ({code})"
    
    # Pattern 4: Just single word degree  e.g. "PhD", "G"
    if re.match(r'^(PhD|G)$', text, re.IGNORECASE):
        return text.upper()
    
    # Debug: return the text itself if it looks like a degree label but didn't match
    if any(text.upper().startswith(p) for p in ['BS', 'MS', 'PhD', 'G', 'FT', 'BA', 'BBA', 'AF']):
        # Might be a malformed header, try to extract what we can
        words = text.split()
        if len(words) >= 1:
            return text  # Return as-is if it starts with a known prefix
    
    return None

def normalize_dept_key(dept_code):
    """
    Normalize unknown department codes (fallback for business school FSM parser).
    If no prefix found, prepend 'BS'.
    
    Examples:
      'CS' -> 'BS CS'
      'Unknown' -> 'BS Unknown'
    """
    if not dept_code:
        return 'BS'
    
    dept_code = str(dept_code).strip()
    
    # Check if already has a known prefix
    known_prefixes = ('BS', 'MS', 'G', 'FT', 'BA', 'BBA', 'AF', 'PhD')
    for prefix in known_prefixes:
        if dept_code.startswith(prefix + ' ') or dept_code == prefix:
            return dept_code
    
    # No prefix found, add BS
    return f'BS {dept_code}'

# ---------------------------------------------------------------------------
# Room normalization and timetable insertion
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

def count_entries(tt):
    n = 0
    for batches in tt.values():
        for sections in batches.values():
            for days in sections.values():
                for entries in days.values():
                    n += len(entries)
    return n
