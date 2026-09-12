# Exam and seating imports

The shared importer is `python/schedule_sync.py`. The scheduled Gmail job and
authenticated `/api/fetch-timetable` endpoint both use it. File imports default
to a dry run. Importing does not send push notifications.

## Current workbook

The root workbook `1st Sessional  Exams Schedule Fall 2026 (Draft 2) as on 11-09-2026.xlsx`
contains 109 Computing, 98 Management and 45 Engineering exam entries, on
September 19, 21, 22 and 23, 2026. Computing and Management have eight slots;
Engineering has six. Source cells and their original text are retained for review.
Some entries omit batches or undergraduate scopes, including postgraduate
papers. They are preserved and reported, without inventing student assignments.

```powershell
python -m pip install -r requirements.txt
python python/schedule_sync.py "1st Sessional  Exams Schedule Fall 2026 (Draft 2) as on 11-09-2026.xlsx" --output .cache/exam-import-preview.json
python python/schedule_sync.py "1st Sessional  Exams Schedule Fall 2026 (Draft 2) as on 11-09-2026.xlsx" --write --source-time "2026-09-11T00:00:00+05:00" --env-file .env.local
```

The ignored environment file needs `MONGODB_URI` and optionally `MONGODB_DB`
(default `compiler2`). File writes require the source revision timestamp with
a timezone; use the issue time, not the time you happen to run the command.
Successful file writes verify the stored content by reading it back.

## Import automatically on push

Commit and push the exam `.xlsx` in the repository root (including the current
September workbook), or under `exam-schedules/`, to `main`. **Import exam data
file** automatically validates and publishes added or modified workbooks using
the repository secret `MONGODB_URI`. No local database credentials or manual
workflow inputs are needed. `MONGODB_DB` is an optional repository variable.
GitHub Actions runs on the push; a local commit alone cannot start it.

The importer examines the entire push range, handles filenames with spaces,
ignores deleted files and Excel lock files, and reads bytes from the pushed
commit. The commit timestamp identifies the revision. All changed workbooks
are validated before a single transaction publishes the documents, followed
by read-back verification. Commit one current revision per school: ambiguous
workbooks targeting the same school fail instead of guessing which is latest.
The workflow and importer must be included in your push along with the workbook.

The manual **Import exam data file** GitHub workflow accepts a committed file
path, kind, source timestamp and write flag. It defaults to validation only and
uses the repository MongoDB secret for writes. Local uncommitted files must be
imported locally or committed before using that workflow.

## What was failing

- The old Gmail reader chose one newest unread message across every route.
  Older unread mail could replace a newer revision; a busy route could hide
  updates to other routes. Fetching RFC822 and explicitly marking Seen happened
  before parsing or MongoDB writes, so read status did not represent success.
- The generic `schedule` subject route preceded `showup`, and did not recognize
  spaced `show up`. Unrelated schedule emails with no XLSX could repeatedly win.
- The parser understood `BS(...)` but discarded BBA, BAF, BEE and BCE scopes.
  A course code on its own line produced an empty course title.
- Read-only openpyxl worksheets do not expose the merged ranges used by the
  room-grid parser. Its three hardcoded slots also lost later slots. Multiple
  sheets for one school replaced each other in memory.
- Apps Script targeted `Riftwalker23x/Compiler2.0`; the current remote is
  `CompilerSociety/Compiler2.0`. Updating the source file does not update the
  deployed Apps Script: copy the corrected script into that project.
- Exam notifications ran after failed syncs too. They now require a successful
  sync completion (manual notification runs remain available).

These are code-level findings. Live Actions history and mailbox access were not
available during the audit, so they are not claims about specific production runs.

## Storage and delivery

`documents` retains the frontend contract: `_id` values `exams/computing`,
`exams/business`, `exams/engineering`, and `seating/plan`, with payloads under
`data`. The API `api/db.mjs` serves these through the existing `/db/...` rewrites.
The browser filters exam `sections` and `batch`; missing scopes therefore matter
even when the stored count looks correct. Existing edge caching allows a cached
exam response for 300 seconds and stale revalidation for up to 3600 seconds
(seating: 120 and 3600).

All documents from one input and their import receipt commit in one MongoDB
transaction with majority write concern. Previous versions are saved in
`schedule_revisions` before replacement. This requires Atlas or another replica
set; standalone MongoDB is unsupported. No source-of-truth JSON fallback is used.
An identical import does not change timestamps. Older source revisions and
entirely older exam periods are skipped. Missing schools are left intact.

Gmail scans the last 30 days by UID, regardless of read status. `--days N`
expands the recovery window. Receipts in `schedule_imports` include mailbox,
UIDVALIDITY and UID, and are written only with committed data. Fetch uses
BODY.PEEK; Seen is set after commit. Failed messages retry next run and do not
prevent independent messages from being attempted. The job fails if any import
fails. A changed UIDVALIDITY safely replays through content deduplication.

```powershell
python python/schedule_sync.py --gmail --write
python python/schedule_sync.py "seating-plan.pdf" --kind seating
python -m unittest discover -s python -p test_schedule_sync.py
python -m unittest discover -s python -p test_seating_rooms.py
```

Seating PDF imports require complete room/date/time coverage. Unknown or scanned
PDF layouts fail before publication instead of replacing live data with partial
results; OCR is not implemented. Multiple attachments for different documents
are supported; competing attachments for the same document fail explicitly and
require selecting the intended file for a manual import. Historical root PDFs
are test fixtures and should not be uploaded over the current seating plan.

Review a previous version by querying `schedule_revisions.document_id`; its
`snapshot` contains the previous MongoDB document. Reimport a corrected source
with its actual new revision timestamp. Neither revision history nor receipts
are pruned automatically; include these collections in operational backups.
