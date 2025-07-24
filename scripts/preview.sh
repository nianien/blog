#!/bin/bash

# 静态文件预览脚本
# 用于预览构建后的静态文件

# 切换到项目根目录
cd "$(dirname "$0")/.."

echo "👀 启动静态文件预览..."

# 检查环境
echo "🔍 检查环境..."
if [ ! -f "package.json" ]; then
    echo "❌ 错误: 未找到 package.json 文件"
    exit 1
fi

# 检查静态文件是否存在
if [ ! -d "out" ]; then
    echo "❌ 错误: 未找到静态文件目录 out/"
    echo "💡 建议: 先运行 npm run build:export 构建静态文件"
    exit 1
fi

# 停止相关进程
echo "🛑 停止相关进程..."
pkill -f "python3 -m http.server" 2>/dev/null || true
pkill -f "npx serve" 2>/dev/null || true
pkill -f "python -m http.server" 2>/dev/null || true

# 释放端口
echo "🧹 释放端口 8000..."
lsof -i :8000 | grep LISTEN | awk '{print $2}' | xargs kill -9 2>/dev/null || true
sleep 2

# 显示静态文件信息
echo "📋 静态文件信息:"
echo "   - 文件数量: $(find out -type f | wc -l)"
echo "   - 总大小: $(du -sh out | cut -f1)"
echo ""

# 启动静态文件服务器
echo "🌐 启动静态文件服务器..."
echo "📱 本地地址: http://localhost:8000"
echo "🛑 停止服务器: Ctrl+C"
echo ""

# 切换到 out 目录并启动服务器
cd out

# 优先使用 python3，其次使用 npx serve
if command -v python3 &> /dev/null; then
    echo "🐍 使用 Python3 HTTP 服务器"
    python3 -m http.server 8000
elif command -v python &> /dev/null; then
    echo "🐍 使用 Python HTTP 服务器"
    python -m http.server 8000
elif command -v npx &> /dev/null; then
    echo "📦 使用 npx serve"
    npx serve -s . -l 8000
else
    echo "❌ 错误: 未找到可用的 HTTP 服务器"
    echo "💡 请安装 Python3 或 Node.js"
    exit 1
fi 