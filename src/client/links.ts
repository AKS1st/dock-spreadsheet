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
  text: string
  /** Absolute URL to open, or `undefined` for literal text. */
  url?: string
}

const CANDIDATE = /(?:https?:\/\/|www\.)[^\s<>"'`\\]+/gi
const TRAILING_PUNCTUATION = /[.,;:!?。，、；：！？]+$/
const BALANCED_PAIRS: readonly (readonly [string, string])[] = [['(', ')'], ['[', ']'], ['{', '}']]

function countOf(text: string, character: string): number {
  let total = 0
  for (const current of text) if (current === character) total += 1
  return total
}

/**
 * Strip trailing characters that belong to the surrounding sentence rather than
 * to the URL: sentence punctuation, and closing brackets that are unbalanced.
 * Balanced brackets stay, so `.../wiki/Foo_(bar)` keeps its parenthesis.
 */
function trimCandidate(candidate: string): string {
  let url = candidate.replace(TRAILING_PUNCTUATION, '')
  for (let guard = 0; guard < 8; guard += 1) {
    const last = url.at(-1)
    const pair = BALANCED_PAIRS.find(([, close]) => close === last)
    if (pair === undefined) break
    if (countOf(url, pair[0]) >= countOf(url, pair[1])) break
    url = url.slice(0, -1)
  }
  return url
}

/** The absolute URL a candidate opens as: `www.` gets an explicit https scheme. */
function absoluteUrl(candidate: string): string {
  return /^www\./i.test(candidate) ? `https://${candidate}` : candidate
}

/**
 * Split cell text into literal runs and detected URLs, preserving the original
 * text verbatim. A candidate immediately preceded by a word character is not
 * detected, so `abchttps://x` stays text.
 *
 * @param text - Raw cell text.
 * @returns Segments in source order; a URL segment carries its absolute `url`.
 */
export function splitLinks(text: string): LinkSegment[] {
  if (text === '') return []
  const segments: LinkSegment[] = []
  // Adjacent literal runs are merged so the output never holds two text
  // segments in a row (trimming a URL can split one run into several).
  const pushText = (value: string): void => {
    if (value === '') return
    const previous = segments.at(-1)
    if (previous !== undefined && previous.url === undefined) previous.text += value
    else segments.push({ text: value })
  }
  let cursor = 0
  for (const match of text.matchAll(CANDIDATE)) {
    const start = match.index
    if (start > 0 && /\w/.test(text[start - 1] ?? '')) continue
    const url = trimCandidate(match[0])
    if (url === '') continue
    pushText(text.slice(cursor, start))
    segments.push({ text: url, url: absoluteUrl(url) })
    cursor = start + url.length
    // Characters trimmed off the candidate stay literal text.
    if (cursor < start + match[0].length) {
      pushText(text.slice(cursor, start + match[0].length))
      cursor = start + match[0].length
    }
  }
  pushText(text.slice(cursor))
  return segments.length === 0 ? [{ text }] : segments
}
