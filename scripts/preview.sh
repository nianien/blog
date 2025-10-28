#!/bin/bash

# 静态文件预览脚本
# 用于构建和预览静态文件

# 切换到项目根目录
cd "$(dirname "$0")/.."

# 解析命令行参数
FORCE_BUILD=false
SKIP_BUILD=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --build|-b)
            FORCE_BUILD=true
            shift
            ;;
        --skip-build|-s)
            SKIP_BUILD=true
            shift
            ;;
        --help|-h)
            echo "用法: $0 [选项]"
            echo ""
            echo "选项:"
            echo "  -b, --build      强制重新构建静态文件"
            echo "  -s, --skip-build 跳过构建，仅预览现有文件"
            echo "  -h, --help       显示此帮助信息"
            echo ""
            echo "示例:"
            echo "  $0                # 自动检测是否需要构建"
            echo "  $0 --build        # 强制重新构建"
            echo "  $0 --skip-build   # 仅预览，不构建"
            exit 0
            ;;
        *)
            echo "未知选项: $1"
            echo "使用 --help 查看可用选项"
            exit 1
            ;;
    esac
done

echo "👀 启动静态文件预览..."

# 检查环境
echo "🔍 检查环境..."
if [ ! -f "package.json" ]; then
    echo "❌ 错误: 未找到 package.json 文件"
    exit 1
fi

# 检查是否需要构建
NEED_BUILD=false

if [ "$FORCE_BUILD" = true ]; then
    echo "🔨 强制重新构建..."
    NEED_BUILD=true
elif [ "$SKIP_BUILD" = true ]; then
    echo "⏭️  跳过构建检查..."
    NEED_BUILD=false
elif [ ! -d "out" ] || [ -z "$(ls -A out 2>/dev/null)" ]; then
    echo "📦 静态文件目录不存在或为空，需要构建..."
    NEED_BUILD=true
else
    echo "✅ 静态文件目录已存在"
    NEED_BUILD=false
fi

# 执行构建
if [ "$NEED_BUILD" = true ]; then
    echo "🔨 开始构建静态文件..."
    echo "⏳ 这可能需要几分钟时间..."

    if npm run build:export; then
        echo "✅ 构建完成！"
    else
        echo "❌ 构建失败！"
        exit 1
    fi
    echo ""
fi

# 最终检查静态文件目录
if [ ! -d "out" ] || [ -z "$(ls -A out 2>/dev/null)" ]; then
    echo "❌ 错误: 静态文件目录 out/ 不存在或为空"
    echo "💡 请运行: $0 --build 来构建静态文件"
    exit 1
fi

# 停止相关进程
echo "🛑 停止相关进程..."
pkill -f "python3 -m http.server" 2>/dev/null || true
pkill -f "npx serve" 2>/dev/null || true
pkill -f "python -m http.server" 2>/dev/null || true

# 释放端口
echo "🧹 释放端口 8000..."
if lsof -i :8000 >/dev/null 2>&1; then
    lsof -i :8000 | grep LISTEN | awk '{print $2}' | xargs kill -9 2>/dev/null || true
    sleep 2
    echo "✅ 端口 8000 已释放"
else
    echo "✅ 端口 8000 可用"
fi

# 显示静态文件信息
echo "📋 静态文件信息:"
FILE_COUNT=$(find out -type f | wc -l)
TOTAL_SIZE=$(du -sh out | cut -f1)
echo "   - 文件数量: $FILE_COUNT"
echo "   - 总大小: $TOTAL_SIZE"
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
    echo "🚀 服务器启动中..."
    python3 -m http.server 8000
elif command -v python &> /dev/null; then
    echo "🐍 使用 Python HTTP 服务器"
    echo "🚀 服务器启动中..."
    python -m http.server 8000
elif command -v npx &> /dev/null; then
    echo "📦 使用 npx serve"
    echo "🚀 服务器启动中..."
    npx serve -s . -l 8000
else
    echo "❌ 错误: 未找到可用的 HTTP 服务器"
    echo "💡 请安装以下任一工具:"
    echo "   - Python3: brew install python3 (macOS) 或 apt install python3 (Ubuntu)"
    echo "   - Node.js: brew install node (macOS) 或 apt install nodejs npm (Ubuntu)"
    exit 1
fi 