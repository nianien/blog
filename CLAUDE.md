# Blog 项目指南

## 项目概览

基于 Next.js 的个人技术博客，使用 Markdown 文件作为内容源。

## 文章存放目录

所有文章位于 `src/content/blog/` 下，按**大类/子类**两级目录组织：

```
src/content/blog/
├── engineering/          # 工程技术类（偏"怎么建"）
│   ├── agentic/          # AI Agent 系列
│   ├── aigc/             # AIGC 视频/短剧工程系列
│   ├── algorithm/        # 算法
│   ├── architecture/     # 系统架构
│   ├── data/             # 数据工程
│   ├── domain/           # 业务系统
│   ├── middleware/       # 中间件
│   ├── practice/         # 工程实践
│   └── tooling/          # 工具链
├── insights/             # 洞察分析类（偏"怎么看"）
│   ├── business/         # 商业分析
│   ├── finance/          # 金融
│   ├── science/          # 科学
│   └── technology/       # 技术趋势、行业格局、宏观分析
├── life/                 # 生活成长类
│   ├── digital/          # 数字生活
│   ├── growth/           # 个人成长
│   └── reading/          # 阅读
└── science/              # 科学类
    ├── cognition/        # 认知科学
    └── complexity/       # 复杂性
```

### 目录选择规则

