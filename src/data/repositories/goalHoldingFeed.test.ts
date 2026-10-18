import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { costBasisCheck } from '@/domain/goalDeposits.ts'
import { createAccount } from './accountRepository.ts'
import { createCategory, setCategoryManually } from './categoryRepository.ts'
import {
  goalDepositCategories,
  goalFeeds,
  goalHoldingFeeds,
  HoldingFeedError,
  holdingPutIn,
  setGoalFeed,
} from './goalDepositRepository.ts'
import {
  cashHoldingOf,
  createGoal,
  createHolding,
  createHoldingPlace,
  listDeposits,
  setPlaceAccount,
  setTransactionHolding,
} from './savingsRepository.ts'
import { monthObservations } from './statisticsRepository.ts'
import { listTransferPairs, setTransferDecisions, suggestTransfers } from './transferPairRepository.ts'
import type { InsertableTransaction } from './transactionRepository.ts'

/** A goal pointed at a Money moved category, or at nothing: `setGoalFeed` with a category. */
const setGoalDepositCategory = (db: Database, goalId: string, categoryId: string | undefined, now: number) =>
  setGoalFeed(db, goalId, categoryId === undefined ? undefined : { kind: 'CATEGORY', categoryId }, now)

const NOW = 1_755_000_000_000
const ils = (minor: number) => money(minor, 'ILS')

/**
 * M30 U4 (D-357): a goal is fed by one source — a Money moved category or the
 * rows that name its default holding — never both, so nothing counts twice.
 */
async function setUp() {
  const db = await createLedgerDatabase()
  const bank = createAccount(db, { name: 'Checking', kind: 'BANK' }, NOW)
  const broker = createAccount(db, { name: 'Broker', kind: 'HOLDINGS' }, NOW)
  const place = createHoldingPlace(db, { name: 'Broker place', kind: 'INVESTMENT' }, NOW)
  setPlaceAccount(db, place.id, broker.id, NOW)
  const security = (name: string) =>
    createHolding(db, { holdingPlaceId: place.id, name, kind: 'SECURITY', provenance: 'RECORDED', isLiquid: true }, NOW)
  const world = security('World index')
  const bonds = security('Bond fund')
  const house = createGoal(db, { name: 'House', kind: 'LONG_TERM', defaultHoldingId: world.id }, NOW)
  const school = createGoal(db, { name: 'School', kind: 'LONG_TERM', defaultHoldingId: bonds.id }, NOW)
  const toBroker = createCategory(db, { name: 'To the broker', kind: 'TRANSFER' }, NOW)
  const row = (id: string, minor: number, accountId: string, day = 5): InsertableTransaction => ({
    id,
    accountId,
    transactionDate: localDate(2026, 6, day),
    chargeDate: undefined,
    billingPeriod: undefined,
    amount: ils(minor),
    direction: minor < 0 ? 'OUTFLOW' : 'INFLOW',
    merchantRaw: id,
    merchantNormalized: id,
    providerCategory: undefined,
    cardLast4: undefined,
    reference: undefined,
    note: undefined,
    installment: undefined,
    foreign: undefined,
    naturalKey: id,
    importSessionId: undefined,
    sourceRowRef: undefined,
  })
  return { db, bank, broker, place, world, bonds, house, school, toBroker, row }
}

