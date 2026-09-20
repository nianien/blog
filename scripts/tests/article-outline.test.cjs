const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const loadTs = require('./load-ts.cjs')
const root = path.resolve(__dirname, '../..')
const { buildArticleOutline } = loadTs(path.join(root, 'src/lib/article-outline.ts'))

test('重复标题和已有锚点生成唯一目标，保留作者已有 id', () => {
  const html = '<h2 id="article-section-1">已有</h2><h2>测试</h2><h2>测试</h2>'
  const result = buildArticleOutline(html)
  assert.deepEqual(Array.from(result.items, x => x.id), ['article-section-1', 'article-section-2', 'article-section-3'])
  assert.ok(result.content.startsWith('<h2 id="article-section-1">已有</h2>'))
})

test('标题内联格式和实体转成目录文字，代码块内容不变', () => {
  const html = '<h2><code>A &amp; B</code> 与 <em>C</em> &#x4E2D;</h2><pre><code>&lt;h2&gt;示例&lt;/h2&gt;</code></pre>'
  const result = buildArticleOutline(html)
  assert.equal(result.items[0].title, 'A & B 与 C 中')
  assert.equal(result.items.length, 1)
  assert.ok(result.content.endsWith('<pre><code>&lt;h2&gt;示例&lt;/h2&gt;</code></pre>'))
})

test('data-id 不是锚点，短文与空标题不产生多余目录项', () => {
  const result = buildArticleOutline('<h2 data-id="other">标题</h2><h2> </h2><h3>子节</h3>')
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].id, 'article-section-1')
  assert.equal(buildArticleOutline('<p>短文</p>').items.length, 0)
})

test('全库文章目录目标可解析，去掉新增锚点后正文保持一致', () => {
  const { getAllPosts } = loadTs(path.join(root, 'src/lib/blog.ts'))
  const posts = getAllPosts()
  assert.ok(posts.length >= 105)
  let headingCount = 0
  for (const post of posts) {
    const { content, items } = buildArticleOutline(post.content)
    assert.equal(new Set(Array.from(items, x => x.id)).size, items.length, post.slug)
    for (const item of items) assert.ok(content.includes(`id="${item.id}"`) || content.includes(`id='${item.id}'`), post.slug)
    assert.equal(content.replace(/ id="article-section-\d+"/g, ''), post.content.replace(/ id="article-section-\d+"/g, ''), post.slug)
    headingCount += items.length
  }
  assert.ok(headingCount > 0)
  console.log(`Checked ${posts.length} articles and ${headingCount} heading targets`)
})
