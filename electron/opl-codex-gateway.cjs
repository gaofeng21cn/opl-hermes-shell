const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { spawn } = require('node:child_process')
const {
  apiKeyPresent,
  getSystemInitialize,
  readyToLaunch,
  runCommand,
  runOplMaintenanceStages
} = require('./opl-bootstrap-runner.cjs')

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const PRODUCT_NAME = 'One Person Lab Hermes Candidate'

const BRIDGE_REST_ROUTES = [
  { method: 'GET', path: '/api/status' },
  { method: 'GET', path: '/api/logs' },
  { method: 'GET', path: '/api/profiles/active' },
  { method: 'GET', path: '/api/profiles/sessions' },
  { method: 'GET', path: '/api/profiles' },
  { method: 'POST', path: '/api/profiles' },
  { method: 'GET', path: '/api/config' },
  { method: 'PUT', path: '/api/config' },
  { method: 'GET', path: '/api/config/defaults' },
  { method: 'GET', path: '/api/config/schema' },
  { method: 'GET', path: '/api/cron/jobs' },
  { method: 'POST', path: '/api/cron/jobs' },
  { method: 'GET', path: '/api/env' },
  { method: 'PUT', path: '/api/env' },
  { method: 'DELETE', path: '/api/env' },
  { method: 'GET', path: '/api/providers/oauth' },
  { method: 'POST', path: '/api/providers/validate' },
  { method: 'GET', path: '/api/model/options' },
  { method: 'GET', path: '/api/model/info' },
  { method: 'POST', path: '/api/model/set' },
  { method: 'GET', path: '/api/model/recommended-default' }
]

const BRIDGE_RPC_METHODS = [
  'session.create',
  'session.resume',
  'prompt.submit',
  'session.interrupt',
  'session.usage',
  'session.title',
  'session.cwd.set',
  'config.get',
  'config.set',
  'setup.status',
  'setup.runtime_check',
  'model.options',
  'file.attach',
  'image.attach',
  'image.attach_bytes'
]

const BRIDGE_REST_ROUTE_KEYS = new Set(BRIDGE_REST_ROUTES.map(route => routeKey(route.method, route.path)))
const BRIDGE_RPC_METHOD_SET = new Set(BRIDGE_RPC_METHODS)

function normalizeMethod(method) {
  return String(method || 'GET').toUpperCase()
}

function routeKey(method, pathname) {
  return `${normalizeMethod(method)} ${pathname}`
}

function isOplCodexBridgeRestRoute(method, pathname) {
  if (/^\/api\/cron\/jobs\/[^/]+(?:\/(?:runs|pause|resume|trigger))?$/.test(String(pathname || ''))) {
    return ['GET', 'PUT', 'POST', 'DELETE'].includes(normalizeMethod(method))
  }
  return BRIDGE_REST_ROUTE_KEYS.has(routeKey(method, pathname))
}

function isOplCodexBridgeRpcMethod(method) {
  return BRIDGE_RPC_METHOD_SET.has(String(method || ''))
}

function describeOplCodexGatewayScope() {
  return {
    mode: 'executor_agent_route_bridge',
    replacesHermesBackend: false,
    executor: 'codex_app_server',
    restRoutes: BRIDGE_REST_ROUTES.map(route => ({ ...route })),
    rpcMethods: [...BRIDGE_RPC_METHODS],
    upstreamHermesBackendOwns: [
      'config',
      'env',
      'oauth',
      'profiles',
      'persisted sessions',
      'session search',
      'cron',
      'skills',
      'toolsets',
      'messaging',
      'analytics',
      'Hermes update',
      'audio',
      'process catalog',
      'command catalog',
      'path completion'
    ]
  }
}

function parseJsonLines(buffer, onMessage) {
  let nextBuffer = buffer
  let newlineIndex = nextBuffer.indexOf('\n')
  while (newlineIndex >= 0) {
    const line = nextBuffer.slice(0, newlineIndex).trim()
    nextBuffer = nextBuffer.slice(newlineIndex + 1)
    if (line) onMessage(JSON.parse(line))
    newlineIndex = nextBuffer.indexOf('\n')
  }
  return nextBuffer
}

function parseTextLines(buffer, onLine) {
  let nextBuffer = buffer
  let newlineIndex = nextBuffer.indexOf('\n')
  while (newlineIndex >= 0) {
    const line = nextBuffer.slice(0, newlineIndex).trim()
    nextBuffer = nextBuffer.slice(newlineIndex + 1)
    if (line) onLine(line)
    newlineIndex = nextBuffer.indexOf('\n')
  }
  return nextBuffer
}

function normalizeCodexError(error, details = {}) {
  if (error?.message || error?.code || error?.data) {
    return {
      message: error.message ?? JSON.stringify(error),
      code: error.code ?? null,
      data: error.data ?? null,
      ...details
    }
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    code: error?.code ?? null,
    data: null,
    ...details
  }
}

function executableSearchPath(executable) {
  return [
    executable ? path.dirname(executable) : null,
    ...String(process.env.PATH || '').split(path.delimiter),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  ].filter(Boolean)
}

