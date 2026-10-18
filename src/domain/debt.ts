/**
 * Debt math — outstanding balances, payoff projections, the four discovery
 * mechanisms, and the one total the splitter is allowed to subtract.
 * docs/f08-debts.md and docs/04-data-model.md's Debts section.
 *
 * Pure functions over plain values: no database, no clock, no React. Written and
 * tested before a screen or a table exists, exactly as M2 opened with the rules
 * engine, M3 with the paycheck figures, M4 with the fixed-expense detector, M5
 * with the bank-import domain and F07 with `domain/savings.ts`.
 *
 * Four things hold everywhere in here:
 *
 * - **An outstanding balance is never handed in, only computed.** No function in
 *   this file takes one as a parameter; every one that reports a balance derives
 *   it from the principal and the payments it was given. docs/f08 inverts the
 *   feature on exactly this point, and the way to keep the inversion is to leave
 *   no signature a stale balance could travel through — the shape
 *   `fixedExpenseBasis` (D-053), `bankSpendingBasis` (D-060), `periodReturn`
 *   (D-066) and every function in `savings.ts` (D-074) each took for their own
 *   milestone's one dangerous rule.
 * - **A payment reduces a debt by its principal, never by its amount.** The
 *   difference is the interest, it is always in the flattering direction, and it
 *   is the one subtraction nobody checks. The pack declares the split —
 *   `debt_payment.principal_part` — and the document works it out, so there is
 *   no stored `principalPortion` for it to disagree with (D-083), and the
 *   balance is the document's totals, read (M36 U03).
 * - **Nothing discovered can be discovered twice.** A `DiscoveredPayment` has no
 *   id and cannot be constructed without a `sourceRefId`, and `paymentSourceKey`
 *   is the one definition of "the same payment" that the review queue, the
 *   repository's upsert and migration `020`'s unique index will all read.
 *   docs/f08 calls idempotency the whole game here.
 * - **A row that two debts both claim is not a payment.** It comes back as an
 *   ambiguity for the user to resolve, not as two unconfirmed payments against
 *   two balances. Marking a wrong number is not the same as not producing it.
 */

import {
  abs,
  add,
  compare,
  money,
  subtract,
  sum,
  zero,
  type CurrencyCode,
  type Money,
} from '@/core/money.ts'
import { shareBasisPoints } from '@/core/percent.ts'
import { normalizeMerchant } from '@/core/text.ts'
import {
  addMonths,
  compareDates,
  monthsBetween,
  toYearMonthString,
  yearMonthOf,
  type LocalDate,
  type YearMonth,
} from '@/core/time.ts'
import { MAX_PATTERN_LENGTH, containsMerchant } from '@/domain/categorization.ts'
import { isActiveIn } from '@/domain/fixedExpenses.ts'
import type { FixedExpense } from '@/domain/model/fixed.ts'
import type { DeductionType, PaycheckWithLines } from '@/domain/model/paycheck.ts'
import type {
  AutoTracking,
  Debt,
  DebtPayment,
  PaymentObservation,
  PaymentSourceKind,
} from '@/domain/model/debt.ts'

/** A debt with the payments that belong to it. The shape `PaycheckWithLines` takes. */
export interface DebtWithPayments {
  readonly debt: Debt
  readonly payments: readonly DebtPayment[]
}

// --- Payments and balances --------------------------------------------------

/** Oldest first, then by id so a same-day pair always reads the same way. */
export function sortPayments(payments: readonly DebtPayment[]): readonly DebtPayment[] {
  return [...payments].sort(
    (a, b) => compareDates(a.date, b.date) || a.id.localeCompare(b.id),
  )
}

/**
 * What a payment nobody has saved yet will take off what is owed — the pack's
 * `principal_part` (`amount - interest`) for a draft, which has no row for the
 * document to work it out on. A stored payment carries the document's own
 * figure in `principalPart`; this is only ever a draft's (M36 U03).
 */
export function draftPrincipalPart(amount: Money, interest: Money): Money | undefined {
  return interest.currency === amount.currency ? subtract(amount, interest) : undefined
}

/**
 * **What the document works out about one debt** (M36 U03) — the totals and
 * worked-out columns the pack declares on `debt`, read by the repository. The
 * sums that used to be here re-added the payments in TypeScript; these are the
 * engine's, so a payment in another currency makes them unchecked rather than
 * quietly left out (D-349). `undefined` is a figure the engine would not give.
 */
export interface DebtFigures {
  /** `principal_paid`: Σ each payment's `principal_part`, confirmed or not. */
  readonly principalPaid: Money | undefined
  /** `total_paid`: Σ `amount`, interest included. */
  readonly totalPaid: Money | undefined
  /** `interest_paid`: `total_paid - principal_paid`. */
  readonly interestPaid: Money | undefined
  /** `outstanding`: `principal - principal_paid`. */
  readonly outstanding: Money | undefined
  /** `unconfirmed`: Σ `principal_part` of the payments not yet confirmed. */
  readonly unconfirmed: Money | undefined
  /** `unconfirmed_count`. */
  readonly unconfirmedCount: number | undefined
  /** `progress`: `principal_paid / principal`, a share. */
  readonly progress: number | undefined
}

/**
 * What a debt has come down to, and what it is made of — **or why that cannot
 * be said**.
 *
 * The unconfirmed share is reported beside the total rather than withheld from
 * it: the money has left the account whether or not the user has agreed the app
 * read the row correctly, and docs/f08 asks for it to be **marked**, not
 * excluded. A balance that jumps when a queue is cleared is a balance nobody
 * trusts.
 *
 * **`UNCHECKED` is a variant, never a smaller number** (D-349): a payment in
 * another currency, or interest in another currency than its payment, leaves the
 * document no subtraction to make — there is no rate here (D-003) — and a total
 * that skipped the row would be the ₪0.00 payslip again (D-138).
 */
export type DebtBalance =
  | {
      readonly kind: 'KNOWN'
      readonly principal: Money
      /** Σ principal part, confirmed and not. What outstanding counts down by. */
      readonly principalPaid: Money
      readonly interestPaid: Money
      /** Σ `amount`. What actually left the account, interest included. */
      readonly totalPaid: Money
      /** `principal − principalPaid`. Negative when overpaid; see `overpaidBy`. */
      readonly outstanding: Money
      /** How much of `principalPaid` is still awaiting an answer. */
      readonly unconfirmedPrincipal: Money
      readonly unconfirmedCount: number
      /** Paid ÷ principal, capped at 100%. Undefined when the principal is zero. */
      readonly progressBasisPoints: number | undefined
      /** docs/f08's "overpaid by X", which offers to close the debt. */
      readonly overpaidBy: Money | undefined
      readonly isSettled: boolean
    }
  | {
      readonly kind: 'UNCHECKED'
      readonly principal: Money
      /** Why the payments do not add up to one figure, in a sentence. */
      readonly reason: string
      readonly unconfirmedCount: number
    }

/** The sentence an unchecked balance carries. */
export const MIXED_CURRENCY_REASON =
  'A payment here is in another currency than the debt, or its interest in another than the payment, and ' +
  'nothing in this document knows a rate between them — so what is owed is not one figure.'

