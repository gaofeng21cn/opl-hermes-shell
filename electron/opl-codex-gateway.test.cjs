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
    assert.equal(models.providers[0].name, 'One Person Lab model access')
    assert.deepEqual(models.providers[0].models, ['gpt-5.5'])
    assert.equal(models.providers[0].models.includes('auto'), false)

    const auxiliary = await getJson(descriptor.baseUrl, '/api/model/auxiliary')
    assert.equal(auxiliary.main.model, 'gpt-5.5')
    assert.equal(auxiliary.tasks.find(task => task.task === 'vision')?.provider, 'auto')

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

test('OPL Codex gateway can answer setup status from lightweight bootstrap state', async () => {
  await withGateway(
    async descriptor => {
      const status = await getJson(descriptor.baseUrl, '/api/status')
      assert.equal(status.provider_configured, false)
      const setup = await requestRpc(descriptor.wsUrl, 'setup.status')
      assert.equal(setup.provider_configured, false)
      assert.equal(setup.startup_mode, 'lightweight')
    },
    {
      initialInitialize: null,
      initialSetup: { needsApiKey: true, startupMode: 'lightweight' },
      initializeReader: async () => {
        throw new Error('setup.status should not call full initialize during lightweight startup')
      }
    }
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
      const setup = await requestRpc(descriptor.wsUrl, 'setup.status')
      assert.equal(setup.provider_configured, true)
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

  assert.equal(scope.mode, 'codex_app_server_skill_first_adapter')
  assert.equal(scope.replacesHermesBackend, false)
  assert.equal(scope.executor, 'codex_app_server')
  assert.equal(isOplCodexBridgeRpcMethod('prompt.submit'), true)
  assert.equal(isOplCodexBridgeRpcMethod('config.get'), true)
  assert.equal(isOplCodexBridgeRpcMethod('config.set'), true)
  assert.equal(isOplCodexBridgeRpcMethod('codex.skills'), true)
  assert.equal(isOplCodexBridgeRpcMethod('purpose.route.resolve'), false)
  assert.equal(isOplCodexBridgeRpcMethod('commands.catalog'), false)
  assert.equal(isOplCodexBridgeRestRoute('GET', '/api/model/options'), true)
  assert.equal(isOplCodexBridgeRestRoute('GET', '/api/model/auxiliary'), true)
  assert.equal(isOplCodexBridgeRestRoute('GET', '/api/providers/oauth'), true)
  assert.equal(isOplCodexBridgeRestRoute('GET', '/api/profiles'), true)
  assert.equal(isOplCodexBridgeRestRoute('GET', '/api/config'), true)
  assert.equal(isOplCodexBridgeRestRoute('GET', '/api/opl/codex-skills'), true)
  assert.equal(isOplCodexBridgeRestRoute('GET', '/api/opl/purpose-routes'), false)
  assert.equal(scope.upstreamHermesBackendOwns.includes('profiles'), true)
  assert.equal(scope.upstreamHermesBackendOwns.includes('command catalog'), true)
  assert.equal(scope.codexSkills.some(skill => skill.skill_id === 'mas' && skill.invocation === '$mas'), true)
  assert.equal(scope.codexSkills.some(skill => skill.skill_id === 'mag' && skill.invocation === '$mag'), true)
  assert.equal(scope.codexSkills.some(skill => skill.skill_id === 'rca' && skill.invocation === '$rca'), true)
  assert.equal(scope.codexSkills.some(skill => skill.skill_id === 'opl'), true)
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
    assert.equal(schema.body.fields['display.personality'].category, 'display')
    assert.equal(schema.body.fields['approvals.mode'].type, 'select')
    assert.equal(schema.body.fields['memory.memory_enabled'].type, 'boolean')
    assert.equal(schema.body.fields['terminal.backend'].type, 'select')

    const cron = await requestJson(descriptor.baseUrl, '/api/cron/jobs')
    assert.equal(cron.response.status, 200)
    assert.deepEqual(cron.body, [])
  })
})

