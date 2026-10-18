/**
 * The period a statement prints for itself above its header — M28 F26.
 *
 * A bank's export says which days it covers (`תקופת הדוח: 01.08.2026 -
 * 01.10.2026`), and that is a better answer to *when does this statement's
 * balance stand* than its last row: a quiet fortnight at the end of the period
 * has no row and is still covered. It is a claim the file makes, so it is kept
 * only when the file's own rows agree with it:
 *
 * - every row read falls inside it, and
 * - it had **ended before the day the file was read** — a period running into
 *   the future is the range somebody asked the bank for, not the days the
 *   balance stands on, and rows dated after the export would be counted against
 *   a balance that never saw them.
 *
 * Otherwise nothing is recorded, and the balance stands on the last row read.
 * Day-first unless the text can only be read the other way, as everywhere else
 * in the importer.
 */

import { cleanText } from '@/core/text.ts'
import { compareDates, tryLocalDate, type LocalDate } from '@/core/time.ts'
import { inferDateOrder, parseDateText } from './normalize.ts'
import type { SheetCell, SheetTable } from './sheetTable.ts'

export interface DateSpan {
  readonly from: LocalDate
  readonly to: LocalDate
}

const DATE = String.raw`\d{1,4}[./]\d{1,2}[./]\d{1,4}`
/** Two dates with a dash or a word between them, anywhere in one cell's text. */
const RANGE = new RegExp(String.raw`(${DATE})\s*(?:-|–|—|עד|to)\s*(${DATE})`, 'i')

/** The span of the given days, or nothing when there are none. */
export function spanOf(days: readonly LocalDate[]): DateSpan | undefined {
  let from: LocalDate | undefined
  let to: LocalDate | undefined
  for (const day of days) {
    if (from === undefined || compareDates(day, from) < 0) from = day
    if (to === undefined || compareDates(day, to) > 0) to = day
  }
  return from === undefined || to === undefined ? undefined : { from, to }
}

/**
 * The period printed above the header, when one is printed and the rows and
 * the day it was read agree with it.
 */
export function findPrintedPeriod(
  table: SheetTable,
  headerRowIndex: number,
  rows: DateSpan | undefined,
  readOn: LocalDate,
): DateSpan | undefined {
  for (let index = 0; index < headerRowIndex && index < table.rows.length; index++) {
    const period = periodIn(table.rows[index] ?? [])
    if (period === undefined) continue
    if (compareDates(period.from, period.to) > 0) return undefined
    if (compareDates(period.to, readOn) >= 0) return undefined
    if (rows !== undefined && (compareDates(rows.from, period.from) < 0 || compareDates(rows.to, period.to) > 0)) {
      return undefined
    }
    return period
  }
  return undefined
}

/** One cell holding both dates, or a row holding exactly two date cells. */
function periodIn(cells: readonly SheetCell[]): DateSpan | undefined {
  for (const cell of cells) {
    if (cell.kind !== 'string') continue
    const match = RANGE.exec(cleanText(cell.value))
    if (match === null) continue
    const [, first, second] = match
    if (first === undefined || second === undefined) continue
    const order = inferDateOrder([first, second])
    const from = parseDateText(first, order)
    const to = parseDateText(second, order)
    if (from !== undefined && to !== undefined) return { from, to }
  }
  const dates = cells.flatMap((cell) =>
    cell.kind === 'date' ? [tryLocalDate(cell.value.year, cell.value.month, cell.value.day)] : [],
  )
  const [from, to] = dates
  return dates.length === 2 && from !== undefined && to !== undefined ? { from, to } : undefined
}
