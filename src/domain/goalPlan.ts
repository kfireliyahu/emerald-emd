/**
 * The deciding view of a goal (M28 U8): what goes toward it each month, and what
 * that leaves you with in a time you pick.
 *
 * **Plain addition, and it says so.** The projection is the balance plus the
 * monthly amount for each month, stopping at the target: no return is assumed,
 * because an assumed return is a figure somebody typed that reads as a fact. A
 * rate the bank agreed to is a different thing and comes back as its own column
 * (S6), not as a scenario.
 *
 * **The monthly amount is Plan's bucket** (choice 3 A): a goal has no amount of
 * its own, it has the bucket that points at it, and this file only reads that
 * and says how to change it. One number, edited from either place.
 *
 * Pure: money in, money out, no clock, no database.
 */

import { money, type CurrencyCode, type Money } from '@/core/money.ts'
import { addMonths, monthsBetween, type YearMonth } from '@/core/time.ts'
import type { Allocation, SplitBucket } from '@/domain/model/plan.ts'
import { changedTo, type ComputedAllocation } from '@/domain/splitter.ts'

/** The most months a projection looks ahead before saying never. Fifty years. */
export const PROJECTION_LIMIT_MONTHS = 600

export interface GoalLine {
  readonly goalId: string
  readonly name: string
  readonly balance: Money
  /** Absent when the goal has no target, or an emergency fund whose basis is unknown. */
  readonly target: Money | undefined
  readonly due: YearMonth | undefined
  /** What Plan puts toward it each month. */
  readonly monthly: Money
  /**
   * Months from now before it takes money again: 1 is "skip this month" (S7). It
   * is paused for exactly that many months of the projection and no more.
   */
  readonly pausedMonths?: number | undefined
  /**
   * A yearly rate the bank agreed to for where the money sits, in basis points
   * (S6). Never an assumed return: those are not kept, and this one is shown
   * apart from the plain figure rather than inside it.
   */
  readonly agreedRateBasisPoints?: number | undefined
}

/**
 * The balance after `months`, adding the monthly amount and stopping at the
 * target. A goal already past its target stays where it is: nothing is taken
 * away, and nothing more is added.
 */
export function balanceAfter(line: GoalLine, months: number): Money {
  const { currency } = line.balance
  let balance = line.balance.minor
  const cap = line.target?.minor
  const each = Math.max(0, line.monthly.minor)
  const paused = Math.max(0, line.pausedMonths ?? 0)
  for (let month = 1; month <= months; month += 1) {
    if (month <= paused) continue
    const room = cap === undefined ? each : Math.max(0, Math.min(each, cap - balance))
    balance += room
  }
  return money(balance, currency)
}

/** Months until the target, by plain addition. 0 when it is there already; `undefined` when never. */
export function monthsToTarget(line: GoalLine): number | undefined {
  if (line.target === undefined) return undefined
  if (line.balance.minor >= line.target.minor) return 0
  if (line.monthly.minor <= 0) return undefined
  return Math.ceil((line.target.minor - line.balance.minor) / line.monthly.minor) + Math.max(0, line.pausedMonths ?? 0)
}

/**
 * What a bank-agreed yearly rate would add on top of plain addition after
 * `months` (S6): the same deposits, with each month's balance earning a twelfth
 * of the rate, rounded to the minor unit each month. Zero with no agreed rate.
 * It is the difference, so it is shown beside the plain figure and never in it.
 */
export function agreedGrowthAfter(line: GoalLine, months: number): Money {
  const { currency } = line.balance
  const rate = line.agreedRateBasisPoints
  if (rate === undefined || rate <= 0) return money(0, currency)
  let balance = line.balance.minor
  const cap = line.target?.minor
  const each = Math.max(0, line.monthly.minor)
  const paused = Math.max(0, line.pausedMonths ?? 0)
  for (let month = 1; month <= months; month += 1) {
    balance += Math.round((balance * rate) / 120_000)
    if (month <= paused) continue
    balance += cap === undefined ? each : Math.max(0, Math.min(each, cap - balance))
  }
  return money(balance - balanceAfter(line, months).minor, currency)
}

export type GoalStatus =
  | { readonly kind: 'REACHED' }
  | { readonly kind: 'ON_TIME'; readonly at: YearMonth }
  | { readonly kind: 'LATE'; readonly at: YearMonth; readonly monthsLate: number }
  | { readonly kind: 'NO_DATE'; readonly at: YearMonth }
  | { readonly kind: 'NO_MONEY' }
  | { readonly kind: 'NO_TARGET' }

export function goalStatus(line: GoalLine, from: YearMonth): GoalStatus {
  if (line.target === undefined) return { kind: 'NO_TARGET' }
  const months = monthsToTarget(line)
  if (months === 0) return { kind: 'REACHED' }
  if (months === undefined || months > PROJECTION_LIMIT_MONTHS) return { kind: 'NO_MONEY' }
  const at = addMonths(from, months)
  if (line.due === undefined) return { kind: 'NO_DATE', at }
  const late = monthsBetween(line.due, at)
  return late <= 0 ? { kind: 'ON_TIME', at } : { kind: 'LATE', at, monthsLate: late }
}

