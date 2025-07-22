# NPM 命令帮助文档

## 🚀 开发命令

### 启动开发服务器
```bash
npm run dev
```
- 启动 Next.js 开发服务器
- 使用 Turbopack 加速编译
- 支持热重载
- 本地地址: http://localhost:3000

### 构建生产版本
```bash
npm run build
```
- 构建优化的生产版本
- 生成静态文件
- 代码压缩和优化
- 类型检查

### 启动生产服务器
```bash
npm run start
```
- 启动生产环境服务器
- 需要先运行 `npm run build`
- 用于生产环境部署

## 🔧 代码质量

### 代码检查
```bash
npm run lint
```
- 运行 ESLint 检查代码质量
- 检查代码规范和潜在问题
- 不自动修复

### 自动修复代码问题
```bash
npm run lint:fix
```
- 自动修复可修复的代码问题
- 格式化代码
- 修复简单的语法错误

### TypeScript 类型检查
```bash
npm run type-check
```
- 检查 TypeScript 类型错误
- 不生成输出文件
- 验证类型定义

## 🧹 维护命令

### 清理缓存
```bash
npm run clean
```
- 删除 `.next` 构建缓存
- 删除 `out` 导出目录
- 删除 `.turbo` 缓存
- 释放磁盘空间

### 导出静态文件
```bash
npm run export
```
- 构建并导出静态文件
- 生成 `out` 目录
- 用于静态网站部署

## 📦 依赖管理

### 安装依赖
```bash
npm install
# 或简写
npm i
```
- 安装 package.json 中的所有依赖
- 生成 node_modules 目录
- 生成 package-lock.json

### 安装特定包
```bash
npm install package-name
npm install package-name@version
npm install --save-dev package-name  # 开发依赖
```

### 更新依赖
```bash
npm update
npm update package-name
```

### 删除依赖
```bash
npm uninstall package-name
npm uninstall --save-dev package-name
```

## 🔍 信息查询

### 查看包信息
```bash
npm list
npm list --depth=0  # 只显示顶层依赖
npm list package-name
```

### 查看过时的包
```bash
npm outdated
```

### 查看包详情
```bash
npm info package-name
```

### 查看脚本
```bash
npm run
```

## 🛠️ 高级命令

### 运行脚本
```bash
npm run script-name
npm run script-name -- --arg  # 传递参数
```

### 执行命令
```bash
npx command-name
npx create-next-app@latest my-app
```

### 发布包
```bash
npm publish
npm publish --access public
```

### 登录/登出
```bash
npm login
npm logout
npm whoami
```

## 📋 常用组合命令

### 完整开发流程
```bash
# 1. 安装依赖
npm install

# 2. 启动开发服务器
npm run dev

# 3. 代码检查
npm run lint
npm run type-check

# 4. 构建生产版本
npm run build

# 5. 清理缓存
npm run clean
```

### 部署流程
```bash
# 1. 清理缓存
npm run clean

# 2. 安装依赖
npm install

# 3. 构建项目
npm run build

# 4. 导出静态文件
npm run export
```

## ⚠️ 常见问题

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