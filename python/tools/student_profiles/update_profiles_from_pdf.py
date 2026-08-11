import json
import re
from pathlib import Path
import pypdf

ROOT = Path(__file__).resolve().parents[2]
pdf_path = ROOT / "docs" / "student-rosters" / "23I_Seating_Extract.pdf"
reader = pypdf.PdfReader(str(pdf_path))
text = '\n'.join(page.extract_text(extraction_mode='layout') or '' for page in reader.pages)

records = []
for line in text.splitlines():
    raw = line.strip()
    if not raw:
        continue
    if raw.startswith('Unique') or raw.startswith('Roll No') or raw.startswith('Section') or raw.startswith('Name'):
        continue
    m = re.match(r'^(\d{2}I-\d+)\s{2,}(.+)$', raw)
    if not m:
        continue
    nuid = m.group(1).strip().upper()
    name = m.group(2).strip()
    records.append((nuid[:2], nuid, name))

students = []
for b, nuid, name in records:
    if b != '23':
        continue
    section_match = re.search(r'\b([A-Z]{2,4}-[0-9A-Z]+)\b', name)
    if section_match:
        code = section_match.group(1).upper()
        dep_raw, section_tail = code.split('-', 1)
        department = dep_raw[1:] if dep_raw.startswith('B') else dep_raw
        section = re.search(r'([A-Z])$', section_tail)
        section = section.group(1) if section else ''
    else:
        department = ''
        section = ''
    clean_name = re.sub(r'\b([A-Z]{2,4}-[0-9A-Z]+)\b', '', name).strip()
    students.append({
        'name': clean_name,
        'nuid': nuid,
        'section': section,
        'department': department,
        'batch': '23',
    })
payload = {
    'updated_at': '',
    'source_subject': 'Seating Plan 23',
    'count': len(students),
    'students': students,
}
ROOT / 'db' / 'students' / '23.json'.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
print('23', len(students))
