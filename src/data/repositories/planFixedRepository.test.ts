import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'

import { money } from '@/core/money.ts'
import { fixedPlanParts } from '@/domain/fixedExpenses.ts'
import { adoptFormat, readFormat } from './formatRepository.ts'
import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { installLedgerPack } from '@/data/packs/ledger/pack.ts'
import { createFixedExpense, deleteFixedExpense, listFixedExpenses } from './fixedExpenseRepository.ts'
import { createFund, deleteFund } from './fundRepository.ts'
import { planMonth } from './planMonthRepository.ts'
import {
  listAllRoles,
  listRoles,
  removePlanRoles,
  setRoles,
} from './planFixedRepository.ts'
import {
  createSplitBucket,
  createSplitPlan,
  deleteSplitPlan,
  duplicateSplitPlan,
  listSplitBuckets,
  updateSplitBucket,
  updateSplitPlan,
} from './splitPlanRepository.ts'

const ILS = 'ILS'
const NOW = 1_790_000_000_000
const AS_OF = { year: 2026, month: 10, day: 3 }
const MONTH = { year: 2026, month: 10 }

function bill(db: Database, name: string, minor: number, extra: Partial<Parameters<typeof createFixedExpense>[1]> = {}) {
  return createFixedExpense(
    db,
    {
      name,
      matchKind: 'MANUAL_ONLY',
      expectedAmount: money(minor, ILS),
      cadence: 'MONTHLY',
      startedAt: { year: 2026, month: 1, day: 1 },
      ...extra,
    },
    1,
  )
}

async function ledger(): Promise<Database> {
  return createLedgerDatabase()
}

describe('what a fixed expense does to a plan', () => {
  it('keeps one role per plan and expense, and changes it in place', async () => {
    const db = await ledger()
    const plan = createSplitPlan(db, { name: 'A', currency: ILS, isDefault: true }, 1)
    const rent = bill(db, 'Rent', 500_000)

    expect(listRoles(db, plan.id).size).toBe(0)
    setRoles(db, [{ planId: plan.id, fixedExpenseId: rent.id, role: 'NET' }])
    setRoles(db, [{ planId: plan.id, fixedExpenseId: rent.id, role: 'SPLIT' }])

    expect(listRoles(db, plan.id).get(rent.id)).toBe('SPLIT')
    expect([...listRoles(db, plan.id)]).toHaveLength(1)
  })

  it('is per plan: two plans can disagree about one bill', async () => {
    const db = await ledger()
    const a = createSplitPlan(db, { name: 'A', currency: ILS, isDefault: true }, 1)
    const b = createSplitPlan(db, { name: 'B', currency: ILS }, 1)
    const rent = bill(db, 'Rent', 500_000)
    setRoles(db, [
      { planId: a.id, fixedExpenseId: rent.id, role: 'NET' },
      { planId: b.id, fixedExpenseId: rent.id, role: 'IGNORE' },
    ])

    expect(listAllRoles(db).get(a.id)?.get(rent.id)).toBe('NET')
    expect(listAllRoles(db).get(b.id)?.get(rent.id)).toBe('IGNORE')
  })

  it('goes with the plan or the expense it belongs to, and a copy of a plan starts with them', async () => {
    const db = await ledger()
    const plan = createSplitPlan(db, { name: 'A', currency: ILS, isDefault: true }, 1)
    const rent = bill(db, 'Rent', 500_000)
    const gym = bill(db, 'Gym', 30_000)
    setRoles(db, [
      { planId: plan.id, fixedExpenseId: rent.id, role: 'NET' },
      { planId: plan.id, fixedExpenseId: gym.id, role: 'SPLIT' },
    ])

    const copy = duplicateSplitPlan(db, plan.id, 'A copy', 2)
    expect(copy && listRoles(db, copy.id).get(gym.id)).toBe('SPLIT')

    // Deleting the expense is not refused for a link nobody can see.
    deleteFixedExpense(db, gym.id, 3)
    expect(listRoles(db, plan.id).has(gym.id)).toBe(false)
    expect(copy && listRoles(db, copy.id).has(gym.id)).toBe(false)

    deleteSplitPlan(db, plan.id, 4)
    expect(listAllRoles(db).has(plan.id)).toBe(false)
    expect(copy && listRoles(db, copy.id).get(rent.id)).toBe('NET')
    removePlanRoles(db, copy?.id ?? '')
    expect(listAllRoles(db).size).toBe(0)
  })

  it('leaves a payslip deduction outside the choice whatever a row says (D-053)', async () => {
    const db = await ledger()
    const plan = createSplitPlan(db, { name: 'A', currency: ILS, isDefault: true }, 1)
    const type = db
      .exec("SELECT id FROM fmt_deduction_type LIMIT 1")[0]?.values[0]?.[0]
    const pension = bill(db, 'Pension', 100_000, {
      matchKind: 'PAYCHECK_DEDUCTION',
      matchRef: String(type),
    })
    const rent = bill(db, 'Rent', 500_000)
    setRoles(db, [
      { planId: plan.id, fixedExpenseId: pension.id, role: 'NET' },
      { planId: plan.id, fixedExpenseId: rent.id, role: 'NET' },
    ])

    const parts = fixedPlanParts(listFixedExpenses(db), listRoles(db, plan.id), MONTH, ILS)
    expect(parts.netOff).toEqual(money(500_000, ILS))
    expect(parts.alreadyOutOfNet.map((one) => one.name)).toEqual(['Pension'])
  })

  it('counts nothing for a bill no role was given to, and shares a yearly bill by the month', async () => {
    const db = await ledger()
    const plan = createSplitPlan(db, { name: 'A', currency: ILS, isDefault: true }, 1)
    const insurance = bill(db, 'Insurance', 372_000, { cadence: 'YEARLY', startedAt: { year: 2025, month: 11, day: 14 } })
    bill(db, 'Streaming', 8_000)

    const none = fixedPlanParts(listFixedExpenses(db), listRoles(db, plan.id), MONTH, ILS)
    expect(none.netOff.minor + none.inSplit.minor).toBe(0)
    expect(none.ignored).toHaveLength(2)

    setRoles(db, [{ planId: plan.id, fixedExpenseId: insurance.id, role: 'SPLIT' }])
    const some = fixedPlanParts(listFixedExpenses(db), listRoles(db, plan.id), MONTH, ILS)
    expect(some.inSplit).toEqual(money(31_000, ILS))
  })
})

