const fs = require('node:fs')
const path = require('node:path')

const THEME_SOURCES = new Set(['dark', 'light', 'system'])

function clampIntensity(value) {
  const n = Math.round(Number(value))

  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0
}

function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

function windowOpacityForIntensity(intensity) {
  return 1 - (clampIntensity(intensity) / 100) * 0.7
}

function createWindowAppearanceController({
  app,
  BrowserWindow,
  isMac,
  nativeTheme,
  rememberLog,
  titlebarHeight,
  userDataPath = app.getPath('userData')
}) {
  const nativeThemeConfigPath = path.join(userDataPath, 'native-theme.json')
  const translucencyConfigPath = path.join(userDataPath, 'translucency.json')
  let rendererTitleBarTheme = null
  let translucencyIntensity = readPersistedTranslucency()

  function readPersistedThemeSource() {
    try {
      const parsed = JSON.parse(fs.readFileSync(nativeThemeConfigPath, 'utf8'))

      if (parsed && THEME_SOURCES.has(parsed.themeSource)) {
        return parsed.themeSource
      }
    } catch {
      // Missing / malformed -> follow the OS like a fresh install.
    }

    return 'system'
  }

  function writePersistedThemeSource(mode) {
    try {
      fs.mkdirSync(path.dirname(nativeThemeConfigPath), { recursive: true })
      fs.writeFileSync(nativeThemeConfigPath, JSON.stringify({ themeSource: mode }, null, 2), 'utf8')
    } catch (error) {
      rememberLog(`[theme] write native theme failed: ${error.message}`)
    }
  }

  function readPersistedTranslucency() {
    try {
      return clampIntensity(JSON.parse(fs.readFileSync(translucencyConfigPath, 'utf8')).intensity)
    } catch {
      return 0
    }
  }

  function writePersistedTranslucency(intensity) {
    try {
      fs.mkdirSync(path.dirname(translucencyConfigPath), { recursive: true })
      fs.writeFileSync(translucencyConfigPath, JSON.stringify({ intensity }, null, 2), 'utf8')
    } catch (error) {
      rememberLog(`[translucency] write failed: ${error.message}`)
    }
  }

  function initialize() {
    nativeTheme.themeSource = readPersistedThemeSource()
  }

  function windowOpacity() {
    return windowOpacityForIntensity(translucencyIntensity)
  }

  function applyWindowTranslucency(win) {
    if (!win || win.isDestroyed() || typeof win.setOpacity !== 'function') {
      return
    }

    try {
      win.setOpacity(windowOpacity())
    } catch (error) {
      rememberLog(`[translucency] apply failed: ${error.message}`)
    }
  }

  function getWindowBackgroundColor() {
    if (rendererTitleBarTheme && isHexColor(rendererTitleBarTheme.background)) {
      return rendererTitleBarTheme.background
    }

    return nativeTheme.shouldUseDarkColors ? '#111111' : '#f7f7f7'
  }

  function getTitleBarOverlayOptions() {
    if (isMac) {
      return { height: titlebarHeight }
    }

    if (rendererTitleBarTheme) {
      return {
        color: rendererTitleBarTheme.background,
        height: titlebarHeight,
        symbolColor: rendererTitleBarTheme.foreground
      }
    }

    const useDarkColors = nativeTheme.shouldUseDarkColors

    return {
      color: useDarkColors ? '#111111' : '#f7f7f7',
      height: titlebarHeight,
      symbolColor: useDarkColors ? '#f7f7f7' : '#242424'
    }
  }

  function setTitleBarTheme(payload, win) {
    if (!payload || !isHexColor(payload.background) || !isHexColor(payload.foreground)) {
      return false
    }

    rendererTitleBarTheme = {
      background: payload.background,
      foreground: payload.foreground
    }
    win?.setTitleBarOverlay?.(getTitleBarOverlayOptions())
    return true
  }

  function setNativeThemeSource(mode) {
    if (!THEME_SOURCES.has(mode)) {
      return false
    }

    if (nativeTheme.themeSource !== mode) {
      nativeTheme.themeSource = mode
      writePersistedThemeSource(mode)
    }
    return true
  }

  function setTranslucency(payload) {
    const next = clampIntensity(payload && payload.intensity)

    if (next === translucencyIntensity) {
      return false
    }

    translucencyIntensity = next
    writePersistedTranslucency(next)

    for (const win of BrowserWindow.getAllWindows()) {
      applyWindowTranslucency(win)
    }
    return true
  }

  return {
    applyWindowTranslucency,
    getTitleBarOverlayOptions,
    getWindowBackgroundColor,
    initialize,
    setNativeThemeSource,
    setTitleBarTheme,
    setTranslucency,
    windowOpacity
  }
}

module.exports = {
  THEME_SOURCES,
  clampIntensity,
  createWindowAppearanceController,
  isHexColor,
  windowOpacityForIntensity
}
