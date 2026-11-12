import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { PassThrough } from 'node:stream'
import { read, utils, write } from 'xlsx'
import { apply, MAX_FILE_BYTES, readSpreadsheet, statSpreadsheet } from '../lib/index.js'
import { gridSheet, parseWorkbook, sheetInfos } from '../src/client/workbook.ts'

const workbook = utils.book_new()
utils.book_append_sheet(workbook, utils.aoa_to_sheet([['<img src=x onerror=alert(1)>', 42], ['', '=1+1']]), 'Data')
utils.book_append_sheet(workbook, utils.aoa_to_sheet([['第二页']]), '中文')

for (const type of ['xlsx', 'xls', 'ods', 'csv']) {
  test(`SheetJS parses ${type} without changing cell data`, () => {
    const bytes = write(workbook, { type: 'buffer', bookType: type })
    const parsed = parseWorkbook(bytes, `sample.${type}`)
    const sheet = gridSheet(parsed, parsed.SheetNames[0])
    assert.equal(sheet.rows[0].cells[0].text, '<img src=x onerror=alert(1)>')
    assert.equal(sheet.rows[0].cells[1].text, '42')
    assert.equal(sheet.rows[0].rowLabel, 1)
    assert.equal(sheet.rows[1].cells[0].text, '')
  })
}

test('TSV treats formula-looking and HTML-looking cells as text', () => {
  const parsed = parseWorkbook(new TextEncoder().encode('<b>unsafe</b>\t=1+1\nnext\t42'), 'sample.tsv')
  const sheet = gridSheet(parsed, 'Sheet1')
  assert.equal(sheet.rows[0].cells[0].text, '<b>unsafe</b>')
  assert.equal(sheet.rows[0].cells[1].text, '=1+1')
})

test('delimited text is decoded from UTF-16 BOM and GBK bytes', () => {
  const utf16 = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from('a;b\r\n1;2', 'utf16le'),
  ])
  const parsedUtf16 = parseWorkbook(utf16, 'sample.csv')
  const utf16Sheet = gridSheet(parsedUtf16, 'Sheet1')
  assert.deepEqual(utf16Sheet.rows.map((row) => row.cells.map((cell) => cell.text)), [['a', 'b'], ['1', '2']])

  // "中文" in GBK; the decoder must fall back after UTF-8 fails.
  const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4])
  const parsedGbk = parseWorkbook(gbk, 'sample.csv')
  assert.equal(gridSheet(parsedGbk, 'Sheet1').rows[0].cells[0].text, '中文')
})

test('multiple sheets, hidden sheets and offset coordinates are retained', () => {
  const parsed = parseWorkbook(write(workbook, { type: 'buffer', bookType: 'xlsx' }))
  assert.deepEqual(parsed.SheetNames, ['Data', '中文'])
  assert.equal(gridSheet(parsed, '中文').rows[0].cells[0].text, '第二页')

  const offset = utils.book_new()
  const offsetSheet = utils.aoa_to_sheet([['last']], { origin: 'C3' })
  offsetSheet['!ref'] = 'C3:C3'
  utils.book_append_sheet(offset, offsetSheet, 'offset')
  const data = gridSheet(offset, 'offset')
  assert.equal(data.rows[0].rowLabel, 3)
  assert.deepEqual(data.columns, ['C'])
  assert.equal(data.rows[0].cells[0].text, 'last')

  const hidden = utils.book_new()
  utils.book_append_sheet(hidden, utils.aoa_to_sheet([['visible']]), 'Visible')
  utils.book_append_sheet(hidden, utils.aoa_to_sheet([['secret']]), 'Hidden')
  hidden.Workbook = { Sheets: [{ name: 'Visible', Hidden: 0 }, { name: 'Hidden', Hidden: 1 }] }
  assert.deepEqual(sheetInfos(hidden), [{ name: 'Visible', hidden: false }, { name: 'Hidden', hidden: true }])
})

test('formula text, cached values and no-cache formulas are classified', () => {
  const book = utils.book_new()
  const sheet = utils.aoa_to_sheet([[2, 3]])
  sheet['!ref'] = 'A1:E2'
  sheet.C1 = { t: 'n', v: 4, w: '4', f: 'A1+B1' }
  sheet.D1 = { t: 'z', f: 'A1*B1' }
  utils.book_append_sheet(book, sheet, 'Calc')
  const parsed = parseWorkbook(write(book, { type: 'buffer', bookType: 'xlsx' }))
  const grid = gridSheet(parsed, 'Calc')
  assert.equal(grid.rows[0].cells[2].formula, '=A1+B1')
  assert.equal(grid.rows[0].cells[2].text, '4')
  assert.equal(grid.rows[0].cells[2].noCache, undefined)
  assert.equal(grid.rows[0].cells[3].formula, '=A1*B1')
  assert.equal(grid.rows[0].cells[3].noCache, true)
  assert.equal(grid.formulaCount, 2)
  assert.equal(grid.noCacheCount, 1)
  assert.equal(grid.rows[0].cells[3].kind, 'number')
})

