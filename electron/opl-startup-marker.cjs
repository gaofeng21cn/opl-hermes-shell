'use strict'

const fs = require('node:fs')
const path = require('node:path')

const OPL_STARTUP_MARKER_KIND = 'opl-hermes-candidate-startup'
const OPL_STARTUP_MARKER_SCHEMA_VERSION = 1

function readOplStartupMarker(markerPath) {
  if (!markerPath) return null
  try {
    return JSON.parse(fs.readFileSync(markerPath, 'utf8'))
  } catch {
    return null
  }
}

function validateOplStartupMarker(marker, options = {}) {
  const schemaVersion = options.schemaVersion || OPL_STARTUP_MARKER_SCHEMA_VERSION
  const maxAgeMs = options.maxAgeMs ?? 30 * 24 * 60 * 60 * 1000

  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) {
    return { ok: false, reason: 'missing' }
  }
  if (marker.kind !== OPL_STARTUP_MARKER_KIND) {
    return { ok: false, reason: 'kind_mismatch' }
  }
  if (marker.schemaVersion !== schemaVersion) {
    return { ok: false, reason: 'schema_version_mismatch' }
  }
  if (typeof marker.completedAt !== 'string' || !marker.completedAt.trim()) {
    return { ok: false, reason: 'completed_at_missing' }
  }
  const completedAtMs = Date.parse(marker.completedAt)
  if (!Number.isFinite(completedAtMs)) {
    return { ok: false, reason: 'completed_at_invalid' }
  }
  if (Date.now() - completedAtMs > maxAgeMs) {
    return { ok: false, reason: 'stale' }
  }
  if (typeof marker.api_key_present !== 'boolean') {
    return { ok: false, reason: 'api_key_status_missing' }
  }

  return { ok: true, reason: 'current' }
}

function writeOplStartupMarker(markerPath, payload = {}) {
  if (!markerPath) return null
  const marker = {
    ...payload,
    kind: OPL_STARTUP_MARKER_KIND,
    schemaVersion: OPL_STARTUP_MARKER_SCHEMA_VERSION,
    completedAt: payload.completedAt || new Date().toISOString()
  }
  fs.mkdirSync(path.dirname(markerPath), { recursive: true })
  const tempPath = path.join(
    path.dirname(markerPath),
    `.${path.basename(markerPath)}.${process.pid}.${Date.now()}.tmp`
  )
  fs.writeFileSync(tempPath, JSON.stringify(marker, null, 2) + '\n', 'utf8')
  fs.renameSync(tempPath, markerPath)
  return marker
}

function removeOplStartupMarker(markerPath) {
  if (!markerPath) return
  try {
    fs.rmSync(markerPath, { force: true })
  } catch {
    void 0
  }
}

module.exports = {
  OPL_STARTUP_MARKER_KIND,
  OPL_STARTUP_MARKER_SCHEMA_VERSION,
  readOplStartupMarker,
  removeOplStartupMarker,
  validateOplStartupMarker,
  writeOplStartupMarker
}
