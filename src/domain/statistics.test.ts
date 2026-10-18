import { describe, expect, it } from 'vitest'

import { add, money } from '@/core/money.ts'
import { localDate, type YearMonth } from '@/core/time.ts'
import type { FixedExpense } from '@/domain/model/fixed.ts'
import type {
  CategoryObservation,
  DayObservation,
  IncomeObservation,
  MonthObservation,
} from '@/domain/model/statistics.ts'
import {
  AVERAGE_MONTHS,
  categoryBreakdown,
  compareMonth,
  cumulativeSpend,
  incomeDetail,
  ledgerClaims,
  monthSummary,
  spendingSplit,
  summarizeMonths,
  versusPreviousMonth,
  versusRecentAverage,
  versusYearAgo,
  yearOverview,
} from './statistics.ts'

const ILS = 'ILS'
const ils = (minor: number) => money(minor, ILS)
const month = (year: number, m: number): YearMonth => ({ year, month: m })

function observation(overrides?: Partial<MonthObservation>): MonthObservation {
  return {
    period: month(2026, 6),
    outflow: ils(8_000_00),
    inflow: ils(0),
    payrollNet: ils(14_000_00),
    payrollSaved: ils(1_500_00),
    deposited: ils(500_00),
    moved: ils(0),
    transactionCount: 42,
    isComplete: true,
    ...overrides,
  }
}

/** Six complete months of the same shape, January to June. */
function sixMonths(): readonly MonthObservation[] {
  return [1, 2, 3, 4, 5, 6].map((m) =>
    observation({ period: month(2026, m), outflow: ils(m * 1_000_00) }),
  )
}

describe('monthSummary', () => {
  it('is docs/05 four definitions and nothing else', () => {
    const summary = monthSummary(observation({ inflow: ils(1_000_00) }))

    expect(summary.income).toEqual(ils(15_000_00))
    expect(summary.expenses).toEqual(ils(8_000_00))
    expect(summary.balance).toEqual(ils(7_000_00))
  })

  /**
   * docs/05: savings are shown separately, never as an expense. A month that
   * put ₪2,000 aside did not spend it.
   */
  it('never subtracts what was saved from the balance', () => {
    const none = monthSummary(observation({ payrollSaved: ils(0), deposited: ils(0) }))
    const plenty = monthSummary(observation({ payrollSaved: ils(5_000_00), deposited: ils(0) }))

    expect(plenty.balance).toEqual(none.balance)
    expect(plenty.saved).toEqual(ils(5_000_00))
  })

  /**
   * The trap M6 was warned about: since D-077 a payslip line linked to a goal
   * produces a payroll saving line **and** a `FROM_PAYCHECK_DEDUCTION` deposit.
   * The two halves are separate fields so the one place they are added is here,
   * and `deposited` is the deposits the payslip did not already account for.
   */
  it('adds the two halves of saving exactly once', () => {
    const summary = monthSummary(
      observation({ payrollSaved: ils(1_500_00), deposited: ils(500_00) }),
    )

    expect(summary.saved).toEqual(ils(2_000_00))
    // 2,000 of 14,000 income.
    expect(summary.savingsRateBasisPoints).toBe(1429)
  })

  it('saves money moved to something owned, and never spends it (M28 U2, D-309)', () => {
    const summary = monthSummary(
      observation({ payrollSaved: ils(1_500_00), deposited: ils(500_00), moved: ils(3_000_00) }),
    )

    expect(summary.saved).toEqual(ils(5_000_00))
    expect(summary.expenses).toEqual(ils(8_000_00))
    expect(summary.balance).toEqual(ils(6_000_00))
  })

  it('has no savings rate at all in a month with no income', () => {
    const summary = monthSummary(observation({ payrollNet: ils(0), inflow: ils(0) }))

    expect(summary.savingsRateBasisPoints).toBeUndefined()
  })

  it('reports a negative balance rather than clamping it', () => {
    const summary = monthSummary(observation({ payrollNet: ils(5_000_00) }))

    expect(summary.balance).toEqual(ils(-3_000_00))
  })
})

