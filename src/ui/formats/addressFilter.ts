/**
 * **A format's filter, held in its address** (M44 U6, U7):
 * `#/formats/finding?action=author&state=open&search=bidi`. Every key but
 * `search` is a column held to a value, and `search` is the substring looked
 * for in every column as shown — `format_rows`' `match` and `search`, spelled
 * as an address so back, forward, a reload and a bookmark keep it, and so the
 * frame (M41) opens on exactly the rows `show_format` was asked for.
 *
 * **Several values, and turned round** (M37 U3, D-476): `?state=planned,in_progress`
 * is any of them — a repeated key says the same — and `?state!=planned` none
 * of them, `match:{state:{not:planned}}`. An empty value is the empty cell:
 * `?owner=` is empty, `?owner!=` is not, and `?state=planned,` is planned or
 * empty. A value holding a comma is quoted, `"Smith, Ann"`, with a quote in it
 * doubled — a spreadsheet's way of writing one.
 *
 * Only the spelling is here. What the filter *means* is
 * `filterQuery` (`formatFilterRepository.ts`), the one reading every reader
 * hands `listRows`. A column named `search` cannot be held through the
 * address; the key is the search's.
 *
 * **What a roadmap folds, and what a line draws** (M37 U5, D-478): a key
 * naming a format and its column, `?unit.state=planned`, holds the rows a
 * roadmap folds under each of its own rather than its own — `match:{"unit.state":
 * planned}` in a conversation — and `?columns:unit=title,state` is which of a
 * format's columns its lines and cards draw. No column's name holds a `.` or a
 * `:`, so neither is ever read as a column held. `addressFilter` reads the
 * format's own filter alone; `addressView` all of them.
 *
 * **What the table is sorted by** (M42 F14): `?order:date=descending` — the
 * column after `order:`, and which way. Held here rather than in the screen,
 * because the table and an entry are two routes and the screen is drawn afresh
 * between them: a Back, a delete, a reload and a bookmark keep it, and the
 * entry's pager walks the rows in it. Absent is the format's default order.
 *
 * Pure, and no React: the frame's host code reads it too.
 */

import { heldValue, heldAs, type RowFilter } from '@/data/repositories/formatFilterRepository.ts'

/** The key the search rides under. */
export const SEARCH_KEY = 'search'

/** What follows a column's name when it is turned round: `state!=planned`. */
const NOT = '!'

/** The key a format's chosen columns ride under: `columns:unit=title,state` (M37 U5). */
export const COLUMNS_KEY = 'columns:'

/** Between a folded format and its column, in a held key: `unit.state=planned` (M37 U5). */
export const FOLD_MARK = '.'

/** The key a table's sort rides under: `order:date=descending` (M42 F14). */
export const ORDER_KEY = 'order:'

const DESCENDING = 'descending'
const ASCENDING = 'ascending'

/** A column sorted by, and which way — `format_rows`' `order` and `descending`. */
export interface AddressOrder {
  readonly column: string
  readonly descending: boolean
}

/** Which columns a format's lines draw, by format — absent is what its views declare. */
export type ColumnChoice = Readonly<Record<string, readonly string[]>>

/** Everything a view's address holds: its own filter, what it folds held, the columns chosen and the sort. */
export interface ViewAddress {
  readonly filter: RowFilter
  /** `unit.state` to its held value, as `match` holds one. */
  readonly folds: Readonly<Record<string, unknown>>
  readonly columns: ColumnChoice
  /** Absent is the format's default order. */
  readonly order?: AddressOrder
}

/** Whether a held key names a folded format's column rather than the format's own. */
export function isFoldKey(name: string): boolean {
  return name.includes(FOLD_MARK)
}

/** A part of an address, escaped — but a comma and a space read as themselves. */
function escaped(text: string): string {
  return encodeURIComponent(text).replace(/%2C/gi, ',').replace(/%20/g, '+')
}

