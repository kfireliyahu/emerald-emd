/**
 * Statistics math — the monthly summary, the comparisons, the category
 * breakdown, the cumulative curve, the yearly overview and the trends.
 * docs/f10-statistics-and-reports.md, against docs/05's definitions.
 *
 * Pure functions over plain values: no database, no clock, no React. Written and
 * tested before a screen or a query exists, exactly as M2 opened with the rules
 * engine, M3 with the paycheck figures, M4 with the fixed-expense detector, M5
 * with the bank-import domain, F07 with `savings.ts` and F08 with `debt.ts`.
 *
 * **Nothing in this file sums a ledger.** docs/f10 requires aggregation in SQL,
 * so what arrives is one row per month or per day, already grouped. What happens
 * here is the arithmetic on top of it — the part that can be quietly wrong.
 *
 * Four rules hold everywhere, and each is a way a chart lies:
 *
 * - **Zero and unknown are different.** A month with no data is `undefined`, in
 *   the year's slots and in a trend's points alike. A gap drawn as a zero says
 *   spending stopped; a gap drawn as a gap says nobody knows. `NetTrend` already
 *   draws breaks for this reason (M3) and this is the same rule one layer down.
 * - **A partial month is never in an average.** Every averaging function here
 *   filters on `isComplete` and none of them takes a flag to include one. A
 *   month in progress measured against three finished ones always flatters.
 * - **Saving is not spending.** `balance` is `income − expenses` and `saved`
 *   sits beside it. There is no path in this file by which saving reaches an
 *   expense figure.
 * - **A comparison that cannot be made says so.** Three chips, three ways to be
 *   unanswerable, each named — because "unchanged from last year" and "there is
 *   no last year" are opposite claims and a zero says the first.
 *
 * The **savings-rate trap** is worth stating once here too, because it is the
 * one figure in this module that could be double the truth. docs/05 defines the
 * effective rate as payslip saving lines plus saving deposits, and since D-077 a
 * payslip line linked to a goal generates both. `MonthObservation` therefore
 * splits the two halves, `monthSummary` is the only place they are added, and
 * `deposited` is documented as the deposits the payslip did not already account
 * for.
 */

import {
  add,
  money,
  subtract,
  sum,
  zero,
  type CurrencyCode,
  type Money,
} from '@/core/money.ts'
import { ratioBasisPoints } from '@/core/percent.ts'
import {
  addMonths,
  compareYearMonths,
  daysInMonth,
  type YearMonth,
} from '@/core/time.ts'
import type { FixedExpense } from '@/domain/model/fixed.ts'
import {
  isActiveIn,
  isChargeMonth,
  isLedgerMatched,
  monthlyShare,
} from '@/domain/fixedExpenses.ts'
import type {
  CategoryLine,
  CategoryObservation,
  Comparison,
  ComparisonGap,
  CumulativeCurve,
  CumulativePoint,
  DayObservation,
  FixedLine,
  FixedLineStatus,
  FixedMatch,
  IncomeDetail,
  IncomeObservation,
  MonthObservation,
  MonthSummary,
  SalaryBank,
  SpendingSplit,
  YearOverview,
} from '@/domain/model/statistics.ts'

/** docs/f10's comparison window: this month against the last three. */
export const AVERAGE_MONTHS = 3

/** Twelve slots, January first, whatever the document actually holds. */
export const MONTHS_IN_YEAR = 12

// --- One month --------------------------------------------------------------

/**
 * docs/05's four definitions, in one place so nothing else may restate them.
 *
 * `income` includes the payslip net rather than the salary deposit, which is why
 * F06's salary reconciliation (D-078) had to exist before this could be right:
 * counting both would report every salary twice, and counting neither would lose
 * the months with no payslip entered.
 *
 * The savings rate is measured against **income**, not against the whole
 * compensation `savingsRateBasisPoints` uses in `paycheck.ts` — those answer
 * different questions and both are worth having. This one is "of what arrived,
 * how much stayed", which is the figure a month can be judged on.
 */
