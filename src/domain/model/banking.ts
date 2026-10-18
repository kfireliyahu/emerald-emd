/**
 * Bank-statement import — the shapes. `CardSettlementLink` in
 * docs/04-data-model.md, and docs/f06-bank-statement-import.md.
 *
 * Plain TypeScript: no React, no sql.js, no DOM, no database
 * (docs/conventions.md). The arithmetic and the matching are
 * `@/domain/bankImport.ts`.
 *
 * Three things this model insists on, because a bank statement is the one file
 * that describes money the app has already counted from somewhere else:
 *
 * - **A class is derived, never stored.** `RowClass` is what the app *made* of a
 *   row, and what it makes of a row changes when the next card statement lands
 *   (D-060). Nothing the user confirmed lives here — that is
 *   `CardSettlementLink.userDecision` and `Account.excludeSettlementsFromStats`,
 *   both of which persist.
 * - **A settlement is a group, not a row.** One card charged twice in a month is
 *   two rows and one settlement, and comparing either row on its own against the
 *   card's monthly total would say they disagree when they add up exactly
 *   (docs/f06's split-charge case).
 * - **The last-4 lives in `merchantRaw`.** `normalizeMerchant` strips a trailing
 *   run of digits as a branch number, so the four digits the whole mechanism
 *   turns on are gone from `merchantNormalized` by the time it is written. Every
 *   field in here that is matched against carries the raw text and says so.
 */

import type { Money } from '@/core/money.ts'
import type { LocalDate, YearMonth } from '@/core/time.ts'

/**
 * What a bank row turned out to be — docs/f06 pipeline step 10.
 *
 * The first two are the ones that exist for a reason beyond reporting: a
 * `CARD_SETTLEMENT` double-counts a card statement and a `SALARY` double-counts
 * a paycheck. The rest are labels that make the cash-flow view readable, and the
 * last two are the honest answer when nothing else fits.
 */
export const ROW_CLASSES = [
  'CARD_SETTLEMENT',
  'SALARY',
  'INTERNAL_TRANSFER',
  'LOAN_PAYMENT',
  'DIRECT_DEBIT',
  'CHEQUE',
  'FEE',
  'INTEREST',
  'OTHER_INFLOW',
  'OTHER_OUTFLOW',
] as const

export type RowClass = (typeof ROW_CLASSES)[number]

/** How sure the app is that a bank row settles a particular card. docs/04. */
export type MatchConfidence = 'HIGH' | 'MEDIUM' | 'LOW'

/**
 * What the user said about a settlement.
 *
 * `PENDING` is not a third opinion, it is the absence of one, and it is why
 * `Account.excludeSettlementsFromStats` is nullable: "not yet asked" and "asked,
 * and the answer was keep them" are different facts about a card.
 */
export type SettlementDecision = 'EXCLUDED' | 'KEPT' | 'PENDING'

/**
 * One parsed bank row, as the classifier sees it.
 *
 * `descriptionRaw` rather than a normalized name: this is the field the last-4
 * is read out of, and normalization eats it. `ref` is the `sourceRowRef` of the
 * draft it came from, so anything reported about a row can name it.
 */
export interface BankRow {
  readonly ref: string
  readonly date: LocalDate
  /** Signed, as everywhere else: negative is money out (D-004). */
  readonly amount: Money
  readonly descriptionRaw: string
  readonly descriptionNormalized: string
  /** The running balance the file states for this row, when it states one. */
  readonly balance?: Money | undefined
}

/**
 * A card, as the matcher needs it. A slice of `Account`, passed in rather than
 * looked up — this file does not read a database.
 */
export interface CardAccountRef {
  readonly id: string
  readonly name: string
  /** Four digits, or nothing. An account with none can never match a settlement. */
  readonly last4?: string | undefined
  /** The remembered answer. `undefined` means the user has not been asked. */
  readonly excludeSettlementsFromStats?: boolean | undefined
}

/**
 * What one card statement came to, for one billing period.
 *
 * The corroboration input: a settlement whose amount equals one of these is
 * settling that period, which is how the period is identified rather than
 * guessed from the charge date. `total` is a **magnitude** — the sum of a card
 * statement is a negative number and the bank's charge for it is a negative
 * number, and comparing the two through their signs is one place to get a minus
 * wrong for nothing.
 */
export interface CardPeriodTotal {
  readonly accountId: string
  readonly period: YearMonth
  readonly total: Money
}

/** A row with the app's reading of it. The reading is derived; see the header. */
export interface ClassifiedBankRow {
  readonly row: BankRow
  readonly rowClass: RowClass
  /** Present exactly when `rowClass` is `CARD_SETTLEMENT`. */
  readonly settlementGroupKey?: string | undefined
}

/**
 * One card's charge for one month — the rows, and what they were matched to.
 *
 * Grouped by card **and by the month the rows fall in**, which is what makes
 * both of docs/f06's awkward cases come out right: two charges in July are one
 * group and are summed before comparing, and a July charge and an August charge
 * are two groups compared against two different statements.
 */
export interface SettlementGroup {
  readonly key: string
  readonly cardAccountId: string
  readonly cardAccountName: string
  /** The four digits read out of the rows' description, when that is how it matched. */
  readonly last4?: string | undefined
  readonly rows: readonly BankRow[]
  /** What the bank charged. A magnitude. */
  readonly chargedTotal: Money
  /** Which card statement it settles, when the amount identified one. */
  readonly billingPeriod?: YearMonth | undefined
  /** What that statement came to. Absent when no period agreed. */
  readonly statementTotal?: Money | undefined
  readonly confidence: MatchConfidence
  readonly decision: SettlementDecision
  /**
   * The user told the app this merchant pays this card, rather than the words
   * or the last-4 doing it.
   *
   * Separate from `confidence`, which means one thing only: whether the amount
   * agreed with a card statement. A user-stated link with no agreeing statement
   * is still `MEDIUM`, because "somebody said so" and "the arithmetic
   * corroborates" are different claims and the screen shows both.
   */
  readonly isUserStated: boolean
}

/**
 * Four digits charged to a card this document does not have.
 *
 * docs/f06: this case matters more than a match. It means a month of card
 * spending is missing from the ledger and every statistic is quietly wrong, so
 * it is reported as its own thing rather than folded into `OTHER_OUTFLOW`.
 */
export interface UnmatchedSettlement {
  /** Absent when the bank omitted it and nothing else identified the card either. */
  readonly last4?: string | undefined
  readonly rows: readonly BankRow[]
  readonly chargedTotal: Money
}
