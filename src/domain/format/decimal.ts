/**
 * A `decimal` column's figure: a whole number underneath, a decimal string at
 * the edge (M24 U6, D-257).
 *
 * The ledger has kept numbers with a fixed count of places since M4 —
 * `quantity_micro`, `price_micro`, `rate_micro`, basis points — each an integer
 * column with the scale in its name, and each a convention the next reader had
 * to know. This is that convention as a type, and **the float never appears**:
 * the figure crosses into the document as the text a person wrote, is split at
 * its point by string arithmetic, and is stored as the integer the ledger would
 * have stored. A `real` would have been the float the money rule forbids next
 * to every amount these columns are multiplied by.
 *
 * **More places than the column keeps is a refusal, never a rounding.** A rate
 * of `3.14159` in a column of two places is a figure somebody believes they
 * stored; rounding it would make that belief quietly false, which is the one
 * thing this app exists not to do.
 *
 * Imports nothing, so the declaration, the row and the text storage can all
 * agree on it without agreeing on anything else.
 */

import { err, ok, type Result } from '@/core/result.ts'

const DECIMAL_PATTERN = /^([+-])?(\d*)(?:\.(\d*))?$/

/**
 * The stored integer for a figure written as text or given as a number.
 *
 * A number is accepted because a conversation sends `3.5` as often as `"3.5"`,
 * and the two mean one thing; it is read through its shortest printed form,
 * which is the digits the sender typed. One that prints with an exponent is
 * refused rather than expanded, because by then the digits are the float's and
 * not the sender's.
 */
export function parseDecimal(offered: string | number, scale: number): Result<number, string> {
  const text = typeof offered === 'number' ? String(offered) : offered.trim().replace(/,/g, '')
  if (typeof offered === 'number' && !Number.isFinite(offered)) {
    return err(`${String(offered)} is not a figure.`)
  }
  if (/e/i.test(text)) {
    return err(`${text} is written with an exponent; send the figure as its digits, "0.0000001".`)
  }
  const match = DECIMAL_PATTERN.exec(text)
  const whole = match?.[2] ?? ''
  const fraction = (match?.[3] ?? '').replace(/0+$/, '')
  if (match === null || (whole === '' && (match[3] ?? '') === '')) {
    return err(`"${text}" is not a figure.`)
  }
  if (fraction.length > scale) {
    return err(
      `${text} has ${fraction.length} places and this column keeps ${scale}. It is refused rather than rounded — send it to ${scale} places if that is what was meant.`,
    )
  }
  const digits = `${whole === '' ? '0' : whole}${fraction.padEnd(scale, '0')}`
  const magnitude = Number(digits)
  if (!Number.isSafeInteger(magnitude)) {
    return err(`${text} is too large for a column of ${scale} places.`)
  }
  return ok(match[1] === '-' && magnitude !== 0 ? -magnitude : magnitude)
}

/** The stored integer as the figure, at exactly the column's places: `3500000` at 6 is `3.500000`. */
export function formatDecimal(scaled: number, scale: number): string {
  const sign = scaled < 0 ? '-' : ''
  const digits = String(Math.abs(scaled)).padStart(scale + 1, '0')
  return `${sign}${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`
}

/**
 * The figure as a number, for the one place that does arithmetic on it — an
 * identity, which already compares within a tolerance (D-222).
 *
 * A division by a power of ten rather than anything cleverer: the result is the
 * nearest double to the figure, which is what `real` holds, and it is never
 * stored or written back.
 */
export function decimalValue(scaled: number, scale: number): number {
  return scaled / 10 ** scale
}
