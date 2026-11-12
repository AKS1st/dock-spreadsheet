import { createElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { TabulatorFull as Tabulator, type CellComponent, type ColumnDefinition } from 'tabulator-tables'
import tabulatorCss from './tabulator-css.generated.ts'
import { viewerCss } from './styles.ts'
import {
  columnKinds, gridSheet, MAX_COLUMNS, MAX_ROWS, parseWorkbook, sheetInfos,
  type CellData, type GridSheet, type SheetInfo,
} from './workbook.ts'
import { splitLinks } from './links.ts'
import type { ViewProps } from './contract.ts'
import type { WorkBook } from 'xlsx'

interface Seed { path?: string; title?: string }
interface ReadError { error?: { message?: string } }
interface StatResult { mtimeMs: number; size: number }
interface SelectedCell {
  address: string
  text: string
  formula?: string
  noCache?: boolean
  comment?: string
  mergeRange?: string
}
type TableRow = { rowLabel: number; __cells: CellData[]; [field: string]: unknown }
interface RangeLike { getCells(): CellComponent[][] }
interface ColumnLike { getField(): string; isVisible(): boolean; getDefinition(): { title?: unknown } }
interface TabulatorExtras {
  getRanges?(): RangeLike[]
  getColumns?(): ColumnLike[]
  download?(format: string, filename: string): void
}
type ExtendedTable = Tabulator & TabulatorExtras
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

/** Apply the search term to the parsed cell texts, not the raw sort values. */
function applyTerm(table: Tabulator, term: string): void {
  if (!isReady(table)) return
  if (term === '') { table.clearFilter(false); return }
  table.setFilter((row: TableRow) => (row.__cells ?? []).some((cell) => cell.text.toLocaleLowerCase().includes(term)))
}

function escapeCell(value: string): string {
  if (value === '') return ''
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function writeClipboard(text: string, html?: string): Promise<boolean> {
  try {
    const clipboard = navigator.clipboard
    if (clipboard !== undefined) {
      if (html !== undefined && typeof ClipboardItem !== 'undefined') {
        await clipboard.write([new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        })])
        return true
      }
      if (typeof clipboard.writeText === 'function') {
        await clipboard.writeText(text)
        return true
      }
    }
  } catch { /* fall through to the textarea fallback */ }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    const copied = document.execCommand('copy')
    area.remove()
    return copied
  } catch { return false }
}

async function readStat(path: string): Promise<StatResult | null> {
  try {
    const response = await fetch('/dock-spreadsheet/stat', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }),
    })
    if (!response.ok) return null
    const result = await response.json() as { ok?: boolean; value?: StatResult }
    if (result.ok !== true || result.value === undefined) return null
    return result.value
  } catch { return null }
}

/** Render one cell: text, detected URL anchors, fill colour and formula marks. */
function cellFormatter(index: number) {
  return (cell: CellComponent): HTMLElement => {
    const row = cell.getRow().getData() as TableRow
    const meta = row.__cells?.[index]
    const wrapper = document.createElement('span')
    wrapper.className = 'ds-cell'
    if (meta === undefined) return wrapper
    if (meta.covered) { wrapper.classList.add('ds-covered'); return wrapper }
    const cellElement = cell.getElement()
    cellElement.style.backgroundColor = meta.fill ?? ''
    if (meta.mergeRange !== undefined) wrapper.classList.add('ds-merged-anchor')
    if (meta.kind === 'number' || meta.kind === 'date') wrapper.classList.add('ds-right')
    if (meta.kind === 'error') wrapper.classList.add('ds-error')
    if (meta.comment !== undefined) wrapper.title = `批注：${meta.comment}`
    if (meta.formula !== undefined) wrapper.title = `${meta.formula}${meta.noCache === true ? '（无缓存结果）' : ''}`
    if (meta.noCache === true) wrapper.classList.add('ds-nocache')
    const text = meta.text
    if (meta.link !== undefined && /^(?:https?:\/\/|www\.)/i.test(meta.link)) {
      wrapper.append(linkAnchor(meta.link, text))
      return wrapper
    }
    for (const segment of splitLinks(text)) {
      if (segment.url === undefined) { wrapper.append(document.createTextNode(segment.text)); continue }
      wrapper.append(linkAnchor(segment.url, segment.text))
    }
    return wrapper
  }
}

