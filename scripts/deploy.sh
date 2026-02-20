#!/bin/bash
set -e

# GitHub Pages 部署脚本
# 用于构建并部署到 GitHub Pages

# 切换到项目根目录
cd "$(dirname "$0")/.."

echo "🚀 开始部署到 GitHub Pages..."

# 检查环境
echo "🔍 检查环境..."
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到 Node.js，请先安装 Node.js"
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

# 检查并安装依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装依赖包..."
    npm install
fi

# 清理缓存
echo "🧹 清理缓存..."
rm -rf .next out .turbo

# 构建并导出静态文件（一步完成）
echo "🔨 构建静态文件..."
echo "⏳ 这可能需要几分钟时间..."
npm run export

# 创建必要文件
echo "📝 创建部署文件..."
touch out/.nojekyll
echo 'skyfalling.cn' > out/CNAME

# 显示构建结果
echo ""
echo "✅ 构建完成！"
echo "📁 静态文件位置: out/"
echo "📊 构建统计:"
echo "   - 总文件数: $(find out -type f | wc -l)"
echo "   - 总大小: $(du -sh out | cut -f1)"
echo ""

# 部署到 GitHub Pages
echo "🌐 部署到 GitHub Pages..."
npm run deploy

echo ""
echo "🎉 部署完成！"
echo "🌍 网站地址: https://www.skyfalling.cn"
echo "⏱️  部署时间: $(date)"
echo ""