test('OPL Codex gateway exposes enough config schema for non-empty official settings sections', async () => {
  await withGateway(async descriptor => {
    const schema = await getJson(descriptor.baseUrl, '/api/config/schema')
    const fields = schema.fields

    for (const key of ['display.personality', 'timezone', 'display.show_reasoning', 'agent.image_input_mode']) {
      assert.ok(fields[key], `chat field ${key} should exist`)
    }
    for (const key of ['approvals.mode', 'security.redact_secrets', 'browser.allow_private_urls', 'checkpoints.enabled']) {
      assert.ok(fields[key], `safety field ${key} should exist`)
    }
    for (const key of ['memory.memory_enabled', 'context.engine', 'compression.enabled']) {
      assert.ok(fields[key], `memory field ${key} should exist`)
    }
    for (const key of ['toolsets', 'terminal.backend', 'agent.max_turns', 'delegation.reasoning_effort']) {
      assert.ok(fields[key], `advanced field ${key} should exist`)
    }
  })
})

test('OPL Codex gateway persists Hermes-compatible config edits during the adapter session', async () => {
  await withGateway(async descriptor => {
    const updated = await requestJson(descriptor.baseUrl, '/api/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        config: {
          display: { personality: 'technical', show_reasoning: false },
          approvals: { mode: 'smart' },
          memory: { memory_enabled: true },
          mcp_servers: {
            filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] }
          }
        }
      })
    })
    assert.equal(updated.response.status, 200)

    const config = await getJson(descriptor.baseUrl, '/api/config')
    assert.equal(config.display.personality, 'technical')
    assert.equal(config.display.show_reasoning, false)
    assert.equal(config.approvals.mode, 'smart')
    assert.equal(config.memory.memory_enabled, true)
    assert.equal(config.mcp_servers.filesystem.command, 'npx')
  })
})

