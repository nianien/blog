#!/usr/bin/env python3
"""
SVG 规范修复工具：自动修复博客 SVG 文件的常见规范问题。

用法:
    # 修复所有 SVG
    python scripts/svg-fix.py

    # 只修复某个目录
    python scripts/svg-fix.py agentic-09

    # 试运行，只报告不修改
    python scripts/svg-fix.py --dry-run

修复内容:
    1. <marker> + marker-end → <polygon> 箭头
    2. <style> CSS → 内联属性
    3. stroke-width="2" → "1.5"
    4. 添加缺失的 viewBox（从 width/height 推导）
    5. 添加缺失的 font-family
    6. 清理残留 marker-end 属性
"""
import re, os, sys, glob, math
from pathlib import Path

# ── 自动定位项目根目录 ──────────────────────────────────────
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent.parent  # .claude/skills/svg-check → 项目根
SVG_BASE = PROJECT_ROOT / "public" / "images" / "blog"

FONT_FAMILY = "system-ui, -apple-system, 'PingFang SC', sans-serif"


# ═══════════════════════════════════════════════════════════════
#  CSS → 内联
# ═══════════════════════════════════════════════════════════════

def parse_css_classes(style_block):
    """从 <style> 块解析 CSS class → 属性映射。"""
    classes = {}
    for m in re.finditer(r"\.([a-zA-Z0-9_-]+)\s*\{([^}]+)\}", style_block):
        cls_name = m.group(1)
        props = {}
        for prop in m.group(2).split(";"):
            prop = prop.strip()
            if ":" in prop:
                key, val = prop.split(":", 1)
                key, val = key.strip(), val.strip()
                if key and val:
                    props[key] = val
        classes[cls_name] = props
    return classes


def inline_css_classes(content):
    """移除 <style> 块，将 class 引用转为内联属性。"""
    style_match = re.search(r"<style[^>]*>(.*?)</style>", content, re.DOTALL)
    if not style_match:
        return content

    classes = parse_css_classes(style_match.group(1))
    content = content[: style_match.start()] + content[style_match.end() :]

    def replace_class(m):
        tag = m.group(0)
        cls_match = re.search(r'class="([^"]+)"', tag)
        if not cls_match:
            return tag

        all_props = {}
        for cls_name in cls_match.group(1).split():
            if cls_name in classes:
                all_props.update(classes[cls_name])

        if not all_props:
            return tag

        # 移除 class 属性
        tag = tag[: cls_match.start()] + tag[cls_match.end() :]

        # 添加内联属性（不覆盖已有属性）
        for css_key, css_val in all_props.items():
            if f'{css_key}="' not in tag:
                tag = re.sub(r"(/?>)", f' {css_key}="{css_val}"\\1', tag, count=1)

        return tag

    content = re.sub(r'<[a-zA-Z][^>]*class="[^"]*"[^>]*/?>',  replace_class, content)
    return content


# ═══════════════════════════════════════════════════════════════
#  <marker> → <polygon>
# ═══════════════════════════════════════════════════════════════

def extract_path_endpoint(d_attr):
    m = re.search(r"[ML]\s*([\d.]+)[,\s]+([\d.]+)\s*$", d_attr.strip())
    if m:
        return float(m.group(1)), float(m.group(2))
    return None, None


def extract_path_direction(d_attr):
    points = re.findall(r"[ML]\s*([\d.]+)[,\s]+([\d.]+)", d_attr)
    if len(points) >= 2:
        x1, y1 = float(points[-2][0]), float(points[-2][1])
        x2, y2 = float(points[-1][0]), float(points[-1][1])
        dx, dy = x2 - x1, y2 - y1
        length = math.sqrt(dx * dx + dy * dy)
        if length > 0:
            return dx / length, dy / length
    return 1, 0


def make_arrow_polygon(x, y, dx, dy, size=8):
    px, py = -dy, dx
    bx, by = x - dx * size, y - dy * size
    p1x, p1y = bx + px * size * 0.4, by + py * size * 0.4
    p2x, p2y = bx - px * size * 0.4, by - py * size * 0.4
    return f"{x:.0f},{y:.0f} {p1x:.0f},{p1y:.0f} {p2x:.0f},{p2y:.0f}"


