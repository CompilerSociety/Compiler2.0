"""Import added/changed exam XLSX files from the complete GitHub push range."""
import argparse
import hashlib
import json
import os
from pathlib import PurePosixPath
import subprocess
import sys

import schedule_sync as sync


def git(*args):
    return subprocess.check_output(["git", *args], cwd=sync.ROOT)


def changed_workbooks(before, after):
    # A new branch has no before commit. Read its tree instead of inventing a diff.
    if before and set(before) != {"0"}:
        names = git("diff", "--name-only", "--no-renames", "--diff-filter=AM", "-z", before, after, "--")
    else:
        names = git("ls-tree", "-r", "--name-only", "-z", after)
    return sorted(name for name in names.decode("utf-8").split("\0") if name and
                  name.endswith(".xlsx") and not PurePosixPath(name).name.startswith("~$") and
                  (len(PurePosixPath(name).parts) == 1 or name.startswith("exam-schedules/")))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--before", default=os.environ.get("PUSH_BEFORE"))
    ap.add_argument("--after", default=os.environ.get("PUSH_AFTER", "HEAD"))
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    after = git("rev-parse", "--verify", args.after + "^{commit}").decode().strip()
    files = changed_workbooks(args.before, after)
    if not files:
        print("No added or modified exam workbooks in this push.")
        return
    docs, sources = {}, []
    # Parse every changed file before any write, preserving atomic publication.
    for name in files:
        payload = git("show", f"{after}:{name}")
        parsed = sync.parse_attachment(payload, name, "exams")
        overlap = docs.keys() & parsed.keys()
        if overlap:
            raise ValueError(f"Multiple changed workbooks target {sorted(overlap)}. Commit one current revision per school.")
        docs.update(parsed)
        sources.append({"filename": name, "sha256": hashlib.sha256(payload).hexdigest()})
    print(json.dumps({"files": files, "counts": {key: doc["count"] for key, doc in docs.items()}}, indent=2))
    if not args.write:
        print("Dry run: no database writes.")
        return
    from datetime import datetime, timezone
    received = datetime.fromisoformat(git("show", "-s", "--format=%cI", after).decode().strip())
    source = {"received_at": received.astimezone(timezone.utc).isoformat(),
              "commit": after, "files": sources}
    db = sync.connect()
    try:
        results = sync.publish(db, docs, source, receipt=f"git:{after}")
        for key, status in results.items():
            if status in ("written", "unchanged"):
                saved = db.documents.find_one({"_id": key})
                if not saved or sync.content_hash(saved["data"]) != sync.content_hash(docs[key]):
                    raise RuntimeError(f"MongoDB read-back verification failed for {key}")
        print(json.dumps(results, indent=2))
    finally:
        db.client.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Import failed ({type(exc).__name__}). " +
              (str(exc) if isinstance(exc, (ValueError, RuntimeError)) else "Check workflow configuration and connectivity."),
              file=sys.stderr)
        sys.exit(1)
