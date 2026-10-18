/**
 * A `percent` column's figure: `12.5%` at the edge, a whole number underneath
 * (M29 U3, D-333).
 *
 * **Stored as millionths of the whole** — the percent figure times ten
 * thousand — so `12.5%` is the integer `125000` and `17%` is `170000`. Three
 * things chose that over every other way to hold it:
 *
 * - **It is exact.** The figure is split at its point by `decimal.ts`'s string
 *   arithmetic and never passes through a float, as money's minor units never
 *   do (D-257's argument, kept).
 * - **SQL can use it as it is.** A derived column compiled into a view (M29
 *   U3b) multiplies money by a rate in SQLite's 64-bit integers:
 *   `price_minor * (1000000 + vat)` is exact, and dividing by `1000000` with
 *   the half-away-from-zero rounding `roundHalfAway` names is the only step
 *   that loses anything — and what it loses is a fraction of an agora, which
 *   no money column could hold anyway.
 * - **One constant, not a per-column scale.** Four places of a percent covers
 *   a VAT rate, a mortgage's 3.875%, and a fund's 0.0045% fee; a person
 *   choosing a percent column is never asked how many places it keeps.
 *
 * **More places than four is a refusal, never a rounding**, as for a decimal:
 * `12.34567%` is a figure somebody believes they stored.
 *
 * **A cell is read the way a person types it** (M29 F3, D-344): `87`, `87%`
 * and `0.87` are all 87%. A `%` makes the figure the percent, always — `0.5%`
 * is half a percent. Without one, a figure strictly between -1 and 1 that is
 * not zero is a fraction of the whole, so `0.87` is 87%; anything else is the
 * percent, so `1` is 1% and never 100%. `readPercent` is that reading, shared
 * by the sheet, the entry page and `record_format_rows`.
 *
 * **A bound is the percent figure, always** (`parsePercent`): a declaration is
 * written once, on purpose, and `maximum: 1` there is 1%.
 *
 * Imports nothing but `decimal.ts`, so the declaration, the row, the text
 * storage and the identity can agree on it without agreeing on anything else.
 */

import { err, type Result } from '@/core/result.ts'
import { formatDecimal, parseDecimal } from './decimal.ts'

/** How many digits after a percent's point it keeps. */
export const PERCENT_PLACES = 4

/**
 * What the stored integer is divided by to be the fraction: a percent is kept
 * in millionths of the whole. `PERCENT_PLACES` of a percent is two more places
 * of the fraction.
 */
export const PERCENT_DENOMINATOR = 1_000_000

/**
 * The stored integer for a percent written as `12.5`, `"12.5"` or `"12.5%"`.
 *
 * The refusals are `parseDecimal`'s, worded for a percent.
 */
export function parsePercent(offered: string | number): Result<number, string> {
  const text = typeof offered === 'number' ? offered : offered.trim().replace(/\s*%$/, '')
  const scaled = parseDecimal(text, PERCENT_PLACES)
  if (scaled.ok) return scaled
  return err(
    scaled.error.replace(
      `this column keeps ${PERCENT_PLACES}`,
      `a percent keeps ${PERCENT_PLACES}`,
    ).replace(`a column of ${PERCENT_PLACES} places`, 'a percent'),
  )
}

/**
 * A cell's percent as a person types it — the one reading the sheet, the entry
 * page and a conversation share (M29 F3, D-344).
 *
 * - `87%`, `0.5%` — a sign makes it the percent, whatever the figure.
 * - `0.87`, `.5`, `-0.2` — a bare figure strictly between -1 and 1, and not
 *   zero, is the fraction: 87%, 50%, -20%. Six places of the fraction is four
 *   of the percent, so a seventh is refused, never rounded.
 * - `87`, `1`, `0`, `150` — any other bare figure is the percent. **`1` is 1%**:
 *   a whole is written `100` or `100%`, because one percent is the figure a
 *   person types far more often than all of it.
 */
export function readPercent(offered: string | number): Result<number, string> {
  if (typeof offered === 'string' && /%\s*$/.test(offered)) return parsePercent(offered)
  const bare = typeof offered === 'number' ? String(offered) : offered.trim()
  if (!FRACTION.test(bare)) return parsePercent(offered)
  const scaled = parseDecimal(bare, PERCENT_PLACES + 2)
  if (scaled.ok) return scaled
  return err(
    `${bare} is read as a fraction of the whole, and a percent keeps ${PERCENT_PLACES} places — ` +
      `${PERCENT_PLACES + 2} of the fraction. It is refused rather than rounded; write it with its % sign if it is already the percent.`,
  )
}

/** A bare figure strictly between -1 and 1 and not zero: `0.87`, `.5`, `-0.2`. */
const FRACTION = /^[+-]?0*\.\d*[1-9]\d*$/

/**
 * The stored integer as a person reads it: `125000` is `12.5%`, `170000` is
 * `17%`. Trailing zeros go — a percent keeps four places so that it *can*, not
 * so that every VAT rate prints as `17.0000%`.
 */
export function formatStoredPercent(stored: number): string {
  return `${percentFigure(stored)}%`
}

/** The figure without its sign: `125000` is `12.5`. What an input holds. */
export function percentFigure(stored: number): string {
  const figure = formatDecimal(stored, PERCENT_PLACES)
  return figure.replace(/\.?0+$/, '')
}

/** The fraction as a number — `125000` is `0.125` — for arithmetic that is not exact. */
export function percentValue(stored: number): number {
  return stored / PERCENT_DENOMINATOR
}

/**
 * `x ÷ d` to a whole number, **halves away from zero** — `2.5` is `3` and
 * `-2.5` is `-3`.
 *
 * The rule a money figure computed from a rate is rounded by (D-333): it is
 * what an invoice does with VAT, it is symmetric so a refund rounds like the
 * charge it reverses, and in SQL it is `(x + sign(x) * d / 2) / d` with
 * SQLite's integer division, which truncates toward zero.
 */
export function roundHalfAway(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n
  const n = numerator < 0n ? -numerator : numerator
  const d = denominator < 0n ? -denominator : denominator
  const rounded = (2n * n + d) / (2n * d)
  return negative ? -rounded : rounded
}
