#!/bin/bash
# 博客项目统一 CLI
# 用法: ./scripts/cli.sh <command> [options]

set -e
cd "$(dirname "$0")/.."

# ─── 工具函数 ───

check_env() {
  if ! command -v node &> /dev/null; then
    echo "❌ 未找到 Node.js"
    exit 1
  fi
  if [ ! -d "node_modules" ]; then
    echo "📦 安装依赖..."
    npm install
  fi
}

kill_port() {
  local port=$1
  if lsof -i :"$port" >/dev/null 2>&1; then
    lsof -i :"$port" | grep LISTEN | awk '{print $2}' | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
}

# ─── 子命令 ───

cmd_dev() {
  check_env
  echo "🛑 停止已有进程..."
  pkill -f "next dev" 2>/dev/null || true
  kill_port 3000
  rm -rf .next .turbo

  echo "🌐 启动开发服务器 http://localhost:3000"
  npm run dev
}

cmd_build() {
  check_env
  echo "🔨 构建静态文件..."
  rm -rf .next out .turbo
  npm run export
  echo "✅ 构建完成 ($(find out -type f | wc -l | tr -d ' ') 文件, $(du -sh out | cut -f1))"
}

cmd_preview() {
  check_env
  # 自动构建（如果 out/ 不存在）
  if [ ! -d "out" ] || [ -z "$(ls -A out 2>/dev/null)" ]; then
    cmd_build
  fi

  pkill -f "python3 -m http.server" 2>/dev/null || true
  kill_port 8000

  echo "🌐 预览 http://localhost:8000"
  cd out && python3 -m http.server 8000
}

cmd_deploy() {
  check_env
  cmd_build
  touch out/.nojekyll
  echo 'skyfalling.cn' > out/CNAME

  echo "🌐 部署到 GitHub Pages..."
  npm run deploy
  echo "🎉 部署完成 https://www.skyfalling.cn"
}

cmd_clean() {
  echo "🧹 清理缓存..."
  rm -rf .next out .turbo
  echo "✅ 清理完成"
}

cmd_wx_build() {
  echo "📦 构建微信云函数 zip 包..."
  cd scripts/wx/scf
  zip -j wx-proxy.zip index.js form-data-lite.js package.json
  echo "✅ 构建完成: scripts/wx/scf/wx-proxy.zip"
}

cmd_wx_preview() {
  if [ -z "$1" ]; then
    echo "用法: $0 wx:preview <md文件路径>"
    exit 1
  fi
  check_env
  npx tsx scripts/wx/publish.ts --preview "$1"
}

cmd_wx_publish() {
  if [ -z "$1" ]; then
    echo "用法: $0 wx:publish <md文件路径>"
    exit 1
  fi
  check_env
  npx tsx scripts/wx/publish.ts "$1"
}

cmd_help() {
  cat <<'EOF'
📖 博客项目 CLI

用法: ./scripts/cli.sh <command> [options]

开发:
  dev              启动开发服务器 (localhost:3000)
  build            构建静态文件到 out/
  preview          预览静态文件 (localhost:8000)
  clean            清理构建缓存

部署:
  deploy           构建并部署到 GitHub Pages

微信公众号:
  wx:build         构建云函数 zip 包
  wx:preview <md>  生成微信排版预览 HTML
  wx:publish <md>  发布文章到公众号草稿箱

示例:
  ./scripts/cli.sh dev
  ./scripts/cli.sh deploy
  ./scripts/cli.sh wx:preview src/content/blog/insights/technology/xxx.md
  ./scripts/cli.sh wx:publish src/content/blog/insights/technology/xxx.md
EOF
}

# ─── 路由 ───

case "${1:-help}" in
  dev)        cmd_dev ;;
  build)      cmd_build ;;
  preview)    cmd_preview ;;
  deploy)     cmd_deploy ;;
  clean)      cmd_clean ;;
  wx:build)   cmd_wx_build ;;
  wx:preview) cmd_wx_preview "$2" ;;
  wx:publish) cmd_wx_publish "$2" ;;
  help|--help|-h) cmd_help ;;
  *)
    echo "未知命令: $1"
    echo ""
    cmd_help
    exit 1
    ;;
esac
