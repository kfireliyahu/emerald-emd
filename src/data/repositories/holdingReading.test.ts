import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate, toISODate } from '@/core/time.ts'
import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { readingGrowth } from '@/domain/holdingReadings.ts'
import { createAccount } from './accountRepository.ts'
import { goalWorth, holdingPutIn, setGoalFeed } from './goalDepositRepository.ts'
import {
  deleteHoldingReading,
  HoldingReadingError,
  latestHoldingReading,
  listHoldingReadings,
  priceCheck,
  readingChecks,
  recordHoldingReading,
} from './holdingReadingRepository.ts'
import {
  cashHoldingOf,
  createGoal,
  createHolding,
  createHoldingPlace,
  goalDetail,
  listDeposits,
  setPlaceAccount,
  setTransactionHolding,
} from './savingsRepository.ts'
import { monthObservations } from './statisticsRepository.ts'
import type { InsertableTransaction } from './transactionRepository.ts'

const NOW = 1_755_000_000_000
const ils = (minor: number) => money(minor, 'ILS')
const AS_OF = localDate(2026, 8, 12)

async function setUp() {
  const db = await createLedgerDatabase()
  const bank = createAccount(db, { name: 'Checking', kind: 'BANK' }, NOW)
  const broker = createAccount(db, { name: 'Broker', kind: 'HOLDINGS' }, NOW)
  const place = createHoldingPlace(db, { name: 'Broker place', kind: 'INVESTMENT' }, NOW)
  setPlaceAccount(db, place.id, broker.id, NOW)
  const world = createHolding(
    db,
    { holdingPlaceId: place.id, name: 'World index', kind: 'SECURITY', provenance: 'TRANSCRIBED', isLiquid: true },
    NOW,
  )
  const house = createGoal(db, { name: 'House', kind: 'LONG_TERM', defaultHoldingId: world.id }, NOW)
  const row = (id: string, minor: number, accountId: string, month = 6, day = 5): InsertableTransaction => ({
    id,
    accountId,
    transactionDate: localDate(2026, month, day),
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
  insertTransaction(db, row('broker-in', 10_000_00, broker.id), NOW)
  insertTransaction(db, row('buy-world', -6_000_00, broker.id, 6, 6), NOW)
  setTransactionHolding(db, 'buy-world', { holdingId: world.id, quantityMicro: 12_000_000 }, NOW)
  setGoalFeed(db, house.id, { kind: 'HOLDING' }, NOW)
  return { db, bank, broker, place, world, house, row }
}

const growthOf = (db: Awaited<ReturnType<typeof setUp>>['db'], goalId: string) =>
  listDeposits(db, { goalId })
    .filter((one) => one.sourceKind === 'GROWTH')
    .map((one) => [toISODate(one.date), one.amount.minor] as const)
    .sort((a, b) => a[0].localeCompare(b[0]))

/**
 * M30 U5 (D-358): a dated reading of what a holding is worth. A goal fed by the
 * holding is worth its latest reading, with what went in beside it; growth is
 * derived and keyed by the reading; the reading checks the rows.
 */
describe('a reading of what a holding is worth (M30 U5)', () => {
  it('makes a goal worth its latest reading, can go down, and re-recording a day changes nothing', async () => {
    const { db, world, house } = await setUp()
    const june = {
      holdingId: world.id,
      asOf: localDate(2026, 6, 30),
      value: ils(6_300_00),
      quantityMicro: 12_000_000,
      costBasis: ils(6_000_00),
      priceMicro: 525_000_000,
      source: 'broker-2026-06.pdf',
    }
    expect(recordHoldingReading(db, june, {}, NOW)).toBe('CREATED')
    expect(growthOf(db, house.id)).toEqual([['2026-06-30', 300_00]])
    expect(goalDetail(db, house.id, AS_OF, 'ILS')?.balance).toEqual(ils(6_300_00))
    expect(goalWorth(db, house.id, 'ILS')).toEqual({ asOf: '2026-06-30', worth: ils(6_300_00), putIn: ils(6_000_00) })

    // The same figures again — an overlapping file — change nothing.
    expect(recordHoldingReading(db, june, {}, NOW)).toBe('UNCHANGED')
    expect(listHoldingReadings(db, world.id)).toHaveLength(1)

    // A month later it is worth less than went in, and that is what the goal says.
    recordHoldingReading(db, { holdingId: world.id, asOf: localDate(2026, 7, 31), value: ils(5_800_00) }, {}, NOW)
    expect(growthOf(db, house.id)).toEqual([
      ['2026-06-30', 300_00],
      ['2026-07-31', -500_00],
    ])
    expect(goalWorth(db, house.id, 'ILS')).toEqual({ asOf: '2026-07-31', worth: ils(5_800_00), putIn: ils(6_000_00) })

    // Other figures for a day that has a reading are refused by name, unless they correct it.
    const other = { ...june, value: ils(6_400_00) }
    expect(() => recordHoldingReading(db, other, {}, NOW)).toThrow(HoldingReadingError)
    expect(recordHoldingReading(db, other, { correct: true }, NOW)).toBe('CORRECTED')
    expect(growthOf(db, house.id)).toEqual([
      ['2026-06-30', 400_00],
      ['2026-07-31', -600_00],
    ])

    // A reading removed takes its growth with it.
    const july = latestHoldingReading(db, world.id)
    deleteHoldingReading(db, july?.id ?? '', NOW)
    expect(growthOf(db, house.id)).toEqual([['2026-06-30', 400_00]])

    // And a goal no longer fed by its holding keeps no growth from it.
    setGoalFeed(db, house.id, undefined, NOW)
    expect(growthOf(db, house.id)).toEqual([])
  })

  it('turns the cost check proved or failed, by the reading’s own day', async () => {
    const { db, world, row, broker } = await setUp()
    expect(holdingPutIn(db, world.id, 'ILS').check.kind).toBe('UNCHECKED')

    recordHoldingReading(
      db,
      { holdingId: world.id, asOf: localDate(2026, 6, 30), value: ils(6_100_00), costBasis: ils(6_000_00) },
      {},
      NOW,
    )
    // A buy after the reading is not counted against a cost that could not include it.
    insertTransaction(db, row('buy-later', -1_000_00, broker.id, 7, 2), NOW)
    setTransactionHolding(db, 'buy-later', { holdingId: world.id, quantityMicro: 2_000_000 }, NOW)
    const fed = holdingPutIn(db, world.id, 'ILS')
    expect(fed.check).toEqual({ kind: 'PROVED' })
    expect(fed.putIn).toEqual(ils(7_000_00))
    expect(fed.reading).toEqual({ asOf: '2026-06-30', rows: 1, putIn: ils(6_000_00) })

    recordHoldingReading(
      db,
      { holdingId: world.id, asOf: localDate(2026, 7, 31), value: ils(7_000_00), costBasis: ils(7_012_50) },
      {},
      NOW,
    )
    expect(holdingPutIn(db, world.id, 'ILS').check).toEqual({
      kind: 'FAILED',
      printed: ils(7_012_50),
      difference: ils(-12_50),
    })
  })

  it('checks quantity × price, which catches a price printed in agorot', async () => {
    const { db, world } = await setUp()
    const base = { holdingId: world.id, asOf: localDate(2026, 6, 30), value: ils(6_300_00), quantityMicro: 12_000_000 }
    recordHoldingReading(db, { ...base, priceMicro: 525_000_000 }, {}, NOW)
    const reading = latestHoldingReading(db, world.id)
    if (reading === undefined) throw new Error('no reading')
    expect(readingChecks(db, reading)).toMatchObject({
      quantity: { kind: 'PROVED' },
      price: { kind: 'PROVED' },
      cash: undefined,
    })
    // 52,500 agorot copied as shekels: a factor of a hundred, never inside the tolerance.
    expect(priceCheck(db, 12_000_000, 52_500_000_000, ils(6_300_00))).toMatchObject({ kind: 'FAILED', ours: ils(630_000_00) })
    expect(priceCheck(db, 12_000_000, undefined, ils(6_300_00)).kind).toBe('UNCHECKED')
    expect(
      readingChecks(db, { ...reading, quantityMicro: 11_000_000 }).quantity,
    ).toEqual({ kind: 'FAILED', ours: 12_000_000, printed: 11_000_000 })
  })

  it('checks the cash line against the account’s running balance, and keeps a value only', async () => {
    const { db, broker } = await setUp()
    const cash = cashHoldingOf(db, broker.id)
    if (cash === undefined) throw new Error('no cash holding')
    expect(() =>
      recordHoldingReading(
        db,
        { holdingId: cash.id, asOf: localDate(2026, 6, 30), value: ils(4_000_00), quantityMicro: 1_000_000 },
        {},
        NOW,
      ),
    ).toThrow(/value only/)

    recordHoldingReading(db, { holdingId: cash.id, asOf: localDate(2026, 6, 30), value: ils(4_000_00) }, {}, NOW)
    const right = latestHoldingReading(db, cash.id)
    if (right === undefined) throw new Error('no reading')
    expect(readingChecks(db, right).cash).toEqual({ kind: 'PROVED' })
    expect(readingChecks(db, { ...right, value: ils(4_010_00) }).cash).toEqual({
      kind: 'FAILED',
      ours: ils(4_000_00),
      printed: ils(4_010_00),
    })
  })

  it('counts nothing on an account with holdings as income: a bonus or interest is growth of its cash', async () => {
    const { db, bank, broker, row } = await setUp()
    insertTransaction(db, row('salary', 9_000_00, bank.id, 6, 1), NOW)
    insertTransaction(db, row('referral bonus', 100_00, broker.id, 6, 9), NOW)
    insertTransaction(db, row('interest', 3_21, broker.id, 6, 30), NOW)
    insertTransaction(db, row('fee rebate', 12_00, broker.id, 6, 30), NOW)
    const june = monthObservations(db, AS_OF)[0]
    expect(june?.inflow).toEqual(ils(9_000_00))
  })
})

describe('growth from readings, in the domain', () => {
  it('is each reading less what went in by its day, step by step', () => {
    const putIn = [
      { date: '2026-01-10', minor: 1_000_00, currency: 'ILS' },
      { date: '2026-03-10', minor: 500_00, currency: 'ILS' },
    ]
    const readings = [
      { id: 'b', asOf: '2026-04-01', value: ils(1_450_00) },
      { id: 'a', asOf: '2026-02-01', value: ils(1_100_00) },
      { id: 'usd', asOf: '2026-03-01', value: money(1, 'USD') },
    ]
    expect(readingGrowth(readings, putIn, 'ILS')).toEqual([
      { key: 'reading:a', date: '2026-02-01', minor: 100_00, currency: 'ILS' },
      { key: 'reading:b', date: '2026-04-01', minor: -150_00, currency: 'ILS' },
    ])
  })

})
