# Timetable Data Fixes — August 2026

A pass over the timetable pipeline that started with "why does the engineering
school point at last semester's sheet?" and ended up uncovering a colour
collision that had hidden an entire BS CS batch. Written up so the reasoning
survives, since most of these bugs are invisible in the code and only show up
when you diff the generated JSON against the source spreadsheet.

Status at a glance:

| # | Problem | Status |
|---|---|---|
| 1 | Engineering pointed at the Spring-26 sheet | Fixed |
| 2 | Switching department cleared the section dropdown | Fixed |
| 3 | BS CS 2023 filed under MS (CS) — shared legend colour | Fixed |
| 4 | Business course codes registered as batch years | Fixed |
| 5 | FSE courses tab unreadable — no 2026 batch | Fixed |
| 6 | FSE schedule titles too abbreviated to match | Fixed |
| 7 | Generator crashed on Windows consoles | Fixed |
| 8 | MS evening classes missing Mon/Tue/Thu | **Open — sheet data gap** |
| 9 | Sectionless BS cells dropped (`SMD (CS)`) | **Open — needs a decision** |
| 10 | BS CE/2026/B has only 2 classes | Not a bug — lab group |

---

## 1. Engineering pointed at the Spring-26 sheet

**Symptom.** The engineering timetable was built from the SP-26 spreadsheet
after the school had moved to a new Fall-26 one.

**Cause.** The sheet ID was hardcoded in three places that had to stay in sync.

**Fix.** Swapped the ID to `1fL2TWhPgbPc2d66vm_KywTpdsGBIaBLqlmz4JLPudCw` in
`python/generate_timetable/config.py`, `api/timetable.js`, and
`web/js/app.js`.

The new sheet also renamed its tabs, so the ID swap alone would have fetched
nothing:

| | Old | New |
|---|---|---|
| Schedule tab | `Classes Schedule FSE SP-26` | `Classes Schedule FA26 (In Progress)` |
| Courses tab | `Courses SP-26` | `Course Allocation FA26` |

The schedule grid's own layout was unchanged, so that parser kept working
as-is — 192 entries. The courses tab did not (see #5).

---

## 2. Switching department cleared the section dropdown

**Symptom.** Change the department and the Section dropdown went empty and
stayed empty. Only a page reload brought the sections back.

**Cause.** `web/js/app.js` — the `dept` change listener refilled the batch list
and then blanked sections outright:

```js
fillSelectOptions(batchSel, batches, null, '-- Batch --');
fillSelectOptions(secSel, [], null, '-- Section --');   // wiped, never refilled
```

`fillSelectOptions` re-selects the previous value when the new list still
contains it, so the batch survived the switch — but nothing repopulated
sections, because changing a select's options programmatically fires no
`change` event on it, and only the batch handler rebuilds the section list.
`loadTT()` then saw an empty `sec` and fell through to the placeholder card.
Reload worked because `refreshTTFilters()` recomputes sections from dept+batch
directly.

**Fix.** The dept handler now mirrors the batch handler:

```js
const secs = Object.keys(((TT[dep]||{})[batchSel.value])||{}).sort();
fillSelectOptions(secSel, secs, null, '-- Section --');
if (secs.length === 1) secSel.value = secs[0];
```

Because `fillSelectOptions` preserves the old value, BS CS-A → BS DS-A keeps
you on section A instead of resetting.

---

## 3. BS CS 2023 filed under MS (CS)

The biggest one, and completely silent.

**Symptom.** BS CS / 2023 contained 8 entries — all of them `PDC` — while
MS (CS) had 74 entries spread over sections A–H and `Robo`, which is not what
an MS programme looks like.

**Cause.** The computing sheet paints two different legends with the same
fill, `(1.0, 0.9, 0.6)`:

- row 0, col 37 — **MS (AI)**
- row 3, col 6 — **BS CS (2023)**

`build_colour_map()` scanned top-down and skipped colours it had already
mapped, so row 0 won and `COLOUR_BATCH_MAP[(1,0.9,0.6)] = "MS"`. Every
CS-2023 cell then resolved to batch `MS` in `resolve_batch` tier 2, and
`resolve_departments_for_cell` saw the MS context and rewrote the department
to `MS (CS)`. The whole cohort was redirected. The only survivors in BS CS
2023 were the `PDC` cells, which happen to be uncoloured and so fell through
to tier-3 name inference — `PDC` matches the 2023 keyword list.

Colour alone cannot resolve this: the sheet really does use that fill for both
legends, and the MS (AI) evening classes under it are genuine. What separates
them is the department code in the cell text — `(CS-…)` is BS CS 2023,
`(AI-…)` is MS (AI).

**Fix.** `COLOUR_BATCH_MAP` became `colour → [(dept, batch), …]`:

- `add_colour_entry()` appends rather than first-write-wins, so a shared fill
  keeps both legends.
- `build_colour_map()` captures each legend's programme code (`BS CS (2023)` →
  `CS`, `MS (AI)` → `AI`, `None` for headers naming no programme).
