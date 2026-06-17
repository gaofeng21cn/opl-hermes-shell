#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
const appPath = path.join(root, 'release', `mac-${arch}`, 'One Person Lab Hermes Candidate.app')
const productName = 'One Person Lab Hermes Candidate'
const binary = process.platform === 'darwin'
  ? path.join(appPath, 'Contents', 'MacOS', productName)
  : null
const legacyBinary = process.platform === 'darwin'
  ? path.join(appPath, 'Contents', 'MacOS', 'Electron')
  : null
const artifactsDir = path.resolve(process.env.OPL_HERMES_SMOKE_ARTIFACTS || path.join(root, 'out', 'smoke-opl-first-run'))
const summaryPath = path.join(artifactsDir, 'summary.json')

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

function copyIfExists(source, destination) {
  if (!source || !fs.existsSync(source)) return null
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(source, destination)
  return destination
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

function appStatePayload(apiKeyPresent, codexInstalled = true) {
  return {
    app_state: {
      meta: {
        profile: 'fast',
        read_policy: 'bounded_local_read_no_network_no_repair'
      },
      core: {
        codex: {
          installed: codexInstalled,
          version_status: codexInstalled ? 'compatible' : 'missing',
          binary_path: codexInstalled ? '/tmp/opl-smoke/bin/codex' : null,
          version: codexInstalled ? 'codex-cli 0.140.0' : null,
          api_key_present: apiKeyPresent,
          default_model: 'gpt-5.5',
          default_reasoning_effort: 'xhigh',
          provider_base_url: 'https://gflabtoken.cn/v1'
        }
      }
    }
  }
}

function makeFixtureBin(sandbox, apiKeyPresent, codexInstalled = true) {
  const binDir = path.join(sandbox, 'bin')
  const callsPath = path.join(sandbox, 'opl-calls.log')
  fs.mkdirSync(binDir, { recursive: true })
  fs.mkdirSync(path.dirname(callsPath), { recursive: true })
  const payload = JSON.stringify(initializePayload(apiKeyPresent))
  const appStatePayloadJson = JSON.stringify(appStatePayload(apiKeyPresent, codexInstalled))
  writeExecutable(path.join(binDir, 'opl'), `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
const payload = ${JSON.stringify(payload)}
const appStatePayload = ${JSON.stringify(appStatePayloadJson)}
fs.appendFileSync(${JSON.stringify(callsPath)}, args.join(' ') + '\\n')
if (args.join(' ') === 'system initialize --json') {
  console.log(payload)
  process.exit(0)
}
if (args.join(' ') === 'app state --profile fast --json') {
  console.log(appStatePayload)
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
  console.log(JSON.stringify({
    ok: true,
    app_action_execution: {
      action_id: 'workspace_ensure',
      dry_run: true,
      authority_boundary: {
        shell: 'implementation_adapter_only',
        can_write_domain_truth: false
      }
    }
  }))
  process.exit(0)
}
if (args.join(' ') === 'start --project medautoscience --json') {
  console.log(JSON.stringify({
    ok: true,
    product_entry_start: {
      project_id: 'medautoscience',
      selected_mode_id: 'open_product_entry'
    }
  }))
  process.exit(0)
}
if (args.join(' ') === 'start --project medautogrant --json') {
  console.error(JSON.stringify({ error: { code: 'route_not_ready', message: 'MAG workspace route is not ready in this smoke fixture.' } }))
  process.exit(2)
}
if (args.join(' ') === 'start --project redcube --json') {
  console.error(JSON.stringify({ error: { code: 'route_not_ready', message: 'RCA workspace route is not ready in this smoke fixture.' } }))
  process.exit(2)
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
  return { binDir, callsPath }
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

function openGatewaySocket(wsUrl) {
  assert(typeof WebSocket === 'function', 'global WebSocket is required for packaged gateway smoke')

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl)
    const timer = setTimeout(() => {
      try {
        socket.close()
      } catch {
        // best-effort cleanup
      }
      reject(new Error(`timeout opening ${wsUrl}`))
    }, 3000)
    socket.addEventListener('open', () => {
      clearTimeout(timer)
      resolve(socket)
    })
    socket.addEventListener('error', event => {
      clearTimeout(timer)
      reject(new Error(event.message || `websocket error for ${wsUrl}`))
    })
  })
}

function requestRpcOnSocket(socket, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1_000_000)
    const timer = setTimeout(() => {
      socket.removeEventListener('message', onMessage)
      reject(new Error(`timeout waiting for ${method}`))
    }, 4000)
    function onMessage(event) {
      const frame = JSON.parse(String(event.data))
      if (frame.id !== id) return
      clearTimeout(timer)
      socket.removeEventListener('message', onMessage)
      if (frame.error) {
        reject(new Error(frame.error.message || `rpc ${method} failed`))
        return
      }
      resolve(frame.result)
    }
    socket.addEventListener('message', onMessage)
    socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  })
}

async function waitForGatewayFrame(frames, predicate, label) {
  const started = Date.now()
  while (Date.now() - started < smokeTimeoutMs) {
    const frame = frames.find(predicate)
    if (frame) return frame
    await sleep(100)
  }
  throw new Error(`timeout waiting for ${label}`)
}

function readCalls(callsPath) {
  try {
    return fs.readFileSync(callsPath, 'utf8').trim().split(/\n/).filter(Boolean)
  } catch {
    return []
  }
}

function stageState(text, stageName) {
  const matches = text.matchAll(new RegExp(`"name":"${stageName}","state":"([^"]+)"`, 'g'))
  return Array.from(matches, match => match[1])
}

