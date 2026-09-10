import unittest
import importlib.util
from unittest.mock import patch
from pathlib import Path

from seating_rooms import parse_pages, parse_pdf, free_rooms


class SeatingRoomsTest(unittest.TestCase):
    def test_sync_retains_per_exam_student_dates(self):
        path = Path(__file__).resolve().parents[1] / 'api/fetch-timetable.py'
        spec = importlib.util.spec_from_file_location('fetch_timetable_test', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        page = 'Dec 15, 2025 9:00 to 12:00 PM\nSeating Plan / Attendance List\nCS3004 - Software Design BCS-5A Room No.C-301 3rd Floor\n1 23I-0001 Example Student C1R6'
        parsed = parse_pages([page, page.replace('Dec 15', 'Dec 16')])
        with patch.object(module, 'parse_exam_rooms', return_value=parsed):
            doc = module.parse_seating_plan_email('', 'Seating plan', b'fixture')
        self.assertEqual(doc['count'], 2)
        self.assertEqual([s['date'] for s in doc['students']], ['2025-12-15', '2025-12-16'])
        self.assertEqual(doc['students'][0]['room'], 'C-301')
        self.assertTrue(doc['room_occupancy']['complete'])

    def test_headers_and_boundaries(self):
        page = 'Dec 15, 2025 9:00 to 12:00 PM\nSeating Plan / Attendance List\nCS3004 - Software Design BCS-5A Room No.C-301 3rd Floor\n1 23I-0001 Example Student C1R6'
        plan, students = parse_pages([page, page, 'Wednesday, December 17, 2025'])
        self.assertTrue(plan['complete'])
        self.assertEqual(plan['dates'], ['2025-12-15'])
        self.assertEqual(len(plan['bookings']), 1)
        self.assertEqual(plan['bookings'][0]['pages'], [1, 2])
        self.assertEqual(students[0]['room'], 'C-301')
        self.assertEqual(students[0]['seat'], 'C1R6')
        self.assertEqual(free_rooms(plan, ['C-301', 'C-306'], '2025-12-15', 719)['free'], ['C-306'])
        self.assertEqual(free_rooms(plan, ['C-301'], '2025-12-15', 720)['free'], ['C-301'])
        self.assertEqual(free_rooms(plan, ['C-301'], '2025-12-17', 600)['status'], 'unknown')
        broken, _ = parse_pages([page, 'Seating Plan / Attendance List\nRoom No.D-301'])
        self.assertFalse(broken['complete'])
        self.assertEqual(free_rooms(broken, ['C-306'], '2025-12-15', 600)['status'], 'unknown')

    def test_example_pdfs(self):
        root = Path(__file__).resolve().parents[1]
        examples = sorted(root.glob('Seating Plan of Final Exam*.pdf'))
        if len(examples) != 2:
            self.skipTest('Local example PDFs not present')
        for pdf in examples:
            with self.subTest(pdf=pdf.name):
                plan, students = parse_pdf(pdf.read_bytes())
                self.assertTrue(plan['complete'], plan['errors'])
                monday = 'Monday' in pdf.name
                self.assertEqual(plan['parsed_pages'], 107 if monday else 35)
                self.assertEqual(plan['dates'], ['2025-12-15' if monday else '2025-12-16'])
                self.assertEqual(plan['schools'], ['computing'])
                self.assertTrue(students)
                self.assertTrue(all(b['room'].startswith(('C-', 'D-')) for b in plan['bookings']))
                self.assertEqual({(b['start'], b['end']) for b in plan['bookings']}, {(540,720),(780,960),(1040,1220)} if monday else {(540,720),(780,960)})
                print(f"{pdf.name}: {plan['parsed_pages']} attendance pages, {len(plan['bookings'])} unique room/time bookings")


if __name__ == '__main__':
    unittest.main()
