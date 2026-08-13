# To-do

Everything deferred, blocked, or stubbed. Grouped by why it isn't done.

Legend — **Dead switch**: the plumbing is built and honoured end to end, but
nothing acts on it yet; the feature turns on by writing the missing half, not by
changing the wiring.

---

## Dead switches (wired, not yet acting)

### Free-room digest notification
- **State:** preference `room` is stored on the device (`vtable_notif_prefs`),
  transmitted by `/api/subscribe`, and read by `wants(entry, 'room')` in
  `scripts/notifications/prefs.mjs`. **No sender writes this notification.**
- **UI:** the toggle renders disabled with a "Soon" tag in the profile modal.
- **To finish:** write `scripts/notifications/send-room-push.mjs` (gate on
  `wants(entry, 'room')`), add a workflow to run it, then drop `disabled` from
  `#notif-pref-room` in `web/modals/all-modals.html` and the `dead: true` flag in
  `NOTIFICATION_CATEGORIES` in `web/js/app.js`.
- **Open question:** what a digest actually says — a daily summary, or a ping
  when a room frees up in the block the student is standing in.

### Notification bell / inbox
- **State:** the bell renders in the phone header and currently only toasts
  "coming soon". Push *delivery* works (4 senders, subscription store,
  per-device dedupe state), but nothing persists a notification history, so
  there is no feed to render.
- **To finish:** decide where history lives — a committed feed file the senders
  append to, or client-side capture in `web/service-worker.js` on `push`. The
  service-worker route needs no backend but only records notifications received
  while that device was subscribed.
- **Blocks:** the design's Notifications screen (§10), and the bell button in
  the mobile header.

---

## Blocked on missing data

### Teacher names on timetable rows
Timetable entries are `{name, location, time}`. The Computing source sheet does
not carry a teacher — cells read `Ideology of Pak (CS-A) 01:00-02:45`. Needs a
course-allocation sheet from FSC (Engineering has one:
`sheets/engineering__Course_Allocation_FA26.json`), joined on course + section.
Dropped from the mobile design in the meantime.

### Course codes on timetable rows
Same cause. `db/exams/*.json` has real `code` ↔ `course` pairs, but only for
examined courses, and timetable names are abbreviated (`PF`, `Discrete`,
`Func Eng`) so they don't match. Code pill dropped from the mobile design.

### Seating plan room + room map
`db/seating/plan.json` is `{name, nuid, seat}` with no room. Confirmed
collision: 269 students across 36 distinct seat coordinates — 8 students share
`C1R1`, i.e. ~8 rooms flattened into one list. The design's room map cannot be
drawn until the Gmail parser (`docs/apps-script/seating-gmail-trigger.gs`)
captures the room. Seating stays an NU ID → seat lookup.

### Faculty office hours and courses taught
`db/faculty/data.json` has name, designation, email, room only. Office hours and
a per-teacher course list have no source. Faculty detail ships with what exists.

---

## Mobile redesign

**Built.** `web/components/mobile-app.html`, `web/css/mobile.css`,
`web/js/mobile.js` — a phone-only view over the same data layer, active below
768px. The desktop DOM stays in the page (hidden) because `js/app.js` drives it
and its startup barrier requires every one of its IDs. Verified in Chrome at
390×844: all five tabs, sign-in + skip, the drill-downs, and the arcade
easter egg, with no console errors and the desktop layout unchanged.

Still outstanding on it:

- **Module extraction was skipped.** `web/js/app.js` is still 4,400 lines and
  `web/js/mobile.js` now sits beside it as a second large file. The stubs in
  `web/js/` and `web/css/` are still empty. Do the extraction post-launch, as
  pure file moves, then rebase both views on the modules.
- **Today is phone-only.** Desktop has no equivalent screen. It's the strongest
  screen in the design and worth porting up.
- **PWA install bar is hidden on phones** — it would collide with the bottom
  tab bar. Re-place it above the tab bar rather than suppressing it.
- **Fonts load from Google Fonts.** The handoff asks for self-hosted DM Mono and
  Figtree for a locally installed app.
- **Exam department chips show both `CY` and `CYS`** — two spellings live in
  `db/exams/computing.json`. Normalise at the parser, not in the view.
- **The desktop profile modal still has the old notification UI.** Phone Profile
  now has a master on/off switch that gates the category toggles and, when
  switched off, deletes the server record (`DELETE /api/subscribe`) and
  unsubscribes the browser. Desktop kept its one-way "Enable notifications"
  button, so there is no way to turn them off from a desktop browser, and its
  category toggles stay live even when nothing is subscribed (flipping one
  writes locally and `syncNotificationPrefs()` silently no-ops). Left alone on
  purpose — this pass was phone-only — but `disableSeatAlerts()` and
  `pushAlertsActive()` in `web/js/app.js` are shared, so porting it is markup
  plus a listener.

### Decided against
- **Room Rush** — double-clicking the Today banner opens the existing game
  picker instead, same as the logo double-click does now.
- **Dark theme for mobile** — deferred; mobile ships light-only.
- **Design's fixed 3-pill floor step** — floors come from `BLOCK_FLOORS` per
  block. Lab rooms render a 4-segment slot bar (`LAB_SLOTS`), classrooms 8.
- **Today on desktop** — mobile-only for now. Worth revisiting; it's the
  strongest screen in the design and desktop won't have it.

---

## Smaller items

- `FV_DEPT_BY_CODE` (`web/js/app.js`) maps `AI` and `DS` to
  `'Artificial Intelligence & Data Science'`, but `db/faculty/data.json` has
  separate `'Artifical Intelligence'` (typo in the data) and `'Data Science'`
  keys. The guard means it fails silently rather than breaking, so profile →
  faculty auto-select just doesn't fire for those two. Check whether the live
  faculty sheet uses the combined name before changing either side.
- `web/css/` has 12 one-line stub files alongside a 1,034-line `main.css`, the
  same unfinished split as `web/js/`. Do it with the module extraction.
- Design's batch chips list 2022–2025; there is a `26` batch and `2026`
  timetables. Batch options should come from the data, not a literal list.
- **Free Rooms still refetches everything every 15 minutes, uncached.** Each
  cycle is ~380 KB: the three `db/timetables/*.json` snapshots plus six Google
  Sheets `gviz` calls (one per weekday, for the C/D block occupancy). Every URL
  carries `?cachebust=` *and* `cache:'no-store'`, so nothing is ever reused.
  The six sheet calls in particular could be fetched lazily — only the day being
  viewed is ever read — which would cut that to roughly one. `engineering.json`
  is also an empty 100-byte file that is fetched on every cycle.
- `web/icons/` is generated by `scripts/make-icons.py` from
  `web/assets/images/logo.png`. Re-run it and commit the output whenever the
  logo changes — the icons were previously hand-made and every one of them was
  subtly wrong (off-centre, transparent where it had to be opaque, letterboxed
  inside the maskable safe zone).
