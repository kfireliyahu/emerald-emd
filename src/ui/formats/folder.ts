import type { Database } from 'sql.js'

import { filterQuery } from '@/data/repositories/formatFilterRepository.ts'
import { countRows, listRows, readRow, type RowQuery } from '@/data/repositories/formatRowRepository.ts'
import { labelColumn, type FormatDeclaration } from '@/domain/format/declaration.ts'
import type { StoredRow } from '@/domain/format/row.ts'
import { nameColumnOf } from '@/domain/format/view.ts'

/**
 * **A format's folder in the rail** — M37 U2 (D-475, 1C).
 *
 * A query, not the whole table: the first twelve rows in the format's own order
 * (the column a row is named by, which is what the Table and `format_rows` sort
 * by), held to the filter line's text through the Table's own `search`, so the
 * 37 a folder says it holds are the 37 its *All 37* opens. In a conversation
 * the same rows are `format_rows order limit:12 search` (D-227).
 *
 * **The entry open is always in its folder**, after the twelve when it is past
 * them, so the rail always marks where you are.
 */

/** How many entries a folder draws before *All n*. */
export const FOLDER_SIZE = 12

export interface FolderEntry {
  readonly id: string
  /** What the entry is called: its first text column, or its day (D-401's title). */
  readonly title: string
  /** Its state, the first enum, drawn as a dot — or nothing for a format with none. */
  readonly state: string | undefined
}

export interface Folder {
  /** Every entry the format holds. */
  readonly total: number
  /** The entries the filter line holds — `total` when it holds nothing. */
  readonly found: number
  readonly entries: readonly FolderEntry[]
  /** Whether the format has a state, so every entry wears a dot, empty ones hollow. */
  readonly stated: boolean
}

/** The query a folder reads, which is `format_rows`' for the same `search` and `limit`. */
export function folderQuery(
  db: Database,
  declaration: FormatDeclaration,
  declarations: readonly FormatDeclaration[],
  search: string,
): RowQuery {
  const asked = search.trim() === '' ? undefined : filterQuery(db, declaration, { search: search.trim() }, declarations)
  const order = labelColumn(declaration)?.name
  return {
    ...(asked?.ok === true ? asked.value : {}),
    ...(order === undefined ? {} : { order }),
  }
}

export function folderOf(
  db: Database,
  declaration: FormatDeclaration,
  declarations: readonly FormatDeclaration[],
  search: string,
  /** The entry open in this format, if one is. */
  current?: string,
): Folder {
  const query = folderQuery(db, declaration, declarations, search)
  const total = countRows(db, declaration, {})
  const found = query.search === undefined ? total : countRows(db, declaration, query)
  const rows = [...listRows(db, declaration, { ...query, limit: FOLDER_SIZE })]
  if (current !== undefined && !rows.some((row) => row.id === current)) {
    const open = readRow(db, declaration, current)
    if (open !== undefined) rows.push(open)
  }
  return {
    total,
    found,
    entries: rows.map((row) => entryOf(declaration, row)),
    stated: declaration.columns.some((column) => column.type === 'enum'),
  }
}

function entryOf(declaration: FormatDeclaration, row: StoredRow): FolderEntry {
  const naming = labelColumn(declaration) ?? nameColumnOf(declaration.columns)
  const name = naming === undefined ? undefined : row.cells[naming.name]
  const state = declaration.columns.find((column) => column.type === 'enum')
  const member = state === undefined ? undefined : row.cells[state.name]
  return {
    id: row.id,
    title: typeof name === 'string' && name.trim() !== '' ? name : `Untitled ${declaration.title.toLowerCase()}`,
    state: typeof member === 'string' && member !== '' ? member : undefined,
  }
}
