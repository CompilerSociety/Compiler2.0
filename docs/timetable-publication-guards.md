Timetable generation now stops before publication when a required source tab
is missing, a download fails, a grid is empty, a computing weekday produces
zero classes, or an entire school produces no classes. All three schools are
parsed and checked before the first database or local output write.

Dated computing tabs apply only to their matching week in Pakistan time.
Supported dates include `Saturday (Sep. 05, 2026)`,
`Saturday (5 September 2026)` and `Saturday (2026-09-05)`. Expired and future
tabs do not replace the regular weekday tab. Invalid dates, weekday/date
disagreements, and multiple possible active schedules fail with the tab names
in the error rather than choosing whichever tab comes first.

Regression tests run on pull requests, pushes to main, and before every
scheduled generation. Tests cover renamed tabs, override replacement, multiple
dates, expired schedules, year boundaries, Pakistan midnight, download failures,
empty parses, publication ordering, and actual Saturday time/status parsing.

To run the checks locally:

```powershell
python -m unittest discover -s python/generate_timetable -t .
```

Operational limits:

- A deliberately empty computing weekday also stops publication and requires
  review. Do not remove this check merely to make a failed run green; confirm
  whether the source represents a closure or a parser problem. Existing
  cancelled-class entries remain supported.
- A failed source check leaves the previous published data in place; it does
  not make that old data current. Review failed generator runs promptly.
- Validation precedes writes, but the three database writes are not one
  transaction. A database failure during publication can still leave mixed
  versions. This change addresses source/parser failures, not database atomicity.
- These checks cannot detect every incorrect source cell or plausible-looking
  parser error. Independent source audits remain useful after layout changes.
- The CI workflow must be published to take effect. Making its status a required
  branch protection check is a separate repository setting.
