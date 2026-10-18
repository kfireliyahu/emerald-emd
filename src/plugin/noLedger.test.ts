import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDatabase, exportDatabase } from '@/data/db/database.ts'

import { LEDGER_TOOLS } from './server.ts'
import { createDebtsTool } from './tools/debts.ts'
import { transactionsTool } from './tools/ledger.ts'
import { debtsTool, savingsTool } from './tools/wealth.ts'
import { NO_CLIENT, ToolInputError } from './tools/tool.ts'
import { tempDir } from '../testing/tempDir'

/**
 * **A ledger tool on a document that keeps no ledger refuses in a sentence**
 * (M36 U03). Since D-378 deleted the schema probes, the same call reached a
 * `fmt_` table that is not there and came back as a raw SQL error.
 */
async function formatsOnly(): Promise<string> {
  const db = await createDatabase()
  const path = join(await tempDir('emerald-no-ledger-'), 'formats.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  return path
}

describe('a ledger tool on a document with no ledger', () => {
  it('reads: says the document keeps no ledger', async () => {
    const path = await formatsOnly()
    for (const tool of [transactionsTool, debtsTool, savingsTool]) {
      const text = await tool.run({ path }, NO_CLIENT)
      expect(text).toContain('keeps no ledger')
      expect(text).not.toContain('no such table')
    }
  })

  it('writes: refuses, and the file is untouched', async () => {
    const path = await formatsOnly()
    const before = await readFile(path)
    const debts = [{ name: 'Car', kind: 'BANK_LOAN', principal_amount: 1000, opened_date: '2026-01-01' }]
    expect(await createDebtsTool.run({ path, debts }, NO_CLIENT)).toContain('keeps no ledger')
    expect(await createDebtsTool.run({ path, debts, commit: true }, NO_CLIENT)).toContain('keeps no ledger')
    expect(Buffer.compare(await readFile(path), before)).toBe(0)
  })

  it('no ledger tool answers with a raw SQL error', async () => {
    const path = await formatsOnly()
    for (const tool of LEDGER_TOOLS) {
      if (tool.definition.name === 'create_document') continue
      try {
        const text = await tool.run({ path }, NO_CLIENT)
        expect(text, tool.definition.name).not.toMatch(/no such table|SQLITE/i)
      } catch (error) {
        // A missing argument is refused before the document is read.
        expect(error, tool.definition.name).toBeInstanceOf(ToolInputError)
      }
    }
  })
})
