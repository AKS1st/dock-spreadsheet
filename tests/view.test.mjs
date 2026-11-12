import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { runInThisContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { utils, write } from 'xlsx'

const book = utils.book_new()
const first = utils.aoa_to_sheet([
  ['<b>literal</b>', 'Alpha', 9],
  ['row 2', 'Beta', 10],
  ['详见 https://example.com/docs, 谢谢', 'Gamma', 2],
])
first['!ref'] = 'A1:E3'
first.D2 = { t: 'n', v: 84, w: '84.00', z: '0.00', f: 'C1*2' }
first.E2 = { t: 'z', f: 'C2*3' }
utils.book_append_sheet(book, first, 'First')
utils.book_append_sheet(book, utils.aoa_to_sheet([['second sheet']]), 'Second')
utils.book_append_sheet(book, utils.aoa_to_sheet([['hidden sheet']]), 'Hidden')
book.Workbook = { Sheets: [
  { name: 'First', Hidden: 0 },
  { name: 'Second', Hidden: 0 },
  { name: 'Hidden', Hidden: 1 },
] }
const bytes = write(book, { type: 'buffer', bookType: 'xlsx' })
const payload = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

const GLOBALS = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node',
  'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver', 'getComputedStyle',
  'requestAnimationFrame', 'cancelAnimationFrame']

/** Publish the jsdom realm as globals so the browser bundle runs against it. */
function installDom(dom, fetchImpl) {
  const prior = new Map()
  for (const key of [...GLOBALS, 'fetch']) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    const value = key === 'fetch' ? fetchImpl
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

const settle = async () => {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)) })
}

/** Rendered virtual-DOM rows as arrays of cell texts. */
const rows = (dom) => [...dom.window.document.querySelectorAll('.tabulator-row')]
  .map((row) => [...row.querySelectorAll('.tabulator-cell')].map((cell) => cell.textContent))

const setInput = async (dom, input, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  await settle()
}

const buttonByText = (dom, text) => [...dom.window.document.querySelectorAll('button')]
  .find((button) => button.textContent?.includes(text))

