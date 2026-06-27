const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { INSTALL_STAMP_SCHEMA_VERSION, loadInstallStamp } = require('./install-stamp.cjs')

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-install-stamp-'))
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true })
  try {
    const result = fn(dir)
    if (result && typeof result.then === 'function') {
      return result.finally(cleanup)
    }
    cleanup()
    return result
  } catch (error) {
    cleanup()
    throw error
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`)
}

test('loadInstallStamp prefers packaged resources over dev build stamp', () =>
  withTempDir(dir => {
    const resourcesPath = path.join(dir, 'resources')
    const appRoot = path.join(dir, 'app')
    const packagedStamp = path.join(resourcesPath, 'install-stamp.json')
    const devStamp = path.join(appRoot, 'build', 'install-stamp.json')

    writeJson(packagedStamp, {
      schemaVersion: INSTALL_STAMP_SCHEMA_VERSION,
      commit: 'abcdef1234567890',
      branch: 'main',
      builtAt: '2026-06-27T00:00:00.000Z',
      dirty: true,
      source: 'packaged'
    })
    writeJson(devStamp, {
      schemaVersion: INSTALL_STAMP_SCHEMA_VERSION,
      commit: '1234567dev',
      source: 'dev'
    })

    const stamp = loadInstallStamp({ appRoot, resourcesPath })

    assert.equal(stamp.commit, 'abcdef1234567890')
    assert.equal(stamp.branch, 'main')
    assert.equal(stamp.dirty, true)
    assert.equal(stamp.source, 'packaged')
    assert.equal(stamp.path, packagedStamp)
    assert.equal(Object.isFrozen(stamp), true)
  }))

test('loadInstallStamp skips stale schema and falls back to dev stamp', () =>
  withTempDir(dir => {
    const resourcesPath = path.join(dir, 'resources')
    const appRoot = path.join(dir, 'app')
    const warnings = []

    writeJson(path.join(resourcesPath, 'install-stamp.json'), {
      schemaVersion: 999,
      commit: 'abcdef1234567890'
    })
    writeJson(path.join(appRoot, 'build', 'install-stamp.json'), {
      schemaVersion: INSTALL_STAMP_SCHEMA_VERSION,
      commit: '1234567dev'
    })

    const stamp = loadInstallStamp({ appRoot, resourcesPath, warn: message => warnings.push(message) })

    assert.equal(stamp.commit, '1234567dev')
    assert.equal(stamp.branch, null)
    assert.equal(stamp.builtAt, null)
    assert.equal(stamp.dirty, false)
    assert.equal(stamp.source, null)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /schemaVersion 999 != expected 1/)
  }))

test('loadInstallStamp returns null when candidates are missing or malformed', () =>
  withTempDir(dir => {
    const resourcesPath = path.join(dir, 'resources')
    const appRoot = path.join(dir, 'app')

    writeJson(path.join(resourcesPath, 'install-stamp.json'), {
      schemaVersion: INSTALL_STAMP_SCHEMA_VERSION,
      commit: 'short'
    })
    fs.mkdirSync(path.join(appRoot, 'build'), { recursive: true })
    fs.writeFileSync(path.join(appRoot, 'build', 'install-stamp.json'), '{')

    assert.equal(loadInstallStamp({ appRoot, resourcesPath }), null)
  }))
