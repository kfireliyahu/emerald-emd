/**
 * Debts — the shapes. `Debt` and `DebtPayment` in docs/04-data-model.md, and
 * docs/f08-debts.md.
 *
 * Shapes only; the arithmetic is `@/domain/debt.ts`. Plain TypeScript: no React,
 * no sql.js, no DOM, no database (docs/conventions.md).
 *
 * Three things this model insists on, each of them a way a debt figure can be
 * quietly wrong:
 *
 * - **A debt has no balance.** There is no `outstanding` field here and there
 *   will not be one. It is `principalAmount` − Σ the principal of its payments,
 *   and docs/f08 opens by inverting the whole feature on that point: the
 *   question is not how a balance gets updated, it is how payments get
 *   discovered. The shape `SavingGoal` already takes for the same reason.
 * - **A tracking kind never travels without the thing it points at.**
 *   `autoTrackKind` and `autoTrackRef` are two columns in docs/04 and **one
 *   field** here, a discriminated union, so there is no way to hold
 *   `MERCHANT_PATTERN` with nothing to match or `CATEGORY` with a deduction
 *   type's id in the ref. That is `ExpectedReturn`'s move (D-074) applied to a
 *   pointer instead of a rate, and it matters more here: the ref is read by
 *   three different discovery mechanisms, and the wrong one reading it finds
 *   payments that never happened.
 * - **A payment states its interest, not its principal.** docs/04 lists
 *   `principalPortion` and `interestPortion` as two stored amounts, which is
 *   three money fields with an arithmetic relation between them and therefore
 *   two ways for one payment to disagree with itself. Only `interestPortion` is
 *   here; principal is `amount − interestPortion`, derived by the one function
 *   in the domain that knows it. "Defaults to all-principal" becomes an interest
 *   portion of zero, which is the same default reached without a second column
 *   to keep in step (D-083).
 */

import type { Money } from '@/core/money.ts'
import type { LocalDate } from '@/core/time.ts'

/** docs/04's list, unchanged. `CARD_INSTALLMENTS` is what a promoted purchase becomes. */
export const DEBT_KINDS = [
  'MORTGAGE',
  'BANK_LOAN',
  'CARD_INSTALLMENTS',
  'PAYROLL_LOAN',
  'PERSONAL',
  'OTHER',
] as const

export type DebtKind = (typeof DEBT_KINDS)[number]

/**
 * docs/f08 lists five, and `PAYROLL_DEDUCTION` is **not** among these four.
 *
 * That fact already has a home: `deduction_type.linked_debt_id`, on the model
 * since migration `012` and described there as "a payroll-deducted loan reduces
 * a debt". A debt naming a deduction type while the type names the debt is two
 * edges for one relationship, and the two can end up pointing at different
 * things — which is what D-037 removed from `CategoryRule` and what D-066
 * refused to add as `linkedDeductionTypeIds`. So payroll discovery reads the
 * link from the type, exactly as F13's expected contributions do, and the
 * deduction-types screen's **Pays into** select gains a third destination
 * beside a fund and a goal rather than the debt editor gaining a fourth
 * tracking kind (D-077's "one question, not two columns", D-083).
 *
 * A debt fed by a payroll line can still track a merchant pattern of its own.
 * Those are different questions and both answers survive.
 */
export const AUTO_TRACK_KINDS = [
  'NONE',
  'MERCHANT_PATTERN',
  'CATEGORY',
  'CARD_INSTALLMENT_GROUP',
] as const

export type AutoTrackKind = (typeof AUTO_TRACK_KINDS)[number]

/**
 * How this debt's payments are discovered, and what they are discovered from.
 *
 * One field rather than a kind and a loose string, so the ref cannot be absent,
 * cannot be left over from a kind the user changed away from, and cannot be read
 * by the wrong mechanism. Each variant names its ref after the thing it actually
 * is — a caller reading `categoryId` cannot be handed a merchant pattern by a
 * compiler that is paying attention.
 *
 * `NONE` is a real answer, not a missing one: money owed to a friend is paid
 * back in cash and entered by hand.
 */
export type AutoTracking =
  | { readonly kind: 'NONE' }
  /** Matched with `CONTAINS` semantics against the normalized merchant. */
  | { readonly kind: 'MERCHANT_PATTERN'; readonly pattern: string }
  | { readonly kind: 'CATEGORY'; readonly categoryId: string }
  | { readonly kind: 'CARD_INSTALLMENT_GROUP'; readonly groupKey: string }

/**
 * What is owed.
 *
 * `interestRatePct` is deliberately absent. docs/04 lists it as informational in
 * v1 and docs/f08 says there is no amortization engine, so a rate here would be
 * a number the domain never reads and a screen would be tempted to compute with.
 * It returns with the amortization schedule generator, where it does something.
 */
