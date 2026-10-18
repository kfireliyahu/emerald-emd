import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { fromMajorUnits } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { exportDatabase, openDatabase } from '@/data/db/database.ts'
import { createAccount } from '@/data/repositories/accountRepository.ts'
import { createCategory, setCategoryManually } from '@/data/repositories/categoryRepository.ts'
import { createRule, listRules } from '@/data/repositories/categoryRuleRepository.ts'
import { listTransactions } from '@/data/repositories/transactionRepository.ts'

import { createRuleTool } from './rules.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'
import { backupFolderFor, listBackups } from '../backup.ts'

interface Fixture {
  readonly path: string
  readonly groceries: string
  readonly other: string
}

/** Four Shufersal rows — one categorized by hand — plus one elsewhere. */
async function fixture(options: { readonly builtIns?: boolean } = {}): Promise<Fixture> {
  // No built-ins unless asked: every rule these tests read is the one the tool
  // wrote. The built-ins are rows since M25 U2, so they would be read too.
  const db = await createLedgerDatabase({ builtInRules: options.builtIns === true })
  const now = 1_700_000_000_000
  const account = createAccount(db, { name: 'Cal – Visa 1234', kind: 'CREDIT_CARD' }, now)
  const groceries = createCategory(db, { name: 'Plugin Groceries', kind: 'EXPENSE' }, now)
  const other = createCategory(db, { name: 'Plugin Other', kind: 'EXPENSE' }, now)

  const rows = [
    { id: 'tx-1', merchant: 'שופרסל דיל', major: -100 },
    { id: 'tx-2', merchant: 'שופרסל דיל', major: -50 },
    { id: 'tx-3', merchant: 'שופרסל דיל', major: -25 },
    { id: 'tx-manual', merchant: 'שופרסל דיל', major: -10 },
    { id: 'tx-aroma', merchant: 'ARomA', major: -18 },
  ]

  for (const row of rows) {
    insertTransaction(
      db,
      {
        id: row.id,
        accountId: account.id,
        transactionDate: localDate(2026, 7, 3),
        chargeDate: localDate(2026, 7, 3),
        billingPeriod: { year: 2026, month: 7 },
        amount: fromMajorUnits(row.major, 'ILS'),
        direction: 'OUTFLOW',
        merchantRaw: `${row.merchant} 344`,
        merchantNormalized: row.merchant,
        providerCategory: undefined,
        cardLast4: undefined,
        reference: undefined,
        note: undefined,
        installment: undefined,
        foreign: undefined,
        naturalKey: row.id,
        importSessionId: undefined,
        sourceRowRef: undefined,
      },
      now,
    )
  }

  setCategoryManually(db, 'tx-manual', other, now)

  const bytes = exportDatabase(db)
  db.close()
  const dir = await tempDir('emerald-rules-')
  const path = join(dir, 'ledger.emd')
  await writeFile(path, bytes)
  return { path, groceries, other }
}

async function reopen(path: string) {
  return openDatabase(await readFile(path))
}


function tokenIn(text: string): string {
  const found = /confirmation: "([0-9a-f]{12})"/.exec(text)
  expect(found, `no confirmation token in:\n${text}`).not.toBeNull()
  return found?.[1] ?? ''
}

