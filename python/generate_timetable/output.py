"""Timetable JSON output helpers."""

import json
from datetime import datetime, timezone

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
    return ref_tt, output["count"]


def write_output(tt, out_path):
    return write_json(tt, out_path)
