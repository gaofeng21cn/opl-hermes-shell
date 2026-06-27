const { spawn } = require('node:child_process')
const { resolveRequestedPathForIpc } = require('../hardening.cjs')

function createExternalOpener({ isWsl, rememberLog, shell }) {
  return function openExternalUrl(rawUrl) {
    const raw = String(rawUrl || '').trim()
    if (!raw) return false

    let parsed
    try {
      parsed = new URL(raw)
    } catch {
      return false
    }

    if (parsed.protocol === 'file:') {
      let localPath
      try {
        localPath = resolveRequestedPathForIpc(parsed.toString(), { purpose: 'Open external file' })
      } catch {
        return false
      }

      void shell
        .openPath(localPath)
        .then(error => {
          if (!error) {
            return
          }

          rememberLog(`[file] openPath failed: ${error}; revealing in folder instead`)

          try {
            shell.showItemInFolder(localPath)
          } catch (revealError) {
            rememberLog(`[file] showItemInFolder failed: ${revealError.message}`)
          }
        })
        .catch(error => rememberLog(`[file] openPath rejected: ${error.message}`))

      return true
    }

    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
      return false
    }

    const url = parsed.toString()

    if (isWsl) {
      rememberLog(`[link] opening via WSL->Windows: ${url}`)
      const proc = spawn('cmd.exe', ['/c', 'start', '""', url], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })
      proc.on('error', error => {
        rememberLog(`[link] cmd.exe start failed: ${error.message}; falling back to xdg-open`)
        shell.openExternal(url).catch(fallback => rememberLog(`[link] xdg-open failed: ${fallback.message}`))
      })
      proc.unref()

      return true
    }

    shell.openExternal(url).catch(error => rememberLog(`[link] openExternal failed: ${error.message}`))
    return true
  }
}

module.exports = { createExternalOpener }
