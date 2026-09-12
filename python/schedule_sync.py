"""Validated, replayable schedule imports shared by CLI, HTTP and Gmail jobs."""
from __future__ import annotations

import argparse
import email
import hashlib
import importlib.util
import json
import os
import re
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("schedule_parser", ROOT / "api/fetch-timetable.py")
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)


def route(subject, filename):
    text = (subject + " " + filename).lower()
    if re.search(r"show[\s_-]*up", text):
        return "showup"
    if "seating" in text and filename.lower().endswith(".pdf"):
        return "seating"
    if re.search(r"exam|sessional|midterm|final", text) and filename.lower().endswith(".xlsx"):
        return "exams"
    return None


def parse_attachment(payload, filename, kind, subject=""):
    if kind == "seating":
        document = parser.parse_seating_plan_email("", subject or filename, payload)
        occupancy = document.get("room_occupancy", {})
        if not occupancy.get("complete"):
            raise ValueError(f"Incomplete seating PDF: {occupancy.get('errors', [])}")
        docs = {"seating/plan": document}
    else:
        fn = parser.parse_exam_schedule_workbook if kind == "exams" else parser.parse_showup_schedule_workbook
        docs = {f"{kind}/{school}": doc for school, doc in fn(payload, subject or filename, filename).items()}
    validate(docs)
    return docs


def validate(docs):
    if not docs:
        raise ValueError("No documents parsed")
    for key, doc in docs.items():
        rows = doc.get("students", []) if key.startswith("seating/") else doc.get("exams", []) + doc.get("flat_exams", [])
        if not rows or doc.get("count") != len(rows):
            raise ValueError(f"{key}: empty document or incorrect count")
        for index, row in enumerate(rows):
            date = row.get("date") or doc.get("exam_date")
            try:
                datetime.strptime(date or "", "%Y-%m-%d")
            except ValueError:
                raise ValueError(f"{key}: row {index + 1} has no valid date") from None
            required = ("nuid", "seat", "time") if key.startswith("seating/") else ("course", "time")
            if any(not row.get(field) for field in required):
                raise ValueError(f"{key}: row {index + 1} missing required fields")


def content_hash(doc):
    stable = {k: v for k, v in doc.items() if k not in ("updated_at", "source_subject", "source_filename")}
    return hashlib.sha256(json.dumps(stable, sort_keys=True).encode()).hexdigest()


def publish(db, docs, source, receipt=None):
    """All schools, previous revisions and receipt commit in one transaction.

    Mongo transactions retry write conflicts; an older delivery cannot roll back
    a newer import. Content-identical deliveries never churn updated_at.
    """
    validate(docs)
    from pymongo import ReadPreference
    from pymongo.read_concern import ReadConcern
    from pymongo.write_concern import WriteConcern

    def commit(session):
        results = {}
        for key, doc in docs.items():
            old = db.documents.find_one({"_id": key}, session=session)
            digest = content_hash(doc)
            if old and content_hash(old["data"]) == digest:
                results[key] = "unchanged"
                continue
            if old:
                old_dates = dates_for(old["data"])
                new_dates = dates_for(doc)
                if old_dates and new_dates and max(new_dates) < min(old_dates):
                    results[key] = "skipped older exam period"
                    continue
                prior = old.get("source", {}).get("received_at", "")
                if prior and source["received_at"] <= prior:
                    results[key] = "skipped older revision"
                    continue
                revision = hashlib.sha256((key + content_hash(old["data"])).encode()).hexdigest()
                db.schedule_revisions.update_one({"_id": revision}, {"$setOnInsert": {
                    "document_id": key, "snapshot": old, "archived_at": datetime.now(timezone.utc)
                }}, upsert=True, session=session)
            db.documents.replace_one({"_id": key}, {
                "_id": key, "kind": key.split("/")[0], "file": f"db/{key}.json",
                "data": doc, "source": source, "content_hash": digest,
                "updatedAt": datetime.now(timezone.utc),
            }, upsert=True, session=session)
            results[key] = "written"
        if receipt:
            db.schedule_imports.update_one({"_id": receipt}, {"$set": {
                "source": source, "results": results, "completed_at": datetime.now(timezone.utc)
            }}, upsert=True, session=session)
        return results

    with db.client.start_session() as session:
        return session.with_transaction(commit, read_concern=ReadConcern("snapshot"),
                                        write_concern=WriteConcern("majority"),
                                        read_preference=ReadPreference.PRIMARY)


