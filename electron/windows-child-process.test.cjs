'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ELECTRON_DIR = __dirname

function readElectronFile(name) {
  return fs.readFileSync(path.join(ELECTRON_DIR, name), 'utf8').replace(/\r\n/g, '\n')
}

function requireHiddenChildOptions(source, needle) {
  const index = source.indexOf(needle)
  assert.notEqual(index, -1, `missing call site: ${needle}`)
  const snippet = source.slice(index, index + 700)
  assert.match(
    snippet,
    /hiddenWindowsChildOptions\(/,
    `expected ${needle} to wrap child-process options with hiddenWindowsChildOptions`
  )
}

test('desktop background child processes opt into hidden Windows consoles', () => {
  const source = readElectronFile('main.cjs')
  const linkTitleSource = readElectronFile(path.join('parts', 'link-title.cjs'))
  const openExternalSource = readElectronFile(path.join('parts', 'open-external.cjs'))

  assert.match(source, /function hiddenWindowsChildOptions\(options = \{\}\)/)

  requireHiddenChildOptions(source, "execFileSync(\n          'reg'")
  requireHiddenChildOptions(source, 'execFileSync(\n          pyExe')
  requireHiddenChildOptions(source, 'spawn(\n      resolveGitBinary()')
  requireHiddenChildOptions(source, "execFileSync('taskkill'")
  requireHiddenChildOptions(source, 'child = spawn(\n        command')
  requireHiddenChildOptions(linkTitleSource, "spawn('curl'")
  assert.match(openExternalSource, /spawn\('cmd\.exe', \['\/c', 'start'/)
  assert.match(openExternalSource, /windowsHide: true/)
  requireHiddenChildOptions(source, 'spawn(\n    backend.command,\n    backend.args')
  requireHiddenChildOptions(source, 'hermesProcess = spawn(\n      backend.command,\n      backend.args')
  requireHiddenChildOptions(
    source,
    "spawn(\n        py,\n        ['-m', 'hermes_cli.main', 'uninstall', '--gui-summary']"
  )
})

test('intentional or interactive desktop child processes stay documented', () => {
  const source = readElectronFile('main.cjs')

  assert.match(source, /windowsHide: false/)
  assert.match(source, /handOffWindowsBootstrapRecovery/)
  assert.match(source, /'--repair', '--branch'/)
  assert.match(source, /'--update', '--branch'/)
  assert.match(source, /nodePty\.spawn\(command, args/)
})

test('bootstrap PowerShell runner hides Windows console children', () => {
  const source = readElectronFile('bootstrap-runner.cjs')

  assert.match(source, /function hiddenWindowsChildOptions\(options = \{\}\)/)
  requireHiddenChildOptions(source, 'spawn(ps, fullArgs')
})
