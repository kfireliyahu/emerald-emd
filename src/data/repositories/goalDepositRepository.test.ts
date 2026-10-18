import type { Database } from 'sql.js'
import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { originSplit } from '@/domain/goalDeposits.ts'
import { createAccount } from './accountRepository.ts'
import { createCategory, setCategoryManually } from './categoryRepository.ts'
import {
  CategoryTakenError,
  NotMoneyMovedCategoryError,
  goalDepositCategories,
  fedDeposits,
  setGoalFeed,
} from './goalDepositRepository.ts'
import {
  addDeposit,
  createGoal,
  createHolding,
  createHoldingPlace,
  GoalHasNoHoldingError,
  goalDetail,
  listDeposits,
} from './savingsRepository.ts'
import { applySuggestions, planMonth } from './planMonthRepository.ts'
import { createSplitBucket, createSplitPlan } from './splitPlanRepository.ts'
import { insertTransactions, type InsertableTransaction } from './transactionRepository.ts'

/** A goal pointed at a Money moved category, or at nothing: `setGoalFeed` with a category. */
const setGoalDepositCategory = (db: Database, goalId: string, categoryId: string | undefined, now: number) =>
  setGoalFeed(db, goalId, categoryId === undefined ? undefined : { kind: 'CATEGORY', categoryId }, now)

const asOf = localDate(2026, 10, 3)

async function seeded() {
  const db = await createLedgerDatabase()
  const place = createHoldingPlace(db, { name: 'Bank', kind: 'CHECKING' }, 1)
  const holding = createHolding(
    db,
    { holdingPlaceId: place.id, name: 'Savings', kind: 'CASH', provenance: 'RECORDED', isLiquid: true },
    1,
  )
  const goal = createGoal(db, { name: 'Holiday', kind: 'SHORT_TERM', defaultHoldingId: holding.id }, 1)
  const bare = createGoal(db, { name: 'Laptop', kind: 'SHORT_TERM' }, 1)
  const account = createAccount(db, { name: 'Checking', kind: 'BANK' }, 1)
  const moved = createCategory(db, { name: 'To holiday', kind: 'TRANSFER' }, 1)
  const spending = createCategory(db, { name: 'Gadgets', kind: 'EXPENSE' }, 1)
  return { db, goal, bare, holding, account, moved, spending }
}

