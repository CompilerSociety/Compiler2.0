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

    # MongoDB is the only store. Writing the file back as well was tried and
    # reverted: db/timetables/*.json sits at exactly the path the frontend
    # fetches, and Vercel checks the filesystem BEFORE applying the rewrite to
    # /api/db - so the moment those files exist, every timetable read is served
    # from the commit and the database is never consulted at all.
    #
    # out_path is an absolute path from main.py and is now only an identifier,
    # so pass the repo-relative tail starting at "db/".
    rel = out_path.replace("\\", "/")
    idx = rel.find("db/")
    doc_id = rel[idx:] if idx >= 0 else rel
    if _store is None or not _store.enabled():
        raise RuntimeError(
            f"MONGODB_URI is not configured - refusing to discard the timetable for {doc_id}"
        )
    if not _store.save_document(doc_id, output):
        raise RuntimeError(f"Could not store {doc_id} in MongoDB")
    return ref_tt, output["count"]


def write_output(tt, out_path):
    return write_json(tt, out_path)