export function monthSummary(observation: MonthObservation): MonthSummary {
  const income = add(observation.payrollNet, observation.inflow)
  const expenses = observation.outflow
  const saved = add(add(observation.payrollSaved, observation.deposited), observation.moved)

  return {
    period: observation.period,
    income,
    expenses,
    balance: subtract(income, expenses),
    saved,
    savingsRateBasisPoints: ratioBasisPoints(saved, income),
    transactionCount: observation.transactionCount,
    isComplete: observation.isComplete,
  }
}

/** Every month the document holds, oldest first. */
export function summarizeMonths(
  observations: readonly MonthObservation[],
): readonly MonthSummary[] {
  return [...observations]
    .map(monthSummary)
    .sort((a, b) => compareYearMonths(a.period, b.period))
}

// --- Comparisons ------------------------------------------------------------

/** What a chip measures. Each reads one field off a `MonthSummary`. */
export type ComparisonMetric = 'income' | 'expenses' | 'balance' | 'saved'

function metricOf(summary: MonthSummary, metric: ComparisonMetric): Money {
  switch (metric) {
    case 'income':
      return summary.income
    case 'expenses':
      return summary.expenses
    case 'balance':
      return summary.balance
    case 'saved':
      return summary.saved
  }
}

function delta(basis: Money, current: Money): Comparison {
  const difference = subtract(current, basis)
  return {
    kind: 'DELTA',
    basis,
    current,
    difference,
    basisPoints: ratioBasisPoints(difference, basis),
  }
}

function noBasis(reason: ComparisonGap): Comparison {
  return { kind: 'NO_BASIS', reason }
}

/**
 * This month against the one before it.
 *
 * A month still in progress is compared anyway — it is what the user is looking
 * at — but the month it is compared *against* must be finished, or a summary
 * opened on the second of the month would report a 95% fall in spending.
 */
export function versusPreviousMonth(
  summaries: readonly MonthSummary[],
  period: YearMonth,
  metric: ComparisonMetric,
): Comparison {
  const current = findMonth(summaries, period)
  if (current === undefined) return noBasis('NO_SUCH_MONTH')

  const previous = findMonth(summaries, addMonths(period, -1))
  if (previous === undefined) return noBasis('NO_SUCH_MONTH')
  if (!previous.isComplete) return noBasis('MONTH_IN_PROGRESS')

  return delta(metricOf(previous, metric), metricOf(current, metric))
}

/**
 * This month against the average of the three complete months before it.
 *
 * **The three months are the three most recent complete ones before this one,
 * not the three calendar months before it.** A document missing April does not
 * get a third of an average; it reaches further back for a real month. That is
 * `observedMonthlyPrincipal`'s call (D-083) and `CandidateMonth`'s before it —
 * a window over months that exist, never over slots.
 */
export function versusRecentAverage(
  summaries: readonly MonthSummary[],
  period: YearMonth,
  metric: ComparisonMetric,
  months: number = AVERAGE_MONTHS,
): Comparison {
  const current = findMonth(summaries, period)
  if (current === undefined) return noBasis('NO_SUCH_MONTH')

  const earlier = summaries
    .filter((one) => one.isComplete && compareYearMonths(one.period, period) < 0)
    .slice(-months)
  if (earlier.length < months) return noBasis('NOT_ENOUGH_MONTHS')

  return delta(
    average(earlier.map((one) => metricOf(one, metric))),
    metricOf(current, metric),
  )
}

/** The same month a year ago — the comparison seasonality does not confound. */
export function versusYearAgo(
  summaries: readonly MonthSummary[],
  period: YearMonth,
  metric: ComparisonMetric,
): Comparison {
  const current = findMonth(summaries, period)
  if (current === undefined) return noBasis('NO_SUCH_MONTH')

  const ago = findMonth(summaries, addMonths(period, -MONTHS_IN_YEAR))
  if (ago === undefined) return noBasis('NO_SUCH_MONTH')
  if (!ago.isComplete) return noBasis('MONTH_IN_PROGRESS')

  return delta(metricOf(ago, metric), metricOf(current, metric))
}

