"""Colour mapping and colour resolution helpers."""

import re

from .config import COLOUR_BATCH_MAP, COMPUTING_PROGRAM_CODES, SCHOOLS
from .helpers import one_line

def rgb_key(bg):
    """
    Convert a Sheets API backgroundColor dict to a rounded (R, G, B) tuple.
    Values are floats in [0, 1]. We round to 2 decimal places so that
    trivial float precision differences don't break dict lookups.
    Returns None if bg is falsy.
    """
    if not bg:
        return None
    r = round(bg.get("red",   0.0), 2)
    g = round(bg.get("green", 0.0), 2)
    b = round(bg.get("blue",  0.0), 2)
    return (r, g, b)

def is_white(colour):
    """True for white / near-white cells (no meaningful background colour)."""
    if colour is None:
        return True
    r, g, b = colour
    return r >= 0.95 and g >= 0.95 and b >= 0.95

# Batch key used for yellow-highlighted "repeat" classes. Yellow is the
# authoritative repeat signal (per the source sheet's convention), so it
# overrides year-suffix / colour-map batch resolution — see resolve_batch.
#
# The repeat fill is READ FROM THE LEGEND (the swatch labelled e.g. "BS Repeat
# Courses" at the top of each day tab) rather than hardcoded, because it has
# already changed once without notice: this was pinned to #FCFE58 while the
# sheet painted #FFFF00, so is_yellow() never fired and 78 repeat cells sat in
# normal batch schedules. A legend the sheet itself maintains cannot drift out
# of sync with the cells it labels.
REPEAT_YELLOW_RGB = (252, 254, 88)   # fallback only, for a tab with no legend
REPEAT_YELLOW_TOLERANCE = 5  # +/- per channel, on a 0-255 scale

# Legend headers that mark the repeat/retake swatch, e.g. "BS Repeat Courses".
REPEAT_LEGEND_RE = re.compile(r'\brepeat\b', re.IGNORECASE)

# Fills registered as the repeat swatch by build_colour_map(). A set, because
# nothing stops the tabs from painting the legend in two near-identical yellows.
REPEAT_SWATCHES = set()

def register_repeat_swatch(colour):
    """Record a fill the legend labels as the repeat/retake colour."""
    if colour is not None and not is_white(colour):
        REPEAT_SWATCHES.add(colour)

def _near(colour, target_255):
    tr, tg, tb = target_255
    r, g, b = colour
    return (abs(r * 255 - tr) <= REPEAT_YELLOW_TOLERANCE and
            abs(g * 255 - tg) <= REPEAT_YELLOW_TOLERANCE and
            abs(b * 255 - tb) <= REPEAT_YELLOW_TOLERANCE)

def is_yellow(colour):
    """True only for the fill the sheet's own legend marks as repeat courses.

    This is intentionally NOT a broad 'looks yellowish' check — pale cohort
    legend colours (including CS-2023's) must never match here; they're
    resolved via colour_to_batch. Falls back to the historical #FCFE58 when
    no tab declared a repeat legend, so a legend-less sheet still works.
    """
    if colour is None:
        return False
    for swatch in REPEAT_SWATCHES:
        if _near(colour, tuple(v * 255 for v in swatch)):
            return True
    if REPEAT_SWATCHES:
        return False
    return _near(colour, REPEAT_YELLOW_RGB)

# Conservative per-channel tolerance for matching a body cell's colour to
# a header legend swatch when they don't round to the exact same tuple.
COLOUR_MATCH_TOLERANCE = 0.03

# A legend header names the programme it belongs to inside parentheses or
# right after the degree word: 'BS CS (2023)' -> CS, 'MS (AI)' -> AI,
# 'MS Electives (All Prgrms)' -> None (names no single programme).
LEGEND_DEPT_RE = re.compile(
    r'\b(?:BS|MS)\s*\(?\s*([A-Za-z]{2,4})\s*\)?', re.IGNORECASE
)

