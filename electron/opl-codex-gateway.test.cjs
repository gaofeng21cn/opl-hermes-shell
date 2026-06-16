const test = require('node:test')
const assert = require('node:assert/strict')

const {
  createOplCodexGateway,
  describeOplCodexGatewayScope,
  isOplCodexBridgeRestRoute,
  isOplCodexBridgeRpcMethod
} = require('./opl-codex-gateway.cjs')

function initializeFixture(apiKeyPresent = true) {
  return {
    system_initialize: {
      setup_flow: {
        ready_to_launch: true,
        blocking_items: apiKeyPresent ? [] : ['codex_config']
      },
      core_engines: {
        codex: {
          api_key_present: apiKeyPresent,
          config_path: '/tmp/.codex/config.toml',
          default_model: 'gpt-5.5',
          default_reasoning_effort: 'xhigh',
          provider_base_url: 'https://gflabtoken.cn/v1'
        }
      },
      checklist: [
        {
          item_id: 'codex_config',
          last_attempt: {
            api_key_present: apiKeyPresent
          }
        }
      ]
    }
  }
}

async function withGateway(fn, options = {}) {
  const gateway = createOplCodexGateway({
    initialInitialize: initializeFixture(true),
    ...options
  })
  const descriptor = await gateway.start()
  try {
    await fn(descriptor)
  } finally {
    gateway.stop()
  }
}

