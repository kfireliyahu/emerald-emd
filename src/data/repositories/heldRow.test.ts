import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { commitSession } from '../importer/commit.ts'
import { stageImport } from '../importer/stage.ts'
import { createAccount } from './accountRepository.ts'
import { listFormats, readFormat } from './formatRepository.ts'
import { runRollup } from './formatRollupRepository.ts'
import { acceptAllNew, listStagedRows } from './stagedRowRepository.ts'
import { createCategory, setCategoryManually } from './categoryRepository.ts'
import { movedLines } from './movedRepository.ts'
import {
  createHolding,
  createHoldingPlace,
  deleteHolding,
  holdingQuantity,
  setPlaceAccount,
  setTransactionHolding,
  TransactionHoldingError,
  transactionHoldingProblem,
} from './savingsRepository.ts'
import { monthObservations } from './statisticsRepository.ts'
import {
  findTransactionById,
  monthlyTotals,
  summarizeTransactions,
  type InsertableTransaction,
} from './transactionRepository.ts'

const NOW = 1_755_000_000_000
const ils = (minor: number) => money(minor, 'ILS')
const AS_OF = localDate(2026, 8, 12)

/**
 * M30 U2: a row can name a holding and a quantity. Such a row is cash turning
 * into a holding inside one account, so it is neither in, out nor moved, and
 * the holding's quantity is the sum of its rows'.
 */
