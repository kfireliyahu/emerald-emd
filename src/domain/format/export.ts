/**
 * **A format's rows, as a JSON file somebody else's build reads** (M63 U1, D-601).
 *
 * Rows left a document only through a model, so a project wrote its own script
 * to open a `.emd`'s tables and could not have read one stored as text. This is
 * the shaping half of the way out: a declaration, its rows as the repositories
 * return them and what their links are called, in — a JSON value and its one
 * spelling, out. The command line (`src/plugin/exportCommand.ts`), the tool and
 * the app's button all call it, so a file is the same bytes whoever wrote it.
 *
 * **Imports nothing that is not domain**, so the renderer can call it too.
 *
 * The values, as D-601 has them:
 *
 * - **money** (and a **quantity**) as exact text, `"12.90"`, beside its own
 *   `<column>_currency` (`<column>_unit`) — the shape `record_format_rows`
 *   takes, and never a number (D-003);
 * - a **percent** as the fraction, written from its stored digits and never
 *   through a float: `125000` is `0.125`, `45` is `0.000045`; a **decimal**
 *   likewise from its digits;
 * - a **date** ISO text, **yes/no** `true`/`false`, an **enum** its member;
 * - **`enums` and `links`** arrays in stored order;
 * - a **link** its row's label, or another column of the linked format when
 *   asked; a row **elsewhere** the name it holds;
 * - an **empty column left out**, and a computed one only when named;
 * - a **child format's rows folded in** (M63 U2): the rows whose link points at
 *   this one, as an array under a key of their own, each shaped the same way
 *   with its link back left out — `[]` when it has none, so every object has
 *   the same keys. One level only.
 *
 * **One spelling** (`exportText`): two-space indent, LF, a trailing newline,
 * keys in declaration order. A number keeps the digits it was given, which is
 * why a JSON value here is tagged rather than a plain object: `0.000045`
 * printed through `JSON.stringify` would be `0.000045` today and `4.5e-5` for
 * a figure one place smaller.
 */

import { minorUnitDigits } from '@/core/money.ts'
import { err, ok, type Result } from '@/core/result.ts'

import type { AggregateValue } from './aggregate.ts'
import { edgesOf } from './connections.ts'
import { ROW_ID_COLUMN, type ColumnDeclaration, type FormatDeclaration } from './declaration.ts'
import { formatDecimal } from './decimal.ts'
import type { DerivedValue } from './derived.ts'
import { parseElsewhere } from './elsewhere.ts'
import { PERCENT_DENOMINATOR } from './percent.ts'
import { currencyKeyOf, idsIn, readValue, unitKeyOf, type StoredRow } from './row.ts'

/** A JSON number, as the digits it is written with. */
export interface JsonNumber {
  readonly kind: 'number'
  readonly digits: string
}

/** A JSON object whose keys keep the order they were put in. */
export interface JsonObject {
  readonly kind: 'object'
  readonly entries: readonly (readonly [string, JsonValue])[]
}

export type JsonValue = null | boolean | string | JsonNumber | JsonObject | readonly JsonValue[]

/** The places of a percent's fraction: four of the percent, two more of the whole. */
const FRACTION_PLACES = Math.log10(PERCENT_DENOMINATOR)

function numberOf(digits: string): JsonNumber {
  return { kind: 'number', digits }
}

/** `3.500000` → `3.5`, `2.000` → `2`, `-0.0` → `0`: the digits, without the places nobody wrote. */
function trimmedFigure(figure: string): string {
  if (!figure.includes('.')) return figure
  const trimmed = figure.replace(/0+$/, '').replace(/\.$/, '')
  return trimmed === '-0' ? '0' : trimmed
}

/** A stored integer at `scale` places, as a JSON number written from its digits. */
function scaledNumber(stored: number, scale: number): JsonNumber {
  return numberOf(scale === 0 ? String(stored) : trimmedFigure(formatDecimal(stored, scale)))
}

/** A number the database holds as a float or an integer — `real`, `integer` — as JavaScript prints it. */
function plainNumber(value: number): JsonNumber {
  return numberOf(Number.isFinite(value) ? String(value) : '0')
}

/** Minor units as the amount's text at the currency's places: `1290` ILS is `"12.90"`. */
export function moneyText(minor: number, currency: string): string {
  const places = minorUnitDigits(currency)
  return places === 0 ? String(minor) : formatDecimal(minor, places)
}

