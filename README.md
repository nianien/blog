# Skyfalling Blog

一个基于 Next.js 和 Tailwind CSS 构建的现代化个人博客网站。

## ✨ 特性

- 🚀 **Next.js 15** - 使用最新的 App Router 和 Turbopack
- 🎨 **Tailwind CSS 4** - 现代化的 CSS 框架
- 📝 **Markdown 支持** - 使用 gray-matter 解析 frontmatter
- 📱 **响应式设计** - 完美适配移动端和桌面端
- 🔍 **SEO 优化** - 内置 SEO 友好的结构
- ⚡ **静态生成** - 使用 SSG 提升性能
- 🎯 **TypeScript** - 完整的类型支持
- 💬 **评论系统** - 集成 Giscus 评论

## 🛠️ 技术栈

- **框架**: Next.js 15.3.5
- **样式**: Tailwind CSS 4
- **语言**: TypeScript 5
- **内容**: Markdown
- **图标**: Heroicons
- **日期**: date-fns
- **评论**: Giscus

## 📁 项目结构

```
src/
├── app/                    # Next.js App Router
│   ├── blog/              # 博客相关页面
│   │   ├── page/[page]/   # 博客列表（分页）
│   │   ├── category/      # 分类筛选页
│   │   ├── tag/           # 标签筛选页
│   │   └── [...slug]/     # 文章详情页
│   ├── about/             # 关于页面
│   ├── contact/           # 联系页面
│   └── layout.tsx         # 根布局
├── components/            # React 组件
│   ├── Header.tsx         # 网站头部
│   ├── Footer.tsx         # 网站底部
│   ├── BlogCard.tsx       # 博客卡片
│   ├── CategoryNav.tsx    # 分类导航组件
│   └── GiscusComments.tsx # 评论组件
├── content/blog/          # 博客内容（Markdown 文章）
│   ├── engineering/       # Engineering 分类
│   ├── insights/          # Industry / Science 分类（虚拟映射）
│   └── life/              # Life 分类
├── lib/                   # 工具函数
│   ├── blog.ts            # 博客处理 & 分类工具函数
│   ├── categories.ts      # 分类元数据 & 目录映射配置
│   └── github-api.ts      # GitHub API
└── types/                 # TypeScript 类型定义
    └── blog.ts            # 博客 & 分类相关类型
```

## 🚀 快速开始

### 环境要求

- Node.js >= 18.0.0
- npm >= 8.0.0

### 安装和启动

```bash
# 完整安装（推荐首次使用）
./scripts/install.sh

# 启动开发服务器
./scripts/restart.sh
```