function buildCodexEnvironment(executable) {
  return {
    ...process.env,
    PATH: [...new Set(executableSearchPath(executable))].join(path.delimiter)
  }
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function findExecutableOnPath(command, pathValue) {
  for (const directory of String(pathValue || '').split(path.delimiter)) {
    if (!directory) continue
    const candidate = path.join(directory, command)
    if (isExecutable(candidate)) return candidate
  }
  return null
}

function resolveCodexExecutable() {
  const explicit = process.env.OPL_CODEX_BIN
  const candidates = [
    explicit,
    findExecutableOnPath('codex', process.env.PATH),
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    path.join(process.env.HOME || '', '.local', 'bin', 'codex')
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (isExecutable(candidate)) return candidate
  }

  return 'codex'
}

class CodexAppServerClient {
  constructor({ codexExecutable = resolveCodexExecutable(), cwd, log = () => undefined, onEvent = () => undefined } = {}) {
    this.codexExecutable = codexExecutable
    this.cwd = cwd
    this.log = log
    this.onEvent = onEvent
    this.child = null
    this.nextRequestId = 1
    this.stdoutBuffer = ''
    this.stderrBuffer = ''
    this.pendingRequests = new Map()
    this.pendingTurnStart = null
    this.activeTurn = null
    this.readyPromise = null
  }

  currentCwd() {
    return this.cwd || process.env.OPL_HERMES_DEFAULT_CWD || process.env.PWD || process.env.HOME || process.cwd()
  }

  ensureStarted() {
    if (!this.readyPromise) {
      this.readyPromise = this.start().catch(error => {
        this.readyPromise = null
        throw error
      })
    }
    return this.readyPromise
  }

  start() {
    return new Promise((resolve, reject) => {
      const child = spawn(this.codexExecutable, ['app-server', '--listen', 'stdio://'], {
        cwd: this.currentCwd(),
        env: buildCodexEnvironment(this.codexExecutable),
        stdio: ['pipe', 'pipe', 'pipe']
      })
      this.child = child
      this.log(`codex app-server started pid=${child.pid ?? 'unknown'}`)

      child.stdout.on('data', chunk => {
        try {
          this.stdoutBuffer = parseJsonLines(this.stdoutBuffer + chunk.toString('utf8'), message => this.handleMessage(message))
        } catch (error) {
          this.forwardError(error, 'stdout-parse')
          this.rejectActiveTurn(error)
        }
      })

      child.stderr.on('data', chunk => {
        this.stderrBuffer += chunk.toString('utf8')
        this.stderrBuffer = parseTextLines(this.stderrBuffer, line => {
          this.onEvent('codex/stderr', { line })
          this.log(line)
        })
      })

      child.once('error', error => {
        this.forwardError(error, 'process-error')
        reject(error)
        this.rejectActiveTurn(error)
      })

      child.once('close', code => {
        const error = new Error(`Codex app-server exited with ${code ?? 'unknown status'}`)
        this.log(error.message)
        this.readyPromise = null
        this.child = null
        this.rejectActiveTurn(error)
        for (const { reject: rejectRequest } of this.pendingRequests.values()) {
          rejectRequest(error)
        }
        this.pendingRequests.clear()
      })

      this.request('initialize', {
        clientInfo: {
          name: 'opl-hermes-shell',
          title: PRODUCT_NAME,
          version: '0.1.0'
        },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
          optOutNotificationMethods: []
        }
      }).then(resolve, reject)
    })
  }

  request(method, params = {}) {
    if (!this.child?.stdin?.writable) {
      return Promise.reject(new Error('Codex app-server is not running'))
    }
    const id = this.nextRequestId
    this.nextRequestId += 1
    const request = { jsonrpc: '2.0', id, method, params }
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject, method })
      this.child.stdin.write(`${JSON.stringify(request)}\n`, error => {
        if (!error) return
        this.pendingRequests.delete(id)
        if (method === 'turn/start') this.pendingTurnStart = null
        this.forwardError(error, 'request-write', { requestId: id, requestMethod: method })
        reject(error)
      })
    })
  }

  activatePendingTurn(turnId) {
    if (!this.pendingTurnStart || !turnId) return
    this.activeTurn = {
      ...this.pendingTurnStart,
      turnId
    }
    this.pendingTurnStart = null
  }

  handleMessage(message) {
    if (Object.prototype.hasOwnProperty.call(message, 'id')) {
      const pending = this.pendingRequests.get(message.id)
      if (!pending) return
      this.pendingRequests.delete(message.id)
      if (message.error) {
        if (pending.method === 'turn/start') this.pendingTurnStart = null
        const error = normalizeCodexError(message.error, { requestId: message.id, requestMethod: pending.method })
        this.forwardError(error, 'request-error')
        pending.reject(new Error(error.message))
        return
      }
      if (pending.method === 'turn/start' && this.pendingTurnStart) {
        this.activatePendingTurn(message.result?.turn?.id)
      }
      pending.resolve(message.result)
      return
    }

    if (!message.method) return
    this.onEvent(message.method, message.params || {})

    if (message.method === 'turn/started') {
      this.activatePendingTurn(message.params?.turn?.id)
      return
    }

    if (!this.activeTurn && this.pendingTurnStart && message.params?.turnId) {
      this.activatePendingTurn(message.params.turnId)
    }

    if (message.method === 'item/agentMessage/delta') {
      const delta = message.params?.delta || ''
      if (this.activeTurn && (!message.params?.turnId || message.params.turnId === this.activeTurn.turnId)) {
        this.activeTurn.output += delta
        this.activeTurn.onDelta(delta, message)
      }
      return
    }

    if (message.method === 'turn/completed') {
      const activeTurn = this.activeTurn
      if (activeTurn && (!message.params?.turn?.id || message.params.turn.id === activeTurn.turnId)) {
        this.activeTurn = null
        const turnError = message.params?.turn?.error
        const ok = message.params?.turn?.status === 'completed' && !turnError
        activeTurn.resolve({
          ok,
          output: activeTurn.output.trim(),
          error: turnError ? normalizeCodexError(turnError) : null,
          threadId: message.params?.threadId || activeTurn.threadId,
          turnId: activeTurn.turnId,
          status: message.params?.turn?.status || 'completed',
          backend: 'codex_app_server'
        })
      }
      return
    }

    if (message.method === 'error' && this.activeTurn) {
      this.rejectActiveTurn(message.params?.error || message.params || new Error('Codex app-server error'))
    }
  }

  forwardError(error, phase, details = {}) {
    const normalized = normalizeCodexError(error, details)
    this.onEvent('codex/process-error', { phase, error: normalized })
    this.log(`${phase}: ${normalized.message}`)
  }

  rejectActiveTurn(error) {
    if (!this.activeTurn) {
      if (this.pendingTurnStart) {
        const pending = this.pendingTurnStart
        this.pendingTurnStart = null
        pending.resolve({
          ok: false,
          output: pending.output.trim(),
          error: normalizeCodexError(error),
          threadId: pending.threadId,
          turnId: null,
          backend: 'codex_app_server'
        })
      }
      return
    }
    const activeTurn = this.activeTurn
    this.activeTurn = null
    activeTurn.resolve({
      ok: false,
      output: activeTurn.output.trim(),
      error: normalizeCodexError(error),
      threadId: activeTurn.threadId,
      turnId: activeTurn.turnId,
      backend: 'codex_app_server'
    })
  }

  async startThread({ cwd, baseInstructions }) {
    await this.ensureStarted()
    const result = await this.request('thread/start', {
      cwd,
      ephemeral: false,
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
      sessionStartSource: 'hermes-candidate',
      threadSource: 'user',
      baseInstructions
    })
    return result
  }

  async runTurn({ threadId, prompt, cwd, onDelta }) {
    if (this.activeTurn || this.pendingTurnStart) {
      throw new Error('Codex is already running a turn')
    }
    const completion = new Promise(resolve => {
      this.pendingTurnStart = {
        resolve,
        output: '',
        threadId,
        onDelta: typeof onDelta === 'function' ? onDelta : () => undefined
      }
    })
    await this.request('turn/start', {
      threadId,
      input: [{ type: 'text', text: prompt, text_elements: [] }],
      cwd,
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'dangerFullAccess' }
    })
    return completion
  }

  abortTurn(threadId) {
    return this.request('turn/abort', { threadId })
  }

  stop() {
    this.child?.kill('SIGTERM')
    this.child = null
    this.readyPromise = null
    this.pendingTurnStart = null
    this.activeTurn = null
    for (const { reject } of this.pendingRequests.values()) {
      reject(new Error('Codex app-server stopped'))
    }
    this.pendingRequests.clear()
  }
}

