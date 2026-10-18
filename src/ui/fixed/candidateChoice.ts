import { fromMajorUnits, type CurrencyCode, type Money } from '@/core/money.ts'
import { parseAmountText } from '@/data/importer/normalize.ts'
import type { Cadence } from '@/domain/model/fixed.ts'

/**
 * What the person agreed to on a candidate's card — the charge and how often —
 * **as the overrides `confirmCandidate` takes**, so the screen that writes it has
 * nothing left to translate and nothing it can quietly drop.
 *
 * M28 F22: the card let the person change the amount, and the screen confirmed the
 * candidate with no overrides at all, so the median was stored instead. The
 * card now hands this over, and the screen's `onTrack` cannot be called without it.
 */
export interface CandidateChoice {
  readonly expectedAmount: Money
  readonly cadence: Cadence
}

/**
 * The card's text read as a choice, or `undefined` when there is no charge in
 * it to agree to — unreadable, or nothing. The sign is dropped: the charge is a
 * size, the way the editor reads it.
 */
export function readCandidateChoice(
  amountText: string,
  cadence: Cadence,
  currency: CurrencyCode,
): CandidateChoice | undefined {
  const parsed = parseAmountText(amountText)
  if (parsed === undefined) return undefined
  const expectedAmount = fromMajorUnits(Math.abs(parsed), currency)
  return expectedAmount.minor === 0 ? undefined : { expectedAmount, cadence }
}
