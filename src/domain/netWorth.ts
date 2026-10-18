/**
 * Net worth — **one figure, one meaning** (M36 U07).
 *
 * Pure functions over plain values, like everything else in `domain/`. Before
 * U07 the app computed this four ways — Home's from the deposits with no
 * statement in it, Overview's from the statements, the savings tool's `Total`
 * with no debt in it, and the money map's display override — and two screens
 * could print two figures under the same name. Now there is this one, which
 * every screen and tool reads through `netWorth` in the repository.
 *
 * **Everything owned, each once, less what is owed** — Overview's meaning since
 * M30 F6, because it is the only one of the four that counted the bank:
 *
 * - **In the bank** — the bank accounts' last statements (D-325), plus liquid
 *   money held outside them, less what is only set aside, which is still inside
 *   a statement (M28 F10). A bank account's own cash is inside its statement
 *   while it has one, and counted there and nowhere else (M30 F2).
 * - **Held** — liquid money at an account with holdings: reachable, and not
 *   in the bank (M30 F1).
 * - **Locked** — every holding that is not liquid and not inside a statement: a
 *   fixed deposit, a lock-up at a broker (M30 F6).
 * - **In funds** — each pension and study fund: **a fund is a holding** (M36
 *   U12, D-389), worth its latest reading like any other, and counted here
 *   rather than in Locked. Before U12 its balance came in beside the holdings,
 *   and a pension kept both ways counted twice.
 * - **Owed** — each debt's declared `outstanding`, never below zero.
 *
 * A holding is worth its latest reading where it has one and its deposits
 * otherwise (D-186, M36 U05 ruling 1); a debt the document cannot give one
 * figure for is **named, not summed** (D-349) — `gaps`.
 *
 * **Negative is a real answer.** Someone six months into a mortgage is worth
 * less than nothing on this measure, and clamping it would be the app lying.
 */

import { money, type CurrencyCode, type Money } from '@/core/money.ts'
import type { LocalDate } from '@/core/time.ts'
import type { HoldingBalance } from '@/domain/savings.ts'

/** What the figure is missing, said rather than absorbed. */
export type NetWorthGapKind =
  /** A deposit naming a holding place this document no longer has. Counted as locked. */
  | 'UNKNOWN_HOLDING'
  /** Deposits denominated in something else. There is no rate here (D-003). */
  | 'OTHER_CURRENCY_DEPOSIT'
  /** Debts denominated in something else, likewise. */
  | 'OTHER_CURRENCY_DEBT'
  /** A debt whose payments are in two currencies: what is owed is not one figure (D-349). */
  | 'UNCHECKED_DEBT'

export interface NetWorthGap {
  readonly kind: NetWorthGapKind
  readonly count: number
}

/** What one debt adds to what is owed. */
export type DebtOwed =
  /** In the document's currency. Negative when overpaid, which owes nothing (D-083). */
  | { readonly kind: 'OWED'; readonly outstanding: Money }
  | { readonly kind: 'OTHER_CURRENCY' }
  | { readonly kind: 'UNCHECKED' }

export interface NetWorthInput {
  readonly asOf: LocalDate
  readonly currency: CurrencyCode
  /** Σ the bank accounts' last statement balances in this currency (D-325). */
  readonly statements: Money
  /** Whether any bank account has a statement balance — what set-aside money is inside. */
  readonly hasStatements: boolean
  /** Every holding's balance, the funds among them — its latest reading, or its deposits up to `asOf`. */
  readonly holdings: readonly HoldingBalance[]
  /** A bank account's own cash while the account has a statement balance: inside `statements`. */
  readonly inStatement: ReadonlySet<string>
  /** Holdings at an account with holdings, or at a place linked to one. */
  readonly held: ReadonlySet<string>
  /** Money only set aside in a holding that is neither held nor inside a statement. */
  readonly setAside: Money
  readonly debts: readonly DebtOwed[]
  /** Deposits in another currency, which no balance above counts. */
  readonly otherCurrencyDeposits: number
}

