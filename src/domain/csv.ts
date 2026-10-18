/**
 * CSV, for a spreadsheet that is about to be opened by a person.
 *
 * RFC 4180 quoting, CRLF line endings, and one deviation the RFC does not
 * cover: a leading `=` in a merchant name is a formula, and every spreadsheet
 * in the world will run it. See `neutralize` below — it is the reason this is a
 * module rather than four lines of `join`.
 *
 * No DOM, no `Blob`, no file name: this turns rows into a string. Where the
 * string goes, and the byte-order mark that makes Excel read Hebrew correctly,
 * belong to `data/export/download.ts`.
 */

/** Fields needing quotes: the separator, a quote, a newline, or edge whitespace. */
const MUST_QUOTE = /[",\r\n]|^\s|\s$/

/**
 * What a spreadsheet treats as the start of a formula rather than as text.
 * Tab and carriage return are here because Excel skips leading whitespace
 * before deciding, so `\t=A1` is a formula too.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/

/** What we are willing to let start with `-` because it is genuinely a number. */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/

/**
 * Stop a cell from being executed, without mangling the numbers.
 *
 * Merchant text arrives from a statement file, which is data this app did not
 * write — the same point D-114 makes about model context, and the same answer:
 * it is not to be obeyed. A merchant called `=HYPERLINK(...)` or
 * `@SUM(1+1)*cmd` is a real technique, and CSV is where it lands because a
 * spreadsheet evaluates on open.
 *
 * The prefix is an apostrophe, which every spreadsheet reads as "the rest of
 * this is text" and does not display. It is applied only to fields that could
 * be a formula and are **not** plain numbers, because `-421.05` has to stay a
 * number the column can sum — which is exactly why a blanket guard on `-` would
 * be worse than none.
 */
export function neutralize(value: string): string {
  if (!FORMULA_LEAD.test(value)) return value
  if (PLAIN_NUMBER.test(value)) return value
  return `'${value}`
}

/** One field, guarded and quoted as needed. */
export function csvField(value: string): string {
  const guarded = neutralize(value)
  return MUST_QUOTE.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded
}

/**
 * Rows to a CSV document. The first row is the header like any other — this
 * makes no distinction, because the escaping rules do not either.
 *
 * CRLF rather than LF: RFC 4180 says so, Excel on Windows wants it, and every
 * other reader accepts it.
 */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n')
}
