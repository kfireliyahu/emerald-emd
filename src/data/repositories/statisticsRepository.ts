/**
 * The aggregates every statistics screen reads — docs/f10's query design.
 *
 * **Aggregation happens here, in SQL, and never in the domain.** docs/f10 is
 * explicit about it: with 60,000 transactions, folding rows in memory is not an
 * option, and the acceptance criterion about rendering in under 200 ms is a
 * query problem rather than an arithmetic one. So this file groups and sums, and
 * `@/domain/statistics.ts` does everything on top — the deltas, the averages,
 * the shares, the rollups. Neither half can do the other's job, which is what
 * keeps "the category totals equal the drill-down" a property rather than a
 * coincidence.
 *
 * Three things worth knowing before reading further:
 *
 * - **One date basis, in one place.** Charge date falling back to transaction
 *   date (D-006), spelled once as `BASIS` and used by every query here. docs/f10
 *   requires that switching the basis changes every screen together; a second
 *   spelling of it in one query is how that promise breaks.
 * - **"Saved" is assembled from two sources that overlap.** docs/05's savings
 *   rate is payslip saving lines plus saving deposits, and since D-077 a payslip
 *   line linked to a goal produces *both*. `payrollSaved` comes from the
 *   payslips and `deposited` excludes the deposits those payslips generated, so
 *   the money is counted once. That is the one figure on these screens that
 *   could be double the truth. A third source, `moved` (D-309), overlaps
 *   neither: transactions a declared format links, which no deposit names.
 * - **A month in progress is marked, not hidden.** `isComplete` is decided
 *   against a date the caller passes rather than a clock, so a report is a
 *   function of the document and reads the same on any day — D-062's rule,
 *   arriving in the last feature that counts months.
 */

import type { Database } from 'sql.js'

import { money, sum, zero, type CurrencyCode, type Money } from '@/core/money.ts'
import {
  addMonths,
  compareYearMonths,
  daysInMonth,
  localDate,
  monthsBetween,
  parseISODate,
  parseYearMonth,
  toYearMonthString,
  yearMonthOf,
  type LocalDate,
  type YearMonth,
} from '@/core/time.ts'
import { ratioBasisPoints } from '@/core/percent.ts'
import { NON_CONTRIBUTION_SOURCE_KINDS } from '@/domain/model/savings.ts'
import type { FixedExpense } from '@/domain/model/fixed.ts'
import type {
  CategoryObservation,
  DayObservation,
  FixedMatch,
  IncomeObservation,
  MonthObservation,
  MonthSummary,
} from '@/domain/model/statistics.ts'
import { payrollSavingLines, payrollSavings, taxTotal } from '@/domain/paycheck.ts'
import {
  categoryBreakdown,
  compareMonth,
  cumulativeSpend,
  incomeDetail,
  ledgerClaims,
  spendingSplit,
  summarizeMonths,
  yearOverview,
  type LedgerClaim,
  type MonthComparisons,
} from '@/domain/statistics.ts'
import type {
  CategoryLine,
  CumulativeCurve,
  IncomeDetail,
  SpendingSplit,
  YearOverview,
} from '@/domain/model/statistics.ts'
import { query } from '../db/database.ts'
import {
  countsCondition,
  movedCondition,
  movedLines,
  pointedAtCondition,
  spendingRuleSql,
  type MovedLine,
} from './movedRepository.ts'
import { listDeductionTypes } from './deductionTypeRepository.ts'
import { listFixedExpenses } from './fixedExpenseRepository.ts'
import { findPaychecksForPeriod, listPaychecksWithLines } from './paycheckRepository.ts'
import { salaryCoveredRefs, salaryWithoutSlipRefs, slipBankStatus } from './salaryRepository.ts'
import { listTransactions, type StoredTransaction } from './transactionRepository.ts'

/**
 * The statistics date basis (D-006), written once.
 *
 * The monthly summary should match what left the bank account, so the charge
 * date leads and the transaction date is the fallback for a row that has none.
 */
const BASIS = 'COALESCE(charge_date, transaction_date)'

/**
 * The rows a spending total is allowed to see, per docs/05 — **the ledger's
 * declared `transaction.spending` rule, read where it is declared** (M36 U04):
 * not left out by the person or by a card settlement, not held (M30 U2, D-358),
 * not filed under Money moved (D-316). Beside it, what only code can say: a row
 * a person's own format links or an answered transfer's end (D-309, D-356) —
 * `movedMonths` counts those as saved instead — and a salary a slip already
 * counts (D-317).
 *
 * A function of the table alias rather than a bare string, so a query that joins
 * gets the same clause instead of a hand-written copy of it. docs/f10: no query
 * hardcodes the definition of an expense, and two spellings of "which rows
 * count" is that rule broken quietly — which is why the spelling is now the
 * declaration's, and the Statistics screen and the rollup cannot disagree.
 */
const spendable = (db: Database, alias = ''): string => {
  const prefix = alias === '' ? '' : `${alias}.`
  return `${spendingRuleSql(db, alias)} AND NOT ${pointedAtCondition(db, alias)}${coveredBySlip(db, prefix)}`
}

/**
 * A salary deposit matched to a slip is the slip's money arriving, so no income
 * figure counts it (D-317). Inlined as ids because the match is derived, not stored.
 */
