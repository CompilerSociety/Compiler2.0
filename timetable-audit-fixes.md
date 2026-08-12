# Timetable Audit Fixes — August 2026

A second pass over the timetable pipeline, driven this time by
`python/tools/timetable_audit/` — a pair of scripts that re-read the source
spreadsheets independently and check the generated JSON against them in both
directions. The audit found 19 computing classes missing, 17 stored at the
wrong time, 78 repeat courses filed as normal cohort classes, and eight
engineering classes dropped outright. All of it is now closed.

Companion to [`timetable-data-fixes.md`](timetable-data-fixes.md), which
covers the earlier pass. Two items left open there — #8 (MS evening classes)
and #9 (sectionless BS cells) — are resolved here.

Status at a glance:

| # | Problem | Status |
|---|---|---|
| 1 | Repeat-course yellow hardcoded to the wrong colour | Fixed |
| 2 | Friday's block geometry read through another day's columns | Fixed |
| 3 | Second class in a shared slot band dropped | Fixed |
| 4 | Cells with no department code dropped | Fixed |
| 5 | MS programmes CI / AIHS filed under `BS SE` | Fixed |
| 6 | `(MS-SE)` cells filed as sections named after programmes | Fixed |
| 7 | PhD cells became `BS PHD` at batch 2023 | Fixed |
| 8 | FSE section E not recognised | Fixed |
| 9 | FSE multi-section cells dropped | Fixed |
| 10 | FSE cells with a trailing `(Batch 2025)` dropped | Fixed |
| 11 | FSE abbreviations missed → four courses misfiled | Fixed |
| 12 | FSE ambiguous department discarded an agreed batch | Fixed |
| 13 | `Research Methodology MS-A` produced department `BS MS` | Fixed |
| 14 | A time inside an FSE course cell was ignored | Fixed |
| 15 | `repeat-computing.json` served a stale semester | Fixed |
| 16 | The audit could not see what it was auditing | Fixed |
| — | Evening Room column blank on 5 of 6 computing tabs | **Open — sheet data gap** |
| — | `Comp. Variables & Trans.` section C not in the allocation | **Open — sheet disagreement** |
| — | 6 allocation rows never scheduled | **Open — sheet data gap** |

Audit result after the fixes:

```
computing    1136 entries | 0 missing, 0 mis-timed, 0 mis-filed, 0 invented
engineering   216 entries | 0 missing, 0 mis-timed, 0 mis-filed, 0 invented
                            structural resolution 200/200, 0 keyword fallbacks
```

---

## 1. Repeat-course yellow hardcoded to the wrong colour

**Symptom.** 78 repeat/retake classes sat inside normal batch schedules.
`OOP (CS-A, 25)` appeared as a BS CS 2025 class; `PDC (CS-B, 23)` as BS CS
2023. The `REPEAT` bucket the frontend renders as "Repeat Courses (Yellow)"
did not exist in the data at all.

**Cause.** `is_yellow()` in `colour_mapper.py` matched `#FCFE58` ±5. The
sheet's `BS Repeat Courses` legend paints `#FFFF00`. The predicate never
fired once, so `REPEAT_BATCH_KEY` was never written. The colour had changed
without notice and nothing detected it.

**Fix.** Read the repeat fill from the legend instead of hardcoding it.
`build_colour_map()` registers any legend swatch whose text matches
`/repeat/i` into `REPEAT_SWATCHES`, and `is_yellow()` tests against those. A
legend the sheet maintains itself cannot drift out of sync with the cells it
labels. `#FCFE58` survives as a fallback for a tab with no legend.

**Consequence worth knowing.** Every cell carrying a year suffix is painted
repeat-yellow — 29 of 29 `, 22` cells, 26 of 26 `, 25`, 12 of 12 `, 24`. The
suffix is how the sheet records *which* batch's course is being re-offered.
So the whole of what used to look like "batch 2022" was really the repeat
list, and **batch 2022 no longer appears as a cohort in computing**. That
matches the sheet's legend and the documented intent of `REPEAT_BATCH_KEY`,
and the frontend surfaces the bucket as its own department — but the year is
not preserved inside it. If a repeating student needs to know which batch a
course belongs to, that needs a schema decision.

## 2. Friday's block geometry read through another day's columns

