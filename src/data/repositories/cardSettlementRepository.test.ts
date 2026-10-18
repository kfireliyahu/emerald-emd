import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import type { SettlementGroup } from '@/domain/model/banking.ts'
import { exportDatabase, openDatabase } from '../db/database.ts'
import {
  createAccount,
  findAccountById,
  listAccounts,
  mergeAccounts,
  setExcludeSettlementsFromStats,
} from './accountRepository.ts'
import {
  decideAllForCard,
  decideForCard,
  findSettlementForTransaction,
  linkInputsFor,
  listSettlementLinks,
  listSettlementSummaries,
  setSettlementDecision,
  syncSettlementLinks,
  type SettlementLinkInput,
} from './cardSettlementRepository.ts'
import { waitingIn } from './homeRepository.ts'
import {
  findTransactionById,
  setExcludedFromStats,
  type InsertableTransaction,
} from './transactionRepository.ts'

const ILS = 'ILS'
const JULY = { year: 2026, month: 7 } as const

function bankRow(id: string, minor: number): InsertableTransaction {
  return {
    accountId: 'bank',
    transactionDate: localDate(2026, 7, 10),
    chargeDate: undefined,
    billingPeriod: undefined,
    amount: money(minor, ILS),
    direction: 'OUTFLOW',
    merchantRaw: 'כרטיס אשראי 1234',
    merchantNormalized: 'כרטיס אשראי',
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

/** A bank account holding one settlement row, and the card it pays. */
async function seeded(): Promise<Database> {
  const db = await createLedgerDatabase()
  createAccount(db, { name: 'Bank', kind: 'BANK' }, 1)
  db.run("UPDATE fmt_account SET id = 'bank' WHERE kind = 'BANK'")
  createAccount(db, { name: 'Cal – Visa 1234', kind: 'CREDIT_CARD', last4: '1234' }, 1)
  db.run("UPDATE fmt_account SET id = 'cal' WHERE last4 = '1234'")
  insertTransaction(db, bankRow('row-1', -421_055), 1)
  return db
}

function input(overrides: Partial<SettlementLinkInput> = {}): SettlementLinkInput {
  return {
    bankTransactionId: 'row-1',
    cardAccountId: 'cal',
    billingPeriod: JULY,
    matchConfidence: 'HIGH',
    decision: 'PENDING',
    ...overrides,
  }
}

describe('the migration', () => {
  it('survives a round trip through a file', async () => {
    // The table is registered and the link is really in the SQLite bytes, not
    // only in the connection that wrote it. Deliberately not asserting a schema
    // number: that pins a fact every later migration has to come and update,
    // and the round trip is the thing worth knowing.
    const db = await seeded()
    syncSettlementLinks(db, [input()], 1)

    const reopened = await openDatabase(exportDatabase(db))
    expect(listSettlementLinks(reopened)).toHaveLength(1)
  })

  it('gives a card three states for the remembered answer, not two', async () => {
    const db = await seeded()
    expect(findAccountById(db, 'cal')?.excludeSettlementsFromStats).toBeUndefined()

    setExcludeSettlementsFromStats(db, 'cal', false, 2)
    expect(findAccountById(db, 'cal')?.excludeSettlementsFromStats).toBe(false)

    // "Keep them" and "not yet asked" are different facts: the first must never
    // prompt again and the second must.
    setExcludeSettlementsFromStats(db, 'cal', undefined, 3)
    expect(findAccountById(db, 'cal')?.excludeSettlementsFromStats).toBeUndefined()
  })

  it('refuses a second live link for one bank row', async () => {
    // One bank row settles one card; two links would be two answers about the
    // same money. Reachable only by writing SQL by hand, but the index is what
    // makes the upsert in `syncSettlementLinks` safe to rely on.
    const db = await seeded()
    syncSettlementLinks(db, [input()], 1)

    expect(() =>
      db.run(
        `INSERT INTO fmt_card_settlement_link
           (id, bank_transaction, card_account, match_confidence, user_decision)
         VALUES ('dupe', 'row-1', 'cal', 'LOW', 'PENDING')`,
      ),
    ).toThrow(/UNIQUE/)
  })

  it('lets a dropped link out of the way of a new one', async () => {
    // A link is removed, not soft-deleted, since M25 U3 — so the row it was
    // about can be linked again, once.
    const db = await seeded()
    syncSettlementLinks(db, [input()], 1)
    expect(syncSettlementLinks(db, [], 2, { scannedBankTransactionIds: ['row-1'] }).dropped).toBe(1)

    expect(syncSettlementLinks(db, [input()], 3).created).toBe(1)
    expect(listSettlementLinks(db)).toHaveLength(1)
  })
})

describe('syncSettlementLinks', () => {
  it('creates a link and leaves it unanswered', async () => {
    const db = await seeded()
    expect(syncSettlementLinks(db, [input()], 1)).toEqual({ created: 1, updated: 0, answersKept: 0, dropped: 0 })
    expect(findSettlementForTransaction(db, 'row-1')).toMatchObject({
      cardAccountId: 'cal',
      billingPeriod: '2026-07',
      matchConfidence: 'HIGH',
      userDecision: 'PENDING',
    })
  })

  it('is idempotent, which is what running it on every import needs', async () => {
    const db = await seeded()
    syncSettlementLinks(db, [input()], 1)
    expect(syncSettlementLinks(db, [input()], 2)).toEqual({ created: 0, updated: 0, answersKept: 0, dropped: 0 })
    expect(listSettlementLinks(db)).toHaveLength(1)
  })

  it('upgrades a match when the card statement arrives later', async () => {
    // docs/f06: order of import must not matter. The bank statement came first,
    // so nothing corroborated the amount and there was no period to name.
    const db = await seeded()
    syncSettlementLinks(db, [input({ matchConfidence: 'MEDIUM', billingPeriod: undefined })], 1)
    expect(findSettlementForTransaction(db, 'row-1')?.billingPeriod).toBeUndefined()

    const result = syncSettlementLinks(db, [input()], 2)
    expect(result).toEqual({ created: 0, updated: 1, answersKept: 0, dropped: 0 })
    expect(findSettlementForTransaction(db, 'row-1')).toMatchObject({
      matchConfidence: 'HIGH',
      billingPeriod: '2026-07',
    })
  })

  it('never overwrites an answer the user gave', async () => {
    const db = await seeded()
    syncSettlementLinks(db, [input({ matchConfidence: 'MEDIUM', billingPeriod: undefined })], 1)
    const link = findSettlementForTransaction(db, 'row-1')
    setSettlementDecision(db, link?.id ?? '', 'KEPT', 2)

    const result = syncSettlementLinks(db, [input()], 3)

    expect(result.answersKept).toBe(1)
    expect(findSettlementForTransaction(db, 'row-1')).toMatchObject({
      userDecision: 'KEPT',
      matchConfidence: 'HIGH',
    })
  })

  it('makes the ledger agree when it creates a link already answered by the card', async () => {
    // The second month of a card whose answer is remembered. The link is born
    // excluded, and the bank row has to be excluded with it or the settlement
    // counts as spending until someone opens a screen.
    const db = await seeded()
    syncSettlementLinks(db, [input({ decision: 'EXCLUDED' })], 1)

    // The settlement's own column, and never the person's (M36 U04).
    expect(findTransactionById(db, 'row-1')).toMatchObject({ countedOnCard: true, isExcludedFromStats: false })
  })

  describe('dropping a link whose row has stopped being a settlement', () => {
    it('leaves a link alone when the caller did not say what it scanned', async () => {
      // A link cannot be judged stale against a reading that never looked at
      // it, which is why the scope is a parameter and not an assumption.
      const db = await seeded()
      syncSettlementLinks(db, [input()], 1)

      expect(syncSettlementLinks(db, [], 2).dropped).toBe(0)
      expect(findSettlementForTransaction(db, 'row-1')).toBeDefined()
    })

    it('drops it with its answer, and leaves the person’s where it was (M36 U01, U04)', async () => {
      // The settlement's answer is its own column now, so it goes with the
      // link; a person who also left this row out by hand keeps their answer.
      const db = await seeded()
      syncSettlementLinks(db, [input({ decision: 'EXCLUDED' })], 1)
      setExcludedFromStats(db, 'row-1', true, 2)

      const result = syncSettlementLinks(db, [], 3, { scannedBankTransactionIds: ['row-1'] })

      expect(result.dropped).toBe(1)
      expect(findSettlementForTransaction(db, 'row-1')).toBeUndefined()
      expect(findTransactionById(db, 'row-1')).toMatchObject({ countedOnCard: false, isExcludedFromStats: true })
    })

    it('puts a row only the settlement left out back in the totals (M36 U04)', async () => {
      const db = await seeded()
      syncSettlementLinks(db, [input({ decision: 'EXCLUDED' })], 1)

      syncSettlementLinks(db, [], 2, { scannedBankTransactionIds: ['row-1'] })

      expect(findTransactionById(db, 'row-1')).toMatchObject({ countedOnCard: false, isExcludedFromStats: false })
    })

    it('leaves an exclusion the user made by hand exactly where it is', async () => {
      // The distinction that keeps this safe: an exclusion this link caused is
      // undone with it, and one the user made about the row is not. Nothing
      // here has the standing to overrule the second.
      const db = await seeded()
      syncSettlementLinks(db, [input()], 1)
      setExcludedFromStats(db, 'row-1', true, 2)

      syncSettlementLinks(db, [], 3, { scannedBankTransactionIds: ['row-1'] })

      expect(findSettlementForTransaction(db, 'row-1')).toBeUndefined()
      expect(findTransactionById(db, 'row-1')?.isExcludedFromStats).toBe(true)
    })
  })
})

describe('answering the prompt', () => {
  it('writes the link and the settlement’s own column together, never the person’s flag', async () => {
    const db = await seeded()
    syncSettlementLinks(db, [input()], 1)
    const link = findSettlementForTransaction(db, 'row-1')

    setSettlementDecision(db, link?.id ?? '', 'EXCLUDED', 2)

    expect(findSettlementForTransaction(db, 'row-1')?.userDecision).toBe('EXCLUDED')
    expect(findTransactionById(db, 'row-1')).toMatchObject({ countedOnCard: true, isExcludedFromStats: false })
  })

  it('keeps the link when the answer is to exclude, so the row stays drillable', async () => {
    // docs/f06 is explicit: excluding must not hide the settlement from the
    // bank's cash-flow view. The link is what keeps it reachable.
    const db = await seeded()
    syncSettlementLinks(db, [input()], 1)
    setSettlementDecision(db, findSettlementForTransaction(db, 'row-1')?.id ?? '', 'EXCLUDED', 2)

    expect(listSettlementLinks(db, { cardAccountId: 'cal' })).toHaveLength(1)
  })

  it('un-excludes when the answer is reversed', async () => {
    const db = await seeded()
    syncSettlementLinks(db, [input()], 1)
    const id = findSettlementForTransaction(db, 'row-1')?.id ?? ''

    setExcludedFromStats(db, 'row-1', true, 2)
    setSettlementDecision(db, id, 'EXCLUDED', 2)
    setSettlementDecision(db, id, 'KEPT', 3)

    // Taking the settlement's answer back leaves the person's alone (M36 U04).
    expect(findTransactionById(db, 'row-1')).toMatchObject({ countedOnCard: false, isExcludedFromStats: true })
  })

  it('answers a whole card at once and counts what was still open', async () => {
    const db = await seeded()
    insertTransaction(db, bankRow('row-2', -180_000), 1)
    syncSettlementLinks(db, [input(), input({ bankTransactionId: 'row-2' })], 1)

    expect(waitingIn(db, 'card_settlement_link')).toBe(2)
    expect(decideAllForCard(db, 'cal', 'EXCLUDED', 2)).toBe(2)
    expect(waitingIn(db, 'card_settlement_link')).toBe(0)
    expect(findTransactionById(db, 'row-2')?.countedOnCard).toBe(true)
  })

  it('leaves an already-answered settlement alone when the group is decided', async () => {
    const db = await seeded()
    insertTransaction(db, bankRow('row-2', -180_000), 1)
    syncSettlementLinks(db, [input(), input({ bankTransactionId: 'row-2' })], 1)
    setSettlementDecision(db, findSettlementForTransaction(db, 'row-1')?.id ?? '', 'KEPT', 2)

    expect(decideAllForCard(db, 'cal', 'EXCLUDED', 3)).toBe(1)
    expect(findSettlementForTransaction(db, 'row-1')?.userDecision).toBe('KEPT')
    expect(findSettlementForTransaction(db, 'row-2')?.userDecision).toBe('EXCLUDED')
  })
})

describe('linkInputsFor', () => {
  const group: SettlementGroup = {
    key: 'cal|2026-07',
    cardAccountId: 'cal',
    cardAccountName: 'Cal – Visa 1234',
    last4: '1234',
    rows: [],
    chargedTotal: money(421_055, ILS),
    billingPeriod: JULY,
    confidence: 'HIGH',
    decision: 'PENDING',
    isUserStated: false,
  }

  function withRows(refs: readonly string[]): SettlementGroup {
    return {
      ...group,
      rows: refs.map((ref) => ({
        ref,
        date: localDate(2026, 7, 10),
        amount: money(-100_000, ILS),
        descriptionRaw: 'כרטיס אשראי 1234',
        descriptionNormalized: 'כרטיס אשראי',
      })),
    }
  }

  it('gives one link per bank row, all carrying the group they were decided as', () => {
    // A split charge is one settlement and two rows: the group is how it was
    // corroborated, and each row is what carries the money.
    const inputs = linkInputsFor([withRows(['a', 'b'])], (ref) => `tx-${ref}`)

    expect(inputs.map((entry) => entry.bankTransactionId)).toEqual(['tx-a', 'tx-b'])
    expect(inputs.every((entry) => entry.matchConfidence === 'HIGH')).toBe(true)
  })

  it('drops a row that never made it into the ledger', () => {
    const inputs = linkInputsFor([withRows(['a', 'skipped'])], (ref) =>
      ref === 'skipped' ? undefined : `tx-${ref}`,
    )
    expect(inputs).toHaveLength(1)
  })
})

describe('merging a card that has settlements', () => {
  it('moves the links and adopts an answer the survivor never gave', async () => {
    const db = await seeded()
    createAccount(db, { name: 'Cal – old', kind: 'CREDIT_CARD' }, 1)
    const old = listAccounts(db).find((account) => account.name === 'Cal – old')
    syncSettlementLinks(db, [input({ cardAccountId: old?.id ?? '' })], 1)
    setExcludeSettlementsFromStats(db, old?.id ?? '', true, 1)

    mergeAccounts(db, old?.id ?? '', 'cal', 2)

    expect(listSettlementLinks(db, { cardAccountId: 'cal' })).toHaveLength(1)
    expect(findAccountById(db, 'cal')?.excludeSettlementsFromStats).toBe(true)
  })
})

describe('listSettlementSummaries', () => {
  /** Three card charges in July adding to exactly the settlement's ₪4,210.55. */
  function cardStatement(db: Database): void {
    ;[200_000, 121_055, 100_000].forEach((minor, index) => {
      insertTransaction(
        db,
        {
          ...bankRow(`card-${index}`, -minor),
          accountId: 'cal',
          billingPeriod: JULY,
          merchantRaw: 'סופר',
          merchantNormalized: 'סופר',
        },
        1,
      )
    })
  }

  it('states the claim in numbers the user can check', async () => {
    // A prompt that says "this looks like a card charge" and nothing else asks
    // for trust it has not earned.
    const db = await seeded()
    cardStatement(db)
    syncSettlementLinks(db, [input()], 1)

    expect(listSettlementSummaries(db, { decision: 'PENDING' })[0]).toMatchObject({
      cardAccountName: 'Cal – Visa 1234',
      last4: '1234',
      billingPeriod: '2026-07',
      chargedTotal: money(421_055, ILS),
      statementTotal: money(421_055, ILS),
      statementRowCount: 3,
    })
  })

  it('groups a split charge as one settlement and sums it before comparing', async () => {
    const db = await seeded()
    cardStatement(db)
    db.run("UPDATE fmt_transaction SET amount_minor = -240000 WHERE id = 'row-1'")
    insertTransaction(db, bankRow('row-2', -181_055), 1)
    syncSettlementLinks(db, [input(), input({ bankTransactionId: 'row-2' })], 1)

    const summaries = listSettlementSummaries(db, { decision: 'PENDING' })
    expect(summaries).toHaveLength(1)
    expect(summaries[0]?.rows).toHaveLength(2)
    expect(summaries[0]?.chargedTotal).toEqual(money(421_055, ILS))
  })

  it('says so when nothing of ours adds up to the charge', async () => {
    const db = await seeded()
    syncSettlementLinks(db, [input({ billingPeriod: undefined, matchConfidence: 'MEDIUM' })], 1)

    expect(listSettlementSummaries(db)[0]).toMatchObject({
      statementTotal: undefined,
      statementRowCount: 0,
      matchConfidence: 'MEDIUM',
    })
  })

  it('drops out of the pending list once answered', async () => {
    const db = await seeded()
    syncSettlementLinks(db, [input()], 1)
    decideAllForCard(db, 'cal', 'EXCLUDED', 2)

    expect(listSettlementSummaries(db, { decision: 'PENDING' })).toEqual([])
    expect(listSettlementSummaries(db)).toHaveLength(1)
  })

})

describe('the account screen’s per-card control', () => {
  it('moves settlements the prompt would have left alone', async () => {
    // The difference from `decideAllForCard`, and the reason both exist: the
    // prompt is answering what it just asked, so it must not overwrite an answer
    // given elsewhere. This control *is* the answer for the card.
    const db = await seeded()
    syncSettlementLinks(db, [input()], 1)
    setSettlementDecision(db, findSettlementForTransaction(db, 'row-1')?.id ?? '', 'KEPT', 2)

    expect(decideAllForCard(db, 'cal', 'EXCLUDED', 3)).toBe(0)
    expect(decideForCard(db, 'cal', 'EXCLUDED', 4)).toBe(1)
    expect(findSettlementForTransaction(db, 'row-1')?.userDecision).toBe('EXCLUDED')
  })

  it('puts them back in the prompt and un-excludes them, which is the reversal', async () => {
    const db = await seeded()
    syncSettlementLinks(db, [input()], 1)
    decideForCard(db, 'cal', 'EXCLUDED', 2)
    expect(findTransactionById(db, 'row-1')?.countedOnCard).toBe(true)

    decideForCard(db, 'cal', 'PENDING', 3)

    expect(waitingIn(db, 'card_settlement_link')).toBe(1)
    expect(findTransactionById(db, 'row-1')?.countedOnCard).toBe(false)
  })
})
