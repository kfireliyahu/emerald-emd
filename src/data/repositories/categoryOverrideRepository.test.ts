import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { normalizeMerchant } from '@/core/text.ts'
import { exportDatabase, openDatabase, query } from '../db/database.ts'
import { setCategoryFromRule } from './categoryRepository.ts'
import { createRule } from './categoryRuleRepository.ts'
import {
  correctCategories,
  correctCategory,
  countCorrections,
  overrideReason,
} from './categoryOverrideRepository.ts'

const SHUFERSAL = normalizeMerchant('שופרסל דיל 344')

/** Two months of the same shop, plus one other merchant, in one account. */
async function seeded(): Promise<Database> {
  const db = await createLedgerDatabase()
  seedAccount(db)
  insert(db, 'tx-1', 'שופרסל דיל 344', SHUFERSAL)
  insert(db, 'tx-2', 'שופרסל דיל 812', SHUFERSAL)
  insert(db, 'tx-3', 'שופרסל דיל 344', SHUFERSAL)
  insert(db, 'tx-4', 'פז יעל', normalizeMerchant('פז יעל'))
  return db
}

function seedAccount(db: Database): void {
  db.run(
    `INSERT INTO fmt_account (id, name, kind, is_archived)
     VALUES ('acc-cal', 'Cal 1234', 'CREDIT_CARD', 0)`,
  )
}

function insert(db: Database, id: string, raw: string, normalized: string): void {
  db.run(
    `INSERT INTO fmt_transaction (
       id, account, transaction_date, amount_minor, amount_currency, direction, merchant_raw,
       merchant_normalized, provider_category, natural_key, is_excluded_from_stats, category_source
     ) VALUES (?, 'acc-cal', '2026-07-01', -42105, 'ILS', 'OUTFLOW', ?, ?, 'סופרמרקט', ?, 0, 'NONE')`,
    [id, raw, normalized, `key-${id}`],
  )
}

function storedCategory(db: Database, id: string): { category: unknown; source: unknown } {
  const row = query(db, `SELECT category, category_source FROM fmt_transaction WHERE id = ?`, [id])[0]
  return { category: row?.['category'] ?? null, source: row?.['category_source'] }
}

describe('correctCategory', () => {
  it('assigns the category and records what it replaced', async () => {
    const db = await seeded()

    const correction = correctCategory(db, 'tx-1', 'cat:groceries', 1000)

    expect(correction?.previousCategoryId).toBeUndefined()
    expect(correction?.previousSource).toBe('NONE')
    expect(correction?.newCategoryId).toBe('cat:groceries')
    expect(correction?.reason).toBe('FILLED_BLANK')
    expect(correction?.merchantRaw).toBe('שופרסל דיל 344')
    expect(storedCategory(db, 'tx-1')).toEqual({ category: 'cat:groceries', source: 'MANUAL' })
  })

  it('hands back the row as the engine sees it, so the offer needs no second query', async () => {
    const db = await seeded()

    const correction = correctCategory(db, 'tx-1', 'cat:groceries', 1000)

    expect(correction?.subject).toEqual({
      merchantNormalized: SHUFERSAL,
      providerCategory: 'סופרמרקט',
      amount: { minor: -42105, currency: 'ILS' },
      accountId: 'acc-cal',
    })
  })

  it('records overruling a rule as a different act from filling in a blank', async () => {
    const db = await seeded()
    const rule = createRule(
      db,
      { name: 'Groceries', kind: 'CONTAINS', pattern: 'שופרסל', targetCategoryId: 'cat:groceries' },
      1,
    )
    setCategoryFromRule(db, 'tx-1', 'cat:groceries', rule.id, 500)

    const correction = correctCategory(db, 'tx-1', 'cat:shopping', 1000)

    expect(correction?.previousCategoryId).toBe('cat:groceries')
    expect(correction?.previousSource).toBe('RULE')
    expect(correction?.reason).toBe('REPLACED_RULE')
    // And the correction is MANUAL, so no automation will ever revisit it (D-009).
    expect(storedCategory(db, 'tx-1')).toEqual({ category: 'cat:shopping', source: 'MANUAL' })
  })

  it('records clearing a category, and offers no count to learn from', async () => {
    const db = await seeded()
    correctCategory(db, 'tx-1', 'cat:groceries', 1000)

    const cleared = correctCategory(db, 'tx-1', undefined, 2000)

    expect(cleared?.reason).toBe('CLEARED')
    expect(cleared?.previousCategoryId).toBe('cat:groceries')
    expect(cleared?.corrections).toBeUndefined()
    expect(storedCategory(db, 'tx-1')).toEqual({ category: null, source: 'NONE' })
  })

  it('records nothing when the row already had that category', async () => {
    const db = await seeded()
    correctCategory(db, 'tx-1', 'cat:groceries', 1000)

    // Re-picking what is already there is not a correction. The assignment
    // still happens; there is simply no previous value to audit, and counting
    // it would let one row insist three times on its own.
    expect(correctCategory(db, 'tx-1', 'cat:groceries', 2000)).toBeUndefined()
    expect(countCorrections(db, SHUFERSAL, 'cat:groceries')).toBe(1)
  })

  it('does nothing for an id that is not in the document', async () => {
    const db = await seeded()

    expect(correctCategory(db, 'tx-nope', 'cat:groceries', 1000)).toBeUndefined()
    expect(countCorrections(db, SHUFERSAL, 'cat:groceries')).toBe(0)
  })

  it('confirming a rule by hand still becomes MANUAL', async () => {
    const db = await seeded()
    const rule = createRule(
      db,
      { name: 'Groceries', kind: 'CONTAINS', pattern: 'שופרסל', targetCategoryId: 'cat:groceries' },
      1,
    )
    setCategoryFromRule(db, 'tx-1', 'cat:groceries', rule.id, 500)

    expect(correctCategory(db, 'tx-1', 'cat:groceries', 1000)).toBeUndefined()
    expect(storedCategory(db, 'tx-1')).toEqual({ category: 'cat:groceries', source: 'MANUAL' })
  })
})

