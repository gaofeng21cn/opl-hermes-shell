const fs = require('node:fs')
const path = require('node:path')

// Schema:
//   { schemaVersion: 1, commit, branch, builtAt, dirty, source }
const INSTALL_STAMP_SCHEMA_VERSION = 1

function loadInstallStamp({ appRoot, resourcesPath = process.resourcesPath, warn = console.warn } = {}) {
  // Try packaged location first (resources/install-stamp.json), then the
  // dev/local build output (apps/desktop/build/install-stamp.json) so
  // someone running `npm run start` after a local `npm run build` also
  // sees a stamp without needing a packaged build.
  const candidates = [
    resourcesPath ? path.join(resourcesPath, 'install-stamp.json') : null,
    appRoot ? path.join(appRoot, 'build', 'install-stamp.json') : null
  ].filter(Boolean)

  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && typeof parsed.commit === 'string' && parsed.commit.length >= 7) {
        if (parsed.schemaVersion !== INSTALL_STAMP_SCHEMA_VERSION) {
          warn(
            `[hermes] install-stamp.json schemaVersion ${parsed.schemaVersion} != expected ${INSTALL_STAMP_SCHEMA_VERSION}; ignoring`
          )
          continue
        }
        return Object.freeze({
          schemaVersion: parsed.schemaVersion,
          commit: parsed.commit,
          branch: parsed.branch || null,
          builtAt: parsed.builtAt || null,
          dirty: Boolean(parsed.dirty),
          source: parsed.source || null,
          path: p
        })
      }
    } catch {
      // Either ENOENT or malformed JSON; try the next candidate
    }
  }

  return null
}

module.exports = {
  INSTALL_STAMP_SCHEMA_VERSION,
  loadInstallStamp
}
