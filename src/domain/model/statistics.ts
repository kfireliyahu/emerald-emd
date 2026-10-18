/**
 * Statistics — the shapes. docs/f10-statistics-and-reports.md, with every
 * definition coming from docs/05's "Statistics definitions" rather than being
 * re-decided here.
 *
 * Shapes only; the arithmetic is `@/domain/statistics.ts`. Plain TypeScript: no
 * React, no sql.js, no DOM, no database (docs/conventions.md).
 *
 * **This module does not sum a ledger, and there is no signature here that would
 * let it.** docs/f10 is explicit that aggregation happens in SQL — with 60,000
 * transactions, folding in memory is not an option — so what arrives here is one
 * row per month, already grouped, and what leaves is the arithmetic that can be
 * *wrong*: the deltas, the averages, the shares, the rollups and the totals. The
 * split is the same one F13 drew between `fundRepository` and `domain/funds.ts`,
 * and it is why the acceptance criterion about 200 ms is a query problem rather
 * than a problem with anything in this file.
 *
 * Four rules hold across every shape below, each of them a way a chart can lie:
 *
 * - **Zero and unknown are different.** A month with no data is absent, never a
 *   zero — docs/f10's edge case, and the reason a year is twelve
 *   `MonthSummary | undefined` slots rather than twelve numbers. A gap drawn as
 *   a zero says spending stopped; a gap drawn as a gap says nobody knows.
 * - **A partial month is not an average.** `isComplete` travels with every
 *   observation and every function that averages takes only the complete ones,
 *   with no parameter to include them. A month in progress compared against
 *   three finished ones always looks like an improvement.
 * - **Saving is not spending.** It is never subtracted from a balance; it is its
 *   own figure beside one. docs/05 says so and the shapes make it awkward to do
 *   otherwise — there is no `expenses` field that anything saved could reach.
 * - **A comparison that cannot be made is a variant, not a zero delta.** No
 *   previous month, no year-ago month, fewer than three complete months to
 *   average — each says which, because "0% versus last year" and "there is no
 *   last year" are opposite claims.
 */

import type { Money } from '@/core/money.ts'
import type { LocalDate, YearMonth } from '@/core/time.ts'
import type { Cadence } from '@/domain/model/fixed.ts'

/**
 * One month as SQL grouped it — the only thing this domain reads spending from.
 *
 * **The two halves of "saved" arrive separately**, and that is not tidiness. The
 * effective savings rate in docs/05 is `Σ payslip saving lines + Σ saving
 * deposits`, and since D-077 a payslip line linked to a goal produces **both** —
 * a payroll saving line on one side and a `FROM_PAYCHECK_DEDUCTION` deposit on
 * the other. Summed by a caller, that money is counted twice. Splitting the
 * field puts the one place the sum happens inside this domain, where the rule
 * can be stated once: `deposited` is deposits the payslip did not already
 * account for.
 */
export interface MonthObservation {
  readonly period: YearMonth
  /**
   * `|Σ outflows|` on the configured date basis, transfers, rows excluded
   * from statistics and money `moved` already dropped by the query. A magnitude, per docs/05's
   * sign convention: spending is reported as a positive number.
   */
  readonly outflow: Money
  /**
   * `Σ inflows` that are not the salary deposit `payrollNet` already counts.
   * Matching a salary deposit to its payslip is F06's job (D-078); by the time a
   * month reaches here it has been done, or the deposit is genuinely other
   * income.
   */
  readonly inflow: Money
  /** `Σ paycheck net` for the period. Zero when no slip was entered. */
  readonly payrollNet: Money
  /**
   * Money put aside inside the payslip — pension, study fund, severance.
   *
   * **The employee side only.** `payrollSavings` also reports the employer's
   * share, and that is the right figure for total compensation (D-048) — but it
   * never arrived as income, and `payrollNet` above does not contain it. Adding
   * it here would produce savings rates above 100% on a good pension.
   */
  readonly payrollSaved: Money
  /**
   * Money put aside outside it. **Excludes `FROM_PAYCHECK_DEDUCTION` deposits**,
   * which `payrollSaved` already counts, and excludes opening balances and
   * market growth, which are in a balance and are not saving (D-081).
   */
  readonly deposited: Money
  /**
   * Money moved to something the person owns: the transactions a row of a
   * format they declared links, net (M28 U2, D-309). **Left out of `outflow`
   * and `inflow`** — a transfer to a broker is not spending and a sale is not
   * income — and saved instead, whatever the category says. Negative when more
   * came back out than went in.
   */
  readonly moved: Money
  readonly transactionCount: number
  /**
   * False while the month is still running. Every average excludes it, and the
   * screen labels it "month in progress" (docs/f10).
   */
  readonly isComplete: boolean
}

