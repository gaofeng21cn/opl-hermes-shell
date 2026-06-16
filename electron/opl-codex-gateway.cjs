const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { spawn } = require('node:child_process')

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

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

  function defaultProfile() {
    return {
      name: 'default',
      path: defaultCwd(),
      is_default: true,
      has_env: true,
      provider: 'codex',
      model: 'auto',
      skill_count: 0
    }
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

  function emptyAnalytics(days) {
    return {
      period_days: days,
      daily: [],
      by_model: [],
      skills: {
        summary: {
          distinct_skills_used: 0,
          total_skill_actions: 0,
          total_skill_edits: 0,
          total_skill_loads: 0
        },
        top_skills: []
      },
      totals: {
        total_actual_cost: 0,
        total_api_calls: 0,
        total_cache_read: 0,
        total_estimated_cost: 0,
        total_input: 0,
        total_output: 0,
        total_reasoning: 0,
        total_sessions: sessions.size
      }
    }
  }

  function actionResponse(name) {
    return { ok: true, name, pid: process.pid }
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

  function sessionRow(session) {
    return {
      id: session.storedId,
      _lineage_root_id: session.storedId,
      title: session.title,
      preview: session.preview,
      started_at: session.startedAt,
      last_active: session.lastActive,
      ended_at: session.running ? null : session.lastActive,
      archived: false,
      cwd: session.cwd,
      input_tokens: session.usage.input,
      output_tokens: session.usage.output,
      is_active: session.running,
      message_count: session.messages.length,
      model: 'auto',
      output_tokens: session.usage.output,
      source: 'opl-codex',
      tool_call_count: 0,
      profile: 'default',
      is_default_profile: true
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

  function readBody(request) {
    return new Promise(resolve => {
      let body = ''
      request.on('data', chunk => {
        body += chunk
      })
      request.on('end', () => {
        if (!body) {
          resolve({})
          return
        }
        try {
          resolve(JSON.parse(body))
        } catch {
          resolve({})
        }
      })
    })
  }

  function routeApi(request, response) {
    const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)
    const pathname = url.pathname
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
    if (pathname === '/api/env') {
      if (request.method === 'PUT' || request.method === 'DELETE') {
        json(response, 200, { ok: true })
        return
      }
      json(response, 200, {})
      return
    }
    if (pathname === '/api/env/reveal') {
      void readBody(request).then(body => {
        json(response, 200, { key: String(body.key || ''), value: '' })
      })
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
    if (pathname === '/api/providers/oauth') {
      json(response, 200, { providers: [] })
      return
    }
    if (pathname.startsWith('/api/providers/oauth/')) {
      if (pathname.includes('/poll/')) {
        const sessionId = pathname.split('/').pop() || ''
        json(response, 200, { session_id: sessionId, status: 'pending', error_message: null, expires_at: null })
        return
      }
      json(response, 200, { ok: true, provider: decodeURIComponent(pathname.split('/')[4] || 'codex') })
      return
    }
    if (pathname === '/api/config' || pathname === '/api/config/defaults') {
      if (request.method === 'PUT') {
        json(response, 200, { ok: true })
        return
      }
      json(response, 200, {
        agent: { reasoning_effort: 'auto', service_tier: '' },
        display: { language: 'zh', skin: 'opl' },
        terminal: { cwd: defaultCwd() },
        stt: { enabled: false },
        voice: { max_recording_seconds: 60 }
      })
      return
    }
    if (pathname === '/api/config/schema') {
      json(response, 200, { fields: {}, category_order: [] })
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
    if (pathname === '/api/model/set') {
      void readBody(request).then(body => {
        json(response, 200, {
          ok: true,
          provider: String(body.provider || 'codex'),
          model: String(body.model || 'auto'),
          scope: String(body.scope || 'main'),
          tasks: [],
          stale_aux: [],
          gateway_tools: []
        })
      })
      return
    }
    if (pathname === '/api/model/auxiliary') {
      json(response, 200, { main: { provider: 'codex', model: 'auto' }, tasks: [] })
      return
    }
    if (pathname === '/api/profiles/sessions' || pathname === '/api/sessions') {
      const limit = Number(url.searchParams.get('limit') || 40)
      const rows = [...sessions.values()].sort((a, b) => b.lastActive - a.lastActive).map(sessionRow)
      json(response, 200, {
        limit,
        offset: 0,
        sessions: rows.slice(0, limit),
        total: rows.length,
        profile_totals: { default: rows.length }
      })
      return
    }
    if (pathname === '/api/sessions/search') {
      json(response, 200, { results: [] })
      return
    }
    const messagesMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/)
    if (messagesMatch) {
      const session = sessions.get(decodeURIComponent(messagesMatch[1]))
      json(response, session ? 200 : 404, {
        session_id: session?.id || decodeURIComponent(messagesMatch[1]),
        messages: session?.messages || []
      })
      return
    }
    const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/)
    if (sessionMatch) {
      const session = sessions.get(decodeURIComponent(sessionMatch[1]))
      if (!session) {
        json(response, 404, { error: 'session not found' })
        return
      }
      if (request.method === 'PATCH') {
        void readBody(request).then(body => {
          if (typeof body.title === 'string' && body.title.trim()) {
            session.title = body.title.trim()
          }
          json(response, 200, { ok: true, title: session.title })
        })
        return
      }
      json(response, 200, sessionRow(session))
      return
    }
    if (pathname === '/api/cron/jobs') {
      if (request.method === 'POST') {
        void readBody(request).then(body => {
          json(response, 200, {
            id: `opl-cron-${Date.now().toString(36)}`,
            enabled: false,
            name: body.name || null,
            prompt: body.prompt || null,
            schedule: { expr: body.schedule || '', kind: 'manual', display: body.schedule || '' },
            schedule_display: body.schedule || null,
            state: 'candidate_disabled',
            next_run_at: null,
            last_run_at: null,
            last_error: null,
            deliver: body.deliver || null
          })
        })
        return
      }
      json(response, 200, [])
      return
    }
    if (pathname.startsWith('/api/cron/')) {
      json(response, 200, pathname.endsWith('/runs') ? { runs: [] } : [])
      return
    }
    if (pathname === '/api/skills') {
      if (request.method !== 'GET') {
        void readBody(request).then(body => {
          json(response, 200, { ok: true, name: String(body.name || ''), enabled: Boolean(body.enabled) })
        })
        return
      }
      json(response, 200, [])
      return
    }
    if (pathname === '/api/skills/toggle') {
      void readBody(request).then(body => {
        json(response, 200, { ok: true, name: String(body.name || ''), enabled: Boolean(body.enabled) })
      })
      return
    }
    if (pathname === '/api/tools/toolsets') {
      json(response, 200, [])
      return
    }
    const toolsetMatch = pathname.match(/^\/api\/tools\/toolsets\/([^/]+)(?:\/([^/]+))?$/)
    if (toolsetMatch) {
      const name = decodeURIComponent(toolsetMatch[1])
      const suffix = toolsetMatch[2] || ''
      if (suffix === 'config') {
        json(response, 200, { name, has_category: false, providers: [], active_provider: null })
        return
      }
      if (suffix === 'post-setup') {
        json(response, 200, { ...actionResponse(`toolset:${name}:post-setup`), key: '' })
        return
      }
      if (suffix === 'provider') {
        void readBody(request).then(body => {
          json(response, 200, { ok: true, name, provider: String(body.provider || '') })
        })
        return
      }
      void readBody(request).then(body => {
        json(response, 200, { ok: true, name, enabled: Boolean(body.enabled) })
      })
      return
    }
    if (pathname === '/api/messaging/platforms') {
      json(response, 200, { platforms: [] })
      return
    }
    const messagingMatch = pathname.match(/^\/api\/messaging\/platforms\/([^/]+)(?:\/test)?$/)
    if (messagingMatch) {
      json(response, 200, pathname.endsWith('/test')
        ? { ok: true, message: 'Candidate messaging bridge is disabled.' }
        : { ok: true, platform: decodeURIComponent(messagingMatch[1]) })
      return
    }
    if (pathname === '/api/profiles/active') {
      json(response, 200, { active: 'default', current: 'default' })
      return
    }
    if (pathname === '/api/profiles') {
      if (request.method === 'POST') {
        void readBody(request).then(body => {
          const name = String(body.name || 'default')
          json(response, 200, { ok: true, name, path: defaultCwd() })
        })
        return
      }
      json(response, 200, { profiles: [defaultProfile()] })
      return
    }
    const profileMatch = pathname.match(/^\/api\/profiles\/([^/]+)(?:\/([^/]+))?$/)
    if (profileMatch) {
      const name = decodeURIComponent(profileMatch[1])
      const suffix = profileMatch[2] || ''
      if (suffix === 'soul') {
        if (request.method === 'PUT') {
          json(response, 200, { ok: true })
          return
        }
        json(response, 200, { exists: false, content: '' })
        return
      }
      if (suffix === 'setup-command') {
        json(response, 200, { command: 'codex login' })
        return
      }
      if (request.method === 'DELETE') {
        json(response, 200, { ok: true, path: defaultCwd() })
        return
      }
      void readBody(request).then(body => {
        json(response, 200, { ok: true, name: String(body.new_name || name), path: defaultCwd() })
      })
      return
    }
    if (pathname === '/api/analytics/usage') {
      const days = Math.max(1, Number(url.searchParams.get('days') || 30))
      json(response, 200, emptyAnalytics(days))
      return
    }
    if (pathname === '/api/gateway/restart' || pathname === '/api/hermes/update') {
      json(response, 200, actionResponse(pathname.slice('/api/'.length).replace(/\//g, ':')))
      return
    }
    if (pathname === '/api/hermes/update/check') {
      json(response, 200, {
        install_method: 'candidate',
        current_version: 'opl-hermes-codex-candidate',
        behind: 0,
        update_available: false,
        can_apply: false,
        update_command: null,
        message: null,
        commits: []
      })
      return
    }
    const actionStatusMatch = pathname.match(/^\/api\/actions\/([^/]+)\/status$/)
    if (actionStatusMatch) {
      json(response, 200, {
        name: decodeURIComponent(actionStatusMatch[1]),
        pid: null,
        running: false,
        exit_code: 0,
        lines: []
      })
      return
    }
    if (pathname === '/api/audio/transcribe') {
      json(response, 200, { ok: false, provider: 'disabled', transcript: '' })
      return
    }
    if (pathname === '/api/audio/speak') {
      json(response, 200, { ok: false, provider: 'disabled', data_url: '', mime_type: 'audio/mpeg' })
      return
    }
    if (pathname === '/api/audio/elevenlabs/voices') {
      json(response, 200, { available: false, voices: [] })
      return
    }
    json(response, 200, {})
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
      if (method === 'reload.env' || method === 'reload.mcp' || method === 'config.set') {
        send(socket, { jsonrpc: '2.0', id, result: { ok: true } })
        return
      }
      if (method === 'model.options') {
        send(socket, { jsonrpc: '2.0', id, result: modelOptions() })
        return
      }
      if (method === 'commands.catalog') {
        send(socket, { jsonrpc: '2.0', id, result: { categories: [], commands: [] } })
        return
      }
      if (method === 'complete.path') {
        send(socket, { jsonrpc: '2.0', id, result: { items: [] } })
        return
      }
      if (method === 'session.cwd.set' || method === 'config.get') {
        const cwd = typeof params.cwd === 'string' && params.cwd ? params.cwd : defaultCwd()
        send(socket, { jsonrpc: '2.0', id, result: { cwd, branch: '' } })
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
      if (method === 'process.list') {
        send(socket, { jsonrpc: '2.0', id, result: { processes: [] } })
        return
      }
      if (method === 'process.kill') {
        send(socket, { jsonrpc: '2.0', id, result: { ok: true } })
        return
      }
      log(`unhandled rpc ${method}; returning candidate empty result`)
      send(socket, { jsonrpc: '2.0', id, result: { ok: true } })
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

module.exports = { createOplCodexGateway }
