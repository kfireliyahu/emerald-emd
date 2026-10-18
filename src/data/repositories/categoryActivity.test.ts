import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'

import { fromMajorUnits } from '@/core/money.ts'
import { createLedgerDatabase } from '../packs/ledger/testing.ts'
import { categoryActivity } from './categoryRepository.ts'

/**
 * A document with an account and nothing filed, ready to have rows put into it.
 */
async function blank(): Promise<Database> {
  const db = await createLedgerDatabase()
  db.run(
    `INSERT INTO fmt_account (id, name, kind, is_archived)
     VALUES ('acc-1', 'Card 1234', 'CREDIT_CARD', 0)`,
  )
  return db
}

let counter = 0
function row(
  db: Database,
  options: {
    categoryId: string | null
    date: string
    major: number
    currency?: string
    excluded?: boolean
  },
): void {
  counter += 1
  db.run(
    `INSERT INTO fmt_transaction (
       id, account, transaction_date, charge_date, billing_period,
       amount_minor, amount_currency, direction, merchant_raw, merchant_normalized,
       category, is_excluded_from_stats, natural_key, category_source
     ) VALUES (?, 'acc-1', ?, ?, ?, ?, ?, 'OUTFLOW', 'm', 'm', ?, ?, ?, 'MANUAL')`,
    [
      `tx-${counter}`,
      options.date,
      options.date,
      options.date.slice(0, 7),
      fromMajorUnits(options.major, options.currency ?? 'ILS').minor,
      options.currency ?? 'ILS',
      options.categoryId,
      options.excluded === true ? 1 : 0,
      `key-${counter}`,
    ],
  )
}

describe('categoryActivity', () => {
  it('is empty for a document with nothing filed', async () => {
    const db = await blank()
    expect(categoryActivity(db, '2026-01-01').size).toBe(0)
  })

  it('counts every row ever filed and remembers the last date', async () => {
    const db = await blank()
    row(db, { categoryId: 'cat:groceries', date: '2024-03-04', major: -100 })
    row(db, { categoryId: 'cat:groceries', date: '2026-08-01', major: -200 })

    const groceries = categoryActivity(db, '2026-06-01').get('cat:groceries')
    expect(groceries?.transactions).toBe(2)
    expect(groceries?.lastUsed).toBe('2026-08-01')
  })

  it('sums the recent outflow and leaves the older rows out of it', async () => {
    const db = await blank()
    row(db, { categoryId: 'cat:fuel', date: '2024-03-04', major: -500 })
    row(db, { categoryId: 'cat:fuel', date: '2026-07-10', major: -120.5 })
    row(db, { categoryId: 'cat:fuel', date: '2026-08-02', major: -80 })

    const fuel = categoryActivity(db, '2026-06-01').get('cat:fuel')
    expect(fuel?.recent).toEqual([{ currency: 'ILS', outflowMinor: 20_050 }])
    // The old row still counts as a row: "nothing points at this" would be a lie.
    expect(fuel?.transactions).toBe(3)
  })

  it('keeps the currencies apart rather than adding them together', async () => {
    const db = await blank()
    row(db, { categoryId: 'cat:travel', date: '2026-07-01', major: -300 })
    row(db, { categoryId: 'cat:travel', date: '2026-07-02', major: -50, currency: 'USD' })

    const travel = categoryActivity(db, '2026-06-01').get('cat:travel')
    expect([...(travel?.recent ?? [])].sort((a, b) => a.currency.localeCompare(b.currency))).toEqual(
      [
        { currency: 'ILS', outflowMinor: 30_000 },
        { currency: 'USD', outflowMinor: 5_000 },
      ],
    )
  })

  it('leaves an excluded row out of the spend and keeps it in the count', async () => {
    const db = await blank()
    row(db, { categoryId: 'cat:transfer', date: '2026-07-01', major: -900, excluded: true })

    const transfer = categoryActivity(db, '2026-06-01').get('cat:transfer')
    expect(transfer?.transactions).toBe(1)
    expect(transfer?.recent).toEqual([])
  })

  it('reports a category that has rows but no recent spend as used and quiet', async () => {
    const db = await blank()
    row(db, { categoryId: 'cat:gifts', date: '2023-01-01', major: -40 })

    const gifts = categoryActivity(db, '2026-06-01').get('cat:gifts')
    expect(gifts?.transactions).toBe(1)
    expect(gifts?.recent).toEqual([])
    expect(gifts?.lastUsed).toBe('2023-01-01')
  })

  it('says nothing about a row with no category — that is the backlog, not a category', async () => {
    const db = await blank()
    row(db, { categoryId: null, date: '2026-07-01', major: -10 })

    expect(categoryActivity(db, '2026-06-01').size).toBe(0)
  })
})
