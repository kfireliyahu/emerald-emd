import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'

import { fromMajorUnits, money } from '@/core/money.ts'
import { localDate, toISODate } from '@/core/time.ts'
import { createAccount } from './accountRepository.ts'
import { UNCATEGORIZED_ID, setCategoryFromRule } from './categoryRepository.ts'
import { createRule, deleteRule } from './categoryRuleRepository.ts'
import {
  DEFAULT_SORT,
  findTransactionById,
  listTransactionIds,
  listTransactions,
  monthlyTotals,
  setExcludedFromStats,
  setTransactionNote,
  summarizeTransactions,
  type InsertableTransaction,
  type TransactionSort,
} from './transactionRepository.ts'

const ACCOUNT_A = 'acc-a'
const ACCOUNT_B = 'acc-b'

function row(overrides: Partial<InsertableTransaction> & { id: string }): InsertableTransaction {
  return {
    accountId: ACCOUNT_A,
    transactionDate: localDate(2026, 7, 3),
    chargeDate: localDate(2026, 8, 2),
    billingPeriod: { year: 2026, month: 8 },
    amount: fromMajorUnits(-100, 'ILS'),
    direction: 'OUTFLOW',
    merchantRaw: 'merchant',
    merchantNormalized: 'MERCHANT',
    providerCategory: undefined,
    cardLast4: undefined,
    reference: undefined,
    note: undefined,
    installment: undefined,
    foreign: undefined,
    naturalKey: overrides.id,
    importSessionId: undefined,
    sourceRowRef: undefined,
    ...overrides,
  }
}

/**
 * A small ledger with the shapes the filters have to tell apart: two accounts,
 * two currencies, a Hebrew merchant with a branch number, a categorized row, an
 * uncategorized one, and a row whose charge date lands in a different month
 * from its purchase.
 */
async function seeded(): Promise<Database> {
  const db = await createLedgerDatabase()
  createAccount(db, { name: 'Cal – Visa 1234', kind: 'CREDIT_CARD', last4: '1234' }, 1)
  createAccount(db, { name: 'Max – Visa 5678', kind: 'CREDIT_CARD', last4: '5678' }, 1)
  // `createAccount` mints its own id, so the fixtures get theirs written directly.
  db.run("UPDATE fmt_account SET id = ? WHERE last4 = '1234'", [ACCOUNT_A])
  db.run("UPDATE fmt_account SET id = ? WHERE last4 = '5678'", [ACCOUNT_B])

  db.run(
    `INSERT INTO fmt_import_mapping
       (id, name, header_signature, header_row_index, data_start_row_index, column_roles,
        amount_convention, date_orders, default_currency, use_count)
     VALUES ('map-1', 'Cal – Visa 1234', 'sig', 3, 4, '{}', 'SIGNED_SINGLE', '{}', 'ILS', 1)`,
  )
  db.run(
    `INSERT INTO fmt_statement
       (id, account, mapping, file_name, file_hash, sheet_name, status, committed, started,
        rows_total, rows_new, rows_duplicate, rows_failed)
     VALUES ('ses-1', ?, 'map-1', 'cal-2026-07.xlsx', 'hash', 'עסקאות', 'COMMITTED', ?,
             '1970-01-01T00:00:00.001Z', 0, 0, 0, 0)`,
    [ACCOUNT_A, new Date(1770000000000).toISOString()],
  )

  insertTransaction(
    db,
    row({
      id: 'tx-groceries',
      transactionDate: localDate(2026, 7, 3),
      chargeDate: localDate(2026, 8, 2),
      amount: fromMajorUnits(-421.05, 'ILS'),
      merchantRaw: 'שופרסל דיל 344',
      merchantNormalized: 'שופרסל דיל',
      providerCategory: 'מזון וצריכה',
      importSessionId: 'ses-1',
      sourceRowRef: 'row 47',
    }),
    1,
  )
  db.run("UPDATE fmt_transaction SET category = 'cat:groceries' WHERE id = 'tx-groceries'")

  insertTransaction(
    db,
    row({
      id: 'tx-electric',
      transactionDate: localDate(2026, 7, 20),
      amount: fromMajorUnits(-1200, 'ILS'),
      merchantRaw: 'חברת החשמל',
      merchantNormalized: 'חברת החשמל',
    }),
    1,
  )
  db.run("UPDATE fmt_transaction SET category = 'cat:utilities' WHERE id = 'tx-electric'")

  // Charged in July, bought in June — the row that proves which date the range
  // filter is actually reading.
  insertTransaction(
    db,
    row({
      id: 'tx-steam',
      accountId: ACCOUNT_B,
      transactionDate: localDate(2026, 6, 15),
      chargeDate: localDate(2026, 7, 2),
      billingPeriod: { year: 2026, month: 7 },
      amount: fromMajorUnits(-55.5, 'ILS'),
      merchantRaw: 'PAYPAL *STEAM',
      merchantNormalized: 'PAYPAL *STEAM',
    }),
    1,
  )

  insertTransaction(
    db,
    row({
      id: 'tx-amazon',
      accountId: ACCOUNT_B,
      transactionDate: localDate(2026, 7, 11),
      chargeDate: localDate(2026, 8, 2),
      amount: money(-3000, 'USD'),
      merchantRaw: 'AMAZON.COM',
      merchantNormalized: 'AMAZON.COM',
    }),
    1,
  )

  insertTransaction(
    db,
    row({
      id: 'tx-abroad',
      transactionDate: localDate(2026, 7, 14),
      amount: fromMajorUnits(-110, 'ILS'),
      merchantRaw: 'BOOKING.COM',
      merchantNormalized: 'BOOKING.COM',
      foreign: { amount: fromMajorUnits(-30, 'USD'), exchangeRate: 3.6667 },
      installment: {
        sequence: 2,
        total: 3,
        groupKey: 'group-booking',
        originalTotal: fromMajorUnits(330, 'ILS'),
      },
    }),
    1,
  )

  insertTransaction(
    db,
    row({
      id: 'tx-refund',
      transactionDate: localDate(2026, 7, 28),
      amount: fromMajorUnits(200, 'ILS'),
      direction: 'INFLOW',
      merchantRaw: 'זיכוי',
      merchantNormalized: 'זיכוי',
    }),
    1,
  )
  db.run(`UPDATE fmt_transaction SET category = ? WHERE id = 'tx-refund'`, [UNCATEGORIZED_ID])

  return db
}

