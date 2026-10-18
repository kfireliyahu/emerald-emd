/**
 * A row of a declared format: what a caller offers, and what the table stores
 * (M19 U2, D-217).
 *
 * U1 made a declaration compile to a real table. **Nothing could put a row in
 * it** — which is why U1's review entry says the four refusals have never been
 * seen on screen: there was no way to give a declared table any data. This file
 * is the other end of that. One declared column at a time, a value a
 * conversation offered becomes the cells SQLite holds, or a sentence saying why
 * it cannot.
 *
 * **It imports nothing from the ledger and nothing in the ledger imports it**,
 * which is D-214's *beside the finance app, touching none of it* said in the
 * import graph, exactly as `declaration.ts` says it.
 *
 * ## Why the checks are here and not left to the `CHECK`
 *
 * The table already refuses a bad value: `ddl.ts` writes the bounds, the enum
 * members and the date shape as real constraints, and they hold against
 * whatever calls `db.run`. But a constraint that fires comes back as *"CHECK
 * constraint failed"* with no column in it, and the reader of that sentence is
 * a model about to try again. It is the reasoning `create_category` already
 * uses for a parent it could have left to a trigger: **refuse here, name the
 * column, and let the constraint catch what this file got wrong** — which is
 * what makes the constraint worth having rather than redundant.
 *
 * ## Forgiving at the edge, strict underneath
 *
 * A value that arrives here came out of a conversation, and two slips are
 * common enough that refusing them costs a round trip to teach nothing: a
 * number sent as a string, and an enum member sent with the wrong case. Both
 * are unambiguous, so both are accepted and normalised. **Everything else is
 * refused with the column named.** The line is that a coercion may not change
 * which value was meant — `"4"` is four and `Label` is `label`, while `"about
 * four"` is a question only the user can answer.
 */

import { fromMajorUnits, money, type CurrencyCode, type Money } from '@/core/money.ts'
import { err, ok, type Result } from '@/core/result.ts'
import { isValidDate, parseISODate, toISODate } from '@/core/time.ts'

import { constraintHolds, constraintText } from './constraint.ts'
import { figureColumnOf } from './ddl.ts'
import { rulePatternProblems } from './rule.ts'
import { decimalValue, formatDecimal, parseDecimal } from './decimal.ts'
import { parseCurrency } from './currency.ts'
import { elsewhereText, parseElsewhere } from './elsewhere.ts'
import { parseFile } from './file.ts'
import { formatStoredPercent, parsePercent, PERCENT_DENOMINATOR, percentValue, readPercent } from './percent.ts'
import { isPointType, parseTime, pointOrdinal, type Point } from './span.ts'

import {
  isLinkType,
  isListType,
  moneyColumnNames,
  quantityColumnNames,
  ROW_ID_COLUMN,
  storedColumnsOf,
  type ColumnDeclaration,
  type FormatDeclaration,
} from './declaration.ts'
import {
  evaluateIdentity,
  type Fraction,
  type IdentityDeclaration,
  type IdentityInputs,
  type Verdict,
} from './identity.ts'
import { SEEDED_UNITS, unitNamed, type Quantity, type UnitTable } from './unit.ts'

/**
 * What one SQL cell of a declared table holds — or, for a `links` column, the
 * ids of its members in order, which are rows of a table of their own and come
 * back beside the row's cells under the column's name (M27 U2, D-300).
 */
export type StoredValue = string | number | null | readonly string[]

/** A row as the table has it: its identity, and a cell per stored column. */
export interface StoredRow {
  readonly id: string
  readonly cells: Readonly<Record<string, StoredValue>>
}

/**
 * What a declared column holds, read back out.
 *
 * `money` is the one that does not come back the shape it went in, and that is
 * the point: two cells go in and a `Money` comes out, so nothing downstream
 * ever holds an amount as a float.
 */
export type ReadValue = string | number | boolean | Money | Quantity | readonly string[] | undefined

/** A cell as one value — a list is none, since a constraint reads one figure. */
function scalarOf(cell: StoredValue | undefined): string | number | null {
  return typeof cell === 'string' || typeof cell === 'number' ? cell : null
}

/** Whether a value read back is a `links` column's list (M27 U2, D-300). */
export function isList(value: ReadValue | StoredValue): value is readonly string[] {
  return Array.isArray(value)
}

/** The ids a link cell holds — one, several (M27 U2, D-300), or none. */
export function idsIn(cell: StoredValue | undefined): readonly string[] {
  if (typeof cell === 'string') return cell === '' ? [] : [cell]
  if (cell === null || cell === undefined || typeof cell === 'number') return []
  return cell.filter((id) => id !== '')
}

/**
 * **A row may not name itself** — M27 U5, D-303. Through a link into its own
 * format: a unit blocked by itself is never ready, and a decision superseding
 * itself is a chain with no next step. Refused at the write, by every surface
 * that writes a row, beside `danglingLinks`; empty when nothing does.
 *
 * `id` is the row's own — an edit's, or the id a batch drew for a new row,
 * since a batch can name its own rows by name (D-256).
 */
export function selfLinks(
  declaration: { readonly name: string; readonly columns: readonly ColumnDeclaration[] },
  id: string,
  cells: Readonly<Record<string, StoredValue>>,
): readonly string[] {
  return declaration.columns
    .filter(
      (column) =>
        isLinkType(column.type) &&
        column.target === declaration.name &&
        idsIn(cells[column.name]).includes(id),
    )
    .map(
      (column) =>
        `${column.name} names this row itself. A row of ${declaration.name} can name other rows through it, never its own.`,
    )
}

/**
 * The key a caller uses to say what currency a `money` column is in.
 *
 * Deliberately the same name the column is *stored* under. A money column
 * `price` is offered as `price` (major units) beside `price_currency`, and the
 * second of those is a column SQLite actually has — so the word a person types
 * and the word the database holds are one word rather than two kept in step.
 */
