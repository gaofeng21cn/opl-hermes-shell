#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
const productName = 'One Person Lab Hermes Candidate'
const defaultAppPath = path.join(root, 'release', `mac-${arch}`, `${productName}.app`)
const options = parseArgs(process.argv.slice(2))
const binary = path.join(options.appPath, 'Contents', 'MacOS', productName)
const legacyBinary = path.join(options.appPath, 'Contents', 'MacOS', 'Electron')
const smokeTimeoutMs = options.timeoutMs

function parseArgs(argv) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const parsed = {
    appPath: defaultAppPath,
    artifactsDir: path.join(root, 'out', `smoke-settings-visual-${stamp}`),
    remoteDebuggingPort: 9339,
    timeoutMs: 20_000
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help') {
      process.stdout.write(`Usage:
  node scripts/smoke-settings-visual.cjs [options]

Options:
  --app <path>             Packaged Hermes .app. Default: ${defaultAppPath}
  --out <path>             Artifact directory. Default: out/smoke-settings-visual-<timestamp>
  --remote-debugging-port <n>
                           Electron remote debugging port. Default: 9339
  --timeout-ms <n>         Smoke timeout. Default: 20000
  --help                   Show this message.
`)
      process.exit(0)
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`)
    }
    index += 1
    if (arg === '--app') parsed.appPath = path.resolve(value)
    else if (arg === '--out') parsed.artifactsDir = path.resolve(value)
    else if (arg === '--remote-debugging-port') parsed.remoteDebuggingPort = Number(value)
    else if (arg === '--timeout-ms') parsed.timeoutMs = Number(value)
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return parsed
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

function assert(condition, message) {
  if (!condition) fail(message)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function writeExecutable(filePath, body) {
  fs.writeFileSync(filePath, body, 'utf8')
  fs.chmodSync(filePath, 0o755)
}

function shellSafeJson(value) {
  return JSON.stringify(value)
}

function makeFixtureBin(sandbox) {
  const binDir = path.join(sandbox, 'bin')
  const callsPath = path.join(sandbox, 'opl-calls.log')
  fs.mkdirSync(binDir, { recursive: true })

  writeExecutable(path.join(binDir, 'opl'), `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
fs.appendFileSync(${shellSafeJson(callsPath)}, args.join(' ') + '\\n')
const appState = {
  app_state: {
    meta: { profile: 'fast', read_policy: 'bounded_local_read_no_network_no_repair' },
    core: {
      codex: {
        installed: true,
        version_status: 'compatible',
        binary_path: ${shellSafeJson(path.join(binDir, 'codex'))},
        version: 'codex-cli 0.140.0',
        api_key_present: true,
        default_model: 'gpt-5.5',
        default_reasoning_effort: 'xhigh',
        provider_base_url: 'https://gflabtoken.cn/v1'
      }
    }
  }
}
const initialize = {
  system_initialize: {
    setup_flow: { ready_to_launch: true, blocking_items: [] },
    core_engines: {
      codex: {
        api_key_present: true,
        config_path: '/tmp/opl-smoke/.codex/config.toml',
        default_model: 'gpt-5.5',
        default_reasoning_effort: 'xhigh',
        provider_base_url: 'https://gflabtoken.cn/v1'
      }
    },
    checklist: [{ item_id: 'codex_config', last_attempt: { api_key_present: true } }]
  }
}
if (args.join(' ') === 'app state --profile fast --json') {
  console.log(JSON.stringify(appState))
  process.exit(0)
}
if (args.join(' ') === 'system initialize --json') {
  console.log(JSON.stringify(initialize))
  process.exit(0)
}
if (args.join(' ') === 'install --skip-gui-open --skip-modules --skip-native-helper-repair --json') {
  console.log(JSON.stringify({ ok: true, installed: true }))
  process.exit(0)
}
if (args.join(' ') === 'system startup-maintenance --json') {
  console.log(JSON.stringify({ ok: true, deferred: true }))
  process.exit(0)
}
if (args.join(' ') === 'system reconcile-modules --json') {
  console.log(JSON.stringify({ ok: true, reconciled: true }))
  process.exit(0)
}
if (args.join(' ').startsWith('app action execute --action workspace_ensure ')) {
  console.log(JSON.stringify({ ok: true, app_action_execution: { action_id: 'workspace_ensure', dry_run: true } }))
  process.exit(0)
}
if (args.join(' ') === 'start --project medautoscience --json') {
  console.log(JSON.stringify({ ok: true, product_entry_start: { project_id: 'medautoscience', selected_mode_id: 'open_product_entry' } }))
  process.exit(0)
}
if (args.join(' ') === 'start --project medautogrant --json') {
  console.log(JSON.stringify({ ok: true, product_entry_start: { project_id: 'medautogrant', selected_mode_id: 'open_product_entry' } }))
  process.exit(0)
}
if (args.join(' ') === 'start --project redcube --json') {
  console.log(JSON.stringify({ ok: true, product_entry_start: { project_id: 'redcube', selected_mode_id: 'open_product_entry' } }))
  process.exit(0)
}
if (args.join(' ') === 'system configure-codex --api-key-stdin --json') {
  process.stdin.resume()
  process.stdin.on('end', () => console.log(JSON.stringify({ ok: true, configured: true })))
  process.exit(0)
}
console.error('unexpected opl command: ' + args.join(' '))
process.exit(42)
`)

  writeExecutable(path.join(binDir, 'codex'), `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args.join(' ') !== 'app-server --listen stdio://') {
  console.error('unexpected codex command: ' + args.join(' '))
  process.exit(42)
}
process.stdin.resume()
`)

  return { binDir, callsPath }
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', event => {
      const message = JSON.parse(String(event.data))
      if (message.id == null || !this.pending.has(message.id)) return
      const { resolve, reject } = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)))
      else resolve(message.result)
    })
  }

  static async open(webSocketDebuggerUrl) {
    const ws = new WebSocket(webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', reject, { once: true })
    })
    return new Cdp(ws)
  }

  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      awaitPromise: true,
      expression,
      returnByValue: true
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed')
    }
    return result.result.value
  }

  close() {
    this.ws.close()
  }
}

async function waitForTarget(port) {
  const started = Date.now()
  let lastError = ''
  let lastTargets = []
  while (Date.now() - started < smokeTimeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`)
      if (response.ok) {
        const targets = await response.json()
        lastTargets = targets
        const pageTargets = targets.filter(entry => {
          const url = String(entry.url || '')
          return entry.type === 'page' && entry.webSocketDebuggerUrl && !url.startsWith('devtools://')
        })
        const target =
          pageTargets.find(entry => /(?:dist\/index\.html|127\.0\.0\.1|localhost)/.test(String(entry.url || ''))) ||
          pageTargets.find(entry => String(entry.url || '') && String(entry.url || '') !== 'about:blank') ||
          pageTargets[0]
        if (target) return target
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await sleep(250)
  }
  throw new Error(
    `Could not find Electron renderer CDP target on ${port}: ${lastError}. Last targets: ${JSON.stringify(lastTargets)}`
  )
}

