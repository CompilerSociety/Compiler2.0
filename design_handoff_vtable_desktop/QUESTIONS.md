# Questions to answer before implementation starts

Answer inline (`> your answer`). Anything left blank, I build to the **Recommended**
option. Backing evidence for each is in `GAPS.md`.

---

## Part 1 — Blocking (I cannot build the screen without an answer)

### Q1. Seating plan — what do we render?

Data is `{name, nuid, seat}`; 757 students share 30 seat codes; no room anywhere.

- (a) Extend the ingest to carry `room`, `paper`, `time` per student, then build the full room map. Who does that work, and when?
- (b) **[Recommended]** Ship search + assignment card now, no room map, until the ingest carries a room.
- (c) Fake the map from placeholder rooms.

> im pretty cetain the script is written to include your room too but the current seating plan it scrapped was for a summer semester and did not resemble the seating plan that we recieve in regular semesters which broke the parser and the parser will still work for the real seating plans there are 2 old seating plans from regular semsters that you can use to test this hypothosis 

### Q2. Show-up schedule — which product is it?

Design = weekly on-campus/online days. Data = exam reporting slots (15-min windows, venue, invigilator).

- (a) **[Recommended]** Re-scope the screen to the exam reporting data, keep the six-column layout as a week-of-exams view. Statuses become "Reporting / No papers".
- (b) Keep the design, derive on-campus days from the timetable (a day with ≥1 class = on campus). Renames the feature in effect.

>The showup schedule works currently its not exams  it just when you are shown your checked exams by the faculty and are announced using an excel sheet keep the behaviour like it is currently in production THIS IS NOT A REFACTOR WE ARE NOT MEANT TO CHANGE HOW THE CURRENT SITE WORKS ONLY CHANGE THE UI

### Q3. Exams — the S1 / S2 / Finals control

All three exam files are the same document (2nd Sessional, Spring 2026). No type field.

- (a) You add a `type` field or separate files per exam type. When?
- (b) **[Recommended]** Render only the tabs that have data; single tab until more exists.
- (c) Show all three, two of them empty.

>

### Q4. Exams — Room and Seat columns

Neither exists in exam data.

- (a) **[Recommended]** Keep both columns, render the "TBA" pill (already in the design).
- (b) Drop both columns.

>

### Q5. app.js coupling — the biggest call in the project

`main.js` refuses to boot if any of ~150 element IDs is missing; app.js (233 KB) reads them directly via inline handlers, and mobile.js depends on app.js globals.

- (a) **[Recommended]** Keep the ID contract for the six tool screens (new markup, same IDs and handlers), rewrite only the chrome (nav, footer, profile) and prune `requiredElementIds` for exactly what is removed.
- (b) Full rewrite of the affected app.js sections.
- (c) Keep every ID everywhere, no app.js changes at all.

>

### Q6. Routing — names and indexability for the new screens

Existing routes: `/timetable /freerooms /showup /exams /seating /faculty` (rewritten to hashes, referenced by sitemap.xml).

- What paths for `home`, `signin`, `manual`, `dashboard`, `profile`?
- **Recommended**: `/` for home, `#dashboard`, `#signin`, `#signin/details`, `#profile`; only the six tool routes stay in sitemap.xml; sign-in redirect uses `replaceState` so Back does not bounce.

>

### Q7. Guest behaviour for the three profile-dependent features

- **Next paper** (home panel + dashboard): no profile = no section. Hide the row, or show the nearest paper school-wide? **Recommended: hide for guests; the home panel row reads "Exam date sheet" only.**
- **Notification toggles**: `api/subscribe.js` requires an NU ID. **Recommended: card visible, toggles disabled with "Sign in to get alerts".**
- **Leaderboard**: submission needs `nuid`/`name`/`section`. **Recommended: guests play, score is not submitted, board shows "Sign in to rank".**

>

---

## Part 2 — Design corrections (I will apply the recommendation unless you object)

### Q8. Free-room slot times

The design's last three columns are wrong. **Recommended: bind to `CLASSROOM_SLOTS`; header becomes 08:30 / 10:00 / 11:30 / 13:00 / 14:30 / 15:55 / 17:20 / 18:45, and the caption reads "Eight teaching slots, 08:30 to 20:05".**

>

### Q9. Lab rooms in the availability table

Labs run a 4-slot model, not 8. **Recommended: the strip takes its cell count from `slotsForRoom(room)` — 4 wider cells for labs.** Alternative: exclude labs.

>

### Q10. Free-room floor pills

Three fixed pills cannot reach C-3xx/C-4xx/D-4xx. **Recommended: render pills per selected block from `BLOCK_FLOORS`, including the "Labs" pseudo-floor; pill count varies 2–5.**

>

### Q11. Saturday

Week grid is 5 columns, the Day select offers 6. **Recommended: six columns, Saturday shown only when the selection has Saturday classes.**

>

### Q12. Section labels — is "6A" a real thing?

Data has bare letters. **Recommended: drop the semester prefix, show "SECTION A".** If you want "6A", tell me the rule for deriving the semester from batch + term.

>

### Q13. Roll-number validation

The design's regex rejects `22P-` rolls that exist in the data. **Recommended: use production's `/^(\d{2})[A-Za-z]{1,4}-\d{4}$/` and send unmatched or non-Computing rolls to the manual form instead of showing an error.**