describe('comparisons', () => {
  const summaries = summarizeMonths(sixMonths())

  it('measures the change against last month', () => {
    const result = versusPreviousMonth(summaries, month(2026, 6), 'expenses')

    expect(result).toMatchObject({
      kind: 'DELTA',
      basis: ils(5_000_00),
      current: ils(6_000_00),
      difference: ils(1_000_00),
      basisPoints: 2000,
    })
  })

  it('says there is no last month rather than reporting no change', () => {
    expect(versusPreviousMonth(summaries, month(2026, 1), 'expenses')).toEqual({
      kind: 'NO_BASIS',
      reason: 'NO_SUCH_MONTH',
    })
  })

  /** A summary opened on the second would otherwise report a 95% fall. */
  it('refuses to compare against a month that is still running', () => {
    const running = summarizeMonths([
      ...sixMonths(),
      observation({ period: month(2026, 7), outflow: ils(200_00), isComplete: false }),
      observation({ period: month(2026, 8), outflow: ils(9_000_00) }),
    ])

    expect(versusPreviousMonth(running, month(2026, 8), 'expenses')).toEqual({
      kind: 'NO_BASIS',
      reason: 'MONTH_IN_PROGRESS',
    })
  })

  it('averages the three complete months before this one', () => {
    // March, April, May: 3,000 + 4,000 + 5,000 → 4,000.
    const result = versusRecentAverage(summaries, month(2026, 6), 'expenses')

    expect(result).toMatchObject({ kind: 'DELTA', basis: ils(4_000_00), basisPoints: 5000 })
  })

  it('leaves a month in progress out of the average it is measured against', () => {
    const running = summarizeMonths([
      ...sixMonths().slice(0, 5),
      observation({ period: month(2026, 6), outflow: ils(60_00), isComplete: false }),
      observation({ period: month(2026, 7), outflow: ils(6_000_00) }),
    ])

    // March, April, May again — June is unfinished and does not drag it down.
    expect(versusRecentAverage(running, month(2026, 7), 'expenses')).toMatchObject({
      basis: ils(4_000_00),
    })
  })

  /**
   * A window over months that exist rather than over calendar slots — the call
   * `observedMonthlyPrincipal` (D-083) makes for the same reason.
   */
  it('reaches past a missing month rather than averaging fewer', () => {
    const gappy = summarizeMonths([
      observation({ period: month(2026, 1), outflow: ils(3_000_00) }),
      observation({ period: month(2026, 2), outflow: ils(3_000_00) }),
      observation({ period: month(2026, 3), outflow: ils(3_000_00) }),
      // no April
      observation({ period: month(2026, 5), outflow: ils(4_000_00) }),
    ])

    expect(versusRecentAverage(gappy, month(2026, 5), 'expenses')).toMatchObject({
      basis: ils(3_000_00),
    })
  })

  it('says so when there are not enough months to average', () => {
    const short = summarizeMonths(sixMonths().slice(0, 2))

    expect(versusRecentAverage(short, month(2026, 2), 'expenses')).toEqual({
      kind: 'NO_BASIS',
      reason: 'NOT_ENOUGH_MONTHS',
    })
    expect(AVERAGE_MONTHS).toBe(3)
  })

  it('compares against the same month last year when there is one', () => {
    const twoYears = summarizeMonths([
      observation({ period: month(2025, 6), outflow: ils(4_000_00) }),
      observation({ period: month(2026, 6), outflow: ils(6_000_00) }),
    ])

    expect(versusYearAgo(twoYears, month(2026, 6), 'expenses')).toMatchObject({
      basis: ils(4_000_00),
      basisPoints: 5000,
    })
  })

  it('says there is no year-ago month rather than printing nothing changed', () => {
    expect(versusYearAgo(summaries, month(2026, 6), 'expenses')).toEqual({
      kind: 'NO_BASIS',
      reason: 'NO_SUCH_MONTH',
    })
  })

  it('has no percentage when the basis is zero, but still carries both figures', () => {
    const fromNothing = summarizeMonths([
      observation({ period: month(2026, 5), outflow: ils(0) }),
      observation({ period: month(2026, 6), outflow: ils(1_240_00) }),
    ])

    expect(versusPreviousMonth(fromNothing, month(2026, 6), 'expenses')).toEqual({
      kind: 'DELTA',
      basis: ils(0),
      current: ils(1_240_00),
      difference: ils(1_240_00),
      basisPoints: undefined,
    })
  })

  it('answers all three chips from one call', () => {
    const result = compareMonth(summaries, month(2026, 6), 'expenses')

    expect(result.previousMonth.kind).toBe('DELTA')
    expect(result.recentAverage.kind).toBe('DELTA')
    expect(result.yearAgo.kind).toBe('NO_BASIS')
  })
})

