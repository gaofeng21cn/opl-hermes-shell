const test = require('node:test')
const assert = require('node:assert/strict')

const {
  createWindowStateController,
  resolveNativeOverlayWidth,
  resolveWindowButtonPosition
} = require('./window-state.cjs')

const DEFAULT_BUTTON_POSITION = { x: 24, y: 10 }

test('resolveWindowButtonPosition preserves platform overlay behavior', () => {
  assert.equal(resolveWindowButtonPosition({
    defaultWindowButtonPosition: DEFAULT_BUTTON_POSITION,
    isMac: false,
    window: { getWindowButtonPosition: () => ({ x: 1, y: 2 }) }
  }), null)

  assert.deepEqual(resolveWindowButtonPosition({
    defaultWindowButtonPosition: DEFAULT_BUTTON_POSITION,
    isMac: true,
    window: { getWindowButtonPosition: () => ({ x: 1, y: 2 }) }
  }), { x: 1, y: 2 })

  assert.deepEqual(resolveWindowButtonPosition({
    defaultWindowButtonPosition: DEFAULT_BUTTON_POSITION,
    isMac: true,
    window: { getWindowButtonPosition: () => null }
  }), DEFAULT_BUTTON_POSITION)
})

test('resolveNativeOverlayWidth reserves right controls only off macOS', () => {
  assert.equal(resolveNativeOverlayWidth({ isMac: true, nativeOverlayButtonWidth: 144 }), 0)
  assert.equal(resolveNativeOverlayWidth({ isMac: false, nativeOverlayButtonWidth: 144 }), 144)
})

test('window state controller reports and broadcasts current state', () => {
  const messages = []
  const window = {
    isDestroyed: () => false,
    isFullScreen: () => true,
    webContents: {
      isDestroyed: () => false,
      send: (channel, payload) => messages.push([channel, payload])
    }
  }
  const controller = createWindowStateController({
    defaultWindowButtonPosition: DEFAULT_BUTTON_POSITION,
    getMainWindow: () => window,
    isMac: false,
    nativeOverlayButtonWidth: 144
  })

  assert.deepEqual(controller.getWindowState(), {
    isFullscreen: true,
    nativeOverlayWidth: 144,
    windowButtonPosition: null
  })

  controller.sendWindowStateChanged(false)

  assert.deepEqual(messages, [[
    'hermes:window-state-changed',
    {
      isFullscreen: false,
      nativeOverlayWidth: 144,
      windowButtonPosition: null
    }
  ]])
})

test('sendWindowStateChanged skips destroyed windows and webContents', () => {
  const controller = createWindowStateController({
    defaultWindowButtonPosition: DEFAULT_BUTTON_POSITION,
    getMainWindow: () => ({
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => true,
        send: () => {
          throw new Error('destroyed webContents should not receive state')
        }
      }
    }),
    isMac: true,
    nativeOverlayButtonWidth: 144
  })

  assert.equal(controller.sendWindowStateChanged(), undefined)
})