/** A debt's balance from what the document works out about it (M36 U03). */
export function debtBalance(debt: Debt, figures: DebtFigures): DebtBalance {
  const principal = debt.principalAmount
  const currency = principal.currency
  const unconfirmedCount = figures.unconfirmedCount ?? 0
  const known = (one: Money | undefined): one is Money => one !== undefined && one.currency === currency
  const { principalPaid, totalPaid, interestPaid, outstanding, unconfirmed } = figures
  if (!known(principalPaid) || !known(totalPaid) || !known(interestPaid) || !known(outstanding) || !known(unconfirmed)) {
    return { kind: 'UNCHECKED', principal, reason: MIXED_CURRENCY_REASON, unconfirmedCount }
  }
  return {
    kind: 'KNOWN',
    principal,
    principalPaid,
    interestPaid,
    totalPaid,
    outstanding,
    unconfirmedPrincipal: unconfirmed,
    unconfirmedCount,
    progressBasisPoints: progressOf(figures.progress),
    overpaidBy: outstanding.minor < 0 ? abs(outstanding) : undefined,
    isSettled: outstanding.minor <= 0,
  }
}

/** One step of a debt coming down: what was outstanding, and from when. */
export interface BalancePoint {
  readonly date: LocalDate
  /** What was still owed immediately after this point. */
  readonly outstanding: Money
  /** The payment that produced it. Absent on the opening point. */
  readonly payment: DebtPayment | undefined
}

/**
 * What was owed, over time — docs/f08's balance-over-time chart.
 *
 * A step function rather than a series of samples, and that is the honest shape:
 * a debt does not drift downwards between payments, it sits still and then drops.
 * Anything that drew it as a smooth line would be inventing intermediate
 * balances that were never true on any day.
 *
 * It comes down by **principal**, so a payment that was mostly interest barely
 * moves the line — which is the fact the chart exists to make visible, and the
 * one a chart plotted from `amount` would hide in the flattering direction.
 *
 * It steps by each payment's `principalPart` — the document's figure — and a
 * payment with none, or in another currency, is not a step: there is no
 * subtraction to make (D-003), and the balance beside the chart says unchecked.
 */
export function balanceOverTime(
  debt: Debt,
  payments: readonly DebtPayment[],
): readonly BalancePoint[] {
  const currency = debt.principalAmount.currency
  const points: BalancePoint[] = [
    { date: debt.openedDate, outstanding: debt.principalAmount, payment: undefined },
  ]

  let running = debt.principalAmount
  for (const payment of sortPayments(payments)) {
    const part = payment.principalPart
    if (part === undefined || part.currency !== currency) continue
    running = subtract(running, part)
    points.push({ date: payment.date, outstanding: running, payment })
  }

  return points
}

/**
 * Paid ÷ principal, for the progress ring.
 *
 * Capped, because a ring past full is a drawing bug wearing the clothes of a
 * number, and the overpayment is already reported as its own figure. A debt with
 * no principal has no ratio at all rather than a zero one — F07's rule about
 * quotients, applied to the one division in this file.
 */
function progressOf(share: number | undefined): number | undefined {
  if (share === undefined) return undefined
  return Math.max(0, Math.min(10_000, shareBasisPoints(share)))
}

// --- When it will be paid off -----------------------------------------------

/** docs/f08's window: the average monthly payment over the last three. */
export const RECENT_PAYMENT_MONTHS = 3

/** Fifty years. Past it, a projection is arithmetic rather than information. */
export const PAYOFF_HORIZON_MONTHS = 600

/**
 * Where the monthly figure a projection divides by came from.
 *
 * `OBSERVED` is measured from what has actually been paid and wins when there is
 * enough of it; `EXPECTED` is the figure the user entered on the debt. Naming
 * which one is in play is the difference between "on this history" and "if you
 * pay what you said you would", and a screen cannot write either sentence from a
 * bare number of months.
 */
export const PAYOFF_BASES = ['OBSERVED', 'EXPECTED'] as const

export type PayoffBasis = (typeof PAYOFF_BASES)[number]

/**
 * When this debt runs out, or why that cannot be said.
 *
 * **"Cannot say" is a variant, never a zero.** One payment is not a rate — the
 * call `periodReturn` already made with `NEEDS_TWO_POINTS` (D-066) and for the
 * identical reason: a single point measures nothing, and a payoff date derived
 * from one would be a guess printed to the month.
 */
export type PayoffProjection =
  | { readonly kind: 'SETTLED' }
  /** The balance itself is unchecked — a payment in another currency — so nothing is counted down from. */
  | { readonly kind: 'UNCHECKED' }
  /** Nothing paid yet and no expected payment on the debt: nothing to divide by. */
  | { readonly kind: 'NO_BASIS' }
  /** One payment, and no expected figure to fall back to. */
  | { readonly kind: 'NEEDS_TWO_PAYMENTS' }
  /** All interest, or nothing at all, going in. The balance is not moving. */
  | { readonly kind: 'NOT_REDUCING'; readonly basis: PayoffBasis }
  | {
      readonly kind: 'BEYOND_HORIZON'
      readonly basis: PayoffBasis
      readonly monthlyPrincipal: Money
    }
  | {
      readonly kind: 'PROJECTED'
      readonly basis: PayoffBasis
      readonly monthlyPrincipal: Money
      readonly months: number
      readonly period: YearMonth
    }

/**
 * The monthly rate this debt is actually coming down at.
 *
 * **Per month, not per payment.** Three payments in one month are one month's
 * repayment, and dividing by the count would report a mortgage paid three times
 * as fast as it is. The window is the last `RECENT_PAYMENT_MONTHS` months that
 * carry a payment, and the divisor is the whole span they cover — so a quarterly
 * debt is measured across its gaps rather than as if it paid every month, which
 * is the same reasoning `CandidateMonth` applies to a fixed expense (D-053) and
 * the same trap `recentContributionRate` avoids for a fund.
 *
 * Undefined below two months of history, which is what makes
 * `NEEDS_TWO_PAYMENTS` a variant rather than a caption.
 */
function observedMonthlyPrincipal(
  payments: readonly DebtPayment[],
  currency: CurrencyCode,
): Money | undefined {
  const inCurrency = sortPayments(payments).filter(
    (payment) => payment.principalPart?.currency === currency,
  )
  if (inCurrency.length === 0) return undefined

  const byMonth = new Map<string, Money>()
  for (const payment of inCurrency) {
    const key = toYearMonthString(yearMonthOf(payment.date))
    byMonth.set(key, add(byMonth.get(key) ?? zero(currency), payment.principalPart ?? zero(currency)))
  }

  const months = [...byMonth.keys()].sort()
  const window = months.slice(-RECENT_PAYMENT_MONTHS)
  const first = window[0]
  const last = window[window.length - 1]
  if (first === undefined || last === undefined || window.length < 2) return undefined

  const total = sum(
    window.map((key) => byMonth.get(key) ?? zero(currency)),
    currency,
  )
  const span = monthsBetween(parseMonthKey(first), parseMonthKey(last)) + 1

  return money(Math.round(total.minor / span), currency)
}

/** The keys are built by `toYearMonthString`, so this parse cannot fail. */
function parseMonthKey(key: string): YearMonth {
  return { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) }
}

/**
 * docs/f08's projected payoff: outstanding ÷ the monthly repayment rate.
 *
 * `from` is the month to count forward from — passed in rather than read off a
 * clock, so a projection is a function of the document and rescans identically
 * on any day (D-062's rule about the settlement window, applied to the one other
 * place in the app that counts months forward).
 */