describe('the evidence comes back before the rule is written', () => {
  it('previews the matching transactions and prints a token', async () => {
    const { path, groceries } = await fixture()
    const text = await createRuleTool.run(
      { path, category_id: groceries, pattern: 'שופרסל' },
      NO_CLIENT,
    )

    // Three, not four: the hand-categorized row is never a candidate at all.
    expect(text).toContain('3 transactions')
    expect(text).toContain('Plugin Groceries')
    expect(text).toMatch(/confirmation: "[0-9a-f]{12}"/)

    const db = await reopen(path)
    expect(listRules(db).length).toBe(0)
    db.close()
  })

  it('refuses a commit that never previewed, and shows the evidence instead', async () => {
    // The gate that a plain dry-run default cannot give: `commit: true` on the
    // first call is exactly the rubber stamp a rule must not get.
    const { path, groceries } = await fixture()
    const text = await createRuleTool.run(
      { path, category_id: groceries, pattern: 'שופרסל', commit: true },
      NO_CLIENT,
    )

    expect(text).toContain('has not been previewed')
    expect(text).toContain('3 transactions')

    const db = await reopen(path)
    expect(listRules(db).length).toBe(0)
    db.close()
    // And no backup: the refusal happened before anything was copied.
    expect(await listBackups(path)).toEqual([])
  })

  it('refuses a token that has gone stale, and re-previews', async () => {
    // A rule previewed against three rows must not be committed against thirty
    // because a statement landed in between.
    const { path, groceries } = await fixture()
    const preview = await createRuleTool.run(
      { path, category_id: groceries, pattern: 'שופרסל' },
      NO_CLIENT,
    )
    const token = tokenIn(preview)

    const db = await reopen(path)
    insertTransaction(
      db,
      {
        id: 'tx-new',
        accountId: listTransactions(db)[0]?.accountId ?? '',
        transactionDate: localDate(2026, 8, 3),
        chargeDate: localDate(2026, 8, 3),
        billingPeriod: { year: 2026, month: 8 },
        amount: fromMajorUnits(-77, 'ILS'),
        direction: 'OUTFLOW',
        merchantRaw: 'שופרסל דיל 900',
        merchantNormalized: 'שופרסל דיל',
        providerCategory: undefined,
        cardLast4: undefined,
        reference: undefined,
        note: undefined,
        installment: undefined,
        foreign: undefined,
        naturalKey: 'tx-new',
        importSessionId: undefined,
        sourceRowRef: undefined,
      },
      Date.now(),
    )
    await writeFile(path, exportDatabase(db))
    db.close()

    const text = await createRuleTool.run(
      { path, category_id: groceries, pattern: 'שופרסל', commit: true, confirmation: token },
      NO_CLIENT,
    )

    expect(text).toContain('out of date')
    expect(text).toContain('4 transactions')

    const after = await reopen(path)
    expect(listRules(after).length).toBe(0)
    after.close()
  })

  it('accepts the token it just issued', async () => {
    const { path, groceries } = await fixture()
    const preview = await createRuleTool.run(
      { path, category_id: groceries, pattern: 'שופרסל' },
      NO_CLIENT,
    )

    const text = await createRuleTool.run(
      {
        path,
        category_id: groceries,
        pattern: 'שופרסל',
        commit: true,
        confirmation: tokenIn(preview),
      },
      NO_CLIENT,
    )

    expect(text).toContain('Created')
    expect(text).toContain('3 transactions were categorized by it')
  })

  /**
   * The rule set is the document's rules **plus** the built-ins the app ships,
   * and `ruleSetRepository` says there is one answer to "what rules are there".
   * This tool asked `listRules` instead of `loadRules` until D-121, so its
   * re-apply ran against a set missing 180 rules — and the three Shufersal rows
   * the fixture inserts directly, which no import ever ran a rule over, stayed
   * uncategorized where the app's own re-apply would have filed them.
   */
  it('runs the built-ins too, and does not claim their work as its own', async () => {
    const { path, other } = await fixture({ builtIns: true })
    // A pattern that matches nothing, so every move in this pass is somebody
    // else's — which is the cleanest way to show whose. (It used to be `ARomA`,
    // which missed only because the fixture stores a merchant un-normalized;
    // since M25 E4 the engine folds case on both sides, D-273.)
    const preview = await createRuleTool.run(
      { path, category_id: other, pattern: 'NO SUCH SHOP' },
      NO_CLIENT,
    )

    const text = await createRuleTool.run(
      { path, category_id: other, pattern: 'NO SUCH SHOP', commit: true, confirmation: tokenIn(preview) },
      NO_CLIENT,
    )

    // Counted apart, because the sentence used to claim every move in the pass
    // for the new rule.
    expect(text).toContain('0 transactions were categorized by it')
    expect(text).toContain('3 more moved in the same pass')

    const after = await reopen(path)
    const rows = listTransactions(after, {})
    const shufersal = rows.filter((row) => row.merchantNormalized === 'שופרסל דיל')

    // Three of the four; the fourth is the hand-filed one, which nothing here
    // is allowed to touch.
    expect(shufersal.filter((row) => row.categoryId === 'cat:groceries')).toHaveLength(3)
    expect(shufersal.filter((row) => row.categoryId === other)).toHaveLength(1)
    // And each of the three names the built-in that filed it, not the new rule.
    expect(
      shufersal.filter((row) => row.matchedRuleId?.startsWith('builtin:') === true),
    ).toHaveLength(3)
    after.close()
  })
})

