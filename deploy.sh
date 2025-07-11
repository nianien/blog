#!/bin/bash
set -e

# GitHub Pages 发布脚本
# 用于构建并部署到 GitHub Pages

echo "🚀 开始发布到 GitHub Pages..."

# 检查 Node.js 是否安装
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到 Node.js，请先安装 Node.js"
    exit 1
fi

# 检查 npm 是否安装
if ! command -v npm &> /dev/null; then
    echo "❌ 错误: 未找到 npm，请先安装 npm"
    exit 1
fi

# 检查 package.json 是否存在
if [ ! -f "package.json" ]; then
    echo "❌ 错误: 未找到 package.json 文件"
    exit 1
fi

# 检查 node_modules 是否存在，如果不存在则安装依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装依赖包..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ 依赖安装失败"
        exit 1
    fi
fi

# 清理之前的构建缓存
echo "🧹 清理构建缓存..."
rm -rf .next
rm -rf out

# 构建项目
echo "🔨 构建项目..."
if npm run build; then
    echo "✅ 构建完成"
else
    echo "❌ 构建失败"
    exit 1
fi

# 导出静态文件
echo "📤 导出静态文件..."
if npm run export; then
    echo "✅ 导出完成"
else
    echo "❌ 导出失败"
    exit 1
fi

# 确保 .nojekyll 文件存在
echo "📝 创建 .nojekyll 文件..."
touch out/.nojekyll

# 显示构建结果
echo ""
echo "🎉 构建完成！"
echo "📁 静态文件位置: out/"
echo "📊 构建统计:"
echo "   - 总文件数: $(find out -type f | wc -l)"
echo "   - 总大小: $(du -sh out | cut -f1)"
echo ""

# 部署到 GitHub Pages
echo "🌐 部署到 GitHub Pages..."
if npm run deploy; then
    echo "✅ 部署完成！"
    echo "🌍 网站地址: https://skyfalling.cn"
else
    echo "❌ 部署失败"
    exit 1
fi

echo ""
echo "🎉 发布完成！"
echo "📱 访问地址: https://skyfalling.cn" 