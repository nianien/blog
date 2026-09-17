---
name: svg-check
description: 检查并修复博客 SVG 的图意、项目样式、几何和实际页面显示；用于 SVG 创建、修改或明确的图形检查。
---

# SVG 检查

读取项目根目录 `AGENTS.md` 的 SVG 与验收章节。检查对象是当前任务的图，不能默认批量修改整个图库。

## 1. 图意

对照文章与相关实现核对节点、连接方向、分支、汇合、循环及图例。执行流、数据流和包含关系分别表达。文字、图注和相邻代码要使用同一套语义。

## 2. 静态审计

从项目根目录执行，参数支持图片目录名、具体目录或单个 SVG 文件：

```bash
python3 .agents/skills/svg-check/svg-audit.py dual-language-rule-engine
python3 .agents/skills/svg-check/svg-audit.py public/images/blog/dual-language-rule-engine/two-layer.svg
```

全库只读审计显式传 `--all`；`--convention-only` 与 `--geometry-only` 互斥。目标不存在、空目录或 XML 无效必须失败。核对文件数量与范围。

- ERROR：XML 无效、根节点不是 svg、缺少或无效 viewBox，退出码非零；检查模式不能跳过这些基础要求
- WARN：字体、描边、marker/CSS 等样式提醒，以及越界、留白等启发式几何提醒；仅有提醒时退出码为 0，需结合原图判断是否修改
- MANUAL：变换、复杂元素等超出静态覆盖范围，需要实际查看；不是已确认错误，也不等于已通过视觉验收

脚本只能检查部分静态几何。文字宽度、字体、变换、路径、箭头含义与遮挡需要浏览器检查；看到“静态检查未发现问题”不能据此宣称配图准确。

## 3. 修正

自动修复只处理可确定的基础属性，先查看 dry-run，再在本次授权的文件范围内应用：

```bash
python3 .agents/skills/svg-check/svg-fix.py public/images/blog/dual-language-rule-engine/two-layer.svg --dry-run
python3 .agents/skills/svg-check/svg-fix.py public/images/blog/dual-language-rule-engine/two-layer.svg
```

- 已有描边宽度等样式保持不变；只补可确定的缺失基础属性，不为统一默认样式覆盖设计
- 遇到 marker、style 或类样式，工具拒绝自动改写该文件；这是自动修复能力限制，不是判定 SVG 无效，人工根据原图处理，避免删掉箭头或丢失 CSS
- 箭头沿末段方向对准目标端口，并保持原分组、变换与绘制顺序
- 无文字矩形可能是合法背景或分组；先看图，再决定是否删除
- 不以单纯放大 viewBox 掩盖错误布局或导致正文中的字体过小
- 修正后重新运行审计并检查差异，不未经查看就批量运行自动修复

## 4. 浏览器验收

对新建或修改的配图，打开原始 SVG 和目标渠道中实际嵌入的版本，查看桌面与窄屏。渠道按 AGENTS.md 第 8 节确定，不自动追加无关渠道。确认文本、节点、线条和箭头无裁切、错向或重叠，正文缩放下主结构可读，放大入口可用。修正后复测。

确定错误需修复，提醒可在实际核对后保留有理由的设计差异，不要求机械清零。只有图意、静态审计和浏览器效果都已核对，才可报告完整通过；否则明确检查范围和剩余事项。
