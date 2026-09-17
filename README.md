# Skyfalling Blog

基于 Next.js App Router、React、Tailwind CSS 和本地 Markdown 的个人博客。依赖版本以 `package.json` 和锁文件为准。

## 工程结构

| 位置 | 职责 |
| --- | --- |
| `src/content/blog/` | 按大类/子类存放文章，YAML frontmatter 加 Markdown 正文 |
| `src/lib/blog.ts` | 读取文章、解析 frontmatter 与 Markdown、生成路由、分类/标签/系列导航 |
| `src/lib/content-paths.ts` | 网站与微信共用的文章路由、public 图片解析与 img src 改写 |
| `src/lib/categories.ts` | 物理目录对应的分类名称与主分类列表 |
| `src/lib/site.ts` | 站点地址、作者、SEO 默认值 |
| `src/config/series.json` | 系列名称与说明 |
| `src/app/` | 文章、列表、分类、标签页面，以及 sitemap、RSS、robots |
| `src/components/SyntaxHighlightedContent.tsx` | 客户端代码高亮与历史 Mermaid 内容渲染 |
| `public/images/blog/` | 文章 SVG 与真实界面截图 |
| `scripts/cli.sh` | 开发、构建、静态预览、部署与微信工具入口 |
| `scripts/wx/` | 独立的微信公众号 HTML/图片转换与草稿发布链路 |

网站链路：Markdown → gray-matter → marked → Next.js 页面 → 客户端高亮。配置 `NEXT_EXPORT=true` 时导出到 `out/`，否则使用标准 Next.js 构建。

微信链路独立转换样式、图片与链接；网站上显示正常不能代替微信预览验收。

## 开发与验证

本项目本地与部署建议使用 Node.js 20。首次安装使用 npm：

```bash
npm ci
npm run dev
```

打开 http://localhost:3000。已有服务优先复用；若需重启先确认进程属于当前项目。

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发预览，Markdown 修改后刷新页面检查 |
| `npm run type-check` | TypeScript 检查；当前 tsconfig 排除了 scripts，因此不覆盖发布脚本 |
| `npm run lint` | 当前 Next.js lint 入口；本地版本提示未来需要迁移 ESLint CLI |
| `npm run build` | 标准 Next.js 生产构建，产物在 .next |
| `npm start` | 启动标准生产构建 |
| `npm run build:export` | 静态导出到 out |
| `npm run preview` | 预览现有 out；只有 out 缺失/为空时自动构建 |
| `npm run help` | 查看统一 CLI 命令 |

静态预览默认端口 8000。修改文章后要先重新导出，不能用已有 out 判断修改是否生效。`cli.sh dev/preview` 会检查监听进程的工作目录与命令，复用当前工程的对应服务；端口被其他服务占用时退出，不结束进程。

## 文章与路由

写作规范统一见 [AGENTS.md](AGENTS.md)。文章使用两级物理目录，分类配置以 `src/lib/categories.ts` 为准；当前主分类为 engineering、insights、science、life，不存在额外的 Industry 虚拟映射。

```yaml
---
title: "文章标题"
description: "填写概括真实结论的摘要，长度与写作要求见 AGENTS.md"
pubDate: 2026-09-16
tags: ["规则引擎", "JavaScript", "业务编排"]
slug: "dual-language-rule-engine"
author: "skyfalling"
---
```

网站 canonical、RSS、sitemap 与微信原文链接共用 `src/lib/content-paths.ts` 的路由规则。新文章提供英文 slug；旧文未提供时回退到文件名。目录前缀保留，例如 `engineering/domain/example.md` 使用 `slug: "rule-engine-design"`，路由为 `/blog/engineering/domain/rule-engine-design/`。

- 文章列表：`/blog/page/1/`
- 分类：`/blog/category/engineering/domain/page/1/`
- 标签：`/blog/tag/规则引擎/page/1/`
- 文章图片：`/images/blog/{article-slug}/{filename}`
- 系列：frontmatter 的 `series.key` 对应 `src/config/series.json`；当前系列导航按发布日期排序

新增子分类时创建物理目录并在 `CATEGORY_META` 注册显示信息；新增主分类还需更新 `MAIN_CATEGORIES`。不要仅按旧文档中的不存在变量修改代码。

## 代理规范与技能

- `AGENTS.md`：唯一公共规范
- `CLAUDE.md`：加载公共规范的入口
- `.agents/skills/`：write-article、review-article、svg-check 的共享实现
- `.claude/skills/`：Claude 发现入口与兼容脚本，不复制实现

SVG 审计示例：

```bash
python3 .agents/skills/svg-check/svg-audit.py dual-language-rule-engine
```

静态检查之外，还需核对图意与浏览器实际显示；具体要求见公共规范及 SVG 技能。

## 部署

| 命令 | 作用 |
| --- | --- |
| `./scripts/cli.sh deploy` | 重新导出并推送 GitHub Pages |
| `npm run deploy` | 仅发布现有 out，不会先构建 |
| `npm run deploy:cf` | 重新导出并直传 Cloudflare Pages 的 blog 项目 |

仓库文档约定的 Cloudflare 在线构建为 `npm run build:export`、输出 `out`、Node.js 20。是否配置了 Git 推送自动部署，需要以平台实际配置为准，本地脚本不能证明线上状态。

## 微信工具

```bash
./scripts/cli.sh wx:preview src/content/blog/engineering/domain/example.md
./scripts/cli.sh wx:publish src/content/blog/engineering/domain/example.md
```

`wx:preview` 只生成本地 `wx_out/` 内容；`wx:publish` 上传图片并创建公众号草稿。详细配置和已知实现边界见 [scripts/README.md](scripts/README.md)。发布需要用户明确授权。
