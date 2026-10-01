import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { runInThisContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { utils, write } from 'xlsx'

const book = utils.book_new()
utils.book_append_sheet(book, utils.aoa_to_sheet([
  ['<b>literal</b>', 'Alpha'],
  ['row 2', 'Beta'],
  ['详见 https://example.com/docs, 谢谢', 'Gamma'],
]), 'First')
utils.book_append_sheet(book, utils.aoa_to_sheet([['second sheet']]), 'Second')
const bytes = write(book, { type: 'buffer', bookType: 'xlsx' })

const GLOBALS = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node',
  'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver', 'getComputedStyle',
  'requestAnimationFrame', 'cancelAnimationFrame']

/** Publish the jsdom realm as globals so the browser bundle runs against it. */
function installDom(dom) {
  const prior = new Map()
  for (const key of [...GLOBALS, 'fetch']) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    const value = key === 'fetch'
      ? async () => ({ ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })
      : key === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window)
        : key === 'requestAnimationFrame' ? (callback) => setTimeout(callback, 0)
          : key === 'cancelAnimationFrame' ? clearTimeout
            : dom.window[key]
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  return () => {
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
}

/** jsdom reports every element as zero-sized, which makes Tabulator's virtual DOM render no rows. */
function giveLayoutBoxes(dom) {
  for (const [property, value] of [['clientWidth', 800], ['clientHeight', 400], ['offsetWidth', 800], ['offsetHeight', 400]]) {
    Object.defineProperty(dom.window.HTMLElement.prototype, property, { configurable: true, get() { return value } })
  }
  dom.window.Element.prototype.getBoundingClientRect = () => (
    { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 400, width: 800, height: 400, toJSON() { return this } }
  )
}

/** Let React effects, the fetch stub and Tabulator's async rendering settle. */
const settle = async () => {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
}

/** Rendered virtual-DOM rows as arrays of cell texts. */
const rows = (dom) => [...dom.window.document.querySelectorAll('.tabulator-row')]
  .map((row) => [...row.querySelectorAll('.tabulator-cell')].map((cell) => cell.textContent))

/** React tracks input values, so drive the native setter before dispatching. */
const setInput = async (dom, input, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  await settle()
}

