/**
 * The six ways a savings balance can change, as the vocabulary rather than as a
 * form's internal state.
 *
 * This lived in `ui/savings/DepositEditor.tsx` until a second caller appeared —
 * the plugin's `record_deposits` — which is the third time a rule has been found
 * in `ui/` (D-097, D-109). The alternative was a second copy of "a loss is
 * `GROWTH` with a negative sign", and two copies of that rule is one that can
 * disagree with itself.
 *
 * **The sign is a mode, not a minus somebody types**, and the mode picks the
 * `sourceKind` the same way it picks the sign. A gain and a loss are two modes
 * rather than one field where a minus decides which, because `OPENING_BALANCE`
 * and `GROWTH` are in the balance and are not contributions — and every figure
 * that has to exclude them is an aggregate, which cannot read a note (D-081).
 *
 * No React, no sql.js, no DOM (docs/conventions.md).
 */

import { money, type CurrencyCode, type Money } from '@/core/money.ts'
import type { DepositSourceKind, SavingDeposit } from '@/domain/model/savings.ts'

export const DEPOSIT_MODES = [
  'DEPOSIT',
  'WITHDRAWAL',
  'TRANSFER',
  'OPENING',
  'GAIN',
  'LOSS',
] as const

export type DepositMode = (typeof DEPOSIT_MODES)[number]

/** The two modes that store a negative amount. */
const NEGATIVE_MODES: readonly DepositMode[] = ['WITHDRAWAL', 'LOSS']

const MODE_SOURCE: Readonly<Record<DepositMode, DepositSourceKind>> = {
  DEPOSIT: 'MANUAL',
  WITHDRAWAL: 'MANUAL',
  TRANSFER: 'MANUAL',
  OPENING: 'OPENING_BALANCE',
  GAIN: 'GROWTH',
  LOSS: 'GROWTH',
}

export function sourceKindFor(mode: DepositMode): DepositSourceKind {
  return MODE_SOURCE[mode]
}

/** A magnitude, signed by the mode. Callers hand in what the user actually said. */
export function signedAmount(
  mode: DepositMode,
  magnitudeMinor: number,
  currency: CurrencyCode,
): Money {
  const size = Math.abs(magnitudeMinor)
  return money(NEGATIVE_MODES.includes(mode) ? -size : size, currency)
}

/**
 * Which mode a stored row is.
 *
 * It has to agree with what was saved, or editing a loss would demand a reason
 * and re-file it as a withdrawal.
 */
export function modeOf(deposit: SavingDeposit): DepositMode {
  if (deposit.sourceKind === 'OPENING_BALANCE') return 'OPENING'
  if (deposit.sourceKind === 'GROWTH') return deposit.amount.minor < 0 ? 'LOSS' : 'GAIN'
  return deposit.amount.minor < 0 ? 'WITHDRAWAL' : 'DEPOSIT'
}