/**
 * What a month came to — docs/05's four definitions and nothing else.
 *
 * `balance` is `income − expenses` and **`saved` is not subtracted from it**.
 * docs/05: saving is not spending. It sits beside the balance as "of which
 * saved", which is a different sentence from "and then this left".
 */
export interface MonthSummary {
  readonly period: YearMonth
  /** `payrollNet + inflow`. */
  readonly income: Money
  /** `outflow`. A magnitude. */
  readonly expenses: Money
  /** `income − expenses`. Negative is a real answer, never clamped. */
  readonly balance: Money
  /** `payrollSaved + deposited + moved`, each counted once. */
  readonly saved: Money
  /** `saved ÷ income`. Undefined when nothing came in — not a zero rate. */
  readonly savingsRateBasisPoints: number | undefined
  readonly transactionCount: number
  readonly isComplete: boolean
}

/**
 * One comparison, or the reason there is not one.
 *
 * docs/f10 asks for three chips on the monthly summary — last month, the
 * three-month average, the same month last year — and each of them can be
 * unanswerable in a way that is worth saying out loud. A document with two
 * months of history has no year-ago figure, and printing "0%" there is a claim
 * about a month nobody imported.
 *
 * `basisPoints` is the change **relative to the basis**: +2,500 is a quarter
 * more than before. Undefined when the basis is zero, because a rise from
 * nothing is not a percentage — the figures are both carried so the screen can
 * say "₪0 → ₪1,240" instead.
 */
export type Comparison =
  | { readonly kind: 'NO_BASIS'; readonly reason: ComparisonGap }
  | {
      readonly kind: 'DELTA'
      readonly basis: Money
      readonly current: Money
      readonly difference: Money
      readonly basisPoints: number | undefined
    }

export type ComparisonGap =
  /** The month it would compare against is not in the document. */
  | 'NO_SUCH_MONTH'
  /** Fewer than `AVERAGE_MONTHS` complete months to average, so no average. */
  | 'NOT_ENOUGH_MONTHS'
  /** The month being compared is still running; it is not comparable yet. */
  | 'MONTH_IN_PROGRESS'

/** One category's month, as SQL grouped it. */
export interface CategoryObservation {
  /** Undefined is the uncategorized bucket, which is always shown (docs/f10). */
  readonly categoryId: string | undefined
  /** Its parent, for the rollup. Undefined on a top-level category. */
  readonly parentId: string | undefined
  readonly name: string
  /** `|Σ outflows|` in this category this month. A magnitude. */
  readonly outflow: Money
  readonly transactionCount: number
}

/**
 * One line of the category breakdown.
 *
 * `shareBasisPoints` is of the month's whole spending, so the lines add to
 * 10,000 — give or take rounding, which is why the screen prints the amounts
 * beside them and never reconstructs one from a percentage.
 */
export interface CategoryLine {
  readonly categoryId: string | undefined
  readonly name: string
  readonly outflow: Money
  readonly transactionCount: number
  readonly shareBasisPoints: number | undefined
  /** Against this category's own three-month average. `NO_BASIS` when new. */
  readonly comparison: Comparison
  /** Present only on a rolled-up parent, in the same order. */
  readonly children: readonly CategoryLine[]
}

/** One day of a month's running spend — docs/f10's cumulative curve. */
export interface CumulativePoint {
  readonly day: number
  /** Spending from the first of the month to the end of this day. */
  readonly runningTotal: Money
}

/**
 * The cumulative curve, its ghost, and where the month is heading.
 *
 * `projection` is docs/f10's open question settled the way it recommends: a
 * neutral figure on this chart and nowhere else. It is deliberately not a
 * verdict — no "you are overspending" — and it is absent entirely on a finished
 * month, where the total is not a projection but the answer.
 */
export interface CumulativeCurve {
  readonly period: YearMonth
  readonly points: readonly CumulativePoint[]
  /** The previous month's curve, for the ghost. Empty when there is none. */
  readonly previous: readonly CumulativePoint[]
  readonly daysInMonth: number
  /** How far through the month the data goes. Equals `daysInMonth` when done. */
  readonly daysElapsed: number
  /** At this rate, the month's total. Undefined once the month is complete. */
  readonly projectedTotal: Money | undefined
}

/** One day's spending, as SQL grouped it. */
export interface DayObservation {
  readonly date: LocalDate
  /** `|Σ outflows|` that day. A magnitude. */
  readonly outflow: Money
}

/**
 * A year, with its gaps intact.
 *
 * `months` is always twelve slots, January first, and a month nobody imported is
 * `undefined` rather than an empty summary — docs/f10's "zero and unknown are
 * different", held by the type rather than by care.
 *
 * **Every total here is a sum of the same twelve slots the table prints**, which
 * is F10's first acceptance criterion made structural: there is no second query
 * for the yearly figure that could disagree with the monthly ones.
 */
