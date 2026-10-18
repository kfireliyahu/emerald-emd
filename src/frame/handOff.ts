/**
 * **What the frame hands the conversation, in words** (M51 U7): the line a
 * ready row's *Start this unit* sends (`ui/message`), the line *Ask about this*
 * sends, and what the model is told the person selected
 * (`ui/update-model-context`).
 *
 * Generic over formats, as the frame is: a row is named by its format's label
 * column (`labelColumn`, the first text column — a unit's `ref`), headed by the
 * column its entry view draws as its line (a unit's `title`), and its long
 * text is every column its entry view draws as markdown (a unit's `brief` and
 * `files`). Nothing here knows what a unit is.
 *
 * Pure: the frame reads the row and the entry's settings, this writes the words.
 */

import { labelColumn, type FormatDeclaration } from '@/domain/format/declaration.ts'
import type { StoredRow } from '@/domain/format/row.ts'

import type { ModelContext } from './host.ts'

/** The document a row is in, as the frame names it. */
export interface Where {
  readonly name: string
  readonly path: string
}

/** One row, with its entry view's settings (`viewSettings(db, format, 'entry')`). */
export interface Handed {
  readonly format: FormatDeclaration
  readonly row: StoredRow
  readonly entry: ReadonlyMap<string, string>
}

/** A cell as one line of text, or nothing: only text and figures are words. */
function textOf(row: StoredRow, column: string): string | undefined {
  const cell = row.cells[column]
  if (typeof cell === 'number') return String(cell)
  return typeof cell === 'string' && cell.trim() !== '' ? cell.trim() : undefined
}

/** `unit M51 U8 — Title`: the format, the row's label, and its line when the entry view heads it with one. */
export function rowName({ format, row, entry }: Handed): string {
  const label = labelColumn(format)
  const name = (label === undefined ? undefined : textOf(row, label.name)) ?? row.id
  const heading = format.columns.find(
    (column) => column.name !== label?.name && (entry.get(column.name) ?? '').startsWith('line'),
  )
  const headed = heading === undefined ? undefined : textOf(row, heading.name)
  return `${format.title.toLowerCase()} ${name}${headed === undefined ? '' : ` — ${headed}`}`
}

/** Every column the entry draws as markdown, in the format's order, that holds text. */
function longText({ format, row, entry }: Handed): readonly string[] {
  return format.columns.flatMap((column) => {
    if (entry.get(column.name) !== 'markdown') return []
    const text = textOf(row, column.name)
    return text === undefined ? [] : [`${column.name}: ${text}`]
  })
}

const inDocument = (handed: Handed, where: Where): string =>
  `It is a row of ${handed.format.name} in ${where.name} (${where.path}).`

/**
 * **Start this unit** (M51 U7): one message, as the person, naming the row and
 * what its entry says at length — so a session starts from the view with the
 * brief already in the conversation.
 */
export function startMessage(handed: Handed, where: Where): string {
  return [`Start ${rowName(handed)}.`, ...longText(handed), inDocument(handed, where)].join('\n\n')
}

/** **About this row** (M51 U7): the generic hand-off — the row named, for the model to read and talk about. */
export function aboutMessage(handed: Handed, where: Where): string {
  return `About ${rowName(handed)}. ${inDocument(handed, where)}`
}

/**
 * **What the model is told the person selected** (M51 U7): the rows, by name,
 * so "these" in the chat means them, and the `format_rows` call that reads
 * them whole. No rows is empty content, which clears what was said before.
 */
export function selectionContext(rows: readonly Handed[], where: Where, view: string): ModelContext {
  if (rows.length === 0) return { content: [] }
  const byFormat = new Map<string, Handed[]>()
  for (const each of rows) byFormat.set(each.format.name, [...(byFormat.get(each.format.name) ?? []), each])
  const reads = [...byFormat].map(([format, handed]) => {
    const first = handed[0]
    const label = first === undefined ? undefined : labelColumn(first.format)
    const names = handed.map((each) => (label === undefined ? undefined : textOf(each.row, label.name)))
    return label !== undefined && names.every((name) => name !== undefined)
      ? `format_rows ${format} match:{${label.name}:[${names.join(', ')}]}`
      : `format_rows ${format}`
  })
  const text =
    `In the Emerald view of ${where.name} (${where.path}) at ${view}, the person has selected ` +
    `${rows.length === 1 ? 'one row' : `${String(rows.length)} rows`}: ${rows.map(rowName).join('; ')}. ` +
    `"These" or "this" in the conversation means ${rows.length === 1 ? 'it' : 'them'}. ` +
    `Read ${rows.length === 1 ? 'it' : 'them'} whole with ${reads.join(' and ')}.`
  return {
    content: [{ type: 'text', text }],
    structuredContent: {
      path: where.path,
      view,
      rows: rows.map((each) => ({ format: each.format.name, id: each.row.id, name: rowName(each) })),
    },
  }
}
