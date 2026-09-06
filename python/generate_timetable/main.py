"""Command-line orchestration for timetable generation."""

import os
import sys
from pathlib import Path

if __package__:
    from .colour_mapper import build_colour_map
    from .config import COLOUR_BATCH_MAP, SCHOOLS, SERVICE_ACCOUNT_FILE
    from .discovery import discover_colours
    from .google_sheets import authenticate
    from .helpers import dlog, dlog_error, flush_debug_log
    from .output import write_json
    from .schools import business, computing, engineering
else:
    PROJECT_ROOT = Path(__file__).resolve().parents[2]
    PYTHON_ROOT = PROJECT_ROOT / "python"
    sys.path.insert(0, str(PYTHON_ROOT))
    os.chdir(PROJECT_ROOT)

    from generate_timetable.colour_mapper import build_colour_map
    from generate_timetable.config import COLOUR_BATCH_MAP, SCHOOLS, SERVICE_ACCOUNT_FILE
    from generate_timetable.discovery import discover_colours
    from generate_timetable.google_sheets import authenticate
    from generate_timetable.helpers import dlog, dlog_error, flush_debug_log
    from generate_timetable.output import write_json
    from generate_timetable.schools import business, computing, engineering


def main():
    discover_mode = "--discover" in sys.argv

    dlog(f"generate_timetable.py started \u2014 mode={'discover' if discover_mode else 'generate'}")
    dlog(f"Python: {sys.version}")

    if not os.path.exists(SERVICE_ACCOUNT_FILE):
        dlog_error(f"'{SERVICE_ACCOUNT_FILE}' not found \u2014 cannot authenticate")
        print(f"ERROR: '{SERVICE_ACCOUNT_FILE}' not found.")
        flush_debug_log()
        raise RuntimeError(f"Missing credential file: {SERVICE_ACCOUNT_FILE}")

    dlog(f"Loading credentials from {SERVICE_ACCOUNT_FILE}")
    service = authenticate()
    dlog(f"Google Sheets API client ready")

    if discover_mode:
        discover_colours(service)
        flush_debug_log()
        return

    dlog("Auto-detecting colour \u2192 batch mappings from sheet headers...")
    build_colour_map(service)

    if not COLOUR_BATCH_MAP:
        dlog_error("Could not auto-detect any colour mappings \u2014 aborting")
        flush_debug_log()
        raise RuntimeError("Could not detect any cohort colour mappings")

    dlog(f"Colour map: {COLOUR_BATCH_MAP}")

    os.makedirs("db", exist_ok=True)
    total_entries = 0
    all_depts = set()

    # Parse and validate every school before the first write. A source failure
    # must not publish a partial timetable or update only the first school.
    generated = {}
    for school, parser in (("computing", computing), ("business", business),
                           ("engineering", engineering)):
        print(f"\nProcessing {school}...")
        tt, count = parser.generate(service)
        if not tt or count <= 0:
            raise RuntimeError(f"{school}: empty generated timetable; refusing publication")
        generated[school] = tt
        total_entries += count

    for school, tt in generated.items():
        out_path = os.path.join("db", "timetables", f"{school}.json")
        ref_tt, written_count = write_json(tt, out_path)
        all_depts.update(ref_tt.keys())
        dlog(f"Wrote {out_path} ({written_count} entries, {len(ref_tt)} depts)")
        print(f"  {school}: {written_count} entries -> {out_path}")

    print(f"\n{'=' * 50}")
    print(f"Done. {len(SCHOOLS)} school files written to db/timetables/")
    print(f"Total entries: {total_entries}")
    print(f"All departments: {', '.join(sorted(all_depts))}")
    dlog(f"Done. Total entries: {total_entries}. Depts: {sorted(all_depts)}")
    flush_debug_log()


if __name__ == "__main__":
    main()
