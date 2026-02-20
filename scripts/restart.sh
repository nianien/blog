#!/bin/bash

# 开发服务器启动/重启脚本
# 用于启动或重启 Next.js 开发服务器

# 切换到项目根目录
cd "$(dirname "$0")/.."

echo "🔄 启动/重启开发服务器..."

# 检查环境
echo "🔍 检查环境..."
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到 Node.js，请先安装 Node.js"
    echo "💡 建议: 运行 ./scripts/install.sh 进行完整安装"
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

# 检查并安装依赖
if [ ! -d "node_modules" ]; then
    echo "📦 检测到缺少依赖，正在安装..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ 依赖安装失败"
        echo "💡 建议: 运行 ./scripts/install.sh 进行完整安装"
        exit 1
    fi
fi

# 停止相关进程
echo "🛑 停止相关进程..."
pkill -f "next dev" 2>/dev/null || true
pkill -f "next start" 2>/dev/null || true
pkill -f "npm run dev" 2>/dev/null || true

# 释放端口
echo "🧹 释放端口 3000..."
lsof -i :3000 | grep LISTEN | awk '{print $2}' | xargs kill -9 2>/dev/null || true
sleep 2

# 清理缓存
echo "🧹 清理缓存..."
rm -rf .next out .turbo

# 显示环境信息
echo "📋 环境信息:"
echo "   Node.js 版本: $(node --version)"
echo "   npm 版本: $(npm --version)"
echo ""

# 启动开发服务器
echo "🌐 启动开发服务器..."
echo "📱 本地地址: http://localhost:3000"
echo "🛑 停止服务器: Ctrl+C"
echo ""

npm run dev 