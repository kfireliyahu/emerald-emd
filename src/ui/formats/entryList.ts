import type { Database } from 'sql.js'

import { formatMoney } from '@/core/money.ts'
import { filterQuery, type RowFilter } from '@/data/repositories/formatFilterRepository.ts'
import { linkLabels, listRows, type RowQuery } from '@/data/repositories/formatRowRepository.ts'
import type { ColumnDeclaration, FormatDeclaration } from '@/domain/format/declaration.ts'
import { isList, readValue, type StoredRow } from '@/domain/format/row.ts'
import {
  dayText,
  entryLayout,
  entryOrder,
  entryWayOf,
  monthText,
  nameColumnOf,
  type ShowAs,
} from '@/domain/format/view.ts'

/**
 * **The entry's list: the pager made visible** — M37 U2b (D-475, 2B;
 * `docs/mockups/m37/finding.html`, its `listPane`).
 *
 * The rows an entry's pager walks, every one of them: the address's filter and
 * search (M44 U7) in the Table's order, which is `format_rows`' for the same
 * `match`, `search` and `order` (D-227) — no cap, since a list that stopped at
 * the Table's 200 would page off its own end. A row is what the entry's header
 * calls it (D-401, `entryLayout`): its title, and under it the first two
 * columns of its header line, an enum as its member.
 *
 * Pure, and no React: the parity test reads it beside the tool.
 */

/** How an entry's page is arranged — what `entryLayout` needs beyond the declaration. */
export interface EntryShape {
  readonly places: ReadonlyMap<string, number>
  readonly chosen: ReadonlyMap<string, ShowAs>
  readonly headers: ReadonlySet<string>
  readonly long: ReadonlySet<string>
}

/** One value under a row's title: as text, or an enum's member to draw as its dot. */
export interface ListCell {
  readonly column: string
  readonly text: string
  /** The member, when the column is an enum — drawn as `.fc-dot` beside its text. */
  readonly member?: string
}

export interface ListRow {
  readonly id: string
  readonly title: string
  readonly line: readonly ListCell[]
}

/** How many header-line columns a row of the list says under its title. */
const LINE = 2

/** The title column and the line under it, as the entry's header has them. */
export function listColumns(
  declaration: FormatDeclaration,
  shape: EntryShape,
): { readonly title: ColumnDeclaration | undefined; readonly line: readonly ColumnDeclaration[] } {
  const ordered = entryOrder(declaration.columns, shape.places)
  const layout = entryLayout(
    ordered,
    (column) => entryWayOf(column, shape.chosen.get(column.name), shape.long.has(column.name)),
    shape.headers,
  )
  // A format with no line of text is named the way the rail names it — its day.
  const title = layout.title ?? nameColumnOf(declaration.columns)
  return { title, line: layout.header.filter((column) => column !== title).slice(0, LINE) }
}

/** The query the list reads: the address's filter, in the order given — the Table's. */
export function listQuery(
  db: Database,
  declaration: FormatDeclaration,
  declarations: readonly FormatDeclaration[],
  filter: RowFilter,
  order: { readonly column: string; readonly descending: boolean } | undefined,
  day: string,
): RowQuery {
  const read = filterQuery(db, declaration, filter, declarations, day)
  return {
    ...(read.ok ? read.value : { today: day }),
    ...(order === undefined ? {} : { order: order.column, descending: order.descending }),
  }
}

/** Every row the query holds, as the list draws it. */
export function entryList(
  db: Database,
  declaration: FormatDeclaration,
  declarations: readonly FormatDeclaration[],
  query: RowQuery,
  shape: EntryShape,
): readonly ListRow[] {
  const rows = listRows(db, declaration, query)
  const { title, line } = listColumns(declaration, shape)
  const labels = line.some((column) => column.type === 'link' || column.type === 'elsewhere')
    ? linkLabels(db, rows, declaration, declarations)
    : new Map<string, string>()
  const untitled = `Untitled ${declaration.title.toLowerCase()}`
  return rows.map((row) => {
    const named = title === undefined ? '' : valueText(title, row, labels)
    return {
      id: row.id,
      title: named.trim() === '' ? untitled : named,
      line: line.flatMap((column): ListCell[] => {
        const text = valueText(column, row, labels)
        if (text === '') return []
        if (column.type === 'enum') return [{ column: column.name, text, member: String(readValue(column, row)) }]
        return [{ column: column.name, text }]
      }),
    }
  })
}

/** One value as a row of the list says it — the header's words, without its controls. */
function valueText(column: ColumnDeclaration, row: StoredRow, labels: ReadonlyMap<string, string>): string {
  const value = readValue(column, row)
  if (value === undefined || value === '') return ''
  if (typeof value === 'boolean') return value ? column.name.replace(/_/g, ' ') : ''
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') {
    if (column.type === 'date') return dayText(value)
    if (column.type === 'month') return monthText(value)
    if (column.type === 'enum') return value.replace(/_/g, ' ')
    if (column.type === 'link') return labels.get(value) ?? ''
    return value
  }
  if (isList(value)) {
    return value.map((each) => (column.type === 'enums' ? each.replace(/_/g, ' ') : (labels.get(each) ?? each))).join(', ')
  }
  if ('minor' in value) return formatMoney(value)
  return `${String(value.amount)} ${value.unit}`
}

/** The ids a query holds, in its order — whether an entry is in a list, and what comes first in it. */
export function heldIds(db: Database, declaration: FormatDeclaration, query: RowQuery): readonly string[] {
  return listRows(db, declaration, query).map((row) => row.id)
}