export interface MonthComparisons {
  readonly previousMonth: Comparison
  readonly recentAverage: Comparison
  readonly yearAgo: Comparison
}

/** docs/f10's three chips, from one call so a screen cannot ask for two of them. */
export function compareMonth(
  summaries: readonly MonthSummary[],
  period: YearMonth,
  metric: ComparisonMetric,
): MonthComparisons {
  return {
    previousMonth: versusPreviousMonth(summaries, period, metric),
    recentAverage: versusRecentAverage(summaries, period, metric),
    yearAgo: versusYearAgo(summaries, period, metric),
  }
}

// --- Category breakdown -----------------------------------------------------

/**
 * The month's spending by category, rolled up, ranked, and each line compared
 * against its own recent average.
 *
 * **Uncategorized is a line like any other and cannot be filtered out here.**
 * docs/f10 is emphatic: hiding it is how these apps quietly lie, and the total
 * the shares are taken against includes it — so a document with half its
 * spending unlabelled shows a 50% slice saying so rather than a tidy breakdown
 * of the other half.
 *
 * The rollup is this function's rather than the query's, so that "flat" is a
 * parameter instead of a second query with a second definition of a parent.
 * A parent's own directly-filed spending stays in its total and appears among
 * its children as itself, because it is real spending and dropping it would make
 * the children fail to add up to the parent.
 */
export function categoryBreakdown(
  observations: readonly CategoryObservation[],
  options?: {
    /** Earlier months, for each line's own comparison. Complete months only. */
    readonly earlierMonths?: readonly (readonly CategoryObservation[])[]
    /** True lists every category on its own instead of rolling into parents. */
    readonly flat?: boolean
    readonly averageMonths?: number
  },
): readonly CategoryLine[] {
  if (observations.length === 0) return []

  const currency = observations[0]?.outflow.currency ?? 'ILS'
  const total = sum(
    observations.map((one) => one.outflow),
    currency,
  )
  const months = options?.averageMonths ?? AVERAGE_MONTHS
  const history = options?.earlierMonths ?? []

  const line = (
    observation: CategoryObservation,
    children: readonly CategoryLine[],
  ): CategoryLine => ({
    categoryId: observation.categoryId,
    name: observation.name,
    outflow: observation.outflow,
    transactionCount: observation.transactionCount,
    shareBasisPoints: ratioBasisPoints(observation.outflow, total),
    comparison: categoryComparison(observation, history, months, currency),
    children,
  })

  if (options?.flat === true) {
    return observations.map((one) => line(one, [])).sort(byOutflowDescending)
  }

  // Roll each row into its parent when the parent is in the month too, and
  // leave it standing on its own when it is not — a subcategory whose parent
  // had no spending of its own is still a real line, not an orphan to drop.
  // **At every level** (M28 F29, D-348): the tree is three deep, so a parent's
  // figure is its own and everything rolled into its children's.
  const byId = new Map(
    observations
      .filter((one) => one.categoryId !== undefined)
      .map((one) => [one.categoryId ?? '', one]),
  )
  const childrenOf = new Map<string, CategoryObservation[]>()
  const roots: CategoryObservation[] = []

  for (const observation of observations) {
    const parentId = observation.parentId
    if (parentId !== undefined && parentId !== observation.categoryId && byId.has(parentId)) {
      childrenOf.set(parentId, [...(childrenOf.get(parentId) ?? []), observation])
    } else {
      roots.push(observation)
    }
  }

  const build = (root: CategoryObservation, seen: ReadonlySet<string>): CategoryLine => {
    const id = root.categoryId ?? ''
    const own = (childrenOf.get(id) ?? []).filter((one) => !seen.has(one.categoryId ?? ''))
    if (own.length === 0) return line(root, [])
    const below = new Set([...seen, id])
    const children = own.map((one) => build(one, below))
    const rolled: CategoryObservation = {
      ...root,
      outflow: sum([root.outflow, ...children.map((one) => one.outflow)], currency),
      transactionCount: root.transactionCount + children.reduce((n, one) => n + one.transactionCount, 0),
    }
    // The parent's own spending is a child of itself, so the children add up
    // to the parent and a reader can see which part was filed where.
    const parts = root.outflow.minor === 0 ? children : [line(root, []), ...children]
    return line(rolled, [...parts].sort(byOutflowDescending))
  }

  return roots.map((root) => build(root, new Set())).sort(byOutflowDescending)
}

