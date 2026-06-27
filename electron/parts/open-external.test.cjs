const test = require('node:test')
const assert = require('node:assert/strict')

const { createExternalOpener } = require('./open-external.cjs')

test('openExternalUrl rejects empty, invalid, and unsupported protocols', () => {
  const calls = []
  const openExternalUrl = createExternalOpener({
    isWsl: false,
    rememberLog: message => calls.push(message),
    shell: {
      openExternal: async url => calls.push(url),
      openPath: async () => ''
    }
  })

  assert.equal(openExternalUrl(''), false)
  assert.equal(openExternalUrl('not a url'), false)
  assert.equal(openExternalUrl('ftp://example.com/file'), false)
  assert.deepEqual(calls, [])
})

test('openExternalUrl delegates web links to Electron shell', () => {
  const calls = []
  const openExternalUrl = createExternalOpener({
    isWsl: false,
    rememberLog: message => calls.push(message),
    shell: {
      openExternal: async url => calls.push(url),
      openPath: async () => ''
    }
  })

  assert.equal(openExternalUrl('https://example.com/path?q=1'), true)
  assert.deepEqual(calls, ['https://example.com/path?q=1'])
})
