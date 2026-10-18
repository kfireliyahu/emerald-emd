import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { planVersusActual, splitPlan as computeSplit } from '@/domain/splitter.ts'
import { exportDatabase, openDatabase } from '../db/database.ts'
import { createAccount } from './accountRepository.ts'
import { createCategory, reparentCategory, setCategoryManually } from './categoryRepository.ts'
import { addPayment, createDebt } from './debtRepository.ts'
import {
  addDeposit,
  createGoal,
  createHolding,
  createHoldingPlace,
  listHoldings,
} from './savingsRepository.ts'
import { type InsertableTransaction } from './transactionRepository.ts'
import {
  bucketActuals,
  bucketUsageCounts,
  createSplitBucket,
  createSplitPlan,
  defaultSplitPlan,
  deleteSplitBucket,
  deleteSplitPlan,
  duplicateSplitPlan,
  findSplitPlan,
  listPlanMonths,
  listSplitBuckets,
  listSplitPlans,
  planOnMonth,
  reorderSplitBuckets,
  setDefaultPlan,
  setPlanMonths,
  updateSplitBucket,
  updateSplitPlan,
} from './splitPlanRepository.ts'

const ILS = 'ILS'

/** Three shared buckets and a 50/30/20 plan over them. */
async function seeded(): Promise<Database> {
  const db = await createLedgerDatabase()

  const needs = createSplitBucket(db, { name: 'Needs', targetKind: 'FREE' }, 1)
  const wants = createSplitBucket(db, { name: 'Wants', targetKind: 'FREE' }, 1)
  const saving = createSplitBucket(db, { name: 'Saving', targetKind: 'FREE' }, 1)

  createSplitPlan(
    db,
    {
      name: 'Default',
      currency: ILS,
      isDefault: true,
      allocations: [
        { bucketId: needs.id, mode: 'PERCENTAGE', basisPoints: 5000 },
        { bucketId: wants.id, mode: 'PERCENTAGE', basisPoints: 3000 },
        { bucketId: saving.id, mode: 'PERCENTAGE', basisPoints: 2000, isLocked: true },
      ],
    },
    1,
  )

  return db
}

