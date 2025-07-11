#!/bin/bash
set -e

# 1. 构建并导出静态文件
npm run build      # next build：构建应用
npm run export     # next export：将页面导出为纯静态文件到 out/

# 2. 确保 .nojekyll 文件存在
touch out/.nojekyll

# 3. 部署到 GitHub Pages
npm run deploy     # gh-pages -d out：将 out 推送到 gh-pages 分支

echo "[deploy] 部署完成！" 