function coveredBySlip(db: Database, prefix: string): string {
  const covered = [...salaryCoveredRefs(db)]
  if (covered.length === 0) return ''
  return ` AND ${prefix}id NOT IN (${covered.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ')})`
}

/**
 * The deposit kinds that are **not** this month's saving effort.
 *
 * Two of them come from the savings domain — an opening balance was already
 * there and a market gain was put there by the market (D-081) — and the third is
 * this module's own: a deposit generated by a payslip is already counted in
 * `payrollSaved`, so counting it again here would report every payroll saver as
 * saving twice what they do. Built from the domain's list rather than retyped,
 * so a fourth kind cannot arrive without passing through here.
 *
 * **And a deposit a goal's feed derived from a row** (M30 U4, D-357) is that row
 * read a second time: a row filed under a Money moved category is already in
 * `movedMonths`, and a buy inside an account with holdings is the transfer
 * that brought the cash there, which is moved at the bank's end (D-356). Counted
 * here too, every fed goal saved twice what it did.
 */
const NOT_THIS_MONTHS_SAVING: readonly string[] = [
  ...NON_CONTRIBUTION_SOURCE_KINDS,
  'FROM_PAYCHECK_DEDUCTION',
  'FROM_TRANSACTION',
]

// --- Observations -----------------------------------------------------------

/**
 * Every month the document holds anything for, as the domain reads it.
 *
 * A month appears if **anything** happened in it — a transaction, a payslip or a
 * deposit — so a month whose only event was a salary is a month, not a gap. What
 * is a gap is a month with none of the three, and that stays absent from the
 * result rather than arriving as a row of zeroes: docs/f10's "zero and unknown
 * are different", enforced by which months this query returns.
 */
export function monthObservations(
  db: Database,
  asOf: LocalDate,
  options?: { readonly currency?: CurrencyCode },
): readonly MonthObservation[] {
  const currency = options?.currency ?? documentCurrency(db)
  const flows = transactionMonths(db, currency)
  const payroll = payrollMonths(db, currency)
  const deposits = depositMonths(db, currency)
  const moved = movedMonths(db, currency)

  const periods = new Set<string>([
    ...flows.keys(),
    ...payroll.keys(),
    ...deposits.keys(),
    ...moved.keys(),
  ])
  const current = yearMonthOf(asOf)

  const observations: MonthObservation[] = []
  for (const key of periods) {
    const period = parseYearMonth(key)
    if (period === undefined) continue

    const flow = flows.get(key)
    const slips = payroll.get(key)

    observations.push({
      period,
      outflow: flow?.outflow ?? zero(currency),
      inflow: flow?.inflow ?? zero(currency),
      payrollNet: slips?.net ?? zero(currency),
      payrollSaved: slips?.saved ?? zero(currency),
      deposited: deposits.get(key) ?? zero(currency),
      moved: moved.get(key) ?? zero(currency),
      transactionCount: flow?.count ?? 0,
      // A month is finished when the month the report is being read in has moved
      // past it. Not a clock: the same document read on any day of July gives
      // the same answer about June.
      isComplete: compareYearMonths(period, current) < 0,
    })
  }

  return observations.sort((a, b) => compareYearMonths(a.period, b.period))
}

interface FlowMonth {
  readonly outflow: Money
  readonly inflow: Money
  readonly count: number
}

/**
 * Outflows and inflows per month, on the one basis.
 *
 * Rows in another currency are **left out rather than converted** — there is no
 * rate in this document (D-003) — and docs/f10 says the same in its own words:
 * all reporting is in ILS at the charged amount, with foreign originals shown
 * only on the transaction detail.
 */
function transactionMonths(db: Database, currency: CurrencyCode): ReadonlyMap<string, FlowMonth> {
  const rows = query(
    db,
    `SELECT substr(${BASIS}, 1, 7) AS period,
            COUNT(*) AS n,
            SUM(CASE WHEN amount_minor < 0 THEN -amount_minor ELSE 0 END) AS outflow,
            SUM(CASE WHEN amount_minor > 0 THEN amount_minor ELSE 0 END) AS inflow
       FROM fmt_transaction
      WHERE ${spendable(db)} AND amount_currency = ?
      GROUP BY period`,
    [currency],
  )

  return new Map(
    rows.map((row) => [
      String(row['period']),
      {
        outflow: money(Number(row['outflow'] ?? 0), currency),
        inflow: money(Number(row['inflow'] ?? 0), currency),
        count: Number(row['n'] ?? 0),
      },
    ]),
  )
}

interface PayrollMonth {
  readonly net: Money
  readonly saved: Money
}

/**
 * Net and payroll saving per salary month, from the payslips themselves.
 *
 * Not SQL, and deliberately: what counts as saving is `countsAsSaving` on the
 * deduction type, and `payrollSavings` is the one function that knows it (M3). A
 * `SUM` here with its own idea of which lines are saving would be a second
 * definition, and the first thing to disagree with it would be the paycheck
 * screen. Payslips are a handful of rows a year; this is not the query that
 * needs to be fast.
 *
 * **The employee side only**, because `net` above does not contain the
 * employer's share and a rate whose numerator did would exceed 100%.
 */
