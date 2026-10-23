/**
 * **Today in questions, never in claims** — M49 U2, D-472.
 *
 * A planner's *what is due in the next fortnight?* and *what is
 * overdue?* are questions about today, and so is *days left*. A question may
 * read the clock: **a filter** (`due is within 14 days`, `due is before
 * today`, `due is after today`, `due is today`), **a view's sort**, and **a
 * computed column shown on a screen or in `format_rows`** (`days_left = due -
 * today`). A claim may not: **an identity, a declared total (which a claim
 * reads), a rule set (which writes what it decides) and the stored view** are
 * refused with `CLOCK_REASON`. A proof that held yesterday must not fail
 * tomorrow with nothing changed — that is a document lying about itself.
 *
 * **Nothing here reads the clock.** Today arrives as `YYYY-MM-DD`, from the
 * one runtime that asked — the app's `ui/today.ts` or the plugin's
 * `plugin/today.ts` (S-064's twins, both the local calendar day, D-023) — so a
 * test pins it by handing one in, and the two halves cannot disagree about
 * which rows a filter names.
 *
 * **The words around today grew in M53 F6** (D-528): `yesterday`, `tomorrow`,
 * `last 7 days` (today and the six days before it — `within`'s backward
 * twin), and the calendar's periods, `this|last|next week|month|year`. Which
 * day a week starts on is the document's (`document_setting`, beside its
 * currency), never the machine's, so two runtimes name the same rows; Monday
 * when a document says nothing.
 */

import type { Expression } from './identity.ts'
import { dateOfOrdinal, DAY_WORDS, pointOrdinal } from './span.ts'

/** The word an expression and a filter name the clock by. */
export const TODAY = 'today'

/** A day of the week, as ISO numbers it: 1 is Monday, 7 is Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

/** The day a week starts on when a document has not said (D-528): ISO's. */
export const MONDAY: Weekday = 1

/** The days of the week as a document's setting spells them, Monday first. */
export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const

/** `sunday`, `Monday` — a day of the week, or nothing when the word is not one. */
export function parseWeekday(text: string): Weekday | undefined {
  const at = (WEEKDAYS as readonly string[]).indexOf(text.trim().toLowerCase())
  return at < 0 ? undefined : ((at + 1) as Weekday)
}

/** A day of the week as a setting spells it: `monday`. */
export function weekdayText(day: Weekday): string {
  return WEEKDAYS[day - 1] ?? 'monday'
}

/** A calendar period a window names: a week, a month, a year. */
export type Period = 'week' | 'month' | 'year'

/** Which days a clock filter takes, before today is known. */
export type ClockWindow =
  /** `within 14 days`, `within 2 weeks`: today through that many days on, both ends taken. */
  | { readonly kind: 'WITHIN'; readonly days: number }
  /** `last 7 days`, `last 2 weeks`: today and the days before it, that many in all (D-528). */
  | { readonly kind: 'LAST'; readonly days: number }
  /** `before today` — overdue: strictly earlier. */
  | { readonly kind: 'BEFORE' }
  /** `after today` — strictly later. */
  | { readonly kind: 'AFTER' }
  /** `today`. */
  | { readonly kind: 'TODAY' }
  /** `yesterday`. */
  | { readonly kind: 'YESTERDAY' }
  /** `tomorrow`. */
  | { readonly kind: 'TOMORROW' }
  /** `this week`, `last month`, `next year` — the calendar's period holding today, or the one either side (D-528). */
  | { readonly kind: 'PERIOD'; readonly period: Period; readonly offset: -1 | 0 | 1 }

/** The days a window takes once today is known, both ends included, `YYYY-MM-DD`. */
export interface DateRange {
  readonly from?: string | undefined
  readonly through?: string | undefined
}

/** Why a claim may not name today — the one sentence every refusal ends with. */
export const CLOCK_REASON =
  'a claim may not read the clock: a proof that held yesterday must not fail tomorrow with nothing changed. Ask it as a question — a filter, `due is before today`, or a computed column, `days_left = due - today`'

/** The periods' offsets as a window says them. */
const OFFSETS: Readonly<Record<string, -1 | 0 | 1>> = { last: -1, this: 0, next: 1 }

/**
 * `within 14 days`, `before today`, `this week`… — what follows a filter's
 * `is`, or a `match` value, read as a window — or nothing when it is not one. A
 * count is whole, in D-471's words (`day`, `days`, `week`, `weeks`), and
 * `last 0 days` names nothing, so it is not one.
 */
export function parseClockWords(text: string): ClockWindow | undefined {
  const said = text.trim().replace(/\s+/g, ' ').toLowerCase()
  if (said === 'before today') return { kind: 'BEFORE' }
  if (said === 'after today') return { kind: 'AFTER' }
  if (said === TODAY) return { kind: 'TODAY' }
  if (said === 'yesterday') return { kind: 'YESTERDAY' }
  if (said === 'tomorrow') return { kind: 'TOMORROW' }
  const period = /^(last|this|next) (week|month|year)$/.exec(said)
  if (period !== null) return { kind: 'PERIOD', period: period[2] as Period, offset: OFFSETS[period[1] ?? ''] ?? 0 }
  const counted = /^(within|last) (\d+) ([a-z]+)$/.exec(said)
  if (counted === null) return undefined
  const per = DAY_WORDS[counted[3] ?? '']
  if (per === undefined) return undefined
  const days = Number(counted[2]) * per
  if (counted[1] === 'within') return { kind: 'WITHIN', days }
  return days === 0 ? undefined : { kind: 'LAST', days }
}