export function currencyKeyOf(column: Pick<ColumnDeclaration, 'name'>): string {
  return moneyColumnNames(column).currency
}

/**
 * The key a caller uses to say what a `quantity` column's figure is in (U4c,
 * D-225).
 *
 * The same arrangement as a currency and for the same reason: the word a person
 * types and the word the database holds are one word rather than two kept in
 * step. An `amount` of 150 is offered beside an `amount_unit` of `g`.
 */
export function unitKeyOf(column: Pick<ColumnDeclaration, 'name'>): string {
  return quantityColumnNames(column).unit
}

/** The companion key a column has, for the two types that store as two columns. */
export function companionKeyOf(column: ColumnDeclaration): string | undefined {
  if (column.type === 'money') return currencyKeyOf(column)
  if (column.type === 'quantity') return unitKeyOf(column)
  return undefined
}

/**
 * Every key a caller may use for this declaration.
 *
 * Exported because both a tool's schema and its refusals are built from it: an
 * unknown key is refused by naming the ones that exist, and a surface that
 * derived that list a second way would eventually name a key nothing reads.
 */
export function offeredKeysOf(declaration: FormatDeclaration): readonly string[] {
  return declaration.columns.flatMap((column) => {
    const companion = companionKeyOf(column)
    return companion === undefined ? [column.name] : [column.name, companion]
  })
}

/**
 * One declared column's worth of a caller's row, as cells.
 *
 * `offered` is what was sent for the column itself; `beside` is what was sent
 * for its companion key — a currency for `money`, a unit symbol for `quantity`
 * — and is ignored by every other type.
 *
 * The switch below has no `money` or `quantity` arm and does not need one: the
 * early returns narrow both out of the union, so adding a tenth type to the
 * language is still a compile error here.
 */
