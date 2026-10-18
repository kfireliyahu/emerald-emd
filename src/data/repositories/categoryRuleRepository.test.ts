import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { fromMajorUnits } from '@/core/money.ts'
import { normalizeMerchant } from '@/core/text.ts'
import { firstMatch } from '@/domain/categorization.ts'
import {
  createRule,
  deleteRule,
  findRule,
  listRules,
  PRIORITY_STEP,
  recordHits,
  reorderRules,
  setRuleEnabled,
  updateRule,
} from './categoryRuleRepository.ts'

/** A ledger with no built-in rules, so every rule a test reads is one it wrote. */
async function seeded(): Promise<Database> {
  const db = await createLedgerDatabase({ builtInRules: false })
  db.run(
    `INSERT INTO fmt_account (id, name, kind, is_archived)
     VALUES ('acc-cal', 'Cal 1234', 'CREDIT_CARD', 0)`,
  )
  return db
}

describe('createRule', () => {
  it('round-trips a rule with all of its conditions', async () => {
    const db = await seeded()
    const created = createRule(
      db,
      {
        name: 'Big Cal charges',
        kind: 'CONTAINS',
        pattern: 'שופרסל',
        targetCategoryId: 'cat:groceries',
        conditions: {
          scopeAccountId: 'acc-cal',
          amountMin: fromMajorUnits(100, 'ILS'),
          amountMax: fromMajorUnits(500, 'ILS'),
        },
      },
      1000,
    )

    const read = findRule(db, created.id)
    expect(read).toEqual(created)
    expect(read?.conditions.amountMin).toEqual(fromMajorUnits(100, 'ILS'))
    expect(read?.conditions.amountMax).toEqual(fromMajorUnits(500, 'ILS'))
    expect(read?.conditions.scopeAccountId).toBe('acc-cal')
    expect(read?.origin).toBe('USER')
    expect(read?.isEnabled).toBe(true)
    expect(read?.hitCount).toBe(0)
  })

  it('stores bounds as magnitudes, whichever sign they were handed in', async () => {
    const db = await seeded()
    const created = createRule(
      db,
      {
        name: 'Refunds',
        kind: 'AMOUNT_RANGE',
        targetCategoryId: 'cat:refunds',
        conditions: { amountMin: fromMajorUnits(-100, 'ILS') },
      },
      1000,
    )
    expect(findRule(db, created.id)?.conditions.amountMin).toEqual(fromMajorUnits(100, 'ILS'))
  })

  it('puts each new rule at the end of its own origin tier', async () => {
    const db = await seeded()
    const first = createRule(db, { name: 'a', kind: 'CONTAINS', pattern: 'a', targetCategoryId: 'cat:fuel' }, 1)
    const second = createRule(db, { name: 'b', kind: 'CONTAINS', pattern: 'b', targetCategoryId: 'cat:fuel' }, 2)
    const learned = createRule(
      db,
      { name: 'c', kind: 'CONTAINS', pattern: 'c', targetCategoryId: 'cat:fuel', origin: 'LEARNED_FROM_CORRECTION' },
      3,
    )

    expect(first.priority).toBe(PRIORITY_STEP)
    expect(second.priority).toBe(PRIORITY_STEP * 2)
    // A learned rule is last among learned rules, not last overall — its tier
    // already puts it below every user rule.
    expect(learned.priority).toBe(PRIORITY_STEP)
  })
})

