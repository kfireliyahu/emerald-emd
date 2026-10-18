import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { fromMajorUnits } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { normalizeMerchant } from '@/core/text.ts'
import { dominantCategory, orderGroups, settledCount } from '@/domain/merchantGroups.ts'
import { createLedgerDatabase, insertTransaction } from '../packs/ledger/testing.ts'
import { setCategoryFromRule, setCategoryManually } from './categoryRepository.ts'
import { bankMerchants, listMerchantGroups, merchantGroupIds } from './merchantGroupRepository.ts'
import { type InsertableTransaction } from './transactionRepository.ts'

let seq = 0

function add(
  db: Database,
  merchantRaw: string,
  amountMajor: number,
  overrides: Partial<InsertableTransaction> = {},
): string {
  seq += 1
  const id = `tx-${seq}`
  insertTransaction(
    db,
    {
      id,
      accountId: 'acc-cal',
      transactionDate: localDate(2026, 7, 3),
      chargeDate: undefined,
      billingPeriod: undefined,
      amount: fromMajorUnits(amountMajor, 'ILS'),
      direction: amountMajor < 0 ? 'OUTFLOW' : 'INFLOW',
      merchantRaw,
      merchantNormalized: normalizeMerchant(merchantRaw),
      providerCategory: undefined,
      cardLast4: undefined,
      reference: undefined,
      note: undefined,
      installment: undefined,
      foreign: undefined,
      naturalKey: id,
      importSessionId: undefined,
      sourceRowRef: undefined,
      ...overrides,
    },
    1000,
  )
  return id
}

async function ledger(): Promise<Database> {
  const db = await createLedgerDatabase()
  db.run(
    `INSERT INTO fmt_account (id, name, kind, is_archived)
     VALUES ('acc-cal', 'Cal 1234', 'CREDIT_CARD', 0),
            ('acc-max', 'Max 9876', 'CREDIT_CARD', 0)`,
  )
  return db
}

describe('listMerchantGroups', () => {
  it('is empty for a document with nothing in it', async () => {
    expect(listMerchantGroups(await ledger())).toEqual([])
  })

  it('folds the branch numbers together, because that is what a rule would match', async () => {
    const db = await ledger()
    add(db, 'שופרסל דיל 344', -120)
    add(db, 'שופרסל דיל 812', -80)

    const groups = listMerchantGroups(db)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.merchantNormalized).toBe('שופרסל דיל')
    expect(groups[0]?.count).toBe(2)
    expect(groups[0]?.totals).toEqual([{ currency: 'ILS', outflowMinor: 20000, inflowMinor: 0 }])
  })

  it('shows the spelling most of the rows use', async () => {
    const db = await ledger()
    add(db, 'שופרסל דיל 344', -10)
    add(db, 'שופרסל דיל 344', -10)
    add(db, 'שופרסל דיל 812', -10)

    expect(listMerchantGroups(db)[0]?.merchantRaw).toBe('שופרסל דיל 344')
  })

  it('keeps two currencies apart rather than adding them', async () => {
    const db = await ledger()
    add(db, 'AMAZON', -100)
    add(db, 'AMAZON', -50, { amount: fromMajorUnits(-50, 'USD') })

    const totals = listMerchantGroups(db)[0]?.totals ?? []
    expect(totals).toHaveLength(2)
    expect(totals.find((total) => total.currency === 'ILS')?.outflowMinor).toBe(10000)
    expect(totals.find((total) => total.currency === 'USD')?.outflowMinor).toBe(5000)
  })

  it('separates outflow from inflow', async () => {
    const db = await ledger()
    add(db, 'ARNONA', -300)
    add(db, 'ARNONA', 50)

    expect(listMerchantGroups(db)[0]?.totals[0]).toEqual({
      currency: 'ILS',
      outflowMinor: 30000,
      inflowMinor: 5000,
    })
  })

  it('leaves out rows that already have a category', async () => {
    const db = await ledger()
    const settled = add(db, 'שופרסל', -100)
    add(db, 'שופרסל', -100)
    setCategoryManually(db, settled, 'cat:groceries', 2000)

    expect(listMerchantGroups(db)[0]?.count).toBe(1)
  })

  it('treats the system Uncategorized category as backlog, not as an answer', async () => {
    const db = await ledger()
    const parked = add(db, 'שופרסל', -100)
    setCategoryManually(db, parked, 'cat:uncategorized', 2000)

    expect(listMerchantGroups(db)[0]?.count).toBe(1)
  })

  it('drops a merchant entirely once nothing of it is left uncategorized', async () => {
    const db = await ledger()
    const only = add(db, 'שופרסל', -100)
    setCategoryManually(db, only, 'cat:groceries', 2000)

    expect(listMerchantGroups(db)).toEqual([])
  })

  it('scopes with the ledger’s own filter vocabulary', async () => {
    const db = await ledger()
    add(db, 'שופרסל', -100)
    add(db, 'פז ילו', -200, { accountId: 'acc-max' })

    expect(listMerchantGroups(db, { accountId: 'acc-max' }).map((g) => g.merchantNormalized)).toEqual(
      ['פז ילו'],
    )
  })

  it('ignores a categoryId in the scope — the backlog is the backlog', async () => {
    const db = await ledger()
    add(db, 'שופרסל', -100)

    expect(listMerchantGroups(db, { categoryId: 'cat:fuel' })).toHaveLength(1)
  })
})

