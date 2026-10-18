/**
 * A document that keeps the ledger, for tests — M25 U2.
 *
 * Every ledger repository reads the pack's `fmt_` tables from U2 on, so a test
 * of one needs a document the pack has been installed into and converted.
 * Installing takes about half a second, and fifty test files each doing it per
 * test would be most of the suite's time: the first call builds one, and every
 * call after opens a copy of its bytes.
 *
 * `builtInRules: false` is a ledger whose built-in rules have been taken out —
 * for a test whose every rule is one it wrote, now that the built-ins are rows
 * a `listRules` reads (M25 U2).
 */

import type { Database } from 'sql.js'

import { createDatabase, exportDatabase, openDatabaseWithoutMigrating } from '../../db/database.ts'
import { insertTransactions, type InsertableTransaction } from '../../repositories/transactionRepository.ts'
import { installLedgerPack } from './pack.ts'

let template: Promise<Uint8Array> | undefined
let withoutRules: Promise<Uint8Array> | undefined

export async function createLedgerDatabase(
  options: { readonly builtInRules?: boolean } = {},
): Promise<Database> {
  if (options.builtInRules === false) {
    withoutRules ??= build(true)
    return openDatabaseWithoutMigrating(await withoutRules)
  }
  template ??= build(false)
  return openDatabaseWithoutMigrating(await template)
}

async function build(dropRules: boolean): Promise<Uint8Array> {
  const db = await createDatabase()
  const installed = installLedgerPack(db, 0)
  if (!installed.ok) throw new Error(installed.error)
  if (dropRules) db.run('DELETE FROM fmt_category_rule')
  const bytes = exportDatabase(db)
  db.close()
  return bytes
}

/**
 * One transaction, for a fixture. The app writes them a statement at a time
 * (`insertTransactions`, M25 U3); a test that wants one row should not have to
 * build a list for it.
 */
export function insertTransaction(db: Database, row: InsertableTransaction, now: number): void {
  insertTransactions(db, [row], now)
}
