import path from 'node:path'

// 网站与微信共用：保留文章目录，只用 frontmatter slug 替换文件名
export function computeRouteSlug(fileSlug: string, frontmatterSlug?: unknown): string {
  if (typeof frontmatterSlug !== 'string' || !frontmatterSlug.trim()) return fileSlug
  return [...fileSlug.split('/').slice(0, -1), frontmatterSlug.trim()].join('/')
}

function within(root: string, target: string): string {
  const relative = path.relative(root, target)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`路径不在 ${root} 内: ${target}`)
  }
  return relative
}

export function articleRouteSlug(projectRoot: string, articleFile: string, slug?: unknown): string {
  const fileSlug = within(path.resolve(projectRoot, 'src/content/blog'), path.resolve(articleFile))
    .replace(/\\/g, '/').replace(/\.md$/, '')
  return computeRouteSlug(fileSlug, slug)
}

export function articlePathname(slug: string, basePath = ''): string {
  return `${basePath.replace(/\/$/, '')}/blog/${slug.split('/').map(encodeURIComponent).join('/')}/`
}

export type ArticleImage = { url: string; filePath?: string }

// 站点绝对路径映射到 public；相对路径以 Markdown 文件为基准，也必须落在 public 内
export function resolveArticleImage(
  source: string, articleFile: string, projectRoot: string, basePath = ''
): ArticleImage {
  if (/^(https?:)?\/\//i.test(source) || /^data:/i.test(source)) return { url: source }
  if (/^[a-z][a-z\d+.-]*:/i.test(source)) throw new Error(`不支持的图片协议: ${source}`)
  const [, pathname, suffix] = source.match(/^([^?#]*)(.*)$/)!
  const decoded = decodeURIComponent(pathname)
  const publicRoot = path.resolve(projectRoot, 'public')
  const prefix = basePath.replace(/\/$/, '')
  const localPath = prefix && decoded.startsWith(prefix + '/') ? decoded.slice(prefix.length) : decoded
  const filePath = localPath.startsWith('/')
    ? path.resolve(publicRoot, '.' + localPath)
    : path.resolve(path.dirname(articleFile), localPath)
  const relative = within(publicRoot, filePath).split(path.sep).map(encodeURIComponent).join('/')
  return { url: `${prefix}/${relative}${suffix}`, filePath }
}

function decodeAttribute(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (entity, code: string) => {
    if (code[0] === '#') return String.fromCodePoint(parseInt(code.slice(code[1].toLowerCase() === 'x' ? 2 : 1), code[1].toLowerCase() === 'x' ? 16 : 10))
    return ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' } as Record<string, string>)[code.toLowerCase()] || entity
  })
}

// 只改写 img 的 src，不误改正文或其他属性；兼容 Markdown 和内嵌 HTML 图片
export function mapImageSources(html: string, transform: (source: string) => string): string {
  return html.replace(/(<img\b[^>]*?\s)src\s*=\s*(["'])(.*?)\2/gi,
    (_match, prefix, quote, source) => {
      const value = transform(decodeAttribute(source)).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
      return `${prefix}src=${quote}${value}${quote}`
    })
}