function byOutflowDescending(a: CategoryLine, b: CategoryLine): number {
  return b.outflow.minor - a.outflow.minor || a.name.localeCompare(b.name)
}

/**
 * One category against its own recent average.
 *
 * A month in which the category had no spending at all counts as **zero**, not
 * as a missing month, and that is the one place in this file where an absence is
 * a zero rather than a gap. The reason is that the observation is of the
 * *month*, not of the category: the month was imported, and "nothing at the
 * dentist in June" is a fact about June rather than a hole in the data. Treating
 * it as unknown would report every occasional category as a fresh discovery
 * every time it reappeared.
 */
function categoryComparison(
  observation: CategoryObservation,
  history: readonly (readonly CategoryObservation[])[],
  months: number,
  currency: CurrencyCode,
): Comparison {
  if (history.length < months) return noBasis('NOT_ENOUGH_MONTHS')

  const window = history.slice(-months)
  const basis = average(
    window.map((month) => {
      const match = month.find((one) => sameCategory(one, observation))
      return match?.outflow ?? zero(currency)
    }),
  )

  return delta(basis, observation.outflow)
}

function sameCategory(a: CategoryObservation, b: CategoryObservation): boolean {
  return a.categoryId === b.categoryId
}

// --- The cumulative curve ---------------------------------------------------

/**
 * Day-of-month running spend, with the previous month behind it.
 *
 * docs/f10 calls this the single most behaviourally useful chart in the app,
 * because it answers "am I ahead of where I usually am?" without asking anyone
 * to hold two numbers in their head.
 *
 * **A day with no spending is a flat step, not a gap**, which is the opposite of
 * the rule everywhere else in this file and for a reason: a running total is
 * defined on every day of the month whether or not anything happened, and a
 * curve with holes in it would be unreadable. What is genuinely unknown is the
 * part of the month that has not happened yet, and that is handled by stopping
 * the line rather than by drawing it flat to the thirty-first.
 *
 * `projectedTotal` is docs/f10's open question settled as it recommends — a
 * neutral figure, on this chart only, and absent once the month is done, where
 * the total is the answer rather than a guess.
 */
export function cumulativeSpend(
  period: YearMonth,
  days: readonly DayObservation[],
  options: {
    /** How far the data goes. The month's length once it is over. */
    readonly daysElapsed: number
    readonly previousMonth?: readonly DayObservation[]
    readonly currency?: CurrencyCode
  },
): CumulativeCurve {
  const currency = options.currency ?? days[0]?.outflow.currency ?? 'ILS'
  const length = daysInMonth(period.year, period.month)
  const elapsed = Math.max(0, Math.min(length, Math.floor(options.daysElapsed)))

  const points = runningTotals(days, elapsed, currency)
  const previousLength = previousMonthLength(period)
  const previous = runningTotals(
    options.previousMonth ?? [],
    options.previousMonth === undefined ? 0 : previousLength,
    currency,
  )

  const spent = points[points.length - 1]?.runningTotal ?? zero(currency)
  const isComplete = elapsed >= length

  return {
    period,
    points,
    previous,
    daysInMonth: length,
    daysElapsed: elapsed,
    // Straight-line, and the arithmetic is integer: spent × days ÷ elapsed. A
    // month one day old projects wildly and says nothing the reader does not
    // already know, which is why this is a figure beside a chart rather than a
    // sentence anywhere else.
    projectedTotal:
      isComplete || elapsed === 0
        ? undefined
        : money(Math.round((spent.minor * length) / elapsed), currency),
  }
}

