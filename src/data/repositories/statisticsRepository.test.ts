import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { createAccount } from './accountRepository.ts'
import { createCategory, setCategoryManually } from './categoryRepository.ts'
import { isMovedKind, movedLines } from './movedRepository.ts'
import { createDeductionType } from './deductionTypeRepository.ts'
import { createFixedExpense } from './fixedExpenseRepository.ts'
import { createPaycheck } from './paycheckRepository.ts'
import {
  addDeposit,
  createGoal,
  createHolding,
  createHoldingPlace,
} from './savingsRepository.ts'
import {
  categoryObservations,
  dayObservations,
  incomeObservations,
  largestCharges,
  monthObservations,
  monthlyReport,
  monthlySummaries,
  payrollYear,
  yearCategoryObservations,
  yearlyReport,
} from './statisticsRepository.ts'
import { incomeDetail, monthSummary } from '@/domain/statistics.ts'
import { read } from '@/domain/format/artefact.ts'
import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import { adoptFormat, listFormats } from './formatRepository.ts'
import { insertRows } from './formatRowRepository.ts'
import {
  setExcludedFromStats,
  summarizeTransactions,
  type InsertableTransaction,
} from './transactionRepository.ts'

const ILS = 'ILS'
const ils = (minor: number) => money(minor, ILS)
const NOW = 1_755_000_000_000
const ACCOUNT = 'acc-1'
/** Read in August, so anything up to July is a finished month. */
const AS_OF = localDate(2026, 8, 12)

function row(overrides: Partial<InsertableTransaction> & { id: string }): InsertableTransaction {
  return {
    accountId: ACCOUNT,
    transactionDate: localDate(2026, 6, 5),
    chargeDate: undefined,
    billingPeriod: undefined,
    amount: ils(-100_00),
    direction: 'OUTFLOW',
    merchantRaw: 'שופרסל',
    merchantNormalized: 'שופרסל',
    providerCategory: undefined,
    cardLast4: undefined,
    reference: undefined,
    note: undefined,
    installment: undefined,
    foreign: undefined,
    naturalKey: overrides.id,
    importSessionId: undefined,
    sourceRowRef: undefined,
    ...overrides,
  }
}

async function withAccount(): Promise<Database> {
  const db = await createLedgerDatabase()
  createAccount(db, { name: 'Hapoalim', kind: 'BANK', last4: '4321' }, NOW)
  db.run("UPDATE fmt_account SET id = ? WHERE last4 = '4321'", [ACCOUNT])
  return db
}

describe('monthObservations', () => {
  it('groups on the charge date, falling back to the transaction date', async () => {
    const db = await withAccount()
    // Bought in June, charged in July: it belongs to July (D-006).
    insertTransaction(
      db,
      row({ id: 'a', transactionDate: localDate(2026, 6, 28), chargeDate: localDate(2026, 7, 2) }),
      NOW,
    )
    insertTransaction(db, row({ id: 'b', transactionDate: localDate(2026, 6, 5) }), NOW)

    const months = monthObservations(db, AS_OF)

    expect(months.map((one) => one.period.month)).toEqual([6, 7])
    expect(months[0]?.outflow).toEqual(ils(100_00))
  })

  it('reports spending as a magnitude and keeps refunds out of it', async () => {
    const db = await withAccount()
    insertTransaction(db, row({ id: 'spend', amount: ils(-500_00) }), NOW)
    insertTransaction(db, row({ id: 'refund', amount: ils(120_00), direction: 'INFLOW' }), NOW)

    const june = monthObservations(db, AS_OF)[0]

    expect(june?.outflow).toEqual(ils(500_00))
    expect(june?.inflow).toEqual(ils(120_00))
  })

  it('leaves out a row the user excluded from statistics', async () => {
    const db = await withAccount()
    insertTransaction(db, row({ id: 'kept' }), NOW)
    insertTransaction(db, row({ id: 'settlement', amount: ils(-3_000_00) }), NOW)
    setExcludedFromStats(db, 'settlement', true, NOW)

    expect(monthObservations(db, AS_OF)[0]?.outflow).toEqual(ils(100_00))
  })

  it('marks the month the report is read in as still running', async () => {
    const db = await withAccount()
    insertTransaction(db, row({ id: 'june' }), NOW)
    insertTransaction(db, row({ id: 'august', transactionDate: localDate(2026, 8, 1) }), NOW)

    const months = monthObservations(db, AS_OF)

    expect(months.find((one) => one.period.month === 6)?.isComplete).toBe(true)
    expect(months.find((one) => one.period.month === 8)?.isComplete).toBe(false)
  })

  it('is a month even when the only thing in it was a payslip', async () => {
    const db = await withAccount()
    createPaycheck(
      db,
      {
        period: { year: 2026, month: 5 },
        paymentDate: localDate(2026, 6, 1),
        gross: ils(20_000_00),
        net: ils(14_000_00),
      },
      NOW,
    )

    const may = monthObservations(db, AS_OF).find((one) => one.period.month === 5)

    expect(may?.payrollNet).toEqual(ils(14_000_00))
    expect(may?.outflow).toEqual(ils(0))
    expect(may?.transactionCount).toBe(0)
  })

  /** docs/f10: zero and unknown are different. */
  it('leaves a month with nothing in it out entirely rather than reporting zeroes', async () => {
    const db = await withAccount()
    insertTransaction(db, row({ id: 'april', transactionDate: localDate(2026, 4, 5) }), NOW)
    insertTransaction(db, row({ id: 'june' }), NOW)

    expect(monthObservations(db, AS_OF).map((one) => one.period.month)).toEqual([4, 6])
  })
})

