import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { money, type Money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import {
  effectiveTaxRateBasisPoints,
  employerTotal,
  payrollSavings,
  reconciliationDelta,
  taxTotal,
  totalCompensation,
} from '@/domain/paycheck.ts'
import { createDebt, addPayment, debtDetail, debtsSummary } from '../../repositories/debtRepository.ts'
import { listDeductionTypes } from '../../repositories/deductionTypeRepository.ts'
import { addSnapshot, createFund, latestSnapshot } from '../../repositories/fundRepository.ts'
import { createPaycheck, findPaycheck } from '../../repositories/paycheckRepository.ts'
import {
  addDeposit,
  createGoal,
  createHolding,
  createHoldingPlace,
  goalDetail,
} from '../../repositories/savingsRepository.ts'
import { priceCheck } from '../../repositories/holdingReadingRepository.ts'
import { adoptFormat, readFormat } from '../../repositories/formatRepository.ts'
import { parseRollup } from '@/domain/format/rollup.ts'
import { installLedgerPack } from './pack.ts'
import { createLedgerDatabase } from './testing.ts'

/**
 * **The ledger reads the figures it declares** (M36 U03) — pinned before and
 * after. Every figure here is what the ledger's own TypeScript sums said on this
 * synthetic document before they were deleted; the declared totals and worked-out
 * columns that replaced them must say the same, to the agora.
 */
const ils = (minor: number): Money => money(minor, 'ILS')
const usd = (minor: number): Money => money(minor, 'USD')
const NOW = 1_000
const FROM = { year: 2026, month: 7 }

async function withDebts(): Promise<{ db: Database; ids: Record<string, string> }> {
  const db = await createLedgerDatabase()
  const debt = (name: string, principal: number): string =>
    createDebt(
      db,
      { name, kind: 'PERSONAL', principalAmount: ils(principal), openedDate: localDate(2026, 1, 1), tracking: { kind: 'NONE' } },
      NOW,
    ).id
  const loan = debt('Loan', 1_000_000)
  addPayment(db, { debtId: loan, date: localDate(2026, 2, 1), amount: ils(100_000), interestPortion: ils(15_000) }, NOW)
  addPayment(
    db,
    { debtId: loan, date: localDate(2026, 3, 1), amount: ils(100_000), interestPortion: ils(12_000), isConfirmed: false },
    NOW,
  )
  addPayment(db, { debtId: loan, date: localDate(2026, 4, 1), amount: ils(50_000) }, NOW)
  const untouched = debt('Untouched', 100_000)
  const overpaid = debt('Overpaid', 50_000)
  addPayment(db, { debtId: overpaid, date: localDate(2026, 2, 1), amount: ils(60_000) }, NOW)
  return { db, ids: { loan, untouched, overpaid } }
}

describe('a debt’s figures', () => {
  it('are the same figures the sums said', async () => {
    const { db, ids } = await withDebts()
    const balance = (id: string) => {
      const found = debtDetail(db, id, FROM)?.balance
      if (found === undefined) throw new Error('no debt')
      return found
    }
    expect(balance(ids.loan ?? '')).toMatchObject({
      principal: ils(1_000_000),
      principalPaid: ils(223_000),
      interestPaid: ils(27_000),
      totalPaid: ils(250_000),
      outstanding: ils(777_000),
      unconfirmedPrincipal: ils(88_000),
      unconfirmedCount: 1,
      progressBasisPoints: 2_230,
      overpaidBy: undefined,
      isSettled: false,
    })
    expect(balance(ids.untouched ?? '')).toMatchObject({
      principalPaid: ils(0),
      totalPaid: ils(0),
      interestPaid: ils(0),
      outstanding: ils(100_000),
      unconfirmedPrincipal: ils(0),
      unconfirmedCount: 0,
      progressBasisPoints: 0,
      isSettled: false,
    })
    expect(balance(ids.overpaid ?? '')).toMatchObject({
      principalPaid: ils(60_000),
      outstanding: ils(-10_000),
      overpaidBy: ils(10_000),
      progressBasisPoints: 10_000,
      isSettled: true,
    })

    const summary = debtsSummary(db, FROM, { currency: 'ILS' })
    expect(summary).toMatchObject({
      totalPrincipal: ils(1_150_000),
      totalOutstanding: ils(877_000),
      totalPaid: ils(310_000),
      unconfirmedCount: 1,
      openCount: 3,
      settledButOpenCount: 1,
    })
  })
})

async function withGoal(): Promise<{ db: Database; goal: string }> {
  const db = await createLedgerDatabase()
  const place = createHoldingPlace(db, { name: 'Bank', kind: 'DEPOSIT' }, NOW).id
  const holding = (name: string, isLiquid: boolean): string =>
    createHolding(db, { holdingPlaceId: place, name, kind: 'CASH', provenance: 'RECORDED', isLiquid }, NOW).id
  const cash = holding('Cash', true)
  const locked = holding('Deposit', false)
  const goal = createGoal(db, { name: 'House', kind: 'LONG_TERM', targetAmount: ils(1_000_000) }, NOW).id
  const deposit = (holdingId: string, minor: number, sourceKind?: 'OPENING_BALANCE' | 'GROWTH', day = 1): void => {
    addDeposit(db, { goalId: goal, date: localDate(2026, 2, day), amount: ils(minor), holdingId, sourceKind }, NOW)
  }
  deposit(cash, 200_000, 'OPENING_BALANCE')
  deposit(locked, 300_000, undefined, 2)
  deposit(cash, -50_000, undefined, 3)
  deposit(locked, 10_000, 'GROWTH', 4)
  return { db, goal }
}

describe('a goal’s figures', () => {
  it('are the same figures the sums said', async () => {
    const { db, goal } = await withGoal()
    const detail = goalDetail(db, goal, localDate(2026, 7, 1), 'ILS')
    expect(detail).toMatchObject({
      balance: ils(460_000),
      progressBalance: ils(460_000),
      openingBalance: ils(200_000),
      contributed: ils(300_000),
      withdrawn: ils(-50_000),
      growth: ils(10_000),
      liquid: ils(150_000),
      locked: ils(310_000),
      progressBasisPoints: 4_600,
      depositCount: 4,
    })
  })
})

describe('a payslip’s figures', () => {
  it('are the same figures the sums said', async () => {
    const db = await createLedgerDatabase()
    const id = createPaycheck(
      db,
      {
        period: { year: 2026, month: 6 },
        paymentDate: localDate(2026, 7, 9),
        gross: ils(1_000_000),
        net: ils(700_000),
        lines: [
          { deductionTypeId: 'ded:income-tax', employeeAmount: ils(150_000) },
          { deductionTypeId: 'ded:pension', employeeAmount: ils(60_000), employerAmount: ils(65_000) },
          { deductionTypeId: 'ded:study-fund', employeeAmount: ils(25_000), employerAmount: ils(75_000) },
        ],
      },
      NOW,
    ).paycheck.id
    const entry = findPaycheck(db, id)
    if (entry === undefined) throw new Error('no slip')
    const types = listDeductionTypes(db)
    expect(reconciliationDelta(entry, types)).toEqual(ils(65_000))
    expect(payrollSavings(entry, types)).toEqual({ employee: ils(85_000), employer: ils(140_000), total: ils(225_000) })
    // M36 U04: the employer's side and the tax, now that a total can say
    // `is not empty` and `is one of` — read, and the same as the sums.
    expect(entry.figures).toMatchObject({ employerPaid: ils(140_000), tax: ils(150_000), compensation: ils(1_140_000) })
    expect(entry.figures?.taxRate).toBeCloseTo(0.15, 12)
    expect(employerTotal(entry)).toEqual(ils(140_000))
    expect(totalCompensation(entry)).toEqual(ils(1_140_000))
    expect(taxTotal(entry, types)).toEqual(ils(150_000))
    expect(effectiveTaxRateBasisPoints(entry, types)).toBe(1_500)
    const draft = { ...entry, figures: undefined }
    expect([employerTotal(draft), taxTotal(draft, types), effectiveTaxRateBasisPoints(draft, types)]).toEqual([
      ils(140_000),
      ils(150_000),
      1_500,
    ])
  })
})

describe('a fund’s balance', () => {
  it('is its latest reading', async () => {
    const db = await createLedgerDatabase()
    const fund = createFund(db, { name: 'Pension', fundType: 'PENSION' }, NOW).id
    addSnapshot(db, { fundAccountId: fund, asOfDate: localDate(2026, 3, 31), totalBalance: ils(5_000_000) }, NOW)
    addSnapshot(db, { fundAccountId: fund, asOfDate: localDate(2026, 6, 30), totalBalance: ils(5_200_000) }, NOW)
    addSnapshot(db, { fundAccountId: fund, asOfDate: localDate(2026, 1, 31), totalBalance: ils(4_900_000) }, NOW)
    expect(latestSnapshot(db, fund)).toMatchObject({ totalBalance: ils(5_200_000) })
    const empty = createFund(db, { name: 'Study', fundType: 'STUDY_FUND' }, NOW).id
    expect(latestSnapshot(db, empty)).toBeUndefined()
  })
})

describe('what changes, on purpose', () => {
  it('a debt with a payment in another currency is unchecked, never a smaller figure (D-349)', async () => {
    const { db, ids } = await withDebts()
    const loan = ids.loan ?? ''
    addPayment(db, { debtId: loan, date: localDate(2026, 5, 1), amount: usd(10_000) }, NOW)
    expect(debtDetail(db, loan, FROM)?.balance).toMatchObject({ kind: 'UNCHECKED', unconfirmedCount: 1 })
    const summary = debtsSummary(db, FROM, { currency: 'ILS' })
    expect(summary.unchecked.map((debt) => debt.name)).toEqual(['Loan'])
    expect(summary.totalOutstanding).toEqual(ils(100_000))
  })

  it('a goal with deposits in two currencies is unchecked', async () => {
    const { db, goal } = await withGoal()
    const holding = goalDetail(db, goal, localDate(2026, 7, 1), 'ILS')?.deposits[0]?.holdingId ?? ''
    addDeposit(db, { goalId: goal, date: localDate(2026, 3, 1), amount: usd(10_000), holdingId: holding }, NOW)
    expect(goalDetail(db, goal, localDate(2026, 7, 1), 'ILS')?.unchecked).toBeDefined()
  })

  it('a reading’s price is held to 0.1% of quantity × price, where it was one whole unit or 0.1%', async () => {
    const db = await createLedgerDatabase()
    // One unit at ₪100.00, printed as ₪100.05: within 0.1%.
    expect(priceCheck(db, 1_000_000, 100_000_000, ils(100_05)).kind).toBe('PROVED')
    // Printed as ₪100.50: one whole unit allowed it before; 0.1% does not.
    expect(priceCheck(db, 1_000_000, 100_000_000, ils(100_50))).toMatchObject({ kind: 'FAILED', ours: ils(100_00) })
    // A large holding keeps its 0.1%: ₪250,000 off by ₪200.
    expect(priceCheck(db, 2_500_000_000, 100_000_000, ils(250_200_00)).kind).toBe('PROVED')
  })
})

describe('a document made before the pack declared these figures', () => {
  it('takes them on its next install, and reads them', async () => {
    const { db, ids } = await withDebts()
    const strip = (name: string): void => {
      const held = readFormat(db, name)
      if (held === undefined) throw new Error(`no ${name}`)
      const plan = adoptFormat(db, { ...held, aggregates: [], derived: [] }, NOW)
      if (plan.refusals.length > 0) throw new Error(plan.refusals.map((one) => one.detail).join(' '))
    }
    strip('debt')
    strip('debt_payment')
    expect(readFormat(db, 'debt')?.derived ?? []).toEqual([])
    const installed = installLedgerPack(db, NOW)
    expect(installed.ok).toBe(true)
    expect(debtDetail(db, ids.loan ?? '', FROM)?.balance).toMatchObject({ outstanding: ils(777_000) })
  })

  it('takes the reworded spending rule and the settlement’s column (M36 U04)', async () => {
    const db = await createLedgerDatabase()
    const held = readFormat(db, 'transaction')
    if (held === undefined) throw new Error('no transaction')
    const older = parseRollup(
      'spending',
      'sum of amount by month of charge_date or transaction_date and category where direction is OUTFLOW and is_excluded_from_stats is false',
    )
    if (!older.ok) throw new Error(older.error)
    const plan = adoptFormat(
      db,
      { ...held, language: 13, columns: held.columns.filter((one) => one.name !== 'counted_on_card'), rollups: [older.value] },
      NOW,
    )
    expect(plan.refusals).toEqual([])
    expect(installLedgerPack(db, NOW).ok).toBe(true)
    const now = readFormat(db, 'transaction')
    expect(now?.columns.some((one) => one.name === 'counted_on_card')).toBe(true)
    expect(now?.rollups?.[0]?.where.map((one) => one.column)).toContain('category.kind')
  })
})
