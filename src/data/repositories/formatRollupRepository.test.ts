/**
 * A rollup run against a real table (M25 E2, D-271) — and the proof the unit
 * owes: **the ledger's month-by-category statistics reproduced by a
 * declaration**, figure for figure, on a fixture.
 */

import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { column, DECLARATION_LANGUAGE, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { parseRollup, type RollupDeclaration } from '@/domain/format/rollup.ts'
import { createDatabase } from '../db/database.ts'
import { exportEncoded, openEncoded } from '../storage/encoding.ts'
import { createAccount } from './accountRepository.ts'
import { createCategory, setCategoryManually } from './categoryRepository.ts'
import { adoptFormat, listFormats, readFormat } from './formatRepository.ts'
import { runRollup } from './formatRollupRepository.ts'
import { insertRows } from './formatRowRepository.ts'
import { categoryObservations } from './statisticsRepository.ts'
import { syncSettlementLinks } from './cardSettlementRepository.ts'
import { actualsByCategory } from './fixedExpenseRepository.ts'
import { findTransactionById, setExcludedFromStats, summarizeTransactions } from './transactionRepository.ts'

const NOW = 1_755_000_000_000

function rollup(name: string, text: string): RollupDeclaration {
  const parsed = parseRollup(name, text)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.value
}

const SHOP: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'shop',
  title: 'Shop',
  notes: '',
  columns: [column('name', 'text', { required: true }), column('essential', 'boolean')],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

const SPEND: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'spend',
  title: 'Spend',
  notes: '',
  columns: [
    column('label', 'text', { required: true }),
    column('amount', 'money'),
    column('bought_on', 'date', { required: true }),
    column('charged_on', 'date'),
    column('kind', 'enum', { values: ['OUT', 'IN'] }),
    column('shop', 'link', { target: 'shop' }),
  ],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
  rollups: [
    rollup('by_shop', 'sum of amount by month of charged_on or bought_on and shop where kind is OUT'),
    rollup('essentials', 'count by month of bought_on where shop.essential is true'),
    rollup('largest', 'minimum of amount by month of bought_on'),
  ],
}

async function shops(): Promise<Database> {
  const db = await createDatabase()
  for (const each of [SHOP, SPEND]) {
    const plan = adoptFormat(db, each, NOW)
    expect(plan.refusals).toEqual([])
  }
  insertRows(db, SHOP, [
    { name: 'Grocer', essential: 1 },
    { name: 'Cinema', essential: 0 },
  ], ['grocer', 'cinema'])
  return db
}

function spend(
  label: string,
  minor: number | null,
  boughtOn: string,
  extra: { chargedOn?: string; kind?: string | null; shop?: string | null; currency?: string } = {},
): Record<string, string | number | null> {
  return {
    label,
    amount_minor: minor,
    amount_currency: minor === null ? null : (extra.currency ?? 'ILS'),
    bought_on: boughtOn,
    charged_on: extra.chargedOn ?? null,
    kind: extra.kind === undefined ? 'OUT' : extra.kind,
    shop: extra.shop === undefined ? 'grocer' : extra.shop,
  }
}