describe('a goal fed by its holding (M30 U4)', () => {
  it('one transfer that buys two holdings feeds two goals, each by its own rows, and the transfer feeds neither', async () => {
    const { db, bank, broker, world, bonds, house, school, toBroker, row } = await setUp()
    insertTransaction(db, row('bank-out', -10_000_00, bank.id), NOW)
    insertTransaction(db, row('broker-in', 10_000_00, broker.id), NOW)
    insertTransaction(db, row('buy-world', -6_000_00, broker.id, 6), NOW)
    insertTransaction(db, row('buy-bonds', -3_990_00, broker.id, 6), NOW)
    // The bank's end is filed as money moved, and both ends are one transfer (D-356).
    setCategoryManually(db, 'bank-out', toBroker, NOW)
    setCategoryManually(db, 'broker-in', toBroker, NOW)
    expect(suggestTransfers(db)).toBe(1)
    const [pair] = listTransferPairs(db)
    if (pair === undefined) throw new Error('no pair')
    setTransferDecisions(db, [{ pairId: pair.id, decision: 'PAIRED' }])
    setTransactionHolding(db, 'buy-world', { holdingId: world.id, quantityMicro: 12_000_000 }, NOW)
    setTransactionHolding(db, 'buy-bonds', { holdingId: bonds.id, quantityMicro: 40_000_000 }, NOW)

    setGoalFeed(db, house.id, { kind: 'HOLDING' }, NOW)
    setGoalFeed(db, school.id, { kind: 'HOLDING' }, NOW)

    const keyed = (goalId: string) =>
      listDeposits(db, { goalId }).map((one) => [one.sourceKind, one.amount.minor, one.holdingId])
    expect(keyed(house.id)).toEqual([['FROM_TRANSACTION', 6_000_00, world.id]])
    expect(keyed(school.id)).toEqual([['FROM_TRANSACTION', 3_990_00, bonds.id]])
    // Neither end of the transfer is a deposit anywhere.
    const everyDeposit = [...listDeposits(db, { goalId: house.id }), ...listDeposits(db, { goalId: school.id })]
    expect(everyDeposit).toHaveLength(2)

    expect(goalFeeds(db).get(house.id)).toEqual({ kind: 'HOLDING', id: world.id, name: 'World index' })

    // And the month saved the transfer once: the deposits the buys derived are that money again.
    const june = monthObservations(db, localDate(2026, 7, 1))[0]
    expect(june?.moved).toEqual(ils(10_000_00))
    expect(june?.deposited).toEqual(ils(0))
  })

  it('a category feed’s deposits are not counted in saved beside the moved row they came from', async () => {
    const { db, bank, house, toBroker, row } = await setUp()
    insertTransaction(db, row('bank-out', -2_000_00, bank.id), NOW)
    setCategoryManually(db, 'bank-out', toBroker, NOW)
    setGoalDepositCategory(db, house.id, toBroker, NOW)
    expect(listDeposits(db, { goalId: house.id })).toHaveLength(1)
    const june = monthObservations(db, localDate(2026, 7, 1))[0]
    expect(june?.moved).toEqual(ils(2_000_00))
    expect(june?.deposited).toEqual(ils(0))
  })

  it('a sale takes back what it returned, and a row that stops naming the holding takes its deposit with it', async () => {
    const { db, broker, world, house, row } = await setUp()
    insertTransaction(db, { ...row('buy', -5_000_00, broker.id), holdingId: world.id, quantityMicro: 10_000_000 }, NOW)
    insertTransaction(db, { ...row('sell', 1_200_00, broker.id, 20), holdingId: world.id, quantityMicro: -2_000_000 }, NOW)
    setGoalFeed(db, house.id, { kind: 'HOLDING' }, NOW)
    expect(listDeposits(db, { goalId: house.id }).map((one) => one.amount.minor).sort()).toEqual([-1_200_00, 5_000_00])

    setTransactionHolding(db, 'sell', undefined, NOW)
    expect(listDeposits(db, { goalId: house.id }).map((one) => one.amount.minor)).toEqual([5_000_00])
  })

  it('is one feed: choosing the holding drops the category, and choosing a category drops the holding', async () => {
    const { db, bank, broker, world, house, toBroker, row } = await setUp()
    insertTransaction(db, row('bank-out', -5_000_00, bank.id), NOW)
    setCategoryManually(db, 'bank-out', toBroker, NOW)
    insertTransaction(db, { ...row('buy', -5_000_00, broker.id), holdingId: world.id, quantityMicro: 10_000_000 }, NOW)

    setGoalDepositCategory(db, house.id, toBroker, NOW)
    expect(listDeposits(db, { goalId: house.id }).map((one) => one.sourceKind)).toEqual(['FROM_TRANSACTION'])
    expect(goalDepositCategories(db).get(house.id)).toBe(toBroker)

    // The same ₪5,000, once: the buy replaces the bank transfer rather than joining it.
    const switched = setGoalFeed(db, house.id, { kind: 'HOLDING' }, NOW)
    expect(switched).toBe(1)
    expect(goalDepositCategories(db).size).toBe(0)
    expect(goalHoldingFeeds(db).get(house.id)).toBe(world.id)
    expect(listDeposits(db, { goalId: house.id }).map((one) => one.amount.minor)).toEqual([5_000_00])

    setGoalDepositCategory(db, house.id, toBroker, NOW)
    expect(goalHoldingFeeds(db).size).toBe(0)
    expect(listDeposits(db, { goalId: house.id })).toHaveLength(1)

    setGoalFeed(db, house.id, undefined, NOW)
    expect(goalFeeds(db).size).toBe(0)
    expect(listDeposits(db, { goalId: house.id })).toHaveLength(0)
  })

  it('a category feed reads no held row, so a buy filed under it is not counted there too', async () => {
    const { db, broker, world, house, toBroker, row } = await setUp()
    insertTransaction(db, { ...row('buy', -5_000_00, broker.id), holdingId: world.id, quantityMicro: 10_000_000 }, NOW)
    setCategoryManually(db, 'buy', toBroker, NOW)
    setGoalDepositCategory(db, house.id, toBroker, NOW)
    expect(listDeposits(db, { goalId: house.id })).toHaveLength(0)
  })

  it('refuses a holding another goal reads, an account’s own cash, and a goal with no holding', async () => {
    const { db, broker, world, house } = await setUp()
    setGoalFeed(db, house.id, { kind: 'HOLDING' }, NOW)
    const twin = createGoal(db, { name: 'Twin', kind: 'LONG_TERM', defaultHoldingId: world.id }, NOW)
    expect(() => setGoalFeed(db, twin.id, { kind: 'HOLDING' }, NOW)).toThrow(HoldingFeedError)

    const cash = cashHoldingOf(db, broker.id)
    if (cash === undefined) throw new Error('no cash holding')
    const inCash = createGoal(db, { name: 'In cash', kind: 'SHORT_TERM', defaultHoldingId: cash.id }, NOW)
    expect(() => setGoalFeed(db, inCash.id, { kind: 'HOLDING' }, NOW)).toThrow(/own cash/)

    const bare = createGoal(db, { name: 'Bare', kind: 'SHORT_TERM' }, NOW)
    expect(() => setGoalFeed(db, bare.id, { kind: 'HOLDING' }, NOW)).toThrow(/holding/)
  })

  it('checks what the rows put in against a cost basis: unchecked until a reading prints one', async () => {
    const { db, broker, world, row } = await setUp()
    insertTransaction(db, { ...row('buy-1', -1_000_00, broker.id), holdingId: world.id, quantityMicro: 2_000_000 }, NOW)
    insertTransaction(db, { ...row('buy-2', -1_502_50, broker.id), holdingId: world.id, quantityMicro: 3_000_000 }, NOW)
    const fed = holdingPutIn(db, world.id, 'ILS')
    expect(fed.rows).toBe(2)
    expect(fed.putIn).toEqual(ils(2_502_50))
    expect(fed.check).toEqual({ kind: 'UNCHECKED', reason: 'No reading of what it cost has been recorded yet.' })

    expect(costBasisCheck(fed.putIn, ils(2_502_50))).toEqual({ kind: 'PROVED' })
    expect(costBasisCheck(fed.putIn, ils(2_500_00))).toEqual({
      kind: 'FAILED',
      printed: ils(2_500_00),
      difference: ils(2_50),
    })
    expect(costBasisCheck(fed.putIn, ils(2_502_50), 1).kind).toBe('UNCHECKED')
    expect(costBasisCheck(fed.putIn, money(2_502_50, 'USD')).kind).toBe('UNCHECKED')
  })
})
