const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  apiKeyPresent,
  hasOnlyApiKeyBlocker,
  readyToLaunch,
  runOplBootstrap
} = require('./opl-bootstrap-runner.cjs')

function mkTmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opl-bootstrap-test-'))
}

function writeFixtureOpl(binDir, payloads) {
  const script = path.join(binDir, 'opl')
  fs.writeFileSync(
    script,
    `#!${process.execPath}
const payloads = ${JSON.stringify(payloads)}
const args = process.argv.slice(2)
const key = args.join(' ')
if (key === 'system initialize --json') {
  console.log(JSON.stringify(payloads.initialize.shift()))
  process.exit(0)
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

test('initialize helpers read OPL first-run truth fields', () => {
  const payload = initializePayload({ ready: true, apiKey: false, blockers: ['codex_config'] })
  assert.equal(readyToLaunch(payload), true)
  assert.equal(apiKeyPresent(payload), false)
  assert.equal(hasOnlyApiKeyBlocker(payload), true)
})

test('runOplBootstrap calls OPL initialize and does not require Hermes installer state', async () => {
  const home = mkTmpHome()
  const bin = path.join(home, 'bin')
  fs.mkdirSync(bin, { recursive: true })
  writeFixtureOpl(bin, { initialize: [initializePayload()] })
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
    assert.equal(result.needsApiKey, false)
    assert.equal(result.maintenanceDeferred, true)
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
        ['opl-model-access', 'Check model access'],
        ['opl-codex-adapter', 'Prepare Codex desktop adapter'],
        ['opl-maintenance-schedule', 'Schedule background maintenance']
      ]
    )
    assert.ok(events.some(ev => ev.type === 'stage' && ev.name === 'opl-cli-check' && ev.state === 'succeeded'))
    assert.ok(events.some(ev => ev.type === 'stage' && ev.name === 'codex-cli-check' && ev.state === 'succeeded'))
    assert.ok(events.some(ev => ev.type === 'stage' && ev.name === 'opl-initialize' && ev.state === 'succeeded'))
    assert.ok(events.some(ev => ev.type === 'stage' && ev.name === 'opl-core-setup' && ev.state === 'skipped'))
    assert.ok(events.some(ev => ev.type === 'stage' && ev.name === 'opl-post-setup-check' && ev.state === 'skipped'))
    assert.ok(events.some(ev => ev.type === 'stage' && ev.name === 'opl-model-access' && ev.state === 'succeeded'))
    assert.ok(events.some(ev => ev.type === 'stage' && ev.name === 'opl-codex-adapter' && ev.state === 'succeeded'))
    assert.ok(events.some(ev => ev.type === 'stage' && ev.name === 'opl-maintenance-schedule' && ev.state === 'succeeded'))
    assert.equal(events.some(ev => ev.type === 'stage' && ev.name === 'opl-startup-maintenance'), false)
    assert.equal(events.some(ev => /install\.sh|install\.ps1|Hermes Agent/.test(JSON.stringify(ev))), false)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('runOplBootstrap does not block first launch on maintenance when gflabtoken is already configured', async () => {
  const home = mkTmpHome()
  const bin = path.join(home, 'bin')
  fs.mkdirSync(bin, { recursive: true })
  writeFixtureOpl(bin, {
    initialize: [initializePayload()],
    startupMaintenance: { ok: false, shouldNotRun: true },
    reconcileModules: { ok: false, shouldNotRun: true }
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
    assert.equal(result.needsApiKey, false)
    assert.equal(result.maintenanceDeferred, true)
    assert.equal(events.some(ev => ev.name === 'opl-startup-maintenance'), false)
    assert.ok(events.some(ev => ev.name === 'opl-model-access' && ev.state === 'succeeded'))
    assert.ok(events.some(ev => ev.type === 'complete' && ev.marker?.maintenance_deferred === true))
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('runOplBootstrap leaves API key entry to onboarding when gflabtoken is missing', async () => {
  const home = mkTmpHome()
  const bin = path.join(home, 'bin')
  fs.mkdirSync(bin, { recursive: true })
  writeFixtureOpl(bin, { initialize: [initializePayload({ apiKey: false, blockers: ['codex_config'] })] })
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
    assert.equal(result.needsApiKey, true)
    assert.ok(events.some(ev => ev.type === 'stage' && ev.name === 'opl-model-access' && ev.state === 'skipped'))
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
