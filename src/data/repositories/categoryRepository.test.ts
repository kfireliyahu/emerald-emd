import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'

import { fromMajorUnits } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { migrate } from '../db/database.ts'
import { createAccount } from './accountRepository.ts'
import {
  categoryTotals,
  createCategory,
  countUncategorized,
  listCategories,
  setCategoryManually,
  UNCATEGORIZED_ID,
} from './categoryRepository.ts'
import { listTransactions } from './transactionRepository.ts'

async function seeded(): Promise<{ db: Database; transactionId: string }> {
  const db = await createLedgerDatabase()
  createAccount(db, { name: 'Card 1234', kind: 'CREDIT_CARD' }, 1)
  db.run("UPDATE fmt_account SET id = 'acc-1'")
  insertTransaction(
    db,
    {
      accountId: 'acc-1',
      transactionDate: localDate(2026, 7, 3),
      chargeDate: localDate(2026, 8, 2),
      billingPeriod: { year: 2026, month: 8 },
      amount: fromMajorUnits(-421.05, 'ILS'),
      direction: 'OUTFLOW',
      merchantRaw: 'שופרסל דיל 344',
      merchantNormalized: 'שופרסל דיל',
      providerCategory: 'מזון וצריכה',
      cardLast4: undefined,
      reference: undefined,
      note: undefined,
      installment: undefined,
      foreign: undefined,
      naturalKey: 'key-1',
      importSessionId: undefined,
      sourceRowRef: undefined,
      id: 'tx-1',
    },
    1,
  )
  return { db, transactionId: 'tx-1' }
}

describe('seeded categories', () => {
  it('ships a usable starting taxonomy', async () => {
    const db = await createLedgerDatabase()
    const categories = listCategories(db)

    expect(categories.length).toBeGreaterThan(30)
    expect(categories.map((category) => category.name)).toContain('Groceries')
    expect(categories.map((category) => category.name)).toContain('Salary')
  })

  it('shows every category by its whole path, three levels deep (M28 F29)', () => {
    return createLedgerDatabase().then((db) => {
      const categories = listCategories(db)
      const paths = categories.map((category) => category.path)
      expect(paths).toContain('Living → Utilities → Electricity')
      expect(paths).toContain('Living → Insurance → Health')
      expect(paths).toContain('Health & Fitness → Pharmacy')
      // The tree in order: a heading, then what is under it, depth first;
      // the system categories last.
      expect(paths.slice(0, 4)).toEqual(['Living', 'Living → Housing & Rent', 'Living → Mortgage', 'Living → Utilities'])
      expect(paths.slice(-2)).toEqual(['Uncategorized', 'Internal Transfer'])
      expect(categories.find((one) => one.name === 'Gas')?.depth).toBe(3)
    })
  })

  it('types income and savings categories correctly', async () => {
    const db = await createLedgerDatabase()
    const byName = new Map(listCategories(db).map((category) => [category.name, category]))
    expect(byName.get('Salary')?.kind).toBe('INCOME')
    expect(byName.get('Pension')?.kind).toBe('SAVING')
    expect(byName.get('Groceries')?.kind).toBe('EXPENSE')
    expect(byName.get('Loan payments')?.kind).toBe('DEBT_PAYMENT')
  })

  it('marks the two undeletable system categories', async () => {
    const db = await createLedgerDatabase()
    const system = listCategories(db).filter((category) => category.isSystem)
    expect(system.map((category) => category.name).sort()).toEqual([
      'Internal Transfer',
      'Uncategorized',
    ])
  })

  it('seeding is idempotent — a second migrate does not duplicate it', async () => {
    const db = await createLedgerDatabase()
    const before = listCategories(db).length
    migrate(db)
    migrate(db)
    expect(listCategories(db).length).toBe(before)
  })

  it('refuses a fourth level of nesting, and a child for a system category', async () => {
    const db = await createLedgerDatabase()
    expect(() =>
      createCategory(db, { name: 'Deep', kind: 'EXPENSE', parentId: 'cat:electricity' }, 1),
    ).toThrow(/3 levels at most/)
    expect(() => createCategory(db, { name: 'Odd', kind: 'EXPENSE', parentId: UNCATEGORIZED_ID }, 1)).toThrow(
      /system category/,
    )
  })
})

describe('manual categorization', () => {
  it('records the assignment as MANUAL, which is what makes it permanent', async () => {
    const { db, transactionId } = await seeded()
    setCategoryManually(db, transactionId, 'cat:groceries', Date.now())

    const [row] = listTransactions(db)
    expect(row?.categoryId).toBe('cat:groceries')
    expect(row?.categoryPath).toBe('Living → Groceries')
    // D-009: nothing automated may overwrite this.
    expect(row?.categorySource).toBe('MANUAL')
  })

  it('is found under a heading two levels up, read with its subcategories (M28 F29)', async () => {
    const { db, transactionId } = await seeded()
    setCategoryManually(db, transactionId, 'cat:gas', Date.now())

    expect(listTransactions(db, { categoryId: 'cat:living', includeSubcategories: true })).toHaveLength(1)
    expect(listTransactions(db, { categoryId: 'cat:living' })).toHaveLength(0)
    expect(listTransactions(db)[0]?.categoryPath).toBe('Living → Utilities → Gas')
  })

  it('can be cleared again', async () => {
    const { db, transactionId } = await seeded()
    setCategoryManually(db, transactionId, 'cat:groceries', Date.now())
    setCategoryManually(db, transactionId, undefined, Date.now())

    const [row] = listTransactions(db)
    expect(row?.categoryId).toBeUndefined()
    expect(row?.categorySource).toBe('NONE')
  })

  it('counts what is still uncategorized', async () => {
    const { db, transactionId } = await seeded()
    expect(countUncategorized(db)).toBe(1)

    setCategoryManually(db, transactionId, 'cat:groceries', Date.now())
    expect(countUncategorized(db)).toBe(0)

    // Assigning the system Uncategorized category still counts as uncategorized.
    setCategoryManually(db, transactionId, UNCATEGORIZED_ID, Date.now())
    expect(countUncategorized(db)).toBe(1)
  })
})

describe('categoryTotals', () => {
  it('reports uncategorized spend as its own visible row', async () => {
    // docs/08 is emphatic: hidden uncategorized spending is how these apps lose
    // trust. It must never be silently folded into anything else.
    const { db } = await seeded()
    const totals = categoryTotals(db, '2026-08')

    expect(totals).toHaveLength(1)
    expect(totals[0]?.name).toBe('Uncategorized')
    expect(totals[0]?.categoryId).toBeUndefined()
    expect(totals[0]?.outflowMinor).toBe(42105)
  })

  it('moves the spend once a category is assigned', async () => {
    const { db, transactionId } = await seeded()
    setCategoryManually(db, transactionId, 'cat:groceries', Date.now())

    const totals = categoryTotals(db, '2026-08')
    expect(totals).toHaveLength(1)
    expect(totals[0]?.name).toBe('Living → Groceries')
    expect(totals[0]?.outflowMinor).toBe(42105)
  })

  it('is empty for a month with nothing in it', async () => {
    const { db } = await seeded()
    expect(categoryTotals(db, '2026-01')).toEqual([])
  })
})

