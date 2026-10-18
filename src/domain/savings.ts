/**
 * Savings math — balances, progress and liquidity. docs/f07-savings-and-deposits.md and
 * docs/04-data-model.md's Savings section.
 *
 * Pure functions over plain values: no database, no clock, no React. Written and
 * tested before a screen exists, exactly as M2 opened with the rules engine, M3
 * with the paycheck figures, M4 with the fixed-expense detector, M5 with the
 * bank-import domain and F13 with `domain/funds.ts`.
 *
 * Three things hold everywhere in here:
 *
 * - **A balance is never handed in, only computed.** No function in this file
 *   takes a balance as a parameter, and every one that reports a balance sums it
 *   from the deposits it was given. docs/f07 says drift in a savings number
 *   destroys trust faster than any other bug here, and the way to make drift
 *   impossible is to leave no signature that can carry a stale one — the shape
 *   `fixedExpenseBasis` (D-053), `bankSpendingBasis` (D-060) and `periodReturn`
 *   (D-066) each took for their own milestone's one dangerous rule.
 * - **Liquid is a property of the holding.** It was a property of the *place*
 *   until D-175, which is why a brokerage account used to have to be reachable
 *   or unreachable in one piece. What is in the bank for a rainy day is the
 *   cushion's question (D-360), and an Emergency goal is an ordinary goal
 *   (M36 U09).
 * - **"Cannot say" is a variant, not a zero.** A goal with no target, three
 *   months with no contribution — each is its own case with its own sentence, never a 0% ring
 *   or a divide-by-zero. F07's fourth acceptance criterion is that there is no
 *   division by zero anywhere in this file, and every quotient here is guarded
 *   by a variant rather than by a check a caller must remember.
 */

import { add, money, subtract, sum, type CurrencyCode, type Money } from '@/core/money.ts'
import { ratioBasisPoints, shareBasisPoints } from '@/core/percent.ts'
import type { GoalPartInput } from '@/domain/cushion.ts'
import {
  addMonths,
  compareDates,
  monthsBetween,
  toYearMonthString,
  yearMonthOf,
  type LocalDate,
  type YearMonth,
} from '@/core/time.ts'
import { NON_CONTRIBUTION_SOURCE_KINDS } from '@/domain/model/savings.ts'
import type {
  DepositSourceKind,
  Holding,
  HoldingKind,
  HoldingPlace,
  HoldingProvenance,
  SavingDeposit,
  SavingGoal,
} from '@/domain/model/savings.ts'
import type { DeductionType, PaycheckWithLines } from '@/domain/model/paycheck.ts'

// --- Deposits and balances --------------------------------------------------

/**
 * Whether this row is money the user actually set aside.
 *
 * An opening balance was already there and a gain was put there by the market,
 * and both are in the balance because the money is real (D-081) — but neither is
 * a contribution, and every figure in this file that measures *effort* has to
 * say so. Three of them do: the required-monthly rate, the completion estimate
 * and the contribution streak. A goal whose balance rose 8% in a good quarter
 * must not be reported as one the user is feeding, or the estimate flatters
 * exactly when it should not.
 *
 * A withdrawal **is** a contribution row, with a negative sign. Money the user
 * took back out is still the user moving money, and the rate that projects a
 * completion date is a net.
 */
export function isContribution(deposit: SavingDeposit): boolean {
  return !NON_CONTRIBUTION_SOURCE_KINDS.includes(deposit.sourceKind)
}

/**
 * The one summation. Every balance in this file goes through it.
 *
 * Private on purpose: a caller with its own `Σ deposits` is a second answer to
 * the question this feature is most easily wrong about, and the exported
 * functions below all carry the sum inside a result that also carries what it
 * was summed over.
 */
function balanceOf(deposits: readonly SavingDeposit[], currency: CurrencyCode): Money {
  return sum(
    deposits.map((deposit) => deposit.amount),
    currency,
  )
}

/**
 * Deposits in this document's currency, and the ones that are not.
 *
 * There is no rate in this document (D-003), so a deposit in another currency is
 * listed rather than converted — the same treatment `fixedExpenseBasis` gives an
 * expense it cannot convert. Dropping it silently would make a balance disagree
 * with the deposit list beside it, which is the exact drift docs/f07 warns
 * about.
 */
function partitionByCurrency(
  deposits: readonly SavingDeposit[],
  currency: CurrencyCode,
): {
  readonly inCurrency: readonly SavingDeposit[]
  readonly otherCurrency: readonly SavingDeposit[]
} {
  const inCurrency: SavingDeposit[] = []
  const otherCurrency: SavingDeposit[] = []
  for (const deposit of deposits) {
    if (deposit.amount.currency === currency) inCurrency.push(deposit)
    else otherCurrency.push(deposit)
  }
  return { inCurrency, otherCurrency }
}

/**
 * What one holding holds, and whether the user can reach it.
 *
 * `holding` is absent when a deposit names a holding this document does not have
 * — which the repository will not normally allow, but a total that quietly
 * dropped such a deposit would break the invariant the screen relies on.
 */
export interface HoldingBalance {
  readonly holdingId: string
  readonly holding: Holding | undefined
  readonly balance: Money
  readonly depositCount: number
  /**
   * **An unknown holding is not liquid.** The failure that matters is counting
   * money as reachable when it is not, so the direction that understates wins —
   * the same call `bankSpendingBasis` makes about an unanswered settlement.
   */
  readonly isLiquid: boolean
  /**
   * Set when the balance is **units times a price** rather than Σ its deposits
   * (D-186). Present exactly when a valuation was supplied for this holding, so
   * a screen can say where the figure came from rather than implying somebody
   * paid that amount in.
   */
  readonly valuation: Money | undefined
}

/**
 * Every holding with what it holds — the grain every total in this file is
 * assembled at since D-175.
 *
 * Holdings with nothing in them are included: a פק"מ the user emptied is still
 * somewhere they have money, and a list that hid it would look like it had been
 * deleted.
 */