/** One value as a list in the address writes it: quoted when it holds a comma or opens with a quote. */
function memberText(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[,"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * A filter as an address's query — `?action=author&state=open` — or empty when
 * it asks for nothing; then what the folds are held to, the columns chosen and
 * the sort.
 */
export function filterAddress(
  filter: RowFilter,
  more: {
    readonly folds?: Readonly<Record<string, unknown>>
    readonly columns?: ColumnChoice
    readonly order?: AddressOrder
  } = {},
): string {
  const parts: string[] = []
  for (const [name, value] of [...Object.entries(filter.match ?? {}), ...Object.entries(more.folds ?? {})]) {
    if (name === SEARCH_KEY || name.startsWith(COLUMNS_KEY) || name.startsWith(ORDER_KEY)) continue
    const { values, not } = heldAs(value)
    parts.push(`${escaped(name)}${not ? NOT : ''}=${escaped(values.map(memberText).join(','))}`)
  }
  if (filter.search !== undefined && filter.search !== '') parts.push(`${SEARCH_KEY}=${escaped(filter.search)}`)
  for (const [format, columns] of Object.entries(more.columns ?? {})) {
    parts.push(`${COLUMNS_KEY}${escaped(format)}=${escaped(columns.join(','))}`)
  }
  if (more.order !== undefined) {
    parts.push(`${ORDER_KEY}${escaped(more.order.column)}=${more.order.descending ? DESCENDING : ASCENDING}`)
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`
}

/** `planned,"Smith, Ann",` — split on the commas outside quotes; an empty piece is the empty cell. */
function membersOf(list: string): readonly string[] {
  const members: string[] = []
  let current = ''
  let quoted = false
  for (let at = 0; at < list.length; at += 1) {
    const char = list[at]
    if (quoted) {
      if (char === '"' && list[at + 1] === '"') {
        current += '"'
        at += 1
      } else if (char === '"') quoted = false
      else current += char
    } else if (char === '"' && current === '') quoted = true
    else if (char === ',') {
      members.push(current)
      current = ''
    } else current += char
  }
  members.push(current)
  return members
}

/** An address's query, read back as the format's own filter. A repeated key adds its values to the first. */
export function addressFilter(query: string): RowFilter {
  return addressView(query).filter
}

/** An address's query, read back whole: the filter, what the folds are held to, the columns chosen and the sort. */
export function addressView(query: string): ViewAddress {
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query)
  const held = new Map<string, { values: string[]; not: boolean }>()
  const columns: Record<string, readonly string[]> = {}
  let search: string | undefined
  let order: AddressOrder | undefined
  for (const [key, value] of params) {
    if (key === SEARCH_KEY) {
      search = value
      continue
    }
    if (key.startsWith(COLUMNS_KEY)) {
      // An empty list is every column let go but the name: `columns:unit=`.
      columns[key.slice(COLUMNS_KEY.length)] = value === '' ? [] : value.split(',').filter((each) => each !== '')
      continue
    }
    if (key.startsWith(ORDER_KEY)) {
      // `order:date` alone, or anything but `descending`, is the column's own way up.
      const column = key.slice(ORDER_KEY.length)
      if (column !== '') order = { column, descending: value === DESCENDING }
      continue
    }
    const not = key.endsWith(NOT)
    const name = not ? key.slice(0, -NOT.length) : key
    const was = held.get(name)
    const values = membersOf(value)
    if (was === undefined || was.not !== not) held.set(name, { values: [...values], not })
    else was.values.push(...values)
  }
  const own = [...held].filter(([name]) => !isFoldKey(name))
  const match = Object.fromEntries(own.map(([name, holding]) => [name, heldValue(holding)]))
  const folds = Object.fromEntries([...held].filter(([name]) => isFoldKey(name)).map(([name, holding]) => [name, heldValue(holding)]))
  return {
    filter: {
      ...(own.length === 0 ? {} : { match }),
      ...(search === undefined || search === '' ? {} : { search }),
    },
    folds,
    columns,
    ...(order === undefined ? {} : { order }),
  }
}

/**
 * **One folded format's rows held, as a filter of its own** (M37 U5): the
 * `unit.…` keys with `unit.` let go — what `filterQuery` reads for that format.
 */
export function foldFilter(folds: Readonly<Record<string, unknown>>, format: string): RowFilter {
  const prefix = `${format}${FOLD_MARK}`
  const match = Object.fromEntries(
    Object.entries(folds)
      .filter(([name]) => name.startsWith(prefix))
      .map(([name, value]) => [name.slice(prefix.length), value]),
  )
  return Object.keys(match).length === 0 ? {} : { match }
}

/** A folded format's filter written back among the others: its keys replaced, every other format's kept. */
export function withFold(
  folds: Readonly<Record<string, unknown>>,
  format: string,
  filter: RowFilter,
): Readonly<Record<string, unknown>> {
  const prefix = `${format}${FOLD_MARK}`
  const rest = Object.entries(folds).filter(([name]) => !name.startsWith(prefix))
  const own = Object.entries(filter.match ?? {}).map(([name, value]) => [`${prefix}${name}`, value] as const)
  return Object.fromEntries([...rest, ...own])
}

/**
 * **An address in one spelling** (M53 U5): read back and written again, its
 * parts in name order — so `?state=open&due=today` and `?due=today&state=open`
 * are one view, and the FilterBand and the rail can tell when the address is a
 * saved view's.
 */
export function canonicalAddress(query: string): string {
  const { filter, folds, columns, order } = addressView(query)
  const written = filterAddress(filter, { folds, columns, ...(order === undefined ? {} : { order }) })
  return written === '' ? '' : `?${written.slice(1).split('&').sort().join('&')}`
}

/** Whether two addresses hold the same view. */
export function sameAddress(a: string, b: string): boolean {
  return canonicalAddress(a) === canonicalAddress(b)
}

/** Whether an address holds anything — a filter, a fold, columns chosen or a sort: what a view can be saved with. */
export function holdsAnything(query: string): boolean {
  return canonicalAddress(query) !== ''
}