**Symptom.** 17 Friday classes stored at the wrong time — the labs three
hours early — and four evening classes landed in the afternoon band wearing
the daytime room. `COAL Lab (CS-B, 24)` was stored 11:30–02:15 when the sheet
says 02:30–05:15; `Research Methodology (CS)` showed up in C-301 at
03:55–05:15 instead of the evening slot.

**Cause.** `CLASSROOM_LEFT` / `CLASSROOM_RIGHT` / `LAB_BLOCK` in `config.py`
hardcode the column layout. Friday does not use it:

| | Common layout | Friday |
|---|---|---|
| Day slots | 1, 6, 11, 16, **21, 26** | 1, 6, 11, 16, **19, 24** |
| Evening Room column | **30** | **28** |
| Evening slots | 31, 36 | 29, 34 |
| Lab slots | 1, 11, 21, 31 | **1, 19** |

Because the generator's daytime block runs to column 30, Friday's evening
text at column 29 fell inside the band the generator labels 03:55–05:15, and
was emitted with the daytime room attached.

**Fix.** `detect_blocks()` in `schools/computing.py` derives geometry from
each tab's own header rows: every `Room` column opens a block, the time
labels to its right — up to the next `Room` column — are its slots, each
spanning until the next label. The config constants remain as a fallback for
a tab whose headers cannot be read. Fixing this also resolved
`timetable-data-fixes.md` #8's Friday component.

## 3. Second class in a shared slot band dropped

**Symptom.** Four classes lost: `Ideology of Pak (AI-C) 12:30-02:15`,
`(CS-D)`, `(SE-C)`, and `UHQ-I&II (CS-D) 09:30-11:20`.

**Cause.** `parse_matrix_block` did `break` after the first parseable cell in
a slot band. A band spans several columns and the sheet does put two classes
in one — the second normally carrying its own inline time.

**Fix.** Keep scanning the band. Merged cells only hold text in their
top-left cell, so a second non-empty cell is genuinely a second class.

## 4. Cells with no department code dropped

**Symptom.** 14 classes lost for being written as a bare course title with no
`(DEPT-SECTION)` parenthetical: `Fund of SPM` ×2, `Fund of Data Vis` ×2,
`PPIT Seminar` ×2, `Empirical S/w Engg` ×2, `CS Elect` ×2, `Securing Cloud`
×2, `Comp Intelligence`, `Engg AI`.

**Cause.** `parse_timetable_cell` returned `None` when `CELL_RE` did not
match, and `CELL_RE` requires the parenthetical.

**Fix.** `parse_bare_course_cell()` keeps them, and `flush_bare()` places them
after the whole week is read, using the best evidence available in order:

1. **The rest of the cell's own row in the same block.** `Fund of SPM` sits
   in D-404 beside `App HCI (CS-A)` and `App HCI (CS-B)` — that row is BS CS.
2. **The same course elsewhere in the week.** Wednesday's `Fund of SPM` is
   alone in its row; Monday's is not, and pass 1 records where it went.
3. **The legend that owns the cell's fill.** This is what places the evening
   electives, whose swatch reads `MS Electives (All Prgrms)` → `MS (Electives)`.

The batch comes from the cell's own fill, not the row's — a row can mix
cohorts (D-504 holds both a 2023 and a 2024 class), and copying a cell into
both would assert something the sheet does not say. A repeat fill outranks
everything: `Comp Intelligence` is yellow, so it lands in `REPEAT` regardless
of the row it sits in. A cell that survives all three rules is dropped with a
warning naming it; none currently are.

