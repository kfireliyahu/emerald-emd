import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { exportDatabase, openDatabase } from '@/data/db/database.ts'
import { categoryBudgets } from '@/data/repositories/categoryBudgetRepository.ts'
import { listCategories } from '@/data/repositories/categoryRepository.ts'
import { listDeductionTypes } from '@/data/repositories/deductionTypeRepository.ts'
import { createFixedExpense, listFixedExpenses } from '@/data/repositories/fixedExpenseRepository.ts'
import { createFund } from '@/data/repositories/fundRepository.ts'
import { listRoles } from '@/data/repositories/planFixedRepository.ts'
import { createGoal, listDeposits } from '@/data/repositories/savingsRepository.ts'
import {
  createSplitBucket,
  createSplitPlan,
  duplicateSplitPlan,
  findSplitPlan,
  planOnMonth,
  listSplitBuckets,
  listSplitPlans,
} from '@/data/repositories/splitPlanRepository.ts'

import {
  editFixedExpensesTool,
  planMonthTool,
  plansTool,
  setFixedExpenseRolesTool,
  setPlanTool,
} from './plan.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'
import { listBackups } from '../backup.ts'

const ILS = 'ILS'

/** A document with a plan, three bills (one of them a payslip deduction), a goal and a fund. */
async function fixture() {
  const db = await createLedgerDatabase()
  const deduction = listDeductionTypes(db)[0]?.id ?? ''
  const bill = (name: string, minor: number, extra: Parameters<typeof createFixedExpense>[1] extends infer T ? Partial<T> : never = {}) =>
    createFixedExpense(
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
  const rent = bill('Rent', 500_000)
  const gym = bill('Gym', 30_000)
  const pension = bill('Pension', 100_000, { matchKind: 'PAYCHECK_DEDUCTION', matchRef: deduction })
  const goal = createGoal(db, { name: 'Holiday', kind: 'SHORT_TERM', targetAmount: money(1_000_000, ILS) }, 1)
  const fund = createFund(db, { name: 'Hishtalmut', fundType: 'STUDY_FUND' }, 1)
  const free = createSplitBucket(db, { name: 'Fun', targetKind: 'FREE' }, 1)
  const plan = createSplitPlan(
    db,
    {
      name: 'Everyday',
      currency: ILS,
      isDefault: true,
      basisKind: 'CUSTOM_AMOUNT',
      customAmount: money(2_000_000, ILS),
      allocations: [{ bucketId: free.id, mode: 'PERCENTAGE', basisPoints: 1000 }],
    },
    1,
  )
  const groceries = listCategories(db).find((one) => one.name === 'Groceries')?.id ?? ''
  const groceriesBucket = createSplitBucket(db, { name: 'Groceries', targetKind: 'CATEGORY', targetId: groceries }, 1).id
  const path = join(await tempDir('emerald-plan-'), 'doc.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  return { path, rent, gym, pension, goal, fund, free, plan, groceries, groceriesBucket }
}

async function reopen(path: string) {
  return openDatabase(await readFile(path))
}

describe('plans', () => {
  it('reads each plan with what every fixed expense does to it, and the ids to change them with', async () => {
    const f = await fixture()
    const text = await plansTool.run({ path: f.path }, NO_CLIENT)

    expect(text).toContain('Everyday (default)')
    expect(text).toContain(f.plan.id)
    expect(text).toContain(f.rent.id)
    expect(text).toContain('ignored (no choice made)')
    expect(text).toContain('already out of net (from the paycheck)')
    expect(text).toContain('nothing in particular')
  })
})

describe('set_fixed_expense_roles', () => {
  it('dry-runs, then writes a role per plan, and refuses a payslip deduction', async () => {
    const f = await fixture()
    const roles = [
      { fixed_expense_id: f.rent.id, role: 'net' },
      { fixed_expense_id: f.gym.id, role: 'split' },
      { fixed_expense_id: f.pension.id, role: 'net' },
    ]
    const before = await readFile(f.path)
    const dry = await setFixedExpenseRolesTool.run({ path: f.path, roles }, NO_CLIENT)
    expect(dry).toContain('2 roles would change')
    expect(dry).toContain('outside this choice')
    expect(dry).toContain('Nothing has been written')
    expect(await readFile(f.path)).toEqual(before)

    const done = await setFixedExpenseRolesTool.run({ path: f.path, roles, commit: true }, NO_CLIENT)
    expect(done).toContain('2 roles written')
    const db = await reopen(f.path)
    expect(listRoles(db, f.plan.id).get(f.rent.id)).toBe('NET')
    expect(listRoles(db, f.plan.id).get(f.gym.id)).toBe('SPLIT')
    expect(listRoles(db, f.plan.id).has(f.pension.id)).toBe(false)
    db.close()
    expect((await listBackups(f.path)).length > 0).toBe(true)

    // Saying it again changes nothing.
    const again = await setFixedExpenseRolesTool.run({ path: f.path, roles: roles.slice(0, 2) }, NO_CLIENT)
    expect(again).toContain('0 roles would change')
  })

  it('names an argument it cannot read', async () => {
    const f = await fixture()
    await expect(
      setFixedExpenseRolesTool.run({ path: f.path, roles: [{ fixed_expense_id: f.rent.id, role: 'sideways' }] }, NO_CLIENT),
    ).rejects.toThrow(/role/)
  })
})

describe('set_plan', () => {
  it('makes a bonus month as a copy with another basis, and resizes buckets that point at things', async () => {
    const f = await fixture()
    const text = await setPlanTool.run(
      {
        path: f.path,
        commit: true,
        plans: [
          {
            create: true,
            copy_of: f.plan.id,
            name: 'With the bonus',
            basis: { kind: 'CUSTOM_AMOUNT', amount: 25_000 },
            buckets: [
              { bucket_id: f.free.id, mode: 'percent', percent: 20, points_at: { kind: 'none' } },
              { name: 'Holiday', mode: 'amount', amount: 2_500, points_at: { kind: 'goal', id: f.goal.id } },
              { name: 'Top-up', mode: 'amount', amount: 1_000, points_at: { kind: 'fund', id: f.fund.id }, locked: true },
              { name: 'Everything else', mode: 'rest' },
            ],
          },
        ],
      },
      NO_CLIENT,
    )
    expect(text).toContain('1 plan changed')

    const db = await reopen(f.path)
    const bonus = listSplitPlans(db).find((one) => one.name === 'With the bonus')
    expect(bonus?.customAmount).toEqual(money(2_500_000, ILS))
    const loaded = findSplitPlan(db, bonus?.id ?? '')
    expect(loaded?.allocations).toHaveLength(4)
    const buckets = listSplitBuckets(db)
    expect(buckets.find((one) => one.name === 'Holiday')).toMatchObject({ targetKind: 'SAVING_GOAL', targetId: f.goal.id })
    expect(buckets.find((one) => one.name === 'Top-up')).toMatchObject({ targetKind: 'FUND', targetId: f.fund.id })
    expect(loaded?.allocations.find((one) => one.mode === 'REMAINDER')).toBeDefined()
    expect(loaded?.allocations.find((one) => one.isLocked)).toBeDefined()
    // The original is as it was.
    expect(findSplitPlan(db, f.plan.id)?.allocations).toHaveLength(1)
    db.close()
  })

  it('takes a bucket out, its share going to the bucket on its right, and deletes the default plan', async () => {
    const f = await fixture()
    await setPlanTool.run(
      {
        path: f.path,
        commit: true,
        plans: [
          {
            plan_id: f.plan.id,
            buckets: [
              { bucket_id: f.free.id, mode: 'percent', percent: 10 },
              { bucket_id: f.groceriesBucket, mode: 'percent', percent: 20, points_at: { kind: 'category', id: f.groceries } },
            ],
          },
        ],
      },
      NO_CLIENT,
    )
    const dry = await setPlanTool.run(
      { path: f.path, plans: [{ plan_id: f.plan.id, remove_buckets: [f.free.id] }] },
      NO_CLIENT,
    )
    expect(dry).toContain('each share goes to the bucket on its right')
    await setPlanTool.run(
      { path: f.path, commit: true, plans: [{ plan_id: f.plan.id, remove_buckets: [f.free.id] }] },
      NO_CLIENT,
    )
    let db = await reopen(f.path)
    const left = findSplitPlan(db, f.plan.id)?.allocations ?? []
    expect(left.map((one) => [one.bucketId, one.basisPoints])).toEqual([[f.groceriesBucket, 3000]])
    expect(listSplitBuckets(db).some((one) => one.id === f.free.id)).toBe(false)
    db.close()

    const dryDelete = await setPlanTool.run({ path: f.path, plans: [{ plan_id: f.plan.id, delete: true }] }, NO_CLIENT)
    expect(dryDelete).toContain('it is the only plan')
    await setPlanTool.run({ path: f.path, commit: true, plans: [{ plan_id: f.plan.id, delete: true }] }, NO_CLIENT)
    db = await reopen(f.path)
    expect(listSplitPlans(db)).toEqual([])
    db.close()
  })

  // No tool prints a goal's id, and every other tool takes a goal by name (M33 F12).
  it('points a bucket at a goal by its name as well as by its id', async () => {
    const f = await fixture()
    await setPlanTool.run(
      {
        path: f.path,
        commit: true,
        plans: [{ plan_id: f.plan.id, buckets: [{ name: 'Trip', mode: 'amount', amount: 500, points_at: { kind: 'goal', id: 'holiday' } }] }],
      },
      NO_CLIENT,
    )
    const db = await reopen(f.path)
    expect(listSplitBuckets(db).find((one) => one.name === 'Trip')).toMatchObject({ targetKind: 'SAVING_GOAL', targetId: f.goal.id })
    db.close()
  })

  it('refuses a target that does not exist, a second rest, and a bucket that is not in the plan', async () => {
    const f = await fixture()
    const dry = await setPlanTool.run(
      {
        path: f.path,
        plans: [
          { plan_id: f.plan.id, buckets: [{ name: 'X', mode: 'percent', percent: 10, points_at: { kind: 'goal', id: 'nope' } }] },
          { plan_id: f.plan.id, remove_buckets: ['nope'] },
          { plan_id: 'ghost', name: 'Boo' },
        ],
      },
      NO_CLIENT,
    )
    expect(dry).toContain('no goal has the id or the name nope')
    expect(dry).toContain('nope is not a bucket of this plan')
    expect(dry).toContain('no plan has this id')
    await expect(
      setPlanTool.run(
        { path: f.path, plans: [{ plan_id: f.plan.id, buckets: [{ name: 'a', mode: 'rest' }, { name: 'b', mode: 'rest' }] }] },
        NO_CLIENT,
      ),
    ).rejects.toThrow(/two buckets/)
  })

  it('deletes a plan that is not the default, with what its fixed-expense choices said', async () => {
    const f = await fixture()
    await setPlanTool.run({ path: f.path, commit: true, plans: [{ create: true, copy_of: f.plan.id, name: 'Lean' }] }, NO_CLIENT)
    let db = await reopen(f.path)
    const lean = listSplitPlans(db).find((one) => one.name === 'Lean')
    db.close()
    await setFixedExpenseRolesTool.run(
      { path: f.path, commit: true, roles: [{ fixed_expense_id: f.rent.id, role: 'net', plan_id: lean?.id }] },
      NO_CLIENT,
    )
    await setPlanTool.run({ path: f.path, commit: true, plans: [{ plan_id: lean?.id, delete: true }] }, NO_CLIENT)
    db = await reopen(f.path)
    expect(listSplitPlans(db).map((one) => one.name)).toEqual(['Everyday'])
    db.close()
  })
})

describe('plan_month', () => {
  it('gives months a plan, and puts them back on the default, recording nothing (M31 U4)', async () => {
    const f = await fixture()
    const opened = await reopen(f.path)
    const holiday = duplicateSplitPlan(opened, f.plan.id, 'Holiday', 1)?.id ?? ''
    await writeFile(f.path, exportDatabase(opened))
    opened.close()

    const dry = await planMonthTool.run({ path: f.path, plan_id: holiday, months: ['2026-11', '2026-12'] }, NO_CLIENT)
    expect(dry).toContain('Holiday')
    expect(dry).toContain('2026-11')
    await planMonthTool.run({ path: f.path, plan_id: holiday, months: ['2026-11', '2026-12'], commit: true }, NO_CLIENT)
    let db = await reopen(f.path)
    expect(planOnMonth(db, { year: 2026, month: 11 })).toBe(holiday)
    expect(planOnMonth(db, { year: 2026, month: 12 })).toBe(holiday)
    db.close()

    const done = await planMonthTool.run({ path: f.path, plan_id: holiday, back_to_default: ['2026-11'], commit: true }, NO_CLIENT)
    expect(done).toContain('Months on it: 2026-12.')
    db = await reopen(f.path)
    expect(planOnMonth(db, { year: 2026, month: 11 })).toBe(f.plan.id)
    expect(listDeposits(db)).toHaveLength(0)
    db.close()
  })

  it('works a plan out for a month on a dry run, and uses it on commit', async () => {
    const f = await fixture()
    await setFixedExpenseRolesTool.run(
      { path: f.path, commit: true, roles: [{ fixed_expense_id: f.rent.id, role: 'net' }, { fixed_expense_id: f.gym.id, role: 'split' }] },
      NO_CLIENT,
    )
    await setPlanTool.run(
      {
        path: f.path,
        commit: true,
        plans: [
          {
            plan_id: f.plan.id,
            buckets: [
              { bucket_id: f.free.id, mode: 'percent', percent: 10 },
              { bucket_id: f.groceriesBucket, mode: 'amount', amount: 2_500 },
              { name: 'Holiday', mode: 'amount', amount: 100, points_at: { kind: 'goal', id: f.goal.id } },
            ],
          },
        ],
      },
      NO_CLIENT,
    )

    const dry = await planMonthTool.run({ path: f.path, month: '2026-10' }, NO_CLIENT)
    expect(dry).toContain('Everyday')
    // ₪20,000 less ₪5,000 of rent is ₪15,000 to split; the gym is a share of it.
    expect(dry).toContain('₪15,000.00')
    expect(dry).toContain('₪300.00')
    expect(dry).not.toContain('monthly target')
    expect(dry).toContain('needs a holding first')
    expect(dry).toContain('goal reached')
    expect(dry).toContain('money with no job to do')
    expect(dry).toContain('Nothing has been written')

    const done = await planMonthTool.run(
      { path: f.path, month: '2026-10', commit: true, only_buckets: [f.groceriesBucket] },
      NO_CLIENT,
    )
    expect(done).toContain('Used **Everyday** for')
    const db = await reopen(f.path)
    // The default plan covers a month nobody gave another plan, so it needs no row (M31 U4).
    expect(planOnMonth(db, { year: 2026, month: 10 })).toBe(f.plan.id)
    expect(listDeposits(db)).toHaveLength(0)
    // A category's target is its bucket (D-327): using the plan copies nothing, the figure was in force already.
    expect(categoryBudgets(db, localDate(2026, 10, 3), ILS).get(listCategories(db).find((one) => one.name === 'Groceries')?.id ?? '')).toEqual(money(250_000, ILS))
    db.close()
  })

  it('says so for a plan that is not there', async () => {
    const f = await fixture()
    const text = await planMonthTool.run({ path: f.path, plan_id: 'ghost' }, NO_CLIENT)
    expect(text).toContain('There is no such plan')
  })
})

describe('edit_fixed_expenses', () => {
  it('changes a bill, ends one, and stops tracking one along with what plans said about it', async () => {
    const f = await fixture()
    await setFixedExpenseRolesTool.run(
      { path: f.path, commit: true, roles: [{ fixed_expense_id: f.gym.id, role: 'split' }, { fixed_expense_id: f.rent.id, role: 'net' }] },
      NO_CLIENT,
    )
    const text = await editFixedExpensesTool.run(
      {
        path: f.path,
        commit: true,
        edits: [
          { fixed_expense_id: f.rent.id, expected_amount: 5_500, name: 'Rent (new lease)' },
          { fixed_expense_id: f.gym.id, stop_tracking: true },
          { fixed_expense_id: f.pension.id, ended_on: '2026-09-30' },
        ],
      },
      NO_CLIENT,
    )
    expect(text).toContain('3 bills changed')

    const db = await reopen(f.path)
    const all = listFixedExpenses(db)
    expect(all.find((one) => one.id === f.rent.id)).toMatchObject({ name: 'Rent (new lease)', expectedAmount: money(550_000, ILS) })
    expect(all.some((one) => one.id === f.gym.id)).toBe(false)
    expect(all.find((one) => one.id === f.pension.id)).toMatchObject({ isActive: false })
    expect(listRoles(db, f.plan.id).has(f.gym.id)).toBe(false)
    db.close()
  })

  it('refuses what cannot be right, by name, and a stop that also changes things', async () => {
    const f = await fixture()
    const dry = await editFixedExpensesTool.run(
      {
        path: f.path,
        edits: [
          { fixed_expense_id: 'ghost', name: 'x' },
          { fixed_expense_id: f.rent.id, cadence: 'YEARLY', category_id: 'nope' },
        ],
      },
      NO_CLIENT,
    )
    expect(dry).toContain('no bill has this id')
    expect(dry).toContain('the category does not exist')
    await expect(
      editFixedExpensesTool.run({ path: f.path, edits: [{ fixed_expense_id: f.rent.id, stop_tracking: true, name: 'y' }] }, NO_CLIENT),
    ).rejects.toThrow(/stops tracking/)
  })
})
