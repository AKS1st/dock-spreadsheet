import assert from 'node:assert/strict'
import { test } from 'node:test'
import { splitLinks } from '../src/client/links.ts'

/** Compact view of the segments for readable assertions. */
const shape = (text) => splitLinks(text).map((segment) => segment.url === undefined ? segment.text : `[${segment.text}](${segment.url})`)

test('plain text without URLs stays a single segment', () => {
  assert.deepEqual(splitLinks('hello world'), [{ text: 'hello world' }])
  assert.deepEqual(splitLinks(''), [])
  assert.deepEqual(splitLinks('a@b.com and example.com'), [{ text: 'a@b.com and example.com' }])
})

test('URLs are detected at the start, middle and end of a cell', () => {
  assert.deepEqual(shape('https://a.example/x'), ['[https://a.example/x](https://a.example/x)'])
  assert.deepEqual(shape('see https://a.example/x now'), ['see ', '[https://a.example/x](https://a.example/x)', ' now'])
  assert.deepEqual(shape('end: http://a.example'), ['end: ', '[http://a.example](http://a.example)'])
})

test('www candidates get an explicit https scheme but keep their text', () => {
  assert.deepEqual(shape('go www.example.com/page'), ['go ', '[www.example.com/page](https://www.example.com/page)'])
})

test('sentence punctuation and unbalanced brackets are not part of the URL', () => {
  assert.deepEqual(shape('see https://a.example/x, then'), ['see ', '[https://a.example/x](https://a.example/x)', ', then'])
  assert.deepEqual(shape('(https://a.example/x)'), ['(', '[https://a.example/x](https://a.example/x)', ')'])
  assert.deepEqual(shape('https://a.example/x.'), ['[https://a.example/x](https://a.example/x)', '.'])
})

test('balanced brackets inside a URL are preserved', () => {
  assert.deepEqual(shape('https://en.example/wiki/Foo_(bar)'),
    ['[https://en.example/wiki/Foo_(bar)](https://en.example/wiki/Foo_(bar))'])
})

test('multiple URLs in one cell stay in order', () => {
  assert.deepEqual(shape('a https://one.example b https://two.example'), [
    'a ', '[https://one.example](https://one.example)', ' b ', '[https://two.example](https://two.example)',
  ])
})

test('a URL glued to a word is not detected', () => {
  assert.deepEqual(shape('abchttps://a.example'), ['abchttps://a.example'])
})

test('uppercase schemes are detected and trimmed', () => {
  assert.deepEqual(shape('HTTPS://A.EXAMPLE/X'), ['[HTTPS://A.EXAMPLE/X](HTTPS://A.EXAMPLE/X)'])
})

test('rebuilt text always equals the original cell text', () => {
  for (const text of ['a https://x.example/p, b', '(http://y.example)', 'www.z.example.', 'abchttps://q.example', 'none']) {
    assert.equal(splitLinks(text).map((segment) => segment.text).join(''), text, `text preserved for ${JSON.stringify(text)}`)
  }
})
