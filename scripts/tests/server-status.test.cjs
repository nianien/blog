const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { serverStatus } = require('../server-status.cjs')
const root = fs.realpathSync(path.resolve(__dirname, '../..'))

function fakeExec(owners) {
  return (command, args) => {
    if (command === 'lsof' && args.includes('-t')) return owners.map(owner => owner.pid).join('\n')
    const pid = args[args.indexOf('-p') + 1]
    const owner = owners.find(item => String(item.pid) === pid)
    if (!owner) throw new Error('进程不存在')
    if (command === 'lsof') return 'p' + pid + '\nn' + owner.cwd + '\n'
    if (command === 'ps' && args.includes('command=')) return owner.command
    if (command === 'ps' && args.includes('ppid=')) return String(owner.parent || 1)
    throw new Error('不允许的命令: ' + command + ' ' + args.join(' '))
  }
}

test('只复用当前工程的开发服务，生产服务和其他工程均拒绝', () => {
  assert.equal(serverStatus(root, 3000, 'dev', fakeExec([{ pid: 10, cwd: root, command: 'node /app/node_modules/.bin/next dev --turbopack' }])), 'reuse')
  assert.equal(serverStatus(root, 3000, 'dev', fakeExec([{ pid: 10, cwd: root, command: 'node /app/node_modules/.bin/next start' }])), 'occupied')
  assert.equal(serverStatus(root, 3000, 'dev', fakeExec([{ pid: 10, cwd: root + '-other', command: 'next dev' }])), 'occupied')
  assert.equal(serverStatus(root, 3000, 'dev', fakeExec([{ pid: 10, cwd: root, command: 'node unrelated-server.js' }])), 'occupied')
})

test('识别 next-server 的 dev 父进程；混合归属或无法查证时拒绝', () => {
  const owners = [{ pid: 10, cwd: root, command: 'next-server (v15.5.14)', parent: 20 }, { pid: 20, cwd: root, command: 'node /app/node_modules/next/dist/bin/next dev' }]
  assert.equal(serverStatus(root, 3000, 'dev', fakeExec(owners)), 'reuse')
  assert.equal(serverStatus(root, 3000, 'dev', fakeExec([...owners, { pid: 30, cwd: '/other', command: 'next dev' }])), 'occupied')
  assert.throws(() => serverStatus(root, 3000, 'dev', () => { throw new Error('permission denied') }))
})

test('仅复用当前 out 目录的 Python 预览，拒绝不同目录或覆盖 --directory', () => {
  const own = { pid: 10, cwd: path.join(root, 'out'), command: '/usr/bin/python3 -m http.server 8000' }
  assert.equal(serverStatus(root, 8000, 'preview', fakeExec([own])), 'reuse')
  assert.equal(serverStatus(root, 8000, 'preview', fakeExec([{ ...own, cwd: root }])), 'occupied')
  assert.equal(serverStatus(root, 8000, 'preview', fakeExec([{ ...own, command: own.command + ' --directory /other' }])), 'occupied')
})

test('空闲端口可以启动，检查命令缺失不能误判为空闲', () => {
  assert.equal(serverStatus(root, 3000, 'dev', () => { throw Object.assign(new Error('no listeners'), { status: 1, stdout: '', stderr: '' }) }), 'free')
  assert.throws(() => serverStatus(root, 3000, 'dev', () => { throw Object.assign(new Error('lsof not found'), { code: 'ENOENT' }) }))
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'scripts/cli.sh'), 'utf8'), /\b(?:pkill|kill|killall|kill_port)\b/)
})

test('真实端口被无关服务占用时拒绝，原服务仍能响应', async t => {
  const server = net.createServer(socket => socket.end('still alive'))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const port = server.address().port
  assert.equal(serverStatus(root, port, 'dev'), 'occupied')
  const response = await new Promise((resolve, reject) => {
    let content = ''
    net.connect(port, '127.0.0.1').on('data', chunk => { content += chunk }).on('end', () => resolve(content)).on('error', reject)
  })
  assert.equal(response, 'still alive')
})
