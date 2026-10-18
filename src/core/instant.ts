import { toISODate, type LocalDate } from './time.ts'

/**
 * An instant as the calendar day it fell on here, ISO like every other date on
 * screen.
 *
 * `toLocaleDateString` would render 10 August 2026 as "8/10/2026" for a user
 * whose statements are all `dd/mm/yyyy` — the one ambiguity this domain cannot
 * afford. Kept in one place so the two screens that show a stored instant
 * cannot drift into disagreeing about it.
 *
 * Only for instants (`last_used_at`, `committed_at`). A `LocalDate` is already
 * a calendar fact and goes through `toISODate` instead; see D-023 for why the
 * two are not the same type.
 */
export function instantDay(instant: number): string {
  return toISODate(instantDate(instant))
}

/** The calendar day an instant fell on here: local parts, not UTC (D-023). */
export function instantDate(instant: number): LocalDate {
  const date = new Date(instant)
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }
}
