/**
 * The total the statement prints for itself — the verification in
 * docs/f01-card-statement-import.md.
 *
 * With a user-defined mapping, a wrong mapping is the main risk, and comparing
 * the sum of what was parsed against a figure the file states independently is
 * the cheapest signal there is that something is pointed at the wrong column.
 *
 * Neither real file makes this easy, and they are wrong in different ways:
 *
 * - **Cal** buries it in preamble prose — `עסקאות בחיוב מיידי 2,600.00 ₪` — one
 *   string cell holding a sentence with a number in it.
 * - **Max** puts the label `סך הכל` in a trailing row and the value in the row
 *   *below* it, as the string `1200.00₪`, after the data rather than before.
 *
 * So the scan covers the preamble *and* the trailing rows, looks in the cell,
 * to its right, and in the row beneath it, and pulls a number out of a
 * surrounding string. Both files' totals reconciled exactly against the sum of
 * their parsed amounts, which is what makes the check worth having.
 */

import { fromMajorUnits, type Money } from '@/core/money.ts'
import { cleanText } from '@/core/text.ts'
import { parseAmountText } from './normalize.ts'
import type { SheetCell, SheetTable } from './sheetTable.ts'

/**
 * Labels that introduce a total, normalized and lowercased.
 *
 * A hint list, like the header aliases: being wrong costs nothing, because the
 * figure is shown to the user next to the parsed one rather than acted on.
 */
const TOTAL_LABELS: readonly string[] = [
  'סך הכל',
  'סה"כ',
  'סהכ',
  'סכום לחיוב',
  'סכום החיוב',
  'לחיוב',
  'לתשלום',
  'עסקאות בחיוב מיידי',
  'total',
  'sum',
  'amount due',
  'grand total',
]

/** How far to the right of a label to look for its value. */
const SAME_ROW_REACH = 4

export interface PrintedTotal {
  readonly amount: Money
  /** The cell the label was in, as `Sheet!12`, so the user can go and look. */
  readonly sourceRowRef: string
  /** The text it was read out of, shown verbatim — this is a claim about the file. */
  readonly text: string
}

export interface PrintedTotalScan {
  readonly headerRowIndex: number
  /** The last row that produced a transaction. Everything after it is trailing. */
  readonly lastDataRowIndex: number
  readonly currency: string
}

/**
 * The first total-looking figure in the preamble or the trailing rows.
 *
 * Deliberately not the whole sheet: an English statement can contain a merchant
 * called "Total Wine", and a data row that happens to hold the word would
 * otherwise be read as the file's own total.
 */
export function findPrintedTotal(
  table: SheetTable,
  scan: PrintedTotalScan,
): PrintedTotal | undefined {
  const regions: readonly (readonly [number, number])[] = [
    [0, Math.max(0, scan.headerRowIndex)],
    [Math.max(0, scan.lastDataRowIndex + 1), table.rows.length],
  ]

  for (const [from, to] of regions) {
    for (let rowIndex = from; rowIndex < to; rowIndex++) {
      const row = table.rows[rowIndex]
      if (row === undefined) continue

      for (let column = 0; column < row.length; column++) {
        const cell = row[column]
        if (cell === undefined || cell.kind === 'empty') continue
        if (!hasTotalLabel(cell.text)) continue

        const found = valueNear(table, rowIndex, column, scan.currency)
        if (found !== undefined) {
          return { ...found, sourceRowRef: `${table.name}!${rowIndex + 1}` }
        }
      }
    }
  }

  return undefined
}

function hasTotalLabel(text: string): boolean {
  const normalized = cleanText(text).toLocaleLowerCase('he')
  return TOTAL_LABELS.some((label) => normalized.includes(label))
}

/**
 * The number belonging to a label: in the same cell, to its right, or in the
 * row below it — in that order, because that is the order of confidence.
 */
function valueNear(
  table: SheetTable,
  rowIndex: number,
  column: number,
  currency: string,
): Omit<PrintedTotal, 'sourceRowRef'> | undefined {
  const labelCell = table.rows[rowIndex]?.[column]

  // Cal: the number is inside the sentence.
  const inline = labelCell === undefined ? undefined : numberIn(labelCell.text)
  if (inline !== undefined) {
    return { amount: fromMajorUnits(inline, currency), text: cleanText(labelCell?.text ?? '') }
  }

  const row = table.rows[rowIndex] ?? []
  for (let offset = 1; offset <= SAME_ROW_REACH && column + offset < row.length; offset++) {
    const found = valueOf(row[column + offset], currency)
    if (found !== undefined) return found
  }

  // Max: the label is one row, the value the next.
  const below = table.rows[rowIndex + 1] ?? []
  const under = valueOf(below[column], currency)
  if (under !== undefined) return under

  for (const cell of below) {
    const found = valueOf(cell, currency)
    if (found !== undefined) return found
  }

  return undefined
}

