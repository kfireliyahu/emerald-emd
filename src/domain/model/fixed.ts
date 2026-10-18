/**
 * Fixed monthly expenses — `FixedExpense` and `FixedExpenseCandidate` in
 * docs/04-data-model.md, and docs/f09-fixed-monthly-expenses.md.
 *
 * Shapes only; the math is `@/domain/fixedExpenses.ts`. Plain TypeScript: no
 * React, no sql.js, no DOM, no database (docs/conventions.md).
 *
 * Two things this model insists on, because getting either wrong makes every
 * plan the splitter produces wrong:
 *
 * - **A candidate is not a fixed expense.** The detector's output is regenerated
 *   from the ledger on demand and never stored (docs/f09). Only the user
 *   confirming one creates a row. That is why `FixedExpenseCandidate` has no
 *   `id`: there is nothing to address it by, because it does not persist.
 * - **`matchKind` decides whether an amount is subtracted at all.** A
 *   `PAYCHECK_DEDUCTION` is already out of net, so subtracting it from net again
 *   double-counts it — docs/f09 calls that the most dangerous bug in the
 *   feature. The rule is enforced in one place, `fixedExpenseBasis`, and this
 *   enum is what it reads.
 */

import type { CurrencyCode, Money } from '@/core/money.ts'
import type { LocalDate, YearMonth } from '@/core/time.ts'

/**
 * How future occurrences of a fixed expense are recognized.
 *
 * `MANUAL_ONLY` is a real answer, not a fallback: an annual insurance premium
 * the app has never seen a charge for is still a number the user plans against.
 */
export const FIXED_EXPENSE_MATCH_KINDS = [
  'MERCHANT_PATTERN',
  'CATEGORY',
  /** Already removed from net by the payslip. Never subtracted from net again. */
  'PAYCHECK_DEDUCTION',
  'MANUAL_ONLY',
] as const

export type FixedExpenseMatchKind = (typeof FIXED_EXPENSE_MATCH_KINDS)[number]

export const CADENCES = ['MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'YEARLY', 'IRREGULAR'] as const

export type Cadence = (typeof CADENCES)[number]

/**
 * How many months one cycle of a cadence spans — what amortization divides by.
 *
 * `IRREGULAR` is 1 because it has no cycle to divide by: an expense with no
 * schedule is planned for at whatever it was last worth, every month, which is
 * the only assumption that does not silently under-provide.
 */
export const CYCLE_MONTHS: Readonly<Record<Cadence, number>> = {
  MONTHLY: 1,
  BIMONTHLY: 2,
  QUARTERLY: 3,
  YEARLY: 12,
  IRREGULAR: 1,
}

/** Rent does not move; electricity does. Drives whether a change is an alert. */
export const AMOUNT_VARIABILITIES = ['FIXED', 'VARIABLE'] as const

export type AmountVariability = (typeof AMOUNT_VARIABILITIES)[number]

export const FIXED_EXPENSE_SOURCES = [
  'USER_DEFINED',
  /** Found in the statements and confirmed; one not yet answered is worked out on read (`billCandidates`). */
  'DETECTED_CONFIRMED',
] as const

export type FixedExpenseSource = (typeof FIXED_EXPENSE_SOURCES)[number]

export const CONFIDENCE_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const

export type Confidence = (typeof CONFIDENCE_LEVELS)[number]

/**
 * A recurring bill the user has committed to, in the document.
 *
 * `startedAt` is also the **cadence anchor**: which months a non-monthly charge
 * actually lands in is counted in whole cycles from it. That is why it is not
 * decoration — an annual premium with no start date has a monthly share and no
 * charge month, and the screen has to be able to say so.
 */
export interface FixedExpense {
  readonly id: string
  readonly name: string
  readonly categoryId: string | undefined
  readonly matchKind: FixedExpenseMatchKind
  /** The merchant pattern, category id or deduction type id `matchKind` names. */
  readonly matchRef: string | undefined
  /** The whole charge, not the monthly share. A yearly premium holds the year's figure. */
  readonly expectedAmount: Money
  readonly amountVariability: AmountVariability
  readonly cadence: Cadence
  readonly dayOfMonthHint: number | undefined
  /**
   * Fixed and necessary are different axes (docs/08 B1). A gym membership is
   * fixed and cuttable; rent is neither.
   */
  readonly isDiscretionary: boolean
  readonly source: FixedExpenseSource
  readonly isActive: boolean
  /** Also the cadence anchor. See above. */
  readonly startedAt: LocalDate | undefined
  /** A cancelled subscription stops appearing in projections from here. */
  readonly endedAt: LocalDate | undefined
}

/**
 * One month of a candidate's history — what the amount sparkline draws.
 *
 * A month rather than a charge: two charges from one merchant in one month are
 * one month's worth of that bill, and it is the monthly figure a projection
 * plans against.
 */
export interface CandidateMonth {
  readonly period: YearMonth
  /** A magnitude. Outflows are stored signed and compared unsigned here. */
  readonly amount: Money
  /** How many charges made it up. More than one is not disqualifying (docs/f09). */
  readonly charges: number
}

/**
 * Detector output awaiting an answer. **Never stored** (docs/f09) — regenerated
 * from the ledger every time the screen asks, which is why it has no id.
 */
export interface FixedExpenseCandidate {
  readonly merchantNormalized: string
  /** The spelling most of its rows use, for showing a name the user recognizes. */
  readonly merchantRaw: string
  readonly currency: CurrencyCode
  /** Oldest first. `occurrences` is its length: distinct months, not charges. */
  readonly months: readonly CandidateMonth[]
  readonly occurrences: number
  /** The median monthly figure — what confirming this would propose. */
  readonly medianAmount: Money
  readonly amountVariability: AmountVariability
  /** Coefficient of variation of the monthly figures, in basis points. */
  readonly amountSpreadBasisPoints: number
  /** Widest gap between days-of-month, wraparound handled. Lower is more regular. */
  readonly dayOfMonthSpread: number
  readonly dayOfMonthHint: number
  readonly suggestedCadence: Cadence
  readonly confidence: Confidence
  readonly lastSeen: LocalDate
  /** The category most of its rows are already in, when they are in one. */
  readonly categoryId: string | undefined
}

/**
 * One charge, as the detector reads it: the pure input `detectFixedExpenses`
 * groups.
 *
 * Deliberately smaller than `StoredTransaction`. The detector is pure over rows
 * (docs/conventions.md), the date basis has already been resolved by whoever
 * built these — charge date falling back to transaction date, D-006 — and
 * nothing in here can be traced back to a database.
 */
export interface ExpenseObservation {
  readonly merchantNormalized: string
  readonly merchantRaw: string
  readonly date: LocalDate
  /**
   * The day the shop charged it, when that is not `date` — a card line, whose
   * `date` is the statement's charge date (M37 F2). A card charges every line
   * on one day, so the day of the month a bill keeps is read from here; the
   * month it counts in is still `date`'s.
   */
  readonly transactionDate?: LocalDate | undefined
  /** Signed as stored: outflow negative (D-004). Inflows are not candidates. */
  readonly amount: Money
  readonly categoryId: string | undefined
}

/**
 * What one fixed expense does to one plan (M28 U7, D-319): it comes out of net
 * before the split, it is one share of the split, or the plan leaves it out.
 * **The choice is per plan and per expense**, which is what replaced the two
 * plan-wide settings that could only say it for all of them at once. A bill
 * taken from the payslip is outside the choice (D-053).
 */
export const FIXED_ROLES = ['NET', 'SPLIT', 'IGNORE'] as const

export type FixedRole = (typeof FIXED_ROLES)[number]
