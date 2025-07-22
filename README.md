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
│   ├── about/             # 关于页面
│   ├── contact/           # 联系页面
│   └── layout.tsx         # 根布局
├── components/            # React 组件
│   ├── Header.tsx         # 网站头部
│   ├── Footer.tsx         # 网站底部
│   ├── BlogCard.tsx       # 博客卡片
│   └── GiscusComments.tsx # 评论组件
├── content/               # 博客内容
│   └── blog/              # Markdown 文章
├── lib/                   # 工具函数
│   ├── blog.ts            # 博客处理函数
│   └── github-api.ts      # GitHub API
└── types/                 # TypeScript 类型定义
    └── blog.ts            # 博客相关类型
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

## 📝 添加新文章

1. 在 `src/content/blog/` 目录下创建新的 `.md` 文件
2. 在文件开头添加 frontmatter：

```markdown
---
title: "文章标题"
description: "文章描述"
pubDate: "2024-01-01"
tags: ["标签1", "标签2"]
heroImage: "/images/hero.jpg"
---

# 文章内容

这里是文章的 Markdown 内容...
```

## 🎨 自定义

### 修改主题颜色

在 `tailwind.config.ts` 中修改颜色配置：

```typescript
theme: {
  extend: {
    colors: {
      primary: {
        50: '#eff6ff',
        500: '#3b82f6',
        600: '#2563eb',
      }
    }
  }
}
```

### 添加新页面

1. 在 `src/app/` 下创建新的目录
2. 添加 `page.tsx` 文件
3. 在 `Header.tsx` 中添加导航链接

## 🚀 部署

### GitHub Pages

```bash
./scripts/deploy.sh
```

### Vercel (推荐)

1. 将代码推送到 GitHub
2. 在 Vercel 中导入项目
3. 自动部署完成

### 其他平台

```bash
npm run build
npm start
```

## 🔧 故障排除

### 常见问题

1. **权限错误**
   ```bash
   chmod +x scripts/*.sh
   ```

2. **端口被占用**
   - 脚本会自动尝试其他端口
   - 或手动结束占用端口的进程

3. **依赖安装失败**
   ```bash
   ./scripts/install.sh
   ```

4. **构建失败**
   ```bash
   npm run clean
   npm run build
   ```

5. **缓存问题**
   ```bash
   ./scripts/restart.sh
   ```

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！
