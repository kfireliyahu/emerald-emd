/**
 * The splitter — `SplitPlan`, `SplitBucket` and `Allocation` in
 * docs/04-data-model.md, and docs/f05-paycheck-splitter.md.
 *
 * Shapes only; the math is `@/domain/splitter.ts`. Plain TypeScript: no React,
 * no sql.js, no DOM, no database (docs/conventions.md).
 *
 * This is the app's forward-looking half. Everything else in the model records
 * what happened; this records what the user intends to happen, which is why
 * nothing here is derived from a transaction and nothing here changes a ledger.
 *
 * Two of docs/04's fields are deliberately not on these types, each because it
 * was a second name for something the model already had — the same call D-037
 * made about three `CategoryRule` fields:
 *
 * - **`SplitPlan.subtractFixedExpenses`** is `fixedExpenseMode !== 'NONE'`. Two
 *   fields that can disagree about one fact is a bug with a schema behind it.
 * - **`Allocation.percentage` as a decimal** is a float in the money path's
 *   vicinity. Rates in this app are integer basis points and always have been
 *   (docs/05), so the column is `basisPoints`: 2350 is 23.5%.
 */

import type { CurrencyCode, Money } from '@/core/money.ts'

/** Where the amount being split comes from (docs/f05). */
export const BASIS_KINDS = [
  'LAST_PAYCHECK',
  'AVERAGE_LAST_N',
  'SPECIFIC_PAYCHECK',
  /** "What if I earned X" — and the fallback when no paycheck exists yet. */
  'CUSTOM_AMOUNT',
] as const

export type BasisKind = (typeof BASIS_KINDS)[number]

/**
 * What a bucket points at, and therefore what applying the plan would do.
 *
 * **All five ship in the schema**, including the two whose tables do not exist
 * yet. A `CHECK` constraint cannot be altered in SQLite without rebuilding the
 * table, and migrations are immutable after release (D-020) — so the vocabulary
 * is the one thing here that has to be complete on day one. Which of them the
 * *screen* offers is a different question with a different answer, and it is
 * answered on the screen (D-056).
 */
export const TARGET_KINDS = [
  /** Its budget is this bucket, read and written as one figure (D-327). */
  'CATEGORY',
  /** Suggests a deposit. */
  'SAVING_GOAL',
  /** Suggests a payment. */
  'DEBT',
  /**
   * A fund, or an account: where the money is meant to end up, compared with
   * nothing and applied as nothing (M28 U7, D-319). Stored as itself since
   * M36 U09, beside the link it names.
   */
  'FUND',
  'ACCOUNT',
  /** A plan and nothing else. "Fun money." */
  'FREE',
] as const

export type TargetKind = (typeof TARGET_KINDS)[number]

export const ALLOCATION_MODES = ['PERCENTAGE', 'FIXED_AMOUNT', 'REMAINDER'] as const

export type AllocationMode = (typeof ALLOCATION_MODES)[number]

/**
 * A saved plan: where the money comes from, and what comes off the top.
 *
 * The buckets are **not** owned by a plan — see `SplitBucket`. What a plan owns
 * is its basis and its allocations.
 */
export interface SplitPlan {
  readonly id: string
  readonly name: string
  readonly basisKind: BasisKind
  /** Whichever the basis needs; the other two are undefined. */
  readonly basisPaycheckId: string | undefined
  readonly basisMonths: number | undefined
  readonly customAmount: Money | undefined
  /** The currency every amount in this plan is denominated in. */
  readonly currency: CurrencyCode
  readonly isDefault: boolean
}

/** Which of 50 / 30 / 20 a bucket was made for: the heading it is under on Plan (M31 U4). */
export const BUCKET_SHARES = ['NEEDS', 'WANTS', 'SAVING'] as const

export type BucketShare = (typeof BUCKET_SHARES)[number]

/**
 * A destination. **Shared across plans**, which is what docs/04's
 * `SplitPlan ──< Allocation ──> SplitBucket` diagram says and what makes
 * "Default" and "Bonus month" comparable: the same six buckets, different
 * percentages.
 *
 * `isBuffer` is therefore a property of the destination rather than of a plan.
 * Two plans disagreeing about which bucket absorbs a stray agora is a
 * distinction with nothing behind it.
 */
export interface SplitBucket {
  readonly id: string
  readonly name: string
  readonly targetKind: TargetKind
  /** Which category, goal or debt. Never a foreign key — it points at four tables. */
  readonly targetId: string | undefined
  readonly color: string | undefined
  readonly sortOrder: number
  /**
   * Absorbs the **rounding** leftover — the agorot floor division threw away,
   * never more than one per other bucket.
   *
   * Not to be confused with a `REMAINDER` allocation, which absorbs the
   * **balance**: everything the plan did not assign, which can be thousands.
   * docs/04 and docs/05 describe both and it is easy to read them as one thing.
   */
  readonly isBuffer: boolean
  /**
   * Counted among the months of expenses the cushion holds, beside the fixed expenses: the
   * person's own say that Groceries is as unavoidable as the rent (M28 F10). Absent is no.
   */
  readonly inCushion?: boolean
  /** The 50 / 30 / 20 share it counts as; undefined for a bucket that is none of them. */
  readonly share?: BucketShare | undefined
}

/** How much of the splittable amount one bucket gets, in one plan. */
export interface Allocation {
  readonly id: string
  readonly planId: string
  readonly bucketId: string
  readonly mode: AllocationMode
  /** Integer basis points of the splittable amount. 2350 is 23.5%. */
  readonly basisPoints: number | undefined
  readonly amount: Money | undefined
  /** A locked allocation never moves when another slider is dragged. */
  readonly isLocked: boolean
}

