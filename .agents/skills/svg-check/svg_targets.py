"""Resolve explicit SVG targets without silently widening the scope"""
from pathlib import Path

SVG_BASE = Path(__file__).resolve().parents[3] / "public" / "images" / "blog"


def collect_svg_files(targets, all_files=False):
    if all_files and targets:
        raise ValueError("--all cannot be combined with explicit targets")
    if not all_files and not targets:
        raise ValueError("Provide an SVG file, directory, or --all for read-only auditing")
    files = set()
    for target in ([SVG_BASE] if all_files else targets):
        candidate = Path(target)
        if not candidate.exists():
            candidate = SVG_BASE / candidate
        if not candidate.exists():
            raise ValueError(f"Target does not exist: {target}")
        if candidate.is_file():
            found = [candidate] if candidate.suffix.lower() == ".svg" else []
        else:
            found = [p for p in candidate.rglob("*") if p.is_file() and p.suffix.lower() == ".svg"]
        if not found:
            raise ValueError(f"No SVG files found: {target}")
        files.update(p.resolve() for p in found)
    return sorted(files)
