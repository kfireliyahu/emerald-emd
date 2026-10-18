/**
 * **A time of day, and the span between two points** — M29 U4,
 * [D-335](../../../docs/09-decision-log.md).
 *
 * A person wanted a start hour and an end hour on a shift and the
 * hours between them, and found no column that held `09:00` or any way to take
 * one from another. So:
 *
 * - **`time`** is a column type: a time of day, `HH:MM`, twenty-four hours,
 *   stored as that text so it sorts as it reads and plain SQL can print it.
 *   Typed plainly — `9`, `9:30`, `0930`, `9.30`, `9:30pm` — and always shown
 *   as `09:30`. Minutes, and no finer: a shift, a dose, an opening hour.
 * - **A date, a time and an instant are points**, not figures. Adding two of
 *   them means nothing, so the one arithmetic every point takes part in is
 *   **`end - start`, two columns of the same point type**, and what comes out
 *   is a duration: a figure in a time unit that converts by D-223's rules and
 *   folds like any other — **hours** for two times or two instants, **days**
 *   for two dates. `hours = end - start` says what the person asked for.
 *
 * ## Overnight, without a conditional
 *
 * A time of day has no date, so `06:00 - 22:00` can only mean the next
 * morning: the span of two times is taken **modulo a day**, always in
 * `[0, 24)` hours. 22:00 to 06:00 is 8 h; 09:00 to 09:00 is 0 h, never 24. It
 * is arithmetic rather than a branch — `((e - s) mod 1440 + 1440) mod 1440`
 * minutes — so the grammar still has no `if`, and SQL and TypeScript say it
 * the same way. A span of a day or more is not something two times can hold;
 * it is two instants, or two dates.
 *
 * ## A date moves by whole days (M49 U1, D-471)
 *
 * `last_reviewed + 7 days`, `start + 2 weeks`, `due - 3 days`: a date and a
 * whole number of days or weeks is a date. It is the one other thing a point
 * takes part in, and only a date: a time of day has no date to move into and an
 * instant has a zone to cross. A month is not here, because a month is not a
 * fixed number of days — `31 Jan + 1 month` has no answer everybody agrees on.
 * The moved date is **the whole of a computed column, or one side of a claim**,
 * or either end of `end - start`; anywhere else it is a point used as a figure.
 * Days are counted on the calendar, so nothing here has a time zone, and in SQL
 * it is `date(d, '+7 days')`, whose empty date is an empty answer.
 *
 * Imports only types, so the declaration, the evaluator and the compiler can
 * all lean on it without a cycle.
 */

import { err, ok, type Result } from '@/core/result.ts'
import type { ColumnType } from './declaration.ts'
import type { Expression } from './identity.ts'

/** The types that are points rather than figures. */
export const POINT_TYPES = ['date', 'time', 'instant'] as const

export type PointType = (typeof POINT_TYPES)[number]

export function isPointType(type: ColumnType | string | undefined): type is PointType {
  return type !== undefined && (POINT_TYPES as readonly string[]).includes(type)
}

/** What the span of two of one point type comes out in. */
export const SPAN_UNITS: Readonly<Record<PointType, string>> = {
  time: 'h',
  instant: 'h',
  date: 'day',
}

/** One point on a row: its type, and where it falls as a whole number. */
export interface Point {
  readonly type: PointType
  /** Minutes since midnight, days since 1970-01-01, or milliseconds since the epoch. */
  readonly ordinal: number
}

const MINUTES_PER_DAY = 1440

/* ------------------------------------------------------------ a time of day */

const TIME_TEXT = /^(\d{1,2})(?:[:.]?(\d{2}))?(?::(\d{2}))?$/
const MERIDIEM = /^(.*?)\s*([ap])\.?\s*m?\.?$/

/**
 * A time of day as a person types it, to the `HH:MM` it is stored as.
 *
 * `9`, `9:30`, `09:30`, `0930`, `9.30`, `21:00`, `9pm`, `9:30 am`, and
 * `09:30:00` from an export (seconds only when they are zero — a time keeps
 * minutes). `24:00` is refused: the end of a day is `00:00`, and the span
 * arithmetic already knows that is after `16:00`.
 */
