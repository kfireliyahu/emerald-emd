import { monthsBetween, parseISODate, toISODate, type LocalDate } from '@/core/time.ts'
import type { HoldingWorth } from '@/domain/holdingReadings.ts'
import type { Holding } from '@/domain/model/savings.ts'

import { NEVER_CONFIRMED } from './labels.ts'

/** What a holding's row says about when it was last counted, and whether it asks. */
export interface HoldingCheck {
  /** "checked 2026-09-01 — 1 month ago", "never checked", or nothing at all. */
  readonly phrase: string | undefined
  /** Whether the row offers *Checked today* and *New figure*. */
  readonly askable: boolean
}

/**
 * **How long since anybody checked, and whether anybody should** (M36 U01).
 *
 * A bank account's own Cash is what its statement leaves once the goals have
 * taken their parts (D-376): the bank counts it, so it says nothing about being
 * checked and offers neither *Checked today* nor a new figure. Home already left
 * it out of its stale holdings; the map said *never checked* beside a figure the
 * statement had just printed.
 *
 * Never-checked is its own phrase rather than a very large number of months,
 * because "nobody has ever counted this" is a different thing to know.
 */
export function checkedOf(
  holding: Holding,
  asOf: LocalDate,
  worth: HoldingWorth | undefined,
  isOwnCash: boolean,
): HoldingCheck {
  if (isOwnCash) return { phrase: undefined, askable: false }

  // A reading is somebody counting it (M30 F5): its day stands when it is the later.
  const read = worth === undefined ? undefined : parseISODate(worth.asOf)
  const confirmed =
    read !== undefined && (holding.lastConfirmedAt === undefined || toISODate(read) > toISODate(holding.lastConfirmedAt))
      ? read
      : holding.lastConfirmedAt
  if (confirmed === undefined) return { phrase: NEVER_CONFIRMED, askable: true }

  const months = monthsBetween(confirmed, asOf)
  const phrase =
    months <= 0
      ? `checked ${toISODate(confirmed)}`
      : `checked ${toISODate(confirmed)} — ${String(months)} month${months === 1 ? '' : 's'} ago`
  return { phrase, askable: true }
}

/**
 * Where Home's *New figure* goes (M36 U01): Net worth, naming the holding, so its row
 * opens with its reading form when the page lands — a holding no goal follows has
 * no other screen to take one.
 */
export function newFigureFor(holdingId: string): { readonly to: string; readonly state: { readonly reading: string } } {
  return { to: '/wealth', state: { reading: holdingId } }
}

/** The holding a navigation named for a reading, if it named one. */
export function readingWanted(state: unknown): string | undefined {
  if (typeof state !== 'object' || state === null || !('reading' in state)) return undefined
  const reading = (state as { reading: unknown }).reading
  return typeof reading === 'string' && reading !== '' ? reading : undefined
}
