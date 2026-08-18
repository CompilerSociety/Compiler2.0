# Handoff addendum — gaps, mismatches and resolutions

Audit of `README.md` + `VTable Desktop.dc.html` against the live code and data
(`web/js/app.js`, `web/js/main.js`, `db/**`, `api/**`) as of 2026-08-18.

The handoff is complete on **look**: tokens, type scale, spacing, radii, motion and
copy are all specified and unambiguous. Everything below is about **data and wiring** —
the parts that decide whether a screen can actually be built, not how it looks.

Severity: **[B]** blocker (screen cannot be built as drawn) · **[F]** wrong constant
(design ships a value the data contradicts) · **[G]** gap (spec silent, decision needed).

---

## A. Blockers — the design asks for data that does not exist

### A1 [B] Seating plan: there is no room, and seat codes collide 26 ways

`db/seating/plan.json` records are `{name, nuid, seat}` only. Seat values are all
`C<col>R<row>` with **5 columns × 6 rows = 30 distinct codes shared by 757 students**
(~26 students per code). There is no room field, no paper, no section.

The design's Seating screen needs all of: an **8-seat × 5-row** room map, the **room**
(`C-301`), the **paper**, **reporting time**, and **"your section's seats"** shading.
None of that is derivable. Grid dimensions are also transposed from the real data
(design 5 rows × 8 cols; data 6 rows × 5 cols).

Resolutions, pick one:

1. **Extend the ingest** so each seating record carries `room`, `paper`, `time` — the
   renderer already reads those fields (`renderSeatingCard`, app.js:3277) and
   `db/students/26.json` already writes them empty. Then derive grid size per room
   from the max col/row seen, rather than hardcoding 5×8.
2. **Ship the screen without the map**: keep the search + assignment card (which the
   data supports), and drop the room map until the ingest carries a room.

Section shading (`--seat-mine`) additionally needs a section per seated student —
joinable from `db/students/<batch>.json` by `nuid`, but only for rolls on that roster.

### A2 [B] Show-up schedule is a different product from the data

The design draws six day columns — "green days are the ones your section is due on
campus, everything else runs online", with per-day class lists and "3 days on campus
this week".

`db/showup/computing.json` is an **exam** show-up schedule: per-paper reporting slots
(`date`, a 15-minute `time` window, `venue`, `code`, `course`, `batch`, `sections`,
`teacher`) for a finals period. There is no weekly on-campus/online concept anywhere
in the data, and the live site renders it as a table of exam entries
(`renderShowupSchedule`, app.js:2925). Nothing supports the "Online" status at all.

Resolutions, pick one:

1. **Re-scope the screen** to what the data is: reporting slots per paper, grouped by
   date, keeping the six-column day layout as a week-of-exams view. Statuses become
   "Reporting / No papers" rather than "On campus / Online / No classes".
2. **Keep the design** and derive on-campus days from the *timetable* instead
   (a day with ≥1 class = on campus). That is a genuinely useful screen but it is no
   longer "show-up", and the dashboard's "3 days on campus this week" would follow it.

The dashboard quick card ("3 days on campus this week") and the home panel depend on
whichever answer is chosen.

### A3 [B] Exams: no room, no seat, no sessional/final type

`db/exams/*.json` entries are `{date, day, time, code, course, batch, sections, notes?}`.
The design's date-sheet table has **Room** and **Seat** columns, and a three-way
**Sessional I / Sessional II / Finals** segmented control.