function payrollMonths(db: Database, currency: CurrencyCode): ReadonlyMap<string, PayrollMonth> {
  const types = listDeductionTypes(db)
  const months = new Map<string, PayrollMonth>()

  for (const entry of listPaychecksWithLines(db)) {
    if (entry.paycheck.net.currency !== currency) continue

    const key = toYearMonthString(entry.paycheck.period)
    const running = months.get(key) ?? { net: zero(currency), saved: zero(currency) }
    months.set(key, {
      net: sum([running.net, entry.paycheck.net], currency),
      saved: sum([running.saved, payrollSavings(entry, types).employee], currency),
    })
  }

  return months
}

/** The deposits saved counts: this currency, not a transfer between places, and this month's own effort. */
const countedDeposit = (prefix = ''): string =>
  `${prefix}amount_currency = ?
        AND ${prefix}transfer_group_key IS NULL
        AND ${prefix}source_kind NOT IN (${NOT_THIS_MONTHS_SAVING.map(() => '?').join(', ')})`

/**
 * Saving deposits per month that the payslips did not already account for.
 *
 * Transfers between holding places are excluded outright: the two legs net to
 * zero and neither is saving, so summing them is harmless and listing them would
 * suggest otherwise.
 */
function depositMonths(db: Database, currency: CurrencyCode): ReadonlyMap<string, Money> {
  const rows = query(
    db,
    `SELECT substr(date, 1, 7) AS period, SUM(amount_minor) AS saved
       FROM fmt_saving_deposit
      WHERE ${countedDeposit()}
      GROUP BY period`,
    [currency, ...NOT_THIS_MONTHS_SAVING],
  )

  return new Map(
    rows.map((row) => [String(row['period']), money(Number(row['saved'] ?? 0), currency)]),
  )
}

/** One saving line off a month's payslips: a pension, a study fund — the employee's part. */
export interface SavedFromSlip {
  readonly deductionTypeId: string
  readonly name: string
  readonly amount: Money
}

/** One goal's deposits that saved counts in a month. */
export interface SavedIntoGoal {
  readonly goalId: string
  readonly name: string
  readonly amount: Money
  readonly count: number
}

/**
 * **Where a month's saved came from, besides what moved** (M30 F1). Saved is the
 * slips' saving lines, the goal deposits nobody else counted, and what moved
 * (`movedLines`); Home showed only the last, so a month that moved ₪12,000 said
 * it saved more and could not say why. Asked: *"from where is this
 * number?"*. Read with the same gates `payrollMonths` and `depositMonths` use, so
 * the three parts add to `MonthSummary.saved` exactly.
 */
export interface SavedFrom {
  readonly slips: readonly SavedFromSlip[]
  readonly goals: readonly SavedIntoGoal[]
}

export function savedFrom(db: Database, period: YearMonth, currency: CurrencyCode): SavedFrom {
  const types = listDeductionTypes(db)
  const slips = new Map<string, SavedFromSlip>()
  for (const entry of listPaychecksWithLines(db)) {
    // `payrollMonths`'s own gates: the slip's period, and its currency.
    if (entry.paycheck.net.currency !== currency || compareYearMonths(entry.paycheck.period, period) !== 0) continue
    for (const line of payrollSavingLines(entry, types)) {
      const was = slips.get(line.deductionTypeId)
      slips.set(line.deductionTypeId, {
        deductionTypeId: line.deductionTypeId,
        name: line.name,
        amount: sum([was?.amount ?? zero(currency), line.employee], currency),
      })
    }
  }

  const goals = query(
    db,
    `SELECT d.goal AS goal_id, g.name AS name, SUM(d.amount_minor) AS saved, COUNT(*) AS n
       FROM fmt_saving_deposit d
       LEFT JOIN fmt_saving_goal g ON g.id = d.goal
      WHERE ${countedDeposit('d.')}
        AND substr(d.date, 1, 7) = ?
      GROUP BY d.goal
      ORDER BY ABS(saved) DESC`,
    [currency, ...NOT_THIS_MONTHS_SAVING, toYearMonthString(period)],
  ).map((row) => ({
    goalId: String(row['goal_id']),
    name: String(row['name'] ?? 'A goal this document no longer has'),
    amount: money(Number(row['saved'] ?? 0), currency),
    count: Number(row['n'] ?? 0),
  }))

  return { slips: [...slips.values()].filter((one) => one.amount.minor !== 0), goals }
}

/**
 * Money moved to something the person owns, per month, net (M28 U2, D-309).
 *
 * The transactions a declared format links, on the same date basis as every
 * other flow here and with the same rows excluded from statistics left out.
 * **Net, and so possibly negative**: a sale linked the same way brings money
 * back out of what they own, and a month that took more out than it put in
 * saved less than nothing — a smaller figure, not a hidden one.
 */
function movedMonths(db: Database, currency: CurrencyCode): ReadonlyMap<string, Money> {
  const moved = movedCondition(db)
  const rows = query(
    db,
    `SELECT substr(${BASIS}, 1, 7) AS period, SUM(-amount_minor) AS moved
       FROM fmt_transaction
      WHERE ${countsCondition()} AND amount_currency = ? AND ${moved}
      GROUP BY period`,
    [currency],
  )

  return new Map(
    rows.map((row) => [String(row['period']), money(Number(row['moved'] ?? 0), currency)]),
  )
}

