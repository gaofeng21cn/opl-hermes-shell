#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const root = path.resolve(__dirname, '..')
const requireApp = process.argv.includes('--require-app')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function sha256(relativePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relativePath))).digest('hex')
}

assert(pkg.name === 'opl-hermes-shell', 'package name must be opl-hermes-shell')
assert(pkg.productName === 'One Person Lab Hermes Candidate', 'productName must be OPL branded')
assert(pkg.build?.appId === 'cn.onepersonlab.app.hermes-codex-candidate', 'appId must be OPL candidate id')
assert(pkg.main === 'electron/main.cjs', 'main must keep official Hermes Desktop main process')
assert(read('README.md').includes('The native desktop app for [Hermes Agent]'), 'official Hermes README must remain available')
assert(read('UPSTREAM_README.md').includes('Hermes Agent'), 'upstream README receipt must remain available')
assert(!read('electron/main.cjs').includes("createOplCodexGateway"), 'main process must not replace the official Hermes backend with the OPL Codex shim')
assert(read('electron/main.cjs').includes("Resolving Hermes backend"), 'main process must preserve official Hermes backend resolution')
assert(read('electron/main.cjs').includes("seedOplHermesDefaults"), 'main process must seed OPL defaults through the official Hermes runtime')
assert(read('electron/opl-defaults.cjs').includes("openai_runtime"), 'OPL defaults must seed Codex app-server runtime')
assert(read('electron/opl-defaults.cjs').includes("external_dirs"), 'OPL defaults must seed Hermes external skill dirs')
assert(read('electron/opl-codex-gateway.cjs').includes("replacesHermesBackend: false"), 'adapter scope must declare it does not replace Hermes backend')
assert(read('electron/opl-codex-gateway.cjs').includes("codex', args"), 'adapter must spawn Codex CLI')
assert(read('electron/opl-codex-gateway.cjs').includes("session.create"), 'adapter must implement Hermes session.create RPC')
assert(read('electron/opl-codex-gateway.cjs').includes("prompt.submit"), 'adapter must implement Hermes prompt.submit RPC')
assert(read('src/app/index.tsx').includes("DesktopController"), 'candidate must reuse official Hermes Desktop app shell')
assert(read('src/main.tsx').includes("HashRouter"), 'candidate must keep official renderer entry')
assert(sha256('public/apple-touch-icon.png') === sha256('assets/icon.png'), 'runtime apple-touch-icon.png must match the OPL app icon')
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
  const packagedAppRoot = path.join(appPath, 'Contents/Resources/app')
  assert(fs.existsSync(path.join(packagedAppRoot, 'electron/opl-defaults.cjs')), 'packaged app must include OPL defaults seed')
  assert(fs.existsSync(path.join(packagedAppRoot, 'public/apple-touch-icon.png')), 'packaged app must include runtime apple-touch-icon.png')
  const packagedIconHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(packagedAppRoot, 'assets/icon.png'))).digest('hex')
  const packagedAppleIconHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(packagedAppRoot, 'public/apple-touch-icon.png'))).digest('hex')
  assert(packagedIconHash === packagedAppleIconHash, 'packaged runtime apple-touch-icon.png must match the OPL app icon')
}

console.log(JSON.stringify({ status: 'hermes_codex_candidate_valid', require_app: requireApp }, null, 2))
