/**
 * **A search across the whole document** — M47 U6.
 *
 * `format_rows`' `search` is per format, so covering a document was one call a
 * format: committing a project's memory meant six of them, and in the end a
 * hand-dumped SQLite file was cheaper (2026-10-11). This is the one call — every
 * row of every declared format, every column as it is shown — and it is the
 * repository both halves share (D-227): the plugin's `search_document` reads it,
 * and the palette's search across the document reads it too (M37 U2c,
 * `src/ui/formats/paletteEntries.ts`), so the screen and the conversation
 * cannot find different things.
 *
 * **Each column is read as `format_rows` searches it** (`searchedText`): a price
 * as it prints, an enum list as its members. Two differences, both because the
 * question here is *where does this text live*:
 *
 * - **A link is not a hit.** `format_rows` finds a row by the name of the row it
 *   links to; here that row is found itself, and counting the rows that point at
 *   it too would list every unit of a milestone whose title holds the word.
 * - **Beyond the rows**, the rest of the file is read as well — what the
 *   document says about its formats (titles, notes, a column's choices), the
 *   names of the files it read, its settings, and any table no declaration names
 *   any more. Those are counted by table and column, never shown: the moment
 *   before a document is shared is about the whole file, and a format's note is
 *   as easy a place to leave an address as a row is.
 *
 * Shaped like everything else here (D-095): a list of terms in, hits out. It
 * takes no SQL and names no table it was not handed by the document; a general
 * query by the back door — `format_rows` without a format — was the rejected
 * shape.
 */

import type { Database } from 'sql.js'

import {
  isLinkType,
  isListType,
  labelColumn,
  memberTableNameFor,
  ROW_ID_COLUMN,
  tableNameFor,
  type FormatDeclaration,
} from '@/domain/format/declaration.ts'
import { quoteIdentifier } from '@/domain/format/ddl.ts'
import type { SearchTerm } from '@/domain/format/searchTerms.ts'
import { query } from '../db/database.ts'
import { searchedText } from './formatRowRepository.ts'

/** One column of one row that holds a term. */
export interface ColumnHit {
  readonly column: string
  /** The terms it holds, by `SearchTerm.name`. */
  readonly terms: readonly string[]
  /** The column as it is shown — what the terms were found in. */
  readonly text: string
}

export interface RowHit {
  readonly id: string
  /** What the row is called — its label column — or null when it has none. */
  readonly label: string | null
  readonly columns: readonly ColumnHit[]
}

export interface FormatHits {
  readonly format: FormatDeclaration
  readonly rows: readonly RowHit[]
}

/** A table outside the declared rows with cells that hold a term — counted, never shown. */
export interface BeyondHit {
  readonly table: string
  readonly column: string
  readonly terms: readonly string[]
  readonly cells: number
  /** The formats the cells are about, when the table names one per row. */
  readonly formats: readonly string[]
}

export interface DocumentSearch {
  /** Formats with at least one row that holds a term, in the order handed in. */
  readonly formats: readonly FormatHits[]
  readonly beyond: readonly BeyondHit[]
  /** Every term with a hit anywhere, by name. */
  readonly found: ReadonlySet<string>
}

export function searchDocument(
  db: Database,
  terms: readonly SearchTerm[],
  formats: readonly FormatDeclaration[],
  /**
   * `rows` reads the declared rows and nothing beyond them — the palette's
   * search (M37 U2c), which lands on an entry and has nowhere to land a cell
   * of the file's own tables. The rows it finds are the same rows.
   */
  only: 'everything' | 'rows' = 'everything',
): DocumentSearch {
  const found = new Set<string>()
  if (terms.length === 0) return { formats: [], beyond: [], found }

  const hits: FormatHits[] = []
  for (const declaration of formats) {
    const rows = searchFormat(db, declaration, formats, terms)
    if (rows.length === 0) continue
    hits.push({ format: declaration, rows })
    for (const row of rows) for (const column of row.columns) for (const term of column.terms) found.add(term)
  }

  const beyond = only === 'rows' ? [] : searchBeyond(db, terms, formats)
  for (const hit of beyond) for (const term of hit.terms) found.add(term)

  return { formats: hits, beyond, found }
}

function searchFormat(
  db: Database,
  declaration: FormatDeclaration,
  formats: readonly FormatDeclaration[],
  terms: readonly SearchTerm[],
): readonly RowHit[] {
  const columns = declaration.columns
    .filter((column) => !isLinkType(column.type))
    .map((column) => ({ name: column.name, expression: searchedText(column, formats, declaration) }))
    .filter((each): each is { name: string; expression: string } => each.expression !== undefined)
  if (columns.length === 0) return []

  const label = labelColumn(declaration)
  const table = quoteIdentifier(tableNameFor(declaration))
  const selected = [
    `${table}.${quoteIdentifier(ROW_ID_COLUMN)} AS "__id"`,
    label === undefined ? `NULL AS "__label"` : `${quoteIdentifier(label.name)} AS "__label"`,
    ...columns.map((column, index) => `${column.expression} AS "c${String(index)}"`),
  ]

  const out: RowHit[] = []
  for (const row of query(db, `SELECT ${selected.join(', ')} FROM ${table} ORDER BY "__label", "__id"`)) {
    const held: ColumnHit[] = []
    columns.forEach((column, index) => {
      const text = row[`c${String(index)}`]
      if (typeof text !== 'string' || text === '') return
      const matched = terms.filter((term) => term.holds(text)).map((term) => term.name)
      if (matched.length > 0) held.push({ column: column.name, terms: matched, text })
    })
    if (held.length === 0) continue
    const named = row['__label']
    out.push({ id: String(row['__id']), label: typeof named === 'string' ? named : null, columns: held })
  }
  return out
}

/** Everything else in the file: every table no declared row lives in, every text cell. */
function searchBeyond(
  db: Database,
  terms: readonly SearchTerm[],
  formats: readonly FormatDeclaration[],
): readonly BeyondHit[] {
  const covered = new Set<string>()
  for (const declaration of formats) {
    covered.add(tableNameFor(declaration))
    for (const column of declaration.columns) {
      if (isListType(column.type)) covered.add(memberTableNameFor(declaration, column))
    }
  }
  const tables = query(db, `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .map((row) => String(row['name']))
    .filter((name) => !covered.has(name) && !name.startsWith('sqlite_'))

  const out: BeyondHit[] = []
  for (const table of tables) {
    const byColumn = new Map<string, { terms: Set<string>; cells: number; formats: Set<string> }>()
    for (const row of query(db, `SELECT * FROM ${quoteIdentifier(table)}`)) {
      for (const [column, value] of Object.entries(row)) {
        if (typeof value !== 'string' || value === '') continue
        const matched = terms.filter((term) => term.holds(value))
        if (matched.length === 0) continue
        const entry = byColumn.get(column) ?? { terms: new Set<string>(), cells: 0, formats: new Set<string>() }
        entry.cells++
        for (const term of matched) entry.terms.add(term.name)
        // A table about formats names one per row — `format_name`, or the
        // `format` table's own `name`.
        const about = table === 'format' ? row['name'] : row['format_name']
        if (typeof about === 'string') entry.formats.add(about)
        byColumn.set(column, entry)
      }
    }
    for (const [column, entry] of byColumn) {
      out.push({
        table,
        column,
        terms: [...entry.terms],
        cells: entry.cells,
        formats: [...entry.formats].sort(),
      })
    }
  }
  return out
}
