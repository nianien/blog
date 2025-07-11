# Skyfalling Blog - Next.js + Tailwind CSS

一个基于 Next.js 和 Tailwind CSS 构建的现代化个人博客网站。

## 特性

- 🚀 **Next.js 14** - 使用最新的 App Router
- 🎨 **Tailwind CSS** - 现代化的 CSS 框架
- 📝 **Markdown 支持** - 使用 gray-matter 解析 frontmatter
- 📱 **响应式设计** - 完美适配移动端和桌面端
- 🔍 **SEO 优化** - 内置 SEO 友好的结构
- ⚡ **静态生成** - 使用 SSG 提升性能
- 🎯 **TypeScript** - 完整的类型支持

## 技术栈

- **框架**: Next.js 14
- **样式**: Tailwind CSS
- **语言**: TypeScript
- **内容**: Markdown
- **图标**: Heroicons
- **日期**: date-fns

## 项目结构

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
│   └── BlogCard.tsx       # 博客卡片
├── content/               # 博客内容
│   └── blog/              # Markdown 文章
├── lib/                   # 工具函数
│   └── blog.ts            # 博客处理函数
└── types/                 # TypeScript 类型定义
    └── blog.ts            # 博客相关类型
```

## 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

访问 [http://localhost:3000](http://localhost:3000) 查看网站。

### 构建生产版本

```bash
npm run build
```

### 启动生产服务器

```bash
npm start
```

## 添加新文章

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

## 自定义

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

## 部署

### Vercel (推荐)

1. 将代码推送到 GitHub
2. 在 Vercel 中导入项目
3. 自动部署完成

### 其他平台

```bash
npm run build
npm start
```

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！
