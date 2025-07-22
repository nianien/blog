# 脚本索引

## 核心脚本

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

## 帮助文档

### npm-help.sh
**用途**: 交互式 npm 命令帮助工具
**功能**:
- 显示项目信息和可用脚本
- 提供常用 npm 命令的快速访问
- 交互式菜单操作
- 命令执行和状态反馈

**使用方法**:
```bash
./scripts/npm-help.sh
# 或
npm run help
```

### NPM_COMMANDS.md
**用途**: 详细的 npm 命令参考文档
**内容**:
- 开发命令（dev, build, start）
- 代码质量命令（lint, type-check）
- 维护命令（clean, export）
- 依赖管理命令（install, update）
- 信息查询命令（list, outdated）
- 高级命令和最佳实践
- 常见问题和故障排除

**使用方法**:
```bash
cat scripts/NPM_COMMANDS.md
# 或
less scripts/NPM_COMMANDS.md
```

## 使用流程

### 首次使用
1. 克隆项目
2. 运行 `./scripts/install.sh` 进行完整安装
3. 运行 `./scripts/restart.sh` 启动开发服务器

### 日常开发
1. 运行 `./scripts/restart.sh` 启动开发服务器
2. 修改代码
3. 如需重启，再次运行 `./scripts/restart.sh`

### 部署网站
1. 运行 `./scripts/deploy.sh` 部署到 GitHub Pages

### 获取帮助
1. 运行 `npm run help` 查看交互式帮助
2. 查看 `scripts/NPM_COMMANDS.md` 获取详细文档

## npm 脚本命令

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

## 脚本特点

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

### npm-help.sh 特点
- ✅ 彩色界面显示
- ✅ 项目信息展示
- ✅ 快速操作菜单
- ✅ 交互式命令执行

## 故障排除

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

### 浏览器强制刷新
如果页面显示旧内容，请在浏览器中：
- Windows/Linux: `Ctrl+Shift+R`
- Mac: `Cmd+Shift+R`
- 或者打开无痕模式访问 