function ids(db: Database, filter: Parameters<typeof listTransactions>[1]): string[] {
  return listTransactions(db, filter).map((transaction) => transaction.id)
}

describe('listTransactions', () => {
  it('returns the whole ledger, most recently charged first', async () => {
    const db = await seeded()
    // Five rows share the 2 August charge date, which is the normal shape of a
    // card statement rather than an edge case — so the purchase date is what
    // actually orders them, and it is the column the eye scans.
    expect(ids(db, {})).toEqual([
      'tx-refund',
      'tx-electric',
      'tx-abroad',
      'tx-amazon',
      'tx-groceries',
      'tx-steam',
    ])
  })

  it('ranges over the charge date, falling back to the transaction date', async () => {
    const db = await seeded()
    // Bought 15 June, charged 2 July: an August range must not contain it, and
    // a July one must — the charge date is what the filter reads.
    expect(ids(db, { from: localDate(2026, 8, 1), to: localDate(2026, 8, 31) })).not.toContain(
      'tx-steam',
    )
    expect(ids(db, { from: localDate(2026, 7, 1), to: localDate(2026, 7, 31) })).toEqual(['tx-steam'])
  })

  it('includes the bounds themselves', async () => {
    const db = await seeded()
    expect(ids(db, { from: localDate(2026, 7, 2), to: localDate(2026, 7, 2) })).toEqual(['tx-steam'])
  })

  it('filters by account', async () => {
    const db = await seeded()
    expect(ids(db, { accountId: ACCOUNT_B }).sort()).toEqual(['tx-amazon', 'tx-steam'])
  })

  it('filters by category', async () => {
    const db = await seeded()
    expect(ids(db, { categoryId: 'cat:groceries' })).toEqual(['tx-groceries'])
  })

  it('treats a missing category and the system one as equally uncategorized', async () => {
    const db = await seeded()
    // tx-refund is parked on cat:uncategorized; the rest have no category at all.
    expect(ids(db, { uncategorized: true }).sort()).toEqual([
      'tx-abroad',
      'tx-amazon',
      'tx-refund',
      'tx-steam',
    ])
  })

  it('searches the raw merchant, the normalized one, and the provider label', async () => {
    const db = await seeded()
    expect(ids(db, { search: 'שופרסל' })).toEqual(['tx-groceries'])
    // "שופרסל דיל 344" keeps its branch number in merchant_raw and loses it in
    // merchant_normalized, so a search for the stripped form has to reach the
    // normalized column to find anything.
    expect(ids(db, { search: 'שופרסל דיל' })).toEqual(['tx-groceries'])
    expect(ids(db, { search: 'מזון' })).toEqual(['tx-groceries'])
    expect(ids(db, { search: 'paypal' })).toEqual(['tx-steam'])
  })

  it('ignores the marks and spacing a pasted merchant name carries', async () => {
    const db = await seeded()
    expect(ids(db, { search: '‏שופרסל  דיל ' })).toEqual(['tx-groceries'])
  })

  it('treats a typed wildcard as text, not as a pattern', async () => {
    const db = await seeded()
    expect(ids(db, { search: '%' })).toEqual([])
    expect(ids(db, { search: '*STEAM' })).toEqual(['tx-steam'])
  })

  it('bounds the amount by magnitude, so a refund is not always the smallest row', async () => {
    const db = await seeded()
    expect(ids(db, { min: fromMajorUnits(200, 'ILS') }).sort()).toEqual([
      'tx-electric',
      'tx-groceries',
      'tx-refund',
    ])
    expect(ids(db, { max: fromMajorUnits(110, 'ILS') }).sort()).toEqual(['tx-abroad', 'tx-steam'])
    expect(ids(db, { min: fromMajorUnits(100, 'ILS'), max: fromMajorUnits(500, 'ILS') }).sort()).toEqual([
      'tx-abroad',
      'tx-groceries',
      'tx-refund',
    ])
  })

  it('keeps an amount bound inside its own currency', async () => {
    const db = await seeded()
    // The $30 row is 3000 minor units, which would sit inside an ILS 100–500
    // bound if the currency were ignored.
    expect(ids(db, { min: fromMajorUnits(1, 'ILS') })).not.toContain('tx-amazon')
    expect(ids(db, { min: fromMajorUnits(1, 'USD') })).toEqual(['tx-amazon'])
  })

  it('combines filters', async () => {
    const db = await seeded()
    expect(
      ids(db, {
        accountId: ACCOUNT_A,
        from: localDate(2026, 8, 1),
        to: localDate(2026, 8, 31),
        min: fromMajorUnits(300, 'ILS'),
      }).sort(),
    ).toEqual(['tx-electric', 'tx-groceries'])
  })

  it('caps the rows it returns', async () => {
    const db = await seeded()
    expect(listTransactions(db, {}, 2)).toHaveLength(2)
  })
})

