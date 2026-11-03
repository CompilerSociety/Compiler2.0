"""Build the FSM student directory from FSM seating-plan PDFs.

    python python/tools/student_profiles/build_fsm_directory.py fsmStudents

Writes seating_plans/fsm-students-directory.json (one row per student, the
same shape as seating_plans/students-directory.json) and a matching
-report.json, then load it with:

    node scripts/db/import-students.mjs seating_plans/fsm-students-directory.json [--confirm]

Each seating-plan group is headed by a course-section label such as
"AF1003,BAF-1A - Introduction to Financial Accounting": program BAF, semester 1,
section A. A student sits several papers, and repeaters also sit papers with
other sections, so their home section is the one they sit most often among the
papers of the semester their batch should be in (26 -> 1, 25 -> 3, ...). The
students where that is a guess are listed in the report.
"""

import collections
import json
import re
import sys
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "seating_plans" / "fsm-students-directory.json"
REPORT = ROOT / "seating_plans" / "fsm-students-directory-report.json"

STUDENT = re.compile(r"^(\d+)\s+(\d{2}I-\d{4})\s+(.+?)\s+(C\d+R\d+)\s*$")
GROUP = re.compile(r"^([A-Z]{2,4}\d{3,4}[A-Z]?)\s*,\s*([A-Z]{2,5})-(\d{1,2})([A-Z])\b")
NOT_A_NAME = re.compile(r"Sessional|SEATING|Date:|S#|School of|Roll No|Page \d|Generated|Venue")
FALL_YEAR = 26  # Fall 2026: batch 26 is in semester 1


def expected_semester(nuid):
    return (FALL_YEAR - int(nuid[:2])) * 2 + 1


def parse(pdf_dir):
    rows = []
    for pdf in sorted(Path(pdf_dir).glob("*.pdf")):
        with pdfplumber.open(pdf) as doc:
            for page in doc.pages:
                # Two columns of students per page. Split at the second "S#"
                # header so a wrapped name stays with its own column.
                heads = sorted(w["x0"] for w in page.extract_words() if w["text"] == "S#")
                split = heads[1] - 2 if len(heads) >= 2 else page.width / 2
                group = None
                for x0, x1 in ((0, split), (split, page.width)):
                    last = None
                    text = page.crop((x0, 0, x1, page.height)).extract_text() or ""
                    for line in (l.strip() for l in text.splitlines()):
                        m = GROUP.match(line)
                        if m:
                            group = {"dept": m[2], "sem": int(m[3]), "sec": m[4]}
                            last = None
                            continue
                        m = STUDENT.match(line)
                        if m and group:
                            last = {"nuid": m[2], "name": m[3], **group}
                            rows.append(last)
                            continue
                        if (last and line and line[0].isupper() and not NOT_A_NAME.search(line)
                                and re.fullmatch(r"[A-Za-z .'\-]+", line)):
                            last["name"] += " " + line  # long name wrapped
    return rows


def build(rows):
    by_nuid = collections.defaultdict(list)
    for r in rows:
        by_nuid[r["nuid"]].append(r)

    directory, irregular = [], []
    for nuid in sorted(by_nuid):
        papers = by_nuid[nuid]
        own = [p for p in papers if p["sem"] == expected_semester(nuid)]
        seen = collections.Counter(f'{p["dept"]}-{p["sem"]}{p["sec"]}' for p in papers)
        counts = collections.Counter((p["dept"], p["sec"]) for p in (own or papers))
        ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
        (dept, sec), top = ranked[0]
        names = collections.Counter(p["name"] for p in papers)
        name = sorted(names.items(), key=lambda kv: (-kv[1], -len(kv[0])))[0][0]
        directory.append({
            "_id": f"{nuid}:{dept}:{sec}",
            "nuid": nuid,
            "name": name,
            "department": dept,
            "section": sec,
            "batch": nuid[:2],
        })
        tied = len(ranked) > 1 and ranked[1][1] == top
        if not own or tied or len(seen) > 1:
            irregular.append({
                "nuid": nuid,
                "chosen": f"{dept}-{sec}",
                "reason": "no papers in own semester" if not own else ("tie" if tied else "mixed"),
                "seen": dict(seen),
            })
    return directory, irregular


def main():
    pdf_dir = sys.argv[1] if len(sys.argv) > 1 else ROOT / "fsmStudents"
    rows = parse(pdf_dir)
    directory, irregular = build(rows)
    OUT.write_text(json.dumps(directory, indent=1, ensure_ascii=False), encoding="utf-8")
    REPORT.write_text(json.dumps({"irregular": irregular}, indent=1, ensure_ascii=False), encoding="utf-8")
    by_dept = collections.Counter(r["department"] for r in directory)
    by_batch = collections.Counter(r["batch"] for r in directory)
    print(f"papers {len(rows)}  students {len(directory)}")
    print("by program", dict(sorted(by_dept.items())))
    print("by batch", dict(sorted(by_batch.items())))
    reasons = collections.Counter(i["reason"] for i in irregular)
    print("needs a look", dict(reasons))


if __name__ == "__main__":
    main()