访问 [http://localhost:3000](http://localhost:3000) 查看网站。

### 其他命令

```bash
# 构建生产版本
npm run build

# 启动生产服务器
npm start

# 代码检查
npm run lint

# 类型检查
npm run type-check

# 清理缓存
npm run clean
```

## 📋 脚本说明

### 🛠️ 安装脚本

#### `install.sh` - 完整安装
**用途**: 首次安装和设置项目环境

**功能**:
- 检查 Node.js 和 npm 环境
- 显示环境信息（版本号）
- 清理所有旧文件和缓存
- 安装所有依赖包
- 验证安装（运行构建测试）

**使用方法**:
```bash
./scripts/install.sh
```

### 🔄 开发脚本

#### `restart.sh` - 启动/重启开发服务器
**用途**: 启动或重启开发服务器，确保显示最新内容

**功能**:
- 检查 Node.js 和 npm 环境
- 智能依赖检查（自动安装缺失依赖）
- 强制停止所有相关进程
- 全面清理缓存（.next, out, node_modules/.cache, .turbo）
- 显示环境信息
- 启动开发服务器

**使用方法**:
```bash
./scripts/restart.sh
```

### 🌐 部署脚本

#### `deploy.sh` - GitHub Pages 部署
**用途**: 构建并部署到 GitHub Pages

#### `preview.sh` - 本地预览
**用途**: 预览生产版本

---

## 站点维护指南

### 信息架构

博客采用「导航 + 标签」双层模式：

- **分类导航**（一级入口）：基于目录结构，分为四个板块
- **标签**（二级辅助）：文章级别的交叉索引，用于跨分类关联

#### 四板块分类

| 板块 | 含义 | 物理目录 |
|------|------|----------|
| **Engineering** | 系统构建与工程实践 | `engineering/*` |
| **Industry** | 产业洞察与商业博弈 | `insights/technology`, `insights/business`, `insights/finance` |
| **Science** | 科学原理与第一性思考 | `insights/science` |
| **Life** | 个体成长与生活实践 | `life/*` |

物理目录和导航板块之间通过 `src/lib/categories.ts` 中的 `DIR_TO_VIRTUAL` 映射关联，文件不需要移动。

#### 当前子分类

```
Engineering
├── Agentic 系统      engineering/agentic
├── 架构设计          engineering/architecture
├── 领域建模          engineering/domain
├── 中间件            engineering/middleware
├── 工程实践          engineering/practice
├── 开发工具          engineering/tooling
└── 数据工程          engineering/data

Industry
├── 技术洞察          insights/technology
├── 商业思考          insights/business
└── 金融分析          insights/finance

Science
└── 科学探索          insights/science

Life
└── 数字生活          life/digital
```

---

### 写文章

#### 1. 确定分类

选择文章所属的子分类目录。如果没有合适的，可以新建（见下方「新增子分类」）。

#### 2. 创建 Markdown 文件

在对应目录下创建 `.md` 文件，文件名即为 URL slug：

```bash
# 示例：在 Engineering > Agentic 系统 下新建文章
touch src/content/blog/engineering/agentic/我的新文章.md
```

#### 3. 编写 Frontmatter

每篇文章开头必须包含 YAML frontmatter：

```markdown
---
title: "文章标题"
description: "一句话描述，会显示在卡片和 SEO 中"
pubDate: "2026-02-20"
tags: ["标签1", "标签2", "标签3"]
---

正文内容，支持标准 Markdown 和 GFM 语法...
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `title` | 是 | 文章标题 |
| `description` | 是 | 摘要描述，显示在列表卡片和 SEO meta 中 |
| `pubDate` | 是 | 发布日期，格式 `YYYY-MM-DD`，决定排序 |
| `tags` | 否 | 标签数组，用于交叉索引 |
| `heroImage` | 否 | 封面图路径 |

#### 4. 标签使用原则

标签是跨分类的交叉索引，不是分类的替代：

- **用于**：具体技术名词（`RAG`, `Kafka`, `微服务`）、方法论（`DDD`, `DevOps`）、主题（`AI`, `投资`）
- **不要**：用标签重复分类信息（文章在 `engineering/agentic` 目录下，不需要加 `工程` 标签）
- **数量**：每篇 2-5 个标签，不宜过多
- **复用**：优先使用已有标签，保持一致性。运行 `npm run build` 后在输出中可以看到所有标签页

#### 5. 预览和发布

```bash
# 本地预览
./scripts/restart.sh
# 浏览器打开 http://localhost:3000

# 构建验证
npm run build

# 部署
./scripts/deploy.sh
```

---

### 新增子分类

当需要新增一个子分类时，需要改动两个地方：

#### 步骤 1：创建物理目录

```bash
mkdir -p src/content/blog/<主目录>/<子目录>
# 示例：
mkdir -p src/content/blog/life/career
```

#### 步骤 2：注册分类映射

编辑 `src/lib/categories.ts`：

```typescript
// 1. 在 DIR_TO_VIRTUAL 中添加物理目录 → 虚拟路径映射
export const DIR_TO_VIRTUAL: Record<string, string> = {
  // ... 已有映射
  'life/career': 'life/career',        // ← 新增
};

// 2. 在 CATEGORY_META 中添加显示名称和描述
export const CATEGORY_META: Record<string, { name: string; description: string }> = {
  // ... 已有配置
  'life/career': { name: '职业成长', description: '职业路径与能力建设' },  // ← 新增
};
```

完成后放入文章，运行 `npm run build` 即可。导航组件会自动读取新分类。

---

### 新增一级板块

一般不需要。如确实需要：

1. 在 `src/lib/categories.ts` 的 `MAIN_CATEGORIES` 数组中添加新板块 key
2. 在 `CATEGORY_META` 中添加该 key 的名称和描述
3. 创建对应的物理目录和 `DIR_TO_VIRTUAL` 映射

---

### 目录结构说明

```
src/content/blog/              ← 所有文章根目录
├── engineering/               ← Engineering 板块
│   ├── agentic/              ← 子分类：Agentic 系统
│   │   ├── 文章A.md
│   │   └── 文章B.md
│   ├── architecture/         ← 子分类：架构设计
│   └── ...
├── insights/                  ← Industry + Science 板块的物理目录
│   ├── technology/           ← 虚拟映射到 Industry
│   ├── business/             ← 虚拟映射到 Industry
│   ├── finance/              ← 虚拟映射到 Industry
│   └── science/              ← 虚拟映射到 Science
└── life/                      ← Life 板块
    └── digital/              ← 子分类：数字生活
```

> **为什么 `insights/` 目录映射到多个板块？**
>
> 物理目录结构是历史遗留的，通过 `DIR_TO_VIRTUAL` 虚拟映射可以在不移动文件的情况下重新组织导航。
> 如果未来需要，也可以物理迁移文件并更新映射。

---

### URL 结构

| 页面 | URL | 说明 |
|------|-----|------|
| 博客首页 | `/blog/page/1` | 全部文章，分页 |
| 一级分类 | `/blog/category/engineering/page/1` | 某板块全部文章 |
| 二级分类 | `/blog/category/engineering/agentic/page/1` | 某子分类文章 |
| 标签页 | `/blog/tag/微服务/page/1` | 某标签下的文章 |
| 文章详情 | `/blog/engineering/agentic/文章名` | slug = 物理路径 |

---

### 微信公众号发布

一键将 Markdown 文章发布到微信公众号草稿箱。

#### 使用

```bash
# 预览排版（生成 HTML 并打开浏览器）
./scripts/cli.sh wx:preview src/content/blog/xxx.md

# 发布到草稿箱
./scripts/cli.sh wx:publish src/content/blog/xxx.md
```

#### 架构

```
本地脚本                     微信云托管                      微信 API
┌──────────────┐  POST JSON  ┌──────────────────┐  内网调用  ┌──────────────┐
│ publish.ts   │ ──────────→ │ wx-proxy (Docker) │ ────────→ │ api.weixin.  │
│ api.ts       │ ← response  │ 免鉴权，无需token │ ← response│ qq.com       │
└──────────────┘              └──────────────────┘            └──────────────┘
```

- **本地** (`scripts/wx/`): Markdown → 微信排版 HTML，图片 base64 编码，调用云端代理
- **云端** (`scripts/wx/scf/`): Express 服务部署在微信云托管，通过「开放接口服务」免鉴权调用微信 API
- 不需要 access_token、不需要 IP 白名单

#### 本地配置

`.env.wx`：

```
WX_PROXY_URL=https://你的云托管公网域名/wx-proxy
```

#### 云端配置（微信云托管控制台）

1. **云调用 → 开放接口服务 → 开启**
2. **云调用权限配置**，添加白名单：
   ```
   /cgi-bin/material/add_material
   /cgi-bin/media/uploadimg
   /cgi-bin/draft/add
   ```
3. 上传 `scripts/wx/scf/` 下的代码部署 Docker 服务
4. **开启开关后必须重新创建版本才生效**

#### 注意事项

- 微信公众号摘要（digest）限制约 40 字符，发布时自动截断并加省略号
- 微信不支持文章内外部链接，发布时自动去除 `<a>` 标签保留文字
- 封面图未指定时自动根据标题和标签生成
- 云托管最小实例数设为 0 可省钱，冷启动约 1-2 秒

---

### 常用操作速查

```bash
# 首次安装
./scripts/install.sh

# 启动开发服务器（自动清缓存）
./scripts/restart.sh

# 构建生产版本
npm run build

# 静态文件预览
npm run preview

# 部署到 GitHub Pages
./scripts/deploy.sh

# 代码检查
npm run lint

# 类型检查
npm run type-check

# 清理缓存
npm run clean

# 交互式帮助
npm run help
```

---

## 部署

### GitHub Pages

```bash
./scripts/deploy.sh
```

### Vercel

1. 将代码推送到 GitHub
2. 在 Vercel 中导入项目
3. 自动部署完成

---

## 故障排除

| 问题 | 解决方法 |
|------|----------|
| 脚本权限错误 | `chmod +x scripts/*.sh` |
| 端口被占用 | `./scripts/restart.sh` 会自动释放端口 |
| 依赖安装失败 | `./scripts/install.sh` |
| 构建失败 | `npm run clean && npm run build` |
| dev 缓存异常 | `./scripts/restart.sh`（会清理 `.next` 缓存）|

---

## 许可证

MIT License