export function parseTime(offered: string): Result<string, string> {
  const raw = offered.trim().toLowerCase()
  if (raw === '') return err('A time of day was given nothing.')
  const meridiem = MERIDIEM.exec(raw)
  const body = meridiem === null ? raw : (meridiem[1] ?? '')
  const match = TIME_TEXT.exec(body.trim())
  const wrong = `"${offered}" is not a time of day. Write it as 09:30, or 21:00.`
  if (match === null) return err(wrong)
  let hour = Number(match[1])
  const minute = Number(match[2] ?? '0')
  if (match[3] !== undefined && Number(match[3]) !== 0) {
    return err(`"${offered}" has seconds, and a time of day keeps minutes. Write it as ${pad(hour)}:${pad(minute)}.`)
  }
  if (minute > 59) return err(wrong)
  if (meridiem !== null) {
    if (hour < 1 || hour > 12) return err(`"${offered}" — with am or pm the hour is 1 to 12.`)
    hour = (hour % 12) + (meridiem[2] === 'p' ? 12 : 0)
  } else if (hour > 23) {
    return err(
      hour === 24 && minute === 0
        ? `"${offered}" — the end of a day is 00:00, and an end at 00:00 is still after a start the evening before.`
        : wrong,
    )
  }
  return ok(`${pad(hour)}:${pad(minute)}`)
}

/** A fraction of a day — a spreadsheet's time cell — to the nearest minute, as `HH:MM`. */
export function timeOfDayFraction(fraction: number): string | undefined {
  if (!Number.isFinite(fraction) || fraction < 0 || fraction >= 1) return undefined
  const minutes = Math.round(fraction * MINUTES_PER_DAY) % MINUTES_PER_DAY
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

/** Whether a stored cell is a time: `HH:MM`, twenty-four hours. */
export function isStoredTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/* -------------------------------------------------------------- the ordinal */

/** Where a stored point falls, as a whole number — or nothing for an empty or malformed cell. */
export function pointOrdinal(type: PointType, cell: unknown): number | undefined {
  if (typeof cell !== 'string') return undefined
  switch (type) {
    case 'time': {
      if (!isStoredTime(cell)) return undefined
      return Number(cell.slice(0, 2)) * 60 + Number(cell.slice(3, 5))
    }
    case 'date': {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cell)
      if (match === null) return undefined
      return daysFromCivil(Number(match[1]), Number(match[2]), Number(match[3]))
    }
    case 'instant': {
      const at = Date.parse(cell)
      return Number.isFinite(at) ? at : undefined
    }
  }
}

/** A stored date, `YYYY-MM-DD`, for a number of days since 1970-01-01 — `pointOrdinal`'s inverse. */
export function dateOfOrdinal(days: number): string {
  // Howard Hinnant's `civil_from_days`, as `daysFromCivil` is his inverse.
  const z = days + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1
  const month = mp < 10 ? mp + 3 : mp - 9
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0)
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`
}

/**
 * Days since 1970-01-01 for a proleptic Gregorian date — Howard Hinnant's
 * `days_from_civil`, integer arithmetic only, so no `Date` and no time zone
 * comes near a date-only value (D-023).
 */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

/* ----------------------------------------------------------------- the span */

/**
 * `end - start` for two points of one type, exactly: a whole number over the
 * denominator that makes it hours or days. Two times wrap at midnight.
 */
export function spanBetween(type: PointType, end: number, start: number): { readonly n: bigint; readonly d: bigint } {
  switch (type) {
    case 'time':
      return { n: BigInt((((end - start) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY), d: 60n }
    case 'date':
      return { n: BigInt(end - start), d: 1n }
    case 'instant':
      return { n: BigInt(end - start), d: 3_600_000n }
  }
}

/** The words a count of days is said in, after a number — `7 days`, `2 weeks` (D-471). */
export const DAY_WORDS: Readonly<Record<string, number>> = { day: 1, days: 1, week: 7, weeks: 7 }

/**
 * A column moved by whole days, when that is what an expression is: the column,
 * how many days, and whether anything moved it at all. `start` is `start` by
 * nought; `start + 2 weeks - 3 days` is `start` by eleven. **Only a count on
 * the right of a `-`**: `7 days - start` is not a date.
 */
export function shiftedPoint(
  expression: Expression,
): { readonly name: string; readonly days: number; readonly moved: boolean } | undefined {
  switch (expression.kind) {
    case 'COLUMN':
      return { name: expression.name, days: 0, moved: false }
    case 'ADD':
    case 'SUBTRACT': {
      const sign = expression.kind === 'ADD' ? 1 : -1
      if (expression.right.kind === 'DAYS') {
        const of = shiftedPoint(expression.left)
        return of === undefined ? undefined : { name: of.name, days: of.days + sign * expression.right.days, moved: true }
      }
      if (expression.kind === 'ADD' && expression.left.kind === 'DAYS') {
        const of = shiftedPoint(expression.right)
        return of === undefined ? undefined : { name: of.name, days: of.days + expression.left.days, moved: true }
      }
      return undefined
    }
    default:
      return undefined
  }
}

/**
 * `end - start`, when that is what an expression is: two columns, one taken
 * from the other — **either moved by whole days** (D-471), `due - (start + 7
 * days)`, which is the span plus the days between the moves (`days`).
 */
export function spanPair(
  expression: Expression,
): { readonly end: string; readonly start: string; readonly days: number; readonly moved: boolean } | undefined {
  if (expression.kind !== 'SUBTRACT' || expression.right.kind === 'DAYS') return undefined
  const end = shiftedPoint(expression.left)
  const start = shiftedPoint(expression.right)
  if (end === undefined || start === undefined) return undefined
  return { end: end.name, start: start.name, days: end.days - start.days, moved: end.moved || start.moved }
}

/** The sentence for a time or an instant moved by days. */
export function movedPointProblem(name: string, type: PointType): string {
  return `${name} is ${aType(type)}, and only a date moves by whole days — ${type === 'time' ? 'a time of day has no date to move into' : 'an instant crosses a time zone on its way'}.`
}

/** `a time`, `an instant` — a type named in a sentence. */
export function aType(type: string): string {
  return `${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type}`
}

/** The sentence for a point used as a figure. */
export function lonePointProblem(name: string, type: PointType): string {
  const span = `\`end - ${name}\`, which comes out in ${SPAN_UNITS[type] === 'h' ? 'hours' : 'days'}`
  if (type === 'date') {
    return `${name} is a date — a point, not an amount — and a date takes part in two things: one taken from another, ${span}; and moving by whole days, \`${name} + 7 days\`, as the whole of a computed column or one side of a claim.`
  }
  return `${name} is ${aType(type)} — a point, not an amount — and the only arithmetic ${aType(type)} takes part in is one taken from another: ${span}.`
}

