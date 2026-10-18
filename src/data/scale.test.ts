import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { addMonths, localDate, monthEnd, type YearMonth } from '@/core/time.ts'
import { createAccount } from './repositories/accountRepository.ts'
import { countUncategorized } from './repositories/categoryRepository.ts'
import { debtsSummary } from './repositories/debtRepository.ts'
import { listFixedExpenses } from './repositories/fixedExpenseRepository.ts'
import { listPaychecks } from './repositories/paycheckRepository.ts'
import { homeSummary } from './repositories/homeRepository.ts'
import { netWorth } from './repositories/netWorthRepository.ts'
import { monthlyReport, yearlyReport } from './repositories/statisticsRepository.ts'
import {
  countTransactions,
  insertTransactions,
  listTransactions,
  listTransactionIds,
  monthlyTotals,
  summarizeTransactions,
} from './repositories/transactionRepository.ts'
import { exportDatabase, inTransaction, openDatabase } from './db/database.ts'

/**
 * Ten years of transactions, and what the app costs on top of them.
 *
 * The last open half of M6.5's migration line, and the only one that is a
 * *measurement* rather than an assertion about data. 02-architecture makes two
 * claims — that 10 years ≈ 60k rows is "trivial for SQLite in wasm", and that a
 * Web Worker should wait until something is *measured* to be slow. Neither had a
 * number behind it. This file is the number.
 *
 * It is a different fixture from `db/migrations.test.ts` on purpose: those 28
 * rows are hand-written because their exact values have to survive; these 60,000
 * are generated because only their volume matters.
 *
 * **The ceilings are deliberately loose.** A timing assertion tight enough to be
 * interesting is a timing assertion that flakes on a loaded machine. These are
 * set to catch the thing worth catching — an operation going from milliseconds
 * to seconds because someone loaded 60k rows into JS to sum them — and nothing
 * finer. The printed table below is what a human reads; the ceilings are what
 * fails the build.
 */

const START: YearMonth = { year: 2016, month: 9 }
const MONTHS = 120
const PER_MONTH = 500
const OUTFLOWS_PER_MONTH = 490
const TOTAL = MONTHS * PER_MONTH

/** ₪100.00 out, ₪1,000.00 in — round, so every total below is checkable by hand. */
const OUTFLOW_MINOR = -10_000
const INFLOW_MINOR = 100_000

const EXPECTED_OUTFLOW = MONTHS * OUTFLOWS_PER_MONTH * -OUTFLOW_MINOR
const EXPECTED_INFLOW = MONTHS * (PER_MONTH - OUTFLOWS_PER_MONTH) * INFLOW_MINOR

/** Enough distinct names that a merchant search and a group-by have real work. */
const MERCHANTS = [
  'שופרסל דיל',
  'רמי לוי',
  'הוט',
  'פרטנר',
  'סונול',
  'פז',
  'ACE',
  'איקאה',
  'סופר פארם',
  'מקדונלדס',
  'ארומה',
  'גולף אנד קו',
]

/** Built-ins from migration 002, so the ledger's category join has rows to find. */
const CATEGORIES = ['cat:rent', 'cat:utilities', 'cat:electricity', 'cat:municipal']

const timings: { label: string; ms: number; pass?: number }[] = []

/**
 * **A read is measured beside a pass over the whole table** (M29 F6). The
 * ceiling below is a second on a quiet machine, and it failed under load: the
 * monthly report takes ~690ms alone and 851ms with the rest of the suite on
 * every core. One aggregation over all sixty thousand rows — ~85ms quiet —
 * timed just before and just after the read says how slow the machine is
 * *right now*; the ratio between the two barely moves with load (8.3 passes
 * quiet, 8.4 loaded), so the read is held to the load it ran under.
 */
let scanOf: (() => void) | undefined
/** How many passes over the table a read may cost: a second on a quiet machine. */
const PASSES = 12

function pass(): number {
  const started = performance.now()
  scanOf?.()
  return performance.now() - started
}

function measure<T>(label: string, work: () => T): T {
  const before = pass()
  const started = performance.now()
  const result = work()
  const ms = performance.now() - started
  timings.push({ label, ms, pass: (before + pass()) / 2 })
  return result
}