async function runLaunch({
  apiKeyPresent,
  codexInstalled = true,
  exerciseChat = false,
  exerciseRoutes = false,
  name,
  sandbox,
  expectBlockingInitialize,
  expectRouteToModelAccess
}) {
  const userData = path.join(sandbox, 'user-data')
  const hermesHome = path.join(sandbox, `hermes-home-${name}`)
  const workspace = path.join(sandbox, 'workspace')
  fs.mkdirSync(userData, { recursive: true })
  fs.mkdirSync(hermesHome, { recursive: true })
  fs.mkdirSync(workspace, { recursive: true })
  const { binDir, callsPath } = makeFixtureBin(path.join(sandbox, `fixture-${name}`), apiKeyPresent, codexInstalled)
  const logPath = path.join(hermesHome, 'logs', 'desktop.log')
  const callsBefore = readCalls(callsPath).length

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
      log.includes('OPL Codex adapter is ready. Finalizing desktop startup')
    ))
    const port = gatewayPortFromLog(text)
    assert(port, `${name}: gateway port was not logged`)
    const baseUrl = `http://127.0.0.1:${port}`
    const oauth = await getJson(baseUrl, '/api/providers/oauth')
    assert(Array.isArray(oauth.providers) && oauth.providers.length === 0, `${name}: OAuth provider route is not renderer-safe empty list`)
    const status = await getJson(baseUrl, '/api/status')
    assert(status.backend === 'codex-app-server-adapter', `${name}: status backend is not Codex app-server adapter`)
    assert(status.provider_configured === apiKeyPresent, `${name}: provider_configured mismatch`)
    const purposeCatalog = await getJson(baseUrl, '/api/opl/purpose-routes')
    assert(purposeCatalog.surface_kind === 'opl_hermes_purpose_route_catalog.v1', `${name}: purpose route catalog shape mismatch`)
    for (const purposeId of ['mas', 'mag', 'rca', 'opl']) {
      assert(purposeCatalog.routes.some(route => route.purpose_id === purposeId), `${name}: missing ${purposeId} route`)
    }
    const smokeConnection = await getJson(baseUrl, '/api/smoke/connection')
    assert(smokeConnection.surface_kind === 'opl_hermes_smoke_connection.v1', `${name}: smoke connection descriptor missing`)
    const chatEvidence = exerciseChat || exerciseRoutes
      ? await exerciseGatewayConversation({
          wsUrl: smokeConnection.wsUrl,
          exerciseRoutes,
          name
        })
      : null
    await sleep(500)
    text = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : text
    assert(!/install\.sh|install\.ps1|Hermes Agent installer/i.test(text), `${name}: Hermes installer path leaked into OPL first run`)
    assert(!/unsupported rpc config\.(get|set)/i.test(text), `${name}: renderer-safe config RPC is still unsupported`)
    const expectedStages = expectBlockingInitialize
      ? [
        'opl-cli-check',
        'codex-cli-check',
        'opl-initialize',
        'opl-core-setup',
        'opl-post-setup-check',
        'opl-codex-adapter',
        'opl-maintenance-schedule'
      ]
      : [
        'opl-cli-check',
        'codex-cli-check',
        'opl-initialize',
        'opl-core-setup',
        'opl-post-setup-check',
        'opl-codex-adapter',
        'opl-maintenance-schedule'
      ]
    for (const stage of expectedStages) {
      assert(text.includes(`"name":"${stage}"`) || text.includes(`"stage":"${stage}"`), `${name}: ${stage} did not emit`)
    }
    assert(!text.includes('"stage":"opl-model-access"'), `${name}: model access leaked into initialization stages`)
    const callsAfter = readCalls(callsPath)
    const newCalls = callsAfter.slice(callsBefore)
    const adapterReadyIndex = text.indexOf('OPL Codex adapter is ready. Finalizing desktop startup')
    const initializeStates = stageState(text, 'opl-initialize')
    if (expectBlockingInitialize) {
      const initializeStageIndex = text.indexOf('"name":"opl-initialize","state":"running"')
      assert(initializeStates.includes('running'), `${name}: expected one-time initialize running stage before adapter ready`)
      assert(
        adapterReadyIndex < 0 || initializeStageIndex < adapterReadyIndex,
        `${name}: expected initialize before adapter ready`
      )
      assert(newCalls.includes('system initialize --json'), `${name}: initialize command did not run`)
    } else {
      const backgroundCalls = [
        'system initialize --json',
        'system startup-maintenance --json',
        'system reconcile-modules --json'
      ]
      assert(
        newCalls.includes('app state --profile fast --json') ||
          newCalls.length === 0 ||
          newCalls.every(call => backgroundCalls.includes(call)),
        `${name}: calls were neither fast probe, marker reuse, nor deferred background refresh: ${JSON.stringify(newCalls)}`
      )
      const backgroundStatusIndex = text.indexOf('"stage":"opl-background-status-refresh"')
      assert(
        !text.includes('[opl-bootstrap] running one-time initialization'),
        `${name}: one-time initialization path ran during lightweight startup`
      )
      assert(
        !text.includes('"type":"manifest","stages":[{"name":"opl-cli-check"'),
        `${name}: install checklist manifest was shown during lightweight startup`
      )
      if (newCalls.includes('system initialize --json')) {
        assert(
          backgroundStatusIndex > adapterReadyIndex,
          `${name}: full initialize ran before adapter ready instead of deferred background refresh`
        )
      }
      if (newCalls.includes('app state --profile fast --json')) {
        assert(
          initializeStates.includes('succeeded'),
          `${name}: fast app state probe did not complete, initializeStates=${JSON.stringify(initializeStates)}`
        )
      } else {
        assert(
          initializeStates.every(state => state === 'skipped'),
          `${name}: expected marker hot launch to skip initialize stage, initializeStates=${JSON.stringify(initializeStates)}`
        )
      }
      assert(
        apiKeyPresent
          ? (text.includes('"stage":"opl-background-status-refresh"') || newCalls.length === 0)
          : !text.includes('"stage":"opl-background-status-refresh"'),
        `${name}: background refresh expectation mismatch, calls=${JSON.stringify(newCalls)}`
      )
    }
    if (apiKeyPresent) {
      assert(text.includes('"maintenance_deferred":true'), `${name}: configured first run did not defer maintenance`)
      assert(!text.includes('API key entry continues in the model access screen'), `${name}: configured first run still routed to API key entry`)
    } else {
      assert(
        text.includes('API key entry continues in the model access screen') === expectRouteToModelAccess,
        `${name}: missing key route expectation mismatch`
      )
      assert(text.includes('"needsApiKey":true') || text.includes('"api_key_present":false'), `${name}: missing-key state was not visible`)
      assert(!text.includes('[opl-maintenance]'), `${name}: background maintenance started before model access was configured`)
    }
    const copiedLogPath = copyIfExists(logPath, path.join(artifactsDir, `${name}.desktop.log`))
    const copiedCallsPath = copyIfExists(callsPath, path.join(artifactsDir, `${name}.opl-calls.log`))
    return {
      calls: newCalls,
      logPath,
      copiedLogPath,
      callsPath,
      copiedCallsPath,
      sandbox,
      gateway: {
        status,
        purpose_route_count: purposeCatalog.routes.length
      },
      chatEvidence
    }
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