/** The sentence for two points of different kinds taken one from the other. */
export function mixedSpanProblem(end: string, start: string, endType: string, startType: string): string {
  return `${end} - ${start} takes ${aType(startType)} from ${aType(endType)}. A span is between two of one kind — two times, two dates or two instants.`
}

/**
 * Whether an expression uses its points rightly: every date, time or instant
 * it names is one side of `end - start` with another of the same type, and
 * nothing else. `typeOf` answers for a name, including a hop.
 */
export function pointProblem(
  expression: Expression,
  typeOf: (name: string) => ColumnType | undefined,
): string | undefined {
  switch (expression.kind) {
    case 'NUMBER':
    case 'DAYS':
      return undefined
    case 'COLUMN': {
      const type = typeOf(expression.name)
      return isPointType(type) ? lonePointProblem(expression.name, type) : undefined
    }
    case 'NEGATE':
    case 'IN':
      return pointProblem(expression.of, typeOf)
    default: {
      const pair = spanPair(expression)
      if (pair !== undefined) {
        const end = typeOf(pair.end)
        const start = typeOf(pair.start)
        if (isPointType(end) || isPointType(start)) {
          if (end !== start) return mixedSpanProblem(pair.end, pair.start, end ?? 'figure', start ?? 'figure')
          if (pair.moved && isPointType(end) && end !== 'date') return movedPointProblem(pair.end, end)
          return undefined
        }
      }
      return pointProblem(expression.left, typeOf) ?? pointProblem(expression.right, typeOf)
    }
  }
}

/**
 * A side that is a point — a column of one, moved by whole days or not — or
 * nothing; with the problem when it is moved and not a date (D-471).
 */
export function pointSide(
  expression: Expression,
  typeOf: (name: string) => ColumnType | undefined,
):
  | { readonly name: string; readonly type: PointType; readonly days: number; readonly problem?: string }
  | undefined {
  const point = shiftedPoint(expression)
  const type = point === undefined ? undefined : typeOf(point.name)
  if (point === undefined || !isPointType(type)) return undefined
  return {
    name: point.name,
    type,
    days: point.days,
    ...(point.moved && type !== 'date' ? { problem: movedPointProblem(point.name, type) } : {}),
  }
}

/**
 * Whether a claim uses its points rightly (D-471): **a point on one side wants
 * a point of its kind on the other** — `next_review = last_reviewed + 7 days`
 * holds two dates — and a side that is a figure is judged by `pointProblem`.
 */
export function equationPointProblem(
  left: Expression,
  right: Expression,
  typeOf: (name: string) => ColumnType | undefined,
): string | undefined {
  const l = pointSide(left, typeOf)
  const r = pointSide(right, typeOf)
  if (l === undefined && r === undefined) return pointProblem(left, typeOf) ?? pointProblem(right, typeOf)
  if (l?.problem !== undefined) return l.problem
  if (r?.problem !== undefined) return r.problem
  if (l === undefined || r === undefined) {
    const one = l ?? r
    if (one === undefined) return undefined
    const lone = lonePointProblem(one.name, one.type)
    return one.type === 'date' ? `${lone} A claim about a date holds a date on each side.` : lone
  }
  if (l.type !== r.type) {
    return `One side is ${aType(l.type)} — ${l.name} — and the other ${aType(r.type)} — ${r.name}. A claim holds two of one kind.`
  }
  return undefined
}
