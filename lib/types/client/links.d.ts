/**
 * URL detection for spreadsheet cell text.
 *
 * Cells are rendered as plain text so workbook content can never become DOM,
 * which means a URL sitting in a cell is inert until it is recognised here and
 * wrapped in an anchor by the cell formatter. Detection is deliberately narrow:
 * an explicit `http(s)://` scheme or a `www.` prefix. Bare domains and e-mail
 * addresses are left as text because their false-positive rate on arbitrary
 * tabular data is high.
 */
/** One run of cell text: a URL when `url` is present, otherwise literal text. */
export interface LinkSegment {
    /** The text exactly as it appears in the cell. */
    text: string;
    /** Absolute URL to open, or `undefined` for literal text. */
    url?: string;
}
/**
 * Split cell text into literal runs and detected URLs, preserving the original
 * text verbatim. A candidate immediately preceded by a word character is not
 * detected, so `abchttps://x` stays text.
 *
 * @param text - Raw cell text.
 * @returns Segments in source order; a URL segment carries its absolute `url`.
 */
export declare function splitLinks(text: string): LinkSegment[];
