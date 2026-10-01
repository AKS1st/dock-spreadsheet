import { createElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { TabulatorFull as Tabulator, type CellComponent, type ColumnDefinition } from 'tabulator-tables'
import tabulatorCss from './tabulator-css.generated.ts'
import { viewerCss } from './styles.ts'
import { gridSheet, MAX_COLUMNS, MAX_ROWS, parseWorkbook } from './workbook.ts'
import { splitLinks } from './links.ts'
import type { ViewProps } from './contract.ts'
import type { WorkBook } from 'xlsx'

interface Seed { path?: string; title?: string }
interface ReadError { error?: { message?: string } }
interface SelectedCell { address: string; value: string }
const styleId = 'dock-spreadsheet-styles'
let styleUsers = 0
function mountStyles(): () => void {
  if (styleUsers++ === 0) {
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = tabulatorCss + viewerCss
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

/**
 * Render a cell as text nodes, turning detected URLs into anchors. Nodes are
 * built with `textContent`, never `innerHTML`, so workbook content still cannot
 * become markup.
 *
 * Each anchor owns its click handler: Tabulator only routes its column-level
 * `cellClick` callback through the edit flow, which a read-only grid never
 * enters. The handler opens the URL for Ctrl/⌘+click and swallows a plain click
 * so the anchor never navigates on its own.
 */
function linkFormatter(cell: CellComponent): HTMLElement {
  const wrapper = document.createElement('span')
  wrapper.className = 'ds-cell'
  for (const segment of splitLinks(String(cell.getValue() ?? ''))) {
    if (segment.url === undefined) {
      wrapper.append(document.createTextNode(segment.text))
      continue
    }
    const anchor = document.createElement('a')
    anchor.className = 'ds-url'
    anchor.href = segment.url
    anchor.target = '_blank'
    anchor.rel = 'noopener noreferrer'
    anchor.textContent = segment.text
    anchor.title = `Ctrl/⌘+点击打开：${segment.url}`
    anchor.addEventListener('click', (event) => {
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) window.open(anchor.href, '_blank', 'noopener,noreferrer')
    })
    wrapper.append(anchor)
  }
  return wrapper
}

export function SpreadsheetView({ seed }: ViewProps): ReactNode {
  const { path, title } = (seed ?? {}) as Seed
  const [book, setBook] = useState<WorkBook | null>(null)
  const [sheetName, setSheetName] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [filtersVisible, setFiltersVisible] = useState(false)
  const [selected, setSelected] = useState<SelectedCell | null>(null)
  const [visibleRows, setVisibleRows] = useState(0)
  const gridRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<Tabulator | null>(null)
  const selectedElementRef = useRef<HTMLElement | null>(null)
  // Tabulator rejects and mis-applies filters before initialization, so the
  // latest search term is retained and re-applied once the table is ready.
  const termRef = useRef('')
  const sheet = useMemo(() => book && sheetName ? gridSheet(book, sheetName) : null, [book, sheetName])

  useEffect(mountStyles, [])
  useEffect(() => {
    setBook(null); setSheetName(''); setQuery(''); setError(''); setFiltersVisible(false); setSelected(null); setVisibleRows(0)
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
    selectedElementRef.current = null
    setSelected(null)
    setVisibleRows(sheet.rows.length)
    const columns: ColumnDefinition[] = [
      { title: '#', field: 'rowLabel', width: 65, frozen: true, hozAlign: 'right', headerSort: false },
      ...sheet.columns.map((letter, index) => ({
        title: letter, field: `c${index}`, minWidth: 110, width: 160,
        sorter: 'string' as const, headerFilter: 'input' as const, formatter: linkFormatter,
      })),
    ]
    const table = new Tabulator(element, {
      data: sheet.rows, columns, layout: 'fitData', height: '100%',
      placeholder: '工作表为空', movableColumns: false,
    })
    tableRef.current = table
    table.on('tableBuilt', () => applyTerm(table, termRef.current))
    table.on('dataFiltered', (_filters, rows) => setVisibleRows(rows.length))
    // Virtual scrolling can recycle a selected DOM cell for another row. Drop
    // only its border on redraw; the inspector keeps the last selected value.
    table.on('renderStarted', () => {
      selectedElementRef.current?.classList.remove('ds-selected-cell')
      selectedElementRef.current = null
    })
    table.on('cellClick', (_event, cell) => {
      const field = cell.getColumn().getField()
      if (!field?.startsWith('c')) return
      const index = Number(field.slice(1))
      const letter = sheet.columns[index]
      if (letter === undefined) return
      selectedElementRef.current?.classList.remove('ds-selected-cell')
      const cellElement = cell.getElement()
      cellElement.classList.add('ds-selected-cell')
      selectedElementRef.current = cellElement
      const row = cell.getRow().getData() as Record<string, unknown>
      setSelected({ address: `${letter}${row.rowLabel}`, value: String(cell.getValue() ?? '') })
    })
    return () => { tableRef.current = null; selectedElementRef.current = null; table.destroy() }
  }, [sheet])

  useEffect(() => {
    const table = tableRef.current
    if (!table || !isReady(table)) return
    if (!filtersVisible) table.clearHeaderFilter()
    table.redraw(true)
  }, [filtersVisible])

  useEffect(() => {
    const term = query.trim().toLocaleLowerCase()
    termRef.current = term
    const table = tableRef.current
    if (table) applyTerm(table, term)
  }, [query, sheet])

  return createElement('div', { className: `ds-sheet${filtersVisible ? ' ds-filtering' : ''}` },
    createElement('div', { className: 'ds-sheet-head' },
      createElement('span', { className: 'ds-sheet-filemark', 'aria-hidden': true }, '▦'),
      createElement('span', { className: 'ds-sheet-title', title: path }, title ?? path ?? 'Spreadsheet'),
      createElement('span', { className: 'ds-sheet-readonly' }, '只读预览'),
    ),
    createElement('div', { className: 'ds-sheet-tools' },
      createElement('div', { className: 'ds-sheet-search-wrap' },
        createElement('span', { className: 'ds-sheet-search-icon', 'aria-hidden': true }, '⌕'),
        createElement('input', { type: 'search', className: 'ds-sheet-search', placeholder: '搜索当前工作表…', 'aria-label': '搜索单元格', value: query,
          onChange: (event: { currentTarget: HTMLInputElement }) => setQuery(event.currentTarget.value), disabled: !sheet }),
      ),
      createElement('button', { type: 'button', className: 'ds-sheet-tool', 'aria-pressed': filtersVisible, disabled: !sheet,
        onClick: () => setFiltersVisible((visible) => !visible) }, '筛选列'),
      createElement('span', { className: 'ds-sheet-hint' }, '点击单元格查看内容'),
    ),
    createElement('div', { className: 'ds-sheet-inspector', 'aria-label': '选中单元格' },
      createElement('span', { className: 'ds-sheet-address', 'aria-label': '单元格坐标' }, selected?.address ?? '—'),
      createElement('span', { className: `ds-sheet-value${selected ? '' : ' is-empty'}`, title: selected?.value ?? '' },
        selected?.value ?? '选择单元格以查看完整内容'),
    ),
    error ? createElement('div', { className: 'ds-sheet-message', role: 'alert' }, error)
      : loading ? createElement('div', { className: 'ds-sheet-message' }, '正在读取表格…')
        : book && (!sheet || sheet.columns.length === 0) ? createElement('div', { className: 'ds-sheet-message' }, '工作表为空') : null,
    createElement('div', { className: 'ds-sheet-grid', ref: gridRef, style: { display: sheet && sheet.columns.length > 0 && !error ? 'block' : 'none' } }),
    createElement('div', { className: 'ds-sheet-footer' },
      createElement('div', { className: 'ds-sheet-tabs', role: 'tablist', 'aria-label': '工作表' },
        ...(book?.SheetNames ?? []).map((name) => createElement('button', {
          key: name, type: 'button', role: 'tab', className: 'ds-sheet-tab', 'aria-selected': sheetName === name,
          tabIndex: sheetName === name ? 0 : -1, title: name, onClick: () => setSheetName(name),
          onKeyDown: (event: { key: string; preventDefault(): void; currentTarget: HTMLButtonElement }) => {
            const names = book?.SheetNames ?? []
            const index = names.indexOf(name)
            const next = event.key === 'ArrowRight' ? (index + 1) % names.length
              : event.key === 'ArrowLeft' ? (index - 1 + names.length) % names.length
                : event.key === 'Home' ? 0 : event.key === 'End' ? names.length - 1 : -1
            if (next < 0 || next === index) return
            event.preventDefault()
            const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('.ds-sheet-tab')
            buttons?.[next]?.focus()
            setSheetName(names[next] ?? name)
          },
        }, name)),
      ),
      sheet ? createElement('span', { className: 'ds-sheet-status', title: sheet.truncated ? `仅预览前 ${MAX_ROWS} 行 / ${MAX_COLUMNS} 列` : undefined },
        `${visibleRows} / ${sheet.rows.length} 行 · ${sheet.columns.length} 列${sheet.truncated ? ' · 预览受限' : ''}`) : null,
    ),
  )
}
