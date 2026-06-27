const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const https = require('node:https')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const {
  DATA_URL_READ_MAX_BYTES,
  TEXT_PREVIEW_SOURCE_MAX_BYTES,
  resolveReadableFileForIpc,
  resolveRequestedPathForIpc
} = require('../hardening.cjs')

const MEDIA_MIME_TYPES = {
  '.avi': 'video/x-msvideo',
  '.bmp': 'image/bmp',
  '.flac': 'audio/flac',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.m4a': 'audio/mp4',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg; codecs=opus',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp'
}

const PREVIEW_HTML_EXTENSIONS = new Set(['.html', '.htm'])
const PREVIEW_WATCH_DEBOUNCE_MS = 120
const LOCAL_PREVIEW_HOSTS = new Set(['0.0.0.0', '127.0.0.1', '::1', '[::1]', 'localhost'])
const TEXT_PREVIEW_MAX_BYTES = 512 * 1024
const PREVIEW_LANGUAGE_BY_EXT = {
  '.c': 'c',
  '.conf': 'ini',
  '.cpp': 'cpp',
  '.css': 'css',
  '.csv': 'csv',
  '.go': 'go',
  '.graphql': 'graphql',
  '.h': 'c',
  '.hpp': 'cpp',
  '.html': 'html',
  '.java': 'java',
  '.js': 'javascript',
  '.json': 'json',
  '.jsx': 'jsx',
  '.kt': 'kotlin',
  '.lua': 'lua',
  '.md': 'markdown',
  '.mjs': 'javascript',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.sh': 'shell',
  '.sql': 'sql',
  '.svg': 'xml',
  '.toml': 'toml',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.txt': 'text',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.zsh': 'shell'
}

const MEDIA_PROTOCOL = 'hermes-media'
const STREAMABLE_MEDIA_EXTS = new Set([
  '.avi',
  '.flac',
  '.m4a',
  '.mkv',
  '.mov',
  '.mp3',
  '.mp4',
  '.ogg',
  '.opus',
  '.wav',
  '.webm'
])

function looksBinary(buffer) {
  if (!buffer.length) return false

  let suspicious = 0

  for (const byte of buffer) {
    if (byte === 0) return true
    // Allow common whitespace controls: tab, LF, CR.
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) suspicious += 1
  }

  return suspicious / buffer.length > 0.12
}

function previewFileMetadata(filePath, mimeType) {
  let byteSize = 0
  let binary = false

  try {
    const stat = fs.statSync(filePath)
    byteSize = stat.size

    if (!mimeType.startsWith('image/')) {
      const fd = fs.openSync(filePath, 'r')

      try {
        const sample = Buffer.alloc(Math.min(byteSize, 4096))
        const bytesRead = fs.readSync(fd, sample, 0, sample.length, 0)
        binary = looksBinary(sample.subarray(0, bytesRead))
      } finally {
        fs.closeSync(fd)
      }
    }
  } catch {
    // Metadata is best-effort; the read handlers surface hard errors later.
  }

  return {
    binary,
    byteSize,
    large: byteSize > TEXT_PREVIEW_MAX_BYTES
  }
}

function mimeTypeForPath(filePath) {
  const ext = path.extname(filePath || '').toLowerCase()

  return MEDIA_MIME_TYPES[ext] || 'application/octet-stream'
}

