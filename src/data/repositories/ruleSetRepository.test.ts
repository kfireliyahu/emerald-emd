import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { fromMajorUnits } from '@/core/money.ts'
import { normalizeMerchant } from '@/core/text.ts'
import { firstMatch } from '@/domain/categorization.ts'
import type { RuleSubject } from '@/domain/model/rules.ts'
import { exportDatabase, openDatabase, openDatabaseWithoutMigrating } from '../db/database.ts'
import { installLedgerPack } from '../packs/ledger/pack.ts'
import { BUILT_IN_RULES } from '../reference/rulepacks/index.ts'
import { deleteCategory } from './categoryRepository.ts'
import { createRule, listRules, recordHits } from './categoryRuleRepository.ts'
import { forkBuiltIn, loadRules, setBuiltInEnabled } from './ruleSetRepository.ts'

const SHUFERSAL = 'builtin:il.grocery.shufersal'
const PAZ = 'builtin:il.fuel.paz-yellow'

function subject(merchant: string): RuleSubject {
  return {
    merchantNormalized: normalizeMerchant(merchant),
    providerCategory: undefined,
    amount: fromMajorUnits(-240, 'ILS'),
    accountId: 'acc-cal',
  }
}

async function document(): Promise<Database> {
  const db = await createLedgerDatabase()
  db.run(
    `INSERT INTO fmt_account (id, name, kind, is_archived)
     VALUES ('acc-cal', 'Cal 1234', 'CREDIT_CARD', 0)`,
  )
  return db
}

/** Save and reopen, which is the only durability this app has (D-021). */
async function reopened(db: Database): Promise<Database> {
  return openDatabase(exportDatabase(db))
}

describe('loadRules — the built-ins are rows now (M25 U2)', () => {
  it('gives a document with no rules of its own the whole built-in set, as rows', async () => {
    const db = await document()

    expect(loadRules(db).length).toBe(BUILT_IN_RULES.length)
    expect(loadRules(db).every((rule) => rule.origin === 'BUILT_IN' && rule.isEnabled)).toBe(true)
  })

  it('keeps each built-in under the id transactions already name it by', async () => {
    const db = await document()
    expect(loadRules(db).map((rule) => rule.id).sort()).toEqual(BUILT_IN_RULES.map((rule) => rule.id).sort())
  })

  it('shows a built-in by its pack’s own name, not the id its row is named by', async () => {
    const db = await document()
    const paz = loadRules(db).find((rule) => rule.id === PAZ)
    expect(paz?.name).toBe(BUILT_IN_RULES.find((rule) => rule.id === PAZ)?.name)
  })

  it('categorizes an Israeli statement row with no user rules at all', async () => {
    const db = await document()

    const winner = firstMatch(loadRules(db), subject('שופרסל דיל 344'))
    expect(winner?.id).toBe(SHUFERSAL)
    expect(winner?.targetCategoryId).toBe('cat:groceries')
  })

  it('puts the user’s own rules above every built-in', async () => {
    const db = await document()
    createRule(
      db,
      { name: 'Shufersal is work', kind: 'CONTAINS', pattern: 'שופרסל', targetCategoryId: 'cat:gifts' },
      1000,
    )

    expect(firstMatch(loadRules(db), subject('שופרסל'))?.targetCategoryId).toBe('cat:gifts')
  })
})

describe('a built-in whose category goes', () => {
  it('goes with it, and stays gone after a save and reopen', async () => {
    const db = await document()
    deleteCategory(db, 'cat:fuel', 1)

    expect(loadRules(db).some((rule) => rule.id === PAZ)).toBe(false)
    expect(firstMatch(loadRules(db), subject('פז ילו'))).toBeUndefined()

    // The pack does not seed it back: the rule was removed, not forgotten.
    const again = await reopened(db)
    installLedgerPack(again, 2)
    expect(loadRules(again).some((rule) => rule.id === PAZ)).toBe(false)
  })

  it('is unaffected by archiving, which is not deleting', async () => {
    const db = await document()
    db.run(`UPDATE fmt_category SET is_archived = 1 WHERE id = 'cat:fuel'`)

    expect(loadRules(db).find((rule) => rule.id === PAZ)?.isEnabled).toBe(true)
  })
})

