import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { fromMajorUnits } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { SCHEMA_VERSION, createDatabase, exportDatabase, openDatabase } from '@/data/db/database.ts'
import { listAccounts } from '@/data/repositories/accountRepository.ts'
import { listCategories } from '@/data/repositories/categoryRepository.ts'
import { createAccount } from '@/data/repositories/accountRepository.ts'
import { readGuideProgress } from '@/data/repositories/guideRepository.ts'
import { FRESH_GUIDE } from '@/domain/guide.ts'

import { guideStatusTool } from './guide.ts'
import { chooseCategoriesTool, createDocumentTool, updateAccountTool } from './setup.ts'
import { NO_CLIENT, type ElicitOutcome, type ToolContext } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

/** A directory nothing else is using, so a created path really is a fresh one. */
async function scratch(name: string): Promise<string> {
  return join(await tempDir('emerald-setup-'), name)
}

/** Read a document back the way the app would, to check what the tools wrote. */
async function reopen(path: string) {
  return openDatabase(await readFile(path))
}

/** A client that fills a form in — the branch `NO_CLIENT` never reaches. */
function clientAnswering(answer: Record<string, unknown>): ToolContext {
  return { elicit: async (): Promise<ElicitOutcome> => ({ action: 'accept', content: answer }) }
}

function clientRefusing(action: 'decline' | 'cancel'): ToolContext {
  return { elicit: async (): Promise<ElicitOutcome> => ({ action }) }
}

async function newDocument(): Promise<string> {
  const path = await scratch('fresh.emd')
  // The ledger, by name: no pack is kept unless asked (M42 F5).
  await createDocumentTool.run({ path, packs: ['ledger'] }, NO_CLIENT)
  return path
}

describe('create_document', () => {
  it('creates a document at this build’s schema, new to the guide', async () => {
    const path = await scratch('household.emd')
    const text = await createDocumentTool.run({ path, packs: ['ledger'] }, NO_CLIENT)

    expect(text).toContain(`schema version ${SCHEMA_VERSION}`)

    const db = await reopen(path)
    expect(readGuideProgress(db)).toEqual(FRESH_GUIDE)
    db.close()
  })

  it('refuses a path that already exists, and leaves it exactly as it was', async () => {
    // The whole reason this tool uses `wx` rather than checking first. A
    // create that overwrote would be the one bug in this plugin with no
    // recovery at all — the document is the user's only copy.
    const path = await scratch('taken.emd')
    await writeFile(path, 'not a database, but it is theirs')

    const text = await createDocumentTool.run({ path }, NO_CLIENT)

    expect(text).toContain('REFUSED')
    expect(text).toContain('will not overwrite')
    expect(await readFile(path, 'utf8')).toBe('not a database, but it is theirs')
  })

  it('asks the client for a path when it can, and uses the answer', async () => {
    const path = await scratch('elicited.emd')
    const text = await createDocumentTool.run({ packs: ['ledger'] }, clientAnswering({ path }))

    expect(text).toContain(path)
    const db = await reopen(path)
    expect(readGuideProgress(db)).toEqual(FRESH_GUIDE)
    db.close()
  })

  it('falls back to prose when the form is cancelled, and creates nothing', async () => {
    // The everyday case, not an error: a headless run cancels every time. The
    // rule is that the UI may only save the user typing.
    for (const action of ['cancel', 'decline'] as const) {
      const text = await createDocumentTool.run({}, clientRefusing(action))
      expect(text).toContain('No path yet, so nothing was created')
      expect(text).toContain('Ask the user')
    }
  })

  it('works identically against a client with no forms at all', async () => {
    const text = await createDocumentTool.run({}, NO_CLIENT)
    expect(text).toContain('No path yet, so nothing was created')
  })
})

describe('update_account', () => {
  it('renames and sets the last four digits', async () => {
    const path = await scratch('named.emd')
    const db = await createLedgerDatabase()
    const account = createAccount(db, { name: 'Cal', kind: 'CREDIT_CARD' }, 1)
    await writeFile(path, exportDatabase(db))
    db.close()

    const text = await updateAccountTool.run(
      { path, account_id: account.id, name: 'Cal – Visa 1234', last4: '1234' },
      NO_CLIENT,
    )
    expect(text).toContain('Cal – Visa 1234')

    const db2 = await reopen(path)
    const updated = listAccounts(db2)[0]
    expect(updated?.name).toBe('Cal – Visa 1234')
    expect(updated?.last4).toBe('1234')
    db2.close()
  })

  it('refuses digits that are not four digits, by name', async () => {
    const path = await newDocument()
    await expect(
      updateAccountTool.run({ path, account_id: 'x', last4: '12ab' }, NO_CLIENT),
    ).rejects.toThrow(/exactly four digits/)
  })
})