export function coerceValue(
  column: ColumnDeclaration,
  offered: unknown,
  beside: unknown,
  units: UnitTable = SEEDED_UNITS,
): Result<Record<string, StoredValue>, string> {
  if (column.type === 'money') return coerceMoney(column, offered, beside)
  if (column.type === 'quantity') return coerceQuantity(column, offered, beside, units)
  if (column.type === 'links') return coerceLinks(column, offered)
  if (column.type === 'enums') return coerceEnums(column, offered)

  if (isBlank(offered)) {
    if (column.required) return err(`${column.name} is required and was not given.`)
    return ok({ [column.name]: null })
  }

  switch (column.type) {
    case 'text':
      if (typeof offered !== 'string') {
        return err(`${column.name} is text, and was given ${describeOffered(offered)}.`)
      }
      return ok({ [column.name]: offered })

    case 'integer':
    case 'real': {
      const value = asNumber(offered)
      if (value === undefined) {
        return err(`${column.name} is a ${column.type}, and was given ${describeOffered(offered)}.`)
      }
      if (column.type === 'integer' && !Number.isInteger(value)) {
        return err(`${column.name} is a whole number, and was given ${String(value)}.`)
      }
      if (column.minimum !== undefined && value < column.minimum) {
        return err(
          `${column.name} is ${String(value)}, below its minimum of ${String(column.minimum)}.`,
        )
      }
      if (column.maximum !== undefined && value > column.maximum) {
        return err(
          `${column.name} is ${String(value)}, above its maximum of ${String(column.maximum)}.`,
        )
      }
      return ok({ [column.name]: value })
    }

    case 'decimal': {
      // As text or as a number, and never through a float on the way in: the
      // digits are split at the point by `decimal.ts` (M24 U6, D-257).
      if (typeof offered !== 'string' && typeof offered !== 'number') {
        return err(`${column.name} is a decimal, and was given ${describeOffered(offered)}.`)
      }
      const scale = column.scale ?? 0
      const scaled = parseDecimal(offered, scale)
      if (!scaled.ok) return err(`${column.name}: ${scaled.error}`)
      const figure = formatDecimal(scaled.value, scale)
      for (const [word, bound, outside] of [
        ['below its minimum', column.minimum, (at: number) => scaled.value < at],
        ['above its maximum', column.maximum, (at: number) => scaled.value > at],
      ] as const) {
        if (bound === undefined) continue
        const at = parseDecimal(String(bound), scale)
        if (at.ok && outside(at.value)) {
          return err(`${column.name} is ${figure}, ${word} of ${String(bound)}.`)
        }
      }
      return ok({ [column.name]: scaled.value })
    }

    case 'percent': {
      // As a person types it — `87`, `"87%"` or `0.87` are all 87% (M29 F3,
      // D-344) — and stored as millionths of the whole without a float on the
      // way in (M29 U3, D-333). A bound is the percent figure, always.
      if (typeof offered !== 'string' && typeof offered !== 'number') {
        return err(`${column.name} is a percent, and was given ${describeOffered(offered)}.`)
      }
      const stored = readPercent(offered)
      if (!stored.ok) return err(`${column.name}: ${stored.error}`)
      for (const [word, bound, outside] of [
        ['below its minimum', column.minimum, (at: number) => stored.value < at],
        ['above its maximum', column.maximum, (at: number) => stored.value > at],
      ] as const) {
        if (bound === undefined) continue
        const at = parsePercent(String(bound))
        if (at.ok && outside(at.value)) {
          return err(`${column.name} is ${formatStoredPercent(stored.value)}, ${word} of ${String(bound)}%.`)
        }
      }
      return ok({ [column.name]: stored.value })
    }

    case 'elsewhere': {
      // **The shape, never the reach** (M47 U4, D-461): a row in a document
      // that is not there is still written, and read back as unresolved.
      if (typeof offered !== 'string') {
        return err(
          `${column.name} is a row in another document, written F:/projects/site/site.emd S1 U5, and was given ${describeOffered(offered)}.`,
        )
      }
      const elsewhere = parseElsewhere(offered)
      if (!elsewhere.ok) return err(`${column.name}: ${elsewhere.error}`)
      return ok({ [column.name]: elsewhereText(elsewhere.value) })
    }

    case 'file': {
      // **Where, never whether** (M37 U6): a file that is not there is still
      // written, and read back as missing.
      if (typeof offered !== 'string') {
        return err(`${column.name} is a file — a path on this computer — and was given ${describeOffered(offered)}.`)
      }
      const file = parseFile(offered)
      if (!file.ok) return err(`${column.name}: ${file.error}`)
      return ok({ [column.name]: file.value })
    }

    case 'month': {
      if (typeof offered !== 'string') {
        return err(`${column.name} is a month, and was given ${describeOffered(offered)}.`)
      }
      const month = parseMonth(offered.trim())
      if (month === undefined) {
        return err(`${column.name} must be a month as YYYY-MM; got "${offered}".`)
      }
      return ok({ [column.name]: month })
    }

    case 'instant': {
      if (typeof offered !== 'string') {
        return err(
          `${column.name} is a moment, written as 2026-09-23T14:05:00Z, and was given ${describeOffered(offered)}.`,
        )
      }
      const instant = parseInstant(offered.trim())
      if (!instant.ok) return err(`${column.name}: ${instant.error}`)
      return ok({ [column.name]: instant.value })
    }

    case 'time': {
      // A time of day, typed plainly — `9`, `9:30`, `21:00`, `9pm` — and kept
      // as `HH:MM` (M29 U4, D-335). A number is refused rather than read as an
      // hour or as a fraction of a day: both are guesses about which it was.
      if (typeof offered !== 'string') {
        return err(`${column.name} is a time of day, written as "09:30", and was given ${describeOffered(offered)}.`)
      }
      const time = parseTime(offered)
      if (!time.ok) return err(`${column.name}: ${time.error}`)
      return ok({ [column.name]: time.value })
    }

    case 'date': {
      if (typeof offered !== 'string') {
        return err(`${column.name} is a date, and was given ${describeOffered(offered)}.`)
      }
      const parsed = parseISODate(offered)
      if (parsed === undefined) {
        return err(`${column.name} must be a date as YYYY-MM-DD; got "${offered}".`)
      }
      return ok({ [column.name]: toISODate(parsed) })
    }

    case 'boolean': {
      const value = asBoolean(offered)
      if (value === undefined) {
        return err(`${column.name} is true or false, and was given ${describeOffered(offered)}.`)
      }
      return ok({ [column.name]: value ? 1 : 0 })
    }

    case 'link': {
      // **A string and nothing else** (U4b, D-224). Whether it is a row's id,
      // or a row's name under a unique naming column (M24 U5, D-256), is a
      // question about the *document*, and this file has none — `linksByName`
      // swaps a name for its id and `missingTargets` refuses what is left, and
      // the repository runs both before a write. Two refusals rather than one
      // because they are two mistakes: a link given a number is a caller that
      // misunderstood the column, and one that names nothing misread a listing.
      if (typeof offered !== 'string') {
        return err(
          `${column.name} points at a row of ${column.target ?? 'another format'}, so it takes that row's id or name, and was given ${describeOffered(offered)}.`,
        )
      }
      const id = offered.trim()
      if (id === '') return err(`${column.name} was given an id with nothing in it.`)
      return ok({ [column.name]: id })
    }

    case 'enum': {
      if (typeof offered !== 'string') {
        return err(
          `${column.name} is one of ${column.values.join(', ')}, and was given ${describeOffered(offered)}.`,
        )
      }
      // Case-insensitively, and stored as the declaration spells it: a model
      // answering `Label` meant `label`, and the `CHECK` would refuse it with
      // nothing in the message to act on.
      const member = column.values.find(
        (value) => value.toLowerCase() === offered.trim().toLowerCase(),
      )
      if (member === undefined) {
        return err(`${column.name} must be one of ${column.values.join(', ')}; got "${offered}".`)
      }
      return ok({ [column.name]: member })
    }
  }
}

/**
 * A `links` cell (M27 U2, D-300): a list of ids or names, in order, or one on
 * its own. **Never a string split on a separator** — a name may hold a comma,
 * and the list is the caller's to say. Empty is an empty list, which is what a
 * row linking to nothing holds; the same row named twice is refused rather
 * than kept once, because a caller who sent it twice meant something.
 */
function coerceLinks(column: ColumnDeclaration, offered: unknown): Result<Record<string, StoredValue>, string> {
  if (isBlank(offered)) return ok({ [column.name]: [] })
  const listed: readonly unknown[] = Array.isArray(offered) ? offered : [offered]
  const ids: string[] = []
  for (const each of listed) {
    if (typeof each !== 'string') {
      return err(
        `${column.name} names rows of ${column.target ?? 'another format'}, so it takes a list of their ids or names, and was given ${describeOffered(each)} in it.`,
      )
    }
    const id = each.trim()
    if (id === '') return err(`${column.name} was given an id with nothing in it.`)
    if (ids.includes(id)) return err(`${column.name} names ${id} twice. A row is in the list once.`)
    ids.push(id)
  }
  return ok({ [column.name]: ids })
}

/**
 * An `enums` cell (M34 U5, D-398): several members of the column's list, in
 * the order given, or one on its own. **Never a string split on a separator**,
 * as a `links` cell is not: the list is the caller's to say, and a reading that
 * splits a spreadsheet cell does so by the separator its mapping states
 * (`reading.ts`). Each member is matched case-insensitively and stored as the
 * declaration spells it, as an enum's one is; **one outside the list is
 * refused by name**, with the list beside it.
 */
