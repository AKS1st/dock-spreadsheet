import { type WorkBook } from 'xlsx';
export declare const MAX_ROWS = 5000;
export declare const MAX_COLUMNS = 256;
export interface GridSheet {
    name: string;
    columns: string[];
    rows: Record<string, string | number>[];
    truncated: boolean;
}
export declare function parseWorkbook(bytes: ArrayBuffer | Uint8Array, filename?: string): WorkBook;
/** Preserve spreadsheet coordinates: first row is data, never inferred headers. */
export declare function gridSheet(book: WorkBook, name: string): GridSheet;
