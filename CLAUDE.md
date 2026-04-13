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
│   ├── domain/           # 领域设计
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
- 架构图、流程图、对比表格等使用 **SVG 文件**而非 ASCII art 或 Markdown 表格，SVG 存放规则见下方"SVG 图形规范"
- Markdown 表格也可以转为 SVG 以获得更好的视觉效果，尤其是多列复杂对比表
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