async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`)
  assert.equal(response.ok, true, `${path} should return 2xx`)
  return response.json()
}

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options)
  return { response, body: await response.json() }
}

function requestRpc(wsUrl, method, params = {}) {
  assert.equal(typeof WebSocket, 'function', 'global WebSocket must be available')

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl)
    const id = Math.floor(Math.random() * 1_000_000)
    const timer = setTimeout(() => {
      try {
        socket.close()
      } catch {
        // ignore best-effort cleanup
      }
      reject(new Error(`timeout waiting for ${method}`))
    }, 2000)

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
    socket.addEventListener('message', event => {
      const frame = JSON.parse(String(event.data))
      if (frame.id !== id) return
      clearTimeout(timer)
      socket.close()
      if (frame.error) {
        reject(new Error(frame.error.message || `rpc ${method} failed`))
        return
      }
      resolve(frame.result)
    })
    socket.addEventListener('error', event => {
      clearTimeout(timer)
      reject(new Error(event.message || `websocket error for ${method}`))
    })
  })
}

function requestRpcOnSocket(socket, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1_000_000)
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 2000)

    const onMessage = event => {
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

async function openGatewaySocket(wsUrl) {
  assert.equal(typeof WebSocket, 'function', 'global WebSocket must be available')

  const socket = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for websocket open')), 2000)
    socket.addEventListener('open', () => {
      clearTimeout(timer)
      resolve()
    })
    socket.addEventListener('error', event => {
      clearTimeout(timer)
      reject(new Error(event.message || 'websocket error'))
    })
  })
  return socket
}

test('OPL Codex gateway returns renderer-safe startup REST shapes', async () => {
  await withGateway(async descriptor => {
    const models = await getJson(descriptor.baseUrl, '/api/model/options')
    assert.equal(Array.isArray(models.providers), true)
    assert.equal(models.providers[0].slug, 'gflab')
    assert.equal(models.providers[0].key_env, 'OPENAI_API_KEY')
    assert.equal(Array.isArray(models.providers[0].models), true)

    const oauthProviders = await getJson(descriptor.baseUrl, '/api/providers/oauth')
    assert.deepEqual(oauthProviders, { providers: [] })

    const status = await getJson(descriptor.baseUrl, '/api/status')
    assert.equal(status.backend, 'codex-app-server-adapter')
    assert.equal(status.provider_configured, true)
  })
})

test('OPL Codex gateway returns renderer-safe startup RPC shapes', async () => {
  await withGateway(async descriptor => {
    const setup = await requestRpc(descriptor.wsUrl, 'setup.status')
    assert.equal(setup.provider_configured, true)
    assert.equal(setup.provider, 'gflab')

    const runtime = await requestRpc(descriptor.wsUrl, 'setup.runtime_check')
    assert.equal(runtime.ready, true)

    const models = await requestRpc(descriptor.wsUrl, 'model.options')
    assert.equal(Array.isArray(models.providers), true)
  })
})

test('OPL Codex gateway reports missing model access key as onboarding-needed', async () => {
  await withGateway(
    async descriptor => {
      const setup = await requestRpc(descriptor.wsUrl, 'setup.status')
      assert.equal(setup.provider_configured, false)
      assert.equal(setup.ready, false)
      assert.match(setup.message, /model access/i)
    },
    { initialInitialize: initializeFixture(false) }
  )
})

test('OPL Codex gateway saves gflabtoken key through OPL configure-codex', async () => {
  const configured = []
  await withGateway(
    async descriptor => {
      const saved = await requestJson(descriptor.baseUrl, '/api/env', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'OPENAI_API_KEY', value: 'sk-gflab-test' })
      })
      assert.equal(saved.response.status, 200)
      assert.deepEqual(configured, ['sk-gflab-test'])
    },
    {
      initialInitialize: initializeFixture(false),
      configureCodex: async key => {
        configured.push(key)
        return { ok: true }
      }
    }
  )
})

test('OPL Codex gateway scope helper documents executor bridge ownership', () => {
  const scope = describeOplCodexGatewayScope()

  assert.equal(scope.mode, 'executor_agent_route_bridge')
  assert.equal(scope.replacesHermesBackend, false)
  assert.equal(scope.executor, 'codex_app_server')
  assert.equal(isOplCodexBridgeRpcMethod('prompt.submit'), true)
  assert.equal(isOplCodexBridgeRpcMethod('config.get'), true)
  assert.equal(isOplCodexBridgeRpcMethod('config.set'), true)
  assert.equal(isOplCodexBridgeRpcMethod('commands.catalog'), false)
  assert.equal(isOplCodexBridgeRestRoute('GET', '/api/model/options'), true)
  assert.equal(isOplCodexBridgeRestRoute('GET', '/api/providers/oauth'), true)
  assert.equal(isOplCodexBridgeRestRoute('GET', '/api/profiles'), true)
  assert.equal(isOplCodexBridgeRestRoute('GET', '/api/config'), true)
  assert.equal(scope.upstreamHermesBackendOwns.includes('profiles'), true)
  assert.equal(scope.upstreamHermesBackendOwns.includes('command catalog'), true)
})

test('OPL Codex gateway returns renderer-safe official UI bootstrap REST shapes', async () => {
  await withGateway(async descriptor => {
    const profiles = await requestJson(descriptor.baseUrl, '/api/profiles')
    assert.equal(profiles.response.status, 200)
    assert.equal(profiles.body.profiles[0].name, 'default')

    const active = await requestJson(descriptor.baseUrl, '/api/profiles/active')
    assert.equal(active.response.status, 200)
    assert.equal(active.body.current, 'default')

    const sessions = await requestJson(descriptor.baseUrl, '/api/profiles/sessions?limit=50&offset=0')
    assert.equal(sessions.response.status, 200)
    assert.equal(Array.isArray(sessions.body.sessions), true)
    assert.equal(sessions.body.profile_totals.default, 0)

    const config = await requestJson(descriptor.baseUrl, '/api/config')
    assert.equal(config.response.status, 200)
    assert.equal(config.body.model, 'gpt-5.5')

    const defaults = await requestJson(descriptor.baseUrl, '/api/config/defaults')
    assert.equal(defaults.response.status, 200)
    assert.equal(defaults.body.provider, 'gflab')

    const schema = await requestJson(descriptor.baseUrl, '/api/config/schema')
    assert.equal(schema.response.status, 200)
    assert.equal(schema.body.fields['agent.reasoning_effort'].type, 'select')

    const cron = await requestJson(descriptor.baseUrl, '/api/cron/jobs')
    assert.equal(cron.response.status, 200)
    assert.deepEqual(cron.body, [])
  })
})

test('OPL Codex gateway refuses non-bootstrap official Hermes backend REST endpoints instead of returning empty success', async () => {
  await withGateway(async descriptor => {
    const analytics = await requestJson(descriptor.baseUrl, '/api/analytics/usage?days=7')
    assert.equal(analytics.response.status, 501)
    assert.equal(analytics.body.name, 'GET /api/analytics/usage')
  })
})

test('OPL Codex gateway refuses official Hermes backend RPC methods instead of returning empty success', async () => {
  await withGateway(async descriptor => {
    await assert.rejects(
      () => requestRpc(descriptor.wsUrl, 'commands.catalog'),
      /opl_codex_bridge_not_full_backend|Hermes backend owns this route/
    )
    await assert.rejects(
      () => requestRpc(descriptor.wsUrl, 'complete.path', { prefix: '/tmp' }),
      /opl_codex_bridge_not_full_backend|Hermes backend owns this route/
    )
  })
})

test('OPL Codex gateway returns renderer-safe config RPC shapes', async () => {
  await withGateway(async descriptor => {
    const project = await requestRpc(descriptor.wsUrl, 'config.get', { key: 'project', cwd: '/tmp' })
    assert.equal(project.cwd, '/tmp')
    assert.equal(project.branch, '')

    const model = await requestRpc(descriptor.wsUrl, 'config.get', { key: 'model' })
    assert.equal(model.provider, 'gflab')
    assert.equal(model.model, 'gpt-5.5')

    const updated = await requestRpc(descriptor.wsUrl, 'config.set', {
      key: 'model',
      value: 'auto --provider gflab --global'
    })
    assert.equal(updated.ok, true)
    assert.equal(updated.provider, 'gflab')
    assert.equal(updated.model, 'auto')
  })
})

test('OPL Codex gateway returns renderer-safe attachment RPC shapes', async () => {
  await withGateway(async descriptor => {
    const file = await requestRpc(descriptor.wsUrl, 'file.attach', {
      path: '/tmp/report.pdf',
      name: 'report.pdf',
      session_id: 'session-1'
    })
    assert.equal(file.attached, true)
    assert.equal(file.ref_text, '@file:/tmp/report.pdf')

    const image = await requestRpc(descriptor.wsUrl, 'image.attach', {
      path: '/tmp/figure.png',
      session_id: 'session-1'
    })
    assert.equal(image.attached, true)
    assert.equal(image.path, '/tmp/figure.png')
  })
})

test('OPL Codex gateway streams message.delta text payloads', async () => {
  const originalPath = process.env.PATH
  const originalFixtureLog = process.env.OPL_CODEX_FIXTURE_LOG
  const fixtureBin = require('node:path').join(__dirname, '..', 'scripts', 'fixtures', 'codex-bin')
  const fixtureLog = require('node:path').join(require('node:os').tmpdir(), `opl-codex-fixture-${process.pid}-${Date.now()}.jsonl`)
  process.env.PATH = `${fixtureBin}${require('node:path').delimiter}${originalPath || ''}`
  process.env.OPL_CODEX_FIXTURE_LOG = fixtureLog

  try {
    await withGateway(async descriptor => {
      const socket = await openGatewaySocket(descriptor.wsUrl)
      const frames = []

      socket.addEventListener('message', event => {
        frames.push(JSON.parse(String(event.data)))
      })

      const session = await requestRpcOnSocket(socket, 'session.create')
      await requestRpcOnSocket(socket, 'prompt.submit', {
        session_id: session.session_id,
        text: 'hello'
      })

      await new Promise((resolve, reject) => {
        const started = Date.now()
        const timer = setInterval(() => {
          if (frames.some(frame => frame.params?.type === 'message.complete')) {
            clearInterval(timer)
            resolve()
          } else if (Date.now() - started > 3000) {
            clearInterval(timer)
            reject(new Error('timeout waiting for message.complete'))
          }
        }, 20)
      })

      const delta = frames.find(frame => frame.params?.type === 'message.delta')
      assert.equal(delta?.params?.payload?.text, 'fixture codex response')
      const fixtureCalls = require('node:fs')
        .readFileSync(fixtureLog, 'utf8')
        .trim()
        .split('\n')
        .map(line => JSON.parse(line))
      assert.deepEqual(
        fixtureCalls.map(call => call.method),
        ['initialize', 'thread/start', 'turn/start']
      )
      assert.equal(fixtureCalls[1].params.cwd, process.env.OPL_HERMES_DEFAULT_CWD || process.env.PWD || process.env.HOME || process.cwd())
      assert.equal(fixtureCalls[2].params.threadId, 'thread-fixture')
      socket.close()
    })
  } finally {
    process.env.PATH = originalPath
    if (originalFixtureLog === undefined) {
      delete process.env.OPL_CODEX_FIXTURE_LOG
    } else {
      process.env.OPL_CODEX_FIXTURE_LOG = originalFixtureLog
    }
    require('node:fs').rmSync(fixtureLog, { force: true })
  }
})
