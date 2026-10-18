/**
 * M28 F8 (D-322): the July/September report, reproduced on a synthetic
 * document with a plan and fixed expenses spanning July to September.
 */
import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { outsideMonthReason } from '@/domain/fixedExpenses.ts'
import { createAccount } from './accountRepository.ts'
import { createCategory, setCategoryManually } from './categoryRepository.ts'
import { createFixedExpense } from './fixedExpenseRepository.ts'
import { setRoles } from './planFixedRepository.ts'
import { planAgainstActual, planMonth, removePlanBuckets } from './planMonthRepository.ts'
import {
  createSplitBucket,
  createSplitPlan,
  deleteSplitPlan,
  findSplitPlan,
  listSplitBuckets,
  listSplitPlans,
} from './splitPlanRepository.ts'
import { monthlyReport } from './statisticsRepository.ts'
import type { InsertableTransaction } from './transactionRepository.ts'

const ILS = 'ILS'
const ils = (minor: number) => money(minor, ILS)
const NOW = 1_790_000_000_000
const ASOF = localDate(2026, 10, 3)

function charge(id: string, merchant: string, minor: number, month: number): InsertableTransaction {
  return {
    id,
    accountId: 'acc',
    transactionDate: localDate(2026, month, 5),
    chargeDate: undefined,
    billingPeriod: undefined,
    amount: ils(-minor),
    direction: 'OUTFLOW',
    merchantRaw: merchant,
    merchantNormalized: merchant,
    providerCategory: undefined,
    cardLast4: undefined,
    reference: undefined,
    note: undefined,
    installment: undefined,
    foreign: undefined,
    naturalKey: id,
    importSessionId: undefined,
    sourceRowRef: undefined,
  }
}

/** A plan over July to September; Internet starts in August, Rent in January. */
async function synthetic() {
  const db: Database = await createLedgerDatabase()
  createAccount(db, { name: 'Bank', kind: 'BANK', last4: '1111' }, NOW)
  db.run("UPDATE fmt_account SET id = 'acc' WHERE last4 = '1111'")

  const rent = createFixedExpense(
    db,
    {
      name: 'Rent',
      matchKind: 'MERCHANT_PATTERN',
      matchRef: 'landlord',
      expectedAmount: ils(520_000),
      startedAt: localDate(2026, 1, 1),
    },
    NOW,
  )
  const internet = createFixedExpense(
    db,
    {
      name: 'Internet',
      matchKind: 'MERCHANT_PATTERN',
      matchRef: 'isp',
      expectedAmount: ils(15_000),
      startedAt: localDate(2026, 8, 10),
    },
    NOW,
  )
  const gym = createFixedExpense(
    db,
    { name: 'Gym', matchKind: 'MANUAL_ONLY', expectedAmount: ils(30_000), startedAt: localDate(2026, 1, 1) },
    NOW,
  )

  const groceriesId = createCategory(db, { name: 'Food shop', kind: 'EXPENSE' }, NOW)
  const brokerId = createCategory(db, { name: 'Broker', kind: 'SAVING' }, NOW)

  for (const month of [7, 8, 9]) {
    insertTransaction(db, charge(`rent-${String(month)}`, 'landlord', 520_000, month), NOW)
    insertTransaction(db, charge(`food-${String(month)}`, 'shop', 80_000 + month * 1_000, month), NOW)
    setCategoryManually(db, `food-${String(month)}`, groceriesId, NOW)
  }
  for (const month of [8, 9]) insertTransaction(db, charge(`isp-${String(month)}`, 'isp', 15_000, month), NOW)
  insertTransaction(db, charge('broker-9', 'broker', 200_000, 9), NOW)
  setCategoryManually(db, 'broker-9', brokerId, NOW)

  const food = createSplitBucket(db, { name: 'Food', targetKind: 'CATEGORY', targetId: groceriesId }, NOW)
  const invest = createSplitBucket(db, { name: 'Investing', targetKind: 'CATEGORY', targetId: brokerId }, NOW)
  const spare = createSplitBucket(db, { name: 'Spare', targetKind: 'FREE' }, NOW)
  const plan = createSplitPlan(
    db,
    {
      name: 'Everyday',
      currency: ILS,
      isDefault: true,
      basisKind: 'CUSTOM_AMOUNT',
      customAmount: ils(2_000_000),
      allocations: [
        { bucketId: food.id, mode: 'PERCENTAGE', basisPoints: 2000 },
        { bucketId: invest.id, mode: 'PERCENTAGE', basisPoints: 1000 },
        { bucketId: spare.id, mode: 'PERCENTAGE', basisPoints: 500 },
      ],
    },
    NOW,
  )
  setRoles(db, [
    { planId: plan.id, fixedExpenseId: rent.id, role: 'NET' },
    { planId: plan.id, fixedExpenseId: internet.id, role: 'SPLIT' },
    { planId: plan.id, fixedExpenseId: gym.id, role: 'NET' },
  ])
  return { db, rent, internet, gym, plan, food, invest, spare }
}