describe('runRollup', () => {
  it('sums per month and link, by the charge date first, and names the link', async () => {
    const db = await shops()
    insertRows(db, SPEND, [
      spend('a', -100_00, '2026-03-02'),
      spend('b', -50_00, '2026-02-27', { chargedOn: '2026-03-10' }),
      spend('c', -30_00, '2026-03-05', { shop: 'cinema' }),
      spend('d', 20_00, '2026-03-06', { kind: 'IN' }),
      spend('e', -7_00, '2026-04-01', { shop: null }),
    ])
    const result = runRollup(db, SPEND, 'by_shop', listFormats(db))
    expect(result?.groups).toEqual([
      { period: '2026-03', by: 'cinema', rows: 1, value: { kind: 'VALUE', figures: [{ value: -30_00, currency: 'ILS' }] } },
      { period: '2026-03', by: 'grocer', rows: 2, value: { kind: 'VALUE', figures: [{ value: -150_00, currency: 'ILS' }] } },
      { period: '2026-04', by: undefined, rows: 1, value: { kind: 'VALUE', figures: [{ value: -7_00, currency: 'ILS' }] } },
    ])
    expect(result?.labels.get('grocer')).toBe('Grocer')
  })

  it('never adds two currencies, and marks only the month with a row it cannot read', async () => {
    const db = await shops()
    insertRows(db, SPEND, [
      spend('a', -100_00, '2026-03-02'),
      spend('b', -5_00, '2026-03-03', { currency: 'USD' }),
      spend('c', -40_00, '2026-04-02'),
      spend('d', null, '2026-04-03'),
      spend('e', -10_00, '2026-05-01', { kind: null }),
    ], ['a', 'b', 'c', 'd', 'e'])
    const groups = runRollup(db, SPEND, 'by_shop', listFormats(db))?.groups ?? []
    expect(groups[0]?.value).toEqual({
      kind: 'VALUE',
      figures: [
        { value: -100_00, currency: 'ILS' },
        { value: -5_00, currency: 'USD' },
      ],
    })
    const april = groups[1]?.value
    expect(april?.kind === 'UNCHECKED' ? april.reason : '').toContain('Row d of spend')
    // A row with no kind may be one the filter takes: its month cannot say.
    const may = groups[2]?.value
    expect(may?.kind === 'UNCHECKED' ? may.reason : '').toContain('Row e of spend')
  })

  it('filters one hop through a link, and keeps to the months asked for', async () => {
    const db = await shops()
    insertRows(db, SPEND, [
      spend('a', -1_00, '2026-03-02'),
      spend('b', -1_00, '2026-03-03', { shop: 'cinema' }),
      spend('c', -1_00, '2026-04-02'),
      spend('d', -1_00, '2026-05-02'),
    ])
    const counted = runRollup(db, SPEND, 'essentials', listFormats(db), { from: '2026-03', to: '2026-04' })
    expect(counted?.groups.map((group) => [group.period, group.value])).toEqual([
      ['2026-03', { kind: 'VALUE', figures: [{ value: 1 }] }],
      ['2026-04', { kind: 'VALUE', figures: [{ value: 1 }] }],
    ])
    expect(runRollup(db, SPEND, 'largest', listFormats(db))?.groups[0]?.value).toEqual({
      kind: 'VALUE',
      figures: [{ value: -1_00, currency: 'ILS' }],
    })
    expect(runRollup(db, SPEND, 'nothing', listFormats(db))).toBeUndefined()
  })

  it('says not, empty and one of, and an empty link passes `is not` (M36 U04)', async () => {
    const db = await shops()
    const wider: FormatDeclaration = {
      ...SPEND,
      rollups: [
        rollup('not_essential', 'sum of amount by month of bought_on where shop.essential is not true and kind is one of OUT, IN'),
        rollup('nowhere', 'count by month of bought_on where shop is empty'),
        rollup('somewhere', 'count by month of bought_on where shop is not empty and amount is not empty'),
      ],
    }
    expect(adoptFormat(db, wider, NOW).refusals).toEqual([])
    insertRows(db, wider, [
      spend('a', -100_00, '2026-03-02'),
      spend('b', -30_00, '2026-03-05', { shop: 'cinema' }),
      spend('c', -7_00, '2026-03-06', { shop: null }),
      spend('d', null, '2026-03-07', { shop: 'cinema', kind: 'IN' }),
    ])
    const formats = listFormats(db)
    const figure = (name: string) => runRollup(db, wider, name, formats)?.groups.map((group) => group.value)
    // Cinema and the row with no shop: neither is essential. The row with no
    // amount is the one that cannot answer, and says so.
    expect(figure('not_essential')).toEqual([
      { kind: 'UNCHECKED', reason: expect.stringContaining('has nothing in amount') as unknown },
    ])
    expect(figure('nowhere')).toEqual([{ kind: 'VALUE', figures: [{ value: 1 }] }])
    expect(figure('somewhere')).toEqual([{ kind: 'VALUE', figures: [{ value: 2 }] }])
    expect(readFormat(db, 'spend')?.rollups).toEqual(wider.rollups)
  })

  it('is kept by the document, as bytes and as text', async () => {
    const db = await shops()
    expect(readFormat(db, 'spend')?.rollups).toEqual(SPEND.rollups)
    const encoded = await exportEncoded(db, 'text')
    if (!encoded.ok) throw new Error(encoded.error)
    const { db: reopened } = await openEncoded(encoded.value)
    expect(readFormat(reopened, 'spend')?.rollups).toEqual(SPEND.rollups)
  })
})

