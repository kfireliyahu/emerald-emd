/**
 * What the home screen puts in front of you — the ranking, not the counting.
 *
 * Pure, like everything in `domain/`: the counts are gathered by the repository
 * and what happens here is the decision about **which of them matters most**,
 * which is the only part of a dashboard worth writing down.
 *
 * The ranking rule is one sentence: **first the thing that makes everything else
 * wrong.** Not the biggest number, not the newest — a hundred merchants left
 * unfiled is not a hundred small chores, it is every category total, every
 * comparison chip and every plan-vs-actual line on every other screen quietly
 * disagreeing with the truth. A dashboard sorted by count would put a stale
 * pension reading above that, and a user who worked down it in order would fix
 * the app's figures last.
 *
 * **An undecided card settlement outranks even that** (D-160). Unfiled rows make
 * the *breakdown* wrong; an unanswered settlement makes the **total** wrong, and
 * wrong by roughly double, because the card's monthly charge in the bank
 * statement is the same money as sixty rows in the card statement. A3 named this
 * as the reason bank import is its own feature note; it is first here for the
 * same reason.
 */

import type { YearMonth } from '@/core/time.ts'

export type AttentionKind =
  /**
   * Card charges found in a bank statement that nobody has said yes or no to.
   * Until they are answered the month is counted twice (docs/f06, A3, D-160).
   */
  | 'PENDING_SETTLEMENTS'
  /** Two rows that look like one transfer between the person's own accounts (D-356). */
  | 'PENDING_TRANSFERS'
  /** A card charge in the bank for a card with no statement: its spending is missing (docs/f06). */
  | 'UNMATCHED_CHARGES'
  /** An account with no statement for the newest month the document holds (M28 U5). */
  | 'MISSING_STATEMENT'
  /** Rows with no category. Everything downstream is wrong until these are filed. */
  | 'UNCATEGORIZED'
  /** Payments the app found and nobody has agreed with yet (docs/f08). */
  | 'UNCONFIRMED_PAYMENTS'
  /** Charges that look like a commitment, waiting to be confirmed or dismissed (docs/f09). */
  | 'FIXED_EXPENSE_CANDIDATES'
  /** A month with payslips before it and none in it. */
  | 'MISSING_PAYSLIP'
  /** A fund whose balance nobody has ever entered, so it is in no total. */
  | 'FUND_WITHOUT_BALANCE'
  /**
   * A holding with money in it that nobody has confirmed in months (D-176).
   *
   * The one item on this list about a figure that is *already* in every total
   * and may simply be wrong. Nothing arrives in the post to correct a `RECORDED`
   * balance, so the app has to be the thing that asks.
   */
  | 'UNCONFIRMED_HOLDING'

export interface AttentionItem {
  readonly kind: AttentionKind
  /** How many. Always at least 1 — a zero is not an item. Merchants, for UNCATEGORIZED. */
  readonly count: number
  /** The rows behind the count, where they differ from it: an uncategorized merchant's transactions. */
  readonly rows?: number
  /** The month this is about, where it is about one. */
  readonly period: YearMonth | undefined
  /** Where the fix is. A route, so the card is a link rather than an instruction. */
  readonly to: string
}

export interface AttentionInput {
  /**
   * Links in `PENDING`. The count is of *rows*, not of groups, because "3
   * credit-card charges" is what the queue itself says and two numbers for one
   * pile is how a dashboard stops being believed.
   */
  readonly pendingSettlements: number
  readonly pendingTransfers: number
  /** Card charges with no statement to match, by card. */
  readonly unmatchedCharges: number
  /** Accounts with no statement for the newest month. */
  readonly missingStatements: number
  /** Rows with no category, and the merchants they are at — what is answered, one per merchant. */
  readonly uncategorized: number
  readonly uncategorizedMerchants: number
  readonly unconfirmedPayments: number
  readonly fixedExpenseCandidates: number
  readonly fundsWithoutBalance: number
  /** Holdings holding money that nobody has checked lately (D-176). */
  readonly unconfirmedHoldings: number
  /**
   * The last complete month, when payslips exist for earlier months and not for
   * it. Undefined when there is nothing to notice — no payslips at all is a
   * document that does not do paychecks, not a document with one missing.
   */
  readonly missingPayslipFor: YearMonth | undefined
}