export interface Debt {
  readonly id: string
  readonly name: string
  readonly kind: DebtKind
  /** The original amount borrowed. What outstanding counts down from. */
  readonly principalAmount: Money
  readonly openedDate: LocalDate
  readonly expectedEndDate: LocalDate | undefined
  /** The expected payment, used for projecting a debt with no history yet. */
  readonly monthlyPaymentAmount: Money | undefined
  /** Where payments come from. Informational; discovery does not read it. */
  readonly linkedAccountId: string | undefined
  readonly tracking: AutoTracking
  /** Paid off or written off. Keeps its history; takes no new payments. */
  readonly isClosed: boolean
  readonly note: string | undefined
}

/**
 * Where a payment came from.
 *
 * `MANUAL` is the only kind with no source ref, and that is what makes it the
 * only kind that can legitimately repeat: two identical payments entered by hand
 * on one day are two payments, because the user made two.
 */
export const PAYMENT_SOURCE_KINDS = [
  'MANUAL',
  'TRANSACTION',
  /**
   * docs/04 calls this `PAYCHECK_LINE` and it is named for the payslip instead,
   * because a `PaycheckLine.id` does not survive an edit — `updatePaycheck`
   * deletes a slip's lines and writes them again, so a payment keyed on one
   * would be orphaned and recreated by every correction. D-075 found that while
   * writing the savings repository against the same relationship; the ref here
   * is `paycheckId:debtId` for the same reason.
   */
  'PAYCHECK',
  'INSTALLMENT_SLICE',
  /**
   * A bucket of a split plan the user accepted — `planId:period:bucketId`, the
   * ref `saving_deposit` already uses under the same name (D-190).
   *
   * **The bucket rather than the debt**, because two buckets in one plan may
   * point at the same debt on purpose ("mortgage" and "mortgage, extra from the
   * bonus") and keying on the debt would make the second overwrite the first.
   * `planDepositRef` drew that line first and this is the same line.
   */
  'FROM_PLAN',
] as const

export type PaymentSourceKind = (typeof PAYMENT_SOURCE_KINDS)[number]

/**
 * One payment against one debt.
 *
 * **`isConfirmed` is not a filter.** A discovered payment starts unconfirmed and
 * still counts towards the balance, because the money has left the account
 * whether or not the user has agreed the app read it correctly — docs/f08 asks
 * for it to be *marked*, not withheld. `debtBalance` reports the unconfirmed
 * share beside the total for exactly that reason.
 *
 * `interestPortion` is the only split stored: principal is the remainder, which
 * the pack declares (`principal_part`) and the document works out.
 */
export interface DebtPayment {
  readonly id: string
  readonly debtId: string
  readonly date: LocalDate
  /** The whole payment. A magnitude — direction is not a question a debt asks. */
  readonly amount: Money
  /**
   * The part that did not reduce what is owed. Zero unless the user says
   * otherwise, which is docs/04's all-principal default reached without a second
   * column that could disagree with this one.
   */
  readonly interestPortion: Money
  /**
   * **The part that reduced what is owed** — the payment less its interest, as
   * the document works it out (`debt_payment.principal_part`, M36 U03), read by
   * the repository. Undefined when the two are in different currencies: there
   * is no subtraction to make (D-003).
   */
  readonly principalPart: Money | undefined
  readonly sourceKind: PaymentSourceKind
  /** The transaction, the `paycheckId:debtId` pair, or the slice behind it. */
  readonly sourceRefId: string | undefined
  /** Auto-detected payments start false and appear in the review queue. */
  readonly isConfirmed: boolean
  readonly note: string | undefined
}

/**
 * One charge, as discovery reads it.
 *
 * Deliberately smaller than `StoredTransaction`, the shape `ExpenseObservation`
 * takes for the detector and for the same reasons: the domain is pure over rows,
 * the date basis has already been resolved by whoever built these (charge date
 * falling back to transaction date, D-006), and nothing in here can be traced
 * back to a database.
 */
export interface PaymentObservation {
  /** The transaction id. Becomes the payment's `sourceRefId`. */
  readonly id: string
  readonly merchantNormalized: string
  readonly merchantRaw: string
  readonly date: LocalDate
  /** Signed as stored: an outflow is negative (D-004). */
  readonly amount: Money
  readonly categoryId: string | undefined
  /** Present on an installment slice, which is what ties it to its purchase. */
  readonly installment: InstallmentSlice | undefined
}

/**
 * The installment fields of one row — "3 of 12", and what the purchase was.
 *
 * These have been on the ledger since migration `007`, which landed in M1 for a
 * reason recorded at the time: M6 needs them and cannot ask the file again.
 */
export interface InstallmentSlice {
  readonly sequence: number
  readonly total: number
  readonly groupKey: string
  /** What the file said the whole purchase cost, when it said. */
  readonly originalTotal: Money | undefined
}