describe('correctCategories', () => {
  it('assigns the whole batch, as MANUAL, and audits every row of it', async () => {
    const db = await seeded()

    const result = correctCategories(db, ['tx-1', 'tx-2', 'tx-3'], 'cat:groceries', 1000)

    expect(result.changed).toBe(3)
    for (const id of ['tx-1', 'tx-2', 'tx-3']) {
      expect(storedCategory(db, id)).toEqual({ category: 'cat:groceries', source: 'MANUAL' })
    }
    // Per row, because a batch is not one event that happened to three
    // transactions — it is three events the user caused at once.
    expect(query(db, 'SELECT COUNT(*) AS n FROM fmt_category_override')[0]?.['n']).toBe(3)
  })

  it('is all or nothing', async () => {
    const db = await seeded()
    // A row that is not in the document is skipped rather than fatal; what must
    // not happen is half the batch landing.
    const result = correctCategories(db, ['tx-1', 'tx-nope', 'tx-2'], 'cat:groceries', 1000)

    expect(result.changed).toBe(2)
    expect(storedCategory(db, 'tx-1').category).toBe('cat:groceries')
    expect(storedCategory(db, 'tx-2').category).toBe('cat:groceries')
  })

  it('does not count re-picking the category a row already has', async () => {
    const db = await seeded()
    correctCategory(db, 'tx-1', 'cat:groceries', 1000)

    const result = correctCategories(db, ['tx-1', 'tx-2'], 'cat:groceries', 2000)
    expect(result.changed).toBe(1)
    expect(query(db, 'SELECT COUNT(*) AS n FROM fmt_category_override')[0]?.['n']).toBe(2)
  })

  it('offers the merchant when every row that changed shares one', async () => {
    const db = await seeded()

    const result = correctCategories(db, ['tx-1', 'tx-2', 'tx-3'], 'cat:groceries', 1000)

    expect(result.merchantNormalized).toBe(SHUFERSAL)
    expect(result.merchantRaw).toBe('שופרסל דיל 344')
    expect(result.subject?.merchantNormalized).toBe(SHUFERSAL)
    // One decision over three rows is three transactions of this merchant in
    // this category, which is what the offer says out loud.
    expect(result.corrections).toBe(3)
  })

  /**
   * The distinction the two callers need. A group on the bulk screen is always
   * one merchant; a selection on the ledger might be forty rows of forty shops,
   * and "always categorize these as Groceries?" cannot be asked about that.
   */
  it('offers no merchant when the batch spans several', async () => {
    const db = await seeded()

    const result = correctCategories(db, ['tx-1', 'tx-4'], 'cat:groceries', 1000)

    expect(result.changed).toBe(2)
    expect(result.merchantNormalized).toBeUndefined()
    expect(result.merchantRaw).toBeUndefined()
    expect(result.subject).toBeUndefined()
    expect(result.corrections).toBeUndefined()
  })

  it('says nothing happened for an empty batch', async () => {
    const db = await seeded()
    expect(correctCategories(db, [], 'cat:groceries', 1000).changed).toBe(0)
    expect(query(db, 'SELECT COUNT(*) AS n FROM fmt_category_override')[0]?.['n']).toBe(0)
  })

  it('clears a category across a batch, and offers no rule for it', async () => {
    const db = await seeded()
    correctCategories(db, ['tx-1', 'tx-2'], 'cat:groceries', 1000)

    const cleared = correctCategories(db, ['tx-1', 'tx-2'], undefined, 2000)

    expect(cleared.changed).toBe(2)
    expect(storedCategory(db, 'tx-1')).toEqual({ category: null, source: 'NONE' })
    // "Always categorize this as nothing" is not a rule anyone means to write.
    expect(cleared.corrections).toBeUndefined()
  })

  it('records what each row replaced, not what the batch replaced', async () => {
    const db = await seeded()
    setCategoryFromRule(db, 'tx-1', 'cat:restaurants', 'rule-x', 500)

    correctCategories(db, ['tx-1', 'tx-2'], 'cat:groceries', 1000)

    const rows = query(
      db,
      `SELECT "transaction" AS transaction_id, previous_category AS previous_category_id, previous_source
         FROM fmt_category_override
        ORDER BY "transaction"`,
    )
    expect(rows[0]?.['previous_source']).toBe('RULE')
    expect(rows[0]?.['previous_category_id']).toBe('cat:restaurants')
    expect(rows[1]?.['previous_source']).toBe('NONE')
    expect(rows[1]?.['previous_category_id']).toBeNull()
  })

  it('survives a save and reopen like anything else written to the file', async () => {
    const db = await seeded()
    correctCategories(db, ['tx-1', 'tx-2'], 'cat:groceries', 1000)

    const reopened = await openDatabase(exportDatabase(db))
    expect(storedCategory(reopened, 'tx-2')).toEqual({
      category: 'cat:groceries',
      source: 'MANUAL',
    })
    expect(countCorrections(reopened, SHUFERSAL, 'cat:groceries')).toBe(2)
  })
})

