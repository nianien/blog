# 脚本使用指南

统一入口：`./scripts/cli.sh <command>`。执行前确认是开发预览、静态预览还是对外发布。

| 命令 | 作用 |
| --- | --- |
| `dev` | 启动开发服务；已有当前工程开发服务则复用，其他服务占用端口时退出 |
| `build` | 清缓存后导出静态文件到 out |
| `preview` | 在 8000 端口预览 out，复用当前工程预览；仅在产物缺失且端口空闲时构建 |
| `deploy` | 构建并部署到 GitHub Pages |
| `deploy:cf` | 构建并直传 Cloudflare Pages |
| `clean` | 清理 .next、out、.turbo |
| `wx:build` | 打包微信代理代码为 zip |
| `wx:preview <md> [--serve] [--no-open]` | 本地转换微信 HTML 与图片，不调用上传/草稿接口 |
| `wx:publish <md>` | 上传图片并创建公众号草稿 |
| `help` | 显示帮助 |

`dev/preview` 使用 `server-status.cjs` 同时核对工作目录和启动命令；不再使用 pkill 或按端口杀进程。无法确认归属、缺少 lsof 或端口被其他服务占用时明确退出；next start 不会误判成开发服务。修改文章后静态预览需要先 `npm run build:export`，以免看到旧产物。

## 微信配置与链路

本地 `scripts/wx/api.ts` 读取根目录 `.env.wx`：

```dotenv
WX_PROXY_URL=https://your-service.example/wx-proxy
WX_PROXY_TOKEN=your-proxy-token
```

代码不读取 WX_APPID / WX_APPSECRET。本地客户端向代理发送 Bearer 头；仓库内 `scripts/wx/scf/index.js` 当前没有校验该头。若线上依赖网关鉴权，应核实网关配置，不能仅凭客户端发送 token 认定代理已鉴权。

代理使用微信云托管开放接口服务，处理图片上传与草稿创建。修改配置、调用真实接口、发布或部署都不属于普通文章预览。

## 内容转换与验收

- `publish.ts` 使用独立 marked renderer 与内联样式，去除外链标签
- 网站和微信共用 `src/lib/content-paths.ts`：原文链接保留目录，优先 frontmatter slug，兼容中文文件名回退、basePath 和结尾斜杠
- `/images/...` 映射到工程 `public/images/...`；编码、查询参数与片段不会混入文件系统路径
- 相对图片路径以 Markdown 文件为基准解析，目标必须位于 public；新文章仍统一使用 `/images/blog/...`
- 只有实际引用的 SVG 才通过 sharp 转成 PNG，结果保存在 `wx_out/images/`；已有 PNG/JPG 原样读取，不会被同名 SVG 替代
- 微信封面优先 `cover`，未指定时复用网站的 `heroImage`，使用同一本地图片解析规则
- 本地正文图片缺失时明确失败，不再跳过图片后继续创建草稿
- 预览生成标准 file URL 指向本地图片，不依赖 /Users 或 /home 等平台目录特例；`--preview --no-open` 可仅生成文件
- `tsconfig.json` 排除了 scripts，网站类型检查不等于发布脚本验证
- 浏览器验收可用 `./scripts/cli.sh wx:preview <md> --serve`：只在 127.0.0.1 的空闲端口提供生成页面及本次配图，不开放目录与任意文件读取，禁止脚本和外部资源；终端显示地址，Ctrl+C 结束
- 预览与上传分别验证，不能为了检查排版而调用真实发布接口
- CLI 使用 `npx tsx` / `npx wrangler`，当前未锁定这些工具为项目依赖；首次运行可能需要下载

## SVG 工具

审计的 ERROR 表示文件解析或必要属性错误，退出码非零；WARN 表示样式或启发式几何提醒，仅有提醒时退出码为 0；MANUAL 表示静态检查覆盖不足。提醒需结合实际图形核对，退出码不能替代视觉验收。自动修复保留已有描边宽度，复杂样式拒绝自动改写，不为统一风格丢失原图语义。

图形审计与保守修复的实现位于 `.agents/skills/svg-check/`，兼容入口位于 `.claude/skills/svg-check/`。

```bash
python3 .agents/skills/svg-check/svg-audit.py dual-language-rule-engine
python3 .agents/skills/svg-check/svg-fix.py public/images/blog/dual-language-rule-engine/two-layer.svg --dry-run
```

通用导出脚本 `scripts/svg2png.ts` 使用本机转换工具，微信脚本使用 sharp；两条链路并不相同。导出成功不证明字体、裁切与正文缩放正确，需要检查实际输出图。

## 工具回归检查

```bash
python3 -B scripts/tests/test_svg_tools.py
node --test scripts/tests/wx-preview.test.cjs scripts/tests/server-status.test.cjs
```

微信检查执行实际转换入口，使用隔离临时文件与上传 stub，不访问真实微信接口。进程检查包含真实临时监听端口，确认拒绝后原服务仍可响应。