/** Whether a phrase starts like a window but is not one — `within 1 month`, `last 3 months`, `this quarter`. */
export function looksLikeClock(text: string): boolean {
  const said = text.trim().toLowerCase()
  return /^(within|last|this|next) /.test(said) || said.endsWith(' today')
}

/**
 * **The words a date's filter menu offers** (M53 F6, D-528), in the order it
 * lists them, written exactly as a conversation types them — the band says
 * them back the same, and a view saved from the menu keeps them.
 */
export const OFFERED_WORDS: readonly string[] = [
  'today',
  'yesterday',
  'tomorrow',
  'this week',
  'last week',
  'next week',
  'this month',
  'last month',
  'next month',
  'this year',
  'last year',
  'next year',
  'before today',
  'after today',
  'last 7 days',
  'within 7 days',
  'last 30 days',
  'within 30 days',
]

/** The window as it is written back. */
export function clockText(window: ClockWindow): string {
  switch (window.kind) {
    case 'WITHIN':
    case 'LAST':
      return `${window.kind === 'WITHIN' ? 'within' : 'last'} ${String(window.days)} ${window.days === 1 ? 'day' : 'days'}`
    case 'BEFORE':
      return 'before today'
    case 'AFTER':
      return 'after today'
    case 'TODAY':
      return TODAY
    case 'YESTERDAY':
      return 'yesterday'
    case 'TOMORROW':
      return 'tomorrow'
    case 'PERIOD':
      return `${window.offset < 0 ? 'last' : window.offset > 0 ? 'next' : 'this'} ${window.period}`
  }
}

/** The ISO day of the week a day's ordinal falls on — 1970-01-01, ordinal nought, was a Thursday. */
function weekdayOf(day: number): Weekday {
  return ((((day + 3) % 7) + 7) % 7 + 1) as Weekday
}

/**
 * The days a window takes, today being `today` (`YYYY-MM-DD`), a week starting
 * on `weekStart` (the document's, Monday when it says nothing); nothing when
 * today is not a date. A period is the local calendar's, as `today` is.
 */
export function clockRange(window: ClockWindow, today: string, weekStart: Weekday = MONDAY): DateRange | undefined {
  const day = pointOrdinal('date', today)
  if (day === undefined) return undefined
  switch (window.kind) {
    case 'WITHIN':
      return { from: today, through: dateOfOrdinal(day + window.days) }
    case 'LAST':
      return { from: dateOfOrdinal(day - window.days + 1), through: today }
    case 'YESTERDAY': {
      const yesterday = dateOfOrdinal(day - 1)
      return { from: yesterday, through: yesterday }
    }
    case 'TOMORROW': {
      const tomorrow = dateOfOrdinal(day + 1)
      return { from: tomorrow, through: tomorrow }
    }
    case 'PERIOD':
      return periodRange(window.period, window.offset, today, day, weekStart)
    case 'BEFORE':
      return { through: dateOfOrdinal(day - 1) }
    case 'AFTER':
      return { from: dateOfOrdinal(day + 1) }
    case 'TODAY':
      return { from: today, through: today }
  }
}

/** The calendar week, month or year holding today, or the one either side of it. */
function periodRange(period: Period, offset: -1 | 0 | 1, today: string, day: number, weekStart: Weekday): DateRange {
  if (period === 'week') {
    const first = day - ((weekdayOf(day) - weekStart + 7) % 7) + offset * 7
    return { from: dateOfOrdinal(first), through: dateOfOrdinal(first + 6) }
  }
  const year = Number(today.slice(0, 4))
  if (period === 'year') return { from: `${pad4(year + offset)}-01-01`, through: `${pad4(year + offset)}-12-31` }
  // A month: its first day, and the day before the next one's first.
  const index = year * 12 + Number(today.slice(5, 7)) - 1 + offset
  const first = (at: number): string => `${pad4(Math.floor(at / 12))}-${String((at % 12) + 1).padStart(2, '0')}-01`
  const next = pointOrdinal('date', first(index + 1)) ?? 0
  return { from: first(index), through: dateOfOrdinal(next - 1) }
}

function pad4(year: number): string {
  return String(year).padStart(4, '0')
}

/** A range as SQL over `sql`, a `YYYY-MM-DD` cell, with its bindings; `NULL` falls nowhere. */
export function rangeSql(sql: string, range: DateRange): { readonly sql: string; readonly bindings: readonly string[] } {
  const parts: string[] = []
  const bindings: string[] = []
  if (range.from !== undefined) {
    parts.push(`${sql} >= ?`)
    bindings.push(range.from)
  }
  if (range.through !== undefined) {
    parts.push(`${sql} <= ?`)
    bindings.push(range.through)
  }
  return { sql: parts.length === 0 ? `${sql} IS NOT NULL` : `(${parts.join(' AND ')})`, bindings }
}

/** Whether an expression reads the day it is asked on. */
export function namesToday(expression: Expression): boolean {
  switch (expression.kind) {
    case 'NUMBER':
    case 'DAYS':
      return false
    case 'COLUMN':
      return expression.name === TODAY
    case 'NEGATE':
    case 'IN':
      return namesToday(expression.of)
    default:
      return namesToday(expression.left) || namesToday(expression.right)
  }
}