describe('switching a built-in off', () => {
  it('takes it out of the engine’s answers and survives a save and reopen', async () => {
    const db = await document()
    setBuiltInEnabled(db, SHUFERSAL, false, 2000)

    expect(firstMatch(loadRules(db), subject('שופרסל'))).toBeUndefined()

    const again = await reopened(db)
    expect(firstMatch(loadRules(again), subject('שופרסל'))).toBeUndefined()
    // Off, not gone: the rules screen lists it and the test box counts it.
    expect(loadRules(again).find((rule) => rule.id === SHUFERSAL)?.isEnabled).toBe(false)
  })

  it('is the person’s from then on, so the pack does not switch it back on', async () => {
    const db = await document()
    setBuiltInEnabled(db, SHUFERSAL, false, 2000)
    installLedgerPack(db, 3000)

    expect(loadRules(db).find((rule) => rule.id === SHUFERSAL)?.isEnabled).toBe(false)
  })

  it('can be switched back on', async () => {
    const db = await document()
    setBuiltInEnabled(db, SHUFERSAL, false, 2000)
    setBuiltInEnabled(db, SHUFERSAL, true, 3000)

    expect(firstMatch(loadRules(db), subject('שופרסל'))?.id).toBe(SHUFERSAL)
  })

  it('does not disturb the other built-ins', async () => {
    const db = await document()
    setBuiltInEnabled(db, SHUFERSAL, false, 2000)

    expect(firstMatch(loadRules(db), subject('פז ילו'))?.id).toBe(PAZ)
  })
})

describe('forking a built-in', () => {
  it('writes a rule of the user’s own and switches the original off', async () => {
    const db = await document()
    const created = forkBuiltIn(
      db,
      SHUFERSAL,
      { name: 'שופרסל', kind: 'CONTAINS', pattern: 'שופרסל', targetCategoryId: 'cat:childcare' },
      4000,
    )

    expect(created.origin).toBe('USER')
    expect(listRules(db).filter((rule) => rule.origin === 'USER').map((rule) => rule.id)).toEqual([created.id])
    expect(loadRules(db).find((rule) => rule.id === SHUFERSAL)?.isEnabled).toBe(false)

    const winner = firstMatch(loadRules(db), subject('שופרסל דיל'))
    expect(winner?.id).toBe(created.id)
    expect(winner?.targetCategoryId).toBe('cat:childcare')
  })

  it('survives a save and reopen as an ordinary rule', async () => {
    const db = await document()
    const created = forkBuiltIn(
      db,
      SHUFERSAL,
      { name: 'שופרסל', kind: 'CONTAINS', pattern: 'שופרסל', targetCategoryId: 'cat:childcare' },
      4000,
    )

    const again = await reopened(db)
    const rules = loadRules(again)
    expect(rules.find((rule) => rule.id === created.id)?.origin).toBe('USER')
    expect(rules.find((rule) => rule.id === SHUFERSAL)?.isEnabled).toBe(false)
  })
})

describe('a hit counted against a built-in', () => {
  it('is counted on its row, and does not make the row the person’s', async () => {
    const db = await document()
    recordHits(db, [SHUFERSAL], 5000)
    expect(loadRules(db).find((rule) => rule.id === SHUFERSAL)?.hitCount).toBe(1)

    // Still the pack's: a later install corrects nothing and keeps the count.
    const again = await openDatabaseWithoutMigrating(exportDatabase(db))
    installLedgerPack(again, 6000)
    expect(loadRules(again).find((rule) => rule.id === SHUFERSAL)?.hitCount).toBe(1)
    expect(
      again.exec("SELECT state FROM format_seed WHERE format_name = 'category_rule' AND seed_key = 'il.grocery.shufersal'")[0]
        ?.values[0]?.[0],
    ).toBe('SEEDED')
  })
})
