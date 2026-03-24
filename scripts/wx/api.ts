/**
 * 微信公众号 API 封装
 * - access_token 获取与缓存
 * - 图片素材上传
 * - 草稿箱创建
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TOKEN_CACHE_FILE = resolve(__dirname, '../../.wx-token.json')

const WX_API_BASE = 'https://api.weixin.qq.com/cgi-bin'

interface TokenCache {
  access_token: string
  expires_at: number // unix timestamp ms
}

interface WxConfig {
  appid: string
  appsecret: string
}

/** 从 .env.wx 读取配置 */
export function loadWxConfig(): WxConfig {
  const envPath = resolve(__dirname, '../../.env.wx')
  if (!existsSync(envPath)) {
    throw new Error('缺少 .env.wx 配置文件，请创建并填入 WX_APPID 和 WX_APPSECRET')
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
  const appid = vars['WX_APPID']
  const appsecret = vars['WX_APPSECRET']
  if (!appid || !appsecret) {
    throw new Error('.env.wx 中缺少 WX_APPID 或 WX_APPSECRET')
  }
  return { appid, appsecret }
}

/** 获取 access_token，优先使用缓存 */
export async function getAccessToken(config: WxConfig): Promise<string> {
  // 尝试读取缓存
  if (existsSync(TOKEN_CACHE_FILE)) {
    try {
      const cache: TokenCache = JSON.parse(readFileSync(TOKEN_CACHE_FILE, 'utf-8'))
      if (cache.access_token && cache.expires_at > Date.now() + 60_000) {
        return cache.access_token
      }
    } catch {
      // 缓存无效，重新获取
    }
  }

  const url = `${WX_API_BASE}/token?grant_type=client_credential&appid=${config.appid}&secret=${config.appsecret}`
  const res = await fetch(url)
  const data = await res.json() as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string }

  if (data.errcode) {
    throw new Error(`获取 access_token 失败: ${data.errcode} ${data.errmsg}`)
  }

  const token = data.access_token!
  const expiresIn = data.expires_in! // 秒

  // 缓存到文件
  const cache: TokenCache = {
    access_token: token,
    expires_at: Date.now() + expiresIn * 1000,
  }
  writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8')

  return token
}

/** 上传永久图片素材，返回 media_id 和 url */
export async function uploadImage(
  token: string,
  imagePath: string,
): Promise<{ media_id: string; url: string }> {
  const url = `${WX_API_BASE}/material/add_material?access_token=${token}&type=image`

  const fileBuffer = readFileSync(imagePath)
  const fileName = imagePath.split('/').pop() || 'image.png'

  const formData = new FormData()
  formData.append('media', new Blob([fileBuffer]), fileName)

  const res = await fetch(url, { method: 'POST', body: formData })
  const data = await res.json() as { media_id?: string; url?: string; errcode?: number; errmsg?: string }

  if (data.errcode) {
    throw new Error(`上传图片失败: ${data.errcode} ${data.errmsg}`)
  }

  return { media_id: data.media_id!, url: data.url! }
}

/**
 * 上传文章内图片（用于正文中的图片，返回微信 CDN URL）
 * 注意：此接口上传的图片不占素材库配额
 */
export async function uploadContentImage(
  token: string,
  imageBuffer: Buffer,
  fileName: string,
): Promise<string> {
  const url = `${WX_API_BASE}/media/uploadimg?access_token=${token}`

  const formData = new FormData()
  formData.append('media', new Blob([imageBuffer]), fileName)

  const res = await fetch(url, { method: 'POST', body: formData })
  const data = await res.json() as { url?: string; errcode?: number; errmsg?: string }

  if (data.errcode) {
    throw new Error(`上传内容图片失败: ${data.errcode} ${data.errmsg}`)
  }

  return data.url!
}

interface DraftArticle {
  title: string
  author: string
  digest: string         // 摘要
  content: string        // HTML 正文
  thumb_media_id: string // 封面图 media_id
  content_source_url?: string // 原文链接
}

/** 创建草稿 */
export async function createDraft(
  token: string,
  article: DraftArticle,
): Promise<string> {
  const url = `${WX_API_BASE}/draft/add?access_token=${token}`

  const body = {
    articles: [
      {
        title: article.title,
        author: article.author,
        digest: article.digest,
        content: article.content,
        thumb_media_id: article.thumb_media_id,
        content_source_url: article.content_source_url || '',
        need_open_comment: 0,
        only_fans_can_comment: 0,
      },
    ],
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json() as { media_id?: string; errcode?: number; errmsg?: string }

  if (data.errcode) {
    throw new Error(`创建草稿失败: ${data.errcode} ${data.errmsg}`)
  }

  return data.media_id!
}
