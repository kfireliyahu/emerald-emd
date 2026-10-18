import { describe, expect, it } from 'vitest'

import { fromMajorUnits } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'

import { createAccount } from './accountRepository.ts'
import { correctCategories, undoCorrections } from './categoryOverrideRepository.ts'
import {
  categoryMerchants,
  categorySeries,
  createCategory,
  usualCategories,
} from './categoryRepository.ts'
import { findTransactionById, setExcludedFromStats } from './transactionRepository.ts'

const NOW = 1_700_000_000_000
const SHUFERSAL = 'שופרסל דיל'
const WOLT = 'WOLT'

async function fixture() {
  const db = await createLedgerDatabase()
  const account = createAccount(db, { name: 'Cal 1234', kind: 'CREDIT_CARD' }, NOW)
  const food = createCategory(db, { name: 'Work Food', kind: 'EXPENSE' }, NOW)
  const fun = createCategory(db, { name: 'Work Fun', kind: 'EXPENSE' }, NOW)
  const rows = [
    { id: 'a1', merchant: SHUFERSAL, major: -100, month: 8 },
    { id: 'a2', merchant: SHUFERSAL, major: -50, month: 7 },
    { id: 'a3', merchant: SHUFERSAL, major: -25, month: 7 },
    { id: 'b1', merchant: WOLT, major: -70, month: 8 },
  ]
  for (const row of rows) {
    insertTransaction(
      db,
      {
        id: row.id,
        accountId: account.id,
        transactionDate: localDate(2026, row.month, 5),
        chargeDate: localDate(2026, row.month, 5),
        billingPeriod: { year: 2026, month: row.month },
        amount: fromMajorUnits(row.major, 'ILS'),
        direction: 'OUTFLOW',
        merchantRaw: row.merchant,
        merchantNormalized: row.merchant,
        providerCategory: undefined,
        cardLast4: undefined,
        reference: undefined,
        note: undefined,
        installment: undefined,
        foreign: undefined,
        naturalKey: row.id,
        importSessionId: undefined,
        sourceRowRef: undefined,
      },
      NOW,
    )
  }
  return { db, food, fun }
}

describe('undoCorrections', () => {
  it('puts the rows back as they were and takes the audit away', async () => {
    const { db, food } = await fixture()
    const result = correctCategories(db, ['a1', 'a2', 'a3'], food, NOW)
    expect(result.changed).toBe(3)
    expect(result.filed).toHaveLength(3)
    expect(findTransactionById(db, 'a1')?.categoryId).toBe(food)

    const restored = undoCorrections(db, result.filed, food)
    expect(restored).toBe(3)
    const back = findTransactionById(db, 'a1')
    expect(back?.categoryId).toBeUndefined()
    expect(back?.categorySource).toBe('NONE')
    // The filing was not a habit: nothing counts it towards a rule offer.
    expect(db.exec('SELECT COUNT(*) FROM fmt_category_override')[0]?.values[0]?.[0]).toBe(0)
  })

  it('leaves a row alone that somebody has moved on since', async () => {
    const { db, food, fun } = await fixture()
    const result = correctCategories(db, ['a1', 'a2'], food, NOW)
    correctCategories(db, ['a2'], fun, NOW + 1)

    expect(undoCorrections(db, result.filed, food)).toBe(1)
    expect(findTransactionById(db, 'a1')?.categoryId).toBeUndefined()
    expect(findTransactionById(db, 'a2')?.categoryId).toBe(fun)
  })
})

describe('usualCategories', () => {
  it('ranks by what a category holds, and never offers an empty one', async () => {
    const { db, food, fun } = await fixture()
    correctCategories(db, ['a1', 'a2', 'a3'], food, NOW)
    correctCategories(db, ['b1'], fun, NOW)
    expect(usualCategories(db, 6).slice(0, 2)).toEqual([food, fun])
    expect(usualCategories(db, 1)).toEqual([food])
  })
})

describe('categorySeries and categoryMerchants', () => {
  it('gives a year of months, oldest first, without the rows left out', async () => {
    const { db, food } = await fixture()
    correctCategories(db, ['a1', 'a2', 'a3'], food, NOW)
    setExcludedFromStats(db, 'a3', true, NOW)

    const line = categorySeries(db, '2026-08', 12, 'ILS').get(food)
    expect(line).toHaveLength(12)
    expect(line?.at(-1)).toBe(10000)
    expect(line?.at(-2)).toBe(5000)
    expect(line?.slice(0, 10).every((value) => value === 0)).toBe(true)
  })

  it('names where the money goes, largest first', async () => {
    const { db, food } = await fixture()
    correctCategories(db, ['a1', 'a2', 'b1'], food, NOW)
    const merchants = categoryMerchants(db, food, '2026-03', '2026-08', 'ILS', 5)
    expect(merchants.map((one) => one.merchantRaw)).toEqual([SHUFERSAL, WOLT])
    expect(merchants[0]?.outflowMinor).toBe(15000)
  })
})
