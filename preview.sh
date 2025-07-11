#!/bin/bash

# 静态站点预览脚本
# 用于启动本地服务器预览构建好的静态网站

echo "🌐 启动静态站点预览服务器..."

# 检查 out 目录是否存在
if [ ! -d "out" ]; then
    echo "❌ 错误: 未找到 out 目录，请先运行 ./build.sh 构建项目"
    exit 1
fi

# 检查 out 目录是否为空
if [ -z "$(ls -A out)" ]; then
    echo "❌ 错误: out 目录为空，请先运行 ./build.sh 构建项目"
    exit 1
fi

# 检查端口 8000 是否被占用
if lsof -i :8000 | grep LISTEN > /dev/null; then
    echo "⚠️  警告: 端口 8000 已被占用，尝试使用端口 8001..."
    PORT=8001
else
    PORT=8000
fi

echo "📱 预览地址: http://localhost:$PORT"
echo "🛑 按 Ctrl+C 停止服务器"
echo ""

# 启动 Python HTTP 服务器
python3 -m http.server $PORT --directory out 