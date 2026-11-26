/**
 * **The plan over a year** — M64 F12 (D-631).
 *
 * The maintainer, 2026-11-26: *"if i had a monthly bucket id like to see how much total in the
 * year went to the bucket out of planned."* So a bucket's year is the sum of its months: what each
 * month's plan gave it, and what the ledger says it got in that month, on the same month basis as
 * Home (D-607) because the months are measured by the same `planVersusActual`.
 *
 * **A month a bucket cannot be measured in stays out of both of its sums**, the rule
 * `planVersusActual` keeps for one month (a free bucket, a month with no statement): adding its
 * plan to the planned side with nothing beside it would report the bucket under its plan by
 * exactly the months nobody could check. Those months are counted, so the screen can say so.
 *
 * Pure: the months are measured by the caller, one `PlanVersusActual` each, in any order.
 */

import { money, type CurrencyCode, type Money } from '@/core/money.ts'
import { compareYearMonths, type YearMonth } from '@/core/time.ts'
import type { SplitBucket } from '@/domain/model/plan.ts'
import type { PlanVersusActual, VarianceVerdict } from '@/domain/splitter.ts'

/** One month of one bucket: what its plan gave it and what it got. */
export interface PlanYearMonth {
  readonly period: YearMonth
  readonly planned: Money
  /** Undefined when the month could not be measured for this bucket. */
  readonly actual: Money | undefined
  readonly verdict: VarianceVerdict
}

export interface PlanYearLine {
  readonly bucket: SplitBucket
  /** Σ planned over the months it could be measured in, so it matches `actual`. */
  readonly planned: Money
  readonly actual: Money
  /** `actual − planned`. Positive means more went to it than was planned. */
  readonly variance: Money
  /** Every month it was planned in, oldest first — measured or not. */
  readonly months: readonly PlanYearMonth[]
  readonly over: number
  readonly under: number
  /** Months it was planned in and could not be measured. */
  readonly unmeasured: number
}

export interface PlanYear {
  /** The months read, oldest first. */
  readonly months: readonly YearMonth[]
  /** Every bucket any of the months planned, in the order the first month that planned it lists it. */
  readonly lines: readonly PlanYearLine[]
  /** Σ over the measured lines only. */
  readonly planned: Money
  readonly actual: Money
  readonly variance: Money
  /** Lines with at least one measured month. */
  readonly comparable: number
}

/**
 * Sum months of plan-against-actual into a year, bucket by bucket. A month in another currency
 * than `currency` is left out: its figures cannot be added to these.
 */
export function planYear(months: readonly PlanVersusActual[], currency: CurrencyCode): PlanYear {
  const ordered = [...months].sort((a, b) => compareYearMonths(a.period, b.period))
  const byBucket = new Map<string, { bucket: SplitBucket; months: PlanYearMonth[] }>()
  const read: YearMonth[] = []

  for (const month of ordered) {
    if (month.planned.currency !== currency) continue
    read.push(month.period)
    for (const line of month.lines) {
      if (line.planned.currency !== currency) continue
      const held = byBucket.get(line.bucket.id) ?? { bucket: line.bucket, months: [] }
      held.months.push({
        period: month.period,
        planned: line.planned,
        actual: line.verdict === 'NO_BASIS' || line.actual?.currency !== currency ? undefined : line.actual,
        verdict: line.actual?.currency !== currency ? 'NO_BASIS' : line.verdict,
      })
      byBucket.set(line.bucket.id, held)
    }
  }

  const lines = [...byBucket.values()].map(({ bucket, months: its }): PlanYearLine => {
    const measured = its.filter((one) => one.actual !== undefined)
    const planned = measured.reduce((total, one) => total + one.planned.minor, 0)
    const actual = measured.reduce((total, one) => total + (one.actual?.minor ?? 0), 0)
    return {
      bucket,
      planned: money(planned, currency),
      actual: money(actual, currency),
      variance: money(actual - planned, currency),
      months: its,
      over: its.filter((one) => one.verdict === 'OVER').length,
      under: its.filter((one) => one.verdict === 'UNDER').length,
      unmeasured: its.length - measured.length,
    }
  })

  const comparable = lines.filter((line) => line.months.length > line.unmeasured)
  const planned = comparable.reduce((total, line) => total + line.planned.minor, 0)
  const actual = comparable.reduce((total, line) => total + line.actual.minor, 0)
  return {
    months: read,
    lines,
    planned: money(planned, currency),
    actual: money(actual, currency),
    variance: money(actual - planned, currency),
    comparable: comparable.length,
  }
}

/** What one kind of bucket came to over the year: the measured lines only. */
export interface PlanYearTotal {
  readonly planned: Money
  readonly actual: Money
  /** `actual − planned`. */
  readonly variance: Money
  readonly lines: number
}

/**
 * **The year said by what a bucket is for** (D-631): over a category's plan is money spent past it,
 * and more into a goal or onto a debt than planned is no problem — so the two are never one sum.
 * `spent` is the categories, `into` the goals and debts (the only other buckets anything measures);
 * each is undefined when no line of its kind could be measured.
 */
export function planYearByKind(reading: PlanYear, currency: CurrencyCode): {
  readonly spent: PlanYearTotal | undefined
  readonly into: PlanYearTotal | undefined
} {
  const measured = reading.lines.filter((line) => line.months.length > line.unmeasured)
  const total = (lines: readonly PlanYearLine[]): PlanYearTotal | undefined => {
    if (lines.length === 0) return undefined
    const planned = lines.reduce((sum, line) => sum + line.planned.minor, 0)
    const actual = lines.reduce((sum, line) => sum + line.actual.minor, 0)
    return {
      planned: money(planned, currency),
      actual: money(actual, currency),
      variance: money(actual - planned, currency),
      lines: lines.length,
    }
  }
  return {
    spent: total(measured.filter((line) => line.bucket.targetKind === 'CATEGORY')),
    into: total(measured.filter((line) => line.bucket.targetKind !== 'CATEGORY')),
  }
}