/**
 * Everything worth doing, most consequential first.
 *
 * The order is fixed rather than computed, because it is a judgement and not a
 * measurement — see the note at the top of this file. Items with a count of zero
 * are absent: a dashboard that lists "0 transactions need a category" is one
 * that teaches you to stop reading it.
 */
export function attention(input: AttentionInput): readonly AttentionItem[] {
  const items: AttentionItem[] = []
  const add = (kind: AttentionKind, count: number, to: string, period?: YearMonth): void => {
    if (count > 0) items.push({ kind, count, to, period })
  }

  // First, everything that makes a *total* wrong rather than a breakdown (M31 U1):
  // 1. Undecided settlements — the month counted twice, so wrong by double.
  add('PENDING_SETTLEMENTS', input.pendingSettlements, '/settings/accounts')
  // 2. A transfer between two accounts, counted as money in and money out.
  add('PENDING_TRANSFERS', input.pendingTransfers, '/settings/accounts')
  // 3. A card's charge with no statement behind it: its spending is missing.
  add('UNMATCHED_CHARGES', input.unmatchedCharges, '/settings/accounts')
  // 4. A statement not read: Went out is short.
  add('MISSING_STATEMENT', input.missingStatements, '/')
  // 5. Unfiled rows, because every figure on every other screen depends on them.
  //    Counted by merchant, because a merchant is what gets one answer.
  if (input.uncategorized > 0 && input.uncategorizedMerchants > 0) {
    items.push({ kind: 'UNCATEGORIZED', count: input.uncategorizedMerchants, rows: input.uncategorized, to: '/transactions/merchants', period: undefined })
  }
  // 6. Payments the app inferred. Money the user did not enter is counted against
  //    a debt on their behalf, and D-084's queue exists so they get to disagree.
  add('UNCONFIRMED_PAYMENTS', input.unconfirmedPayments, '/wealth/debts')
  // 7. Detected commitments. These change the splitter's basis once confirmed,
  //    so they are worth more than their count suggests — but they change a plan
  //    rather than a record, which is why they sit below a payment.
  add('FIXED_EXPENSE_CANDIDATES', input.fixedExpenseCandidates, '/plan')
  // 8. A month with no payslip. One number, but it is the number the splitter's
  //    whole basis is built on.
  if (input.missingPayslipFor !== undefined) {
    add('MISSING_PAYSLIP', 1, '/paychecks', input.missingPayslipFor)
  }
  // 9. A fund nobody has read. It is missing from net worth and from nothing
  //    else, which is why it is late and still here.
  add('FUND_WITHOUT_BALANCE', input.fundsWithoutBalance, '/wealth/funds')
  // 10. A balance nobody has checked. Last, and deliberately so: unlike every
  //    item above it, nothing here is *missing* — the figure is in every total
  //    already, and the only claim is that it may have drifted. That is worth
  //    saying and it is not worth saying loudly.
  add('UNCONFIRMED_HOLDING', input.unconfirmedHoldings, '/wealth')

  return items
}

/** The kinds that make this month's *totals* wrong until answered, not only a breakdown. */
export function changesTotals(kind: AttentionKind): boolean {
  return kind === 'PENDING_SETTLEMENTS' || kind === 'PENDING_TRANSFERS' || kind === 'UNMATCHED_CHARGES' || kind === 'MISSING_STATEMENT'
}

/** What the notice bar says: every answer waiting, and how many change a total (M31 U1). */
export function waitingCounts(items: readonly AttentionItem[]): { readonly all: number; readonly totals: number } {
  let all = 0
  let totals = 0
  for (const item of items) {
    all += item.count
    if (changesTotals(item.kind)) totals += item.count
  }
  return { all, totals }
}
