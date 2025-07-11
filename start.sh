#!/bin/bash

# 快速启动脚本 - 简化版开发服务器
# 用于快速启动 Next.js 开发服务器

echo "🚀 快速启动开发服务器..."

# 检查依赖是否安装
if [ ! -d "node_modules" ]; then
    echo "📦 安装依赖..."
    npm install
fi

# 释放端口 3000
echo "🧹 释放端口 3000..."
lsof -i :3000 | grep LISTEN | awk '{print $2}' | xargs kill -9 2>/dev/null || true
sleep 1

echo "🌐 启动开发服务器..."
echo "📱 访问地址: http://localhost:3000"
echo "🛑 按 Ctrl+C 停止服务器"
echo ""

npm run dev 