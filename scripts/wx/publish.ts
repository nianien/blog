#!/usr/bin/env tsx
/**
 * 微信公众号一键发布工具
 *
 * 用法：
 *   npx tsx scripts/wx/publish.ts <md文件路径>              # 发布到草稿箱
 *   npx tsx scripts/wx/publish.ts --preview <md文件路径>     # 仅生成预览 HTML
 *   npx tsx scripts/wx/publish.ts --preview --serve <md文件路径> # 本机网页预览
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
import matter from 'gray-matter'
import { Marked, type Tokens } from 'marked'
import { wxStyles, normalizeStyle } from './styles.js'
import {
  uploadImage,
  uploadContentImage,
  createDraft,
} from './api.js'
import { generateCover } from './cover.js'
import { articleRouteSlug, articlePathname, mapImageSources } from '../../src/lib/content-paths.js'
import { SITE } from '../../src/lib/site.js'
import { prepareArticleImages, prepareLocalImage, previewImages } from './images.js'
import { startPreviewServer } from './preview-server.js'

const projectRoot = resolve(__dirname, '../..')

// ─── CLI 参数解析 ───

const args = process.argv.slice(2)
const previewMode = args.includes('--preview') || args.includes('--serve')
const filePath = args.filter(a => !a.startsWith('--'))[0]

if (!filePath) {
  console.error('用法: npx tsx scripts/wx/publish.ts [--preview [--no-open] | --serve [--no-open]] <md文件路径>')
  process.exit(1)
}

const absolutePath = resolve(filePath)
if (!existsSync(absolutePath)) {
  console.error(`文件不存在: ${absolutePath}`)
  process.exit(1)
}

// ─── 解析 Markdown ───

const raw = readFileSync(absolutePath, 'utf-8')
const { data: frontmatter, content: mdContent } = matter(raw)

const title = frontmatter.title || basename(absolutePath, '.md')
const author = frontmatter.author || 'skyfalling'
const description = frontmatter.description || ''
const cover = (frontmatter.cover || frontmatter.heroImage) as string | undefined
const articleUrl = SITE.url + articlePathname(
  articleRouteSlug(projectRoot, absolutePath, frontmatter.slug),
  process.env.NEXT_PUBLIC_BASE_PATH
)

// 去掉正文开头的一级标题（已从 frontmatter 中获取，避免重复）
const mdBody = mdContent.replace(/^\s*#\s+.+\n+/, '')

console.log(`📄 文章: ${title}`)
console.log(`✍️  作者: ${author}`)
console.log(`🔗 原文: ${articleUrl}`)

// ─── Markdown → 微信 HTML ───

const s = (key: string) => normalizeStyle(wxStyles[key] || '')

/** 追踪表格行号，用于偶数行背景色 */
let tableRowIndex = 0

