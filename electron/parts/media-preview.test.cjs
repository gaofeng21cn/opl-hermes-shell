const test = require('node:test')
const assert = require('node:assert/strict')

const {
  extensionForMimeType,
  filenameFromUrl,
  looksBinary,
  mimeTypeForPath,
  previewUrlTarget
} = require('./media-preview.cjs')

test('mime helpers map common media types and fallback safely', () => {
  assert.equal(mimeTypeForPath('/tmp/photo.JPG'), 'image/jpeg')
  assert.equal(mimeTypeForPath('/tmp/clip.webm'), 'video/webm')
  assert.equal(mimeTypeForPath('/tmp/file.unknown'), 'application/octet-stream')
  assert.equal(extensionForMimeType('image/png; charset=binary'), '.png')
  assert.equal(extensionForMimeType('text/plain'), '')
})

test('filenameFromUrl keeps a real basename or fallback', () => {
  assert.equal(filenameFromUrl('https://example.com/path/image.png?x=1'), 'image.png')
  assert.equal(filenameFromUrl('https://example.com/path/', 'fallback.png'), 'fallback.png')
  assert.equal(filenameFromUrl('not a url', 'fallback.png'), 'fallback.png')
})

test('looksBinary detects NUL bytes and tolerates plain text controls', () => {
  assert.equal(looksBinary(Buffer.from('hello\nworld\t')), false)
  assert.equal(looksBinary(Buffer.from([104, 0, 105])), true)
})

test('previewUrlTarget only accepts local http targets', () => {
  assert.deepEqual(previewUrlTarget('http://0.0.0.0:5174/index.html'), {
    kind: 'url',
    label: '127.0.0.1:5174/index.html',
    source: 'http://0.0.0.0:5174/index.html',
    url: 'http://127.0.0.1:5174/index.html'
  })
  assert.equal(previewUrlTarget('https://example.com/'), null)
  assert.equal(previewUrlTarget('file:///tmp/index.html'), null)
})
