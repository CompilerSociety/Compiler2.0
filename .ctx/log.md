## 2026-09-10T22:50:00+05:00
- Updated the timetable frontend school registry so FSC, FSE, and FSM use their actual source tabs.
- Re-enabled per-school snapshot fallback after Mongo/API errors and added snapshot fallback for Free Rooms.
- Next: run syntax and project regression checks.

## 2026-09-10T22:56:00+05:00
- JavaScript syntax and diff checks pass for the frontend and timetable API.
- Python test discovery reaches 9 passing tests but 3 modules cannot import because the environment lacks `google-auth` / `google-api-python-client`.

## 2026-09-10T23:02:00+05:00
- Added API aliases for FCS/FSC, FSM, and FSE; responses still use canonical computing/business/engineering keys.
- Final syntax and whitespace checks pass.

## 2026-09-10T23:30:00+05:00
- User preference: push completed code changes to the repository as part of each task after validation.

## 2026-10-15T00:00:00+05:00
Replaced mobile Today screen with NASCON 26 planner: Today = saved events (localStorage vtable_nascon_events_v1), Week tab renamed "Nascon Schedule" (day -> category incl. All -> events with + add). Agenda data in web/js/nascon-data.js (loaded by main.js before mobile.js). Old class timetable code kept; toggled by NASCON_ON in mobile.js. Asset version bumped to 47. Not committed.

## 2026-10-15T12:00:00+05:00
Pushed NASCON planner to main (d1df27e, rebased on 30ed292, v=48). Then added countdown banner on Today (nasconBannerHTML in mobile.js): live event = red "ends in", else next = green "starts in", plus a "THEN" card; all-day picks only lead when nothing timed is left. Bumped to v=49. Not committed yet.

## 2026-10-15T13:00:00+05:00
Pushed countdown (8ca072e). Saved events now show a red cross (remove) instead of a check; bumped to v=50. Not committed.