- `colour_to_batch(colour, dept_codes)` picks the entry whose legend dept
  matches the codes parsed from the cell. **Colours mapped by a single legend
  ignore `dept_codes` entirely**, so every non-colliding cell resolves exactly
  as before.
- `resolve_batch()` takes `dept_codes` and forwards it; the call site in
  `parse_matrix_block` passes `parsed["depts"]`.
- `discovery.py`'s copy-paste template was updated — it printed the old
  `colour: "YEAR"` shape, which would now build a broken map.

**Result**, diffed row-by-row against the previous JSON:

| | Before | After |
|---|---|---|
| BS CS / 2023 | 8 entries, sections A–D | **76 entries, sections A–H + Robo** |
| MS (CS) / MS | 74 entries, sections A–H + Robo | **4 entries, section A** |

`business.json` and `engineering.json` were byte-identical apart from
`generatedAt`. In computing, 910 rows were untouched and 68 moved buckets.

BS CS / 2023 / A now reads as the sheet does — Monday: App HCI (D-404, 08:30),
Cloud Comp (D-411, 11:30), Deep Learn (D-412, 11:30).

---

## 4. Business course codes registered as batch years

**Symptom.** The auto-built colour map contained batches `2011` and `2006`.

**Cause.** `build_colour_map()` scans the first 10 rows of every tab for a
`20\d\d` token. On the business tab those rows include course titles —
`MG 2011 Environmental Science`, `SS 2006 Macroeconomics` — whose codes parse
as years, claiming whatever fill they happened to carry.

**Fix.** A header only registers as a cohort legend if it contains `BS` or
`MS`. The map went from 30 colours to 29, with exactly one shared fill left —
the real collision from #3.

---

## 5. FSE courses tab unreadable — no 2026 batch

**Symptom.** FSE had no 2026 batch at all, and first-semester courses were
scattered: Applied Calculus and Applications of ICT into 2025, Physics for
Engineers and Engineering Drawing into 2024.

**Cause.** Two things stacked.

`infer_fse_batch_fallback()` has four keyword tiers — 2025, 2024, 2023, 2022 —
and defaults to `"2024"`. **It cannot return 2026**; its docstring was still
written for Spring-2026, when 2025 was the freshman batch. Same for the JS
twin `inferEngineeringBatch()` in `api/timetable.js`.

And that fallback was handling nearly everything, because the structural
courses lookup was broken. `parse_courses_tab` hardcoded column positions that
the FA26 tab had moved:

| | `Courses SP-26` | `Course Allocation FA26` |
|---|---|---|
| Header row | index 1 | index 2 |
| Semester / batch | col 0, combined | split: col 0 `BS CE 1st Semester Courses/Labs`, col 1 `Batch BS(CE) 2026` |
| Code / title | cols 1 / 2 | cols 2 / 3 |
| Sections | cols 6–9 (A–D) | cols 7–11 (A–**E**) |

Only 8 of ~81 rows parsed.

**Fix.**

- `detect_courses_layout()` reads the header row for `Code`, `Course…` and
  `Section-x` cells instead of hardcoding indices. Both layouts now work, with
  the old constants as fallback.
- Block headers are read from *every* cell left of the Code column, so a
  header split across two cells (and two rows) still resolves. A dept-only
  header opens a block and clears the batch; the batch fills in when its cell
  appears on the block's first course row.
- `2025 (Repeat)` in the batch column is picked up as a block-level repeat
  flag, alongside the existing per-title `(Repeat)` annotation.
