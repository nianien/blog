const express = require('express')
const FormData = require('./form-data-lite')

const app = express()
app.use(express.json({ limit: '10mb' }))

// 开放接口服务：http + 不带 access_token
const WX_API = 'http://api.weixin.qq.com/cgi-bin'

/** 统一调微信 API，自动检查错误 */
async function wxRequest(url, options = {}) {
  const res = await fetch(url, options)
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`微信返回非JSON: ${text.slice(0, 500)}`)
  }
  if (data.errcode && data.errcode !== 0) {
    throw new Error(`微信API错误: ${data.errcode} ${data.errmsg || ''} (${JSON.stringify(data).slice(0, 300)})`)
  }
  return data
}

async function handleUploadImage(params) {
  const url = `${WX_API}/material/add_material?type=image`
  const buffer = Buffer.from(params.fileBase64, 'base64')
  const form = new FormData()
  form.append('media', buffer, params.fileName)
  const data = await wxRequest(url, { method: 'POST', body: form.getBuffer(), headers: form.getHeaders() })
  if (!data.media_id) throw new Error(`上传图片未返回media_id: ${JSON.stringify(data)}`)
  return { media_id: data.media_id, url: data.url }
}

async function handleUploadContentImage(params) {
  const url = `${WX_API}/media/uploadimg`
  const buffer = Buffer.from(params.fileBase64, 'base64')
  const form = new FormData()
  form.append('media', buffer, params.fileName)
  const data = await wxRequest(url, { method: 'POST', body: form.getBuffer(), headers: form.getHeaders() })
  if (!data.url) throw new Error(`上传内容图片未返回url: ${JSON.stringify(data)}`)
  return { url: data.url }
}

async function handleCreateDraft(params) {
  const url = `${WX_API}/draft/add`
  const body = {
    articles: [{
      title: params.title,
      author: params.author,
      digest: params.digest,
      content: params.content,
      thumb_media_id: params.thumb_media_id,
      content_source_url: params.content_source_url || '',
      need_open_comment: 0,
      only_fans_can_comment: 0,
    }],
  }
  const data = await wxRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!data.media_id) throw new Error(`创建草稿未返回media_id: ${JSON.stringify(data)}`)
  return { media_id: data.media_id }
}

const actions = { uploadImage: handleUploadImage, uploadContentImage: handleUploadContentImage, createDraft: handleCreateDraft }

// 健康检查
app.get('/', (req, res) => res.send('ok'))

app.post('/wx-proxy', async (req, res) => {
  const { action, params } = req.body || {}
  const handler = actions[action]
  if (!handler) return res.status(400).json({ success: false, error: `未知action: ${action}` })
  try {
    const data = await handler(params || {})
    res.json({ success: true, data })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

const PORT = process.env.PORT || 80
app.listen(PORT, () => console.log(`wx-proxy listening on :${PORT}`))
