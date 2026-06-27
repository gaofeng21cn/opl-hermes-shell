const test = require('node:test')
const assert = require('node:assert/strict')

const { canonicalTitleCacheKey, decodeHtmlEntities, parseHtmlTitle } = require('./link-title.cjs')

test('canonicalTitleCacheKey normalizes host and trailing slash', () => {
  assert.equal(canonicalTitleCacheKey('https://www.Example.com/path/?q=1'), 'example.com/path?q=1')
  assert.equal(canonicalTitleCacheKey('https://example.com/'), 'example.com/')
})

test('parseHtmlTitle decodes entities and collapses whitespace', () => {
  assert.equal(parseHtmlTitle('<html><title> A &amp; B\n &#x43; </title></html>'), 'A & B C')
})

test('decodeHtmlEntities handles named and numeric entities', () => {
  assert.equal(decodeHtmlEntities('&lt;tag&gt; &#39;x&#39; &#x26;'), "<tag> 'x' &")
})
