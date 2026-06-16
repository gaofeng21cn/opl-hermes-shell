#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
const appPath = path.join(root, 'release', `mac-${arch}`, 'One Person Lab Hermes Candidate.app')
const binary = process.platform === 'darwin'
  ? path.join(appPath, 'Contents', 'MacOS', 'Electron')
  : null

const smokeTimeoutMs = 14_000

function fail(message) {
  console.error(message)
  process.exit(1)
}

function assert(condition, message) {
  if (!condition) fail(message)
}

function normalizeExpectedStderr(raw) {
  return String(raw || '')
    .replace(
      /\[\d+:\d+\/\d+\.\d+:ERROR:net\/cert\/internal\/trust_store_mac\.cc:\d+\] Error parsing certificate:[\s\S]*?(?=\n\[\d+:\d+\/|\nError occurred in handler|$)/g,
      ''
    )
    .replace(
      /Error occurred in handler for 'hermes:api': Error: connect ECONNREFUSED 127\.0\.0\.1:\d+[\s\S]*?(?=\nError occurred in handler|\n\[\d+:\d+\/|$)/g,
      ''
    )
    .trim()
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function writeExecutable(filePath, body) {
  fs.writeFileSync(filePath, body, 'utf8')
  fs.chmodSync(filePath, 0o755)
}

function initializePayload(apiKeyPresent) {
  return {
    system_initialize: {
      setup_flow: {
        ready_to_launch: true,
        blocking_items: apiKeyPresent ? [] : ['codex_config']
      },
      core_engines: {
        codex: {
          api_key_present: apiKeyPresent,
          config_path: '/tmp/opl-smoke/.codex/config.toml',
          default_model: 'gpt-5.5',
          default_reasoning_effort: 'xhigh',
          provider_base_url: 'https://gflabtoken.cn/v1'
        }
      },
      checklist: [
        {
          item_id: 'codex_config',
          last_attempt: { api_key_present: apiKeyPresent }
        }
      ]
    }
  }
}

function makeFixtureBin(sandbox, apiKeyPresent) {
  const binDir = path.join(sandbox, 'bin')
  fs.mkdirSync(binDir, { recursive: true })
  const payload = JSON.stringify(initializePayload(apiKeyPresent))
  writeExecutable(path.join(binDir, 'opl'), `#!/usr/bin/env node
const args = process.argv.slice(2)
const payload = ${JSON.stringify(payload)}
if (args.join(' ') === 'system initialize --json') {
  console.log(payload)
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
if (args.join(' ') === 'system configure-codex --api-key-stdin --json') {
  process.stdin.resume()
  process.stdin.on('end', () => {
    console.log(JSON.stringify({ ok: true, configured: true }))
  })
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
let buffer = ''
function write(message) {
  process.stdout.write(JSON.stringify(message) + '\\n')
}
function respond(id, result) {
  write({ jsonrpc: '2.0', id, result })
}
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  let newlineIndex = buffer.indexOf('\\n')
  while (newlineIndex >= 0) {
    const line = buffer.slice(0, newlineIndex).trim()
    buffer = buffer.slice(newlineIndex + 1)
    if (line) handle(JSON.parse(line))
    newlineIndex = buffer.indexOf('\\n')
  }
})
function handle(request) {
  if (request.method === 'initialize') {
    respond(request.id, { serverInfo: { name: 'fixture-codex-app-server', version: '0.0.0' } })
    return
  }
  if (request.method === 'thread/start') {
    respond(request.id, { thread: { id: 'thread-fixture' }, cwd: request.params?.cwd || process.cwd() })
    return
  }
  if (request.method === 'turn/start') {
    respond(request.id, { turn: { id: 'turn-fixture', status: 'running' } })
    write({ jsonrpc: '2.0', method: 'turn/started', params: { threadId: request.params?.threadId || 'thread-fixture', turn: { id: 'turn-fixture', status: 'running' } } })
    write({ jsonrpc: '2.0', method: 'item/agentMessage/delta', params: { threadId: request.params?.threadId || 'thread-fixture', turnId: 'turn-fixture', delta: 'fixture codex response' } })
    write({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId: request.params?.threadId || 'thread-fixture', turn: { id: 'turn-fixture', status: 'completed' } } })
    return
  }
  if (request.method === 'turn/abort') {
    respond(request.id, { ok: true })
    return
  }
  write({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'unsupported fixture method ' + request.method } })
}
`)
  return binDir
}

async function waitForLog(logPath, predicate) {
  const started = Date.now()
  while (Date.now() - started < smokeTimeoutMs) {
    if (fs.existsSync(logPath)) {
      const text = fs.readFileSync(logPath, 'utf8')
      if (predicate(text)) return text
    }
    await sleep(250)
  }
  const text = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : ''
  fail(`timed out waiting for packaged first-run smoke log. log=${logPath}\n${text.slice(-4000)}`)
}

function gatewayPortFromLog(text) {
  const match = text.match(/gateway listening on 127\.0\.0\.1:(\d+)/)
  return match ? Number(match[1]) : null
}

async function getJson(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`)
  assert(response.ok, `${pathname} returned ${response.status}`)
  return response.json()
}

async function runCase(name, apiKeyPresent) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), `opl-hermes-${name}-`))
  const userData = path.join(sandbox, 'user-data')
  const hermesHome = path.join(sandbox, 'hermes-home')
  const workspace = path.join(sandbox, 'workspace')
  fs.mkdirSync(userData, { recursive: true })
  fs.mkdirSync(hermesHome, { recursive: true })
  fs.mkdirSync(workspace, { recursive: true })
  const binDir = makeFixtureBin(sandbox, apiKeyPresent)
  const logPath = path.join(hermesHome, 'logs', 'desktop.log')

  const env = {
    ...process.env,
    HERMES_DESKTOP_CWD: workspace,
    HERMES_DESKTOP_IGNORE_EXISTING: '1',
    HERMES_DESKTOP_USER_DATA_DIR: userData,
    HERMES_HOME: hermesHome,
    OPL_HERMES_CODEX_CANDIDATE: '1',
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`
  }
  delete env.HERMES_DESKTOP_HERMES
  delete env.HERMES_DESKTOP_HERMES_ROOT

  const child = spawn(binary, [], {
    cwd: workspace,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stderr = ''
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })

  try {
    let text = await waitForLog(logPath, log => (
      log.includes('OPL App initialization instead of Hermes Agent install') &&
      log.includes('OPL Codex adapter is ready. Finalizing desktop startup') &&
      log.includes('"api_key_present":' + String(apiKeyPresent))
    ))
    const port = gatewayPortFromLog(text)
    assert(port, `${name}: gateway port was not logged`)
    const baseUrl = `http://127.0.0.1:${port}`
    const oauth = await getJson(baseUrl, '/api/providers/oauth')
    assert(Array.isArray(oauth.providers) && oauth.providers.length === 0, `${name}: OAuth provider route is not renderer-safe empty list`)
    const status = await getJson(baseUrl, '/api/status')
    assert(status.backend === 'codex-app-server-adapter', `${name}: status backend is not Codex app-server adapter`)
    assert(status.provider_configured === apiKeyPresent, `${name}: provider_configured mismatch`)
    await sleep(500)
    text = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : text
    assert(!/install\.sh|install\.ps1|Hermes Agent installer/i.test(text), `${name}: Hermes installer path leaked into OPL first run`)
    assert(!/unsupported rpc config\.(get|set)/i.test(text), `${name}: renderer-safe config RPC is still unsupported`)
    for (const stage of [
      'opl-cli-check',
      'codex-cli-check',
      'opl-initialize',
      'opl-core-setup',
      'opl-post-setup-check',
      'opl-model-access',
      'opl-codex-adapter',
      'opl-maintenance-schedule'
    ]) {
      assert(text.includes(`"name":"${stage}"`) || text.includes(`"stage":"${stage}"`), `${name}: ${stage} did not emit`)
    }
    assert(text.includes('"stage":"opl-model-access"'), `${name}: model access stage did not emit`)
    if (apiKeyPresent) {
      assert(text.includes('"maintenance_deferred":true'), `${name}: configured first run did not defer maintenance`)
      assert(!text.includes('API key entry continues in the model access screen'), `${name}: configured first run still routed to API key entry`)
    } else {
      assert(text.includes('API key entry continues in the model access screen'), `${name}: missing key did not route to model access entry`)
      assert(text.includes('"needsApiKey":true') || text.includes('"api_key_present":false'), `${name}: missing-key state was not visible`)
    }
    return { logPath, sandbox }
  } finally {
    try {
      child.kill('SIGTERM')
    } catch {
      // best-effort cleanup
    }
    await sleep(300)
    if (!child.killed) {
      try {
        child.kill('SIGKILL')
      } catch {
        // best-effort cleanup
      }
    }
    const unexpectedStderr = normalizeExpectedStderr(stderr)
    if (unexpectedStderr && /Error|Exception|Unhandled/i.test(unexpectedStderr)) {
      console.error(`[${name}] stderr:\n${unexpectedStderr}`)
    }
  }
}

async function main() {
  assert(process.platform === 'darwin', 'packaged OPL first-run smoke is currently macOS-only')
  assert(binary && fs.existsSync(binary), `missing packaged executable: ${binary}`)

  const missing = await runCase('missing-key', false)
  const configured = await runCase('configured-key', true)

  console.log(JSON.stringify({
    status: 'opl_hermes_packaged_first_run_smoke_passed',
    cases: {
      missing_key: missing,
      configured_key: configured
    }
  }, null, 2))
}

main().catch(error => {
  fail(error instanceof Error ? error.stack || error.message : String(error))
})