export function holdingBalances(
  deposits: readonly SavingDeposit[],
  holdings: readonly Holding[],
  currency: CurrencyCode,
  valuations?: ReadonlyMap<string, Money> | undefined,
): readonly HoldingBalance[] {
  const { inCurrency } = partitionByCurrency(deposits, currency)

  const running = new Map<string, { minor: number; count: number }>()
  for (const deposit of inCurrency) {
    const entry = running.get(deposit.holdingId) ?? { minor: 0, count: 0 }
    entry.minor += deposit.amount.minor
    entry.count += 1
    running.set(deposit.holdingId, entry)
  }

  const rows: HoldingBalance[] = holdings.map((holding) => {
    const entry = running.get(holding.id)
    const valued = valuations?.get(holding.id)
    return {
      holdingId: holding.id,
      holding,
      // **A valuation replaces the sum rather than joining it** (D-186). What a
      // position is worth is its units times a price; the deposits that bought
      // those units are the same money in an earlier form, and adding both
      // would count a purchase twice. The deposit count is still reported,
      // because the deposits are still there and a screen may want to say so.
      balance: valued ?? money(entry?.minor ?? 0, currency),
      depositCount: entry?.count ?? 0,
      isLiquid: holding.isLiquid,
      valuation: valued,
    }
  })

  const known = new Set(holdings.map((holding) => holding.id))
  for (const [holdingId, entry] of running) {
    if (known.has(holdingId)) continue
    rows.push({
      holdingId,
      holding: undefined,
      balance: money(entry.minor, currency),
      depositCount: entry.count,
      isLiquid: false,
      valuation: undefined,
    })
  }

  return rows
}

/**
 * The same money rolled up to where it sits — one row per place, with its
 * holdings underneath. The money map's shape (D-176, D-177).
 *
 * **A place has no liquidity of its own.** It reports the liquid and the locked
 * part of what its holdings hold, which is the fact D-175 moved down a level: a
 * brokerage account is not reachable or unreachable — its cash is reachable and
 * its index fund may not be.
 *
 * Balances whose holding this document does not have are gathered into one row
 * with `place` absent, for the reason `holdingBalances` keeps an unknown holding
 * at all: a total that dropped them would stop being checkable against the
 * deposit list.
 */
export interface PlaceBalance {
  readonly holdingPlaceId: string
  readonly place: HoldingPlace | undefined
  readonly balance: Money
  readonly liquid: Money
  readonly locked: Money
  readonly depositCount: number
  readonly holdings: readonly HoldingBalance[]
  /**
   * Set on a bank or cash account's own place while the account has a statement
   * balance (M30 F7, D-376): the place's figure is that balance plus any other
   * holding there, each goal saved in its Cash is a part, and the Cash is what no
   * goal has taken.
   */
  readonly statement?: StatementPlace | undefined
}

export interface StatementPlace {
  /** The account's latest statement balance (D-325). */
  readonly balance: Money
  readonly cashHoldingId: string | undefined
  /** Each goal's part, largest first: its deposits into this account's Cash (D-360). */
  readonly parts: readonly GoalPartInput[]
  /** The balance less the parts. Undefined when the parts are more: a failed check, never a clamp. */
  readonly cash: Money | undefined
  /** How much more the parts are than the balance; undefined while they fit. */
  readonly short: Money | undefined
}

export function placeBalances(
  balances: readonly HoldingBalance[],
  places: readonly HoldingPlace[],
  currency: CurrencyCode,
): readonly PlaceBalance[] {
  const byPlace = new Map<string, HoldingBalance[]>()
  const orphans: HoldingBalance[] = []
  const known = new Set(places.map((place) => place.id))

  for (const row of balances) {
    // A fund is a holding in no place: it is a row of its own (D-389), not an orphan.
    if (row.holding?.fundType !== undefined) continue
    const placeId = row.holding?.holdingPlaceId
    if (placeId === undefined || !known.has(placeId)) {
      orphans.push(row)
      continue
    }
    const bucket = byPlace.get(placeId) ?? []
    bucket.push(row)
    byPlace.set(placeId, bucket)
  }

  const rowFor = (
    holdingPlaceId: string,
    place: HoldingPlace | undefined,
    rows: readonly HoldingBalance[],
  ): PlaceBalance => ({
    holdingPlaceId,
    place,
    balance: balanceAmounts(rows, currency),
    liquid: balanceAmounts(
      rows.filter((row) => row.isLiquid),
      currency,
    ),
    locked: balanceAmounts(
      rows.filter((row) => !row.isLiquid),
      currency,
    ),
    depositCount: rows.reduce((running, row) => running + row.depositCount, 0),
    holdings: rows,
  })

  const out = places.map((place) => rowFor(place.id, place, byPlace.get(place.id) ?? []))
  if (orphans.length > 0) out.push(rowFor('', undefined, orphans))
  return out
}

/**
 * Total savings, split into money that can be reached and money that cannot.
 *
 * **`liquid + locked === total`, always.** That is F07's third acceptance
 * criterion and it is held by construction: every holding falls into exactly one
 * of the two, and an unrecognized holding falls into `locked`. **A fund is one of
 * the holdings** (M36 U12, D-389) — not liquid, so locked — and is counted once,
 * as its row; before U12 its balance came in beside the holdings, and a pension
 * kept both ways was counted twice.
 */
export interface LiquiditySplit {
  readonly total: Money
  readonly liquid: Money
  readonly locked: Money
  /** Holdings a deposit named and this document does not have. Counted as locked. */
  readonly unknownHoldingIds: readonly string[]
}

export function liquiditySplit(balances: readonly HoldingBalance[], currency: CurrencyCode): LiquiditySplit {
  const liquid = balanceAmounts(balances.filter((row) => row.isLiquid), currency)
  const locked = balanceAmounts(balances.filter((row) => !row.isLiquid), currency)

  return {
    total: add(liquid, locked),
    liquid,
    locked,
    unknownHoldingIds: balances
      .filter((row) => row.holding === undefined)
      .map((row) => row.holdingId),
  }
}

function balanceAmounts(
  balances: readonly { readonly balance: Money }[],
  currency: CurrencyCode,
): Money {
  return sum(
    balances.map((row) => row.balance),
    currency,
  )
}

// --- What a goal is aiming at -----------------------------------------------

/**
 * A month's expenses, two ways — what the cushion's months are of (D-360).
 *
 * Both are passed in rather than computed here, because both already exist and
 * each is the output of the one function allowed to produce it:
 * `fixedExpenseBasis(...).total` for the floor (D-053, which is also the
 * function that refuses to subtract a payroll deduction twice) and the ledger's
 * or `bankSpendingBasis`'s total for the comfortable figure (D-060). Either may
 * be absent — a document with no fixed expenses recorded cannot answer the first
 * — and absent is a sentence, not a zero.
 */
