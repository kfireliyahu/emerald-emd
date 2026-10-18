/**
 * Order of import must not matter — docs/f06's edge case, tested as the property
 * it is rather than as the one direction that is easy to arrange.
 *
 * The two orders are run against two fresh documents and the resulting links
 * are compared. That is the honest shape of the claim: not "the rescan fires",
 * but "you cannot tell from the result which statement you imported first".
 */

import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate, type YearMonth } from '@/core/time.ts'
import { createAccount, setExcludeSettlementsFromStats } from '../repositories/accountRepository.ts'
import {
  findSettlementForTransaction,
  listSettlementLinks,
} from '../repositories/cardSettlementRepository.ts'
import { waitingIn } from '../repositories/homeRepository.ts'
import {
  findTransactionById,
  type InsertableTransaction,
} from '../repositories/transactionRepository.ts'
import { countCardCharges } from '../repositories/cardSettlementRepository.ts'
import { listBankRowsForScan, listCardPeriodTotals, rescanSettlements, cardAccounts, unmatchedSettlements } from './settlementScan.ts'

const ILS = 'ILS'
const JULY: YearMonth = { year: 2026, month: 7 }

function base(id: string, accountId: string): InsertableTransaction {
  return {
    id,
    accountId,
    transactionDate: localDate(2026, 7, 10),
    chargeDate: undefined,
    billingPeriod: undefined,
    amount: money(-100_000, ILS),
    direction: 'OUTFLOW',
    merchantRaw: 'X',
    merchantNormalized: 'X',
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

async function documentWithAccounts(): Promise<Database> {
  const db = await createLedgerDatabase()
  createAccount(db, { name: 'Bank', kind: 'BANK' }, 1)
  db.run("UPDATE fmt_account SET id = 'bank' WHERE kind = 'BANK'")
  createAccount(db, { name: 'Cal – Visa 1234', kind: 'CREDIT_CARD', last4: '1234' }, 1)
  db.run("UPDATE fmt_account SET id = 'cal' WHERE last4 = '1234'")
  return db
}

/** The bank's July statement: a settlement of ₪4,210.55 and one ordinary outflow. */
function importBankStatement(db: Database): void {
  insertTransaction(
    db,
    {
      ...base('bank-settlement', 'bank'),
      amount: money(-421_055, ILS),
      merchantRaw: 'כרטיס אשראי 1234',
      merchantNormalized: 'כרטיס אשראי',
    },
    1,
  )
  insertTransaction(
    db,
    {
      ...base('bank-rent', 'bank'),
      amount: money(-500_000, ILS),
      merchantRaw: 'שכר דירה',
      merchantNormalized: 'שכר דירה',
    },
    1,
  )
}

/** The card's July statement: three charges adding to exactly ₪4,210.55. */
function importCardStatement(db: Database): void {
  const slices = [200_000, 121_055, 100_000]
  slices.forEach((minor, index) => {
    insertTransaction(
      db,
      {
        ...base(`card-${index}`, 'cal'),
        amount: money(-minor, ILS),
        billingPeriod: JULY,
        merchantRaw: 'סופר',
        merchantNormalized: 'סופר',
      },
      1,
    )
  })
}

describe('rescanning after a commit', () => {
  it('produces the same links whichever statement was imported first', async () => {
    const bankFirst = await documentWithAccounts()
    importBankStatement(bankFirst)
    rescanSettlements(bankFirst, 10)
    importCardStatement(bankFirst)
    rescanSettlements(bankFirst, 20)

    const cardFirst = await documentWithAccounts()
    importCardStatement(cardFirst)
    rescanSettlements(cardFirst, 10)
    importBankStatement(cardFirst)
    rescanSettlements(cardFirst, 20)

    const shape = (db: Database) =>
      listSettlementLinks(db).map((link) => ({
        bankTransactionId: link.bankTransactionId,
        cardAccountId: link.cardAccountId,
        billingPeriod: link.billingPeriod,
        matchConfidence: link.matchConfidence,
        userDecision: link.userDecision,
      }))

    expect(shape(bankFirst)).toEqual(shape(cardFirst))
    expect(shape(bankFirst)).toEqual([
      {
        bankTransactionId: 'bank-settlement',
        cardAccountId: 'cal',
        billingPeriod: '2026-07',
        matchConfidence: 'HIGH',
        userDecision: 'PENDING',
      },
    ])
  })

  it('upgrades an existing link in place when the card statement lands', async () => {
    const db = await documentWithAccounts()
    importBankStatement(db)
    rescanSettlements(db, 10)
    expect(findSettlementForTransaction(db, 'bank-settlement')).toMatchObject({
      matchConfidence: 'MEDIUM',
      billingPeriod: undefined,
    })

    importCardStatement(db)
    const result = rescanSettlements(db, 20)

    expect(result).toMatchObject({ created: 0, updated: 1 })
    expect(findSettlementForTransaction(db, 'bank-settlement')).toMatchObject({
      matchConfidence: 'HIGH',
      billingPeriod: '2026-07',
    })
  })

  it('leaves an answer alone when the card statement arrives afterwards', async () => {
    const db = await documentWithAccounts()
    importBankStatement(db)
    rescanSettlements(db, 10)
    setExcludeSettlementsFromStats(db, 'cal', true, 11)

    // The remembered answer reaches an existing link only through the prompt,
    // never through a rescan: the sync re-derives the match, not the decision.
    importCardStatement(db)
    rescanSettlements(db, 20)

    expect(findSettlementForTransaction(db, 'bank-settlement')?.userDecision).toBe('PENDING')
  })

  it('applies the remembered answer to a settlement it is seeing for the first time', async () => {
    const db = await documentWithAccounts()
    setExcludeSettlementsFromStats(db, 'cal', true, 1)
    importBankStatement(db)
    importCardStatement(db)

    rescanSettlements(db, 10)

    expect(findSettlementForTransaction(db, 'bank-settlement')?.userDecision).toBe('EXCLUDED')
    // The settlement's own column, never the person's flag (M36 U04).
    expect(findTransactionById(db, 'bank-settlement')?.countedOnCard).toBe(true)
    expect(waitingIn(db, 'card_settlement_link')).toBe(0)
  })

  it('is idempotent, so running it after every commit costs nothing', async () => {
    const db = await documentWithAccounts()
    importBankStatement(db)
    importCardStatement(db)

    expect(rescanSettlements(db, 10)).toMatchObject({ created: 1, updated: 0 })
    expect(rescanSettlements(db, 20)).toMatchObject({ created: 0, updated: 0 })
    expect(rescanSettlements(db, 30)).toMatchObject({ created: 0, updated: 0 })
  })

  it('reports a card charge whose card is not in this document', async () => {
    const db = await createLedgerDatabase()
    createAccount(db, { name: 'Bank', kind: 'BANK' }, 1)
    db.run("UPDATE fmt_account SET id = 'bank' WHERE kind = 'BANK'")
    insertTransaction(
      db,
      {
        ...base('orphan', 'bank'),
        amount: money(-89_020, ILS),
        merchantRaw: 'כרטיס אשראי 9012',
        merchantNormalized: 'כרטיס אשראי',
      },
      1,
    )

    const result = rescanSettlements(db, 10)

    expect(result).toMatchObject({ created: 0, unmatched: 1, bankRowsScanned: 1 })
  })

  it('stops asking about a charge once it is counted as spending, and asks again if taken back (M31 U1)', async () => {
    const db = await createLedgerDatabase()
    createAccount(db, { name: 'Bank', kind: 'BANK' }, 1)
    db.run("UPDATE fmt_account SET id = 'bank' WHERE kind = 'BANK'")
    for (const [id, minor, day] of [['first', -89_020, 10], ['second', -10_000, 20]] as const) {
      insertTransaction(
        db,
        { ...base(id, 'bank'), transactionDate: localDate(2026, 7, day), amount: money(minor, ILS), merchantRaw: 'כרטיס אשראי 9012', merchantNormalized: 'כרטיס אשראי' },
        1,
      )
    }
    expect(unmatchedSettlements(db)).toMatchObject([{ last4: '9012', chargedTotal: money(99_020, ILS) }])

    countCardCharges(db, ['first'], true, 2)
    expect(unmatchedSettlements(db)).toMatchObject([{ last4: '9012', chargedTotal: money(10_000, ILS) }])
    countCardCharges(db, ['second'], true, 3)
    expect(unmatchedSettlements(db)).toEqual([])

    countCardCharges(db, ['first', 'second'], false, 4)
    expect(unmatchedSettlements(db)).toHaveLength(1)
  })

  it('does nothing at all on a document with no bank account', async () => {
    const db = await documentWithAccounts()
    importCardStatement(db)
    expect(rescanSettlements(db, 10)).toMatchObject({ bankRowsScanned: 0, created: 0 })
  })
})

describe('what the scan reads', () => {
  it('gives the classifier both forms of the description', async () => {
    // Not the caller's choice: keywords match the normalized text and the
    // last-4 is read out of the raw one, which normalization strips.
    const db = await documentWithAccounts()
    importBankStatement(db)

    const rows = listBankRowsForScan(db)
    expect(rows.find((row) => row.ref === 'bank-settlement')).toMatchObject({
      descriptionRaw: 'כרטיס אשראי 1234',
      descriptionNormalized: 'כרטיס אשראי',
    })
  })

  it('reads no balance, because a running balance is never stored', async () => {
    const db = await documentWithAccounts()
    importBankStatement(db)
    expect(listBankRowsForScan(db).every((row) => row.balance === undefined)).toBe(true)
  })

  it('totals a card statement per period', async () => {
    const db = await documentWithAccounts()
    importCardStatement(db)

    expect(listCardPeriodTotals(db, cardAccounts(db))).toEqual([
      { accountId: 'cal', period: JULY, total: money(-421_055, ILS) },
    ])
  })

  it('ignores card rows with no billing period, which are the total of no statement', async () => {
    const db = await documentWithAccounts()
    insertTransaction(db, base('loose', 'cal'), 1)
    expect(listCardPeriodTotals(db, cardAccounts(db))).toEqual([])
  })

  it('leaves a bank row older than the window out of the scan', async () => {
    const db = await documentWithAccounts()
    importBankStatement(db)
    insertTransaction(
      db,
      {
        ...base('ancient', 'bank'),
        transactionDate: localDate(2024, 1, 5),
        merchantRaw: 'כרטיס אשראי 1234',
        merchantNormalized: 'כרטיס אשראי',
      },
      1,
    )

    expect(listBankRowsForScan(db).map((row) => row.ref)).not.toContain('ancient')
  })
})
