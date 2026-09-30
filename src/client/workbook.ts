import { read, utils, type WorkBook } from 'xlsx'
import Papa from 'papaparse'

export const MAX_ROWS = 5000
export const MAX_COLUMNS = 256
export interface GridSheet {
  name: string
  columns: string[]
  rows: Record<string, string | number>[]
  truncated: boolean
}

export function parseWorkbook(bytes: ArrayBuffer | Uint8Array, filename = ''): WorkBook {
  if (/\.(?:csv|tsv)$/i.test(filename)) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')
    const delimiter = /\.tsv$/i.test(filename) ? '\t' : ','
    const parsed = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: false })
    if (parsed.errors.length) throw new Error(`分隔文本格式错误：${parsed.errors[0]?.message}`)
    const book = utils.book_new()
    utils.book_append_sheet(book, utils.aoa_to_sheet(parsed.data), 'Sheet1')
    return book
  }
  return read(bytes, { type: 'array', dense: true, cellText: true, cellDates: false })
}

/** Preserve spreadsheet coordinates: first row is data, never inferred headers. */
export function gridSheet(book: WorkBook, name: string): GridSheet {
  const sheet = book.Sheets[name]
  if (!sheet) throw new Error('工作表不存在')
  const reference = sheet['!ref']
  if (!reference) return { name, columns: [], rows: [], truncated: false }
  const range = utils.decode_range(reference)
  const lastRow = Math.min(range.e.r, range.s.r + MAX_ROWS - 1)
  const lastColumn = Math.min(range.e.c, range.s.c + MAX_COLUMNS - 1)
  const values = utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1, defval: '', raw: false,
    range: { s: range.s, e: { r: lastRow, c: lastColumn } },
  })
  const columns = Array.from({ length: lastColumn - range.s.c + 1 }, (_, index) => utils.encode_col(range.s.c + index))
  const rows = values.map((valuesRow, index) => {
    const row: Record<string, string | number> = { rowLabel: range.s.r + index + 1 }
    columns.forEach((_, column) => { row[`c${column}`] = String(valuesRow?.[column] ?? '') })
    return row
  })
  return { name, columns, rows, truncated: range.e.r > lastRow || range.e.c > lastColumn }
}