function createOplCodexGateway({
  rememberLog = () => undefined,
  initializeReader = null,
  configureCodex = null,
  initialInitialize = null,
  appServerClient = null,
  codexExecutable = null
} = {}) {
  const token = crypto.randomBytes(24).toString('base64url')
  const sessions = new Map()
  const sockets = new Set()
  let server = null
  let port = 0
  let cachedInitialize = initialInitialize
  let configuredModel = {
    provider: 'gflab',
    model: 'gpt-5.5',
    reasoning_effort: 'xhigh',
    base_url: 'https://gflabtoken.cn/v1'
  }
  let maintenancePromise = null
  let codexClient = appServerClient || null

  function log(message) {
    rememberLog(`[opl-codex] ${message}`)
  }

  function nowSeconds() {
    return Math.floor(Date.now() / 1000)
  }

  function defaultCwd() {
    return process.env.OPL_HERMES_DEFAULT_CWD || process.env.PWD || process.env.HOME || process.cwd()
  }

  function getCodexClient(cwd = defaultCwd()) {
    if (!codexClient) {
      codexClient = new CodexAppServerClient({
        codexExecutable: codexExecutable || resolveCodexExecutable(),
        cwd,
        log,
        onEvent: (method, params) => {
          log(`[app-server] ${JSON.stringify({ method, params })}`)
        }
      })
    }
    return codexClient
  }

  async function readInitialize() {
    if (typeof initializeReader === 'function') {
      cachedInitialize = await initializeReader()
      return cachedInitialize
    }
    if (cachedInitialize) return cachedInitialize

    const result = await runCommand('opl', ['system', 'initialize', '--json'], {
      cwd: defaultCwd(),
      env: process.env,
      stage: 'opl-initialize',
      emit: ev => {
        if (ev.stream === 'stderr') log(ev.line)
      },
      timeoutMs: 180_000
    })
    if (result.code !== 0) {
      const error = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`
      throw new Error(error)
    }
    cachedInitialize = JSON.parse(result.stdout)
    return cachedInitialize
  }

  async function setupSnapshot() {
    try {
      const initialize = await readInitialize()
      const system = getSystemInitialize(initialize)
      const codex = system?.core_engines?.codex || {}
      const providerConfigured = apiKeyPresent(initialize)
      const launchReady = readyToLaunch(initialize)
      const baseUrl = codex.provider_base_url || configuredModel.base_url
      const model = codex.default_model || configuredModel.model
      const reasoningEffort = codex.default_reasoning_effort || configuredModel.reasoning_effort
      configuredModel = {
        ...configuredModel,
        base_url: baseUrl,
        model,
        reasoning_effort: reasoningEffort
      }

      return {
        ok: launchReady && providerConfigured,
        ready: launchReady && providerConfigured,
        launch_ready: launchReady,
        provider_configured: providerConfigured,
        provider: 'gflab',
        model,
        reasoning_effort: reasoningEffort,
        base_url: baseUrl,
        config_path: codex.config_path || null,
        message: providerConfigured
          ? 'OPL Codex model access is configured.'
          : 'Paste an API key to configure OPL Codex model access.'
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        ready: false,
        launch_ready: false,
        provider_configured: false,
        provider: 'gflab',
        error: message,
        message
      }
    }
  }

  function modelOptions() {
    return {
      model: configuredModel.model,
      provider: configuredModel.provider,
      providers: [
        {
          name: 'OPL Model Access',
          slug: 'gflab',
          authenticated: true,
          is_current: true,
          auth_type: 'api_key',
          key_env: 'OPENAI_API_KEY',
          models: ['gpt-5.5', 'auto'],
          total_models: 2,
          capabilities: {
            'gpt-5.5': { fast: false, reasoning: true },
            auto: { fast: false, reasoning: true }
          }
        }
      ]
    }
  }

  function currentConfigRecord() {
    return {
      agent: {
        reasoning_effort: configuredModel.reasoning_effort,
        service_tier: '',
        personalities: {}
      },
      display: {
        personality: '',
        skin: 'system'
      },
      terminal: {
        cwd: defaultCwd()
      },
      stt: {
        enabled: false
      },
      voice: {
        max_recording_seconds: 60
      },
      model: configuredModel.model,
      provider: configuredModel.provider,
      providers: {
        gflab: {
          base_url: configuredModel.base_url,
          models: ['gpt-5.5', 'auto']
        }
      }
    }
  }

  function configSchema() {
    return {
      category_order: ['agent', 'display', 'terminal', 'voice'],
      fields: {
        'agent.reasoning_effort': {
          category: 'agent',
          description: 'Default Codex reasoning effort.',
          type: 'select',
          options: ['minimal', 'low', 'medium', 'high', 'xhigh']
        },
        'terminal.cwd': {
          category: 'terminal',
          description: 'Default workspace directory.',
          type: 'string'
        },
        'voice.max_recording_seconds': {
          category: 'voice',
          description: 'Maximum voice recording length.',
          type: 'number'
        },
        'stt.enabled': {
          category: 'voice',
          description: 'Speech to text is not enabled in the OPL candidate adapter.',
          type: 'boolean'
        }
      }
    }
  }

  function defaultProfile() {
    return {
      name: 'default',
      path: defaultCwd(),
      is_default: true,
      has_env: true,
      model: configuredModel.model,
      provider: configuredModel.provider,
      skill_count: 0
    }
  }

  function sessionInfoRow(session) {
    return {
      id: session.storedId || session.id,
      title: session.title || 'One Person Lab',
      preview: session.preview || null,
      cwd: session.cwd || defaultCwd(),
      started_at: session.startedAt || nowSeconds(),
      last_active: session.lastActive || session.startedAt || nowSeconds(),
      ended_at: session.running ? null : session.lastActive || session.startedAt || nowSeconds(),
      is_active: Boolean(session.running),
      message_count: Array.isArray(session.messages) ? session.messages.length : 0,
      input_tokens: session.usage?.input || 0,
      output_tokens: session.usage?.output || 0,
      tool_call_count: 0,
      model: configuredModel.model,
      source: 'desktop',
      archived: false,
      profile: 'default',
      is_default_profile: true
    }
  }

  function paginatedSessions(limit = 40, offset = 0) {
    const all = [...sessions.values()]
      .sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0))
      .map(sessionInfoRow)
    const safeOffset = Math.max(0, offset)
    const safeLimit = Math.max(0, limit)
    return {
      sessions: all.slice(safeOffset, safeOffset + safeLimit),
      limit: safeLimit,
      offset: safeOffset,
      total: all.length,
      profile_totals: { default: all.length },
      errors: []
    }
  }

  function cronJob(id = 'opl-candidate-placeholder') {
    return {
      id,
      enabled: false,
      name: 'OPL Automations',
      prompt: '',
      deliver: null,
      script: null,
      state: 'disabled',
      last_error: null,
      last_run_at: null,
      next_run_at: null,
      schedule_display: null,
      schedule: { kind: 'manual', expr: '', display: 'Managed by OPL App' }
    }
  }

  function startMaintenanceInBackground() {
    if (maintenancePromise) return maintenancePromise
    log('starting deferred OPL maintenance after credential change')
    maintenancePromise = runOplMaintenanceStages({
      cwd: defaultCwd(),
      env: process.env,
      emit: ev => {
        if (ev.type === 'stage' || ev.type === 'failed') {
          log(`[maintenance] ${JSON.stringify(ev)}`)
        }
      },
      emitOutput: false
    })
      .catch(error => {
        log(`[maintenance] ${error instanceof Error ? error.message : String(error)}`)
        return { ok: true, skipped: true }
      })
      .finally(() => {
        maintenancePromise = null
      })
    return maintenancePromise
  }

  function runtimeInfo(session) {
    return {
      cwd: session.cwd,
      branch: '',
      model: configuredModel.model,
      provider: configuredModel.provider,
      reasoning_effort: configuredModel.reasoning_effort,
      service_tier: '',
      running: session.running,
      version: 'opl-hermes-codex-candidate',
      desktop_contract: 2,
      usage: session.usage
    }
  }

  function projectConfig(params = {}) {
    const cwd = typeof params.cwd === 'string' && params.cwd.trim() ? path.resolve(params.cwd) : defaultCwd()
    return { cwd, branch: '' }
  }

  function parseModelAssignment(value) {
    const text = String(value || '').trim()
    if (!text) return null
    const providerMatch = text.match(/\s+--provider\s+(\S+)/)
    const model = text.replace(/\s+--provider\s+\S+.*$/, '').trim()
    return {
      model: model || configuredModel.model,
      provider: providerMatch?.[1] || configuredModel.provider
    }
  }

  function createSession(params = {}) {
    const id = `opl-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
    const cwd = typeof params.cwd === 'string' && params.cwd.trim() ? path.resolve(params.cwd) : defaultCwd()
    const messages = Array.isArray(params.messages)
      ? params.messages
          .map(message => ({
            role: message?.role === 'assistant' ? 'assistant' : 'user',
            content: String(message?.content || ''),
            timestamp: nowSeconds()
          }))
          .filter(message => message.content)
      : []
    const session = {
      id,
      storedId: id,
      title: typeof params.title === 'string' && params.title.trim() ? params.title.trim() : 'One Person Lab',
      preview: messages.find(message => message.role === 'user')?.content || null,
      cwd,
      startedAt: nowSeconds(),
      lastActive: nowSeconds(),
      running: false,
      messages,
      usage: { calls: 0, input: 0, output: 0, total: 0 },
      threadId: null,
      codexThread: null
    }
    sessions.set(id, session)
    return session
  }

  function baseInstructions(session) {
    return [
      '你是 One Person Lab App 内由 Codex app-server 固定承载的后台代理。',
      '保持中文、直接、专业；按用户任务推进，不解释 UI 或实现细节。',
      `Hermes session id: ${session.id}`,
      `workspace: ${session.cwd || defaultCwd()}`
    ].join('\n')
  }

  async function bindCodexThread(session) {
    if (session.threadId) return session.threadId
    const result = await getCodexClient(session.cwd).startThread({
      cwd: session.cwd || defaultCwd(),
      baseInstructions: baseInstructions(session)
    })
    session.threadId = result?.thread?.id || result?.threadId || result?.id
    session.codexThread = result
    if (!session.threadId) throw new Error('Codex app-server did not return a thread id')
    session.lastActive = nowSeconds()
    return session.threadId
  }

  function buildPrompt(text, session) {
    return [
      '用户输入：',
      text,
      '',
      `session: ${session.id}`,
      `cwd: ${session.cwd || defaultCwd()}`
    ].join('\n')
  }

  function json(response, statusCode, payload) {
    response.writeHead(statusCode, {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    })
    response.end(JSON.stringify(payload))
  }

  function readBody(request) {
    return new Promise((resolve, reject) => {
      let raw = ''
      request.on('data', chunk => {
        raw += chunk.toString('utf8')
        if (raw.length > 2 * 1024 * 1024) {
          reject(new Error('request body too large'))
          request.destroy()
        }
      })
      request.on('end', () => {
        if (!raw.trim()) {
          resolve({})
          return
        }
        try {
          resolve(JSON.parse(raw))
        } catch (error) {
          reject(error)
        }
      })
      request.on('error', reject)
    })
  }

  async function configureGflabtoken(apiKey) {
    const trimmed = String(apiKey || '').trim()
    if (!trimmed) {
      throw new Error('Enter an API key first.')
    }
    if (typeof configureCodex === 'function') {
      const result = await configureCodex(trimmed)
      cachedInitialize = null
      return result
    }
    const result = await runCommand('opl', ['system', 'configure-codex', '--api-key-stdin', '--json'], {
      cwd: defaultCwd(),
      env: process.env,
      input: trimmed,
      stage: 'opl-model-access',
      emit: ev => {
        if (ev.stream === 'stderr') log(ev.line)
      },
      timeoutMs: 120_000
    })
    if (result.code !== 0) {
      const error = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`
      throw new Error(error)
    }
    startMaintenanceInBackground()
    cachedInitialize = null
    return JSON.parse(result.stdout || '{}')
  }

  function unsupportedPayload(surface, name) {
    return {
      ok: false,
      error: 'opl_codex_bridge_not_full_backend',
      surface,
      name,
      route_owner: 'official_hermes_backend',
      bridge_mode: 'executor_agent_route_bridge',
      message: 'OPL Codex/MAS adapter only owns executor/agent bridge routes; official Hermes backend owns this route.'
    }
  }

  function unsupportedRest(response, request, pathname) {
    json(response, 501, unsupportedPayload('rest', `${normalizeMethod(request.method)} ${pathname}`))
  }

  async function routeApi(request, response) {
    const { pathname } = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)
    if (!isOplCodexBridgeRestRoute(request.method, pathname)) {
      unsupportedRest(response, request, pathname)
      return
    }
    if (pathname === '/api/status') {
      const setup = await setupSnapshot()
      json(response, 200, {
        ok: true,
        active_sessions: [...sessions.values()].filter(session => session.running).length,
        config_path: setup.config_path || path.join(defaultCwd(), '.codex', 'config.toml'),
        config_version: 1,
        env_path: path.join(defaultCwd(), '.env'),
        gateway_exit_reason: null,
        gateway_health_url: null,
        gateway_pid: process.pid,
        gateway_running: true,
        gateway_state: setup.ready ? 'ready' : 'needs_configuration',
        gateway_updated_at: new Date().toISOString(),
        hermes_home: defaultCwd(),
        latest_config_version: 1,
        release_date: '2026-06-16',
        status: setup.ready ? 'ready' : 'needs_configuration',
        version: 'opl-hermes-codex-candidate',
        backend: 'codex-app-server-adapter',
        provider_configured: setup.provider_configured,
        gateway_platforms: {}
      })
      return
    }
    if (pathname === '/api/logs') {
      json(response, 200, { file: 'desktop.log', lines: ['OPL Hermes Codex adapter is running.'] })
      return
    }
    if (pathname === '/api/profiles/active') {
      json(response, 200, { active: 'default', current: 'default' })
      return
    }
    if (pathname === '/api/profiles/sessions') {
      const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)
      json(
        response,
        200,
        paginatedSessions(
          Number(url.searchParams.get('limit') || 40),
          Number(url.searchParams.get('offset') || 0)
        )
      )
      return
    }
    if (pathname === '/api/profiles') {
      if (normalizeMethod(request.method) === 'GET') {
        json(response, 200, { profiles: [defaultProfile()] })
        return
      }
      const body = await readBody(request).catch(() => ({}))
      json(response, 200, { ok: true, name: String(body.name || 'default'), path: defaultCwd() })
      return
    }
    if (pathname === '/api/config') {
      if (normalizeMethod(request.method) === 'GET') {
        json(response, 200, currentConfigRecord())
        return
      }
      const body = await readBody(request).catch(() => ({}))
      const config = body.config || body
      if (typeof config?.agent?.reasoning_effort === 'string') {
        configuredModel = { ...configuredModel, reasoning_effort: config.agent.reasoning_effort }
      }
      if (typeof config?.model === 'string') {
        configuredModel = { ...configuredModel, model: config.model }
      }
      json(response, 200, { ok: true })
      return
    }
    if (pathname === '/api/config/defaults') {
      json(response, 200, currentConfigRecord())
      return
    }
    if (pathname === '/api/config/schema') {
      json(response, 200, configSchema())
      return
    }
    if (pathname === '/api/cron/jobs') {
      if (normalizeMethod(request.method) === 'GET') {
        json(response, 200, [])
        return
      }
      const body = await readBody(request).catch(() => ({}))
      json(response, 200, cronJob(`opl-${crypto.createHash('sha1').update(JSON.stringify(body)).digest('hex').slice(0, 8)}`))
      return
    }
    const cronMatch = pathname.match(/^\/api\/cron\/jobs\/([^/]+)(?:\/(runs|pause|resume|trigger))?$/)
    if (cronMatch) {
      const job = cronJob(decodeURIComponent(cronMatch[1]))
      if (cronMatch[2] === 'runs') {
        json(response, 200, { runs: [] })
        return
      }
      if (normalizeMethod(request.method) === 'DELETE') {
        json(response, 200, { ok: true })
        return
      }
      json(response, 200, job)
      return
    }
    if (pathname === '/api/env' && normalizeMethod(request.method) === 'GET') {
      const setup = await setupSnapshot()
      json(response, 200, {
        OPENAI_API_KEY: {
          advanced: false,
          category: 'OPL model access',
          description: 'API key used by the One Person Lab Codex app-server adapter.',
          is_password: true,
          is_set: Boolean(setup.provider_configured),
          redacted_value: setup.provider_configured ? '••••••••' : null,
          tools: ['codex'],
          url: null
        }
      })
      return
    }
    if (pathname === '/api/env' && normalizeMethod(request.method) === 'DELETE') {
      json(response, 200, { ok: true })
      return
    }
    if (pathname === '/api/env') {
      try {
        const body = await readBody(request)
        if (body?.key !== 'OPENAI_API_KEY') {
          json(response, 400, { ok: false, message: 'OPL candidate only accepts the OpenAI-compatible model access API key.' })
          return
        }
        await configureGflabtoken(body.value)
        json(response, 200, { ok: true })
      } catch (error) {
        json(response, 400, { ok: false, message: error instanceof Error ? error.message : String(error) })
      }
      return
    }
    if (pathname === '/api/providers/oauth') {
      json(response, 200, { providers: [] })
      return
    }
    if (pathname === '/api/providers/validate') {
      try {
        const body = await readBody(request)
        await configureGflabtoken(body?.value || body?.api_key)
        json(response, 200, {
          ok: true,
          reachable: true,
          message: 'Model access saved for the One Person Lab Codex adapter.',
          models: [configuredModel.model]
        })
      } catch (error) {
        json(response, 400, {
          ok: false,
          reachable: false,
          message: error instanceof Error ? error.message : String(error),
          models: []
        })
      }
      return
    }
    if (pathname === '/api/model/options') {
      json(response, 200, modelOptions())
      return
    }
    if (pathname === '/api/model/info') {
      json(response, 200, {
        model: configuredModel.model,
        provider: configuredModel.provider,
        effective_context_length: 0,
        config_context_length: 0,
        auto_context_length: 0,
        capabilities: {}
      })
      return
    }
    if (pathname === '/api/model/set') {
      const body = await readBody(request).catch(() => ({}))
      configuredModel = {
        ...configuredModel,
        provider: String(body.provider || configuredModel.provider),
        model: String(body.model || configuredModel.model)
      }
      json(response, 200, { ...configuredModel, gateway_tools: [] })
      return
    }
    if (pathname === '/api/model/recommended-default') {
      json(response, 200, { provider: configuredModel.provider, model: configuredModel.model, free_tier: null })
      return
    }
    unsupportedRest(response, request, pathname)
  }

  function send(socket, frame) {
    if (socket.destroyed) return
    const payload = Buffer.from(JSON.stringify(frame), 'utf8')
    const header = payload.length < 126
      ? Buffer.from([0x81, payload.length])
      : payload.length < 65536
        ? Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff])
        : null
    if (!header) return
    socket.write(Buffer.concat([header, payload]))
  }

  function event(socket, type, sessionId, payload = {}) {
    send(socket, {
      jsonrpc: '2.0',
      method: 'event',
      params: { type, session_id: sessionId, payload }
    })
  }

  function decodeFrame(buffer) {
    if (buffer.length < 6) return null
    const opcode = buffer[0] & 0x0f
    if (opcode === 0x8) return { close: true }
    let offset = 2
    let length = buffer[1] & 0x7f
    if (length === 126) {
      length = buffer.readUInt16BE(offset)
      offset += 2
    } else if (length === 127) {
      return null
    }
    const masked = Boolean(buffer[1] & 0x80)
    const mask = masked ? buffer.subarray(offset, offset + 4) : null
    offset += masked ? 4 : 0
    const payload = Buffer.from(buffer.subarray(offset, offset + length))
    if (mask) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4]
      }
    }
    return { text: payload.toString('utf8') }
  }

  function handleRpc(socket, frame) {
    const id = frame.id
    const params = frame.params || {}
    const method = String(frame.method || '')
    try {
      if (!isOplCodexBridgeRpcMethod(method)) {
        log(`unsupported rpc ${method}; official Hermes backend owns this route`)
        send(socket, { jsonrpc: '2.0', id, error: unsupportedPayload('rpc', method) })
        return
      }
      if (method === 'session.create') {
        const session = createSession(params)
        bindCodexThread(session)
          .then(() => {
            send(socket, {
              jsonrpc: '2.0',
              id,
              result: {
                session_id: session.id,
                stored_session_id: session.storedId,
                messages: session.messages,
                message_count: session.messages.length,
                info: runtimeInfo(session)
              }
            })
            event(socket, 'session.info', session.id, runtimeInfo(session))
          })
          .catch(error => send(socket, { jsonrpc: '2.0', id, error: { message: error instanceof Error ? error.message : String(error) } }))
        return
      }
      if (method === 'session.resume') {
        const session = sessions.get(String(params.session_id)) || createSession({ title: 'One Person Lab' })
        send(socket, {
          jsonrpc: '2.0',
          id,
          result: {
            session_id: session.id,
            resumed: session.storedId,
            messages: session.messages,
            message_count: session.messages.length,
            running: session.running,
            info: runtimeInfo(session)
          }
        })
        event(socket, 'session.info', session.id, runtimeInfo(session))
        return
      }
      if (method === 'prompt.submit') {
        const session = sessions.get(String(params.session_id))
        if (!session) throw new Error('session not found')
        submitPrompt(socket, session, String(params.text || ''))
          .then(() => send(socket, { jsonrpc: '2.0', id, result: { ok: true } }))
          .catch(error => send(socket, { jsonrpc: '2.0', id, error: { message: error instanceof Error ? error.message : String(error) } }))
        return
      }
      if (method === 'session.interrupt') {
        const session = sessions.get(String(params.session_id))
        if (session) {
          getCodexClient(session.cwd).abortTurn(session.threadId).catch(() => undefined)
          session.running = false
          event(socket, 'session.info', session.id, runtimeInfo(session))
        }
        send(socket, { jsonrpc: '2.0', id, result: { ok: true } })
        return
      }
      if (method === 'session.usage') {
        const session = sessions.get(String(params.session_id))
        send(socket, { jsonrpc: '2.0', id, result: session?.usage || { calls: 0, input: 0, output: 0, total: 0 } })
        return
      }
      if (method === 'session.title') {
        const session = sessions.get(String(params.session_id))
        if (session && typeof params.title === 'string') {
          session.title = params.title
        }
        send(socket, { jsonrpc: '2.0', id, result: { pending: false, title: session?.title || params.title || 'One Person Lab' } })
        return
      }
      if (method === 'session.cwd.set') {
        const session = sessions.get(String(params.session_id))
        const cwd = typeof params.cwd === 'string' && params.cwd ? path.resolve(params.cwd) : defaultCwd()
        if (session) {
          session.cwd = cwd
          session.lastActive = nowSeconds()
          event(socket, 'session.info', session.id, runtimeInfo(session))
        }
        send(socket, { jsonrpc: '2.0', id, result: { cwd, branch: '' } })
        return
      }
      if (method === 'config.get') {
        if (params.key === 'project') {
          send(socket, { jsonrpc: '2.0', id, result: projectConfig(params) })
          return
        }
        if (params.key === 'model') {
          send(socket, { jsonrpc: '2.0', id, result: { model: configuredModel.model, provider: configuredModel.provider } })
          return
        }
        send(socket, { jsonrpc: '2.0', id, result: currentConfigRecord() })
        return
      }
      if (method === 'config.set') {
        if (params.key === 'model') {
          const assignment = parseModelAssignment(params.value)
          if (assignment) {
            configuredModel = { ...configuredModel, ...assignment }
          }
        }
        send(socket, { jsonrpc: '2.0', id, result: { ok: true, ...projectConfig(params), model: configuredModel.model, provider: configuredModel.provider } })
        return
      }
      if (method === 'setup.status' || method === 'setup.runtime_check') {
        setupSnapshot()
          .then(result => send(socket, { jsonrpc: '2.0', id, result }))
          .catch(error => send(socket, { jsonrpc: '2.0', id, error: { message: error.message } }))
        return
      }
      if (method === 'model.options') {
        send(socket, { jsonrpc: '2.0', id, result: modelOptions() })
        return
      }
      if (method === 'file.attach') {
        const refPath = String(params.path || params.name || 'attachment')
        send(socket, {
          jsonrpc: '2.0',
          id,
          result: {
            attached: true,
            path: refPath,
            ref_path: refPath,
            ref_text: `@file:${refPath}`,
            uploaded: Boolean(params.data_url),
            name: String(params.name || path.basename(refPath))
          }
        })
        return
      }
      if (method === 'image.attach' || method === 'image.attach_bytes') {
        const imagePath = String(params.path || params.filename || 'image')
        send(socket, {
          jsonrpc: '2.0',
          id,
          result: {
            attached: true,
            path: imagePath,
            name: String(params.filename || path.basename(imagePath)),
            bytes: typeof params.content_base64 === 'string' ? Buffer.byteLength(params.content_base64, 'base64') : 0
          }
        })
        return
      }
      log(`bridge-owned rpc ${method} has no handler`)
      send(socket, { jsonrpc: '2.0', id, error: { message: `bridge-owned rpc ${method} has no handler` } })
    } catch (error) {
      send(socket, { jsonrpc: '2.0', id, error: { message: error instanceof Error ? error.message : String(error) } })
    }
  }

  async function submitPrompt(socket, session, text) {
    const userText = text.trim()
    if (!userText) return
    if (session.running) throw new Error('session already has a running turn')
    const threadId = await bindCodexThread(session)
    session.messages.push({ role: 'user', content: userText, timestamp: nowSeconds() })
    session.preview = session.preview || userText
    session.lastActive = nowSeconds()
    session.running = true
    session.usage.calls += 1
    session.usage.input += userText.length
    session.usage.total = session.usage.input + session.usage.output
    event(socket, 'session.info', session.id, runtimeInfo(session))
    event(socket, 'message.start', session.id, { role: 'assistant' })

    const result = await getCodexClient(session.cwd).runTurn({
      threadId,
      prompt: buildPrompt(userText, session),
      cwd: session.cwd || defaultCwd(),
      onDelta: chunk => {
        if (!chunk) return
        session.usage.output += chunk.length
        session.usage.total = session.usage.input + session.usage.output
        event(socket, 'message.delta', session.id, { text: chunk })
      }
    })
    if (!result.ok && result.error) {
      const message = result.output || result.error.message || 'Codex app-server turn failed.'
      finishAssistant(socket, session, message)
      return
    }
    finishAssistant(socket, session, result.output || 'Done.')
  }

  function finishAssistant(socket, session, text) {
    const content = text || 'Done.'
    session.messages.push({ role: 'assistant', content, timestamp: nowSeconds() })
    session.running = false
    session.lastActive = nowSeconds()
    session.usage.output += content.length
    session.usage.total = session.usage.input + session.usage.output
    event(socket, 'message.complete', session.id, { text: content, role: 'assistant' })
    event(socket, 'session.info', session.id, runtimeInfo(session))
  }

  async function start() {
    if (server) return descriptor()
    server = http.createServer((request, response) => {
      routeApi(request, response).catch(error => {
        json(response, 500, { ok: false, message: error instanceof Error ? error.message : String(error) })
      })
    })
    server.on('upgrade', (request, socket) => {
      const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)
      if (url.pathname !== '/api/ws' || url.searchParams.get('token') !== token) {
        socket.destroy()
        return
      }
      const key = request.headers['sec-websocket-key']
      if (!key) {
        socket.destroy()
        return
      }
      const accept = crypto.createHash('sha1').update(`${key}${WS_GUID}`).digest('base64')
      socket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        ''
      ].join('\r\n'))
      sockets.add(socket)
      socket.on('error', error => {
        sockets.delete(socket)
        log(`websocket error: ${error.message}`)
      })
      socket.on('data', buffer => {
        const decoded = decodeFrame(buffer)
        if (decoded?.close) {
          socket.end()
          return
        }
        if (!decoded?.text) return
        try {
          handleRpc(socket, JSON.parse(decoded.text))
        } catch {
          // Ignore malformed frames from candidate smoke tooling.
        }
      })
      socket.on('close', () => sockets.delete(socket))
      event(socket, 'gateway.ready', null, { backend: 'opl-codex', skin: 'one-person-lab' })
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    port = server.address().port
    log(`gateway listening on 127.0.0.1:${port}`)
    return descriptor()
  }

  function descriptor() {
    const baseUrl = `http://127.0.0.1:${port}`
    return {
      baseUrl,
      mode: 'local',
      source: 'opl-codex-adapter',
      authMode: 'token',
      token,
      profile: 'default',
      wsUrl: `ws://127.0.0.1:${port}/api/ws?token=${encodeURIComponent(token)}`,
      logs: ['OPL Hermes Codex adapter is ready.']
    }
  }

  function stop() {
    for (const socket of sockets) socket.destroy()
    sockets.clear()
    if (server) {
      server.close()
      server = null
    }
    codexClient?.stop?.()
  }

  return { start, stop }
}

module.exports = {
  CodexAppServerClient,
  createOplCodexGateway,
  describeOplCodexGatewayScope,
  isOplCodexBridgeRestRoute,
  isOplCodexBridgeRpcMethod
}
