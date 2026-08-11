from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
(ROOT / "test_output.txt").write_text("ok", encoding="utf-8")