/**
 * One month's spending per category, uncategorized included as its own row.
 *
 * The parent id comes out with it, because the rollup is the domain's and it
 * needs to know which rows belong under which — `categoryTotals` in
 * `categoryRepository` builds a display label instead and is the ledger's, not
 * this screen's.
 */
export function categoryObservations(
  db: Database,
  period: YearMonth,
  options?: { readonly currency?: CurrencyCode },
): readonly CategoryObservation[] {
  const currency = options?.currency ?? documentCurrency(db)
  return categoryRows(db, toYearMonthString(period), currency)
}

/**
 * Spending per category over whatever span the prefix names.
 *
 * `2026-06` is a month and `2026` is a year, and they are the same query because
 * the ISO date is a prefix of itself — which keeps "which rows count as
 * spending" written once. docs/f10: no query hardcodes the definition of an
 * expense, and two copies of this one would be exactly that.
 */
function categoryRows(
  db: Database,
  prefix: string,
  currency: CurrencyCode,
): readonly CategoryObservation[] {
  const rows = query(
    db,
    `SELECT t.category AS category_id, c.parent AS parent_id, COALESCE(c.name, 'Uncategorized') AS name,
            COUNT(*) AS n,
            SUM(CASE WHEN t.amount_minor < 0 THEN -t.amount_minor ELSE 0 END) AS outflow
       FROM fmt_transaction t
       LEFT JOIN fmt_category c ON c.id = t.category
      WHERE ${spendable(db, 't')}
        AND t.amount_currency = ?
        AND t.amount_minor < 0
        AND substr(${BASIS}, 1, ?) = ?
      GROUP BY t.category
      ORDER BY outflow DESC`,
    [currency, prefix.length, prefix],
  )

  return rows.map((row) => ({
    categoryId: row['category_id'] == null ? undefined : String(row['category_id']),
    parentId: row['parent_id'] == null ? undefined : String(row['parent_id']),
    name: String(row['name'] ?? 'Uncategorized'),
    outflow: money(Number(row['outflow'] ?? 0), currency),
    transactionCount: Number(row['n'] ?? 0),
  }))
}

/** One month's spending per day, for the cumulative curve. */
export function dayObservations(
  db: Database,
  period: YearMonth,
  options?: { readonly currency?: CurrencyCode },
): readonly DayObservation[] {
  const currency = options?.currency ?? documentCurrency(db)
  const rows = query(
    db,
    `SELECT ${BASIS} AS basis_date,
            SUM(CASE WHEN amount_minor < 0 THEN -amount_minor ELSE 0 END) AS outflow
       FROM fmt_transaction
      WHERE ${spendable(db)}
        AND amount_currency = ?
        AND amount_minor < 0
        AND substr(${BASIS}, 1, 7) = ?
      GROUP BY basis_date
      ORDER BY basis_date`,
    [currency, toYearMonthString(period)],
  )

  const observations: DayObservation[] = []
  for (const row of rows) {
    const date = parseISODate(String(row['basis_date']))
    if (date === undefined) continue
    observations.push({ date, outflow: money(Number(row['outflow'] ?? 0), currency) })
  }
  return observations
}

/**
 * The month's biggest single charges, **of the rows went out counts** (M30 F1).
 *
 * Home listed the five most negative rows of the month straight off the ledger,
 * so a bank row the person had said pays a card — excluded from every total,
 * because the card's own rows are the spending — still topped the list, as did
 * money moved and a buy inside an account with holdings. Reported: rows
 * marked *this pays a card* "still show up in biggest single charges". Now the
 * list is chosen by `spendable`, the one predicate every total here reads.
 */
export function largestCharges(
  db: Database,
  period: YearMonth,
  limit: number,
  options?: { readonly currency?: CurrencyCode },
): readonly StoredTransaction[] {
  const currency = options?.currency ?? documentCurrency(db)
  const ids = query(
    db,
    `SELECT id FROM fmt_transaction
      WHERE ${spendable(db)} AND amount_currency = ? AND amount_minor < 0
        AND substr(${BASIS}, 1, 7) = ?
      ORDER BY amount_minor ASC, rowid DESC
      LIMIT ?`,
    [currency, toYearMonthString(period), limit],
  ).map((row) => String(row['id']))
  return listTransactions(db, { ids }, limit, { column: 'AMOUNT', direction: 'ASC' })
}

// --- Reports ----------------------------------------------------------------

/** Every month, summarized. The backbone of every screen in F10. */
export function monthlySummaries(
  db: Database,
  asOf: LocalDate,
  options?: { readonly currency?: CurrencyCode },
): readonly MonthSummary[] {
  return summarizeMonths(monthObservations(db, asOf, options))
}