async function waitForCondition(cdp, expression, label) {
  const started = Date.now()
  let lastValue = null
  while (Date.now() - started < smokeTimeoutMs) {
    lastValue = await cdp.eval(expression)
    if (lastValue) return lastValue
    await sleep(250)
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(lastValue)}`)
}

async function waitForLog(logPath, predicate, label) {
  const started = Date.now()
  let text = ''
  while (Date.now() - started < smokeTimeoutMs) {
    if (fs.existsSync(logPath)) {
      text = fs.readFileSync(logPath, 'utf8')
      if (predicate(text)) return text
    }
    await sleep(250)
  }
  throw new Error(`Timed out waiting for ${label}. Last log tail:\n${text.slice(-4000)}`)
}

function pngDimensions(filePath) {
  const buffer = fs.readFileSync(filePath)
  assert(buffer.length > 24, `screenshot is too small to be a PNG: ${filePath}`)
  assert(buffer.readUInt32BE(0) === 0x89504e47, `screenshot is not a PNG: ${filePath}`)
  return {
    bytes: buffer.length,
    height: buffer.readUInt32BE(20),
    path: filePath,
    width: buffer.readUInt32BE(16)
  }
}

async function normalizeCaptureWindow(cdp) {
  try {
    const windowInfo = await cdp.send('Browser.getWindowForTarget')
    if (windowInfo?.windowId != null) {
      await cdp.send('Browser.setWindowBounds', {
        bounds: {
          height: 1080,
          left: 80,
          top: 80,
          width: 1440,
          windowState: 'normal'
        },
        windowId: windowInfo.windowId
      })
    }
  } catch {
    // Some Electron/Chromium builds do not expose Browser.* through the page target.
  }
}

async function capture(cdp, filePath) {
  await normalizeCaptureWindow(cdp)
  await cdp.send('Page.bringToFront')
  await cdp.eval(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))`)
  await sleep(300)
  const result = await cdp.send('Page.captureScreenshot', {
    captureBeyondViewport: false,
    format: 'png'
  })
  fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'))
  const image = pngDimensions(filePath)
  assert(image.width >= 1000 && image.height >= 700, `screenshot dimensions are too small: ${filePath} ${image.width}x${image.height}`)
  return image
}

