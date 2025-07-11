#!/bin/bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info() { echo -e "${YELLOW}$1${NC}"; }
success() { echo -e "${GREEN}$1${NC}"; }
error() { echo -e "${RED}$1${NC}"; }

info "🧹 杀掉 github-pages-server.py 进程和释放端口 8080..."
pkill -f "github-pages-server.py" 2>/dev/null || true
lsof -i :8080 | grep LISTEN | awk '{print $2}' | xargs kill -9 2>/dev/null || true
sleep 1

info "🚀 构建静态站点..."
if npm run build; then
  success "✅ 构建完成"
else
  error "❌ 构建失败，退出"
  exit 1
fi

info "🗂️  复制 index.html 到 out/gitbook/index.html"
mkdir -p out/gitbook
cp out/index.html out/gitbook/index.html

info "🌐 启动本地 GitHub Pages 模拟服务器 (8080)"
if lsof -i :8080 | grep LISTEN; then
  error "❌ 端口 8080 仍被占用，无法启动服务器"
  exit 1
fi

exec python3 github-pages-server.py 