def replace_markers_with_polygons(content):
    """将 <marker> 定义和 marker-end 引用替换为 <polygon> 箭头。"""
    markers = {}

    # 解析所有 marker 定义
    for m in re.finditer(r'<marker\s+id="([^"]+)"[^>]*>.*?</marker>', content, re.DOTALL):
        marker_id = m.group(1)
        fill_match = re.search(r'fill="([^"]+)"', m.group(0))
        markers[marker_id] = fill_match.group(1) if fill_match else "#333"

    if not markers:
        return content

    # 移除 marker 定义
    for marker_id in markers:
        content = re.sub(
            r"\s*<marker\s+id=\"" + re.escape(marker_id) + r'"[^>]*>.*?</marker>\s*',
            "",
            content,
            flags=re.DOTALL,
        )

    # 清理空 <defs>
    content = re.sub(r"\s*<defs>\s*</defs>\s*", "\n", content)

    # 替换带 marker-end 的 path/line
    new_polygons = []

    def replace_marker_ref(m):
        tag = m.group(0)
        ref = re.search(r'marker-end="url\(#([^)]+)\)"', tag)
        if not ref or ref.group(1) not in markers:
            return tag

        fill = markers[ref.group(1)]
        tag = re.sub(r'\s*marker-end="[^"]*"', "", tag)

        if tag.lstrip().startswith("<path"):
            d = re.search(r'd="([^"]+)"', tag)
            if d:
                ex, ey = extract_path_endpoint(d.group(1))
                dx, dy = extract_path_direction(d.group(1))
                if ex is not None:
                    new_polygons.append(f'<polygon points="{make_arrow_polygon(ex, ey, dx, dy)}" fill="{fill}"/>')
        elif tag.lstrip().startswith("<line"):
            try:
                x1 = float(re.search(r'x1="([^"]+)"', tag).group(1))
                y1 = float(re.search(r'y1="([^"]+)"', tag).group(1))
                x2 = float(re.search(r'x2="([^"]+)"', tag).group(1))
                y2 = float(re.search(r'y2="([^"]+)"', tag).group(1))
                dx, dy = x2 - x1, y2 - y1
                length = math.sqrt(dx * dx + dy * dy)
                if length > 0:
                    dx, dy = dx / length, dy / length
                new_polygons.append(f'<polygon points="{make_arrow_polygon(x2, y2, dx, dy)}" fill="{fill}"/>')
            except (AttributeError, ValueError):
                pass

        return tag

    content = re.sub(r'<(?:path|line)\s[^>]*marker-end="[^"]*"[^>]*/?\s*>', replace_marker_ref, content)

    if new_polygons:
        block = "\n  ".join(new_polygons)
        content = content.replace("</svg>", f"  {block}\n</svg>")

    return content


# ═══════════════════════════════════════════════════════════════
#  主修复逻辑
# ═══════════════════════════════════════════════════════════════

def fix_svg(filepath, dry_run=False):
    """修复单个 SVG 文件，返回修改列表。"""
    with open(filepath, "r", encoding="utf-8") as f:
        original = f.read()

    content = original
    changes = []

    # 1. <style> → 内联
    if "<style" in content:
        content = inline_css_classes(content)
        changes.append("inlined CSS")

    # 2. <marker> → <polygon>
    if "<marker" in content:
        content = replace_markers_with_polygons(content)
        changes.append("replaced markers")

    # 3. 残留 marker-end
    if "marker-end" in content:
        content = re.sub(r'\s*marker-end="[^"]*"', "", content)
        changes.append("removed marker-end refs")

    # 4. stroke-width="2" → "1.5"
    if 'stroke-width="2"' in content:
        content = content.replace('stroke-width="2"', 'stroke-width="1.5"')
        changes.append("fixed stroke-width")

    # 5. 添加 viewBox（从 width/height 推导）
    if "viewBox" not in content:
        m = re.search(r'width="(\d+)".*?height="(\d+)"', content)
        if m:
            w, h = m.group(1), m.group(2)
            content = content.replace(
                f'width="{w}" height="{h}"',
                f'width="{w}" height="{h}" viewBox="0 0 {w} {h}"',
            )
            changes.append(f"added viewBox 0 0 {w} {h}")

    # 6. 添加 font-family
    first_tag = content.split(">")[0]
    if "font-family" not in first_tag:
        content = content.replace(
            'xmlns="http://www.w3.org/2000/svg"',
            f"xmlns=\"http://www.w3.org/2000/svg\" font-family=\"{FONT_FAMILY}\"",
        )
        changes.append("added font-family")

    # 7. 清理 <rect> 上的无效 viewBox 属性
    content = re.sub(r'(<rect\s[^>]*)\s+viewBox="[^"]*"', r"\1", content)

    if content != original:
        if not dry_run:
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)
        return changes
    return []


# ═══════════════════════════════════════════════════════════════
#  Main
# ═══════════════════════════════════════════════════════════════

def main():
    args = sys.argv[1:]
    dry_run = "--dry-run" in args
    args = [a for a in args if not a.startswith("--")]

    if args:
        target = args[0]
        svg_dirs = sorted(glob.glob(str(SVG_BASE / target)))
        if not svg_dirs:
            svg_dirs = sorted(glob.glob(str(SVG_BASE / f"{target}*")))
        if not svg_dirs:
            print(f"❌ 找不到匹配 '{target}' 的 SVG 目录")
            sys.exit(1)
    else:
        svg_dirs = sorted(str(d) for d in SVG_BASE.iterdir() if d.is_dir())

    mode = "试运行" if dry_run else "修复"
    total_fixed = 0

    for svg_dir in svg_dirs:
        svg_dir = Path(svg_dir)
        if not svg_dir.is_dir():
            continue

        for svg_file in sorted(svg_dir.glob("*.svg")):
            changes = fix_svg(svg_file, dry_run=dry_run)
            if changes:
                rel = svg_file.relative_to(SVG_BASE)
                prefix = "🔍" if dry_run else "✅"
                print(f"{prefix} {rel}: {', '.join(changes)}")
                total_fixed += 1

    print(f"\n{'='*60}")
    if total_fixed == 0:
        print(f"✅ 所有 SVG 已符合规范，无需{mode}")
    else:
        print(f"{mode}了 {total_fixed} 个 SVG 文件")
        if dry_run:
            print("（试运行模式，文件未修改。去掉 --dry-run 执行实际修复）")


if __name__ == "__main__":
    main()
