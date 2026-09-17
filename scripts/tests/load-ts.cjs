const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { pathToFileURL } = require('node:url')
const ts = require('typescript')

// 使用项目编译器执行真实 TypeScript，外部 API 由测试显式替换
module.exports = function loadTs(filename, options = {}) {
  const source = fs.readFileSync(filename, 'utf8').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(options.metaFile || filename).href))
  const { outputText, diagnostics } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    reportDiagnostics: true
  })
  if (diagnostics?.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => process.cwd(), getCanonicalFileName: f => f, getNewLine: () => '\n'
  }))
  const module = { exports: {} }
  const localRequire = name => {
    if (Object.hasOwn(options.stubs || {}, name)) return options.stubs[name]
    if (name.startsWith('.') || name.startsWith('@/')) {
      const target = name.startsWith('@/') ? path.resolve(__dirname, '../../src', name.slice(2)) : path.resolve(path.dirname(filename), name)
      if (target.endsWith('.json')) return require(target)
      const tsFile = target.replace(/\.js$/, '') + '.ts'
      if (fs.existsSync(tsFile)) return loadTs(tsFile, { ...options, metaFile: undefined })
    }
    return require(name)
  }
  const run = vm.runInNewContext('(function(require,module,exports){' + outputText.replace(/^#![^\n]*\n/, '') + '\n})', {
    Buffer, URL, Set, Map, console: options.console || console, process: options.process || process,
    fetch: options.fetch || (() => { throw new Error('测试禁止网络访问') }),
  }, { filename })
  run(localRequire, module, module.exports)
  return module.exports
}
