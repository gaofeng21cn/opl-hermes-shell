const test = require('node:test')
const assert = require('node:assert/strict')

const { ZOOM_STORAGE_KEY, clampZoomLevel, createWindowZoomController } = require('./window-zoom.cjs')

function createWindow({ stored = null, zoomLevel = 0 } = {}) {
  const calls = []
  const handlers = {}
  const window = {
    isDestroyed: () => false,
    webContents: {
      executeJavaScript: async script => {
        calls.push(['executeJavaScript', script])
        return stored
      },
      getZoomLevel: () => zoomLevel,
      on: (eventName, handler) => {
        handlers[eventName] = handler
      },
      setZoomLevel: value => calls.push(['setZoomLevel', value])
    }
  }

  return { calls, handlers, window }
}

test('clampZoomLevel preserves existing zoom bounds', () => {
  assert.equal(clampZoomLevel(Number.NaN), 0)
  assert.equal(clampZoomLevel(-20), -9)
  assert.equal(clampZoomLevel(2.5), 2.5)
  assert.equal(clampZoomLevel(20), 9)
})

test('setAndPersistZoomLevel sets Electron zoom and mirrors to localStorage', async () => {
  const logs = []
  const { calls, window } = createWindow()
  const controller = createWindowZoomController({ isMac: false, rememberLog: message => logs.push(message) })

  controller.setAndPersistZoomLevel(window, 20)
  await Promise.resolve()

  assert.deepEqual(calls[0], ['setZoomLevel', 9])
  assert.equal(calls[1][0], 'executeJavaScript')
  assert.equal(calls[1][1].includes(JSON.stringify(ZOOM_STORAGE_KEY)), true)
  assert.equal(calls[1][1].includes('"9"'), true)
  assert.deepEqual(logs, [])
})

test('restorePersistedZoomLevel reads localStorage and reapplies stored zoom', async () => {
  const { calls, window } = createWindow({ stored: '1.25' })
  const controller = createWindowZoomController({ isMac: false, rememberLog: () => {} })

  controller.restorePersistedZoomLevel(window)
  await Promise.resolve()

  assert.deepEqual(calls.at(-1), ['setZoomLevel', 1.25])
})

test('installZoomShortcuts keeps platform modifier behavior', () => {
  const { calls, handlers, window } = createWindow({ zoomLevel: 1 })
  const controller = createWindowZoomController({ isMac: false, rememberLog: () => {} })
  controller.installZoomShortcuts(window)

  const prevented = []
  handlers['before-input-event'](
    { preventDefault: () => prevented.push(true) },
    { control: true, key: '=', alt: false, shift: false }
  )
  handlers['before-input-event'](
    { preventDefault: () => prevented.push(true) },
    { control: true, key: '-', alt: false, shift: false }
  )
  handlers['before-input-event'](
    { preventDefault: () => prevented.push(true) },
    { control: false, key: '0', alt: false, shift: false }
  )

  assert.deepEqual(prevented, [true, true])
  assert.deepEqual(
    calls.filter(call => call[0] === 'setZoomLevel'),
    [
      ['setZoomLevel', 1.1],
      ['setZoomLevel', 0.9]
    ]
  )
})
