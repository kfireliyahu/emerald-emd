import type { LocalDate } from '@/core/time.ts'

/**
 * Today, as the calendar day it is here.
 *
 * The clock is read in the UI and never in `domain/`: every function there
 * takes the date it needs as an argument, which is what makes "a slip entered
 * on 1 January defaults to December" a test rather than a thing that is true
 * for eleven months of the year.
 *
 * Local parts, not UTC. A `LocalDate` is a calendar fact with no timezone
 * (D-023), and `getFullYear`/`getMonth`/`getDate` are the reading that agrees
 * with the calendar on the user's wall.
 */
export function today(): LocalDate {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }
}
