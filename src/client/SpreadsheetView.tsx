import { createElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { TabulatorFull as Tabulator, type ColumnDefinition } from 'tabulator-tables'
import tabulatorCss from './tabulator-css.generated.ts'
import { gridSheet, MAX_COLUMNS, MAX_ROWS, parseWorkbook } from './workbook.ts'
import type { ViewProps } from './contract.ts'
import type { WorkBook } from 'xlsx'

interface Seed { path?: string; title?: string }
interface ReadError { error?: { message?: string } }
const styleId = 'dock-spreadsheet-styles'
const ownCss = `
.ds-sheet { display:flex; flex-direction:column; height:100%; min-height:0; overflow:hidden; background:var(--dsw-alias-fill-primary,#fff); color:var(--dsw-alias-label-primary,#24292f); font:12px sans-serif }
.ds-sheet-head { display:flex; align-items:center; flex-wrap:wrap; gap:8px; padding:8px; border-bottom:1px solid #8886; flex:none }
.ds-sheet-title { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:35%; }
.ds-sheet-search { background:var(--dsw-alias-fill-control,#fff); color:inherit; border:1px solid #8888; border-radius:4px; padding:4px 6px; flex:1; min-width:110px; max-width:240px }
.ds-sheet-search:disabled { opacity:.6 }
.ds-sheet-grid { flex:1; min-height:0; overflow:hidden }
.ds-sheet .tabulator { height:100%; background:transparent; color:inherit }
.ds-sheet .tabulator-header,.ds-sheet .tabulator-row { background:var(--dsw-alias-fill-primary,#fff); color:inherit }
.ds-sheet .tabulator-row:nth-child(even) { background:var(--dsw-alias-fill-control,#f4f4f4) }
.ds-sheet-message { padding:16px; overflow:auto }
`
let styleUsers = 0
function mountStyles(): () => void {
  if (styleUsers++ === 0) {
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = tabulatorCss + ownCss
    document.head.append(style)
  }
  return () => { if (--styleUsers === 0) document.getElementById(styleId)?.remove() }
}

/** Tabulator warns and filters inconsistently before its initialization pass. */
function isReady(table: Tabulator): boolean {
  return (table as Tabulator & { initialized?: boolean }).initialized === true
}

/**
 * Apply the search term as a row filter over all data columns (empty clears it).
 * A table that has not finished building is left untouched; the mount effect
 * re-applies the retained term from the `tableBuilt` event, so the term is never
 * silently dropped whichever of the two happens last.
 */
function applyTerm(table: Tabulator, term: string): void {
  if (!isReady(table)) return
  if (term === '') {
    table.clearFilter(false)
    return
  }
  table.setFilter((row: Record<string, unknown>) =>
    Object.entries(row).some(([key, value]) => key !== 'rowLabel' && String(value).toLocaleLowerCase().includes(term)))
}

export function SpreadsheetView({ seed }: ViewProps): ReactNode {
  const { path, title } = (seed ?? {}) as Seed
  const [book, setBook] = useState<WorkBook | null>(null)
  const [sheetName, setSheetName] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<Tabulator | null>(null)
  // Tabulator rejects and mis-applies filters before initialization, so the
  // latest search term is retained and re-applied once the table is ready.
  const termRef = useRef('')
  const sheet = useMemo(() => book && sheetName ? gridSheet(book, sheetName) : null, [book, sheetName])

  useEffect(mountStyles, [])
  useEffect(() => {
    setBook(null); setSheetName(''); setQuery(''); setError('')
    if (!path) { setError('未指定表格文件'); return }
    const controller = new AbortController()
    setLoading(true)
    void (async () => {
      try {
        const response = await fetch('/dock-spreadsheet/read', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path }), signal: controller.signal,
        })
        if (!response.ok) {
          const result = await response.json() as ReadError
          throw new Error(result.error?.message ?? `读取失败 (${response.status})`)
        }
        const parsed = parseWorkbook(await response.arrayBuffer(), path)
        if (controller.signal.aborted) return
        setBook(parsed)
        setSheetName(parsed.SheetNames[0] ?? '')
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
      } finally { if (!controller.signal.aborted) setLoading(false) }
    })()
    return () => controller.abort()
  }, [path])

  useEffect(() => {
    const element = gridRef.current
    if (!element || !sheet || sheet.columns.length === 0) return
    const columns: ColumnDefinition[] = [
      { title: '#', field: 'rowLabel', width: 65, frozen: true, hozAlign: 'right', headerSort: false },
      ...sheet.columns.map((letter, index) => ({
        title: letter, field: `c${index}`, minWidth: 110, width: 160,
        sorter: 'string' as const, headerFilter: 'input' as const, formatter: 'plaintext' as const,
      })),
    ]
    const table = new Tabulator(element, {
      data: sheet.rows, columns, layout: 'fitData', height: '100%',
      placeholder: '工作表为空', movableColumns: false,
    })
    tableRef.current = table
    table.on('tableBuilt', () => applyTerm(table, termRef.current))
    return () => { tableRef.current = null; table.destroy() }
  }, [sheet])

  useEffect(() => {
    const term = query.trim().toLocaleLowerCase()
    termRef.current = term
    const table = tableRef.current
    if (table) applyTerm(table, term)
  }, [query, sheet])

  return createElement('div', { className: 'ds-sheet' },
    createElement('div', { className: 'ds-sheet-head' },
      createElement('span', { className: 'ds-sheet-title', title: path }, title ?? path ?? 'Spreadsheet'),
      book && book.SheetNames.length > 0 ? createElement('select', {
        value: sheetName, 'aria-label': '工作表', onChange: (event: { currentTarget: HTMLSelectElement }) => setSheetName(event.currentTarget.value),
      }, ...book.SheetNames.map((name) => createElement('option', { key: name, value: name }, name))) : null,
      createElement('input', { type: 'search', className: 'ds-sheet-search', placeholder: '搜索单元格…', 'aria-label': '搜索单元格', value: query,
        onChange: (event: { currentTarget: HTMLInputElement }) => setQuery(event.currentTarget.value), disabled: !sheet }),
      sheet?.truncated ? createElement('span', { title: '超出预览范围的数据未显示' }, `仅预览前 ${MAX_ROWS} 行 / ${MAX_COLUMNS} 列`) : null,
    ),
    error ? createElement('div', { className: 'ds-sheet-message', role: 'alert' }, error)
      : loading ? createElement('div', { className: 'ds-sheet-message' }, '正在读取表格…')
        : book && (!sheet || sheet.columns.length === 0) ? createElement('div', { className: 'ds-sheet-message' }, '工作表为空') : null,
    createElement('div', { className: 'ds-sheet-grid', ref: gridRef, style: { display: sheet && sheet.columns.length > 0 && !error ? 'block' : 'none' } }),
  )
}
