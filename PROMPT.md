Audit this repo's generated timetables against the Google Sheets they came from. The
audit is already written — don't rewrite it, run it.

## Run

From the repo root:

```
python python/tools/timetable_audit/fetch_cache.py       ./sheets
python python/tools/timetable_audit/audit_computing.py   ./sheets  .
python python/tools/timetable_audit/audit_engineering.py ./sheets  .
```

`fetch_cache.py` reads sheet IDs and tab names from
`python/generate_timetable/config.py` and needs `service-account.json` in the repo
root. It caches the text and colour grids of every computing day tab, the engineering
schedule tab and the Course Allocation tab into `./sheets`, so the two audit scripts
run offline and can be re-run freely.

If the FSE tabs were renamed in the new sheet, update `SCHED` and `ALLOC` at the top of
`audit_engineering.py` to match the filenames that actually landed in `./sheets`.

## What it checks

The audit is a second, independent parser — it does not import
`python/generate_timetable/schools/`, and it derives each tab's block geometry from that
tab's own header row instead of trusting the hardcoded columns in `config.py`. It checks
both directions:

- every JSON entry traces to a real sheet cell at its exact day, room and time
- every schedulable sheet cell reaches the JSON
- dept and section match the code written inside the cell text
- batch matches the legend swatch that owns the cell's fill colour
- the stored time honours any time the cell states inline
- (engineering) every course exists on the Course Allocation tab, and the dept, batch
  and section it's filed under match what the school allocated

## Output

Each script prints counts per check and writes every finding — entry, offending cell,
sheet row and column — to `./sheets/audit_computing.json` and
`./sheets/audit_engineering.json`.

Read both dumps and summarise by severity: classes missing from the JSON, entries at the
wrong time, entries in the wrong dept/batch/section, and anything filed under a bucket
that isn't a real cohort.

## Baseline

These were the findings the last time this ran (Aug 2026, previous sheet data). For each
one, say whether it is fixed, still present, or changed.

**computing** — 984 entries, 0 invented

- The `BS Repeat Courses` legend fill is `#FFFF00`, but `is_yellow()` in
  `colour_mapper.py` matches `#FCFE58` ±5. It never fires, so the `REPEAT` bucket
  doesn't exist and 84 repeat cells sit in normal batch schedules.
- Friday's tab uses different columns from every other day: day slots at 1, 6, 11, 16,
  **19, 24**; evening room column **28**, not 30; labs have only two slots, at **1, 19**.
  14 classes get wrong times — the Friday labs by three hours — and 4 evening entries
  leak into the afternoon band with the daytime room attached.
- The evening room column is blank on every day but Wednesday, so 62 evening classes are
  skipped outright. Mostly the MS programme.
- 49 sectionless cells are dropped: `Project (AI/DS)` ×18, `Project (CY)` ×8, plus PPIT,
  HCI, Stat Modeling, Process Mining, SMD (CS) and the rest of the 2022/23 electives.
- 126 entries ignore the end time the cell states inline
  (`Ideology of Pak (CS-A) 01:00-02:45` stored as `01:00-02:20`).
- 4 classes lost where two share one slot band — the parser takes the first and breaks.
- 16 classes lost for having no dept code in the cell, including four `AP (A, 25)` /
  `AP (B, 25)`.
- Bogus buckets: `BS PHD / 2023`, and `BS SE / MS` holding the CI and AIHS MS
  programmes, which have no department key of their own.

**engineering** — 192 entries, placement exact (0 wrong rooms, 0 wrong times, 0 ignored
overrides)

- `Comp. Variables & Trans.` ×6 filed as 2024; MT2003 is 2025 for both EE and CE. The
  parser gave up on an ambiguous dept even though both candidates agreed on the batch.
- `Fund. Database Systems` ×3 filed as 2024; CS3020/CL3020 is EE 2023.
- `Prog Fundamentals & Eng.` filed as 2025; it belongs to the `2025 (Repeat)` block.
- `Research Methodology MS-A` produced the department `BS MS` at batch 2024; it's EE5011
  under `MS EE`.
- 8 classes dropped: three `EE-E` cells (`FSE_VALID_SECTIONS` is `"ABCD"`, but the
  allocation lists sections A–E for the EE 2026 labs), three multi-section cells
  (`CE-A, CE-B`), and two defeated by a trailing `(Batch 2025)`.
- 12 allocation rows never appeared in the schedule, 6 of them explained by the drops
  and abbreviations above.
