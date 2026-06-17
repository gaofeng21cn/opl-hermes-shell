#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const root = path.resolve(__dirname, '..')
const requireApp = process.argv.includes('--require-app')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const mainProcess = read('electron/main.cjs')
const oplBootstrapRunner = read('electron/opl-bootstrap-runner.cjs')
const oplCodexGateway = read('electron/opl-codex-gateway.cjs')
const upstreamSourceRef = '5e01a5dbf1b7bc0144d9057be706da1ea9f065c3'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function sha256(relativePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relativePath))).digest('hex')
}

function assertIconAlphaBounds({ maxWidth, maxHeight }) {
  const iconBounds = require('node:child_process')
    .spawnSync('magick', ['assets/icon.png', '-alpha', 'extract', '-format', '%@', 'info:'], { cwd: root, encoding: 'utf8' })
    .stdout.trim()
  const match = iconBounds.match(/^(\d+)x(\d+)\+(\d+)\+(\d+)$/)
  assert(match, `could not read icon alpha bounds: ${iconBounds}`)
  assert(
    Number(match[1]) <= maxWidth && Number(match[2]) <= maxHeight,
    `icon content must keep macOS Dock safe margin, got ${iconBounds}`
  )
}

assert(pkg.name === 'opl-hermes-shell', 'package name must be opl-hermes-shell')
assert(pkg.productName === 'One Person Lab Hermes Candidate', 'productName must be OPL branded')
assert(pkg.build?.appId === 'cn.onepersonlab.app.hermes-codex-candidate', 'appId must be OPL candidate id')
assert(pkg.main === 'electron/main.cjs', 'main must keep official Hermes Desktop main process')
assert(read('README_OPL.md').includes(`evaluated source ref: \`${upstreamSourceRef}\``), 'README_OPL.md must record the current upstream source ref')
assert(read('docs/opl-hermes-upstream-strategy.md').includes(`evaluated source ref: \`${upstreamSourceRef}\``), 'upstream strategy doc must record the current upstream source ref')
assert(read('scripts/package-opl-candidate-app.cjs').includes(`const upstreamSourceRef = '${upstreamSourceRef}'`), 'candidate package wrapper must stamp the current upstream source ref')
assert(read('README.md').includes('The native desktop app for [Hermes Agent]'), 'official Hermes README must remain available')
assert(read('UPSTREAM_README.md').includes('Hermes Agent'), 'upstream README receipt must remain available')
assert(mainProcess.includes("Resolving Hermes backend"), 'main process must preserve official Hermes backend resolution')
assert(mainProcess.includes("seedOplHermesDefaults"), 'main process must seed OPL defaults through the official Hermes runtime')
assert(mainProcess.includes("createOplCodexGateway"), 'main process must start the OPL Codex adapter for the OPL fallback path')
assert(
  mainProcess.includes("OPL_CODEX_CANDIDATE && backend.kind === 'bootstrap-needed'"),
  'OPL candidate must intercept missing Hermes runtime before official Hermes bootstrap'
)
assert(mainProcess.includes("runOplBootstrap"), 'OPL candidate must run App-managed OPL initialization when Hermes runtime is absent')
assert(
  mainProcess.indexOf('await runOplBootstrap') < mainProcess.indexOf('const bootstrapResult = await runBootstrap'),
  'OPL bootstrap interception must happen before the official Hermes installer path'
)
assert(fs.existsSync(path.join(root, 'electron/opl-bootstrap-runner.cjs')), 'candidate must include electron/opl-bootstrap-runner.cjs')
assert(fs.existsSync(path.join(root, 'electron/opl-startup-marker.cjs')), 'candidate must include electron/opl-startup-marker.cjs')
assert(fs.existsSync(path.join(root, 'electron/opl-bootstrap-runner.test.cjs')), 'candidate must include electron/opl-bootstrap-runner.test.cjs')
assert(fs.existsSync(path.join(root, 'electron/opl-codex-gateway.test.cjs')), 'candidate must include electron/opl-codex-gateway.test.cjs')
assert(oplBootstrapRunner.includes("require('./opl-startup-marker.cjs')"), 'OPL bootstrap runner must use the OPL startup marker')
assert(oplBootstrapRunner.includes('classifyStartupMarker'), 'OPL bootstrap runner must classify startup marker before full initialize')
assert(oplBootstrapRunner.includes("startupMode: 'lightweight'"), 'OPL bootstrap runner must support lightweight startup')
assert(oplBootstrapRunner.includes("'app', 'state', '--profile', 'fast', '--json'"), 'OPL bootstrap runner must use fast app state readiness before one-time initialization')
assert(oplBootstrapRunner.includes("startup_path: 'lightweight_probe'"), 'OPL bootstrap runner must refresh marker from a successful fast readiness probe')
assert(oplBootstrapRunner.includes("'system', 'initialize', '--json'"), 'OPL bootstrap runner must call opl system initialize --json')
assert(oplBootstrapRunner.includes("'install', '--skip-gui-open', '--skip-modules', '--skip-native-helper-repair', '--json'"), 'OPL bootstrap runner must run OPL core install without opening GUI')
assert(oplBootstrapRunner.includes("'system', 'startup-maintenance', '--json'"), 'OPL bootstrap runner must run startup maintenance when configured')
assert(oplBootstrapRunner.includes("'system', 'reconcile-modules', '--json'"), 'OPL bootstrap runner must reconcile modules when configured')
assert(oplBootstrapRunner.includes('maintenanceDeferred'), 'OPL bootstrap runner must defer maintenance until after adapter readiness')
assert(mainProcess.includes('OPL_STARTUP_MARKER_PATH'), 'main process must provide an OPL startup marker path')
assert(mainProcess.includes('removeOplStartupMarker(OPL_STARTUP_MARKER_PATH)'), 'bootstrap repair must clear the OPL startup marker')
assert(mainProcess.includes('startOplMaintenanceInBackground'), 'main process must start deferred OPL maintenance after adapter readiness')
assert(read('electron/opl-defaults.cjs').includes("openai_runtime"), 'OPL defaults must seed Codex app-server runtime')
assert(read('electron/opl-defaults.cjs').includes("external_dirs"), 'OPL defaults must seed Hermes external skill dirs')
assert(oplCodexGateway.includes("replacesHermesBackend: false"), 'adapter scope must declare it does not replace Hermes backend')
assert(oplCodexGateway.includes("executor: 'codex_app_server'"), 'adapter scope must declare Codex app-server as executor')
assert(oplCodexGateway.includes("'app-server', '--listen', 'stdio://'"), 'adapter must spawn Codex app-server over stdio')
assert(oplCodexGateway.includes("'thread/start'"), 'adapter must map Hermes session.create to Codex thread/start')
assert(oplCodexGateway.includes("'turn/start'"), 'adapter must map Hermes prompt.submit to Codex turn/start')
assert(oplCodexGateway.includes("'item/agentMessage/delta'"), 'adapter must map Codex deltas to Hermes message.delta')
assert(!oplCodexGateway.includes('exec --json'), 'adapter must not use the old codex exec JSON shim')
assert(oplCodexGateway.includes("configure-codex"), 'adapter must configure Codex through OPL gflabtoken setup')
assert(oplCodexGateway.includes("'/api/profiles'"), 'adapter must provide renderer-safe profile bootstrap routes')
assert(oplCodexGateway.includes("'/api/config'"), 'adapter must provide renderer-safe config bootstrap routes')
assert(oplCodexGateway.includes("'/api/providers/oauth'"), 'adapter must provide renderer-safe OAuth provider bootstrap route')
assert(oplCodexGateway.includes("providers: []"), 'adapter must report no OAuth providers for the OPL model access path')
assert(oplCodexGateway.includes("session.create"), 'adapter must implement Hermes session.create RPC')
assert(oplCodexGateway.includes("prompt.submit"), 'adapter must implement Hermes prompt.submit RPC')
assert(oplCodexGateway.includes("config.get"), 'adapter must implement renderer-safe config.get RPC')
assert(oplCodexGateway.includes("config.set"), 'adapter must implement renderer-safe config.set RPC')
assert(
  read('src/store/onboarding.ts').includes("setup?.provider_configured === true"),
  'onboarding must auto-skip the model access form when setup.status already reports configured credentials'
)
assert(read('src/app/index.tsx').includes("DesktopController"), 'candidate must reuse official Hermes Desktop app shell')
assert(read('src/main.tsx').includes("HashRouter"), 'candidate must keep official renderer entry')
assert(sha256('public/apple-touch-icon.png') === sha256('assets/icon.png'), 'runtime apple-touch-icon.png must match the OPL app icon')
assertIconAlphaBounds({ maxWidth: 900, maxHeight: 900 })
assert(!fs.existsSync(path.join(root, 'resources/opl-install.sh')), 'candidate must not carry stable OPL install wrapper')
assert(!fs.existsSync(path.join(root, 'scripts/validate-opl-state-model.cjs')), 'candidate must not claim OPL page-state/state-model mapping yet')
assert(!fs.existsSync(path.join(root, 'scripts/validate-packaged-runtime.cjs')), 'candidate must not carry packaged-runtime gate yet')
assert(!fs.existsSync(path.join(root, 'src/candidateContractEvidence.json')), 'candidate must not use static evidence as truth')