export interface MonthlyReport {
  readonly period: YearMonth
  readonly summary: MonthSummary | undefined
  /** Every month, so the screen can offer a month picker without a second read. */
  readonly months: readonly MonthSummary[]
  readonly spending: MonthComparisons
  readonly income: MonthComparisons
  readonly categories: readonly CategoryLine[]
  readonly curve: CumulativeCurve
  /** docs/f10's income detail: the headline's `income` shown as its parts. */
  readonly detail: IncomeDetail
  /** docs/f10's fixed-versus-variable split of the same month's spending. */
  readonly split: SpendingSplit
  /**
   * What moved this month, net per category (M28 F4, D-316): out of went out and
   * into saved, and listed so a wrong filing is seen rather than quietly
   * shrinking what went out.
   */
  readonly moved: readonly MovedLine[]
  /** The rest of saved: the slips' saving lines and the goal deposits (M30 F1). With `moved`, they add to `summary.saved`. */
  readonly savedFrom: SavedFrom
}

/**
 * Everything docs/f10's monthly summary shows, from one read of the document.
 *
 * One call rather than six, for the reason `fundAnalysis` is one call (D-071)
 * and `debtsSummary` is (D-085): the headline, the chips, the breakdown and the
 * curve are all views of the same month, and a screen assembling them from
 * separate reads is a screen where they can disagree.
 */
export function monthlyReport(
  db: Database,
  period: YearMonth,
  asOf: LocalDate,
  options?: { readonly currency?: CurrencyCode; readonly flatCategories?: boolean },
): MonthlyReport {
  const currency = options?.currency ?? documentCurrency(db)
  const months = monthlySummaries(db, asOf, { currency })
  const summary = months.find((one) => compareYearMonths(one.period, period) === 0)

  return {
    period,
    summary,
    months,
    spending: compareMonth(months, period, 'expenses'),
    income: compareMonth(months, period, 'income'),
    categories: categoryBreakdown(categoryObservations(db, period, { currency }), {
      earlierMonths: earlierCategoryMonths(db, period, months, currency),
      ...(options?.flatCategories === true ? { flat: true } : {}),
    }),
    curve: cumulativeSpend(period, dayObservations(db, period, { currency }), {
      // **A month the document has never seen gets no curve at all.**
      // `cumulativeSpend` cannot tell "spent nothing" from "no data" — both
      // reach it as an empty list of days — and drawing a flat line along zero
      // for a month nobody imported is the zero-versus-unknown mistake in the
      // one chart docs/f10 calls the most useful in the app. This is the only
      // layer that knows which it is, because `summary` is present exactly when
      // the month is in the document.
      daysElapsed: summary === undefined ? 0 : daysElapsedIn(period, asOf),
      previousMonth: dayObservations(db, previousMonth(period), { currency }),
      currency,
    }),
    detail: incomeDetail(period, incomeObservations(db, period, { currency }), currency),
    split: monthSplit(db, period, summary, currency),
    moved: movedLines(db, toYearMonthString(period), currency),
    savedFrom: savedFrom(db, period, currency),
  }
}

/**
 * The fixed-versus-variable split of one month, from the fixed expenses as they
 * stand today.
 *
 * **A month with nothing in the document gets an empty split**, not a split of
 * zero against zero: `summary` is present exactly when the month is in the
 * document, which is the same test the curve makes for the same reason (D-087).
 * A ring drawn 100% variable over a month nobody imported is the zero-versus-
 * unknown mistake wearing a different chart.
 */
function monthSplit(
  db: Database,
  period: YearMonth,
  summary: MonthSummary | undefined,
  currency: CurrencyCode,
): SpendingSplit {
  const expenses: readonly FixedExpense[] = summary === undefined ? [] : listFixedExpenses(db)
  const claims: readonly LedgerClaim[] = ledgerClaims(expenses, period)

  return spendingSplit(
    period,
    {
      expenses: summary?.expenses ?? zero(currency),
      income: summary?.income ?? zero(currency),
    },
    expenses,
    fixedMatches(db, period, claims, { currency }),
    currency,
  )
}

// --- Income detail and the fixed split --------------------------------------

/**
 * Everything that brought money into one month — docs/f10's income detail.
 *
 * **Two sources, counted from the two places `MonthSummary.income` counts
 * them.** The payslips come out of `paycheck`, the rest out of the ledger, and
 * neither is read from the other: the whole point of D-078 is that the salary
 * deposit and the payslip are the same money, and a detail that summed the bank
 * row instead of the slip would be the second definition that decision removed.
 *
 * The ledger half is grouped by **merchant**, not listed row by row, so the
 * lines still add to the total when a month has two hundred inflows. Its
 * predicate is `amount_minor > 0` rather than `direction = 'INFLOW'`, because
 * that is what `transactionMonths` sums — a transfer arriving is in the headline
 * whether or not it should be, and a detail that quietly disagreed would send
 * the reader hunting for a rounding error that is really a design question.
 */
