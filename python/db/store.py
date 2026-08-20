"""MongoDB access for the Python sync jobs.

The Node side has lib/db/mongo.mjs and lib/db/repos.mjs; this is the same idea
for the Python half of the system (api/fetch-timetable.py and the timetable
generator), and it deliberately mirrors that module's collection names and
document ids so both languages read and write the same records.

Design note - why the Python jobs keep writing files too:

    These jobs run inside a GitHub Action that already commits its output, and
    that commit is what keeps the db/*.json mirror fresh for the frontend's
    static fetches and for the API's offline fallback. So `save_document` writes
    BOTH: Mongo becomes the source of truth, and the file keeps being produced
    exactly as before. Nothing downstream had to change, and if MONGODB_URI is
    ever unset the jobs degrade to precisely their old behaviour instead of
    failing.

Env:
    MONGODB_URI - Atlas connection string. Unset means "file only".
    MONGODB_DB  - database name (optional, default "compiler2").
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from typing import Any

# Mirrors DOCUMENT_FILES in lib/db/collections.mjs. Keep the two in step: a path
# missing here is silently file-only, which is a confusing way to lose data.
DOCUMENT_IDS: dict[str, str] = {
    "db/timetables/computing.json": "timetables/computing",
    "db/timetables/business.json": "timetables/business",
    "db/timetables/engineering.json": "timetables/engineering",
    "db/timetables/repeat-computing.json": "timetables/repeat-computing",
    "db/exams/computing.json": "exams/computing",
    "db/exams/business.json": "exams/business",
    "db/exams/engineering.json": "exams/engineering",
    "db/showup/computing.json": "showup/computing",
    "db/seating/plan.json": "seating/plan",
    "db/faculty/data.json": "faculty/data",
}

DOCUMENTS_COLLECTION = "documents"

_client = None
_warned = False


def _normalize(path: str) -> str:
    """Accepts either OS separators or repo-relative POSIX paths."""
    return path.replace("\\", "/").lstrip("./")


def enabled() -> bool:
    return bool(os.environ.get("MONGODB_URI", "").strip())


def _db():
    """Returns the database handle, or None if Mongo is unavailable.

    Never raises: these jobs must keep producing their JSON output even when the
    database is unreachable, because that output is what the site actually
    serves.
    """
    global _client, _warned
    if not enabled():
        return None
    if _client is None:
        try:
            from pymongo import MongoClient  # imported lazily so the dependency
        except ImportError:                  # stays optional for the audit tools
            if not _warned:
                print("pymongo is not installed - writing files only", file=sys.stderr)
                _warned = True
            return None
        try:
            _client = MongoClient(
                os.environ["MONGODB_URI"],
                # Match the Node client: fail fast so a job never hangs on a
                # sick cluster, it just falls back to file-only.
                serverSelectionTimeoutMS=5000,
                connectTimeoutMS=5000,
            )
        except Exception as exc:  # noqa: BLE001 - any failure means file-only
            if not _warned:
                print(f"Mongo connection failed ({exc}) - writing files only", file=sys.stderr)
                _warned = True
            return None
    return _client[os.environ.get("MONGODB_DB", "compiler2")]


def save_document(repo_path: str, document: Any) -> bool:
    """Upserts one generated document. Returns True if Mongo was written.

    `document` is stored verbatim under `data`, so every consumer keeps parsing
    the exact shape it parses today.
    """
    key = _normalize(repo_path)
    doc_id = DOCUMENT_IDS.get(key)
    if doc_id is None:
        return False
    db = _db()
    if db is None:
        return False
    try:
        db[DOCUMENTS_COLLECTION].update_one(
            {"_id": doc_id},
            {"$set": {
                "kind": doc_id.split("/")[0],
                "file": key,
                "data": document,
                "updatedAt": datetime.now(timezone.utc),
            }},
            upsert=True,
        )
        return True
    except Exception as exc:  # noqa: BLE001
        # A failed Mongo write must not fail the sync job: the file was still
        # written and committed, so the site is correct either way.
        print(f"Mongo write for {key} failed ({exc}) - the JSON file is still authoritative",
              file=sys.stderr)
        return False


def load_document(repo_path: str) -> Any | None:
    """Reads one generated document from Mongo, or None if unavailable."""
    key = _normalize(repo_path)
    doc_id = DOCUMENT_IDS.get(key)
    if doc_id is None:
        return None
    db = _db()
    if db is None:
        return None
    try:
        row = db[DOCUMENTS_COLLECTION].find_one({"_id": doc_id}, {"data": 1})
        return row.get("data") if row else None
    except Exception as exc:  # noqa: BLE001
        print(f"Mongo read for {key} failed ({exc})", file=sys.stderr)
        return None


def close() -> None:
    """For short-lived jobs that want a clean exit."""
    global _client
    if _client is not None:
        try:
            _client.close()
        finally:
            _client = None