function coerceEnums(column: ColumnDeclaration, offered: unknown): Result<Record<string, StoredValue>, string> {
  if (isBlank(offered)) return ok({ [column.name]: [] })
  const listed: readonly unknown[] = Array.isArray(offered) ? offered : [offered]
  const members: string[] = []
  for (const each of listed) {
    if (typeof each !== 'string') {
      return err(
        `${column.name} is any of ${column.values.join(', ')}, so it takes a list of them, and was given ${describeOffered(each)} in it.`,
      )
    }
    const written = each.trim()
    if (written === '') return err(`${column.name} was given a member with nothing in it.`)
    const member = column.values.find((value) => value.toLowerCase() === written.toLowerCase())
    if (member === undefined) {
      return err(`${column.name} has no "${written}" on its list; it is any of ${column.values.join(', ')}.`)
    }
    if (members.includes(member)) return err(`${column.name} names ${member} twice. A member is in the list once.`)
    members.push(member)
  }
  return ok({ [column.name]: members })
}

/**
 * A whole row, checked against the declaration before anything is written.
 *
 * **An unknown key is refused rather than dropped.** A conversation that sent
 * `protein` to a format declaring `protein_g` has not written a row with a
 * missing figure — it believes it wrote the figure, and every check that ever
 * runs over that row is wrong quietly. That is D-138's law in its smallest
 * form: a write that reports what it wrote has to report what was *offered*.
 */
export function coerceRow(
  declaration: FormatDeclaration,
  offered: Readonly<Record<string, unknown>>,
  units: UnitTable = SEEDED_UNITS,
): Result<Record<string, StoredValue>, string> {
  const known = new Set(offeredKeysOf(declaration))
  const unknownKey = firstUnknownKey(Object.keys(offered), known, declaration)
  if (unknownKey !== undefined) return err(unknownKey)

  const cells: Record<string, StoredValue> = {}
  for (const column of declaration.columns) {
    const companion = companionKeyOf(column)
    const coerced = coerceValue(
      column,
      offered[column.name],
      companion === undefined ? undefined : offered[companion],
      units,
    )
    if (!coerced.ok) return coerced
    Object.assign(cells, coerced.value)
  }
  return ok(cells)
}

/**
 * The cells a *partial* row touches — an edit, where a column nobody named is a
 * column left exactly as it was.
 *
 * The difference from `coerceRow` is the whole of what makes an edit an edit:
 * there, a missing required column is a row with a hole in it; here it is a
 * column nobody mentioned. **What is still not permitted is emptying a required
 * column**, and `coerceValue` refuses that on its own, because a blank offer
 * for a required column is a blank offer whichever call it arrived in.
 */
export function coerceEdit(
  declaration: FormatDeclaration,
  offered: Readonly<Record<string, unknown>>,
  units: UnitTable = SEEDED_UNITS,
): Result<Record<string, StoredValue>, string> {
  const known = new Set(offeredKeysOf(declaration))
  const named = Object.keys(offered)
  if (named.length === 0) return err('This edit names no columns, so there is nothing to change.')
  const unknownKey = firstUnknownKey(named, known, declaration)
  if (unknownKey !== undefined) return err(unknownKey)

  const cells: Record<string, StoredValue> = {}
  for (const column of declaration.columns) {
    const companion = companionKeyOf(column)
    const mentioned =
      Object.hasOwn(offered, column.name) ||
      (companion !== undefined && Object.hasOwn(offered, companion))
    if (!mentioned) continue

    const coerced = coerceValue(
      column,
      offered[column.name],
      companion === undefined ? undefined : offered[companion],
      units,
    )
    if (!coerced.ok) return coerced
    Object.assign(cells, coerced.value)
  }
  return ok(cells)
}

/** What a stored row holds for one declared column, as something to print. */
export function readValue(column: ColumnDeclaration, row: StoredRow): ReadValue {
  if (column.type === 'money') {
    const names = moneyColumnNames(column)
    const minor = row.cells[names.minor]
    const currency = row.cells[names.currency]
    if (typeof minor !== 'number' || typeof currency !== 'string') return undefined
    return money(minor, currency)
  }

  if (column.type === 'quantity') {
    // **Both cells or nothing** (U4c, D-225). Half a quantity is a figure whose
    // unit is missing, and a caller handed the figure alone would print it
    // beside whatever unit it assumed — which is the factor-of-a-thousand this
    // type exists to prevent.
    const names = quantityColumnNames(column)
    const amount = row.cells[names.amount]
    const unit = row.cells[names.unit]
    if (typeof amount !== 'number' || typeof unit !== 'string' || unit === '') return undefined
    return { amount, unit }
  }

  const cell = row.cells[column.name]
  if (cell === null || cell === undefined) return undefined
  // An empty list is nothing to print, like an empty link (M27 U2, D-300).
  if (isListType(column.type)) return idsIn(cell).length === 0 ? undefined : idsIn(cell)
  if (typeof cell !== 'string' && typeof cell !== 'number') return undefined
  if (column.type === 'boolean') return cell === 1
  // **Out as the figure, at the column's places** (M24 U6, D-257) — `3.500000`
  // rather than the `3500000` the table holds, and a string rather than a
  // number, so nothing downstream turns it back into a float to print it.
  if (column.type === 'decimal' && typeof cell === 'number') {
    return formatDecimal(cell, column.scale ?? 0)
  }
  // `12.5%`, for the same reason (M29 U3, D-333).
  if (column.type === 'percent' && typeof cell === 'number') return formatStoredPercent(cell)
  return cell
}

/**
 * `YYYY-MM`, with a month from 01 to 12, or nothing.
 *
 * A date is refused rather than cut down to its month: `2026-09-01` sent to a
 * billing period may be the first day of September or a misread column, and
 * only the sender knows which.
 */
