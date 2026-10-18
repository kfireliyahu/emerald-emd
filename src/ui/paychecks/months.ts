import { compareYearMonths, toYearMonthString, type YearMonth } from '@/core/time.ts'
import type { PaycheckWithLines } from '@/domain/model/paycheck.ts'
import { missingPeriods } from '@/domain/paycheck.ts'

/**
 * Paging through the slips, one month at a time (M28 U4).
 *
 * Paychecks opens on one slip and moves between them three ways, all of them
 * kept — the arrows (and the arrow keys), a point on the net line, a row of
 * the table — and all three go through here, so they cannot disagree about
 * what *next* means.
 *
 * Oldest first, and a month with two slips (a second job, a bonus run) is two
 * stops in the order they were paid: paging never skips a slip that exists and
 * never stops on a month that has none.
 */
export function inOrder(entries: readonly PaycheckWithLines[]): readonly PaycheckWithLines[] {
  return [...entries].sort((a, b) => {
    const byMonth = compareYearMonths(a.paycheck.period, b.paycheck.period)
    if (byMonth !== 0) return byMonth
    return toKey(a) < toKey(b) ? -1 : toKey(a) > toKey(b) ? 1 : 0
  })
}

const toKey = (entry: PaycheckWithLines): string =>
  `${String(entry.paycheck.paymentDate.year).padStart(4, '0')}-${String(entry.paycheck.paymentDate.month).padStart(2, '0')}-${String(entry.paycheck.paymentDate.day).padStart(2, '0')}:${entry.paycheck.id}`

/** The slip shown: the one asked for while it exists, else the newest. */
export function shownSlip(
  ordered: readonly PaycheckWithLines[],
  wanted: string | undefined,
): PaycheckWithLines | undefined {
  return ordered.find((entry) => entry.paycheck.id === wanted) ?? ordered.at(-1)
}

/** The slip before or after one, or nothing at either end. */
export function neighbour(
  ordered: readonly PaycheckWithLines[],
  id: string,
  step: -1 | 1,
): PaycheckWithLines | undefined {
  const index = ordered.findIndex((entry) => entry.paycheck.id === id)
  if (index < 0) return undefined
  return ordered[index + step]
}

/** The first slip of a salary month, for a point on the line that names a month. */
export function slipOfMonth(
  ordered: readonly PaycheckWithLines[],
  period: YearMonth,
): PaycheckWithLines | undefined {
  return ordered.find((entry) => compareYearMonths(entry.paycheck.period, period) === 0)
}

/**
 * The table's rows, newest first: every slip, and a row for each month inside
 * the run of slips that has none, because a gap is information (docs/f04) and
 * the row is where reading the missing slip is offered.
 */
export type TableRow =
  | { readonly kind: 'slip'; readonly entry: PaycheckWithLines }
  | { readonly kind: 'missing'; readonly period: YearMonth }

export function tableRows(
  ordered: readonly PaycheckWithLines[],
  noPay: ReadonlySet<string> = new Set(),
): readonly TableRow[] {
  const first = ordered[0]
  const last = ordered.at(-1)
  if (first === undefined || last === undefined) return []
  const missing = missingPeriods(
    ordered.map((entry) => entry.paycheck),
    first.paycheck.period,
    last.paycheck.period,
  ).filter((period) => !noPay.has(toYearMonthString(period)))
  const rows: TableRow[] = [
    ...ordered.map((entry) => ({ kind: 'slip' as const, entry })),
    ...missing.map((period) => ({ kind: 'missing' as const, period })),
  ]
  const periodOf = (row: TableRow): YearMonth => (row.kind === 'slip' ? row.entry.paycheck.period : row.period)
  // Stable, so two slips of one month keep their paid order (reversed below).
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => compareYearMonths(periodOf(b.row), periodOf(a.row)) || b.index - a.index)
    .map(({ row }) => row)
}
