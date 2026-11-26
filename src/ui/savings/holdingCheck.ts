import { monthsBetween, parseISODate, toISODate, type LocalDate } from '@/core/time.ts'
import type { HoldingWorth } from '@/domain/holdingReadings.ts'
import type { Holding } from '@/domain/model/savings.ts'
import { countKey } from '@/i18n/count.ts'
import type { Translate } from '@/i18n/current.ts'

/** When a holding was last counted: never, or on a day so many whole months ago. */
export type LastChecked = { readonly kind: 'NEVER' } | { readonly kind: 'ON'; readonly day: LocalDate; readonly months: number }

/** What a holding's row says about when it was last counted, and whether it asks. */
export interface HoldingCheck {
  /** When it was last counted — said by `checkedSaid` — or nothing at all. */
  readonly checked: LastChecked | undefined
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
  if (isOwnCash) return { checked: undefined, askable: false }

  // A reading is somebody counting it (M30 F5): its day stands when it is the later.
  const read = worth === undefined ? undefined : parseISODate(worth.asOf)
  const confirmed =
    read !== undefined && (holding.lastConfirmedAt === undefined || toISODate(read) > toISODate(holding.lastConfirmedAt))
      ? read
      : holding.lastConfirmedAt
  if (confirmed === undefined) return { checked: { kind: 'NEVER' }, askable: true }
  return { checked: { kind: 'ON', day: confirmed, months: monthsBetween(confirmed, asOf) }, askable: true }
}

/** `checked 2026-09-01 — 1 month ago`, `never checked`, in the language on screen (M64 F38). */
export function checkedSaid(checked: LastChecked, t: Translate): string {
  if (checked.kind === 'NEVER') return t('wealth.checked.never')
  const day = toISODate(checked.day)
  return checked.months <= 0
    ? t('wealth.checked.on', { day })
    : t(countKey('wealth.checked.ago', checked.months), { day, count: checked.months })
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