describe('choose_categories', () => {
  it('archives what was not kept, and never touches a system category', async () => {
    const path = await newDocument()
    const db = await reopen(path)
    const all = listCategories(db, { includeArchived: true })
    const keep = all.filter((one) => !one.isSystem).slice(0, 3)
    const system = all.filter((one) => one.isSystem)
    db.close()
    expect(system.length).toBeGreaterThan(0)

    const text = await chooseCategoriesTool.run(
      { path, keep_ids: keep.map((one) => one.id) },
      NO_CLIENT,
    )
    expect(text).toContain('Nothing was deleted')

    const after = await reopen(path)
    const live = listCategories(after)
    // The kept ones plus the system ones, and nothing else.
    expect(live.filter((one) => !one.isSystem).length).toBe(keep.length)
    for (const one of system) {
      expect(live.some((live2) => live2.id === one.id), one.path).toBe(true)
    }
    after.close()
  })
})

describe('a document that holds work keeps its categories safe, and is still reachable', () => {
  it('refuses keep_ids, serves archive and restore, and copies the file first', async () => {
    // A document with real records in it is not an empty one (D-110, and
    // D-330 for reading it off the document rather than onboarding's
    // progress): putting a category away is something the app allows on any
    // day, so it takes the `.bak` an empty document did not need.
    const db = await createLedgerDatabase()
    const account = { name: 'Real card', kind: 'CREDIT_CARD' as const }
    const created = createAccount(db, account, 1)
    insertTransaction(
      db,
      {
        id: 'tx-1',
        accountId: created.id,
        transactionDate: localDate(2026, 7, 3),
        chargeDate: localDate(2026, 7, 3),
        billingPeriod: { year: 2026, month: 7 },
        amount: fromMajorUnits(-42.05, 'ILS'),
        direction: 'OUTFLOW',
        merchantRaw: 'שופרסל דיל',
        merchantNormalized: 'שופרסל דיל',
        providerCategory: undefined,
        cardLast4: undefined,
        reference: undefined,
        note: undefined,
        installment: undefined,
        foreign: undefined,
        naturalKey: 'key-1',
        importSessionId: undefined,
        sourceRowRef: undefined,
      },
      1,
    )
    const bytes = exportDatabase(db)
    db.close()

    const path = await scratch('real.emd')
    await writeFile(path, bytes)
    const before = await readFile(path)

    // `keep_ids` is the first-run shape and stays there: on a document holding
    // a year of filed rows, one forgotten id would archive a live category.
    await expect(chooseCategoriesTool.run({ path, keep_ids: [] }, NO_CLIENT)).rejects.toThrow(
      /keep_ids` is refused/,
    )
    expect(await readFile(path)).toEqual(before)

    // But archiving and restoring work, and take a copy on the way.
    const opened = await reopen(path)
    const target = listCategories(opened).find((one) => !one.isSystem)
    opened.close()
    expect(target).toBeDefined()
    if (target === undefined) return

    const archived = await chooseCategoriesTool.run(
      { path, archive_ids: [target.id] },
      NO_CLIENT,
    )
    expect(archived).toContain('Archived 1')
    expect(archived).toContain('.bak')

    const after = await reopen(path)
    expect(listCategories(after, { includeArchived: true }).find((one) => one.id === target.id)?.isArchived).toBe(true)
    after.close()

    const restored = await chooseCategoriesTool.run(
      { path, restore_ids: [target.id] },
      NO_CLIENT,
    )
    expect(restored).toContain('Brought back 1')

    const back = await reopen(path)
    expect(listCategories(back).some((one) => one.id === target.id)).toBe(true)
    back.close()
    // **A real timeout rather than the 5s default**, because this test opens
    // the document nine times and every open runs the whole migration list —
    // which only ever grows (032 put it past the default under a parallel
    // suite). Nothing here asserts a duration; the number exists so a hung
    // tool still fails rather than hanging the run.
  }, 30_000)

  it('is never offered the guide, and guide_status still reads it', async () => {
    const path = await scratch('done.emd')
    const db = await createLedgerDatabase()
    createAccount(db, { name: 'Real card', kind: 'CREDIT_CARD' }, 1)
    const bytes = exportDatabase(db)
    db.close()
    await writeFile(path, bytes)

    const reopened = await reopen(path)
    expect(readGuideProgress(reopened).offered).toBe(true)
    reopened.close()
    const text = await guideStatusTool.run({ path }, NO_CLIENT)
    expect(text).toContain('0 of 7 places done')
  })
})

describe('the schema gate guards the write tools too', () => {
  it('refuses an older document without writing to it', async () => {
    const db = await createDatabase(SCHEMA_VERSION - 1)
    const bytes = exportDatabase(db)
    db.close()

    const path = await scratch('old.emd')
    await writeFile(path, bytes)
    const before = await readFile(path)

    const text = await updateAccountTool.run({ path, account_id: 'x', name: 'Renamed' }, NO_CLIENT)
    expect(text).toContain('REFUSED')
    expect(text).toContain('SCHEMA_BEHIND')
    expect(await readFile(path)).toEqual(before)
  })
})
