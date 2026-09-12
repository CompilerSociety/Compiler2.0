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

## Gmail is the workflow source

**Sync exam schedule from Gmail** runs on every push to `main` and manual
**Run workflow**, with no inputs. It always reads `compilersociety@gmail.com`
using repository secret `GMAIL_PASS`, then publishes using `MONGODB_URI`
(optional variable `MONGODB_DB`, default `compiler2`). No repository workbook
or seating-plan file is read by this workflow. A commit is only a trigger.

The exam-only command searches the inbox regardless of read state or age,
newest UID first, skips seating/show-up emails and attachments, and imports
the latest matching exam XLSX. All school documents are validated and committed
together. A failed latest exam import stops the run instead of falling back to
an older schedule. Successful receipts make repeat runs a no-op.

```powershell
python python/schedule_sync.py --gmail --kind exams --write
```

Local file commands above are diagnostic/manual utilities, not the workflow
source. The separate existing multi-purpose Gmail sync continues its original
seating/show-up duties.

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
