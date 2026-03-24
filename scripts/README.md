# 脚本使用指南

统一入口：`./scripts/cli.sh <command>`

## 命令一览

| 命令 | 说明 |
|------|------|
| `dev` | 启动开发服务器 (localhost:3000) |
| `build` | 构建静态文件到 out/ |
| `preview` | 预览静态文件 (localhost:8000) |
| `deploy` | 构建并部署到 GitHub Pages |
| `clean` | 清理构建缓存 |
| `wx:preview <md>` | 生成微信公众号排版预览 HTML |
| `wx:publish <md>` | 发布文章到公众号草稿箱 |
| `help` | 显示帮助信息 |

## 常用示例

```bash
# 日常开发
./scripts/cli.sh dev

# 部署
./scripts/cli.sh deploy

# 微信公众号
./scripts/cli.sh wx:preview src/content/blog/insights/technology/xxx.md
./scripts/cli.sh wx:publish src/content/blog/insights/technology/xxx.md
```

## 目录结构

```
scripts/
├── cli.sh          # 统一 CLI 入口
└── wx/             # 微信公众号发布工具
    ├── publish.ts   # 主脚本（CLI 入口）
    ├── api.ts       # 微信 API 封装
    ├── styles.ts    # 内联样式配置
    └── cover.ts     # 封面图生成器
```

## 微信发布配置

1. 在项目根目录创建 `.env.wx`：
   ```
   WX_APPID=your_appid
   WX_APPSECRET=your_appsecret
   ```
2. 在微信公众平台 IP 白名单中添加本机 IP
3. 首次发布会自动生成标题卡片封面图，也可在 frontmatter 中指定 `cover: path/to/image.jpg`