describe('what the committed rule looks like', () => {
  it('lands enabled, marked as suggested by the assistant', async () => {
    const { path, groceries } = await fixture()
    const preview = await createRuleTool.run(
      { path, category_id: groceries, pattern: 'שופרסל' },
      NO_CLIENT,
    )
    await createRuleTool.run(
      { path, category_id: groceries, pattern: 'שופרסל', commit: true, confirmation: tokenIn(preview) },
      NO_CLIENT,
    )

    const db = await reopen(path)
    const [rule] = listRules(db)
    expect(rule?.isEnabled).toBe(true)
    expect(rule?.origin).toBe('AI_SUGGESTED')
    expect(rule?.targetCategoryId).toBe(groceries)
    db.close()
  })

  it('is listed under the name the preview showed, not under nothing', async () => {
    // The name is optional because the pattern is the name of most rules, and
    // the editor resolves that on the way in. Passing the raw empty field to the
    // repository created a rule listed as nothing at all — visible the first
    // time this was driven, and invisible to every assertion until now.
    const { path, groceries } = await fixture()
    const preview = await createRuleTool.run(
      { path, category_id: groceries, pattern: 'שופרסל' },
      NO_CLIENT,
    )
    expect(preview).toContain('Rule "שופרסל"')

    const committed = await createRuleTool.run(
      { path, category_id: groceries, pattern: 'שופרסל', commit: true, confirmation: tokenIn(preview) },
      NO_CLIENT,
    )
    expect(committed).toContain('Created **שופרסל**')

    const db = await reopen(path)
    expect(listRules(db)[0]?.name).toBe('שופרסל')
    db.close()
  })

  it('keeps a name the caller did give', async () => {
    const { path, groceries } = await fixture()
    const preview = await createRuleTool.run(
      { path, category_id: groceries, pattern: 'שופרסל', name: 'Weekly shop' },
      NO_CLIENT,
    )
    await createRuleTool.run(
      {
        path,
        category_id: groceries,
        pattern: 'שופרסל',
        name: 'Weekly shop',
        commit: true,
        confirmation: tokenIn(preview),
      },
      NO_CLIENT,
    )

    const db = await reopen(path)
    expect(listRules(db)[0]?.name).toBe('Weekly shop')
    db.close()
  })

  it('files the rows as assigned by the RULE, not by the assistant', async () => {
    // The distinction that keeps the provenance column honest: a rule did this,
    // so the ledger must say a rule did it — and name which one.
    const { path, groceries } = await fixture()
    const preview = await createRuleTool.run(
      { path, category_id: groceries, pattern: 'שופרסל' },
      NO_CLIENT,
    )
    await createRuleTool.run(
      { path, category_id: groceries, pattern: 'שופרסל', commit: true, confirmation: tokenIn(preview) },
      NO_CLIENT,
    )

    const db = await reopen(path)
    const [rule] = listRules(db)
    const filed = listTransactions(db).filter((row) => row.categoryId === groceries)
    expect(filed.length).toBe(3)
    for (const row of filed) {
      expect(row.categorySource).toBe('RULE')
      expect(row.matchedRuleId).toBe(rule?.id)
    }
    db.close()
  })

  it('never touches a row categorized by hand', async () => {
    const { path, groceries, other } = await fixture()
    const preview = await createRuleTool.run(
      { path, category_id: groceries, pattern: 'שופרסל' },
      NO_CLIENT,
    )
    await createRuleTool.run(
      { path, category_id: groceries, pattern: 'שופרסל', commit: true, confirmation: tokenIn(preview) },
      NO_CLIENT,
    )

    const db = await reopen(path)
    const row = listTransactions(db).find((one) => one.id === 'tx-manual')
    expect(row?.categoryId).toBe(other)
    expect(row?.categorySource).toBe('MANUAL')
    db.close()
  })

  it('can create a rule for future imports only', async () => {
    const { path, groceries } = await fixture()
    const preview = await createRuleTool.run(
      { path, category_id: groceries, pattern: 'שופרסל', apply_to_existing: false },
      NO_CLIENT,
    )
    expect(preview).toContain('future imports only')

    const text = await createRuleTool.run(
      {
        path,
        category_id: groceries,
        pattern: 'שופרסל',
        apply_to_existing: false,
        commit: true,
        confirmation: tokenIn(preview),
      },
      NO_CLIENT,
    )
    expect(text).toContain('Nothing already in the ledger was changed')

    const db = await reopen(path)
    expect(listRules(db).length).toBe(1)
    expect(listTransactions(db).filter((row) => row.categoryId === groceries).length).toBe(0)
    db.close()
  })

  it('binds the token to the mode, so the two cannot be swapped', async () => {
    // Previewing "future only" and committing "apply to everything" would be a
    // different change than the one that was shown.
    const { path, groceries } = await fixture()
    const preview = await createRuleTool.run(
      { path, category_id: groceries, pattern: 'שופרסל', apply_to_existing: false },
      NO_CLIENT,
    )

    const text = await createRuleTool.run(
      { path, category_id: groceries, pattern: 'שופרסל', commit: true, confirmation: tokenIn(preview) },
      NO_CLIENT,
    )
    expect(text).toContain('out of date')
  })

  it('takes a backup before it writes', async () => {
    const { path, groceries } = await fixture()
    const before = await readFile(path)
    const preview = await createRuleTool.run(
      { path, category_id: groceries, pattern: 'שופרסל' },
      NO_CLIENT,
    )
    await createRuleTool.run(
      { path, category_id: groceries, pattern: 'שופרסל', commit: true, confirmation: tokenIn(preview) },
      NO_CLIENT,
    )

    const backups = await listBackups(path)
    expect(backups.length).toBe(1)
    expect(await readFile(join(backupFolderFor(path), backups[0] ?? ''))).toEqual(before)
  })
})

