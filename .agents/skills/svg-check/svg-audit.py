#!/usr/bin/env python3
"""
SVG 审计工具：检查博客 SVG 文件的规范合规性和几何问题。

用法:
    # 审计所有 SVG
    python scripts/svg-audit.py

    # 只审计某个目录
    python scripts/svg-audit.py agentic-09

    # 只做规范检查（跳过几何检查）
    python scripts/svg-audit.py --convention-only

    # 只做几何检查（跳过规范检查）
    python scripts/svg-audit.py --geometry-only

检查内容:
  规范检查 (Convention):
    - 缺少 viewBox 属性
    - 缺少 font-family 属性
    - 使用了 <marker> 元素（博客渲染不支持）
    - 使用了 <style> 块（应改为内联属性）
    - stroke-width 不是 1.5

  几何检查 (Geometry):
    - rect/line/polygon/text 溢出 viewBox
    - 孤立 rect（无文字的矩形，可能是 ghost element）
    - 元素离 viewBox 边缘太近（< 15px）
"""
import re, os, sys, glob
from pathlib import Path

# ── 自动定位项目根目录 ──────────────────────────────────────
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent.parent  # .claude/skills/svg-check → 项目根
SVG_BASE = PROJECT_ROOT / "public" / "images" / "blog"


# ═══════════════════════════════════════════════════════════════
#  Part 1: 规范检查 (Convention Audit)
# ═══════════════════════════════════════════════════════════════

def convention_audit(filepath):
    """检查 SVG 是否符合 CLAUDE.md 中定义的绘制约定。"""
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    issues = []
    first_tag = content.split(">")[0]

    # 1. viewBox
    if "viewBox" not in content:
        issues.append(("NO_VIEWBOX", "缺少 viewBox 属性"))

    # 2. font-family on root <svg>
    if "font-family" not in first_tag:
        issues.append(("NO_FONT_FAMILY", "根 <svg> 缺少 font-family 属性"))

    # 3. <marker> element
    if "<marker" in content:
        count = content.count("<marker")
        issues.append(("HAS_MARKER", f"使用了 <marker> 元素 ({count} 处)，应改为 <polygon> 箭头"))

    # 4. <style> block
    if "<style" in content:
        issues.append(("HAS_STYLE", "使用了 <style> 块，应改为内联属性"))

    # 5. stroke-width="2"
    sw2_count = content.count('stroke-width="2"')
    if sw2_count > 0:
        issues.append(("STROKE_WIDTH_2", f'stroke-width="2" 出现 {sw2_count} 处，应为 "1.5"'))

    # 6. marker-end 残留
    if "marker-end=" in content:
        issues.append(("MARKER_END_REF", "残留 marker-end 属性引用"))

    return issues


# ═══════════════════════════════════════════════════════════════
#  Part 2: 几何检查 (Geometry Audit)
# ═══════════════════════════════════════════════════════════════

def parse_viewbox(content):
    m = re.search(r'viewBox="([^"]+)"', content)
    if not m:
        return None
    parts = m.group(1).split()
    return float(parts[0]), float(parts[1]), float(parts[2]), float(parts[3])


def find_rects(content):
    rects = []
    for m in re.finditer(r"<rect\s+([^/]*)/>", content):
        attrs = m.group(1)
        x = float(re.search(r'x="([^"]+)"', attrs).group(1)) if re.search(r'x="([^"]+)"', attrs) else 0
        y = float(re.search(r'y="([^"]+)"', attrs).group(1)) if re.search(r'y="([^"]+)"', attrs) else 0
        w = float(re.search(r'width="([^"]+)"', attrs).group(1)) if re.search(r'width="([^"]+)"', attrs) else 0
        h = float(re.search(r'height="([^"]+)"', attrs).group(1)) if re.search(r'height="([^"]+)"', attrs) else 0
        rects.append({"x": x, "y": y, "w": w, "h": h, "right": x + w, "bottom": y + h})
    return rects


