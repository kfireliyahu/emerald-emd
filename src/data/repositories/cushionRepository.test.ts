import type { Database } from 'sql.js'
import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { createAccount } from './accountRepository.ts'
import {
  BadCushionMonthsError,
  NotACushionAccountError,
  cushionReading,
  setCushionAccounts,
  setCushionBuckets,
  setCushionMonths,
} from './cushionRepository.ts'
import { createFixedExpense, type NewFixedExpense } from './fixedExpenseRepository.ts'
import { createSession, setBalanceCheck, setSessionStatus } from './importSessionRepository.ts'
import { addDeposit, createGoal, createHoldingPlace, documentMoneyMap, listGoals, setPlaceAccount } from './savingsRepository.ts'
import { createSplitBucket, createSplitPlan } from './splitPlanRepository.ts'
import { insertTransactions } from './transactionRepository.ts'

const asOf = localDate(2026, 10, 3)
const ils = (minor: number) => money(minor, 'ILS')

/** A bank account whose one verified statement ends at `closing`. */
function bank(db: Database, name: string, closing: number) {
  const account = createAccount(db, { name, kind: 'BANK' }, 1)
  const session = `s-${account.id}`
  insertTransactions(
    db,
    [
      {
        id: `t-${account.id}`,
        accountId: account.id,
        transactionDate: localDate(2026, 9, 30),
        chargeDate: undefined,
        billingPeriod: undefined,
        amount: ils(-100),
        direction: 'OUTFLOW',
        merchantRaw: 'x',
        merchantNormalized: 'x',
        providerCategory: undefined,
        cardLast4: undefined,
        reference: undefined,
        note: undefined,
        installment: undefined,
        foreign: undefined,
        naturalKey: `t-${account.id}`,
        importSessionId: session,
        sourceRowRef: undefined,
      },
    ],
    1,
  )
  createSession(db, { id: session, accountId: account.id, mappingId: undefined, fileName: `${name}.xlsx`, fileHash: session, sheetName: undefined }, 1)
  setBalanceCheck(
    db,
    session,
    { kind: 'VERIFIED', order: 'OLDEST_FIRST', openingBalance: ils(closing + 100), closingBalance: ils(closing), rowCount: 1 },
    1,
  )
  setSessionStatus(db, session, 'COMMITTED', 2)
  const place = createHoldingPlace(db, { name, kind: 'CHECKING' }, 1)
  const cash = setPlaceAccount(db, place.id, account.id, 1).cashHolding
  if (cash === undefined) throw new Error('no cash holding')
  return { account, cash }
}

function save(db: Database, name: string, holdingId: string, minor: number) {
  const goal = listGoals(db).find((one) => one.name === name) ?? createGoal(db, { name, kind: 'SHORT_TERM', defaultHoldingId: holdingId }, 1)
  addDeposit(db, { goalId: goal.id, date: asOf, amount: ils(minor), holdingId, sourceKind: 'OPENING_BALANCE' }, 1)
  return goal
}