describe('countCorrections', () => {
  it('counts the same merchant across different rows, however it was spelled', async () => {
    const db = await seeded()

    // Two different branch numbers, one merchant once normalized — which is the
    // form a rule would match, so it is the form the habit is counted in.
    expect(correctCategory(db, 'tx-1', 'cat:groceries', 1000)?.corrections).toBe(1)
    expect(correctCategory(db, 'tx-2', 'cat:groceries', 2000)?.corrections).toBe(2)
    expect(correctCategory(db, 'tx-3', 'cat:groceries', 3000)?.corrections).toBe(3)
  })

  it('counts one row changing its mind once', async () => {
    const db = await seeded()

    correctCategory(db, 'tx-1', 'cat:groceries', 1000)
    correctCategory(db, 'tx-1', 'cat:shopping', 2000)
    const back = correctCategory(db, 'tx-1', 'cat:groceries', 3000)

    // Three overrides, one transaction. The third-repeat prompt is about a
    // habit across charges, not about one charge being talked about a lot.
    expect(back?.corrections).toBe(1)
  })

  it('keeps merchants and categories apart', async () => {
    const db = await seeded()

    correctCategory(db, 'tx-1', 'cat:groceries', 1000)
    correctCategory(db, 'tx-4', 'cat:groceries', 2000)

    expect(countCorrections(db, SHUFERSAL, 'cat:groceries')).toBe(1)
    expect(countCorrections(db, SHUFERSAL, 'cat:shopping')).toBe(0)
    expect(countCorrections(db, normalizeMerchant('פז יעל'), 'cat:groceries')).toBe(1)
  })

  it('is zero on an empty document', async () => {
    const db = await createLedgerDatabase()

    expect(countCorrections(db, SHUFERSAL, 'cat:groceries')).toBe(0)
  })
})

describe('overrideReason', () => {
  it('reads the reason kind off the columns that decide it', () => {
    expect(overrideReason(undefined, 'NONE', 'cat:groceries')).toBe('FILLED_BLANK')
    expect(overrideReason('cat:fuel', 'RULE', 'cat:groceries')).toBe('REPLACED_RULE')
    expect(overrideReason('cat:fuel', 'MANUAL', 'cat:groceries')).toBe('CHANGED_MANUAL')
    expect(overrideReason('cat:fuel', 'AI', 'cat:groceries')).toBe('REPLACED_SUGGESTION')
    expect(overrideReason('cat:fuel', 'INHERITED', 'cat:groceries')).toBe('REPLACED_SUGGESTION')
    // Clearing is what happened regardless of where the old value came from.
    expect(overrideReason('cat:fuel', 'RULE', undefined)).toBe('CLEARED')
  })
})