export interface MonthlyExpenses {
  readonly fixedExpenses: Money | undefined
  readonly totalSpending: Money | undefined
  /**
   * Plan's buckets counted inside `fixedExpenses`, beside the bills (M28 F10): the cushion's
   * months are of these too. Empty or absent when none is ticked.
   */
  readonly alongside?: readonly { readonly name: string; readonly amount: Money }[]
}

/**
 * What a goal is aiming at: the amount it stores, or nothing. An Emergency
 * goal is no exception since M36 U09 — the months it once multiplied are the
 * cushion's (D-360).
 */
export type EffectiveTarget = { readonly kind: 'NONE' } | { readonly kind: 'AMOUNT'; readonly amount: Money }

/**
 * The target of a goal. One function so that the progress ring and the
 * required-monthly figure cannot disagree about what the goal is aiming at.
 */
export function effectiveTarget(goal: SavingGoal): EffectiveTarget {
  const stored = goal.targetAmount
  return stored === undefined ? { kind: 'NONE' } : { kind: 'AMOUNT', amount: stored }
}

/** The amount, when there is one. `undefined` covers both ways of not having one. */
export function targetAmountOf(target: EffectiveTarget): Money | undefined {
  return target.kind === 'AMOUNT' ? target.amount : undefined
}

// --- Progress ---------------------------------------------------------------

/**
 * How much a month, to get there on time.
 *
 * `OVERDUE` rather than a negative or infinite figure is docs/f07's edge case:
 * a target date that has passed with the goal unmet divides by zero or by a
 * negative number, and both produce a number that is worse than the words.
 *
 * The months remaining **include the current month**, so a goal due this month
 * asks for the whole shortfall now rather than dividing by zero, and the count
 * only reaches zero once the date is genuinely behind. The amount is rounded
 * **up**: N payments of a rounded-down figure land short of the target, which is
 * the direction that quietly misses.
 */
export type RequiredMonthly =
  | { readonly kind: 'NO_TARGET' }
  | { readonly kind: 'NO_TARGET_DATE'; readonly shortfall: Money }
  | { readonly kind: 'REACHED'; readonly surplus: Money }
  | {
      readonly kind: 'OVERDUE'
      readonly shortfall: Money
      readonly targetDate: LocalDate
      readonly monthsPast: number
    }
  | {
      readonly kind: 'REQUIRED'
      readonly amount: Money
      readonly shortfall: Money
      readonly monthsRemaining: number
    }

function requiredMonthly(
  goal: SavingGoal,
  target: EffectiveTarget,
  balance: Money,
  asOf: LocalDate,
): RequiredMonthly {
  const amount = targetAmountOf(target)
  if (amount === undefined) return { kind: 'NO_TARGET' }

  const shortfall = subtract(amount, balance)
  if (shortfall.minor <= 0) return { kind: 'REACHED', surplus: money(-shortfall.minor, balance.currency) }

  const targetDate = goal.targetDate
  if (targetDate === undefined) return { kind: 'NO_TARGET_DATE', shortfall }

  const monthsRemaining = monthsBetween(yearMonthOf(asOf), yearMonthOf(targetDate)) + 1
  if (monthsRemaining <= 0) {
    return {
      kind: 'OVERDUE',
      shortfall,
      targetDate,
      monthsPast: monthsBetween(yearMonthOf(targetDate), yearMonthOf(asOf)),
    }
  }

  return {
    kind: 'REQUIRED',
    amount: money(Math.ceil(shortfall.minor / monthsRemaining), shortfall.currency),
    shortfall,
    monthsRemaining,
  }
}

/** How many months of contributions the completion estimate averages over. */
export const RECENT_CONTRIBUTION_WINDOW_MONTHS = 3

/**
 * How far ahead a completion date is worth printing: fifty years.
 *
 * Past that the arithmetic still works and the answer stops meaning anything —
 * ₪50 a month against a ₪400,000 house deposit is a real situation and "August
 * 2692" is not a useful way to say so.
 */
export const PROJECTION_HORIZON_MONTHS = 600

/**
 * When the goal gets there at the rate of the last three months.
 *
 * The rate is the **net** of the window — a withdrawal in it counts against the
 * deposits, because a goal being drawn down is not on its way anywhere. A rate
 * of zero or less is therefore an ordinary outcome and gets its own variant
 * carrying the rate, so the screen can tell "nothing went in" from "more came
 * out than went in" without a second calculation.
 *
 * The window ends at the **current** month rather than the last complete one,
 * which is the opposite of the call D-055 made for the fixed-expense screen and
 * right for the opposite reason: there, a partial month dragged a coverage
 * figure down for everybody; here, excluding it would mean a deposit made this
 * morning moved nothing on screen. The months averaged over come back in the
 * result so the screen can say what it counted.
 */
export type ProjectedCompletion =
  | { readonly kind: 'NO_TARGET' }
  | { readonly kind: 'REACHED' }
  | {
      readonly kind: 'NOT_AT_THIS_RATE'
      readonly monthlyRate: Money
      readonly from: YearMonth
      readonly to: YearMonth
    }
  | {
      readonly kind: 'BEYOND_HORIZON'
      readonly monthlyRate: Money
      readonly months: number
      readonly from: YearMonth
      readonly to: YearMonth
    }
  | {
      readonly kind: 'PROJECTED'
      readonly monthlyRate: Money
      readonly months: number
      readonly period: YearMonth
      readonly from: YearMonth
      readonly to: YearMonth
    }

function projectedCompletion(
  deposits: readonly SavingDeposit[],
  target: EffectiveTarget,
  balance: Money,
  asOf: LocalDate,
): ProjectedCompletion {
  const amount = targetAmountOf(target)
  if (amount === undefined) return { kind: 'NO_TARGET' }

  const shortfall = subtract(amount, balance)
  if (shortfall.minor <= 0) return { kind: 'REACHED' }

  const to = yearMonthOf(asOf)
  const from = addMonths(to, -(RECENT_CONTRIBUTION_WINDOW_MONTHS - 1))
  // Contributions only. A quarter's investment gain in the window would raise
  // the rate and bring the completion date forward, which is the app claiming
  // the user is saving faster because the market went up (D-081).
  const inWindow = deposits.filter((deposit) => {
    if (!isContribution(deposit)) return false
    const period = yearMonthOf(deposit.date)
    return monthsBetween(from, period) >= 0 && monthsBetween(period, to) >= 0
  })

  const netMinor = inWindow.reduce((running, deposit) => running + deposit.amount.minor, 0)
  const monthlyRate = money(
    Math.trunc(netMinor / RECENT_CONTRIBUTION_WINDOW_MONTHS),
    balance.currency,
  )
  if (monthlyRate.minor <= 0) return { kind: 'NOT_AT_THIS_RATE', monthlyRate, from, to }

  const months = Math.ceil(shortfall.minor / monthlyRate.minor)
  if (months > PROJECTION_HORIZON_MONTHS) {
    return { kind: 'BEYOND_HORIZON', monthlyRate, months, from, to }
  }

  return { kind: 'PROJECTED', monthlyRate, months, period: addMonths(to, months), from, to }
}

