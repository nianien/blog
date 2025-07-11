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

## 🚀 快速开始

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

## 📁 脚本说明

本项目提供了多个便捷脚本来简化开发和部署流程：

### 开发脚本

#### `start-local.sh` - 完整开发服务器 ⭐
**用途**: 启动 Next.js 开发服务器进行本地开发（推荐）

**功能**:
- 检查 Node.js 和 npm 环境
- 自动安装依赖（如果需要）
- 清理构建缓存
- 启动开发服务器

**使用方法**:
```bash
./start-local.sh
```

**访问地址**: http://localhost:3000

---

#### `start.sh` - 快速启动脚本
**用途**: 快速启动开发服务器（端口被占用时使用）

**功能**:
- 检查并安装依赖
- 自动释放端口 3000
- 快速启动开发服务器

**使用方法**:
```bash
./start.sh
```

**使用场景**: 当 `start-local.sh` 端口被占用时使用

---

### 构建脚本

#### `build.sh` - 静态站点构建 ⭐
**用途**: 构建和导出静态网站文件

**功能**:
- 检查环境依赖
- 自动安装依赖（如果需要）
- 清理构建缓存
- 构建项目
- 导出静态文件
- 显示构建统计信息

**使用方法**:
```bash
./build.sh
```

**输出目录**: `out/`

---

### 预览脚本

#### `preview.sh` - 静态站点预览 ⭐
**用途**: 启动本地服务器预览构建好的静态网站

**功能**:
- 检查构建文件是否存在
- 自动选择可用端口
- 启动 Python HTTP 服务器

**使用方法**:
```bash
./preview.sh
```

**访问地址**: http://localhost:8000 (或 8001)

---

### 部署脚本

#### `deploy.sh` - GitHub Pages 部署
**用途**: 构建并部署到 GitHub Pages

**功能**:
- 构建项目
- 导出静态文件
- 创建 `.nojekyll` 文件
- 部署到 `gh-pages` 分支

**使用方法**:
```bash
./deploy.sh
```

---

## 🎯 使用流程

### 开发模式（推荐日常使用）
```bash
# 启动开发服务器（热重载）
./start-local.sh
```

### 生产构建和预览
```bash
# 1. 构建静态站点
./build.sh

# 2. 预览构建结果（静态文件）
./preview.sh
```

### 部署到 GitHub Pages
```bash
# 一键部署
./deploy.sh
```

### 快速开发（备用方案）
```bash
# 快速启动（当端口被占用时）
./start.sh
```

### 脚本区别说明

| 脚本 | 用途 | 端口 | 推荐度 |
|------|------|------|--------|
| `start-local.sh` | 开发服务器（热重载） | 3000 | ⭐⭐⭐⭐⭐ |
| `start.sh` | 快速启动（备用） | 3000 | ⭐⭐⭐ |
| `preview.sh` | 静态文件预览 | 8000/8001 | ⭐⭐⭐⭐⭐ |

---

## 📋 脚本特性

- ✅ **环境检查**: 自动检查 Node.js、npm 等依赖
- ✅ **自动安装**: 如果依赖缺失会自动安装
- ✅ **错误处理**: 完善的错误提示和处理
- ✅ **端口管理**: 自动检测和选择可用端口
- ✅ **缓存清理**: 自动清理旧的构建缓存
- ✅ **状态反馈**: 清晰的操作状态提示

---

## 🔧 故障排除

### 常见问题

1. **权限错误**
   ```bash
   chmod +x *.sh
   ```

2. **端口被占用**
   - 脚本会自动尝试其他端口
   - 或手动结束占用端口的进程

3. **依赖安装失败**
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

4. **构建失败**
   ```bash
   rm -rf .next out
   npm run build
   ```

---

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
