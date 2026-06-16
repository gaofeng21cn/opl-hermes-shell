#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const requireApp = process.argv.includes('--require-app')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

assert(pkg.name === 'opl-hermes-shell', 'package name must be opl-hermes-shell')
assert(pkg.productName === 'One Person Lab Hermes Candidate', 'productName must be OPL branded')
assert(pkg.build?.appId === 'cn.onepersonlab.app.hermes-codex-candidate', 'appId must be OPL candidate id')
assert(pkg.main === 'electron/main.cjs', 'main must keep official Hermes Desktop main process')
assert(read('README.md').includes('The native desktop app for [Hermes Agent]'), 'official Hermes README must remain available')
assert(read('UPSTREAM_README.md').includes('Hermes Agent'), 'upstream README receipt must remain available')
assert(read('electron/main.cjs').includes("createOplCodexGateway"), 'main process must use OPL Codex gateway adapter')
assert(read('electron/opl-codex-gateway.cjs').includes("codex', args"), 'adapter must spawn Codex CLI')
assert(read('electron/opl-codex-gateway.cjs').includes("session.create"), 'adapter must implement Hermes session.create RPC')
assert(read('electron/opl-codex-gateway.cjs').includes("prompt.submit"), 'adapter must implement Hermes prompt.submit RPC')
assert(read('src/app/index.tsx').includes("DesktopController"), 'candidate must reuse official Hermes Desktop app shell')
assert(read('src/main.tsx').includes("HashRouter"), 'candidate must keep official renderer entry')
assert(!fs.existsSync(path.join(root, 'resources/opl-install.sh')), 'candidate must not carry stable OPL install wrapper')
assert(!fs.existsSync(path.join(root, 'scripts/validate-opl-state-model.cjs')), 'candidate must not claim OPL page-state/state-model mapping yet')
assert(!fs.existsSync(path.join(root, 'scripts/validate-packaged-runtime.cjs')), 'candidate must not carry packaged-runtime gate yet')
assert(!fs.existsSync(path.join(root, 'src/candidateContractEvidence.json')), 'candidate must not use static evidence as truth')

if (requireApp) {
  const manifestPath = path.join(root, 'out/hermes-codex-candidate-manifest.json')
  assert(fs.existsSync(manifestPath), 'candidate manifest missing')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  assert(manifest.status === 'candidate_app_bundle_ready', 'manifest status must be ready')
  const appPath = path.join(root, manifest.app_bundle_path)
  assert(fs.existsSync(path.join(appPath, 'Contents/Info.plist')), 'Info.plist missing')
  const info = read(path.relative(root, path.join(appPath, 'Contents/Info.plist')))
  assert(info.includes('One Person Lab Hermes Candidate'), 'Info.plist must contain OPL product name')
}

console.log(JSON.stringify({ status: 'hermes_codex_candidate_valid', require_app: requireApp }, null, 2))
