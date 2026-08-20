"""Timetable JSON output helpers."""

import json
import os
import sys
from datetime import datetime, timezone

# Generated timetables live in Mongo (collection `documents`) as well as in the
# committed db/timetables/*.json the frontend serves statically. Optional by
# design: with no MONGODB_URI this module behaves exactly as it did before.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
try:
    from db import store as _store
except Exception:  # noqa: BLE001
    _store = None

def convert_to_reference_format(tt):
    """Convert internal {c,l,t} entries to {name,location,time}."""
    out = {}
    for dept, batches in tt.items():
        out[dept] = {}
        for batch, sections in batches.items():
            out[dept][batch] = {}
            for sec, days in sections.items():
                out[dept][batch][sec] = {}
                for day, entries in days.items():
                    out[dept][batch][sec][day] = [
                        {"name": e["c"], "location": e["l"], "time": e["t"]}
                        for e in entries
                    ]
    return out

def count_entries(tt):
    n = 0
    for batches in tt.values():
        for sections in batches.values():
            for days in sections.values():
                for entries in days.values():
                    n += len(entries)
    return n


def write_json(tt, out_path):
    ref_tt = convert_to_reference_format(tt)
    output = {
        "ok": True,
        "tt": ref_tt,
        "count": count_entries(ref_tt),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    if _store is not None:
        # out_path is an absolute path from main.py; save_document matches on
        # the repo-relative tail, so pass the part starting at "db/".
        rel = out_path.replace("\\", "/")
        idx = rel.find("db/")
        _store.save_document(rel[idx:] if idx >= 0 else rel, output)
    return ref_tt, output["count"]


def write_output(tt, out_path):
    return write_json(tt, out_path)