function runningTotals(
  days: readonly DayObservation[],
  elapsed: number,
  currency: CurrencyCode,
): readonly CumulativePoint[] {
  if (elapsed <= 0) return []

  const byDay = new Map<number, number>()
  for (const observation of days) {
    byDay.set(
      observation.date.day,
      (byDay.get(observation.date.day) ?? 0) + observation.outflow.minor,
    )
  }

  const points: CumulativePoint[] = []
  let running = 0
  for (let day = 1; day <= elapsed; day += 1) {
    running += byDay.get(day) ?? 0
    points.push({ day, runningTotal: money(running, currency) })
  }
  return points
}

function previousMonthLength(period: YearMonth): number {
  const previous = addMonths(period, -1)
  return daysInMonth(previous.year, previous.month)
}

// --- The year ---------------------------------------------------------------

/**
 * Twelve months with their gaps intact, and every total a sum of exactly those
 * twelve.
 *
 * **F10's first acceptance criterion is structural here rather than tested into
 * place**: the yearly figures are computed from the same `MonthSummary[]` the
 * month-over-month table prints, so there is no second path for them to disagree
 * along. A query that summed the year directly would be that second path, which
 * is why there is not one.
 *
 * The averages and the best and worst months use **complete months only**.
 * December of a year in progress is not a bad month; it is an unfinished one.
 */
export function yearOverview(
  summaries: readonly MonthSummary[],
  year: number,
  currency: CurrencyCode,
): YearOverview {
  const months: (MonthSummary | undefined)[] = []
  for (let month = 1; month <= MONTHS_IN_YEAR; month += 1) {
    months.push(summaries.find((one) => one.period.year === year && one.period.month === month))
  }

  const present = months.filter((one): one is MonthSummary => one !== undefined)
  const complete = present.filter((one) => one.isComplete)

  const income = sum(
    present.map((one) => one.income),
    currency,
  )
  const expenses = sum(
    present.map((one) => one.expenses),
    currency,
  )
  const saved = sum(
    present.map((one) => one.saved),
    currency,
  )

  return {
    year,
    months,
    income,
    expenses,
    // Not `sum(month.balance)` and not a coincidence that it agrees: income and
    // expenses are each a sum of the twelve, and the balance is their
    // difference, so the year's balance is the sum of the months' by
    // construction rather than by a second addition that could drift.
    balance: subtract(income, expenses),
    saved,
    savingsRateBasisPoints: ratioBasisPoints(saved, income),
    monthsWithData: present.length,
    completeMonths: complete.length,
    averageIncome: complete.length === 0 ? undefined : average(complete.map((one) => one.income)),
    averageExpenses:
      complete.length === 0 ? undefined : average(complete.map((one) => one.expenses)),
    bestMonth: extreme(complete, (a, b) => b.balance.minor - a.balance.minor),
    worstMonth: extreme(complete, (a, b) => a.balance.minor - b.balance.minor),
  }
}

function extreme(
  summaries: readonly MonthSummary[],
  compare: (a: MonthSummary, b: MonthSummary) => number,
): MonthSummary | undefined {
  return [...summaries].sort(compare)[0]
}

// --- Income detail ----------------------------------------------------------

/** A salary the person should look at: anything but a deposit that agrees, or one not looked for. */
export function salaryProblem(salary: SalaryBank | undefined): boolean {
  return salary !== undefined && salary.kind !== 'AGREES' && salary.kind !== 'UNCHECKED'
}

