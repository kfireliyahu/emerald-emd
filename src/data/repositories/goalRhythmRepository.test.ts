import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { applyGoalSplit, goalsPlan, setGoalMonthly, suggestGoalSplit } from './goalPlanRepository.ts'
import { MaxPauseError, pauseGoal, pausedUntilByGoal, setAsideHeld, settleSetAside, staleSetAside } from './goalRhythmRepository.ts'
import { addDeposit, createGoal, createHolding, createHoldingPlace, listDeposits } from './savingsRepository.ts'
import { createSplitBucket, createSplitPlan } from './splitPlanRepository.ts'

const asOf = localDate(2026, 10, 3)
const ils = (minor: number) => money(minor, 'ILS')

async function seeded() {
  const db = await createLedgerDatabase()
  const place = createHoldingPlace(db, { name: 'Bank', kind: 'CHECKING' }, 1)
  const holding = createHolding(
    db,
    {
      holdingPlaceId: place.id,
      name: 'Savings',
      kind: 'CASH',
      provenance: 'RECORDED',
      isLiquid: true,
      expectedReturnBasisPoints: 400,
      expectedReturnBasis: 'CONTRACTUAL',
    },
    1,
  )
  const holiday = createGoal(
    db,
    {
      name: 'Holiday',
      kind: 'SHORT_TERM',
      targetAmount: ils(500_000),
      targetDate: localDate(2027, 2, 1),
      defaultHoldingId: holding.id,
    },
    1,
  )
  const laptop = createGoal(
    db,
    {
      name: 'Laptop',
      kind: 'SHORT_TERM',
      targetAmount: ils(240_000),
      targetDate: localDate(2027, 10, 1),
      defaultHoldingId: holding.id,
    },
    1,
  )
  const holidayBucket = createSplitBucket(db, { name: 'Holiday', targetKind: 'SAVING_GOAL', targetId: holiday.id }, 1)
  const rest = createSplitBucket(db, { name: 'Everything else', targetKind: 'FREE' }, 1)
  createSplitPlan(
    db,
    {
      name: 'Default',
      currency: 'ILS',
      isDefault: true,
      basisKind: 'CUSTOM_AMOUNT',
      customAmount: ils(1_000_000),
      allocations: [
        { bucketId: holidayBucket.id, mode: 'FIXED_AMOUNT', amount: ils(100_000) },
        { bucketId: rest.id, mode: 'REMAINDER' },
      ],
    },
    1,
  )
  return { db, holiday, laptop, holding }
}

describe('pausing a goal (S7)', () => {
  it('skips the months, gives the amount back to what is left, and starts again on 0', async () => {
    const { db, holiday } = await seeded()
    // Everything else is the what's-left bucket (M28 F10): 10,000 less the holiday's 1,000.
    expect(goalsPlan(db, asOf, 'ILS').left?.minor).toBe(900_000)

    expect(pauseGoal(db, holiday.id, 1, asOf)).toEqual({ year: 2026, month: 11 })
    expect(pausedUntilByGoal(db).get(holiday.id)).toEqual({ year: 2026, month: 11 })

    const paused = goalsPlan(db, asOf, 'ILS')
    const row = paused.rows.find((one) => one.line.goalId === holiday.id)
    expect(row?.pausedUntil).toEqual({ year: 2026, month: 11 })
    expect(row?.line.pausedMonths).toBe(1)
    // Its 1,000 is not being taken this month, so it is back in what is left and out of the total.
    expect(paused.monthly.minor).toBe(0)
    expect(paused.left?.minor).toBe(1_000_000)

    expect(pauseGoal(db, holiday.id, 0, asOf)).toBeUndefined()
    const resumed = goalsPlan(db, asOf, 'ILS')
    expect(resumed.rows.find((one) => one.line.goalId === holiday.id)?.pausedUntil).toBeUndefined()
    expect(resumed.monthly.minor).toBe(100_000)
  })

  it('stops by itself once the month has come, and refuses a length that is not one', async () => {
    const { db, holiday } = await seeded()
    pauseGoal(db, holiday.id, 1, asOf)
    const later = localDate(2026, 11, 2)
    expect(goalsPlan(db, later, 'ILS').rows.find((one) => one.line.goalId === holiday.id)?.pausedUntil).toBeUndefined()
    expect(() => pauseGoal(db, holiday.id, 13, asOf)).toThrow(MaxPauseError)
    expect(() => pauseGoal(db, holiday.id, 1.5, asOf)).toThrow(MaxPauseError)
  })
})