- The MS forms the old regex missed now parse: `MS/PhD (EE) Courses`,
  `MS EE`, `MS(EE) - IC Design`. The captured token is only trusted when it
  names a known programme, so `MS Electives` can't read as dept `Ele`.
- Rows with no batch in scope are skipped rather than filed under a null
  batch, and counted in a warning.

Courses tab: **8 rows parsed → 81** (68 unique titles).

---

## 6. FSE schedule titles too abbreviated to match

**Symptom.** Even with the courses tab parsing, 107 of 192 schedule entries
still fell through to keyword guessing.

**Cause.** The schedule grid abbreviates hard and the courses tab spells out,
so exact-name lookup missed most of the sheet: `A & Digital Comm.`,
`Elect. Netwk. Analysis`, `Obj. Oriented Data Struct.`,
`Computer Org.Architecture`, plus outright typos (`Discrete Strucures`).

**Fix.** Token-sequence matching in `resolve_fse_entry`, applied only after an
exact-key miss:

- Tokens come from the raw title, split on non-alphanumerics, so the sheet's
  punctuation separates words instead of gluing them (`Org.Architecture` →
  `org`, `architecture`). Connector words (`and`, from `&`) are dropped from
  both sides.
- A grid token matches a course token by prefix **in either direction** (the
  tabs disagree about plurals and spelling: `Variables`/`Variable`,
  `Analogue`/`Analog`), or — for tokens of 3+ characters sharing a first
  letter — by in-order subsequence, which absorbs dropped vowels and typos
  (`netwks`/`networks`, `strucures`/`structures`).
- Grid tokens must all be accounted for, in order; the course title may carry
  extra words the grid dropped.
- Course-vs-lab is disambiguated by whether the grid title says `lab`,
  since a course and its lab share every other word. Remaining ties prefer the
  title adding the fewest words of its own.
- **Ambiguity is never guessed at**: more than one surviving candidate logs a
  warning and falls back.

A successful abbreviation match records grid-name → courses-tab-name in an
alias map, so `cross_validate()` can still tell the entry made it into the
schedule.

**Result.** Structural resolution went from **85 of 192 → 183 of 192** entries.

| dept/batch | Before | After |
|---|---|---|
| BS EE / 2026 | 0 | **36** |
| BS CE / 2026 | 0 | **13** |
| BS EE / 2024 | 106 | 40 |
| BS EE / 2023 | 3 | 20 |
| BS CE / 2025 | 12 | 26 |
| BS CE / 2024 | 38 | 16 |
| BS EE / MS | 0 | 5 |
| BS EE / REPEAT | 0 | 7 |
| BS CE / 2022 | 4 | 0 |

BS EE/2026/A Monday now reads Applied Calculus, Physics for Engr.,
Applications of ICT Lab — first-semester courses, which is what the batch
label promises.