/**
 * **One column's value, for the column alone** — what a cell is when the export
 * holds it, or `undefined` when it is empty. Money and a quantity are their
 * text here; their currency or unit is `companionOf`'s. A link, a list of them
 * and a row elsewhere are their stored text: `rowEntries` says what they go
 * out as, since that needs the rows they name.
 */
export function cellValue(column: ColumnDeclaration, row: StoredRow): JsonValue | undefined {
  const cell = row.cells[column.name]
  switch (column.type) {
    case 'money': {
      const value = readValue(column, row)
      return value !== undefined && typeof value === 'object' && 'minor' in value ? moneyText(value.minor, value.currency) : undefined
    }
    case 'quantity': {
      const value = readValue(column, row)
      return value !== undefined && typeof value === 'object' && 'amount' in value ? String(value.amount) : undefined
    }
    case 'percent':
      return typeof cell === 'number' ? scaledNumber(cell, FRACTION_PLACES) : undefined
    case 'decimal':
      return typeof cell === 'number' ? scaledNumber(cell, column.scale ?? 0) : undefined
    case 'integer':
    case 'real':
      return typeof cell === 'number' ? plainNumber(cell) : undefined
    case 'boolean':
      return typeof cell === 'number' ? cell === 1 : undefined
    case 'links':
    case 'enums': {
      const members = idsIn(cell)
      return members.length === 0 ? undefined : members
    }
    case 'text':
    case 'date':
    case 'enum':
    case 'link':
    case 'month':
    case 'instant':
    case 'time':
    case 'elsewhere':
    case 'file':
      return typeof cell === 'string' && cell !== '' ? cell : typeof cell === 'number' ? String(cell) : undefined
  }
}

/** The key and text that go beside a money or quantity column's figure, or nothing. */
function companionOf(column: ColumnDeclaration, row: StoredRow): readonly [string, string] | undefined {
  const value = readValue(column, row)
  if (value === undefined || typeof value !== 'object' || Array.isArray(value)) return undefined
  if (column.type === 'money' && 'currency' in value) return [currencyKeyOf(column), value.currency]
  if (column.type === 'quantity' && 'unit' in value) return [unitKeyOf(column), value.unit]
  return undefined
}

/**
 * **The types a link may be asked to go out as** (`--link name=column`): one
 * value that is whole by itself. Money and a quantity need a second key, and a
 * link from the linked row would be a second hop (one hop, and no traversal).
 */
export function linkableColumn(column: ColumnDeclaration): boolean {
  return !['money', 'quantity', 'link', 'links', 'enums', 'elsewhere'].includes(column.type)
}

/** A computed figure of a row: a derived column's (D-334), or a total folded along a link. */
export type ComputedValue = DerivedValue | AggregateValue

/** A computed figure, as the export holds it — its value, and a currency or unit beside it. */
function computedEntries(name: string, value: ComputedValue): readonly (readonly [string, JsonValue])[] {
  if (value.kind === 'DATE') return [[name, value.date]]
  if (value.kind === 'MONEY') {
    return value.currency === undefined
      ? [[name, formatDecimal(value.minor, 2)]]
      : [[name, moneyText(value.minor, value.currency)], [`${name}_currency`, value.currency]]
  }
  if (value.kind === 'VALUE' && value.currency !== undefined) {
    // A fold of money can land between two minor units (an average): halves away from zero.
    const minor = Math.sign(value.value) * Math.round(Math.abs(value.value))
    return [[name, moneyText(minor === 0 ? 0 : minor, value.currency)], [`${name}_currency`, value.currency]]
  }
  if (value.kind !== 'VALUE' && value.kind !== 'NUMBER') return []
  const figure = plainNumber(value.value)
  return value.unit === undefined ? [[name, figure]] : [[name, figure], [`${name}_unit`, value.unit]]
}

/** What one export asks for, besides the rows. */
export interface ExportShape {
  readonly declaration: FormatDeclaration
  /**
   * The columns to hold, stored and computed, by name — or every stored column
   * when absent. Whatever order they are asked in, they go out in the
   * declaration's: stored columns, then computed ones.
   */
  readonly columns?: readonly string[]
  /**
   * What each linked row goes out as, by its id: its label, or the column a
   * caller chose. A link to a row with none goes out as its id.
   */
  readonly linked: ReadonlyMap<string, ReadonlyMap<string, JsonValue>>
  /** Each row's computed figures by name — only the ones `columns` names are read. */
  readonly computed?: ReadonlyMap<string, ReadonlyMap<string, ComputedValue>>
  /** The row's id as the first key, `id`. Off unless asked. */
  readonly ids?: boolean
  /** A column held back whatever `columns` says: a child's link back to the row it is folded into (M63 U2). */
  readonly omit?: string
  /** Child formats folded into each row, after its own columns, in the order asked (M63 U2). */
  readonly nested?: readonly NestedShape[]
}