export function projectPayoff(
  debt: Debt,
  payments: readonly DebtPayment[],
  balance: DebtBalance,
  from: YearMonth,
): PayoffProjection {
  if (balance.kind === 'UNCHECKED') return { kind: 'UNCHECKED' }
  if (balance.isSettled) return { kind: 'SETTLED' }

  const currency = debt.principalAmount.currency
  const observed = observedMonthlyPrincipal(payments, currency)
  const expected =
    debt.monthlyPaymentAmount?.currency === currency ? debt.monthlyPaymentAmount : undefined

  const basis: PayoffBasis = observed !== undefined ? 'OBSERVED' : 'EXPECTED'
  const monthlyPrincipal = observed ?? expected

  if (monthlyPrincipal === undefined) {
    // A debt with exactly one payment knows something — that a payment happened
    // — and still cannot state a rate. Saying so is not the same as saying
    // nothing has been paid.
    const hasPayments = payments.some((payment) => payment.amount.currency === currency)
    return hasPayments ? { kind: 'NEEDS_TWO_PAYMENTS' } : { kind: 'NO_BASIS' }
  }

  if (monthlyPrincipal.minor <= 0) return { kind: 'NOT_REDUCING', basis }

  const months = Math.ceil(balance.outstanding.minor / monthlyPrincipal.minor)
  if (months > PAYOFF_HORIZON_MONTHS) {
    return { kind: 'BEYOND_HORIZON', basis, monthlyPrincipal }
  }

  return {
    kind: 'PROJECTED',
    basis,
    monthlyPrincipal,
    months,
    // The last payment lands at the end of the run, so a debt with one month to
    // go finishes this month rather than next.
    period: addMonths(from, months - 1),
  }
}

// --- What the splitter may subtract -----------------------------------------

/**
 * The debts this document finds payments for on its own.
 *
 * **Asked before a plan writes one**, because a plan payment and a discovered
 * payment are two rows for one movement of money, and a debt balance is Σ the
 * principal of its rows. A mortgage tracked by a merchant pattern already gains
 * a payment the month its standing order is imported; a payroll loan already
 * gains one the month its payslip is entered. Accepting a bucket that names
 * either would take the balance down twice for money that left once.
 *
 * **It is a warning and not a refusal** (D-190), which is the whole reason it is
 * a set of ids rather than a filter. The user may legitimately plan *extra* off
 * a tracked mortgage, and the app has no way to tell that apart from the double
 * — so it says which debts it already watches and leaves the judgement where the
 * rest of this app leaves it. Nothing here writes; `applyPlan` marks the
 * suggestion and the panel says the sentence.
 *
 * Both mechanisms in one answer, because they are one question. Tracking lives
 * on the debt; the payroll link lives on the deduction type and never on the
 * debt (D-083), so a caller asking only the side it happened to have would miss
 * half of them.
 */
export function selfDiscoveringDebts(
  debts: readonly Debt[],
  types: readonly DeductionType[],
): ReadonlySet<string> {
  const found = new Set<string>()
  for (const debt of debts) {
    if (!debt.isClosed && debt.tracking.kind !== 'NONE') found.add(debt.id)
  }
  const open = new Set(debts.filter((debt) => !debt.isClosed).map((debt) => debt.id))
  for (const type of types) {
    if (type.linkedDebtId !== undefined && open.has(type.linkedDebtId)) found.add(type.linkedDebtId)
  }
  return found
}

/**
 * The monthly debt obligation, and every debt whose payment must not be in it.
 *
 * **One function, because there is one rule to get right — and this milestone's
 * version of it has three ways to go wrong instead of D-053's one.** A debt
 * repayment already accounted for elsewhere in the plan and subtracted again as
 * an obligation makes every plan built on that basis wrong by its amount:
 *
 * - A **payroll-deducted loan** is out of net before the payslip is even
 *   entered. This is D-053's rule exactly, arriving at a second feature, and it
 *   is found the same way — by asking where the money already went.
 * - A **card installment** is charged to the card, and the card statement is
 *   already in the spending total. docs/f08 declines to model the monthly card
 *   charge as a rolling debt for precisely this reason; a promoted installment
 *   purchase is the same money reaching the same place by a different door.
 * - A **standing order the user has also recorded as a fixed expense** is
 *   subtracted by `fixedExpenseBasis` first. docs/04 says M6 computes that
 *   overlap by comparing the two refs rather than asking the user to maintain a
 *   third copy, and this is where the comparison pays for itself.
 *
 * All four groups come back, because a debt silently dropped from a total is
 * indistinguishable from one the app forgot about — `FixedExpenseBasis`' own
 * argument, and the reason that shape is worth copying rather than returning a
 * bare `Money`.
 */
export interface DebtObligationBasis {
  /** The monthly total that comes off the top, in `currency`. */
  readonly total: Money
  readonly subtracted: readonly Debt[]
  /** Fed by a payroll line. Real money, already out of net, never in `total`. */
  readonly alreadyOutOfNet: readonly Debt[]
  /** Paid by card slices, already inside the spending the plan is built on. */
  readonly alreadyInSpending: readonly Debt[]
  /** Already subtracted by `fixedExpenseBasis`, which names the same ref. */
  readonly alreadyAFixedExpense: readonly Debt[]
  /** Open debts with no monthly figure. Shown, not guessed at. */
  readonly noStatedPayment: readonly Debt[]
  readonly otherCurrency: readonly Debt[]
}

export function debtObligationBasis(
  debts: readonly DebtWithPayments[],
  balances: ReadonlyMap<string, DebtBalance>,
  types: readonly DeductionType[],
  expenses: readonly FixedExpense[],
  period: YearMonth,
  currency: CurrencyCode,
): DebtObligationBasis {
  const payrollFed = new Set(
    types.map((type) => type.linkedDebtId).filter((id): id is string => id !== undefined),
  )
  const liveExpenses = expenses.filter((expense) => isActiveIn(expense, period))

  const subtracted: Debt[] = []
  const alreadyOutOfNet: Debt[] = []
  const alreadyInSpending: Debt[] = []
  const alreadyAFixedExpense: Debt[] = []
  const noStatedPayment: Debt[] = []
  const otherCurrency: Debt[] = []

  for (const { debt } of debts) {
    if (debt.isClosed) continue
    // A settled debt still open in the document is not a monthly obligation. The
    // screen prompts to close it; the plan must not wait for the user to agree.
    const balance = balances.get(debt.id)
    if (balance?.kind === 'KNOWN' && balance.isSettled) continue

    // The three exclusions run before the currency check, so that a debt already
    // accounted for elsewhere cannot fall through into a group a future caller
    // might decide to sum. `fixedExpenseBasis` orders its own checks the same
    // way and for the same reason.
    if (payrollFed.has(debt.id)) {
      alreadyOutOfNet.push(debt)
      continue
    }
    if (debt.tracking.kind === 'CARD_INSTALLMENT_GROUP') {
      alreadyInSpending.push(debt)
      continue
    }
    if (liveExpenses.some((expense) => sharesTrackingRef(debt, expense))) {
      alreadyAFixedExpense.push(debt)
      continue
    }

    const payment = debt.monthlyPaymentAmount
    if (payment === undefined) {
      noStatedPayment.push(debt)
      continue
    }
    if (payment.currency !== currency) {
      otherCurrency.push(debt)
      continue
    }

    subtracted.push(debt)
  }

  return {
    total: sum(
      subtracted.map((debt) => debt.monthlyPaymentAmount ?? zero(currency)),
      currency,
    ),
    subtracted,
    alreadyOutOfNet,
    alreadyInSpending,
    alreadyAFixedExpense,
    noStatedPayment,
    otherCurrency,
  }
}

/** One overlap between a debt's tracking and a fixed expense's matching. */
export interface DebtExpenseOverlap {
  readonly debtId: string
  readonly expenseId: string
  /** The ref both of them name, for a message that can quote it. */
  readonly ref: string
}