function transaction(accountId: string, id: string, minor: number, day: number): InsertableTransaction {
  return {
    id,
    accountId,
    transactionDate: localDate(2026, 9, day),
    chargeDate: undefined,
    billingPeriod: undefined,
    amount: money(minor, 'ILS'),
    direction: minor < 0 ? 'OUTFLOW' : 'INFLOW',
    merchantRaw: 'Transfer to savings',
    merchantNormalized: 'transfer to savings',
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

describe('a goal reads its deposits from a Money moved category', () => {
  it('turns transactions filed under the category into deposits, once', async () => {
    const { db, goal, account, moved } = await seeded()
    insertTransactions(db, [transaction(account.id, 't1', -213_100, 2), transaction(account.id, 't2', -190_000, 9)], 1)
    setCategoryManually(db, 't1', moved, 1)
    setCategoryManually(db, 't2', moved, 1)
    setGoalDepositCategory(db, goal.id, moved, 1)

    const derived = listDeposits(db, { goalId: goal.id })
    expect(derived.map((one) => [one.sourceKind, one.amount.minor]).sort()).toEqual([
      ['FROM_TRANSACTION', 190_000],
      ['FROM_TRANSACTION', 213_100],
    ])
    // Running it again changes nothing.
    expect(listDeposits(db, { goalId: goal.id })).toHaveLength(2)
  })

  it('a transaction filed elsewhere takes its deposit with it, and a late one arrives by itself', async () => {
    const { db, goal, account, moved, spending } = await seeded()
    insertTransactions(db, [transaction(account.id, 't1', -213_100, 2), transaction(account.id, 't2', -190_000, 9)], 1)
    setCategoryManually(db, 't1', moved, 1)
    setGoalDepositCategory(db, goal.id, moved, 1)
    expect(listDeposits(db, { goalId: goal.id })).toHaveLength(1)

    setCategoryManually(db, 't1', spending, 1)
    setCategoryManually(db, 't2', moved, 1)
    expect(listDeposits(db, { goalId: goal.id }).map((one) => one.amount.minor)).toEqual([190_000])
  })

  it('a withdrawal back from the goal reduces it', async () => {
    const { db, goal, account, moved } = await seeded()
    insertTransactions(db, [transaction(account.id, 't1', -300_000, 2), transaction(account.id, 't2', 100_000, 9)], 1)
    setCategoryManually(db, 't1', moved, 1)
    setCategoryManually(db, 't2', moved, 1)
    setGoalDepositCategory(db, goal.id, moved, 1)
    const split = originSplit(listDeposits(db, { goalId: goal.id }), 'ILS')
    expect(split.DERIVED.minor).toBe(200_000)
  })

  it('stopping removes only what it derived, never a set-aside or an opening deposit', async () => {
    const { db, goal, account, moved, holding } = await seeded()
    insertTransactions(db, [transaction(account.id, 't1', -213_100, 2)], 1)
    setCategoryManually(db, 't1', moved, 1)
    addDeposit(db, { goalId: goal.id, date: asOf, amount: money(50_000, 'ILS'), holdingId: holding.id, sourceKind: 'MANUAL' }, 1)
    addDeposit(db, { goalId: goal.id, date: asOf, amount: money(900_000, 'ILS'), holdingId: holding.id, sourceKind: 'OPENING_BALANCE' }, 1)
    setGoalDepositCategory(db, goal.id, moved, 1)
    expect(listDeposits(db, { goalId: goal.id })).toHaveLength(3)

    const stopped = setGoalDepositCategory(db, goal.id, undefined, 1)
    expect(stopped).toBe(0)
    expect(goalDepositCategories(db).size).toBe(0)
    expect(listDeposits(db, { goalId: goal.id }).map((one) => one.sourceKind).sort()).toEqual(['MANUAL', 'OPENING_BALANCE'])
  })

  it('refuses a spending category, a taken one, and a goal with nowhere to hold the money', async () => {
    const { db, goal, bare, moved, spending } = await seeded()
    expect(() => setGoalDepositCategory(db, goal.id, spending, 1)).toThrow(NotMoneyMovedCategoryError)
    expect(() => setGoalDepositCategory(db, bare.id, moved, 1)).toThrow(GoalHasNoHoldingError)
    setGoalDepositCategory(db, goal.id, moved, 1)
    const other = createGoal(db, { name: 'Car', kind: 'SHORT_TERM', defaultHoldingId: goal.defaultHoldingId }, 1)
    expect(() => setGoalDepositCategory(db, other.id, moved, 1)).toThrow(CategoryTakenError)
  })

  it('works out nothing in a document where no goal has a feed', async () => {
    const { db } = await seeded()
    expect(fedDeposits(db)).toEqual([])
  })
})

describe('Use for the month and a goal real money already feeds (M28 F27)', () => {
  it('writes no planned deposit into a fed goal, so its balance is its bank transfers', async () => {
    const { db, goal, holding, account, moved } = await seeded()
    const plain = createGoal(db, { name: 'Car', kind: 'SHORT_TERM', defaultHoldingId: holding.id }, 1)
    insertTransactions(db, [transaction(account.id, 't1', -150_000, 2)], 1)
    setCategoryManually(db, 't1', moved, 1)
    setGoalDepositCategory(db, goal.id, moved, 1)

    const toHoliday = createSplitBucket(db, { name: 'Holiday', targetKind: 'SAVING_GOAL', targetId: goal.id }, 1)
    const toCar = createSplitBucket(db, { name: 'Car', targetKind: 'SAVING_GOAL', targetId: plain.id }, 1)
    const plan = createSplitPlan(
      db,
      {
        name: 'Everyday',
        currency: 'ILS',
        basisKind: 'CUSTOM_AMOUNT',
        customAmount: money(1_000_000, 'ILS'),
        isDefault: true,
        allocations: [
          { bucketId: toHoliday.id, mode: 'FIXED_AMOUNT', amount: money(150_000, 'ILS') },
          { bucketId: toCar.id, mode: 'FIXED_AMOUNT', amount: money(80_000, 'ILS') },
        ],
      },
      1,
    )
    const month = { year: 2026, month: 9 }
    const pm = planMonth(db, { planId: plan.id, month, asOf })
    expect(pm?.applied.suggestions.find((one) => one.targetId === goal.id)?.fedBy).toEqual({
      kind: 'CATEGORY',
      id: moved,
      name: 'To holiday',
    })

    // Every suggestion, the fed one included: the write refuses it, not only the screen.
    applySuggestions(db, plan.id, month, pm?.applied.suggestions ?? [], 1)

    const fed = listDeposits(db, { goalId: goal.id })
    expect(fed.map((one) => one.sourceKind)).toEqual(['FROM_TRANSACTION'])
    expect(goalDetail(db, goal.id, asOf, 'ILS')?.balance.minor).toBe(150_000)
    // A goal nothing feeds still takes the plan's deposit.
    expect(listDeposits(db, { goalId: plain.id }).map((one) => [one.sourceKind, one.amount.minor])).toEqual([
      ['FROM_PLAN', 80_000],
    ])
  })
})