/* ------------------------------------------------ the ledger's statistics */

describe('the ledger’s month by category, as a declaration', () => {
  it('reproduces categoryObservations figure for figure', async () => {
    const db = await createLedgerDatabase()
    createAccount(db, { name: 'Card', kind: 'CREDIT_CARD', last4: '1111' }, NOW)
    const account = String(db.exec("SELECT id FROM fmt_account WHERE last4 = '1111'")[0]?.values[0]?.[0])
    const categories = ['Rollup A', 'Rollup B', 'Rollup C', 'Rollup D'].map((name) =>
      createCategory(db, { name, kind: 'EXPENSE' }, NOW),
    )

    // A fixed pseudo-random fixture: six months, four categories and none,
    // refunds, rows excluded from statistics, rows charged a month after they
    // were bought, and a second currency.
    let seed = 7
    const next = (limit: number): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
      return seed % limit
    }
    for (let index = 0; index < 400; index += 1) {
      const month = 1 + next(6)
      const day = 1 + next(28)
      const roll = next(20)
      const direction = roll === 0 ? 'TRANSFER' : roll < 3 ? 'INFLOW' : 'OUTFLOW'
      const minor = (1 + next(50_000)) * (direction === 'INFLOW' ? 1 : -1)
      const id = `t${String(index)}`
      insertTransaction(
        db,
        {
          id,
          accountId: account,
          transactionDate: localDate(2026, month, day),
          chargeDate: next(3) === 0 ? localDate(2026, Math.min(12, month + 1), 2) : undefined,
          billingPeriod: undefined,
          amount: money(minor, next(15) === 0 ? 'USD' : 'ILS'),
          direction,
          merchantRaw: `m${String(next(30))}`,
          merchantNormalized: `m${String(next(30))}`,
          providerCategory: undefined,
          cardLast4: undefined,
          reference: undefined,
          note: undefined,
          installment: undefined,
          foreign: undefined,
          naturalKey: id,
          importSessionId: undefined,
          sourceRowRef: undefined,
        },
        NOW,
      )
      const category = next(5)
      if (category < 4) setCategoryManually(db, id, categories[category], NOW)
      // A transfer is excluded, as a card's settlement is: see the note below.
      if (direction === 'TRANSFER' || next(12) === 0) setExcludedFromStats(db, id, true, NOW)
    }

    const transaction = readFormat(db, 'transaction')
    expect(transaction?.rollups?.map((each) => each.name)).toEqual(['spending'])
    if (transaction === undefined) return
    const result = runRollup(db, transaction, 'spending', listFormats(db))
    if (result === undefined) throw new Error('no spending rollup')

    let compared = 0
    for (let month = 1; month <= 7; month += 1) {
      const period = `2026-${String(month).padStart(2, '0')}`
      const ledger = categoryObservations(db, { year: 2026, month }, { currency: 'ILS' })
      const declared = result.groups
        .filter((group) => group.period === period)
        .flatMap((group) => {
          if (group.value.kind !== 'VALUE') throw new Error(group.value.reason)
          const ils = group.value.figures.find((figure) => figure.currency === 'ILS')
          return ils === undefined ? [] : [{ category: group.by, outflow: -ils.value }]
        })
      expect(
        declared.map((each) => [each.category, each.outflow]).sort(),
      ).toEqual(ledger.map((each) => [each.categoryId, each.outflow.minor]).sort())
      compared += ledger.length
    }
    expect(compared).toBeGreaterThan(20)
    // The declaration says `direction is OUTFLOW` where the ledger's SQL says
    // `amount < 0`. Under the sign rule the two differ only on a transfer out
    // that nobody excluded, which is U3's question to answer (D-271).
  })

  /**
   * **The done-test of M36 U04**: the declared `spending` is the rule the
   * Statistics screen reads, so a month with a moved, a held, a settled and a
   * left-out row comes to the same figure both ways — and the Plan's actuals
   * and the Transactions screen's "went out" with them.
   */
  it('is the Statistics screen’s spending, with a moved, a held, a settled and a left-out row (M36 U04)', async () => {
    const db = await createLedgerDatabase()
    const card = createAccount(db, { name: 'Card', kind: 'CREDIT_CARD', last4: '2222' }, NOW)
    const bank = createAccount(db, { name: 'Bank', kind: 'BANK' }, NOW)
    const broker = createAccount(db, { name: 'Broker', kind: 'HOLDINGS' }, NOW)
    const food = createCategory(db, { name: 'Food U04', kind: 'EXPENSE' }, NOW)
    const saved = createCategory(db, { name: 'Savings U04', kind: 'SAVING' }, NOW)
    const row = (id: string, accountId: string, minor: number, category?: string): void => {
      insertTransaction(
        db,
        {
          id,
          accountId,
          transactionDate: localDate(2026, 6, 10),
          chargeDate: undefined,
          billingPeriod: undefined,
          amount: money(minor, 'ILS'),
          direction: minor < 0 ? 'OUTFLOW' : 'INFLOW',
          merchantRaw: id,
          merchantNormalized: id,
          providerCategory: undefined,
          cardLast4: undefined,
          reference: undefined,
          note: undefined,
          installment: undefined,
          foreign: undefined,
          naturalKey: id,
          importSessionId: undefined,
          sourceRowRef: undefined,
        },
        NOW,
      )
      if (category !== undefined) setCategoryManually(db, id, category, NOW)
    }
    row('spent', card.id, -100_00, food)
    row('uncategorised', card.id, -7_00) // passes `is not`: nothing is not a transfer
    row('moved', bank.id, -500_00, saved) // Money moved (D-316)
    row('held', broker.id, -300_00, food) // on an account with holdings (D-358)
    row('bought', card.id, -40_00, food)
    db.run("UPDATE fmt_transaction SET holding = 'h-1' WHERE id = 'bought'") // names a holding (M30 U2)
    row('settled', bank.id, -900_00, food) // the card's bill, its charges counted on the card
    syncSettlementLinks(
      db,
      [{ bankTransactionId: 'settled', cardAccountId: card.id, billingPeriod: undefined, matchConfidence: 'HIGH', decision: 'EXCLUDED' }],
      NOW,
    )
    row('left', card.id, -60_00, food) // the person's own answer
    setExcludedFromStats(db, 'left', true, NOW)

    const transaction = readFormat(db, 'transaction')
    if (transaction === undefined) throw new Error('no transaction')
    const groups = runRollup(db, transaction, 'spending', listFormats(db))?.groups ?? []
    const declared = groups.flatMap((group) =>
      group.value.kind === 'VALUE' ? [[group.by ?? null, -(group.value.figures[0]?.value ?? 0)] as const] : [],
    )
    expect([...declared].sort()).toEqual([[food, 100_00], [null, 7_00]].sort())

    const ledger = categoryObservations(db, { year: 2026, month: 6 }, { currency: 'ILS' })
    expect(ledger.map((each) => [each.categoryId ?? null, each.outflow.minor]).sort()).toEqual([...declared].sort())
    expect(actualsByCategory(db, localDate(2026, 6, 1), localDate(2026, 6, 30)).get(food)?.minor).toBe(100_00)
    expect(summarizeTransactions(db).totals[0]?.outflowMinor).toBe(107_00)
    // The flag is the person's alone: the settlement's answer is its own column.
    expect(findTransactionById(db, 'settled')).toMatchObject({ isExcludedFromStats: false, countedOnCard: true })
  })
})
