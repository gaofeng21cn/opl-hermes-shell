const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  apiKeyPresent,
  classifyStartupMarker,
  hasOnlyApiKeyBlocker,
  readyToLaunch,
  requiredCoreMissing,
  runOplMaintenanceStages,
  runOplBootstrap
} = require('./opl-bootstrap-runner.cjs')
const { writeOplStartupMarker } = require('./opl-startup-marker.cjs')

function mkTmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opl-bootstrap-test-'))
}

function writeFixtureOpl(binDir, payloads) {
  const script = path.join(binDir, 'opl')
  fs.writeFileSync(
    script,
    `#!${process.execPath}
const fs = require('node:fs')
const payloads = ${JSON.stringify(payloads)}
const args = process.argv.slice(2)
const key = args.join(' ')
if (payloads.callsFile) fs.appendFileSync(payloads.callsFile, key + '\\n')
if (key === 'system initialize --json') {
  console.log(JSON.stringify(payloads.initialize.shift()))
  process.exit(0)
}
if (key === 'app state --profile fast --json') {
  const appState = Array.isArray(payloads.appState) ? payloads.appState.shift() : payloads.appState
  if (appState) {
    console.log(JSON.stringify(appState))
    process.exit(0)
  }
  console.error('missing fixture app state payload')
  process.exit(3)
}
if (key === 'install --skip-gui-open --skip-modules --skip-native-helper-repair --json') {
  console.log(JSON.stringify(payloads.install || { ok: true }))
  process.exit(0)
}
if (key === 'system configure-codex --api-key-stdin --json') {
  let input = ''
  process.stdin.on('data', chunk => { input += chunk })
  process.stdin.on('end', () => {
    console.log(JSON.stringify({ ok: input.trim().length > 0 }))
  })
  return
}
if (key === 'system startup-maintenance --json') {
  console.log(JSON.stringify(payloads.startupMaintenance || { ok: true }))
  process.exit(0)
}
if (key === 'system reconcile-modules --json') {
  console.log(JSON.stringify(payloads.reconcileModules || { ok: true }))
  process.exit(0)
}
console.error('unexpected opl command: ' + key)
process.exit(2)
`
  )
  fs.chmodSync(script, 0o755)
}

function writeFixtureCodex(binDir) {
  const script = path.join(binDir, 'codex')
  fs.writeFileSync(
    script,
    `#!${process.execPath}
console.log(JSON.stringify({ ok: true, fixture: 'codex-cli' }))
`
  )
  fs.chmodSync(script, 0o755)
}

function readCalls(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim().split(/\n/).filter(Boolean)
  } catch {
    return []
  }
}

function initializePayload({ ready = true, apiKey = true, blockers = [] } = {}) {
  return {
    system_initialize: {
      setup_flow: {
        ready_to_launch: ready,
        blocking_items: blockers
      },
      core_engines: {
        codex: {
          api_key_present: apiKey,
          provider_base_url: 'https://gflabtoken.cn/v1'
        }
      },
      checklist: [
        {
          item_id: 'codex_config',
          last_attempt: {
            api_key_present: apiKey
          }
        }
      ]
    }
  }
}

function appStatePayload({ codexInstalled = true, apiKey = true } = {}) {
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
          binary_path: codexInstalled ? '/fixture/bin/codex' : null,
          version: codexInstalled ? 'codex-cli 0.140.0' : null,
          api_key_present: apiKey,
          default_model: 'gpt-5.5',
          default_reasoning_effort: 'xhigh',
          provider_base_url: 'https://gflabtoken.cn/v1'
        }
      }
    }
  }
}

test('initialize helpers read OPL first-run truth fields', () => {
  const payload = initializePayload({ ready: true, apiKey: false, blockers: ['codex_config'] })
  assert.equal(readyToLaunch(payload), true)
  assert.equal(apiKeyPresent(payload), false)
  assert.equal(hasOnlyApiKeyBlocker(payload), true)
})

