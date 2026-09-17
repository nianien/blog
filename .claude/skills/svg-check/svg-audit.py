#!/usr/bin/env python3
"""Delegate to the shared SVG implementation"""
import runpy
import sys
from pathlib import Path

shared = Path(__file__).resolve().parents[3] / ".agents" / "skills" / "svg-check"
sys.path.insert(0, str(shared))
if __name__ == "__main__":
    runpy.run_path(str(shared / "svg-audit.py"), run_name="__main__")
