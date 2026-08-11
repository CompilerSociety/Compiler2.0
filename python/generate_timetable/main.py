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
        return

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
        return

    dlog(f"Colour map: {COLOUR_BATCH_MAP}")

    os.makedirs("db", exist_ok=True)
    total_entries = 0
    all_depts = set()

    print(f"\nProcessing computing...")
    tt, count = computing.generate(service)
    total_entries += count
    out_path = os.path.join("db", "timetables", "computing.json")
    ref_tt, written_count = write_json(tt, out_path)
    all_depts.update(ref_tt.keys())
    dlog(f"Wrote {out_path} ({written_count} entries, {len(ref_tt)} depts)")
    print(f"  \u2192 computing: {count} entries, {len(tt)} depts \u2192 {out_path}")

    print(f"\nProcessing business...")
    tt, count = business.generate(service)
    total_entries += count
    out_path = os.path.join("db", "timetables", "business.json")
    ref_tt, written_count = write_json(tt, out_path)
    all_depts.update(ref_tt.keys())
    dlog(f"Wrote {out_path} ({written_count} entries, {len(ref_tt)} depts)")
    print(f"  \u2192 business: {count} entries, {len(tt)} depts \u2192 {out_path}")

    print(f"\nProcessing engineering...")
    tt, count = engineering.generate(service)
    total_entries += count
    out_path = os.path.join("db", "timetables", "engineering.json")
    ref_tt, written_count = write_json(tt, out_path)
    all_depts.update(ref_tt.keys())
    dlog(f"Wrote {out_path} ({written_count} entries, {len(ref_tt)} depts)")
    print(f"  \u2192 engineering: {count} entries, {len(tt)} depts \u2192 {out_path}")

    print(f"\n{'=' * 50}")
    print(f"Done. {len(SCHOOLS)} school files written to db/timetables/")
    print(f"Total entries: {total_entries}")
    print(f"All departments: {', '.join(sorted(all_depts))}")
    dlog(f"Done. Total entries: {total_entries}. Depts: {sorted(all_depts)}")
    flush_debug_log()


if __name__ == "__main__":
    main()