describe('what counts as saved', () => {
  /**
   * The trap M6 was warned about. A payslip line linked to a goal produces a
   * payroll saving line and a `FROM_PAYCHECK_DEDUCTION` deposit (D-077); summing
   * both would report double the money.
   */
  async function withLinkedPayroll(): Promise<Database> {
    const db = await withAccount()
    const place = createHoldingPlace(db, { name: 'Bank', kind: 'CHECKING' }, NOW)
    const holding = createHolding(
      db,
      { holdingPlaceId: place.id, name: 'Cash', kind: 'CASH', provenance: 'RECORDED', isLiquid: true },
      NOW,
    )
    const goal = createGoal(
      db,
      { name: 'Pension top-up', kind: 'RETIREMENT', defaultHoldingId: holding.id },
      NOW,
    )
    const type = createDeductionType(
      db,
      { name: 'Pension plan', kind: 'PENSION', countsAsSaving: true, linkedSavingGoalId: goal.id },
      NOW,
    )
    createPaycheck(
      db,
      {
        period: { year: 2026, month: 6 },
        paymentDate: localDate(2026, 7, 1),
        gross: ils(20_000_00),
        net: ils(14_000_00),
        lines: [
          { deductionTypeId: type.id, employeeAmount: ils(1_200_00), employerAmount: ils(1_300_00) },
        ],
      },
      NOW,
    )
    return db
  }

  it('counts a payslip-generated deposit once, not twice', async () => {
    const db = await withLinkedPayroll()

    const june = monthObservations(db, AS_OF).find((one) => one.period.month === 6)

    expect(june?.payrollSaved).toEqual(ils(1_200_00))
    // The deposit the payslip generated is already in `payrollSaved`.
    expect(june?.deposited).toEqual(ils(0))
    expect(monthlySummaries(db, AS_OF)[0]?.saved).toEqual(ils(1_200_00))
  })

  /**
   * The employer's share is wealth (D-048) but it never arrived as income, and a
   * rate whose numerator contained it would exceed 100% on a good pension.
   */
  it('counts the employee side of a payslip, never the employer share', async () => {
    const db = await withLinkedPayroll()

    const summary = monthlySummaries(db, AS_OF)[0]

    // 1,200 of 14,000 net.
    expect(summary?.savingsRateBasisPoints).toBe(857)
  })

  it('counts a deposit the user made by hand', async () => {
    const db = await withAccount()
    const place = createHoldingPlace(db, { name: 'Bank', kind: 'CHECKING' }, NOW)
    const holding = createHolding(
      db,
      { holdingPlaceId: place.id, name: 'Cash', kind: 'CASH', provenance: 'RECORDED', isLiquid: true },
      NOW,
    )
    const goal = createGoal(db, { name: 'Trip', kind: 'SHORT_TERM' }, NOW)
    addDeposit(
      db,
      {
        goalId: goal.id,
        date: localDate(2026, 6, 10),
        amount: ils(800_00),
        holdingId: holding.id,
      },
      NOW,
    )

    expect(monthObservations(db, AS_OF)[0]?.deposited).toEqual(ils(800_00))
  })

  /** An opening balance was already there and a gain came from the market (D-081). */
  it('leaves an opening balance and market growth out of what was saved', async () => {
    const db = await withAccount()
    const place = createHoldingPlace(db, { name: 'Broker', kind: 'INVESTMENT' }, NOW)
    const holding = createHolding(
      db,
      { holdingPlaceId: place.id, name: 'Cash', kind: 'CASH', provenance: 'RECORDED', isLiquid: true },
      NOW,
    )
    const goal = createGoal(db, { name: 'Portfolio', kind: 'LONG_TERM' }, NOW)
    for (const [amount, sourceKind] of [
      [200_000_00, 'OPENING_BALANCE'],
      [7_000_00, 'GROWTH'],
      [1_000_00, 'MANUAL'],
    ] as const) {
      addDeposit(
        db,
        {
          goalId: goal.id,
          date: localDate(2026, 6, 10),
          amount: ils(amount),
          holdingId: holding.id,
          sourceKind,
        },
        NOW,
      )
    }

    expect(monthObservations(db, AS_OF)[0]?.deposited).toEqual(ils(1_000_00))
  })
})

/**
 * Three categorized charges, a refund and an excluded settlement, all in June —
 * the shapes a category total and a ledger total could disagree about.
 */
async function withCategories(): Promise<{ db: Database; foodId: string }> {
    const db = await withAccount()
    const foodId = createCategory(db, { name: 'Eating', kind: 'EXPENSE' }, NOW)
    const restaurantsId = createCategory(
      db,
      { name: 'Restaurants', kind: 'EXPENSE', parentId: foodId },
      NOW,
    )

    insertTransaction(db, row({ id: 'groceries', amount: ils(-300_00) }), NOW)
    insertTransaction(db, row({ id: 'dinner', amount: ils(-150_00) }), NOW)
    insertTransaction(db, row({ id: 'mystery', amount: ils(-90_00) }), NOW)
    // The two shapes a category total and a ledger total could disagree about:
    // a refund, which is not spending, and a settlement the user excluded.
    insertTransaction(db, row({ id: 'refund', amount: ils(45_00), direction: 'INFLOW' }), NOW)
    insertTransaction(db, row({ id: 'settlement', amount: ils(-2_000_00) }), NOW)
    setExcludedFromStats(db, 'settlement', true, NOW)
    setCategoryManually(db, 'groceries', foodId, NOW)
    setCategoryManually(db, 'dinner', restaurantsId, NOW)
    setCategoryManually(db, 'refund', foodId, NOW)

  return { db, foodId }
}

