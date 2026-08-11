# Computing Timetable 2026 Changes

## Completed

- Updated the Python timetable generator's Computing spreadsheet ID in
  `python/generate_timetable/config.py` to:

  ```text
  1vlTuotLw34fedME3gNQj09cZw-todVomxAiu5P1wZ6Q
  ```

## Required matching URL updates

Update the same Computing spreadsheet ID in these files so the website and
Vercel API use the same 2026 sheet as the Python generator:

- `api/timetable.js` — `SCHOOLS.computing.id`
- `web/js/app.js` — `SCHOOLS.computing.id`

Keep the weekday tabs as `Monday` through `Friday` only if the new spreadsheet
uses those exact tab names.

## Show the 2026 batch

The website currently treats `2026` as a repeat-course bucket and hides it
from the normal Batch Year dropdown. In `web/js/app.js`, replace:

```js
const REPEAT_BATCH_KEYS=['REPEAT','2026'];
```

with:

```js
const REPEAT_BATCH_KEYS=['REPEAT'];
```

This keeps yellow repeat courses under `REPEAT` while allowing a genuine 2026
admission batch to be shown.

## Batch mappings

Add `26` to the explicit mappings used by the parsers:

```python
# python/generate_timetable/config.py
BATCH_MAP = {"26": "2026", "25": "2025", "24": "2024", "23": "2023", "22": "2022"}
```

```js
// api/timetable.js
const BATCH_MAP = { "26": "2026", "25": "2025", "24": "2024", "23": "2023", "22": "2022" };
```

## Regenerate timetable data

From the project root, run:

```powershell
python python\scripts\Script.py
```

The new Google Sheet must be shared with the service-account email listed in
`service-account.json`. After regeneration, `db/timetables/computing.json`
should contain the current batches supplied by the sheet.
