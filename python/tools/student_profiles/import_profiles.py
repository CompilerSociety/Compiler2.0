import json
import re
from datetime import datetime, timezone
from pathlib import Path

import pypdf

ROOT = Path(__file__).resolve().parents[2]
PDF_PATH = ROOT / "docs" / "student-rosters" / "final_24_25_clean.pdf"
DB_DIR = ROOT / "db"


def parse_section_code(code: str) -> tuple[str, str]:
    cleaned = (code or "").strip().upper()
    if not cleaned:
        return "", ""
    match = re.fullmatch(r"([A-Z]{2,4})-([A-Z])", cleaned)
    if not match:
        return "", ""
    department = match.group(1)
    if department.startswith("B"):
        department = department[1:]
    return department, match.group(2)


def parse_students_from_pdf() -> tuple[list[dict], list[dict]]:
    reader = pypdf.PdfReader(str(PDF_PATH))
    all_lines: list[str] = []
    for page in reader.pages:
        text = page.extract_text(extraction_mode="layout") or ""
        all_lines.extend(text.splitlines())

    students_24: list[dict] = []
    students_25: list[dict] = []
    current: dict | None = None
    for line in all_lines:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("Unique") or stripped.startswith("Roll No") or stripped.startswith("Section") or stripped.startswith("Name"):
            continue

        if re.match(r"^\d{2}I-\d+", stripped):
            parts = re.split(r"\s{2,}", stripped)
            if len(parts) >= 2:
                nuid = parts[0].strip().upper()
                name = parts[1].strip()
                batch = nuid[:2]
                current = {
                    "name": name,
                    "nuid": nuid,
                    "section": "",
                    "department": "",
                    "batch": batch,
                }
                if batch == "24":
                    students_24.append(current)
                elif batch == "25":
                    students_25.append(current)
            continue

        if current is not None and not re.match(r"^\d{2}I-\d+", stripped):
            if re.fullmatch(r"[A-Z]{2,4}-[A-Z]", stripped.upper()):
                department, section = parse_section_code(stripped)
                current["department"] = department
                current["section"] = section
                continue
            if stripped.upper().startswith("SECTION"):
                continue

    return students_24, students_25


def write_students(batch: str, students: list[dict]) -> None:
    payload = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "source_subject": f"Seating Plan {batch}",
        "count": len(students),
        "students": students,
    }
    out_path = DB_DIR / f"{batch}.json"
    with out_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


if __name__ == "__main__":
    students_24, students_25 = parse_students_from_pdf()
    print(f"Parsed {len(students_24)} 24-batch students and {len(students_25)} 25-batch students")
    if students_24:
        print("Sample 24:", students_24[0])
    if students_25:
        print("Sample 25:", students_25[0])
    write_students("24", students_24)
    write_students("25", students_25)
    print(f"Wrote {len(students_24)} records to db/students/24.json")
    print(f"Wrote {len(students_25)} records to db/students/25.json")
