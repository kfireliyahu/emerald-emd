/**
 * Where a goal's money came from (M28 U8, D-324).
 *
 * **Three kinds, because that is what a person can tell apart**, and the
 * simplest of them was asked for: a deposit is *derived* from the bank,
 * *set aside* (conceptual: it is still inside the account, promised to the goal
 * and moved nowhere), or *was already there* (what the goal held before the
 * document knew about it). Growth is the fourth thing in the balance and is not a
 * deposit at all, so it is named apart rather than hidden in one of the three.
 *
 * The kinds are a reading of `sourceKind`, not a new column: nothing is stored
 * twice, so the two cannot disagree.
 *
 * Pure: no database, no clock.
 */

import { money, type CurrencyCode, type Money } from '@/core/money.ts'
import type { DepositSourceKind, SavingDeposit } from './model/savings.ts'

export const DEPOSIT_ORIGINS = ['DERIVED', 'SET_ASIDE', 'ALREADY_THERE', 'GROWTH'] as const
export type DepositOrigin = (typeof DEPOSIT_ORIGINS)[number]

const ORIGIN: Readonly<Record<DepositSourceKind, DepositOrigin>> = {
  // Read from a document: a transaction filed under the goal's category, or a
  // payslip line that feeds it. Nobody typed the amount.
  FROM_TRANSACTION: 'DERIVED',
  FROM_PAYCHECK_DEDUCTION: 'DERIVED',
  // Said by a person or by a plan: the money is still where it was.
  MANUAL: 'SET_ASIDE',
  FROM_PLAN: 'SET_ASIDE',
  OPENING_BALANCE: 'ALREADY_THERE',
  GROWTH: 'GROWTH',
}

export function originOf(kind: DepositSourceKind): DepositOrigin {
  return ORIGIN[kind]
}

/** The source kind a person's choice writes. Derived is never typed: only the sync writes it. */
export function sourceKindForOrigin(origin: 'SET_ASIDE' | 'ALREADY_THERE'): DepositSourceKind {
  return origin === 'ALREADY_THERE' ? 'OPENING_BALANCE' : 'MANUAL'
}

export type OriginSplit = Readonly<Record<DepositOrigin, Money>>

/**
 * A goal's balance by kind. Sums to the balance exactly: every deposit lands in
 * one bucket, signs included, so a withdrawal reduces the kind it was taken from
 * and the four always add to what the goal holds.
 */
export function originSplit(deposits: readonly SavingDeposit[], currency: CurrencyCode): OriginSplit {
  const sums: Record<DepositOrigin, number> = { DERIVED: 0, SET_ASIDE: 0, ALREADY_THERE: 0, GROWTH: 0 }
  for (const deposit of deposits) {
    if (deposit.amount.currency !== currency) continue
    sums[originOf(deposit.sourceKind)] += deposit.amount.minor
  }
  return {
    DERIVED: money(sums.DERIVED, currency),
    SET_ASIDE: money(sums.SET_ASIDE, currency),
    ALREADY_THERE: money(sums.ALREADY_THERE, currency),
    GROWTH: money(sums.GROWTH, currency),
  }
}

// --- Deposits derived from the bank -----------------------------------------

/** One transaction filed under a goal's category. Negative `minor` is money out of the bank. */
export interface FiledTransaction {
  readonly id: string
  readonly date: string
  readonly minor: number
  readonly currency: CurrencyCode
}

/** The deposit a filed transaction stands for: out of the bank is into the goal. */
export interface WantedDeposit {
  readonly key: string
  readonly date: string
  readonly minor: number
  readonly currency: CurrencyCode
}

export function wantedDeposit(transaction: FiledTransaction): WantedDeposit {
  return {
    key: transaction.id,
    date: transaction.date,
    minor: -transaction.minor,
    currency: transaction.currency,
  }
}

// --- What a holding's rows put in, against what it cost ---------------------

/**
 * **What a holding's rows put in, checked against the cost basis a reading
 * printed** (M30 U4, D-357). A buy's amount is what left the account's cash,
 * its fee inside it, so the rows that name a holding sum to what the holding
 * cost; a sale takes back what it returned. Three answers and never a silent
 * fourth (D-149): the two agree to the agora, they do not, or there is nothing
 * to check against — no reading yet, or a row in another currency.
 */
export type CostBasisCheck =
  | { readonly kind: 'PROVED' }
  | { readonly kind: 'FAILED'; readonly printed: Money; readonly difference: Money }
  | { readonly kind: 'UNCHECKED'; readonly reason: string }

export function costBasisCheck(putIn: Money, printed: Money | undefined, otherCurrencies = 0): CostBasisCheck {
  if (otherCurrencies > 0) {
    return {
      kind: 'UNCHECKED',
      reason: `${String(otherCurrencies)} of its rows are in another currency, and a cost basis is one figure.`,
    }
  }
  if (printed === undefined) return { kind: 'UNCHECKED', reason: 'No reading of what it cost has been recorded yet.' }
  if (printed.currency !== putIn.currency) {
    return {
      kind: 'UNCHECKED',
      reason: `The reading printed its cost in ${printed.currency}, and the rows are in ${putIn.currency}.`,
    }
  }
  if (printed.minor === putIn.minor) return { kind: 'PROVED' }
  return { kind: 'FAILED', printed, difference: money(putIn.minor - printed.minor, putIn.currency) }
}

// --- The cushion ------------------------------------------------------------

/** A month is 10,000 of the basis points the emergency target is stored in. */
export const MONTH_BASIS_POINTS = 10_000

/** The most months a cushion can be, the emergency target's own ceiling. */
export const MAX_CUSHION_MONTHS = 24

export function monthsToBasisPoints(months: number): number {
  return Math.round(months * MONTH_BASIS_POINTS)
}

/** Whether a figure is a month count a cushion can be: above zero, to two places, at most two years. */
export function isCushionMonths(months: number): boolean {
  return Number.isFinite(months) && months > 0 && months <= MAX_CUSHION_MONTHS && Math.round(months * 100) > 0
}