describe('what a merchant has already been put in', () => {
  it('reports the user’s own past decisions, with their counts', async () => {
    const db = await ledger()
    for (let i = 0; i < 14; i++) setCategoryManually(db, add(db, 'שופרסל', -10), 'cat:groceries', 2000)
    for (let i = 0; i < 4; i++) setCategoryManually(db, add(db, 'שופרסל', -10), 'cat:gifts', 2000)
    add(db, 'שופרסל', -10)

    const group = listMerchantGroups(db)[0]
    expect(group?.count).toBe(1)
    expect(settledCount(group!)).toBe(18)
    expect(dominantCategory(group!)).toEqual({ categoryId: 'cat:groceries', count: 14 })
  })

  it('counts a category a rule assigned, not only one picked by hand', async () => {
    // What the row holds is the hint. How it got there is a different question,
    // and the detail panel is where it is asked.
    const db = await ledger()
    setCategoryFromRule(db, add(db, 'פז ילו', -200), 'cat:fuel', 'builtin:il.fuel.paz-yellow', 2000)
    add(db, 'פז ילו', -200)

    expect(dominantCategory(listMerchantGroups(db)[0]!)).toEqual({
      categoryId: 'cat:fuel',
      count: 1,
    })
  })

  it('answers about the merchant rather than about the scope', async () => {
    // Scoped to one card, the hint still reads the other card's history: "what
    // have I put Shufersal in before" is a question about the shop.
    const db = await ledger()
    setCategoryManually(db, add(db, 'שופרסל', -10, { accountId: 'acc-max' }), 'cat:groceries', 2000)
    add(db, 'שופרסל', -10)

    const group = listMerchantGroups(db, { accountId: 'acc-cal' })[0]
    expect(group?.count).toBe(1)
    expect(dominantCategory(group!)?.categoryId).toBe('cat:groceries')
  })

  it('says nothing about a merchant with no history', async () => {
    const db = await ledger()
    add(db, 'חנות הפרחים של דנה', -60)

    expect(listMerchantGroups(db)[0]?.settled).toEqual([])
  })
})

describe("the provider's own heading", () => {
  it('comes back most common first, with the count that earned the order', async () => {
    const db = await ledger()
    add(db, 'רמי לוי 12', -100, { providerCategory: 'סופרמרקטים' })
    add(db, 'רמי לוי 12', -80, { providerCategory: 'סופרמרקטים' })
    add(db, 'רמי לוי 12', -60, { providerCategory: 'מזון ומשקאות' })

    expect(listMerchantGroups(db)[0]?.providerCategories).toEqual([
      { value: 'סופרמרקטים', count: 2 },
      { value: 'מזון ומשקאות', count: 1 },
    ])
  })

  it('is empty where the file had no such column, which is information in itself', async () => {
    const db = await ledger()
    add(db, 'משהו', -100)

    expect(listMerchantGroups(db)[0]?.providerCategories).toEqual([])
  })

  it('does not count a blank cell as a heading', async () => {
    const db = await ledger()
    add(db, 'משהו', -100, { providerCategory: '   ' })

    expect(listMerchantGroups(db)[0]?.providerCategories).toEqual([])
  })

  it('describes the rows in scope, not the merchant across all time', async () => {
    // Unlike "already filed under", which is a question about the merchant:
    // this is a fact about the very rows the caller is looking at.
    const db = await ledger()
    add(db, 'דלק', -100, { providerCategory: 'דלק', chargeDate: localDate(2026, 7, 3) })
    add(db, 'דלק', -100, { providerCategory: 'תחבורה', chargeDate: localDate(2026, 8, 3) })

    const july = listMerchantGroups(db, { from: localDate(2026, 7, 1), to: localDate(2026, 7, 31) })
    expect(july[0]?.providerCategories).toEqual([{ value: 'דלק', count: 1 }])
  })
})

describe('merchantGroupIds', () => {
  it('names exactly the rows the group counted', async () => {
    const db = await ledger()
    const a = add(db, 'שופרסל דיל 344', -100)
    const b = add(db, 'שופרסל דיל 812', -100)
    const settled = add(db, 'שופרסל דיל 900', -100)
    setCategoryManually(db, settled, 'cat:groceries', 2000)
    add(db, 'פז ילו', -100)

    expect([...merchantGroupIds(db, 'שופרסל דיל')].sort()).toEqual([a, b].sort())
  })

  it('honours the same scope the list was built with', async () => {
    const db = await ledger()
    add(db, 'שופרסל', -100)
    const onMax = add(db, 'שופרסל', -100, { accountId: 'acc-max' })

    expect(merchantGroupIds(db, 'שופרסל', { accountId: 'acc-max' })).toEqual([onMax])
  })

  it('is empty for a merchant that is not in the backlog', async () => {
    expect(merchantGroupIds(await ledger(), 'שופרסל')).toEqual([])
  })
})

describe('the screen’s default order', () => {
  it('puts the biggest pile of work first', async () => {
    const db = await ledger()
    add(db, 'פז ילו', -900)
    for (let i = 0; i < 5; i++) add(db, 'שופרסל', -20)

    expect(orderGroups(listMerchantGroups(db), 'COUNT').map((g) => g.merchantNormalized)).toEqual([
      'שופרסל',
      'פז ילו',
    ])
  })
})

describe('bankMerchants', () => {
  it('is the merchants that took money out of a bank account, and no card merchant', async () => {
    const db = await ledger()
    db.run(`INSERT INTO fmt_account (id, name, kind, is_archived) VALUES ('acc-bank', 'Hapoalim', 'BANK', 0)`)
    add(db, 'כרטיס אשראי כאל', -3000, { accountId: 'acc-bank' })
    add(db, 'משכורת', 9000, { accountId: 'acc-bank' })
    add(db, 'שופרסל', -20)

    expect([...bankMerchants(db)]).toEqual([normalizeMerchant('כרטיס אשראי כאל')])
  })
})