def legend_dept_code(text):
    """
    Extract the programme code a legend header refers to, or None.

      'BS CS (2023)'              -> 'CS'
      'MS (AI)'                   -> 'AI'
      'BS AI (2025)'              -> 'AI'
      'MS Electives (All Prgrms)' -> None   (no programme named)
      'MS'                        -> None

    Only codes that are actual programmes count. Anything else — 'Electives',
    a year, a stray word — yields None, which means "this legend does not
    discriminate by department" and matches any cell.
    """
    if not text:
        return None
    for m in LEGEND_DEPT_RE.finditer(text):
        code = m.group(1).upper()
        if code in COMPUTING_PROGRAM_CODES:
            return code
    return None

def add_colour_entry(colour, dept_code, batch):
    """
    Record one legend under its fill colour.

    Entries ACCUMULATE rather than first-write-wins: the computing sheet
    paints 'MS (AI)' and 'BS CS (2023)' with the very same fill, and the
    old first-write-wins behaviour silently redirected an entire BS CS
    cohort into MS. Both legends are kept, and colour_to_batch() picks
    between them using the department code in the cell's own text.
    """
    entries = COLOUR_BATCH_MAP.setdefault(colour, [])
    if (dept_code, batch) not in entries:
        entries.append((dept_code, batch))

# Legend header text kept per fill, so a cell that names no department of its
# own can still be attributed to the cohort its colour belongs to.
COLOUR_LEGEND_TEXT = {}

def remember_legend_text(colour, text):
    texts = COLOUR_LEGEND_TEXT.setdefault(colour, [])
    text = one_line(text)
    if text and text not in texts:
        texts.append(text)

def _legend_texts_for(colour):
    exact = COLOUR_LEGEND_TEXT.get(colour)
    if exact:
        return exact
    best, best_dist = [], None
    for swatch, texts in COLOUR_LEGEND_TEXT.items():
        deltas = [abs(a - b) for a, b in zip(colour, swatch)]
        if max(deltas) <= COLOUR_MATCH_TOLERANCE:
            dist = sum(deltas)
            if best_dist is None or dist < best_dist:
                best, best_dist = texts, dist
    return best

def colour_dept_label(colour):
    """
    Department label for a cell that names no department of its own, taken
    from the legend that owns the cell's fill.

      'BS CS (2023)'              -> 'BS CS'
      'MS (DS)'                   -> 'MS (DS)'
      'MS Electives (All Prgrms)' -> 'MS (Electives)'

    Last resort only — a department written in the cell text, or carried by
    the cell's row, is always better evidence than the fill. Returns None
    when the legend names no usable programme.
    """
    if colour is None or is_white(colour):
        return None
    for text in _legend_texts_for(colour):
        m = re.match(r'^\s*BS\s*\(?\s*([A-Za-z]{2,4})\b', text, re.IGNORECASE)
        if m:
            return f"BS {m.group(1).upper()}"
        m = re.match(r'^\s*MS\s*\(?\s*([A-Za-z]{2,9})\b', text, re.IGNORECASE)
        if m:
            code = m.group(1)
            return f"MS ({code.upper() if len(code) <= 4 else code.capitalize()})"
    return None

def _entries_for_colour(colour):
    """Exact colour hit, else the nearest legend swatch within tolerance."""
    exact = COLOUR_BATCH_MAP.get(colour)
    if exact:
        return exact

    best_entries, best_dist = None, None
    for swatch, entries in COLOUR_BATCH_MAP.items():
        dr = abs(colour[0] - swatch[0])
        dg = abs(colour[1] - swatch[1])
        db = abs(colour[2] - swatch[2])
        if dr <= COLOUR_MATCH_TOLERANCE and dg <= COLOUR_MATCH_TOLERANCE and db <= COLOUR_MATCH_TOLERANCE:
            dist = dr + dg + db
            if best_dist is None or dist < best_dist:
                best_entries, best_dist = entries, dist
    return best_entries

