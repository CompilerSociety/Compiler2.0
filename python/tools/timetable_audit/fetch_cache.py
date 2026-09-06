"""Fetch all three schools' source tabs once and cache them to disk,
so the audit can be re-run without hammering the Sheets API."""
import json, os, sys

sys.path.insert(0, os.path.abspath("."))
from python.generate_timetable.google_sheets import authenticate, fetch_sheet_with_colours, get_sheet_tab_names
from python.generate_timetable.config import SCHOOLS
from python.generate_timetable.day_tabs import resolve_day_tab

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

svc = authenticate()

targets = []
actual_tabs = get_sheet_tab_names(svc, SCHOOLS["computing"]["id"])
for tab in SCHOOLS["computing"]["tabs"]:
    targets.append(("computing", SCHOOLS["computing"]["id"], tab))
targets.append(("engineering", SCHOOLS["engineering"]["id"], SCHOOLS["engineering"]["tabs"][0]))
targets.append(("engineering", SCHOOLS["engineering"]["id"], SCHOOLS["engineering"]["courses_tab"]))

targets.append(("business", SCHOOLS["business"]["id"], SCHOOLS["business"]["tabs"][0]))

for school, sid, tab in targets:
    actual = resolve_day_tab(actual_tabs, tab) if school == "computing" else tab
    if actual is None:
        raise RuntimeError(f"No active tab for {school}/{tab}")
    text, colour = fetch_sheet_with_colours(svc, sid, actual)
    safe = "".join(ch if ch.isalnum() else "_" for ch in f"{school}__{tab}")
    with open(os.path.join(OUT, safe + ".json"), "w", encoding="utf-8") as f:
        json.dump({"school": school, "tab": actual, "text": text, "colour": colour}, f)
    print(f"{school}/{tab}: {len(text)} rows x {max((len(r) for r in text), default=0)} cols")
