const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_FLUSH_MS = 120
const DEFAULT_BUFFER_MAX_CHARS = 64 * 1024
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024
const DEFAULT_BACKUP_COUNT = 3

function planDesktopLogRotation(
  size,
  { backupCount = DEFAULT_BACKUP_COUNT, discardBytes, logPath, maxBytes = DEFAULT_MAX_BYTES } = {}
) {
  discardBytes = discardBytes ?? maxBytes * 4

  if (size < maxBytes) return []

  const backupPath = n => `${logPath}.${n}`
  const backups = n => Array.from({ length: n }, (_, i) => backupPath(i + 1))

  if (size > discardBytes) {
    return [logPath, ...backups(backupCount)].map(p => ['rm', p])
  }

  const ops = [['rm', backupPath(backupCount)]]
  for (let i = backupCount - 1; i >= 1; i--) {
    ops.push(['mv', backupPath(i), backupPath(i + 1)])
  }
  ops.push(['mv', logPath, backupPath(1)])
  return ops
}

function createDesktopLogController({
  bufferMaxChars = DEFAULT_BUFFER_MAX_CHARS,
  flushMs = DEFAULT_FLUSH_MS,
  logPath,
  maxBytes = DEFAULT_MAX_BYTES,
  backupCount = DEFAULT_BACKUP_COUNT,
  recentLog,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
}) {
  const discardBytes = maxBytes * 4
  let buffer = ''
  let flushTimer = null
  let flushPromise = Promise.resolve()

  function rotationPlan(size) {
    return planDesktopLogRotation(size, { backupCount, discardBytes, logPath, maxBytes })
  }

  function rotateIfNeededSync() {
    let size
    try {
      size = fs.statSync(logPath).size
    } catch {
      return
    }

    for (const [op, src, dst] of rotationPlan(size)) {
      try {
        if (op === 'rm') fs.rmSync(src, { force: true })
        else fs.renameSync(src, dst)
      } catch {
        // Best-effort: logging must never block startup/shutdown.
      }
    }
  }

  async function rotateIfNeededAsync() {
    let size
    try {
      size = (await fs.promises.stat(logPath)).size
    } catch {
      return
    }

    for (const [op, src, dst] of rotationPlan(size)) {
      try {
        if (op === 'rm') await fs.promises.rm(src, { force: true })
        else await fs.promises.rename(src, dst)
      } catch {
        // Best-effort: logging must never crash the desktop shell.
      }
    }
  }

  function flushSync() {
    if (!buffer) return
    const chunk = buffer
    buffer = ''

    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true })
      rotateIfNeededSync()
      fs.appendFileSync(logPath, chunk)
    } catch {
      // Logging must never block app startup/shutdown.
    }
  }

  function flushAsync() {
    if (!buffer) return flushPromise
    const chunk = buffer
    buffer = ''

    flushPromise = flushPromise
      .then(async () => {
        await fs.promises.mkdir(path.dirname(logPath), { recursive: true })
        await rotateIfNeededAsync()
        await fs.promises.appendFile(logPath, chunk)
      })
      .catch(() => {
        // Logging must never crash the desktop shell.
      })

    return flushPromise
  }

  function scheduleFlush() {
    if (flushTimer) return
    flushTimer = setTimeoutFn(() => {
      flushTimer = null
      void flushAsync()
    }, flushMs)
  }

  function cancelScheduledFlush() {
    if (!flushTimer) return
    clearTimeoutFn(flushTimer)
    flushTimer = null
  }

  function remember(chunk) {
    const text = String(chunk || '').trim()
    if (!text) return
    const lines = text.split(/\r?\n/).map(line => `[hermes] ${line}`)
    recentLog.push(...lines)
    if (recentLog.length > 300) {
      recentLog.splice(0, recentLog.length - 300)
    }

    buffer += `${lines.join('\n')}\n`

    if (buffer.length >= bufferMaxChars) {
      cancelScheduledFlush()
      void flushAsync()
      return
    }

    scheduleFlush()
  }

  return {
    cancelScheduledFlush,
    flushSync,
    remember
  }
}

module.exports = {
  createDesktopLogController,
  planDesktopLogRotation
}
