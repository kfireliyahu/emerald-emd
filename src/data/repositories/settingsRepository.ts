/**
 * The ledger's settings, as key and value — the pack's `setting` since M25 U8.
 *
 * docs/04 "Cross-cutting" asks for two single-row records — onboarding state and
 * settings. This is both of them: one format whose values are JSON owned by the
 * feature that wrote them, rather than a column per preference and a migration
 * per preference (D-034). **A pack's settings are a format the pack declares**
 * (M25 U8): `app_setting` was the one table every document got whether it kept a
 * ledger or not, and a document that keeps none has no ledger settings.
 *
 * Reads never write. Opening someone's document must not mark it dirty, so a
 * missing key returns `undefined` and the caller supplies its own default.
 */

import type { Database } from 'sql.js'

import { query } from '../db/database.ts'
import { declared } from '../packs/ledger/tables.ts'
import { insertRows, updateRow } from './formatRowRepository.ts'
import { objectOf } from './json.ts'

export function readSetting(db: Database, key: string): string | undefined {
  const rows = query(db, 'SELECT value FROM fmt_setting WHERE key = ?', [key])
  const value = rows[0]?.['value']
  return value == null ? undefined : String(value)
}

export function writeSetting(db: Database, key: string, value: string, _now: number): void {
  const settings = declared(db, 'setting')
  const existing = query(db, 'SELECT id FROM fmt_setting WHERE key = ?', [key])[0]
  if (existing === undefined) insertRows(db, settings, [{ key, value }])
  else updateRow(db, settings, String(existing['id']), { value })
}

/**
 * A JSON setting, decoded by the caller.
 *
 * Defensive like every other read of this file: the document is a real SQLite
 * database the user can edit in any tool, so a value may be anything, and a
 * setting that no longer decodes falls back to its default rather than throwing.
 */
export function readJsonSetting(db: Database, key: string): Record<string, unknown> | undefined {
  return objectOf(readSetting(db, key))
}