function linkAnchor(url: string, text: string): HTMLAnchorElement {
  const anchor = document.createElement('a')
  anchor.className = 'ds-url'
  anchor.href = url
  anchor.target = '_blank'
  anchor.rel = 'noopener noreferrer'
  anchor.textContent = text
  anchor.title = `Ctrl/⌘+点击打开：${url}`
  anchor.addEventListener('click', (event) => {
    event.preventDefault()
    if (event.ctrlKey || event.metaKey) window.open(anchor.href, '_blank', 'noopener,noreferrer')
  })
  return anchor
}

export function SpreadsheetView({ seed, active }: ViewProps): ReactNode {
  const { path, title } = (seed ?? {}) as Seed
  const [book, setBook] = useState<WorkBook | null>(null)
  const [infos, setInfos] = useState<SheetInfo[]>([])
  const [sheetName, setSheetName] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [filtersVisible, setFiltersVisible] = useState(false)
  const [showHiddenSheets, setShowHiddenSheets] = useState(false)
  const [showHiddenRows, setShowHiddenRows] = useState(false)
  const [showHiddenCols, setShowHiddenCols] = useState(false)
  const [selected, setSelected] = useState<SelectedCell | null>(null)
  const [visibleRows, setVisibleRows] = useState(0)
  const [visibleCols, setVisibleCols] = useState(0)
  const [reloadToken, setReloadToken] = useState(0)
  const [stale, setStale] = useState(false)
  const [status, setStatus] = useState('')
  const gridRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<ExtendedTable | null>(null)
  const termRef = useRef('')
  const pathRef = useRef<string | undefined>(undefined)
  const statRef = useRef<StatResult | null>(null)
  const timeoutRef = useRef<number | undefined>(undefined)
  const sheet = useMemo<GridSheet | null>(() => book && sheetName !== '' ? gridSheet(book, sheetName) : null, [book, sheetName])
  const hiddenSheetCount = useMemo(() => infos.filter((info) => info.hidden).length, [infos])
  const visibleSheetInfos = useMemo(() => infos.filter((info) => showHiddenSheets || !info.hidden), [infos, showHiddenSheets])

  useEffect(mountStyles, [])
  useEffect(() => () => { if (timeoutRef.current !== undefined) window.clearTimeout(timeoutRef.current) }, [])

  // Load one file; a reload token re-reads the same path on demand.
  useEffect(() => {
    const changed = pathRef.current !== path
    pathRef.current = path
    if (changed) {
      setBook(null); setInfos([]); setSheetName(''); setQuery(''); setError('')
      setFiltersVisible(false); setShowHiddenSheets(false); setShowHiddenRows(false); setShowHiddenCols(false)
      setSelected(null); setVisibleRows(0); setVisibleCols(0); setStale(false); statRef.current = null
    }
    if (path === undefined || path === '') { setError('未指定表格文件'); return }
    const controller = new AbortController()
    setLoading(true); setError('')
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
        const info = sheetInfos(parsed)
        setInfos(info)
        setSheetName((current) => {
          if (current !== '' && info.some((entry) => entry.name === current)) return current
          return info.find((entry) => !entry.hidden)?.name ?? info[0]?.name ?? ''
        })
        const nextStat = await readStat(path)
        if (!controller.signal.aborted) { statRef.current = nextStat; setStale(false) }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
      } finally { if (!controller.signal.aborted) setLoading(false) }
    })()
    return () => controller.abort()
  }, [path, reloadToken])

  // Keep the selected tab pointing at a sheet that is currently visible.
  useEffect(() => {
    if (book === null || sheetName === '' || infos.length === 0) return
    const current = infos.find((info) => info.name === sheetName)
    if (current === undefined || (current.hidden && !showHiddenSheets)) {
      setSheetName(infos.find((info) => !info.hidden)?.name ?? infos[0]?.name ?? '')
    }
  }, [book, infos, sheetName, showHiddenSheets])

  // Poll the host for the file's mtime; changing content shows a reload prompt
  // rather than replacing the reader's scroll position underneath them.
  useEffect(() => {
    if (path === undefined || path === '' || !active) return
    let disposed = false
    const timer = window.setInterval(() => {
      void (async () => {
        const next = await readStat(path)
        if (disposed || next === null) return
        if (statRef.current !== null && statRef.current.mtimeMs !== next.mtimeMs) setStale(true)
        statRef.current = next
      })()
    }, 4000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [path, active])

  // Build the grid for the selected sheet, honouring the hidden row/column toggles.
  useEffect(() => {
    const element = gridRef.current
    if (element === null || sheet === null || sheet.columns.length === 0) {
      tableRef.current?.destroy?.()
      tableRef.current = null
      setVisibleCols(0)
      return
    }
    const columnIndexes = sheet.columns.map((_, index) => index).filter((index) => showHiddenCols || !sheet.hiddenColumns[index])
    const rowIndexes = sheet.rows.map((row, index) => (showHiddenRows || !row.hidden ? index : -1)).filter((index) => index >= 0)
    setVisibleCols(columnIndexes.length)
    if (columnIndexes.length === 0) {
      tableRef.current?.destroy?.()
      tableRef.current = null
      return
    }
    const kinds = columnKinds(sheet)
    const columns: ColumnDefinition[] = [
      { title: '#', field: 'rowLabel', width: 65, hozAlign: 'right', headerSort: false },
      ...columnIndexes.map((index) => {
        const letter = sheet.columns[index]
        const width = sheet.widths[index] ?? 160
        return {
          title: letter, field: `c${index}`, minWidth: 60,
          width: Math.min(480, Math.max(60, width)),
          sorter: kinds[index] === 'text' ? 'string' : 'number',
          headerFilter: 'input', formatter: cellFormatter(index),
        } satisfies ColumnDefinition
      }),
    ]
    const rows: TableRow[] = rowIndexes.map((index) => {
      const row = sheet.rows[index]
      const data: TableRow = { rowLabel: row.rowLabel, __cells: row.cells }
      for (const column of columnIndexes) data[`c${column}`] = row.cells[column]?.raw ?? row.cells[column]?.text ?? ''
      return data
    })
    const table = new Tabulator(element, {
      data: rows, columns, layout: 'fitData', height: '100%',
      placeholder: '工作表为空', movableColumns: false,
      selectableRange: true, selectableRows: false, rowHeight: 29,
    }) as ExtendedTable
    tableRef.current = table
    setVisibleRows(rows.length)
    setSelected(null)
    table.on('tableBuilt', () => applyTerm(table, termRef.current))
    table.on('dataFiltered', (_filters, filtered) => setVisibleRows(filtered.length))
    table.on('cellClick', (_event, cell) => {
      const field = cell.getColumn().getField()
      if (typeof field !== 'string' || !field.startsWith('c')) return
      const index = Number(field.slice(1))
      const letter = sheet.columns[index]
      if (letter === undefined) return
      const row = cell.getRow().getData() as TableRow
      const meta = row.__cells?.[index]
      setSelected({
        address: `${letter}${row.rowLabel}`,
        text: meta?.text ?? '',
        formula: meta?.formula,
        noCache: meta?.noCache,
        comment: meta?.comment,
        mergeRange: meta?.mergeRange,
      })
    })
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        const target = event.target as HTMLElement | null
        if (target?.closest('.ds-sheet-inspector') != null) return
        event.preventDefault()
        void copySelection()
      }
    }
    element.addEventListener('keydown', onKeyDown)
    return () => {
      element.removeEventListener('keydown', onKeyDown)
      tableRef.current = null
      table.destroy()
    }
    // copySelection is stable; the grid rebuilds when these values change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, showHiddenRows, showHiddenCols])

  useEffect(() => {
    const table = tableRef.current
    if (table === null || !isReady(table)) return
    if (!filtersVisible) table.clearHeaderFilter()
    table.redraw(true)
  }, [filtersVisible])

  useEffect(() => {
    const term = query.trim().toLocaleLowerCase()
    termRef.current = term
    if (tableRef.current !== null) applyTerm(tableRef.current, term)
  }, [query, sheet])

  const flash = useCallback((message: string): void => {
    setStatus(message)
    if (timeoutRef.current !== undefined) window.clearTimeout(timeoutRef.current)
    timeoutRef.current = window.setTimeout(() => setStatus(''), 2500)
  }, [])

  const copySelection = useCallback(async (): Promise<void> => {
    const table = tableRef.current
    if (table === null || typeof table.getRanges !== 'function') { flash('没有可复制的选区'); return }
    const ranges = table.getRanges()
    if (ranges.length === 0) { flash('没有可复制的选区'); return }
    const cells = (ranges[0]?.getCells() ?? []) as unknown as CellComponent[][]
    if (cells.length === 0) { flash('没有可复制的选区'); return }
    const grid = cells.map((row) => row.map((cell: CellComponent) => {
      const field = cell.getColumn().getField() ?? ''
      const data = cell.getRow().getData() as TableRow
      if (field === 'rowLabel') return String(data.rowLabel)
      const index = Number(field.slice(1))
      return data.__cells?.[index]?.text ?? String(cell.getValue() ?? '')
    }))
    const tsv = grid.map((row) => row.map(escapeCell).join('\t')).join('\n')
    const html = `<table>${grid.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('')}</table>`
    const copied = await writeClipboard(tsv, html)
    flash(copied ? `已复制 ${grid.length} 行 × ${grid[0]?.length ?? 0} 列` : '复制失败，请检查剪贴板权限')
  }, [flash])

  const copyView = useCallback(async (): Promise<void> => {
    const table = tableRef.current
    if (table === null || typeof table.getColumns !== 'function') return
    const columns = table.getColumns().filter((column) => column.isVisible())
    const rows = table.getData('active') as TableRow[]
    const grid: string[][] = [
      columns.map((column) => String(column.getDefinition().title ?? '')),
      ...rows.map((row) => columns.map((column) => {
        const field = column.getField()
        if (field === 'rowLabel') return String(row.rowLabel)
        const index = Number(field.slice(1))
        return row.__cells?.[index]?.text ?? String(row[field] ?? '')
      })),
    ]
    const tsv = grid.map((row) => row.map(escapeCell).join('\t')).join('\n')
    const copied = await writeClipboard(tsv)
    flash(copied ? `已复制当前视图 ${rows.length} 行` : '复制失败，请检查剪贴板权限')
  }, [flash])

  const exportCsv = useCallback((): void => {
    const table = tableRef.current
    if (table === null || typeof table.download !== 'function') return
    const name = (title ?? path ?? 'spreadsheet').replace(/[/\\:*?"<>|]+/g, '-')
    table.download('csv', `${name}.csv`)
  }, [path, title])

  const reload = useCallback((): void => { setStale(false); setReloadToken((token) => token + 1) }, [])
  const retry = reload

  const copyPath = useCallback((): void => {
    if (path === undefined) return
    void writeClipboard(path).then((copied) => flash(copied ? '已复制文件路径' : '复制失败'))
  }, [flash, path])

  const selectSheet = useCallback((name: string): void => {
    setSheetName(name)
    setSelected(null)
  }, [])

  const onTabKeyDown = (event: { key: string; preventDefault(): void; currentTarget: HTMLButtonElement }, name: string): void => {
    const names = visibleSheetInfos.map((info) => info.name)
    const index = names.indexOf(name)
    const next = event.key === 'ArrowRight' ? (index + 1) % names.length
      : event.key === 'ArrowLeft' ? (index - 1 + names.length) % names.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? names.length - 1 : -1
    if (next < 0 || next === index) return
    event.preventDefault()
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('.ds-sheet-tab')
    buttons?.[next]?.focus()
    selectSheet(names[next] ?? name)
  }

  const hiddenSuffix = sheet !== null && sheet.truncated
    ? ` · 原表 ${sheet.totalRows} 行 × ${sheet.totalCols} 列，仅预览前 ${MAX_ROWS} 行 / ${MAX_COLUMNS} 列`
    : ''
  const statusText = sheet !== null
    ? `${visibleRows} / ${sheet.rows.length} 行 · ${visibleCols} 列${hiddenSuffix}`
    : ''

  return createElement('div', { className: `ds-sheet${filtersVisible ? ' ds-filtering' : ''}` },
    createElement('div', { className: 'ds-sheet-head' },
      createElement('span', { className: 'ds-sheet-filemark', 'aria-hidden': true }, '▦'),
      createElement('span', { className: 'ds-sheet-title', title: path }, title ?? path ?? 'Spreadsheet'),
      createElement('span', { className: 'ds-sheet-readonly' }, '只读预览'),
      stale ? createElement('button', {
        type: 'button', className: 'ds-sheet-stale', onClick: reload, title: '文件已修改，点击重新加载',
      }, '文件已更新 · 重新加载') : null,
    ),
    createElement('div', { className: 'ds-sheet-tools' },
      createElement('div', { className: 'ds-sheet-search-wrap' },
        createElement('span', { className: 'ds-sheet-search-icon', 'aria-hidden': true }, '⌕'),
        createElement('input', { type: 'search', className: 'ds-sheet-search', placeholder: '搜索当前工作表…', 'aria-label': '搜索单元格', value: query,
          onChange: (event: { currentTarget: HTMLInputElement }) => setQuery(event.currentTarget.value), disabled: sheet === null }),
      ),
      createElement('button', { type: 'button', className: 'ds-sheet-tool', 'aria-pressed': filtersVisible, disabled: sheet === null,
        onClick: () => setFiltersVisible((visible) => !visible) }, '筛选列'),
      createElement('button', { type: 'button', className: 'ds-sheet-tool', disabled: sheet === null, title: '复制选中区域（Ctrl/⌘+C）',
        onClick: () => { void copySelection() } }, '复制所选'),
      createElement('button', { type: 'button', className: 'ds-sheet-tool', disabled: sheet === null, title: '复制当前可见视图',
        onClick: () => { void copyView() } }, '复制视图'),
      createElement('button', { type: 'button', className: 'ds-sheet-tool', disabled: sheet === null, title: '导出为 CSV',
        onClick: exportCsv }, '导出'),
      createElement('button', { type: 'button', className: 'ds-sheet-tool', disabled: path === undefined, title: '重新加载文件',
        onClick: reload }, '↻'),
      hiddenSheetCount > 0 ? createElement('button', {
        type: 'button', className: 'ds-sheet-tool', 'aria-pressed': showHiddenSheets, title: '显示或隐藏隐藏工作表',
        onClick: () => setShowHiddenSheets((shown) => !shown),
      }, `隐藏表 ${hiddenSheetCount}`) : null,
      sheet !== null && (sheet.hiddenRowCount > 0 || sheet.hiddenColumnCount > 0) ? createElement('button', {
        type: 'button', className: 'ds-sheet-tool', 'aria-pressed': showHiddenRows && showHiddenCols,
        title: '显示或隐藏工作表中的隐藏行列',
        onClick: () => { const next = !(showHiddenRows && showHiddenCols); setShowHiddenRows(next); setShowHiddenCols(next) },
      }, '隐藏行列') : null,
      createElement('span', { className: 'ds-sheet-hint' }, status === '' ? '点击单元格查看公式' : status),
    ),
    createElement('div', { className: 'ds-sheet-inspector', 'aria-label': '选中单元格' },
      createElement('span', { className: 'ds-sheet-address', 'aria-label': '单元格坐标' }, selected?.address ?? '—'),
      createElement('span', { className: `ds-sheet-value${selected === null ? ' is-empty' : ''}`, title: selected?.formula ?? selected?.text ?? '',
        'aria-label': '单元格内容或公式' }, selected === null ? '选择单元格以查看公式或内容'
        : (selected.formula ?? selected.text)),
      selected?.noCache === true ? createElement('span', { className: 'ds-sheet-badge ds-sheet-warn', title: '公式没有缓存结果，只能显示公式本身' }, '无缓存') : null,
      selected?.mergeRange !== undefined ? createElement('span', { className: 'ds-sheet-badge' }, `合并 ${selected.mergeRange}`) : null,
      selected?.comment !== undefined ? createElement('span', { className: 'ds-sheet-badge', title: selected.comment }, '批注') : null,
    ),
    stale ? createElement('div', { className: 'ds-sheet-banner', role: 'status' },
      createElement('span', {}, '文件已被修改，当前内容可能已过期'),
      createElement('button', { type: 'button', className: 'ds-sheet-tool', onClick: reload }, '重新加载'),
    ) : null,
    error !== '' ? createElement('div', { className: 'ds-sheet-message', role: 'alert' },
      createElement('div', {}, error),
      createElement('div', { className: 'ds-sheet-actions' },
        createElement('button', { type: 'button', className: 'ds-sheet-tool', onClick: retry }, '重试'),
        createElement('button', { type: 'button', className: 'ds-sheet-tool', onClick: copyPath, disabled: path === undefined }, '复制文件路径'),
      ),
    ) : loading ? createElement('div', { className: 'ds-sheet-message' }, '正在读取表格…')
      : book !== null && (sheet === null || sheet.columns.length === 0) ? createElement('div', { className: 'ds-sheet-message' }, '工作表为空') : null,
    createElement('div', { className: 'ds-sheet-grid', ref: gridRef, style: { display: sheet !== null && sheet.columns.length > 0 && error === '' ? 'block' : 'none' } }),
    createElement('div', { className: 'ds-sheet-footer' },
      createElement('div', { className: 'ds-sheet-tabs', role: 'tablist', 'aria-label': '工作表' },
        ...visibleSheetInfos.map((info) => createElement('button', {
          key: info.name, type: 'button', role: 'tab',
          className: `ds-sheet-tab${info.hidden ? ' is-hidden-sheet' : ''}`,
          'aria-selected': sheetName === info.name,
          tabIndex: sheetName === info.name ? 0 : -1,
          title: info.hidden ? `${info.name}（隐藏工作表）` : info.name,
          onClick: () => selectSheet(info.name),
          onKeyDown: (event: { key: string; preventDefault(): void; currentTarget: HTMLButtonElement }) => onTabKeyDown(event, info.name),
        }, info.name)),
      ),
      sheet !== null ? createElement('span', { className: 'ds-sheet-status', title: statusText }, statusText) : null,
    ),
  )
}
