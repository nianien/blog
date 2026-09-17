#!/usr/bin/env python3
"""
SVG 审计工具：区分文件错误、样式与几何提醒、需人工核对的范围

用法:
    # 审计所有 SVG，显式传 --all
    python3 .agents/skills/svg-check/svg-audit.py --all

    # 只审计某个目录
    python3 .agents/skills/svg-check/svg-audit.py agentic-09

    # 只做规范检查（跳过几何检查）
    python3 .agents/skills/svg-check/svg-audit.py agentic-09 --convention-only

    # 只做几何检查（跳过规范检查）
    python3 .agents/skills/svg-check/svg-audit.py agentic-09 --geometry-only

检查内容:
  基础错误 (Error):
    - XML 无效、根节点非 svg、缺少或无效 viewBox

  样式提醒 (Convention):
    - 缺少 font-family 属性
    - 使用了 <marker> 元素（项目样式约定）
    - 使用了 <style> 块（默认建议内联属性）
    - stroke-width 不是 1.5

  几何提醒 (Geometry):
    - rect/line/polygon/text 溢出 viewBox
    - 孤立 rect（无文字的矩形，可能是 ghost element）
    - 元素离 viewBox 边缘太近（< 15px）
"""
import argparse, math, re, sys
import xml.etree.ElementTree as ET
from svg_targets import collect_svg_files
from pathlib import Path

# ── 自动定位项目根目录 ──────────────────────────────────────
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent.parent  # .agents/skills/svg-check → 项目根
SVG_BASE = PROJECT_ROOT / "public" / "images" / "blog"


# ═══════════════════════════════════════════════════════════════
#  Part 1: 规范检查 (Convention Audit)
# ═══════════════════════════════════════════════════════════════


def validate_svg(root):
    """Validate required file properties regardless of audit mode"""
    if root.tag.split("}")[-1] != "svg":
        raise ValueError("Root element must be svg")
    if "viewBox" not in root.attrib:
        raise ValueError("Root svg is missing viewBox")
    values = [float(v) for v in re.split(r"[\s,]+", root.attrib["viewBox"].strip())]
    if len(values) != 4 or not all(math.isfinite(v) for v in values) or min(values[2:]) <= 0:
        raise ValueError("viewBox must contain four finite numbers with positive width and height")
    return tuple(values)


def convention_audit(filepath):
    """Report differences from default project styles"""
    root = ET.parse(filepath).getroot()
    issues = []
    if "font-family" not in root.attrib:
        issues.append(("NO_FONT_FAMILY", "Root svg is missing font-family"))
    for element in root.iter():
        tag = element.tag.split("}")[-1]
        if tag in {"marker", "style"}:
            issues.append(("HAS_" + tag.upper(), f"{tag} differs from default styles; verify actual rendering"))
        if any(key.startswith("marker-") for key in element.attrib):
            issues.append(("MARKER_REF", "Marker reference requires manual review"))
        width = element.get("stroke-width")
        if width is not None and width != "1.5":
            issues.append(("STROKE_WIDTH", f"stroke-width={width}; default recommendation is 1.5"))
    return issues


# ═══════════════════════════════════════════════════════════════
#  Part 2: 几何检查 (Geometry Audit)
# ═══════════════════════════════════════════════════════════════

def parse_viewbox(content):
    return validate_svg(ET.fromstring(content))


def find_rects(content):
    rects = []
    for m in re.finditer(r"<rect\s+([^/]*)/>", content):
        attrs = m.group(1)
        x = float(re.search(r'(?<![\w:-])x="([^"]+)"', attrs).group(1)) if re.search(r'(?<![\w:-])x="([^"]+)"', attrs) else 0
        y = float(re.search(r'(?<![\w:-])y="([^"]+)"', attrs).group(1)) if re.search(r'(?<![\w:-])y="([^"]+)"', attrs) else 0
        w = float(re.search(r'(?<![\w:-])width="([^"]+)"', attrs).group(1)) if re.search(r'(?<![\w:-])width="([^"]+)"', attrs) else 0
        h = float(re.search(r'(?<![\w:-])height="([^"]+)"', attrs).group(1)) if re.search(r'(?<![\w:-])height="([^"]+)"', attrs) else 0
        rects.append({"x": x, "y": y, "w": w, "h": h, "right": x + w, "bottom": y + h})
    return rects