describe('categoryObservations', () => {
  it('carries the parent id so the rollup can be the domain', async () => {
    const { db, foodId } = await withCategories()

    const rows = categoryObservations(db, { year: 2026, month: 6 })
    const restaurants = rows.find((one) => one.name === 'Restaurants')

    expect(restaurants?.parentId).toBe(foodId)
  })

  /** docs/f10 is emphatic: hiding it is how these apps quietly lie. */
  it('includes uncategorized as its own row', async () => {
    const { db } = await withCategories()

    const uncategorized = categoryObservations(db, { year: 2026, month: 6 }).find(
      (one) => one.categoryId === undefined,
    )

    expect(uncategorized?.outflow).toEqual(ils(90_00))
    expect(uncategorized?.name).toBe('Uncategorized')
  })

  /**
   * F10's third acceptance criterion — the category totals equal the sum of the
   * transactions a drill-down would show — checked against the ledger's own
   * summary rather than against a hand-added figure, and with the two rows that
   * could make the two disagree present: a refund, which is not spending, and a
   * card settlement the user excluded from statistics.
   */
  it('adds up to what the ledger says the month spent', async () => {
    const { db } = await withCategories()

    const categories = categoryObservations(db, { year: 2026, month: 6 })
    const total = categories.reduce((running, one) => running + one.outflow.minor, 0)
    const ledger = summarizeTransactions(db, {
      from: localDate(2026, 6, 1),
      to: localDate(2026, 6, 30),
    })

    expect(total).toBe(ledger.totals[0]?.outflowMinor)
  })
})

describe('dayObservations', () => {
  it('groups by the day money left, on the same basis as everything else', async () => {
    const db = await withAccount()
    insertTransaction(db, row({ id: 'a', transactionDate: localDate(2026, 6, 3) }), NOW)
    insertTransaction(db, row({ id: 'b', transactionDate: localDate(2026, 6, 3) }), NOW)
    insertTransaction(
      db,
      row({ id: 'c', transactionDate: localDate(2026, 5, 30), chargeDate: localDate(2026, 6, 9) }),
      NOW,
    )

    const days = dayObservations(db, { year: 2026, month: 6 })

    expect(days).toHaveLength(2)
    expect(days[0]).toEqual({ date: localDate(2026, 6, 3), outflow: ils(200_00) })
    expect(days[1]?.date).toEqual(localDate(2026, 6, 9))
  })
})

describe('monthlyReport', () => {
  async function withThreeMonths(): Promise<Database> {
    const db = await withAccount()
    for (const month of [4, 5, 6, 7]) {
      insertTransaction(
        db,
        row({ id: `m-${month}`, transactionDate: localDate(2026, month, 5), amount: ils(-month * 100_00) }),
        NOW,
      )
      createPaycheck(
        db,
        {
          period: { year: 2026, month },
          paymentDate: localDate(2026, month + 1, 1),
          gross: ils(20_000_00),
          net: ils(14_000_00),
        },
        NOW,
      )
    }
    return db
  }

  it('answers the headline, the chips, the breakdown and the curve from one call', async () => {
    const db = await withThreeMonths()

    const report = monthlyReport(db, { year: 2026, month: 7 }, AS_OF)

    expect(report.summary?.expenses).toEqual(ils(700_00))
    expect(report.summary?.income).toEqual(ils(14_000_00))
    expect(report.spending.previousMonth).toMatchObject({ basis: ils(600_00) })
    // April, May, June: 400 + 500 + 600 → 500.
    expect(report.spending.recentAverage).toMatchObject({ basis: ils(500_00) })
    expect(report.spending.yearAgo).toEqual({ kind: 'NO_BASIS', reason: 'NO_SUCH_MONTH' })
    expect(report.categories).toHaveLength(1)
    expect(report.curve.points).toHaveLength(31)
  })

  it('stops the curve where the month has got to, and projects from there', async () => {
    const db = await withThreeMonths()
    insertTransaction(
      db,
      row({ id: 'aug', transactionDate: localDate(2026, 8, 4), amount: ils(-400_00) }),
      NOW,
    )

    const report = monthlyReport(db, { year: 2026, month: 8 }, AS_OF)

    expect(report.summary?.isComplete).toBe(false)
    expect(report.curve.daysElapsed).toBe(12)
    expect(report.curve.daysInMonth).toBe(31)
    // 400 over twelve days of a thirty-one day month.
    expect(report.curve.projectedTotal).toEqual(ils(1_033_33))
  })

  /**
   * The find, from running this against a real database: `cumulativeSpend`
   * cannot tell "spent nothing" from "no data" — both reach it as an empty list
   * of days — and a month absent from the document was drawing a flat line along
   * zero for thirty days, which is the zero-versus-unknown mistake in the one
   * chart docs/f10 calls the most useful in the app. Only the caller knows which
   * it is, so the report withholds the elapsed days from a month it has no
   * summary for.
   */
  it('draws no curve at all for a month the document has never seen', async () => {
    const db = await withAccount()

    const report = monthlyReport(db, { year: 2026, month: 6 }, AS_OF)

    expect(report.summary).toBeUndefined()
    expect(report.categories).toEqual([])
    expect(report.curve.points).toEqual([])
  })

  it('draws a flat curve for a month that really did spend nothing', async () => {
    const db = await withAccount()
    createPaycheck(
      db,
      {
        period: { year: 2026, month: 6 },
        paymentDate: localDate(2026, 7, 1),
        gross: ils(20_000_00),
        net: ils(14_000_00),
      },
      NOW,
    )

    const report = monthlyReport(db, { year: 2026, month: 6 }, AS_OF)

    expect(report.summary?.expenses).toEqual(ils(0))
    expect(report.curve.points).toHaveLength(30)
    expect(report.curve.points[29]?.runningTotal).toEqual(ils(0))
  })
})

