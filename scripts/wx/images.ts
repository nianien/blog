import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve, dirname, extname, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { mapImageSources, resolveArticleImage } from '../../src/lib/content-paths.js'

export async function prepareLocalImage(source: string, articleFile: string, projectRoot: string): Promise<string | undefined> {
  const image = resolveArticleImage(source, articleFile, projectRoot, process.env.NEXT_PUBLIC_BASE_PATH)
  if (!image.filePath) return undefined
  if (!existsSync(image.filePath)) throw new Error(`本地图片不存在: ${image.filePath}`)
  if (extname(image.filePath).toLowerCase() !== '.svg') return image.filePath

  // 按源路径区分同名 SVG，转换结果不覆盖原始 PNG
  const key = createHash('sha256').update(image.filePath).digest('hex').slice(0, 16)
  const outPath = resolve(projectRoot, 'wx_out/images', key + '-' + basename(image.filePath).replace(/\.svg$/i, '.png'))
  mkdirSync(dirname(outPath), { recursive: true })
  await sharp(readFileSync(image.filePath), { density: 144 })
    .flatten({ background: { r: 255, g: 255, b: 255 } }).png().toFile(outPath)
  return outPath
}

export async function prepareArticleImages(html: string, articleFile: string, projectRoot: string) {
  const sources = new Set<string>()
  mapImageSources(html, source => { sources.add(source); return source })
  const files = new Map<string, string>()
  for (const source of sources) {
    const file = await prepareLocalImage(source, articleFile, projectRoot)
    if (file) files.set(source, file)
  }
  return files
}

export function previewImages(html: string, files: Map<string, string>): string {
  return mapImageSources(html, source => {
    const file = files.get(source)
    return file ? pathToFileURL(file).href : source
  })
}
