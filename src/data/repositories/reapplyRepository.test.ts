import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { normalizeMerchant } from '@/core/text.ts'
import { planReapply } from '@/domain/reapply.ts'
import { query } from '../db/database.ts'
import { correctCategory } from './categoryOverrideRepository.ts'
import { UNCATEGORIZED_ID, setCategoryFromRule } from './categoryRepository.ts'
import { createRule, findRule, listRules } from './categoryRuleRepository.ts'
import {
  commitReapply,
  listReapplyCandidates,
  undoReapply,
  undoableRun,
} from './reapplyRepository.ts'

const SHUFERSAL = normalizeMerchant('שופרסל דיל 344')
const PAZ = normalizeMerchant('פז יעל')

/** A ledger with no built-in rules: every rule a re-apply here runs is one a test wrote. */
async function seeded(): Promise<Database> {
  const db = await createLedgerDatabase({ builtInRules: false })
  db.run(
    `INSERT INTO fmt_account (id, name, kind, is_archived)
     VALUES ('acc-cal', 'Cal 1234', 'CREDIT_CARD', 0),
            ('acc-max', 'Max 9876', 'CREDIT_CARD', 0)`,
  )
  insert(db, 't1', 'שופרסל דיל 344', SHUFERSAL, 'acc-cal', '2026-07-03')
  insert(db, 't2', 'שופרסל דיל 812', SHUFERSAL, 'acc-cal', '2026-06-03')
  insert(db, 't3', 'פז יעל', PAZ, 'acc-max', '2026-07-11')
  return db
}

function insert(
  db: Database,
  id: string,
  raw: string,
  normalized: string,
  accountId: string,
  date: string,
): void {
  db.run(
    `INSERT INTO fmt_transaction (
       id, account, transaction_date, charge_date, amount_minor, amount_currency, direction,
       merchant_raw, merchant_normalized, provider_category, natural_key, is_excluded_from_stats,
       category_source
     ) VALUES (?, ?, ?, ?, -42105, 'ILS', 'OUTFLOW', ?, ?, 'סופרמרקט', ?, 0, 'NONE')`,
    [id, accountId, date, date, raw, normalized, `key-${id}`],
  )
}

function groceriesRule(db: Database): string {
  return createRule(
    db,
    { name: 'Groceries', kind: 'CONTAINS', pattern: 'שופרסל', targetCategoryId: 'cat:groceries' },
    1000,
  ).id
}

function stored(db: Database, id: string): Record<string, unknown> | undefined {
  return query(
    db,
    `SELECT category AS category_id, category_source, matched_rule AS matched_rule_id
       FROM fmt_transaction WHERE id = ?`,
    [id],
  )[0]
}

/** Preview and commit in one step, the way the panel does it. */
function reapply(db: Database, scope = 'Everything', now = 2000) {
  const candidates = listReapplyCandidates(db)
  const plan = planReapply(listRules(db), candidates)
  return { plan, run: commitReapply(db, plan, scope, now) }
}

describe('listReapplyCandidates', () => {
  it('never offers a manually categorized row', async () => {
    // F03's acceptance criterion, enforced in SQL rather than above it: a
    // manual assignment is not filtered out later, it is never in the list.
    const db = await seeded()
    correctCategory(db, 't1', 'cat:shopping', 1500)

    const ids = listReapplyCandidates(db).map((row) => row.id)

    expect(ids).not.toContain('t1')
    expect(ids).toEqual(expect.arrayContaining(['t2', 't3']))
  })

  it('offers a row a rule categorized, so an edited rule can reach it', async () => {
    const db = await seeded()
    const ruleId = groceriesRule(db)
    setCategoryFromRule(db, 't1', 'cat:groceries', ruleId, 1500)

    expect(listReapplyCandidates(db).map((row) => row.id)).toContain('t1')
  })

  it('reads a row parked on Uncategorized as having no category', async () => {
    // Otherwise a re-apply meant to fix exactly those rows would decide they
    // already have what they need and skip them.
    const db = await seeded()
    correctCategory(db, 't1', UNCATEGORIZED_ID, 1500)
    db.run(`UPDATE fmt_transaction SET category_source = 'RULE' WHERE id = 't1'`)

    expect(listReapplyCandidates(db).find((row) => row.id === 't1')?.categoryId).toBeUndefined()
  })

  it('scopes by account, by date and to uncategorized only', async () => {
    const db = await seeded()

    expect(listReapplyCandidates(db, { accountId: 'acc-max' }).map((row) => row.id)).toEqual(['t3'])
    expect(
      listReapplyCandidates(db, { from: { year: 2026, month: 7, day: 1 } }).map((row) => row.id),
    ).toEqual(['t3', 't1'])
    expect(listReapplyCandidates(db, { uncategorized: true })).toHaveLength(3)
  })

  it('hands the engine what a rule matches on', async () => {
    const db = await seeded()

    const row = listReapplyCandidates(db).find((candidate) => candidate.id === 't1')

    expect(row?.merchantRaw).toBe('שופרסל דיל 344')
    expect(row?.subject).toEqual({
      merchantNormalized: SHUFERSAL,
      providerCategory: 'סופרמרקט',
      amount: { minor: -42105, currency: 'ILS' },
      accountId: 'acc-cal',
    })
  })
})

