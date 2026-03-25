/**
 * 微信公众号 API 封装（通过云托管代理）
 *
 * .env.wx 配置项：
 *   WX_PROXY_URL   - 云托管服务地址
 *   WX_PROXY_TOKEN - 调用凭证
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface ProxyConfig {
  proxyUrl: string
  proxyToken: string
}

/** 从 .env.wx 读取配置 */
export function loadWxConfig(): ProxyConfig {
  const envPath = resolve(__dirname, '../../.env.wx')
  if (!existsSync(envPath)) {
    throw new Error('缺少 .env.wx 配置文件，请创建并填入 WX_PROXY_URL 和 WX_PROXY_TOKEN')
  }
  const content = readFileSync(envPath, 'utf-8')
  const vars: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    vars[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim()
  }
  const proxyUrl = vars['WX_PROXY_URL']
  const proxyToken = vars['WX_PROXY_TOKEN']
  if (!proxyUrl || !proxyToken) {
    throw new Error('.env.wx 中缺少 WX_PROXY_URL 或 WX_PROXY_TOKEN')
  }
  return { proxyUrl, proxyToken }
}

let _config: ProxyConfig | null = null

function getConfig(): ProxyConfig {
  if (!_config) _config = loadWxConfig()
  return _config
}

/** 调用云托管代理 */
async function callProxy(action: string, params: Record<string, unknown>): Promise<any> {
  const { proxyUrl, proxyToken } = getConfig()

  const res = await fetch(proxyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${proxyToken}`,
    },
    body: JSON.stringify({ action, params }),
  })

  const text = await res.text()
  let data: { success: boolean; data?: any; error?: string }
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`代理返回非JSON (HTTP ${res.status}): ${text.slice(0, 300)}`)
  }

  if (!data.success) {
    throw new Error(`[${action}] ${data.error || '未知错误'}`)
  }

  return data.data
}

/** 上传永久图片素材，返回 media_id 和 url */
export async function uploadImage(imagePath: string): Promise<{ media_id: string; url: string }> {
  const fileBuffer = readFileSync(imagePath)
  const fileName = imagePath.split('/').pop() || 'image.png'

  const result = await callProxy('uploadImage', {
    fileBase64: fileBuffer.toString('base64'),
    fileName,
  })

  if (!result?.media_id) {
    throw new Error(`uploadImage 返回无效: ${JSON.stringify(result)}`)
  }

  return { media_id: result.media_id, url: result.url }
}

/** 上传文章内图片，返回微信 CDN URL */
export async function uploadContentImage(imageBuffer: Buffer, fileName: string): Promise<string> {
  const result = await callProxy('uploadContentImage', {
    fileBase64: imageBuffer.toString('base64'),
    fileName,
  })

  if (!result?.url) {
    throw new Error(`uploadContentImage 返回无效: ${JSON.stringify(result)}`)
  }

  return result.url
}

export interface DraftArticle {
  title: string
  author: string
  digest: string
  content: string
  thumb_media_id: string
  content_source_url?: string
}

/** 创建草稿 */
export async function createDraft(article: DraftArticle): Promise<string> {
  const result = await callProxy('createDraft', { ...article })

  if (!result?.media_id) {
    throw new Error(`createDraft 返回无效: ${JSON.stringify(result)}`)
  }

  return result.media_id
}