test('OPL Codex gateway exposes only the gflabtoken API key in the ordinary model-access catalog', async () => {
  await withGateway(async descriptor => {
    const env = await getJson(descriptor.baseUrl, '/api/env')

    assert.deepEqual(Object.keys(env), ['OPENAI_API_KEY'])
    assert.equal(env.OPENAI_API_KEY.category, 'provider')
    assert.match(env.OPENAI_API_KEY.description, /gflabtoken/i)
    assert.equal(env.OPENAI_API_KEY.is_password, true)
    assert.equal(env.OPENAI_API_KEY.is_set, true)

    const rejected = await requestJson(descriptor.baseUrl, '/api/env', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'OPENAI_BASE_URL', value: 'https://example.invalid/v1' })
    })
    assert.equal(rejected.response.status, 400)
    assert.match(rejected.body.message, /gflabtoken API key/i)
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
    assert.equal(updated.model, 'gpt-5.5')

    const explicit = await requestRpc(descriptor.wsUrl, 'config.set', {
      key: 'model',
      value: 'gpt-5.5 --provider gflab --global'
    })
    assert.equal(explicit.model, 'gpt-5.5')
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

test('OPL Codex gateway exposes MAS/MAG/RCA as Codex skill catalog', async () => {
  const originalPath = process.env.PATH
  const originalFixtureLog = process.env.OPL_CODEX_FIXTURE_LOG
  const fixtureBin = require('node:path').join(__dirname, '..', 'scripts', 'fixtures', 'codex-bin')
  const fixtureLog = require('node:path').join(require('node:os').tmpdir(), `opl-codex-skills-${process.pid}-${Date.now()}.jsonl`)
  process.env.PATH = `${fixtureBin}${require('node:path').delimiter}${originalPath || ''}`
  process.env.OPL_CODEX_FIXTURE_LOG = fixtureLog

  try {
    await withGateway(async descriptor => {
      const catalog = await getJson(descriptor.baseUrl, '/api/opl/codex-skills')
      assert.equal(catalog.surface_kind, 'opl_hermes_codex_skill_catalog.v1')
      assert.equal(catalog.authority_boundary.uses_codex_skill_plugin_authority, true)
      assert.equal(catalog.authority_boundary.gui_executes_domain_commands, false)
      assert.equal(catalog.authority_boundary.creates_second_truth_source, false)

      const byId = new Map(catalog.skills.map(skill => [skill.skill_id, skill]))
      for (const id of ['mas', 'mag', 'rca', 'opl']) {
        assert.ok(byId.has(id), `missing ${id} skill`)
        assert.equal(byId.get(id).codex_prompt_contract.includes('Codex'), true)
      }
      assert.equal(byId.get('mas').invocation, '$mas')
      assert.equal(byId.get('mag').invocation, '$mag')
      assert.equal(byId.get('rca').invocation, '$rca')
      assert.equal(byId.get('mas').available, true)
      assert.equal(byId.get('mas').codex_skill_name, 'mas')
      assert.equal(byId.get('mas').codex_skill_path, '/fixture/codex/skills/mas/SKILL.md')
      assert.equal(byId.get('opl').available, false)
      assert.equal(byId.get('opl').codex_skill_path, null)

      const rpcCatalog = await requestRpc(descriptor.wsUrl, 'codex.skills')
      assert.equal(rpcCatalog.skills.length, catalog.skills.length)

      const legacyRest = await requestJson(descriptor.baseUrl, '/api/opl/purpose-routes')
      assert.equal(legacyRest.response.status, 501)
      const legacyRpc = await requestRpc(descriptor.wsUrl, 'purpose.route.resolve', { purpose: 'mas' }).catch(error => error)
      assert.match(String(legacyRpc.message || legacyRpc), /not full backend|official Hermes backend|unsupported/i)
    })

    const fixtureCalls = require('node:fs')
      .readFileSync(fixtureLog, 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line))
    assert.equal(fixtureCalls.some(call => call.method === 'skills/list'), true)
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

test('OPL Codex gateway exposes smoke WebSocket descriptor only when explicitly enabled', async () => {
  await withGateway(async descriptor => {
    const blocked = await requestJson(descriptor.baseUrl, '/api/smoke/connection')
    assert.equal(blocked.response.status, 404)
  })

  const previous = process.env.OPL_HERMES_SMOKE_EXPOSE_DESCRIPTOR
  process.env.OPL_HERMES_SMOKE_EXPOSE_DESCRIPTOR = '1'
  try {
    await withGateway(async descriptor => {
      const smoke = await getJson(descriptor.baseUrl, '/api/smoke/connection')
      assert.equal(smoke.surface_kind, 'opl_hermes_smoke_connection.v1')
      assert.equal(smoke.authMode, 'token')
      assert.equal(smoke.wsUrl, descriptor.wsUrl)
    })
  } finally {
    if (previous === undefined) {
      delete process.env.OPL_HERMES_SMOKE_EXPOSE_DESCRIPTOR
    } else {
      process.env.OPL_HERMES_SMOKE_EXPOSE_DESCRIPTOR = previous
    }
  }
})

test('OPL Codex gateway starts without blocking on Codex or OPL purpose route probes', async () => {
  const runOplCommand = async args => {
    throw new Error(`startup should not call OPL: ${args.join(' ')}`)
  }
  const appServerClient = {
    stop() {
      // start() should not touch the Codex app-server client.
    },
    startThread() {
      throw new Error('startup should not start Codex threads')
    }
  }

  await withGateway(
    async descriptor => {
      const status = await getJson(descriptor.baseUrl, '/api/status')
      assert.equal(status.backend, 'codex-app-server-adapter')
    },
    { appServerClient, runOplCommand }
  )
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
      assert.ok(frames.some(frame => frame.params?.type === 'tool.event'))
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
      assert.equal(fixtureCalls[1].params.sessionStartSource, 'startup')
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

test('OPL Codex gateway leaves explicit skill invocation to Codex without route receipts', async () => {
  const originalPath = process.env.PATH
  const originalFixtureLog = process.env.OPL_CODEX_FIXTURE_LOG
  const fixtureBin = require('node:path').join(__dirname, '..', 'scripts', 'fixtures', 'codex-bin')
  const fixtureLog = require('node:path').join(require('node:os').tmpdir(), `opl-codex-purpose-${process.pid}-${Date.now()}.jsonl`)
  const calls = []
  const runOplCommand = async args => {
    calls.push(args)
    throw new Error(`prompt.submit must not call OPL directly: ${args.join(' ')}`)
  }
  process.env.PATH = `${fixtureBin}${require('node:path').delimiter}${originalPath || ''}`
  process.env.OPL_CODEX_FIXTURE_LOG = fixtureLog

  try {
    await withGateway(
      async descriptor => {
        const socket = await openGatewaySocket(descriptor.wsUrl)
        const frames = []

        socket.addEventListener('message', event => {
          frames.push(JSON.parse(String(event.data)))
        })

        const session = await requestRpcOnSocket(socket, 'session.create', { purpose: 'mag' })
        await requestRpcOnSocket(socket, 'prompt.submit', {
          session_id: session.session_id,
          purpose: 'mag',
          text: '$mag 帮我准备基金申请路线'
        })

        await new Promise((resolve, reject) => {
          const started = Date.now()
          const timer = setInterval(() => {
            if (frames.some(frame => frame.params?.type === 'message.complete')) {
              clearInterval(timer)
              resolve()
            } else if (Date.now() - started > 3000) {
              clearInterval(timer)
              reject(new Error('timeout waiting for skill-first message.complete'))
            }
          }, 20)
        })

        const routeSelected = frames.find(frame => frame.params?.type === 'route.selected')
        assert.equal(routeSelected, undefined)
        const routeReceipt = frames.find(frame => frame.params?.type === 'route.receipt')
        assert.equal(routeReceipt, undefined)
        const routeError = frames.find(frame => frame.params?.type === 'route.error')
        assert.equal(routeError, undefined)

        const fixtureCalls = require('node:fs')
          .readFileSync(fixtureLog, 'utf8')
          .trim()
          .split('\n')
          .map(line => JSON.parse(line))
        const turnStart = fixtureCalls.find(call => call.method === 'turn/start')
        assert.equal(fixtureCalls.some(call => call.method === 'skills/list'), true)
        assert.deepEqual(turnStart.params.input[0], { type: 'skill', name: 'mag', path: '/fixture/codex/skills/mag/SKILL.md' })
        const promptText = turnStart.params.input[1].text
        assert.match(promptText, /\$mag 帮我准备基金申请路线/)
        assert.doesNotMatch(promptText, /OPL purpose route receipt/)
        assert.doesNotMatch(promptText, /Do not write MAG truth/)
        assert.deepEqual(calls, [])
        socket.close()
      },
      { runOplCommand }
    )
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

test('OPL Codex gateway does not auto-route ordinary Chinese research prompts to MAS', async () => {
  const originalPath = process.env.PATH
  const originalFixtureLog = process.env.OPL_CODEX_FIXTURE_LOG
  const fixtureBin = require('node:path').join(__dirname, '..', 'scripts', 'fixtures', 'codex-bin')
  const fixtureLog = require('node:path').join(require('node:os').tmpdir(), `opl-codex-mas-auto-${process.pid}-${Date.now()}.jsonl`)
  const calls = []
  const runOplCommand = async args => {
    calls.push(args)
    throw new Error(`ordinary chat must not call OPL directly: ${args.join(' ')}`)
  }
  process.env.PATH = `${fixtureBin}${require('node:path').delimiter}${originalPath || ''}`
  process.env.OPL_CODEX_FIXTURE_LOG = fixtureLog

  try {
    await withGateway(
      async descriptor => {
        const socket = await openGatewaySocket(descriptor.wsUrl)
        const frames = []

        socket.addEventListener('message', event => {
          frames.push(JSON.parse(String(event.data)))
        })

        const session = await requestRpcOnSocket(socket, 'session.create')
        await requestRpcOnSocket(socket, 'prompt.submit', {
          session_id: session.session_id,
          text: '检查 MAS 糖尿病 002、003 两篇论文的进展'
        })

        await new Promise((resolve, reject) => {
          const started = Date.now()
          const timer = setInterval(() => {
            if (frames.some(frame => frame.params?.type === 'message.complete')) {
              clearInterval(timer)
              resolve()
            } else if (Date.now() - started > 3000) {
              clearInterval(timer)
              reject(new Error('timeout waiting for non-routed message.complete'))
            }
          }, 20)
        })

        const routeReceipt = frames.find(frame => frame.params?.type === 'route.receipt')
        assert.equal(routeReceipt, undefined)
        const routeSelected = frames.find(frame => frame.params?.type === 'route.selected')
        assert.equal(routeSelected, undefined)
        const routeError = frames.find(frame => frame.params?.type === 'route.error')
        assert.equal(routeError, undefined)

        const fixtureCalls = require('node:fs')
          .readFileSync(fixtureLog, 'utf8')
          .trim()
          .split('\n')
          .map(line => JSON.parse(line))
        const turnStart = fixtureCalls.find(call => call.method === 'turn/start')
        assert.equal(fixtureCalls.some(call => call.method === 'skills/list'), false)
        assert.equal(turnStart.params.input.length, 1)
        assert.equal(turnStart.params.input[0].type, 'text')
        const promptText = turnStart.params.input[0].text
        assert.match(promptText, /检查 MAS 糖尿病 002、003 两篇论文的进展/)
        assert.doesNotMatch(promptText, /OPL purpose route receipt/)
        assert.doesNotMatch(promptText, /Do not write MAS truth/)
        assert.deepEqual(calls, [])
        socket.close()
      },
      { runOplCommand }
    )
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