if (requireApp) {
  const manifestPath = path.join(root, 'out/hermes-codex-candidate-manifest.json')
  assert(fs.existsSync(manifestPath), 'candidate manifest missing')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  assert(manifest.status === 'candidate_app_bundle_ready', 'manifest status must be ready')
  assert(manifest.source_ref === upstreamSourceRef, 'candidate manifest must use the current upstream source ref')
  const appPath = path.join(root, manifest.app_bundle_path)
  assert(fs.existsSync(path.join(appPath, 'Contents/Info.plist')), 'Info.plist missing')
  const info = read(path.relative(root, path.join(appPath, 'Contents/Info.plist')))
  assert(info.includes('One Person Lab Hermes Candidate'), 'Info.plist must contain OPL product name')
  const packagedAppRoot = path.join(appPath, 'Contents/Resources/app')
  assert(fs.existsSync(path.join(packagedAppRoot, 'electron/opl-defaults.cjs')), 'packaged app must include OPL defaults seed')
  const packagedBootstrap = fs.readFileSync(path.join(packagedAppRoot, 'electron/opl-bootstrap-runner.cjs'), 'utf8')
  const packagedGateway = fs.readFileSync(path.join(packagedAppRoot, 'electron/opl-codex-gateway.cjs'), 'utf8')
  assert(fs.existsSync(path.join(packagedAppRoot, 'electron/opl-startup-marker.cjs')), 'packaged app must include OPL startup marker helper')
  for (const stage of [
    'opl-cli-check',
    'codex-cli-check',
    'opl-initialize',
    'opl-core-setup',
    'opl-post-setup-check',
    'opl-codex-adapter',
    'opl-maintenance-schedule'
  ]) {
    assert(packagedBootstrap.includes(`name: '${stage}'`), `packaged bootstrap runner must include ${stage}`)
  }
  assert(packagedGateway.includes("'app-server', '--listen', 'stdio://'"), 'packaged adapter must spawn Codex app-server over stdio')
  assert(packagedBootstrap.includes('classifyStartupMarker'), 'packaged bootstrap runner must support marker-based lightweight startup')
  assert(packagedBootstrap.includes("'app', 'state', '--profile', 'fast', '--json'"), 'packaged bootstrap runner must use fast app state readiness before one-time initialization')
  assert(packagedBootstrap.includes("startup_path: 'lightweight_probe'"), 'packaged bootstrap runner must refresh marker from a successful fast readiness probe')
  assert(packagedGateway.includes("'thread/start'"), 'packaged adapter must include thread/start mapping')
  assert(packagedGateway.includes("'turn/start'"), 'packaged adapter must include turn/start mapping')
  assert(packagedGateway.includes("'item/agentMessage/delta'"), 'packaged adapter must include agent delta mapping')
  assert(!packagedGateway.includes('exec --json'), 'packaged adapter must not include old codex exec JSON shim')
  const packagedStamp = JSON.parse(fs.readFileSync(path.join(appPath, 'Contents/Resources/install-stamp.json'), 'utf8'))
  assert(packagedStamp.commit === upstreamSourceRef, 'packaged install-stamp.json must use the current upstream source ref')
  assert(fs.existsSync(path.join(packagedAppRoot, 'public/apple-touch-icon.png')), 'packaged app must include runtime apple-touch-icon.png')
  const packagedIconHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(packagedAppRoot, 'assets/icon.png'))).digest('hex')
  const packagedAppleIconHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(packagedAppRoot, 'public/apple-touch-icon.png'))).digest('hex')
  assert(packagedIconHash === packagedAppleIconHash, 'packaged runtime apple-touch-icon.png must match the OPL app icon')
}

console.log(JSON.stringify({ status: 'hermes_codex_candidate_valid', require_app: requireApp }, null, 2))