/**
 * **One child format folded into its parent's rows** (M63 U2) — the key it goes
 * out under, the shape each child row takes (its link back as `omit`, and no
 * `nested` of its own: one level only), and each parent's children by the
 * parent's id, already in the order asked.
 */
export interface NestedShape {
  readonly as: string
  readonly shape: ExportShape
  readonly children: ReadonlyMap<string, readonly StoredRow[]>
}

/**
 * **The columns of `child` that point at a row of `parent`** — read off the
 * graph `connections.ts` draws, so a link the formats screen shows is the link
 * a nest follows. A link at a format the document no longer declares is not
 * one; a `links` column is, since a row it names is a row it points at.
 */
export function linksBack(declarations: readonly FormatDeclaration[], child: string, parent: string): readonly string[] {
  return edgesOf(declarations).flatMap((edge) =>
    edge.kind === 'LINK' && edge.format === child && edge.target === parent && !edge.dangling ? [edge.column] : [],
  )
}

/**
 * **Child rows grouped by the parent each points at** through `column`, every
 * group in the order the rows came — so the order a caller listed them in is
 * the order each array holds. A `links` cell puts its row under each parent it
 * names, once.
 */
export function childrenByParent(column: string, rows: readonly StoredRow[]): ReadonlyMap<string, readonly StoredRow[]> {
  const out = new Map<string, StoredRow[]>()
  for (const row of rows) {
    for (const parent of new Set(idsIn(row.cells[column]))) {
      const held = out.get(parent)
      if (held === undefined) out.set(parent, [row])
      else held.push(row)
    }
  }
  return out
}

/** The computed columns a declaration has, in its order: derived, then totals. */
export function computedNames(declaration: FormatDeclaration): readonly string[] {
  return [...(declaration.derived ?? []).map((each) => each.name), ...declaration.aggregates.map((each) => each.name)]
}

/** One row's keys and values, in declaration order, its empty columns left out. */
export function rowEntries(shape: ExportShape, row: StoredRow): readonly (readonly [string, JsonValue])[] {
  const asked = shape.columns === undefined ? undefined : new Set(shape.columns)
  const entries: (readonly [string, JsonValue])[] = shape.ids === true ? [[ROW_ID_COLUMN, row.id]] : []
  for (const column of shape.declaration.columns) {
    if (asked !== undefined && !asked.has(column.name)) continue
    if (column.name === shape.omit) continue
    const value = cellValue(column, row)
    if (value === undefined) continue
    const linked = shape.linked.get(column.name)
    if (column.type === 'link' && typeof value === 'string') {
      const out = linked?.get(value) ?? value
      if (out !== null) entries.push([column.name, out])
      continue
    }
    if (column.type === 'links' && Array.isArray(value)) {
      entries.push([column.name, (value as readonly string[]).map((id) => linked?.get(id) ?? id)])
      continue
    }
    if (column.type === 'elsewhere' && typeof value === 'string') {
      const parsed = parseElsewhere(value)
      entries.push([column.name, parsed.ok ? parsed.value.name : value])
      continue
    }
    entries.push([column.name, value])
    const companion = companionOf(column, row)
    if (companion !== undefined) entries.push(companion)
  }
  if (asked !== undefined) {
    const figures = shape.computed?.get(row.id)
    for (const name of computedNames(shape.declaration)) {
      const value = asked.has(name) ? figures?.get(name) : undefined
      if (value !== undefined) entries.push(...computedEntries(name, value))
    }
  }
  for (const nest of shape.nested ?? []) {
    const children = nest.children.get(row.id) ?? []
    entries.push([nest.as, children.map((child): JsonValue => ({ kind: 'object', entries: rowEntries(nest.shape, child) }))])
  }
  return entries
}

/** The rows, as the JSON array a file holds: one object per row, in the order given. */
export function exportValue(shape: ExportShape, rows: readonly StoredRow[]): JsonValue {
  return rows.map((row): JsonValue => ({ kind: 'object', entries: rowEntries(shape, row) }))
}

