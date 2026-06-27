const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createDesktopLogController, planDesktopLogRotation } = require('./desktop-log.cjs')

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-desktop-log-'))
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

async function readFileWhenPresent(filePath) {
  for (let i = 0; i < 20; i++) {
    try {
      return fs.readFileSync(filePath, 'utf8')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      await new Promise(resolve => setTimeout(resolve, 5))
    }
  }
  return fs.readFileSync(filePath, 'utf8')
}

test('planDesktopLogRotation cascades bounded logs', () => {
  assert.deepEqual(
    planDesktopLogRotation(10, {
      backupCount: 3,
      discardBytes: 400,
      logPath: '/tmp/desktop.log',
      maxBytes: 100
    }),
    []
  )

  assert.deepEqual(
    planDesktopLogRotation(100, {
      backupCount: 3,
      discardBytes: 400,
      logPath: '/tmp/desktop.log',
      maxBytes: 100
    }),
    [
      ['rm', '/tmp/desktop.log.3'],
      ['mv', '/tmp/desktop.log.2', '/tmp/desktop.log.3'],
      ['mv', '/tmp/desktop.log.1', '/tmp/desktop.log.2'],
      ['mv', '/tmp/desktop.log', '/tmp/desktop.log.1']
    ]
  )
})

test('planDesktopLogRotation deletes pathological logs and backups', () => {
  assert.deepEqual(
    planDesktopLogRotation(401, {
      backupCount: 2,
      discardBytes: 400,
      logPath: '/tmp/desktop.log',
      maxBytes: 100
    }),
    [
      ['rm', '/tmp/desktop.log'],
      ['rm', '/tmp/desktop.log.1'],
      ['rm', '/tmp/desktop.log.2']
    ]
  )
})

test('desktop log controller records recent lines and flushes synchronously', () =>
  withTempDir(dir => {
    const logPath = path.join(dir, 'logs', 'desktop.log')
    const recentLog = []
    const controller = createDesktopLogController({
      clearTimeoutFn: () => undefined,
      logPath,
      recentLog,
      setTimeoutFn: () => 1
    })

    controller.remember('one\ntwo')
    assert.deepEqual(recentLog, ['[hermes] one', '[hermes] two'])

    controller.cancelScheduledFlush()
    controller.flushSync()

    assert.equal(fs.readFileSync(logPath, 'utf8'), '[hermes] one\n[hermes] two\n')
  }))

test('desktop log controller flushes immediately when buffer reaches threshold', async () =>
  withTempDir(async dir => {
    const logPath = path.join(dir, 'desktop.log')
    const controller = createDesktopLogController({
      bufferMaxChars: 10,
      logPath,
      recentLog: [],
      setTimeoutFn: () => {
        throw new Error('large buffers should not schedule delayed flush')
      }
    })

    controller.remember('large enough')

    assert.equal(await readFileWhenPresent(logPath), '[hermes] large enough\n')
  }))
