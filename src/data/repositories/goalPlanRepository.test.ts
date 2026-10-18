import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { editGoalMonthly } from '@/domain/goalPlan.ts'
import { goalsAfter, goalsPlan } from './goalPlanRepository.ts'
import { planMonth } from './planMonthRepository.ts'
import { addDeposit, createGoal, createHolding, createHoldingPlace } from './savingsRepository.ts'
import { createSplitBucket, createSplitPlan, updateSplitPlan } from './splitPlanRepository.ts'

const asOf = localDate(2026, 10, 3)

async function seeded() {
  const db = await createLedgerDatabase()
  const place = createHoldingPlace(db, { name: 'Bank', kind: 'CHECKING' }, 1)
  const holding = createHolding(
    db,
    { holdingPlaceId: place.id, name: 'Savings', kind: 'CASH', provenance: 'RECORDED', isLiquid: true },
    1,
  )
  const goal = createGoal(
    db,
    { name: 'Holiday', kind: 'SHORT_TERM', targetAmount: money(500_000, 'ILS'), targetDate: localDate(2027, 2, 1) },
    1,
  )
  addDeposit(
    db,
    { goalId: goal.id, date: localDate(2026, 9, 1), amount: money(100_000, 'ILS'), holdingId: holding.id, sourceKind: 'MANUAL' },
    1,
  )
  const saving = createSplitBucket(db, { name: 'Holiday', targetKind: 'SAVING_GOAL', targetId: goal.id }, 1)
  const rest = createSplitBucket(db, { name: 'Everything else', targetKind: 'FREE' }, 1)
  createSplitPlan(
    db,
    {
      name: 'Default',
      currency: 'ILS',
      isDefault: true,
      basisKind: 'CUSTOM_AMOUNT',
      customAmount: money(1_000_000, 'ILS'),
      allocations: [
        { bucketId: saving.id, mode: 'FIXED_AMOUNT', amount: money(100_000, 'ILS') },
        { bucketId: rest.id, mode: 'REMAINDER' },
      ],
    },
    1,
  )
  return { db, goal, saving }
}

describe('goalsPlan', () => {
  it('reads each goal with the Plan bucket that points at it as its monthly amount', async () => {
    const { db, goal, saving } = await seeded()
    const read = goalsPlan(db, asOf, 'ILS')
    const [row] = read.rows
    expect(row?.line.goalId).toBe(goal.id)
    expect(row?.line.monthly.minor).toBe(100_000)
    expect(row?.bucketIds).toEqual([saving.id])
    expect(read.monthly.minor).toBe(100_000)
    // Four more months of 1,000 brings 1,000 to 5,000: February, the date.
    expect(row?.status.kind).toBe('ON_TIME')
    expect(goalsAfter(read.rows, 2, 'ILS').minor).toBe(300_000)
    // Everything else is the what's-left bucket of nothing, not the agorot no bucket took (M28 F10).
    expect(read.left?.minor).toBe(900_000)
  })

  it('a typed amount is written to the same bucket Plan shows, so the two cannot disagree', async () => {
    const { db } = await seeded()
    const pm = planMonth(db, { month: { year: 2026, month: 10 }, asOf })
    const read = goalsPlan(db, asOf, 'ILS')
    const row = read.rows[0]
    if (pm === undefined || row === undefined) throw new Error('seed')
    const edit = editGoalMonthly(
      pm.allocations,
      pm.buckets,
      row.line.goalId,
      150_000,
      pm.result.splittable,
      pm.result.allocations.map((one) => one.allocation.id),
      row.line.monthly.minor,
    )
    if (edit.kind !== 'ALLOCATIONS') throw new Error('expected an allocation edit')
    updateSplitPlan(
      db,
      pm.plan.id,
      {
        allocations: edit.allocations.map((one) => ({
          bucketId: one.bucketId,
          mode: one.mode,
          basisPoints: one.basisPoints,
          amount: one.amount,
          isLocked: one.isLocked,
        })),
      },
      2,
    )
    const after = goalsPlan(db, asOf, 'ILS')
    expect(after.rows[0]?.line.monthly.minor).toBe(150_000)
    // The remainder gave up what the goal took.
    expect(after.left?.minor).toBe(850_000)
    expect(planMonth(db, { month: { year: 2026, month: 10 }, asOf })?.result.allocations[1]?.amount.minor).toBe(850_000)
  })

  it('a goal with no bucket has no money going toward it, and says it needs one', async () => {
    const { db } = await seeded()
    const lonely = createGoal(db, { name: 'Laptop', kind: 'SHORT_TERM', targetAmount: money(650_000, 'ILS') }, 2)
    const read = goalsPlan(db, asOf, 'ILS')
    const row = read.rows.find((one) => one.line.goalId === lonely.id)
    expect(row?.line.monthly.minor).toBe(0)
    expect(row?.bucketIds).toEqual([])
    expect(row?.status.kind).toBe('NO_MONEY')
    const pm = planMonth(db, { month: { year: 2026, month: 10 }, asOf })
    if (pm === undefined) throw new Error('seed')
    const edit = editGoalMonthly(pm.allocations, pm.buckets, lonely.id, 50_000, pm.result.splittable, [], 0)
    expect(edit.kind).toBe('NEEDS_BUCKET')
  })

  it('has no plan to read from in a document without one', async () => {
    const db = await createLedgerDatabase()
    createGoal(db, { name: 'Holiday', kind: 'SHORT_TERM', targetAmount: money(500_000, 'ILS') }, 1)
    const read = goalsPlan(db, asOf, 'ILS')
    expect(read.plan).toBeUndefined()
    expect(read.left).toBeUndefined()
    expect(read.rows[0]?.line.monthly.minor).toBe(0)
  })
})