export interface NetWorth {
  readonly asOf: LocalDate
  readonly currency: CurrencyCode
  /** The statements plus liquid money outside them, less what is only set aside (inside a statement). Never below the statements. */
  readonly inBank: Money
  /** Liquid money in accounts with holdings: reachable, and not in the bank. */
  readonly held: Money
  /** Every holding that is not liquid, not a fund and not inside a statement. */
  readonly locked: Money
  /** The holdings that are funds (D-389), each its latest reading. */
  readonly funds: Money
  /** Outstanding on every debt in this currency. Never negative. */
  readonly liabilities: Money
  /** `inBank + held + locked + funds − liabilities`. **Negative is a real answer.** */
  readonly worth: Money
  /** What this figure does not know. Empty when it knows everything it can. */
  readonly gaps: readonly NetWorthGap[]
  /** True when the document holds no statement balance, no savings, no fund reading and no debt at all. */
  readonly isEmpty: boolean
}

/** The one net worth, from its parts. */
export function netWorthOf(input: NetWorthInput): NetWorth {
  const { currency } = input
  const total = (keep: (row: HoldingBalance) => boolean): number =>
    input.holdings.filter(keep).reduce((sum, row) => sum + row.balance.minor, 0)
  const counted = (row: HoldingBalance): boolean => !input.inStatement.has(row.holdingId)
  const isFund = (row: HoldingBalance): boolean => row.holding?.fundType !== undefined

  const held = total((row) => row.isLiquid && !isFund(row) && input.held.has(row.holdingId))
  const elsewhere = total((row) => row.isLiquid && !isFund(row) && !input.held.has(row.holdingId) && counted(row))
  const locked = total((row) => !row.isLiquid && !isFund(row) && counted(row))
  const funds = total(isFund)
  // Set aside is still inside a statement, so it is not outside it (M28 F10) —
  // while there is a statement balance for it to be inside. Without one it is
  // counted nowhere else, and stays, as a bank account's own cash does (M30 F2).
  const inside = input.hasStatements ? Math.max(0, input.setAside.minor) : 0
  const outside = Math.max(0, elsewhere - inside)
  const inBank = input.statements.minor + outside

  const liabilities = input.debts.reduce(
    (sum, one) => (one.kind === 'OWED' ? sum + Math.max(0, one.outstanding.minor) : sum),
    0,
  )

  const gaps: NetWorthGap[] = []
  const push = (kind: NetWorthGapKind, count: number): void => {
    if (count > 0) gaps.push({ kind, count })
  }
  push('UNKNOWN_HOLDING', input.holdings.filter((row) => row.holding === undefined).length)
  push('OTHER_CURRENCY_DEPOSIT', input.otherCurrencyDeposits)
  push('OTHER_CURRENCY_DEBT', input.debts.filter((one) => one.kind === 'OTHER_CURRENCY').length)
  push('UNCHECKED_DEBT', input.debts.filter((one) => one.kind === 'UNCHECKED').length)

  return {
    asOf: input.asOf,
    currency,
    inBank: money(inBank, currency),
    held: money(held, currency),
    locked: money(locked, currency),
    funds: money(funds, currency),
    liabilities: money(liabilities, currency),
    worth: money(inBank + held + locked + funds - liabilities, currency),
    gaps,
    isEmpty:
      input.statements.minor === 0 &&
      input.holdings.every((row) => row.depositCount === 0 && row.valuation === undefined) &&
      input.debts.length === 0 &&
      input.otherCurrencyDeposits === 0,
  }
}

/** One gap, said in a few words: what the figure leaves out. */
export function describeGap(gap: NetWorthGap): string {
  const n = gap.count
  switch (gap.kind) {
    case 'UNKNOWN_HOLDING':
      return `${String(n)} ${n === 1 ? 'deposit names a holding' : 'deposits name holdings'} this document no longer has`
    case 'OTHER_CURRENCY_DEPOSIT':
      return `${String(n)} ${n === 1 ? 'deposit' : 'deposits'} in another currency`
    case 'OTHER_CURRENCY_DEBT':
      return `${String(n)} ${n === 1 ? 'debt' : 'debts'} in another currency`
    case 'UNCHECKED_DEBT':
      return `${String(n)} ${n === 1 ? 'debt has' : 'debts have'} payments in two currencies`
  }
}
