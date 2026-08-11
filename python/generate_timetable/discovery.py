"""Discover-mode reporting for spreadsheet cell colours."""

from .config import SCHOOLS
from .colour_mapper import is_white
from .google_sheets import fetch_sheet_with_colours
from .helpers import one_line

def discover_colours(service):
    """
    Scan all sheets and print every unique non-white background colour found,
    with the nearest cell text so you can identify which batch it belongs to.
    Run once, then fill in COLOUR_BATCH_MAP from the output.
    """
    print("\n" + "=" * 60)
    print("COLOUR DISCOVERY MODE")
    print("=" * 60)
    print("Scanning all sheets for non-white background colours...\n")

    all_colours = {}  # colour_tuple → list of (school, tab, row, col, text)

    for school_name, school_info in SCHOOLS.items():
        print(f"  [{school_name}]")
        for tab in school_info["tabs"]:
            print(f"    Fetching {tab}...", end=" ", flush=True)
            try:
                text_grid, colour_grid = fetch_sheet_with_colours(
                    service, school_info["id"], tab)
            except Exception as e:
                print(f"ERROR: {e}")
                continue

            found = 0
            for r, (t_row, c_row) in enumerate(zip(text_grid, colour_grid)):
                for col, (text, colour) in enumerate(zip(t_row, c_row)):
                    if colour is None or is_white(colour):
                        continue
                    snippet = one_line(text)[:60] if text else ""
                    if colour not in all_colours:
                        all_colours[colour] = []
                    all_colours[colour].append((school_name, tab, r, col, snippet))
                    found += 1
            print(f"{found} coloured cells")

    if not all_colours:
        print("\n[!] No non-white coloured cells found across any sheet.")
        print("    Check that the service account has viewer access to the sheets.")
        return

    print("\n" + "=" * 60)
    print(f"Found {len(all_colours)} unique colours.\n")

    # Print them grouped, with one example cell each for identification
    # Sort by first occurrence row so header colours come first
    def sort_key(item):
        colour, occurrences = item
        first = occurrences[0]
        return (first[0], first[1], first[2])  # school, tab, row

    for colour, occurrences in sorted(all_colours.items(), key=sort_key):
        r, g, b = colour
        # Show the first few examples so you can identify the batch
        examples = occurrences[:3]
        ex_str = " | ".join(
            f"'{ex[4]}' (row {ex[2]}, col {ex[3]}, {ex[0]}/{ex[1]})"
            for ex in examples
        )
        count = len(occurrences)
        print(f"  ({r:.2f}, {g:.2f}, {b:.2f})  [{count:4d} cells]  e.g. {ex_str}")

    print("\n" + "=" * 60)
    print("Copy the entries below into COLOUR_BATCH_MAP at the top of this script,")
    print("replacing 'YEAR' with the correct batch year (2022 / 2023 / 2024 / 2025):\n")
    print("COLOUR_BATCH_MAP = {")
    for colour, occurrences in sorted(all_colours.items(), key=sort_key):
        r, g, b = colour
        ex = occurrences[0]
        print(f"    ({r:.2f}, {g:.2f}, {b:.2f}): \"YEAR\",  # e.g. '{ex[4][:50]}'")
    print("}")
    print()