describe('split plans', () => {
  it('round-trips a plan and its allocations through a real file', async () => {
    const db = await seeded()
    const before = defaultSplitPlan(db)

    const reopened = await openDatabase(exportDatabase(db))
    const after = defaultSplitPlan(reopened)

    expect(after).toEqual(before)
    expect(after?.plan.name).toBe('Default')
    expect(after?.allocations).toHaveLength(3)
    expect(after?.allocations.find((one) => one.isLocked)?.basisPoints).toBe(2000)
  })

  it('feeds the splitter, end to end', async () => {
    const db = await seeded()
    const loaded = defaultSplitPlan(db)
    if (loaded === undefined) throw new Error('the fixture stopped producing a plan')

    const result = computeSplit(
      loaded.plan,
      listSplitBuckets(db),
      loaded.allocations,
      money(1_950_000, ILS),
      { netOff: money(0, ILS), inSplit: money(0, ILS) },
    )

    expect(result.allocations.map((entry) => entry.amount.minor)).toEqual([
      975_000, 585_000, 390_000,
    ])
    expect(result.status).toBe('EXACT')
  })

  it('replaces allocations wholesale when the screen saves', async () => {
    const db = await seeded()
    const loaded = defaultSplitPlan(db)
    const buckets = listSplitBuckets(db)
    const first = buckets[0]
    if (loaded === undefined || first === undefined) throw new Error('bad fixture')

    updateSplitPlan(
      db,
      loaded.plan.id,
      { allocations: [{ bucketId: first.id, mode: 'REMAINDER' }] },
      2,
    )

    const after = findSplitPlan(db, loaded.plan.id)
    expect(after?.allocations).toHaveLength(1)
    expect(after?.allocations[0]?.mode).toBe('REMAINDER')
  })

  it('refuses a second remainder in one plan', async () => {
    const db = await seeded()
    const loaded = defaultSplitPlan(db)
    const [first, second] = listSplitBuckets(db)
    if (loaded === undefined || first === undefined || second === undefined) {
      throw new Error('bad fixture')
    }

    // The invariant docs/04 states, enforced by a partial unique index rather
    // than by hoping every caller checks.
    expect(() =>
      updateSplitPlan(
        db,
        loaded.plan.id,
        {
          allocations: [
            { bucketId: first.id, mode: 'REMAINDER' },
            { bucketId: second.id, mode: 'REMAINDER' },
          ],
        },
        2,
      ),
    ).toThrow()

    // And the rollback held: the plan still has the three it started with.
    expect(findSplitPlan(db, loaded.plan.id)?.allocations).toHaveLength(3)
  })

  it('refuses to allocate to one bucket twice in one plan', async () => {
    const db = await seeded()
    const loaded = defaultSplitPlan(db)
    const first = listSplitBuckets(db)[0]
    if (loaded === undefined || first === undefined) throw new Error('bad fixture')

    expect(() =>
      updateSplitPlan(
        db,
        loaded.plan.id,
        {
          allocations: [
            { bucketId: first.id, mode: 'PERCENTAGE', basisPoints: 1000 },
            { bucketId: first.id, mode: 'PERCENTAGE', basisPoints: 2000 },
          ],
        },
        2,
      ),
    ).toThrow()
  })

  it('keeps exactly one default', async () => {
    const db = await seeded()
    const bonus = createSplitPlan(db, { name: 'Bonus month', currency: ILS, isDefault: true }, 2)

    const plans = listSplitPlans(db)
    expect(plans.filter((one) => one.isDefault)).toHaveLength(1)
    expect(defaultSplitPlan(db)?.plan.id).toBe(bonus.id)

    const other = plans.find((one) => one.id !== bonus.id)
    if (other === undefined) throw new Error('bad fixture')
    setDefaultPlan(db, other.id, 3)
    expect(listSplitPlans(db).filter((one) => one.isDefault).map((one) => one.id)).toEqual([
      other.id,
    ])
  })

  it('duplicates a plan with its allocations, and never as the default', async () => {
    const db = await seeded()
    const loaded = defaultSplitPlan(db)
    if (loaded === undefined) throw new Error('bad fixture')

    const copy = duplicateSplitPlan(db, loaded.plan.id, 'Bonus month', 2)
    if (copy === undefined) throw new Error('the copy did not happen')

    expect(copy.isDefault).toBe(false)
    expect(copy.name).toBe('Bonus month')

    const copied = findSplitPlan(db, copy.id)
    expect(copied?.allocations.map((one) => one.basisPoints).sort()).toEqual(
      loaded.allocations.map((one) => one.basisPoints).sort(),
    )
    // The buckets are shared, so both plans point at the same three rows —
    // which is what makes two plans comparable.
    expect(new Set(copied?.allocations.map((one) => one.bucketId))).toEqual(
      new Set(loaded.allocations.map((one) => one.bucketId)),
    )
  })

  it('soft-deletes a plan without taking its buckets with it', async () => {
    const db = await seeded()
    const loaded = defaultSplitPlan(db)
    if (loaded === undefined) throw new Error('bad fixture')

    deleteSplitPlan(db, loaded.plan.id, 2)
    expect(listSplitPlans(db)).toEqual([])
    expect(listSplitBuckets(db)).toHaveLength(3)
  })
})

