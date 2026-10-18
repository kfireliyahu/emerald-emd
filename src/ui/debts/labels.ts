/**
 * What the debt vocabulary is called on screen.
 *
 * Here rather than title-cased from the identifier, for the reason
 * `savings/labels.ts` and `funds/labels.ts` exist: `CARD_INSTALLMENTS` is "a
 * purchase split into payments" and `NEEDS_TWO_PAYMENTS` is "one payment is not
 * a rate", and neither survives a mechanical transformation of its enum name.
 *
 * The tracking kinds get a **hint** as well as a label, because picking one is
 * the single most consequential choice in the debt editor: it decides which
 * ledger rows become payments against this balance, and a wrong choice writes
 * money figures rather than merely looking odd.
 */

import { formatMoney } from '@/core/money.ts'
import { formatYearMonth } from '@/core/time.ts'
import type { PayoffProjection } from '@/domain/debt.ts'
import type {
  AutoTrackKind,
  DebtKind,
  PaymentSourceKind,
} from '@/domain/model/debt.ts'

export const DEBT_KIND_LABEL: Readonly<Record<DebtKind, string>> = {
  MORTGAGE: 'Mortgage',
  BANK_LOAN: 'Bank loan',
  CARD_INSTALLMENTS: 'Split purchase',
  PAYROLL_LOAN: 'Employer loan',
  PERSONAL: 'Owed to someone',
  OTHER: 'Other',
}

export const TRACK_KIND_LABEL: Readonly<Record<AutoTrackKind, string>> = {
  NONE: 'I will enter payments myself',
  MERCHANT_PATTERN: 'Charges from a merchant',
  CATEGORY: 'Anything in a category',
  CARD_INSTALLMENT_GROUP: 'The slices of one split purchase',
}

/**
 * What each mechanism will actually do, in the words that make the choice
 * decidable — including the one it cannot offer, which is the payroll link.
 */
export const TRACK_KIND_HINT: Readonly<Record<AutoTrackKind, string>> = {
  NONE: 'Nothing is discovered. Right for money owed to a friend, paid back in cash.',
  MERCHANT_PATTERN:
    'Every outgoing charge whose merchant contains this text becomes a payment. The standing order for a bank loan or a mortgage.',
  CATEGORY:
    'Every outgoing charge categorized under this category becomes a payment. Right when the repayments arrive under several names.',
  CARD_INSTALLMENT_GROUP:
    'The remaining slices of one purchase, as each is charged. Usually created by promoting the purchase rather than typed here.',
}

/**
 * Payroll is not one of the four, and the editor says so where the choice is
 * made rather than leaving the user to wonder where it went.
 */
export const PAYROLL_TRACKING_NOTE =
  'A loan repaid out of your salary is linked from the deduction type instead — Paychecks › Deduction types, "Pays into". A debt can do both.'

export const PAYMENT_SOURCE_LABEL: Readonly<Record<PaymentSourceKind, string>> = {
  MANUAL: 'Entered by hand',
  TRANSACTION: 'From a transaction',
  PAYCHECK: 'From a paycheck',
  INSTALLMENT_SLICE: 'A slice of a split purchase',
  FROM_PLAN: 'From a split plan',
}

/**
 * When it will be paid off, or why that cannot be said.
 *
 * Every "cannot say" is a sentence naming what is missing, never a dash: the
 * domain models them as separate variants precisely so the screen can tell a
 * debt with no schedule apart from one whose payments are all interest, and
 * collapsing them here would throw that away at the last step.
 */
export function payoffSentence(projection: PayoffProjection): string {
  switch (projection.kind) {
    case 'SETTLED':
      return 'Paid off'
    case 'UNCHECKED':
      return 'A payment is in another currency, so what is owed is not one figure to count down'
    case 'NO_BASIS':
      return 'No payments yet and no expected amount, so there is nothing to project from'
    case 'NEEDS_TWO_PAYMENTS':
      return 'One payment is not a rate — a second one makes this a date'
    case 'NOT_REDUCING':
      return projection.basis === 'OBSERVED'
        ? 'The balance is not coming down at this rate'
        : 'The expected payment does not reduce the balance'
    case 'BEYOND_HORIZON':
      return `Over fifty years at ${formatMoney(projection.monthlyPrincipal)} a month`
    case 'PROJECTED':
      return `Clear by ${formatYearMonth(projection.period)}`
  }
}

/** Whose figure the projection divided by, said plainly under the date. */
export function payoffBasisNote(projection: PayoffProjection): string | undefined {
  if (projection.kind !== 'PROJECTED' && projection.kind !== 'BEYOND_HORIZON') return undefined
  return projection.basis === 'OBSERVED'
    ? `on ${formatMoney(projection.monthlyPrincipal)} a month, from what you have actually been paying`
    : `on ${formatMoney(projection.monthlyPrincipal)} a month, the amount you entered`
}