export function parseMonth(text: string): string | undefined {
  const match = /^(\d{4})-(\d{2})$/.exec(text)
  if (match === null) return undefined
  const month = Number(match[2])
  return month >= 1 && month <= 12 ? text : undefined
}

const INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})$/

/**
 * A moment, as the one spelling the column stores — UTC, to the millisecond
 * (M24 U6, D-257).
 *
 * **Its offset or its refusal.** `2026-09-23T14:05` is a different moment in
 * Tel Aviv and in London, and a column of instants that guessed would be a
 * column of guesses. Finer than a millisecond is refused rather than cut, for
 * `decimal.ts`'s reason.
 */
export function parseInstant(text: string): Result<string, string> {
  const match = INSTANT_PATTERN.exec(text)
  if (match === null) {
    return err(
      `"${text}" is not a moment. Write it with its offset — 2026-09-23T14:05:00Z, or 2026-09-23T17:05:00+03:00.`,
    )
  }
  const [, year, month, day, hour, minute, second = '0', fraction = ''] = match
  if (!isValidDate(Number(year), Number(month), Number(day))) {
    return err(`"${text}" names a day that does not exist.`)
  }
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) {
    return err(`"${text}" names a time of day that does not exist.`)
  }
  if (fraction.replace(/0+$/, '').length > 3) {
    return err(`"${text}" is finer than a millisecond, which is as fine as a moment is kept.`)
  }
  const at = Date.parse(text)
  if (Number.isNaN(at)) return err(`"${text}" is not a moment.`)
  return ok(new Date(at).toISOString())
}

/**
 * The value a `match` filter compares against, which is a stored cell and never
 * a declared one.
 *
 * A money column is deliberately not matchable: the cell is minor units, a
 * filter would have to name a currency to mean anything, and *"the ingredient
 * that cost exactly 12.90"* is not a question anybody asks. Refused by name
 * rather than quietly ignored, which is the difference between a filter that
 * found nothing and a filter that was not applied.
 */
export function coerceMatch(
  column: ColumnDeclaration,
  offered: unknown,
): Result<StoredValue, string> {
  if (column.type === 'money') {
    return err(`${column.name} is money, and an amount is not something to match a row by — hold it to a range in one currency: \`10..50 ILS\`, \`10.. ILS\`, \`..50 ILS\`.`)
  }
  if (column.type === 'quantity') {
    // The same refusal as money, for the nearer reason: *the line that uses
    // 150* is a question about a figure whose unit the filter never said, and
    // it would quietly match the row measured in millilitres.
    return err(
      `${column.name} is a quantity, and a figure without the unit it is in is not something to match a row by — hold it to a range in one unit: \`100..500 g\`.`,
    )
  }
  if (isBlank(offered)) return ok(null)
  // A list matches a row that holds the one row named (M27 U2, D-300).
  if (column.type === 'links' && typeof offered !== 'string') {
    return err(`${column.name} is a list, so a match names one row it should hold, by id or name.`)
  }
  // And several of a list, a row that holds the one member named (M34 U5, D-398).
  if (column.type === 'enums') {
    if (typeof offered !== 'string') {
      return err(`${column.name} is a list, so a match names one member it should hold — one of ${column.values.join(', ')}.`)
    }
    const coerced = coerceEnums(column, offered)
    if (!coerced.ok) return coerced
    const [member] = idsIn(coerced.value[column.name])
    return ok(member ?? null)
  }
  const coerced = coerceValue(column, offered, undefined)
  if (!coerced.ok) return coerced
  return ok(coerced.value[column.name] ?? null)
}

function firstUnknownKey(
  keys: readonly string[],
  known: ReadonlySet<string>,
  declaration: FormatDeclaration,
): string | undefined {
  for (const key of keys) {
    if (key === ROW_ID_COLUMN) {
      return `${ROW_ID_COLUMN} is the identity this document gives a row, not something to set.`
    }
    if (!known.has(key)) {
      return `${declaration.name} has no ${key}. It has ${[...known].join(', ')}.`
    }
  }
  return undefined
}

/**
 * A figure and the unit it is in, as two cells (U4c, D-225).
 *
 * **The symbol is checked against the document here**, which is the one thing
 * the `CHECK` in `ddl.ts` deliberately does not do: the units are rows and the
 * list closes at the moment it is used (D-223), so the table can only insist
 * that the cell is a symbol at all. A row stored with a symbol nothing knows
 * would convert to nothing for the rest of its life, and the only sentence
 * worth reading about it is this one — at the moment it is written, naming the
 * column and what the document does have.
 *
 * `g` and `G` are not the same unit and no case is forgiven, for the reason
 * `unit.ts` keeps: `mg` and `Mg` are a thousandfold apart in every table that
 * has ever printed both. That is the line D-217 drew — a coercion may not
 * change *which* value was meant — landing on the other side for once.
 */
function coerceQuantity(
  column: ColumnDeclaration,
  offered: unknown,
  beside: unknown,
  units: UnitTable,
): Result<Record<string, StoredValue>, string> {
  const names = quantityColumnNames(column)

  if (isBlank(offered) && isBlank(beside)) {
    if (column.required) return err(`${column.name} is required and was not given.`)
    return ok({ [names.amount]: null, [names.unit]: null })
  }

  const amount = asNumber(offered)
  if (amount === undefined) {
    return err(
      `${column.name} is a quantity: give the figure as a number — ${column.name}: 150 — ` +
        `and what it is in as ${names.unit}.`,
    )
  }
  if (typeof beside !== 'string' || beside.trim() === '') {
    return err(
      `${column.name} needs ${names.unit} as well — a quantity is a figure and what it is in, ` +
        'and the two are stored together because one row of a format is in grams and the next ' +
        'is in millilitres.',
    )
  }

  const symbol = beside.trim()
  if (unitNamed(units, symbol) === undefined) {
    const known = units.map((each) => each.symbol)
    return err(
      `${column.name} is in ${symbol}, which is not a unit this document knows. ` +
        (known.length === 0
          ? 'This document knows none at all; add one, saying what it measures.'
          : `It knows ${known.slice(0, 12).join(', ')}${known.length > 12 ? ' and others' : ''}. ` +
            'A symbol is read exactly as written — mg and Mg are a thousand apart.'),
    )
  }

  return ok({ [names.amount]: amount, [names.unit]: symbol })
}

