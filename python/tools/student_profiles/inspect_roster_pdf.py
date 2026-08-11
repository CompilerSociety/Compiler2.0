import re
from pathlib import Path
import pypdf

ROOT = Path(__file__).resolve().parents[2]
pdf_path = ROOT / "docs" / "student-rosters" / "final_24_25_clean.pdf"
reader = pypdf.PdfReader(str(pdf_path))
lines = []
for page in reader.pages:
    text = page.extract_text(extraction_mode='layout') or ''
    lines.extend(text.splitlines())

print('total_lines', len(lines))
for line in lines[:80]:
    print(repr(line))
