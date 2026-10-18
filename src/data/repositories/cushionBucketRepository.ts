import type { Database } from 'sql.js'

import { money, type CurrencyCode, type Money } from '@/core/money.ts'
import { yearMonthOf, type LocalDate } from '@/core/time.ts'
import { planMonth } from './planMonthRepository.ts'
import { planOnMonth } from './splitPlanRepository.ts'

/**
 * Which of Plan's buckets the cushion counts beside the fixed expenses (M28 F10).
 *
 * The question: *what if I want to enlarge the cushion, so that one of the buckets in the split is
 * included?* The cushion is n months of fixed expenses (D-324); a bucket a person ticks — Groceries,
 * say — is counted among those months too, at what the plan in use gives it this month. The tick
 * is on the bucket (`in_cushion`), because buckets are shared across plans; the amount is the plan's.
 *
 * Only spending is offered: a goal's bucket (the cushion's own most of all) is saving, and counting
 * it would have the cushion hold months of what is put into it.
 */
export interface CushionBucket {
  readonly bucketId: string
  readonly name: string
  /** What the plan in use gives the bucket this month. */
  readonly amount: Money
  readonly included: boolean
}

export function cushionBuckets(
  db: Database,
  asOf: LocalDate,
  currency: CurrencyCode,
): readonly CushionBucket[] {
  const month = yearMonthOf(asOf)
  const planId = planOnMonth(db, month)
  if (planId === undefined) return []
  const plan = planMonth(db, { planId, month, asOf, readings: false })
  if (plan === undefined) return []
  return plan.result.allocations
    // Spending a month cannot do without: a category's budget, a debt's extra, a bucket of nothing in
    // particular. Money put toward a goal, a fund or an account is saved, not spent, and *What's left*
    // is not a figure anyone chose.
    .filter(
      (entry) =>
        (entry.bucket.targetKind === 'CATEGORY' || entry.bucket.targetKind === 'DEBT' || entry.bucket.targetKind === 'FREE') &&
        entry.allocation.mode !== 'REMAINDER',
    )
    .map((entry) => ({
      bucketId: entry.bucket.id,
      name: entry.bucket.name,
      amount: money(Math.max(0, entry.amount.minor), currency),
      included: entry.bucket.inCushion === true,
    }))
}