describe('which plan a month is on (M31 U4)', () => {
  const oct = { year: 2026, month: 10 }
  const nov = { year: 2026, month: 11 }
  const dec = { year: 2026, month: 12 }

  it('puts a month nobody gave a plan on the default, and a month given one on that plan', async () => {
    const db = await seeded()
    const everyday = defaultSplitPlan(db)?.plan.id ?? ''
    const holiday = duplicateSplitPlan(db, everyday, 'Holiday', 2)?.id ?? ''
    expect(planOnMonth(db, nov)).toBe(everyday)

    setPlanMonths(db, holiday, [nov, dec], [])
    expect(planOnMonth(db, nov)).toBe(holiday)
    expect(planOnMonth(db, dec)).toBe(holiday)
    expect(planOnMonth(db, oct)).toBe(everyday)

    // The default takes a month back by giving it to itself, which leaves no row.
    setPlanMonths(db, everyday, [dec], [])
    expect(planOnMonth(db, dec)).toBe(everyday)
    expect([...listPlanMonths(db).keys()]).toEqual(['2026-11'])

    // Taking a month off a plan only does so when it is that plan's.
    setPlanMonths(db, everyday, [], [nov])
    expect(planOnMonth(db, nov)).toBe(holiday)
    setPlanMonths(db, holiday, [], [nov])
    expect(planOnMonth(db, nov)).toBe(everyday)
  })

  it('keeps the month when the plan is edited, and gives its months back when it is deleted', async () => {
    const db = await seeded()
    const everyday = defaultSplitPlan(db)?.plan.id ?? ''
    const holiday = duplicateSplitPlan(db, everyday, 'Holiday', 2)?.id ?? ''
    setPlanMonths(db, holiday, [nov], [])
    updateSplitPlan(db, holiday, { allocations: findSplitPlan(db, everyday)?.allocations.map((one) => ({ ...one })) ?? [] }, 3)
    expect(planOnMonth(db, nov)).toBe(holiday)

    deleteSplitPlan(db, holiday, 4)
    expect(listPlanMonths(db).size).toBe(0)
    expect(planOnMonth(db, nov)).toBe(everyday)
  })
})

describe('split buckets', () => {
  it('are shared across plans and ordered by the user', async () => {
    const db = await seeded()
    const ids = listSplitBuckets(db).map((one) => one.id)
    const reversed = [...ids].reverse()

    reorderSplitBuckets(db, reversed, 2)
    expect(listSplitBuckets(db).map((one) => one.id)).toEqual(reversed)
  })

  it('keeps every target kind, and refuses one that names nothing to point at (D-252)', async () => {
    const db = await createLedgerDatabase()
    expect(() => createSplitBucket(db, { name: 'FREE', targetKind: 'FREE' }, 1)).not.toThrow()
    // A bucket for a category, a goal or a debt is one of its links since M25
    // U7, and a fund or an account too since M36 U09 — each a kind of its own,
    // and the declaration says the kind's link is required.
    for (const kind of ['CATEGORY', 'SAVING_GOAL', 'DEBT', 'FUND', 'ACCOUNT'] as const) {
      expect(() => createSplitBucket(db, { name: kind, targetKind: kind }, 1)).toThrow(/required/)
    }
    expect(listSplitBuckets(db)).toHaveLength(1)
    expect(db.exec("SELECT DISTINCT target_kind FROM fmt_split_bucket")[0]?.values).toEqual([['FREE']])
  })

  it('remembers the 50 / 30 / 20 share it counts as, and forgets it on none (M31 U4)', async () => {
    const db = await seeded()
    const made = createSplitBucket(db, { name: 'Hobbies', share: 'WANTS' }, 1)
    expect(listSplitBuckets(db).find((one) => one.id === made.id)?.share).toBe('WANTS')
    updateSplitBucket(db, made.id, { name: 'Hobbies and games' }, 2)
    expect(listSplitBuckets(db).find((one) => one.id === made.id)?.share).toBe('WANTS')
    updateSplitBucket(db, made.id, { share: undefined }, 3)
    expect(listSplitBuckets(db).find((one) => one.id === made.id)?.share).toBeUndefined()
  })

  it('renames and retargets in place', async () => {
    const db = await seeded()
    const first = listSplitBuckets(db)[0]
    if (first === undefined) throw new Error('bad fixture')

    updateSplitBucket(db, first.id, { name: 'Groceries', targetKind: 'CATEGORY', targetId: 'cat:1' }, 2)
    const after = listSplitBuckets(db).find((one) => one.id === first.id)

    expect(after?.name).toBe('Groceries')
    expect(after?.targetKind).toBe('CATEGORY')
    expect(after?.targetId).toBe('cat:1')
  })

  it('counts what would be lost before a bucket is deleted, then cascades', async () => {
    const db = await seeded()
    const loaded = defaultSplitPlan(db)
    const first = listSplitBuckets(db)[0]
    if (loaded === undefined || first === undefined) throw new Error('bad fixture')

    duplicateSplitPlan(db, loaded.plan.id, 'Bonus month', 2)
    expect(bucketUsageCounts(db).get(first.id)).toBe(2)

    // Cascaded rather than refused: an allocation is a plan for money that has
    // not moved, so a destination that no longer exists has no history to lose.
    deleteSplitBucket(db, first.id, 3)
    expect(listSplitBuckets(db).map((one) => one.id)).not.toContain(first.id)
    expect(findSplitPlan(db, loaded.plan.id)?.allocations).toHaveLength(2)
    expect(bucketUsageCounts(db).get(first.id)).toBeUndefined()
  })
})