async function tenYearsOfTransactions() {
  const db = await createLedgerDatabase()
  const account = createAccount(db, { name: 'כאל 4821', kind: 'CREDIT_CARD', last4: '4821' }, 1)

  // Built first and written in one call, as an import commits a statement.
  const rows: Parameters<typeof insertTransactions>[1][number][] = []
  inTransaction(db, () => {
    let index = 0
    for (let offset = 0; offset < MONTHS; offset += 1) {
      const period = addMonths(START, offset)
      for (let row = 0; row < PER_MONTH; row += 1, index += 1) {
        const isInflow = row >= OUTFLOWS_PER_MONTH
        const day = 1 + (row % 27)
        // One row in twenty is a slice of a twelve-payment purchase: 3,000
        // slices in 250 groups. Without them the installment reads would be
        // measured against nothing and would look free.
        const slice = index % 20 === 0 ? Math.floor(index / 20) : undefined

        rows.push({
          id: `tx-${index}`,
          accountId: account.id,
          transactionDate: localDate(period.year, period.month, day),
          chargeDate: localDate(period.year, period.month, Math.min(day + 1, 28)),
          billingPeriod: period,
          amount: money(isInflow ? INFLOW_MINOR : OUTFLOW_MINOR, 'ILS'),
          direction: isInflow ? 'INFLOW' : 'OUTFLOW',
          merchantRaw: `${MERCHANTS[index % MERCHANTS.length]} ${index}`,
          merchantNormalized: MERCHANTS[index % MERCHANTS.length] ?? '',
          providerCategory: 'מזון וצריכה',
          cardLast4: '4821',
          reference: undefined,
          note: undefined,
          installment:
            slice === undefined
              ? undefined
              : {
                  sequence: (slice % 12) + 1,
                  total: 12,
                  groupKey: `grp-${Math.floor(slice / 12)}`,
                  originalTotal: money(OUTFLOW_MINOR * 12, 'ILS'),
                },
          foreign: undefined,
          naturalKey: `key-${index}`,
          importSessionId: undefined,
          sourceRowRef: `עסקאות!${index}`,
        })
      }
    }
    insertTransactions(db, rows, 1)
  })

  // Four rows in five categorized, so the ledger's join and the category rollup
  // both have work and 12,000 rows stay in the uncategorized backlog.
  db.run(
    `UPDATE fmt_transaction
        SET category = CASE CAST(SUBSTR(id, 4) AS INTEGER) % 5
              ${CATEGORIES.map((id, at) => `WHEN ${at} THEN '${id}'`).join('\n              ')}
              ELSE NULL END,
            category_source = CASE WHEN CAST(SUBSTR(id, 4) AS INTEGER) % 5 = 4 THEN 'NONE' ELSE 'RULE' END`,
  )

  return db
}