describe('yearCategoryObservations', () => {
  it('sums a category across the whole year, on the same basis as a month does', async () => {
    const { db } = await withCategories()
    // Charged in January of the next year, so it belongs to that year (D-006).
    insertTransaction(
      db,
      row({
        id: 'december',
        transactionDate: localDate(2026, 12, 30),
        chargeDate: localDate(2027, 1, 3),
        amount: ils(-70_00),
      }),
      NOW,
    )
    insertTransaction(
      db,
      row({ id: 'march', transactionDate: localDate(2026, 3, 4), amount: ils(-110_00) }),
      NOW,
    )

    const year = yearCategoryObservations(db, 2026)
    const uncategorized = year.find((one) => one.categoryId === undefined)

    // June's 90 plus March's 110. December's row is charged in 2027.
    expect(uncategorized?.outflow).toEqual(ils(200_00))
    expect(yearCategoryObservations(db, 2027).length).toBe(1)
  })

  /** The month and the year read the same rows, because they share one query. */
  it('agrees with the months it is made of', async () => {
    const { db } = await withCategories()

    const june = categoryObservations(db, { year: 2026, month: 6 })
    const year = yearCategoryObservations(db, 2026)
    const total = (rows: readonly { outflow: { minor: number } }[]) =>
      rows.reduce((running, one) => running + one.outflow.minor, 0)

    expect(total(year)).toBe(total(june))
  })
})

describe('payrollYear', () => {
  async function withSlips(): Promise<Database> {
    const db = await withAccount()
    const tax = createDeductionType(db, { name: 'Tax at source', kind: 'TAX' }, NOW)
    const pension = createDeductionType(
      db,
      { name: 'Pension plan', kind: 'PENSION', countsAsSaving: true },
      NOW,
    )
    for (const month of [1, 2, 3]) {
      createPaycheck(
        db,
        {
          period: { year: 2026, month },
          paymentDate: localDate(2026, month, 28),
          gross: ils(20_000_00),
          net: ils(14_000_00),
          lines: [
            { deductionTypeId: tax.id, employeeAmount: ils(3_400_00) },
            {
              deductionTypeId: pension.id,
              employeeAmount: ils(1_200_00),
              employerAmount: ils(1_300_00),
            },
          ],
        },
        NOW,
      )
    }
    return db
  }

  it('adds the payslips of one year and reports the rate they were taxed at', async () => {
    const db = await withSlips()

    const year = payrollYear(db, 2026)

    expect(year.slips).toBe(3)
    expect(year.gross).toEqual(ils(60_000_00))
    expect(year.net).toEqual(ils(42_000_00))
    expect(year.tax).toEqual(ils(10_200_00))
    expect(year.saved).toEqual(ils(3_600_00))
    // 10,200 of 60,000.
    expect(year.taxRateBasisPoints).toBe(1700)
  })

  it('has no tax rate in a year with no payslips, rather than a zero one', async () => {
    const db = await withSlips()

    const year = payrollYear(db, 2025)

    expect(year.slips).toBe(0)
    expect(year.gross).toEqual(ils(0))
    expect(year.taxRateBasisPoints).toBeUndefined()
  })
})

describe('yearlyReport', () => {
  /** F10's first acceptance criterion, from the database rather than from fixtures. */
  it('sums to exactly what the months say', async () => {
    const db = await withAccount()
    for (const month of [1, 3, 6, 11]) {
      insertTransaction(
        db,
        row({ id: `m-${month}`, transactionDate: localDate(2026, month, 5), amount: ils(-month * 100_00) }),
        NOW,
      )
      createPaycheck(
        db,
        {
          period: { year: 2026, month },
          paymentDate: localDate(2026, month, 28),
          gross: ils(20_000_00),
          net: ils(14_000_00),
        },
        NOW,
      )
    }

    const months = monthlySummaries(db, AS_OF).filter((one) => one.period.year === 2026)
    const year = yearlyReport(db, 2026, AS_OF)

    expect(year.expenses.minor).toBe(
      months.reduce((total, one) => total + one.expenses.minor, 0),
    )
    expect(year.income.minor).toBe(months.reduce((total, one) => total + one.income.minor, 0))
    expect(year.monthsWithData).toBe(4)
    // The months nobody imported are gaps, not zeroes.
    expect(year.months[1]).toBeUndefined()
  })
})