describe('categoryBreakdown', () => {
  const groceries: CategoryObservation = {
    categoryId: 'food',
    parentId: undefined,
    name: 'Food',
    outflow: ils(3_000_00),
    transactionCount: 20,
  }
  const restaurants: CategoryObservation = {
    categoryId: 'restaurants',
    parentId: 'food',
    name: 'Restaurants',
    outflow: ils(1_000_00),
    transactionCount: 5,
  }
  const rent: CategoryObservation = {
    categoryId: 'rent',
    parentId: undefined,
    name: 'Rent',
    outflow: ils(5_400_00),
    transactionCount: 1,
  }
  const unknown: CategoryObservation = {
    categoryId: undefined,
    parentId: undefined,
    name: 'Uncategorized',
    outflow: ils(600_00),
    transactionCount: 8,
  }

  it('rolls a subcategory into its parent and keeps the parts underneath', () => {
    const lines = categoryBreakdown([groceries, restaurants, rent, unknown])

    const food = lines.find((line) => line.categoryId === 'food')
    expect(food?.outflow).toEqual(ils(4_000_00))
    expect(food?.transactionCount).toBe(25)
    // The children add up to the parent, the parent's own spending included.
    expect(food?.children.map((child) => child.outflow)).toEqual([ils(3_000_00), ils(1_000_00)])
  })

  it('lists everything on its own when asked for the flat view', () => {
    const lines = categoryBreakdown([groceries, restaurants, rent, unknown], { flat: true })

    expect(lines).toHaveLength(4)
    expect(lines.every((line) => line.children.length === 0)).toBe(true)
  })

  /** docs/f10: hiding it is how these apps quietly lie. */
  it('keeps uncategorized as a line, and inside the total the shares are of', () => {
    const lines = categoryBreakdown([groceries, restaurants, rent, unknown])
    const uncategorized = lines.find((line) => line.categoryId === undefined)

    expect(uncategorized?.outflow).toEqual(ils(600_00))
    // 600 of 10,000.
    expect(uncategorized?.shareBasisPoints).toBe(600)
  })

  it('ranks by amount, biggest first', () => {
    const lines = categoryBreakdown([groceries, restaurants, rent, unknown])

    expect(lines.map((line) => line.name)).toEqual(['Rent', 'Food', 'Uncategorized'])
  })

  it('rolls three levels up, so a heading is everything under it (M28 F29)', () => {
    const living: CategoryObservation = { ...rent, categoryId: 'living', name: 'Living', outflow: ils(100_00), transactionCount: 1 }
    const utilities: CategoryObservation = { ...rent, categoryId: 'utilities', parentId: 'living', name: 'Utilities', outflow: ils(200_00), transactionCount: 1 }
    const power: CategoryObservation = { ...rent, categoryId: 'power', parentId: 'utilities', name: 'Electricity', outflow: ils(300_00), transactionCount: 2 }
    const [top] = categoryBreakdown([power, utilities, living])

    expect(top?.outflow).toEqual(ils(600_00))
    expect(top?.transactionCount).toBe(4)
    const middle = top?.children.find((line) => line.categoryId === 'utilities')
    expect(middle?.outflow).toEqual(ils(500_00))
    expect(middle?.children.map((line) => line.outflow)).toEqual([ils(300_00), ils(200_00)])
  })

  it('leaves a subcategory standing alone when its parent had no spending', () => {
    const lines = categoryBreakdown([restaurants, rent])

    expect(lines.map((line) => line.categoryId)).toEqual(['rent', 'restaurants'])
  })

  /**
   * A month with nothing in this category is a zero rather than a gap: the
   * observation is of the month, and the month was imported. Otherwise every
   * occasional category would read as a fresh discovery each time it reappeared.
   */
  it('counts a category absent from an earlier month as zero in its average', () => {
    const lines = categoryBreakdown([rent], {
      earlierMonths: [[rent], [], [rent]],
    })

    // 5,400 + 0 + 5,400 over three months → 3,600.
    expect(lines[0]?.comparison).toMatchObject({ kind: 'DELTA', basis: ils(3_600_00) })
  })

  it('has no comparison for a category with too little history', () => {
    const lines = categoryBreakdown([rent], { earlierMonths: [[rent]] })

    expect(lines[0]?.comparison).toEqual({ kind: 'NO_BASIS', reason: 'NOT_ENOUGH_MONTHS' })
  })

  it('is empty on a month with nothing in it', () => {
    expect(categoryBreakdown([])).toEqual([])
  })
})