function coerceMoney(
  column: ColumnDeclaration,
  offered: unknown,
  currency: unknown,
): Result<Record<string, StoredValue>, string> {
  const names = moneyColumnNames(column)

  if (isBlank(offered) && isBlank(currency)) {
    if (column.required) return err(`${column.name} is required and was not given.`)
    return ok({ [names.minor]: null, [names.currency]: null })
  }

  const amount = asNumber(offered)
  if (amount === undefined) {
    return err(
      `${column.name} is money: give the amount in major units as a number — ` +
        `${column.name}: 12.90 — and its currency as ${names.currency}.`,
    )
  }
  // The code, from the picker or typed (M29 F3, D-344); a sign such as `$` is
  // refused by naming the codes it could be.
  const parsed = typeof currency === 'string' && !isBlank(currency) ? parseCurrency(currency) : undefined
  if (parsed === undefined || !parsed.ok) {
    return err(
      `${column.name} needs ${names.currency} as a three-letter code such as ILS. ` +
        (parsed?.error.includes('the sign of') === true ? `${parsed.error} ` : '') +
        'A currency is stored per row because one thing bought here and one bought abroad ' +
        'are two rows of one format.',
    )
  }

  const code: CurrencyCode = parsed.value
  // The one float boundary on this path, called once, at the edge, on a number
  // that came from outside — which is exactly what `fromMajorUnits` documents
  // itself as being for.
  const value: Money = fromMajorUnits(amount, code)
  return ok({ [names.minor]: value.minor, [names.currency]: code })
}

/** `undefined`, `null` and the empty string all mean "nothing was given". */
function isBlank(offered: unknown): boolean {
  return (
    offered === undefined ||
    offered === null ||
    (typeof offered === 'string' && offered.trim() === '')
  )
}

/** A number, or a string that is exactly one. See the head of this file. */
function asNumber(offered: unknown): number | undefined {
  if (typeof offered === 'number') return Number.isFinite(offered) ? offered : undefined
  if (typeof offered !== 'string') return undefined
  const trimmed = offered.trim()
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) return undefined
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : undefined
}

function asBoolean(offered: unknown): boolean | undefined {
  if (typeof offered === 'boolean') return offered
  if (typeof offered === 'number') {
    if (offered === 1) return true
    if (offered === 0) return false
    return undefined
  }
  if (typeof offered !== 'string') return undefined
  const word = offered.trim().toLowerCase()
  if (['true', 'yes', '1'].includes(word)) return true
  if (['false', 'no', '0'].includes(word)) return false
  return undefined
}

/** What was actually sent, for a message somebody has to act on. */
function describeOffered(offered: unknown): string {
  if (offered === null) return 'null'
  if (Array.isArray(offered)) return 'a list'
  if (typeof offered === 'object') return 'an object'
  if (typeof offered === 'string') return `the text "${offered}"`
  return `${typeof offered} ${String(offered)}`
}

/** Re-exported so a caller naming a row's cells needs one import. */

/**
 * The links in a row that name a row that is not there (U4b, D-224).
 *
 * **A predicate rather than a database**, because `src/domain/` imports no
 * sql.js and this is the layer that knows what a link *means*. The repository
 * supplies the looking-up; what is decided here is that a dangling link is a
 * refusal with the column and the id in it, rather than a row written and a
 * join that silently returns nothing for the rest of its life.
 *
 * It is separate from `coerceValue` for the reason D-138 keeps giving: the
 * coercion proves the shape of a value and nothing else, and a function that
 * quietly grew a second kind of check would be reporting one thing while having
 * verified another.
 */