export function incomeObservations(
  db: Database,
  period: YearMonth,
  options?: { readonly currency?: CurrencyCode },
): readonly IncomeObservation[] {
  const currency = options?.currency ?? documentCurrency(db)
  const observations: IncomeObservation[] = []
  const slips = findPaychecksForPeriod(db, period)
  const bank = slips.length === 0 ? new Map() : slipBankStatus(db, currency)

  for (const paycheck of slips) {
    // The same currency gate `payrollMonths` applies, so these lines add up to
    // the `payrollNet` the headline used rather than to a larger figure.
    if (paycheck.net.currency !== currency) continue
    observations.push({
      kind: 'PAYSLIP',
      name: paycheck.employerName ?? 'Salary',
      amount: paycheck.net,
      ref: paycheck.id,
      categoryName: undefined,
      count: 1,
      date: paycheck.paymentDate,
      salary: bank.get(paycheck.id),
    })
  }

  const unslipped = [...salaryWithoutSlipRefs(db, currency)]
  const unslippedTest =
    unslipped.length === 0
      ? '0'
      : `CASE WHEN t.id IN (${placeholders(unslipped.length)}) THEN 1 ELSE 0 END`

  const rows = query(
    db,
    `SELECT t.merchant_normalized,
            MAX(${BASIS}) AS last_date,
            COUNT(*) AS n,
            SUM(t.amount_minor) AS inflow,
            SUM(${unslippedTest}) AS duplicates
       FROM fmt_transaction t
      WHERE ${spendable(db, 't')}
        AND t.amount_currency = ?
        AND t.amount_minor > 0
        AND substr(${BASIS}, 1, 7) = ?
      GROUP BY t.merchant_normalized
      ORDER BY inflow DESC`,
    [...unslipped, currency, toYearMonthString(period)],
  )

  for (const row of rows) {
    const merchant = String(row['merchant_normalized'])
    const date = parseISODate(String(row['last_date'] ?? ''))
    if (date === undefined) continue

    const context = inflowContext(db, merchant, period, currency)
    observations.push({
      kind: 'LEDGER',
      name: context.merchantRaw ?? merchant,
      amount: money(Number(row['inflow'] ?? 0), currency),
      ref: merchant,
      categoryName: context.categoryName,
      count: Number(row['n'] ?? 0),
      date,
      // The whole group, not a part of it. A merchant whose month is partly a
      // matched salary deposit and partly something else is not a shape the
      // matcher can produce — a salary group is every deposit of that month —
      // and treating a mixed group as clean would understate the double.
      salary: Number(row['duplicates'] ?? 0) > 0 ? { kind: 'NO_SLIP' } : undefined,
    })
  }

  return observations
}

interface InflowContext {
  /** The most recent raw spelling, for a name the user recognizes. */
  readonly merchantRaw: string | undefined
  /** What its rows are filed under, when any of them are. */
  readonly categoryName: string | undefined
}

function inflowContext(
  db: Database,
  merchant: string,
  period: YearMonth,
  currency: CurrencyCode,
): InflowContext {
  const rows = query(
    db,
    `SELECT t.merchant_raw, c.name AS category_name, ${BASIS} AS basis_date
       FROM fmt_transaction t
       LEFT JOIN fmt_category c ON c.id = t.category
      WHERE ${spendable(db, 't')}
        AND t.amount_currency = ?
        AND t.amount_minor > 0
        AND t.merchant_normalized = ?
        AND substr(${BASIS}, 1, 7) = ?
      ORDER BY basis_date DESC`,
    [currency, merchant, toYearMonthString(period)],
  )

  const raw = rows[0] === undefined ? '' : String(rows[0]['merchant_raw'] ?? '')
  const named = rows.find((row) => row['category_name'] != null)

  return {
    merchantRaw: raw === '' ? undefined : raw,
    categoryName: named === undefined ? undefined : String(named['category_name']),
  }
}

/**
 * This month's spending grouped by which fixed expense claims it — the left half
 * of docs/f10's fixed-versus-variable split.
 *
 * **One scan, one bucket per row.** The `CASE` is built from `ledgerClaims` in
 * the order that function returns, so a charge two commitments could both claim
 * lands in exactly one of them, and "the fixed part never exceeds the whole" is
 * arithmetic rather than a hope. Summing per expense with a query each would
 * double the one row that matters — the merchant that is also inside a category
 * somebody declared — and put `fixed` above the month's total spending.
 *
 * The unclaimed bucket is deliberately **not** returned: `spendingSplit` gets
 * `variable` by subtracting from the month's own total, which is the figure the
 * headline already prints.
 */
export function fixedMatches(
  db: Database,
  period: YearMonth,
  claims: readonly LedgerClaim[],
  options?: { readonly currency?: CurrencyCode },
): readonly FixedMatch[] {
  if (claims.length === 0) return []
  const currency = options?.currency ?? documentCurrency(db)

  const branches = claims
    .map((claim) =>
      claim.on === 'MERCHANT'
        ? 'WHEN t.merchant_normalized = ? THEN ?'
        : 'WHEN t.category = ? THEN ?',
    )
    .join('\n             ')

  const rows = query(
    db,
    `SELECT CASE
             ${branches}
             ELSE '' END AS claimed_by,
            COUNT(*) AS n,
            SUM(-t.amount_minor) AS outflow
       FROM fmt_transaction t
      WHERE ${spendable(db, 't')}
        AND t.amount_currency = ?
        AND t.amount_minor < 0
        AND substr(${BASIS}, 1, 7) = ?
      GROUP BY claimed_by`,
    [
      ...claims.flatMap((claim) => [claim.matchRef, claim.expenseId]),
      currency,
      toYearMonthString(period),
    ],
  )

  const matches: FixedMatch[] = []
  for (const row of rows) {
    const expenseId = String(row['claimed_by'] ?? '')
    if (expenseId === '') continue
    matches.push({
      expenseId,
      outflow: money(Number(row['outflow'] ?? 0), currency),
      transactionCount: Number(row['n'] ?? 0),
    })
  }
  return matches
}

