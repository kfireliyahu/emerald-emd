import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { createAccount } from './accountRepository.ts'
import { setGoalFeed } from './goalDepositRepository.ts'
import { addDeposit } from './savingsRepository.ts'
import { holdingWorths, recordHoldingReading } from './holdingReadingRepository.ts'
import { netWorth } from './netWorthRepository.ts'
import {
  cashHoldingOf,
  createGoal,
  createHolding,
  createHoldingPlace,
  documentMoneyMap,
  goalDetail,
  savingsSummary,
  setPlaceAccount,
  setTransactionHolding,
  staleHoldings,
} from './savingsRepository.ts'
import type { InsertableTransaction } from './transactionRepository.ts'

const NOW = 1_755_000_000_000
const ils = (minor: number) => money(minor, 'ILS')
const AS_OF = localDate(2026, 8, 12)

/**
 * A broker with two positions — one a goal follows, one no goal follows — and its
 * own cash, read on 30 June; one more buy after the reading.
 */
async function setUp() {
  const db = await createLedgerDatabase()
  const broker = createAccount(db, { name: 'Broker', kind: 'HOLDINGS' }, NOW)
  const place = createHoldingPlace(db, { name: 'Broker place', kind: 'INVESTMENT' }, NOW)
  setPlaceAccount(db, place.id, broker.id, NOW)
  const holding = (name: string) =>
    createHolding(db, { holdingPlaceId: place.id, name, kind: 'SECURITY', provenance: 'TRANSCRIBED', isLiquid: true }, NOW)
  const world = holding('World index')
  const spare = holding('Spare index')
  const house = createGoal(db, { name: 'House', kind: 'LONG_TERM', defaultHoldingId: world.id }, NOW)
  const row = (id: string, minor: number, month: number, day: number): InsertableTransaction => ({
    id,
    accountId: broker.id,
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
  insertTransaction(db, row('broker-in', 10_000_00, 6, 5), NOW)
  insertTransaction(db, row('buy-world', -6_000_00, 6, 6), NOW)
  insertTransaction(db, row('buy-spare', -2_000_00, 6, 6), NOW)
  insertTransaction(db, row('buy-spare-later', -500_00, 7, 10), NOW)
  setTransactionHolding(db, 'buy-world', { holdingId: world.id, quantityMicro: 12_000_000 }, NOW)
  setTransactionHolding(db, 'buy-spare', { holdingId: spare.id, quantityMicro: 4_000_000 }, NOW)
  setTransactionHolding(db, 'buy-spare-later', { holdingId: spare.id, quantityMicro: 1_000_000 }, NOW)
  setGoalFeed(db, house.id, { kind: 'HOLDING' }, NOW)
  const cash = cashHoldingOf(db, broker.id)
  if (cash === undefined) throw new Error('no cash holding')
  const june = localDate(2026, 6, 30)
  recordHoldingReading(db, { holdingId: world.id, asOf: june, value: ils(6_500_00) }, {}, NOW)
  recordHoldingReading(db, { holdingId: spare.id, asOf: june, value: ils(2_300_00) }, {}, NOW)
  recordHoldingReading(db, { holdingId: cash.id, asOf: june, value: ils(2_000_00) }, {}, NOW)
  return { db, place, world, spare, cash, house }
}

/**
 * M30 F5: a holding with readings is worth its latest reading, and its growth is
 * the reading less what went in — whether or not a goal follows it. Before, a
 * holding was Σ its goal deposits, so a position no goal followed showed 0.
 */
describe('a holding with a reading is worth it, goal or none (M30 F5)', () => {
  it('is the reading plus what moved after it, with growth on what went in', async () => {
    const { db, world, spare, cash } = await setUp()
    const worths = holdingWorths(db, 'ILS')
    expect(worths.get(spare.id)).toEqual({
      holdingId: spare.id,
      asOf: '2026-06-30',
      reading: ils(2_300_00),
      worth: ils(2_800_00),
      putIn: ils(2_500_00),
      growth: ils(300_00),
    })
    expect(worths.get(world.id)?.growth).toEqual(ils(500_00))
    // An account's own cash: the reading less the buy after it, and no growth.
    expect(worths.get(cash.id)).toMatchObject({ worth: ils(1_500_00), putIn: undefined, growth: undefined })
  })

  it('shows on the money map and in savings, and the goal that follows one is unchanged', async () => {
    const { db, place, spare, house } = await setUp()
    const map = documentMoneyMap(db, 'ILS')
    const row = map.places.find((one) => one.holdingPlaceId === place.id)
    expect(row?.holdings.find((one) => one.holdingId === spare.id)?.balance).toEqual(ils(2_800_00))
    expect(row?.balance).toEqual(ils(6_500_00 + 2_800_00 + 1_500_00))
    expect(map.worths.get(spare.id)?.asOf).toBe('2026-06-30')

    const summary = savingsSummary(db, AS_OF, 'ILS')
    expect(summary.liquidity.total).toEqual(ils(10_800_00))
    expect(summary.inGoals).toEqual(ils(6_500_00))
    expect(goalDetail(db, house.id, AS_OF, 'ILS')?.balance).toEqual(ils(6_500_00))
  })

  it('counts once in net worth, from the readings', async () => {
    const { db } = await setUp()
    const read = netWorth(db, AS_OF, 'ILS')
    expect(read.worth).toEqual(ils(10_800_00))
    // Held at a broker: reachable and not in the bank, from the readings.
    expect([read.inBank, read.held, read.locked]).toEqual([ils(0), ils(10_800_00), ils(0)])
  })

  it('takes a reading as somebody counting it', async () => {
    const { db } = await setUp()
    expect(staleHoldings(db, AS_OF, 'ILS')).toEqual([])
  })
})

describe('what a holding is worth, declared (M36 U05)', () => {
  it('counts what a person put in by hand as put in, before the reading and after it (D-381)', async () => {
    const { db, place } = await setUp()
    const box = createHolding(db, { holdingPlaceId: place.id, name: 'Box', kind: 'DEPOSIT', provenance: 'RECORDED', isLiquid: true }, NOW)
    const goal = createGoal(db, { name: 'Rainy day', kind: 'EMERGENCY', defaultHoldingId: box.id }, NOW)
    addDeposit(db, { goalId: goal.id, date: localDate(2026, 6, 1), amount: ils(5_000_00), holdingId: box.id }, NOW)
    recordHoldingReading(db, { holdingId: box.id, asOf: localDate(2026, 6, 30), value: ils(5_400_00) }, {}, NOW)
    expect(holdingWorths(db, 'ILS').get(box.id)).toMatchObject({ worth: ils(5_400_00), putIn: ils(5_000_00), growth: ils(400_00) })

    // Put in after the reading: in the worth and in what went in, so the growth stands.
    addDeposit(db, { goalId: goal.id, date: localDate(2026, 7, 1), amount: ils(300_00), holdingId: box.id, sourceKind: 'FROM_PLAN', sourceRefId: 'p' }, NOW)
    expect(holdingWorths(db, 'ILS').get(box.id)).toMatchObject({ worth: ils(5_700_00), putIn: ils(5_300_00), growth: ils(400_00) })
  })

  it('passes over a holding whose latest reading is in another currency, and one with none', async () => {
    const { db, place, world } = await setUp()
    const abroad = createHolding(db, { holdingPlaceId: place.id, name: 'Abroad', kind: 'SECURITY', provenance: 'RECORDED', isLiquid: true }, NOW)
    recordHoldingReading(db, { holdingId: abroad.id, asOf: localDate(2026, 6, 30), value: money(100_00, 'USD') }, {}, NOW)
    const worths = holdingWorths(db, 'ILS')
    expect(worths.has(abroad.id)).toBe(false)
    expect(worths.has(world.id)).toBe(true)
  })
})
