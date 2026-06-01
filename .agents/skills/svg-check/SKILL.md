---
name: svg-check
description: 检查和修复博客 SVG 文件的规范合规性和几何问题。当创建或修改了 SVG 文件后使用，或用户要求检查 SVG 时使用。
argument-hint: "[目录名，如 agentic-03，不传则检查全部]"
allowed-tools: Bash Read Edit
---

检查和修复 `public/images/blog/` 下的 SVG 文件。

## 步骤

### 1. 审计

运行审计脚本检查规范和几何问题：

```bash
python3 ${CLAUDE_SKILL_DIR}/svg-audit.py $ARGUMENTS
```

不传参数则检查所有 SVG。可用选项：
- `--convention-only`：只检查规范（marker、style、font-family 等）
- `--geometry-only`：只检查几何（溢出、孤立元素、贴边等）

### 2. 自动修复

如果审计发现规范问题（`C:` 前缀），运行修复脚本：

```bash
python3 ${CLAUDE_SKILL_DIR}/svg-fix.py $ARGUMENTS
```

自动修复内容：
- `<marker>` + `marker-end` → `<polygon>` 箭头
- `<style>` CSS → 内联属性
- `stroke-width="2"` → `"1.5"`
- 添加缺失的 `viewBox` 和 `font-family`
- 清理残留 `marker-end` 属性

可用选项：
- `--dry-run`：试运行，只报告不修改

### 3. 验证

修复后再次运行审计确认全部通过：

```bash
python3 ${CLAUDE_SKILL_DIR}/svg-audit.py $ARGUMENTS
```

### 4. 手动处理

以下问题需要手动修复，脚本无法自动处理：
- `G:*_OVERFLOW`：元素溢出 viewBox → 扩大 viewBox 或调整元素坐标
- `G:ORPHAN_RECT`：孤立矩形 → 删除或补充文字
- `G:TIGHT_*`：元素贴边 → 扩大 viewBox 留出边距
