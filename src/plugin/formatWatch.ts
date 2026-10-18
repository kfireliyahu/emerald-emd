/**
 * **Told when one format's rows change, and only then** (M44 U3, D-441).
 *
 * U2's subscription is to a document, so `memory.emd changed` fires on every
 * write — a driver's own unit row included — and a session waiting on its inbox
 * would be woken by all of them. This narrows it: on each change `watch.ts`
 * hears, the document is opened read-only, **one format's rows are read as they
 * print**, and the listener is told only when those rows differ from the last
 * reading.
 *
 * **Rows are compared by what they say, not by their id.** A text document
 * renews every id on every write (D-246), so an id-keyed comparison would call
 * every row of a text document changed on every save. A row is its columns as
 * `format_rows` prints them — a link by the name of the row it names, for the
 * same reason — and two readings are compared as multisets of those. A row that
 * left and a row that arrived under the same name are reported as one row
 * changed; that pairing is for the sentence, and nothing else depends on it.
 *
 * It reads and never writes: `openDocument` opens the copy in memory with
 * `query_only` set, and the file is not held open past the read.
 */

import { stat } from 'node:fs/promises'

import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import { labelColumn } from '@/domain/format/declaration.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import { linkLabels, listRows } from '@/data/repositories/formatRowRepository.ts'

import { openDocument, refusalText } from './document.ts'
import { cellText, resolve } from './tools/formats.ts'
import { watchDocument, type StopWatching } from './watch.ts'

/** One row, as it prints: what is compared, and what a line names it by. */
export interface WatchedRow {
  /** What the row is called — its first text column, as the screen sorts by. */
  readonly label: string
  /** Every declared column, as `format_rows` prints it; `-` when empty. */
  readonly cells: Readonly<Record<string, string>>
  /** The cells in declaration order, as one string: what two readings compare. */
  readonly key: string
  /** The row's id as this reading found it — what a printed row is headed by; never compared, since a text document renews it on every write. */
  readonly id?: string
}

/** What a reading found: the rows, or why there are none to compare. */
export type FormatReading =
  | { readonly kind: 'rows'; readonly columns: readonly string[]; readonly rows: readonly WatchedRow[] }
  /** The file is not there — moved, renamed away or deleted. */
  | { readonly kind: 'gone' }
  /** There, and not readable as this format: a refusal, said as the tools say it. */
  | { readonly kind: 'problem'; readonly message: string }

export interface FormatChange {
  readonly added: readonly WatchedRow[]
  readonly changed: readonly { readonly before: WatchedRow; readonly after: WatchedRow }[]
  readonly removed: readonly WatchedRow[]
}

/** Column name to the value a row must hold, compared as `format_rows`' `match` compares text. */
export type RowMatch = ReadonlyMap<string, string>

function rowsOf(declaration: FormatDeclaration, db: Parameters<typeof listRows>[0]): readonly WatchedRow[] {
  const stored = listRows(db, declaration)
  const labels = linkLabels(db, stored, declaration, listFormats(db))
  const naming = labelColumn(declaration)
  return stored.map((row) => {
    const cells: Record<string, string> = {}
    for (const column of declaration.columns) cells[column.name] = cellText(column, row, labels)
    const label = naming === undefined ? row.id : (cells[naming.name] ?? row.id)
    return { id: row.id, label, cells, key: JSON.stringify(declaration.columns.map((column) => cells[column.name])) }
  })
}

/** Reads one format of the document at `path`, as it prints. */
export async function readFormat(path: string, format: string): Promise<FormatReading> {
  return (await readFormats(path, [format]))[0] as FormatReading
}

/**
 * Reads several formats of the document at `path` in one open — what the
 * status line asks (M51 U6), since an open of a large text document is most
 * of what a reading costs. One reading per name, in order.
 */