export function missingTargets(
  declaration: FormatDeclaration,
  cells: Readonly<Record<string, StoredValue>>,
  exists: (format: string, id: string) => boolean,
  namedBy: (format: string) => NamingColumn | undefined = () => undefined,
  /**
   * The rows a name is held by, and the parent it was looked for within
   * (M48 U1) — so a name two rows share is refused naming both, and a name
   * looked for in one course says which.
   */
  heldBy: (format: string, name: string) => NameHolders = () => ({ holders: [], within: undefined }),
): readonly string[] {
  const problems: string[] = []
  for (const column of declaration.columns) {
    if (!isLinkType(column.type) || column.target === undefined) continue
    for (const id of idsIn(cells[column.name])) {
      if (!exists(column.target, id)) {
        const naming = namedBy(column.target)
        const held = naming === undefined ? undefined : heldBy(column.target, id)
        problems.push(
          `${column.name} points at ${column.target} "${id}". ${
            held !== undefined && held.holders.length > 1
              ? heldByMany(column.target, naming?.name ?? 'name', held)
              : held?.within !== undefined
                ? `${column.target} has no row with that id, and none of ${held.within.label} with that ${naming?.name ?? 'name'}. \`format_rows\` on ${column.target} lists what it does have.`
                : notFound(column.target, naming)
          }`,
        )
      }
    }
  }
  return problems
}

/** Who holds a name, and the parent it was looked for within, if one (M48 U1). */
export interface NameHolders {
  readonly holders: readonly string[]
  readonly within: { readonly column: string; readonly label: string } | undefined
}

function heldByMany(target: string, naming: string, held: NameHolders): string {
  const some = held.holders.length > 5 ? 'More than five' : String(held.holders.length)
  const where = held.within === undefined ? '' : ` of ${held.within.label}`
  return (
    `${some} ${target} rows${where} have that ${naming}: ${held.holders.slice(0, 5).join(', ')}. ` +
    `They are told apart by one more column — {"${naming}": "…", "<column>": "…"} — or by the id.`
  )
}

/**
 * The row constraints this row breaks, one sentence each (M24 U7, D-259).
 *
 * `cells` is the whole row as it would be stored — for an edit, the row as it
 * stands with the edit laid over it, since a constraint is about two columns
 * and an edit may name one. The same logic the reconciler's triggers compile,
 * so a dry run refuses exactly what the write would, and names the rule.
 */
export function brokenConstraints(
  declaration: FormatDeclaration,
  cells: Readonly<Record<string, StoredValue>>,
): readonly string[] {
  return [
    ...(declaration.constraints ?? [])
      .filter(
        (each) => !constraintHolds(each, (name) => scalarOf(cells[figureColumnOf(declaration, name)])),
      )
      .map((each) => `This row breaks "${constraintText(each)}".`),
    // A rule's pattern (D-273): empty, too long, or a regex that will not
    // compile is refused at its write rather than matching nothing forever.
    ...rulePatternProblems(declaration.ruleSets ?? [], cells),
  ]
}

/**
 * The column a format's rows are called by, and whether a write may name a row
 * with it (M24 U5, D-256). Only a `unique` one may: a name two rows share is
 * not a name, and a link resolved to the first of them is a guess stored.
 */
export interface NamingColumn {
  readonly name: string
  readonly unique: boolean
}

/**
 * The second half of a dangling link's sentence — what was looked for, and
 * what would have been taken. A caller that wrote a name into a format whose
 * naming column is not unique needs to hear why the name was not read, not
 * that an id it never sent is missing.
 */
function notFound(target: string, naming: NamingColumn | undefined): string {
  const listing = `\`format_rows\` on ${target} lists what it does have.`
  if (naming === undefined) return `${target} has no row with that id. ${listing}`
  if (naming.unique) return `${target} has no row with that id or that ${naming.name}. ${listing}`
  return (
    `${target} has no row with that id, and not exactly one with that ${naming.name}. Two rows ` +
    `sharing a ${naming.name} are told apart by one more column: {"${naming.name}": "…", "<column>": "…"}. ${listing}`
  )
}

/**
 * **A refusal in a screen's words** (M33 U2). The sentences above are written
 * for a conversation, which writes a row as keys — `total_currency`, `{"name":
 * "…"}` — and is told which tool lists what exists. A person on a sheet typed
 * into a cell beside a currency and picked a row from a list; the same refusal,
 * in those words. **The same check and the same reason**: only the phrasing of
 * what to send changes, so the two can never disagree about whether a row is
 * written (D-217).
 */
export function screenWords(reason: string, declaration: FormatDeclaration): string {
  let said = reason
  for (const column of declaration.columns) {
    const name = column.name
    if (column.type === 'money') {
      const names = moneyColumnNames(column)
      said = said
        .replace(
          `${name} is money: give the amount in major units as a number — ${name}: 12.90 — and its currency as ${names.currency}.`,
          `${name} is money: an amount such as 12.90, in the currency beside it.`,
        )
        .replace(`${name} needs ${names.currency} as a three-letter code`, `${name} needs its currency, a three-letter code`)
    } else if (column.type === 'quantity') {
      const names = quantityColumnNames(column)
      said = said
        .replace(
          `${name} is a quantity: give the figure as a number — ${name}: 150 — and what it is in as ${names.unit}.`,
          `${name} is a quantity: a figure such as 150, in the unit beside it.`,
        )
        .replace(`${name} needs ${names.unit} as well`, `${name} needs its unit as well`)
    }
  }
  // A link that found nothing: the row is picked from a list on a screen, so
  // what was not found is a name, and an id or a second column is no help.
  said = said.replace(
    /(\S+) points at (\S+) "([^"]*)"\. \2 has no row with that id[^.]*\.(?: Two rows sharing [^.]*\.)?/g,
    (_, column: string, target: string, typed: string) => `${column}: no ${target} is called "${typed}". Pick one from the list.`,
  )
  return said
    .replace(/ ?`format_rows` on \S+ lists what it does have\./g, '')
    .replace(/: \{"[^}]*\}\./g, '.')
}

/* ------------------------------------------------------- what has to hold */

/** One identity's answer about one row (U3, D-222). */
export interface RowVerdict {
  readonly identity: IdentityDeclaration
  readonly verdict: Verdict
}

/**
 * One row, as numbers an identity can be put through.
 *
 * **A money column enters as its minor units**, with its currency beside it so
 * that two currencies meeting in one sum can be refused rather than added
 * (`identity.ts` argues it). Everything that is not a number this build can do
 * arithmetic on is simply absent, and an identity naming an absent column comes
 * back `unchecked` — which is the honest answer and not a failure.
 */
export function identityInputsOf(
  declaration: FormatDeclaration,
  row: StoredRow,
): IdentityInputs {
  const numbers = new Map<string, number>()
  const currencies = new Map<string, string>()
  // What each figure is *in* — **from the declaration for eight types and from
  // the row for the ninth** (U4a, D-223; U4c, D-225). A unit declared on a
  // column is read once from the declaration and never from a cell, which is
  // why a unit change is the reconciler's most dangerous refusal: nothing in
  // the table records that the meaning moved. A `quantity` is the exception the
  // type exists to be — the cell beside it says, every row for itself, and
  // there is nothing to re-mean.
  const units = new Map<string, string>()
  // The other half of a ratio column, read only where an expression bridges
  // through it. From the declaration always: what a density is *per* is a fact
  // about the column, not about the row.
  const per = new Map<string, string>()
  // What an aggregate's filter asks of the row (M24 U8, D-260) — never a figure.
  const members = new Map<string, string>()
  // A decimal's and a percent's figure as the fraction it is (M29 U3, D-333);
  // a whole number needs no entry, because its double already is exact.
  const exact = new Map<string, Fraction>()
  // Each date, time and instant as where it falls — never a figure, only ever
  // one side of `end - start` (M29 U4, D-335).
  const points = new Map<string, Point>()
  // Every column that holds something, for `is empty` (M36 U04).
  const filled = new Set<string>()
  for (const column of declaration.columns) {
    if (isFilled(column, row)) filled.add(column.name)
    if (column.unit !== undefined) units.set(column.name, column.unit)
    if (column.per !== undefined) per.set(column.name, column.per)
    if (isPointType(column.type)) {
      const ordinal = pointOrdinal(column.type, row.cells[column.name])
      if (ordinal !== undefined) points.set(column.name, { type: column.type, ordinal })
      continue
    }
    const member = memberOf(column, row)
    if (member !== undefined) {
      members.set(column.name, member)
      continue
    }
    // A decimal enters as the figure it is, not as its stored integer (M24 U6,
    // D-257), and a percent as its fraction — 12.5% is 0.125 — because that is
    // what `price * (1 + vat)` means (M29 U3, D-333). Both exactly as well,
    // beside the double, so a money identity lands on the agora it should
    // rather than a hair beside it.
    if (column.type === 'decimal' || column.type === 'percent') {
      const figure = scaledFigureOf(column, row.cells[column.name])
      if (figure !== undefined) {
        numbers.set(column.name, figure.value)
        exact.set(column.name, figure.exact)
      }
      continue
    }
    const value = readValue(column, row)
    if (typeof value === 'number') {
      numbers.set(column.name, value)
      continue
    }
    if (typeof value === 'object' && value !== null && 'minor' in value) {
      numbers.set(column.name, value.minor)
      currencies.set(column.name, value.currency)
      continue
    }
    if (typeof value === 'object' && value !== null && 'amount' in value) {
      numbers.set(column.name, value.amount)
      units.set(column.name, value.unit)
    }
  }
  return { numbers, currencies, units, per, members, exact, points, filled }
}

/** Whether a row's column holds anything — what `is empty` asks (M36 U04). */
export function isFilled(column: ColumnDeclaration, row: StoredRow): boolean {
  const value = readValue(column, row)
  return value !== undefined && value !== ''
}

/**
 * A `decimal` or `percent` cell as an identity reads it — the double, and the
 * exact fraction beside it (M29 U3, D-333). Nothing for any other type, an
 * empty cell, or a cell that is not the whole number it should be.
 */
export function scaledFigureOf(
  column: ColumnDeclaration,
  cell: unknown,
): { readonly value: number; readonly exact: Fraction } | undefined {
  if (typeof cell !== 'number' || !Number.isSafeInteger(cell)) return undefined
  if (column.type === 'percent') {
    return { value: percentValue(cell), exact: { n: BigInt(cell), d: BigInt(PERCENT_DENOMINATOR) } }
  }
  if (column.type !== 'decimal') return undefined
  const scale = column.scale ?? 0
  return { value: decimalValue(cell, scale), exact: { n: BigInt(cell), d: 10n ** BigInt(scale) } }
}

/**
 * An `enum` or `boolean` cell as a filter compares it — the member, or `true`
 * / `false` — and nothing for an empty cell or any other type (M24 U8).
 */
export function memberOf(column: ColumnDeclaration, row: StoredRow): string | undefined {
  if (column.type !== 'enum' && column.type !== 'boolean') return undefined
  const value = readValue(column, row)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Every identity this format declares, judged against one row.
 *
 * **Computed on read and never stored.** A stored verdict is a fact about a
 * declaration that has since changed — the exact disease the vault suffered,
 * where a table of totals was computed once by a model and frozen into prose
 * while its inputs moved underneath it (D-210). Recomputing costs a polynomial
 * over one row, and the answer is therefore about the declaration as it is now.
 */
export function verdictsOf(
  declaration: FormatDeclaration,
  row: StoredRow,
  units: UnitTable = SEEDED_UNITS,
): readonly RowVerdict[] {
  const inputs = identityInputsOf(declaration, row)
  return declaration.identities.map((identity) => ({
    identity,
    verdict: evaluateIdentity(identity, inputs, units),
  }))
}

/** How many rows proved, failed and could not be checked. */
export interface Tally {
  readonly proved: number
  readonly failed: number
  readonly unchecked: number
}

/**
 * One tally over many rows and every identity.
 *
 * **A row counts once, at its worst**: a row with a failed identity is a failed
 * row whatever else holds, and a row with nothing to fail on but something
 * unchecked is unchecked. Summing the identities instead would report nine
 * proofs over three rows and hide that one of the three is wrong — which is
 * D-138 in a counter, and D-138 is what this whole unit exists to serve.
 */
export function tally(
  declaration: FormatDeclaration,
  rows: readonly StoredRow[],
  units: UnitTable = SEEDED_UNITS,
): Tally {
  let proved = 0
  let failed = 0
  let unchecked = 0
  for (const row of rows) {
    const verdicts = verdictsOf(declaration, row, units)
    if (verdicts.length === 0) continue
    if (verdicts.some((each) => each.verdict.kind === 'FAILED')) failed += 1
    else if (verdicts.some((each) => each.verdict.kind === 'UNCHECKED')) unchecked += 1
    else proved += 1
  }
  return { proved, failed, unchecked }
}

/** Re-exported so a caller needs one import to name a declared table's columns. */
export { storedColumnsOf }
