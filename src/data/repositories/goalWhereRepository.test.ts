import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { createAccount } from './accountRepository.ts'
import { createCategory } from './categoryRepository.ts'
import { goalFeeds } from './goalDepositRepository.ts'
import { GoalAnswerError, makePlace, saveGoalAnswer, whereChoices } from './goalWhereRepository.ts'
import {
  cashHoldingOf,
  createHolding,
  createHoldingPlace,
  findGoal,
  listDeposits,
  listHoldingPlaces,
  listHoldings,
  setPlaceAccount,
  setTransactionHolding,
} from './savingsRepository.ts'
import type { InsertableTransaction } from './transactionRepository.ts'

const NOW = 1_755_000_000_000
const ils = (minor: number) => money(minor, 'ILS')
const DAY = localDate(2026, 10, 5)

/** A bank account, a broker with two holdings, an envelope kept by hand (M30 F3). */
async function setUp() {
  const db = await createLedgerDatabase()
  const bank = createAccount(db, { name: 'Current', kind: 'BANK', last4: '1234' }, NOW)
  const broker = createAccount(db, { name: 'Broker', kind: 'HOLDINGS' }, NOW)
  const brokerPlace = createHoldingPlace(db, { name: 'Broker', kind: 'INVESTMENT' }, NOW)
  setPlaceAccount(db, brokerPlace.id, broker.id, NOW)
  const security = (name: string) =>
    createHolding(db, { holdingPlaceId: brokerPlace.id, name, kind: 'SECURITY', provenance: 'RECORDED', isLiquid: true }, NOW)
  const world = security('World ETF')
  const bonds = security('Bond fund')
  const home = createHoldingPlace(db, { name: 'Envelope', kind: 'CASH' }, NOW)
  const envelope = createHolding(db, { holdingPlaceId: home.id, name: 'Envelope', kind: 'CASH', provenance: 'RECORDED', isLiquid: true }, NOW)
  const row = (id: string, minor: number, accountId: string): InsertableTransaction => ({
    id,
    accountId,
    transactionDate: localDate(2026, 7, 6),
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
  insertTransaction(db, row('buy-world', -6_000_00, broker.id), NOW)
  setTransactionHolding(db, 'buy-world', { holdingId: world.id, quantityMicro: 12_000_000 }, NOW)
  const cash = cashHoldingOf(db, bank.id)
  if (cash === undefined) throw new Error('a bank account has its own Cash (D-362)')
  return { db, bank, broker, world, bonds, envelope, cash }
}

describe('where is the money (M30 F3)', () => {
  it('lists each holding by one name: an account for its Cash, then what a place holds, then what is kept by hand', async () => {
    const { db, cash, world, bonds, envelope } = await setUp()
    const choices = whereChoices(db, 'ILS')
    const shown = choices.map((one) => [one.name, one.detail, one.group.kind, one.way])
    expect(shown).toEqual([
      ['Current', '···1234', 'BANK', 'ALREADY_THERE'],
      ['Bond fund', 'at Broker', 'HELD', 'FOLLOWS_ROWS'],
      ['World ETF', 'at Broker', 'HELD', 'FOLLOWS_ROWS'],
      ['Cash', 'at Broker', 'HELD', 'ALREADY_THERE'],
      ['Envelope', undefined, 'BY_HAND', 'ALREADY_THERE'],
    ])
    expect(choices.map((one) => one.holdingId)).toEqual(expect.arrayContaining([cash.id, world.id, bonds.id, envelope.id]))
    // Its Cash is never named: the account is.
    expect(choices.some((one) => one.name === cash.name && one.group.kind === 'BANK')).toBe(false)
  })

  it('5,000 in the bank is for a trip: one write, the goal in the account and the money already there', async () => {
    const { db, cash } = await setUp()
    const goal = saveGoalAnswer(
      db,
      {
        name: 'Trip',
        kind: 'EARMARKED',
        targetAmount: ils(12_000_00),
        where: { kind: 'HOLDING', holdingId: cash.id },
        alreadyThere: { amount: ils(5_000_00), date: DAY },
      },
      NOW,
    )
    expect(goal.defaultHoldingId).toBe(cash.id)
    expect(goalFeeds(db).get(goal.id)).toBeUndefined()
    expect(listDeposits(db, { goalId: goal.id }).map((one) => [one.sourceKind, one.amount.minor, one.holdingId])).toEqual([
      ['OPENING_BALANCE', 5_000_00, cash.id],
    ])
  })

  it('a goal following a holding follows its rows, and no other goal can then', async () => {
    const { db, world } = await setUp()
    const house = saveGoalAnswer(db, { name: 'House', kind: 'LONG_TERM', where: { kind: 'HOLDING', holdingId: world.id } }, NOW)
    expect(goalFeeds(db).get(house.id)).toEqual({ kind: 'HOLDING', id: world.id, name: 'World ETF' })
    expect(listDeposits(db, { goalId: house.id }).map((one) => [one.sourceKind, one.amount.minor])).toEqual([
      ['FROM_TRANSACTION', 6_000_00],
    ])
    expect(whereChoices(db, 'ILS').find((one) => one.holdingId === world.id)?.followedBy).toBe('House')
    expect(whereChoices(db, 'ILS', house.id).find((one) => one.holdingId === world.id)?.followedBy).toBeUndefined()

    expect(() =>
      saveGoalAnswer(db, { name: 'Other', kind: 'LONG_TERM', where: { kind: 'HOLDING', holdingId: world.id } }, NOW),
    ).toThrow(GoalAnswerError)
    // Refused whole: the goal it would have made is not there.
    expect(findGoalByName(db, 'Other')).toBeUndefined()
  })

  it('refuses money typed into a holding its rows feed', async () => {
    const { db, world } = await setUp()
    expect(() =>
      saveGoalAnswer(
        db,
        { name: 'House', kind: 'LONG_TERM', where: { kind: 'HOLDING', holdingId: world.id }, alreadyThere: { amount: ils(1_00), date: DAY } },
        NOW,
      ),
    ).toThrow(/followed, not typed/)
  })

  it('+ New… makes the place and its one holding in the same write, and a refusal leaves no place behind', async () => {
    const { db } = await setUp()
    const before = listHoldingPlaces(db).length
    const goal = saveGoalAnswer(
      db,
      {
        name: 'Rainy day',
        kind: 'SHORT_TERM',
        where: { kind: 'NEW', place: { kind: 'DEPOSIT', name: '1-year deposit', institution: 'Mizrahi', lockedUntil: localDate(2027, 3, 31) } },
        alreadyThere: { amount: ils(20_000_00), date: DAY },
      },
      NOW,
    )
    const made = listHoldings(db).find((one) => one.id === goal.defaultHoldingId)
    expect(made).toMatchObject({ name: '1-year deposit', kind: 'DEPOSIT', provenance: 'TRANSCRIBED', isLiquid: false })
    expect(listHoldingPlaces(db).find((one) => one.id === made?.holdingPlaceId)).toMatchObject({
      name: '1-year deposit',
      kind: 'DEPOSIT',
      institution: 'Mizrahi',
    })
    expect(listDeposits(db, { goalId: goal.id }).map((one) => one.amount.minor)).toEqual([20_000_00])
    expect(whereChoices(db, 'ILS').find((one) => one.holdingId === made?.id)).toMatchObject({
      group: { kind: 'BY_HAND' },
      detail: 'at Mizrahi',
      figure: { kind: 'RECORDED', amount: ils(20_000_00) },
    })

    // A category that is not money moved fails after the place is made; the place goes with it.
    const groceries = createCategory(db, { name: 'Treats', kind: 'EXPENSE' }, NOW)
    const places = listHoldingPlaces(db).length
    expect(() =>
      saveGoalAnswer(
        db,
        { name: 'Jar', kind: 'SHORT_TERM', where: { kind: 'NEW', place: { kind: 'CASH_AT_HOME', name: 'Jar' } }, categoryId: groceries },
        NOW,
      ),
    ).toThrow()
    expect(listHoldingPlaces(db).length).toBe(places)
    expect(places).toBe(before + 1)
  })

  it('the category in the fold replaces the rows, and editing keeps the deposits already there', async () => {
    const { db, world, cash } = await setUp()
    const moved = createCategory(db, { name: 'To the house', kind: 'TRANSFER' }, NOW)
    const house = saveGoalAnswer(
      db,
      { name: 'House', kind: 'LONG_TERM', where: { kind: 'HOLDING', holdingId: world.id }, categoryId: moved },
      NOW,
    )
    expect(goalFeeds(db).get(house.id)?.kind).toBe('CATEGORY')
    expect(listDeposits(db, { goalId: house.id })).toEqual([])

    const trip = saveGoalAnswer(
      db,
      { name: 'Trip', kind: 'EARMARKED', where: { kind: 'HOLDING', holdingId: cash.id }, alreadyThere: { amount: ils(5_000_00), date: DAY } },
      NOW,
    )
    saveGoalAnswer(db, { goalId: trip.id, name: 'Trip to Japan', kind: 'EARMARKED', where: { kind: 'HOLDING', holdingId: cash.id } }, NOW)
    expect(findGoal(db, trip.id)?.name).toBe('Trip to Japan')
    expect(listDeposits(db, { goalId: trip.id }).map((one) => one.amount.minor)).toEqual([5_000_00])
  })
})

function findGoalByName(db: import('sql.js').Database, name: string) {
  return (db.exec('SELECT id FROM fmt_saving_goal WHERE name = ?', [name])[0]?.values ?? [])[0]
}

/** M31 U6: what *+ New…* makes from a form that needs it, chosen the moment it exists. */
describe('+ New… in place', () => {
  it('makes a deposit its holding: a place holding one thing, by the id the select takes', async () => {
    const db = await createLedgerDatabase()
    const id = makePlace(db, { kind: 'DEPOSIT', name: '  Fixed deposit ' }, NOW)
    const held = listHoldings(db).find((one) => one.id === id)
    expect(held).toMatchObject({ name: 'Fixed deposit', kind: 'DEPOSIT', provenance: 'TRANSCRIBED', isLiquid: true })
    const place = listHoldingPlaces(db).find((one) => one.id === held?.holdingPlaceId)
    expect(place).toMatchObject({ name: 'Fixed deposit', kind: 'DEPOSIT' })
  })

  it('makes a place its account without leaving a second place behind once the place is saved', async () => {
    const db = await createLedgerDatabase()
    const drawer = createHoldingPlace(db, { name: 'Leumi branch', kind: 'CHECKING' }, NOW)
    const account = createAccount(db, { name: 'Leumi current', kind: 'BANK' }, NOW)
    // The account comes with a place of its own, holding its cash and nothing else.
    expect(listHoldingPlaces(db).filter((one) => one.accountId === account.id)).toHaveLength(1)
    setPlaceAccount(db, drawer.id, account.id, NOW)
    const naming = listHoldingPlaces(db, { includeArchived: true }).filter((one) => one.accountId === account.id)
    expect(naming.map((one) => one.id)).toEqual([drawer.id])
    expect(cashHoldingOf(db, account.id)?.holdingPlaceId).toBe(drawer.id)
  })
})