const at = (month: number) => ({ year: 2026, month })

describe('a role is per plan and a month is not (D-322, cause of the July report)', () => {
  it('leaves a bill that has not started out of July and says so, and counts it from August', async () => {
    const { db, internet, plan } = await synthetic()

    const july = planMonth(db, { planId: plan.id, month: at(7), asOf: ASOF, readings: false })
    const september = planMonth(db, { planId: plan.id, month: at(9), asOf: ASOF, readings: false })

    // The switch still says Part of the split (the plan's own choice) ...
    expect(july?.roles.get(internet.id)).toBe('SPLIT')
    // ... the picture leaves it out, but no longer silently: it is listed with its reason.
    expect(july?.parts.inSplit.minor).toBe(0)
    expect(july?.parts.outsideMonth.map((one) => one.name)).toEqual(['Internet'])
    expect(outsideMonthReason(internet, at(7))).toBe('NOT_STARTED')

    expect(september?.parts.inSplit.minor).toBe(15_000)
    expect(september?.parts.outsideMonth).toEqual([])
    // The bills that run in both months agree in both.
    expect(july?.parts.netOff.minor).toBe(september?.parts.netOff.minor)
  })

  it('counts a bill in the month it starts: the plan for August is about August', async () => {
    const { db, plan } = await synthetic()
    const august = planMonth(db, { planId: plan.id, month: at(8), asOf: ASOF, readings: false })
    expect(august?.parts.inSplit.minor).toBe(15_000)
  })
})

describe('plan against what happened (D-322, cause of "compare does nothing")', () => {
  it('compares each bucket and each fixed expense for September', async () => {
    const { db, plan, food, invest, spare, rent, internet, gym } = await synthetic()
    const pm = planMonth(db, { planId: plan.id, month: at(9), asOf: ASOF, readings: false })
    if (pm === undefined) throw new Error('no plan')
    const against = planAgainstActual(db, pm, at(9), ASOF)

    expect(against.nothing).toBeUndefined()
    const line = (id: string) => against.versus.lines.find((one) => one.bucket.id === id)
    expect(line(food.id)?.actual?.minor).toBe(89_000)
    // A category on the Money moved tab is measured by what moved (D-316).
    expect(line(invest.id)?.actual?.minor).toBe(200_000)
    expect(line(spare.id)?.verdict).toBe('NO_BASIS')

    const fixed = (id: string) => against.fixed.find((one) => one.expenseId === id)
    expect(fixed(rent.id)).toMatchObject({ status: 'CHARGED', role: 'NET', transactionCount: 1 })
    expect(fixed(rent.id)?.planned?.minor).toBe(520_000)
    expect(fixed(rent.id)?.actual?.minor).toBe(520_000)
    expect(fixed(internet.id)?.role).toBe('SPLIT')
    expect(fixed(internet.id)?.actual?.minor).toBe(15_000)
    expect(fixed(gym.id)?.status).toBe('NOT_TRACKED')
    expect(against.fixedPlanned.minor).toBe(535_000)
    expect(against.fixedActual.minor).toBe(535_000)
  })

  it('leaves a bill that had not started out of the comparison for that month', async () => {
    const { db, plan, internet } = await synthetic()
    const pm = planMonth(db, { planId: plan.id, month: at(7), asOf: ASOF, readings: false })
    if (pm === undefined) throw new Error('no plan')
    const against = planAgainstActual(db, pm, at(7), ASOF)
    expect(against.fixed.some((one) => one.expenseId === internet.id)).toBe(false)
  })

  it('says a month nobody imported is unknown, not zero', async () => {
    const { db, plan } = await synthetic()
    const pm = planMonth(db, { planId: plan.id, month: at(12), asOf: ASOF, readings: false })
    if (pm === undefined) throw new Error('no plan')
    const against = planAgainstActual(db, pm, at(12), ASOF)
    expect(against.ledgerHasMonth).toBe(false)
    expect(against.nothing).toMatch(/no statement has been imported for 2026-12/)
  })

  it('marks a due bill nothing matched in a month that has statements', async () => {
    const { db, plan, rent } = await synthetic()
    insertTransaction(db, charge('late-10', 'cafe', 1_000, 10), NOW)
    const pm = planMonth(db, { planId: plan.id, month: at(10), asOf: ASOF, readings: false })
    if (pm === undefined) throw new Error('no plan')
    const against = planAgainstActual(db, pm, at(10), ASOF)
    expect(against.fixed.find((one) => one.expenseId === rent.id)?.status).toBe('NOT_CHARGED')
    expect(against.nothing).toBeUndefined()
  })

  it('names the reasons when no bucket is measurable and no bill is due', async () => {
    const db = await createLedgerDatabase()
    createAccount(db, { name: 'Bank', kind: 'BANK', last4: '1111' }, NOW)
    db.run("UPDATE fmt_account SET id = 'acc' WHERE last4 = '1111'")
    const free = createSplitBucket(db, { name: 'Spare', targetKind: 'FREE' }, NOW)
    const plan = createSplitPlan(
      db,
      {
        name: 'Plain',
        currency: ILS,
        isDefault: true,
        basisKind: 'CUSTOM_AMOUNT',
        customAmount: ils(1_000_000),
        allocations: [{ bucketId: free.id, mode: 'PERCENTAGE', basisPoints: 1000 }],
      },
      NOW,
    )
    insertTransaction(db, charge('x-9', 'cafe', 1_000, 9), NOW)
    const pm = planMonth(db, { planId: plan.id, month: at(9), asOf: ASOF, readings: false })
    if (pm === undefined) throw new Error('no plan')
    const against = planAgainstActual(db, pm, at(9), ASOF)
    expect(against.nothing).toMatch(/Nothing to compare for 2026-09/)
    expect(against.nothing).toMatch(/no tracked bill/)
    expect(against.nothing).toMatch(/no bucket is for a category/)
  })
})

