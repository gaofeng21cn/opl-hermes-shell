const test = require('node:test')
const assert = require('node:assert/strict')

const { createOplCodexGateway } = require('./opl-codex-gateway.cjs')

async function withGateway(fn) {
  const gateway = createOplCodexGateway()
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
    const activeProfile = await getJson(descriptor.baseUrl, '/api/profiles/active')
    assert.deepEqual(activeProfile, { active: 'default', current: 'default' })

    const profiles = await getJson(descriptor.baseUrl, '/api/profiles')
    assert.equal(Array.isArray(profiles.profiles), true)
    assert.equal(profiles.profiles[0].name, 'default')

    const oauth = await getJson(descriptor.baseUrl, '/api/providers/oauth')
    assert.deepEqual(oauth, { providers: [] })

    const models = await getJson(descriptor.baseUrl, '/api/model/options')
    assert.equal(Array.isArray(models.providers), true)
    assert.equal(models.providers[0].slug, 'codex')
    assert.equal(Array.isArray(models.providers[0].models), true)

    const analytics = await getJson(descriptor.baseUrl, '/api/analytics/usage?days=7')
    assert.equal(Array.isArray(analytics.daily), true)
    assert.equal(Array.isArray(analytics.by_model), true)
    assert.equal(Array.isArray(analytics.skills.top_skills), true)
  })
})

test('OPL Codex gateway returns renderer-safe startup RPC shapes', async () => {
  await withGateway(async descriptor => {
    const setup = await requestRpc(descriptor.wsUrl, 'setup.status')
    assert.equal(setup.provider_configured, true)

    const runtime = await requestRpc(descriptor.wsUrl, 'setup.runtime_check')
    assert.equal(runtime.ready, true)

    const models = await requestRpc(descriptor.wsUrl, 'model.options')
    assert.equal(Array.isArray(models.providers), true)

    const commands = await requestRpc(descriptor.wsUrl, 'commands.catalog')
    assert.equal(Array.isArray(commands.commands), true)
    assert.equal(Array.isArray(commands.categories), true)
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
  const fixtureBin = require('node:path').join(__dirname, '..', 'scripts', 'fixtures', 'codex-bin')
  process.env.PATH = `${fixtureBin}${require('node:path').delimiter}${originalPath || ''}`

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
      socket.close()
    })
  } finally {
    process.env.PATH = originalPath
  }
})
