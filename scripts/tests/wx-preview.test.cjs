const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const sharp = require('sharp')
const { fileURLToPath } = require('node:url')
const loadTs = require('./load-ts.cjs')
const root = path.resolve(__dirname, '../..')
const paths = loadTs(path.join(root, 'src/lib/content-paths.ts'))

test('路由保留目录，优先英文 slug，兼容中文文件名与子路径', () => {
  assert.equal(paths.computeRouteSlug('engineering/domain/中文标题', ' engine-design '), 'engineering/domain/engine-design')
  assert.equal(paths.computeRouteSlug('engineering/domain/中文标题', ' '), 'engineering/domain/中文标题')
  assert.equal(paths.articlePathname('engineering/domain/中文标题', '/notes/'), '/notes/blog/engineering/domain/%E4%B8%AD%E6%96%87%E6%A0%87%E9%A2%98/')
  assert.throws(() => paths.articleRouteSlug(root, '/tmp/outside.md'))
})

test('图片统一解析 public、相对路径、编码、参数和子路径，保留远程 URL', () => {
  const article = path.join(root, 'src/content/blog/engineering/domain/例子.md')
  const file = path.join(root, 'public/images/中 文.png')
  for (const source of ['/images/中%20文.png?v=1#x', '/notes/images/中%20文.png?v=1#x', '../../../../../public/images/中 文.png?v=1#x']) {
    const image = paths.resolveArticleImage(source, article, root, '/notes')
    assert.equal(image.filePath, file)
    assert.equal(image.url, '/notes/images/%E4%B8%AD%20%E6%96%87.png?v=1#x')
  }
  for (const source of ['https://example.com/a.png', '//example.com/a.png', 'data:image/png;base64,AAAA']) {
    assert.equal(paths.resolveArticleImage(source, article, root, '/notes').url, source)
  }
  assert.throws(() => paths.resolveArticleImage('/../secret.png', article, root))
  assert.throws(() => paths.resolveArticleImage('./local.png', article, root))
  assert.throws(() => paths.resolveArticleImage('file:///tmp/private.png', article, root))
})

test('只替换图片 src，兼容属性顺序、引号、HTML 实体，正文不被误替换', () => {
  const source = '<p>/images/a.png</p><img alt="same" src=\'/images/a.png?a=1&amp;b=2\'>'
  const result = paths.mapImageSources(source, src => {
    assert.equal(src, '/images/a.png?a=1&b=2')
    return 'https://example.com/a.png?x=1&y=2'
  })
  assert.equal(result, '<p>/images/a.png</p><img alt="same" src=\'https://example.com/a.png?x=1&amp;y=2\'>')
})

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-content-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, 'public/images'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'src/content/blog/engineering/domain'), { recursive: true })
  await sharp({ create: { width: 7, height: 5, channels: 3, background: '#f00' } }).png().toFile(path.join(dir, 'public/images/真实 图.png'))
  await sharp({ create: { width: 9, height: 6, channels: 3, background: '#00f' } }).jpeg().toFile(path.join(dir, 'public/images/cover.jpg'))
  fs.writeFileSync(path.join(dir, 'public/images/真实 图.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="green"/></svg>')
  const article = path.join(dir, 'src/content/blog/engineering/domain/中文标题.md')
  fs.writeFileSync(article, `---
title: 测试文章
slug: engine-design
pubDate: 2026-09-16
heroImage: /images/cover.jpg
---
![PNG](</images/真实%20图.png?v=1&x=2>)
![SVG](</images/真实%20图.svg>)
<img alt="JPG" src='/images/cover.jpg'>
正文 /images/cover.jpg
`)
  return { dir, article }
}

async function runWx(dir, article, preview, noOpen = true) {
  const calls = { uploads: [], covers: [], drafts: [], exits: [], logs: [], opens: [] }
  await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('微信测试超时')), 10000)
    const finish = () => { clearTimeout(timer); done() }
    try {
      loadTs(path.join(root, 'scripts/wx/publish.ts'), {
        metaFile: path.join(dir, 'scripts/wx/publish.ts'),
        process: { ...process, env: {}, argv: ['node', 'publish.ts', ...(preview ? ['--preview', ...(noOpen ? ['--no-open'] : [])] : []), article], exit: code => { calls.exits.push(code); finish() } },
        console: { log: (...args) => { calls.logs.push(args.join(' ')); if (args.join(' ').includes('发布成功')) finish() }, error: (...args) => calls.logs.push(args.join(' ')) },
        stubs: {
          './api.js': {
            uploadContentImage: async (buffer, name) => { calls.uploads.push({ buffer, name }); return 'https://mmbiz.qpic.cn/test-' + calls.uploads.length },
            uploadImage: async file => { calls.covers.push(file); return { media_id: 'cover' } },
            createDraft: async draft => { calls.drafts.push(draft); return 'draft' }
          },
          './cover.js': { generateCover() { throw new Error('有 heroImage 不应自动生成封面') } },
          'node:child_process': {
            execFile(command, args) {
              if (noOpen) throw new Error('--no-open 不应请求打开浏览器')
              calls.opens.push({ command, args: Array.from(args) })
            }
          }
        }
      })
    } catch (error) { clearTimeout(timer); reject(error) }
  })
  return calls
}

