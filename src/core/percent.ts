/**
 * Rates as integer basis points — 2350 is 23.5%.
 *
 * A rate is not money, but a rate computed in floating point and multiplied back
 * against an amount puts the float straight into the money path, which is the
 * whole of what D-003 exists to prevent. So every ratio in this app is an
 * integer of hundredths of a percent, and the one float lives in `formatPercent`
 * at the moment a string is produced.
 *
 * docs/03 has listed this file as arriving with M4 since the structure was
 * written. It does, and it arrives holding what was already there rather than
 * anything new: `ratioBasisPoints` moved out of `domain/paycheck.ts` (its second
 * caller is fixed-expense variance, which is not paycheck math) and
 * `formatPercent` absorbed the private `percent` on the paycheck detail screen.
 */

import type { Money } from './money.ts'

/** 100% — the denominator every basis-point figure is against. */
export const BASIS_POINTS_PER_WHOLE = 10_000

/**
 * A share the document worked out — `principal_paid / principal`, a double —
 * as basis points, halves away from zero as `ratioBasisPoints` rounds (M36
 * U03). The nudge is far below a basis point and only keeps a half the double
 * landed a hair under from rounding the other way.
 */
export function shareBasisPoints(share: number): number {
  const magnitude = Math.floor(Math.abs(share) * BASIS_POINTS_PER_WHOLE + 0.5 + 1e-9)
  return share < 0 ? -magnitude : magnitude
}

/**
 * A ratio as integer basis points, rounded half-up. `undefined` when the whole
 * is zero, because a rate against nothing is not a small rate.
 *
 * Integer arithmetic throughout: the inputs are minor units and the output is
 * hundredths of a percent, so no float is involved in either.
 */
export function ratioBasisPoints(part: Money, whole: Money): number | undefined {
  if (whole.minor === 0) return undefined
  const scaled = part.minor * BASIS_POINTS_PER_WHOLE
  const negative = scaled < 0 !== whole.minor < 0
  const magnitude = Math.floor(
    (Math.abs(scaled) * 2 + Math.abs(whole.minor)) / (Math.abs(whole.minor) * 2),
  )
  return negative ? -magnitude : magnitude
}

/**
 * The same ratio over two plain integers — a spread, a coefficient of variation,
 * anything counted rather than denominated.
 *
 * Separate from `ratioBasisPoints` rather than a looser version of it: that one
 * takes `Money` so that a ratio between two currencies is impossible to ask for
 * by accident, and widening it to numbers would give that guarantee away.
 */
export function ratioOfBasisPoints(part: number, whole: number): number | undefined {
  if (whole === 0) return undefined
  const scaled = part * BASIS_POINTS_PER_WHOLE
  const negative = scaled < 0 !== whole < 0
  const magnitude = Math.floor((Math.abs(scaled) * 2 + Math.abs(whole)) / (Math.abs(whole) * 2))
  return negative ? -magnitude : magnitude
}

/**
 * `minor × basisPoints ÷ 10000`, rounded half-up, sign preserved — the inverse
 * of `ratioBasisPoints`, and the one place a proportion **of an amount** is
 * taken.
 *
 * Integer throughout: a fee of 0.5% on ₪120,000 is
 * `applyBasisPoints(12_000_000, 50)`, not a multiplication by 0.005 (D-003).
 *
 * Here rather than in `domain/funds.ts`, where it was written, on its second
 * module: `domain/projection.ts` compounds a balance with it, and a projection
 * that reached into the pension module for its arithmetic would have the
 * dependency backwards. The habit `ratioBasisPoints` and `monthsBetween` both
 * followed.
 */
export function applyBasisPoints(minor: number, basisPoints: number): number {
  const scaled = minor * basisPoints
  const negative = scaled < 0
  const magnitude = Math.floor(
    (Math.abs(scaled) * 2 + BASIS_POINTS_PER_WHOLE) / (BASIS_POINTS_PER_WHOLE * 2),
  )
  return negative ? -magnitude : magnitude
}