test('startup marker classifier requires current marker schema and present core paths', () => {
  const home = mkTmpHome()
  const markerPath = path.join(home, 'marker.json')
  const coreFile = path.join(home, 'core.txt')
  try {
    assert.deepEqual(requiredCoreMissing([coreFile]), [coreFile])
    assert.equal(classifyStartupMarker({ markerPath, requiredCorePaths: [coreFile] }).reason, 'missing')

    writeOplStartupMarker(markerPath, { api_key_present: true })
    assert.equal(classifyStartupMarker({ markerPath, requiredCorePaths: [coreFile] }).reason, 'core_missing')

    fs.writeFileSync(coreFile, 'ok')
    const current = classifyStartupMarker({ markerPath, requiredCorePaths: [coreFile] })
    assert.equal(current.needsInitialize, false)
    assert.equal(current.reason, 'marker_current')

    fs.writeFileSync(
      markerPath,
      JSON.stringify({ kind: 'opl-hermes-candidate-startup', schemaVersion: 0, completedAt: new Date().toISOString() })
    )
    assert.equal(classifyStartupMarker({ markerPath, requiredCorePaths: [coreFile] }).reason, 'schema_version_mismatch')
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('runOplBootstrap uses fast app state when marker is missing but OPL is already usable', async () => {
  const home = mkTmpHome()
  const bin = path.join(home, 'bin')
  const markerPath = path.join(home, 'userData', 'opl-startup-marker.json')
  const callsFile = path.join(home, 'calls.log')
  fs.mkdirSync(bin, { recursive: true })
  writeFixtureOpl(bin, { appState: appStatePayload(), initialize: [initializePayload()], callsFile })
  writeFixtureCodex(bin)

  const events = []
  try {
    const result = await runOplBootstrap({
      cwd: home,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}` },
      logRoot: path.join(home, 'logs'),
      markerPath,
      onEvent: ev => events.push(ev)
    })

    assert.equal(result.ok, true)
    assert.equal(result.startupMode, 'lightweight')
    assert.equal(result.initialize, null)
    assert.equal(result.needsApiKey, false)
    assert.equal(result.maintenanceDeferred, true)
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'))
    assert.equal(marker.kind, 'opl-hermes-candidate-startup')
    assert.equal(marker.startup_path, 'lightweight_probe')
    assert.equal(marker.marker_reason, 'missing_fast_state_ready')
    assert.deepEqual(readCalls(callsFile), ['app state --profile fast --json'])
    assert.equal(events.some(ev => ev.type === 'manifest'), false)
    assert.ok(events.some(ev => ev.type === 'stage' && ev.name === 'opl-cli-check' && ev.state === 'succeeded'))
    assert.ok(events.some(ev => ev.type === 'stage' && ev.name === 'codex-cli-check' && ev.state === 'succeeded'))
    assert.ok(events.some(ev => ev.type === 'stage' && ev.name === 'opl-initialize' && ev.state === 'succeeded'))
    assert.ok(events.some(ev => ev.type === 'stage' && ev.name === 'opl-core-setup' && ev.state === 'skipped'))
    assert.ok(events.some(ev => ev.type === 'stage' && ev.name === 'opl-post-setup-check' && ev.state === 'skipped'))
    assert.equal(events.some(ev => ev.type === 'stage' && ev.name === 'opl-model-access'), false)
    assert.ok(events.some(ev => ev.type === 'stage' && ev.name === 'opl-codex-adapter' && ev.state === 'succeeded'))
    assert.ok(events.some(ev => ev.type === 'stage' && ev.name === 'opl-maintenance-schedule' && ev.state === 'succeeded'))
    assert.equal(events.some(ev => ev.type === 'stage' && ev.name === 'opl-startup-maintenance'), false)
    assert.equal(events.some(ev => /install\.sh|install\.ps1|Hermes Agent/.test(JSON.stringify(ev))), false)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('runOplBootstrap falls back to one-time initialization when fast app state cannot prove readiness', async () => {
  const home = mkTmpHome()
  const bin = path.join(home, 'bin')
  const markerPath = path.join(home, 'userData', 'opl-startup-marker.json')
  const callsFile = path.join(home, 'calls.log')
  fs.mkdirSync(bin, { recursive: true })
  writeFixtureOpl(bin, {
    appState: appStatePayload({ codexInstalled: false, apiKey: true }),
    initialize: [initializePayload()],
    callsFile
  })
  writeFixtureCodex(bin)

  const events = []
  try {
    const result = await runOplBootstrap({
      cwd: home,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}` },
      logRoot: path.join(home, 'logs'),
      markerPath,
      onEvent: ev => events.push(ev)
    })

    assert.equal(result.ok, true)
    assert.equal(result.startupMode, 'initialized')
    assert.deepEqual(readCalls(callsFile), ['app state --profile fast --json', 'system initialize --json'])
    const manifest = events.find(ev => ev.type === 'manifest')
    assert.ok(manifest)
    assert.deepEqual(
      manifest.stages.map(stage => [stage.name, stage.title]),
      [
        ['opl-cli-check', 'Check One Person Lab CLI'],
        ['codex-cli-check', 'Check Codex CLI'],
        ['opl-initialize', 'Read One Person Lab status'],
        ['opl-core-setup', 'Prepare One Person Lab core components'],
        ['opl-post-setup-check', 'Verify One Person Lab setup'],
        ['opl-codex-adapter', 'Prepare Codex desktop adapter'],
        ['opl-maintenance-schedule', 'Schedule background maintenance']
      ]
    )
    assert.ok(events.some(ev => ev.type === 'stage' && ev.name === 'opl-initialize' && ev.state === 'succeeded'))
    assert.equal(JSON.parse(fs.readFileSync(markerPath, 'utf8')).marker_reason, 'missing')
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('runOplBootstrap uses lightweight startup when OPL marker is current', async () => {
  const home = mkTmpHome()
  const bin = path.join(home, 'bin')
  const markerPath = path.join(home, 'userData', 'opl-startup-marker.json')
  const callsFile = path.join(home, 'calls.log')
  fs.mkdirSync(bin, { recursive: true })
  writeFixtureOpl(bin, { initialize: [initializePayload()], callsFile })
  writeFixtureCodex(bin)
  writeOplStartupMarker(markerPath, { api_key_present: true })

  const events = []
  try {
    const result = await runOplBootstrap({
      cwd: home,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}` },
      logRoot: path.join(home, 'logs'),
      markerPath,
      onEvent: ev => events.push(ev)
    })

    assert.equal(result.ok, true)
    assert.equal(result.startupMode, 'lightweight')
    assert.equal(result.initialize, null)
    assert.equal(result.needsApiKey, false)
    assert.deepEqual(readCalls(callsFile), [])
    assert.ok(events.some(ev => ev.type === 'stage' && ev.name === 'opl-cli-check' && ev.state === 'succeeded'))
    assert.ok(events.some(ev => ev.type === 'stage' && ev.name === 'codex-cli-check' && ev.state === 'succeeded'))
    assert.ok(events.some(ev => ev.type === 'stage' && ev.name === 'opl-initialize' && ev.state === 'skipped'))
    assert.ok(events.some(ev => ev.type === 'stage' && ev.name === 'opl-core-setup' && ev.state === 'skipped'))
    assert.equal(events.some(ev => ev.type === 'stage' && ev.name === 'opl-model-access'), false)
    assert.ok(events.some(ev => ev.type === 'stage' && ev.name === 'opl-codex-adapter' && ev.state === 'succeeded'))
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('runOplBootstrap routes current-marker missing key to model access without full initialize', async () => {
  const home = mkTmpHome()
  const bin = path.join(home, 'bin')
  const markerPath = path.join(home, 'userData', 'opl-startup-marker.json')
  const callsFile = path.join(home, 'calls.log')
  fs.mkdirSync(bin, { recursive: true })
  writeFixtureOpl(bin, { initialize: [initializePayload({ apiKey: false, blockers: ['codex_config'] })], callsFile })
  writeFixtureCodex(bin)
  writeOplStartupMarker(markerPath, { api_key_present: false })

  const events = []
  try {
    const result = await runOplBootstrap({
      cwd: home,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}` },
      logRoot: path.join(home, 'logs'),
      markerPath,
      onEvent: ev => events.push(ev)
    })

    assert.equal(result.ok, true)
    assert.equal(result.startupMode, 'lightweight')
    assert.equal(result.initialize, null)
    assert.equal(result.needsApiKey, true)
    assert.deepEqual(readCalls(callsFile), [])
    assert.equal(events.some(ev => ev.type === 'stage' && ev.name === 'opl-model-access'), false)
    assert.ok(events.some(ev => ev.type === 'route' && ev.route === 'model-access' && ev.needsApiKey === true))
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('runOplMaintenanceStages performs full status refresh in the background path', async () => {
  const home = mkTmpHome()
  const bin = path.join(home, 'bin')
  const callsFile = path.join(home, 'calls.log')
  fs.mkdirSync(bin, { recursive: true })
  writeFixtureOpl(bin, {
    initialize: [initializePayload()],
    startupMaintenance: { ok: true },
    reconcileModules: { ok: true },
    callsFile
  })

  const events = []
  try {
    const result = await runOplMaintenanceStages({
      cwd: home,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}` },
      emit: ev => events.push(ev),
      emitOutput: false
    })

    assert.equal(result.ok, true)
    assert.deepEqual(readCalls(callsFile), [
      'system initialize --json',
      'system startup-maintenance --json',
      'system reconcile-modules --json'
    ])
    assert.ok(events.some(ev => ev.type === 'stage' && ev.name === 'opl-background-status-refresh' && ev.state === 'succeeded'))
    assert.ok(events.some(ev => ev.type === 'stage' && ev.name === 'opl-startup-maintenance' && ev.state === 'succeeded'))
    assert.ok(events.some(ev => ev.type === 'stage' && ev.name === 'opl-reconcile-modules' && ev.state === 'succeeded'))
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('runOplBootstrap reruns one-time initialization when required core is missing', async () => {
  const home = mkTmpHome()
  const bin = path.join(home, 'bin')
  const markerPath = path.join(home, 'userData', 'opl-startup-marker.json')
  const callsFile = path.join(home, 'calls.log')
  const missingCore = path.join(home, 'missing-core')
  fs.mkdirSync(bin, { recursive: true })
  writeFixtureOpl(bin, { initialize: [initializePayload()], callsFile })
  writeFixtureCodex(bin)
  writeOplStartupMarker(markerPath, { api_key_present: true })

  const events = []
  try {
    const result = await runOplBootstrap({
      cwd: home,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}` },
      logRoot: path.join(home, 'logs'),
      markerPath,
      requiredCorePaths: [{ path: missingCore, label: 'missing-core' }],
      onEvent: ev => events.push(ev)
    })

    assert.equal(result.ok, true)
    assert.equal(result.startupMode, 'initialized')
    assert.deepEqual(readCalls(callsFile), ['system initialize --json'])
    assert.equal(result.marker.marker_reason, 'core_missing')
    assert.deepEqual(result.marker.missing_core, ['missing-core'])
    assert.ok(events.some(ev => ev.type === 'manifest'))
    assert.ok(events.some(ev => ev.type === 'stage' && ev.name === 'opl-initialize' && ev.state === 'succeeded'))
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('runOplBootstrap does not block first launch on maintenance when gflabtoken is already configured', async () => {
  const home = mkTmpHome()
  const bin = path.join(home, 'bin')
  const callsFile = path.join(home, 'calls.log')
  fs.mkdirSync(bin, { recursive: true })
  writeFixtureOpl(bin, {
    appState: appStatePayload(),
    initialize: [initializePayload()],
    startupMaintenance: { ok: false, shouldNotRun: true },
    reconcileModules: { ok: false, shouldNotRun: true },
    callsFile
  })
  writeFixtureCodex(bin)

  const events = []
  try {
    const result = await runOplBootstrap({
      cwd: home,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}` },
      logRoot: path.join(home, 'logs'),
      onEvent: ev => events.push(ev)
    })

    assert.equal(result.ok, true)
    assert.equal(result.startupMode, 'lightweight')
    assert.equal(result.initialize, null)
    assert.equal(result.needsApiKey, false)
    assert.equal(result.maintenanceDeferred, true)
    assert.deepEqual(readCalls(callsFile), ['app state --profile fast --json'])
    assert.equal(events.some(ev => ev.name === 'opl-startup-maintenance'), false)
    assert.equal(events.some(ev => ev.name === 'opl-model-access'), false)
    assert.ok(events.some(ev => ev.type === 'complete' && ev.marker?.maintenance_deferred === true))
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('runOplBootstrap leaves API key entry to onboarding when gflabtoken is missing', async () => {
  const home = mkTmpHome()
  const bin = path.join(home, 'bin')
  const callsFile = path.join(home, 'calls.log')
  fs.mkdirSync(bin, { recursive: true })
  writeFixtureOpl(bin, {
    appState: appStatePayload({ apiKey: false }),
    initialize: [initializePayload({ apiKey: false, blockers: ['codex_config'] })],
    callsFile
  })
  writeFixtureCodex(bin)

  const events = []
  try {
    const result = await runOplBootstrap({
      cwd: home,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}` },
      logRoot: path.join(home, 'logs'),
      onEvent: ev => events.push(ev)
    })

    assert.equal(result.ok, true)
    assert.equal(result.startupMode, 'lightweight')
    assert.equal(result.initialize, null)
    assert.equal(result.needsApiKey, true)
    assert.deepEqual(readCalls(callsFile), ['app state --profile fast --json'])
    assert.equal(events.some(ev => ev.type === 'stage' && ev.name === 'opl-model-access'), false)
    assert.ok(events.some(ev => ev.type === 'route' && ev.route === 'model-access' && ev.needsApiKey === true))
    assert.ok(events.some(ev => ev.type === 'stage' && ev.name === 'opl-maintenance-schedule' && ev.state === 'skipped'))
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('runOplBootstrap fails early when Codex CLI is unavailable', async () => {
  const home = mkTmpHome()
  const bin = path.join(home, 'bin')
  fs.mkdirSync(bin, { recursive: true })
  writeFixtureOpl(bin, { initialize: [initializePayload()] })

  const events = []
  try {
    const result = await runOplBootstrap({
      cwd: home,
      env: { PATH: bin },
      logRoot: path.join(home, 'logs'),
      onEvent: ev => events.push(ev)
    })

    assert.equal(result.ok, false)
    assert.equal(result.failedStage, 'codex-cli-check')
    assert.match(result.error, /Codex CLI was not found on PATH/)
    assert.ok(events.some(ev => ev.type === 'stage' && ev.name === 'codex-cli-check' && ev.state === 'failed'))
    assert.equal(events.some(ev => ev.type === 'stage' && ev.name === 'opl-initialize'), false)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})
