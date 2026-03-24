/**
 * 微信封面图生成器
 * 根据文章标题自动生成标题卡片风格的封面图
 */

import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { writeFileSync, existsSync } from 'node:fs'

// 注册中文字体
const fontPaths = [
  '/System/Library/Fonts/STHeiti Medium.ttc',       // macOS
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc', // Linux
  'C:\\Windows\\Fonts\\msyh.ttc',                   // Windows
]
for (const fp of fontPaths) {
  if (existsSync(fp)) {
    GlobalFonts.registerFromPath(fp, 'CJK')
    break
  }
}

const WIDTH = 900
const HEIGHT = 383

/** 根据标题文字生成一个稳定的色相值 */
function titleToHue(title: string): number {
  let hash = 0
  for (let i = 0; i < title.length; i++) {
    hash = ((hash << 5) - hash + title.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % 360
}

/** HSL → RGB */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100
  l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

function rgbStr(r: number, g: number, b: number): string {
  return `rgb(${r},${g},${b})`
}

/** 中文标题自动换行 */
function wrapTitle(
  ctx: any,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = []
  let current = ''
  for (const char of text) {
    const test = current + char
    const metrics = ctx.measureText(test)
    if (metrics.width > maxWidth && current) {
      lines.push(current)
      current = char
    } else {
      current = test
    }
  }
  if (current) lines.push(current)
  return lines
}

export function generateCover(title: string, tags: string[] = []): Buffer {
  const canvas = createCanvas(WIDTH, HEIGHT)
  const ctx = canvas.getContext('2d')

  // ─── 背景渐变 ───
  const hue = titleToHue(title)
  const [r1, g1, b1] = hslToRgb(hue, 65, 25)
  const [r2, g2, b2] = hslToRgb((hue + 40) % 360, 70, 35)
  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT)
  gradient.addColorStop(0, rgbStr(r1, g1, b1))
  gradient.addColorStop(1, rgbStr(r2, g2, b2))
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  // ─── 装饰元素 ───
  // 右上角圆形光晕
  const [ra, ga, ba] = hslToRgb((hue + 20) % 360, 50, 50)
  ctx.globalAlpha = 0.08
  ctx.beginPath()
  ctx.arc(WIDTH - 80, 80, 200, 0, Math.PI * 2)
  ctx.fillStyle = rgbStr(ra, ga, ba)
  ctx.fill()

  // 左下角圆形光晕
  ctx.beginPath()
  ctx.arc(100, HEIGHT - 60, 150, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1

  // ─── 左侧装饰竖条 ───
  const [rb, gb, bb] = hslToRgb((hue + 30) % 360, 80, 60)
  ctx.fillStyle = rgbStr(rb, gb, bb)
  ctx.fillRect(60, 80, 4, HEIGHT - 160)

  // ─── 标题文字 ───
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 36px CJK, "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.textBaseline = 'top'

  const lines = wrapTitle(ctx, title, WIDTH - 180)
  const lineHeight = 52
  const totalTextHeight = lines.length * lineHeight
  const startY = (HEIGHT - totalTextHeight) / 2 - 10

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], 84, startY + i * lineHeight)
  }

  // ─── 标签 ───
  if (tags.length > 0) {
    const tagY = startY + totalTextHeight + 20
    ctx.font = '14px CJK, "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.globalAlpha = 0.7

    let tagX = 84
    for (const tag of tags.slice(0, 4)) {
      const label = `#${tag}`
      const tw = ctx.measureText(label).width
      // 标签背景
      ctx.fillStyle = 'rgba(255,255,255,0.15)'
      const padding = 8
      const tagH = 24
      const radius = 4
      ctx.beginPath()
      ctx.moveTo(tagX + radius, tagY)
      ctx.lineTo(tagX + tw + padding * 2 - radius, tagY)
      ctx.arcTo(tagX + tw + padding * 2, tagY, tagX + tw + padding * 2, tagY + radius, radius)
      ctx.lineTo(tagX + tw + padding * 2, tagY + tagH - radius)
      ctx.arcTo(tagX + tw + padding * 2, tagY + tagH, tagX + tw + padding * 2 - radius, tagY + tagH, radius)
      ctx.lineTo(tagX + radius, tagY + tagH)
      ctx.arcTo(tagX, tagY + tagH, tagX, tagY + tagH - radius, radius)
      ctx.lineTo(tagX, tagY + radius)
      ctx.arcTo(tagX, tagY, tagX + radius, tagY, radius)
      ctx.fill()
      // 标签文字
      ctx.fillStyle = '#ffffff'
      ctx.fillText(label, tagX + padding, tagY + 5)
      tagX += tw + padding * 2 + 10
    }
    ctx.globalAlpha = 1
  }

  // ─── 底部署名线 ───
  ctx.globalAlpha = 0.3
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(84, HEIGHT - 50, WIDTH - 168, 1)
  ctx.globalAlpha = 0.5
  ctx.font = '13px CJK, "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('skyfalling.cn', 84, HEIGHT - 38)
  ctx.globalAlpha = 1

  return Buffer.from(canvas.toBuffer('image/png'))
}

/** CLI: 直接运行可测试生成效果 */
if (process.argv[1]?.endsWith('cover.ts')) {
  const testTitle = process.argv[2] || '从瓦特到比特：AI时代的能源出口革命'
  const testTags = ['AI', '能源', '技术趋势']
  const buf = generateCover(testTitle, testTags)
  const outPath = 'out/wx-cover-test.png'
  writeFileSync(outPath, buf)
  console.log(`✅ 封面图已生成: ${outPath} (${buf.length} bytes)`)
}
