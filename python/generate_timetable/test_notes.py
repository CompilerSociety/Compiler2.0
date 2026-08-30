"""Regression checks for durable class-change notes.

Run from the repository root:
    python -m unittest python.generate_timetable.test_notes
"""

import unittest

from python.generate_timetable.output import convert_to_reference_format
from python.generate_timetable.schools.computing import add_course, parse_timetable_cell


class TimetableNoteTests(unittest.TestCase):
    def test_parser_extracts_trailing_status_without_polluting_course_name(self):
        parsed = parse_timetable_cell("Data St (CS-G) Rescheduled")
        self.assertEqual(parsed["course"], "Data St")
        self.assertEqual(parsed["note"], "Rescheduled")

    def test_output_keeps_note_optional_and_backward_compatible(self):
        tt = {"BS CS": {"2025": {"G": {"Monday": [
            {"c": "Data St", "l": "C-401", "t": "11:30-12:50", "n": "Rescheduled"},
            {"c": "PF", "l": "C-301", "t": "08:30-09:50"},
        ]}}}}
        entries = convert_to_reference_format(tt)["BS CS"]["2025"]["G"]["Monday"]
        self.assertEqual(entries[0]["note"], "Rescheduled")
        self.assertNotIn("note", entries[1])

    def test_duplicate_entry_retains_a_later_status_note(self):
        tt = {}
        self.assertTrue(add_course(tt, "BS CS", "2025", "G", "Monday", "Data St", "C-401", "11:30-12:50"))
        self.assertFalse(add_course(tt, "BS CS", "2025", "G", "Monday", "Data St", "C-401", "11:30-12:50", "Rescheduled"))
        entry = tt["BS CS"]["2025"]["G"]["Monday"][0]
        self.assertEqual(entry["n"], "Rescheduled")


if __name__ == "__main__":
    unittest.main()
