from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DB_DIR = ROOT / "db"


def _json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def _get_profile_file_for_nuid(nuid: str) -> Path:
    match = re.match(r"^(\d{2})", str(nuid or "").strip())
    year = match.group(1) if match else ""
    if year in {"22", "23", "24", "25", "26"}:
        return DB_DIR / "students" / f"{year}.json"
    return DB_DIR / "seating" / "plan.json"


def save_student_profile(payload: dict[str, Any]) -> dict[str, Any]:
    nuid = str(payload.get("nuid") or "").strip().upper()
    name = str(payload.get("name") or "").strip()
    section = str(payload.get("section") or "").strip()
    department = str(payload.get("department") or "").strip()
    batch = str(payload.get("batch") or "").strip()

    if not nuid or not name or not section or not department or not batch:
        raise ValueError("nuid, name, section, department, and batch are required")

    file_path = _get_profile_file_for_nuid(nuid)
    existing = _read_json(file_path)
    students = existing.get("students") if isinstance(existing.get("students"), list) else []

    new_student = {
        "name": name,
        "nuid": nuid,
        "section": section,
        "department": department,
        "batch": batch,
        "paper": "",
        "time": "",
        "class": "",
        "seat": "",
    }

    existing_index = next((index for index, student in enumerate(students) if str(student.get("nuid") or "").upper() == nuid), None)
    if existing_index is None:
        students.append(new_student)
    else:
        students[existing_index] = {**students[existing_index], **new_student}

    document = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "source_subject": f"Seating Plan {batch}",
        "count": len(students),
        "students": students,
    }
    _write_json(file_path, document)
    return {"ok": True, "student": new_student, "file": str(file_path.relative_to(ROOT))}


class handler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_OPTIONS(self) -> None:
        if self.path.startswith("/api/profile"):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self) -> None:
        if self.path.startswith("/api/profile"):
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length).decode("utf-8")
            try:
                payload = json.loads(body or "{}") if body else {}
                if not isinstance(payload, dict):
                    raise ValueError("Expected a JSON object")
                result = save_student_profile(payload)
                _json_response(self, 200, result)
            except Exception as exc:
                _json_response(self, 400, {"ok": False, "error": str(exc)})
            return

        _json_response(self, 404, {"ok": False, "error": "Not found"})

    def do_GET(self) -> None:
        if self.path.startswith("/api/profile"):
            _json_response(self, 200, {"ok": True, "message": "Profile endpoint is active"})
            return
        super().do_GET()

    def log_message(self, format: str, *args: Any) -> None:
        return


def main() -> None:
    port = int(os.environ.get("PORT", "8000"))
    address = ("0.0.0.0", port)
    server = ThreadingHTTPServer(address, handler)
    print(f"Profile server listening on http://127.0.0.1:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