export async function readFormats(path: string, formats: readonly string[]): Promise<readonly FormatReading[]> {
  const there = await stat(path).catch(() => undefined)
  if (there === undefined || !there.isFile()) return formats.map(() => ({ kind: 'gone' }))
  const opened = await openDocument(path)
  if (!opened.ok) {
    const message = refusalText(path, opened.error)
    return formats.map(() => ({ kind: 'problem', message }))
  }
  try {
    return formats.map((format): FormatReading => {
      try {
        const resolved = resolve(opened.value, format)
        if ('refusal' in resolved) return { kind: 'problem', message: resolved.refusal }
        return {
          kind: 'rows',
          columns: resolved.declaration.columns.map((column) => column.name),
          rows: rowsOf(resolved.declaration, opened.value.db),
        }
      } catch (error) {
        return { kind: 'problem', message: `Cannot read ${format} in ${path}: ${error instanceof Error ? error.message : String(error)}` }
      }
    })
  } finally {
    opened.value.db.close()
  }
}

/** The rows `match` keeps: each named column equal, without regard to case; a list column, holding it. */
export function matching(rows: readonly WatchedRow[], match: RowMatch | undefined): readonly WatchedRow[] {
  if (match === undefined || match.size === 0) return rows
  return rows.filter((row) =>
    [...match].every(([name, wanted]) => {
      const text = (row.cells[name] ?? '-').toLowerCase()
      const value = wanted.toLowerCase()
      return text === value || text.split(', ').includes(value)
    }),
  )
}

/**
 * What differs between two readings, as multisets of rows by what they say.
 * Empty in all three when nothing does — the only answer that wakes nobody.
 */
export function compareRows(before: readonly WatchedRow[], after: readonly WatchedRow[]): FormatChange {
  const left = new Map<string, WatchedRow[]>()
  for (const row of before) left.set(row.key, [...(left.get(row.key) ?? []), row])
  const arrived: WatchedRow[] = []
  for (const row of after) {
    const same = left.get(row.key)
    if (same !== undefined && same.length > 0) same.pop()
    else arrived.push(row)
  }
  const departed = [...left.values()].flat()

  // A row that left and a row that arrived under one name: one row, edited.
  const changed: { before: WatchedRow; after: WatchedRow }[] = []
  const added: WatchedRow[] = []
  for (const row of arrived) {
    const at = departed.findIndex((one) => one.label === row.label)
    if (at === -1) added.push(row)
    else changed.push({ before: departed.splice(at, 1)[0] as WatchedRow, after: row })
  }
  return { added, changed, removed: departed }
}

function isEmptyChange(change: FormatChange): boolean {
  return change.added.length === 0 && change.changed.length === 0 && change.removed.length === 0
}

/** What to watch, and who hears it. */
interface FormatWatch {
  readonly path: string
  readonly format: string
  /** Only rows holding these; a row that leaves them is `removed`, one that comes to hold them `added`. */
  readonly match?: RowMatch
  /** A change in this format's (matching) rows, and nothing else. */
  readonly onChange: (change: FormatChange) => void
  /** Every reading that is not rows — the document gone, or a refusal — for the caller to judge. */
  readonly onReading?: (reading: Exclude<FormatReading, { kind: 'rows' }>) => void
  /** The reading to start from, when the caller already took one. */
  readonly first?: FormatReading
}

/**
 * One reading after another, each compared with the last it could read.
 *
 * Readings are taken one at a time, in the order the changes were heard. When
 * there was no reading to compare with — the watch began on a refusal, or the
 * document was gone — the first rows read become the reading compared from, and
 * wake nobody: what changed while it could not be read is not known, and a
 * whole format reported as new would be a lie told loudly.
 */
export async function watchFormat(watch: FormatWatch): Promise<StopWatching> {
  const { path, format, match } = watch
  const start = watch.first ?? (await readFormat(path, format))
  let known: readonly WatchedRow[] | undefined = start.kind === 'rows' ? matching(start.rows, match) : undefined
  let queue = Promise.resolve()
  let stopped = false

  const stopWatching = await watchDocument(path, () => {
    queue = queue.then(async () => {
      if (stopped) return
      const reading = await readFormat(path, format)
      if (stopped) return
      if (reading.kind !== 'rows') {
        if (reading.kind === 'gone') known = undefined
        watch.onReading?.(reading)
        return
      }
      const after = matching(reading.rows, match)
      const before = known
      known = after
      if (before === undefined) return
      const change = compareRows(before, after)
      if (!isEmptyChange(change)) watch.onChange(change)
    })
  })
  return () => {
    stopped = true
    stopWatching()
  }
}