/**
 * docs/f10's income detail: what actually brought the month's money in.
 *
 * **The headline's own arithmetic, shown as its parts.** `MonthSummary.income`
 * is `payrollNet + inflow`, and `total` here is the same sum reassembled from
 * the lines — so a detail that does not add up to the figure above it is a bug
 * this shape makes visible rather than a discrepancy the reader has to find.
 *
 * **Whether a deposit is a slip arriving is not decided here.** The salary
 * match decides, in one place (D-078, D-317); the observations arrive with what
 * the bank said and this function only totals them and counts what is wrong.
 */
export function incomeDetail(
  period: YearMonth,
  observations: readonly IncomeObservation[],
  currency: CurrencyCode,
): IncomeDetail {
  const payroll = sum(
    observations.filter((one) => one.kind === 'PAYSLIP').map((one) => one.amount),
    currency,
  )
  const other = sum(
    observations.filter((one) => one.kind === 'LEDGER').map((one) => one.amount),
    currency,
  )
  const total = add(payroll, other)

  const lines = [...observations]
    .sort((a, b) => b.amount.minor - a.amount.minor)
    .map((one) => ({ ...one, shareBasisPoints: ratioBasisPoints(one.amount, total) }))

  return {
    period,
    payroll,
    other,
    total,
    lines,
    payrollShareBasisPoints: ratioBasisPoints(payroll, total),
    problems: observations.filter((one) => salaryProblem(one.salary)).length,
  }
}

// --- Fixed versus variable --------------------------------------------------

/** One fixed expense's claim on the ledger — which rows count as its charges. */
export interface LedgerClaim {
  readonly expenseId: string
  readonly on: 'MERCHANT' | 'CATEGORY'
  readonly matchRef: string
}

/**
 * Which rows each live fixed expense claims, in the order claims are settled.
 *
 * **A charge belongs to exactly one commitment**, and this order is what decides
 * which. Merchant patterns come before categories because a pattern is the more
 * specific statement — declaring "Netflix" and declaring "Entertainment" and
 * then charging Netflix is one charge, not two, and counting it twice would put
 * `fixed` above the month's total spending.
 *
 * Written here, once, and read by both halves: the query builds its buckets from
 * this list in this order and `spendingSplit` reads the results back through it.
 * Two spellings of the precedence would be two answers to "what is fixed".
 */
export function ledgerClaims(
  expenses: readonly FixedExpense[],
  period: YearMonth,
): readonly LedgerClaim[] {
  const live = expenses.filter((one) => isActiveIn(one, period) && isLedgerMatched(one))
  const claimsOf = (
    kind: 'MERCHANT_PATTERN' | 'CATEGORY',
    on: 'MERCHANT' | 'CATEGORY',
  ): readonly LedgerClaim[] =>
    live
      .filter((one) => one.matchKind === kind && one.matchRef !== undefined && one.matchRef !== '')
      .map((one) => ({ expenseId: one.id, on, matchRef: one.matchRef ?? '' }))

  return [...claimsOf('MERCHANT_PATTERN', 'MERCHANT'), ...claimsOf('CATEGORY', 'CATEGORY')]
}

/** `CHARGED` first, then the kinds of absence, each biggest first. */
const STATUS_ORDER: Readonly<Record<FixedLineStatus, number>> = {
  CHARGED: 0,
  NOT_CHARGED: 1,
  NOT_DUE: 2,
  OUT_OF_NET: 3,
  NOT_TRACKED: 4,
}

/**
 * docs/f10's fixed-versus-variable split, from one grouping of one month.
 *
 * `variable` is a **subtraction, not a second sum**: everything the claims did
 * not take. That is what makes `fixed + variable = expenses` a property of the
 * shape rather than a coincidence two queries have to keep agreeing on.
 *
 * **A payroll deduction never reaches `fixed`.** It is a line with a declared
 * share and no charge, because it is already out of net and the ledger has never
 * seen it — `fixedExpenseBasis`' one rule (docs/f09: the most dangerous bug in
 * the feature) arriving in its second caller. `MANUAL_ONLY` is kept apart from
 * it for the same reason in reverse: it is not out of net, it is simply a number
 * nothing can check.
 */
