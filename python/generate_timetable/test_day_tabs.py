import unittest
from datetime import date
from python.generate_timetable.day_tabs import resolve_day_tab


class DayTabTests(unittest.TestCase):
    def test_exception_replaces_regular_saturday_regardless_of_tab_order(self):
        special = 'Saturday (Sep. 05, 2026)'
        for tabs in ([special, 'Saturday'], ['Saturday', special]):
            self.assertEqual(resolve_day_tab(tabs, 'Saturday', date(2026, 9, 5)), special)
            self.assertEqual(resolve_day_tab(tabs, 'Saturday', date(2026, 9, 6)), special)

    def test_old_and_future_overrides_do_not_replace_this_week(self):
        tabs = ['Saturday (Sep. 05,2026)', 'Saturday (Sep. 19,2026)', 'Saturday']
        self.assertEqual(resolve_day_tab(tabs, 'Saturday', date(2026, 9, 12)), 'Saturday')

    def test_selects_matching_date_among_multiple_overrides(self):
        tabs = ['Saturday (Sep. 12,2026)', 'Saturday (Sep. 05,2026)', 'Saturday']
        self.assertEqual(resolve_day_tab(tabs, 'Saturday', date(2026, 9, 5)), tabs[1])

    def test_does_not_reuse_expired_override_without_regular_tab(self):
        self.assertIsNone(resolve_day_tab(['Saturday (Sep. 05,2026)'], 'Saturday', date(2026, 9, 12)))

    def test_regular_weekday_and_undated_renaming(self):
        self.assertEqual(resolve_day_tab([' Monday '], 'Monday', date(2026, 9, 5)), ' Monday ')
        self.assertEqual(resolve_day_tab(['Saturday revised'], 'Saturday', date(2026, 9, 5)), 'Saturday revised')

    def test_supported_date_formats(self):
        for tab in ['Saturday (2026-09-05)', 'Saturday (5 September 2026)',
                    'saturday (September 5, 2026)']:
            self.assertEqual(resolve_day_tab(['Saturday', tab], 'Saturday', date(2026, 9, 5)), tab)

    def test_bad_dates_and_conflicting_tabs_fail_visibly(self):
        for tabs in [
            ['Saturday (Sep. 99, 2026)'], ['Saturday (05/09/2026)'],
            ['Saturday (Sep. 06, 2026)'],
            ['Saturday (Sep. 05, 2026)', 'Saturday (2026-09-05)'],
            ['Saturday', 'Saturday revised'],
        ]:
            with self.subTest(tabs=tabs), self.assertRaises(ValueError):
                resolve_day_tab(tabs, 'Saturday', date(2026, 9, 5))

    def test_year_boundary_uses_the_week_of_the_requested_day(self):
        tab = 'Saturday (Jan. 02, 2027)'
        self.assertEqual(resolve_day_tab(['Saturday', tab], 'Saturday', date(2026, 12, 31)), tab)

    def test_local_week_rolls_over_at_pakistan_midnight(self):
        from datetime import datetime, timezone
        from unittest.mock import patch
        tab = 'Saturday (Sep. 05, 2026)'
        for utc, expected in [(datetime(2026, 9, 6, 18, 59, tzinfo=timezone.utc), tab),
                              (datetime(2026, 9, 6, 19, 0, tzinfo=timezone.utc), 'Saturday')]:
            with patch('python.generate_timetable.day_tabs.datetime') as clock:
                clock.now.side_effect = lambda tz: utc.astimezone(tz)
                self.assertEqual(resolve_day_tab(['Saturday', tab], 'Saturday'), expected)