- Room and seat are not in exam data. Seat can only come from A1; room from nowhere.
- All three files are the *same source document* ("Schedule of 2nd Sessional
  Examination Spring 2026"). There is no per-exam type field and no S1 or Finals file,
  so the segmented control has nothing to switch between.

Resolutions:

- Room/Seat columns: render "TBA" (the design already specs the TBA pill) until a
  source carries them, or drop the two columns for now.
- Segmented control: needs either a `type` field per exam, or one file per exam type
  (`db/exams/<school>-s1.json` etc.). Until then the control should reflect only what
  exists — a single "Sessional II" state — rather than shipping two dead tabs.

### A4 [B] No timetable data for batch 2022, which is the design's own example user

`db/timetables/computing.json` has BS CS batches **2023, 2024, 2025, 2026, REPEAT**.
There is no 2022. The handoff's Batch select spec says "2022–2026", and the canonical
signed-in user throughout the design is `22i-1847` / "BS(CS) · 2022 · SECTION 6A" —
a profile whose dashboard and timetable would both render empty.

Resolution: drive the Batch options **from the data** (`Object.keys(TT[program])`)
rather than a hardcoded range, and re-shoot the example profile as a batch that exists
(e.g. `23i-`). This also fixes the show-up filter, which currently hardcodes 2022–2025
(`web/components/showup-schedule.html`).

### A5 [B] Course codes are not in the timetable data

Every class row in the design shows the course code beneath the name (`500 13px 'DM Mono'`).
Timetable entries are exactly `{name, location, time}` — 2,010 of them, no exceptions,
no code field. Exam data has codes but does not map to timetable rows.

Resolution: drop the code line from the class row, or leave the slot and populate it
only when a name↔code match against `db/exams` succeeds (unreliable — names are
abbreviated in timetables: "App HCI", "Deep Learn").

### A6 [B] Faculty consultation hours do not exist

The detail panel lists Email / Office / **Consultation hours** / Department.
`db/faculty/data.json` teacher records carry only `{name, designation, email, room}`.

Resolution: drop the row, or show it as "Not published". (The panel already correctly
omits a course list for the same reason.)

---

## B. Wrong constants — the design hardcodes values the data contradicts

### B1 [F] Free-room slot times: three of eight are wrong

Design header row: `08:30, 10:00, 11:30, 13:00, 14:30, 16:00, 16:30, 17:20`
(README §6 and prototype `slotHead`).

Real classroom slots (`CLASSROOM_SLOTS`, app.js:1094):
`08:30–09:50, 10:00–11:20, 11:30–12:50, 01:00–02:20, 02:30–03:50, 03:55–05:15, 05:20–06:40, 06:45–08:05`
→ starts are `08:30, 10:00, 11:30, 13:00, 14:30, 15:55, 17:20, 18:45`.

So the last three columns are wrong, and the caption "Eight teaching slots, 08:30 to
17:20" should read **08:30 to 20:05**. Use the constant, not literals.

### B2 [F] Free rooms: labs have four slots, not eight

`LAB_SLOTS` is a separate 4-slot model (`08:30–11:15, 11:30–02:15, 02:30–05:15, 05:20–08:05`)
and `slotsForRoom()` picks per room. A fixed 8-cell strip misrenders every lab.
Spec needed: either exclude lab rooms from the table, or let the strip take its cell
count from `slotsForRoom(room)` (4 wider cells for labs).

### B3 [F] Free rooms: three floor pills cannot cover the building

Design: Ground / 1st floor / 2nd floor. Real floors per block (`DEFAULT_BLOCK_FLOORS`,
app.js:992): A = 0,1,2,3,Labs · B = 0,1,2,Labs · C = 1,2,3,4,5 · D = 2,3,4,5.
Blocks do not share a floor set, and C-3xx/C-4xx and D-4xx — the busiest teaching
rooms — are unreachable through the designed control.

Resolution: render the floor pills **per selected block** from `BLOCK_FLOORS[block]`,
including the "Labs" pseudo-floor, using the existing `floorLabel()` copy. Pill count
becomes variable (2–5); the layout needs to tolerate that.

### B4 [F] Week view has five columns; the Day select has six days

Both the README (`88px repeat(5, 1fr)`) and the prototype grid are Mon–Fri, while the
Day select and `roomDays` list Monday–Saturday. Saturday classes exist in the data
(4 entries). Decide: six columns, or a Saturday column that appears only when the
selection has Saturday classes.

### B5 [F] Faculty count is 199, not 214

The kicker "ALL SCHOOLS · 214 PEOPLE" is placeholder. Actual: 199 teachers across
School of Computing (CS 57, SE 30, DS 28, CY 18, AI 14) and Sciences & Humanities
(Social Sciences 35, Mathematics 11, Physics 6). Bind the count; do not print it.

Note the chip set (All, CS, AI, SE, DS, CY, SH) collapses three S&H departments into
one "SH" chip — fine, but say so, and the HOS/HOD leadership strip must then switch
school when SH is selected (there are two HOS records and eight HOD records).

### B6 [F] Sections are single letters — there is no "6A"

Timetable section keys are `A–H, J`, plus `ALL` (batch-wide classes merged into every
section) and `Robo`. Student records store `section: "A"`. The design's "SECTION 6A" /
"BS(CS) 6A" implies a semester prefix that exists nowhere in the data.

Resolution: either drop the prefix (show "SECTION A"), or compute the semester from
batch + current term and label it explicitly as derived. Also: the design's Section
select must hide `ALL` (it is a merge key, never pickable — see `ALL_SECTIONS`,
app.js:1098) and handle sub-section tokens (`J1`, `J2` — `baseSection()`).

### B7 [F] The roll-number regex rejects real students

Design: `/^(\d{2})\s*[iIlL]\s*-?\s*(\d{4})$/` — only `i`/`l`. The production validator
(`NUID_RE`, api/subscribe.js) is `/^(\d{2})[A-Za-z]{1,4}-\d{4}$/`, and the seating data
contains `22P-0507`. Use the permissive form and route non-`i` campuses to the manual
form rather than showing "that does not look like a roll number".

### B8 [F] Data is Spring 2026; the design says Fall 2026

Exam and show-up files are Spring 2026 / Fall 2025 documents. Every kicker in the
design hardcodes a term ("FALL 2026 · LIVE FROM THE SHEET", "SESSIONALS & FINALS ·
FALL 2026", "COMPUTING · WEEK OF 11 AUGUST"). These must be bound to
`updated_at` / `source_subject`, not typed into the markup.

---

## C. Integration facts the handoff omits

### C1 [B] `main.js` hard-fails startup on ~150 required element IDs

`verifyRequiredElements()` (web/js/main.js) throws — and the app never boots — if any
ID in `requiredElementIds` is missing. The redesign deletes or replaces a large number
of them: the six nav cards (`nc0–nc5`, `p0–p5`), the profile modal set
(`profile-modal-backdrop`, `profile-launcher`, `profile-card`, `profile-save-btn`, …),
`header-logo`, `liveTime`/`liveDay`/`liveDate`, `sec-cell`, `sb1–sb3`.

`web/js/app.js` (233 KB) reads those IDs directly and the components use inline
`onchange=` handlers. **This is the single largest piece of work in the redesign and
the handoff does not mention it.** Whoever implements needs a stated position:

1. **Keep the ID contract** — new markup, same IDs and inline handlers, so app.js is
   untouched. Cheapest; constrains structure (e.g. the profile screen must still carry
   the modal's IDs even though it is no longer a modal).
2. **Rewrite the affected app.js sections** and prune `requiredElementIds` and
   `componentTargets` in step. Cleaner; much larger, and every deletion is a chance to
   break the phone view, which shares app.js globals (`mobile.js` loads after it and
   reads them directly).

Recommend (1) for the tool screens and (2) only for chrome (nav, footer, profile).

### C2 [B] The design has no URL story; the site already has routes

`web/index.html` rewrites `/timetable`, `/freerooms`, `/showup`, `/exams`, `/seating`,
`/faculty` to hash routes, `app.js` syncs the hash (slug lists at app.js:2629, 2839),
and `web/sitemap.xml` + the canonical tag depend on them. The handoff's `screen` state
model never mentions URLs, deep links, or the back button.

Needed: hash/route names for the four **new** screens (`home`, `signin`, `manual`,
`dashboard`, `profile`), whether they are indexable, and what the back button does
after a sign-in redirect. Without this, deep links and SEO regress.

### C3 [G] Profile storage key differs from production, with no migration

Design persists to `vtable-desktop-profile`. Production uses `vtable_profile` in
localStorage **plus a cookie of the same name**, with `vtable_profile_nuid` alongside
(app.js:50-51), and has repair logic for old records (`healProfileDepartment`).
Adopting a new key silently signs out every existing user.

Resolution: keep `vtable_profile` and extend the record with the design's extra fields
(`school`, `program`, `source`); the existing shape is `{nuid, name, section,
department, batch}`. Same for filter persistence — `fast_timetable_prefs`,
`fast_showup_prefs`, `fast_exam_prefs` already exist and should be reused, not renamed.

Also: `school` and `program` are **not** in student records (`{name, nuid, section,
department, batch}`). They must be derived from `department` (CS/AI/SE/DS/CY →
School of Computing → "BS CS" timetable key). The mapping needs to be written down —
note that `department: "AI"` must become `"BS AI"` to match the timetable, which is
exactly what `healProfileDepartment` patches today.

### C4 [B] There is no roll-number lookup endpoint

The handoff says sign-in resolves the profile via "the existing `api/profile.py` /
`db/students/<batch>.json` lookup". `api/profile.py` is **write-only**: POST saves a
student, GET returns `{"ok": true, "message": "Profile endpoint is active"}`. There is
no read/lookup route.

So sign-in must fetch `/db/students/<batch>.json` client-side and scan it —
`22.json` alone is 1,804 records. Specify: fetch-and-cache client side (the pattern
`PROFILE_STUDENTS_CACHE` already implies), or add a lookup endpoint. Also note
`26.json` holds 45 records, so most of batch 2026 will miss — which is what the
design's batch-2026 manual path is for, but the same fallback must cover *any*
unmatched roll number, not just `26`.

### C5 [G] Notification toggles are push subscriptions, not local booleans

The design models `notifs` as five booleans. Production writes local prefs
(`vtable_notif_prefs`, defaults `{cls:true, exam:true, show:true, seat:true, room:false}`)
**and** registers a Web Push subscription through `api/subscribe.js` (VAPID, service
worker, browser permission prompt, per-IP rate limiting, roster enrolment). The design
shows no permission prompt, no denied/blocked state, no "notifications unsupported"
state, and no signed-out state — yet `api/subscribe.js` requires a valid NU ID, so the
toggles cannot work for a guest. The `#profile-bell-btn` / `#profile-push-status`
affordances have no home in the new layout.

Needed: what a guest sees on the Profile screen's notification card, and the three
permission states.

### C6 [G] Arcade leaderboards require a profile

`submitLeaderboardScore` (app.js:1043) posts `nuid, name, section, department, batch`;
`api/leaderboard.js` keys entries by NU ID. The design says every screen works signed
out and shows "the player's own row highlighted" — undefined for a guest. Specify:
play allowed, submission disabled with a "sign in to rank" line (recommended), or the
whole arcade gated.

Also, the game ids are `compiler_run`, `duck_hunter`, `flappy_bird` (note: *bird*, not
byte, in the storage layer) and per-game bests live under `compiler_run_hi`,
`duck_hunter_hi`, `flappy_byte_hi`.

### C7 [G] The launch gate is not mentioned

`web/js/status.js` gates the whole app behind a countdown holding page
(`components/coming-soon.html`); when gated, components never load. The redesign needs
to say whether the holding page is restyled to the new tokens or left as is.

### C8 [G] Accessibility regresses, silently

Current components use a tabs pattern with real semantics: `role="tabpanel"`,
`aria-labelledby`, `aria-hidden`, `.sr-only` headings, `role="status" aria-live="polite"`
on every result region. The prototype has **zero** `aria-` or `role` attributes, and
the handoff specifies only `:focus-visible`.

Needed, at minimum: the nav pill group's role (it is now navigation, not tabs — say so
and drop the tab semantics deliberately rather than by accident), live-region behaviour
for search results (faculty, seating), the toast's `role="status"`, focus management on
screen change (the design scrolls to top but never moves focus), and the arcade modal's
focus trap + `aria-modal` + return focus on Escape.

### C9 [G] Loading and error states are specified only as "in the existing idiom"

The idiom has a name: `renderUiState({kind, title, message, note})` with `kind` of
`loading` / `empty` / `error`, plus the global error banner in `main.js` and the
timetable's live badge (`setTimetableLiveBadge`: syncing / live / cached / error).
The redesign should say where the badge lives in the new header, since the current
`#tt-live-badge` and `#exam-source-badge` / `#showup-source-badge` have no place in
the new layout. Empty copy is given only for faculty.

---

## D. Smaller ambiguities

| # | Ambiguity | Recommended resolution |
| --- | --- | --- |
| D1 | "Free rooms 23 open", "Blocks A–D", "9 of 12 free in slot 4", "214 people", "5 papers · 17–26 Aug", "Synced 22 min ago" | All placeholders. Bind every one; none should survive as literals. `#footer-last-sync` already computes the sync line. |
| D2 | Home panel "Next in 2 days" and dashboard "NEXT PAPER IN 2 days" for a **guest** | No profile ⇒ no section ⇒ no "your" next paper. Specify a guest fallback (nearest paper across the school, or hide the row). |
| D3 | Free-window row: "6 rooms open on C-2" then "jumps to Free rooms pre-set to that block/floor" | Which block/floor — the one from the *previous* class's room, or nearest? Also the count must be computed, and C-2 is a real floor (`C-Margala` rooms) so the example is misleading. |
| D4 | "Current class" / "past class" styling | Needs the day-boundary rule: what renders on a Sunday, and whether "current" uses campus local time. `SLOT_MINUTE_MAP` and `getUpcomingSlots` already exist — reuse. |
| D5 | Timetable "Repeat courses" batch option | `db/timetables/repeat-computing.json` is shaped differently (`{_README, repeat}`) and only exists for computing. Say what the Repeat option does for Business/Engineering (recommend: hide it). |
| D6 | Dashboard greeting "Good morning, {firstName}" | Define the time bands, and the fallback when `name` is missing (manual profiles may omit it — the design marks name required, but existing stored profiles may not have one). |
| D7 | Live clock "ticks every 20s" showing `HH:MM` | Fine, but the free-rooms status bar's "current slot" derives from it and changes on slot boundaries — that needs a re-render, not just a text swap. |
| D8 | Theme toggle | `initializeTheme()` binds `#theme-toggle`, which is **not** in `requiredElementIds` — so a missing toggle fails silently rather than loudly. Add it to the list. |
| D9 | Mobile boundary | "correct from ~1180px up" and "below the mobile breakpoint `mobile.css` takes over". The actual breakpoint value is not stated, and 1180px→breakpoint is an unspecified gap. State the number and what renders between it and 1180px. |
| D10 | `db/timetables/business.json` and `engineering.json` | The design's School select implies all three schools, but every screen's copy is Computing-first (dept chips CS/AI/SE/DS/CY, show-up is `computing.json` only, exams have per-school files). Confirm which screens are Computing-only by design. |
| D11 | Print | Students print timetables and date sheets. Nothing in the handoff covers print styles. Confirm out of scope. |

---

## E. Decisions needed before implementation starts

1. **Seating** (A1) — extend the ingest, or ship without the room map?
2. **Show-up** (A2) — re-scope to exam reporting slots, or rebuild the screen on
   timetable data?
3. **Exams** (A3) — where do S1/S2/Finals come from, and do Room/Seat ship as TBA?
4. **app.js coupling** (C1) — preserve the ID contract, or rewrite the runtime?
5. **Routing** (C2) — route names for the five new screens, and their indexability.
6. **Guest behaviour** for the three profile-dependent features: next paper (D2),
   notifications (C5), leaderboard submission (C6).
