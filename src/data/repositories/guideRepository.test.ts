import { describe, expect, it } from 'vitest'

import { fromMajorUnits } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { LEDGER_GUIDE } from '@/data/packs/ledger/guide.ts'
import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { FRESH_GUIDE, QUIET_GUIDE } from '@/domain/guide.ts'

import { createAccount } from './accountRepository.ts'
import { createCategory, listCategories, setCategoryAppearance, setCategoryArchived } from './categoryRepository.ts'
import { merchantQueue, skipMerchant } from './labelingQueueRepository.ts'
import { holdsWork, ledgerGuideChecks, monthSpan, readGuideProgress, saveGuideProgress } from './guideRepository.ts'

const TODAY = localDate(2026, 10, 3)

type Db = Awaited<ReturnType<typeof createLedgerDatabase>>

function charge(db: Db, accountId: string, id: string, month: number, merchant = 'שופרסל דיל'): void {
  insertTransaction(
    db,
    {
      id,
      accountId,
      transactionDate: localDate(2026, month, 3),
      chargeDate: localDate(2026, month, 3),
      billingPeriod: { year: 2026, month },
      amount: fromMajorUnits(-42.05, 'ILS'),
      direction: 'OUTFLOW',
      merchantRaw: merchant,
      merchantNormalized: merchant,
      providerCategory: undefined,
      cardLast4: undefined,
      reference: undefined,
      note: undefined,
      installment: undefined,
      foreign: undefined,
      naturalKey: `key-${id}`,
      importSessionId: undefined,
      sourceRowRef: undefined,
    },
    1,
  )
}

describe('where the guide stopped', () => {
  it('asks a new document once, leaves one with work alone, and keeps what is saved', async () => {
    const db = await createLedgerDatabase()
    expect(readGuideProgress(db)).toEqual(FRESH_GUIDE)
    expect(holdsWork(db)).toBe(false)

    createAccount(db, { name: 'Card', kind: 'CREDIT_CARD' }, 1)
    expect(holdsWork(db)).toBe(true)
    expect(readGuideProgress(db)).toEqual(QUIET_GUIDE)

    saveGuideProgress(db, { offered: true, started: true, step: 'split', lineAway: false }, 2)
    expect(readGuideProgress(db)).toEqual({ offered: true, started: true, step: 'split', lineAway: false })
    db.close()
  })
})

describe('the ledger’s done-tests', () => {
  it('answers every step it declares, and an empty document has none done', async () => {
    const db = await createLedgerDatabase()
    const checks = ledgerGuideChecks(db, TODAY)
    expect(Object.keys(checks).sort()).toEqual(LEDGER_GUIDE.map((step) => step.id).sort())
    expect(Object.values(checks).every((check) => !check.done)).toBe(true)
    db.close()
  })

  it('ticks reading once a transaction is in, and says what it found (S1)', async () => {
    const db = await createLedgerDatabase()
    const card = createAccount(db, { name: 'Card', kind: 'CREDIT_CARD' }, 1)
    charge(db, card.id, 'a', 8)
    charge(db, card.id, 'b', 9)
    const checks = ledgerGuideChecks(db, TODAY)
    expect(checks['read']).toEqual({ done: true, says: 'Read: 2 transactions, August and September.' })
    // Nothing filed yet, so By merchant is still open.
    expect(checks['merchant']?.done).toBe(false)
    db.close()
  })

  it('ticks By merchant when the screen has nothing left, a skipped shop included (F16)', async () => {
    const db = await createLedgerDatabase()
    const card = createAccount(db, { name: 'Card', kind: 'CREDIT_CARD' }, 1)
    charge(db, card.id, 'a', 9)
    charge(db, card.id, 'b', 9, 'קפה')
    const groceries = listCategories(db).find((one) => one.name === 'Groceries')
    db.run('UPDATE fmt_transaction SET category = ? WHERE id = ?', [groceries?.id ?? '', 'a'])
    expect(merchantQueue(db).waiting).toHaveLength(1)
    expect(ledgerGuideChecks(db, TODAY)['merchant']).toEqual({ done: false })

    // A real case: the last shop skipped, By merchant says nothing is left.
    skipMerchant(db, 'קפה', 2)
    expect(merchantQueue(db).waiting).toHaveLength(0)
    expect(ledgerGuideChecks(db, TODAY)['merchant']).toEqual({
      done: true,
      says: 'Every merchant has a category or was skipped; 1 skipped shop waits under Skipped.',
    })

    db.run('UPDATE fmt_transaction SET category = ? WHERE id = ?', [groceries?.id ?? '', 'b'])
    expect(ledgerGuideChecks(db, TODAY)['merchant']).toEqual({ done: true, says: 'Every merchant has a category.' })
    db.close()
  })

  it('ticks Categories only for a category made or changed here, never for the starter list (F13)', async () => {
    const db = await createLedgerDatabase()
    expect(listCategories(db).length).toBeGreaterThan(0)
    expect(ledgerGuideChecks(db, TODAY)['categories']).toEqual({ done: false })

    const groceries = listCategories(db).find((one) => one.name === 'Groceries')
    expect(groceries).toBeDefined()
    // Writing back what a starter row already says is not an edit.
    setCategoryAppearance(db, groceries?.id ?? '', { color: groceries?.color, icon: groceries?.icon }, 1)
    expect(ledgerGuideChecks(db, TODAY)['categories']?.done).toBe(false)

    setCategoryAppearance(db, groceries?.id ?? '', { color: 'category-3', icon: undefined }, 2)
    expect(ledgerGuideChecks(db, TODAY)['categories']).toEqual({
      done: true,
      says: '1 category is yours, made or changed since the starter list.',
    })

    createCategory(db, { name: 'Coffee', kind: 'EXPENSE' }, 3)
    const gifts = listCategories(db).find((one) => one.name === 'Gifts')
    setCategoryArchived(db, gifts?.id ?? '', true, 4)
    expect(ledgerGuideChecks(db, TODAY)['categories']?.says).toBe(
      '3 categories are yours, made or changed since the starter list.',
    )
    db.close()
  })

  it('says a span of months the way a person would', () => {
    expect(monthSpan({ year: 2026, month: 9 }, { year: 2026, month: 9 })).toBe('September')
    expect(monthSpan({ year: 2026, month: 6 }, { year: 2026, month: 9 })).toBe('June to September')
    expect(monthSpan({ year: 2025, month: 12 }, { year: 2026, month: 1 })).toBe('December 2025 to January 2026')
  })
})
