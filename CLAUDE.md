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
- 架构图、流程图等使用 **SVG 文件**而非 ASCII art，SVG 文件存放在 `public/images/blog/` 目录下，Markdown 中用 `![描述](/images/blog/xxx.svg)` 引用
- 善用 Markdown 表格、代码块、引用块增强可读性
- 每个大章节末尾用**一句话总结**收束
- 使用"Normal vs Better"对比模式而非"Wrong vs Correct"
- 中文为主，技术术语保留英文（如 Pipeline、State Management）
