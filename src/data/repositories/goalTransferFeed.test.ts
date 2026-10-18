import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { createAccount } from './accountRepository.ts'
import { createCategory, setCategoryManually } from './categoryRepository.ts'
import { cushionReading, setCushionAccounts } from './cushionRepository.ts'
import { goalFeeds, setGoalFeed } from './goalDepositRepository.ts'
import { goalAnswerProblem, saveGoalAnswer, whereChoices } from './goalWhereRepository.ts'
import { cashHoldingOf, createHoldingPlace, listDeposits, setPlaceAccount } from './savingsRepository.ts'
import type { InsertableTransaction } from './transactionRepository.ts'
import { setTransferDecisions, suggestTransfers } from './transferPairRepository.ts'

const NOW = 1_755_000_000_000
const ils = (minor: number) => money(minor, 'ILS')

/**
 * M30 F4: a goal whose money is a bank account's own Cash counts the confirmed
 * transfers into that account — no category, no rule — once it is ticked.
 */
describe('a goal kept in an account counts the transfers into it', () => {
  async function setUp() {
    const db = await createLedgerDatabase()
    const main = createAccount(db, { name: 'Main', kind: 'BANK' }, NOW)
    const savings = createAccount(db, { name: 'Savings', kind: 'BANK', last4: '9876' }, NOW)
    const broker = createAccount(db, { name: 'Broker', kind: 'HOLDINGS' }, NOW)
    const row = (id: string, accountId: string, minor: number, month: number, day = 3): InsertableTransaction => ({
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
    /** The monthly bank-to-savings transfer: both ends, confirmed once as a pair. */
    const monthly = (month: number, minor = 1_000_00): void => {
      insertTransaction(db, row(`out-${String(month)}`, main.id, -minor, month), NOW)
      insertTransaction(db, row(`in-${String(month)}`, savings.id, minor, month), NOW)
    }
    const confirmAll = (): void => {
      suggestTransfers(db)
      const pending = db.exec("SELECT id FROM fmt_transfer_pair WHERE user_decision = 'PENDING'")[0]?.values ?? []
      setTransferDecisions(
        db,
        pending.map(([id]) => ({ pairId: String(id), decision: 'PAIRED' as const })),
      )
    }
    const cash = cashHoldingOf(db, savings.id)
    const mainCash = cashHoldingOf(db, main.id)
    if (cash === undefined || mainCash === undefined) throw new Error('a bank account has its own Cash (D-362)')
    return { db, main, savings, broker, row, monthly, confirmAll, cash, mainCash }
  }

  it('turns a monthly transfer, confirmed once as a pair, into the goal’s deposit with no other step', async () => {
    const { db, savings, cash, monthly, confirmAll } = await setUp()
    const goal = saveGoalAnswer(
      db,
      { name: 'Trip', kind: 'SHORT_TERM', where: { kind: 'HOLDING', holdingId: cash.id }, transfersIn: true },
      NOW,
    )
    expect(goalFeeds(db).get(goal.id)).toEqual({ kind: 'TRANSFERS', id: savings.id, name: 'Savings' })

    monthly(7)
    confirmAll()
    const deposits = listDeposits(db, { goalId: goal.id })
    expect(deposits.map((one) => [one.amount.minor, one.holdingId, one.sourceKind])).toEqual([
      [1_000_00, cash.id, 'FROM_TRANSACTION'],
    ])

    monthly(8)
    confirmAll()
    expect(listDeposits(db, { goalId: goal.id }).map((one) => one.amount.minor).sort()).toEqual([1_000_00, 1_000_00])
    // Idempotent: another sync changes nothing.
  })

  it('counts a transfer out of the account as a withdrawal, and an unconfirmed one as nothing', async () => {
    const { db, main, cash, row, monthly, confirmAll } = await setUp()
    const goal = saveGoalAnswer(
      db,
      { name: 'Trip', kind: 'SHORT_TERM', where: { kind: 'HOLDING', holdingId: cash.id }, transfersIn: true },
      NOW,
    )
    monthly(7)
    confirmAll()
    // Back to the main account: a pair the other way round.
    const savingsId = cash.accountId ?? ''
    insertTransaction(db, row('back-out', savingsId, -300_00, 8, 10), NOW)
    insertTransaction(db, row('back-in', main.id, 300_00, 8, 10), NOW)
    suggestTransfers(db)
    // Still PENDING: not a transfer until somebody says so.
    expect(listDeposits(db, { goalId: goal.id }).map((one) => one.amount.minor)).toEqual([1_000_00])
    confirmAll()
    expect(listDeposits(db, { goalId: goal.id }).map((one) => one.amount.minor).sort((a, b) => a - b)).toEqual([
      -300_00,
      1_000_00,
    ])
  })

  it('is off by default: a goal in the main account counts nothing that arrives there', async () => {
    const { db, mainCash, row, main, savings, confirmAll } = await setUp()
    const goal = saveGoalAnswer(db, { name: 'Rainy day', kind: 'SHORT_TERM', where: { kind: 'HOLDING', holdingId: mainCash.id } }, NOW)
    insertTransaction(db, row('from-savings', savings.id, -500_00, 7), NOW)
    insertTransaction(db, row('into-main', main.id, 500_00, 7), NOW)
    confirmAll()
    expect(goalFeeds(db).get(goal.id)).toBeUndefined()
    expect(listDeposits(db, { goalId: goal.id })).toEqual([])
  })

  it('counts only the transfers after what was already there, which already holds the ones before', async () => {
    const { db, cash, monthly, confirmAll } = await setUp()
    monthly(5)
    monthly(6)
    confirmAll()
    const goal = saveGoalAnswer(
      db,
      {
        name: 'Trip',
        kind: 'SHORT_TERM',
        where: { kind: 'HOLDING', holdingId: cash.id },
        alreadyThere: { amount: ils(2_000_00), date: localDate(2026, 6, 30) },
        transfersIn: true,
      },
      NOW,
    )
    expect(listDeposits(db, { goalId: goal.id }).map((one) => [one.sourceKind, one.amount.minor])).toEqual([
      ['OPENING_BALANCE', 2_000_00],
    ])
    monthly(7)
    confirmAll()
    expect(
      listDeposits(db, { goalId: goal.id })
        .map((one) => one.sourceKind)
        .sort(),
    ).toEqual(['FROM_TRANSACTION', 'OPENING_BALANCE'])
  })

  it('is one source: a category reading the bank’s end of the same transfer does not count it again', async () => {
    const { db, cash, mainCash, monthly, confirmAll } = await setUp()
    const toSavings = createCategory(db, { name: 'To savings', kind: 'SAVING' }, NOW)
    monthly(7)
    setCategoryManually(db, 'out-7', toSavings, NOW)
    const other = saveGoalAnswer(
      db,
      { name: 'House', kind: 'LONG_TERM', where: { kind: 'HOLDING', holdingId: mainCash.id }, categoryId: toSavings },
      NOW,
    )
    expect(listDeposits(db, { goalId: other.id }).map((one) => one.amount.minor)).toEqual([1_000_00])

    const trip = saveGoalAnswer(
      db,
      { name: 'Trip', kind: 'SHORT_TERM', where: { kind: 'HOLDING', holdingId: cash.id }, transfersIn: true },
      NOW,
    )
    confirmAll()
    // The pair is Trip's now; House no longer counts its bank end beside it.
    expect(listDeposits(db, { goalId: trip.id }).map((one) => one.amount.minor)).toEqual([1_000_00])
    expect(listDeposits(db, { goalId: other.id })).toEqual([])
    expect(
      goalAnswerProblem(db, {
        name: 'Both',
        kind: 'SHORT_TERM',
        where: { kind: 'HOLDING', holdingId: cash.id },
        transfersIn: true,
        categoryId: toSavings,
      }),
    ).toMatch(/never both/)
  })

  it('refuses a broker’s cash (D-355), a second goal on one account, and setting the feed on anything but an account’s Cash', async () => {
    const { db, cash, broker } = await setUp()
    const place = createHoldingPlace(db, { name: 'Broker', kind: 'INVESTMENT' }, NOW)
    setPlaceAccount(db, place.id, broker.id, NOW)
    const brokerCash = cashHoldingOf(db, broker.id)
    expect(brokerCash).toBeDefined()
    if (brokerCash !== undefined) {
      expect(
        goalAnswerProblem(db, {
          name: 'Broker',
          kind: 'SHORT_TERM',
          where: { kind: 'HOLDING', holdingId: brokerCash.id },
          transfersIn: true,
        }),
      ).toMatch(/not a bank account's own cash/)
    }
    const first = saveGoalAnswer(
      db,
      { name: 'Trip', kind: 'SHORT_TERM', where: { kind: 'HOLDING', holdingId: cash.id }, transfersIn: true },
      NOW,
    )
    expect(
      goalAnswerProblem(db, {
        name: 'Car',
        kind: 'SHORT_TERM',
        where: { kind: 'HOLDING', holdingId: cash.id },
        transfersIn: true,
      }),
    ).toMatch(/already feed Trip/)
    // The list says so, so the form can say it before saving.
    const second = saveGoalAnswer(db, { name: 'Car', kind: 'SHORT_TERM', where: { kind: 'HOLDING', holdingId: cash.id } }, NOW)
    expect(whereChoices(db, 'ILS', second.id).find((one) => one.holdingId === cash.id)?.transfersReadBy).toBe('Trip')
    expect(whereChoices(db, 'ILS', first.id).find((one) => one.holdingId === cash.id)?.transfersReadBy).toBeUndefined()
    expect(() => setGoalFeed(db, second.id, { kind: 'TRANSFERS' }, NOW)).toThrow(/already feed Trip/)
  })

  it('counts each transfer once in the cushion’s split: the goal’s part is its deposits into the account’s Cash (D-360)', async () => {
    const { db, savings, cash, monthly, confirmAll } = await setUp()
    const goal = saveGoalAnswer(
      db,
      { name: 'Trip', kind: 'SHORT_TERM', where: { kind: 'HOLDING', holdingId: cash.id }, transfersIn: true },
      NOW,
    )
    monthly(7)
    monthly(8)
    confirmAll()
    setCushionAccounts(db, [{ accountId: savings.id, counts: true }], NOW)
    const parts = cushionReading(db, localDate(2026, 8, 31), 'ILS').split.parts
    const trip = parts.filter((one) => one.goalId === goal.id)
    expect(trip.reduce((sum, one) => sum + one.amount.minor, 0)).toBe(2_000_00)
  })

  it('turning the tick off takes the derived deposits away and leaves what was typed', async () => {
    const { db, cash, monthly, confirmAll } = await setUp()
    const goal = saveGoalAnswer(
      db,
      {
        name: 'Trip',
        kind: 'SHORT_TERM',
        where: { kind: 'HOLDING', holdingId: cash.id },
        alreadyThere: { amount: ils(500_00), date: localDate(2026, 6, 1) },
        transfersIn: true,
      },
      NOW,
    )
    monthly(7)
    confirmAll()
    expect(listDeposits(db, { goalId: goal.id })).toHaveLength(2)
    saveGoalAnswer(db, { goalId: goal.id, name: 'Trip', kind: 'SHORT_TERM', where: { kind: 'HOLDING', holdingId: cash.id } }, NOW)
    expect(listDeposits(db, { goalId: goal.id }).map((one) => one.sourceKind)).toEqual(['OPENING_BALANCE'])
  })
})
