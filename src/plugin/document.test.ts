import { insertTransaction } from '@/data/packs/ledger/testing.ts'
import { installLedgerPack } from '@/data/packs/ledger/pack.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { fromMajorUnits } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { SCHEMA_VERSION, createDatabase, exportDatabase } from '@/data/db/database.ts'
import { createAccount } from '@/data/repositories/accountRepository.ts'

import { assessSchema, openDocument } from './document.ts'
import { documentInfo } from './tools/documentInfo.ts'
import { tempDir } from '../testing/tempDir'

/**
 * A real `.emd` on disk, written the way the app writes one:
 * `exportDatabase` and nothing else. `schemaVersion` builds it at an older
 * schema, which is how the gate gets something honest to refuse.
 */
async function writeDocument(
  name: string,
  options: { readonly schemaVersion?: number; readonly transactions?: number } = {},
): Promise<string> {
  const db = await createDatabase(options.schemaVersion ?? SCHEMA_VERSION)
  // At today's schema, a ledger the app has opened — converted — which is the
  // only kind the plugin serves (M25 U2).
  if (options.schemaVersion === undefined) installLedgerPack(db, 1)

  if (options.transactions !== undefined && options.transactions > 0) {
    const account = createAccount(db, { name: 'Cal – Visa 1234', kind: 'CREDIT_CARD', last4: '1234' }, 1)
    for (let i = 0; i < options.transactions; i++) {
      insertTransaction(
        db,
        {
          id: `tx-${i}`,
          accountId: account.id,
          transactionDate: localDate(2026, 7, 3),
          chargeDate: localDate(2026, 8, 2),
          billingPeriod: { year: 2026, month: 8 },
          amount: fromMajorUnits(-42.05, 'ILS'),
          direction: 'OUTFLOW',
          merchantRaw: 'שופרסל דיל 344',
          merchantNormalized: 'שופרסל דיל',
          providerCategory: 'מזון וצריכה',
          cardLast4: '1234',
          reference: undefined,
          note: undefined,
          installment: undefined,
          foreign: undefined,
          naturalKey: `key-${i}`,
          importSessionId: undefined,
          sourceRowRef: undefined,
        },
        1,
      )
    }
  }

  const bytes = exportDatabase(db)
  db.close()

  const dir = await tempDir('emerald-plugin-')
  const path = join(dir, name)
  await writeFile(path, bytes)
  return path
}

describe('the schema gate', () => {
  it('serves a document at exactly this build’s schema', () => {
    expect(assessSchema(SCHEMA_VERSION, 'x.emd')).toBeUndefined()
  })

  it('refuses an older document, naming both versions and where the fix is', () => {
    const problem = assessSchema(SCHEMA_VERSION - 1, 'budget.emd')
    expect(problem?.code).toBe('SCHEMA_BEHIND')
    expect(problem?.message).toContain(String(SCHEMA_VERSION - 1))
    expect(problem?.message).toContain(String(SCHEMA_VERSION))
    // The fix belongs to the app, and saying so is most of the value of
    // refusing: the alternative is a user who does not know what to do next.
    expect(problem?.message).toContain('app')
  })

  it('refuses a newer document too, and sends the user somewhere else', () => {
    // The mirror image, and it needs different advice: an old document is fixed
    // by the app, an old plugin is fixed by rebuilding the plugin.
    const problem = assessSchema(SCHEMA_VERSION + 5, 'budget.emd')
    expect(problem?.code).toBe('SCHEMA_AHEAD')
    expect(problem?.message).toContain(String(SCHEMA_VERSION + 5))
    expect(problem?.message).toContain('build:plugin')
  })

  it('refuses a SQLite file that is not an Emerald document', () => {
    expect(assessSchema(0, 'photos.sqlite')?.code).toBe('NOT_A_DOCUMENT')
  })
})

describe('openDocument', () => {
  it('opens a current document and says which schema it is at', async () => {
    const path = await writeDocument('current.emd')
    const opened = await openDocument(path)

    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.value.schemaVersion).toBe(SCHEMA_VERSION)
    expect(opened.value.path).toBe(path)
    opened.value.db.close()
  })

  it('refuses an older document and leaves the file byte for byte as it found it', async () => {
    // docs/f14 trap 1, as a test rather than as a comment. A plugin that
    // migrated here would answer the question and leave the user's own app
    // refusing to open its own document with SchemaTooNewError — so the
    // assertion that matters is not the refusal, it is the bytes.
    const path = await writeDocument('old.emd', { schemaVersion: SCHEMA_VERSION - 1 })
    const before = await readFile(path)

    const opened = await openDocument(path)
    expect(opened.ok).toBe(false)
    if (opened.ok) return
    expect(opened.error.code).toBe('SCHEMA_BEHIND')
    expect(opened.error.fileSchemaVersion).toBe(SCHEMA_VERSION - 1)

    expect(await readFile(path)).toEqual(before)
  })

  it('refuses a database with no schema version, and still writes nothing', async () => {
    const path = await writeDocument('empty.sqlite', { schemaVersion: 0 })
    const before = await readFile(path)

    const opened = await openDocument(path)
    expect(opened.ok).toBe(false)
    if (opened.ok) return
    expect(opened.error.code).toBe('NOT_A_DOCUMENT')

    expect(await readFile(path)).toEqual(before)
  })

  it('reports a file that is not SQLite at all, rather than throwing', async () => {
    const dir = await tempDir('emerald-plugin-')
    const path = join(dir, 'notes.txt')
    await writeFile(path, 'this is not a database')

    const opened = await openDocument(path)
    expect(opened.ok).toBe(false)
    if (opened.ok) return
    expect(opened.error.code).toBe('UNREADABLE')
  })

  it('reports a missing file, rather than throwing', async () => {
    const opened = await openDocument(join(tmpdir(), 'emerald-does-not-exist.emd'))
    expect(opened.ok).toBe(false)
    if (opened.ok) return
    expect(opened.error.code).toBe('UNREADABLE')
  })
})

describe('document_info', () => {
  it('counts what the document holds', async () => {
    const path = await writeDocument('counted.emd', { transactions: 3 })
    const text = await documentInfo(path)

    expect(text).toContain(path)
    expect(text).toContain(`Schema version ${SCHEMA_VERSION}`)
    expect(text).toContain('Accounts: 1')
    expect(text).toContain('Transactions: 3')
    // The seeded category tree, whatever its size — the assertion is that
    // categories are counted through the repository at all, not a magic number
    // that a new seed category would break.
    expect(text).toMatch(/Categories: [1-9]\d*/)
    expect(text).toContain('Ready to serve')
  })

  it('says REFUSED, and both versions, when the document is behind', async () => {
    const path = await writeDocument('old.emd', { schemaVersion: SCHEMA_VERSION - 1 })
    const text = await documentInfo(path)

    expect(text).toContain('REFUSED')
    expect(text).toContain(`Document schema version: ${SCHEMA_VERSION - 1}`)
    expect(text).toContain(`Plugin understands: ${SCHEMA_VERSION}`)
    expect(text).toContain('SCHEMA_BEHIND')
    expect(text).not.toContain('Ready to serve')
  })
})