describe('cumulativeSpend', () => {
  const days: readonly DayObservation[] = [
    { date: localDate(2026, 6, 1), outflow: ils(100_00) },
    { date: localDate(2026, 6, 3), outflow: ils(50_00) },
    { date: localDate(2026, 6, 10), outflow: ils(200_00) },
  ]

  it('runs a total across every day, flat on the days nothing happened', () => {
    const curve = cumulativeSpend(month(2026, 6), days, { daysElapsed: 10 })

    expect(curve.points).toHaveLength(10)
    expect(curve.points[0]?.runningTotal).toEqual(ils(100_00))
    expect(curve.points[1]?.runningTotal).toEqual(ils(100_00))
    expect(curve.points[2]?.runningTotal).toEqual(ils(150_00))
    expect(curve.points[9]?.runningTotal).toEqual(ils(350_00))
  })

  it('stops where the data stops rather than running flat to the end', () => {
    const curve = cumulativeSpend(month(2026, 6), days, { daysElapsed: 10 })

    expect(curve.daysInMonth).toBe(30)
    expect(curve.daysElapsed).toBe(10)
  })

  it('projects the month at the rate so far, and only while it is running', () => {
    const running = cumulativeSpend(month(2026, 6), days, { daysElapsed: 10 })
    const finished = cumulativeSpend(month(2026, 6), days, { daysElapsed: 30 })

    // 350 over ten days of a thirty-day month.
    expect(running.projectedTotal).toEqual(ils(1_050_00))
    expect(finished.projectedTotal).toBeUndefined()
  })

  it('carries the previous month as its own curve for the ghost', () => {
    const curve = cumulativeSpend(month(2026, 6), days, {
      daysElapsed: 10,
      previousMonth: [{ date: localDate(2026, 5, 2), outflow: ils(80_00) }],
    })

    expect(curve.previous).toHaveLength(31)
    expect(curve.previous[30]?.runningTotal).toEqual(ils(80_00))
  })

  it('has no points and no projection on the first of the month', () => {
    const curve = cumulativeSpend(month(2026, 6), [], { daysElapsed: 0, currency: ILS })

    expect(curve.points).toEqual([])
    expect(curve.projectedTotal).toBeUndefined()
  })
})

