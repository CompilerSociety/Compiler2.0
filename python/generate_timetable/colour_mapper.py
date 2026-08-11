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

def colour_to_batch(colour):
    """
    Look up a colour tuple against COLOUR_BATCH_MAP.
    Tries an exact match first, then falls back to the nearest legend
    swatch within COLOUR_MATCH_TOLERANCE per channel — this is what lets
    a slightly-drifted body cell (e.g. CS-2023's pale-skin fill) resolve
    to its real legend batch instead of falling through to name-guessing.
    Returns a year string like "2025"/"2023", "MS", or None if no swatch
    is close enough / colour is white.
    """
    if colour is None or is_white(colour):
        return None

    exact = COLOUR_BATCH_MAP.get(colour)
    if exact:
        return exact

    best_batch, best_dist = None, None
    for swatch, batch in COLOUR_BATCH_MAP.items():
        dr = abs(colour[0] - swatch[0])
        dg = abs(colour[1] - swatch[1])
        db = abs(colour[2] - swatch[2])
        if dr <= COLOUR_MATCH_TOLERANCE and dg <= COLOUR_MATCH_TOLERANCE and db <= COLOUR_MATCH_TOLERANCE:
            dist = dr + dg + db
            if best_dist is None or dist < best_dist:
                best_batch, best_dist = batch, dist
    return best_batch

def build_colour_map(service):
    """
    Scan all sheets and auto-populate COLOUR_BATCH_MAP by parsing year from
    header cells like 'BS CS (2025)', 'BS AI (2022)', 'MS (CS)', etc.
    Only needs to scan the first few rows where headers live.
    """
    from .google_sheets import fetch_sheet_with_colours

    year_re = re.compile(r'\b(20\d{2})\b')
    ms_re   = re.compile(r'\bMS\b', re.IGNORECASE)

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
                    if colour in COLOUR_BATCH_MAP:
                        continue  # already mapped

                    m = year_re.search(text)
                    if m:
                        COLOUR_BATCH_MAP[colour] = m.group(1)
                        continue

                    # MS header with no year e.g. 'MS (CS)', 'MS (DS)'
                    if ms_re.search(text) and 'BS' not in text.upper():
                        COLOUR_BATCH_MAP[colour] = "MS"

    print(f"  Auto-mapped {len(COLOUR_BATCH_MAP)} colours: "
          + ", ".join(sorted(set(COLOUR_BATCH_MAP.values()))))
