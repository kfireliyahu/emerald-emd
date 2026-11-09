/**
 * **Whether a `file` cell's file is there** (M37 U6) — what `format_rows` prints
 * beside a path whose file has gone: `scans/a.pdf · missing`.
 *
 * Looked for on every read, each path once, and never on a write: a file that
 * has gone is a cell that says so, never a refusal. An app's address is not
 * looked for — the app it names is the one that knows — and neither is a value
 * on another machine, which no write lets in and looking would reach.
 */

import { existsSync } from 'node:fs'

import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import { fileWhere, parseFile } from '@/domain/format/file.ts'
import type { StoredRow } from '@/domain/format/row.ts'

import { documentStore, localFileStore } from './store.ts'

/** Each `file` value of these rows whose file is not there, as `missing`. */
export function fileLabels(declaration: FormatDeclaration, rows: readonly StoredRow[], holder: string): Map<string, string> {
  const labels = new Map<string, string>()
  // **Looked for only beside a file on this machine** (M57 U2, D-562): a
  // document in another store — the Google Drive connector's — is read where
  // the person's files are not, so a path in it is never looked for there.
  if (documentStore() !== localFileStore) return labels
  const columns = declaration.columns.filter((column) => column.type === 'file')
  for (const row of rows) {
    for (const column of columns) {
      const value = row.cells[column.name]
      if (typeof value !== 'string' || labels.has(value) || !parseFile(value).ok) continue
      const where = fileWhere(value, holder)
      if (where.kind === 'path' && where.path !== undefined && !existsSync(where.path)) labels.set(value, 'missing')
    }
  }
  return labels
}