>

### Q14. Course code under each class name

Not in timetable data. **Recommended: drop the line.** Alternative: leave the slot, fill only on a confident name match against exam data.

>

### Q15. Faculty consultation hours

Not in faculty data. **Recommended: drop the row** (or show "Not published" — say which).

>

### Q16. Batch options and the example profile

BS CS has 2023–2026 + REPEAT; there is no 2022. **Recommended: build batch options from the data, and change every "22i-1847 / 2022" reference in the design to a batch that exists.**

>

### Q17. Term strings in kickers

"FALL 2026", "SESSIONALS & FINALS · FALL 2026", "WEEK OF 11 AUGUST" are typed in, while the data is Spring 2026 / Fall 2025. **Recommended: bind all of them to `updated_at` / `source_subject`.** Also tell me what the current live term actually is.

>I have no idea what you want to know 

### Q18. "Repeat courses" for Business and Engineering

Only `repeat-computing.json` exists, in a different shape. **Recommended: show the Repeat option only for Computing.**

> No we dont compromise on functionality 

---

## Part 3 — Wiring decisions I need from you

### Q19. Profile storage

The design's `vtable-desktop-profile` would sign out every existing user (production: `vtable_profile` in localStorage + cookie, plus `vtable_profile_nuid`).
**Recommended: keep `vtable_profile`, extend the record with `school`, `program`, `source`; reuse `fast_timetable_prefs` / `fast_showup_prefs` / `fast_exam_prefs` unchanged.**

>

### Q20. department → school/program mapping

Student records have no `school` or `program`. I need the authoritative table, e.g.
`CS → BS CS`, `AI → BS AI`, `SE → BS SE`, `DS → BS DS`, `CY → BS CY`, all under School of Computing; everything else → manual form. Confirm, and say what BS PCS / MS / PhD rolls should do.

>OFC students have an authorotative table for schools and program mapping its in the fucking json in db/students/ the jsons incode data in such a way that we know the batch section and program for them as for FSM AND FSE handle them like the mobile version does 

### Q21. Roll-number lookup

There is no read endpoint (`api/profile.py` is write-only), so sign-in must fetch `/db/students/<batch>.json` client-side (22.json is 1,804 records).

- (a) **[Recommended]** Client-side fetch + cache, same as the existing profile flow.
- (b) Add a lookup endpoint — who writes it?

>

### Q22. Notification permission states

Push needs a browser permission prompt, and can be denied or unsupported. The design shows none of these. **Recommended: the toggle triggers the prompt on first enable; a denied state shows an inline "Blocked in your browser settings" line; unsupported hides the card.** Confirm the copy.

>

### Q23. Fonts

`main.css` already `@import`s Inter + JetBrains Mono + VT323 from Google Fonts (and references 'Share Tech Mono', which is never imported — an existing bug). The redesign needs DM Mono + Figtree.
**Recommended: add DM Mono + Figtree to the existing import, keep Inter/JetBrains (mobile.css uses `--mono`/`--sans`), drop VT323 once the old header is gone.** Self-hosting instead?

>

### Q24. CSS strategy

`main.css` is 79 KB of the old design, and `mobile.css` (767px and below) must not change.

- (a) **[Recommended]** New desktop styles in a separate stylesheet loaded after main.css; old desktop rules deleted as each screen lands.
- (b) Rewrite main.css in place.

>

### Q25. The 768px–1180px gap

`mobile.css` takes over at max-width 767px; the design is "correct from ~1180px up". Nothing covers between. **Recommended: the desktop layout reflows down to 768px (container goes fluid, two-column layouts stack).** Confirm, or say tablets are out of scope.

>

### Q26. Accessibility

Current components use `role="tabpanel"`, `aria-labelledby`, `aria-live` result regions and `.sr-only` headings. The prototype has zero aria. **Recommended: nav becomes real `<nav>` navigation (tab semantics dropped deliberately), result regions keep `aria-live="polite"`, the toast gets `role="status"`, the arcade modal gets a focus trap + `aria-modal` + focus return, and focus moves to the page `<h1>` on screen change.** Confirm this is in scope.

>

### Q27. Launch gate and status badges

- `js/status.js` gates the whole app behind `components/coming-soon.html`. Restyle it to the new tokens, or leave as is? **Recommended: leave as is.**
- Where do `#tt-live-badge` / `#exam-source-badge` / `#showup-source-badge` live in the new header? **Recommended: one live badge beside each page H1.**

>

---

## Part 4 — Scope and process

### Q28. Delivery shape

All 11 screens in one pass, or phased? **Recommended: chrome + home + sign-in + dashboard first, then the six tool screens, then the arcade chrome.**

>

### Q29. Where does this land?

Feature branch and PR, or straight to `main`? Is there a preview deploy? Should the new desktop view sit behind a flag until it is complete?

>

### Q30. Confirm the phone view is frozen

`mobile.css` and `mobile.js` untouched, phone behaviour unchanged — including the fact that mobile.js reads app.js globals, so app.js changes must stay compatible. Confirm.

>

### Q31. How do I verify?

There is no test suite in the repo. Is `devserver.py` the way to run it locally? Anything else I should check a change against before calling it done?

>

### Q32. Print styles

Students print timetables and date sheets. Nothing in the handoff covers it. In scope? **Recommended: out of scope for now.**

>
