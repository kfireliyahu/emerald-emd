/**
 * **The same source, read again** — M38 U3, [D-408](../../../docs/09-decision-log.md).
 *
 * Both trials of M34 said it: a read was a copy, and the copy drifted from its
 * source within a week. The only way back was to supersede the whole file and
 * read it again, which loses every edit made since. So a second read of the
 * same source **updates the rows the first one wrote**, adds what is new and
 * names what is gone — and for that each line of a source needs a key.
 *
 * ## The key, per kind of file
 *
 * - **A note: its file name** (`ReadTable.rowNames`). A folder is the source
 *   and a file name is unique inside it. The title is not the key: a note
 *   renamed by its frontmatter is the same note.
 * - **A spreadsheet: the value of the format's unique column the reading
 *   fills** — its name column when that is unique, else the first unique column
 *   mapped. A unique column is the one place a format already says *no two rows
 *   hold this*, which is the only sameness this engine was ever willing to take
 *   from anywhere but the person (D-226, D-255).
 * - **A note's item: its note's file name and its place among the note's
 *   items** (M38 U4) — `Pancakes.md, item 3`. An edited line is that row
 *   changed; a line added at the end, a row added; one added in the middle
 *   moves the ones after it, and each is written over, as a person would.
 * - **Neither: no key.** The read adds to what it wrote, as every read did.
 *
 * ## What happens to a row
 *
 * A line whose key a row of that source holds is the same thing: **the same**
 * when every cell the read fills already says what the line says, **changed**
 * when one does not — written over — and **edited here** when the row no longer
 * matches what the last read put in it, because a person changed it since: a
 * manual value is never overwritten by a re-import, so it is left and named. A
 * line with a key no row holds is **added**. A row of the source whose line is
 * gone is **gone**: named, and removed only when somebody asks.
 *
 * Nothing here touches a database; `readingPlan.ts` hands it the rows.
 */

import {
  isLinkType,
  labelColumn,
  moneyColumnNames,
  quantityColumnNames,
  type ColumnDeclaration,
  type FormatDeclaration,
} from './declaration.ts'
import type { ReadResult, ReadTable, Reading } from './reading.ts'
import type { StoredRow, StoredValue } from './row.ts'

/** How a read's lines are told apart from one read to the next. */
export type SourceKey =
  | { readonly kind: 'NAMED'; readonly items?: boolean | undefined }
  | { readonly kind: 'COLUMN'; readonly column: string }
  | { readonly kind: 'NONE' }

/** The types a key column may be — a value written the same way twice. */
const KEYABLE: ReadonlySet<string> = new Set(['text', 'integer', 'date', 'decimal', 'month'])

/** What keys this read's lines: the file's own row names, a unique column, or nothing. */
export function sourceKeyOf(declaration: FormatDeclaration, reading: Reading, table: ReadTable): SourceKey {
  // A note's item is named by its note and its place in it (M38 U4).
  if (table.rowNames !== undefined) return table.keyedBy === undefined ? { kind: 'NAMED' } : { kind: 'NAMED', items: true }
  const mapped = new Set(reading.columns.map((each) => each.key))
  const candidates = declaration.columns.filter(
    (column) => column.unique && mapped.has(column.name) && KEYABLE.has(column.type),
  )
  const naming = labelColumn(declaration)
  const column = candidates.find((each) => each.name === naming?.name) ?? candidates[0]
  return column === undefined ? { kind: 'NONE' } : { kind: 'COLUMN', column: column.name }
}

/** How the lines are keyed, in the words a person reads it in. */
export function keySentence(key: SourceKey): string {
  switch (key.kind) {
    case 'NAMED':
      return key.items === true ? 'by its note and its place in it' : 'by its file name'
    case 'COLUMN':
      return `by ${key.column}, which is unique`
    case 'NONE':
      return 'by nothing — the format has no unique column the reading fills'
  }
}

/**
 * Each line's key, at its place in `read.rows` — a line that did not type keeps
 * its key too, so the row it would have updated is not called gone.
 */
export function lineKeys(key: SourceKey, table: ReadTable, read: ReadResult): readonly (string | undefined)[] {
  return read.rows.map((row) => {
    if (key.kind === 'NAMED') return table.rowNames?.[row.line]
    if (key.kind === 'NONE') return undefined
    return keyText(row.cells?.[key.column] ?? row.offered[key.column])
  })
}