async function captureUntilRendered(cdp, filePath, { label, minBytes }) {
  const started = Date.now()
  let lastImage = null
  while (Date.now() - started < smokeTimeoutMs) {
    lastImage = await capture(cdp, filePath)
    if (lastImage.bytes >= minBytes) return lastImage
    await cdp.eval(`new Promise(resolve => {
      document.body.style.transform = 'translateZ(0)'
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    })`)
    await sleep(500)
  }
  throw new Error(
    `${label} screenshot looks blank or under-rendered: ${filePath} (${lastImage?.bytes ?? 0} bytes after retry)`
  )
}

async function navigateHash(cdp, route) {
  await cdp.eval(`location.hash = ${JSON.stringify(route)}`)
  await sleep(500)
}

async function pageSnapshot(cdp) {
  return cdp.eval(`JSON.stringify({
    href: location.href,
    title: document.title,
    bodyText: document.body.innerText,
    width: window.innerWidth,
    height: window.innerHeight,
    buttons: Array.from(document.querySelectorAll('button')).map(button => button.innerText || button.getAttribute('aria-label') || '').filter(Boolean)
  })`)
}

function assertTextIncludesAny(text, options, label) {
  if (!options.some(option => text.includes(option))) {
    throw new Error(`${label} missing. Expected one of ${JSON.stringify(options)} in:\n${text.slice(0, 4000)}`)
  }
}

function assertTextExcludes(text, forbidden, label) {
  const hit = forbidden.find(entry => text.includes(entry))
  if (hit) throw new Error(`${label} unexpectedly exposed ${hit}`)
}

