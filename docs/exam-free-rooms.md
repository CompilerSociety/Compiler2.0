# Exam free rooms

`isExamSeason` in `web/js/app.js` chooses the room occupancy source. It is
recomputed on every room render/query and data refresh using Asia/Karachi dates.
Each school's published exam schedule defines its first-to-last exam date;
an explicitly dated seating plan also activates exam mode on that date.
The switch resets after those dates. Weekday browsing means the next occurrence
of that weekday, with its actual calendar date, rather than repeating an old PDF.

Normal mode uses the existing school timetables. Exam mode exclusively uses
`room_occupancy` in `/db/seating/plan.json`, with exact exam intervals and gaps.
An exam ending at noon stops occupying the room at noon. A class booking cannot
keep a room marked busy during exam mode. Refreshes fetch all three schools'
exam schedules and the seating plan independently of the selected school.

Missing, failed, stale or incomplete data produces a pending message instead
of free-room claims. During exams the plan must cover the selected date and
every school with exams that day; unknown room names also prevent free claims.
A computing-only plan cannot establish campus-wide availability when other
schools also have exams. The source must contain their seating allocations too.
Availability describes published bookings, not physical access or room closures.

## PDF parser and command

`python/seating_rooms.py` reads explicit room/date/time headers, not seat codes
or inferred student counts. Gmail sync attaches its output to the same seating
document automatically. Attendance-list student records retain their room,
date, seat and exam time; existing two-column student parsing remains available.

Run from the repository root:

```powershell
python python/seating_rooms.py "Seating Plan of Final Exam for Monday (December 15, 2025) - Fall-2025.pdf" --date 2025-12-15 --time 10:00
```

This returns free and occupied rooms from the app's room inventory **according
to that supplied plan**, with its school scope. Add `--rooms C-301 C-306` to
query specific rooms. Without date/time arguments it outputs the occupancy
document; `--output filename.json` writes either result to a file. It does not
publish the historical example plans or change live data.

The examples contain:

| PDF | Attendance pages | Unique room/time bookings | Exam intervals |
| --- | ---: | ---: | --- |
| Monday, 15 December 2025 | 107 | 69 | 09:00–12:00, 13:00–16:00, 17:20–20:20 |
| Tuesday, 16 December 2025 | 35 | 26 | 09:00–12:00, 13:00–16:00 |

Repeated sections in the same room/interval collapse into one booking.
Tuesday's final Wednesday cover page does not establish Wednesday coverage.
Unreadable attendance pages invalidate completeness. Neither example allocates
an exam to C-306, so it remains free according to these plans.

## Validation

```powershell
python -m unittest discover -s python -p test_seating_rooms.py
node scripts/test/exam-rooms.cjs
node scripts/test/exam-rooms-browser.cjs
node scripts/test/mobile-friends-browser.cjs
```

Browser tests use Playwright and installed Microsoft Edge. Set
`PLAYWRIGHT_MODULE` to an installed Playwright package if it is not in
`node_modules`. All browser data is mocked; no external writes occur.