describe('sorting the ledger', () => {
  const sorted = (db: Database, sort: TransactionSort, limit = 500): string[] =>
    listTransactions(db, {}, limit, sort).map((transaction) => transaction.id)

  it('defaults to newest first on the charge date, falling back to the purchase date', async () => {
    const db = await seeded()
    // The default has to be the order the ledger already had, or adding sorting
    // silently reorders every document that never asked for it.
    expect(listTransactions(db).map((t) => t.id)).toEqual(sorted(db, DEFAULT_SORT))

    const basis = listTransactions(db).map((t) => toISODate(t.chargeDate ?? t.transactionDate))
    expect(basis).toEqual([...basis].sort().reverse())
  })

  it('sorts by amount as the column shows it — signed, so the biggest charge is first', async () => {
    const db = await seeded()
    const ascending = sorted(db, { column: 'AMOUNT', direction: 'ASC' })

    expect(ascending[0]).toBe('tx-electric')
    expect(ascending[ascending.length - 1]).toBe('tx-refund')
    expect(sorted(db, { column: 'AMOUNT', direction: 'DESC' })[0]).toBe('tx-refund')
  })

  it('sorts by the normalized merchant, so branch numbers do not scatter a shop', async () => {
    const db = await seeded()
    const byName = listTransactions(db, {}, 500, { column: 'MERCHANT', direction: 'ASC' })
    const names = byName.map((transaction) => transaction.merchantNormalized)

    expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
  })

  it('sorts by the category path the row displays', async () => {
    const db = await seeded()
    const first = listTransactions(db, {}, 500, { column: 'CATEGORY', direction: 'DESC' })[0]
    expect(first?.categoryPath).toBe('Uncategorized') // above Living → Utilities, which it sorted below while paths had no top level
  })

  /**
   * The reason sorting is in SQL at all (D-032): the list stops at 500, so a
   * sort applied to what came back would order the page rather than the ledger.
   * With a cap of one, "the biggest charge" has to still be the biggest charge.
   */
  it('sorts the whole filter and then caps, never the other way round', async () => {
    const db = await seeded()
    expect(sorted(db, { column: 'AMOUNT', direction: 'ASC' }, 1)).toEqual(['tx-electric'])
  })

  it('breaks a tie the same way every time', async () => {
    const db = await seeded()
    const once = sorted(db, { column: 'CATEGORY', direction: 'ASC' })
    expect(sorted(db, { column: 'CATEGORY', direction: 'ASC' })).toEqual(once)
  })
})