test('merged cells and column widths are exposed to the grid model', () => {
  const book = utils.book_new()
  const sheet = utils.aoa_to_sheet([['title', '', 'right'], ['a', 'b', 'c']])
  sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]
  sheet['!cols'] = [{ wpx: 120 }, { wpx: 90 }, { hidden: true, wpx: 70 }]
  utils.book_append_sheet(book, sheet, 'Sheet1')
  const parsed = parseWorkbook(write(book, { type: 'buffer', bookType: 'xlsx' }))
  const grid = gridSheet(parsed, 'Sheet1')
  assert.equal(grid.rows[0].cells[0].mergeRange, 'A1:B1')
  assert.equal(grid.rows[0].cells[1].covered, true)
  assert.equal(grid.widths[0], 120)
  assert.equal(grid.hiddenColumns[2], true)
  assert.equal(grid.hiddenColumnCount, 1)
  assert.equal(grid.totalRows, 2)
  assert.equal(grid.totalCols, 3)
})

test('browser bundle loads with platform React only and registers viewer', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  let plugin
  runInNewContext(source, {
    document: { createElement() { return { classList: { add() {} }, setAttribute() {} } } },
    window: {
      __ModuleLoader__: {
        load(entry) {
          plugin = entry.factory((id) => {
            assert.equal(id, 'react', `unexpected external browser require: ${id}`)
            return React
          })
        },
      },
    },
  })
  assert.ok(plugin)
  const registry = []
  const ctx = {
    get(name) {
      return name === 'files'
        ? { registerFileViewer(def) { registry.push(def); return () => {} } }
        : { registerPlugin() { return () => {} }, registerEditorView(def) { registry.push(def); return () => {} } }
    },
    effect(register) { register() },
  }
  plugin.apply(ctx)
  assert.deepEqual(Array.from(registry[0].exts), ['xlsx', 'xls', 'ods', 'csv', 'tsv'])
  assert.equal(registry[1].id, 'spreadsheet')
})

class Request extends PassThrough {
  constructor(path, headers = {}, url = '/dock-spreadsheet/read') {
    super()
    this.method = 'POST'; this.url = url
    this.headers = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', ...headers }
    queueMicrotask(() => this.end(JSON.stringify({ path })))
  }
}
class Response {
  status = 0; headers = {}; chunks = []
  writeHead(status, headers) { this.status = status; this.headers = headers }
  end(chunk) { if (chunk) this.chunks.push(Buffer.from(chunk)) }
  get body() { return Buffer.concat(this.chunks) }
}

async function handle(path, headers, url) {
  let handler
  const ctx = {
    webRuntime: { trustedHosts: [] },
    webServer: { register({ handler: registered }) { handler = registered; return () => {} } },
    effect(register) { register() },
  }
  apply(ctx)
  const res = new Response()
  await handler(new Request(path, headers, url), res)
  return res
}

test('host serves raw spreadsheet bytes, metadata, and refuses cross-site requests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dock-spreadsheet-'))
  try {
    const path = join(dir, 'test.xlsx')
    const payload = write(workbook, { type: 'buffer', bookType: 'xlsx' })
    await writeFile(path, payload)
    assert.deepEqual(await readSpreadsheet(path), payload)
    const stat = await statSpreadsheet(path)
    assert.equal(stat.size, payload.length)
    assert.ok(stat.mtimeMs > 0)

    const ok = await handle(path)
    assert.equal(ok.status, 200)
    assert.equal(ok.headers['content-type'], 'application/octet-stream')
    assert.equal(read(ok.body, { type: 'buffer' }).SheetNames.length, 2)

    const statResponse = await handle(path, {}, '/dock-spreadsheet/stat')
    assert.equal(statResponse.status, 200)
    assert.equal(JSON.parse(statResponse.body.toString('utf8')).ok, true)

    assert.equal((await handle(path, { 'sec-fetch-site': 'cross-site' })).status, 403)
    assert.equal((await handle(join(dir, 'test.exe'))).status, 400)
    assert.equal((await handle('relative.xlsx')).status, 400)
    const oversized = join(dir, 'large.xlsx')
    await writeFile(oversized, Buffer.alloc(MAX_FILE_BYTES + 1))
    assert.equal((await handle(oversized)).status, 413)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
