#!/usr/bin/env python3
"""Conservative SVG attribute fixes; complex graphics require manual review"""
import argparse
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from xml.sax.saxutils import quoteattr

from svg_targets import collect_svg_files

FONT_FAMILY = "system-ui, -apple-system, 'PingFang SC', sans-serif"


def fix_svg(filepath, dry_run=False):
    path = Path(filepath)
    original = path.read_text(encoding="utf-8")
    root = ET.fromstring(original)
    if root.tag.split("}")[-1] != "svg":
        raise ValueError("Root element must be svg")
    for element in root.iter():
        if element.tag.split("}")[-1] in {"marker", "style"}:
            raise ValueError("marker/style requires manual review; file left unchanged")
        if any(key.startswith("marker-") or key in {"class", "style"} for key in element.attrib):
            raise ValueError("Marker or CSS attributes require manual review; file left unchanged")
    match = re.search(r"<svg\b[^>]*>", original)
    if not match:
        raise ValueError("Cannot safely locate an unprefixed svg root")
    tag = match.group()
    changes = []
    attrs = []
    if "viewBox" not in root.attrib:
        values = [root.get("width", ""), root.get("height", "")]
        if not all(re.fullmatch(r"\d+(?:\.\d+)?(?:px)?", v) for v in values):
            raise ValueError("Missing viewBox and explicit numeric dimensions; file left unchanged")
        dimensions = [v.removesuffix("px") for v in values]
        if any(float(v) <= 0 for v in dimensions):
            raise ValueError("Dimensions must be positive")
        attrs.append('viewBox="0 0 ' + " ".join(dimensions) + '"')
        changes.append("added viewBox")
    if "font-family" not in root.attrib:
        attrs.append("font-family=" + quoteattr(FONT_FAMILY))
        changes.append("added font-family")
    if attrs:
        tag = re.sub(r"(\s*/?>)$", lambda m: " " + " ".join(attrs) + m.group(1), tag)
    content = original[:match.start()] + tag + original[match.end():]
    ET.fromstring(content)
    if content != original and not dry_run:
        path.write_text(content, encoding="utf-8")
    return changes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("targets", nargs="+", help="Explicit SVG files or directories")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    try:
        files = collect_svg_files(args.targets)
    except ValueError as error:
        parser.error(str(error))
    failed = 0
    changed = 0
    for path in files:
        try:
            changes = fix_svg(path, dry_run=args.dry_run)
            if changes:
                changed += 1
                print(f"{path}: {', '.join(changes)}")
        except (ValueError, ET.ParseError, OSError) as error:
            failed += 1
            print(f"REFUSED {path}: {error}", file=sys.stderr)
    print(f"Scanned {len(files)} SVG; {'would change' if args.dry_run else 'changed'} {changed}; refused {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
