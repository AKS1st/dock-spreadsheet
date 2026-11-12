import { read, utils, SSF, type CellObject, type WorkBook, type WorkSheet } from 'xlsx'
import Papa from 'papaparse'

export const MAX_ROWS = 5000
export const MAX_COLUMNS = 256

/** The visual/semantic class of a cell, used for alignment and sorting. */
export type CellKind = 'number' | 'date' | 'text' | 'error' | 'boolean' | 'blank'

/** One parsed cell: display text plus the metadata SheetJS can expose. */
export interface CellData {
  /** Formatted text shown in the grid (`cell.w`, or a string fallback). */
  text: string
  /** Raw value used for sorting and filtering (`cell.v`). */
  raw?: string | number | boolean
  /** Formula text without the leading `=`, when the cell has one. */
  formula?: string
  /** True when the formula has no cached result (program-generated workbooks). */
  noCache?: boolean
  kind: CellKind
  /** Solid fill background as `#rrggbb`, when the file stores one. */
  fill?: string
  /** Hyperlink target from the cell object (not text detection). */
  link?: string
  /** Plain text of the first comment/note on the cell. */
  comment?: string
  /** True for a merged cell other than its top-left anchor. */
  covered?: boolean
  /** The full merged range (e.g. `A1:C1`) on the top-left anchor only. */
  mergeRange?: string
}

export interface GridRow {
  /** Absolute 1-based Excel row number. */
  rowLabel: number
  cells: CellData[]
  /** Whether the source workbook marks this row hidden. */
  hidden: boolean
}

export interface SheetInfo {
  name: string
  hidden: boolean
}

export interface GridSheet {
  name: string
  /** Column letters, aligned with `GridRow.cells` and `widths`. */
  columns: string[]
  rows: GridRow[]
  widths: (number | undefined)[]
  /** Whether each source column is hidden. */
  hiddenColumns: boolean[]
  truncated: boolean
  totalRows: number
  totalCols: number
  formulaCount: number
  noCacheCount: number
  hiddenRowCount: number
  hiddenColumnCount: number
}

export type ColumnKind = 'number' | 'date' | 'text'

interface ReadCell {
  t?: string
  v?: unknown
  w?: string
  f?: string
  z?: string
  s?: { patternType?: string; fgColor?: { rgb?: string; theme?: number; tint?: number } }
  c?: { t?: string }[]
  l?: { Target?: string }
}

const NUMERIC_Z = /^[#0?,.%E+\-() ]+$/i

function cellText(cell: ReadCell): string {
  if (typeof cell.w === 'string' && cell.w !== '') return cell.w
  if (cell.v === undefined || cell.v === null) return ''
  return String(cell.v)
}

function solidFill(cell: ReadCell): string | undefined {
  const pattern = cell.s
  if (pattern?.patternType !== 'solid') return undefined
  const rgb = pattern.fgColor?.rgb
  if (typeof rgb !== 'string') return undefined
  if (/^[0-9a-f]{8}$/i.test(rgb)) return `#${rgb.slice(2)}`
  if (/^[0-9a-f]{6}$/i.test(rgb)) return `#${rgb}`
  return undefined
}

function kindOf(cell: ReadCell): CellKind {
  if (cell.t === 'e') return 'error'
  if (cell.t === 'b') return 'boolean'
  if (cell.t === 'd') return 'date'
  if (cell.t === 'n') {
    const format = typeof cell.z === 'string' ? cell.z : ''
    if (format !== '' && SSF.is_date(format)) return 'date'
    if (format === '' || NUMERIC_Z.test(format)) return 'number'
    return 'number'
  }
  if (cell.t === 's') return 'text'
  if (cell.f !== undefined) return 'number'
  return 'blank'
}

/**
 * Decode delimited text. Supports UTF-8 (with or without BOM), UTF-16 with a
 * BOM, and falls back to GBK for Windows-produced CSV files. Throws a
 * user-facing error when no decoder fits.
 */
function decodeDelimited(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(3))
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2))
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be', { fatal: true }).decode(bytes.subarray(2))
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    try {
      return new TextDecoder('gbk', { fatal: true }).decode(bytes)
    } catch {
      throw new Error('无法识别此文本文件的编码，请另存为 UTF-8 或带 BOM 的 UTF-16 后重试')
    }
  }
}

