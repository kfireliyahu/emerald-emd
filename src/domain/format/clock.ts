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
 */

import type { Expression } from './identity.ts'
import { dateOfOrdinal, DAY_WORDS, pointOrdinal } from './span.ts'

/** The word an expression and a filter name the clock by. */
export const TODAY = 'today'

/** Which days a clock filter takes, before today is known. */
export type ClockWindow =
  /** `within 14 days`, `within 2 weeks`: today through that many days on, both ends taken. */
  | { readonly kind: 'WITHIN'; readonly days: number }
  /** `before today` — overdue: strictly earlier. */
  | { readonly kind: 'BEFORE' }
  /** `after today` — strictly later. */
  | { readonly kind: 'AFTER' }
  /** `today`. */
  | { readonly kind: 'TODAY' }

/** The days a window takes once today is known, both ends included, `YYYY-MM-DD`. */
export interface DateRange {
  readonly from?: string | undefined
  readonly through?: string | undefined
}

/** Why a claim may not name today — the one sentence every refusal ends with. */
export const CLOCK_REASON =
  'a claim may not read the clock: a proof that held yesterday must not fail tomorrow with nothing changed. Ask it as a question — a filter, `due is before today`, or a computed column, `days_left = due - today`'

/**
 * `within 14 days`, `before today`… — what follows a filter's `is`, or a
 * `match` value, read as a window — or nothing when it is not one. A count is
 * whole, in D-471's words (`day`, `days`, `week`, `weeks`).
 */
export function parseClockWords(text: string): ClockWindow | undefined {
  const said = text.trim().replace(/\s+/g, ' ').toLowerCase()
  if (said === 'before today') return { kind: 'BEFORE' }
  if (said === 'after today') return { kind: 'AFTER' }
  if (said === TODAY) return { kind: 'TODAY' }
  const within = /^within (\d+) ([a-z]+)$/.exec(said)
  if (within === null) return undefined
  const per = DAY_WORDS[within[2] ?? '']
  if (per === undefined) return undefined
  return { kind: 'WITHIN', days: Number(within[1]) * per }
}

/** Whether a phrase starts like a window but is not one — `within 1 month`, `within a week`. */
export function looksLikeClock(text: string): boolean {
  const said = text.trim().toLowerCase()
  return said.startsWith('within ') || said.endsWith(' today')
}

/** The window as it is written back. */
export function clockText(window: ClockWindow): string {
  switch (window.kind) {
    case 'WITHIN':
      return `within ${String(window.days)} ${window.days === 1 ? 'day' : 'days'}`
    case 'BEFORE':
      return 'before today'
    case 'AFTER':
      return 'after today'
    case 'TODAY':
      return TODAY
  }
}

/** The days a window takes, today being `today` (`YYYY-MM-DD`); nothing when today is not a date. */
export function clockRange(window: ClockWindow, today: string): DateRange | undefined {
  const day = pointOrdinal('date', today)
  if (day === undefined) return undefined
  switch (window.kind) {
    case 'WITHIN':
      return { from: today, through: dateOfOrdinal(day + window.days) }
    case 'BEFORE':
      return { through: dateOfOrdinal(day - 1) }
    case 'AFTER':
      return { from: dateOfOrdinal(day + 1) }
    case 'TODAY':
      return { from: today, through: today }
  }
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