/** An `IN` list of the given length. */
function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}

/** docs/f10's yearly overview, from the same summaries the monthly one reads. */
export function yearlyReport(
  db: Database,
  year: number,
  asOf: LocalDate,
  options?: { readonly currency?: CurrencyCode },
): YearOverview {
  const currency = options?.currency ?? documentCurrency(db)
  return yearOverview(monthlySummaries(db, asOf, { currency }), year, currency)
}

/**
 * What the payslips say about a year — docs/f10's "gross, net, tax paid".
 *
 * Separate from `YearOverview` and deliberately: gross and tax are facts about
 * **payslips**, not about the ledger, and a year with no slips entered has none
 * of them while still having a perfectly good spending total. Folding them into
 * the overview would make one absence look like the other.
 *
 * `slips` is what makes the figures readable: nine payslips in a twelve-month
 * year is why the gross looks low, and a screen that printed the total without
 * the count would invite the wrong conclusion.
 */
export interface PayrollYear {
  readonly gross: Money
  readonly net: Money
  readonly tax: Money
  readonly saved: Money
  /** `tax ÷ gross`. Undefined when no slip was entered — not a zero rate. */
  readonly taxRateBasisPoints: number | undefined
  readonly slips: number
}

export function payrollYear(
  db: Database,
  year: number,
  options?: { readonly currency?: CurrencyCode },
): PayrollYear {
  const currency = options?.currency ?? documentCurrency(db)
  const types = listDeductionTypes(db)
  const entries = listPaychecksWithLines(db).filter(
    (entry) => entry.paycheck.period.year === year && entry.paycheck.gross.currency === currency,
  )

  const gross = sum(entries.map((entry) => entry.paycheck.gross), currency)
  const tax = sum(entries.map((entry) => taxTotal(entry, types)), currency)

  return {
    gross,
    net: sum(entries.map((entry) => entry.paycheck.net), currency),
    tax,
    // The employee side, for the reason `payrollMonths` uses it: the employer's
    // share never arrived, and nothing on this screen is measured against a
    // figure that contains it.
    saved: sum(entries.map((entry) => payrollSavings(entry, types).employee), currency),
    taxRateBasisPoints: ratioBasisPoints(tax, gross),
    slips: entries.length,
  }
}

/**
 * **What the payslips took in tax, month by month** (M28 U5) — the fourth flow
 * on Home beside came in, went out and saved.
 *
 * Off the slips and nothing else, keyed by salary month, for the reason
 * `payrollYear` gives: tax is a fact about a payslip, and a month with no slip
 * has no figure here rather than a zero.
 */
export function monthlyTaxes(
  db: Database,
  options?: { readonly currency?: CurrencyCode },
): ReadonlyMap<string, Money> {
  const currency = options?.currency ?? documentCurrency(db)
  const types = listDeductionTypes(db)
  const months = new Map<string, Money>()
  for (const entry of listPaychecksWithLines(db)) {
    if (entry.paycheck.gross.currency !== currency) continue
    const key = toYearMonthString(entry.paycheck.period)
    months.set(key, sum([months.get(key) ?? zero(currency), taxTotal(entry, types)], currency))
  }
  return months
}

/**
 * A whole year's spending per category — docs/f10's yearly category totals.
 *
 * The same shape and the same rules as the monthly one: uncategorized included,
 * the parent id carried so the rollup stays the domain's. The only difference is
 * the span, which is why the two share their SQL rather than being written
 * twice — a second spelling of "which rows are spending" is the thing docs/f10
 * warns about when it says no query may hardcode the definition of an expense.
 */
export function yearCategoryObservations(
  db: Database,
  year: number,
  options?: { readonly currency?: CurrencyCode },
): readonly CategoryObservation[] {
  const currency = options?.currency ?? documentCurrency(db)
  return categoryRows(db, String(year), currency)
}

/**
 * Where the money actually goes, by merchant — docs/f10's leaderboard.
 *
 * "Often more revealing than the category view", and the reason is that a
 * category is a judgement while a merchant is a fact. Six hundred shekels at
 * Groceries is a budget line; six hundred shekels at one supermarket four times
 * a month is a habit.
 *
 * Grouped on the **normalized** merchant, because that is the name without the
 * branch number — `שופרסל דיל 344` and `שופרסל דיל 12` are one shop and the
 * whole point of `normalizeMerchant` is that they group. The raw spelling comes
 * along for display: the most recent one, since a provider that changed how it
 * writes a name changed it *to* the newer form.
 *
 * `months` is how many distinct months the merchant appears in, which is what
 * separates a habit from a one-off — a leaderboard without it puts a single
 * flight above a year of coffee and says nothing about either.
 */
export interface MerchantTotal {
  readonly merchantNormalized: string
  readonly merchantRaw: string
  readonly outflow: Money
  readonly transactionCount: number
  readonly months: number
  /** The category most of its rows are filed under, for context. */
  readonly categoryName: string | undefined
}

