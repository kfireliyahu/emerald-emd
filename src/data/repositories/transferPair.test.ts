import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { matchTransfers } from '@/domain/transferPairs.ts'
import { commitSession } from '../importer/commit.ts'
import { stageImport } from '../importer/stage.ts'
import { createAccount } from './accountRepository.ts'
import { createCategory, setCategoryManually } from './categoryRepository.ts'
import { acceptAllNew } from './stagedRowRepository.ts'
import { monthObservations } from './statisticsRepository.ts'
import { summarizeTransactions, type InsertableTransaction } from './transactionRepository.ts'
import {
  listTransferPairs,
  setTransferDecisions,
  suggestTransfers,
  transferPairFor,
} from './transferPairRepository.ts'
import { waitingIn } from './homeRepository.ts'

const NOW = 1_755_000_000_000
const ils = (minor: number) => money(minor, 'ILS')
const AS_OF = localDate(2026, 8, 12)

/**
 * M30 U3: a transfer between two of the person's own accounts is one pair —
 * matched by amount and date, suggested on import, answered once, and then in
 * neither income nor spending.
 */
describe('a transfer between two of your own accounts', () => {
  async function setUp() {
    const db = await createLedgerDatabase()
    const bank = createAccount(db, { name: 'Checking', kind: 'BANK' }, NOW)
    const broker = createAccount(db, { name: 'Broker', kind: 'HOLDINGS' }, NOW)
    const card = createAccount(db, { name: 'Card', kind: 'CREDIT_CARD', last4: '1234' }, NOW)
    const row = (id: string, accountId: string, minor: number, day = 5): InsertableTransaction => ({
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
    return { db, bank, broker, card, row }
  }

  it('makes bank −X and broker +X one pair on import, and leaves the broker’s +100 bonus alone', async () => {
    const { db, bank, broker, row } = await setUp()
    insertTransaction(db, row('to-broker', bank.id, -5_000_00), NOW)

    // The broker's line: a date, an amount and a cut-off source text — no reference.
    const { sessionId } = stageImport(
      db,
      {
        accountId: broker.id,
        fileName: 'broker.pdf',
        fileHash: 'hash-1',
        sheetName: 'page 1',
        rows: [
          ['הפקדה מבנק', 5_000_00],
          ['בונוס הצטר', 100_00],
        ].map(([text, minor], rowIndex) => ({
          rowIndex,
          cells: [],
          outcome: {
            kind: 'parsed' as const,
            transaction: {
              transactionDate: localDate(2026, 6, 5),
              amount: ils(minor as number),
              direction: 'INFLOW' as const,
              merchantRaw: text as string,
              merchantNormalized: text as string,
              sourceRowRef: `page 1, row ${String(rowIndex + 1)}`,
            },
          },
        })),
      },
      NOW,
    )
    acceptAllNew(db, sessionId, NOW)
    const result = commitSession(db, sessionId, NOW)

    expect(result.transfersSuggested).toBe(1)
    const [pair] = listTransferPairs(db)
    expect(pair).toMatchObject({
      decision: 'PENDING',
      out: { transactionId: 'to-broker', accountName: 'Checking' },
      in: { accountName: 'Broker', amount: ils(5_000_00) },
    })
    expect(listTransferPairs(db)).toHaveLength(1)
    expect(waitingIn(db, 'transfer_pair')).toBe(1)

    // A rescan asks nothing twice.
    expect(suggestTransfers(db)).toBe(0)
  })

  it('once answered, is neither income nor spending: saved counts it once', async () => {
    const { db, bank, broker, row } = await setUp()
    insertTransaction(db, row('coffee', bank.id, -20_00), NOW)
    insertTransaction(db, row('to-broker', bank.id, -5_000_00), NOW)
    insertTransaction(db, row('arrived', broker.id, 5_000_00, 6), NOW)
    insertTransaction(db, row('bonus', broker.id, 100_00), NOW)
    suggestTransfers(db)

    // Undecided, the bank's end is spending; nothing at the broker is ever income (M30 U5, D-358).
    const before = monthObservations(db, AS_OF)[0]
    expect(before?.outflow).toEqual(ils(5_020_00))
    expect(before?.inflow ?? ils(0)).toEqual(ils(0))

    const pair = transferPairFor(db, 'arrived')
    expect(pair?.out.transactionId).toBe('to-broker')
    setTransferDecisions(db, [{ pairId: pair?.id ?? '', decision: 'PAIRED' }])

    const after = monthObservations(db, AS_OF)[0]
    expect(after?.outflow).toEqual(ils(20_00))
    // The bonus is not a transfer: it is growth of the broker's cash, not income (M30 U5, D-358).
    expect(after?.inflow ?? ils(0)).toEqual(ils(0))
    // The end on the bank is moved, into saved; the end at the broker is held, so not taken back out.
    expect(after?.moved).toEqual(ils(5_000_00))

    const summary = summarizeTransactions(db, {})
    expect(summary).toMatchObject({ count: 4, moved: 1, held: 2 })
    expect(summary.totals[0]).toMatchObject({ outflowMinor: 20_00, inflowMinor: 0 })
  })

  it('between two ordinary accounts nets to nothing moved', async () => {
    const { db, bank, row } = await setUp()
    const other = createAccount(db, { name: 'Second bank', kind: 'BANK' }, NOW)
    insertTransaction(db, row('out', bank.id, -700_00), NOW)
    insertTransaction(db, row('in', other.id, 700_00, 7), NOW)
    suggestTransfers(db)
    const [pair] = listTransferPairs(db)
    setTransferDecisions(db, [{ pairId: pair?.id ?? '', decision: 'PAIRED' }])

    const month = monthObservations(db, AS_OF)[0]
    expect(month?.outflow ?? ils(0)).toEqual(ils(0))
    expect(month?.inflow ?? ils(0)).toEqual(ils(0))
    expect(month?.moved ?? ils(0)).toEqual(ils(0))
  })

  it('remembers “not a transfer”: both rows count as before and are never suggested again', async () => {
    const { db, bank, row } = await setUp()
    const other = createAccount(db, { name: 'Second bank', kind: 'BANK' }, NOW)
    insertTransaction(db, row('rent', bank.id, -300_00), NOW)
    insertTransaction(db, row('refund', other.id, 300_00), NOW)
    suggestTransfers(db)
    const [pair] = listTransferPairs(db)
    setTransferDecisions(db, [{ pairId: pair?.id ?? '', decision: 'NOT_PAIRED' }])

    expect(suggestTransfers(db)).toBe(0)
    expect(waitingIn(db, 'transfer_pair')).toBe(0)
    const month = monthObservations(db, AS_OF)[0]
    expect(month?.outflow).toEqual(ils(300_00))
    expect(month?.inflow).toEqual(ils(300_00))
  })

  it('pairs no card row, no row on one account, nothing a week apart, and keeps a filed row moved once', async () => {
    const { db, bank, broker, card, row } = await setUp()
    insertTransaction(db, row('card-refund', card.id, 50_00), NOW)
    insertTransaction(db, row('bank-50', bank.id, -50_00), NOW)
    insertTransaction(db, row('same-account-in', bank.id, 60_00), NOW)
    insertTransaction(db, row('same-account-out', bank.id, -60_00), NOW)
    insertTransaction(db, row('early', bank.id, -80_00, 1), NOW)
    insertTransaction(db, row('late', broker.id, 80_00, 9), NOW)
    expect(suggestTransfers(db)).toBe(0)

    // A row already filed under Money moved is moved once, paired or not.
    insertTransaction(db, row('saving', bank.id, -1_000_00), NOW)
    insertTransaction(db, row('arrived', broker.id, 1_000_00), NOW)
    setCategoryManually(db, 'saving', createCategory(db, { name: 'Saving', kind: 'SAVING' }, NOW), NOW)
    suggestTransfers(db)
    const [pair] = listTransferPairs(db)
    setTransferDecisions(db, [{ pairId: pair?.id ?? '', decision: 'PAIRED' }])
    expect(monthObservations(db, AS_OF)[0]?.moved).toEqual(ils(1_000_00))
  })
})

describe('matchTransfers', () => {
  const row = (id: string, accountId: string, minor: number, day: number) => ({
    id,
    accountId,
    date: localDate(2026, 6, day),
    amountMinor: minor,
    currency: 'ILS',
  })

  it('takes the closest arrival, and leaves the other one alone', () => {
    expect(
      matchTransfers([
        row('out', 'bank', -100, 10),
        row('far', 'broker', 100, 13),
        row('near', 'savings', 100, 11),
      ]),
    ).toEqual([{ outId: 'out', inId: 'near', daysApart: 1 }])
  })

  it('needs the same currency and the same amount', () => {
    expect(matchTransfers([row('out', 'bank', -100, 10), { ...row('in', 'broker', 100, 10), currency: 'USD' }])).toEqual([])
    expect(matchTransfers([row('out', 'bank', -100, 10), row('in', 'broker', 101, 10)])).toEqual([])
  })

  it('pairs each row once', () => {
    expect(
      matchTransfers([
        row('a', 'bank', -100, 10),
        row('b', 'bank', -100, 10),
        row('in', 'broker', 100, 10),
      ]),
    ).toHaveLength(1)
  })
})
