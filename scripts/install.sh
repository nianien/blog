#!/bin/bash

# 项目安装脚本
# 用于首次安装和设置项目环境

# 切换到项目根目录
cd "$(dirname "$0")/.."

echo "🚀 开始安装项目..."

# 检查环境
echo "🔍 检查环境..."
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到 Node.js，请先安装 Node.js"
    echo "💡 建议: 访问 https://nodejs.org/ 下载并安装 Node.js"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ 错误: 未找到 npm，请先安装 npm"
    exit 1
fi

if [ ! -f "package.json" ]; then
    echo "❌ 错误: 未找到 package.json 文件"
    exit 1
fi

# 显示环境信息
echo "📋 环境信息:"
echo "   Node.js 版本: $(node --version)"
echo "   npm 版本: $(npm --version)"
echo ""

# 清理旧文件（保留 package-lock.json 确保依赖版本一致）
echo "🧹 清理旧文件..."
rm -rf node_modules .next out .turbo

# 安装依赖
echo "📦 安装依赖包..."
npm install
if [ $? -ne 0 ]; then
    echo "❌ 依赖安装失败"
    exit 1
fi

# 验证安装
echo "✅ 验证安装..."
npm run build
if [ $? -ne 0 ]; then
    echo "❌ 构建验证失败"
    exit 1
fi

echo ""
echo "🎉 安装完成！"
echo ""
echo "📝 使用说明:"
echo "   启动开发服务器: ./scripts/restart.sh"
echo "   部署到生产环境: ./scripts/deploy.sh"
echo ""
echo "🌐 开发服务器地址: http://localhost:3000"
echo "" 