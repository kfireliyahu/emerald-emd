import type { LocalDate } from '@/core/time.ts'

/**
 * Today, as the calendar day it is here.
 *
 * A deliberate twin of `src/ui/today.ts`, not an import of it. The clock is
 * read at the edge and never in `domain/` — every function there takes the date
 * it needs as an argument, which is what makes "a summary asked for in August
 * defaults to August" a test rather than something that is true for one month
 * at a time. The app's edge is the UI; the plugin's edge is here.
 *
 * Importing the UI's copy would make `src/plugin/` depend on `src/ui/`, which
 * is React, and moving it down into `core/` would put an impure function where
 * `domain/` could reach it — the exact thing the layering forbids. Five
 * duplicated lines is the cheapest of the three (D-094).
 *
 * Local parts, not UTC. A `LocalDate` is a calendar fact with no timezone
 * (D-023).
 */
export function today(): LocalDate {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }
}