export function spendingSplit(
  period: YearMonth,
  totals: { readonly expenses: Money; readonly income: Money },
  expenses: readonly FixedExpense[],
  matches: readonly FixedMatch[],
  currency: CurrencyCode,
): SpendingSplit {
  const charged = new Map(matches.map((one) => [one.expenseId, one]))
  const lines: FixedLine[] = []

  for (const expense of expenses) {
    if (!isActiveIn(expense, period)) continue

    const match = charged.get(expense.id)
    const status: FixedLineStatus =
      expense.matchKind === 'PAYCHECK_DEDUCTION'
        ? 'OUT_OF_NET'
        : !isLedgerMatched(expense)
          ? 'NOT_TRACKED'
          : match !== undefined
            ? 'CHARGED'
            : // A bimonthly bill in its off month is not a bill that failed to
              // arrive, and `isChargeMonth` is the one place that distinction
              // is drawn (docs/f09). Asked here rather than restated, so this
              // screen cannot start crying wolf on its own.
              isChargeMonth(expense, period)
              ? 'NOT_CHARGED'
              : 'NOT_DUE'

    const outflow = status === 'CHARGED' && match !== undefined ? match.outflow : zero(currency)

    lines.push({
      expenseId: expense.id,
      name: expense.name,
      status,
      outflow,
      transactionCount: status === 'CHARGED' ? (match?.transactionCount ?? 0) : 0,
      monthlyShare: monthlyShare(expense),
      cadence: expense.cadence,
      shareBasisPoints: ratioBasisPoints(outflow, totals.expenses),
      isDiscretionary: expense.isDiscretionary,
      on: !isLedgerMatched(expense)
        ? undefined
        : expense.matchKind === 'MERCHANT_PATTERN'
          ? 'MERCHANT'
          : 'CATEGORY',
      matchRef: isLedgerMatched(expense) ? expense.matchRef : undefined,
    })
  }

  lines.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      (a.status === 'CHARGED'
        ? b.outflow.minor - a.outflow.minor
        : b.monthlyShare.minor - a.monthlyShare.minor),
  )

  const claimed = lines.filter((one) => one.status === 'CHARGED')
  const fixed = sum(
    claimed.map((one) => one.outflow),
    currency,
  )

  const variable = subtract(totals.expenses, fixed)

  return {
    period,
    fixed,
    variable,
    expenses: totals.expenses,
    discretionary: sum(
      claimed.filter((one) => one.isDiscretionary).map((one) => one.outflow),
      currency,
    ),
    fixedShareBasisPoints: ratioBasisPoints(fixed, totals.expenses),
    // Its own division rather than the complement of the one above: the two
    // round independently and a screen doing the subtraction itself is a screen
    // doing arithmetic, which is the one thing these shapes exist to stop.
    variableShareBasisPoints: ratioBasisPoints(variable, totals.expenses),
    fixedShareOfIncomeBasisPoints: ratioBasisPoints(fixed, totals.income),
    lines,
  }
}

// --- Shared -----------------------------------------------------------------

function findMonth(
  summaries: readonly MonthSummary[],
  period: YearMonth,
): MonthSummary | undefined {
  return summaries.find((one) => compareYearMonths(one.period, period) === 0)
}

/**
 * The mean of some amounts, rounded half-up and staying in minor units.
 *
 * Never called with an empty list — every caller checks first, because the mean
 * of nothing is `undefined` and returning a zero here would hand every one of
 * them a figure to print.
 */
function average(amounts: readonly Money[]): Money {
  const first = amounts[0]
  if (first === undefined) throw new Error('average of no amounts')

  const total = sum(amounts, first.currency)
  return money(Math.round(total.minor / amounts.length), first.currency)
}