describe('incomeObservations', () => {
  it('counts the payslip and the ledger inflow from their own two places', async () => {
    const db = await withAccount()
    createPaycheck(
      db,
      {
        period: { year: 2026, month: 6 },
        paymentDate: localDate(2026, 6, 9),
        gross: ils(20_000_00),
        net: ils(14_000_00),
        employerName: 'Acme',
      },
      NOW,
    )
    insertTransaction(
      db,
      row({ id: 'refund', amount: ils(320_00), direction: 'INFLOW', merchantRaw: 'Amazon' }),
      NOW,
    )

    const detail = incomeDetail(
      { year: 2026, month: 6 },
      incomeObservations(db, { year: 2026, month: 6 }),
      ILS,
    )

    expect(detail.payroll).toEqual(ils(14_000_00))
    expect(detail.other).toEqual(ils(320_00))
    // The property the whole shape exists for: the detail adds up to the
    // headline the same screen prints above it.
    expect(detail.total).toEqual(
      monthlySummaries(db, AS_OF).find((one) => one.period.month === 6)?.income,
    )
  })

  it('is one line per merchant, not one per row', async () => {
    const db = await withAccount()
    for (const day of [3, 11, 24]) {
      insertTransaction(
        db,
        row({
          id: `rent-${day}`,
          transactionDate: localDate(2026, 6, day),
          amount: ils(100_00),
          direction: 'INFLOW',
          merchantRaw: 'Bituach Leumi',
          merchantNormalized: 'bituach leumi',
        }),
        NOW,
      )
    }

    const lines = incomeObservations(db, { year: 2026, month: 6 })

    expect(lines).toHaveLength(1)
    expect(lines[0]?.count).toBe(3)
    expect(lines[0]?.amount).toEqual(ils(300_00))
    // The latest date, so the line says when the money last arrived.
    expect(lines[0]?.date).toEqual(localDate(2026, 6, 24))
  })

  it('leaves out an inflow the user excluded, exactly as the headline does', async () => {
    const db = await withAccount()
    insertTransaction(db, row({ id: 'kept', amount: ils(200_00), direction: 'INFLOW' }), NOW)
    insertTransaction(
      db,
      row({ id: 'salary', amount: ils(14_000_00), direction: 'INFLOW', merchantRaw: 'Acme' }),
      NOW,
    )
    setExcludedFromStats(db, 'salary', true, NOW)

    const observations = incomeObservations(db, { year: 2026, month: 6 })

    expect(observations).toHaveLength(1)
    expect(observations[0]?.amount).toEqual(ils(200_00))
  })

  it('says nothing about a salary in a document with no payslip to check it against', async () => {
    const db = await withAccount()
    insertTransaction(
      db,
      row({ id: 'deposit', amount: ils(14_000_00), direction: 'INFLOW', merchantRaw: 'Acme' }),
      NOW,
    )

    const observations = incomeObservations(db, { year: 2026, month: 6 })

    expect(observations.map((one) => one.salary)).toEqual([undefined])
  })
})

describe('fixedMatches and the split', () => {
  /** Rent by merchant, groceries by category, and one uncommitted charge. */
  async function withCommitments(): Promise<{ db: Database; groceriesId: string }> {
    const db = await withAccount()
    const groceriesId = createCategory(db, { name: 'Weekly shop', kind: 'EXPENSE' }, NOW)

    insertTransaction(
      db,
      row({
        id: 'rent',
        amount: ils(-5_200_00),
        merchantRaw: 'Landlord',
        merchantNormalized: 'landlord',
      }),
      NOW,
    )
    insertTransaction(db, row({ id: 'shop', amount: ils(-640_00) }), NOW)
    setCategoryManually(db, 'shop', groceriesId, NOW)
    insertTransaction(
      db,
      row({ id: 'coffee', amount: ils(-32_00), merchantNormalized: 'cafe' }),
      NOW,
    )

    createFixedExpense(
      db,
      {
        name: 'Rent',
        matchKind: 'MERCHANT_PATTERN',
        matchRef: 'landlord',
        expectedAmount: ils(5_200_00),
        startedAt: localDate(2026, 1, 1),
      },
      NOW,
    )
    createFixedExpense(
      db,
      {
        name: 'Groceries',
        matchKind: 'CATEGORY',
        matchRef: groceriesId,
        expectedAmount: ils(600_00),
        amountVariability: 'VARIABLE',
        startedAt: localDate(2026, 1, 1),
      },
      NOW,
    )

    return { db, groceriesId }
  }

  it('splits the month into what was committed to and what was not', async () => {
    const { db } = await withCommitments()

    const { split, summary } = monthlyReport(db, { year: 2026, month: 6 }, AS_OF)

    expect(split.fixed).toEqual(ils(5_840_00))
    expect(split.variable).toEqual(ils(32_00))
    // The property: the two sides are the whole of the headline's own figure.
    expect(split.expenses).toEqual(summary?.expenses)
  })

  it('gives a charge two commitments could claim to the merchant one only', async () => {
    const { db, groceriesId } = await withCommitments()
    // The coffee is now both a merchant pattern and inside a declared category.
    setCategoryManually(db, 'coffee', groceriesId, NOW)
    createFixedExpense(
      db,
      {
        name: 'Coffee',
        matchKind: 'MERCHANT_PATTERN',
        matchRef: 'cafe',
        expectedAmount: ils(32_00),
        isDiscretionary: true,
        startedAt: localDate(2026, 1, 1),
      },
      NOW,
    )

    const { split } = monthlyReport(db, { year: 2026, month: 6 }, AS_OF)
    const byName = new Map(split.lines.map((one) => [one.name, one]))

    expect(byName.get('Coffee')?.outflow).toEqual(ils(32_00))
    expect(byName.get('Groceries')?.outflow).toEqual(ils(640_00))
    // Counted once: the whole month is fixed, not more than the whole month.
    expect(split.fixed).toEqual(ils(5_872_00))
    expect(split.variable).toEqual(ils(0))
    expect(split.discretionary).toEqual(ils(32_00))
  })

  it('shows a payroll deduction beside the split and never inside it', async () => {
    const { db } = await withCommitments()
    createFixedExpense(
      db,
      {
        name: 'Pension',
        matchKind: 'PAYCHECK_DEDUCTION',
        matchRef: 'dt-1',
        expectedAmount: ils(1_400_00),
        startedAt: localDate(2026, 1, 1),
      },
      NOW,
    )

    const { split } = monthlyReport(db, { year: 2026, month: 6 }, AS_OF)

    expect(split.fixed).toEqual(ils(5_840_00))
    expect(split.lines.find((one) => one.name === 'Pension')).toMatchObject({
      status: 'OUT_OF_NET',
      outflow: ils(0),
    })
  })

  it('has no split at all for a month the document has never seen', async () => {
    const { db } = await withCommitments()

    const { split, summary } = monthlyReport(db, { year: 2026, month: 3 }, AS_OF)

    expect(summary).toBeUndefined()
    expect(split.lines).toEqual([])
    expect(split.fixedShareBasisPoints).toBeUndefined()
  })
})