const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    heading({ tokens, depth }: Tokens.Heading) {
      const tag = `h${depth}` as 'h1' | 'h2' | 'h3' | 'h4'
      const style = s(tag) || s('h4')
      const inner = this.parser.parseInline(tokens)
      return `<${tag} style="${style}">${inner}</${tag}>\n`
    },
    paragraph({ tokens }: Tokens.Paragraph) {
      const inner = this.parser.parseInline(tokens)
      return `<p style="${s('p')}">${inner}</p>\n`
    },
    blockquote({ tokens }: Tokens.Blockquote) {
      const inner = this.parser.parse(tokens)
      return `<blockquote style="${s('blockquote')}">${inner}</blockquote>\n`
    },
    code({ text, lang }: Tokens.Code) {
      let escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
      // 微信会重置 white-space:pre，必须用显式格式化
      escaped = escaped
        .replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;')
        .replace(/ /g, '&nbsp;')
        .replace(/\n/g, '<br/>')
      const langLabel = lang ? `<span style="color:#888;font-size:12px;display:block;margin-bottom:8px;">${lang}</span>` : ''
      return `<section style="${s('pre')}">${langLabel}<code style="${s('code')}">${escaped}</code></section>\n`
    },
    codespan({ text }: Tokens.Codespan) {
      return `<code style="${s('codeInline')}">${text}</code>`
    },
    table({ header, rows }: Tokens.Table) {
      tableRowIndex = 0
      const headerCells = header.map(cell =>
        `<th style="${s('th')}">${this.parser.parseInline(cell.tokens)}</th>`
      ).join('')
      const headerRow = `<tr>${headerCells}</tr>`

      const bodyRows = rows.map(row => {
        tableRowIndex++
        const rowStyle = tableRowIndex % 2 === 0 ? s('tr_even') : ''
        const cells = row.map(cell =>
          `<td style="${s('td')}">${this.parser.parseInline(cell.tokens)}</td>`
        ).join('')
        return `<tr style="${rowStyle}">${cells}</tr>`
      }).join('\n')

      return `<table style="${s('table')}"><thead>${headerRow}</thead><tbody>${bodyRows}</tbody></table>\n`
    },
    list({ ordered, items }: Tokens.List) {
      const tag = ordered ? 'ol' : 'ul'
      const style = ordered ? s('ol') : s('ul')
      const itemsHtml = items.map(item => {
        let inner = this.parser.parse(item.tokens)
        // 微信会剥掉 <li> 内的 <p> 等块级元素，导致内容丢失
        // 将相邻 <p> 之间替换为 <br>，再去掉所有 <p> 标签
        inner = inner.replace(/<\/p>\n*<p style="[^"]*">/g, '<br/><br/>')
        inner = inner.replace(/<p style="[^"]*">/g, '')
        inner = inner.replace(/<\/p>/g, '')
        inner = inner.trim()
        return `<li style="${s('li')}">${inner}</li>`
      }).join('')
      return `<${tag} style="${style}">${itemsHtml}</${tag}>\n`
    },
    strong({ tokens }: Tokens.Strong) {
      const inner = this.parser.parseInline(tokens)
      return `<strong style="${s('strong')}">${inner}</strong>`
    },
    em({ tokens }: Tokens.Em) {
      const inner = this.parser.parseInline(tokens)
      return `<em style="${s('em')}">${inner}</em>`
    },
    link({ href, tokens }: Tokens.Link) {
      const inner = this.parser.parseInline(tokens)
      return `<a href="${href}" style="${s('a')}">${inner}</a>`
    },
    image({ href, text }: Tokens.Image) {
      return `<img src="${href}" alt="${text || ''}" style="${s('img')}" />`
    },
    hr() {
      return `<hr style="${s('hr')}" />\n`
    },
    del({ tokens }: Tokens.Del) {
      const inner = this.parser.parseInline(tokens)
      return `<del style="${s('del')}">${inner}</del>`
    },
  },
})

let html = marked.parse(mdBody) as string

// 微信不允许外部链接，将 <a> 标签替换为纯文本
html = html.replace(/<a\s[^>]*>(.*?)<\/a>/g, '$1')

// 防止 </strong> 后的中文标点被微信换行分离（把标点拉入 strong 内部）
html = html.replace(/<\/strong>([：。，、；！？:.])/g, '$1</strong>')

// 文末引流
const footerHtml = `
<hr style="${s('hr')}" />
<p style="font-size: 14px; color: #999; line-height: 1.6; text-align: center; margin: 20px 0 8px 0;">
  更多文章请访问 <strong style="color: #666;">www.skyfalling.cn</strong>
</p>`

// 包裹全局容器
html = `<section style="${s('wrapper')}">${html}${footerHtml}</section>`

// ─── 图片处理 ───

async function processImages(html: string, files: Map<string, string>): Promise<string> {
  const sources = new Set<string>()
  mapImageSources(html, source => { sources.add(source); return source })
  const uploaded = new Map<string, string>()
  for (const source of sources) {
    const file = files.get(source)
    const remoteUrl = source.startsWith('//') ? 'https:' + source : source
    if (!file && /^https?:/i.test(remoteUrl) && new URL(remoteUrl).hostname === 'mmbiz.qpic.cn') continue
    let imageBuffer: Buffer
    let fileName: string
    if (file) {
      imageBuffer = readFileSync(file)
      fileName = basename(file)
    } else {
      const res = await fetch(remoteUrl)
      if (!res.ok) throw new Error(`图片下载失败: ${source} (HTTP ${res.status})`)
      imageBuffer = Buffer.from(await res.arrayBuffer())
      fileName = basename(new URL(remoteUrl).pathname) || 'image.png'
      if (res.headers.get('content-type')?.includes('image/svg+xml') || /\.svg$/i.test(fileName)) {
        const { default: sharp } = await import('sharp')
        imageBuffer = await sharp(imageBuffer, { density: 144 }).flatten({ background: '#fff' }).png().toBuffer()
        fileName = fileName.replace(/\.svg$/i, '') + '.png'
      }
    }
    if (!extname(fileName)) fileName += '.png'
    console.log(`  ⬆️  上传: ${fileName}`)
    uploaded.set(source, await uploadContentImage(imageBuffer, fileName))
  }
  return mapImageSources(html, source => uploaded.get(source) || source)
}