/** Guess the delimiter from the first lines; unknown files fall back to the extension default. */
function detectDelimiter(text: string, filename: string): string {
  const fallback = /\.tsv$/i.test(filename) ? '\t' : ','
  const lines = text.split(/\r?\n/).slice(0, 20).filter((line) => line.trim() !== '')
  if (lines.length === 0) return fallback
  const candidates = ['\t', ',', ';', '|']
  let best = fallback
  let bestScore = 1
  for (const candidate of candidates) {
    const counts = lines.map((line) => line.split(candidate).length)
    const min = Math.min(...counts)
    if (min <= 1) continue
    const score = min
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }
  return best
}

/** Parse a workbook from raw bytes. Spreadsheets go through SheetJS with the
 * metadata options the viewer needs; CSV/TSV go through Papa Parse. */
export function parseWorkbook(bytes: ArrayBuffer | Uint8Array, filename = ''): WorkBook {
  if (/\.(?:csv|tsv)$/i.test(filename)) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    const text = decodeDelimited(view)
    const delimiter = detectDelimiter(text, filename)
    const parsed = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: false })
    if (parsed.errors.length) throw new Error(`分隔文本格式错误：${parsed.errors[0]?.message ?? '未知错误'}`)
    const book = utils.book_new()
    utils.book_append_sheet(book, utils.aoa_to_sheet(parsed.data), 'Sheet1')
    return book
  }
  return read(bytes, {
    type: 'array', dense: true, cellText: true, cellDates: false,
    cellStyles: true, cellNF: true,
  })
}

/** Sheet names plus the workbook's hidden/veryHidden state. */
export function sheetInfos(book: WorkBook): SheetInfo[] {
  const metadata = (book as unknown as { Workbook?: { Sheets?: { name?: string; Hidden?: number }[] } }).Workbook?.Sheets
  return book.SheetNames.map((name, index) => ({ name, hidden: (metadata?.[index]?.Hidden ?? 0) !== 0 }))
}

function readCell(sheet: WorkSheet, data: CellObject[][] | undefined, row: number, col: number): ReadCell | undefined {
  if (data !== undefined) return data[row]?.[col] as ReadCell | undefined
  return sheet[utils.encode_cell({ r: row, c: col })] as ReadCell | undefined
}