describe('is it still set aside (S5)', () => {
  it('asks about set-aside money older than 90 days, and a withdrawal takes from the oldest first', async () => {
    const { db, holiday, holding } = await seeded()
    const put = (date: ReturnType<typeof localDate>, minor: number) =>
      addDeposit(
        db,
        {
          goalId: holiday.id,
          date,
          amount: ils(minor),
          holdingId: holding.id,
          sourceKind: 'MANUAL',
          note: minor < 0 ? 'taken' : undefined,
        },
        1,
      )
    put(localDate(2026, 5, 1), 50_000)
    put(localDate(2026, 6, 1), 30_000)
    put(localDate(2026, 9, 20), 10_000)
    addDeposit(
      db,
      {
        goalId: holiday.id,
        date: localDate(2026, 5, 2),
        amount: ils(900_000),
        holdingId: holding.id,
        sourceKind: 'FROM_TRANSACTION',
        sourceRefId: 'tx',
      },
      1,
    )
    put(localDate(2026, 7, 1), -60_000)

    const held = setAsideHeld(db)
    // 50,000 + 30,000 + 10,000, less 60,000 taken from the oldest: 20,000 of June and the 10,000 from September.
    expect(held.map((one) => one.amount.minor)).toEqual([20_000, 10_000])
    const stale = staleSetAside(db, asOf).get(holiday.id)
    expect(stale?.map((one) => one.amount.minor)).toEqual([20_000])
    expect(goalsPlan(db, asOf, 'ILS').rows[0]?.stale).toHaveLength(1)
  })

  it('still there is not asked again for 90 days, and gone withdraws it with the reason', async () => {
    const { db, holiday, holding } = await seeded()
    addDeposit(
      db,
      { goalId: holiday.id, date: localDate(2026, 5, 1), amount: ils(50_000), holdingId: holding.id, sourceKind: 'MANUAL' },
      1,
    )

    settleSetAside(db, holiday.id, 'STILL_THERE', asOf, 2)
    expect(staleSetAside(db, asOf).size).toBe(0)
    expect(staleSetAside(db, localDate(2027, 1, 2)).size).toBe(1)

    const before = listDeposits(db, { goalId: holiday.id }).length
    const settled = settleSetAside(db, holiday.id, 'GONE', localDate(2027, 1, 2), 3)
    expect(settled.amount?.minor).toBe(50_000)
    const after = listDeposits(db, { goalId: holiday.id })
    expect(after).toHaveLength(before + 1)
    const withdrawal = after.find((one) => one.amount.minor < 0)
    expect(withdrawal?.amount.minor).toBe(-50_000)
    expect(withdrawal?.note).toContain('No longer set aside')
    // The balance followed, and nothing is left to ask about.
    expect(setAsideHeld(db)).toEqual([])
  })
})

describe('planned against moved and the bank-agreed rate (S2, S6)', () => {
  it('reads the derived deposits of the last three full months, and the rate of the default holding', async () => {
    const { db, holiday, holding } = await seeded()
    for (const [date, minor] of [
      [localDate(2026, 7, 5), 40_000],
      [localDate(2026, 9, 5), 60_000],
      [localDate(2026, 10, 1), 999],
    ] as const) {
      addDeposit(
        db,
        {
          goalId: holiday.id,
          date,
          amount: ils(minor),
          holdingId: holding.id,
          sourceKind: 'FROM_TRANSACTION',
          sourceRefId: `t${String(date.month)}`,
        },
        1,
      )
    }
    const row = goalsPlan(db, asOf, 'ILS').rows.find((one) => one.line.goalId === holiday.id)
    expect(row?.moved.minor).toBe(100_000)
    expect(row?.line.agreedRateBasisPoints).toBe(400)
  })
})

describe('suggesting and writing a split (S3)', () => {
  it('suggests inside what Plan has for goals and writes it through the typed-amount rule', async () => {
    const { db, holiday, laptop } = await seeded()
    const suggestion = suggestGoalSplit(db, asOf, 'ILS')
    if (suggestion === undefined) throw new Error('a plan and two goals')
    // The pool is the 1,000 the holiday takes plus the 9,000 left: all of it.
    expect(suggestion.pool.minor).toBe(1_000_000)
    const by = Object.fromEntries(suggestion.amounts.map((one) => [one.goalId, one.amount.minor]))
    // Holiday: nothing yet, 5,000 to find in the 4 months to February. Laptop: 2,400 over 12.
    expect(by[holiday.id]).toBe(125_000)
    expect(by[laptop.id]).toBe(20_000)

    const done = applyGoalSplit(db, asOf, 'ILS', suggestion, 2)
    expect(done.problems).toEqual([])
    const read = goalsPlan(db, asOf, 'ILS')
    expect(read.rows.find((one) => one.line.goalId === holiday.id)?.line.monthly.minor).toBe(125_000)
    // The laptop had no bucket and got one, ahead of everything else.
    expect(read.rows.find((one) => one.line.goalId === laptop.id)?.line.monthly.minor).toBe(20_000)
    // Everything else is the remainder, so it gave up exactly what the goals took.
    const rest = read.plan?.result.allocations.find((one) => one.allocation.mode === 'REMAINDER')
    expect(rest?.amount.minor).toBe(1_000_000 - 125_000 - 20_000)
    expect(read.left?.minor).toBe(1_000_000 - 125_000 - 20_000)
  })

  it('setGoalMonthly says when it changed nothing and when there is no plan', async () => {
    const { db, holiday } = await seeded()
    expect(setGoalMonthly(db, asOf, 'ILS', holiday.id, 100_000, 2)).toBe('UNCHANGED')
    expect(setGoalMonthly(db, asOf, 'ILS', holiday.id, 150_000, 2)).toBe('SET')
    const empty = await createLedgerDatabase()
    expect(setGoalMonthly(empty, asOf, 'ILS', 'nope', 1, 2)).toBe('NO_PLAN')
  })
})