function keyText(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** Every key a read fills, across all its lines, in one order. */
export function filledKeys(rows: readonly Readonly<Record<string, StoredValue>>[]): readonly string[] {
  return [...new Set(rows.flatMap((cells) => Object.keys(cells)))].sort()
}

/**
 * The mark of what a read put in a row: a hash of its filled cells less its
 * links, then the keys it covers — `<hash>:name,kcal` — so a later read checks
 * the same cells even when it fills others. A link is left out because it holds
 * an id, and a text document mints ids afresh on every open (D-247): a mark over
 * one would call every row of a text document edited.
 */
export function writtenMark(
  declaration: FormatDeclaration,
  cells: Readonly<Record<string, StoredValue>>,
  keys: readonly string[],
): string {
  const links = new Set(declaration.columns.filter((column) => isLinkType(column.type)).map((column) => column.name))
  const covered = keys.filter((key) => !links.has(key))
  return `${markOf(cells, covered)}:${covered.join(',')}`
}

function markOf(cells: Readonly<Record<string, StoredValue>>, keys: readonly string[]): string {
  return fnv1a(JSON.stringify(keys.map((key) => [key, cells[key] ?? null])))
}

/**
 * FNV-1a, 32 bits twice from two seeds — a mark that only has to tell an edited
 * row from an untouched one, not a hash anybody verifies. Here rather than
 * `core/id.ts`'s, because `src/domain/format/` imports nothing outside itself.
 */
function fnv1a(text: string): string {
  return [0x811c9dc5, 0x01000193]
    .map((seed) => {
      let hash = seed
      for (let at = 0; at < text.length; at += 1) {
        hash ^= text.charCodeAt(at)
        hash = Math.imul(hash, 0x01000193)
      }
      return (hash >>> 0).toString(16).padStart(8, '0')
    })
    .join('')
}

/** Whether a row still holds what a read put in it — false when a person changed it since. */
export function stillAsWritten(cells: Readonly<Record<string, StoredValue>>, written: string): boolean {
  const at = written.indexOf(':')
  if (at === -1) return true
  const keys = written.slice(at + 1) === '' ? [] : written.slice(at + 1).split(',')
  return markOf(cells, keys) === written.slice(0, at)
}

/** One row a source wrote before, and what keys it. */
export interface SourceRecord {
  readonly rowId: string
  readonly key: string
  /** `writtenMark` when the read wrote the row; absent for a record with none. */
  readonly written: string | undefined
}

/** A row of the source, named for a person. */
export interface SourceRow {
  readonly key: string
  readonly rowId: string
  /** The row's name, when its format has a name column and the row fills it. */
  readonly name: string | undefined
}

export interface Rereading {
  /** How lines are keyed. */
  readonly key: SourceKey
  /** Per staged row, the row it is — `undefined` for a line that adds one. */
  readonly matched: readonly (string | undefined)[]
  /** Per staged row, whether its cells are written over the row it is. */
  readonly update: readonly boolean[]
  /** Per staged row, its key. */
  readonly keys: readonly (string | undefined)[]
  readonly changed: readonly (SourceRow & { readonly columns: readonly string[] })[]
  readonly same: number
  /** A person changed the row since the last read; it is left as it is. */
  readonly edited: readonly SourceRow[]
  /** The keys of the lines that add a row (or the line, when it has no key). */
  readonly added: readonly string[]
  /** Rows of the source whose line is gone — named, never removed unasked. */
  readonly gone: readonly SourceRow[]
}

/**
 * Compare a read against what its source wrote before.
 *
 * `keys` is per staged row and `refused` the keys of lines that did not type;
 * `current` is every recorded row as it is now — a record whose row has gone
 * is not in it, and is no row of the source.
 */
export function compareRereading(input: {
  readonly declaration: FormatDeclaration
  readonly key: SourceKey
  readonly staged: readonly StoredRow[]
  readonly keys: readonly (string | undefined)[]
  readonly refused: ReadonlySet<string>
  readonly records: readonly SourceRecord[]
  readonly current: ReadonlyMap<string, StoredRow>
}): Rereading {
  const { declaration, staged, keys, records, current } = input
  const naming = labelColumn(declaration)
  const nameOf = (row: StoredRow | undefined): string | undefined => {
    const value = naming === undefined ? undefined : row?.cells[naming.name]
    return typeof value === 'string' && value !== '' ? value : undefined
  }
  const byKey = new Map<string, SourceRecord>()
  for (const record of records) {
    if (current.has(record.rowId) && !byKey.has(record.key)) byKey.set(record.key, record)
  }
  const filled = filledKeys(staged.map((row) => row.cells))

  const matched: (string | undefined)[] = []
  const update: boolean[] = []
  const changed: (SourceRow & { readonly columns: readonly string[] })[] = []
  const edited: SourceRow[] = []
  const added: string[] = []
  let same = 0
  const seen = new Set<string>()

  for (const [at, row] of staged.entries()) {
    const key = keys[at]
    const record = key === undefined || seen.has(key) ? undefined : byKey.get(key)
    if (key !== undefined) seen.add(key)
    const now = record === undefined ? undefined : current.get(record.rowId)
    if (record === undefined || now === undefined || key === undefined) {
      matched.push(undefined)
      update.push(false)
      added.push(key ?? row.id)
      continue
    }
    matched.push(record.rowId)
    const columns = differing(declaration, row.cells, now.cells, filled)
    if (columns.length === 0) {
      update.push(false)
      same += 1
      continue
    }
    const named = { key, rowId: record.rowId, name: nameOf(now) }
    if (record.written !== undefined && !stillAsWritten(now.cells, record.written)) {
      update.push(false)
      edited.push(named)
      continue
    }
    update.push(true)
    changed.push({ ...named, columns })
  }

  const gone = [...byKey.values()]
    .filter((record) => !seen.has(record.key) && !input.refused.has(record.key))
    .map((record) => ({ key: record.key, rowId: record.rowId, name: nameOf(current.get(record.rowId)) }))

  return { key: input.key, matched, update, keys, changed, same, edited, added, gone }
}

/** The columns a line would change in a row, by the column's name, in declaration order. */
function differing(
  declaration: FormatDeclaration,
  line: Readonly<Record<string, StoredValue>>,
  row: Readonly<Record<string, StoredValue>>,
  filled: readonly string[],
): readonly string[] {
  const keys = filled.filter((key) => JSON.stringify(line[key] ?? null) !== JSON.stringify(row[key] ?? null))
  const columns = new Set(keys.map((key) => columnOf(declaration, key)?.name ?? key))
  return declaration.columns.map((column) => column.name).filter((name) => columns.has(name))
}

function columnOf(declaration: FormatDeclaration, key: string): ColumnDeclaration | undefined {
  return declaration.columns.find((column) => {
    if (column.name === key) return true
    if (column.type === 'money') {
      const names = moneyColumnNames(column)
      return names.minor === key || names.currency === key
    }
    if (column.type === 'quantity') {
      const names = quantityColumnNames(column)
      return names.amount === key || names.unit === key
    }
    return false
  })
}