function valueOf(
  cell: SheetCell | undefined,
  currency: string,
): Omit<PrintedTotal, 'sourceRowRef'> | undefined {
  if (cell === undefined || cell.kind === 'empty') return undefined

  if (cell.kind === 'number') {
    return { amount: fromMajorUnits(cell.value, currency), text: cell.text }
  }
  if (cell.kind !== 'string') return undefined

  const value = numberIn(cell.value)
  return value === undefined
    ? undefined
    : { amount: fromMajorUnits(value, currency), text: cleanText(cell.value) }
}

/**
 * A money-shaped number out of a string that may be a whole sentence.
 *
 * The decimal point is the discriminator: `2,600.00` in a line that also
 * contains a year is the total, and a bare integer next to it is not. Only when
 * nothing has a decimal point does the largest bare number win — a total is the
 * biggest number on a line by construction.
 */
export function numberIn(text: string): number | undefined {
  const cleaned = cleanText(text)
  const matches = cleaned.match(/-?\d[\d,]*(?:\.\d+)?-?/g)
  if (matches === null) return undefined

  const parsed = matches
    .map((match) => ({ text: match, value: parseAmountText(match) }))
    .filter((candidate): candidate is { text: string; value: number } => candidate.value !== undefined)
  if (parsed.length === 0) return undefined

  const withDecimals = parsed.filter((candidate) => candidate.text.includes('.'))
  const pool = withDecimals.length > 0 ? withDecimals : parsed

  let best = pool[0]
  for (const candidate of pool) {
    if (best === undefined || Math.abs(candidate.value) > Math.abs(best.value)) best = candidate
  }
  return best?.value
}

/**
 * Does the parsed sum agree with what the file says?
 *
 * Compared on magnitude, because the sign is the app's convention and not the
 * file's: both real files print their charges as positive and the importer is
 * what makes them negative (D-004). Comparing signed values would report every
 * correct import as a mismatch.
 */
export function totalsAgree(printed: Money, parsed: Money): boolean {
  if (printed.currency !== parsed.currency) return false
  return Math.abs(printed.minor) === Math.abs(parsed.minor)
}

/** What the parsed rows came to beside the file's own figure. */
export interface Reconciliation {
  /** One per currency: the figure the printed total was compared with. */
  readonly totals: readonly Money[]
  /** `undefined` when the file prints no total: unchecked, not agreed (D-149). */
  readonly reconciles: boolean | undefined
}

/**
 * **The printed total against the rows, charges less refunds** (M64 U17, D-613).
 *
 * A card statement prints what it will charge, which is net of a refund on it:
 * the signed sum of its rows, compared on magnitude as {@link totalsAgree} says.
 * Summing every row's magnitude, as this did until a synthetic year's refund
 * months were refused, counts a refund twice. The magnitudes stay as the second
 * reading only — a file that prints its charges and its refunds as one gross
 * figure still agrees, so nothing that reconciled before this stops reconciling.
 *
 * Per currency, because a file with a dollar and a shekel section prints one
 * total for each; the figure shown per currency is the one that agreed, else
 * the net one.
 */
export function reconcileRows(printed: PrintedTotal | undefined, amounts: readonly Money[]): Reconciliation {
  const byCurrency = new Map<string, { net: number; gross: number }>()
  for (const amount of amounts) {
    const sums = byCurrency.get(amount.currency) ?? { net: 0, gross: 0 }
    sums.net += amount.minor
    sums.gross += Math.abs(amount.minor)
    byCurrency.set(amount.currency, sums)
  }
  let reconciles = false
  const totals = [...byCurrency].map(([currency, sums]): Money => {
    const net: Money = { minor: Math.abs(sums.net), currency }
    const gross: Money = { minor: sums.gross, currency }
    if (printed === undefined) return net
    if (totalsAgree(printed.amount, net)) {
      reconciles = true
      return net
    }
    if (totalsAgree(printed.amount, gross)) {
      reconciles = true
      return gross
    }
    return net
  })
  return { totals, reconciles: printed === undefined ? undefined : reconciles }
}
