/**
 * Compounding a balance forward — the arithmetic behind every "what would this
 * be worth" figure in the app.
 *
 * One function, because there is one honest way to do this and two copies of it
 * would eventually disagree about what a year's deposits earn. It was written
 * inside `domain/funds.ts` for the fee-drag illustration (D-066); it moves here
 * on its second caller, the fee-impact screen, and F07's savings projection is
 * the third — the habit `ratioBasisPoints` and `monthsBetween` both followed.
 *
 * **Nothing here is a forecast.** It is an illustration of an assumption, and
 * every screen that shows one has to say so and has to show the assumption
 * beside the answer. Which is why `projectBalance` takes its assumptions as
 * plain values with no defaults: a default return rate is a prediction the app
 * would be making on the user's behalf without ever printing it.
 *
 * Pure and integer: the fees and the return are basis points and the balance is
 * minor units, so no float is ever within reach of an amount (D-003).
 */

import { money, type Money } from '@/core/money.ts'
import { applyBasisPoints } from '@/core/percent.ts'

/**
 * What a projection needs to know, stated rather than assumed.
 *
 * The two fees are plain basis points rather than a `FundFees`, because a
 * pension's דמי ניהול and a savings account's charges are the same two
 * arithmetic slots wearing different names — the fee taken off the balance each
 * year, and the fee taken off each contribution before it is invested. Taking
 * the fund type here would make F07 construct a pension to project a bank
 * deposit.
 */
export interface ProjectionAssumptions {
  readonly openingBalance: Money
  /** Paid in over each year, in one lump for the purposes of this arithmetic. */
  readonly annualContribution: Money
  readonly years: number
  /** The assumed return **before** fees, per year. 500 is 5%. */
  readonly grossReturnBasisPoints: number
  /** Taken off the balance every year. 50 is 0.5%. */
  readonly feeOnBalanceBasisPoints?: number | undefined
  /** Taken off each contribution before it is invested. 600 is 6%. */
  readonly feeOnContributionBasisPoints?: number | undefined
}

/**
 * A balance projected forward, year by year, in integer minor units.
 *
 * Each year: the contribution arrives net of the contribution fee, and the
 * year's net return (gross minus the balance fee) is applied to the opening
 * balance plus **half** the contribution — the same mid-period assumption
 * `periodReturn` makes, so the projection and the measurement do not disagree
 * about what a year of deposits earns (docs/05).
 *
 * A negative net return is arithmetic, not an error: a 2% gross return against
 * a 3% fee loses money every year, and that is precisely the case a fee
 * illustration exists to show.
 */
export function projectBalance(assumptions: ProjectionAssumptions): Money {
  const {
    openingBalance,
    annualContribution,
    years,
    grossReturnBasisPoints,
    feeOnBalanceBasisPoints,
    feeOnContributionBasisPoints,
  } = assumptions

  const netReturn = grossReturnBasisPoints - (feeOnBalanceBasisPoints ?? 0)
  const deposited =
    annualContribution.minor -
    applyBasisPoints(annualContribution.minor, feeOnContributionBasisPoints ?? 0)

  let balance = openingBalance.minor
  for (let year = 0; year < Math.max(0, Math.trunc(years)); year += 1) {
    const growthBase = balance + Math.trunc(deposited / 2)
    balance += deposited + applyBasisPoints(growthBase, netReturn)
  }

  return money(balance, openingBalance.currency)
}
