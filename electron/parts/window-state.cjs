function resolveWindowButtonPosition({ defaultWindowButtonPosition, isMac, window }) {
  if (!isMac) return null
  return window?.getWindowButtonPosition?.() || defaultWindowButtonPosition
}

function resolveNativeOverlayWidth({ isMac, nativeOverlayButtonWidth }) {
  return isMac ? 0 : nativeOverlayButtonWidth
}

function createWindowStateController({
  defaultWindowButtonPosition,
  getMainWindow,
  isMac,
  nativeOverlayButtonWidth
}) {
  function getWindowButtonPosition() {
    return resolveWindowButtonPosition({
      defaultWindowButtonPosition,
      isMac,
      window: getMainWindow()
    })
  }

  function getNativeOverlayWidth() {
    return resolveNativeOverlayWidth({ isMac, nativeOverlayButtonWidth })
  }

  function getWindowState() {
    const window = getMainWindow()
    return {
      isFullscreen: Boolean(window?.isFullScreen?.()),
      nativeOverlayWidth: getNativeOverlayWidth(),
      windowButtonPosition: getWindowButtonPosition()
    }
  }

  function sendWindowStateChanged(nextIsFullscreen) {
    const window = getMainWindow()
    if (!window || window.isDestroyed()) return
    const { webContents } = window
    if (!webContents || webContents.isDestroyed()) return
    const state = getWindowState()

    if (typeof nextIsFullscreen === 'boolean') {
      state.isFullscreen = nextIsFullscreen
    }

    webContents.send('hermes:window-state-changed', state)
  }

  return {
    getNativeOverlayWidth,
    getWindowButtonPosition,
    getWindowState,
    sendWindowStateChanged
  }
}

module.exports = {
  createWindowStateController,
  resolveNativeOverlayWidth,
  resolveWindowButtonPosition
}