def find_lines(content):
    lines = []
    for m in re.finditer(r"<line\s+([^/]*)/>", content):
        attrs = m.group(1)
        try:
            x1 = float(re.search(r'x1="([^"]+)"', attrs).group(1))
            y1 = float(re.search(r'y1="([^"]+)"', attrs).group(1))
            x2 = float(re.search(r'x2="([^"]+)"', attrs).group(1))
            y2 = float(re.search(r'y2="([^"]+)"', attrs).group(1))
            lines.append({"x1": x1, "y1": y1, "x2": x2, "y2": y2})
        except (AttributeError, ValueError):
            continue
    return lines


def find_texts(content):
    texts = []
    for m in re.finditer(r"<text\s+([^>]*)>([^<]*)</text>", content):
        attrs = m.group(1)
        text_content = m.group(2).strip()
        x = float(re.search(r'x="([^"]+)"', attrs).group(1)) if re.search(r'x="([^"]+)"', attrs) else 0
        y = float(re.search(r'y="([^"]+)"', attrs).group(1)) if re.search(r'y="([^"]+)"', attrs) else 0
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

    vb = parse_viewbox(content)
    if not vb:
        return [("NO_VIEWBOX", "缺少 viewBox，无法做几何检查")]

    vb_x, vb_y, vb_w, vb_h = vb
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
    # 解析参数
    args = sys.argv[1:]
    convention_only = "--convention-only" in args
    geometry_only = "--geometry-only" in args
    args = [a for a in args if not a.startswith("--")]

    # 确定扫描目录
    if args:
        target = args[0]
        svg_dirs = sorted(glob.glob(str(SVG_BASE / target)))
        if not svg_dirs:
            # 尝试作为子目录名
            svg_dirs = sorted(glob.glob(str(SVG_BASE / f"{target}*")))
        if not svg_dirs:
            print(f"❌ 找不到匹配 '{target}' 的 SVG 目录")
            sys.exit(1)
    else:
        svg_dirs = sorted(d for d in SVG_BASE.iterdir() if d.is_dir())

    total_files = 0
    total_issues = 0
    files_with_issues = 0

    for svg_dir in svg_dirs:
        svg_dir = Path(svg_dir)
        if not svg_dir.is_dir():
            continue
        dir_name = svg_dir.name

        for svg_file in sorted(svg_dir.glob("*.svg")):
            total_files += 1
            filename = svg_file.name
            all_issues = []

            if not geometry_only:
                all_issues.extend(("C:" + code, desc) for code, desc in convention_audit(svg_file))

            if not convention_only:
                all_issues.extend(("G:" + code, desc) for code, desc in geometry_audit(svg_file))

            # 去重 NO_VIEWBOX（规范和几何都会报）
            seen = set()
            deduped = []
            for code, desc in all_issues:
                key = code.split(":")[-1]
                if key == "NO_VIEWBOX" and key in seen:
                    continue
                seen.add(key)
                deduped.append((code, desc))

            if deduped:
                files_with_issues += 1
                print(f"\n{'─'*60}")
                print(f"❌ {dir_name}/{filename} ({len(deduped)} issues)")
                print(f"{'─'*60}")
                for code, desc in deduped:
                    print(f"  [{code}] {desc}")
                    total_issues += 1

    # 总结
    print(f"\n{'='*60}")
    if total_issues == 0:
        print(f"✅ 扫描 {total_files} 个 SVG，全部通过！")
    else:
        print(f"扫描 {total_files} 个 SVG，{files_with_issues} 个文件共 {total_issues} 个问题")
        print()
        print("严重程度说明:")
        print("  C:HAS_MARKER / C:HAS_STYLE    → 博客渲染会出错，必须修复")
        print("  G:*_OVERFLOW                   → 内容被裁切，必须修复")
        print("  G:ORPHAN_RECT                  → 可能是残留 ghost element")
        print("  G:TIGHT_*                      → 边距偏紧，建议扩大 viewBox")
        print("  C:NO_VIEWBOX / C:NO_FONT_FAMILY → 不影响渲染但不规范")

    sys.exit(1 if total_issues > 0 else 0)


if __name__ == "__main__":
    main()