## 2026-10-15T14:00:00+05:00
Pushed cross button (8ae484f). Hid My courses / My Friends on Today while NASCON_ON (#m-today.is-nascon CSS rule); bumped to v=51. Not committed.

## 2026-10-15T15:00:00+05:00
Pushed hidden buttons (0122ac1). Added per-event venue picker: pencil on events with 2+ rooms (nasconVenues splits venue text), choice saved in localStorage vtable_nascon_venues_v1 and shown in rows + countdown card. Countdown now one big card only (dropped THEN card). Bumped to v=52. Not committed.

## 2026-10-15T16:00:00+05:00
Re-themed the mobile app to NASCON maroon (#7a1c1e) on cream (#fffaf2) via the .m-app tokens in mobile.css (light + dark), and the browser theme-color. Desktop (main.css) still green. Bumped to v=53. Not committed (venue picker + one-card banner also uncommitted).

## 2026-10-15T16:30:00+05:00
Pushed theme (b5445c9). Lightened light-theme palette: accent #b23a3c, cream base #fdf4e6. Bumped to v=54. Not committed.

## 2026-10-15T17:00:00+05:00
Pushed lighter palette (80cf680). Event rows now list every room as its own pill by default (or just the picked one), with the pencil moved under the pills captioned "Edit your venue". Bumped to v=55. Not committed.

## 2026-10-15T17:30:00+05:00
Pushed all-rooms view (118d51e). Set mobile palette to colours sampled from the NASCON posters: maroon #561014 primary, cream #e8dcc4 secondary/background, ink #36120a; dark = maroon page #2a0709 with cream accent. Bumped to v=56. Not committed.

## 2026-10-15T18:00:00+05:00
Pushed exact palette (aab6ef9). Added NASCON 26 poster pop-up on every mobile app open (web/assets/images/nascon-26.webp, #m-nc-promo in mobile-app.html, showNasconPromo in mobile.js): close X, backdrop tap, Escape, or "Plan your NASCON" -> schedule tab. Bumped to v=57. Not committed.

## 2026-10-15T18:30:00+05:00
Pushed open banner (47d2675). Made VTABLE x NASCON promo poster: marketing/poster/poster.html (+ nascon-logo.png), rendered to marketing/poster/vtable-x-nascon-poster.png (2160x2700) via headless Chrome; phones are live iframes of the app, so render by copying the folder into web/_poster/ temporarily. Not committed.

## 2026-10-15T19:00:00+05:00
Pushed poster (3f2b738). Added "Not officially affiliated with FAST NUCES or NASCON." line to the poster footer (band now 270px tall) and re-rendered. Not committed.

## 2026-10-15T19:30:00+05:00
Pushed poster disclaimer (51e8da0). Faster app open: removed MIN_SPLASH_MS floor in mobile.js start() (routes immediately), and main.js now preloads exam-rooms/app/nascon-data/mobile/announcement scripts in parallel when the site is live. Bumped to v=58. Not committed.

## 2026-10-15T20:00:00+05:00
Free Rooms runs on the NASCON agenda for 2026-10-16..18 (phone + desktop): nasconRoomStatus() in nascon-data.js (now loaded before app.js) maps agenda venues to inventory rooms (DIT n->D-IT Lab n, Margalla->C-Margala, Karakorum->A-KK-I.., Khyber->A-Khyber I.., Potohar->B-Poth, A-block 3rd floor for Devils Lair, Cyber Lab, B-Digital etc.) and replaces the class timetable on those dates; desktop day picker gains Sunday on Day 3; phone card says Event. Not in inventory: A-108, C-109, D-102, D-Audi. Bumped to v=59. Not committed.

## 2026-10-15T20:30:00+05:00
Pushed NASCON Free Rooms (209112c). Added "Continue as guest" link on the mobile sign-in screen: sets vtable_skipped_login and goes to Today; remembered across launches; Profile shows Log in for guests. Bumped to v=60. Not committed.

## 2026-10-15T21:00:00+05:00
26I-0816 was deleted from Mongo by the user, but the Vercel CDN copy of /db/students/26.json (s-maxage 300, swr 3600) still listed it, so sign-in skipped registration. loadProfileStudents now appends ?fresh=<ts> and drops PROFILE_STUDENTS_CACHE, so sign-in always reads the DB. Bumped to v=61. Not committed.

## 2026-10-15T22:00:00+05:00
Desktop redesign: the .m-app shell is now the UI at every width (mobile.css no longer wrapped in max-width:767px; new web/css/desktop.css lays it out >=768px with a sidebar nav, wider grids, centred sign-in). Desktop never gates on sign-in: logged-out visitors are guests (.m-app.is-guest), with "Log in" in header + sidebar; guests get a landing on Today (guestHomeHTML, non-NASCON) and perks lists on locked screens. Logged-in desktop users get the avatar/bell, sidebar profile card, own Today/Week, My courses, friends, notifications. Old #timetable/#freerooms/... links map to the new routes; arcade opens by double-clicking the sidebar wordmark. bg3d loop skipped when hidden. Bumped to v=62.

## 2026-10-19T12:00:00+05:00
Removed NASCON '26 after the fest (Oct 16-18). Mobile Today/Week are the class timetable again (renderNascon* + whole NASCON section, promo poster, venue picker gone from mobile.js); Week tab label restored; Free Rooms no longer consults the agenda on phone or desktop (no Sunday in the desktop day picker, card says Class); mobile.css restored to pre-NASCON 30ed292 green theme + guest-button rules; theme-color back to #ffffff/#141414. Deleted web/js/nascon-data.js and web/assets/images/nascon-26.webp. Kept: guest login, seating-plan retirement, parallel script preload, no splash floor. marketing/poster/ left untouched. Rebased onto the desktop redesign (b126996): kept its unwrapped mobile.css/desktop.css, sidebar and guest landing; dropped its NASCON leftovers (is-nascon guest selector, maroon shadow, promo). Bumped to v=63. Verified in browser at 375px and 1280px, signed in and guest (local API 503s, so data was injected from TT to prove rendering).

## 2026-10-19T12:30:00+05:00
Deleted marketing/poster/ (VTABLE x NASCON promo poster: poster.html, nascon-logo.png, vtable-x-nascon-poster.png) at the user's request; nothing referenced it. No NASCON content left in the repo outside .ctx/log.md history.

## 2026-10-20T12:00:00+05:00
Sign-in screen: "Continue as guest" moved to the top of the sign-in card and made a full-size 62px pill (green outline on tint) instead of the small underlined link at the bottom; its note sits under it, then an "or log in" divider before the NU ID field. Bumped to v=64. Checked at 375px and 1280px.

## 2026-10-20T13:00:00+05:00
Guests land on Lookup: "Continue as guest" now goes to #/lookup instead of Today, and a returning phone guest (no profile, vtable_skipped_login set, no hash) opens on Lookup too. Desktop guests keep the guest landing on Today. Bumped to v=65. Checked at 375px: click -> Lookup, relaunch -> Lookup.

## 2026-10-26T12:00:00+05:00
Roster reads narrowed. `/api/auth/me` now returns the session account's own roster row (`student`), replacing `loadProfileStudents`/`getProfileDataFileForNuid` in desktop sign-in and mobile `finishSignIn`; auth outages fail closed with no public fallback. Mobile friend lookup now calls the new verified-session, exact-match `/api/roster/lookup` (name/department/batch only; 60 weighted/hour, 200/day, misses cost 5, events TTL 24h, `ROSTER_LOOKUP_ENABLED=0` kill switch). `api/db.mjs?doc=students/*` is behind `ALLOW_PUBLIC_ROSTER`; unset still allows for the first deploy, set 0 to deny. Integration test asserts the deny path; friend browser test mocks the new lookup. Bumped to v=67. Full DB/OTP and Playwright suites not run here (missing mongodb-memory-server and playwright).

## 2026-10-26T13:00:00+05:00
Auth OTP rate limiting now fails closed. `authRateCheck` and `authRateNote` in `lib/db/repos.mjs` throw on a storage fault instead of silently allowing the request, and `/api/auth/request-code` books both per-IP and per-NU-ID attempts before creating or emailing a code, so an unrecorded email can no longer bypass the counters. `auth:smoke` now asserts request-code returns 503 with no nonce cookie when the limiter is unreadable, and that rate booking propagates the failure. No frontend change, so no asset bump.

## 2026-10-27T12:00:00+05:00
Removed OTP from sign-in at the user's request. `/api/auth/request-code` now validates the NU ID, rate-limits per IP/NU ID, upserts the account, mints the session cookie and returns `{ok, verified, account}`; no email, challenge or nonce. Desktop `syncProfile` and mobile `doSignIn` call it and continue straight to `/api/auth/me`; code-entry UI is never shown. `/api/auth/verify`, otp.mjs, mailer.mjs and `scripts/auth/smoke-test.mjs` are left in place but unused/stale (smoke test still expects the OTP flow). Security note: anyone who knows an NU ID can now sign in as that student. Not committed; no asset version bump yet.

Bumped asset version to v=69 (OTP removal ships to browsers).

## 2026-11-02T14:45:00+05:00
Exam mode off after the 2nd Sessional (Oct 29 - Nov 2): EXAM_SEASON is {start:'',end:''} and the new EXAM_MODE flag gates everything, so isExamSeason stays false even on dates the exam schedules/seating plan still cover, and roomAvailabilityMessage no longer blocks Free Rooms while exam data loads or fails. Free Rooms is back on the class timetables (8 class / 4 lab slots); phone Today shows lecture cards again. Bumped to v=72. Checked at 375px: before = "Could not check exam dates..." (local API 503), after = block/floor picker and room bars.

## 2026-11-03T12:00:00+05:00
Restored OTP sign-in with a transactional mailer. Root cause of the 2026-10-27 outage: Gmail's outbound filter blocked the OTP burst. The society inbox has 29 OTP sends and 9 `Message blocked` DSNs from mailer-daemon@googlemail.com starting 03:23 PKT, each linking to Gmail error 69585; the App Password still sends a single test, so this was not the code. Added `lib/auth/email-config.mjs` and Resend support in `mailer.mjs` (`EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`), with SMTP only as a fallback. Restored the b6a3f26 request/verify flow and desktop/mobile code entry; added a 60s per-NU-ID cooldown, a 60/15min default per-IP limit (was 10), and an atomic global daily budget (`AUTH_EMAIL_BUDGET`, default 250, `OTP_DAILY_MAX`). `authConfigError` now accepts either Resend or SMTP. Verified with `npm run auth:smoke`, a full request-code -> verify flow against a throwaway Mongo DB, and mocked Resend/SMTP success and failure paths. Bumped assets to v=73. Not committed; production still needs a verified Resend domain/key before redeploying.

## 2026-11-04T02:00:00+05:00
FSM students are on the roster. `python/tools/student_profiles/build_fsm_directory.py fsmStudents` parses the two FSM Sessional I seating plans (8,512 papers) into `seating_plans/fsm-students-directory.json`, one row per student, department = seating-plan program code (BAF, BBA, BFT, BSBA, MB, MSBA, PMG), section = the section they sit most often in their own semester (ambiguous ones in the -report.json). Imported with `import-students.mjs --confirm --prune-self`: 17 self-registered rows where FSM students had picked a computing program were replaced; 3 roll nos in both the CS and FSM seating plans (24I-5569, 26I-4005, 26I-5102) are FSM only: their CS rows were removed with --prune. Directory: 2,190 students. Client: `BUSINESS_DEPT_LABELS` maps the codes to the business timetable's program names, roster profiles get `school:'business'`, registration offers FSC and FSM programs, `/api/register` stores FSM rows (`isRosterDept`); push subscriptions stay computing-only. Mobile "FOR FSE & FSM" button is now "FOR FSE" and the manual picker offers only FSE. Bumped to v=74.

## 2026-11-08T12:00:00+05:00
Fixed "OTP emailed but no code field" sign-ins. Causes: (1) a Resend timeout (8s abort) was treated as a failure, so the challenge was deleted and a 503 returned even though the email often went out; (2) a lost request-code reply (flaky data, gateway 504) left the browser with no challenge id; (3) on Android the NU ID box fires `input` when composition ends on blur, which happened as the code box took focus and hid it; (4) desktop ran `localStorage.setItem` before showing the code step and dropped the pending code on modal close. Now the browser generates the binding nonce (`client_nonce`) and remembers the request in sessionStorage before sending; `/api/auth/verify` accepts NU ID + nonce when it has no challenge id (`findLatestAuthChallenge`, new `by_nuid_recent` index). Mailer errors carry `definite`; only a clear refusal (4xx, SMTP reply code, auth/DNS) deletes the challenge, otherwise request-code returns 200 with `delivery: 'uncertain'`. A cooldown 429 while a code from this tab is still live re-shows its field. Cooldown/limits unchanged. Verified with `npm run auth:smoke` (new nonce + mailer checks) and scratch end-to-end runs against an in-memory Mongo stub and mocked Resend. Assets v=75.