describe('editing', () => {
  it('leaves out fields alone', async () => {
    const db = await seeded()
    const created = createRule(
      db,
      { name: 'Fuel', kind: 'CONTAINS', pattern: 'פז', targetCategoryId: 'cat:fuel' },
      1000,
    )

    updateRule(db, created.id, { pattern: 'דלק' }, 2000)

    const read = findRule(db, created.id)
    expect(read?.pattern).toBe('דלק')
    expect(read?.name).toBe('Fuel')
    expect(read?.targetCategoryId).toBe('cat:fuel')
    expect(read?.priority).toBe(created.priority)
  })

  it('can clear a condition by passing conditions without it', async () => {
    const db = await seeded()
    const created = createRule(
      db,
      {
        name: 'Scoped',
        kind: 'CONTAINS',
        pattern: 'פז',
        targetCategoryId: 'cat:fuel',
        conditions: { scopeAccountId: 'acc-cal' },
      },
      1000,
    )

    updateRule(db, created.id, { conditions: {} }, 2000)
    expect(findRule(db, created.id)?.conditions.scopeAccountId).toBeUndefined()
  })

  it('enables and disables without touching anything else', async () => {
    const db = await seeded()
    const created = createRule(db, { name: 'x', kind: 'CONTAINS', pattern: 'x', targetCategoryId: 'cat:fuel' }, 1)

    setRuleEnabled(db, created.id, false, 2)
    expect(findRule(db, created.id)?.isEnabled).toBe(false)

    setRuleEnabled(db, created.id, true, 3)
    expect(findRule(db, created.id)).toEqual(created)
  })

  it('removes, so a deleted rule leaves the list and the file (M25 U2)', async () => {
    const db = await seeded()
    const created = createRule(db, { name: 'x', kind: 'CONTAINS', pattern: 'x', targetCategoryId: 'cat:fuel' }, 1)

    deleteRule(db, created.id, 2)
    expect(listRules(db)).toEqual([])
    expect(findRule(db, created.id)).toBeUndefined()
    expect(db.exec(`SELECT 1 FROM fmt_category_rule WHERE id = '${created.id}'`)).toEqual([])
  })

  it('tells a second rule of the same name apart, since a name is one rule’s', async () => {
    const db = await seeded()
    createRule(db, { name: 'דלק', kind: 'CONTAINS', pattern: 'דלק', targetCategoryId: 'cat:fuel' }, 1)
    const second = createRule(db, { name: 'דלק', kind: 'EXACT_MERCHANT', pattern: 'דלק', targetCategoryId: 'cat:fuel' }, 2)
    expect(second.name).toBe('דלק (2)')
  })
})

describe('reorderRules', () => {
  it('renormalizes to even steps, so there is always room between two rules', async () => {
    const db = await seeded()
    const a = createRule(db, { name: 'a', kind: 'CONTAINS', pattern: 'a', targetCategoryId: 'cat:fuel' }, 1)
    const b = createRule(db, { name: 'b', kind: 'CONTAINS', pattern: 'b', targetCategoryId: 'cat:fuel' }, 2)
    const c = createRule(db, { name: 'c', kind: 'CONTAINS', pattern: 'c', targetCategoryId: 'cat:fuel' }, 3)

    reorderRules(db, [c.id, a.id, b.id], 4)

    expect(listRules(db).map((rule) => rule.name)).toEqual(['c', 'a', 'b'])
    expect(listRules(db).map((rule) => rule.priority)).toEqual([10, 20, 30])
  })

  it('ignores an id that is not a live rule', async () => {
    const db = await seeded()
    const a = createRule(db, { name: 'a', kind: 'CONTAINS', pattern: 'a', targetCategoryId: 'cat:fuel' }, 1)

    reorderRules(db, ['no-such-rule', a.id], 2)
    expect(findRule(db, a.id)?.priority).toBe(PRIORITY_STEP * 2)
  })
})

describe('hit counting', () => {
  it('counts a fire and remembers when', async () => {
    const db = await seeded()
    const created = createRule(db, { name: 'x', kind: 'CONTAINS', pattern: 'x', targetCategoryId: 'cat:fuel' }, 1)

    recordHits(db, [created.id, created.id], 5000)

    const read = findRule(db, created.id)
    expect(read?.hitCount).toBe(2)
    expect(read?.lastMatchedAt).toBe(5000)
  })
})

describe('the stored rule set and the engine', () => {
  it('feeds the engine rules that decide a category', async () => {
    const db = await seeded()
    createRule(db, { name: 'Fuel', kind: 'CONTAINS', pattern: 'פז', targetCategoryId: 'cat:fuel' }, 1)
    const groceries = createRule(
      db,
      { name: 'Groceries', kind: 'EXACT_MERCHANT', pattern: 'שופרסל דיל', targetCategoryId: 'cat:groceries' },
      2,
    )

    const winner = firstMatch(listRules(db), {
      merchantNormalized: normalizeMerchant('שופרסל דיל 344'),
      providerCategory: undefined,
      amount: fromMajorUnits(-421.05, 'ILS'),
      accountId: 'acc-cal',
    })

    expect(winner?.id).toBe(groceries.id)
    expect(winner?.targetCategoryId).toBe('cat:groceries')
  })
})