describe('a row that names a holding', () => {
  async function setUp() {
    const db = await createLedgerDatabase()
    const broker = createAccount(db, { name: 'Broker', kind: 'HOLDINGS' }, NOW)
    const bank = createAccount(db, { name: 'Checking', kind: 'BANK' }, NOW)
    const place = createHoldingPlace(db, { name: 'Broker place', kind: 'INVESTMENT' }, NOW)
    setPlaceAccount(db, place.id, broker.id, NOW)
    const fund = createHolding(
      db,
      { holdingPlaceId: place.id, name: 'Index fund', kind: 'SECURITY', provenance: 'RECORDED', isLiquid: true },
      NOW,
    )
    const row = (id: string, minor: number, accountId = broker.id): InsertableTransaction => ({
      id,
      accountId,
      transactionDate: localDate(2026, 6, 5),
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
    return { db, broker, bank, place, fund, row }
  }

  it('adds zero to the month: neither went out, came in nor moved', async () => {
    const { db, bank, fund, row } = await setUp()
    insertTransaction(db, row('coffee', -20_00, bank.id), NOW)
    insertTransaction(db, row('buy', -3_000_00), NOW)
    insertTransaction(db, row('sell', 500_00), NOW)
    // Filed under Money moved, it is still held and not moved: one row, one meaning.
    const moved = createCategory(db, { name: 'Broker buys', kind: 'SAVING' }, NOW)
    setCategoryManually(db, 'buy', moved, NOW)
    setTransactionHolding(db, 'buy', { holdingId: fund.id, quantityMicro: 10_000_000 }, NOW)
    setTransactionHolding(db, 'sell', { holdingId: fund.id, quantityMicro: -1_500_000 }, NOW)

    const june = monthObservations(db, AS_OF)[0]
    expect(june?.outflow).toEqual(ils(20_00))
    expect(june?.inflow ?? ils(0)).toEqual(ils(0))
    expect(june?.moved ?? ils(0)).toEqual(ils(0))
    expect(movedLines(db, '2026-06', 'ILS')).toEqual([])

    expect(monthlyTotals(db)[0]).toMatchObject({ outflowMinor: 20_00, inflowMinor: 0, count: 3 })
    const summary = summarizeTransactions(db, {})
    expect(summary).toMatchObject({ count: 3, held: 2, moved: 0 })
    expect(summary.totals[0]).toMatchObject({ outflowMinor: 20_00, inflowMinor: 0 })
  })

  it('makes the holding’s quantity the sum of its rows', async () => {
    const { db, fund, row } = await setUp()
    expect(holdingQuantity(db, fund.id)).toEqual({ kind: 'VALUE', quantityMicro: 0, rows: 0 })

    insertTransaction(db, { ...row('buy-1', -1_000_00), holdingId: fund.id, quantityMicro: 10_000_000 }, NOW)
    insertTransaction(db, row('buy-2', -250_00), NOW)
    setTransactionHolding(db, 'buy-2', { holdingId: fund.id, quantityMicro: 2_500_000 }, NOW)
    insertTransaction(db, row('sell', 400_00), NOW)
    setTransactionHolding(db, 'sell', { holdingId: fund.id, quantityMicro: -4_000_000 }, NOW)

    expect(findTransactionById(db, 'buy-2')).toMatchObject({ holdingId: fund.id, quantityMicro: 2_500_000 })
    expect(holdingQuantity(db, fund.id)).toEqual({ kind: 'VALUE', quantityMicro: 8_500_000, rows: 3 })

    setTransactionHolding(db, 'sell', undefined, NOW)
    expect(findTransactionById(db, 'sell')).toMatchObject({ holdingId: undefined, quantityMicro: undefined })
    expect(holdingQuantity(db, fund.id)).toEqual({ kind: 'VALUE', quantityMicro: 12_500_000, rows: 2 })
  })

  it('is unchecked, not smaller, when a row names the holding with no quantity', async () => {
    const { db, fund, row } = await setUp()
    insertTransaction(db, { ...row('buy', -1_000_00), holdingId: fund.id, quantityMicro: 10_000_000 }, NOW)
    insertTransaction(db, { ...row('half', -500_00), holdingId: fund.id }, NOW)
    expect(holdingQuantity(db, fund.id).kind).toBe('UNCHECKED')
  })

  it('refuses another account’s holding, an account’s own cash, and a quantity of zero', async () => {
    const { db, bank, broker, place, fund, row } = await setUp()
    insertTransaction(db, row('bank-row', -100_00, bank.id), NOW)
    insertTransaction(db, row('buy', -100_00), NOW)

    expect(transactionHoldingProblem(db, 'bank-row', { holdingId: fund.id, quantityMicro: 1 })).toMatch(
      /another account's/,
    )
    const cash = setPlaceAccount(db, place.id, broker.id, NOW).cashHolding
    expect(transactionHoldingProblem(db, 'buy', { holdingId: cash?.id ?? '', quantityMicro: 1 })).toMatch(
      /own cash/,
    )
    expect(transactionHoldingProblem(db, 'buy', { holdingId: fund.id, quantityMicro: 0 })).toMatch(/zero/)
    expect(() => setTransactionHolding(db, 'buy', { holdingId: fund.id, quantityMicro: 0 }, NOW)).toThrow(
      TransactionHoldingError,
    )
    expect(transactionHoldingProblem(db, 'gone', undefined)).toMatch(/no longer exists/)
    expect(transactionHoldingProblem(db, 'buy', { holdingId: fund.id, quantityMicro: 1 })).toBeUndefined()

    // A place that names no account refuses nothing: a deposit has no statements.
    const drawer = createHoldingPlace(db, { name: 'A deposit', kind: 'DEPOSIT' }, NOW)
    const deposit = createHolding(
      db,
      { holdingPlaceId: drawer.id, name: 'Deposit', kind: 'DEPOSIT', provenance: 'RECORDED', isLiquid: false },
      NOW,
    )
    expect(transactionHoldingProblem(db, 'bank-row', { holdingId: deposit.id, quantityMicro: 1 })).toBeUndefined()
  })

  it('carries a staged row’s holding and quantity to the transaction it commits as', async () => {
    const { db, broker, fund } = await setUp()
    const { sessionId } = stageImport(
      db,
      {
        accountId: broker.id,
        fileName: 'broker.pdf',
        fileHash: 'hash-1',
        sheetName: 'page 1',
        rows: [
          {
            rowIndex: 0,
            cells: [],
            outcome: {
              kind: 'parsed',
              transaction: {
                transactionDate: localDate(2026, 6, 5),
                amount: ils(-1_000_00),
                direction: 'OUTFLOW',
                merchantRaw: 'Buy index fund',
                merchantNormalized: 'Buy index fund',
                sourceRowRef: 'page 1, row 1',
                holdingId: fund.id,
                quantityMicro: 3_250_000,
              },
            },
          },
        ],
      },
      NOW,
    )
    expect(listStagedRows(db, sessionId)[0]?.transaction).toMatchObject({ holdingId: fund.id, quantityMicro: 3_250_000 })
    acceptAllNew(db, sessionId, NOW)
    commitSession(db, sessionId, NOW)
    expect(holdingQuantity(db, fund.id)).toEqual({ kind: 'VALUE', quantityMicro: 3_250_000, rows: 1 })
    expect(monthObservations(db, AS_OF)[0]?.outflow ?? ils(0)).toEqual(ils(0))
  })

  it('refuses removing a holding a row still names', async () => {
    const { db, fund, row } = await setUp()
    insertTransaction(db, { ...row('buy', -1_000_00), holdingId: fund.id, quantityMicro: 1_000_000 }, NOW)
    expect(() => deleteHolding(db, fund.id, NOW)).toThrow()
  })
})

/**
 * The pack's declared `spending` rollup and Statistics' spending were two figures until M36 U04
 * (M30 U4 pinned how they differed, D-357): a filter had no `not` and no `is empty`. Now it has
 * both, the rollup says "no holding" and "not a Money moved category", and Statistics reads it —
 * so this pins that they are one figure.
 */
describe('the declared spending rollup beside Statistics', () => {
  it('leaves out the moved and the held lines, as Statistics does (M36 U04, which amends D-357)', async () => {
    const db = await createLedgerDatabase()
    const bank = createAccount(db, { name: 'Checking', kind: 'BANK' }, NOW)
    const broker = createAccount(db, { name: 'Broker', kind: 'HOLDINGS' }, NOW)
    const place = createHoldingPlace(db, { name: 'Broker place', kind: 'INVESTMENT' }, NOW)
    setPlaceAccount(db, place.id, broker.id, NOW)
    const fund = createHolding(
      db,
      { holdingPlaceId: place.id, name: 'Index fund', kind: 'SECURITY', provenance: 'RECORDED', isLiquid: true },
      NOW,
    )
    const line = (id: string, minor: number, accountId: string): InsertableTransaction => ({
      id,
      accountId,
      transactionDate: localDate(2026, 6, 5),
      chargeDate: undefined,
      billingPeriod: undefined,
      amount: ils(minor),
      direction: 'OUTFLOW',
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
    const food = createCategory(db, { name: 'Food', kind: 'EXPENSE' }, NOW)
    const toBroker = createCategory(db, { name: 'To the broker', kind: 'TRANSFER' }, NOW)
    insertTransaction(db, line('coffee', -20_00, bank.id), NOW)
    insertTransaction(db, line('transfer', -1_000_00, bank.id), NOW)
    insertTransaction(db, { ...line('buy', -300_00, broker.id), holdingId: fund.id, quantityMicro: 1_000_000 }, NOW)
    setCategoryManually(db, 'coffee', food, NOW)
    setCategoryManually(db, 'transfer', toBroker, NOW)
    setCategoryManually(db, 'buy', food, NOW)

    expect(monthObservations(db, AS_OF)[0]?.outflow).toEqual(ils(20_00))

    const transaction = readFormat(db, 'transaction')
    if (transaction === undefined) throw new Error('no transaction format')
    const groups = runRollup(db, transaction, 'spending', listFormats(db))?.groups ?? []
    const june = groups
      .filter((group) => group.period === '2026-06')
      .map((group) => {
        if (group.value.kind !== 'VALUE') throw new Error(group.value.reason)
        return [group.by, group.value.figures.find((figure) => figure.currency === 'ILS')?.value]
      })
    // The rule Statistics reads is the declaration's now, so the two agree.
    expect(new Map(june as [string, number][])).toEqual(new Map([[food, -20_00]]))
  })
})