/**
 * What a month would have to be to arrive on the date. The shortfall over the
 * months between now and the date — the same count the projection uses, where
 * after N months N payments have landed — rounded up, because N payments of a
 * rounded down figure land short. A date this month or past asks for it all now. `undefined` when there is no date, no target, or the
 * goal is there already.
 */
export function neededMonthly(line: GoalLine, from: YearMonth): Money | undefined {
  if (line.target === undefined || line.due === undefined) return undefined
  const shortfall = line.target.minor - line.balance.minor
  if (shortfall <= 0) return undefined
  const left = Math.max(1, monthsBetween(from, line.due))
  return money(Math.ceil(shortfall / left), line.balance.currency)
}

// --- The monthly amount is Plan's bucket ------------------------------------

/** What a Plan bucket can point at and have its figure read and written as one number (D-323, D-325, D-327). */
export type BucketPointsAt = 'SAVING_GOAL' | 'DEBT' | 'CATEGORY'

/** What Plan puts toward one goal this month: the sum of the buckets that point at it. */
export function goalMonthlyFromPlan(
  computed: readonly ComputedAllocation[],
  goalId: string,
  currency: CurrencyCode,
  /** A debt's extra is read the same way (M28 U8, D-325): the bucket points at a different table. */
  kind: BucketPointsAt = 'SAVING_GOAL',
): { readonly amount: Money; readonly bucketIds: readonly string[] } {
  const mine = computed.filter(
    (entry) => entry.bucket.targetKind === kind && entry.bucket.targetId === goalId,
  )
  return {
    amount: money(
      mine.reduce((running, entry) => running + entry.amount.minor, 0),
      currency,
    ),
    bucketIds: mine.map((entry) => entry.bucket.id),
  }
}

/**
 * What changing a goal's monthly amount does to Plan.
 *
 * - One bucket points at the goal: that bucket's allocation becomes the amount
 *   (`changedTo`, the same function typing into Plan's own field calls, so the
 *   two places cannot disagree about what a typed figure does to the rest).
 * - None does: a bucket has to be made, and the caller makes it (it is a write
 *   this file does not do).
 * - More than one: the sum is the figure and no single field is it. Edit on Plan.
 */
export type GoalMonthlyEdit =
  | { readonly kind: 'ALLOCATIONS'; readonly allocations: readonly Allocation[] }
  | { readonly kind: 'NEEDS_BUCKET'; readonly existingBucketId: string | undefined }
  | { readonly kind: 'SEVERAL_BUCKETS'; readonly count: number }

export function editGoalMonthly(
  allocations: readonly Allocation[],
  buckets: readonly SplitBucket[],
  goalId: string,
  minor: number,
  splittable: Money,
  order: readonly string[],
  /** What the bucket comes to now: a percentage is first turned into this fixed amount. */
  currentMinor: number,
  kind: BucketPointsAt = 'SAVING_GOAL',
): GoalMonthlyEdit {
  const mine = buckets.filter(
    (bucket) => bucket.targetKind === kind && bucket.targetId === goalId,
  )
  const used = mine.flatMap((bucket) => allocations.filter((one) => one.bucketId === bucket.id))
  if (used.length > 1) return { kind: 'SEVERAL_BUCKETS', count: used.length }
  const [only] = used
  if (only === undefined) return { kind: 'NEEDS_BUCKET', existingBucketId: mine[0]?.id }
  // A typed amount is a fixed amount. A bucket sized as a percentage or as what is
  // left becomes one at what it comes to now, and then moves to the typed figure
  // through the same trade Plan's own field makes.
  const fixed: readonly Allocation[] =
    only.mode === 'FIXED_AMOUNT'
      ? allocations
      : allocations.map((one) =>
          one.id === only.id
            ? { ...one, mode: 'FIXED_AMOUNT', basisPoints: undefined, amount: money(currentMinor, splittable.currency) }
            : one,
        )
  // Typed from Goals, Debts or Categories, the amount is taken from (or given back to) Plan's
  // *Everything else* when the plan has one, as the approved Wealth mockup says (M28 F10): the
  // buckets beside it on Plan are somebody else's decision. Plan's own field and divider keep
  // D-321's flow to the right.
  if (fixed.some((one) => one.mode === 'REMAINDER')) {
    return {
      kind: 'ALLOCATIONS',
      allocations: fixed.map((one) =>
        one.id === only.id ? { ...one, mode: 'FIXED_AMOUNT', basisPoints: undefined, amount: money(Math.max(0, minor), splittable.currency) } : one,
      ),
    }
  }
  return {
    kind: 'ALLOCATIONS',
    allocations: changedTo(fixed, only.id, Math.max(0, minor), splittable, { overflow: true, order }),
  }
}
