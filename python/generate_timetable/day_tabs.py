"""Select one schedule per weekday, applying dated overrides only that week."""

import re
from datetime import date, datetime, timedelta, timezone

MONTHS = {name: i for i, name in enumerate(
    ('jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'), 1)}


def tab_date(tab):
    iso = re.search(r'\b(20\d{2})-(\d{1,2})-(\d{1,2})\b', tab)
    named = re.search(r'([A-Za-z]{3,9})\.?\s+(\d{1,2})\s*,?\s*(20\d{2})', tab)
    day_first = re.search(r'\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s*,?\s*(20\d{2})', tab)
    try:
        if iso:
            return date(*map(int, iso.groups()))
        if named or day_first:
            month, date_day, year = named.groups() if named else (
                day_first[2], day_first[1], day_first[3])
            return date(int(year), MONTHS[month[:3].lower()], int(date_day))
    except (ValueError, KeyError) as exc:
        raise ValueError(f"Invalid date in timetable tab: {tab!r}") from exc
    if re.search(r'\d', tab):
        raise ValueError(f"Unrecognised dated timetable tab: {tab!r}; use 'Saturday (Sep. 05, 2026)' or an ISO date")
    return None


def resolve_day_tab(tabs, day, today=None):
    today = today or datetime.now(timezone(timedelta(hours=5))).date()
    target = today - timedelta(days=today.weekday()) + timedelta(
        days=('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday').index(day))
    candidates = [t for t in tabs if re.match(rf'^{day}(?:\b|\s)', t.strip(), re.I)]
    bare = [t for t in candidates if t.strip().lower() == day.lower()]
    undated, active = [], []
    for tab in candidates:
        parsed_date = tab_date(tab)
        if parsed_date:
            if parsed_date.weekday() != target.weekday():
                raise ValueError(f"Tab weekday disagrees with its date: {tab!r}")
            if parsed_date == target:
                active.append(tab)
        elif tab not in bare:
            undated.append(tab)
    choices = active or (bare + undated)
    if len(choices) > 1:
        raise ValueError(f"Ambiguous {day} schedule: {choices}; refusing to choose by tab order")
    return choices[0] if choices else None
