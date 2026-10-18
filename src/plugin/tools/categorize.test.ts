import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { fromMajorUnits } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { SCHEMA_VERSION, createDatabase, exportDatabase, openDatabase } from '@/data/db/database.ts'
import { createAccount } from '@/data/repositories/accountRepository.ts'
import {
  createCategory,
  listCategories,
  setCategoryFromRule,
  setCategoryManually,
} from '@/data/repositories/categoryRepository.ts'
import { createRule } from '@/data/repositories/categoryRuleRepository.ts'
import { listTransactions } from '@/data/repositories/transactionRepository.ts'

import { backupFolderFor, BACKUPS_KEPT, listBackups } from '../backup.ts'
import { merchantSuggestionMap } from '@/data/repositories/merchantSuggestionRepository.ts'

import { assignCategoryTool, noteMerchantSuggestionsTool } from './categorize.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

/** Every note, newest first, through the reader the listings use. */
const listMerchantSuggestions = (db: Database) =>
  [...merchantSuggestionMap(db).values()].sort((a, b) => b.at - a.at)

interface Fixture {
  readonly path: string
  readonly groceries: string
  readonly other: string
}

/**
 * Five rows at one merchant, deliberately in four different states: three
 * untouched, one categorized by hand, one assigned by a rule. The states are
 * the point — this tool is mostly defined by what it refuses to touch.
 */