describe('commitReapply', () => {
  it('assigns the category, names the rule, and counts the hits', async () => {
    const db = await seeded()
    const ruleId = groceriesRule(db)

    const { plan, run } = reapply(db)

    expect(plan.changes).toHaveLength(2)
    expect(run?.changedCount).toBe(2)
    expect(stored(db, 't1')).toEqual({
      category_id: 'cat:groceries',
      category_source: 'RULE',
      matched_rule_id: ruleId,
    })
    expect(findRule(db, ruleId)?.hitCount).toBe(2)
    expect(findRule(db, ruleId)?.lastMatchedAt).toBe(2000)
  })

  it('leaves a manually categorized row exactly as it was', async () => {
    const db = await seeded()
    groceriesRule(db)
    correctCategory(db, 't1', 'cat:shopping', 1500)

    reapply(db)

    expect(stored(db, 't1')).toEqual({
      category_id: 'cat:shopping',
      category_source: 'MANUAL',
      matched_rule_id: null,
    })
  })

  it('writes nothing when nothing would change', async () => {
    const db = await seeded()

    // No rules at all, so no row moves and there is no run to undo.
    expect(reapply(db).run).toBeUndefined()
    expect(undoableRun(db)).toBeUndefined()
    expect(query(db, 'SELECT id FROM fmt_reapply_run')).toHaveLength(0)
  })

  it('records what each row held before it, including which rule had said so', async () => {
    const db = await seeded()
    const first = groceriesRule(db)
    setCategoryFromRule(db, 't1', 'cat:fuel', first, 1500)

    reapply(db)

    const before = query(
      db,
      `SELECT previous_category AS previous_category_id, previous_source, previous_rule AS previous_rule_id
         FROM fmt_reapply_change WHERE "transaction" = 't1'`,
    )[0]
    expect(before).toEqual({
      previous_category_id: 'cat:fuel',
      previous_source: 'RULE',
      previous_rule_id: first,
    })
  })
})

describe('undo', () => {
  it('puts every row back where it was, and gives the hits back', async () => {
    const db = await seeded()
    const ruleId = groceriesRule(db)
    const { run } = reapply(db)

    const restored = undoReapply(db, run?.id ?? '', 3000)

    expect(restored).toBe(2)
    expect(stored(db, 't1')).toEqual({
      category_id: null,
      category_source: 'NONE',
      matched_rule_id: null,
    })
    expect(findRule(db, ruleId)?.hitCount).toBe(0)
    // The rule did fire, and the user changed their mind about the result. When
    // it last matched is still today.
    expect(findRule(db, ruleId)?.lastMatchedAt).toBe(2000)
  })

  it('restores the rule a row named before the run, not just its category', async () => {
    const db = await seeded()
    const first = createRule(
      db,
      { name: 'Fuel', kind: 'CONTAINS', pattern: 'שופרסל', targetCategoryId: 'cat:fuel' },
      500,
    ).id
    setCategoryFromRule(db, 't1', 'cat:fuel', first, 1500)
    db.run(`UPDATE fmt_category_rule SET target = 'cat:groceries' WHERE id = ?`, [first])

    const { run } = reapply(db)
    undoReapply(db, run?.id ?? '', 3000)

    expect(stored(db, 't1')).toEqual({
      category_id: 'cat:fuel',
      category_source: 'RULE',
      matched_rule_id: first,
    })
  })

  it('leaves alone a row the user has categorized by hand since', async () => {
    // D-009 outranks this undo exactly as it outranks the re-apply itself, so
    // the count comes back smaller — which is the truth, not a failure.
    const db = await seeded()
    groceriesRule(db)
    const { run } = reapply(db)
    correctCategory(db, 't1', 'cat:shopping', 2500)

    const restored = undoReapply(db, run?.id ?? '', 3000)

    expect(restored).toBe(1)
    expect(stored(db, 't1')).toEqual({
      category_id: 'cat:shopping',
      category_source: 'MANUAL',
      matched_rule_id: null,
    })
  })

  it('offers only the newest run, and only until it is undone', async () => {
    const db = await seeded()
    groceriesRule(db)

    const first = reapply(db, 'Everything', 2000).run
    expect(undoableRun(db)?.id).toBe(first?.id)
    expect(undoableRun(db)?.scope).toBe('Everything')

    undoReapply(db, first?.id ?? '', 3000)
    expect(undoableRun(db)).toBeUndefined()

    const second = reapply(db, 'Cal 1234', 4000).run
    expect(undoableRun(db)?.id).toBe(second?.id)
    expect(undoableRun(db)?.scope).toBe('Cal 1234')
  })

  it('is idempotent enough that a second call changes nothing', async () => {
    const db = await seeded()
    const ruleId = groceriesRule(db)
    const { run } = reapply(db)
    undoReapply(db, run?.id ?? '', 3000)

    // The rows are no longer RULE assignments, so there is nothing to restore
    // and no hit to give back a second time.
    expect(undoReapply(db, run?.id ?? '', 4000)).toBe(0)
    expect(findRule(db, ruleId)?.hitCount).toBe(0)
  })
})