def find_lines(content):
    lines = []
    for m in re.finditer(r"<line\s+([^/]*)/>", content):
        attrs = m.group(1)
        try:
            x1 = float(re.search(r'(?<![\w:-])x1="([^"]+)"', attrs).group(1))
            y1 = float(re.search(r'(?<![\w:-])y1="([^"]+)"', attrs).group(1))
            x2 = float(re.search(r'(?<![\w:-])x2="([^"]+)"', attrs).group(1))
            y2 = float(re.search(r'(?<![\w:-])y2="([^"]+)"', attrs).group(1))
            lines.append({"x1": x1, "y1": y1, "x2": x2, "y2": y2})
        except (AttributeError, ValueError):
            continue
    return lines


def find_texts(content):
    texts = []
    for m in re.finditer(r"<text\s+([^>]*)>([^<]*)</text>", content):
        attrs = m.group(1)
        text_content = m.group(2).strip()
        x = float(re.search(r'(?<![\w:-])x="([^"]+)"', attrs).group(1)) if re.search(r'(?<![\w:-])x="([^"]+)"', attrs) else 0
        y = float(re.search(r'(?<![\w:-])y="([^"]+)"', attrs).group(1)) if re.search(r'(?<![\w:-])y="([^"]+)"', attrs) else 0
        texts.append({"x": x, "y": y, "text": text_content})
    return texts


def find_polygons(content):
    polys = []
    for m in re.finditer(r'<polygon\s+points="([^"]+)"', content):
        coords = []
        for pt in m.group(1).strip().split():
            pt = pt.strip().strip(",")
            if not pt:
                continue
            parts = pt.split(",")
            parts = [p.strip() for p in parts if p.strip()]
            if len(parts) == 2:
                try:
                    coords.append((float(parts[0]), float(parts[1])))
                except ValueError:
                    continue
        polys.append({"coords": coords})
    return polys


def check_orphan_rects(rects, texts):
    """找出没有文字的 rect（可能是 ghost element）。"""
    orphans = []
    for rect in rects:
        if rect["w"] < 30 or rect["h"] < 20:
            continue
        has_text = False
        for t in texts:
            if rect["x"] <= t["x"] <= rect["right"] and rect["y"] <= t["y"] <= rect["bottom"]:
                has_text = True
                break
        if not has_text:
            center_x = rect["x"] + rect["w"] / 2
            for t in texts:
                if abs(t["x"] - center_x) < rect["w"] / 2 + 10 and rect["y"] <= t["y"] <= rect["bottom"] + 5:
                    has_text = True
                    break
        if not has_text:
            orphans.append(rect)
    return orphans