describe('listTransactionIds', () => {
  it('returns every id the filter matches, past the list’s cap', async () => {
    const db = await seeded()
    expect(listTransactionIds(db)).toHaveLength(summarizeTransactions(db).count)
    expect(listTransactions(db, {}, 2)).toHaveLength(2)
  })

  it('honours the filter', async () => {
    const db = await seeded()
    expect([...listTransactionIds(db, { accountId: ACCOUNT_B })].sort()).toEqual([
      'tx-amazon',
      'tx-steam',
    ])
  })

  it('is empty when nothing matches', async () => {
    const db = await seeded()
    expect(listTransactionIds(db, { search: 'nothing here' })).toEqual([])
  })
})

describe('summarizeTransactions', () => {
  it('counts and totals the whole filter, not the page', async () => {
    const db = await seeded()
    const summary = summarizeTransactions(db, { accountId: ACCOUNT_A })

    expect(summary.count).toBe(4)
    expect(summary.totals).toEqual([
      { currency: 'ILS', outflowMinor: 173105, inflowMinor: 20000 },
    ])
  })

  it('splits the totals by currency rather than adding them together', async () => {
    const db = await seeded()
    const summary = summarizeTransactions(db, {})

    expect(summary.count).toBe(6)
    expect(summary.totals).toContainEqual({ currency: 'USD', outflowMinor: 3000, inflowMinor: 0 })
    expect(summary.totals).toContainEqual({ currency: 'ILS', outflowMinor: 178655, inflowMinor: 20000 })
  })

  it('counts an excluded row but leaves it out of the total', async () => {
    const db = await seeded()
    setExcludedFromStats(db, 'tx-electric', true, 2)

    const summary = summarizeTransactions(db, { accountId: ACCOUNT_A })
    expect(summary.count).toBe(4)
    expect(summary.excluded).toBe(1)
    expect(summary.totals).toEqual([{ currency: 'ILS', outflowMinor: 53105, inflowMinor: 20000 }])
  })

  it('is empty, not broken, when nothing matches', async () => {
    const db = await seeded()
    const summary = summarizeTransactions(db, { search: 'no such shop' })

    expect(summary).toEqual({ count: 0, excluded: 0, moved: 0, held: 0, totals: [], leftOut: [] })
  })
})