/** How far back the activity figures look. */
export const ACTIVITY_WINDOW_MONTHS = 12

/**
 * Whether the user is actually feeding this goal — docs/f07's contribution
 * streak and months with no deposit.
 *
 * **Only a positive amount is a contribution.** A withdrawal is money leaving,
 * and a streak that a withdrawal kept alive would be congratulating the user for
 * the opposite of what it claims to measure.
 *
 * The streak is allowed to end at **last** month rather than this one, because
 * on the third of the month a user who pays in on the fifteenth has not broken
 * anything — the same "a partial month is not a verdict" argument D-055 made
 * about the fixed-expense screen.
 */
export interface ContributionActivity {
  readonly lastDepositDate: LocalDate | undefined
  readonly monthsSinceLastDeposit: number | undefined
  /** Consecutive months with a contribution, counting back from now. */
  readonly streakMonths: number
  /** Months with a contribution in the last `windowMonths`. */
  readonly monthsWithContribution: number
  readonly windowMonths: number
}

function contributionActivity(
  deposits: readonly SavingDeposit[],
  asOf: LocalDate,
): ContributionActivity {
  // Positive **and** actually contributed. A streak kept alive by a month the
  // fund happened to gain would congratulate the user for the market's work.
  const contributions = deposits.filter(
    (deposit) => deposit.amount.minor > 0 && isContribution(deposit),
  )
  const months = new Set(contributions.map((deposit) => toYearMonthString(yearMonthOf(deposit.date))))

  const latest = contributions.reduce<LocalDate | undefined>(
    (newest, deposit) =>
      newest === undefined || compareDates(deposit.date, newest) > 0 ? deposit.date : newest,
    undefined,
  )

  const thisMonth = yearMonthOf(asOf)
  let cursor = months.has(toYearMonthString(thisMonth))
    ? thisMonth
    : addMonths(thisMonth, -1)
  let streakMonths = 0
  while (months.has(toYearMonthString(cursor))) {
    streakMonths += 1
    cursor = addMonths(cursor, -1)
  }

  let monthsWithContribution = 0
  for (let back = 0; back < ACTIVITY_WINDOW_MONTHS; back += 1) {
    if (months.has(toYearMonthString(addMonths(thisMonth, -back)))) monthsWithContribution += 1
  }

  return {
    lastDepositDate: latest,
    monthsSinceLastDeposit:
      latest === undefined ? undefined : monthsBetween(yearMonthOf(latest), thisMonth),
    streakMonths,
    monthsWithContribution,
    windowMonths: ACTIVITY_WINDOW_MONTHS,
  }
}

/**
 * One goal, with its balance computed from the deposits it was given and every
 * figure docs/f07 asks for beside it.
 */
export interface GoalProgress {
  readonly goal: SavingGoal
  /** Σ every deposit, withdrawals included as negatives. Never stored. */
  readonly balance: Money
  /** What the target is measured against: the balance, for every kind of goal (M36 U09). */
  readonly progressBalance: Money
  /**
   * **The four ways money got here, and they sum to `balance` exactly.**
   *
   * `openingBalance + contributed + withdrawn + growth === balance`, with
   * `withdrawn` negative and `growth` negative in a bad year. The split is
   * reported rather than left to a screen because the interesting question about
   * a savings balance is which part of it the user is responsible for, and
   * subtracting one figure from another to find out is how two screens come to
   * disagree (D-081).
   */
  readonly openingBalance: Money
  /** Σ the positive contributions. Excludes the opening balance and growth. */
  readonly contributed: Money
  /** Σ the withdrawals, as the negative figure they are stored as. */
  readonly withdrawn: Money
  /** Σ the `GROWTH` rows. Negative in a year the market took some back. */
  readonly growth: Money
  readonly depositCount: number
  readonly holdings: readonly HoldingBalance[]
  readonly liquid: Money
  readonly locked: Money
  readonly target: EffectiveTarget
  /** `progressBalance ÷ target`. Absent when there is no target to be a share of. */
  readonly progressBasisPoints: number | undefined
  readonly required: RequiredMonthly
  readonly completion: ProjectedCompletion
  readonly activity: ContributionActivity
  /** Deposits in another currency. Listed, never converted (D-003). */
  readonly otherCurrency: readonly SavingDeposit[]
  /**
   * **Why the goal's totals are not one figure**, when they are not (M36 U03):
   * deposits in two currencies, which the document folds to nothing rather than
   * to a smaller sum (D-349). Its money figures are then zero and say nothing;
   * a screen shows this sentence instead of them.
   */
  readonly unchecked: string | undefined
}

/**
 * **What the document works out about one goal** (M36 U03) — the totals and
 * worked-out columns the pack declares on `saving_goal`, read by the
 * repository. `undefined` is a figure the engine would not give: deposits in
 * two currencies.
 */
export interface GoalFigures {
  /** `balance`: Σ every deposit. */
  readonly balance: Money | undefined
  /** `opening`: Σ the `OPENING_BALANCE` deposits. */
  readonly opening: Money | undefined
  /** `growth`: Σ the `GROWTH` deposits. */
  readonly growth: Money | undefined
  /** `liquid`: Σ the deposits in a holding that is liquid. */
  readonly liquid: Money | undefined
  /** `put_in`: `balance - growth`. */
  readonly putIn: Money | undefined
  /** `progress`: `balance / target`, a share; empty with no target. */
  readonly progress: number | undefined
}

/** A goal the repository was not asked about: nothing worked out, so nothing claimed. */
const NO_FIGURES: GoalFigures = {
  balance: undefined,
  opening: undefined,
  growth: undefined,
  liquid: undefined,
  putIn: undefined,
  progress: undefined,
}

/** The sentence a goal whose deposits are in two currencies carries. */
export const GOAL_MIXED_CURRENCY =
  'Its deposits are in more than one currency, and nothing in this document knows a rate between them — ' +
  'so its balance is not one figure.'

