import type { Database } from 'sql.js'

import { searchDocument, type RowHit } from '@/data/repositories/documentSearchRepository.ts'
import { labelColumn, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { typedTerms } from '@/domain/format/searchTerms.ts'
import { filterAddress } from '@/ui/formats/addressFilter.ts'
import { folderOf } from '@/ui/formats/folder.ts'
import { entryPath, formatPath } from '@/ui/nav.ts'

/**
 * **The palette finds entries, as `search_document` does** — M37 U2c (D-475,
 * direction 3B of `docs/mockups/m37/finding.html`).
 *
 * The rows are `searchDocument`'s, the repository the plugin's `search_document`
 * reads (M47 U6, D-463), so a person at the palette and a conversation find the
 * same entries for the same text (D-227) — no second search. What this file adds
 * is only the order a palette needs, the mockup's `results`:
 *
 * - **names first** — a name that starts with it, then a word in the name that
 *   does, then a name that holds it;
 * - **then any other column**, named, with the text around the match;
 * - **grouped by format**, the format with the best hit first and then the one
 *   with the most, **four a format** and the rest counted;
 * - **nothing at all under two characters**, where every entry in a document
 *   would match and none of them is what was meant.
 */

/** Below this many characters typed the palette looks for no entry. */
export const ENTRY_SEARCH_MIN = 2

/** How many of a format's entries the palette lists before *n more in X*. */
export const ENTRIES_PER_FORMAT = 4

/** 0 a name that starts with it · 1 a word in it does · 2 it holds it · 3 another column does. */
export type EntryRank = 0 | 1 | 2 | 3

export interface PaletteEntry {
  readonly id: string
  /** What the entry is called — its name, or *Untitled x* when it has none. */
  readonly name: string
  readonly rank: EntryRank
  /** The column the text was found in, when it was not the name. */
  readonly column?: string
  /** That column as it is shown. */
  readonly text?: string
}

export interface PaletteEntryGroup {
  readonly format: FormatDeclaration
  /** Every entry of the format that holds it, ranked; the palette shows the first four. */
  readonly entries: readonly PaletteEntry[]
}

/** The entries that hold `query`, grouped by format and ranked — nothing under two characters. */
export function paletteEntries(
  db: Database,
  query: string,
  declarations: readonly FormatDeclaration[],
): readonly PaletteEntryGroup[] {
  const needle = query.trim().toLowerCase()
  if (needle.length < ENTRY_SEARCH_MIN) return []
  const search = searchDocument(db, typedTerms([query]), declarations, 'rows')

  const groups = search.formats.map((hits) => {
    const named = labelColumn(hits.format)?.name
    const untitled = `Untitled ${hits.format.title.toLowerCase()}`
    const entries = hits.rows
      .map((row) => entryOf(row, named, untitled, needle))
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
    return { format: hits.format, entries }
  })
  // The format with the best hit first, then the one holding the most.
  return groups.sort(
    (a, b) => (a.entries[0]?.rank ?? 3) - (b.entries[0]?.rank ?? 3) || b.entries.length - a.entries.length,
  )
}

function entryOf(row: RowHit, named: string | undefined, untitled: string, needle: string): PaletteEntry {
  const name = row.label !== null && row.label.trim() !== '' ? row.label : untitled
  if (named !== undefined && row.label !== null && row.columns.some((column) => column.column === named)) {
    const folded = row.label.toLowerCase()
    const rank: EntryRank = folded.startsWith(needle)
      ? 0
      : folded.split(/[\s,]+/).some((word) => word.startsWith(needle))
        ? 1
        : 2
    return { id: row.id, name, rank }
  }
  // The first column, in the format's own order, that holds it.
  const other = row.columns.find((column) => column.column !== named) ?? row.columns[0]
  return {
    id: row.id,
    name,
    rank: 3,
    ...(other === undefined ? {} : { column: other.column, text: other.text }),
  }
}

/**
 * Where choosing an entry lands: **the one entry view**, with no search in the
 * address — an entry reached from outside its list's search lets the search go
 * (M37 U2b), so the list beside it always holds it.
 */
export function entryAddress(format: FormatDeclaration, id: string): string {
  return entryPath(format.name, id)
}

/**
 * Where *n more in X* lands: **the format's list holding the search**, opened
 * as the rail's *All n* opens it (M37 U2b) — on the first entry it holds in the
 * Table's order, with what was typed as its `?search=`. The best hit stands in
 * should the list's search hold none of them.
 */
export function moreAddress(
  db: Database,
  format: FormatDeclaration,
  declarations: readonly FormatDeclaration[],
  query: string,
  best: string | undefined,
): string {
  const search = query.trim()
  const first = folderOf(db, format, declarations, search).entries[0]?.id ?? best
  const held = filterAddress({ search })
  return first === undefined ? formatPath(format.name) + held : entryPath(format.name, first) + held
}

export interface Snippet {
  readonly before: string
  readonly hit: string
  readonly after: string
  /** Text was cut off before `before`. */
  readonly leading: boolean
  /** Text was cut off after `after`. */
  readonly trailing: boolean
}

/**
 * The text around the first place `query` is in it — 28 characters before, 40
 * after, the mockup's `snippet` — on one line. Nothing when it is not in it.
 */
export function snippetOf(text: string, query: string): Snippet | undefined {
  const needle = query.trim().toLowerCase()
  const flat = text.replace(/\s+/g, ' ')
  const at = needle === '' ? -1 : flat.toLowerCase().indexOf(needle)
  if (at < 0) return undefined
  const start = Math.max(0, at - 28)
  const end = Math.min(flat.length, at + needle.length + 40)
  return {
    before: flat.slice(start, at),
    hit: flat.slice(at, at + needle.length),
    after: flat.slice(at + needle.length, end),
    leading: start > 0,
    trailing: end < flat.length,
  }
}
