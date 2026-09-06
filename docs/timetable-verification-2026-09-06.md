Verified against live Google Sheets on September 6, 2026. Generated files are
local verification output; this run did not publish to MongoDB or send pushes.

Upstream main was fast-forwarded from `9269fc9` to `8453264`, then the existing
mobile friends work was reapplied cleanly. A backup remains in the Git stash.

Changes verified:

- Notification exit 10 meant no pending deliveries. Successful no-op runs now
  exit 0, while logs retain their outcome and actual failures remain nonzero.
- Computing uses the dated September 5 Saturday schedule for its matching
  week. Dated overrides no longer supersede the normal tab in later weeks.
  Colour mapping and audit fetching use the same active-tab selection.
- Computing recognises PCS as PhD and auditorium annotations as venues.
- Business accepts inline times without parentheses and with surplus closing
  parentheses. Psychology on Tuesday is 08:30–10:20; Ideology on Friday is
  10:00–11:50, matching the sheet.
- The generation workflow rejects missing Mongo credentials; missing Google
  credentials or a completely unreadable colour legend now fail visibly.

Generated output and audit evidence:

| School | Entries | Saturday | Verification |
|---|---:|---:|---|
| Computing | 1,591 | 290 | No source-coordinate, course, time, department or section mismatches in the independent audit |
| Business | 661 | 0 | All 661 course/day/room/time combinations traced to source cells |
| Engineering | 219 | 0 | Every generated entry traces to a source cell; no time or department mismatches |

Business and engineering source sheets currently contain Monday–Friday
schedules only. The computing Saturday count includes sectionless expansion.
The duplicate Wednesday PPIT auditorium source cell collapses to one sitting.

Limits and source issues: computing has four unassigned classes and 206
entries whose cohort colour the independent audit cannot verify. Engineering
has three Internet of Things entries absent from its allocation tab, two
section disagreements (Database Systems Lab B and Applied Machine Learning
Lab C), and allocation entries with no scheduled sitting. The business audit
does not independently prove cohort routing or completeness of section
expansion. These results do not certify the source sheets as error-free.

Validation passed: 13 Python regression tests; five notification safeguard
tests; class-push integration with duplicate suppression; notification exit
codes 0/20/21/23; Mongo timetable API contract; mobile friends browser flows;
and application boot at 390px and 1440px with fixture-backed data.

Reproduce local source audits after generating local timetable JSON:

```powershell
python python/tools/timetable_audit/fetch_cache.py .cache/timetable-audit
python python/tools/timetable_audit/audit_computing.py .cache/timetable-audit . --local
python python/tools/timetable_audit/audit_engineering.py .cache/timetable-audit . --local
python python/tools/timetable_audit/audit_business.py .cache/timetable-audit .
python -m unittest discover -s python/generate_timetable -t .
```

The local app smoke test used timetable fixtures because live MongoDB access
was not exercised. GitHub Actions and production delivery need verification
after these code changes are published.
