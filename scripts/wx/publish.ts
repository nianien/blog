#!/usr/bin/env tsx
/**
 * 微信公众号一键发布工具
 *
 * 用法：
 *   npx tsx scripts/wx/publish.ts <md文件路径>              # 发布到草稿箱
 *   npx tsx scripts/wx/publish.ts --preview <md文件路径>     # 仅生成预览 HTML
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

// ─── CLI 参数解析 ───

const args = process.argv.slice(2)
const previewMode = args.includes('--preview')
const filePath = args.filter(a => !a.startsWith('--'))[0]

if (!filePath) {
  console.error('用法: npx tsx scripts/wx/publish.ts [--preview] <md文件路径>')
  process.exit(1)
}

const absolutePath = resolve(filePath)
if (!existsSync(absolutePath)) {
  console.error(`文件不存在: ${absolutePath}`)
  process.exit(1)
}

// 从文件路径推算博客 URL：src/content/blog/a/b/title.md → /blog/a/b/title
const blogContentDir = resolve(__dirname, '../../src/content/blog')
const blogSlug = absolutePath.replace(blogContentDir + '/', '').replace(/\.md$/, '')
const articleUrl = `https://www.skyfalling.cn/blog/${encodeURI(blogSlug)}`

// ─── 解析 Markdown ───

const raw = readFileSync(absolutePath, 'utf-8')
const { data: frontmatter, content: mdContent } = matter(raw)

const title = frontmatter.title || basename(absolutePath, '.md')
const author = frontmatter.author || 'skyfalling'
const description = frontmatter.description || ''
const cover = frontmatter.cover as string | undefined

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

let html = marked.parse(mdContent) as string

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

async function processImages(html: string): Promise<string> {
  const imgRegex = /<img\s+src="([^"]+)"/g
  const matches = [...html.matchAll(imgRegex)]

  if (matches.length === 0) {
    console.log('📷 无图片需要处理')
    return html
  }

  console.log(`📷 发现 ${matches.length} 张图片，开始处理...`)

  for (const match of matches) {
    const originalSrc = match[1]

    // 已经是微信 CDN 的图片跳过
    if (originalSrc.includes('mmbiz.qpic.cn')) continue

    let imageBuffer: Buffer
    let fileName: string

    if (originalSrc.startsWith('http://') || originalSrc.startsWith('https://')) {
      // 外部图片：下载
      console.log(`  ⬇️  下载: ${originalSrc}`)
      const res = await fetch(originalSrc)
      if (!res.ok) {
        console.warn(`  ⚠️  下载失败: ${originalSrc}`)
        continue
      }
      imageBuffer = Buffer.from(await res.arrayBuffer())
      fileName = basename(new URL(originalSrc).pathname) || 'image.png'
    } else {
      // 本地图片：相对于 md 文件或项目根目录
      const imgPath = resolve(dirname(absolutePath), originalSrc)
      if (!existsSync(imgPath)) {
        console.warn(`  ⚠️  本地图片不存在: ${imgPath}`)
        continue
      }
      imageBuffer = Buffer.from(readFileSync(imgPath))
      fileName = basename(imgPath)
    }

    // 确保文件名有扩展名
    if (!extname(fileName)) fileName += '.png'

    console.log(`  ⬆️  上传: ${fileName}`)
    const wxUrl = await uploadContentImage(imageBuffer, fileName)
    html = html.split(originalSrc).join(wxUrl)
    console.log(`  ✅ 替换完成`)
  }

  return html
}

// ─── 封面图处理 ───

async function getThumbMediaId(): Promise<string> {
  if (cover) {
    // frontmatter 中指定了封面图
    const coverPath = resolve(dirname(absolutePath), cover)
    if (!existsSync(coverPath)) {
      throw new Error(`封面图不存在: ${coverPath}`)
    }
    console.log(`🖼️  上传封面图: ${cover}`)
    const { media_id } = await uploadImage(coverPath)
    return media_id
  }

  // 自动生成标题卡片封面图
  const tags = (frontmatter.tags as string[]) || []
  console.log('🖼️  自动生成封面图...')
  const coverBuf = generateCover(title, tags)
  const tmpCoverPath = resolve(__dirname, '../../out/wx/.wx-cover-tmp.png')
  mkdirSync(dirname(tmpCoverPath), { recursive: true })
  writeFileSync(tmpCoverPath, coverBuf)
  const { media_id } = await uploadImage(tmpCoverPath)
  return media_id
}

// ─── 预览模式 ───

if (previewMode) {
  const outDir = resolve(__dirname, '../../out/wx')
  mkdirSync(outDir, { recursive: true })
  const outFileName = basename(absolutePath, '.md') + '.html'
  const outPath = resolve(outDir, outFileName)

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

  writeFileSync(outPath, previewHtml, 'utf-8')
  console.log(`\n✅ 预览文件已生成: ${outPath}`)

  // 自动用浏览器打开
  const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  execFile(openCmd, [outPath])
  process.exit(0)
}

// ─── 发布模式 ───

async function publish() {
  // 处理文章中的图片
  html = await processImages(html)

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

publish().catch(err => {
  console.error('\n❌ 发布失败:', err.message)
  process.exit(1)
})