/**
 * The debts and fixed expenses that are watching the same money.
 *
 * docs/04: "a debt tracked by merchant pattern names the same string this row's
 * `matchRef` does — M6 computes the overlap by comparing the two rather than
 * asking the user to maintain a third copy." This is that comparison, exported
 * because two screens need it for different sentences — the debt editor warns at
 * save time, and the plan says why an obligation is not in its total.
 */
export function debtFixedExpenseOverlaps(
  debts: readonly Debt[],
  expenses: readonly FixedExpense[],
): readonly DebtExpenseOverlap[] {
  const overlaps: DebtExpenseOverlap[] = []

  for (const debt of debts) {
    if (debt.isClosed) continue
    for (const expense of expenses) {
      if (!expense.isActive) continue
      if (!sharesTrackingRef(debt, expense)) continue
      overlaps.push({ debtId: debt.id, expenseId: expense.id, ref: trackingRef(debt) ?? '' })
    }
  }

  return overlaps
}

function trackingRef(debt: Debt): string | undefined {
  switch (debt.tracking.kind) {
    case 'MERCHANT_PATTERN':
      return debt.tracking.pattern
    case 'CATEGORY':
      return debt.tracking.categoryId
    case 'CARD_INSTALLMENT_GROUP':
      return debt.tracking.groupKey
    case 'NONE':
      return undefined
  }
}

/**
 * Are these two watching the same thing?
 *
 * A merchant pattern is compared through `normalizeMerchant`, so the two are
 * judged in the form the engine matches in rather than as the user happened to
 * type them — `שופרסל` and `שופרסל ` are one pattern, and a comparison that says
 * otherwise would let the same money be subtracted twice on a space.
 */
function sharesTrackingRef(debt: Debt, expense: FixedExpense): boolean {
  const ref = expense.matchRef
  if (ref === undefined) return false

  switch (debt.tracking.kind) {
    case 'MERCHANT_PATTERN':
      return (
        expense.matchKind === 'MERCHANT_PATTERN' &&
        normalizeMerchant(debt.tracking.pattern) === normalizeMerchant(ref) &&
        normalizeMerchant(ref) !== ''
      )
    case 'CATEGORY':
      return expense.matchKind === 'CATEGORY' && debt.tracking.categoryId === ref
    case 'CARD_INSTALLMENT_GROUP':
    case 'NONE':
      return false
  }
}

// --- Discovery --------------------------------------------------------------

/**
 * Where a discovered payment came from, in enough detail to say so on screen.
 *
 * F08's third acceptance criterion is that **every payment can name where it
 * came from**, and a criterion about a sentence is met by carrying what the
 * sentence needs rather than by a screen looking it up again later — by which
 * time the row may have been recategorized, the slip edited, or the file long
 * gone. `sourceKindOf` derives the stored enum from this, so the two cannot
 * drift.
 */
export type PaymentProvenance =
  | {
      readonly kind: 'TRANSACTION'
      readonly transactionId: string
      readonly merchantRaw: string
      readonly date: LocalDate
    }
  | {
      readonly kind: 'PAYCHECK'
      readonly paycheckId: string
      readonly period: YearMonth
      /** Which line types made it up, for "from your July payslip, Loan repayment". */
      readonly deductionTypeIds: readonly string[]
    }
  | {
      readonly kind: 'INSTALLMENT_SLICE'
      readonly transactionId: string
      readonly merchantRaw: string
      readonly date: LocalDate
      /** The "3" and the "12" of "3 of 12". */
      readonly sequence: number
      readonly total: number
    }

export function sourceKindOf(provenance: PaymentProvenance): PaymentSourceKind {
  return provenance.kind
}

/**
 * A payment the app believes happened, before anyone has agreed.
 *
 * **No id, and `sourceRefId` is not optional.** It is derived from the ledger
 * and the payslips every time anything asks, the shape `PayrollSavingDeposit`
 * (D-075) and `ExpectedContribution` (D-066) both take — and the required ref is
 * what makes docs/f08's uniqueness invariant unbreakable rather than merely
 * observed: there is no way to construct a discovered payment that cannot be
 * matched against one already recorded.
 */
export interface DiscoveredPayment {
  readonly debtId: string
  readonly sourceKind: PaymentSourceKind
  readonly sourceRefId: string
  readonly date: LocalDate
  /** A magnitude. What left the account towards this debt. */
  readonly amount: Money
  readonly provenance: PaymentProvenance
}

/**
 * One row that more than one debt claims.
 *
 * docs/f08 sends these to review with a debt picker, and the important half is
 * what is **not** produced: two unconfirmed payments against two balances. Both
 * would be marked, both would be wrong, and the sum of the two would be double
 * the money that moved. An answer the user has not given yet is better modelled
 * as a question than as two guesses.
 */
export interface AmbiguousMatch {
  readonly sourceRefId: string
  readonly amount: Money
  readonly provenance: PaymentProvenance
  /** The debts that all matched, in the order they were given. */
  readonly debtIds: readonly string[]
}

export interface PaymentDiscovery {
  readonly payments: readonly DiscoveredPayment[]
  readonly ambiguous: readonly AmbiguousMatch[]
  /** Claims dropped because the user has already said no to them. */
  readonly dismissed: number
}

export interface DiscoveryInput {
  readonly debts: readonly Debt[]
  /** The ledger rows to read. Already resolved to one date basis (D-006). */
  readonly transactions: readonly PaymentObservation[]
  readonly paychecks: readonly PaycheckWithLines[]
  /** Payroll links live here, not on the debt. See `AUTO_TRACK_KINDS`. */
  readonly deductionTypes: readonly DeductionType[]
  /**
   * The `paymentSourceKey`s the user has already rejected — "this charge is not
   * a payment on that loan".
   *
   * **A dismissal removes the debt from the claim, not the payment from the
   * result**, and the distinction is the whole reason this belongs in the domain
   * rather than in a filter over what comes out. A row dismissed for one debt
   * that a second debt also matches would otherwise arrive as an *ambiguity*
   * between two debts, one of which the user has already ruled out — the same
   * question again, wearing a shape that cannot be answered by repeating the
   * same answer. Filtered here, one claimant is left and the row becomes an
   * ordinary discovered payment for the debt that really does claim it.
   */
  readonly dismissedKeys?: ReadonlySet<string> | undefined
}

/** The ref a payroll payment is unique per. `paycheckId:debtId`, never a line id (D-075). */
export function payrollPaymentRef(paycheckId: string, debtId: string): string {
  return `${paycheckId}:${debtId}`
}

/**
 * The key a payment is unique per — docs/f08's invariant, written once so the
 * review queue, the repository's upsert and migration `020`'s index cannot
 * disagree about what "the same payment" means.
 *
 * The debt is **in** the key. One transaction can legitimately pay two debts
 * only when the user says so, and a key without the debt in it would silently
 * make that impossible while looking like it enforced something else.
 *
 * A `MANUAL` payment has no key at all: two identical payments entered by hand
 * on one day are two payments, because the user made two. `depositSourceKey`
 * draws the same line for the same reason (D-075).
 */
export function paymentSourceKey(
  debtId: string,
  sourceKind: PaymentSourceKind,
  sourceRefId: string | undefined,
): string | undefined {
  if (sourceKind === 'MANUAL' || sourceRefId === undefined) return undefined
  return `${debtId}:${sourceKind}:${sourceRefId}`
}