export interface YearOverview {
  readonly year: number
  readonly months: readonly (MonthSummary | undefined)[]
  readonly income: Money
  readonly expenses: Money
  readonly balance: Money
  readonly saved: Money
  readonly savingsRateBasisPoints: number | undefined
  /** How many of the twelve carry data, and how many of those are finished. */
  readonly monthsWithData: number
  readonly completeMonths: number
  /** Averages over the complete months only. Undefined when there are none. */
  readonly averageIncome: Money | undefined
  readonly averageExpenses: Money | undefined
  /** By balance, among complete months. docs/f10 asks for both. */
  readonly bestMonth: MonthSummary | undefined
  readonly worstMonth: MonthSummary | undefined
}

// --- Income detail ----------------------------------------------------------

/**
 * Where one line of a month's income came from.
 *
 * `PAYSLIP` is a slip entered in F04 and `LEDGER` is a positive row in the
 * ledger, and the two are counted from different places on purpose:
 * `MonthSummary.income` is `payrollNet + inflow`, so a detail that read the
 * salary out of the bank statement instead would be a second definition of the
 * same figure — the one thing D-078 exists to prevent.
 */
export type IncomeSourceKind = 'PAYSLIP' | 'LEDGER'

/**
 * One thing that brought money in, before the shares are worked out.
 *
 * A payslip is one slip; a ledger line is one **merchant**, not one row, for the
 * reason the merchant leaderboard groups the same way — four rent refunds from
 * one landlord are one source of income, and a month with two hundred inflows
 * would otherwise be a list nobody reads with a total nobody can check against
 * it.
 */
export interface IncomeObservation {
  readonly kind: IncomeSourceKind
  /** The payslip's employer, or the merchant the money came from. */
  readonly name: string
  readonly amount: Money
  /** The payslip's id, or the normalized merchant — what the line drills on. */
  readonly ref: string
  /** What the rows are filed under, when they agree. Absent on a payslip. */
  readonly categoryName: string | undefined
  /** How many rows made it up. One, for a payslip. */
  readonly count: number
  /** The latest date it arrived on. */
  readonly date: LocalDate
  /**
   * What the bank says about this salary (D-317): on a slip, whether the deposit
   * that paid it agrees; on a ledger line, that the deposit has no slip. Absent
   * on any other income.
   */
  readonly salary?: SalaryBank | undefined
}

/**
 * The slip against its deposit. **The slip is the figure and the deposit is what
 * proves it** (D-317), so an agreeing deposit is shown quietly and everything
 * else says what is the matter.
 *
 * `AGREES` and `DIFFERS` carry the deposit, which may have landed a month after
 * the slip's month — a slip for April is often paid in early May, and the slip
 * stays in April. `NO_DEPOSIT` is a slip paid in a month the bank statements
 * cover and nothing arrived; `UNCHECKED` is one paid in a month they do not, so
 * nothing was looked for. `NO_SLIP` is a deposit filed as salary that no slip
 * accounts for.
 */
export type SalaryBank =
  | { readonly kind: 'AGREES'; readonly landed: Money; readonly landedOn: LocalDate; readonly count: number }
  | {
      readonly kind: 'DIFFERS'
      readonly landed: Money
      readonly landedOn: LocalDate
      readonly count: number
      /** Landed minus the slip's net. Positive means more arrived than the slip says. */
      readonly difference: Money
    }
  | { readonly kind: 'NO_DEPOSIT' }
  | { readonly kind: 'UNCHECKED' }
  | { readonly kind: 'NO_SLIP' }

/** One line of the income detail, with its share of what came in. */
export interface IncomeLine extends IncomeObservation {
  readonly shareBasisPoints: number | undefined
}

/**
 * docs/f10's income detail — "paychecks in the period plus non-salary inflows".
 *
 * **`total` is `MonthSummary.income` reconstructed from its parts**, and that is
 * the whole reason this shape carries it: a detail that does not add up to the
 * headline above it is worse than no detail, because it makes the reader
 * distrust both numbers rather than one.
 *
 * **A salary is one line** (D-317): the slip, with the deposit that paid it said
 * on it. The deposit is not a second line and is not in `total`, wherever it
 * landed; `problems` is how many lines say something is the matter with one.
 */
export interface IncomeDetail {
  readonly period: YearMonth
  /** `Σ payslip net`. */
  readonly payroll: Money
  /** `Σ inflow rows`. */
  readonly other: Money
  /** `payroll + other`. Equals `MonthSummary.income`. */
  readonly total: Money
  /** Biggest first, payslips and ledger rows in one list. */
  readonly lines: readonly IncomeLine[]
  readonly payrollShareBasisPoints: number | undefined
  /** How many salaries disagree with the bank, never arrived, or arrived with no slip. */
  readonly problems: number
}

