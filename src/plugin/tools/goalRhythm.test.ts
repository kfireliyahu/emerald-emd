import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { exportDatabase, openDatabase } from '@/data/db/database.ts'
import { goalsPlan } from '@/data/repositories/goalPlanRepository.ts'
import { pausedUntilByGoal, setAsideHeld } from '@/data/repositories/goalRhythmRepository.ts'
import { addDeposit, createGoal, createHolding, createHoldingPlace, listDeposits } from '@/data/repositories/savingsRepository.ts'
import { createSplitBucket, createSplitPlan } from '@/data/repositories/splitPlanRepository.ts'

import { goalProjectionTool } from './wealth.ts'
import { pauseGoalsTool, setGoalAmountsTool, settleSetAsideTool, suggestGoalAmountsTool } from './goalRhythm.ts'
import { NO_CLIENT } from './tool.ts'
import { today } from '../today.ts'
import { tempDir } from '../../testing/tempDir'

const ils = (minor: number) => money(minor, 'ILS')

/** Two goals a long way off, a plan with an Everything-else bucket, and set-aside money from 2020. */
async function fixture(): Promise<string> {
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
    { name: 'Holiday', kind: 'SHORT_TERM', targetAmount: ils(600_000), targetDate: localDate(2099, 1, 1), defaultHoldingId: holding.id },
    1,
  )
  createGoal(
    db,
    { name: 'Laptop', kind: 'SHORT_TERM', targetAmount: ils(300_000), targetDate: localDate(2099, 6, 1), defaultHoldingId: holding.id },
    1,
  )
  addDeposit(
    db,
    { goalId: holiday.id, date: localDate(2020, 1, 1), amount: ils(40_000), holdingId: holding.id, sourceKind: 'MANUAL' },
    1,
  )
  const bucket = createSplitBucket(db, { name: 'Holiday', targetKind: 'SAVING_GOAL', targetId: holiday.id }, 1)
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
        { bucketId: bucket.id, mode: 'FIXED_AMOUNT', amount: ils(10_000) },
        { bucketId: rest.id, mode: 'REMAINDER' },
      ],
    },
    1,
  )
  const path = join(await tempDir('emerald-goalrhythm-'), 'doc.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  return path
}

describe('pause_goals', () => {
  it('dry-runs, then pauses, and the projection says so', async () => {
    const path = await fixture()
    const before = await readFile(path)
    const args = { path, goals: [{ goal: 'Holiday', months: 2 }] }

    const dry = await pauseGoalsTool.run(args, NO_CLIENT)
    expect(dry).toContain('paused 2 months')
    expect(dry).toContain('Nothing has been written')
    expect(await readFile(path)).toEqual(before)

    await pauseGoalsTool.run({ ...args, commit: true }, NO_CLIENT)
    const db = await openDatabase(await readFile(path))
    expect(pausedUntilByGoal(db).size).toBe(1)
    expect(await goalProjectionTool.run({ path }, NO_CLIENT)).toContain('paused until')

    await pauseGoalsTool.run({ path, goals: [{ goal: 'Holiday', months: 0 }], commit: true }, NO_CLIENT)
    expect(pausedUntilByGoal(await openDatabase(await readFile(path))).size).toBe(0)
  })

  it('refuses a length that is not one and a goal it does not know', async () => {
    const path = await fixture()
    const text = await pauseGoalsTool.run(
      { path, goals: [{ goal: 'Holiday', months: 40 }, { goal: 'Yacht', months: 1 }] },
      NO_CLIENT,
    )
    expect(text).toContain('months is 1 to 12')
    expect(text).toContain('no such goal')
    expect(text).not.toContain('commit: true')
  })
})

describe('settle_set_aside', () => {
  it('is asked about in the projection, and gone withdraws it', async () => {
    const path = await fixture()
    expect(await goalProjectionTool.run({ path }, NO_CLIENT)).toContain('Still set aside?')

    const dry = await settleSetAsideTool.run({ path, goals: [{ goal: 'Holiday', still_there: false }] }, NO_CLIENT)
    expect(dry).toContain('gone: withdraw it')
    expect(dry).toContain('Nothing has been written')

    await settleSetAsideTool.run({ path, goals: [{ goal: 'Holiday', still_there: false }], commit: true }, NO_CLIENT)
    const db = await openDatabase(await readFile(path))
    expect(setAsideHeld(db)).toEqual([])
    expect(listDeposits(db).some((one) => one.amount.minor === -40_000)).toBe(true)
  })

  it('says when there is nothing old enough to ask about', async () => {
    const path = await fixture()
    await settleSetAsideTool.run({ path, goals: [{ goal: 'Holiday', still_there: true }], commit: true }, NO_CLIENT)
    const text = await settleSetAsideTool.run({ path, goals: [{ goal: 'Holiday', still_there: true }] }, NO_CLIENT)
    expect(text).toContain('nothing set aside is older than 90 days')
  })
})

describe('suggest_goal_amounts', () => {
  it('shows the suggestion, then writes it through Plan', async () => {
    const path = await fixture()
    const before = await readFile(path)
    const dry = await suggestGoalAmountsTool.run({ path }, NO_CLIENT)
    expect(dry).toContain('Holiday')
    expect(dry).toContain('Laptop')
    expect(dry).toContain('Plan has')
    expect(await readFile(path)).toEqual(before)

    await suggestGoalAmountsTool.run({ path, commit: true }, NO_CLIENT)
    const db = await openDatabase(await readFile(path))
    const read = goalsPlan(db, today(), 'ILS')
    // Both goals now take something, and the laptop was given a bucket.
    expect(read.rows.every((row) => row.line.monthly.minor > 0)).toBe(true)
  })
})

describe('set_goal_amounts', () => {
  it('sets a goal’s bucket from Everything else, and gives a goal with none a bucket before it (M28 F10)', async () => {
    const path = await fixture()
    const refused = await setGoalAmountsTool.run({ path, amounts: [{ goal: 'Boat', amount: 100 }] }, NO_CLIENT)
    expect(refused).toContain('no goal called "Boat"')

    await setGoalAmountsTool.run(
      { path, amounts: [{ goal: 'Holiday', amount: 300 }, { goal: 'laptop', amount: 200 }], commit: true },
      NO_CLIENT,
    )
    const db = await openDatabase(await readFile(path))
    const read = goalsPlan(db, today(), 'ILS')
    expect(read.rows.map((row) => [row.line.name, row.line.monthly.minor])).toEqual([
      ['Holiday', 30_000],
      ['Laptop', 20_000],
    ])
    // Everything else gave up exactly what the two took.
    expect(read.left?.minor).toBe(1_000_000 - 30_000 - 20_000)
    // The new bucket sits before What's left, not after it.
    expect(read.plan?.result.allocations.map((entry) => entry.bucket.name)).toEqual(['Holiday', 'Laptop', 'Everything else'])
  })
})
