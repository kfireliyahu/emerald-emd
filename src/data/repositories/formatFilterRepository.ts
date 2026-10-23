/**
 * **Which rows of a format are asked for — one reading of a filter, for every
 * reader** (M44 U6). `format_rows` took `match` and `search` since M19;
 * `show_format` takes them since M44 U6, and the app's format screen holds
 * them in its address (M44 U7). All three turn what was asked into a
 * `RowQuery` here and hand it to `listRows` and `countRows`, so a conversation
 * and a screen cannot disagree about which rows a filter names: there is no
 * second filter, and nothing re-filters a full list after it is read.
 *
 * **A date is held to a window around today as well as to a day** (M49 U2,
 * D-472): `match:{due: "within 14 days"}`, `"before today"`, `"after today"`,
 * `"today"` — the words a filter's `is` takes — worked out against the day the
 * asking runtime hands in, so the app and a conversation asked on one day name
 * the same rows. The clock is read by that caller, never here.
 *
 * Read-only: it asks the document what a link's name names, and writes nothing.
 */

import type { Database } from 'sql.js'

import { column, isLinkType, type ColumnDeclaration, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { derivedValueSql } from '@/domain/format/derived.ts'
import { clockRange, clockText, parseClockWords, type DateRange } from '@/domain/format/clock.ts'
import { aType } from '@/domain/format/span.ts'
import { coerceMatch, idsIn, type StoredValue } from '@/domain/format/row.ts'
import { err, ok, type Result } from '@/core/result.ts'

import { fromDecimalString, minorUnitDigits } from '@/core/money.ts'
import { parseCurrency } from '@/domain/format/currency.ts'
import { figureRangeSaid, parseFigureRange, type FigureRangeWords } from '@/domain/format/figureRange.ts'

import { indexOf, linksByName } from './formatJoinRepository.ts'
import { documentWeekStart } from './unitRepository.ts'
import type { FigureRange, HeldTo, RowQuery } from './formatRowRepository.ts'

/**
 * What was asked, as a caller has it: column name to what it is held to, and a
 * substring. A column is held to one value (`state: open`), to any of several
 * (`state: [planned, in_progress]`), or to none of them (`state: {not:
 * planned}`, `{not: [a, b]}`) — M37 U3, D-476 — and `null` (or `''`) is the
 * empty cell, alone or among several: `{owner: null}` is *is empty* and
 * `{owner: {not: null}}` *is not empty*. One shape for a tool's `match`, the
 * address and any screen that writes a filter.
 */
export interface RowFilter {
  readonly match?: Readonly<Record<string, unknown>>
  readonly search?: string
}

/** One column's held value, read: the values it may be, and whether that is turned round. */
export interface Holding {
  readonly values: readonly unknown[]
  readonly not: boolean
}

/** `{not: …}`, and nothing else beside it. */
function isNotForm(value: unknown): value is { readonly not: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 1 && 'not' in value
}

/**
 * **A held value as the values it may be** (M37 U3, D-476): one, a list, or
 * either inside `{not: …}`. Anything else is one value, which the column then
 * refuses or takes.
 */
export function heldAs(value: unknown): Holding {
  if (isNotForm(value)) return { values: Array.isArray(value.not) ? value.not : [value.not], not: true }
  return Array.isArray(value) ? { values: value, not: false } : { values: [value], not: false }
}

/** A held value written back from what it may be — one stays one, so the common case reads as it always did. */
export function heldValue(holding: Holding): unknown {
  const values = holding.values.length === 1 ? holding.values[0] : holding.values
  return holding.not ? { not: values } : values
}

/**
 * Why a filter was refused: a column the format has not got, or a value the
 * column cannot be matched by (money, a quantity, a word an enum lacks). Said
 * by the caller in its own words — a tool names its argument, a screen its
 * address.
 */
export type FilterRefusal =
  | { readonly kind: 'NO_COLUMN'; readonly name: string }
  | { readonly kind: 'REFUSED'; readonly column: string; readonly reason: string }

/**
 * A `match`, checked against the declaration and turned into the cells it
 * compares — with every link named the way a person names it resolved to the
 * row id it is stored as (M27 U2). **A link is matched by its target's name as
 * well as by its id**: in a document stored as text an id is regenerated on
 * every write, so `match:{milestone:M20}` was the only spelling that could
 * survive one. The resolution is `linksByName`'s — an id, else the target's
 * unique name, exactly — so a match and a write have one answer to *which row
 * is that*; a name that names nothing stays as written and matches nothing,
 * which is the honest answer.
 */
export function matchCells(
  db: Database,
  declaration: FormatDeclaration,
  match: Readonly<Record<string, unknown>>,
  declarations: readonly FormatDeclaration[],
): Result<ReadonlyMap<string, StoredValue | HeldTo>, FilterRefusal> {
  // Each column's values coerced, and whether it is turned round.
  const held = new Map<string, { values: StoredValue[]; readonly not: boolean; readonly one: boolean }>()
  for (const [name, value] of Object.entries(match)) {
    const column = declaration.columns.find((one) => one.name === name) ?? computedDate(declaration, name, declarations)
    if (column === undefined) return err({ kind: 'NO_COLUMN', name })
    if ('refused' in column) return err({ kind: 'REFUSED', column: name, reason: column.refused })
    const holding = heldAs(value)
    if (holding.values.length === 0) {
      return err({ kind: 'REFUSED', column: column.name, reason: `${column.name} is held to a list with nothing in it — name at least one value, or null for empty.` })
    }
    const values: StoredValue[] = []
    for (const each of holding.values) {
      const cell = coerceMatch(column, each)
      if (!cell.ok) return err({ kind: 'REFUSED', column: column.name, reason: cell.error })
      values.push(cell.value)
    }
    held.set(column.name, { values, not: holding.not, one: !holding.not && values.length === 1 })
  }

  // **A link is read by name, each value of it** (M27 U2; several since M37
  // U3): one row per value asked, beside every other column's first, so a name
  // resolved within its parent (M48 U1) still has the parent to read.
  const linked = declaration.columns.filter((one) => isLinkType(one.type) && held.has(one.name))
  if (linked.length > 0) {
    const base = Object.fromEntries([...held].map(([name, each]) => [name, each.values.find((value) => value !== null) ?? null]))
    const asked: { readonly name: string; readonly at: number }[] = []
    const rows: Record<string, StoredValue>[] = []
    for (const column of linked) {
      held.get(column.name)?.values.forEach((value, at) => {
        if (value === null) return
        rows.push({ ...base, [column.name]: value })
        asked.push({ name: column.name, at })
      })
    }
    const resolved = linksByName(db, declaration, rows, indexOf(declarations))
    asked.forEach(({ name, at }, index) => {
      const values = held.get(name)?.values
      if (values !== undefined) values[at] = resolved[index]?.[name] ?? values[at] ?? null
    })
  }

  return ok(
    new Map(
      [...held].map(([name, each]): [string, StoredValue | HeldTo] => [
        name,
        each.one
          ? (each.values[0] ?? null)
          : { values: each.values.map((value) => (Array.isArray(value) ? (idsIn(value)[0] ?? null) : (value as string | number | null))), not: each.not },
      ]),
    ),
  )
}

/** Any day at all: only a computed column's type is read here, which no day changes. */
const ANY_DAY = '1970-01-01'

/**
 * **A computed column held to a value, as the date column it reads like** (M49
 * U1, D-471): a computed date is matched as a typed one is, in the SQL its view
 * is. A computed figure is refused — a worked-out fraction equal to what was
 * typed is an accident — and anything else is no column.
 */
function computedDate(
  declaration: FormatDeclaration,
  name: string,
  declarations: readonly FormatDeclaration[],
  today?: string,
): ColumnDeclaration | { readonly refused: string } | undefined {
  if (!(declaration.derived ?? []).some((each) => each.name === name)) return undefined
  const found = derivedValueSql(declaration, declarations.filter((each) => each.name !== declaration.name), name, undefined, today ?? ANY_DAY)
  if (found === undefined) return undefined
  return found.type.kind === 'DATE'
    ? column(name, 'date')
    : { refused: `${name} is a computed figure, and only a computed date is held to a value.` }
}

/**
 * **A filter as the `RowQuery` that finds its rows** — the `match` cells and
 * the trimmed `search`, with the formats a search reads a link's name from
 * and a computed column is compiled against. Order and paging stay the caller's.
 */
export function filterQuery(
  db: Database,
  declaration: FormatDeclaration,
  filter: RowFilter,
  declarations: readonly FormatDeclaration[],
  /** The asking runtime's day, `YYYY-MM-DD` — what a window around today is around (D-472). */
  today?: string,
): Result<RowQuery, FilterRefusal> {
  const held: Record<string, unknown> = {}
  const windows = new Map<string, DateRange>()
  const ranges = new Map<string, FigureRange>()
  for (const [name, value] of Object.entries(filter.match ?? {})) {
    // An amount is held to a range in what it is in (M37 U4): `10..50 ILS`.
    const figured = declaration.columns.find((one) => one.name === name && (one.type === 'money' || one.type === 'quantity'))
    const words = figured !== undefined && typeof value === 'string' ? parseFigureRange(value) : undefined
    if (figured !== undefined && words !== undefined) {
      const range = figureRange(figured, words)
      if (!range.ok) return err({ kind: 'REFUSED', column: name, reason: range.error })
      ranges.set(name, range.value)
      continue
    }
    const clock = typeof value === 'string' ? parseClockWords(value) : undefined
    const column = clock === undefined ? undefined : dateColumn(declaration, name, declarations, today)
    if (clock === undefined || column === undefined) {
      // A window is one question, never one of several or turned round (D-472).
      const holding = heldAs(value)
      const windowed = holding.values.some((each) => typeof each === 'string' && parseClockWords(each) !== undefined)
      if (windowed && (holding.not || holding.values.length > 1)) {
        const date = dateColumn(declaration, name, declarations, today)
        if (date !== undefined && !('refused' in date)) {
          return err({
            kind: 'REFUSED',
            column: name,
            reason: `${name} is held to a window of days ${holding.not ? 'turned round' : 'among other values'}; a window is asked alone — say \`before today\`, \`after today\`, \`within 14 days\` or \`this week\`.`,
          })
        }
      }
      held[name] = value
      continue
    }
    if ('refused' in column) return err({ kind: 'REFUSED', column: name, reason: column.refused })
    // A week starts on the document's day, never the machine's (D-528).
    const range = today === undefined ? undefined : clockRange(clock, today, documentWeekStart(db))
    if (range === undefined) {
      return err({ kind: 'REFUSED', column: name, reason: `${name} ${clockText(clock)} needs the day it is asked on, and nothing said what day it is.` })
    }
    windows.set(name, range)
  }
  const cells = matchCells(db, declaration, held, declarations)
  if (!cells.ok) return cells
  const search = filter.search?.trim() ?? ''
  return ok({
    ...(cells.value.size === 0 ? {} : { match: cells.value }),
    ...(windows.size === 0 ? {} : { windows }),
    ...(ranges.size === 0 ? {} : { ranges }),
    ...(search === '' ? {} : { search }),
    ...(today === undefined ? {} : { today }),
    formats: declarations,
  })
}

/**
 * A range's ends in what the column stores (M37 U4): minor units of the
 * currency named, which refuses a figure finer than the currency has rather
 * than rounding it, or a quantity's figure as it is.
 */
function figureRange(column: ColumnDeclaration, words: FigureRangeWords): Result<FigureRange, string> {
  if (column.type === 'money') {
    const currency = parseCurrency(words.unit)
    if (!currency.ok) return err(`${column.name} is held to a range in ${words.unit}: ${currency.error}`)
    const ends: (number | undefined)[] = []
    for (const end of [words.from, words.to]) {
      if (end === undefined) {
        ends.push(undefined)
        continue
      }
      const amount = fromDecimalString(end, currency.value)
      if (amount === undefined) return err(`${end} is not an amount in ${currency.value}, which has ${String(minorUnitDigits(currency.value))} places.`)
      ends.push(amount.minor)
    }
    return ok({ unit: currency.value, from: ends[0], to: ends[1] })
  }
  return ok({
    unit: words.unit,
    from: words.from === undefined ? undefined : Number(words.from),
    to: words.to === undefined ? undefined : Number(words.to),
  })
}

/**
 * The column a window is held to: a typed date, or a computed one — or the
 * sentence saying why a window does not fit it. Nothing for a name that is no
 * column at all, which `matchCells` then names.
 */
function dateColumn(
  declaration: FormatDeclaration,
  name: string,
  declarations: readonly FormatDeclaration[],
  today: string | undefined,
): { readonly date: true } | { readonly refused: string } | undefined {
  const typed = declaration.columns.find((one) => one.name === name)
  const found = typed ?? computedDate(declaration, name, declarations, today)
  if (found === undefined) return undefined
  if ('refused' in found) return { refused: `${name} is a computed figure, and a window of days is a date's.` }
  return found.type === 'date' ? { date: true } : { refused: `${name} is ${aType(found.type)}, and a window of days is a date's.` }
}

/**
 * One held value as a line says it — `state = open`, and a window around
 * today with the filter's own `is`: `due is within 14 days` (D-472). Several,
 * or turned round, in a declared filter's words (D-380, M37 U3): `state is one
 * of planned, in_progress`, `state is not planned`, `owner is not empty`.
 */
export function heldText(name: string, value: unknown): string {
  const clock = typeof value === 'string' ? parseClockWords(value) : undefined
  if (clock !== undefined) return `${name} is ${String(value).trim().replace(/\s+/g, ' ').toLowerCase()}`
  const range = typeof value === 'string' ? parseFigureRange(value) : undefined
  if (range !== undefined) return `${name} is ${figureRangeSaid(range)}`
  const { values, not } = heldAs(value)
  if (!not && values.length === 1) return `${name} = ${heldMember(values[0])}`
  const several = values.length > 1 ? 'one of ' : ''
  return `${name} is ${not ? 'not ' : ''}${several}${values.map(heldMember).join(', ')}`
}

/** One value a column is held to, as a line says it: `empty` for nothing. */
export function heldMember(value: unknown): string {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '') ? 'empty' : String(value)
}

/** Whether a filter asks for anything at all. */
export function isFiltered(filter: RowFilter): boolean {
  return Object.keys(filter.match ?? {}).length > 0 || (filter.search?.trim() ?? '') !== ''
}

/**
 * **What a filter holds, in a line** — `action = author, state = open,
 * search “bidi”`: what the frame's text answer and the screen's band both say
 * it is filtered by.
 */
export function filterText(filter: RowFilter): string {
  const held = Object.entries(filter.match ?? {}).map(([name, value]) => heldText(name, value))
  const search = filter.search?.trim() ?? ''
  return [...held, ...(search === '' ? [] : [`search “${search}”`])].join(', ')
}
