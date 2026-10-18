/**
 * Turning raw cells into domain values: amounts into `Money`, dates into
 * `LocalDate`. Pipeline step 7 of docs/f01-card-statement-import.md.
 *
 * Everything here is a pure function over a `SheetCell`, and every one of them
 * returns `undefined` rather than throwing or guessing — a cell that cannot be
 * read is a row-scoped error, not a crash.
 */

import { fromMajorUnits, type CurrencyCode, type Money } from '@/core/money.ts'
import { cleanText, parseFigureText } from '@/core/text.ts'
import {
  inferNumericDateOrder,
  parseNumericDate,
  tryLocalDate,
  type LocalDate,
  type NumericDateOrder,
} from '@/core/time.ts'
import type { DateOrder } from '@/domain/model/importing.ts'
import type { SheetCell } from './sheetTable.ts'

// --- Dates -----------------------------------------------------------------

/**
 * Read a date cell.
 *
 * A real date cell is already unambiguous and is used as-is. A text date is
 * read according to `order`, which the mapper infers per column rather than
 * assuming — `03/07/2026` is 3 July in Israel and 7 March in the US, and
 * nothing in the cell itself says which.
 */
export function parseDateCell(cell: SheetCell, order: DateOrder): LocalDate | undefined {
  if (cell.kind === 'date') {
    return tryLocalDate(cell.value.year, cell.value.month, cell.value.day)
  }
  if (cell.kind === 'string') return parseDateText(cell.value, order)
  return undefined
}

/** The importer's order, in the spelling `@/core/time.ts` reads. */
const CORE_ORDER = { DMY: 'dmy', MDY: 'mdy', YMD: 'ymd' } as const satisfies Record<DateOrder, NumericDateOrder>
const IMPORTER_ORDER = { dmy: 'DMY', mdy: 'MDY', ymd: 'YMD' } as const satisfies Record<NumericDateOrder, DateOrder>

/** A written date — the one reader the engine uses too (`parseNumericDate`, M45 F1). */
export function parseDateText(text: string, order: DateOrder): LocalDate | undefined {
  return parseNumericDate(cleanText(text), CORE_ORDER[order])
}

/** Which order a column's dates imply — `inferNumericDateOrder`, shared with the engine. */
export function inferDateOrder(texts: readonly string[]): DateOrder {
  return IMPORTER_ORDER[inferNumericDateOrder(texts.map(cleanText))]
}

// --- Currencies ------------------------------------------------------------

/** A symbol that stands for exactly one currency, as these files write it. */
const SYMBOL_TO_CODE: Readonly<Record<string, CurrencyCode>> = {
  '₪': 'ILS',
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
}

/** A word or code that names a currency, matched case-insensitively. */
const WORD_TO_CODE: Readonly<Record<string, CurrencyCode>> = {
  ils: 'ILS',
  nis: 'ILS',
  'ש"ח': 'ILS',
  שח: 'ILS',
  usd: 'USD',
  eur: 'EUR',
  gbp: 'GBP',
}

/**
 * Currency symbols and codes that appear glued to an amount in these files.
 *
 * Two jobs, one pattern: stripping the symbol off an amount before reading the
 * number, and reading the symbol *as* evidence of what the file is denominated
 * in (`currenciesInText`).
 *
 * The boundary around the words is spelled out rather than `\b`, which is
 * defined on ASCII word characters and so never fires beside a Hebrew letter —
 * `\bש"ח\b` matches nothing at all. `¥` is stripped but names no currency: it
 * is the yen and the yuan, and those disagree on how many minor units they
 * have, so guessing between them is worse than not guessing.
 */
const CURRENCY_NOISE = /[₪$€£¥]|(?<![\p{L}\p{N}])(?:ils|nis|usd|eur|gbp|ש"ח|שח)(?![\p{L}\p{N}])/giu

/**
 * Every currency the text names, in the order it names them.
 *
 * The evidence a default currency is guessed from. In a file whose amounts are
 * currency-formatted numbers — which is how Cal writes every one of them — the
 * symbol in the cell's displayed text is the only place the currency appears at
 * all, so this reads what `parseAmountText` throws away.
 */
export function currenciesInText(text: string): readonly CurrencyCode[] {
  const found: CurrencyCode[] = []
  for (const match of cleanText(text).matchAll(CURRENCY_NOISE)) {
    const code = codeForToken(match[0])
    if (code !== undefined) found.push(code)
  }
  return found
}

function codeForToken(token: string): CurrencyCode | undefined {
  return SYMBOL_TO_CODE[token] ?? WORD_TO_CODE[token.toLowerCase()]
}

// --- Amounts ---------------------------------------------------------------

/**
 * Read an amount cell as a positive-or-negative major-unit number.
 *
 * A real number cell is used directly — which is the common case, since both
 * Cal and Max store amounts as numbers and put the ₪ in the number format.
 * Text amounts get the full treatment: currency symbols, thousands
 * separators, a trailing minus (`1,234.56-`) and accounting parentheses —
 * `parseFigureText`, which the engine reads through too, told to strip this
 * file's currency symbols and words.
 */
export function parseAmountText(text: string): number | undefined {
  return parseFigureText(text, CURRENCY_NOISE)
}

export function parseAmountCell(cell: SheetCell, currency: CurrencyCode): Money | undefined {
  if (cell.kind === 'number') return fromMajorUnits(cell.value, currency)
  if (cell.kind === 'string') {
    const value = parseAmountText(cell.value)
    return value === undefined ? undefined : fromMajorUnits(value, currency)
  }
  return undefined
}

/** A bare number, for exchange rates and installment counters. */
export function parseNumberCell(cell: SheetCell): number | undefined {
  if (cell.kind === 'number') return cell.value
  if (cell.kind === 'string') return parseAmountText(cell.value)
  return undefined
}

// --- Odds and ends ---------------------------------------------------------

/** `1 מתוך 3`, `3/12`, `תשלום 2 מתוך 6` — the ways an installment counter is written. */
export function parseInstallmentText(
  text: string,
): { readonly sequence: number; readonly total: number } | undefined {
  const value = cleanText(text)
  const match = /(\d{1,3})\s*(?:מתוך|of|\/|מ)\s*(\d{1,3})/u.exec(value)
  if (match === null) return undefined

  const [, sequence, total] = match
  if (sequence === undefined || total === undefined) return undefined

  const s = Number(sequence)
  const t = Number(total)
  if (s < 1 || t < 1 || s > t) return undefined
  return { sequence: s, total: t }
}

/** The last four digits of a card, from a cell that may be padded or masked. */
export function parseCardLast4(text: string): string | undefined {
  const digits = cleanText(text).replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(-4) : undefined
}

/**
 * A whole cell that states a currency: a symbol, a name, or a three-letter code.
 *
 * Stricter than `currenciesInText`, and deliberately: this is a mapped column
 * saying what *this row* is denominated in, so the cell has to be the currency
 * rather than merely mention one. An unknown three-letter code is taken at face
 * value — the app has no ISO 4217 table and does not need one.
 */
export function parseCurrencyCell(cell: SheetCell): CurrencyCode | undefined {
  if (cell.kind !== 'string') return undefined
  const value = cleanText(cell.value)
  if (value === '') return undefined

  const known = codeForToken(value)
  if (known !== undefined) return known
  if (/^[A-Za-z]{3}$/.test(value)) return value.toUpperCase()
  return undefined
}