/**
 * **Money moved to something you own is not spent** (M28 U2, D-309). A synthetic
 * format the person declared links the ledger's transactions — never a
 * real document, and never the savings group as a rule: the broker
 * transfer below is categorised however anybody likes and still is not spent.
 */
describe('money moved to something owned (M28 U2, D-309)', () => {
  /** Read against the document's own formats, so `transaction` resolves, and adopted. */
  function declare(db: Database, text: string): FormatDeclaration {
    const result = read(text, undefined, listFormats(db))
    if (!result.ok) throw new Error(result.error)
    expect(adoptFormat(db, result.value, NOW).refusals).toEqual([])
    return result.value
  }

  const INVESTMENT = `---
format: investment
title: Investment
language: 14
checks: none
---

A thing I own, and the transfer that bought it.

| column | type | points at | unit | per | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| name | text |  |  |  | yes | no |  |  |  |  |
| transaction | link | transaction |  |  | no | no |  |  |  |  |
`

  const BASKET = `---
format: basket
title: Basket
language: 14
checks: none
---

Several transfers into one thing.

| column | type | points at | unit | per | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| name | text |  |  |  | yes | no |  |  |  |  |
| transfers | links | transaction |  |  | no | no |  |  |  |  |
`

  async function withBroker(): Promise<Database> {
    const db = await withAccount()
    const savings = createCategory(db, { name: 'Savings account', kind: 'EXPENSE' }, NOW)
    insertTransaction(db, row({ id: 'groceries', amount: ils(-100_00) }), NOW)
    insertTransaction(db, row({ id: 'broker', amount: ils(-3_000_00), merchantRaw: 'Broker', merchantNormalized: 'Broker' }), NOW)
    insertTransaction(
      db,
      row({ id: 'sale', amount: ils(500_00), direction: 'INFLOW', merchantRaw: 'Broker', merchantNormalized: 'Broker' }),
      NOW,
    )
    // A category called Savings account that is an ordinary spending kind: a pack link
    // (an override) that says nothing about ownership. (A category on the Money
    // moved tab is a rule since D-316, and has its own tests below.)
    setCategoryManually(db, 'broker', savings, NOW)
    return db
  }

  const JUNE = { year: 2026, month: 6 }

  it('counts a transfer as spent until a declared format links it', async () => {
    const db = await withBroker()

    const june = monthObservations(db, AS_OF)[0]

    expect(june?.outflow).toEqual(ils(3_100_00))
    expect(june?.moved).toEqual(ils(0))
  })

  it('moves a linked transaction out of what went out and into what was saved', async () => {
    const db = await withBroker()
    insertRows(db, declare(db, INVESTMENT), [
      { name: 'Index fund', transaction: 'broker' },
      { name: 'Index fund, sold', transaction: 'sale' },
    ])

    const june = monthObservations(db, AS_OF)[0]
    if (june === undefined) throw new Error('no June')
    const summary = monthSummary(june)

    expect(june.outflow).toEqual(ils(100_00))
    expect(june.inflow).toEqual(ils(0))
    // Net: 3,000 went in and 500 came back out.
    expect(june.moved).toEqual(ils(2_500_00))
    expect(summary.expenses).toEqual(ils(100_00))
    expect(summary.saved).toEqual(ils(2_500_00))
    expect(categoryObservations(db, JUNE).map((one) => one.name)).toEqual(['Uncategorized'])
  })

  it('reads a links column member by member', async () => {
    const db = await withBroker()
    insertRows(db, declare(db, BASKET), [{ name: 'Pension top-up', transfers: ['broker'] }])

    const june = monthObservations(db, AS_OF)[0]

    expect(june?.outflow).toEqual(ils(100_00))
    expect(june?.inflow).toEqual(ils(500_00))
    expect(june?.moved).toEqual(ils(3_000_00))
  })

  /** F10's third criterion again: the drill-down still adds up to the report. */
  it('leaves the ledger’s filter total agreeing with the report, and says how many moved', async () => {
    const db = await withBroker()
    insertRows(db, declare(db, INVESTMENT), [{ name: 'Index fund', transaction: 'broker' }])

    const ledger = summarizeTransactions(db, { from: localDate(2026, 6, 1), to: localDate(2026, 6, 30) })
    const categories = categoryObservations(db, JUNE)

    expect(ledger.moved).toBe(1)
    expect(ledger.count).toBe(3)
    expect(ledger.totals[0]?.outflowMinor).toBe(100_00)
    expect(categories.reduce((running, one) => running + one.outflow.minor, 0)).toBe(100_00)
  })
})

/**
 * **A category on the Money moved tab is moved, not spent** (M28 F4, D-316).
 * The tab is every kind but EXPENSE and INCOME, and the totals read the same list.
 */