async function exerciseGatewayConversation({ wsUrl, exerciseRoutes, name }) {
  const socket = await openGatewaySocket(wsUrl)
  const frames = []
  socket.addEventListener('message', event => {
    frames.push(JSON.parse(String(event.data)))
  })

  try {
    const session = await requestRpcOnSocket(socket, 'session.create', exerciseRoutes ? { purpose: 'mas' } : {})
    await requestRpcOnSocket(socket, 'prompt.submit', {
      session_id: session.session_id,
      text: exerciseRoutes
        ? '检查 MAS 糖尿病 002、003 两篇论文的进展'
        : '请回复一句 packaged Codex smoke。'
    })
    await waitForGatewayFrame(frames, frame => frame.params?.type === 'message.complete', `${name} message.complete`)

    const assistantDelta = frames
      .filter(frame => frame.params?.type === 'message.delta')
      .map(frame => frame.params?.payload?.text || '')
      .join('')
    assert(assistantDelta.includes('fixture codex response'), `${name}: Codex app-server delta did not reach Hermes stream`)

    const routeFrame = frames.find(frame => frame.params?.type === 'route.receipt' || frame.params?.type === 'route.error')
    if (exerciseRoutes) {
      assert(routeFrame, `${name}: route receipt/error did not reach Hermes stream`)
      assert(routeFrame.params.payload.receipt.purpose_id === 'mas', `${name}: MAS route receipt missing`)
      assert(routeFrame.params.payload.receipt.status === 'route_readback_ready', `${name}: MAS route was not ready in fixture`)
    }

    const routeReadbacks = {}
    if (exerciseRoutes) {
      for (const purpose of ['mag', 'rca']) {
        const resolved = await requestRpcOnSocket(socket, 'purpose.route.resolve', { purpose })
        assert(resolved.ok === true, `${name}: ${purpose} route did not resolve`)
        assert(resolved.route.purpose_id === purpose, `${name}: ${purpose} route id mismatch`)
        assert(
          resolved.receipt.status === 'route_readback_ready' || resolved.receipt.status === 'route_readback_with_blockers',
          `${name}: ${purpose} route status was not explicit`
        )
        routeReadbacks[purpose] = {
          event_status: resolved.receipt.status,
          error_count: resolved.receipt.errors.length,
          project_id: resolved.receipt.project_id
        }
      }
    }

    return {
      session_id: session.session_id,
      message_complete: true,
      assistant_delta: assistantDelta,
      route_event_type: routeFrame?.params?.type || null,
      route_status: routeFrame?.params?.payload?.receipt?.status || null,
      route_readbacks: routeReadbacks,
      frame_count: frames.length
    }
  } finally {
    socket.close()
  }
}