export interface GoalProgressInput {
  readonly goal: SavingGoal
  /** Every deposit, or this goal's. Filtered by `goalId` either way. */
  readonly deposits: readonly SavingDeposit[]
  readonly holdings: readonly Holding[]
  /** The domain has no clock (docs/03). */
  readonly asOf: LocalDate
  readonly currency: CurrencyCode
  /** What the document works out about this goal — its declared totals (M36 U03). */
  readonly figures: GoalFigures
}

export function goalProgress(input: GoalProgressInput): GoalProgress {
  const mine = input.deposits.filter((deposit) => deposit.goalId === input.goal.id)
  const { inCurrency, otherCurrency } = partitionByCurrency(mine, input.currency)

  const holdings = holdingBalances(inCurrency, input.holdings, input.currency)

  // **The totals are the document's** (M36 U03): the pack declares them on
  // `saving_goal` and the engine folds them; nothing here adds the deposits
  // again. A goal wholly in another currency is listed, as before (D-003) —
  // its figures in this currency are zero. One whose deposits are in two
  // currencies has no figure at all, and says so (D-349).
  const zero = money(0, input.currency)
  const read = input.figures
  const here = (one: Money | undefined): Money | undefined => (one?.currency === input.currency ? one : undefined)
  const elsewhere = read.balance !== undefined && read.balance.currency !== input.currency
  const unchecked = read.balance === undefined ? GOAL_MIXED_CURRENCY : undefined
  const figure = (one: Money | undefined): Money => here(one) ?? zero
  const balance = figure(read.balance)
  const liquid = figure(read.liquid)
  const openingBalance = figure(read.opening)
  const growth = figure(read.growth)

  const progressBalance = balance

  const target = effectiveTarget(input.goal)
  const amount = targetAmountOf(target)
  const progressBasisPoints =
    unchecked !== undefined || elsewhere || amount === undefined
      ? undefined
      : read.progress === undefined
        ? ratioBasisPoints(progressBalance, amount)
        : shareBasisPoints(read.progress)

  return {
    goal: input.goal,
    balance,
    progressBalance,
    openingBalance,
    contributed: balanceOf(
      inCurrency.filter((deposit) => deposit.amount.minor > 0 && isContribution(deposit)),
      input.currency,
    ),
    withdrawn: balanceOf(
      inCurrency.filter((deposit) => deposit.amount.minor < 0 && isContribution(deposit)),
      input.currency,
    ),
    growth,
    depositCount: inCurrency.length,
    holdings: holdings.filter((row) => row.depositCount > 0),
    liquid,
    locked: subtract(balance, liquid),
    target,
    progressBasisPoints,
    required: requiredMonthly(input.goal, target, progressBalance, input.asOf),
    completion: projectedCompletion(inCurrency, target, progressBalance, input.asOf),
    activity: contributionActivity(inCurrency, input.asOf),
    otherCurrency,
    unchecked,
  }
}

// --- The overview -----------------------------------------------------------

/**
 * One cell of docs/f07's goal × holding place matrix. Zero cells are omitted.
 *
 * Still keyed on the **place** after D-175, with a goal's holdings at one place
 * summed into one cell. An empty `holdingPlaceId` is the bucket for money in a
 * holding this document no longer has.
 */
export interface GoalPlaceAmount {
  readonly goalId: string
  readonly holdingPlaceId: string
  readonly balance: Money
}

/**
 * Everything the savings screens need in one pass, so no two of them can
 * disagree.
 *
 * The totals are computed over **all** the deposits, not over the sum of the
 * goal rows, and the difference between the two is reported rather than
 * absorbed: `orphaned` holds deposits naming a goal this document does not have,
 * which is how a total stays checkable against the deposit list.
 */
export interface SavingsOverview {
  readonly goals: readonly GoalProgress[]
  /** Every holding with what it holds. The grain the totals are built at. */
  readonly holdings: readonly HoldingBalance[]
  /** The same money rolled up to where it sits, holdings underneath. */
  readonly places: readonly PlaceBalance[]
  readonly cells: readonly GoalPlaceAmount[]
  readonly liquidity: LiquiditySplit
  /**
   * Σ the goals' balances.
   *
   * `liquidity.total` is deliberately a different figure: it also carries F13's
   * funds, and since M16 it carries a position at what it is *worth* where this
   * carries it at what was paid in (D-186).
   */
  readonly inGoals: Money
  readonly orphaned: readonly SavingDeposit[]
  readonly otherCurrency: readonly SavingDeposit[]
}

export interface SavingsOverviewInput {
  readonly goals: readonly SavingGoal[]
  readonly deposits: readonly SavingDeposit[]
  readonly holdings: readonly Holding[]
  readonly places: readonly HoldingPlace[]
  readonly asOf: LocalDate
  readonly currency: CurrencyCode
  readonly monthly?: MonthlyExpenses
  /** What the document works out about each goal, by id (M36 U03). */
  readonly goalFigures: ReadonlyMap<string, GoalFigures>
  /**
   * What each valued holding is worth (D-186).
   *
   * **It reaches the places and the liquidity split and deliberately not the
   * goals.** A position's market value belongs to wherever it is held; it
   * belongs to a *goal* only through the deposits that bought it, and
   * attributing a gain to a goal nobody deposited into would put money in a
   * purpose that never claimed it. So `inGoals` stays Σ the deposits and
   * `liquidity.total` carries the valuation — the same asymmetry F13's funds
   * have had since D-074, for the same reason.
   */
  readonly valuations?: ReadonlyMap<string, Money> | undefined
}

