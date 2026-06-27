const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const {
  buildCodexEnvironment,
  normalizeCodexError,
  parseJsonLines,
  parseTextLines
} = require('./codex-app-server-client.cjs')

test('Codex app-server line parsers emit complete records and keep trailing buffers', () => {
  const messages = []
  const remainingJson = parseJsonLines('{"a":1}\n{"b":2', message => messages.push(message))
  assert.deepEqual(messages, [{ a: 1 }])
  assert.equal(remainingJson, '{"b":2')

  const lines = []
  const remainingText = parseTextLines('first\nsecond', line => lines.push(line))
  assert.deepEqual(lines, ['first'])
  assert.equal(remainingText, 'second')
})

test('Codex app-server helpers normalize errors and include executable directory in PATH', () => {
  assert.deepEqual(normalizeCodexError({ message: 'bad', code: -1 }, { requestId: 7 }), {
    message: 'bad',
    code: -1,
    data: null,
    requestId: 7
  })

  const executable = path.join('/tmp', 'codex-bin', 'codex')
  const env = buildCodexEnvironment(executable)
  assert.equal(env.PATH.split(path.delimiter)[0], path.dirname(executable))
})
