"""Fetch the computing + engineering source tabs once and cache them to disk,
so the audit can be re-run without hammering the Sheets API."""
import json, os, sys

sys.path.insert(0, os.path.abspath("."))
from python.generate_timetable.google_sheets import authenticate, fetch_sheet_with_colours
from python.generate_timetable.config import SCHOOLS

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

svc = authenticate()

targets = []
for tab in SCHOOLS["computing"]["tabs"]:
    targets.append(("computing", SCHOOLS["computing"]["id"], tab))
targets.append(("engineering", SCHOOLS["engineering"]["id"], SCHOOLS["engineering"]["tabs"][0]))
targets.append(("engineering", SCHOOLS["engineering"]["id"], SCHOOLS["engineering"]["courses_tab"]))

for school, sid, tab in targets:
    text, colour = fetch_sheet_with_colours(svc, sid, tab)
    safe = "".join(ch if ch.isalnum() else "_" for ch in f"{school}__{tab}")
    with open(os.path.join(OUT, safe + ".json"), "w", encoding="utf-8") as f:
        json.dump({"school": school, "tab": tab, "text": text, "colour": colour}, f)
    print(f"{school}/{tab}: {len(text)} rows x {max((len(r) for r in text), default=0)} cols")
