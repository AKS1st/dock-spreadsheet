import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { PassThrough } from 'node:stream'
import { read, utils, write } from 'xlsx'
import { apply, MAX_FILE_BYTES, readSpreadsheet } from '../lib/index.js'
import { gridSheet, parseWorkbook } from '../src/client/workbook.ts'

const workbook = utils.book_new()
utils.book_append_sheet(workbook, utils.aoa_to_sheet([['<img src=x onerror=alert(1)>', 42], ['', '=1+1']]), 'Data')
utils.book_append_sheet(workbook, utils.aoa_to_sheet([['第二页']]), '中文')

for (const type of ['xlsx', 'xls', 'ods', 'csv']) {
  test(`SheetJS parses ${type} without changing cell data`, () => {
    const bytes = write(workbook, { type: 'buffer', bookType: type })
    const parsed = parseWorkbook(bytes, `sample.${type}`)
    const sheet = gridSheet(parsed, parsed.SheetNames[0])
    assert.equal(sheet.rows[0].c0, '<img src=x onerror=alert(1)>')
    assert.equal(sheet.rows[0].c1, '42')
    assert.equal(sheet.rows[0].rowLabel, 1)
    assert.equal(sheet.rows[1].c0, '')
  })
}

test('TSV treats formula-looking and HTML-looking cells as text', () => {
  const parsed = parseWorkbook(new TextEncoder().encode('<b>unsafe</b>\t=1+1\nnext\t42'), 'sample.tsv')
  assert.equal(gridSheet(parsed, 'Sheet1').rows[0].c0, '<b>unsafe</b>')
  assert.equal(gridSheet(parsed, 'Sheet1').rows[0].c1, '=1+1')
})

test('multiple sheets and truncated ranges retain coordinates', () => {
  const parsed = parseWorkbook(write(workbook, { type: 'buffer', bookType: 'xlsx' }))
  assert.deepEqual(parsed.SheetNames, ['Data', '中文'])
  assert.equal(gridSheet(parsed, '中文').rows[0].c0, '第二页')
  const offset = utils.book_new()
  const offsetSheet = utils.aoa_to_sheet([['last']], { origin: 'C3' })
  offsetSheet['!ref'] = 'C3:C3'
  utils.book_append_sheet(offset, offsetSheet, 'offset')
  const data = gridSheet(offset, 'offset')
  assert.equal(data.rows[0].rowLabel, 3)
  assert.deepEqual(data.columns, ['C'])
  assert.equal(data.rows[0].c0, 'last')
})

class Request extends PassThrough {
  constructor(path, headers = {}) {
    super()
    this.method = 'POST'; this.url = '/dock-spreadsheet/read'
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

async function handle(path, headers) {
  let handler
  const ctx = {
    webRuntime: { trustedHosts: [] },
    webServer: { register({ handler: h }) { handler = h; return () => {} } },
    effect(register) { register() },
  }
  apply(ctx)
  const res = new Response()
  await handler(new Request(path, headers), res)
  return res
}

test('browser bundle loads with platform React only and registers viewer', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  let plugin
  runInNewContext(source, {
    document: { createElement() { return { classList: { add() {} }, setAttribute() {} } } },
    window: { __ModuleLoader__: { load(entry) { plugin = entry.factory((id) => {
      assert.equal(id, 'react', `unexpected external browser require: ${id}`)
      return React
    }) } } },
  })
  assert.ok(plugin)
  const registry = []
  const ctx = {
    get(name) { return name === 'files'
      ? { registerFileViewer(def) { registry.push(def); return () => {} } }
      : { registerPlugin() { return () => {} }, registerEditorView(def) { registry.push(def); return () => {} } } },
    effect(register) { register() },
  }
  plugin.apply(ctx)
  assert.deepEqual(Array.from(registry[0].exts), ['xlsx', 'xls', 'ods', 'csv', 'tsv'])
  assert.equal(registry[1].id, 'spreadsheet')
})

test('host serves raw spreadsheet bytes and refuses cross-site requests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dock-spreadsheet-'))
  try {
    const path = join(dir, 'test.xlsx')
    const payload = write(workbook, { type: 'buffer', bookType: 'xlsx' })
    await writeFile(path, payload)
    assert.deepEqual(await readSpreadsheet(path), payload)
    const ok = await handle(path)
    assert.equal(ok.status, 200)
    assert.equal(ok.headers['content-type'], 'application/octet-stream')
    assert.equal(read(ok.body, { type: 'buffer' }).SheetNames.length, 2)
    assert.equal((await handle(path, { 'sec-fetch-site': 'cross-site' })).status, 403)
    assert.equal((await handle(join(dir, 'test.exe'))).status, 400)
    assert.equal((await handle('relative.xlsx')).status, 400)
    const oversized = join(dir, 'large.xlsx')
    await writeFile(oversized, Buffer.alloc(MAX_FILE_BYTES + 1))
    assert.equal((await handle(oversized)).status, 413)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