def dates_for(doc):
    rows = doc.get("exams", []) + doc.get("flat_exams", []) + doc.get("students", [])
    return sorted({r["date"] for r in rows if r.get("date")} | ({doc["exam_date"]} if doc.get("exam_date") else set()))


def connect():
    from pymongo import MongoClient
    uri = os.environ.get("MONGODB_URI", "").strip()
    if not uri:
        raise RuntimeError("MONGODB_URI is required for writes")
    client = MongoClient(uri, serverSelectionTimeoutMS=15000, connectTimeoutMS=15000)
    client.admin.command("ping")
    return client[os.environ.get("MONGODB_DB", "compiler2")]


def sync_gmail(days=30, exams_only=False):
    """Scan recent matching UIDs regardless of read state; checkpoint only on commit."""
    import imaplib
    import ssl
    db = connect()
    mail = imaplib.IMAP4_SSL(parser.GMAIL_IMAP_HOST, ssl_context=ssl.create_default_context())
    failures = 0
    try:
        mail.login(os.environ["GMAIL_USER"], os.environ["GMAIL_PASS"])
        status, _ = mail.select("INBOX")
        if status != "OK":
            raise RuntimeError("Cannot select INBOX")
        validity = mail.response("UIDVALIDITY")[1][0].decode()
        since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%d-%b-%Y")
        criteria = (parser._build_subject_or_criteria(["schedule", "exam", "sessional"]),) if exams_only else (
            "SINCE", since, parser._build_subject_or_criteria(["seating", "schedule", "showup", "show up"]))
        status, data = mail.uid("search", None, *criteria)
        if status != "OK":
            raise RuntimeError("IMAP search failed")
        uids = data[0].split()
        if exams_only:
            uids = sorted(uids, key=int, reverse=True)
        for uid in uids:
            receipt = f"{os.environ['GMAIL_USER']}:INBOX:{validity}:{uid.decode()}"
            if exams_only:
                receipt += ":exams-v1"
            if db.schedule_imports.find_one({"_id": receipt}):
                if exams_only:
                    print("Latest exam schedule already imported from Gmail.")
                    return
                continue
            try:
                status, parts = mail.uid("fetch", uid, "(BODY.PEEK[] INTERNALDATE)")
                if status != "OK":
                    raise RuntimeError("IMAP fetch failed")
                header, raw = next(p for p in parts if isinstance(p, tuple))
                stamp = re.search(rb'INTERNALDATE "([^"]+)"', header).group(1).decode()
                received = datetime.strptime(stamp, "%d-%b-%Y %H:%M:%S %z").astimezone(timezone.utc).isoformat()
                msg = email.message_from_bytes(raw)
                subject = parser.decode_mime_header(msg.get("Subject", ""))
                if exams_only and re.search(r"seating|show[\s_-]*up", subject, re.I):
                    continue
                if re.search(r"show[\s_-]*up", subject, re.I):
                    parser.maybe_bootstrap_showup_sheet_source("showup_schedule", subject, parser.extract_plain_text(msg))
                docs, hashes = {}, []
                for part in msg.walk():
                    name = parser.decode_mime_header(part.get_filename() or "")
                    kind = route(subject, name)
                    if exams_only and (kind != "exams" or re.search(r"seating|show[\s_-]*up", name, re.I)):
                        continue
                    if not kind:
                        continue
                    payload = part.get_payload(decode=True)
                    if not payload:
                        raise ValueError("Empty attachment")
                    parsed = parse_attachment(payload, name, kind, subject)
                    if docs.keys() & parsed.keys():
                        raise ValueError("Multiple attachments target the same document; import them explicitly")
                    docs.update(parsed)
                    hashes.append(hashlib.sha256(payload).hexdigest())
                if not docs:
                    if re.search(r"seating|(?=.*(?:exam|sessional|midterm|final))(?=.*schedule)", subject, re.I) and not re.search(r"show[\s_-]*up", subject, re.I):
                        raise ValueError("Expected a supported schedule/seating attachment but found none")
                    continue
                result = publish(db, docs, {"received_at": received, "message_uid": uid.decode(),
                                           "attachment_hashes": hashes}, receipt)
                mail.uid("store", uid, "+FLAGS", "(\\Seen)")
                print(json.dumps({"uid": uid.decode(), "results": result}))
                if exams_only:
                    return
            except Exception as exc:
                if exams_only:
                    raise RuntimeError(f"Gmail exam schedule UID {uid.decode()} failed ({type(exc).__name__}); existing data retained, retry after fixing the failure") from None
                failures += 1
                print(f"UID {uid.decode()} failed: {type(exc).__name__}", file=sys.stderr)
        if failures:
            raise RuntimeError(f"{failures} message(s) failed; uncommitted messages will retry")
        if exams_only:
            raise RuntimeError("No exam schedule XLSX found in the CompilerSociety Gmail inbox")
    finally:
        try:
            mail.logout()
        finally:
            db.client.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("file", nargs="?", type=Path)
    ap.add_argument("--kind", choices=["exams", "seating", "showup"])
    ap.add_argument("--write", action="store_true", help="Commit to MongoDB; default is dry run")
    ap.add_argument("--source-time", help="Source revision timestamp with timezone (required for file writes)")
    ap.add_argument("--env-file", type=Path)
    ap.add_argument("--output", type=Path, help="Write parsed preview locally")
    ap.add_argument("--gmail", action="store_true")
    ap.add_argument("--days", type=int, default=30)
    args = ap.parse_args()
    if args.env_file:
        for line in args.env_file.read_text(encoding="utf-8-sig").splitlines():
            if line.strip() and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                os.environ[key.strip()] = value.strip().strip('\"\'')
    if args.gmail:
        if not args.write:
            ap.error("--gmail requires --write")
        if args.days < 1:
            ap.error("--days must be positive")
        sync_gmail(args.days, exams_only=args.kind == "exams")
        return
    if not args.file:
        ap.error("provide a file or --gmail --write")
    kind = args.kind or route("", args.file.name)
    if not kind:
        ap.error("cannot infer kind; specify --kind")
    payload = args.file.read_bytes()
    docs = parse_attachment(payload, args.file.name, kind)
    print(json.dumps({key: {"count": doc["count"], "dates": dates_for(doc)} for key, doc in docs.items()}, indent=2))
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(docs, indent=2), encoding="utf-8")
    for key, doc in docs.items():
        unscoped = sum(not row.get("sections") or not row.get("batch") for row in doc.get("exams", []))
        if unscoped:
            print(f"{key}: {unscoped} entries lack department/batch scope in the source; retained without guessing.")
    if args.write:
        if not args.source_time:
            ap.error("--write requires --source-time to prevent stale revision imports")
        stamp = datetime.fromisoformat(args.source_time)
        if stamp.tzinfo is None:
            ap.error("--source-time must include a timezone")
        db = connect()
        try:
            result = publish(db, docs, {"received_at": stamp.astimezone(timezone.utc).isoformat(),
                                       "filename": args.file.name, "sha256": hashlib.sha256(payload).hexdigest()})
            for key, status in result.items():
                if status in ("written", "unchanged"):
                    saved = db.documents.find_one({"_id": key})
                    if content_hash(saved["data"]) != content_hash(docs[key]):
                        raise RuntimeError(f"Read-back verification failed for {key}")
            print(json.dumps(result, indent=2))
        finally:
            db.client.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Database exceptions can contain credentials or hostnames. Do not dump them.
        print(f"Import failed ({type(exc).__name__}). " + (str(exc) if isinstance(exc, (ValueError, RuntimeError)) else "Check configuration and connectivity."), file=sys.stderr)
        sys.exit(1)