describe('the cushion is what is left in the bank (M30 U7, D-360)', () => {
  it('splits the ticked accounts between the goals saved there and the cushion', async () => {
    const db = await createLedgerDatabase()
    const current = bank(db, 'Current', 3_145_218)
    const savings = bank(db, 'Savings', 1_674_800)
    const joint = bank(db, 'Joint', 521_340)
    save(db, 'Car', savings.cash.id, 1_200_000)
    save(db, 'Wedding', current.cash.id, 850_000)
    setCushionAccounts(db, [{ accountId: joint.account.id, counts: false }], 1)
    setCushionMonths(db, 3, 1)
    createFixedExpense(db, FIXED_RENT, 1)

    const reading = cushionReading(db, asOf, 'ILS')
    expect(reading.accounts.map((one) => [one.name, one.counts])).toEqual([
      ['Current', true],
      ['Joint', false],
      ['Savings', true],
    ])
    expect(reading.split.balance).toEqual(ils(4_820_018))
    expect(reading.split.parts.map((one) => [one.goalName, one.amount.minor])).toEqual([
      ['Car', 1_200_000],
      ['Wedding', 850_000],
    ])
    expect(reading.split.check).toEqual({ kind: 'ADDS_UP' })
    expect(reading.split.left).toEqual(ils(2_770_018))
    expect(reading.target).toEqual(ils(1_500_000))
    expect(reading.above).toEqual(ils(1_270_018))
  })

  it("is each ticked account's Cash, not for any goal, which Net worth shows under it (M36 F3)", async () => {
    const db = await createLedgerDatabase()
    const current = bank(db, 'Current', 3_145_218)
    const savings = bank(db, 'Savings', 1_674_800)
    const joint = bank(db, 'Joint', 521_340)
    save(db, 'Car', savings.cash.id, 1_200_000)
    save(db, 'Wedding', current.cash.id, 850_000)
    setCushionAccounts(db, [{ accountId: joint.account.id, counts: false }], 1)

    const { accounts, split } = cushionReading(db, asOf, 'ILS')
    const ticked = new Set(accounts.filter((one) => one.counts).map((one) => one.accountId))
    const cash = documentMoneyMap(db, 'ILS')
      .places.filter((row) => row.place?.accountId !== undefined && ticked.has(row.place.accountId))
      .map((row) => row.statement?.cash?.minor ?? 0)
    expect(cash.sort((a, b) => a - b)).toEqual([474_800, 2_295_218])
    expect(cash.reduce((sum, one) => sum + one, 0)).toBe(split.left?.minor)
  })

  it('says the goals hold more than is there, in the whole and per account, and shrinks nothing', async () => {
    const db = await createLedgerDatabase()
    const current = bank(db, 'Current', 1_120_650)
    const savings = bank(db, 'Savings', 709_350)
    save(db, 'Car', savings.cash.id, 1_200_000)
    save(db, 'Wedding', current.cash.id, 870_000)
    setCushionAccounts(db, [current, savings].map((one) => ({ accountId: one.account.id, counts: true })), 1)
    setCushionMonths(db, 3, 1)
    createFixedExpense(db, FIXED_RENT, 1)

    const { split, above } = cushionReading(db, asOf, 'ILS')
    expect(split.check).toEqual({ kind: 'OVER', by: ils(240_000) })
    expect(split.left).toBeUndefined()
    expect(above).toBeUndefined()
    expect(split.short.map((one) => [one.name, one.by.minor])).toEqual([['Savings', 490_650]])
  })

  it('names an account that is short even when the whole adds up, and keeps the cushion', async () => {
    const db = await createLedgerDatabase()
    const current = bank(db, 'Current', 5_000_000)
    const savings = bank(db, 'Savings', 100_000)
    save(db, 'Car', savings.cash.id, 300_000)
    setCushionAccounts(db, [current, savings].map((one) => ({ accountId: one.account.id, counts: true })), 1)

    const { split } = cushionReading(db, asOf, 'ILS')
    expect(split.check).toEqual({ kind: 'ADDS_UP' })
    expect(split.left).toEqual(ils(4_800_000))
    expect(split.short.map((one) => [one.name, one.parts.minor, one.balance.minor, one.by.minor])).toEqual([
      ['Savings', 300_000, 100_000, 200_000],
    ])
  })

  it('counts every bank account until it is unticked, and no goal saved in an unticked one (D-371)', async () => {
    const db = await createLedgerDatabase()
    const current = bank(db, 'Current', 2_261_430)
    const joint = bank(db, 'Joint', 521_340)
    save(db, 'Holiday', joint.cash.id, 300_000)
    const before = cushionReading(db, asOf, 'ILS')
    expect(before.accounts.every((one) => one.counts)).toBe(true)
    expect(before.split.balance).toEqual(ils(2_782_770))

    setCushionAccounts(db, [{ accountId: joint.account.id, counts: false }], 1)
    const { split } = cushionReading(db, asOf, 'ILS')
    expect(split.parts).toEqual([])
    expect(split.left).toEqual(ils(2_261_430))

    setCushionAccounts(db, [{ accountId: current.account.id, counts: false }], 1)
    expect(cushionReading(db, asOf, 'ILS').split.check).toEqual({ kind: 'NO_ACCOUNTS' })
  })

  it('leaves the split unchecked when a ticked account has no statement balance', async () => {
    const db = await createLedgerDatabase()
    const current = bank(db, 'Current', 2_000_000)
    const bare = createAccount(db, { name: 'New', kind: 'BANK' }, 1)
    setCushionAccounts(
      db,
      [
        { accountId: current.account.id, counts: true },
        { accountId: bare.id, counts: true },
      ],
      1,
    )
    const { split } = cushionReading(db, asOf, 'ILS')
    expect(split.check).toEqual({ kind: 'UNCHECKED', withoutBalance: ['New'] })
    expect(split.balance).toBeUndefined()
    expect(split.left).toBeUndefined()
  })

  it('refuses a card, and an account with holdings, as the bank', async () => {
    const db = await createLedgerDatabase()
    const card = createAccount(db, { name: 'Visa', kind: 'CREDIT_CARD' }, 1)
    const broker = createAccount(db, { name: 'Broker', kind: 'HOLDINGS' }, 1)
    expect(() => setCushionAccounts(db, [{ accountId: card.id, counts: true }], 1)).toThrow(NotACushionAccountError)
    expect(() => setCushionAccounts(db, [{ accountId: broker.id, counts: true }], 1)).toThrow(NotACushionAccountError)
  })
})

