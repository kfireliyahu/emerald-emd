import { add, zero, type CurrencyCode, type Money } from '@/core/money.ts'
import { ratioBasisPoints } from '@/core/percent.ts'
import { addMonths, compareYearMonths, toYearMonthString, type YearMonth } from '@/core/time.ts'
import type { MonthSummary } from '@/domain/model/statistics.ts'
import { versusRecentAverage, type ComparisonMetric } from '@/domain/statistics.ts'

/**
 * The arithmetic Home's two views page and compare by — M28 U5. Pure, so the
 * screens do no sums of their own; every figure is still the domain's.
 */

/** How many months the month chart shows: a year and a little, as Paychecks does. */
export const CHART_MONTHS = 14

/**
 * **Home opens on the newest month that has data** (S1): on
 * 2 October a document whose newest statement is August opens on August, not on
 * an empty October.
 */
export function newestWithData(summaries: readonly MonthSummary[]): YearMonth | undefined {
  return summaries.at(-1)?.period
}

/** The month before or after `period` that the document holds, or nothing. */
export function neighbour(
  summaries: readonly MonthSummary[],
  period: YearMonth,
  step: -1 | 1,
): YearMonth | undefined {
  const ordered = step === 1 ? summaries : [...summaries].reverse()
  return ordered.find((one) => step * compareYearMonths(one.period, period) > 0)?.period
}

/**
 * Where the chart ends: at the newest month, unless the month open is further
 * back than the window reaches — then a little after it, so it is on the line.
 */
export function chartEnd(shown: YearMonth, newest: YearMonth, span = CHART_MONTHS): YearMonth {
  if (compareYearMonths(shown, addMonths(newest, -(span - 1))) >= 0) return newest
  const after = addMonths(shown, Math.floor(span / 2))
  return compareYearMonths(after, newest) > 0 ? newest : after
}

/** `span` consecutive months ending at `end`, oldest first. */
export function monthsEndingAt(end: YearMonth, span = CHART_MONTHS): readonly YearMonth[] {
  return Array.from({ length: span }, (_, index) => addMonths(end, index - span + 1))
}

/** January to December of `year` — what a year is (the answer to choice 4). */
export function monthsOfYear(year: number): readonly YearMonth[] {
  return Array.from({ length: 12 }, (_, index) => ({ year, month: index + 1 }))
}

/** Every year the document has a month in, oldest first. */
export function yearsWithData(summaries: readonly MonthSummary[]): readonly number[] {
  return [...new Set(summaries.map((one) => one.period.year))].sort((a, b) => a - b)
}

/**
 * **A headline figure against its three-month average** (S4),
 * as whole percent — `undefined` when there are not three complete months before
 * it to average, which is said by saying nothing.
 */
export function versusAverage(
  summaries: readonly MonthSummary[],
  period: YearMonth,
  metric: ComparisonMetric,
): number | undefined {
  const comparison = versusRecentAverage(summaries, period, metric)
  if (comparison.kind !== 'DELTA' || comparison.basisPoints === undefined) return undefined
  return Math.round(comparison.basisPoints / 100)
}

/**
 * Taxes against the average of the three slips before it — the same question
 * as `versusAverage`, for the one flow that is a payslip's and not the ledger's.
 */
export function taxVersusAverage(
  taxes: ReadonlyMap<string, Money>,
  period: YearMonth,
  currency: CurrencyCode,
): number | undefined {
  const current = taxes.get(toYearMonthString(period))
  if (current === undefined) return undefined
  const earlier = [...taxes.keys()]
    .filter((key) => key < toYearMonthString(period))
    .sort()
    .slice(-3)
    .flatMap((key) => {
      const value = taxes.get(key)
      return value === undefined ? [] : [value]
    })
  if (earlier.length < 3) return undefined
  const total = earlier.reduce((sum, value) => add(sum, value), zero(currency))
  const average = Math.round(total.minor / earlier.length)
  const points = ratioBasisPoints({ minor: current.minor - average, currency }, { minor: average, currency })
  return points === undefined ? undefined : Math.round(points / 100)
}

/** `+4%` or `−3%`, the way a figure's comparison is written under it. */
export function signedPercent(value: number): string {
  return `${value >= 0 ? '+' : '−'}${String(Math.abs(value))}%`
}
