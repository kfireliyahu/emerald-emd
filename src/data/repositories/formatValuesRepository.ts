/**
 * **The values a column holds, each with how many rows hold it** (M37 U4) —
 * what a table's header menu lists and `format_rows`' `values` answers, one
 * reading for both, so a count on screen and a count in a conversation cannot
 * differ.
 *
 * Counted in SQL (`valueCounts`) over the rows the *other* held columns and the
 * search leave, so a menu shows what is left to narrow: the column's own hold
 * is set aside, since a menu that showed only the values already ticked could
 * never tick another. Each value comes back as what a filter writes — an
 * enum's member, `yes`/`no`, a link's row by the name `matchCells` resolves —
 * so ticking one names exactly the rows its count promised.
 *
 * Read-only.
 */

import type { Database } from 'sql.js'

import { money, toDecimalString } from '@/core/money.ts'
import { err, ok, type Result } from '@/core/result.ts'
import { isLinkType, labelColumn, tableNameFor, ROW_ID_COLUMN, type ColumnDeclaration, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { quoteIdentifier } from '@/domain/format/ddl.ts'
import { readValue } from '@/domain/format/row.ts'
import { query } from '../db/database.ts'

import { filterQuery, type FilterRefusal, type RowFilter } from './formatFilterRepository.ts'
import { countRows, holdsPassages, valueCounts } from './formatRowRepository.ts'

/** A value longer than a line is a passage, not a thing to filter by: such a column is searched instead. */
export const VALUE_LONGEST = 80

/** One value a column may be held to: what a filter writes, how it reads, and the rows holding it. */
export interface ColumnValue {
  readonly value: string
  readonly label: string
  readonly count: number
}

/** One currency or unit a money or quantity column holds, and its least and most figure there. */
export interface ColumnUnit {
  readonly unit: string
  readonly count: number
  readonly least: string
  readonly most: string
}

/**
 * What a column can be held to, under the other filters: its values (an
 * enum's every member, in declared order, a zero among them), a range in each
 * currency or unit it holds, or — a column of passages — nothing to list.
 * `empty` is the rows with nothing in it; `rows` every row the other filters
 * leave.
 */
export type ColumnValues =
  | { readonly kind: 'VALUES'; readonly values: readonly ColumnValue[]; readonly empty: number; readonly rows: number }
  | { readonly kind: 'RANGE'; readonly units: readonly ColumnUnit[]; readonly empty: number; readonly rows: number }
  | { readonly kind: 'PASSAGES'; readonly rows: number }

/** The filter with one column's hold set aside. */
export function otherHolds(filter: RowFilter, name: string): RowFilter {
  const { [name]: _own, ...rest } = filter.match ?? {}
  return {
    ...(Object.keys(rest).length === 0 ? {} : { match: rest }),
    ...(filter.search === undefined ? {} : { search: filter.search }),
  }
}

export function columnValues(
  db: Database,
  declaration: FormatDeclaration,
  name: string,
  filter: RowFilter,
  declarations: readonly FormatDeclaration[],
  /** The asking runtime's day — a window around today another column holds is around it (D-472). */
  today?: string,
): Result<ColumnValues, FilterRefusal> {
  const column = declaration.columns.find((each) => each.name === name)
  if (column === undefined) return err({ kind: 'NO_COLUMN', name })
  const read = filterQuery(db, declaration, otherHolds(filter, name), declarations, today)
  if (!read.ok) return read
  const rows = countRows(db, declaration, read.value)
  if (holdsPassages(db, declaration, column, VALUE_LONGEST)) return ok({ kind: 'PASSAGES', rows })

  const counts = valueCounts(db, declaration, column, read.value)
  const empty = counts.find((each) => each.value === null)?.count ?? 0
  const held = counts.filter((each): each is typeof each & { value: string | number } => each.value !== null)

  if (column.type === 'money' || column.type === 'quantity') {
    const figure = (value: number | undefined, unit: string): string =>
      value === undefined ? '' : column.type === 'money' ? toDecimalString(money(value, unit)) : String(value)
    return ok({
      kind: 'RANGE',
      units: held
        .map((each) => ({ unit: String(each.value), count: each.count, least: figure(each.least, String(each.value)), most: figure(each.most, String(each.value)) }))
        .sort((a, b) => b.count - a.count || a.unit.localeCompare(b.unit)),
      empty,
      rows,
    })
  }

  // **An enum lists every member, in the order declared** — a member no row
  // holds is still a thing to ask for, and its zero says so.
  if (column.type === 'enum' || column.type === 'enums') {
    const byMember = new Map(held.map((each) => [String(each.value).toLowerCase(), each.count]))
    return ok({ kind: 'VALUES', values: column.values.map((value) => ({ value, label: value, count: byMember.get(value.toLowerCase()) ?? 0 })), empty, rows })
  }
  if (column.type === 'boolean') {
    const byCell = new Map(held.map((each) => [Number(each.value), each.count]))
    return ok({ kind: 'VALUES', values: [{ value: 'yes', label: 'yes', count: byCell.get(1) ?? 0 }, { value: 'no', label: 'no', count: byCell.get(0) ?? 0 }], empty, rows })
  }
  if (isLinkType(column.type)) {
    return ok({ kind: 'VALUES', values: linkValues(db, column, held, declarations), empty, rows })
  }

  // Figures in order of size, and anything else as a person sorts words.
  const sorted = held.every((each) => typeof each.value === 'number')
    ? [...held].sort((a, b) => Number(a.value) - Number(b.value))
    : [...held].sort((a, b) => String(a.value).localeCompare(String(b.value), undefined, { numeric: true }))
  const values = sorted.map((each) => {
    const shown = readValue(column, { id: '', cells: { [column.name]: each.value } })
    const text = typeof shown === 'string' || typeof shown === 'number' ? String(shown) : String(each.value)
    return { value: text, label: text, count: each.count }
  })
  return ok({ kind: 'VALUES', values, empty, rows })
}

/**
 * A link's rows by what they are called — written as the name when the
 * target's names are unique, which `matchCells` resolves, and as the id
 * otherwise — read from the target in one query.
 */
function linkValues(
  db: Database,
  column: ColumnDeclaration,
  held: readonly { readonly value: string | number; readonly count: number }[],
  declarations: readonly FormatDeclaration[],
): readonly ColumnValue[] {
  const target = declarations.find((each) => each.name === column.target)
  const naming = target === undefined ? undefined : labelColumn(target)
  const labels = new Map<string, string>()
  const ids = held.map((each) => String(each.value))
  if (target !== undefined && naming !== undefined && ids.length > 0) {
    const id = quoteIdentifier(ROW_ID_COLUMN)
    for (let at = 0; at < ids.length; at += 500) {
      const chunk = ids.slice(at, at + 500)
      for (const row of query(
        db,
        `SELECT ${id} AS id, ${quoteIdentifier(naming.name)} AS label FROM ${quoteIdentifier(tableNameFor(target))} WHERE ${id} IN (${chunk.map(() => '?').join(', ')})`,
        chunk,
      )) {
        if (typeof row['id'] === 'string' && typeof row['label'] === 'string' && row['label'] !== '') labels.set(row['id'], row['label'])
      }
    }
  }
  const byName = naming?.unique === true
  return held
    .map((each) => {
      const id = String(each.value)
      const label = labels.get(id) ?? id
      return { value: byName ? label : id, label, count: each.count }
    })
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
}