**Still on keyword fallback — 9 of 192**, all logged: `MP Inter. & Prog` ×4
(two-letter stubs are below the subsequence threshold on purpose — `mp`
matches too much), `Fund. Database Systems` ×3 (the grid adds a word the tab
doesn't have), `Prog Fundamentals & Eng.`, and one `Research Methodology`
tagged MS where the tab lists it under EE. A hand-maintained alias table would
close these, at the cost of a table that rots.

---

## 7. Generator crashed on Windows consoles

**Symptom.** `python -m python.generate_timetable.main` died immediately:

```
UnicodeEncodeError: 'charmap' codec can't encode character '→'
```

**Cause.** Windows consoles default to cp1252, and the logs are full of `→`
and `—`. Any one of them aborts the run — this was not specific to the one
line it happened to die on.

**Fix.** `helpers.py` reconfigures `stdout`/`stderr` to UTF-8 at import, before
anything prints, with a lossy-print fallback where the interpreter won't allow
it. A mangled character in a log line must never abort a generation.

---

## 8. MS evening classes missing Mon/Tue/Thu — **open**

**Symptom.** MS (AI) has Wednesday classes only. Per the sheet, Monday should
be:

| Time | Section | Course |
|---|---|---|
| 05:20–06:40 | A | App Comp Vision |
| 05:20–06:40 | A | Math Foundations of AI |
| 05:20–06:40 | B | Research Methodology |
| 06:45–08:05 | B | Agentic AI |
| 06:45–08:05 | B | Math Foundations of AI |

**Cause.** A hole in the sheet, not the parser. The computing tabs have two
Room columns — column 0 for the daytime block (08:30–05:15) and column 30 for
the evening block (05:20–08:05). The evening rooms are genuinely different
from the daytime ones (Wednesday row 9: `C-305` in col 0, `D-305` in col 30),
so column 0 cannot stand in for a missing column 30.

**Column 30 is filled on Wednesday only:**

| Day | Rooms in col 30 | Evening cells | Parseable |
|---|---|---|---|
| Monday | **0** | 22 | 18 |
| Tuesday | **0** | 18 | 16 |
| Wednesday | 12 | 22 | 18 |
| Thursday | **0** | 18 | 16 |
| Friday / Saturday | 0 | 0 / 1 | 0 |

`parse_matrix_block` skips any row whose room cell is blank
(`computing.py:288`), so every Mon/Tue/Thu evening class is dropped —
**39 entries**, essentially the whole MS evening programme:

```
MS (AI) 15   MS (DS) 10   MS (CY) 6   MS (SE) 5   MS (CS) 3
```

**Options.**

1. Get column 30 filled in on the Mon/Tue/Thu tabs. This is the real fix — the
   data recovers on the next generator run with no code change.
2. Emit the classes with `TBA` as the room when the evening room column is
   blank but the block has classes, so they stop vanishing silently. Roughly a
   five-line change in `parse_matrix_block`.

---

## 9. Sectionless BS cells dropped — **open**

Fixing #3 cost two rows: `SMD (CS)` (D-405, Mon 11:30–12:50 and Wed
01:00–02:20). The cell names no section, and sectionless BS cells are skipped
by the existing rule at `computing.py:321`. It only survived before because MS
context defaults a missing section to `"A"` — so it was appearing under
MS (CS)/A, where no 2023 student would look.

Nothing real was lost, but if `SMD` is meant to be visible to CS-2023, the
sectionless-cell rule needs its own decision — most likely fanning the entry
out to every section of that dept+batch.

---

## 10. BS CE/2026/B has only 2 classes — not a bug

Per `Course Allocation FA26`, BS CE's 1st semester has **one lecture cohort**
of 60. Only the two lab courses list a section B:

```
CS1009  Applications of ICT              sections=[A]
CL1009  Applications of ICT Lab          sections=[A, B]
MT1001  Applied Calculus                 sections=[A]
NS1002  Physics for Engineers            sections=[A]
NL1002  Physics for Engineers Lab        sections=[A, B]
SS1003  Pakistan Studies                 sections=[A]
SS1005  English Language Skills          sections=[A]
MG1008  Occupational Health and Safety   sections=[A]
```

So "B" is a **lab group**, not a section: one class sits together for lectures
and splits in two for labs. The same shape appears in BS CE/2025/C,
BS CE/2024/B and BS EE/2025/D. Decision taken: leave the data mirroring the
sheet. If the sheet ever gives one of these batches a real second lecture
section, it will fill in on its own — nothing is special-casing it.

---

## Files touched

| File | Change |
|---|---|
| `python/generate_timetable/colour_mapper.py` | Multi-legend colour map, dept-aware lookup, `BS`/`MS` header guard |
| `python/generate_timetable/config.py` | Engineering sheet ID + tab names; courses-tab layout regexes |
| `python/generate_timetable/helpers.py` | UTF-8 console reconfigure + safe print |
| `python/generate_timetable/discovery.py` | Template updated to the list-shaped colour map |
| `python/generate_timetable/schools/computing.py` | `resolve_batch` takes dept codes |
| `python/generate_timetable/schools/engineering.py` | Layout detection, split block headers, abbreviation matching |
| `api/timetable.js` | Engineering sheet ID + tab name |
| `web/js/app.js` | Engineering sheet ID; dept-change section refill |
| `db/timetables/*.json` | Regenerated |

## Reproducing

```bash
python -m python.generate_timetable.main     # regenerates db/timetables/*.json
python devserver.py 8123                     # serves the app with vercel.json's rewrites
```

`devserver.py` mimics the `vercel.json` rewrites so `/js/…`, `/css/…` and
`/db/…` resolve the way they do in production; a plain `http.server` will not
work. It does not run `/api/*`, which the timetable panel does not need.