describe('Home splits went out into fixed expenses and the rest (D-322)', () => {
  it('fixed plus everything else is exactly went out', async () => {
    const { db } = await synthetic()
    const report = monthlyReport(db, at(9), ASOF)
    const wentOut = report.summary?.expenses.minor ?? -1
    expect(report.split.fixed.minor).toBe(535_000)
    expect(report.split.variable.minor).toBe(89_000)
    expect(report.split.fixed.minor + report.split.variable.minor).toBe(wentOut)
  })
})

describe('removing a bucket hands its share to the right (D-322)', () => {
  it('gives it to the next bucket in its own unit, and deletes a bucket no plan uses', async () => {
    const { db, plan, food, invest, spare } = await synthetic()
    const result = removePlanBuckets(db, plan.id, [food.id], at(9), ASOF, NOW)
    expect(result.removed).toEqual([food.id])
    expect(result.deleted).toEqual([food.id])

    const loaded = findSplitPlan(db, plan.id)
    expect(new Map(loaded?.allocations.map((one) => [one.bucketId, one.basisPoints]))).toEqual(
      new Map([
        [invest.id, 3000],
        [spare.id, 500],
      ]),
    )
    expect(listSplitBuckets(db).some((one) => one.id === food.id)).toBe(false)
  })

  it('gives the last bucket back to the money not given a job, and keeps a bucket another plan uses', async () => {
    const { db, plan, spare } = await synthetic()
    createSplitPlan(
      db,
      { name: 'Other', currency: ILS, allocations: [{ bucketId: spare.id, mode: 'PERCENTAGE', basisPoints: 100 }] },
      NOW,
    )
    const result = removePlanBuckets(db, plan.id, [spare.id], at(9), ASOF, NOW)
    expect(result.deleted).toEqual([])
    const loaded = findSplitPlan(db, plan.id)
    expect(loaded?.allocations.map((one) => one.basisPoints).sort()).toEqual([1000, 2000])
    expect(listSplitBuckets(db).some((one) => one.id === spare.id)).toBe(true)
  })
})

describe('deleting the default plan (D-322)', () => {
  it('makes another plan the default, and leaves none when it was the only one', async () => {
    const { db, plan } = await synthetic()
    createSplitPlan(db, { name: 'Zeta', currency: ILS }, NOW)
    deleteSplitPlan(db, plan.id, NOW)
    const left = listSplitPlans(db)
    expect(left.map((one) => [one.name, one.isDefault])).toEqual([['Zeta', true]])
    deleteSplitPlan(db, left[0]?.id ?? '', NOW)
    expect(listSplitPlans(db)).toEqual([])
  })
})
