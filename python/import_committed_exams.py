"""Import the single exam schedule workbook in the repository root."""
import argparse
import hashlib
import json
import os
import subprocess
import sys

import schedule_sync as sync


def git(*args):
    return subprocess.check_output(["git", *args], cwd=sync.ROOT)


def exam_workbook(after):
    names = git("ls-tree", "--name-only", "-z", after).decode("utf-8").split("\0")
    files = [name for name in names if name.lower().endswith(".xlsx")
             and not name.startswith("~$") and "seating" not in name.lower()]
    if len(files) != 1:
        raise ValueError(f"Expected one exam schedule XLSX in the repository root; found {len(files)}")
    return files[0]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--after", default=os.environ.get("PUSH_AFTER", "HEAD"))
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    after = git("rev-parse", "--verify", args.after + "^{commit}").decode().strip()
    name = exam_workbook(after)
    payload = git("show", f"{after}:{name}")
    docs = sync.parse_attachment(payload, name, "exams")
    sources = [{"filename": name, "sha256": hashlib.sha256(payload).hexdigest()}]
    print(json.dumps({"file": name, "counts": {key: doc["count"] for key, doc in docs.items()}}, indent=2))
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
