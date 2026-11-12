import { type WorkBook } from 'xlsx';
export declare const MAX_ROWS = 5000;
export declare const MAX_COLUMNS = 256;
/** The visual/semantic class of a cell, used for alignment and sorting. */
export type CellKind = 'number' | 'date' | 'text' | 'error' | 'boolean' | 'blank';
/** One parsed cell: display text plus the metadata SheetJS can expose. */
export interface CellData {
    /** Formatted text shown in the grid (`cell.w`, or a string fallback). */
    text: string;
    /** Raw value used for sorting and filtering (`cell.v`). */
    raw?: string | number | boolean;
    /** Formula text without the leading `=`, when the cell has one. */
    formula?: string;
    /** True when the formula has no cached result (program-generated workbooks). */
    noCache?: boolean;
    kind: CellKind;
    /** Solid fill background as `#rrggbb`, when the file stores one. */
    fill?: string;
    /** Hyperlink target from the cell object (not text detection). */
    link?: string;
    /** Plain text of the first comment/note on the cell. */
    comment?: string;
    /** True for a merged cell other than its top-left anchor. */
    covered?: boolean;
    /** The full merged range (e.g. `A1:C1`) on the top-left anchor only. */
    mergeRange?: string;
}
export interface GridRow {
    /** Absolute 1-based Excel row number. */
    rowLabel: number;
    cells: CellData[];
    /** Whether the source workbook marks this row hidden. */
    hidden: boolean;
}
export interface SheetInfo {
    name: string;
    hidden: boolean;
}
export interface GridSheet {
    name: string;
    /** Column letters, aligned with `GridRow.cells` and `widths`. */
    columns: string[];
    rows: GridRow[];
    widths: (number | undefined)[];
    /** Whether each source column is hidden. */
    hiddenColumns: boolean[];
    truncated: boolean;
    totalRows: number;
    totalCols: number;
    formulaCount: number;
    noCacheCount: number;
    hiddenRowCount: number;
    hiddenColumnCount: number;
}
export type ColumnKind = 'number' | 'date' | 'text';
/** Parse a workbook from raw bytes. Spreadsheets go through SheetJS with the
 * metadata options the viewer needs; CSV/TSV go through Papa Parse. */
export declare function parseWorkbook(bytes: ArrayBuffer | Uint8Array, filename?: string): WorkBook;
/** Sheet names plus the workbook's hidden/veryHidden state. */
export declare function sheetInfos(book: WorkBook): SheetInfo[];
/** Build the display model for one worksheet, clipped to the preview limits. */
export declare function gridSheet(book: WorkBook, name: string): GridSheet;
/** Column sorting kind, inferred from the first rows. */
export declare function columnKinds(sheet: GridSheet): ColumnKind[];
