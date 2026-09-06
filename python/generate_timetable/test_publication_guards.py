"""Source failures must not replace the last published timetable."""
import io
import unittest
from contextlib import ExitStack, redirect_stdout
from datetime import date
from unittest.mock import patch

from python.generate_timetable import main
from python.generate_timetable.config import DAYS
from python.generate_timetable.day_tabs import resolve_day_tab
from python.generate_timetable.schools import computing, business, engineering


def timetable():
    return {'BS CS': {'2026': {'A': {'Monday': [{'c': 'Course', 't': '08:30-09:50', 'l': 'C-301'}]}}}}


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(redirect_stdout(io.StringIO()))
        self.stack.enter_context(patch.object(main.os.path, 'exists', return_value=True))
        self.stack.enter_context(patch.object(main, 'authenticate', return_value=object()))
        self.stack.enter_context(patch.object(main, 'build_colour_map'))
        self.stack.enter_context(patch.dict(main.COLOUR_BATCH_MAP, {'test': '2026'}, clear=True))
        self.stack.enter_context(patch.object(main, 'flush_debug_log'))
        self.write = self.stack.enter_context(patch.object(main, 'write_json', return_value=({}, 1)))

    def test_later_school_failure_prevents_every_write(self):
        for result in [RuntimeError('Engineering source unavailable'), ({}, 0)]:
            with self.subTest(result=result), \
                 patch.object(computing, 'generate', return_value=(timetable(), 1)), \
                 patch.object(business, 'generate', return_value=(timetable(), 1)), \
                 patch.object(engineering, 'generate') as generate:
                if isinstance(result, Exception):
                    generate.side_effect = result
                else:
                    generate.return_value = result
                with self.assertRaises(RuntimeError):
                    main.main()
                self.write.assert_not_called()

    def computing_source(self, tabs, fetch, parse=None):
        self.stack.enter_context(patch.object(computing, 'get_sheet_tab_names', return_value=tabs))
        self.fetch = self.stack.enter_context(patch.object(computing, 'fetch_sheet_with_colours', side_effect=fetch))
        self.stack.enter_context(patch.object(computing, 'resolve_day_tab',
            side_effect=lambda names, day: resolve_day_tab(names, day, date(2026, 9, 5))))

        def parse_grid(grid, colours, day, tt, pending, bare):
            tt.setdefault('BS CS', {}).setdefault('2026', {}).setdefault('A', {})[day] = [
                {'c': grid[0][0], 't': '08:30-09:50', 'l': 'C-301'}]
            return 1

        self.stack.enter_context(patch.object(computing, 'parse_grid_to_tt', side_effect=parse or parse_grid))

    def test_missing_saturday_prevents_publication(self):
        self.computing_source(DAYS[:-1], lambda *args: ([['normal']], []))
        with self.assertRaisesRegex(RuntimeError, 'Saturday'):
            main.main()
        self.write.assert_not_called()

    def test_failed_saturday_download_prevents_publication(self):
        def fetch(service, sid, tab):
            if tab == 'Saturday':
                raise OSError('download failed')
            return [['normal']], []
        self.computing_source(DAYS, fetch)
        with self.assertRaisesRegex(RuntimeError, 'fetch failed'):
            main.main()
        self.write.assert_not_called()

    def test_empty_saturday_grid_prevents_publication(self):
        self.computing_source(DAYS, lambda service, sid, tab: ([], []) if tab == 'Saturday' else ([['normal']], []))
        with self.assertRaisesRegex(RuntimeError, 'empty source'):
            main.main()
        self.write.assert_not_called()

    def test_unrecognised_layout_prevents_publication(self):
        self.computing_source(DAYS, lambda *args: ([['changed layout']], []), parse=lambda *args: 0)
        with self.assertRaisesRegex(RuntimeError, 'zero parsed classes'):
            main.main()
        self.write.assert_not_called()

    def test_saturday_override_reaches_generated_data_without_regular_classes(self):
        special = 'Saturday (Sep. 05, 2026)'
        self.computing_source([*DAYS, special], lambda service, sid, tab: ([[tab]], []))
        tt, count = computing.generate(object())
        self.assertEqual(count, 6)
        self.assertEqual([e['c'] for e in tt['BS CS']['2026']['A']['Saturday']], [special])
        self.assertNotIn('Saturday', [call.args[2] for call in self.fetch.call_args_list])

    def test_real_parser_keeps_exceptional_saturday_time_and_status(self):
        special = 'Saturday (Sep. 05, 2026)'
        def fetch(service, sid, tab):
            course = ('Calculus (CS-A, 26) 10:00-11:20 Cancelled' if tab == special
                      else 'PF (CS-A, 26)')
            header = ['Room'] + [''] * 16
            for col, time in zip((1, 6, 11, 16),
                                 ('08:30-09:50', '10:00-11:20', '11:30-12:50', '01:00-02:20')):
                header[col] = time
            return [header, ['C-301', course]], [[None] * 17, [None, None]]
        with patch.object(computing, 'get_sheet_tab_names', return_value=[*DAYS, special]), \
             patch.object(computing, 'fetch_sheet_with_colours', side_effect=fetch), \
             patch.object(computing, 'resolve_day_tab', side_effect=lambda tabs, day:
                          resolve_day_tab(tabs, day, date(2026, 9, 5))):
            tt, count = computing.generate(object())
        self.assertEqual(count, 6)
        self.assertEqual(tt['BS CS']['2026']['A']['Saturday'], [
            {'c': 'Calculus', 'l': 'C-301', 't': '10:00-11:20', 'n': 'Cancelled'}])

    def test_success_publishes_only_after_all_schools_parse(self):
        events = []
        def generate(name):
            events.append(name)
            return timetable(), 1
        self.write.side_effect = lambda *args: (events.append('write') or {}, 1)
        with patch.object(computing, 'generate', side_effect=lambda s: generate('computing')), \
             patch.object(business, 'generate', side_effect=lambda s: generate('business')), \
             patch.object(engineering, 'generate', side_effect=lambda s: generate('engineering')):
            main.main()
        self.assertEqual(events, ['computing', 'business', 'engineering', 'write', 'write', 'write'])