test('real React view mounts Tabulator, formula bar, search, sort and hidden sheets', async () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
  giveLayoutBoxes(dom)
  const copied = []
  Object.defineProperty(dom.window.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text) => { copied.push(text) },
      write: async (items) => { copied.push(items) },
    },
  })
  let fetchCount = 0
  const restored = installDom(dom, async (url) => {
    fetchCount += 1
    if (String(url).includes('/dock-spreadsheet/stat')) {
      return { ok: true, json: async () => ({ ok: true, value: { mtimeMs: 1, size: payload.byteLength } }) }
    }
    return { ok: true, arrayBuffer: async () => payload }
  })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  let plugin, root
  try {
    dom.window.__ModuleLoader__ = {
      load(entry) {
        plugin = entry.factory((id) => {
          assert.equal(id, 'react', `unexpected external browser require: ${id}`)
          return React
        })
      },
    }
    runInThisContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'))

    let component
    plugin.apply({
      get(name) {
        return name === 'files' ? { registerFileViewer() { return () => {} } }
          : { registerPlugin() { return () => {} }, registerEditorView(def) { component = def.component; return () => {} } }
      },
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
    assert.deepEqual(tabs().map((tab) => tab.textContent), ['First', 'Second'], 'hidden sheet is not shown by default')
    assert.equal(tabs()[0].getAttribute('aria-selected'), 'true')
    assert.equal(dom.window.document.querySelector('.ds-sheet-readonly').textContent, '只读预览')
    assert.equal(dom.window.document.querySelector('b'), null, 'cell HTML must never become a DOM element')
    assert.deepEqual(rows(dom)[0].slice(1), ['<b>literal</b>', 'Alpha', '9', '', ''])
    assert.deepEqual(rows(dom)[1].slice(4), ['84.00', '=C2*3'], 'cached formula value and no-cache formula text')

    // Formula bar: cached formula shows its formula, no-cache shows formula plus a warning badge.
    const secondRow = dom.window.document.querySelectorAll('.tabulator-row')[1]
    await act(async () => { secondRow.querySelectorAll('.tabulator-cell')[4].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    assert.equal(dom.window.document.querySelector('.ds-sheet-value').textContent, '=C1*2')
    assert.equal(dom.window.document.querySelector('.ds-sheet-warn'), null)
    await act(async () => { secondRow.querySelectorAll('.tabulator-cell')[5].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    assert.equal(dom.window.document.querySelector('.ds-sheet-value').textContent, '=C2*3')
    assert.equal(dom.window.document.querySelector('.ds-sheet-warn').textContent, '无缓存')

    const filterButton = buttonByText(dom, '筛选列')
    assert.equal(filterButton.getAttribute('aria-pressed'), 'false')
    await act(async () => { filterButton.click() })
    assert.equal(filterButton.getAttribute('aria-pressed'), 'true')
    assert.ok(dom.window.document.querySelector('.ds-sheet.ds-filtering'))

    const anchor = dom.window.document.querySelector('a.ds-url')
    assert.ok(anchor, 'detected URL must render as an anchor')
    assert.equal(anchor.getAttribute('href'), 'https://example.com/docs')
    const opened = []
    dom.window.open = (...args) => { opened.push(args); return null }
    const click = (init) => anchor.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, ...init }))
    assert.equal(click({}), false)
    assert.deepEqual(opened, [])
    click({ ctrlKey: true })
    assert.deepEqual(opened, [['https://example.com/docs', '_blank', 'noopener,noreferrer']])

    const search = dom.window.document.querySelector('input[type=search]')
    await setInput(dom, search, 'Beta')
    assert.deepEqual(rows(dom).map((cells) => cells[2]), ['Beta'])
    await setInput(dom, search, '')
    assert.equal(rows(dom).length, 3)

    // Numeric sorting uses the raw value: 2, 9, 10 rather than 10, 2, 9.
    const header = (letter) => [...dom.window.document.querySelectorAll('.tabulator-col')]
      .find((column) => column.textContent.trim() === letter)
    const clickHeader = async () => {
      await act(async () => { header('C').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
      await settle()
    }
    await clickHeader()
    assert.deepEqual(rows(dom).map((cells) => cells[3]), ['2', '9', '10'])
    await clickHeader()
    assert.deepEqual(rows(dom).map((cells) => cells[3]), ['10', '9', '2'])

    // Copy the visible view through the clipboard API.
    await act(async () => { buttonByText(dom, '复制视图').click() })
    await settle()
    assert.ok(copied.some((entry) => typeof entry === 'string' && entry.includes('Alpha') && entry.includes('Beta')),
      'copy-view writes the visible rows')

    // The default active range is copyable without throwing.
    await act(async () => { buttonByText(dom, '复制所选').click() })
    await settle()
    assert.ok(copied.some((entry) => typeof entry === 'string' && entry.length > 0),
      'copy-selection writes the active range')

    // Refresh re-reads the same path instead of relying on a new seed.
    const before = fetchCount
    await act(async () => { buttonByText(dom, '↻').click() })
    await settle()
    assert.ok(fetchCount > before, 'refresh must re-fetch the file')

    // Hidden sheets become reachable through the toggle.
    const hiddenToggle = buttonByText(dom, '隐藏表')
    assert.ok(hiddenToggle, 'hidden-sheet toggle must be available')
    await act(async () => { hiddenToggle.click() })
    await settle()
    assert.ok(tabs().some((tab) => tab.textContent === 'Hidden'), 'hidden sheet appears after enabling the toggle')

    // Swapping sheets rebuilds the grid and resets the selected cell.
    await act(async () => { tabs()[1].click() })
    await settle()
    assert.deepEqual(rows(dom).map((cells) => cells[1]), ['second sheet'])
    assert.equal(dom.window.document.querySelector('.ds-sheet-address').textContent, '—')
    await act(async () => { tabs()[1].dispatchEvent(new dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' })) })
    await settle()
    assert.equal(tabs()[0].getAttribute('aria-selected'), 'true')
  } finally {
    if (root) await act(async () => root.unmount())
    restored()
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
    dom.window.close()
  }
})