test('网站与微信实际入口使用同一路由；预览全部图片可读且不会调用上传', async t => {
  const { dir, article } = await fixture(t)
  const blog = loadTs(path.join(root, 'src/lib/blog.ts'), { process: { ...process, cwd: () => dir, env: {} } })
  const [post] = blog.getAllPosts()
  assert.equal(post.slug, 'engineering/domain/engine-design')
  assert.match(post.content, /src="\/images\/%E7%9C%9F%E5%AE%9E%20%E5%9B%BE.png\?v=1&amp;x=2"/)
  const calls = await runWx(dir, article, true)
  assert.deepEqual(calls.exits, [0], calls.logs.join('\n'))
  assert.equal(calls.uploads.length + calls.covers.length + calls.drafts.length, 0)
  assert.ok(calls.logs.some(line => line.includes('/blog/' + post.slug + '/')))
  const html = fs.readFileSync(path.join(dir, 'wx_out/中文标题.html'), 'utf8')
  const images = []
  paths.mapImageSources(html, src => { images.push(fileURLToPath(src)); return src })
  assert.equal(images.length, 3)
  for (const file of images) assert.ok(fs.existsSync(file), file)
  assert.equal(images[0], path.join(dir, 'public/images/真实 图.png'))
  assert.equal((await sharp(images[0]).metadata()).width, 7)
  assert.equal((await sharp(images[1]).metadata()).width, 40)
  assert.match(html, /正文 \/images\/cover.jpg/)
})

test('发布入口上传 PNG/JPG/转换后的 SVG，并复用 heroImage 和英文原文路由', async t => {
  const { dir, article } = await fixture(t)
  const calls = await runWx(dir, article, false)
  assert.deepEqual(calls.exits, [], calls.logs.join('\n'))
  assert.equal(calls.uploads.length, 3)
  assert.equal(calls.drafts.length, 1)
  assert.equal(calls.covers[0], path.join(dir, 'public/images/cover.jpg'))
  assert.equal(calls.drafts[0].content_source_url, 'https://www.skyfalling.cn/blog/engineering/domain/engine-design/')
  assert.equal((await sharp(calls.uploads[0].buffer).metadata()).width, 7)
  assert.equal((await sharp(calls.uploads[1].buffer).metadata()).width, 40)
  assert.match(calls.drafts[0].content, /正文 \/images\/cover.jpg/)
  assert.equal((calls.drafts[0].content.match(/src=["']https:\/\/mmbiz.qpic.cn\/test-/g) || []).length, 3)
})

test('本地图片缺失时发布失败，上传和创建草稿均未发生', async t => {
  const { dir, article } = await fixture(t)
  fs.appendFileSync(article, '\n![missing](/images/missing.jpg)')
  const calls = await runWx(dir, article, false)
  assert.deepEqual(calls.exits, [1])
  assert.equal(calls.uploads.length + calls.drafts.length, 0)
  assert.ok(calls.logs.some(line => line.includes('本地图片不存在')))
})

test('默认预览请求系统打开已生成的 HTML，仅拦截进程调用，不实际打开浏览器', async t => {
  const { dir, article } = await fixture(t)
  const calls = await runWx(dir, article, true, false)
  const outPath = path.join(dir, 'wx_out/中文标题.html')
  assert.deepEqual(calls.exits, [0], calls.logs.join('\n'))
  assert.deepEqual(calls.opens, [{
    command: process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open',
    args: [outPath]
  }])
  assert.ok(fs.existsSync(outPath))
  assert.equal(calls.uploads.length + calls.covers.length + calls.drafts.length, 0)
  const html = fs.readFileSync(outPath, 'utf8')
  let imageCount = 0
  paths.mapImageSources(html, source => {
    assert.ok(fs.existsSync(fileURLToPath(source)))
    imageCount++
    return source
  })
  assert.equal(imageCount, 3)
})

test('网页预览只提供当前页面和选定图片，拒绝其他路径、Host 与写入请求', async t => {
  const { dir } = await fixture(t)
  const { startPreviewServer } = loadTs(path.join(root, 'scripts/wx/preview-server.ts'))
  const imageFile = path.join(dir, 'public/images/真实 图.png')
  const { server, url } = await startPreviewServer('<h1>预览</h1><img src="/images/example.png">', new Map([['/images/example.png', imageFile]]))
  t.after(() => new Promise(resolve => server.close(resolve)))
  assert.equal(server.address().address, '127.0.0.1')
  const page = await fetch(url)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /src="\/image\/0"/)
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/)
  const image = await fetch(url + 'image/0')
  assert.equal(image.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), fs.readFileSync(imageFile))
  for (const route of ['.env.wx', 'image/1', 'public/images/example.png', '%2e%2e/%2e%2e/etc/passwd']) {
    assert.equal((await fetch(url + route)).status, 404)
  }
  const wrongHostStatus = await new Promise((resolve, reject) => {
    require('node:http').get(url, { headers: { Host: 'other.example' } }, response => {
      response.resume()
      response.on('end', () => resolve(response.statusCode))
    }).on('error', reject)
  })
  assert.equal(wrongHostStatus, 403)
  assert.equal((await fetch(url, { method: 'POST' })).status, 405)
})