def colour_to_batch(colour, dept_codes=None):
    """
    Look up a colour tuple against COLOUR_BATCH_MAP.

    Tries an exact match first, then falls back to the nearest legend
    swatch within COLOUR_MATCH_TOLERANCE per channel — this is what lets
    a slightly-drifted body cell (e.g. CS-2023's pale-skin fill) resolve
    to its real legend batch instead of falling through to name-guessing.

    When a colour carries MORE THAN ONE legend (the sheet reuses a fill for
    two different cohorts), dept_codes — the department codes parsed out of
    the cell's own text, e.g. ["CS"] from "Cloud Comp (CS-A)" — decides
    which legend applies. A colour with a single legend ignores dept_codes
    entirely and resolves exactly as it always did.

    Returns a year string like "2025"/"2023", "MS", or None if no swatch
    is close enough / colour is white.
    """
    if colour is None or is_white(colour):
        return None

    entries = _entries_for_colour(colour)
    if not entries:
        return None

    if len(entries) == 1:
        return entries[0][1]

    # Shared fill — disambiguate on the cell's own department code.
    if dept_codes:
        wanted = {str(d).upper() for d in dept_codes}
        for dept_code, batch in entries:
            if dept_code and dept_code in wanted:
                return batch

    # No usable department signal: prefer a legend that names no programme
    # (it applies to everything), otherwise keep the first-seen legend so
    # behaviour matches the pre-fix code rather than changing arbitrarily.
    for dept_code, batch in entries:
        if dept_code is None:
            return batch
    return entries[0][1]

def build_colour_map(service):
    """
    Scan all sheets and auto-populate COLOUR_BATCH_MAP by parsing year from
    header cells like 'BS CS (2025)', 'BS AI (2022)', 'MS (CS)', etc.
    Only needs to scan the first few rows where headers live.

    Each legend is stored with the programme code it names, so a fill used
    by two cohorts keeps both and can be resolved per-cell later.
    """
    from .google_sheets import fetch_sheet_with_colours

    year_re = re.compile(r'\b(20\d{2})\b')
    ms_re   = re.compile(r'\bMS\b', re.IGNORECASE)
    # A cohort legend always names a degree. Without this guard the business
    # tab's course titles — 'MG 2011 Environmental Science', 'SS 2006
    # Macroeconomics' — parse their course codes as batch years and claim
    # whatever fill they happen to carry.
    cohort_re = re.compile(r'\b(?:BS|MS)\b', re.IGNORECASE)

    for school_name, school_info in SCHOOLS.items():
        for tab in school_info["tabs"]:
            try:
                text_grid, colour_grid = fetch_sheet_with_colours(
                    service, school_info["id"], tab)
            except Exception:
                continue

            # Only scan first 10 rows — headers are always at the top
            for r, (t_row, c_row) in enumerate(zip(text_grid[:10], colour_grid[:10])):
                for text, colour in zip(t_row, c_row):
                    if colour is None or is_white(colour):
                        continue
                    if not cohort_re.search(text or ""):
                        continue  # not a cohort legend — see cohort_re above

                    # "BS Repeat Courses" names a fill, not a cohort: register
                    # it as the repeat swatch and never as a batch.
                    if REPEAT_LEGEND_RE.search(text or ""):
                        register_repeat_swatch(colour)
                        continue

                    remember_legend_text(colour, text)
                    dept_code = legend_dept_code(text)

                    m = year_re.search(text)
                    if m:
                        add_colour_entry(colour, dept_code, m.group(1))
                        continue

                    # MS header with no year e.g. 'MS (CS)', 'MS (DS)'
                    if ms_re.search(text) and 'BS' not in text.upper():
                        add_colour_entry(colour, dept_code, "MS")

    all_batches = sorted({b for entries in COLOUR_BATCH_MAP.values() for _, b in entries})
    shared = [c for c, entries in COLOUR_BATCH_MAP.items() if len(entries) > 1]
    print(f"  Auto-mapped {len(COLOUR_BATCH_MAP)} colours: " + ", ".join(all_batches))
    for colour in shared:
        print(f"    shared fill {colour} -> {COLOUR_BATCH_MAP[colour]} "
              f"(resolved per-cell by department code)")
