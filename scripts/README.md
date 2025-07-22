# 脚本使用指南

## 📋 目录

- [脚本概览](#脚本概览)
- [快速开始](#快速开始)
- [核心脚本](#核心脚本)
- [帮助工具](#帮助工具)
- [NPM 命令参考](#npm-命令参考)
- [使用场景](#使用场景)
- [故障排除](#故障排除)
- [更新日志](#更新日志)

## 🚀 脚本概览

本项目提供了一套完整的开发工具脚本，帮助你快速进行开发、构建和部署。

### 核心脚本
- `install.sh` - 项目安装和初始化
- `restart.sh` - 开发服务器管理
- `deploy.sh` - 部署到 GitHub Pages
- `help.sh` - 交互式帮助工具

### 文档
- `README.md` - 综合使用指南（本文档）
- `NPM_COMMANDS.md` - 详细的 NPM 命令参考

## 🎯 快速开始

### 首次使用
```bash
# 1. 安装项目
./scripts/install.sh

# 2. 启动开发服务器
./scripts/restart.sh

# 3. 获取帮助
npm run help
```

### 日常开发
```bash
# 启动开发服务器
./scripts/restart.sh

# 或使用 npm 脚本
npm run dev
```

### 部署网站
```bash
# 完整部署流程
./scripts/deploy.sh

# 或通过帮助脚本
npm run help
# 选择选项 6
```

## 🔧 核心脚本

### install.sh
**用途**: 首次安装和设置项目环境

**功能**:
- 检查 Node.js 和 npm 环境
- 显示环境信息（版本号）
- 清理所有旧文件和缓存
- 安装所有依赖包
- 验证安装（运行构建测试）
- 提供使用说明

**使用方法**:
```bash
./scripts/install.sh
# 或
npm run setup
```

**适用场景**:
- 首次克隆项目后
- 环境出现问题需要重新安装
- 依赖版本冲突需要清理重装

### restart.sh
**用途**: 启动或重启开发服务器

**功能**:
- 检查 Node.js 和 npm 环境
- 智能依赖检查（自动安装缺失依赖）
- 强制停止所有相关进程
- 清理缓存（.next, out, .turbo）
- 显示环境信息
- 启动开发服务器

**使用方法**:
```bash
./scripts/restart.sh
# 或
npm run restart
```

**适用场景**:
- 日常开发启动
- 修改文件后重启
- 遇到缓存问题时重启

### deploy.sh
**用途**: 构建并部署到 GitHub Pages

**功能**:
- 检查环境依赖
- 显示环境信息
- 清理构建缓存
- 构建项目
- 导出静态文件
- 创建必要文件（.nojekyll, CNAME）
- 部署到 GitHub Pages
- 显示构建统计信息

**使用方法**:
```bash
./scripts/deploy.sh
# 或
npm run deploy
```

## 🛠️ 帮助工具

### help.sh
**用途**: 交互式 npm 命令帮助工具

**功能**:
- 显示项目信息和可用脚本
- 提供常用 npm 命令的快速访问
- 交互式菜单操作
- 命令执行和状态反馈
- **新增**: GitHub Pages 部署功能
  - 完整部署（构建 + 部署）

**使用方法**:
```bash
./scripts/help.sh
# 或
npm run help
```

**部署方式**:
运行 `./scripts/deploy.sh` 进行完整构建和部署流程

## 📚 NPM 命令参考

### 🚀 开发命令

#### 启动开发服务器
```bash
npm run dev
```
- 启动 Next.js 开发服务器
- 使用 Turbopack 加速编译
- 支持热重载
- 本地地址: http://localhost:3000

#### 构建生产版本
```bash
npm run build
```
- 构建优化的生产版本
- 生成静态文件
- 代码压缩和优化
- 类型检查

#### 启动生产服务器
```bash
npm run start
```
- 启动生产环境服务器
- 需要先运行 `npm run build`
- 用于生产环境部署

### 🔧 代码质量

#### 代码检查
```bash
npm run lint
```
- 运行 ESLint 检查代码质量
- 检查代码规范和潜在问题
- 不自动修复

#### 自动修复代码问题
```bash
npm run lint:fix
```
- 自动修复可修复的代码问题
- 格式化代码
- 修复简单的语法错误

#### TypeScript 类型检查
```bash
npm run type-check
```
- 检查 TypeScript 类型错误
- 不生成输出文件
- 验证类型定义

### 🧹 维护命令

#### 清理缓存
```bash
npm run clean
```
- 删除 `.next` 构建缓存
- 删除 `out` 导出目录
- 删除 `.turbo` 缓存
- 释放磁盘空间

#### 导出静态文件
```bash
npm run export
```
- 构建并导出静态文件
- 生成 `out` 目录
- 用于静态网站部署

### 📦 依赖管理

#### 安装依赖
```bash
npm install
# 或简写
npm i
```
- 安装 package.json 中的所有依赖
- 生成 node_modules 目录
- 生成 package-lock.json

#### 安装特定包
```bash
npm install package-name
npm install package-name@version
npm install --save-dev package-name  # 开发依赖
```

#### 更新依赖
```bash
npm update
npm update package-name
```

#### 删除依赖
```bash
npm uninstall package-name
npm uninstall --save-dev package-name
```

### 🔍 信息查询

#### 查看包信息
```bash
npm list
npm list --depth=0  # 只显示顶层依赖
npm list package-name
```

#### 查看过时的包
```bash
npm outdated
```

#### 查看包详情
```bash
npm info package-name
```

#### 查看脚本
```bash
npm run
```

### 🛠️ 高级命令

#### 运行脚本
```bash
npm run script-name
npm run script-name -- --arg  # 传递参数
```

#### 执行命令
```bash
npx command-name
npx create-next-app@latest my-app
```

#### 发布包
```bash
npm publish
npm publish --access public
```

#### 登录/登出
```bash
npm login
npm logout
npm whoami
```

## 🎯 使用场景

### 新项目设置
1. 克隆项目
2. 运行 `./scripts/install.sh`
3. 运行 `./scripts/restart.sh` 启动开发服务器

### 日常开发
1. 运行 `./scripts/restart.sh` 启动开发服务器
2. 修改代码
3. 如需重启，再次运行 `./scripts/restart.sh`

### 部署网站
1. 运行 `./scripts/deploy.sh` 部署到 GitHub Pages

### 获取帮助
1. 运行 `npm run help` 查看交互式帮助
2. 查看本文档获取详细说明

## 📋 npm 脚本命令

```bash
# 安装项目
npm run setup

# 重启开发服务器
npm run restart

# 部署网站
npm run deploy

# 获取帮助
npm run help

# 清理缓存
npm run clean

# 代码检查
npm run lint

# 类型检查
npm run type-check
```

## 🔧 脚本特点

### install.sh 特点
- ✅ 完整的环境检查
- ✅ 彻底的清理机制
- ✅ 安装验证
- ✅ 友好的错误提示

### restart.sh 特点
- ✅ 智能依赖检查
- ✅ 全面的缓存清理
- ✅ 强制进程停止
- ✅ 环境信息显示
- ✅ 用户友好的提示

### deploy.sh 特点
- ✅ 完整的环境检查
- ✅ 详细的构建过程
- ✅ 自动创建必要文件
- ✅ 构建统计信息

### help.sh 特点
- ✅ 彩色界面显示
- ✅ 项目信息展示
- ✅ 快速操作菜单
- ✅ 交互式命令执行

## ⚠️ 故障排除

### 常见问题

#### 1. 权限错误
```bash
chmod +x scripts/*.sh
```

#### 2. 端口被占用
- 脚本会自动尝试其他端口
- 或手动结束占用端口的进程

#### 3. 依赖安装失败
```bash
./scripts/install.sh
```

#### 4. 构建失败
```bash
npm run clean
npm run build
```

#### 5. 缓存问题
```bash
./scripts/restart.sh
```

### 权限问题
```bash
# 修复权限
sudo chown -R $USER:$GROUP ~/.npm
sudo chown -R $USER:$GROUP node_modules
```

### 缓存问题
```bash
# 清理 npm 缓存
npm cache clean --force

# 清理项目缓存
npm run clean
rm -rf node_modules package-lock.json
npm install
```

### 端口占用
```bash
# 查看端口占用
lsof -i :3000

# 杀死进程
kill -9 PID
```

### 浏览器强制刷新
如果页面显示旧内容，请在浏览器中：
- Windows/Linux: `Ctrl+Shift+R`
- Mac: `Cmd+Shift+R`
- 或者打开无痕模式访问

## 🎯 最佳实践

1. **定期更新依赖**
   ```bash
   npm outdated
   npm update
   ```

2. **使用 package-lock.json**
   - 确保依赖版本一致性
   - 不要手动修改

3. **合理使用脚本**
   - 将复杂命令封装为脚本
   - 使用有意义的脚本名称

4. **代码质量检查**
   ```bash
   npm run lint:fix
   npm run type-check
   ```

5. **定期清理**
   ```bash
   npm run clean
   npm cache clean --force
   ```

## 📚 相关文档

- [NPM 官方文档](https://docs.npmjs.com/)
- [Next.js 文档](https://nextjs.org/docs)
- [TypeScript 文档](https://www.typescriptlang.org/docs/)
- [ESLint 文档](https://eslint.org/docs/)

## 📝 更新日志

### 2024-12-19
- ✅ 在 `help.sh` 中添加了 GitHub Pages 部署功能
- ✅ 新增完整部署选项
- ✅ 更新了 `package.json` 添加 `deploy` 脚本
- ✅ 优化了交互式菜单，新增部署选项
- ✅ 更新了文档说明
- ✅ 重命名 `npm-help.sh` 为 `help.sh`
- ✅ 合并了文档文件

### 功能增强
- 🔨 **完整部署**: 运行 `./scripts/deploy.sh` 进行完整构建和部署流程
- 📋 **一键部署**: 在 help 脚本中提供直接部署选项
- 📚 **文档更新**: 更新了相关文档和说明
- 📖 **文档合并**: 将多个文档合并为综合使用指南 