/**
 * Split `total` into parts proportional to `weights`, so the parts sum to the
 * total **exactly** — the largest-remainder method of docs/05.
 *
 * Plain integers rather than `Money`, because both callers are integer
 * quantities of different kinds: minor units when the splitter divides a
 * paycheck, and basis points when a dragged slider gives back what it took. A
 * `Money` signature would make the second one impossible to write.
 *
 * Each part starts at its floor share; the agorot that floor threw away are
 * handed out one at a time to the largest remainders, and **ties go to the
 * earlier weight**, so the same plan always splits the same way (docs/05: ties
 * break by bucket sort order).
 *
 * Two edge cases, both real:
 *
 * - **Weights summing to zero** split the total evenly. A plan whose buckets are
 *   all at 0% still has to put the money somewhere, and evenly is the only
 *   answer that does not privilege whichever bucket happens to be first.
 * - **A negative total** is split by magnitude and negated. The splittable
 *   amount goes negative when fixed expenses exceed the basis, which docs/f05
 *   says to show rather than clamp — so the arithmetic downstream of it has to
 *   keep working rather than throw.
 */
export function distribute(total: number, weights: readonly number[]): readonly number[] {
  return split(total, weights, undefined)
}

/**
 * The same split, with one part designated to absorb every agora the floor
 * division threw away instead of spreading them by remainder — docs/05's buffer
 * bucket.
 *
 * The buffer takes what is left after the others take their floors, which is
 * exact by construction. Out of range, this is `distribute`.
 */
export function distributeWithBuffer(
  total: number,
  weights: readonly number[],
  bufferIndex: number,
): readonly number[] {
  return split(total, weights, bufferIndex)
}

/** One implementation; the buffer is the only thing the two callers disagree about. */
function split(
  total: number,
  weights: readonly number[],
  bufferIndex: number | undefined,
): readonly number[] {
  if (weights.length === 0) return []

  const sign = total < 0 ? -1 : 1
  const magnitude = Math.abs(total)
  const totalWeight = weights.reduce((running, weight) => running + Math.abs(weight), 0)
  // All-zero weights split evenly: a plan whose buckets are all at 0% still has
  // to put the money somewhere, and evenly is the only answer that does not
  // privilege whichever bucket happens to be first.
  const effective = weights.map((weight) => (totalWeight === 0 ? 1 : Math.abs(weight)))
  const denominator = totalWeight === 0 ? weights.length : totalWeight

  const buffered =
    bufferIndex !== undefined && bufferIndex >= 0 && bufferIndex < weights.length
      ? bufferIndex
      : undefined

  const parts = effective.map((weight, index) =>
    index === buffered ? 0 : Math.floor((magnitude * weight) / denominator),
  )
  const assigned = parts.reduce((running, part) => running + part, 0)

  if (buffered !== undefined) {
    // Exact by construction: the buffer is defined as what the others left.
    parts[buffered] = magnitude - assigned
    return parts.map((part) => sign * part)
  }

  // Largest remainder first; the index breaks ties, so the order is the answer.
  const order = effective
    .map((weight, index) => ({
      remainder: magnitude * weight - (parts[index] ?? 0) * denominator,
      index,
    }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)

  let leftover = magnitude - assigned
  for (const { index } of order) {
    if (leftover <= 0) break
    parts[index] = (parts[index] ?? 0) + 1
    leftover -= 1
  }

  return parts.map((part) => sign * part)
}

/**
 * Basis points as a percentage figure, without its sign: `1250` is `12.5`,
 * `1700` is `17`, `35` is `0.35`.
 *
 * **Every basis-point display goes through this** (M45 F1, S-073): the
 * screens' `formatPercent`, the monthly-summary CSV, and the fund editor's and
 * the Plan's percent inputs. They were four, and printed one rate four ways —
 * `12.50`, `12.5`, `12.5%` and `12.50%`. Up to `digits` decimals (two, which is
 * all a basis point has), trailing zeros trimmed.
 *
 * The float appears here, at the last possible moment, and never touches an
 * amount. Never parse the output of this back into a rate.
 */
export function basisPointsText(basisPoints: number, digits = 2): string {
  const fixed = (basisPoints / 100).toFixed(digits)
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
  return trimmed === '-0' ? '0' : trimmed
}

/**
 * Basis points as a percentage, for display and nowhere else — `basisPointsText`
 * with its sign, and `—` for none. `digits` is the most decimals shown.
 */
export function formatPercent(
  basisPoints: number | undefined,
  options?: { readonly digits?: number },
): string {
  if (basisPoints === undefined) return '—'
  return `${basisPointsText(basisPoints, options?.digits)}%`
}
