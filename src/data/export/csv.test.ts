import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import type { MonthSummary } from '@/domain/model/statistics.ts'
import { createAccount } from '../repositories/accountRepository.ts'
import { monthlySummaryCsv, transactionsCsv } from './csv.ts'

async function ledger() {
  const db = await createLedgerDatabase()
  const card = createAccount(db, { name: 'כאל 4821', kind: 'CREDIT_CARD', last4: '4821' }, 1)

  const rows = [
    {
      id: 'tx-1',
      date: localDate(2026, 7, 3),
      charge: localDate(2026, 8, 2),
      minor: -42105,
      merchant: 'שופרסל דיל 344',
      installment: { sequence: 1, total: 3, groupKey: 'g1', originalTotal: money(-126315, 'ILS') },
    },
    {
      id: 'tx-2',
      date: localDate(2026, 7, 5),
      charge: localDate(2026, 8, 2),
      minor: -1900,
      merchant: 'Cafe, Corner "Best"',
      installment: undefined,
    },
  ]

  for (const row of rows) {
    insertTransaction(
      db,
      {
        id: row.id,
        accountId: card.id,
        transactionDate: row.date,
        chargeDate: row.charge,
        billingPeriod: { year: 2026, month: 8 },
        amount: money(row.minor, 'ILS'),
        direction: 'OUTFLOW',
        merchantRaw: row.merchant,
        merchantNormalized: row.merchant,
        providerCategory: 'מזון וצריכה',
        cardLast4: '4821',
        reference: undefined,
        note: undefined,
        installment: row.installment,
        foreign: undefined,
        naturalKey: row.id,
        importSessionId: undefined,
        sourceRowRef: undefined,
      },
      1,
    )
  }

  return db
}

describe('transactionsCsv', () => {
  it('writes a header and one line per row', async () => {
    const csv = await ledger().then((db) => transactionsCsv(db))
    const lines = csv.split('\r\n')

    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatch(/^Transaction date,Charge date,Billing period,Account,Merchant,/)
  })

  it('writes amounts as plain decimals a spreadsheet can sum', async () => {
    const csv = await ledger().then((db) => transactionsCsv(db))

    // Not ₪-421.05, not -42105, and not a float that arrived by dividing.
    expect(csv).toContain(',-421.05,ILS,OUTFLOW,')
    expect(csv).toContain(',-19.00,ILS,OUTFLOW,')
  })

  it('keeps both dates, which docs/05 says are not interchangeable', async () => {
    const csv = await ledger().then((db) => transactionsCsv(db))
    expect(csv).toContain('2026-07-03,2026-08-02,2026-08,')
  })

  it('quotes a merchant carrying a comma and a quote', async () => {
    const csv = await ledger().then((db) => transactionsCsv(db))
    expect(csv).toContain('"Cafe, Corner ""Best"""')
  })

  it('carries the installment slice as "1/3"', async () => {
    const csv = await ledger().then((db) => transactionsCsv(db))
    expect(csv).toContain(',1/3,')
  })

  it('respects the filter it is given', async () => {
    const db = await ledger()
    const csv = transactionsCsv(db, { search: 'שופרסל' })

    expect(csv.split('\r\n')).toHaveLength(2)
    expect(csv).toContain('שופרסל דיל 344')
    expect(csv).not.toContain('Cafe')
  })

  it('is not capped at the ledger screen’s 500', async () => {
    const db = await createLedgerDatabase()
    const card = createAccount(db, { name: 'Card', kind: 'CREDIT_CARD', last4: '1' }, 1)
    for (let index = 0; index < 620; index += 1) {
      insertTransaction(
        db,
        {
          id: `tx-${index}`,
          accountId: card.id,
          transactionDate: localDate(2026, 7, 1 + (index % 28)),
          chargeDate: undefined,
          billingPeriod: undefined,
          amount: money(-100, 'ILS'),
          direction: 'OUTFLOW',
          merchantRaw: `m${index}`,
          merchantNormalized: `m${index}`,
          providerCategory: undefined,
          cardLast4: undefined,
          reference: undefined,
          note: undefined,
          installment: undefined,
          foreign: undefined,
          naturalKey: `k-${index}`,
          importSessionId: undefined,
          sourceRowRef: undefined,
        },
        1,
      )
    }

    // The screen shows 500. A file the user is about to sum must be all of it.
    expect(transactionsCsv(db).split('\r\n')).toHaveLength(621)
  })

  it('is a header alone when nothing matches', async () => {
    const db = await createLedgerDatabase()
    expect(transactionsCsv(db).split('\r\n')).toHaveLength(1)
  })
})

describe('monthlySummaryCsv', () => {
  const month = (over: Partial<MonthSummary>): MonthSummary => ({
    period: { year: 2026, month: 7 },
    income: money(1_964_250, 'ILS'),
    expenses: money(1_204_000, 'ILS'),
    balance: money(760_250, 'ILS'),
    saved: money(250_000, 'ILS'),
    savingsRateBasisPoints: 1272,
    transactionCount: 143,
    isComplete: true,
    ...over,
  })

  it('writes the table in the order the screen prints it', () => {
    const csv = monthlySummaryCsv([month({})])
    const lines = csv.split('\r\n')

    expect(lines[0]).toBe('Month,Income,Expenses,Balance,Saved,Savings rate %,Transactions,Complete')
    expect(lines[1]).toBe('2026-07,19642.50,12040.00,7602.50,2500.00,12.72,143,yes')
  })

  it('leaves an unknown savings rate empty rather than zero', () => {
    // A month with no income has no rate. A column of zeroes would let a
    // spreadsheet average an answer the app refuses to give.
    const csv = monthlySummaryCsv([month({ savingsRateBasisPoints: undefined })])
    expect(csv.split('\r\n')[1]).toContain(',2500.00,,143,yes')
  })

  it('writes a negative balance as negative, never clamped', () => {
    const csv = monthlySummaryCsv([month({ balance: money(-31_050, 'ILS') })])
    expect(csv).toContain(',-310.50,')
  })

  it('marks a month in progress', () => {
    const csv = monthlySummaryCsv([month({ isComplete: false })])
    expect(csv.split('\r\n')[1]?.endsWith(',no')).toBe(true)
  })

  it('is a header alone for no months', () => {
    expect(monthlySummaryCsv([]).split('\r\n')).toHaveLength(1)
  })
})