describe('bringing a document up (D-319, D-378)', () => {
  it('grows a document that has never heard of roles, a fund or an account', async () => {
    const db = await ledger()
    // As a document written before D-319: no role format, and buckets without
    // the two new links.
    db.run('DROP TABLE fmt_plan_fixed_expense')
    db.run("DELETE FROM format WHERE name = 'plan_fixed_expense'")
    const held = readFormat(db, 'split_bucket')
    if (held === undefined) throw new Error('the ledger lost split_bucket')
    const newer = (columns: readonly string[]): boolean => columns.some((one) => one === 'target_holding' || one === 'target_account')
    const older = {
      ...held,
      columns: held.columns.filter((one) => !newer([one.name])),
      constraints: (held.constraints ?? []).map((one) =>
        one.kind === 'AT_MOST_ONE' ? { ...one, columns: one.columns.filter((name) => !newer([name])) } : one,
      ),
    }
    expect(adoptFormat(db, older, 1).refusals).toEqual([])
    expect(readFormat(db, 'split_bucket')?.columns.some((one) => one.name === 'target_holding')).toBe(false)

    // Nothing reads it as it is (D-378): every open installs the pack first.
    const installed = installLedgerPack(db, NOW)
    expect(installed.ok).toBe(true)
    expect(readFormat(db, 'split_bucket')?.columns.some((one) => one.name === 'target_holding')).toBe(true)
    expect(readFormat(db, 'plan_fixed_expense')).toBeDefined()
    createSplitBucket(db, { name: 'Free', targetKind: 'FREE' }, 1)
    expect(listSplitBuckets(db)).toHaveLength(1)
  })
})