describe('findTransactionById', () => {
  it('reads the whole record, including where it came from', async () => {
    const db = await seeded()
    const detail = findTransactionById(db, 'tx-groceries')

    expect(detail?.merchantRaw).toBe('שופרסל דיל 344')
    expect(detail?.accountName).toBe('Cal – Visa 1234')
    expect(detail?.billingPeriod).toEqual({ year: 2026, month: 8 })
    expect(detail?.sourceRowRef).toBe('row 47')
    expect(detail?.provenance).toEqual({
      fileName: 'cal-2026-07.xlsx',
      sheetName: 'עסקאות',
      mappingName: 'Cal – Visa 1234',
      importedAt: 1770000000000,
    })
  })

  it('reads the original currency amount and the installment counter', async () => {
    const db = await seeded()
    const detail = findTransactionById(db, 'tx-abroad')

    expect(detail?.foreign).toEqual({ amount: { minor: -3000, currency: 'USD' }, exchangeRate: 3.6667 })
    expect(detail?.installment).toEqual({
      sequence: 2,
      total: 3,
      groupKey: 'group-booking',
      originalTotal: { minor: 33000, currency: 'ILS' },
    })
  })

  it('has no provenance for a row no import wrote', async () => {
    const db = await seeded()
    expect(findTransactionById(db, 'tx-steam')?.provenance).toBeUndefined()
  })

  it('is undefined for an id that is not there', async () => {
    const db = await seeded()
    expect(findTransactionById(db, 'nope')).toBeUndefined()
  })

  it('names the rule that assigned the category', async () => {
    // The column has been written since the commit path landed and was never
    // read back, so a rule-assigned category was indistinguishable on screen
    // from one that came from nowhere. "Categorization is always explainable"
    // (docs/conventions.md) is only true if this survives the round trip.
    const db = await seeded()
    const rule = createRule(
      db,
      { name: 'שופרסל', kind: 'CONTAINS', pattern: 'שופרסל', targetCategoryId: UNCATEGORIZED_ID },
      1000,
    )
    setCategoryFromRule(db, 'tx-steam', UNCATEGORIZED_ID, rule.id, 1000)

    const found = findTransactionById(db, 'tx-steam')
    expect(found?.categorySource).toBe('RULE')
    expect(found?.matchedRuleId).toBe(rule.id)
    expect(found?.matchedRuleName).toBe('שופרסל')
  })

  it('keeps what a rule since deleted did, and names no rule for it', async () => {
    // Deleting a rule does not un-happen the categorization it did: the row
    // keeps its category, as a rule's. A link names a row that is there (M25
    // U3), so the rule's id goes with the rule, and the panel says "a rule that
    // has since been deleted" — which is what happened.
    const db = await seeded()
    const rule = createRule(
      db,
      { name: 'gone', kind: 'CONTAINS', pattern: 'x', targetCategoryId: UNCATEGORIZED_ID },
      1000,
    )
    setCategoryFromRule(db, 'tx-steam', UNCATEGORIZED_ID, rule.id, 1000)
    deleteRule(db, rule.id, 2000)

    const found = findTransactionById(db, 'tx-steam')
    expect(found?.categoryId).toBe(UNCATEGORIZED_ID)
    expect(found?.categorySource).toBe('RULE')
    expect(found?.matchedRuleId).toBeUndefined()
    expect(found?.matchedRuleName).toBeUndefined()
  })
})

describe('setTransactionNote', () => {
  it('stores a note and clears it again', async () => {
    const db = await seeded()

    setTransactionNote(db, 'tx-groceries', '  split with Dana  ', 2)
    expect(findTransactionById(db, 'tx-groceries')?.note).toBe('split with Dana')

    // Blank is "no note", not a note that happens to be empty.
    setTransactionNote(db, 'tx-groceries', '   ', 3)
    expect(findTransactionById(db, 'tx-groceries')?.note).toBeUndefined()
  })
})

describe('setExcludedFromStats', () => {
  it('takes a row out of the monthly totals without removing it from the ledger', async () => {
    const db = await seeded()
    const before = monthlyTotals(db).find((month) => month.period === '2026-08' && month.currency === 'ILS')

    setExcludedFromStats(db, 'tx-electric', true, 2)

    const after = monthlyTotals(db).find((month) => month.period === '2026-08' && month.currency === 'ILS')
    expect(before!.outflowMinor - after!.outflowMinor).toBe(120000)
    expect(ids(db, {})).toContain('tx-electric')
    expect(findTransactionById(db, 'tx-electric')?.isExcludedFromStats).toBe(true)
  })

  it('puts it back', async () => {
    const db = await seeded()
    setExcludedFromStats(db, 'tx-electric', true, 2)
    setExcludedFromStats(db, 'tx-electric', false, 3)

    expect(findTransactionById(db, 'tx-electric')?.isExcludedFromStats).toBe(false)
  })
})
