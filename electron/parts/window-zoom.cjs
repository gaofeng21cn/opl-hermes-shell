const ZOOM_STORAGE_KEY = 'hermes:desktop:zoomLevel'

function clampZoomLevel(value) {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, -9), 9)
}

function createWindowZoomController({ isMac, rememberLog }) {
  function setAndPersistZoomLevel(window, zoomLevel) {
    if (!window || window.isDestroyed()) return
    const next = clampZoomLevel(zoomLevel)
    window.webContents.setZoomLevel(next)
    window.webContents
      .executeJavaScript(
        `try { localStorage.setItem(${JSON.stringify(ZOOM_STORAGE_KEY)}, ${JSON.stringify(String(next))}) } catch {}`
      )
      .catch(error => rememberLog(`[zoom] persist failed: ${error?.message || error}`))
  }

  function restorePersistedZoomLevel(window) {
    if (!window || window.isDestroyed()) return
    window.webContents
      .executeJavaScript(
        `(() => { try { return localStorage.getItem(${JSON.stringify(ZOOM_STORAGE_KEY)}) } catch { return null } })()`
      )
      .then(stored => {
        if (stored == null || !window || window.isDestroyed()) return
        const level = clampZoomLevel(Number(stored))
        window.webContents.setZoomLevel(level)
      })
      .catch(error => rememberLog(`[zoom] restore failed: ${error?.message || error}`))
  }

  function installZoomShortcuts(window) {
    // Override Ctrl/Cmd + +/-/0 with half the default zoom step (0.1 vs 0.2).
    // The menu items handle this on macOS (where the menu is always present),
    // but on Linux/Windows the menu is null and Chromium's default handler
    // would use the full 0.2 step, so we intercept here for consistency.
    const ZOOM_STEP = 0.1
    window.webContents.on('before-input-event', (event, input) => {
      const mod = isMac ? input.meta : input.control
      if (!mod || input.alt || input.shift) return

      const key = input.key
      if (key === '0') {
        event.preventDefault()
        setAndPersistZoomLevel(window, 0)
      } else if (key === '=' || key === '+') {
        event.preventDefault()
        setAndPersistZoomLevel(window, window.webContents.getZoomLevel() + ZOOM_STEP)
      } else if (key === '-') {
        event.preventDefault()
        setAndPersistZoomLevel(window, window.webContents.getZoomLevel() - ZOOM_STEP)
      }
    })
  }

  return {
    installZoomShortcuts,
    restorePersistedZoomLevel,
    setAndPersistZoomLevel
  }
}

module.exports = {
  ZOOM_STORAGE_KEY,
  clampZoomLevel,
  createWindowZoomController
}
