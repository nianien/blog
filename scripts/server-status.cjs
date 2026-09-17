const { execFileSync } = require('node:child_process')
const { realpathSync } = require('node:fs')
const path = require('node:path')

// 不发送信号，只识别是否可以复用当前项目的服务
function serverStatus(projectRoot, port, mode, exec = execFileSync) {
  let output
  try {
    output = exec('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' })
  } catch (error) {
    if (error.status === 1 && !String(error.stdout || '').trim() && !String(error.stderr || '').trim()) return 'free'
    throw new Error(`无法检查端口 ${port}: ${error.message}`)
  }
  const pids = [...new Set(output.trim().split(/\s+/).filter(Boolean))]
  if (!pids.length) return 'free'
  const expectedCwd = path.join(realpathSync(projectRoot), mode === 'preview' ? 'out' : '')
  for (const pid of pids) {
    const cwd = exec('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], { encoding: 'utf8' })
      .split('\n').find(line => line.startsWith('n'))?.slice(1)
    if (cwd !== expectedCwd) return 'occupied'
    const command = exec('ps', ['-p', pid, '-o', 'command='], { encoding: 'utf8' }).trim()
    if (mode === 'preview') {
      if (!new RegExp(`(?:^|/)python[\\d.]* -m http\\.server ${port}$`).test(command)) return 'occupied'
    } else {
      // next-server 是 next dev 的子进程；不能把 next start 当成开发服务
      let currentPid = pid
      let currentCommand = command
      let isDev = false
      for (let depth = 0; depth < 4; depth++) {
        if (/(?:^|[ /])next(?:\/dist\/bin\/next)? dev(?: |$)/.test(currentCommand)) { isDev = true; break }
        if (depth === 0 && !/^next-server(?: |$)/.test(currentCommand)) break
        currentPid = exec('ps', ['-p', currentPid, '-o', 'ppid='], { encoding: 'utf8' }).trim()
        if (!/^\d+$/.test(currentPid) || currentPid === '1') break
        currentCommand = exec('ps', ['-p', currentPid, '-o', 'command='], { encoding: 'utf8' }).trim()
      }
      if (!isDev) return 'occupied'
    }
  }
  return 'reuse'
}

module.exports = { serverStatus }

if (require.main === module) {
  try {
    const [, , projectRoot, port, mode] = process.argv
    const status = serverStatus(projectRoot, port, mode)
    if (status === 'reuse') {
      console.log(`♻️  复用当前项目服务 http://localhost:${port}`)
      process.exitCode = 10
    } else if (status === 'occupied') {
      console.error(`端口 ${port} 被其他服务占用，未结束任何进程；请释放端口后重试`)
      process.exitCode = 1
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