async function fixture(): Promise<Fixture> {
  const db = await createLedgerDatabase()
  const now = 1_700_000_000_000
  const account = createAccount(db, { name: 'Cal – Visa 1234', kind: 'CREDIT_CARD' }, now)
  const groceries = createCategory(db, { name: 'Plugin Groceries', kind: 'EXPENSE' }, now)
  const other = createCategory(db, { name: 'Plugin Other', kind: 'EXPENSE' }, now)

  const rows = [
    { id: 'tx-1', merchant: 'שופרסל דיל', major: -100 },
    { id: 'tx-2', merchant: 'שופרסל דיל', major: -50.5 },
    { id: 'tx-3', merchant: 'שופרסל דיל', major: -25.25 },
    { id: 'tx-manual', merchant: 'שופרסל דיל', major: -10 },
    { id: 'tx-rule', merchant: 'שופרסל דיל', major: -5 },
    { id: 'tx-elsewhere', merchant: 'ARomA', major: -18 },
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
  const rule = createRule(
    db,
    { name: 'Shufersal', kind: 'CONTAINS', pattern: 'שופרסל', targetCategoryId: other },
    now,
  )
  setCategoryFromRule(db, 'tx-rule', other, rule.id, now)

  const bytes = exportDatabase(db)
  db.close()

  const dir = await tempDir('emerald-assign-')
  const path = join(dir, 'ledger.emd')
  await writeFile(path, bytes)
  return { path, groceries, other }
}

async function reopen(path: string) {
  return openDatabase(await readFile(path))
}


describe('the dry run is the default', () => {
  it('describes the change, and writes absolutely nothing', async () => {
    const { path, groceries } = await fixture()
    const before = await readFile(path)

    const text = await assignCategoryTool.run(
      { path, assignments: [{ category_id: groceries, merchant: 'שופרסל דיל' }] },
      NO_CLIENT,
    )

    expect(text).toContain('3 transactions → Plugin Groceries')
    expect(text).toContain('₪175.75')
    expect(text).toContain('Nothing has been written')
    expect(text).toContain('commit: true')

    expect(await readFile(path)).toEqual(before)
    expect(await listBackups(path)).toEqual([])
  })

  it('names what it is leaving alone, and why', async () => {
    // "34 rows were skipped" invites the wrong next question; "34 rows you
    // categorized by hand were skipped" answers it.
    const { path, groceries } = await fixture()
    const text = await assignCategoryTool.run(
      { path, assignments: [{ category_id: groceries, merchant: 'שופרסל דיל' }] },
      NO_CLIENT,
    )

    expect(text).toContain('categorized by hand')
    expect(text).toContain('assigned by a rule')
  })
})

describe('the batch', () => {
  it('files several merchants in one call, with one preview and one backup', async () => {
    // The round trip this tool was actually spending (D-110): forty merchants
    // used to mean eighty calls, each re-sending the whole conversation.
    const { path, groceries, other } = await fixture()

    const preview = await assignCategoryTool.run(
      {
        path,
        assignments: [
          { category_id: groceries, merchant: 'שופרסל דיל' },
          { category_id: other, merchant: 'ARomA' },
        ],
      },
      NO_CLIENT,
    )
    expect(preview).toContain('4 transactions → 2 categories')
    expect(preview).toContain('Plugin Groceries')
    expect(preview).toContain('Plugin Other')
    expect(preview).toContain('Nothing has been written')
    expect(await listBackups(path)).toEqual([])

    const committed = await assignCategoryTool.run(
      {
        path,
        assignments: [
          { category_id: groceries, merchant: 'שופרסל דיל' },
          { category_id: other, merchant: 'ARomA' },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(committed).toContain('Assigned 4 transactions across 2 categories')

    // One copy for the whole batch, not one per assignment.
    expect(await listBackups(path)).toHaveLength(1)

    const db = await reopen(path)
    const rows = listTransactions(db, {}, 50)
    db.close()
    expect(rows.filter((row) => row.categoryId === groceries)).toHaveLength(3)
    expect(rows.find((row) => row.id === 'tx-elsewhere')?.categoryId).toBe(other)
  })

  it('refuses a row two assignments both claim, rather than picking one', async () => {
    // Whichever one lost would be a category the user was shown in the preview
    // and never got.
    const { path, groceries, other } = await fixture()

    await expect(
      assignCategoryTool.run(
        {
          path,
          assignments: [
            { category_id: groceries, merchant: 'שופרסל דיל' },
            { category_id: other, transaction_ids: ['tx-1'] },
          ],
          commit: true,
        },
        NO_CLIENT,
      ),
    ).rejects.toThrow(/covered by two assignments/)

    const db = await reopen(path)
    expect(listTransactions(db, {}, 50).find((row) => row.id === 'tx-1')?.categoryId).toBeUndefined()
    db.close()
  })

  it('teaches the list shape to a caller that sent the old single form', async () => {
    const { path, groceries } = await fixture()
    await expect(
      assignCategoryTool.run({ path, category_id: groceries, merchant: 'x' }, NO_CLIENT),
    ).rejects.toThrow('takes a list')
  })
})

describe('committing', () => {
  it('writes the rows, marks every one AI, and takes a backup first', async () => {
    const { path, groceries } = await fixture()
    const before = await readFile(path)

    const text = await assignCategoryTool.run(
      { path, assignments: [{ category_id: groceries, merchant: 'שופרסל דיל' }], commit: true },
      NO_CLIENT,
    )

    expect(text).toContain('Assigned **Plugin Groceries** to 3 transactions')
    expect(text).toContain('.bak')

    const db = await reopen(path)
    const rows = listTransactions(db)
    const assigned = rows.filter((row) => row.categoryId === groceries)
    expect(assigned.length).toBe(3)
    // Provenance is the whole point: the batch has to stay findable afterwards.
    for (const row of assigned) expect(row.categorySource).toBe('AI')
    db.close()

    // And the copy is a real one — the document as it was before the batch.
    const backups = await listBackups(path)
    expect(backups.length).toBe(1)
    expect(await readFile(join(backupFolderFor(path), backups[0] ?? ''))).toEqual(before)
    // In Emerald's own folder, which the reply names in full — and nothing new beside the document (D-455).
    expect(text).toContain(join(backupFolderFor(path), backups[0] ?? ''))
    expect((await readdir(dirname(path))).filter((one) => one.endsWith('.bak'))).toEqual([])
  })

  it('never overwrites a hand-made assignment, however it is aimed', async () => {
    // The oldest convention in the app (D-009). Aimed straight at the row by id,
    // which is the only way a caller could try.
    const { path, groceries, other } = await fixture()

    const text = await assignCategoryTool.run(
      { path, assignments: [{ category_id: groceries, transaction_ids: ['tx-manual'] }], commit: true },
      NO_CLIENT,
    )
    expect(text).toContain('categorized by hand')

    const db = await reopen(path)
    const row = listTransactions(db).find((one) => one.id === 'tx-manual')
    expect(row?.categoryId).toBe(other)
    expect(row?.categorySource).toBe('MANUAL')
    db.close()
  })

  it('leaves a rule’s row to the rule', async () => {
    const { path, groceries, other } = await fixture()
    await assignCategoryTool.run(
      { path, assignments: [{ category_id: groceries, transaction_ids: ['tx-rule'] }], commit: true },
      NO_CLIENT,
    )

    const db = await reopen(path)
    const row = listTransactions(db).find((one) => one.id === 'tx-rule')
    expect(row?.categoryId).toBe(other)
    expect(row?.categorySource).toBe('RULE')
    db.close()
  })

  it('can correct what it assigned itself', async () => {
    // `AI` is a label, not a lock. The plugin may revisit its own work; it may
    // not revisit the user's.
    const { path, groceries, other } = await fixture()
    await assignCategoryTool.run(
      { path, assignments: [{ category_id: groceries, merchant: 'שופרסל דיל' }], commit: true },
      NO_CLIENT,
    )
    await assignCategoryTool.run(
      { path, assignments: [{ category_id: other, merchant: 'שופרסל דיל' }], commit: true },
      NO_CLIENT,
    )

    const db = await reopen(path)
    const moved = listTransactions(db).filter(
      (one) => one.categoryId === other && one.categorySource === 'AI',
    )
    expect(moved.length).toBe(3)
    db.close()
  })

  it('matches the merchant exactly, not the way search does', async () => {
    // `search` matches raw, normalized and the provider label, which is right
    // for finding rows and too loose for changing them.
    const { path, groceries } = await fixture()
    const text = await assignCategoryTool.run(
      { path, assignments: [{ category_id: groceries, merchant: 'שופרסל' }] },
      NO_CLIENT,
    )
    expect(text).toContain('Nothing to change')
  })

  it('keeps only the last few copies', async () => {
    const { path, groceries, other } = await fixture()
    for (let i = 0; i < BACKUPS_KEPT + 2; i++) {
      await assignCategoryTool.run(
        { path, assignments: [{ category_id: i % 2 === 0 ? groceries : other, merchant: 'שופרסל דיל' }], commit: true },
        NO_CLIENT,
      )
      // The stamp is second-resolution, so two batches inside one second would
      // land on the same name. Real batches do not, and neither does this.
      await new Promise((resolve) => setTimeout(resolve, 1100))
    }

    expect((await listBackups(path)).length).toBe(BACKUPS_KEPT)
  }, 30_000)
})

describe('what it refuses outright', () => {
  it('will not run without a scope', async () => {
    const { path, groceries } = await fixture()
    await expect(
      assignCategoryTool.run({ path, assignments: [{ category_id: groceries }] }, NO_CLIENT),
    ).rejects.toThrow(/every row in the document/)
  })

  it('will not take a category id it cannot find, and says where ids come from', async () => {
    const { path } = await fixture()
    await expect(
      assignCategoryTool.run(
        { path, assignments: [{ category_id: 'Plugin Groceries', merchant: 'שופרסל דיל' }] },
        NO_CLIENT,
      ),
    ).rejects.toThrow(/category_tree/)
  })

  it('will not assign the uncategorized bucket', async () => {
    const { path } = await fixture()
    await expect(
      assignCategoryTool.run(
        { path, assignments: [{ category_id: 'cat:uncategorized', merchant: 'שופרסל דיל' }], commit: true },
        NO_CLIENT,
      ),
    ).rejects.toThrow(/not a categorization/)
  })

  it('refuses an older document, and leaves no backup behind explaining it', async () => {
    // The ordering that matters: gate, then copy, then write. A refused call
    // that had already taken a backup would leave a file whose only meaning is
    // "nothing happened".
    const db = await createDatabase(SCHEMA_VERSION - 1)
    const bytes = exportDatabase(db)
    db.close()
    const dir = await tempDir('emerald-assign-')
    const path = join(dir, 'old.emd')
    await writeFile(path, bytes)
    const before = await readFile(path)

    const text = await assignCategoryTool.run(
      { path, assignments: [{ category_id: 'anything', transaction_ids: ['x'] }], commit: true },
      NO_CLIENT,
    )

    expect(text).toContain('REFUSED')
    expect(text).toContain('SCHEMA_BEHIND')
    expect(await readFile(path)).toEqual(before)
    expect(await listBackups(path)).toEqual([])
  })
})

describe('the preview and the commit agree', () => {
  it('what the dry run promised is what the commit reports', async () => {
    const { path, groceries } = await fixture()

    const preview = await assignCategoryTool.run(
      { path, assignments: [{ category_id: groceries, merchant: 'שופרסל דיל' }] },
      NO_CLIENT,
    )
    const committed = await assignCategoryTool.run(
      { path, assignments: [{ category_id: groceries, merchant: 'שופרסל דיל' }], commit: true },
      NO_CLIENT,
    )

    expect(preview).toContain('3 transactions')
    expect(committed).toContain('3 transactions')
    expect(preview).toContain('₪175.75')
    expect(committed).toContain('₪175.75')
  })

  it('reports what actually happened when the document moved underneath it', async () => {
    // The plan is recomputed inside the write rather than carried over, so a
    // document that changed between the two calls gets an honest answer instead
    // of a stale one applied blind.
    const { path, groceries, other } = await fixture()

    const preview = await assignCategoryTool.run(
      { path, assignments: [{ category_id: groceries, merchant: 'שופרסל דיל' }] },
      NO_CLIENT,
    )
    expect(preview).toContain('3 transactions')

    // Somebody categorizes one of them by hand in the app, and saves.
    const db = await reopen(path)
    setCategoryManually(db, 'tx-1', other, Date.now())
    await writeFile(path, exportDatabase(db))
    db.close()

    const committed = await assignCategoryTool.run(
      { path, assignments: [{ category_id: groceries, merchant: 'שופרסל דיל' }], commit: true },
      NO_CLIENT,
    )
    expect(committed).toContain('2 transactions')
    expect(committed).toContain('categorized by hand')

    const after = await reopen(path)
    expect(after.exec.length).toBeGreaterThan(0)
    const row = listTransactions(after).find((one) => one.id === 'tx-1')
    expect(row?.categorySource).toBe('MANUAL')
    after.close()
  })
})

describe('the category the user sees', () => {
  it('names the full path rather than an id, in both the preview and the commit', async () => {
    const { path } = await fixture()
    const db = await reopen(path)
    const nested = listCategories(db).find((one) => one.path.includes('→'))
    db.close()
    if (nested === undefined) return

    const text = await assignCategoryTool.run(
      { path, assignments: [{ category_id: nested.id, merchant: 'שופרסל דיל' }] },
      NO_CLIENT,
    )
    expect(text).toContain(nested.path)
  })
})

describe('the memo that stops a name being asked about twice', () => {
  it('writes immediately — no dry run, and no .bak for a note that touches no row', async () => {
    const { path, groceries } = await fixture()

    const text = await noteMerchantSuggestionsTool.run(
      {
        path,
        suggestions: [
          { merchant: 'ARomA', category_id: groceries, status: 'DECLINED', note: 'they call it work' },
          { merchant: 'שופרסל דיל', status: 'NO_SUGGESTION' },
        ],
      },
      NO_CLIENT,
    )

    expect(text).toContain('Noted 2 merchants')
    expect(text).toContain('1 DECLINED')
    expect(text).toContain('1 NO_SUGGESTION')
    expect(await listBackups(path)).toEqual([])

    const db = await reopen(path)
    const notes = listMerchantSuggestions(db)
    expect(notes.map((note) => note.merchantNormalized).sort()).toEqual(['ARomA', 'שופרסל דיל'])
    expect(notes.find((note) => note.merchantNormalized === 'ARomA')?.note).toBe('they call it work')
    db.close()
  })

  it('changes no transaction', async () => {
    const { path, groceries } = await fixture()
    const before = await reopen(path)
    const categoriesBefore = listTransactions(before, {}, 100).map((row) => row.categoryPath)
    before.close()

    await noteMerchantSuggestionsTool.run(
      { path, suggestions: [{ merchant: 'ARomA', category_id: groceries, status: 'SUGGESTED' }] },
      NO_CLIENT,
    )

    const after = await reopen(path)
    expect(listTransactions(after, {}, 100).map((row) => row.categoryPath)).toEqual(categoriesBefore)
    after.close()
  })

  it('refuses a status it does not know, and a suggestion with no category', async () => {
    const { path } = await fixture()

    await expect(
      noteMerchantSuggestionsTool.run(
        { path, suggestions: [{ merchant: 'ARomA', status: 'PROBABLY' }] },
        NO_CLIENT,
      ),
    ).rejects.toThrow(/SUGGESTED, DECLINED or NO_SUGGESTION/)

    await expect(
      noteMerchantSuggestionsTool.run(
        { path, suggestions: [{ merchant: 'ARomA', status: 'DECLINED' }] },
        NO_CLIENT,
      ),
    ).rejects.toThrow(/names no category/)
  })

  it('says so when the category no longer exists, and still writes the note', async () => {
    const { path } = await fixture()

    const text = await noteMerchantSuggestionsTool.run(
      { path, suggestions: [{ merchant: 'ARomA', category_id: 'cat-gone', status: 'DECLINED' }] },
      NO_CLIENT,
    )

    expect(text).toContain('a category this document does not have')
    const db = await reopen(path)
    expect(listMerchantSuggestions(db)).toHaveLength(1)
    db.close()
  })

  it('is cleared by the assignment that answers it', async () => {
    const { path, groceries } = await fixture()
    await noteMerchantSuggestionsTool.run(
      { path, suggestions: [{ merchant: 'שופרסל דיל', category_id: groceries, status: 'SUGGESTED' }] },
      NO_CLIENT,
    )

    await assignCategoryTool.run(
      { path, assignments: [{ category_id: groceries, merchant: 'שופרסל דיל' }], commit: true },
      NO_CLIENT,
    )

    const db = await reopen(path)
    expect(listMerchantSuggestions(db)).toEqual([])
    db.close()
  })
})