export function merchantTotals(
  db: Database,
  from: YearMonth,
  to: YearMonth,
  options?: { readonly currency?: CurrencyCode; readonly limit?: number },
): readonly MerchantTotal[] {
  const currency = options?.currency ?? documentCurrency(db)
  const rows = query(
    db,
    `SELECT t.merchant_normalized,
            COUNT(*) AS n,
            COUNT(DISTINCT substr(${BASIS}, 1, 7)) AS months,
            SUM(-t.amount_minor) AS outflow,
            (SELECT t2.merchant_raw FROM fmt_transaction t2
              WHERE t2.merchant_normalized = t.merchant_normalized
              ORDER BY COALESCE(t2.charge_date, t2.transaction_date) DESC
              LIMIT 1) AS raw,
            (SELECT COALESCE(c.name, NULL) FROM fmt_transaction t3
               LEFT JOIN fmt_category c ON c.id = t3.category
              WHERE t3.merchant_normalized = t.merchant_normalized
                AND t3.category IS NOT NULL
              GROUP BY t3.category
              ORDER BY COUNT(*) DESC
              LIMIT 1) AS category_name
       FROM fmt_transaction t
      WHERE ${spendable(db, 't')}
        AND t.amount_currency = ?
        AND t.amount_minor < 0
        AND t.merchant_normalized <> ''
        AND substr(${BASIS}, 1, 7) >= ?
        AND substr(${BASIS}, 1, 7) <= ?
      GROUP BY t.merchant_normalized
      ORDER BY outflow DESC
      LIMIT ?`,
    [currency, toYearMonthString(from), toYearMonthString(to), options?.limit ?? 15],
  )

  return rows.map((row) => ({
    merchantNormalized: String(row['merchant_normalized']),
    merchantRaw: String(row['raw'] ?? row['merchant_normalized']),
    outflow: money(Number(row['outflow'] ?? 0), currency),
    transactionCount: Number(row['n'] ?? 0),
    months: Number(row['months'] ?? 0),
    categoryName: row['category_name'] == null ? undefined : String(row['category_name']),
  }))
}

/**
 * Each month's category breakdown across a span, keyed by month.
 *
 * **A map rather than a list**, and that is the whole point: a month present
 * with nothing in this category is a zero, a month absent from the map is
 * unknown, and only a structure that can tell those apart lets the chart draw a
 * gap where a gap belongs (D-087).
 */
export function categoryMonths(
  db: Database,
  from: YearMonth,
  to: YearMonth,
  options?: { readonly currency?: CurrencyCode },
): ReadonlyMap<string, readonly CategoryObservation[]> {
  const currency = options?.currency ?? documentCurrency(db)
  const present = new Set(
    monthObservations(db, monthEndOf(to), { currency }).map((one) =>
      toYearMonthString(one.period),
    ),
  )

  const months = new Map<string, readonly CategoryObservation[]>()
  const span = Math.max(0, monthsBetween(from, to))
  for (let index = 0; index <= span; index += 1) {
    const period = addMonths(from, index)
    const key = toYearMonthString(period)
    if (!present.has(key)) continue
    months.set(key, categoryObservations(db, period, { currency }))
  }
  return months
}

/** The last day of a month, so a span can be read as though standing at its end. */
function monthEndOf(period: YearMonth): LocalDate {
  return localDate(period.year, period.month, daysInMonth(period.year, period.month))
}

/**
 * The complete months before this one, each as its own category breakdown, for
 * the per-category comparison chips.
 *
 * **Only months the document actually holds**, and only complete ones — a
 * category compared against a month in progress reads as a spike every time. The
 * window is over months that exist rather than over calendar slots, which is the
 * same call `versusRecentAverage` makes one layer up.
 */
function earlierCategoryMonths(
  db: Database,
  period: YearMonth,
  months: readonly MonthSummary[],
  currency: CurrencyCode,
): readonly (readonly CategoryObservation[])[] {
  return months
    .filter((one) => one.isComplete && compareYearMonths(one.period, period) < 0)
    .slice(-3)
    .map((one) => categoryObservations(db, one.period, { currency }))
}

function previousMonth(period: YearMonth): YearMonth {
  return period.month === 1
    ? { year: period.year - 1, month: 12 }
    : { year: period.year, month: period.month - 1 }
}

/**
 * How far through a month the report has got.
 *
 * The whole month once the reading date has passed it, none of it when the month
 * has not started, and the day itself while it is running — so the curve stops
 * where the data stops rather than running flat to the thirty-first.
 */
function daysElapsedIn(period: YearMonth, asOf: LocalDate): number {
  const order = compareYearMonths(period, yearMonthOf(asOf))
  if (order < 0) return daysInMonth(period.year, period.month)
  if (order > 0) return 0
  return asOf.day
}

/**
 * What this document is denominated in.
 *
 * The currency most of its rows are in, rather than a constant: a document whose
 * statements are all in dollars should report in dollars instead of showing
 * zeroes with every row silently dropped. `fundAnalysis` takes its currency from
 * the readings for the same reason (D-071).
 */
export function documentCurrency(db: Database): CurrencyCode {
  const rows = query(
    db,
    `SELECT amount_currency AS currency, COUNT(*) AS n
       FROM fmt_transaction
      GROUP BY amount_currency
      ORDER BY n DESC
      LIMIT 1`,
  )
  return rows[0] === undefined ? 'ILS' : String(rows[0]['currency'])
}
