import type { Database } from 'sql.js'

import { stageRows, type StagedRow } from '@/data/repositories/formatBatchRepository.ts'
import { listRows } from '@/data/repositories/formatRowRepository.ts'
import { entryHeaders, entryInputs, entryPlaces, viewSettings } from '@/data/repositories/formatViewRepository.ts'
import {
  isLinkType,
  labelColumn,
  type ColumnDeclaration,
  type FormatDeclaration,
} from '@/domain/format/declaration.ts'
import { readValue } from '@/domain/format/row.ts'
import { blankDraft, offeredOf, type RowDraft } from '@/domain/format/rowDraft.ts'
import { entryLayout, entryOrder, entryWayOf } from '@/domain/format/view.ts'
import { newRowDefaults } from '@/ui/formats/savedView.ts'

/** A row of another format, as something to pick from a list. */
export interface LinkChoice {
  readonly id: string
  /** What the row is called — its first text column — which is what a link is written and kept by. */
  readonly label: string
  /** What its entry is titled by, when that is another column than its name: a milestone's title beside its `M2`. */
  readonly title?: string | undefined
}

/** How many rows a link offers before the list stops naming them. */
const PAGE = 200

/** `M2` before `M10`, `D-9` before `D-10`: a name's numbers read as numbers. */
const NATURAL = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * **What each `link` column of this format may point at** (M55 U6, D-550), in
 * the target's own order — the column its roadmap is ordered by, else its
 * name, with a name's numbers read as numbers — each called by its name and
 * titled by its entry's title where that is another column. It was every row
 * in id order, so a unit's milestone listed M2, M3, M1.
 *
 * Capped, because a format with four thousand rows is not one you pick from a
 * list — the refusal for a link nobody could pick is `danglingLinks`, and a
 * conversation can always name the row.
 */
export function linkChoices(
  db: Database,
  declaration: Pick<FormatDeclaration, 'columns'>,
  formats: ReadonlyMap<string, FormatDeclaration>,
): ReadonlyMap<string, readonly LinkChoice[]> {
  const choices = new Map<string, readonly LinkChoice[]>()
  for (const column of declaration.columns) {
    if (!isLinkType(column.type) || column.target === undefined) continue
    if (choices.has(column.target)) continue
    const target = formats.get(column.target)
    if (target === undefined) continue
    choices.set(column.target, linkChoicesOf(db, target))
  }
  return choices
}

/** The rows of one target, as a link field lists them. */
export function linkChoicesOf(db: Database, target: FormatDeclaration): readonly LinkChoice[] {
  const named = labelColumn(target)
  const titled = titleColumn(db, target)
  const order = orderColumn(db, target) ?? named
  const rows = listRows(db, target, { ...(order === undefined ? {} : { order: order.name }), limit: PAGE })
  const textOf = (column: ColumnDeclaration | undefined, row: (typeof rows)[number]): string => {
    if (column === undefined) return ''
    const value = readValue(column, row)
    return typeof value === 'string' ? value.trim() : ''
  }
  const made = rows.map((row) => {
    const label = textOf(named, row) || row.id
    const title = titled === undefined ? '' : textOf(titled, row)
    return { id: row.id, label, ...(title === '' || title === label ? {} : { title }) }
  })
  // The order a view names is the database's; a name's is read as a person counts.
  return order === named ? [...made].sort((a, b) => NATURAL.compare(a.label, b.label)) : made
}

/** The column a view of the format orders its rows by — the roadmap's `order`. */
function orderColumn(db: Database, target: FormatDeclaration): ColumnDeclaration | undefined {
  const said = [...viewSettings(db, target.name, 'roadmap')].find(([, setting]) => setting === 'order')?.[0]
  return said === undefined ? undefined : target.columns.find((column) => column.name === said)
}

/** What the target's entry is titled by, when it is not the column its rows are named by. */
function titleColumn(db: Database, target: FormatDeclaration): ColumnDeclaration | undefined {
  const inputs = entryInputs(db, target.name)
  const title = entryLayout(
    entryOrder(target.columns, entryPlaces(db, target.name)),
    (column) => entryWayOf(column, inputs.get(column.name), false),
    entryHeaders(db, target.name),
  ).title
  return title === labelColumn(target) ? undefined : title
}

/**
 * **A row a link field would make, from the name typed** (M55 U6, D-550): the
 * target's new-row defaults (D-536) with the name in the column it is named
 * by, and the required columns still empty — which the inline form asks. A
 * target that asks nothing is made at once.
 */
export interface NewLinked {
  readonly format: FormatDeclaration
  readonly draft: RowDraft
  /** The column the name was typed into. */
  readonly named: ColumnDeclaration | undefined
  /** The required columns nothing fills: the form's fields, after the name. */
  readonly asks: readonly ColumnDeclaration[]
}

export function newLinked(db: Database, target: FormatDeclaration, name: string, day: string): NewLinked {
  const named = labelColumn(target)
  const draft: RowDraft = {
    ...blankDraft(target),
    ...newRowDefaults(db, target, {}, day),
    ...(named === undefined ? {} : { [named.name]: name.trim() }),
  }
  const asks = target.columns.filter(
    (column) => column.required && column !== named && (draft[column.name] ?? '').trim() === '',
  )
  return { format: target, draft, named, asks }
}

/** One problem with the row being made, at its column where it has one. */
export interface LinkedRefusal {
  readonly column: string | undefined
  readonly reason: string
}

/**
 * **The row checked as `record_format_rows` checks it** — `stageRows`, the
 * batch every screen and tool writes through (D-227), so making a row from a
 * link field is no new write. Accepted, it is the row to insert; refused,
 * every problem at once.
 */
export function stageLinked(
  db: Database,
  made: NewLinked,
  day: string,
  declarations: readonly FormatDeclaration[],
): { readonly row: StagedRow } | { readonly refusals: readonly LinkedRefusal[] } {
  const batch = stageRows(db, made.format, [offeredOf(made.format, made.draft, day)], declarations)
  const [row] = batch.accepted
  if (batch.refusals.length > 0 || row === undefined) {
    return { refusals: batch.refusals.map((each) => ({ column: each.column, reason: each.reason })) }
  }
  return { row }
}