// --- Fixed versus variable --------------------------------------------------

/**
 * What became of one fixed expense this month.
 *
 * The answers that are not `CHARGED` are all "no figure", and they are four
 * because the reasons are not interchangeable: a bill that did not arrive is a
 * question, a bill that was never due this month is not, a pension deduction is
 * a certainty the ledger cannot see, and a manual entry is a number only the
 * user holds. Collapsing them into one absence is how `fixedExpenseBasis`' most
 * dangerous bug gets back in — the payroll deduction quietly rejoining a total
 * that is compared against income.
 */
export type FixedLineStatus =
  /** Charges in this month's ledger. The only status counted in `fixed`. */
  | 'CHARGED'
  /** Live, ledger-matched, due this month, and nothing matched it. */
  | 'NOT_CHARGED'
  /**
   * Not one of its months at all — `isChargeMonth` says so. A bimonthly water
   * bill is not missing in its off month, and reporting it as missing every
   * other month is the alert that cries wolf that function exists to refuse.
   */
  | 'NOT_DUE'
  /** A payroll deduction: real money, already out of net, never in `fixed`. */
  | 'OUT_OF_NET'
  /** `MANUAL_ONLY`: nothing in the ledger can answer what it cost. */
  | 'NOT_TRACKED'

/** One month's charges for one fixed expense, as SQL grouped them. */
export interface FixedMatch {
  readonly expenseId: string
  readonly outflow: Money
  readonly transactionCount: number
}

export interface FixedLine {
  readonly expenseId: string
  readonly name: string
  readonly status: FixedLineStatus
  /** What the ledger holds for it. Zero on every status but `CHARGED`. */
  readonly outflow: Money
  readonly transactionCount: number
  /** Its declared monthly share — the figure for the ones the ledger cannot answer. */
  readonly monthlyShare: Money
  /** Which months are its months, for a line that has to say why it is empty. */
  readonly cadence: Cadence
  /** Of the month's whole spending. Undefined when nothing was spent. */
  readonly shareBasisPoints: number | undefined
  /** Fixed and cuttable are different axes (docs/08 B1). */
  readonly isDiscretionary: boolean
  /**
   * What the ledger would have to be filtered by to show this line's charges —
   * a merchant or a category — so the line drills like every other figure on
   * the screen (docs/f10's first non-negotiable). Absent on the two statuses
   * with no ledger rows behind them.
   */
  readonly on: 'MERCHANT' | 'CATEGORY' | undefined
  readonly matchRef: string | undefined
}

/**
 * docs/f10's fixed-versus-variable split of a month's spending.
 *
 * **A split of what was actually charged, not of what was declared.** Every
 * shekel in `expenses` is on one side or the other and `fixed + variable` is
 * `MonthSummary.expenses` by construction, because the two come out of one
 * grouping of one scan rather than being counted separately and hoped to agree.
 *
 * **A payroll deduction is not on either side.** It never touched the ledger, so
 * there is no charge to classify; it appears as an `OUT_OF_NET` line carrying
 * its declared share and it is *not* in `fixed`. This is `fixedExpenseBasis`'
 * rule arriving in a second caller: docs/f09 calls double-subtracting it the
 * most dangerous bug in the feature, and a screen that folded it into "fixed"
 * and then took a percentage of income would be that bug with a chart on it.
 *
 * `fixedShareBasisPoints` is measured against **this month's income** — the
 * figure in the headline directly above it — rather than against take-home.
 * docs/f09's "% of take-home" is on the fixed expenses screen, where net is the
 * basis of everything; a percentage here against a denominator this screen does
 * not print is the quiet disagreement one `monthlyReport` call exists to stop.
 */
export interface SpendingSplit {
  readonly period: YearMonth
  /** Charges an active, ledger-matched fixed expense claims. */
  readonly fixed: Money
  /** Everything else that went out. */
  readonly variable: Money
  /** `fixed + variable`. Equals `MonthSummary.expenses`. */
  readonly expenses: Money
  /** The part of `fixed` the user marked cuttable. */
  readonly discretionary: Money
  /** `fixed ÷ expenses`. Undefined when nothing was spent. */
  readonly fixedShareBasisPoints: number | undefined
  /** `variable ÷ expenses`. Its own division, not ten thousand minus the other. */
  readonly variableShareBasisPoints: number | undefined
  /** `fixed ÷ income`. Undefined when nothing came in — not a zero. */
  readonly fixedShareOfIncomeBasisPoints: number | undefined
  /** Every live fixed expense, charged or not. Biggest charge first. */
  readonly lines: readonly FixedLine[]
}