describe('the cushion’s target', () => {
  it('sets the months without making a goal, and refuses a count that cannot be a cushion', async () => {
    const db = await createLedgerDatabase()
    expect(cushionReading(db, asOf, 'ILS').months).toBeUndefined()
    setCushionMonths(db, 3, 1)
    setCushionMonths(db, 4.5, 1)
    expect(cushionReading(db, asOf, 'ILS').months).toBe(4.5)
    expect(listGoals(db)).toEqual([])
    expect(() => setCushionMonths(db, 0, 1)).toThrow(BadCushionMonthsError)
    expect(() => setCushionMonths(db, 40, 1)).toThrow(BadCushionMonthsError)
  })

  it('has no amount until the document knows its fixed expenses, then multiplies them', async () => {
    const db = await createLedgerDatabase()
    setCushionMonths(db, 3, 1)
    expect(cushionReading(db, asOf, 'ILS').target).toBeUndefined()
    createFixedExpense(db, FIXED_RENT, 1)
    expect(cushionReading(db, asOf, 'ILS').target).toEqual(ils(1_500_000))
  })

  it('counts a ticked Plan bucket among the months, beside the fixed expenses (M28 F10)', async () => {
    const db = await createLedgerDatabase()
    setCushionMonths(db, 3, 1)
    createFixedExpense(db, FIXED_RENT, 1)
    const groceries = createSplitBucket(db, { name: 'Groceries', targetKind: 'FREE' }, 1)
    const goal = createGoal(db, { name: 'Car', kind: 'SHORT_TERM' }, 1)
    const toCar = createSplitBucket(db, { name: 'Car', targetKind: 'SAVING_GOAL', targetId: goal.id }, 1)
    createSplitPlan(
      db,
      {
        name: 'Everyday',
        currency: 'ILS',
        basisKind: 'CUSTOM_AMOUNT',
        customAmount: ils(1_000_000),
        isDefault: true,
        allocations: [
          { bucketId: groceries.id, mode: 'FIXED_AMOUNT', amount: ils(200_000) },
          { bucketId: toCar.id, mode: 'FIXED_AMOUNT', amount: ils(100_000) },
        ],
      },
      1,
    )

    const before = cushionReading(db, asOf, 'ILS')
    expect(before.target?.minor).toBe(1_500_000)
    // Money put toward a goal is saved, not spent, and is never offered.
    expect(before.buckets.map((one) => [one.name, one.included, one.amount.minor])).toEqual([['Groceries', false, 200_000]])

    setCushionBuckets(db, [{ bucketId: groceries.id, included: true }], 1)
    expect(cushionReading(db, asOf, 'ILS').target?.minor).toBe(3 * (500_000 + 200_000))
    setCushionBuckets(db, [{ bucketId: groceries.id, included: false }], 1)
    expect(cushionReading(db, asOf, 'ILS').target?.minor).toBe(1_500_000)
    expect(() => setCushionBuckets(db, [{ bucketId: 'nope', included: true }], 1)).toThrow()
  })

  it('is met or short with one choice, the months, once there are statements and bills (M31 U5)', async () => {
    const db = await createLedgerDatabase()
    bank(db, 'Current', 1_200_000)
    createFixedExpense(db, FIXED_RENT, 1)
    expect(cushionReading(db, asOf, 'ILS').above).toBeUndefined()

    setCushionMonths(db, 3, 1)
    expect(cushionReading(db, asOf, 'ILS').above).toEqual(ils(-300_000))
    setCushionMonths(db, 2, 1)
    expect(cushionReading(db, asOf, 'ILS').above).toEqual(ils(200_000))
  })
})

const FIXED_RENT: NewFixedExpense = {
  name: 'Rent',
  expectedAmount: money(500_000, 'ILS'),
  cadence: 'MONTHLY',
  amountVariability: 'FIXED',
  matchKind: 'MANUAL_ONLY',
  source: 'USER_DEFINED',
  isDiscretionary: false,
}