/**
 * Every payment the document implies, from all four mechanisms at once.
 *
 * One pass rather than four exported detectors, because ambiguity is a fact
 * about the *set* — a transaction claimed by a merchant pattern on one debt and
 * a category on another is only visible to something looking at both. Running
 * the mechanisms separately would produce two confident answers and no way to
 * notice they were about the same money.
 *
 * Payroll payments are exempt from that check by construction: they are keyed
 * per paycheck per debt and summed before they are emitted, so two lines feeding
 * one debt are one payment rather than an ambiguity.
 */
export function discoverPayments(input: DiscoveryInput): PaymentDiscovery {
  const open = input.debts.filter((debt) => !debt.isClosed)
  const dismissed = input.dismissedKeys ?? new Set<string>()
  const payroll = payrollPayments(open, input, dismissed)
  const payments: DiscoveredPayment[] = [...payroll.payments]
  const ambiguous: AmbiguousMatch[] = []
  let dropped = payroll.dismissed

  for (const observation of input.transactions) {
    // Only outflows. A refund at the merchant a mortgage is matched on is money
    // arriving, and counting it as a repayment would pay off the debt with the
    // bank's own money (D-004's sign convention, read rather than assumed).
    if (observation.amount.minor >= 0) continue

    const matched = open.filter((debt) => tracks(debt, observation))
    const claimants = matched.filter(
      (debt) => !dismissed.has(observationKey(debt, observation)),
    )
    dropped += matched.length - claimants.length

    const first = claimants[0]
    if (first === undefined) continue

    const provenance = observationProvenance(observation, first)
    const amount = abs(observation.amount)

    if (claimants.length > 1) {
      ambiguous.push({
        sourceRefId: observation.id,
        amount,
        provenance,
        debtIds: claimants.map((debt) => debt.id),
      })
      continue
    }

    payments.push({
      debtId: first.id,
      sourceKind: sourceKindOf(provenance),
      sourceRefId: observation.id,
      date: observation.date,
      amount,
      provenance,
    })
  }

  return { payments, ambiguous, dismissed: dropped }
}

/** The key a claim on this row by this debt would be dismissed under. */
function observationKey(debt: Debt, observation: PaymentObservation): string {
  const kind = sourceKindOf(observationProvenance(observation, debt))
  return `${debt.id}:${kind}:${observation.id}`
}

/**
 * A slice is an `INSTALLMENT_SLICE` only for the debt that was promoted from its
 * own group. The same row reaching a debt by a merchant pattern is an ordinary
 * transaction, and calling it a slice would put "3 of 12" on a payment that has
 * nothing to do with the purchase.
 */
function observationProvenance(
  observation: PaymentObservation,
  debt: Debt,
): PaymentProvenance {
  const slice = observation.installment
  if (slice !== undefined && debt.tracking.kind === 'CARD_INSTALLMENT_GROUP') {
    return {
      kind: 'INSTALLMENT_SLICE',
      transactionId: observation.id,
      merchantRaw: observation.merchantRaw,
      date: observation.date,
      sequence: slice.sequence,
      total: slice.total,
    }
  }
  return {
    kind: 'TRANSACTION',
    transactionId: observation.id,
    merchantRaw: observation.merchantRaw,
    date: observation.date,
  }
}

function tracks(debt: Debt, observation: PaymentObservation): boolean {
  switch (debt.tracking.kind) {
    case 'NONE':
      return false
    case 'MERCHANT_PATTERN':
      return containsMerchant(observation.merchantNormalized, debt.tracking.pattern)
    case 'CATEGORY':
      return observation.categoryId === debt.tracking.categoryId
    case 'CARD_INSTALLMENT_GROUP':
      return observation.installment?.groupKey === debt.tracking.groupKey
  }
}

/**
 * What the payslips say was repaid, one payment per slip per debt.
 *
 * **Not one per line**, which is a correctness requirement rather than a
 * tidiness one: `updatePaycheck` deletes a slip's lines and writes them again,
 * so a payment keyed on a `PaycheckLine.id` would be orphaned and recreated by
 * every correction — the exact duplication docs/f08's invariant forbids,
 * produced by the mechanism meant to prevent it. D-075 found this writing the
 * savings repository against the same relationship, and it is the same fix.
 *
 * The employee side only. An employer's share of a pension is the user's wealth
 * (D-048), but nobody else is paying off the user's loan, and an employer column
 * on a repayment line is a number about something else.
 */
function payrollPayments(
  debts: readonly Debt[],
  input: DiscoveryInput,
  dismissed: ReadonlySet<string>,
): { readonly payments: readonly DiscoveredPayment[]; readonly dismissed: number } {
  const byDebt = new Map(debts.map((debt) => [debt.id, debt]))
  const debtOfType = new Map<string, string>()
  for (const type of input.deductionTypes) {
    if (type.linkedDebtId !== undefined && byDebt.has(type.linkedDebtId)) {
      debtOfType.set(type.id, type.linkedDebtId)
    }
  }
  if (debtOfType.size === 0) return { payments: [], dismissed: 0 }

  const payments: DiscoveredPayment[] = []
  let dropped = 0

  for (const entry of input.paychecks) {
    const perDebt = new Map<string, { minor: number; typeIds: string[] }>()

    for (const line of entry.lines) {
      const debtId = debtOfType.get(line.deductionTypeId)
      if (debtId === undefined) continue
      const running = perDebt.get(debtId) ?? { minor: 0, typeIds: [] }
      running.minor += line.employeeAmount.minor
      running.typeIds.push(line.deductionTypeId)
      perDebt.set(debtId, running)
    }

    for (const [debtId, { minor, typeIds }] of perDebt) {
      // A slip whose lines cancel out repaid nothing, and a payment of zero is a
      // row that says something happened.
      if (minor === 0) continue

      const sourceRefId = payrollPaymentRef(entry.paycheck.id, debtId)
      if (dismissed.has(`${debtId}:PAYCHECK:${sourceRefId}`)) {
        dropped += 1
        continue
      }

      payments.push({
        debtId,
        sourceKind: 'PAYCHECK',
        sourceRefId,
        date: entry.paycheck.paymentDate,
        amount: money(Math.abs(minor), entry.paycheck.net.currency),
        provenance: {
          kind: 'PAYCHECK',
          paycheckId: entry.paycheck.id,
          period: entry.paycheck.period,
          deductionTypeIds: typeIds,
        },
      })
    }
  }

  return { payments, dismissed: dropped }
}

/**
 * The discovered payments that are not already recorded.
 *
 * **This is where idempotency actually happens**, and it is a set membership
 * test rather than a comparison of amounts or dates: re-importing the same
 * statement, re-saving the same payslip or rescanning the whole history reaches
 * the same keys and therefore produces nothing. F08's first acceptance criterion
 * — importing three months of statements twice gives the same balances — is this
 * function plus the key above.
 */
export function newPayments(
  discovered: readonly DiscoveredPayment[],
  existing: readonly DebtPayment[],
): readonly DiscoveredPayment[] {
  const keys = new Set(
    existing
      .map((payment) => paymentSourceKey(payment.debtId, payment.sourceKind, payment.sourceRefId))
      .filter((key): key is string => key !== undefined),
  )

  return discovered.filter(
    (payment) => !keys.has(`${payment.debtId}:${payment.sourceKind}:${payment.sourceRefId}`),
  )
}