Cells are stored under `ALL_SECTIONS`, the same key the sectionless path uses
(`timetable-data-fixes.md` #9), so the frontend merges them into whichever
section the student picks.

Non-classes are excluded by `NOT_A_CLASS_RE`, word-anchored so that `admin`
cannot reject `Administration`, plus a separate check against the text with
whitespace removed to catch the sheet's letter-spaced banners
(`P R A Y E R  B R E A K`).

## 5. MS programmes CI / AIHS filed under `BS SE`

**Symptom.** A department `BS SE` with a batch `MS` holding eight MS
Computational Intelligence and six MS AI in Health Sciences classes —
`Prog for AI (CI)`, `Found of Health Info Sys (AIHS)`, `Math for CI (CI)`.

**Cause.** `resolve_departments_for_cell` only accepted programme codes in
`COMPUTING_PROGRAM_CODES` (`AI CS CY DS SE`). `CI` and `AIHS` fell through to
the column header — which for the computing matrix is a colour legend, not a
per-column department, exactly as that function's own docstring warns.

**Fix.** In an MS context, any 2–5 letter code written in the cell is the
programme: `MS (CI)`, `MS (AIHS)`. The legend confirms both exist
(`MS Computational Intelligence`, `MS AI in Health Sciences` are their own
swatches). New MS programmes now work without a config edit.

## 6. `(MS-SE)` cells filed as sections named after programmes

**Symptom.** `BS SE / MS` had sections `A`, `CY` and `SE`.

**Cause.** `UHQ-I & II (MS-SE)` writes the degree where the department
normally goes and the programme where a section letter normally goes, so it
parsed as department `MS`, section `SE`.

**Fix.** When the department code is exactly `MS` and the "section" is two or
more letters, the programme is the department and the cell names no section.

## 7. PhD cells became `BS PHD` at batch 2023

**Symptom.** A department `BS PHD` at batch `2023` — a BS cohort that does
not exist — holding `UHQ-I & II (PHD-A)` and `(PHD-B)`.

**Cause.** `PHD` normalised to `BS PHD`, and with no year suffix and a fill
the legend does not cover, batch resolution fell through to its `"2023"`
default.

**Fix.** `PHD_CODES` / `PHD_DEPT_KEY` / `PHD_BATCH_KEY` in `config.py`; a
doctoral cell short-circuits both department and batch resolution to `PhD`,
the way the MS programmes already have their own keys. Sections `A` and `B`
are genuine and kept.

## 8. FSE section E not recognised

**Symptom.** Three classes dropped: `Physics for Engineers Lab EE-E`,
`Applications of ICT Lab EE-E`, `Engineering Drawing EE-E`.

**Cause.** `FSE_VALID_SECTIONS = set("ABCD")`.

**Fix.** `set("ABCDE")`. The Course Allocation tab lists sections A–E for the
EE 2026 labs, and `detect_courses_layout` already reads five section columns.

## 9. FSE multi-section cells dropped

**Symptom.** Three classes dropped: `Civics and Comminity Engagement CE-A,
CE-B`, `Understanding of Holy Quran I/Ethics I & II A,B`, `Ocp. Health &
Safety EE-A,B,C`.

**Cause.** `FSE_SECTION_RE` matches a single trailing section letter. It also
requires that letter at the very end of the cell, and these cells append the
instructor, the time and sometimes the venue after it.

**Fix.** `FSE_MULTI_SECTION_RE` reads a comma-separated suffix, and
`_split_multi_suffix()` expands it — a programme named once applies to the
whole list, since the sheet writes `EE-A,B,C` rather than
`EE-A, EE-B, EE-C`. `parse_engineering_grid` emits one class per section.

Trailing instructor/time/venue text is stripped by `FSE_TRAILING_NOISE_RES`,
but **only as a fallback**, after a first attempt on the untouched title. Run
up-front it is destructive: an honorific rule matching `Engr` turns
`Physics for Engr. EE-A` into `Physics for`, which silently cost eight
classes their names on the first attempt at this fix.

## 10. FSE cells with a trailing `(Batch 2025)` dropped

**Symptom.** Two classes dropped: `Applied Physics A (Batch 2025)`,
`Applied Physics Lab EE-A (Batch 2025)`.

**Cause.** Same anchoring problem — the annotation sits after the section
suffix.

**Fix.** `FSE_BATCH_ANNOTATION_RE` strips and captures it before parsing.

## 11. FSE abbreviations missed → four courses misfiled

**Symptom.** Four courses filed under the wrong batch, all landing on the
course-name keyword heuristic instead of the Course Allocation tab:

| Cell | Was | Should be |
|---|---|---|
| `Fund. Database Systems` ×3 + Lab | EE 2024 | EE 2023 (CS3020 / CL3020) |
| `Prog Fundamentals & Eng.` | EE 2026 | EE 2025 **Repeat** (CS1002) |
| `MP Inter. & Prog` ×4 | EE 2024 (right by luck) | EE 2024 (EE3002), structurally |
| `Understanding of Holy Quran I/Ethics I & II` | EE MS | EE 2025 (SS1021/SS1022) |

**Cause.** Three separate gaps in `match_abbreviated_title`:

- `title_token_match` allowed the *allocation* to carry extra words but not
  the *grid*. `Fund. Database Systems` has a word `Database Systems` lacks,
  so the walk never got past `Fund.`.
- `tokens_match` required 3+ characters, so the stub `MP` could not reach
  `Microprocessor`.
- The Holy Quran cell matches the MS block word for word, and the matcher
  stopped there — even though the cell names a section B that only the 2025
  block runs.

**Fix.**

- `title_token_match` takes a `max_unmatched` budget, computed as a longest
  in-order pairing. Used only as a second pass, and never below two matching
  tokens.
- `tokens_match` allows a two-letter stub against a word of six or more
  sharing its first letter — every other token still has to match, and the
  ambiguity guard still applies.
- The matcher takes the cell's sections. A word-for-word hit that does not
  run them is the wrong row, so it widens and prefers rows that do.
- Candidates agreeing on dept, batch and repeat status are merged rather than
  called ambiguous — SS1021 and SS1022 are two halves of one class.

Result: **200/200 engineering cells now resolve structurally against the
allocation, with zero keyword fallbacks.**

## 12. FSE ambiguous department discarded an agreed batch

**Symptom.** `Comp. Variables & Trans.` ×6 filed as 2024. MT2003 is 2025 for
both EE and CE, and the schedule cell names no programme.

**Cause.** `resolve_fse_entry` warned "ambiguous dept" and fell back to
`infer_fse_batch_fallback` — throwing away a batch both candidates agreed on
in order to guess from the course name.

**Fix.** When the candidates disagree on department but agree on batch, the
course is genuinely shared: record it for every department that offers it,
with the batch the allocation states. This also correctly splits
`Linear Algebra` into CE 2025 (normal) and EE 2025 (repeat).

## 13. `Research Methodology MS-A` produced department `BS MS`

**Symptom.** A department `BS MS` at batch 2024. EE5011 is `MS EE`.

**Cause.** The suffix `MS-A` parsed `MS` as a programme code, and the
department key was built as `f"BS {code}"` unconditionally.

**Fix.** `MS` is dropped from the programme list, and `fse_dept_key()` builds
`MS EE` when the resolved batch is `MS` — the key the MS rows already use.

## 14. A time inside an FSE course cell was ignored

**Symptom.** Four entries stored at the column's slot time while the cell
stated its own: `Civics ... 12:45 - 02:40` stored as `12:45-02:05`.

**Cause.** The parser read a time override from the instructor row below the
course cell, but not from the course cell itself.

**Fix.** `FSE_CELL_TIME_RE` picks up a time written after the section suffix;
it takes precedence the same way the instructor-row override does.

## 15. `repeat-computing.json` served a stale semester

**Symptom.** 63 hand-maintained repeat classes shown in the frontend's
"Repeat Courses (Yellow)" view. Not one matched any cell in the current
sheet — it lists `Calculus` in C-302 Monday 03:55–05:15, where the FA26 sheet
has nothing at all.

**Cause.** `buildRepeatIndex()` in `web/js/app.js` merges
`db/timetables/repeat-<school>.json` on top of whatever the pipeline
extracted. Nothing in `python/generate_timetable/` writes that file, so it
was carrying a previous semester's data indefinitely — invisible while fix #1
meant the pipeline contributed nothing of its own.

**Fix.** Emptied, with a README explaining that the list is now produced
automatically and that entries belong here only for repeat classes the source
sheet does not paint yellow.

## 16. The audit could not see what it was auditing

The audit scripts are meant to be a second, independent reader. Several of
their own blind spots made them unable to verify the corrected data, so they
were fixed too. Each fix re-reads the sheet independently rather than
importing generator code — the two implementations still have to agree on
their own.

| Blind spot | Effect | Fix |
|---|---|---|
| Same hardcoded `#FCFE58` | Could not see the `REPEAT` bucket; reported 94 false batch mismatches | Registers the repeat swatch from the legend |
| `Rawal 3 (GPU)` / `Rawal-3` not normalised | 18 classes looked invented and 12 looked missing — the same classes | Same block-letter-less rule the generator uses |
| Section-only `(A, 25)` and bare-title cells unreadable | 16 false course mismatches | `read_cell()` handles all three cell forms |
| Roomless evening rows skipped | 63 real classes reported as invented | Reads them with room `TBA`, as the generator does |
| Cells indexed only by column slot | All 134 inline-time overrides reported as mis-timed, which would bury a real one | Also indexes by the cell's own stated time |
| Section `ALL` treated as a mismatch | 84 false findings | `ALL` and `A` both accepted for a sectionless cell |
| Department scored below section | Wrong cell matched where several share the `TBA` coordinate | Department weighted equally, and a conflicting one counts against |
| Friday's layout reported as a fault | 4 findings for a tab that is simply different | Split into `geometry_problems` (unreadable) and `geometry_variants` (informational) |
| FSE: sections A–D, no `(Batch YYYY)`, no `Teacher:` tail | 8 classes unreadable | Mirrors the generator's three cell forms |
| FSE: no extra-word or short-stub matching | 10 false "not a real course" | Same bounded relaxation, independently written |

---

## Open — not parser bugs

**The evening Room column is blank on five of six computing tabs.** Only
Wednesday fills it. 63 classes — mostly the MS programme — are emitted with
room `TBA` rather than being dropped, but the room genuinely is not in the
sheet. This is `timetable-data-fixes.md` #8's remaining half and can only be
fixed upstream, by filling column 30 on the other day tabs.

**`Comp. Variables & Trans.` runs a section C the allocation does not list.**
The Course Allocation tab gives MT2003 sections A and B; the schedule
timetables a section C on Wednesday and Thursday. The two tabs disagree —
worth raising with the school rather than papering over.

**Six allocation rows never appear in the schedule.** `Final Year Project – I`
(EE4091), the two Holy Quran halves (scheduled as one combined cell, credited
to the MS row), and three MS IC-design courses (EE5036, EE5013, EE5037) that
appear only as `Resrved for IC Design` room blocks in B-127.

**62 cells across both schools are not classes** and are correctly ignored:
FSM bookings (25), `Resrved for IC Design` (26), `Tutorial Batch 26` (5),
prayer breaks (2), an `EE` block (2), a CS reservation, and a faculty meeting.

**Four computing cells carry no fill at all**, so the audit cannot verify
their batch from colour: `PPIT Seminar` ×2 (unpainted, resolved by name
inference to 2023) and the two PhD cells, whose teal has no legend swatch
because the sheet never legends PhD.

---

## Files touched

| File | Change |
|---|---|
| `python/generate_timetable/colour_mapper.py` | Legend-derived repeat swatch; per-fill legend text and `colour_dept_label()` |
| `python/generate_timetable/config.py` | `PHD_*` keys; FSE sections A–E, multi-section / batch-annotation / trailing-noise / cell-time regexes |
| `python/generate_timetable/schools/computing.py` | `detect_blocks()`; band scan; bare-cell capture and `flush_bare()`; MS/PhD department resolution |
| `python/generate_timetable/schools/engineering.py` | Multi-section and annotated titles; abbreviation matcher; shared-course resolution; `fse_dept_key()`; cell-level time override |
| `python/tools/timetable_audit/audit_computing.py` | Repeat swatch, room normalisation, three cell forms, roomless evening rows, override-aware indexing, matcher scoring, geometry variants |
| `python/tools/timetable_audit/audit_engineering.py` | Sections A–E, batch annotation, `Teacher:` tail, section-aware abbreviation matching |
| `db/timetables/repeat-computing.json` | Emptied — the pipeline now produces this list |
| `db/timetables/*.json` | Regenerated |

`business.json` is byte-identical apart from its timestamp — no collateral
damage from the shared config and colour-mapper changes.

## Reproducing

Regenerate, then audit:

```bash
python -m python.generate_timetable.main                  # needs service-account.json in the repo root

python python/tools/timetable_audit/fetch_cache.py       ./sheets
python python/tools/timetable_audit/audit_computing.py   ./sheets  .
python python/tools/timetable_audit/audit_engineering.py ./sheets  .
```

`fetch_cache.py` caches the text and colour grids of every source tab into
`./sheets`, so both audits run offline and can be re-run freely. Findings are
written to `./sheets/audit_computing.json` and `./sheets/audit_engineering.json`
with the offending entry, cell, sheet row and column for every one.

`./sheets` is a working cache and should not be committed.