- **engineering/**：偏工程实现、代码、架构设计、技术方案的文章（读完去"动手建"）
- **engineering/aigc/**：AIGC 视频生成、短剧制作、角色一致性等工程实战文章
- **engineering/agentic/**：AI Agent、LLM 工程化、Agentic 系统系列
- **insights/technology/**：偏技术趋势、行业格局、宏观分析的文章（读完去"思考判断"）
- **insights/business/**：偏商业模式、品牌、创业相关分析
- **life/growth/**：职业发展、个人成长话题
- 参考材料放在 `material/` 目录，**不要**把文章放在 material 中

## 文章 Frontmatter 格式

每篇文章必须以 YAML frontmatter 开头：

```yaml
---
title: "文章标题"
description: "一两句话的文章摘要，要有信息量"
pubDate: 2026-03-19          # 日期格式：YYYY-MM-DD，可带引号也可不带
tags: ["标签1", "标签2"]      # 字符串数组
slug: "english-route-slug"   # 路由用的英文 slug（kebab-case），新文章必填
author: "skyfalling"              # 固定作者名
---
```

### Frontmatter 注意事项

- `author` 固定为 `"skyfalling"`
- `description` 要写得有信息密度，概括核心观点而不只是描述主题
- `tags` 选择与内容匹配的关键词，可参考已有文章的 tag 体系
- `pubDate` 使用当天日期
- **正文不要包含一级标题（`# 标题`）**，页面会自动从 frontmatter 的 `title` 渲染标题，正文中再写会导致标题重复显示
- **`title` 和 `description` 字段内禁止出现直引号 `"`**：YAML 用直引号 `"` 作为字符串定界符，字段值内部再出现 `"` 会导致解析器提前截断，构建报错。需要引用时改用中文书名号《》、破折号或直接去掉引号

### slug 字段规则

`slug` 决定文章 URL 的最后一段（保留所在目录前缀），用英文 kebab-case，对 SEO / 分享至关重要。

- **新文章必填**，旧文章如不填则回退到文件名（保持兼容）
- 全小写，单词间用短横线 `-` 分隔
- **意译而非音译**：用关键概念的英文，而不是拼音
  - 文件名 `12-学习与自进化.md` → `slug: "learning-self-improvement"` ✓
  - 不要 `slug: "xue-xi-yu-zi-jin-hua"` ✗
- 长度 3-6 个单词，含主关键词；不带序号前缀（序号靠 `series.order` 或日期排序）
- 同目录下不可重复（构建时会冲突）

URL 映射示例：

| 文件路径 | frontmatter slug | 最终 URL |
|---|---|---|
| `engineering/agentic/12-学习与自进化.md` | `learning-self-improvement` | `/blog/engineering/agentic/learning-self-improvement/` |
| `engineering/agentic/12-学习与自进化.md` | （未填）| `/blog/engineering/agentic/12-学习与自进化/` |

## SEO / GEO 写作规范

每篇文章除了内容质量本身，还要满足搜索引擎（Google/Bing/百度）和生成式 AI 搜索（ChatGPT/Perplexity/Gemini）的抓取与引用偏好。以下是硬性规则，写新文章时必须遵守。

### Frontmatter 的 SEO 强化

- **`title`**：≤30 中文字，必须包含主关键词，避免"浅谈/简谈/聊聊"等弱化前缀
- **`description`**：120-160 字之间，**前 80 字内必须出现主关键词 + 文章核心结论**，禁止"本文将介绍/本文主要讨论"式开头
- **`tags`**：3-6 个，覆盖"主题词 + 技术栈词 + 场景词"三类（例如：撮合引擎 / Go / 高并发交易）

### 正文的 GEO 强化

- **开头 100 字必须给出核心结论**（TL;DR 段或第一段直接抛结论），不写寒暄式铺垫、不写"随着 XX 的发展"
- **断言式表述**：避免"我认为/可能/或许/也许"等弱化词，多用确定性陈述句，GEO 引擎优先引用断言句
- **可引用句**：每个 H2 章节至少有一句独立成段的核心论断，便于 AI 抽取
- **结构化对比 → Markdown 表格**：所有"前后/方案/维度"对比一律用表格，AI 抽表的能力远强于抽段落
- **定义类内容用粗体冒号格式**：`**XX**：YY 是 ZZ ...`，便于 LLM 识别概念定义
- **图片 alt 文本要有信息量**：`![撮合引擎单线程架构](/images/...)` 而非 `![image](/images/...)`，alt 是 GEO 主要抓取字段

### 不强求的项

- 不强求站内内链，文章自然成段、互不依赖更重要
- 不强求堆叠数据/引用，没有真实数据就不要硬塞

## 文章生成流程

当需要根据参考材料撰写文章时，遵循以下流程：

1. **读取参考材料**：从 `material/` 目录读取参考文件
2. **生成大纲**：先产出文章大纲，包含章节结构和要点
3. **大纲自评**：从完整性、结构清晰度、技术深度、可读性、原创洞察五个维度评估
4. **与用户对齐**：确认目标读者、篇幅、是否需要案例、结构调整偏好等
5. **撰写全文**：基于确认后的大纲撰写完整文章
6. **保存到正确目录**：根据文章主题选择合适的子目录，**不要**保存到 material/ 或项目根目录

## 文章写作风格

- 面向技术从业者时：包含代码片段、架构图（SVG）、技术栈对比表
- 架构图、流程图等使用 **SVG 文件**而非 ASCII art，SVG 存放规则见下方"SVG 图形规范"
- **表格一律使用 Markdown 表格**，不要用 SVG 画表格
- 善用 Markdown 表格、代码块、引用块增强可读性
- 每个大章节末尾用**一句话总结**收束
- 使用"Normal vs Better"对比模式而非"Wrong vs Correct"
- 中文为主，技术术语保留英文（如 Pipeline、State Management）

## Markdown 格式注意事项

- **加粗标记 `**` 内不要包含中文括号和引号**：`**口型同步（Lip Sync）**` 在部分渲染器中会失败，应写成 `**口型同步**（Lip Sync）`，把括号注释移到加粗外面
- 同理 `**"粗生成 + Face Swap精修"**` 应写成 `"**粗生成 + Face Swap精修**"`，引号移到外面
- 加粗内可以包含纯中文内容和英文，但避免混入 `（）""《》` 等全角标点
- 如果加粗内容本身就是完整句子且包含括号（如 `**长镜头（>10秒）的质量急剧下降**`），括号是句意的一部分而非术语注释，可以保留

## 代码块使用规范

**代码块（\`\`\`）仅用于真正的代码和配置**，包括：YAML/JSON/SQL/Python 等编程语言代码、配置文件、Prompt 模板、伪代码（含 `while`/`if` 等语法结构的）。

**以下内容禁止使用代码块**，应使用 Markdown 原生格式：

- 纯文本列表、分类罗列 → 使用 **Markdown 表格**
- 指标体系、分级策略、配额层次 → 使用 **Markdown 表格**
- 流程步骤（无代码语法的）→ 使用 **Markdown 表格**（阶段/动作列）
- 对比信息（前后对比、方案对比）→ 使用 **Markdown 表格**
- ASCII art 图形（流程图、架构图、树形图）→ 转为 **SVG 文件**

简单判断标准：如果代码块里的内容去掉缩进后就是普通中文句子和列表，那就不应该用代码块。

## SVG 图形规范

SVG 文件统一存放在 `public/images/blog/{article-slug}/` 目录下，Markdown 中用 `![描述](/images/blog/{article-slug}/xxx.svg)` 引用。

- `{article-slug}` 使用文章主题的英文短横线命名（如 `cdn-technology`、`mousika-rule-engine`）
- **不要**在 `src/content/blog/` 下创建 `assets/` 目录，项目中所有现有文章均使用 `public/images/blog/` 路径

命名格式 `{序号}-{描述}.svg` 或按内容命名如 `table-toolchain.svg`、`pipeline.svg`。

SVG 绘制约定：

- 字体：`font-family="system-ui, -apple-system, 'PingFang SC', sans-serif"`，代码类文本用 `'SF Mono', 'Menlo', monospace`
- 圆角矩形：`rx="6"` 或 `rx="8"`
- 描边：`stroke-width="1.5"`
- 配色：浅色填充 + 深色描边（如 `fill="#DBEAFE" stroke="#3B82F6"`）
- **不使用 `<marker>` 元素**（博客渲染环境不支持），箭头用 `<polygon>` 三角形实现
- 不使用 CSS `<style>` 块，所有样式用内联属性
- 所有元素必须在 `viewBox` 范围内，不允许溢出
- 连接线使用直线（水平/垂直），避免对角线连接
- 多个并排矩形之间留足间距，不允许重叠

## 文章自检清单（初稿写完前必扫）

完成初稿后、保存前必须按以下 5 项机械级 checklist 自查。**不靠主观判断、用工具直接扫**——避免"自我审查盲点"。详细操作步骤见 `write-article` skill 的"机械级自检"步骤；本节列规则。

1. **缩写与术语首次出现是否解释**：英文缩写（如 MCP / RaaS / RAG / CDP / NRR / MQL / SQL）首次出现处必须有 inline 注释或就近段落给出全称。
2. **前向引用：先问必要性、再问精确度**：默认偏好**尽量少用引用**——深度长文不是 reference manual，过多 "详见 X.Y" 让文章读起来像技术规范。判断顺序：① 相邻段落 / 同节下一段的引用 = **删**（读者下一页就读到、纯属冗余）；② 跨章远距离指引 / 去重声明（"已在 X.X 详述"）/ 层级区分 = **保留**；③ 保留的必须精确到 X.Y、不写"详见后文"、"详见第四章"。
3. **加粗 `**` 内是否含中文括号 / 引号**：CLAUDE.md "Markdown 格式注意事项"段已规定禁用——必须用 Python 脚本严格扫描（命令见下方）。
4. **论据是否扛得住"通用 AI 也能做"反问**：凡是"为什么不能被通用方案替代"的论据，都要做反向 stress test——通用 LLM + 简单 RAG 能解决的论据要替换为更难替代的。
5. **SVG 文件是否通过 svg-check**：包含 SVG 的文章保存后必须执行 `python3 .claude/skills/svg-check/svg-audit.py public/images/blog/{slug}/` 并全部通过。

6. **是否有教材式注解（AI 味重灾区）**：grep `"^> 注|^> 这里|^> 这部分|^> 本节"` 扫描——`> 注：`、`> 这里的 X 分两类`、`> X 与 Y 互补、不冲突` 这类教学式 callout 必须改为正文段或直接删。引用块只留给"断言型论断"和"富意境比喻"，不留给"老师式备注"。

7. **AI 味累积扫描（单段集中度）**：AI 味不在单 marker、在单段累积——对偶 + 加粗 + 浮夸副词 + dash 堆一段就出 LLM 生成感。**单段红线**：≥4 处加粗、≥3 处 dash、≥2 个"正是/恰是/反而"副词、≥2 次"X 不是 Y、是 Z"对偶——任一触发即改写：拆段、去副词、对偶改直白、加粗降到 1-2 处。

**Checklist 不过、文章不能发布**。这 7 项是硬门槛、不是建议。

### 加粗格式扫描命令

```bash
python3 -c "
import re
with open('article.md') as f:
    for ln, line in enumerate(f, 1):
        for m in re.finditer(r'\*\*([^*\n]+?)\*\*', line):
            content = m.group(1)
            bad = [c for c in content if c in '\"\"（）《》']
            if bad:
                print(f'{ln}: [{content}] -> {bad}')
"
```

### 前向引用扫描命令

```bash
grep -nE "详见|见后文|见第.章|后述|前述" article.md
```

逐条核对引用对象是否已精确到 X.Y 章节号。
