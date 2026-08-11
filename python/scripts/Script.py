#!/usr/bin/env python3
"""Compatibility entry point for the timetable generator."""

import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = PROJECT_ROOT / "python"
sys.path.insert(0, str(PYTHON_ROOT))
os.chdir(PROJECT_ROOT)

from generate_timetable.main import main


if __name__ == "__main__":
    main()
