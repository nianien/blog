import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { mapImageSources } from '../../src/lib/content-paths.js'

// 只把本次生成的页面与已选定图片放入内存，不提供目录或文件路径访问
export async function startPreviewServer(html: string, files: Map<string, string>) {
  const assets = new Map<string, { body: Buffer; type: string }>()
  const sources = new Map<string, string>()
  const types: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
  }
  for (const [source, file] of files) {
    const route = '/image/' + assets.size
    assets.set(route, { body: readFileSync(file), type: types[extname(file).toLowerCase()] || 'application/octet-stream' })
    sources.set(source, route)
  }
  const page = mapImageSources(html, source => sources.get(source) || source)
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'")
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405).end()
      return
    }
    const address = server.address()
    if (!address || typeof address === 'string' || request.headers.host !== '127.0.0.1:' + address.port) {
      response.writeHead(403).end()
      return
    }
    const asset = assets.get(request.url || '')
    if (request.url !== '/' && !asset) {
      response.writeHead(404).end()
      return
    }
    response.setHeader('Content-Type', asset?.type || 'text/html; charset=utf-8')
    response.end(request.method === 'HEAD' ? undefined : asset?.body || page)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('预览服务地址不可用')
  return { server, url: 'http://127.0.0.1:' + address.port + '/' }
}