describe('ten years of transactions', () => {
  let db: Awaited<ReturnType<typeof tenYearsOfTransactions>>
  let saved: Uint8Array

  beforeAll(async () => {
    const started = performance.now()
    db = await tenYearsOfTransactions()
    scanOf = () => summarizeTransactions(db)
    timings.push({ label: `import ${TOTAL.toLocaleString()} rows (one transaction)`, ms: performance.now() - started })
  }, 120_000)

  afterAll(() => {
    const width = Math.max(...timings.map((entry) => entry.label.length))
    const lines = timings.map(
      (entry) =>
        `  ${entry.label.padEnd(width)}  ${entry.ms.toFixed(0).padStart(6)} ms` +
        (entry.pass === undefined ? '' : `  (a pass: ${entry.pass.toFixed(0)} ms)`),
    )
    // The point of the file. Read this, then decide about a Web Worker.
    console.log(`\n60k-row measurements\n${lines.join('\n')}\n`)
  })

  it('holds sixty thousand rows', () => {
    expect(measure('count all rows', () => countTransactions(db))).toBe(TOTAL)
  })

  it('sums every row without loading one into JS', () => {
    // The claim 02-architecture actually makes: statistics are SQL aggregations.
    // A regression here is someone replacing the GROUP BY with a JS reduce, and
    // the ceiling is what catches it.
    const summary = measure('summarize all 60k (uncapped)', () => summarizeTransactions(db))

    expect(summary.count).toBe(TOTAL)
    expect(summary.totals).toEqual([
      { currency: 'ILS', outflowMinor: EXPECTED_OUTFLOW, inflowMinor: EXPECTED_INFLOW },
    ])
  })

  it('opens the ledger', () => {
    const page = measure('ledger, first page of 500', () => listTransactions(db))
    expect(page).toHaveLength(500)

    const filtered = measure('ledger, merchant search', () =>
      listTransactions(db, { search: 'שופרסל' }),
    )
    expect(filtered.length).toBeGreaterThan(0)

    const month = measure('ledger, one month', () =>
      listTransactions(db, {
        from: localDate(2026, 6, 1),
        to: monthEnd({ year: 2026, month: 6 }),
      }),
    )
    expect(month).toHaveLength(500)
  })

  it('selects everything', () => {
    // "Select all" is the one read that is *meant* to bring the whole ledger
    // back — ids only, which is the shape the repository chose for this reason.
    const ids = measure('select all (60k ids)', () => listTransactionIds(db))
    expect(ids).toHaveLength(TOTAL)
  })

  it('answers the statistics screens', () => {
    const asOf = localDate(2026, 6, 30)

    const month = measure('monthly report', () =>
      monthlyReport(db, { year: 2026, month: 6 }, asOf, { currency: 'ILS' }),
    )
    expect(month.period).toEqual({ year: 2026, month: 6 })

    measure('yearly report', () => yearlyReport(db, 2025, asOf, { currency: 'ILS' }))
    measure('monthly totals (the trend)', () => monthlyTotals(db))
    measure('net worth', () => netWorth(db, asOf, 'ILS'))
  })

  it('opens the home dashboard, and every part of it', () => {
    // Broken out by part because the whole is what the user waits on and a part
    // is what a regression lives in. This is how the 613ms in `debtsSummary`
    // was found: the dashboard took a second, and nothing in it should.
    const asOf = localDate(2026, 6, 30)
    const period = { year: 2026, month: 6 } as const

    measure('  home: countUncategorized', () => countUncategorized(db))
    measure('  home: debtsSummary', () => debtsSummary(db, period, { currency: 'ILS' }))
    measure('  home: listFixedExpenses', () => listFixedExpenses(db))
    measure('  home: listPaychecks', () => listPaychecks(db))

    const home = measure('home dashboard (all of it)', () => homeSummary(db, asOf, 'ILS'))
    expect(home.period).toEqual(period)
    expect(home.isEmpty).toBe(false)
  })

  it('saves and reopens the document', async () => {
    // Every Save serializes the whole file, and every open parses it. At this
    // size that is the one cost the user waits on rather than a query.
    saved = measure('save (serialize the document)', () => exportDatabase(db))

    const started = performance.now()
    const reopened = await openDatabase(saved)
    timings.push({ label: 'open the saved document', ms: performance.now() - started })
    timings.push({ label: `document size: ${(saved.byteLength / 1_048_576).toFixed(1)} MB`, ms: 0 })

    expect(countTransactions(reopened)).toBe(TOTAL)
  }, 60_000)

  /**
   * **What opening a real ledger costs once, on the build that moves it** (M25
   * U3, open question *M22 U6 #4*). The same sixty thousand rows, written into
   * the old table the way a document from before M25 holds them, then opened as
   * the app opens one. It is a one-off wait behind the notice that says what
   * the conversion did, so it is measured and not held to the read ceiling.
   */
  it('is nowhere near needing a Web Worker', () => {
    // The ceiling exists to catch an order of magnitude, not a percentage. A
    // read that takes a second at this size is a read that blocks the UI, and
    // that is the trigger 02-architecture names for moving sql.js off the main
    // thread. Import and save are excluded: both are already explicit,
    // user-initiated waits with a progress affordance. **The second stretches
    // with the machine** (M29 F6): twelve passes are a second here when it is
    // quiet, and more when the suite is running beside it — never fewer.
    const reads = timings.filter(
      (entry) =>
        !entry.label.startsWith('import ') &&
        !entry.label.startsWith('save ') &&
        !entry.label.startsWith('open ') &&
        !entry.label.startsWith('convert ') &&
        !entry.label.startsWith('document size'),
    )

    expect(reads.length).toBeGreaterThan(0)
    for (const entry of reads) {
      const ceiling = Math.max(1_000, PASSES * (entry.pass ?? 0))
      expect({ [entry.label]: entry.ms < ceiling }).toEqual({ [entry.label]: true })
    }
  })
})
