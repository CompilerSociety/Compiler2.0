"""Colour mapping and colour resolution helpers."""

import re

from .config import COLOUR_BATCH_MAP, SCHOOLS
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
# Exact fill colour Sheets uses to flag a repeat-course cell (#FCFE58).
# Tolerance is generous enough to absorb Sheets/rendering float drift but
# tight enough that pale-skin cohort swatches (e.g. CS-2023's mustard/gold
# legend colour) never match it.
REPEAT_YELLOW_RGB = (252, 254, 88)
REPEAT_YELLOW_TOLERANCE = 5  # +/- per channel, on a 0-255 scale

def is_yellow(colour):
    """True only for the sheet's repeat-course yellow (#FCFE58), within a
    small tolerance for rendering variation. This is intentionally NOT a
    broad 'looks yellowish' check — pale cohort legend colours (including
    CS-2023's) must never match here; they're resolved via colour_to_batch."""
    if colour is None:
        return False
    r, g, b = colour
    tr, tg, tb = REPEAT_YELLOW_RGB
    return (abs(r * 255 - tr) <= REPEAT_YELLOW_TOLERANCE and
            abs(g * 255 - tg) <= REPEAT_YELLOW_TOLERANCE and
            abs(b * 255 - tb) <= REPEAT_YELLOW_TOLERANCE)

# Conservative per-channel tolerance for matching a body cell's colour to
# a header legend swatch when they don't round to the exact same tuple.
COLOUR_MATCH_TOLERANCE = 0.03

def add_colour_entry(colour, dept, batch):
    """
    Record that `colour` is the legend swatch for (dept, batch).

    One fill can legitimately serve two legends — the computing sheet paints
    both "MS (AI)" and "BS CS (2023)" the same #FFE699 — so entries accumulate
    in a list rather than overwriting. dept is the legend's programme code
    ("CS", "AI", ...) or None for headers that name no programme
    (e.g. "MS Electives (All Prgrms)"); it is what disambiguates a shared
    colour at lookup time.
    """
    entries = COLOUR_BATCH_MAP.setdefault(colour, [])
    if not any(d == dept and b == batch for d, b in entries):
        entries.append((dept, batch))

def _entries_for_colour(colour):
    """
    Legend entries for a colour: exact match first, then the nearest legend
    swatch within COLOUR_MATCH_TOLERANCE per channel — this is what lets a
    slightly-drifted body cell resolve to its real legend instead of falling
    through to name-guessing. Returns [] when nothing is close enough.
    """
    exact = COLOUR_BATCH_MAP.get(colour)
    if exact:
        return exact

    best_entries, best_dist = [], None
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
    Resolve a cell's background colour to a batch key.

    dept_codes is the list of programme codes parsed out of the cell text
    itself (e.g. ["CS"] for "Cloud Comp (CS-A)"). When a colour is shared by
    more than one legend, the entry whose legend dept matches the cell wins:
    the #FFE699 fill means "BS CS (2023)" on a (CS-…) cell and "MS (AI)" on an
    (AI-…) one. Without that, whichever legend the header scan happened to see
    first swallowed the other cohort entirely.

    Colours mapped by a single legend ignore dept_codes and behave exactly as
    before. Returns a year string like "2025"/"2023", "MS", or None if no
    swatch is close enough / colour is white.
    """
    if colour is None or is_white(colour):
        return None

    entries = _entries_for_colour(colour)
    if not entries:
        return None

    if dept_codes and len(entries) > 1:
        wanted = {str(d).strip().upper() for d in dept_codes if d}
        for dept, batch in entries:
            if dept and dept in wanted:
                return batch

    return entries[0][1]

def build_colour_map(service):
    """
    Scan all sheets and auto-populate COLOUR_BATCH_MAP by parsing year from
    header cells like 'BS CS (2025)', 'BS AI (2022)', 'MS (CS)', etc.
    Only needs to scan the first few rows where headers live.
    """
    from .google_sheets import fetch_sheet_with_colours

    year_re = re.compile(r'\b(20\d{2})\b')
    ms_re   = re.compile(r'\bMS\b', re.IGNORECASE)
    # Programme code carried by the header: "BS CS (2023)" -> CS, "MS (AI)" -> AI.
    # Headers that name no programme ("MS Electives (All Prgrms)") yield None.
    bs_dept_re = re.compile(r'\bBS\s+([A-Z]{2,3})\b')
    ms_dept_re = re.compile(r'\bMS\s*\(\s*([A-Za-z]{2,3})\s*\)')

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

                    # A cohort legend always names its programme level. Without
                    # this guard, business course codes that happen to sit in the
                    # header band ("MG 2011 Environmental Science") register as
                    # bogus batch years on whatever fill they carry.
                    if not re.search(r'\b(BS|MS)\b', text, re.IGNORECASE):
                        continue

                    m = year_re.search(text)
                    if m:
                        dept_m = bs_dept_re.search(text.upper())
                        add_colour_entry(colour,
                                         dept_m.group(1) if dept_m else None,
                                         m.group(1))
                        continue

                    # MS header with no year e.g. 'MS (CS)', 'MS (DS)'
                    if ms_re.search(text) and 'BS' not in text.upper():
                        dept_m = ms_dept_re.search(text)
                        add_colour_entry(colour,
                                         dept_m.group(1).upper() if dept_m else None,
                                         "MS")

    batches = sorted({batch for entries in COLOUR_BATCH_MAP.values()
                      for _dept, batch in entries})
    shared = sum(1 for entries in COLOUR_BATCH_MAP.values() if len(entries) > 1)
    print(f"  Auto-mapped {len(COLOUR_BATCH_MAP)} colours"
          + (f" ({shared} shared by 2+ legends)" if shared else "")
          + ": " + ", ".join(batches))