test('real React view mounts Tabulator, searches, sorts and switches sheets', async () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
  giveLayoutBoxes(dom)
  const restore = installDom(dom)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  // react-dom must be evaluated once the jsdom globals exist, otherwise its
  // event system binds to no document and dispatched events never reach React.
  const { createRoot } = await import('react-dom/client')
  let plugin, root
  try {
    dom.window.__ModuleLoader__ = { load(entry) { plugin = entry.factory((id) => {
      assert.equal(id, 'react', `unexpected external browser require: ${id}`)
      return React
    }) } }
    runInThisContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'))

    let component
    plugin.apply({
      get(name) { return name === 'files' ? { registerFileViewer() { return () => {} } }
        : { registerPlugin() { return () => {} }, registerEditorView(def) { component = def.component; return () => {} } } },
      effect(register) { register() },
    })
    assert.equal(typeof component, 'function')

    root = createRoot(dom.window.document.getElementById('root'))
    await act(async () => {
      root.render(React.createElement(component, { seed: { path: '/tmp/example.xlsx' }, active: true, viewId: 'spreadsheet' }))
    })
    await settle()

    assert.ok(dom.window.document.querySelector('.tabulator'), 'grid must mount')
    const tabs = () => [...dom.window.document.querySelectorAll('.ds-sheet-tab')]
    assert.deepEqual(tabs().map((tab) => tab.textContent), ['First', 'Second'])
    assert.equal(tabs()[0].getAttribute('aria-selected'), 'true', 'first sheet is the active tab')
    assert.equal(dom.window.document.querySelector('.ds-sheet-readonly').textContent, '只读预览')
    assert.deepEqual(rows(dom).map((cells) => cells[2]), ['Alpha', 'Beta', 'Gamma'], 'cells render in worksheet order')
    assert.equal(dom.window.document.querySelector('b'), null, 'cell HTML must never become a DOM element')

    // A click highlights one data cell and reveals its actual coordinate/text.
    const firstCell = dom.window.document.querySelector('.tabulator-row').querySelectorAll('.tabulator-cell')[1]
    await act(async () => { firstCell.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    assert.equal(dom.window.document.querySelector('.ds-sheet-address').textContent, 'A1')
    assert.equal(dom.window.document.querySelector('.ds-sheet-value').textContent, '<b>literal</b>')
    assert.ok(firstCell.classList.contains('ds-selected-cell'))
    assert.equal(dom.window.document.querySelector('.ds-sheet-value b'), null, 'inspector is also text only')

    const filterButton = dom.window.document.querySelector('.ds-sheet-tool')
    assert.equal(filterButton.getAttribute('aria-pressed'), 'false')
    await act(async () => { filterButton.click() })
    assert.equal(filterButton.getAttribute('aria-pressed'), 'true')
    assert.ok(dom.window.document.querySelector('.ds-sheet.ds-filtering'))
    await act(async () => { filterButton.click() })
    assert.equal(filterButton.getAttribute('aria-pressed'), 'false')

    // A URL inside a cell becomes an anchor; the surrounding text stays intact.
    const anchor = dom.window.document.querySelector('a.ds-url')
    assert.ok(anchor, 'detected URL must render as an anchor')
    assert.equal(anchor.textContent, 'https://example.com/docs')
    assert.equal(anchor.getAttribute('href'), 'https://example.com/docs')
    assert.equal(anchor.closest('.tabulator-cell').textContent, '详见 https://example.com/docs, 谢谢',
      'text around the URL is preserved verbatim')
    assert.match(anchor.title, /Ctrl/)

    // Only Ctrl/⌘+click opens the link; a plain click must not navigate.
    const opened = []
    dom.window.open = (...args) => { opened.push(args); return null }
    const click = (init) => anchor.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, ...init }))
    assert.equal(click({}), false, 'plain click is swallowed so the anchor cannot navigate on its own')
    assert.deepEqual(opened, [], 'plain click must not open anything')
    click({ ctrlKey: true })
    assert.deepEqual(opened, [['https://example.com/docs', '_blank', 'noopener,noreferrer']], 'Ctrl+click opens the URL in a new tab')
    opened.length = 0
    click({ metaKey: true })
    assert.deepEqual(opened, [['https://example.com/docs', '_blank', 'noopener,noreferrer']], 'Cmd+click opens the URL on macOS')

    // Search box filters across columns.
    const search = dom.window.document.querySelector('input[type=search]')
    await setInput(dom, search, 'Beta')
    await settle()
    assert.deepEqual(rows(dom).map((cells) => cells[2]), ['Beta'], 'search must keep only matching rows')
    await setInput(dom, search, '')
    await settle()
    assert.equal(rows(dom).length, 3, 'clearing the search must restore every row')

    // A header click sorts the column: ascending first, then descending.
    const header = (letter) => [...dom.window.document.querySelectorAll('.tabulator-col')]
      .find((column) => column.textContent.trim() === letter)
    const clickHeader = async () => {
      await act(async () => { header('B').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
      await settle()
    }
    await clickHeader()
    assert.deepEqual(rows(dom).map((cells) => cells[2]), ['Alpha', 'Beta', 'Gamma'], 'ascending sort keeps data order here')
    await clickHeader()
    assert.deepEqual(rows(dom).map((cells) => cells[2]), ['Gamma', 'Beta', 'Alpha'], 'descending sort must reorder rows')

    // Switching worksheets rebuilds the grid and clears stale cell selection.
    await act(async () => { tabs()[1].click() })
    await settle()
    assert.equal(tabs()[1].getAttribute('aria-selected'), 'true')
    assert.deepEqual(rows(dom).map((cells) => cells[1]), ['second sheet'])
    assert.equal(dom.window.document.querySelector('.ds-sheet-address').textContent, '—', 'selection resets on sheet switch')
    await act(async () => { tabs()[1].dispatchEvent(new dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' })) })
    await settle()
    assert.equal(tabs()[0].getAttribute('aria-selected'), 'true', 'arrow keys navigate sheet tabs')
    assert.deepEqual(rows(dom).map((cells) => cells[2]), ['Alpha', 'Beta', 'Gamma'])
  } finally {
    if (root) await act(async () => root.unmount())
    restore()
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
    dom.window.close()
  }
})
