/**
 * The deciding view of a debt (M28 U8, D-325): what goes toward it each month,
 * and what is left in a time you pick. The same shape as `goalPlan.ts`, the other
 * way round.
 *
 * **Plain addition, and it says so.** A debt here has no interest rate (D-083: a
 * payment states its interest, and the balance is principal less principal paid),
 * so inventing one to project with would be a number somebody typed that reads as
 * a fact. What is left is what is left now, less each month's payments, stopping
 * at nothing. Interest only ever enters as a payment says it did.
 *
 * **Two amounts, one of them Plan's.** The *payment* is what the debt already
 * takes each month — its standing order, or failing that what the last payments
 * show it coming down by. The *extra* is the Plan bucket that points at the debt
 * (choice 3 A, as for a goal): typed here or on Plan, it is one number. The table
 * can therefore say how much sooner the extra gets you there.
 *
 * Pure: money in, money out, no clock, no database.
 */

import { money, type Money } from '@/core/money.ts'
import { addMonths, type YearMonth } from '@/core/time.ts'
import { PROJECTION_LIMIT_MONTHS } from '@/domain/goalPlan.ts'

export interface DebtLine {
  readonly debtId: string
  readonly name: string
  /** Outstanding principal now; never below zero. */
  readonly left: Money
  /** What it takes each month without Plan: a standing order, or what it has been coming down by. */
  readonly payment: Money
  /** Where `payment` came from, for the line under it. */
  readonly paymentSource: 'STANDING_ORDER' | 'OBSERVED' | 'NONE'
  /** What Plan puts toward it each month, on top. */
  readonly extra: Money
}

/** What is left after `months`, with the extra or without it. Never below zero. */
export function leftAfter(line: DebtLine, months: number, withExtra = true): Money {
  const each = Math.max(0, line.payment.minor) + (withExtra ? Math.max(0, line.extra.minor) : 0)
  return money(Math.max(0, line.left.minor - each * Math.max(0, months)), line.left.currency)
}

/** Months until nothing is left. 0 when it is paid already; `undefined` when never. */
export function monthsToPayOff(line: DebtLine, withExtra = true): number | undefined {
  if (line.left.minor <= 0) return 0
  const each = Math.max(0, line.payment.minor) + (withExtra ? Math.max(0, line.extra.minor) : 0)
  if (each <= 0) return undefined
  const months = Math.ceil(line.left.minor / each)
  return months > PROJECTION_LIMIT_MONTHS ? undefined : months
}

export type DebtStatus =
  | { readonly kind: 'PAID' }
  | { readonly kind: 'PAID_OFF'; readonly at: YearMonth; readonly sooner: number | undefined }
  | { readonly kind: 'NO_PAYMENT' }

/** `sooner` is how many months the extra saves, when there is one and it saves any. */
export function debtStatus(line: DebtLine, from: YearMonth): DebtStatus {
  const months = monthsToPayOff(line)
  if (months === 0) return { kind: 'PAID' }
  if (months === undefined) return { kind: 'NO_PAYMENT' }
  const without = line.extra.minor > 0 ? monthsToPayOff(line, false) : months
  return {
    kind: 'PAID_OFF',
    at: addMonths(from, months),
    sooner: without === undefined ? undefined : without > months ? without - months : undefined,
  }
}
