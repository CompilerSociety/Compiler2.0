import unittest
from python.generate_timetable.schools.business import parse_fsm_course_name


class BusinessTimeTests(unittest.TestCase):
    def test_source_time_variants(self):
        for raw, expected in [
            ('SS2019Psychology 8:30 - 10:20', ('SS2019', 'Psychology', '08:30-10:20')),
            ('SS1013 Ideology and Constitution of Pakistan (10:00-11:50))',
             ('SS1013', 'Ideology and Constitution of Pakistan', '10:00-11:50')),
            ('SS1016 English - I (08:30-10:20)', ('SS1016', 'English - I', '08:30-10:20')),
            ('MG1001 Fundamental of Management', ('MG1001', 'Fundamental of Management', None)),
        ]:
            with self.subTest(raw=raw):
                self.assertEqual(parse_fsm_course_name(raw), expected)