/**
 * The ambiguities nobody has answered yet.
 *
 * `newPayments`' sibling, and the reason it has to exist: `discoverPayments`
 * reports an ambiguity as a fact about the *set* of debts, so it goes on
 * reporting it every scan however the user answered — the answer lives in the
 * payment table, not in the question. A queue that did not subtract the answers
 * would ask the same question after every import, forever.
 *
 * An ambiguity is answered when **any** of its claimants has a payment against
 * that row. Picking one debt is the whole of the answer: the other claimants
 * were never owed a payment, they were the alternatives.
 */
export function unresolvedAmbiguities(
  ambiguous: readonly AmbiguousMatch[],
  existing: readonly DebtPayment[],
): readonly AmbiguousMatch[] {
  const answered = new Set(
    existing
      .filter((payment) => payment.sourceRefId !== undefined && payment.sourceKind !== 'MANUAL')
      .map((payment) => payment.sourceRefId),
  )

  return ambiguous.filter((match) => !answered.has(match.sourceRefId))
}

/**
 * The kinds `discoverPayments` produces, and therefore the only kinds whose
 * source row this file can look for.
 *
 * **Named rather than written as "not MANUAL"**, which is what it used to be and
 * what D-190 had to correct. `MANUAL` was the only kind with no discoverable
 * source until a plan wrote one: a `FROM_PLAN` payment has a ref, and the ref
 * names a bucket of a plan — something `paymentReview` never enumerates, so
 * every plan payment in the document would have been reported as orphaned the
 * moment it was written, on a screen whose whole job is to be believed. An
 * exclusion list of one is how that happens; a list of what *is* checked leaves
 * the next kind out by default, which is the safe direction.
 */
const DISCOVERED_SOURCE_KINDS: ReadonlySet<PaymentSourceKind> = new Set([
  'TRANSACTION',
  'PAYCHECK',
  'INSTALLMENT_SLICE',
])

/**
 * Payments whose source is gone from the document.
 *
 * docs/f08: surfaced, never silently deleted — "nothing is auto-deleted"
 * (docs/conventions.md), and a payment quietly removed because a transaction was
 * would move a balance with no record of why.
 *
 * The test is whether the **source row** still exists, not whether it would
 * still be discovered. A user who narrows a merchant pattern has changed their
 * mind about future rows; they have not claimed the payment never happened, and
 * reporting the whole history as orphaned every time a pattern is edited would
 * make the signal worthless.
 *
 * Only the discovered kinds are judged at all — see above.
 */
export function orphanedPayments(
  payments: readonly DebtPayment[],
  liveSourceRefIds: ReadonlySet<string>,
): readonly DebtPayment[] {
  return payments.filter(
    (payment) =>
      DISCOVERED_SOURCE_KINDS.has(payment.sourceKind) &&
      payment.sourceRefId !== undefined &&
      !liveSourceRefIds.has(payment.sourceRefId),
  )
}

/**
 * What pointing one debt's tracking at a merchant would do — the labeling
 * queue's second promotion (docs/f06), decided here rather than on the screen.
 *
 * The promotion writes no payment. It points a debt at the name and lets
 * discovery find every charge, past and future, which is the only shape that
 * matches a queue whose whole premise is one decision per counterparty. So the
 * question the screen has to answer is not "which debt" but **"what happens to
 * this debt if I say yes"**, and every answer below is a sentence it prints.
 *
 * `REFUSED` for a split purchase is the same refusal docs/f08 already makes by
 * name in the plugin, arriving from the other side: a `CARD_INSTALLMENT_GROUP`
 * debt's payments are its slices, and replacing that tracking would stop the
 * remaining slices being discovered and orphan the ones already found. A debt
 * that tracks a *category* is only `REPLACES` — it loses a mechanism the user
 * chose, and the screen says which one before it goes.
 */
export type TrackingOffer =
  /** Tracks nothing. Pointing it here takes nothing away. */
  | { readonly kind: 'FREE' }
  /** Already claims these charges — the pattern it has matches this name. */
  | { readonly kind: 'ALREADY'; readonly pattern: string }
  /** Would take a live mechanism away, named so the screen can print it. */
  | { readonly kind: 'REPLACES'; readonly current: AutoTracking }
  | { readonly kind: 'REFUSED'; readonly reason: 'CLOSED' | 'INSTALLMENT_GROUP' }

export function trackingOffer(debt: Debt, merchantNormalized: string): TrackingOffer {
  // A closed debt is skipped by discovery entirely, so pointing it at a name
  // would write a pattern that finds nothing and say it had done something.
  if (debt.isClosed) return { kind: 'REFUSED', reason: 'CLOSED' }

  switch (debt.tracking.kind) {
    case 'NONE':
      return { kind: 'FREE' }
    case 'CARD_INSTALLMENT_GROUP':
      return { kind: 'REFUSED', reason: 'INSTALLMENT_GROUP' }
    case 'MERCHANT_PATTERN':
      return containsMerchant(merchantNormalized, debt.tracking.pattern)
        ? { kind: 'ALREADY', pattern: debt.tracking.pattern }
        : { kind: 'REPLACES', current: debt.tracking }
    case 'CATEGORY':
      return { kind: 'REPLACES', current: debt.tracking }
  }
}

/**
 * The debts whose current tracking already claims this merchant's charges.
 *
 * What it is for is the warning, not the list: a second debt pointed at a name
 * one debt already claims turns every one of those rows into an **ambiguity**
 * rather than a payment — `discoverPayments` refuses to guess between two
 * claimants — and the user would be left with a queue of questions where they
 * expected a balance to move.
 */
export function debtsClaiming(
  debts: readonly Debt[],
  merchantNormalized: string,
): readonly Debt[] {
  return debts.filter((debt) => trackingOffer(debt, merchantNormalized).kind === 'ALREADY')
}

// --- Card installments ------------------------------------------------------

/** docs/f08's default: a purchase split more ways than this is worth offering as a debt. */
export const DEFAULT_INSTALLMENT_PROMOTION_THRESHOLD = 3

/**
 * A purchase the user could promote to a debt, and everything the offer needs.
 *
 * docs/f08 calls this the case most apps get wrong: twelve slices' worth of
 * money is owed the moment the purchase is made, and only one slice appears in
 * each statement. The candidate is **derived and never stored** — regenerated
 * from the ledger every time anything asks, the shape `FixedExpenseCandidate`
 * takes and for the same reason (docs/f09).
 */
export interface InstallmentDebtCandidate {
  readonly groupKey: string
  readonly merchantNormalized: string
  /** The spelling most of its slices use, so the offer names something recognizable. */
  readonly merchantRaw: string
  /** The "12" of "3 of 12". */
  readonly paymentCount: number
  readonly slicesSeen: number
  /** `paymentCount − the highest sequence seen`. What is still to be charged. */
  readonly remainingSlices: number
  /** Σ the slices already charged. */
  readonly chargedSoFar: Money
  /** The most recent slice's amount, which is what the remaining ones will be. */
  readonly sliceAmount: Money
  /**
   * What promoting this would set as the principal, and on whose word.
   *
   * `STATED` is the total the file printed on the row (`original_total_minor`,
   * on the ledger since migration `007` — landed in M1 precisely because M6
   * would need it and could not ask the file again). `ESTIMATED` is slice ×
   * count, which is a number no file ever said: `installmentGroupKey` refuses to
   * invent it for a key, and this is allowed to only because it is shown to the
   * user for confirmation before it becomes anything. The basis travels with the
   * figure so the offer can say which it is — `ExpectedReturn`'s move (D-074).
   */
  readonly principal: { readonly amount: Money; readonly basis: 'STATED' | 'ESTIMATED' }
  readonly firstChargeDate: LocalDate
  readonly lastChargeDate: LocalDate
}

