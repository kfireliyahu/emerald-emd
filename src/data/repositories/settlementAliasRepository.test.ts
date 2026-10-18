import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { normalizeMerchant } from '@/core/text.ts'
import { localDate } from '@/core/time.ts'
import { exportDatabase, openDatabase } from '../db/database.ts'
import { readSettlementPlan, rescanSettlements } from '../importer/settlementScan.ts'
import { createAccount } from './accountRepository.ts'
import { findSettlementForTransaction } from './cardSettlementRepository.ts'
import {
  clearSettlementAlias,
  findSettlementAlias,
  setSettlementAlias,
  settlementAliasMap,
} from './settlementAliasRepository.ts'
import { type InsertableTransaction } from './transactionRepository.ts'

const ILS = 'ILS'
const NOW = 1_755_000_000_000

/** What a bank writes when it words its card charge in a way no keyword covers. */
const PLAIN = 'חיוב חודשי'
const PLAIN_KEY = normalizeMerchant(PLAIN)

function bankRow(id: string, minor: number, month: number): InsertableTransaction {
  return {
    accountId: 'bank',
    transactionDate: localDate(2026, month, 10),
    chargeDate: undefined,
    billingPeriod: undefined,
    amount: money(minor, ILS),
    direction: 'OUTFLOW',
    merchantRaw: PLAIN,
    merchantNormalized: PLAIN_KEY,
    providerCategory: undefined,
    cardLast4: undefined,
    reference: undefined,
    note: undefined,
    installment: undefined,
    foreign: undefined,
    naturalKey: id,
    importSessionId: undefined,
    sourceRowRef: undefined,
    id,
  }
}

async function seeded(): Promise<Database> {
  const db = await createLedgerDatabase()
  createAccount(db, { name: 'Bank', kind: 'BANK' }, NOW)
  db.run("UPDATE fmt_account SET id = 'bank' WHERE kind = 'BANK'")
  createAccount(db, { name: 'Cal', kind: 'CREDIT_CARD', last4: '1234' }, NOW)
  db.run("UPDATE fmt_account SET id = 'cal' WHERE last4 = '1234'")
  return db
}

describe('settlement aliases', () => {
  it('records which card a merchant pays and reads it back', async () => {
    const db = await seeded()

    setSettlementAlias(db, PLAIN_KEY, 'cal', NOW)

    expect(findSettlementAlias(db, PLAIN_KEY)?.cardAccountId).toBe('cal')
    expect(findSettlementAlias(db, PLAIN_KEY)?.at).toBe(NOW)
    expect(settlementAliasMap(db).get(PLAIN_KEY)).toBe('cal')
  })

  it('replaces an answer rather than keeping two', async () => {
    const db = await seeded()

    setSettlementAlias(db, PLAIN_KEY, 'cal', NOW)
    setSettlementAlias(db, PLAIN_KEY, 'max', NOW + 1)

    expect(settlementAliasMap(db).size).toBe(1)
    expect(findSettlementAlias(db, PLAIN_KEY)?.cardAccountId).toBe('max')
  })

  it('takes one back without touching the others', async () => {
    const db = await seeded()

    setSettlementAlias(db, PLAIN_KEY, 'cal', NOW)
    setSettlementAlias(db, 'תשלום כרטיס', 'max', NOW)
    clearSettlementAlias(db, PLAIN_KEY, NOW + 1)

    expect(findSettlementAlias(db, PLAIN_KEY)).toBeUndefined()
    expect(findSettlementAlias(db, 'תשלום כרטיס')?.cardAccountId).toBe('max')
  })

  it('has nothing to say about a document that has never been asked', async () => {
    const db = await seeded()
    expect(settlementAliasMap(db).size).toBe(0)
  })

  it('survives a save and reopen', async () => {
    const db = await seeded()
    setSettlementAlias(db, PLAIN_KEY, 'cal', NOW)

    const reopened = await openDatabase(exportDatabase(db))
    expect(findSettlementAlias(reopened, PLAIN_KEY)?.cardAccountId).toBe('cal')
  })
})

describe('what an alias does to the ledger', () => {
  async function withRows(): Promise<Database> {
    const db = await seeded()
    insertTransaction(db, bankRow('row-june', -300_000, 6), NOW)
    insertTransaction(db, bankRow('row-july', -421_055, 7), NOW)
    return db
  }

  it('leaves the rows alone while nobody has said anything', async () => {
    const db = await withRows()

    const { plan } = readSettlementPlan(db)
    expect(plan.settlements).toHaveLength(0)
    expect(plan.rows.every((row) => row.rowClass === 'OTHER_OUTFLOW')).toBe(true)
  })

  it('turns them into settlements the moment the user names the card', async () => {
    const db = await withRows()

    setSettlementAlias(db, PLAIN_KEY, 'cal', NOW)

    const { plan } = readSettlementPlan(db)
    // Two months are two settlements, as they are for a detected one.
    expect(plan.settlements).toHaveLength(2)
    expect(plan.settlements.every((group) => group.isUserStated)).toBe(true)
  })

  it('reaches rows already in the ledger, not just the next import', async () => {
    // The point of the answer being read by the re-derivation rather than
    // written onto a row: history is fixed by the same click that fixes the
    // future (D-062, D-069).
    const db = await withRows()
    expect(findSettlementForTransaction(db, 'row-july')).toBeUndefined()

    setSettlementAlias(db, PLAIN_KEY, 'cal', NOW)
    const scan = rescanSettlements(db, NOW)

    // June and July are two settlements, as they are for a detected one.
    expect(scan.settlements).toBe(2)
    expect(findSettlementForTransaction(db, 'row-july')?.cardAccountId).toBe('cal')
    expect(findSettlementForTransaction(db, 'row-june')?.cardAccountId).toBe('cal')
  })

  it('drops the links again when the answer is taken back', async () => {
    const db = await withRows()
    setSettlementAlias(db, PLAIN_KEY, 'cal', NOW)
    rescanSettlements(db, NOW)

    clearSettlementAlias(db, PLAIN_KEY, NOW + 1)
    rescanSettlements(db, NOW + 1)

    expect(findSettlementForTransaction(db, 'row-july')).toBeUndefined()
  })
})