/** Build the display model for one worksheet, clipped to the preview limits. */
export function gridSheet(book: WorkBook, name: string): GridSheet {
  const sheet = book.Sheets[name]
  if (!sheet) throw new Error('工作表不存在')
  const reference = sheet['!ref']
  if (!reference) {
    return {
      name, columns: [], rows: [], widths: [], hiddenColumns: [], truncated: false,
      totalRows: 0, totalCols: 0, formulaCount: 0, noCacheCount: 0, hiddenRowCount: 0, hiddenColumnCount: 0,
    }
  }
  const range = utils.decode_range(reference)
  const data = (sheet as unknown as { '!data'?: CellObject[][] })['!data']
  const lastRow = Math.min(range.e.r, range.s.r + MAX_ROWS - 1)
  const lastCol = Math.min(range.e.c, range.s.c + MAX_COLUMNS - 1)
  const columns = Array.from({ length: lastCol - range.s.c + 1 }, (_, index) => utils.encode_col(range.s.c + index))
  const rowMeta = (sheet['!rows'] ?? []) as { hidden?: boolean; hpx?: number; hpt?: number }[]
  const colMeta = (sheet['!cols'] ?? []) as { hidden?: boolean; wpx?: number; wch?: number; width?: number }[]

  // Merged cells: mark the anchor and cover the rest so the grid does not show
  // a value in every covered cell.
  const anchors = new Map<string, string>()
  const covered = new Set<string>()
  const merges = (sheet['!merges'] ?? []) as { s: { r: number; c: number }; e: { r: number; c: number } }[]
  for (const merge of merges) {
    const r1 = Math.max(merge.s.r, range.s.r)
    const c1 = Math.max(merge.s.c, range.s.c)
    const r2 = Math.min(merge.e.r, lastRow)
    const c2 = Math.min(merge.e.c, lastCol)
    if (r2 < r1 || c2 < c1) continue
    const label = `${utils.encode_cell({ r: merge.s.r, c: merge.s.c })}:${utils.encode_cell({ r: merge.e.r, c: merge.e.c })}`
    anchors.set(`${r1}:${c1}`, label)
    for (let r = r1; r <= r2; r += 1) {
      for (let c = c1; c <= c2; c += 1) {
        if (r !== r1 || c !== c1) covered.add(`${r}:${c}`)
      }
    }
  }

  let formulaCount = 0
  let noCacheCount = 0
  const rows: GridRow[] = []
  for (let row = range.s.r; row <= lastRow; row += 1) {
    const cells: CellData[] = []
    for (let col = range.s.c; col <= lastCol; col += 1) {
      const cell = readCell(sheet, data, row, col)
      const key = `${row}:${col}`
      const anchorRange = anchors.get(key)
      if (cell === undefined) {
        cells.push({ text: '', kind: 'blank', covered: covered.has(key), mergeRange: anchorRange })
        continue
      }
      const kind = kindOf(cell)
      const formula = typeof cell.f === 'string' && cell.f !== '' ? `=${cell.f.replace(/^=/, '')}` : undefined
      const noCache = formula !== undefined && (cell.v === undefined || cell.v === null || cell.t === 'z')
      if (formula !== undefined) formulaCount += 1
      if (noCache) noCacheCount += 1
      cells.push({
        text: noCache ? formula ?? '' : cellText(cell),
        raw: typeof cell.v === 'string' || typeof cell.v === 'number' || typeof cell.v === 'boolean' ? cell.v : undefined,
        formula,
        noCache: noCache || undefined,
        kind,
        fill: solidFill(cell),
        link: typeof cell.l?.Target === 'string' ? cell.l.Target : undefined,
        comment: typeof cell.c?.[0]?.t === 'string' ? cell.c[0].t : undefined,
        covered: covered.has(key) || undefined,
        mergeRange: anchorRange,
      })
    }
    rows.push({ rowLabel: row + 1, cells, hidden: rowMeta[row]?.hidden === true })
  }

  const widths = columns.map((_, index) => {
    const meta = colMeta[range.s.c + index]
    if (meta?.wpx !== undefined) return Math.max(60, Math.round(meta.wpx))
    if (meta?.wch !== undefined) return Math.max(60, Math.round(meta.wch * 7 + 5))
    if (meta?.width !== undefined) return Math.max(60, Math.round(meta.width * 7 + 5))
    return undefined
  })
  const hiddenColumns = columns.map((_, index) => colMeta[range.s.c + index]?.hidden === true)

  return {
    name,
    columns,
    rows,
    widths,
    hiddenColumns,
    truncated: range.e.r > lastRow || range.e.c > lastCol,
    totalRows: range.e.r - range.s.r + 1,
    totalCols: range.e.c - range.s.c + 1,
    formulaCount,
    noCacheCount,
    hiddenRowCount: rows.filter((row) => row.hidden).length,
    hiddenColumnCount: hiddenColumns.filter(Boolean).length,
  }
}

/** Column sorting kind, inferred from the first rows. */
export function columnKinds(sheet: GridSheet): ColumnKind[] {
  return sheet.columns.map((_, column) => {
    let numbers = 0
    let dates = 0
    let texts = 0
    for (const row of sheet.rows.slice(0, 200)) {
      const cell = row.cells[column]
      if (cell === undefined || cell.kind === 'blank') continue
      if (cell.kind === 'number') numbers += 1
      else if (cell.kind === 'date') dates += 1
      else if (cell.kind === 'text' && cell.text.trim() !== '') texts += 1
    }
    if (dates > 0 && dates >= numbers && dates >= texts) return 'date'
    if (numbers > 0 && numbers >= texts) return 'number'
    return 'text'
  })
}
