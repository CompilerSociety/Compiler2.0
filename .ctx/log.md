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