export function savingsOverview(input: SavingsOverviewInput): SavingsOverview {
  const known = new Set(input.goals.map((goal) => goal.id))
  const owned = input.deposits.filter((deposit) => known.has(deposit.goalId))
  const orphaned = input.deposits.filter((deposit) => !known.has(deposit.goalId))
  const { inCurrency, otherCurrency } = partitionByCurrency(owned, input.currency)

  const goals = input.goals.map((goal) =>
    goalProgress({
      goal,
      figures: input.goalFigures.get(goal.id) ?? NO_FIGURES,
      deposits: inCurrency,
      holdings: input.holdings,
      asOf: input.asOf,
      currency: input.currency,
      ...(input.monthly === undefined ? {} : { monthly: input.monthly }),
    }),
  )

  // **The matrix stays goal × place**, not goal × holding, and that is D-176's
  // call rather than an oversight: the crossing no list can show is the one
  // between a purpose and a location, and a goal with cash and a deposit at the
  // same bank would otherwise get two columns saying the same thing about where
  // its money is. So a goal's holdings are folded up to their places here, which
  // is also why this is a sum rather than a copy.
  const placeOf = new Map(input.holdings.map((holding) => [holding.id, holding.holdingPlaceId]))
  const cells: GoalPlaceAmount[] = []
  for (const progress of goals) {
    const running = new Map<string, number>()
    for (const row of progress.holdings) {
      const placeId = placeOf.get(row.holdingId) ?? ''
      running.set(placeId, (running.get(placeId) ?? 0) + row.balance.minor)
    }
    for (const [holdingPlaceId, minor] of running) {
      if (minor === 0) continue
      cells.push({ goalId: progress.goal.id, holdingPlaceId, balance: money(minor, input.currency) })
    }
  }

  const holdings = holdingBalances(
    inCurrency,
    input.holdings,
    input.currency,
    input.valuations,
  )

  return {
    goals,
    holdings,
    places: placeBalances(holdings, input.places, input.currency),
    cells,
    liquidity: liquiditySplit(holdings, input.currency),
    inGoals: sum(
      goals.map((progress) => progress.balance),
      input.currency,
    ),
    orphaned,
    otherCurrency,
  }
}

// --- The money map ----------------------------------------------------------

/**
 * One fund as the map sees it — F13's record, **read** and never written here.
 *
 * D-177 kept a fund a record of its own and made it a row on the map; **M36 U12
 * made the record a holding** (D-389) — one with a fund type, its parts on its
 * readings — so a pension cannot be kept twice, once as a fund and once as a
 * place's track, and counted twice. It is in no place, so it is this row rather
 * than a place's line, and its figure is its holding's.
 *
 * Assembled by the repository from `FundAccount` and its latest reading. This
 * shape rather than F13's own so `domain/savings.ts` stays a file about savings.
 */
export interface FundRow {
  readonly fundId: string
  readonly name: string
  readonly institution: string | undefined
  readonly balance: Money
  /** The snapshot's as-of date. Absent when the fund has no reading yet. */
  readonly asOf: LocalDate | undefined
}

/**
 * A fund's row on the map, with the two facts every other row also carries.
 *
 * Both are constants and both are constants for a reason. A fund's balance is a
 * transcribed snapshot — F13's deliberate exception to "balances are derived" —
 * and a pension or a study fund is not money you can reach this week, which is
 * what put funds inside the locked subtotal in the first place (D-074).
 */
export interface MoneyMapFund extends FundRow {
  readonly provenance: HoldingProvenance
  readonly isLiquid: boolean
}

/**
 * Where the money is, how much of it, and how much of it you should believe.
 *
 * **The one function that assembles the map** (D-177), which is what keeps
 * `liquid + locked === total` a property of the domain rather than of a screen
 * adding carefully: the split is computed here, over these rows, with the funds
 * included the same way `liquiditySplit` has always included them.
 */
export interface MoneyMap {
  readonly places: readonly PlaceBalance[]
  readonly funds: readonly MoneyMapFund[]
  readonly liquidity: LiquiditySplit
  /** Money in a holding this document does not have. Locked, and named. */
  readonly unknownHoldingIds: readonly string[]
}

export interface MoneyMapInput {
  readonly deposits: readonly SavingDeposit[]
  readonly holdings: readonly Holding[]
  readonly places: readonly HoldingPlace[]
  readonly funds?: readonly FundRow[]
  /**
   * What each valued holding is worth, from `positionValuations` (D-186). A
   * holding not named here is Σ its deposits, which is every holding this
   * document had before M16.
   */
  readonly valuations?: ReadonlyMap<string, Money> | undefined
  readonly currency: CurrencyCode
}

export function moneyMap(input: MoneyMapInput): MoneyMap {
  const funds = input.funds ?? []
  const balances = holdingBalances(
    input.deposits,
    input.holdings,
    input.currency,
    input.valuations,
  )
  // A fund is one of the holdings (D-389): the split counts it once, as its row,
  // and the fund's line on the map carries that row's figure.
  const liquidity = liquiditySplit(balances, input.currency)
  const held = new Map(balances.map((row) => [row.holdingId, row.balance]))

  return {
    places: placeBalances(balances, input.places, input.currency),
    funds: funds.map((fund) => ({
      ...fund,
      balance: held.get(fund.fundId) ?? fund.balance,
      provenance: 'TRANSCRIBED',
      isLiquid: false,
    })),
    liquidity,
    unknownHoldingIds: liquidity.unknownHoldingIds,
  }
}

/**
 * How long a holding may go unconfirmed before the app says so, in months.
 *
 * Five, and it is F13's six with one month taken off rather than a new number
 * invented: `STALE_READING_MONTHS` is set to the reporting cadence of a fund,
 * and nothing sends a statement for the envelope in a drawer. What makes a
 * `RECORDED` holding the most likely wrong figure in a document is exactly that
 * nobody will ever be prompted about it — so the app has to be the prompt, and a
 * little sooner than it is for the documents that arrive by post.
 */
export const UNCONFIRMED_HOLDING_MONTHS = 5

/** One holding nobody has counted lately, with how long it has been. */
export interface UnconfirmedHolding {
  readonly holdingId: string
  readonly holding: Holding
  readonly balance: Money
  /** Absent when it has never been confirmed at all, which is not zero months. */
  readonly monthsSince: number | undefined
}

/**
 * The holdings whose balance nobody has checked, for Home's attention list
 * (D-091, D-176).
 *
 * **Only the ones with money in them**, and only where the figure could actually
 * be wrong: a holding at zero has nothing to be wrong about, and one the user
 * confirmed last month is the case this list exists to leave alone.
 *
 * Never-confirmed is `undefined` months rather than a large number, because
 * "nobody has ever checked this" and "nobody has checked this in eleven months"
 * are two different sentences and the app knows which it is looking at.
 */
export function unconfirmedHoldings(
  balances: readonly HoldingBalance[],
  asOf: LocalDate,
  months: number = UNCONFIRMED_HOLDING_MONTHS,
): readonly UnconfirmedHolding[] {
  const out: UnconfirmedHolding[] = []

  for (const row of balances) {
    const holding = row.holding
    if (holding === undefined || holding.isArchived) continue
    if (row.balance.minor === 0) continue

    const confirmed = holding.lastConfirmedAt
    if (confirmed === undefined) {
      out.push({ holdingId: row.holdingId, holding, balance: row.balance, monthsSince: undefined })
      continue
    }

    const since = monthsBetween(confirmed, asOf)
    if (since >= months) {
      out.push({ holdingId: row.holdingId, holding, balance: row.balance, monthsSince: since })
    }
  }

  return out
}