describe('bucketActuals', () => {
  const NOW = 1_755_000_000_000
  const ACCOUNT = 'acc-1'
  const PERIOD = { year: 2026, month: 7 }
  /** Read in August, so July is a finished month. */
  const AS_OF = localDate(2026, 8, 12)

  function charge(id: string, minor: number): InsertableTransaction {
    return {
      accountId: ACCOUNT,
      transactionDate: localDate(2026, 7, 9),
      chargeDate: undefined,
      billingPeriod: undefined,
      amount: money(minor, ILS),
      direction: 'OUTFLOW',
      merchantRaw: 'שופרסל',
      merchantNormalized: 'שופרסל',
      providerCategory: undefined,
      cardLast4: undefined,
      reference: undefined,
      note: undefined,
      installment: undefined,
      foreign: undefined,
      naturalKey: id,
      importSessionId: undefined,
      sourceRowRef: undefined,
      id,
    }
  }

  /** A document with one of each thing a bucket can point at, and July activity. */
  async function withEverything() {
    const db = await createLedgerDatabase()
    createAccount(db, { name: 'Hapoalim', kind: 'BANK', last4: '4321' }, NOW)
    db.run("UPDATE fmt_account SET id = ? WHERE last4 = '4321'", [ACCOUNT])

    const food = createCategory(db, { name: 'Food', kind: 'EXPENSE' }, NOW)
    const restaurants = createCategory(
      db,
      { name: 'Restaurants', kind: 'EXPENSE', parentId: food },
      NOW,
    )

    insertTransaction(db, charge('t1', -60_000), NOW)
    insertTransaction(db, charge('t2', -25_000), NOW)
    setCategoryManually(db, 't1', food, NOW)
    setCategoryManually(db, 't2', restaurants, NOW)

    const place = createHoldingPlace(db, { name: 'Bank', kind: 'CHECKING' }, NOW)
    const holding = createHolding(
      db,
      { holdingPlaceId: place.id, name: 'Cash', kind: 'CASH', provenance: 'RECORDED', isLiquid: true },
      NOW,
    )
    const goal = createGoal(
      db,
      { name: 'House', kind: 'LONG_TERM', defaultHoldingId: holding.id },
      NOW,
    )
    addDeposit(
      db,
      {
        goalId: goal.id,
        date: localDate(2026, 7, 3),
        amount: money(150_000, ILS),
        holdingId: holding.id,
      },
      NOW,
    )
    // Already there when the goal opened: real money in the balance, and not
    // this month's saving (D-081).
    addDeposit(
      db,
      {
        goalId: goal.id,
        date: localDate(2026, 7, 4),
        amount: money(900_000, ILS),
        holdingId: holding.id,
        sourceKind: 'OPENING_BALANCE',
      },
      NOW,
    )

    const debt = createDebt(
      db,
      {
        name: 'Car loan',
        kind: 'BANK_LOAN',
        principalAmount: money(5_000_000, ILS),
        openedDate: localDate(2026, 1, 1),
      },
      NOW,
    )
    addPayment(
      db,
      { debtId: debt.id, date: localDate(2026, 7, 20), amount: money(200_000, ILS) },
      NOW,
    )
    // August, so it is not this month's payment.
    addPayment(
      db,
      { debtId: debt.id, date: localDate(2026, 8, 20), amount: money(200_000, ILS) },
      NOW,
    )

    return { db, food, restaurants, goalId: goal.id, debtId: debt.id }
  }

  it('measures each kind from the place that owns it', async () => {
    const { db, food, restaurants, goalId, debtId } = await withEverything()

    const buckets = [
      createSplitBucket(db, { name: 'Food', targetKind: 'CATEGORY', targetId: food }, NOW),
      createSplitBucket(db, { name: 'House', targetKind: 'SAVING_GOAL', targetId: goalId }, NOW),
      createSplitBucket(db, { name: 'Car', targetKind: 'DEBT', targetId: debtId }, NOW),
      createSplitBucket(db, { name: 'Fun', targetKind: 'FREE' }, NOW),
    ]
    const known = new Set([food, restaurants, goalId, debtId])

    const { actuals } = bucketActuals(db, buckets, PERIOD, AS_OF, known, { currency: ILS })

    // Food's own ₪600 plus Restaurants' ₪250 underneath it (D-088).
    expect(actuals.get(idOf(buckets, 0))?.amount).toEqual(money(85_000, ILS))
    expect(actuals.get(idOf(buckets, 0))?.rowCount).toBe(2)
    // The contribution only — the opening balance is in the goal and is not saving.
    expect(actuals.get(idOf(buckets, 1))?.amount).toEqual(money(150_000, ILS))
    // July's payment, not August's.
    expect(actuals.get(idOf(buckets, 2))?.amount).toEqual(money(200_000, ILS))
    // FREE has nothing behind it, so it is absent rather than zero.
    expect(actuals.has(idOf(buckets, 3))).toBe(false)
  })

  it('measures a subcategory bucket as itself, not as its parent', async () => {
    const { db, food, restaurants } = await withEverything()
    const bucket = createSplitBucket(
      db,
      { name: 'Eating out', targetKind: 'CATEGORY', targetId: restaurants },
      NOW,
    )

    const { actuals } = bucketActuals(db, [bucket], PERIOD, AS_OF, new Set([food, restaurants]), {
      currency: ILS,
    })
    expect(actuals.get(bucket.id)?.amount).toEqual(money(25_000, ILS))
  })

  it('measures a bucket on a heading as everything under it, two levels down (M28 F29)', async () => {
    const { db, food, restaurants } = await withEverything()
    // A heading nothing is filed into directly, with Food under it and
    // Restaurants under that: it measured nothing while its line needed
    // spending of its own.
    const living = createCategory(db, { name: 'Daily life', kind: 'EXPENSE' }, NOW)
    reparentCategory(db, food, living, NOW)
    const bucket = createSplitBucket(db, { name: 'Daily life', targetKind: 'CATEGORY', targetId: living }, NOW)

    const { actuals } = bucketActuals(db, [bucket], PERIOD, AS_OF, new Set([living, food, restaurants]), {
      currency: ILS,
    })
    expect(actuals.get(bucket.id)?.amount).toEqual(money(85_000, ILS))
    expect(actuals.get(bucket.id)?.rowCount).toBe(2)
  })

  it('measures a real zero for a category nothing was filed under', async () => {
    const { db, food } = await withEverything()
    const empty = createCategory(db, { name: 'Trips abroad', kind: 'EXPENSE' }, NOW)
    const bucket = createSplitBucket(
      db,
      { name: 'Travel', targetKind: 'CATEGORY', targetId: empty },
      NOW,
    )

    const { actuals } = bucketActuals(db, [bucket], PERIOD, AS_OF, new Set([food, empty]), {
      currency: ILS,
    })
    // Present and zero: nothing went out, which is a fact rather than a gap.
    expect(actuals.get(bucket.id)?.amount).toEqual(money(0, ILS))
    expect(actuals.get(bucket.id)?.basis).toBe('CATEGORY_SPEND')
  })

  it('has nothing to measure once the bucket points at a category that is gone', async () => {
    const { db, food } = await withEverything()
    const bucket = createSplitBucket(
      db,
      { name: 'Gone', targetKind: 'CATEGORY', targetId: 'cat:deleted' },
      NOW,
    )

    expect(
      bucketActuals(db, [bucket], PERIOD, AS_OF, new Set([food]), { currency: ILS }).actuals.size,
    ).toBe(0)
  })

  it('leaves the ledger-backed figures out of a month nobody imported', async () => {
    const { db, food, goalId } = await withEverything()
    const spending = createSplitBucket(
      db,
      { name: 'Food', targetKind: 'CATEGORY', targetId: food },
      NOW,
    )
    const saving = createSplitBucket(
      db,
      { name: 'House', targetKind: 'SAVING_GOAL', targetId: goalId },
      NOW,
    )
    addDeposit(
      db,
      {
        goalId,
        date: localDate(2026, 5, 3),
        amount: money(50_000, ILS),
        holdingId: idOf(listHoldings(db), 0),
      },
      NOW,
    )

    // May: no statement was ever imported for it, but a deposit was recorded.
    const measured = bucketActuals(
      db,
      [spending, saving],
      { year: 2026, month: 5 },
      AS_OF,
      new Set([food, goalId]),
      { currency: ILS },
    )

    expect(measured.ledgerHasMonth).toBe(false)
    // Absent, not zero: the month did not cost nothing, it is unknown (D-087).
    expect(measured.actuals.has(spending.id)).toBe(false)
    // The deposit needs no statement, so it is measured either way.
    expect(measured.actuals.get(saving.id)?.amount).toEqual(money(50_000, ILS))
  })

  it('feeds the comparison the domain draws', async () => {
    const { db, food, restaurants } = await withEverything()
    const bucket = createSplitBucket(
      db,
      { name: 'Food', targetKind: 'CATEGORY', targetId: food },
      NOW,
    )
    const created = createSplitPlan(
      db,
      {
        name: 'July',
        currency: ILS,
        allocations: [{ bucketId: bucket.id, mode: 'FIXED_AMOUNT', amount: money(100_000, ILS) }],
      },
      NOW,
    )
    const loaded = findSplitPlan(db, created.id)
    if (loaded === undefined) throw new Error('plan did not survive')

    const result = computeSplit(
      loaded.plan,
      [bucket],
      loaded.allocations,
      money(1_000_000, ILS),
      { netOff: money(0, ILS), inSplit: money(0, ILS) },
    )
    const comparison = planVersusActual(
      result,
      PERIOD,
      bucketActuals(db, [bucket], PERIOD, AS_OF, new Set([food, restaurants]), { currency: ILS })
        .actuals,
      ILS,
    )

    // Planned ₪1,000, spent ₪850.
    expect(comparison.lines[0]?.verdict).toBe('UNDER')
    expect(comparison.variance).toEqual(money(-15_000, ILS))
  })
})

/** The nth bucket's id, without a non-null assertion in a file that forbids them. */
function idOf(buckets: readonly { readonly id: string }[], index: number): string {
  return buckets[index]?.id ?? ''
}