describe('a Money moved category is moved (M28 F4, D-316)', () => {
  async function withKinds(): Promise<{ db: Database; ids: Record<string, string> }> {
    const db = await withAccount()
    const ids = {
      investments: createCategory(db, { name: 'Brokerage', kind: 'SAVING' }, NOW),
      transfer: createCategory(db, { name: 'Between mine', kind: 'TRANSFER' }, NOW),
      food: createCategory(db, { name: 'Eating', kind: 'EXPENSE' }, NOW),
    }
    return { db, ids }
  }

  it('saves a transaction filed under a Money moved category and leaves it out of went out', async () => {
    const { db, ids } = await withKinds()
    insertTransaction(db, row({ id: 'food', amount: ils(-100_00) }), NOW)
    insertTransaction(db, row({ id: 'buy', amount: ils(-3_000_00), merchantRaw: 'Broker', merchantNormalized: 'Broker' }), NOW)
    setCategoryManually(db, 'food', ids.food, NOW)
    setCategoryManually(db, 'buy', ids.investments, NOW)

    const june = monthObservations(db, AS_OF)[0]
    if (june === undefined) throw new Error('no June')

    expect(june.outflow).toEqual(ils(100_00))
    expect(june.moved).toEqual(ils(3_000_00))
    expect(monthSummary(june).saved).toEqual(ils(3_000_00))
    expect(categoryObservations(db, { year: 2026, month: 6 }).map((one) => one.name)).toEqual(['Eating'])
    expect(movedLines(db, '2026-06', 'ILS')).toEqual([
      { categoryId: ids.investments, name: 'Brokerage', netMinor: 3_000_00, transactionCount: 1 },
    ])
  })

  it('nets money coming back from a Money moved category against what went in', async () => {
    const { db, ids } = await withKinds()
    insertTransaction(db, row({ id: 'buy', amount: ils(-3_000_00) }), NOW)
    insertTransaction(db, row({ id: 'sale', amount: ils(500_00), direction: 'INFLOW' }), NOW)
    setCategoryManually(db, 'buy', ids.investments, NOW)
    setCategoryManually(db, 'sale', ids.investments, NOW)

    const june = monthObservations(db, AS_OF)[0]

    expect(june?.moved).toEqual(ils(2_500_00))
    expect(june?.inflow).toEqual(ils(0))
    expect(june?.outflow).toEqual(ils(0))
  })

  it('does not count a row the ledger already leaves out, such as a card bill', async () => {
    const { db, ids } = await withKinds()
    insertTransaction(db, row({ id: 'bill', amount: ils(-900_00) }), NOW)
    setCategoryManually(db, 'bill', ids.transfer, NOW)
    setExcludedFromStats(db, 'bill', true, NOW)

    const june = monthObservations(db, AS_OF)[0]

    expect(june?.moved ?? ils(0)).toEqual(ils(0))
    expect(movedLines(db, '2026-06', 'ILS')).toEqual([])
  })

  it('keeps a loan payment spent: part of it is interest (F6, amends D-316)', async () => {
    const { db } = await withKinds()
    const loan = createCategory(db, { name: 'Loan', kind: 'DEBT_PAYMENT' }, NOW)
    insertTransaction(db, row({ id: 'pay', amount: ils(-1_200_00) }), NOW)
    setCategoryManually(db, 'pay', loan, NOW)

    const june = monthObservations(db, AS_OF)[0]

    expect(june?.outflow).toEqual(ils(1_200_00))
    expect(june?.moved ?? ils(0)).toEqual(ils(0))
    expect(movedLines(db, '2026-06', 'ILS')).toEqual([])
    expect(isMovedKind('DEBT_PAYMENT')).toBe(false)
  })

  it('still moves a lone Internal Transfer leg', async () => {
    const { db, ids } = await withKinds()
    insertTransaction(db, row({ id: 'leg', amount: ils(-700_00) }), NOW)
    setCategoryManually(db, 'leg', ids.transfer, NOW)

    const june = monthObservations(db, AS_OF)[0]

    expect(june?.moved).toEqual(ils(700_00))
    expect(june?.outflow).toEqual(ils(0))
    expect(isMovedKind('TRANSFER')).toBe(true)
  })

  it('counts a row once when a declared format links it and it is filed under Money moved', async () => {
    const { db, ids } = await withKinds()
    insertTransaction(db, row({ id: 'buy', amount: ils(-3_000_00) }), NOW)
    setCategoryManually(db, 'buy', ids.investments, NOW)
    const parsed = read(
      `---
format: owned
title: Owned
language: 14
checks: none
---

A thing I own.

| column | type | points at | unit | per | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| name | text |  |  |  | yes | no |  |  |  |  |
| transaction | link | transaction |  |  | no | no |  |  |  |  |
`,
      undefined,
      listFormats(db),
    )
    if (!parsed.ok) throw new Error(parsed.error)
    expect(adoptFormat(db, parsed.value, NOW).refusals).toEqual([])
    insertRows(db, parsed.value, [{ name: 'Fund', transaction: 'buy' }])

    const june = monthObservations(db, AS_OF)[0]

    expect(june?.moved).toEqual(ils(3_000_00))
    expect(movedLines(db, '2026-06', 'ILS')[0]?.transactionCount).toBe(1)
    expect(summarizeTransactions(db, {}).moved).toBe(1)
  })
})

/**
 * M30 F1, from a real June: Saved said more than what moved, and Home
 * could not say where the rest came from — it was the payslip's saving lines,
 * which Saved has always counted and nothing on the page listed.
 */