async function main() {
  assert(process.platform === 'darwin', 'packaged OPL first-run smoke is currently macOS-only')
  fs.rmSync(artifactsDir, { recursive: true, force: true })
  fs.mkdirSync(artifactsDir, { recursive: true })
  assert(binary && fs.existsSync(binary), `missing packaged executable: ${binary}`)
  assert(!legacyBinary || !fs.existsSync(legacyBinary), `packaged app still exposes legacy Electron executable: ${legacyBinary}`)

  const missingSandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'opl-hermes-missing-key-'))
  const configuredSandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'opl-hermes-configured-key-'))
  const fallbackSandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'opl-hermes-fallback-'))
  const missing = await runLaunch({
    apiKeyPresent: false,
    expectBlockingInitialize: false,
    expectRouteToModelAccess: true,
    name: 'missing-key-first-run',
    sandbox: missingSandbox
  })
  const missingHot = await runLaunch({
    apiKeyPresent: false,
    expectBlockingInitialize: false,
    expectRouteToModelAccess: true,
    name: 'missing-key-hot-launch',
    sandbox: missingSandbox
  })
  const configured = await runLaunch({
    apiKeyPresent: true,
    exerciseChat: true,
    exerciseRoutes: true,
    expectBlockingInitialize: false,
    expectRouteToModelAccess: false,
    name: 'configured-key-first-run',
    sandbox: configuredSandbox
  })
  const configuredHot = await runLaunch({
    apiKeyPresent: true,
    expectBlockingInitialize: false,
    expectRouteToModelAccess: false,
    name: 'configured-key-hot-launch',
    sandbox: configuredSandbox
  })
  const fallbackInitialize = await runLaunch({
    apiKeyPresent: true,
    codexInstalled: false,
    expectBlockingInitialize: true,
    expectRouteToModelAccess: false,
    name: 'fast-probe-not-ready-first-run',
    sandbox: fallbackSandbox
  })

  const summary = {
    status: 'opl_hermes_packaged_first_run_smoke_passed',
    app_bundle_path: appPath,
    executable_path: binary,
    artifact_dir: artifactsDir,
    cases: {
      missing_key: missing,
      missing_key_hot_launch: missingHot,
      configured_key: configured,
      configured_key_hot_launch: configuredHot,
      fast_probe_not_ready_first_run: fallbackInitialize
    }
  }
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)
  console.log(JSON.stringify(summary, null, 2))
}

main().catch(error => {
  fail(error instanceof Error ? error.stack || error.message : String(error))
})
