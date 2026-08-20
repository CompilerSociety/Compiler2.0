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

    # Primary output: write to disk, same as before Mongo was introduced.
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    # Mongo write is best-effort only for now — if MONGODB_URI isn't
    # configured, or the write fails, that no longer blocks the JSON file
    # (which is the source of truth again). out_path is an absolute path
    # from main.py; pass the repo-relative tail starting at "db/" as the
    # doc id.
    rel = out_path.replace("\\", "/")
    idx = rel.find("db/")
    doc_id = rel[idx:] if idx >= 0 else rel
    if _store is not None and _store.enabled():
        try:
            if not _store.save_document(doc_id, output):
                print(f"  [warn] could not store {doc_id} in MongoDB (JSON file still written)")
        except Exception as e:  # noqa: BLE001
            print(f"  [warn] MongoDB write failed for {doc_id}: {e} (JSON file still written)")

    return ref_tt, output["count"]


def write_output(tt, out_path):
    return write_json(tt, out_path)