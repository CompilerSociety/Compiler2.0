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