// --- Payroll savings --------------------------------------------------------

/**
 * What a payslip says should have reached a saving goal.
 *
 * **Derived, never stored** — no id, the shape `ExpectedContribution` has in
 * F13 (D-066) and for the same reason: it is recomputed from
 * `PaycheckLine` × `DeductionType.linkedSavingGoalId` every time anything asks,
 * so editing a paycheck moves the figure rather than leaving a stale row behind.
 * What the repository stores is one `SavingDeposit` per `sourceRefId`, which is
 * how docs/f07's "created exactly once regardless of how often the paycheck is
 * edited" holds.
 *
 * **One deposit per goal per payslip, not per line**, which is
 * `expectedContributions`' shape and, here, a correctness requirement rather
 * than a tidiness one: `updatePaycheck` deletes a slip's lines and writes them
 * again, so a `PaycheckLine.id` does not survive an edit. A deposit keyed on one
 * would be deleted and recreated by every correction — the exact duplication the
 * criterion forbids, produced by the mechanism meant to prevent it. A payslip
 * and a goal both survive, so `sourceRefId` is built from those.
 *
 * Employee and employer sides both count: both are the user's wealth, which is
 * what `countsAsSaving` means and what docs/05's savings rate sums.
 */
export interface PayrollSavingDeposit {
  readonly goalId: string
  readonly paycheckId: string
  /** `paycheckId:goalId` — stable across an edit, unlike a line id. */
  readonly sourceRefId: string
  readonly period: YearMonth
  readonly date: LocalDate
  readonly amount: Money
  /** The goal's default holding, when it has one. */
  readonly holdingId: string | undefined
}

/** The one definition of "which generated deposit is this", shared by every caller. */
export function payrollDepositRef(paycheckId: string, goalId: string): string {
  return `${paycheckId}:${goalId}`
}

export function payrollSavingDeposits(
  entries: readonly PaycheckWithLines[],
  types: readonly DeductionType[],
  goals: readonly SavingGoal[],
): readonly PayrollSavingDeposit[] {
  const byType = new Map(types.map((type) => [type.id, type]))
  const byGoal = new Map(goals.map((goal) => [goal.id, goal]))
  const deposits: PayrollSavingDeposit[] = []

  for (const entry of entries) {
    const perGoal = new Map<string, number>()

    for (const line of entry.lines) {
      const type = byType.get(line.deductionTypeId)
      const goalId = type?.linkedSavingGoalId
      if (goalId === undefined || !byGoal.has(goalId)) continue

      const minor = line.employeeAmount.minor + (line.employerAmount?.minor ?? 0)
      perGoal.set(goalId, (perGoal.get(goalId) ?? 0) + minor)
    }

    for (const [goalId, minor] of perGoal) {
      // A slip whose lines cancel out contributed nothing, and a deposit of zero
      // is a row that says something happened.
      if (minor === 0) continue

      deposits.push({
        goalId,
        paycheckId: entry.paycheck.id,
        sourceRefId: payrollDepositRef(entry.paycheck.id, goalId),
        period: entry.paycheck.period,
        date: entry.paycheck.paymentDate,
        amount: money(minor, entry.paycheck.gross.currency),
        holdingId: byGoal.get(goalId)?.defaultHoldingId,
      })
    }
  }

  return deposits
}

/**
 * The key a generated deposit is unique per — docs/f07's idempotency invariant,
 * written once so the repository's upsert and migration `018`'s index agree
 * about what "the same deposit" means.
 *
 * A `MANUAL` deposit has no key: two identical manual deposits on one day are
 * two deposits, because the user made two.
 */
export function depositSourceKey(
  sourceKind: DepositSourceKind,
  sourceRefId: string | undefined,
): string | undefined {
  if (sourceKind === 'MANUAL' || sourceRefId === undefined) return undefined
  return `${sourceKind}:${sourceRefId}`
}

// --- Validation -------------------------------------------------------------

/**
 * The band a rate is held inside: ±20% a year.
 *
 * Not an opinion about markets — an arithmetic guard. A mistyped 500% is a typo,
 * and a figure that size is refused here rather than carried into every sum
 * that reads the holding (D-072 clamped the fee screen's sliders for the same
 * reason).
 */
export const MAX_EXPECTED_RETURN_BASIS_POINTS = 2_000

export type GoalProblem =
  | 'NO_NAME'
  | 'NEGATIVE_TARGET'

/**
 * What makes a goal unenterable, and nothing else — the shape of
 * `validateSnapshot` and `validateFixedExpense`.
 *
 * A goal with no target amount and no date is perfectly valid: docs/f07 lists
 * the open-ended goal as a case to support, not an error to prevent.
 */
export function validateGoal(goal: SavingGoal): readonly GoalProblem[] {
  const problems: GoalProblem[] = []

  if (goal.name.trim() === '') problems.push('NO_NAME')
  if (goal.targetAmount !== undefined && goal.targetAmount.minor < 0) {
    problems.push('NEGATIVE_TARGET')
  }

  return [...new Set(problems)]
}

export type HoldingPlaceProblem = 'NO_NAME'

/**
 * A place is a name and a kind now, so this is a name check and nothing more.
 *
 * `RETURN_OUT_OF_RANGE` moved to `validateHolding` with the rate it was about
 * (D-175). It did not become laxer on the way: the same bound, applied to the
 * record that actually earns the return.
 */
export function validateHoldingPlace(place: HoldingPlace): readonly HoldingPlaceProblem[] {
  return place.name.trim() === '' ? ['NO_NAME'] : []
}

export type HoldingProblem = 'NO_NAME' | 'RETURN_OUT_OF_RANGE' | 'FEE_OUT_OF_RANGE'

/**
 * **Whether a holding's money is reachable, worked out rather than asked** (M36 U11).
 * A term that has not ended locks it; otherwise its kind decides — cash, a fund
 * and a security can be sold this week, a deposit with no term given is taken to
 * be locked, as is a pension track. The holding form asks the term, not the answer.
 */
