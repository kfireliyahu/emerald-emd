/**
 * **An amount held to a range, in what it is in** (M37 U4): `10..50 ILS`,
 * `10.. ILS` (at least), `..50 ILS` (at most), and a quantity's the same with
 * its unit — `100..500 g`. A money or quantity column is never held to one
 * value (`coerceMatch` says why: an amount equal to what was typed is an
 * accident, and a figure without its unit quietly matches the row measured in
 * millilitres), so a range is what holds one, and it always says what it is in:
 * a row in another currency or unit is not in it, rather than compared as if
 * it were.
 *
 * Words, like a window around today (D-472): one string, the same in
 * `format_rows`' `match`, the address (`?price=10..50+ILS`) and the header's
 * menu, read by `filterQuery` on a column it fits. Pure.
 */

/** A range as written: each end as typed, and what it is in. */
export interface FigureRangeWords {
  readonly from: string | undefined
  readonly to: string | undefined
  readonly unit: string
}

const FIGURE = '-?[0-9]+(?:\\.[0-9]+)?'
const RANGE = new RegExp(`^\\s*(${FIGURE})?\\s*\\.\\.\\s*(${FIGURE})?\\s+(\\S+)\\s*$`)

/** `10..50 ILS` read, or nothing when it is not a range — a range has at least one end. */
export function parseFigureRange(text: string): FigureRangeWords | undefined {
  const found = RANGE.exec(text)
  if (found === null) return undefined
  const [, from, to, unit = ''] = found
  if (from === undefined && to === undefined) return undefined
  return { from, to, unit }
}

/** A range written back: `10..50 ILS`, `10.. ILS`, `..50 ILS`. */
export function figureRangeText(range: FigureRangeWords): string {
  return `${range.from ?? ''}..${range.to ?? ''} ${range.unit}`
}

/** A range as a sentence says it: `10 to 50 ILS`, `at least 10 ILS`, `at most 50 ILS`. */
export function figureRangeSaid(range: FigureRangeWords): string {
  if (range.from !== undefined && range.to !== undefined) return `${range.from} to ${range.to} ${range.unit}`
  return range.from !== undefined ? `at least ${range.from} ${range.unit}` : `at most ${range.to ?? ''} ${range.unit}`
}
