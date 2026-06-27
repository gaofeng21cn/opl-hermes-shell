const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const DEFAULT_CLIENT_TITLE = 'One Person Lab Hermes Candidate'

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
  constructor({
    codexExecutable = resolveCodexExecutable(),
    cwd,
    log = () => undefined,
    onEvent = () => undefined,
    clientTitle = DEFAULT_CLIENT_TITLE
  } = {}) {
    this.codexExecutable = codexExecutable
    this.cwd = cwd
    this.log = log
    this.onEvent = onEvent
    this.clientTitle = clientTitle
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
          title: this.clientTitle,
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
    const activeForEvent = this.activeTurn || this.pendingTurnStart
    if (activeForEvent?.onCodexEvent) {
      activeForEvent.onCodexEvent(message.method, message.params || {}, message)
    }

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
      sessionStartSource: 'startup',
      threadSource: 'user',
      baseInstructions
    })
    return result
  }

  async listSkills({ cwd, forceReload = false } = {}) {
    await this.ensureStarted()
    return this.request('skills/list', {
      cwds: cwd ? [cwd] : [],
      forceReload
    })
  }

  async runTurn({ threadId, prompt, cwd, skills = [], onDelta, onCodexEvent }) {
    if (this.activeTurn || this.pendingTurnStart) {
      throw new Error('Codex is already running a turn')
    }
    const completion = new Promise(resolve => {
      this.pendingTurnStart = {
        resolve,
        output: '',
        threadId,
        onDelta: typeof onDelta === 'function' ? onDelta : () => undefined,
        onCodexEvent: typeof onCodexEvent === 'function' ? onCodexEvent : () => undefined
      }
    })
    const input = []
    for (const skill of skills) {
      if (!skill?.name || !skill?.path) continue
      input.push({ type: 'skill', name: String(skill.name), path: String(skill.path) })
    }
    input.push({ type: 'text', text: prompt, text_elements: [] })
    await this.request('turn/start', {
      threadId,
      input,
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

module.exports = {
  CodexAppServerClient,
  buildCodexEnvironment,
  normalizeCodexError,
  parseJsonLines,
  parseTextLines,
  resolveCodexExecutable
}
