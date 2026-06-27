const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  clampIntensity,
  createWindowAppearanceController,
  isHexColor,
  windowOpacityForIntensity
} = require('./window-appearance.cjs')

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-window-appearance-'))
  try {
    return fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function createController(userDataPath, overrides = {}) {
  const windows = []
  const logs = []
  const nativeTheme = { shouldUseDarkColors: true, themeSource: 'system' }
  const controller = createWindowAppearanceController({
    app: {
      getPath: name => {
        assert.equal(name, 'userData')
        return userDataPath
      }
    },
    BrowserWindow: {
      getAllWindows: () => windows
    },
    isMac: false,
    nativeTheme,
    rememberLog: message => logs.push(message),
    titlebarHeight: 34,
    ...overrides
  })

  return { controller, logs, nativeTheme, windows }
}

test('clampIntensity and windowOpacityForIntensity bound the translucency lever', () => {
  assert.equal(clampIntensity(-10), 0)
  assert.equal(clampIntensity(50.6), 51)
  assert.equal(clampIntensity(200), 100)
  assert.equal(windowOpacityForIntensity(0), 1)
  assert.equal(windowOpacityForIntensity(100), 0.30000000000000004)
})

test('isHexColor accepts six-digit colors only', () => {
  assert.equal(isHexColor('#aabbcc'), true)
  assert.equal(isHexColor('#AABBCC'), true)
  assert.equal(isHexColor('#abc'), false)
  assert.equal(isHexColor('aabbcc'), false)
})

test('window appearance reads persisted theme and applies titlebar colors', () =>
  withTempDir(userDataPath => {
    fs.writeFileSync(path.join(userDataPath, 'native-theme.json'), JSON.stringify({ themeSource: 'dark' }))
    const { controller, nativeTheme } = createController(userDataPath)

    controller.initialize()
    assert.equal(nativeTheme.themeSource, 'dark')
    assert.deepEqual(controller.getTitleBarOverlayOptions(), {
      color: '#111111',
      height: 34,
      symbolColor: '#f7f7f7'
    })

    const overlays = []
    assert.equal(controller.setTitleBarTheme({ background: '#101820', foreground: '#fefefe' }, {
      setTitleBarOverlay: overlay => overlays.push(overlay)
    }), true)
    assert.deepEqual(overlays, [{ color: '#101820', height: 34, symbolColor: '#fefefe' }])
    assert.equal(controller.getWindowBackgroundColor(), '#101820')
  }))

test('setNativeThemeSource persists valid modes only', () =>
  withTempDir(userDataPath => {
    const { controller, nativeTheme } = createController(userDataPath)

    assert.equal(controller.setNativeThemeSource('bogus'), false)
    assert.equal(nativeTheme.themeSource, 'system')

    assert.equal(controller.setNativeThemeSource('light'), true)
    assert.equal(nativeTheme.themeSource, 'light')
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(userDataPath, 'native-theme.json'), 'utf8')), {
      themeSource: 'light'
    })
  }))

test('setTranslucency persists intensity and applies opacity to live windows', () =>
  withTempDir(userDataPath => {
    const calls = []
    const { controller, windows } = createController(userDataPath)
    windows.push({ isDestroyed: () => false, setOpacity: value => calls.push(value) })

    assert.equal(controller.setTranslucency({ intensity: 50 }), true)
    assert.deepEqual(calls, [0.65])
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(userDataPath, 'translucency.json'), 'utf8')), {
      intensity: 50
    })
    assert.equal(controller.windowOpacity(), 0.65)
    assert.equal(controller.setTranslucency({ intensity: 50 }), false)
  }))