describe('what it warns about', () => {
  it('says plainly when a rule matches nothing', async () => {
    const { path, groceries } = await fixture()
    const text = await createRuleTool.run(
      { path, category_id: groceries, pattern: 'nothing at all like this' },
      NO_CLIENT,
    )
    expect(text).toContain('matches nothing in this document')
    expect(text).toContain('usually means a typo')
  })

  it('names a rule that outranks the one being written', async () => {
    const { path, groceries, other } = await fixture()
    const db = await reopen(path)
    // A rule the user wrote themselves, which sits above anything from here.
    createRule(
      db,
      { name: 'User Shufersal', kind: 'CONTAINS', pattern: 'שופרסל', targetCategoryId: other },
      Date.now(),
    )
    await writeFile(path, exportDatabase(db))
    db.close()

    const text = await createRuleTool.run(
      { path, category_id: groceries, pattern: 'שופרסל' },
      NO_CLIENT,
    )
    expect(text).toContain('already covered by a rule that outranks it')
    expect(text).toContain('User Shufersal')
  })

  it('refuses a rule the editor would refuse, in the engine’s words', async () => {
    const { path } = await fixture()
    await expect(
      createRuleTool.run({ path, category_id: '', pattern: 'x' }, NO_CLIENT),
    ).rejects.toThrow()
  })

  it('refuses a pattern-taking kind with no pattern', async () => {
    const { path, groceries } = await fixture()
    await expect(createRuleTool.run({ path, category_id: groceries }, NO_CLIENT)).rejects.toThrow(
      /needs a `pattern`/,
    )
  })

  it('refuses a kind it does not have', async () => {
    const { path, groceries } = await fixture()
    await expect(
      createRuleTool.run({ path, category_id: groceries, kind: 'STARTS_WITH', pattern: 'x' }, NO_CLIENT),
    ).rejects.toThrow(/must be one of/)
  })
})
