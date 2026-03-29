#!/usr/bin/env tsx
/**
 * SVG → PNG 批量转换工具
 *
 * 使用 Node.js 内置的 Web API 渲染 SVG，需要在本地 Mac/PC 上运行（需要中文字体支持）。
 *
 * 用法：
 *   npx tsx scripts/svg2png.ts                         # 转换所有 SVG
 *   npx tsx scripts/svg2png.ts public/images/blog/agentic-01  # 转换指定目录
 *   npx tsx scripts/svg2png.ts path/to/file.svg        # 转换单个文件
 *
 * 依赖：@napi-rs/canvas（已在 devDependencies 中）
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { resolve, extname, basename, dirname, join } from 'node:path'
import { execSync } from 'node:child_process'

// ─── 参数解析 ───

const target = process.argv[2] || 'public/images/blog'
const targetPath = resolve(target)
const scale = 2 // 2x for retina / WeChat

// ─── 收集 SVG 文件 ───

function collectSvgFiles(dir: string): string[] {
  const files: string[] = []

  if (!existsSync(dir)) {
    console.error(`❌ 路径不存在: ${dir}`)
    process.exit(1)
  }

  const stat = statSync(dir)
  if (stat.isFile()) {
    if (extname(dir) === '.svg') files.push(dir)
    return files
  }

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectSvgFiles(fullPath))
    } else if (entry.isFile() && extname(entry.name) === '.svg') {
      files.push(fullPath)
    }
  }
  return files
}

const svgFiles = collectSvgFiles(targetPath)

if (svgFiles.length === 0) {
  console.log('📭 未找到 SVG 文件')
  process.exit(0)
}

console.log(`🔍 找到 ${svgFiles.length} 个 SVG 文件\n`)

// ─── 使用 resvg-js 转换（比 @napi-rs/canvas 对 SVG 支持更好）───

async function convertWithResvg(svgPath: string): Promise<void> {
  const { Resvg } = await import('@aspect-build/resvg-nodejs').catch(() => {
    // fallback to resvg-js
    return import('@aspect-build/resvg-nodejs').catch(() => null)
  }) || await import('@aspect-build/resvg-nodejs').catch(() => null) || { Resvg: null }

  if (!Resvg) {
    // Fallback: use system tools
    return convertWithSystemTool(svgPath)
  }

  const svg = readFileSync(svgPath, 'utf-8')
  const resvg = new Resvg(svg, { dpi: 72 * scale })
  const pngData = resvg.render()
  const pngBuffer = pngData.asPng()
  const pngPath = svgPath.replace(/\.svg$/, '.png')
  writeFileSync(pngPath, pngBuffer)
}

// ─── Fallback: 使用系统命令行工具 ───

function convertWithSystemTool(svgPath: string): void {
  const pngPath = svgPath.replace(/\.svg$/, '.png')

  // 尝试 rsvg-convert (Linux)
  try {
    execSync(`which rsvg-convert`, { stdio: 'ignore' })
    execSync(`rsvg-convert -z ${scale} "${svgPath}" -o "${pngPath}"`)
    return
  } catch {}

  // 尝试 Inkscape
  try {
    execSync(`which inkscape`, { stdio: 'ignore' })
    execSync(`inkscape "${svgPath}" --export-type=png --export-filename="${pngPath}" --export-dpi=${72 * scale}`)
    return
  } catch {}

  // 尝试 macOS sips (通过临时 HTML)
  // macOS 没有直接的 SVG→PNG 工具，使用 qlmanage 作为 fallback
  try {
    execSync(`which qlmanage`, { stdio: 'ignore' })
    const tmpDir = '/tmp/svg2png'
    execSync(`mkdir -p "${tmpDir}"`)
    execSync(`qlmanage -t -s ${800 * scale} -o "${tmpDir}" "${svgPath}" 2>/dev/null`)
    const qlOutput = join(tmpDir, basename(svgPath) + '.png')
    if (existsSync(qlOutput)) {
      execSync(`mv "${qlOutput}" "${pngPath}"`)
      return
    }
  } catch {}

  // 最终 fallback: 使用 Chrome headless
  try {
    const chromeCmd = process.platform === 'darwin'
      ? '"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"'
      : 'google-chrome'

    // 创建一个临时 HTML 来渲染 SVG
    const svgContent = readFileSync(svgPath, 'utf-8')
    const viewBoxMatch = svgContent.match(/viewBox="(\d+)\s+(\d+)\s+(\d+)\s+(\d+)"/)
    const width = viewBoxMatch ? parseInt(viewBoxMatch[3]) : 800
    const height = viewBoxMatch ? parseInt(viewBoxMatch[4]) : 600

    const tmpHtml = `/tmp/svg2png-render.html`
    writeFileSync(tmpHtml, `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; }
  body { width: ${width}px; height: ${height}px; }
  img { width: 100%; height: 100%; }
</style></head>
<body><img src="file://${svgPath}" /></body></html>`)

    execSync(`${chromeCmd} --headless --disable-gpu --screenshot="${pngPath}" --window-size=${width * scale},${height * scale} "file://${tmpHtml}" 2>/dev/null`)
    return
  } catch {}

  throw new Error('无可用的转换工具。请安装 rsvg-convert、Inkscape 或确保 Chrome 可用。')
}

// ─── 主流程 ───

let success = 0
let failed = 0

for (const svgPath of svgFiles) {
  const relPath = svgPath.replace(resolve('.') + '/', '')
  const pngPath = relPath.replace(/\.svg$/, '.png')

  try {
    convertWithSystemTool(svgPath)
    const size = statSync(svgPath.replace(/\.svg$/, '.png')).size
    console.log(`✅ ${relPath} → ${pngPath} (${(size / 1024).toFixed(1)} KB)`)
    success++
  } catch (err: any) {
    console.error(`❌ ${relPath}: ${err.message}`)
    failed++
  }
}

console.log(`\n📊 完成: ${success} 成功, ${failed} 失败`)