function extensionForMimeType(mimeType) {
  const type = String(mimeType || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (type === 'image/png') return '.png'
  if (type === 'image/jpeg') return '.jpg'
  if (type === 'image/gif') return '.gif'
  if (type === 'image/webp') return '.webp'
  if (type === 'image/bmp') return '.bmp'
  if (type === 'image/svg+xml') return '.svg'
  return ''
}

function filenameFromUrl(rawUrl, fallback = 'image') {
  try {
    const parsed = new URL(rawUrl)
    const base = path.basename(decodeURIComponent(parsed.pathname || ''))
    return base && base.includes('.') ? base : fallback
  } catch {
    return fallback
  }
}

function previewLabelForUrl(url) {
  return `${url.host}${url.pathname === '/' ? '' : url.pathname}`
}

function previewUrlTarget(rawTarget) {
  const raw = String(rawTarget || '').trim()
  const url = new URL(raw)

  if (!['http:', 'https:'].includes(url.protocol)) {
    return null
  }

  if (!LOCAL_PREVIEW_HOSTS.has(url.hostname.toLowerCase())) {
    return null
  }

  if (url.hostname === '0.0.0.0') {
    url.hostname = '127.0.0.1'
  }

  return {
    kind: 'url',
    label: previewLabelForUrl(url),
    source: raw,
    url: url.toString()
  }
}

function createMediaPreviewController({
  app,
  clipboard,
  dialog,
  electronNet,
  getMainWindow,
  nativeImage,
  protocol,
  directoryExists,
  fileExists,
  resolveDefaultPreviewCwd
}) {
  const previewWatchers = new Map()

  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_PROTOCOL,
      privileges: {
        secure: true,
        standard: true,
        stream: true,
        supportFetchAPI: true
      }
    }
  ])

  function expandUserPath(filePath) {
    const value = String(filePath || '').trim()

    if (value === '~') {
      return app.getPath('home')
    }

    if (value.startsWith(`~${path.sep}`) || value.startsWith('~/')) {
      return path.join(app.getPath('home'), value.slice(2))
    }

    return value
  }

  function registerMediaProtocol() {
    protocol.handle(MEDIA_PROTOCOL, async request => {
      let resolvedPath
      try {
        const url = new URL(request.url)
        const filePath = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
        ;({ resolvedPath } = await resolveReadableFileForIpc(filePath, { purpose: 'Media stream' }))
      } catch {
        return new Response('Media not found', { status: 404 })
      }

      if (!STREAMABLE_MEDIA_EXTS.has(path.extname(resolvedPath).toLowerCase())) {
        return new Response('Unsupported media type', { status: 415 })
      }

      return electronNet.fetch(pathToFileURL(resolvedPath).toString(), {
        bypassCustomProtocolHandlers: true,
        headers: request.headers
      })
    })
  }

  async function resourceBufferFromUrl(rawUrl) {
    if (!rawUrl) throw new Error('Missing URL')
    if (rawUrl.startsWith('data:')) {
      const match = rawUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s)
      if (!match) throw new Error('Invalid data URL')
      const mimeType = match[1] || 'application/octet-stream'
      const encoded = match[3] || ''
      const buffer = match[2] ? Buffer.from(encoded, 'base64') : Buffer.from(decodeURIComponent(encoded), 'utf8')
      return { buffer, mimeType }
    }
    if (/^file:/i.test(rawUrl)) {
      const { resolvedPath } = await resolveReadableFileForIpc(rawUrl, { purpose: 'Image file' })
      const buffer = await fs.promises.readFile(resolvedPath)
      return { buffer, mimeType: mimeTypeForPath(resolvedPath) }
    }

    const parsed = new URL(rawUrl)
    const client = parsed.protocol === 'https:' ? https : http
    return new Promise((resolve, reject) => {
      const req = client.get(parsed, res => {
        if ((res.statusCode || 500) >= 400) {
          reject(new Error(`Failed to fetch ${rawUrl}: ${res.statusCode}`))
          res.resume()
          return
        }
        const chunks = []
        res.on('error', reject)
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () => {
          resolve({
            buffer: Buffer.concat(chunks),
            mimeType: res.headers['content-type'] || 'application/octet-stream'
          })
        })
      })
      req.on('error', reject)
    })
  }

  async function copyImageFromUrl(rawUrl) {
    const { buffer } = await resourceBufferFromUrl(rawUrl)
    const image = nativeImage.createFromBuffer(buffer)
    if (image.isEmpty()) throw new Error('Could not read image')
    clipboard.writeImage(image)
  }

  async function saveImageFromUrl(rawUrl) {
    const { buffer, mimeType } = await resourceBufferFromUrl(rawUrl)
    const fallbackName = filenameFromUrl(rawUrl, `image${extensionForMimeType(mimeType) || '.png'}`)
    const result = await dialog.showSaveDialog(getMainWindow(), {
      title: 'Save Image',
      defaultPath: fallbackName
    })
    if (result.canceled || !result.filePath) return false
    await fs.promises.writeFile(result.filePath, buffer)
    return true
  }

  async function writeComposerImage(buffer, ext = '.png') {
    const rawExt = String(ext || '.png')
      .trim()
      .toLowerCase()
    const normalizedExt = rawExt.startsWith('.') ? rawExt : `.${rawExt}`
    const safeExt = /^\.[a-z0-9]{1,5}$/.test(normalizedExt) ? normalizedExt : '.png'
    const dir = path.join(app.getPath('userData'), 'composer-images')
    await fs.promises.mkdir(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
    const random = crypto.randomBytes(3).toString('hex')
    const filePath = path.join(dir, `composer_${stamp}_${random}${safeExt}`)
    await fs.promises.writeFile(filePath, buffer)
    return filePath
  }

  async function saveClipboardImage() {
    const image = clipboard.readImage()
    if (!image || image.isEmpty()) {
      return ''
    }

    return writeComposerImage(image.toPNG(), '.png')
  }

  async function previewFileTarget(rawTarget, baseDir) {
    const raw = String(rawTarget || '').trim()
    const base = baseDir ? path.resolve(expandUserPath(baseDir)) : resolveDefaultPreviewCwd()
    let resolved = resolveRequestedPathForIpc(/^file:/i.test(raw) ? raw : expandUserPath(raw), {
      baseDir: base,
      purpose: 'Preview target'
    })

    if (directoryExists(resolved)) {
      resolved = path.join(resolved, 'index.html')
    }

    const ext = path.extname(resolved).toLowerCase()
    if (!fileExists(resolved)) {
      return null
    }

    ;({ resolvedPath: resolved } = await resolveReadableFileForIpc(resolved, { purpose: 'Preview target' }))

    const mimeType = mimeTypeForPath(resolved)
    const metadata = previewFileMetadata(resolved, mimeType)
    const isHtml = PREVIEW_HTML_EXTENSIONS.has(ext)
    const isImage = mimeType.startsWith('image/')
    const previewKind = isHtml ? 'html' : isImage ? 'image' : metadata.binary ? 'binary' : 'text'

    return {
      binary: metadata.binary,
      byteSize: metadata.byteSize,
      kind: 'file',
      large: metadata.large,
      label: path.basename(resolved),
      language: PREVIEW_LANGUAGE_BY_EXT[ext] || 'text',
      mimeType,
      path: resolved,
      previewKind,
      source: raw,
      url: pathToFileURL(resolved).toString()
    }
  }

  async function normalizePreviewTarget(rawTarget, baseDir) {
    const raw = String(rawTarget || '').trim()

    if (!raw) {
      return null
    }

    try {
      if (/^https?:\/\//i.test(raw)) {
        return previewUrlTarget(raw)
      }

      return await previewFileTarget(raw, baseDir)
    } catch {
      return null
    }
  }

  async function filePathFromPreviewUrl(rawUrl) {
    const { resolvedPath } = await resolveReadableFileForIpc(String(rawUrl || ''), { purpose: 'Preview file' })
    return resolvedPath
  }

  function sendPreviewFileChanged(payload) {
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return
    const { webContents } = mainWindow
    if (!webContents || webContents.isDestroyed()) return
    webContents.send('hermes:preview-file-changed', payload)
  }

  async function watchPreviewFile(rawUrl) {
    const filePath = await filePathFromPreviewUrl(rawUrl)
    const watchDir = path.dirname(filePath)
    const targetName = path.basename(filePath)
    const id = crypto.randomBytes(12).toString('base64url')
    let timer = null
    const watcher = fs.watch(watchDir, (_eventType, filename) => {
      const changedName = filename ? path.basename(String(filename)) : ''

      if (changedName && changedName !== targetName) {
        return
      }

      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        if (!fileExists(filePath)) return
        sendPreviewFileChanged({ id, path: filePath, url: pathToFileURL(filePath).toString() })
      }, PREVIEW_WATCH_DEBOUNCE_MS)
    })

    previewWatchers.set(id, {
      close: () => {
        if (timer) clearTimeout(timer)
        watcher.close()
      }
    })

    return { id, path: filePath }
  }

  function stopPreviewFileWatch(id) {
    const watcher = previewWatchers.get(id)

    if (!watcher) {
      return false
    }

    watcher.close()
    previewWatchers.delete(id)

    return true
  }

  function closePreviewWatchers() {
    for (const id of previewWatchers.keys()) {
      stopPreviewFileWatch(id)
    }
  }

  async function readFileDataUrl(filePath) {
    const { resolvedPath } = await resolveReadableFileForIpc(filePath, {
      maxBytes: DATA_URL_READ_MAX_BYTES,
      purpose: 'File preview'
    })
    const data = await fs.promises.readFile(resolvedPath)
    return `data:${mimeTypeForPath(resolvedPath)};base64,${data.toString('base64')}`
  }

  async function readFileText(filePath) {
    const { resolvedPath, stat } = await resolveReadableFileForIpc(filePath, {
      maxBytes: TEXT_PREVIEW_SOURCE_MAX_BYTES,
      purpose: 'Text preview'
    })
    const ext = path.extname(resolvedPath).toLowerCase()
    const handle = await fs.promises.open(resolvedPath, 'r')
    const bytesToRead = Math.min(stat.size, TEXT_PREVIEW_MAX_BYTES)

    try {
      const buffer = Buffer.alloc(bytesToRead)
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0)

      return {
        binary: looksBinary(buffer.subarray(0, Math.min(bytesRead, 4096))),
        byteSize: stat.size,
        language: PREVIEW_LANGUAGE_BY_EXT[ext] || 'text',
        mimeType: mimeTypeForPath(resolvedPath),
        path: resolvedPath,
        text: buffer.subarray(0, bytesRead).toString('utf8'),
        truncated: stat.size > TEXT_PREVIEW_MAX_BYTES
      }
    } finally {
      await handle.close()
    }
  }

  return {
    closePreviewWatchers,
    copyImageFromUrl,
    normalizePreviewTarget,
    readFileDataUrl,
    readFileText,
    registerMediaProtocol,
    saveClipboardImage,
    saveImageFromUrl,
    stopPreviewFileWatch,
    watchPreviewFile,
    writeComposerImage
  }
}

module.exports = {
  createMediaPreviewController,
  extensionForMimeType,
  filenameFromUrl,
  looksBinary,
  mimeTypeForPath,
  previewUrlTarget
}