export interface InstallmentCandidateOptions {
  /** Purchases split into more than this many payments. Default 3. */
  readonly threshold?: number
  /** Groups already promoted, which must not be offered twice. */
  readonly promotedGroupKeys?: ReadonlySet<string>
}

export function installmentDebtCandidates(
  observations: readonly PaymentObservation[],
  options?: InstallmentCandidateOptions,
): readonly InstallmentDebtCandidate[] {
  const threshold = options?.threshold ?? DEFAULT_INSTALLMENT_PROMOTION_THRESHOLD
  const promoted = options?.promotedGroupKeys ?? new Set<string>()

  const candidates: InstallmentDebtCandidate[] = []

  for (const group of groupSlices(observations)) {
    if (promoted.has(group.groupKey)) continue
    if (group.paymentCount <= threshold) continue
    candidates.push(toCandidate(group))
  }

  return candidates.sort((a, b) => a.groupKey.localeCompare(b.groupKey))
}

/**
 * What is still owed on card installments across every group, promoted or not.
 *
 * docs/f08 shows this as one figure on the debts screen "because that money is
 * committed regardless". **Future slices only**: the ones already charged have
 * left the account and are in the spending totals, and adding them here would
 * report the same money as both spent and owed — the mistake this milestone's
 * obligation basis exists to prevent, arriving in a different feature.
 */
export function outstandingInstallmentTotal(
  observations: readonly PaymentObservation[],
  currency: CurrencyCode,
): Money {
  let minor = 0

  for (const group of groupSlices(observations)) {
    if (group.sliceAmount.currency !== currency) continue
    const remaining = Math.max(0, group.paymentCount - group.highestSequence)
    minor += remaining * Math.abs(group.sliceAmount.minor)
  }

  return money(minor, currency)
}

interface SliceGroup {
  readonly groupKey: string
  readonly merchantNormalized: string
  readonly merchantRaw: string
  readonly paymentCount: number
  readonly highestSequence: number
  readonly slices: readonly PaymentObservation[]
  readonly sliceAmount: Money
  readonly originalTotal: Money | undefined
  readonly firstDate: LocalDate
  readonly lastDate: LocalDate
}

function groupSlices(observations: readonly PaymentObservation[]): readonly SliceGroup[] {
  const groups = new Map<string, PaymentObservation[]>()

  for (const observation of observations) {
    const slice = observation.installment
    // A one-payment "installment" is an ordinary charge, and a group with no
    // count cannot say what is left to pay.
    if (slice === undefined || slice.total <= 1) continue
    const bucket = groups.get(slice.groupKey)
    if (bucket === undefined) groups.set(slice.groupKey, [observation])
    else bucket.push(observation)
  }

  const result: SliceGroup[] = []

  for (const [groupKey, slices] of groups) {
    const ordered = [...slices].sort(
      (a, b) =>
        (a.installment?.sequence ?? 0) - (b.installment?.sequence ?? 0) ||
        compareDates(a.date, b.date),
    )
    const newest = ordered[ordered.length - 1]
    const first = ordered[0]
    if (newest === undefined || first === undefined) continue

    // Sequence order and date order usually agree, and a statement that lists a
    // slice out of order must not be able to make the first charge later than
    // the last.
    const dates = ordered.map((slice) => slice.date).sort(compareDates)

    result.push({
      groupKey,
      merchantNormalized: first.merchantNormalized,
      merchantRaw: commonestRaw(ordered),
      paymentCount: Math.max(...ordered.map((slice) => slice.installment?.total ?? 0)),
      highestSequence: Math.max(...ordered.map((slice) => slice.installment?.sequence ?? 0)),
      slices: ordered,
      sliceAmount: abs(newest.amount),
      originalTotal: ordered
        .map((slice) => slice.installment?.originalTotal)
        .find((total): total is Money => total !== undefined),
      firstDate: dates[0] ?? first.date,
      lastDate: dates[dates.length - 1] ?? first.date,
    })
  }

  return result
}

function toCandidate(group: SliceGroup): InstallmentDebtCandidate {
  const currency = group.sliceAmount.currency
  const stated = group.originalTotal

  return {
    groupKey: group.groupKey,
    merchantNormalized: group.merchantNormalized,
    merchantRaw: group.merchantRaw,
    paymentCount: group.paymentCount,
    slicesSeen: group.slices.length,
    remainingSlices: Math.max(0, group.paymentCount - group.highestSequence),
    chargedSoFar: sum(
      group.slices.map((slice) => abs(slice.amount)),
      currency,
    ),
    sliceAmount: group.sliceAmount,
    principal:
      stated !== undefined && stated.currency === currency
        ? { amount: abs(stated), basis: 'STATED' }
        : {
            amount: money(Math.abs(group.sliceAmount.minor) * group.paymentCount, currency),
            basis: 'ESTIMATED',
          },
    firstChargeDate: group.firstDate,
    lastChargeDate: group.lastDate,
  }
}

/** The spelling most slices use, so a stray variant does not name the offer. */
function commonestRaw(slices: readonly PaymentObservation[]): string {
  const counts = new Map<string, number>()
  for (const slice of slices) {
    counts.set(slice.merchantRaw, (counts.get(slice.merchantRaw) ?? 0) + 1)
  }
  let best = slices[0]?.merchantRaw ?? ''
  let bestCount = 0
  for (const [raw, count] of counts) {
    if (count > bestCount) {
      best = raw
      bestCount = count
    }
  }
  return best
}

// --- The overview -----------------------------------------------------------

/**
 * Everything the debts screen puts at the top, and the net-worth figure's half
 * of the subtraction.
 *
 * `totalOutstanding` sums only debts in the document's currency; the rest are
 * listed, for the reason every total in this app lists what it could not
 * convert (D-003).
 */
export interface DebtsOverview {
  readonly totalPrincipal: Money
  readonly totalOutstanding: Money
  readonly totalPaid: Money
  readonly unconfirmedCount: number
  readonly openCount: number
  readonly settledButOpenCount: number
  readonly closedCount: number
  readonly otherCurrency: readonly Debt[]
  /** Open debts whose balance is unchecked — a payment in another currency — and so in no total. */
  readonly unchecked: readonly Debt[]
}

export function debtsOverview(
  debts: readonly DebtWithPayments[],
  balances: ReadonlyMap<string, DebtBalance>,
  currency: CurrencyCode,
): DebtsOverview {
  let totalPrincipal = zero(currency)
  let totalOutstanding = zero(currency)
  let totalPaid = zero(currency)
  let unconfirmedCount = 0
  let openCount = 0
  let settledButOpenCount = 0
  let closedCount = 0
  const otherCurrency: Debt[] = []
  const unchecked: Debt[] = []

  for (const { debt } of debts) {
    if (debt.isClosed) {
      closedCount += 1
      continue
    }
    if (debt.principalAmount.currency !== currency) {
      otherCurrency.push(debt)
      continue
    }

    const balance = balances.get(debt.id)
    if (balance === undefined) continue
    if (balance.kind === 'UNCHECKED') {
      // Counted as open and named, never added as a smaller figure (D-349).
      openCount += 1
      unconfirmedCount += balance.unconfirmedCount
      unchecked.push(debt)
      continue
    }
    openCount += 1
    if (balance.isSettled) settledButOpenCount += 1
    unconfirmedCount += balance.unconfirmedCount
    totalPrincipal = add(totalPrincipal, balance.principal)
    totalPaid = add(totalPaid, balance.totalPaid)
    // An overpaid debt does not reduce the total owed on the others: it is money
    // that has already left, not credit against a mortgage.
    totalOutstanding = add(
      totalOutstanding,
      balance.outstanding.minor > 0 ? balance.outstanding : zero(currency),
    )
  }

  return {
    totalPrincipal,
    totalOutstanding,
    totalPaid,
    unconfirmedCount,
    openCount,
    settledButOpenCount,
    closedCount,
    otherCurrency,
    unchecked,
  }
}