function isNumber(value: JsonValue): value is JsonNumber {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && (value as JsonNumber | JsonObject).kind === 'number'
}

function spelled(value: JsonValue, indent: string): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return JSON.stringify(value)
  if (isNumber(value)) return value.digits
  const inner = `${indent}  `
  if (Array.isArray(value)) {
    const items = value as readonly JsonValue[]
    return items.length === 0 ? '[]' : `[\n${items.map((item) => `${inner}${spelled(item, inner)}`).join(',\n')}\n${indent}]`
  }
  const entries = (value as JsonObject).entries
  return entries.length === 0
    ? '{}'
    : `{\n${entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${spelled(item, inner)}`).join(',\n')}\n${indent}}`
}

/** **The one spelling**: two-space indent, LF, a trailing newline, keys in the order they were put in. */
export function exportText(value: JsonValue): string {
  return `${spelled(value, '')}\n`
}

// --- what one export asks (M63 U1-U3) -----------------------------------------

/** What one export asks of a document — the command line's flags and the tool's arguments alike. */
export interface ExportAsk {
  readonly format: string
  readonly match?: Readonly<Record<string, unknown>>
  readonly search?: string
  readonly order?: string
  readonly descending?: boolean
  /** Stored and computed columns to hold; every stored column when absent. */
  readonly columns?: readonly string[]
  /** A link column to the column of the linked format it goes out as, instead of the row's label. */
  readonly link?: Readonly<Record<string, string>>
  readonly ids?: boolean
  /** Child formats folded into each row (M63 U2), in the order their keys go out. */
  readonly nest?: readonly NestAsk[]
}

/**
 * **One child format to fold in** (M63 U2): its rows whose link points at an
 * exported row, as an array under `as`. `format` is the child's name, or
 * `child.link` when it links to the parent's format through more than one
 * column. Its other links go out as their rows' labels, and `ids` is the
 * parent's.
 */
export interface NestAsk {
  readonly format: string
  /** The key the array goes out under; the child format's name by default. */
  readonly as?: string
  /** A column of the child's; its label column by default, ties by the label column then the id. */
  readonly order?: string
  readonly descending?: boolean
  /** The child's columns to hold, computed too; every stored one but the link back when absent. */
  readonly columns?: readonly string[]
}

/** The sentence refusing a nest inside a nest. */
export const NEST_ONE_LEVEL = (format: string): string =>
  `A nest folds one level only: ${format}'s own children cannot be folded into it. Export ${format} with its own nest to a file of its own.`

export const NEST_FORM = '<child>[.<link>] [as=<key>] [order=<column>] [descending] [columns=a,b]'

/**
 * **One nest, as a person types it** (M63 U2), here so the renderer reads a saved export's nests too (M63 U3): the child format — `keyword`, or
 * `keyword.card` to say which link — then any of `as=`, `order=`, `descending`
 * and `columns=a,b`, separated by spaces. The command line's `--nest` takes it,
 * the tool takes it in place of an object, and a saved export holds one per line.
 */
export function parseNest(spec: string): Result<NestAsk, string> {
  const [format, ...words] = spec.trim().split(/\s+/)
  if (format === undefined || format === '' || format.includes('=')) return err(`A nest starts with the format folded in: ${NEST_FORM}.`)
  let as: string | undefined
  let order: string | undefined
  let columns: string[] | undefined
  let descending = false
  for (const word of words) {
    const equals = word.indexOf('=')
    const key = equals < 0 ? word : word.slice(0, equals)
    const given = equals < 0 ? undefined : word.slice(equals + 1)
    if (key === 'descending' && given === undefined) descending = true
    else if (key === 'nest' || key === '--nest') return err(NEST_ONE_LEVEL(format))
    else if ((key === 'as' || key === 'order' || key === 'columns') && given !== undefined && given !== '') {
      if (key === 'as') as = given
      else if (key === 'order') order = given
      else columns = given.split(',').map((each) => each.trim()).filter((each) => each !== '')
    } else return err(`A nest does not know ${word}. It reads ${NEST_FORM}.`)
  }
  return ok({
    format,
    ...(as === undefined ? {} : { as }),
    ...(order === undefined ? {} : { order }),
    ...(descending ? { descending } : {}),
    ...(columns === undefined ? {} : { columns }),
  })
}