async function main() {
  assert(process.platform === 'darwin', 'packaged Settings visual smoke is macOS-only')
  assert(fs.existsSync(binary), `missing packaged executable: ${binary}`)
  assert(!fs.existsSync(legacyBinary), `packaged app still exposes legacy Electron executable: ${legacyBinary}`)

  fs.rmSync(options.artifactsDir, { recursive: true, force: true })
  fs.mkdirSync(options.artifactsDir, { recursive: true })

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'opl-hermes-settings-visual-'))
  const userData = path.join(sandbox, 'user-data')
  const hermesHome = path.join(sandbox, 'hermes-home')
  const workspace = path.join(sandbox, 'workspace')
  fs.mkdirSync(userData, { recursive: true })
  fs.mkdirSync(hermesHome, { recursive: true })
  fs.mkdirSync(workspace, { recursive: true })
  const { binDir, callsPath } = makeFixtureBin(path.join(sandbox, 'fixture'))
  const logPath = path.join(hermesHome, 'logs', 'desktop.log')
  const env = {
    ...process.env,
    HERMES_DESKTOP_CWD: workspace,
    HERMES_DESKTOP_IGNORE_EXISTING: '1',
    HERMES_DESKTOP_USER_DATA_DIR: userData,
    HERMES_HOME: hermesHome,
    OPL_HERMES_CODEX_CANDIDATE: '1',
    OPL_HERMES_SMOKE_EXPOSE_DESCRIPTOR: '1',
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`
  }
  delete env.HERMES_DESKTOP_HERMES
  delete env.HERMES_DESKTOP_HERMES_ROOT

  const child = spawn(binary, [
    `--remote-debugging-port=${options.remoteDebuggingPort}`,
    '--remote-allow-origins=*'
  ], {
    cwd: workspace,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stderr = ''
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })

  let cdp = null
  try {
    const target = await waitForTarget(options.remoteDebuggingPort)
    fs.writeFileSync(path.join(options.artifactsDir, 'cdp-target.json'), `${JSON.stringify(target, null, 2)}\n`)
    cdp = await Cdp.open(target.webSocketDebuggerUrl)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await normalizeCaptureWindow(cdp)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      deviceScaleFactor: 1,
      height: 1080,
      mobile: false,
      width: 1440
    })

    await waitForLog(
      logPath,
      log => log.includes('OPL Codex adapter is ready. Finalizing desktop startup'),
      'OPL Codex adapter readiness'
    )
    await waitForCondition(
      cdp,
      `(() => {
        const text = document.body?.innerText || ''
        return text.length > 20 &&
          !text.includes('正在启动 One Person Lab') &&
          !text.includes('Starting One Person Lab') &&
          !text.includes('Resolving Hermes runtime')
      })()`,
      'home body text after startup'
    )
    await waitForCondition(
      cdp,
      `(() => {
        const intro = document.querySelector('[data-slot="aui_intro"]')
        const mas = document.querySelector('[data-purpose-route="mas"]')
        if (!(intro instanceof HTMLElement) || !(mas instanceof HTMLButtonElement)) return false
        const rect = intro.getBoundingClientRect()
        const style = getComputedStyle(intro)
        return rect.width > 500 &&
          rect.height > 100 &&
          style.visibility !== 'hidden' &&
          Number(style.opacity || '1') > 0.5
      })()`,
      'home intro rendered'
    )
    await cdp.eval(`document.fonts?.ready || true`)
    const homePng = await captureUntilRendered(cdp, path.join(options.artifactsDir, 'desktop-home.png'), {
      label: 'home',
      minBytes: 50_000
    })
    const home = JSON.parse(await pageSnapshot(cdp))
    assert(home.bodyText.length > 20, 'home chrome is empty')
    assertTextIncludesAny(home.bodyText, ['One Person Lab'], 'home OPL branding')
    assertTextIncludesAny(home.bodyText, ['科研', 'MAS'], 'home MAS route chip')
    assertTextIncludesAny(home.bodyText, ['基金', 'MAG'], 'home MAG route chip')
    assertTextIncludesAny(home.bodyText, ['演示', 'RCA'], 'home RCA route chip')
    assertTextExcludes(home.bodyText, ['HERMES AGENT'], 'home legacy Hermes wordmark')
    await cdp.eval(`(() => {
      const button = document.querySelector('[data-purpose-route="mas"]')
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('MAS route chip button not found')
      }
      button.click()
      return true
    })()`)
    await waitForCondition(
      cdp,
      `document.body.innerText.includes('科研 / MAS')`,
      'MAS route chip inserts a route prompt'
    )

    await navigateHash(cdp, '/settings?tab=providers')
    await waitForCondition(
      cdp,
      `document.body.innerText.includes('gflabtoken') || document.body.innerText.includes('模型访问') || document.body.innerText.includes('Model Access')`,
      'model access settings'
    )
    const accessPng = await capture(cdp, path.join(options.artifactsDir, 'settings-access.png'))
    const access = JSON.parse(await pageSnapshot(cdp))
    assertTextIncludesAny(access.bodyText, ['gflabtoken'], 'model access provider')
    assertTextIncludesAny(access.bodyText, ['OPENAI_API_KEY', 'API key', 'API 密钥'], 'model access key')
    assertTextExcludes(access.bodyText, ['OPENAI_BASE_URL', 'provider marketplace', 'OAuth provider accounts', 'Nous Portal'], 'model access ordinary settings')

    await navigateHash(cdp, '/settings?tab=agents')
    await waitForCondition(
      cdp,
      `document.body.innerText.includes('智能体与能力') || document.body.innerText.includes('Agents & Capabilities')`,
      'agents settings'
    )
    const agentsPng = await capture(cdp, path.join(options.artifactsDir, 'settings-agents.png'))
    const agents = JSON.parse(await pageSnapshot(cdp))
    assertTextIncludesAny(agents.bodyText, ['科研', 'Med Auto Science', 'Research'], 'MAS route label')
    assertTextIncludesAny(agents.bodyText, ['基金', 'Med Auto Grant', 'Grant'], 'MAG route label')
    assertTextIncludesAny(agents.bodyText, ['演示', 'RedCube AI', 'Presentation'], 'RCA route label')
    assertTextExcludes(agents.bodyText, ['domain_ready', 'artifact_authority', 'quality_verdict'], 'agents ordinary settings')

    await navigateHash(cdp, '/settings?tab=about')
    await waitForCondition(
      cdp,
      `document.body.innerText.includes('One Person Lab Hermes Candidate') || document.body.innerText.includes('关于') || document.body.innerText.includes('About')`,
      'about settings'
    )
    const aboutPng = await capture(cdp, path.join(options.artifactsDir, 'settings-about.png'))
    const about = JSON.parse(await pageSnapshot(cdp))
    assertTextIncludesAny(about.bodyText, ['One Person Lab Hermes Candidate', 'One Person Lab'], 'about branding')

    const summary = {
      status: 'opl_hermes_settings_visual_smoke_passed',
      app_bundle_path: options.appPath,
      executable_path: binary,
      artifact_dir: options.artifactsDir,
      remote_debugging_port: options.remoteDebuggingPort,
      screenshots: {
        desktop_home: homePng,
        settings_access: accessPng,
        settings_agents: agentsPng,
        settings_about: aboutPng
      },
      assertions: {
        home_nonblank: true,
        home_branding_opl: true,
        home_legacy_hermes_wordmark_hidden: true,
        home_route_chips_visible: true,
        home_route_chip_inserts_prompt: true,
        model_access_gflabtoken_only: true,
        agents_capabilities_routes_visible: true,
        about_branding_visible: true,
        forbidden_provider_controls_hidden: true
      },
      fixture_calls: fs.existsSync(callsPath) ? fs.readFileSync(callsPath, 'utf8').trim().split(/\n/).filter(Boolean) : [],
      desktop_log: fs.existsSync(logPath) ? logPath : null
    }
    if (fs.existsSync(logPath)) {
      const copiedLog = path.join(options.artifactsDir, 'desktop.log')
      fs.copyFileSync(logPath, copiedLog)
      summary.desktop_log_artifact = copiedLog
    }
    fs.writeFileSync(path.join(options.artifactsDir, 'settings-visual-summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
    console.log(JSON.stringify(summary, null, 2))
  } catch (error) {
    if (cdp) {
      try {
        const failure = JSON.parse(await pageSnapshot(cdp))
        fs.writeFileSync(path.join(options.artifactsDir, 'failure-snapshot.json'), `${JSON.stringify(failure, null, 2)}\n`)
        await capture(cdp, path.join(options.artifactsDir, 'failure.png'))
      } catch {
        // keep the original failure
      }
    }
    throw error
  } finally {
    if (cdp) cdp.close()
    try {
      child.kill('SIGTERM')
    } catch {
      // best-effort cleanup
    }
    await sleep(500)
    if (!child.killed) {
      try {
        child.kill('SIGKILL')
      } catch {
        // best-effort cleanup
      }
    }
    if (stderr && /Error|Exception|Unhandled/i.test(stderr)) {
      fs.writeFileSync(path.join(options.artifactsDir, 'stderr.log'), stderr, 'utf8')
    }
  }
}

main().catch(error => {
  fail(error instanceof Error ? error.stack || error.message : String(error))
})