// --- Validation -------------------------------------------------------------

export type DebtProblem =
  | 'NO_NAME'
  | 'NON_POSITIVE_PRINCIPAL'
  | 'NEGATIVE_MONTHLY_PAYMENT'
  /** A tracking kind whose ref is blank: it would match everything or nothing. */
  | 'EMPTY_TRACKING_REF'
  | 'PATTERN_TOO_LONG'
  | 'ENDS_BEFORE_IT_STARTS'
  | 'MIXED_CURRENCY'

/**
 * What makes a debt unenterable, and nothing else — the shape `validateGoal`,
 * `validateSnapshot` and `validateFixedExpense` take.
 *
 * A debt with no expected end date and no monthly payment is perfectly valid:
 * money owed to a friend has neither, and `projectPayoff` already answers
 * `NO_BASIS` rather than treating it as an error.
 */
export function validateDebt(debt: Debt): readonly DebtProblem[] {
  const problems: DebtProblem[] = []

  if (debt.name.trim() === '') problems.push('NO_NAME')
  if (debt.principalAmount.minor <= 0) problems.push('NON_POSITIVE_PRINCIPAL')

  const monthly = debt.monthlyPaymentAmount
  if (monthly !== undefined) {
    if (monthly.minor < 0) problems.push('NEGATIVE_MONTHLY_PAYMENT')
    if (monthly.currency !== debt.principalAmount.currency) problems.push('MIXED_CURRENCY')
  }

  const ref = trackingRef(debt)
  if (debt.tracking.kind !== 'NONE') {
    if (ref === undefined || ref.trim() === '') problems.push('EMPTY_TRACKING_REF')
    else if (
      debt.tracking.kind === 'MERCHANT_PATTERN' &&
      debt.tracking.pattern.length > MAX_PATTERN_LENGTH
    ) {
      problems.push('PATTERN_TOO_LONG')
    }
  }

  if (
    debt.expectedEndDate !== undefined &&
    compareDates(debt.expectedEndDate, debt.openedDate) < 0
  ) {
    problems.push('ENDS_BEFORE_IT_STARTS')
  }

  return [...new Set(problems)]
}

export type DebtWarning =
  /** Two debts watching one pattern: docs/f08 warns at save time rather than refusing. */
  | 'TRACKING_SHARED_WITH_ANOTHER_DEBT'
  /** The overlap docs/04 asks M6 to compute rather than ask the user to maintain. */
  | 'TRACKING_SHARED_WITH_FIXED_EXPENSE'

/**
 * What is worth saying about a debt that can still be saved.
 *
 * Both of these describe a document that is *allowed* — two debts really can be
 * paid at one merchant, and a standing order really can be both a fixed expense
 * and a loan. What they cost is a decision the user has to make once, and
 * `discoverPayments` and `debtObligationBasis` both behave correctly meanwhile:
 * the first produces an ambiguity rather than two payments, the second leaves
 * the obligation out rather than subtracting it twice.
 */
export function debtWarnings(
  debt: Debt,
  others: readonly Debt[],
  expenses: readonly FixedExpense[],
): readonly DebtWarning[] {
  const warnings: DebtWarning[] = []
  const ref = trackingRef(debt)
  if (debt.tracking.kind === 'NONE' || ref === undefined) return warnings

  const rival = others.some(
    (other) =>
      other.id !== debt.id &&
      !other.isClosed &&
      other.tracking.kind === debt.tracking.kind &&
      sameRef(trackingRef(other), ref, debt.tracking.kind),
  )
  if (rival) warnings.push('TRACKING_SHARED_WITH_ANOTHER_DEBT')

  if (expenses.some((expense) => expense.isActive && sharesTrackingRef(debt, expense))) {
    warnings.push('TRACKING_SHARED_WITH_FIXED_EXPENSE')
  }

  return warnings
}

function sameRef(a: string | undefined, b: string, kind: Debt['tracking']['kind']): boolean {
  if (a === undefined) return false
  return kind === 'MERCHANT_PATTERN' ? normalizeMerchant(a) === normalizeMerchant(b) : a === b
}

export type PaymentProblem =
  | 'UNKNOWN_DEBT'
  /** docs/f08: blocked, and the screen offers to reopen the debt. */
  | 'CLOSED_DEBT'
  | 'ZERO_AMOUNT'
  | 'NEGATIVE_AMOUNT'
  | 'NEGATIVE_INTEREST'
  /** Interest larger than the payment: the debt would go up by paying it. */
  | 'INTEREST_EXCEEDS_PAYMENT'
  | 'MIXED_CURRENCY'

export interface PaymentContext {
  readonly debt: Debt | undefined
}

/**
 * What makes a payment unenterable.
 *
 * **Separate from `paymentWarnings` on purpose**, on the line docs/f08's
 * edge-case table draws: a payment into a closed debt is *blocked*, and one
 * larger than the balance is *allowed* — overpayment is a real thing that
 * happens, and refusing it would make the app argue with a bank transfer that
 * has already cleared. `validateDeposit` and `depositWarnings` split the same
 * way for the same reason (D-074).
 */
export function validatePayment(
  payment: DebtPayment,
  context: PaymentContext,
): readonly PaymentProblem[] {
  const problems: PaymentProblem[] = []
  const debt = context.debt

  if (debt === undefined) problems.push('UNKNOWN_DEBT')
  else if (debt.isClosed) problems.push('CLOSED_DEBT')

  if (payment.amount.minor === 0) problems.push('ZERO_AMOUNT')
  if (payment.amount.minor < 0) problems.push('NEGATIVE_AMOUNT')
  if (payment.interestPortion.minor < 0) problems.push('NEGATIVE_INTEREST')

  if (payment.interestPortion.currency !== payment.amount.currency) {
    problems.push('MIXED_CURRENCY')
  } else if (payment.interestPortion.minor > payment.amount.minor) {
    problems.push('INTEREST_EXCEEDS_PAYMENT')
  }

  if (debt !== undefined && payment.amount.currency !== debt.principalAmount.currency) {
    problems.push('MIXED_CURRENCY')
  }

  return [...new Set(problems)]
}

export type PaymentWarning = 'EXCEEDS_OUTSTANDING'

/**
 * What is worth saying about a payment that is still allowed.
 *
 * The balance it is judged against is computed from `existing` with this payment
 * taken out by id, so editing a payment does not warn about itself —
 * `depositWarnings` does the same, and for the same reason.
 */
export function paymentWarnings(
  payment: DebtPayment,
  debt: Debt,
  existing: readonly DebtPayment[],
): readonly PaymentWarning[] {
  if (payment.amount.currency !== debt.principalAmount.currency) return []

  const others = existing.filter(
    (other) => other.id !== payment.id && other.debtId === payment.debtId,
  )
  // What the other payments left owing: the chart's last step, by their parts.
  const steps = balanceOverTime(debt, others)
  const outstanding = steps[steps.length - 1]?.outstanding ?? debt.principalAmount
  const part = payment.principalPart
  if (part === undefined) return []

  return compare(part, outstanding) > 0 ? ['EXCEEDS_OUTSTANDING'] : []
}