// ─── 封面图处理 ───

async function getThumbMediaId(): Promise<string> {
  if (cover) {
    const coverPath = await prepareLocalImage(cover, absolutePath, projectRoot)
    if (!coverPath) throw new Error('封面请使用 public 内的本地图片')
    console.log(`🖼️  上传封面图: ${cover}`)
    const { media_id } = await uploadImage(coverPath)
    return media_id
  }

  // 自动生成标题卡片封面图
  const tags = (frontmatter.tags as string[]) || []
  console.log('🖼️  自动生成封面图...')
  const coverBuf = generateCover(title, tags)
  const tmpCoverPath = resolve(__dirname, '../../wx_out/.wx-cover-tmp.png')
  mkdirSync(dirname(tmpCoverPath), { recursive: true })
  writeFileSync(tmpCoverPath, coverBuf)
  const { media_id } = await uploadImage(tmpCoverPath)
  return media_id
}

// ─── 预览模式 ───

if (previewMode) {
  ;(async () => {
    const outDir = resolve(__dirname, '../../wx_out')
    mkdirSync(outDir, { recursive: true })
    const outFileName = basename(absolutePath, '.md') + '.html'
    const outPath = resolve(outDir, outFileName)

    const files = await prepareArticleImages(html, absolutePath, projectRoot)
    const servePreview = args.includes('--serve')
    if (!servePreview) html = previewImages(html, files)

    const previewHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} - 微信预览</title>
  <style>
    body {
      max-width: 600px;
      margin: 40px auto;
      padding: 0 20px;
      background: #f5f5f5;
    }
    .preview-container {
      background: #fff;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.1);
    }
    .preview-header {
      text-align: center;
      padding: 20px 0;
      border-bottom: 1px solid #eee;
      margin-bottom: 20px;
    }
    .preview-header h1 { font-size: 22px; margin: 0 0 8px 0; }
    .preview-header p { color: #999; font-size: 14px; margin: 0; }
  </style>
</head>
<body>
  <div class="preview-container">
    <div class="preview-header">
      <h1>${title}</h1>
      <p>${author} · 微信公众号预览</p>
    </div>
    ${html}
  </div>
</body>
</html>`

    if (servePreview) {
      const { url } = await startPreviewServer(previewHtml, files)
      console.log(`\n✅ 微信网页预览: ${url}`)
      console.log('仅监听本机，按 Ctrl+C 结束')
      if (!args.includes('--no-open')) {
        const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
        execFile(openCmd, [url])
      }
      return
    }

    writeFileSync(outPath, previewHtml, 'utf-8')
    console.log(`\n✅ 预览文件已生成: ${outPath}`)

    // 自动用浏览器打开
    const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
    if (!args.includes('--no-open')) execFile(openCmd, [outPath])
    process.exit(0)
  })().catch(err => {
    console.error('\n❌ 预览失败:', err.message)
    process.exit(1)
  })
}

// ─── 发布模式 ───

async function publish() {
  // 先解析并检查全部本地图片，再上传到微信 CDN
  const files = await prepareArticleImages(html, absolutePath, projectRoot)
  html = await processImages(html, files)

  // 获取封面图
  const thumbMediaId = await getThumbMediaId()

  // 创建草稿
  console.log('\n📝 创建草稿...')
  const mediaId = await createDraft({
    title,
    author,
    digest: description.length > 40 ? description.slice(0, 39) + '…' : description,
    content: html,
    thumb_media_id: thumbMediaId,
    content_source_url: articleUrl,
  })

  console.log(`\n✅ 发布成功！草稿 media_id: ${mediaId}`)
  console.log('   请前往微信公众号后台「草稿箱」查看')
}

if (!previewMode) {
  publish().catch(err => {
    console.error('\n❌ 发布失败:', err.message)
    process.exit(1)
  })
}