def geometry_audit(filepath):
    """检查 SVG 元素是否溢出 viewBox、是否有孤立元素、是否太贴边。"""
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    vb_x, vb_y, vb_w, vb_h = parse_viewbox(content)
    issues = []
    margin = 5  # 溢出容差 px

    rects = find_rects(content)
    lines = find_lines(content)
    texts = find_texts(content)
    polys = find_polygons(content)

    # 1. rect 溢出
    for r in rects:
        if r["right"] > vb_x + vb_w + margin:
            issues.append(("RECT_OVERFLOW_RIGHT", f"rect({r['x']},{r['y']}) w={r['w']} → x={r['right']:.0f}, viewBox宽={vb_w:.0f}"))
        if r["bottom"] > vb_y + vb_h + margin:
            issues.append(("RECT_OVERFLOW_BOTTOM", f"rect({r['x']},{r['y']}) h={r['h']} → y={r['bottom']:.0f}, viewBox高={vb_h:.0f}"))
        if r["x"] < vb_x - margin:
            issues.append(("RECT_OVERFLOW_LEFT", f"rect x={r['x']:.0f}, viewBox起始={vb_x:.0f}"))

    # 2. line 溢出
    for l in lines:
        for coord, dim, label in [(l["x1"], vb_w, "x1"), (l["x2"], vb_w, "x2")]:
            if coord > vb_x + vb_w + margin:
                issues.append(("LINE_OVERFLOW", f"line {label}={coord:.0f} > viewBox宽={vb_w:.0f}"))
        for coord, dim, label in [(l["y1"], vb_h, "y1"), (l["y2"], vb_h, "y2")]:
            if coord > vb_y + vb_h + margin:
                issues.append(("LINE_OVERFLOW", f"line {label}={coord:.0f} > viewBox高={vb_h:.0f}"))

    # 3. polygon 溢出
    for p in polys:
        for cx, cy in p["coords"]:
            if cx > vb_x + vb_w + margin or cy > vb_y + vb_h + margin:
                issues.append(("POLYGON_OVERFLOW", f"polygon点({cx:.0f},{cy:.0f}) 超出 viewBox({vb_w:.0f}x{vb_h:.0f})"))
                break

    # 4. 孤立 rect
    for o in check_orphan_rects(rects, texts):
        issues.append(("ORPHAN_RECT", f"rect({o['x']},{o['y']}) {o['w']}x{o['h']} 无文字 → 可能是 ghost element"))

    # 5. text 溢出
    for t in texts:
        if t["x"] > vb_x + vb_w + margin:
            issues.append(("TEXT_OVERFLOW", f"text '{t['text'][:20]}' x={t['x']:.0f} > viewBox宽"))
        if t["y"] > vb_y + vb_h + margin:
            issues.append(("TEXT_OVERFLOW", f"text '{t['text'][:20]}' y={t['y']:.0f} > viewBox高"))

    # 6. 贴边检查
    tight = 15
    for r in rects:
        rem_r = (vb_x + vb_w) - r["right"]
        rem_b = (vb_y + vb_h) - r["bottom"]
        if 0 < rem_r < tight and r["w"] > 50:
            issues.append(("TIGHT_RIGHT", f"rect({r['x']},{r['y']}) 距右边缘仅 {rem_r:.0f}px"))
        if 0 < rem_b < tight and r["h"] > 30:
            issues.append(("TIGHT_BOTTOM", f"rect({r['x']},{r['y']}) 距下边缘仅 {rem_b:.0f}px"))

    return issues


# ═══════════════════════════════════════════════════════════════
#  Main
# ═══════════════════════════════════════════════════════════════


def main():
    parser = argparse.ArgumentParser(description="SVG static audit; browser validation is still required")
    parser.add_argument("targets", nargs="*", help="SVG files, directories, or image directory names")
    parser.add_argument("--all", action="store_true", help="Audit all blog SVG files without modifying them")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--convention-only", action="store_true")
    mode.add_argument("--geometry-only", action="store_true")
    args = parser.parse_args()
    try:
        files = collect_svg_files(args.targets, all_files=args.all)
    except ValueError as error:
        parser.error(str(error))
    errors = warnings = manual_files = 0
    for path in files:
        try:
            root = ET.parse(path).getroot()
            validate_svg(root)
            manual = False
            issues = []
            if not args.geometry_only:
                issues.extend(("C:" + code, message) for code, message in convention_audit(path))
            if not args.convention_only:
                if any("transform" in element.attrib for element in root.iter()):
                    manual = True
                    print(f"MANUAL {path.name}: transformed geometry requires browser measurement")
                else:
                    try:
                        issues.extend(("G:" + code, message) for code, message in geometry_audit(path))
                    except (ValueError, AttributeError, IndexError) as error:
                        manual = True
                        print(f"MANUAL {path.name}: unsupported coordinate syntax: {error}")
                if any(element.tag.split("}")[-1] in {"path", "circle", "ellipse", "polyline", "tspan"} for element in root.iter()):
                    manual = True
                    print(f"MANUAL {path.name}: complex elements are not fully covered by static geometry")
            for code, message in issues:
                print(f"WARN {path}: [{code}] {message}")
            warnings += len(issues)
            manual_files += int(manual)
        except (ET.ParseError, ValueError, OSError) as error:
            errors += 1
            print(f"ERROR {path}: [INVALID_SVG] {error}")
    print(f"Scanned {len(files)} SVG; errors: {errors}; warnings: {warnings}; manual review: {manual_files} file(s)")
    print("Static checks do not validate diagram semantics, text bounds, arrow direction or visual overlap")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