describe('yearOverview', () => {
  it('holds twelve slots and leaves the months nobody imported empty', () => {
    const year = yearOverview(summarizeMonths(sixMonths()), 2026, ILS)

    expect(year.months).toHaveLength(12)
    expect(year.monthsWithData).toBe(6)
    expect(year.months[6]).toBeUndefined()
  })

  /** F10's first acceptance criterion, and it holds by construction. */
  it('sums to exactly what the months say', () => {
    const summaries = summarizeMonths(sixMonths())
    const year = yearOverview(summaries, 2026, ILS)

    const monthly = summaries.reduce(
      (totals, one) => ({
        income: totals.income + one.income.minor,
        expenses: totals.expenses + one.expenses.minor,
        saved: totals.saved + one.saved.minor,
      }),
      { income: 0, expenses: 0, saved: 0 },
    )

    expect(year.income.minor).toBe(monthly.income)
    expect(year.expenses.minor).toBe(monthly.expenses)
    expect(year.saved.minor).toBe(monthly.saved)
    expect(year.balance.minor).toBe(monthly.income - monthly.expenses)
  })

  it('leaves the month in progress out of the averages and out of best and worst', () => {
    const summaries = summarizeMonths([
      ...sixMonths(),
      observation({ period: month(2026, 7), outflow: ils(30_00), isComplete: false }),
    ])
    const year = yearOverview(summaries, 2026, ILS)

    expect(year.monthsWithData).toBe(7)
    expect(year.completeMonths).toBe(6)
    // 1,000 … 6,000 over six months.
    expect(year.averageExpenses).toEqual(ils(3_500_00))
    // July spent almost nothing but is unfinished, so June is not displaced.
    expect(year.bestMonth?.period.month).toBe(1)
    expect(year.worstMonth?.period.month).toBe(6)
  })

  it('still counts the month in progress in the year total', () => {
    const summaries = summarizeMonths([
      ...sixMonths(),
      observation({ period: month(2026, 7), outflow: ils(1_000_00), isComplete: false }),
    ])

    expect(yearOverview(summaries, 2026, ILS).expenses).toEqual(ils(22_000_00))
  })

  it('has no averages and no best month in a year with nothing finished', () => {
    const year = yearOverview(
      summarizeMonths([observation({ period: month(2026, 1), isComplete: false })]),
      2026,
      ILS,
    )

    expect(year.averageIncome).toBeUndefined()
    expect(year.bestMonth).toBeUndefined()
  })

  it('is an empty year rather than a crash when nothing is there at all', () => {
    const year = yearOverview([], 2026, ILS)

    expect(year.income).toEqual(ils(0))
    expect(year.monthsWithData).toBe(0)
    expect(year.savingsRateBasisPoints).toBeUndefined()
  })
})

describe('income detail', () => {
  const payslip: IncomeObservation = {
    kind: 'PAYSLIP',
    name: 'Acme',
    amount: ils(14_000_00),
    ref: 'pay-1',
    categoryName: undefined,
    count: 1,
    date: localDate(2026, 6, 9),
    salary: { kind: 'AGREES', landed: ils(14_000_00), landedOn: localDate(2026, 6, 9), count: 1 },
  }
  const inflow = (overrides?: Partial<IncomeObservation>): IncomeObservation => ({
    kind: 'LEDGER',
    name: 'ביטוח לאומי',
    amount: ils(600_00),
    ref: 'ביטוח לאומי',
    categoryName: 'Benefits',
    count: 2,
    date: localDate(2026, 6, 20),
    ...overrides,
  })

  it('adds up to the income the headline prints', () => {
    const detail = incomeDetail(month(2026, 6), [payslip, inflow()], ILS)

    expect(detail.payroll).toEqual(ils(14_000_00))
    expect(detail.other).toEqual(ils(600_00))
    // The same arithmetic `monthSummary` does: payrollNet + inflow.
    expect(detail.total).toEqual(
      monthSummary(observation({ inflow: ils(600_00) })).income,
    )
  })

  it('names the salary as a share of what came in', () => {
    const detail = incomeDetail(month(2026, 6), [payslip, inflow()], ILS)

    expect(detail.payrollShareBasisPoints).toBe(9589)
    expect(detail.lines[0]?.ref).toBe('pay-1')
    expect(detail.lines[1]?.shareBasisPoints).toBe(411)
  })

  it('is a list of nothing, not a division by nothing, in an empty month', () => {
    const detail = incomeDetail(month(2026, 6), [], ILS)

    expect(detail.total).toEqual(ils(0))
    expect(detail.payrollShareBasisPoints).toBeUndefined()
    expect(detail.problems).toBe(0)
  })

  it('counts a salary the bank disagrees with, and says nothing of one that agrees', () => {
    const detail = incomeDetail(
      month(2026, 6),
      [
        payslip,
        inflow({ name: 'Acme', amount: ils(900_00), salary: { kind: 'NO_SLIP' } }),
        { ...payslip, ref: 'pay-2', salary: { kind: 'NO_DEPOSIT' } },
        { ...payslip, ref: 'pay-3', salary: { kind: 'UNCHECKED' } },
      ],
      ILS,
    )

    // A deposit agreeing, or never looked for, is not a problem; a deposit with no
    // slip and a slip with no deposit are. The total is the lines' either way.
    expect(detail.problems).toBe(2)
  })
})