describe('where saved came from (M30 F1)', () => {
  it('lists what moved, the slip lines and the goal deposits, and they add to saved', async () => {
    const db = await withAccount()
    const transfer = createCategory(db, { name: 'To the broker', kind: 'TRANSFER' }, NOW)
    insertTransaction(db, row({ id: 'move', amount: ils(-5_000_00) }), NOW)
    setCategoryManually(db, 'move', transfer, NOW)

    const pension = createDeductionType(db, { name: 'Pension plan', kind: 'PENSION', countsAsSaving: true }, NOW)
    const tax = createDeductionType(db, { name: 'A tax of its own', kind: 'TAX', countsAsSaving: false }, NOW)
    createPaycheck(
      db,
      {
        period: { year: 2026, month: 6 },
        paymentDate: localDate(2026, 7, 1),
        gross: ils(20_000_00),
        net: ils(14_000_00),
        lines: [
          { deductionTypeId: pension.id, employeeAmount: ils(800_00), employerAmount: ils(900_00) },
          { deductionTypeId: tax.id, employeeAmount: ils(3_000_00) },
        ],
      },
      NOW,
    )

    const place = createHoldingPlace(db, { name: 'Box', kind: 'CHECKING' }, NOW)
    const holding = createHolding(
      db,
      { holdingPlaceId: place.id, name: 'Cash', kind: 'CASH', provenance: 'RECORDED', isLiquid: true },
      NOW,
    )
    const goal = createGoal(db, { name: 'Trip', kind: 'SHORT_TERM' }, NOW)
    addDeposit(db, { goalId: goal.id, holdingId: holding.id, date: localDate(2026, 6, 10), amount: ils(300_00) }, NOW)
    // Growth is not this month's saving, and so is not one of its parts either.
    addDeposit(db, { goalId: goal.id, holdingId: holding.id, date: localDate(2026, 6, 30), amount: ils(7_00), sourceKind: 'GROWTH' }, NOW)

    const report = monthlyReport(db, { year: 2026, month: 6 }, AS_OF)

    expect(report.moved.map((one) => one.netMinor)).toEqual([5_000_00])
    expect(report.savedFrom.slips).toEqual([{ deductionTypeId: pension.id, name: 'Pension plan', amount: ils(800_00) }])
    expect(report.savedFrom.goals).toEqual([{ goalId: goal.id, name: 'Trip', amount: ils(300_00), count: 1 }])
    const parts =
      report.moved.reduce((total, one) => total + one.netMinor, 0) +
      report.savedFrom.slips.reduce((total, one) => total + one.amount.minor, 0) +
      report.savedFrom.goals.reduce((total, one) => total + one.amount.minor, 0)
    expect(report.summary?.saved).toEqual(ils(parts))
  })

  it('does not list a deposit a payslip made, as saved does not count it twice', async () => {
    const db = await withAccount()
    const place = createHoldingPlace(db, { name: 'Bank', kind: 'CHECKING' }, NOW)
    const holding = createHolding(
      db,
      { holdingPlaceId: place.id, name: 'Cash', kind: 'CASH', provenance: 'RECORDED', isLiquid: true },
      NOW,
    )
    const goal = createGoal(db, { name: 'Top-up', kind: 'RETIREMENT', defaultHoldingId: holding.id }, NOW)
    const type = createDeductionType(
      db,
      { name: 'Pension plan', kind: 'PENSION', countsAsSaving: true, linkedSavingGoalId: goal.id },
      NOW,
    )
    createPaycheck(
      db,
      {
        period: { year: 2026, month: 6 },
        paymentDate: localDate(2026, 7, 1),
        gross: ils(20_000_00),
        net: ils(14_000_00),
        lines: [{ deductionTypeId: type.id, employeeAmount: ils(1_200_00) }],
      },
      NOW,
    )

    const report = monthlyReport(db, { year: 2026, month: 6 }, AS_OF)

    expect(report.savedFrom.goals).toEqual([])
    expect(report.savedFrom.slips.map((one) => one.amount)).toEqual([ils(1_200_00)])
    expect(report.summary?.saved).toEqual(ils(1_200_00))
  })
})

/** M30 F1: a bank row that pays a card was still one of Home's biggest charges. */
describe('largestCharges (M30 F1)', () => {
  it('lists only rows went out counts: not one that pays a card, nor money moved, nor a buy where things are held', async () => {
    const db = await withAccount()
    const transfer = createCategory(db, { name: 'Between mine', kind: 'TRANSFER' }, NOW)
    const broker = createAccount(db, { name: 'Broker', kind: 'HOLDINGS' }, NOW)
    insertTransaction(db, row({ id: 'card-bill', amount: ils(-9_000_00) }), NOW)
    setExcludedFromStats(db, 'card-bill', true, NOW)
    insertTransaction(db, row({ id: 'moved', amount: ils(-8_000_00) }), NOW)
    setCategoryManually(db, 'moved', transfer, NOW)
    insertTransaction(db, row({ id: 'buy', accountId: broker.id, amount: ils(-7_000_00) }), NOW)
    insertTransaction(db, row({ id: 'rent', amount: ils(-4_000_00) }), NOW)
    insertTransaction(db, row({ id: 'food', amount: ils(-100_00) }), NOW)
    insertTransaction(db, row({ id: 'refund', amount: ils(50_00), direction: 'INFLOW' }), NOW)
    insertTransaction(db, row({ id: 'july', amount: ils(-6_000_00), transactionDate: localDate(2026, 7, 2) }), NOW)

    expect(largestCharges(db, { year: 2026, month: 6 }, 5).map((one) => one.id)).toEqual(['rent', 'food'])
    expect(largestCharges(db, { year: 2026, month: 6 }, 1).map((one) => one.id)).toEqual(['rent'])
  })
})
