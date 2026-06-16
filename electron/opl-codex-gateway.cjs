const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { spawn } = require('node:child_process')

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

const BRIDGE_REST_ROUTES = [
  { method: 'GET', path: '/api/status' },
  { method: 'GET', path: '/api/logs' },
  { method: 'POST', path: '/api/providers/validate' },
  { method: 'GET', path: '/api/model/options' },
  { method: 'GET', path: '/api/model/info' },
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
  return BRIDGE_REST_ROUTE_KEYS.has(routeKey(method, pathname))
}

function isOplCodexBridgeRpcMethod(method) {
  return BRIDGE_RPC_METHOD_SET.has(String(method || ''))
}

function describeOplCodexGatewayScope() {
  return {
    mode: 'executor_agent_route_bridge',
    replacesHermesBackend: false,
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

function createOplCodexGateway({ rememberLog = () => undefined } = {}) {
  const token = crypto.randomBytes(24).toString('base64url')
  const sessions = new Map()
  const sockets = new Set()
  let server = null
  let port = 0

  function log(message) {
    rememberLog(`[opl-codex] ${message}`)
  }

  function nowSeconds() {
    return Math.floor(Date.now() / 1000)
  }

  function defaultCwd() {
    return process.env.OPL_HERMES_DEFAULT_CWD || process.env.PWD || process.env.HOME || process.cwd()
  }

  function modelOptions() {
    return {
      model: 'auto',
      provider: 'codex',
      providers: [
        {
          name: 'Codex CLI',
          slug: 'codex',
          authenticated: true,
          is_current: true,
          auth_type: 'external',
          models: ['auto'],
          total_models: 1,
          capabilities: {
            auto: { fast: false, reasoning: true }
          }
        }
      ]
    }
  }

  function runtimeInfo(session) {
    return {
      cwd: session.cwd,
      branch: '',
      model: 'auto',
      provider: 'codex',
      reasoning_effort: 'auto',
      service_tier: '',
      running: session.running,
      version: 'opl-hermes-codex-candidate',
      desktop_contract: 2,
      usage: session.usage
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
      child: null
    }
    sessions.set(id, session)
    return session
  }

  function json(response, statusCode, payload) {
    response.writeHead(statusCode, {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    })
    response.end(JSON.stringify(payload))
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

  function routeApi(request, response) {
    const { pathname } = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)
    if (!isOplCodexBridgeRestRoute(request.method, pathname)) {
      unsupportedRest(response, request, pathname)
      return
    }
    if (pathname === '/api/status') {
      json(response, 200, {
        ok: true,
        active_sessions: [...sessions.values()].filter(session => session.running).length,
        config_path: path.join(defaultCwd(), '.opl-hermes-codex-config.json'),
        config_version: 1,
        env_path: path.join(defaultCwd(), '.env'),
        gateway_exit_reason: null,
        gateway_health_url: null,
        gateway_pid: process.pid,
        gateway_running: true,
        gateway_state: 'ready',
        gateway_updated_at: new Date().toISOString(),
        hermes_home: defaultCwd(),
        latest_config_version: 1,
        release_date: '2026-06-16',
        status: 'ready',
        version: 'opl-hermes-codex-candidate',
        backend: 'codex-cli-adapter',
        gateway_platforms: {}
      })
      return
    }
    if (pathname === '/api/logs') {
      json(response, 200, { file: 'desktop.log', lines: ['OPL Hermes Codex adapter is running.'] })
      return
    }
    if (pathname === '/api/providers/validate') {
      json(response, 200, {
        ok: true,
        reachable: true,
        message: 'Codex CLI is used as the fixed OPL executor.',
        models: ['auto']
      })
      return
    }
    if (pathname === '/api/model/options') {
      json(response, 200, modelOptions())
      return
    }
    if (pathname === '/api/model/info') {
      json(response, 200, {
        model: 'auto',
        provider: 'codex',
        effective_context_length: 0,
        config_context_length: 0,
        auto_context_length: 0,
        capabilities: {}
      })
      return
    }
    if (pathname === '/api/model/recommended-default') {
      json(response, 200, { provider: 'codex', model: 'auto', free_tier: null })
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
    if (!header) {
      return
    }
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
        send(socket, { jsonrpc: '2.0', id, result: { ok: true } })
        return
      }
      if (method === 'session.interrupt') {
        const session = sessions.get(String(params.session_id))
        if (session?.child) {
          session.child.kill('SIGTERM')
          session.child = null
        }
        if (session) {
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
      if (method === 'setup.status') {
        send(socket, { jsonrpc: '2.0', id, result: { provider_configured: true, provider: 'codex' } })
        return
      }
      if (method === 'setup.runtime_check') {
        send(socket, {
          jsonrpc: '2.0',
          id,
          result: {
            ok: true,
            ready: true,
            provider_configured: true,
            provider: 'codex',
            message: 'Codex CLI adapter is ready.'
          }
        })
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

  function submitPrompt(socket, session, text) {
    const userText = text.trim()
    if (!userText) return
    session.messages.push({ role: 'user', content: userText, timestamp: nowSeconds() })
    session.preview = session.preview || userText
    session.lastActive = nowSeconds()
    session.running = true
    session.usage.calls += 1
    event(socket, 'session.info', session.id, runtimeInfo(session))
    event(socket, 'message.start', session.id, { role: 'assistant' })

    const codex = spawnCodex(session.cwd, userText)
    session.child = codex.child
    if (!codex.child) {
      finishAssistant(socket, session, codex.fallback)
      return
    }

    let streamed = false
    let output = ''
    const append = chunk => {
      if (!chunk) return
      streamed = true
      output += chunk
      event(socket, 'message.delta', session.id, { text: chunk })
    }
    codex.child.stdout.on('data', chunk => append(parseCodexChunk(chunk.toString('utf8'))))
    codex.child.stderr.on('data', chunk => {
      const text = chunk.toString('utf8')
      log(text.trim())
    })
    codex.child.once('error', error => {
      finishAssistant(socket, session, `Codex CLI 启动失败：${error.message}`)
    })
    codex.child.once('exit', code => {
      if (!streamed) {
        output = code === 0
          ? 'Codex turn completed without streamed text.'
          : `Codex CLI exited with code ${code}.`
      }
      finishAssistant(socket, session, output)
    })
  }

  function spawnCodex(cwd, prompt) {
    const args = ['exec', '--json', prompt]
    try {
      const child = spawn('codex', args, {
        cwd: fs.existsSync(cwd) ? cwd : defaultCwd(),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      return { child }
    } catch (error) {
      return {
        child: null,
        fallback: `OPL Hermes candidate 已连接到 Codex CLI adapter，但启动 codex 失败：${error.message}`
      }
    }
  }

  function parseCodexChunk(raw) {
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => {
        try {
          const parsed = JSON.parse(line)
          return (
            parsed.message ||
            parsed.text ||
            parsed.delta ||
            parsed.output ||
            parsed.content ||
            ''
          )
        } catch {
          return line
        }
      })
      .filter(Boolean)
      .join('\n')
  }

  function finishAssistant(socket, session, text) {
    const content = text || 'Done.'
    session.messages.push({ role: 'assistant', content, timestamp: nowSeconds() })
    session.running = false
    session.child = null
    session.lastActive = nowSeconds()
    session.usage.output += content.length
    session.usage.total = session.usage.input + session.usage.output
    event(socket, 'message.complete', session.id, { text: content, role: 'assistant' })
    event(socket, 'session.info', session.id, runtimeInfo(session))
  }

  async function start() {
    if (server) return descriptor()
    server = http.createServer(routeApi)
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
    for (const session of sessions.values()) {
      if (session.child) session.child.kill('SIGTERM')
    }
  }

  return { start, stop }
}

module.exports = {
  createOplCodexGateway,
  describeOplCodexGatewayScope,
  isOplCodexBridgeRestRoute,
  isOplCodexBridgeRpcMethod
}