export function reachableOf(kind: HoldingKind, termEndDate: LocalDate | undefined, asOf: LocalDate): boolean {
  if (termEndDate !== undefined) return compareDates(termEndDate, asOf) <= 0
  return kind === 'CASH' || kind === 'FUND' || kind === 'SECURITY'
}

/**
 * **Where a holding's figure comes from, read off what the document has**
 * (M36 U11): a reading with a quantity is holdings times a price, a reading
 * without one is what a statement says, and none at all is what somebody wrote
 * down. The holding form no longer asks it.
 */
export function provenanceOf(readings: readonly { readonly quantityMicro: number | undefined }[]): HoldingProvenance {
  if (readings.some((reading) => reading.quantityMicro !== undefined)) return 'VALUED'
  return readings.length > 0 ? 'TRANSCRIBED' : 'RECORDED'
}

/**
 * What makes a holding unenterable.
 *
 * **Provenance is not checked, because it cannot be wrong** — it is declared,
 * and every one of the three is a legitimate answer on the day the holding is
 * created (D-176). A `TRANSCRIBED` holding with nothing transcribed against it
 * yet is precisely the state the column exists to name.
 */
export function validateHolding(holding: Holding): readonly HoldingProblem[] {
  const problems: HoldingProblem[] = []

  if (holding.name.trim() === '') problems.push('NO_NAME')

  const expected = holding.expectedReturn
  if (
    expected !== undefined &&
    Math.abs(expected.basisPoints) > MAX_EXPECTED_RETURN_BASIS_POINTS
  ) {
    problems.push('RETURN_OUT_OF_RANGE')
  }

  // A management fee is a charge against a balance, so the same bound as a
  // return with the negative half taken away: a fee that pays you is not a fee.
  if (
    holding.feeBasisPoints !== undefined &&
    (holding.feeBasisPoints < 0 || holding.feeBasisPoints > MAX_EXPECTED_RETURN_BASIS_POINTS)
  ) {
    problems.push('FEE_OUT_OF_RANGE')
  }

  return problems
}

export type DepositProblem =
  | 'UNKNOWN_GOAL'
  | 'ZERO_AMOUNT'
  /** docs/f07: blocked, and the screen offers to reopen the goal. */
  | 'CLOSED_GOAL'
  | 'UNKNOWN_HOLDING'
  /** A withdrawal must say why. The price of modelling it as a negative deposit. */
  | 'WITHDRAWAL_WITHOUT_REASON'
  | 'MIXED_CURRENCY'

export interface DepositContext {
  readonly goal: SavingGoal | undefined
  readonly holdings: readonly Holding[]
}

/**
 * What makes a deposit unenterable.
 *
 * **Separate from `depositWarnings` on purpose**, because docs/f07's edge-case
 * table draws exactly that line: a deposit into a closed goal is *blocked* and a
 * withdrawal larger than the balance is *allowed with a warning* — the user's
 * records may simply be incomplete, and refusing it would make the app argue
 * with something that already happened.
 */
export function validateDeposit(
  deposit: SavingDeposit,
  context: DepositContext,
): readonly DepositProblem[] {
  const problems: DepositProblem[] = []
  const goal = context.goal

  if (goal === undefined) problems.push('UNKNOWN_GOAL')
  else if (goal.isClosed) problems.push('CLOSED_GOAL')

  if (deposit.amount.minor === 0) problems.push('ZERO_AMOUNT')
  // A balance that fell must say why — except on a `GROWTH` row, where the kind
  // is the why. Demanding "what the money went on" for a loss would be asking
  // the user to account for money that did not go anywhere, and the only way to
  // answer it is to record the fall as a withdrawal, which every spending figure
  // downstream would then believe (D-081).
  if (
    deposit.amount.minor < 0 &&
    deposit.sourceKind !== 'GROWTH' &&
    (deposit.note ?? '').trim() === ''
  ) {
    problems.push('WITHDRAWAL_WITHOUT_REASON')
  }
  if (!context.holdings.some((holding) => holding.id === deposit.holdingId)) {
    problems.push('UNKNOWN_HOLDING')
  }
  if (
    goal?.targetAmount !== undefined &&
    goal.targetAmount.currency !== deposit.amount.currency
  ) {
    problems.push('MIXED_CURRENCY')
  }

  return [...new Set(problems)]
}

export type DepositWarning = 'WITHDRAWAL_EXCEEDS_BALANCE'

/**
 * What is worth saying about a deposit that is still allowed.
 *
 * The balance it is judged against is computed from `existing` with this deposit
 * taken out by id, so editing a withdrawal does not warn about itself.
 */
export function depositWarnings(
  deposit: SavingDeposit,
  existing: readonly SavingDeposit[],
): readonly DepositWarning[] {
  if (deposit.amount.minor >= 0) return []

  const others = existing.filter(
    (other) =>
      other.id !== deposit.id &&
      other.goalId === deposit.goalId &&
      other.amount.currency === deposit.amount.currency,
  )
  const balance = balanceOf(others, deposit.amount.currency)

  return balance.minor + deposit.amount.minor < 0 ? ['WITHDRAWAL_EXCEEDS_BALANCE'] : []
}

export type TransferProblem =
  | 'NOT_TWO_LEGS'
  | 'DOES_NOT_NET_TO_ZERO'
  | 'SAME_HOLDING'
  | 'MIXED_CURRENCY'

/**
 * A move between holdings, checked.
 *
 * docs/f07 models it as two deposits netting to zero rather than as an entity of
 * its own, which keeps the balance one sum — and makes the invariant worth
 * checking, since two legs that do not net would move the goal's balance while
 * claiming to have moved nothing.
 */
export function validateTransfer(legs: readonly SavingDeposit[]): readonly TransferProblem[] {
  const problems: TransferProblem[] = []
  if (legs.length !== 2) problems.push('NOT_TWO_LEGS')

  const first = legs[0]
  if (first === undefined) return problems

  if (legs.some((leg) => leg.amount.currency !== first.amount.currency)) {
    problems.push('MIXED_CURRENCY')
  } else if (
    // Only a group with something to net can fail to net. A single leg is
    // already reported as the one problem it has, and saying it also fails to
    // cancel out would be the same fact wearing a second name.
    legs.length > 1 &&
    legs.reduce((running, leg) => running + leg.amount.minor, 0) !== 0
  ) {
    problems.push('DOES_NOT_NET_TO_ZERO')
  }

  if (new Set(legs.map((leg) => leg.holdingId)).size < legs.length) {
    problems.push('SAME_HOLDING')
  }

  return [...new Set(problems)]
}