describe('fixed versus variable', () => {
  const expense = (overrides?: Partial<FixedExpense>): FixedExpense => ({
    id: 'fx-1',
    name: 'Netflix',
    categoryId: undefined,
    matchKind: 'MERCHANT_PATTERN',
    matchRef: 'netflix',
    expectedAmount: ils(54_90),
    amountVariability: 'FIXED',
    cadence: 'MONTHLY',
    dayOfMonthHint: 12,
    isDiscretionary: true,
    source: 'DETECTED_CONFIRMED',
    isActive: true,
    startedAt: localDate(2026, 1, 1),
    endedAt: undefined,
    ...overrides,
  })

  const totals = { expenses: ils(8_000_00), income: ils(14_600_00) }

  it('settles a merchant claim before a category one, so no charge is claimed twice', () => {
    const claims = ledgerClaims(
      [
        expense({ id: 'cat', matchKind: 'CATEGORY', matchRef: 'entertainment' }),
        expense({ id: 'merchant' }),
      ],
      month(2026, 6),
    )

    // The order is the precedence, and the query builds its buckets from it.
    expect(claims.map((one) => one.expenseId)).toEqual(['merchant', 'cat'])
    expect(claims.map((one) => one.on)).toEqual(['MERCHANT', 'CATEGORY'])
  })

  it('leaves out an expense that had not started, or has ended', () => {
    const claims = ledgerClaims(
      [
        expense({ id: 'later', startedAt: localDate(2026, 9, 1) }),
        expense({ id: 'over', endedAt: localDate(2026, 3, 31) }),
        expense({ id: 'live' }),
      ],
      month(2026, 6),
    )

    expect(claims.map((one) => one.expenseId)).toEqual(['live'])
  })

  it('splits the month so that fixed and variable are the whole of it', () => {
    const split = spendingSplit(
      month(2026, 6),
      totals,
      [expense(), expense({ id: 'fx-2', name: 'Rent', matchRef: 'landlord', isDiscretionary: false })],
      [
        { expenseId: 'fx-1', outflow: ils(54_90), transactionCount: 1 },
        { expenseId: 'fx-2', outflow: ils(5_200_00), transactionCount: 1 },
      ],
      ILS,
    )

    expect(split.fixed).toEqual(ils(5_254_90))
    expect(split.variable).toEqual(ils(2_745_10))
    expect(add(split.fixed, split.variable)).toEqual(totals.expenses)
    expect(split.fixedShareBasisPoints).toBe(6569)
    // Against the income the headline above it prints, not against take-home.
    expect(split.fixedShareOfIncomeBasisPoints).toBe(3599)
    // docs/08 B1: fixed and cuttable are different axes.
    expect(split.discretionary).toEqual(ils(54_90))
  })

  it('never lets a payroll deduction into the fixed total', () => {
    const split = spendingSplit(
      month(2026, 6),
      totals,
      [expense({ id: 'pension', matchKind: 'PAYCHECK_DEDUCTION', matchRef: 'dt-1', expectedAmount: ils(1_200_00) })],
      [],
      ILS,
    )

    // docs/f09 calls subtracting this twice the most dangerous bug in the
    // feature. It is shown, with its declared share, and it is not in `fixed`.
    expect(split.fixed).toEqual(ils(0))
    expect(split.variable).toEqual(totals.expenses)
    expect(split.lines[0]).toMatchObject({
      status: 'OUT_OF_NET',
      outflow: ils(0),
      monthlyShare: ils(1_200_00),
    })
  })

  it('tells a bill that did not arrive from one nothing can answer', () => {
    const split = spendingSplit(
      month(2026, 6),
      totals,
      [
        expense({ id: 'water', name: 'Water', matchRef: 'mei-avivim' }),
        expense({
          id: 'premium',
          name: 'Car insurance',
          matchKind: 'MANUAL_ONLY',
          matchRef: undefined,
          cadence: 'YEARLY',
          expectedAmount: ils(3_600_00),
        }),
      ],
      [],
      ILS,
    )

    expect(split.lines.map((one) => one.status)).toEqual(['NOT_CHARGED', 'NOT_TRACKED'])
    // Amortized, because a yearly premium is not a month's worth of anything.
    expect(split.lines[1]?.monthlyShare).toEqual(ils(300_00))
  })

  it('does not call a bimonthly bill missing in its off month', () => {
    const water = expense({
      id: 'water',
      name: 'Water',
      matchRef: 'mei-avivim',
      cadence: 'BIMONTHLY',
      expectedAmount: ils(310_00),
      startedAt: localDate(2026, 1, 1),
    })

    // January, March, May are its months; June is not.
    expect(spendingSplit(month(2026, 5), totals, [water], [], ILS).lines[0]?.status).toBe(
      'NOT_CHARGED',
    )
    expect(spendingSplit(month(2026, 6), totals, [water], [], ILS).lines[0]?.status).toBe(
      'NOT_DUE',
    )
  })

  it('never reports an irregular expense as a bill that failed to arrive', () => {
    const split = spendingSplit(
      month(2026, 6),
      totals,
      [expense({ id: 'vet', name: 'Vet', matchRef: 'vet', cadence: 'IRREGULAR' })],
      [],
      ILS,
    )

    // It has no schedule to be late against, so there is nothing to be missing.
    expect(split.lines[0]?.status).toBe('NOT_DUE')
  })

  it('divides the variable share itself rather than taking the complement', () => {
    const split = spendingSplit(
      month(2026, 6),
      { expenses: ils(3_00), income: ils(100_00) },
      [expense()],
      [{ expenseId: 'fx-1', outflow: ils(1_00), transactionCount: 1 }],
      ILS,
    )

    // 1/3 and 2/3 both round, and neither is ten thousand minus the other.
    expect(split.fixedShareBasisPoints).toBe(3333)
    expect(split.variableShareBasisPoints).toBe(6667)
  })

  it('calls a month with no commitments entirely variable', () => {
    const split = spendingSplit(month(2026, 6), totals, [], [], ILS)

    expect(split.fixed).toEqual(ils(0))
    expect(split.variable).toEqual(totals.expenses)
    expect(split.lines).toEqual([])
    expect(split.fixedShareBasisPoints).toBe(0)
  })

  it('has no share to report for a month nothing came in or went out', () => {
    const split = spendingSplit(
      month(2026, 6),
      { expenses: ils(0), income: ils(0) },
      [expense()],
      [],
      ILS,
    )

    expect(split.fixedShareBasisPoints).toBeUndefined()
    expect(split.fixedShareOfIncomeBasisPoints).toBeUndefined()
  })
})