describe('a bucket that points at a fund or an account', () => {
  it('keeps its kind, and becomes free money when the fund goes', async () => {
    const db = await ledger()
    const fund = createFund(db, { name: 'Hishtalmut', fundType: 'STUDY_FUND' }, 1)
    const bucket = createSplitBucket(db, { name: 'Top-up', targetKind: 'FUND', targetId: fund.id }, 1)

    expect(listSplitBuckets(db).find((one) => one.id === bucket.id)).toMatchObject({
      targetKind: 'FUND',
      targetId: fund.id,
    })

    updateSplitBucket(db, bucket.id, { targetKind: 'FREE', targetId: undefined }, 2)
    updateSplitBucket(db, bucket.id, { targetKind: 'FUND', targetId: fund.id }, 3)
    deleteFund(db, fund.id, 4)
    expect(listSplitBuckets(db).find((one) => one.id === bucket.id)).toMatchObject({
      targetKind: 'FREE',
      targetId: undefined,
    })
  })
})

describe('one plan, one month', () => {
  it('works out the bar from the roles: net-off first, a share of the split, the rest to the buckets', async () => {
    const db = await ledger()
    const rent = bill(db, 'Rent', 500_000)
    const gym = bill(db, 'Gym', 30_000)
    const a = createSplitBucket(db, { name: 'Free', targetKind: 'FREE' }, 1)
    const b = createSplitBucket(db, { name: 'Rest', targetKind: 'FREE' }, 1)
    const plan = createSplitPlan(
      db,
      {
        name: 'A',
        currency: ILS,
        isDefault: true,
        basisKind: 'CUSTOM_AMOUNT',
        customAmount: money(2_000_000, ILS),
        allocations: [
          { bucketId: a.id, mode: 'PERCENTAGE', basisPoints: 5000 },
          { bucketId: b.id, mode: 'REMAINDER' },
        ],
      },
      1,
    )
    setRoles(db, [
      { planId: plan.id, fixedExpenseId: rent.id, role: 'NET' },
      { planId: plan.id, fixedExpenseId: gym.id, role: 'SPLIT' },
    ])

    const month = planMonth(db, { month: MONTH, asOf: AS_OF })
    if (month === undefined) throw new Error('no plan')
    expect(month.result.splittable).toEqual(money(1_500_000, ILS))
    expect(month.result.fixedShare).toEqual(money(30_000, ILS))
    // Half of what is left, then the remainder takes what the fixed share left.
    expect(month.result.allocations.map((entry) => entry.amount.minor)).toEqual([750_000, 720_000])
    expect(month.result.balance.minor).toBe(0)

    updateSplitPlan(db, plan.id, { customAmount: money(1_000_000, ILS) }, 2)
    const smaller = planMonth(db, { month: MONTH, asOf: AS_OF })
    expect(smaller?.result.splittable.minor).toBe(500_000)
  })
})

describe('the buckets of a plan that point at something', () => {
  it('flags money with no job to do, and says when a goal is reached at this rate', async () => {
    const db = await ledger()
    const goal = (await import('./savingsRepository.ts')).createGoal(
      db,
      { name: 'Holiday', kind: 'SHORT_TERM', targetAmount: money(1_000_000, ILS) },
      1,
    )
    const toGoal = createSplitBucket(db, { name: 'Holiday', targetKind: 'SAVING_GOAL', targetId: goal.id }, 1)
    const nowhere = createSplitBucket(db, { name: 'Misc', targetKind: 'FREE' }, 1)
    createSplitPlan(
      db,
      {
        name: 'A',
        currency: ILS,
        isDefault: true,
        basisKind: 'CUSTOM_AMOUNT',
        customAmount: money(1_000_000, ILS),
        allocations: [
          { bucketId: toGoal.id, mode: 'FIXED_AMOUNT', amount: money(250_000, ILS) },
          { bucketId: nowhere.id, mode: 'PERCENTAGE', basisPoints: 1000 },
        ],
      },
      1,
    )

    const month = planMonth(db, { month: MONTH, asOf: AS_OF })
    expect(month?.readings.get(toGoal.id)?.reach).toEqual({ kind: 'in', months: 4, period: { year: 2027, month: 1 } })
    expect(month?.readings.get(toGoal.id)?.noTarget).toBe(false)
    expect(month?.readings.get(nowhere.id)?.noTarget).toBe(true)
  })
})
