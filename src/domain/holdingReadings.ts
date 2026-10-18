/**
 * **A dated reading of what a holding is worth** (M30 U5, D-358).
 *
 * A statement prints what a holding was worth on a day, and that figure is the
 * holding's worth — transcribed, never fetched (D-308). What went in is the
 * rows; the difference is growth, and it is derived, keyed by the reading, so a
 * goal fed by the holding is worth its latest reading and can go down.
 *
 * The checks here are three answers and never a silent fourth (D-149): each
 * says `PROVED`, `FAILED` with both figures, or `UNCHECKED` with its reason.
 * None of them is a source of a figure — a price only checks a value.
 */

import type { CurrencyCode, Money } from '@/core/money.ts'
import type { WantedDeposit } from './goalDeposits.ts'

/** The key a reading's growth deposit carries: one deposit per reading. */
export function readingGrowthKey(readingId: string): string {
  return `reading:${readingId}`
}

export const READING_GROWTH_PREFIX = 'reading:'

export interface ReadingPoint {
  readonly id: string
  /** ISO date. */
  readonly asOf: string
  readonly value: Money
}

/** A deposit the goal already holds in the holding, growth from readings left out. */
export interface PutInPoint {
  /** ISO date. */
  readonly date: string
  readonly minor: number
  readonly currency: CurrencyCode
}

/**
 * **Growth is a reading less what went in by its day** — cumulatively, so each
 * reading's deposit is what changed since the one before it, and together they
 * leave the goal's balance on the latest reading exactly (plus anything put in
 * after it). A reading in another currency than the goal's is passed over: it
 * cannot be subtracted from, and is no figure here (D-003). A step of zero is no
 * deposit, since a deposit is never zero.
 */
export function readingGrowth(
  readings: readonly ReadingPoint[],
  putIn: readonly PutInPoint[],
  currency: CurrencyCode,
): readonly WantedDeposit[] {
  const ordered = readings
    .filter((reading) => reading.value.currency === currency)
    .slice()
    .sort((a, b) => a.asOf.localeCompare(b.asOf))
  const wanted: WantedDeposit[] = []
  let before = 0
  for (const reading of ordered) {
    const went = putIn
      .filter((one) => one.currency === currency && one.date <= reading.asOf)
      .reduce((sum, one) => sum + one.minor, 0)
    const gained = reading.value.minor - went
    const step = gained - before
    before = gained
    if (step === 0) continue
    wanted.push({ key: readingGrowthKey(reading.id), date: reading.asOf, minor: step, currency })
  }
  return wanted
}

/** A check of a reading against something else the document knows. */
export type ReadingCheck<T> =
  | { readonly kind: 'PROVED' }
  | { readonly kind: 'FAILED'; readonly ours: T; readonly printed: T }
  | { readonly kind: 'UNCHECKED'; readonly reason: string }

/** The holding's rows, in millionths, against the quantity a reading printed. Exact. */
export function quantityCheck(
  rows: { readonly quantityMicro: number } | { readonly reason: string },
  printedMicro: number | undefined,
): ReadingCheck<number> {
  if (printedMicro === undefined) return { kind: 'UNCHECKED', reason: 'The reading printed no quantity.' }
  if ('reason' in rows) return { kind: 'UNCHECKED', reason: rows.reason }
  return rows.quantityMicro === printedMicro
    ? { kind: 'PROVED' }
    : { kind: 'FAILED', ours: rows.quantityMicro, printed: printedMicro }
}

/**
 * **An account's cash line against its running balance** — what the account's
 * rows add up to by the reading's day, from its opening balance when it has one.
 * Exact: both are what the broker printed.
 */
export function cashCheck(running: Money | undefined, value: Money, reason?: string): ReadingCheck<Money> {
  if (running === undefined) {
    return { kind: 'UNCHECKED', reason: reason ?? 'Its account has no rows to run a balance over.' }
  }
  if (running.currency !== value.currency) {
    return { kind: 'UNCHECKED', reason: `The cash line is in ${value.currency} and the account's rows in ${running.currency}.` }
  }
  return running.minor === value.minor ? { kind: 'PROVED' } : { kind: 'FAILED', ours: running, printed: value }
}

// --- What a holding is worth (M30 F5) -----------------------------------------

/**
 * What a holding with a reading is worth now, and what of it is growth —
 * `holdingWorths` in `holdingReadingRepository` works it out from the figures
 * the pack declares (M36 U05, D-381).
 */
export interface HoldingWorth {
  readonly holdingId: string
  /** The day of the reading it stands on. ISO. */
  readonly asOf: string
  /** What the reading printed. */
  readonly reading: Money
  /** The reading, and what moved in or out after its day. */
  readonly worth: Money
  /** What went in: its rows and what a person put in by hand. Absent for an account's own cash, which has no cost. */
  readonly putIn: Money | undefined
  /** `worth − putIn`. Absent for cash. */
  readonly growth: Money | undefined
}
