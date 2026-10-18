/**
 * Savings — the shapes. `SavingGoal`, `SavingDeposit`, `HoldingPlace` and
 * `Holding` in
 * docs/04-data-model.md, and docs/f07-savings-and-deposits.md.
 *
 * Shapes only; the arithmetic is `@/domain/savings.ts`. Plain TypeScript: no
 * React, no sql.js, no DOM, no database (docs/conventions.md).
 *
 * Five things this model insists on, because each of them is a way a savings
 * number can be quietly wrong and docs/f07 says drift in one of these destroys
 * trust faster than any other bug in this app:
 *
 * - **A goal has no balance.** There is no `balance` field here and there will
 *   not be one. A balance is Σ its deposits, withdrawals being negative
 *   deposits, and nothing in the companion file hands out a goal without
 *   computing it from the deposits it was given. A stored balance drifts the
 *   first time a deposit is edited (docs/04).
 * - **Liquid versus locked is a `Holding` question, not a goal question and no
 *   longer a place question either.** The flag is on the thing that *is*
 *   reachable or not, which is the instrument and not the bank: a brokerage
 *   account's cash is reachable this week and its index fund is not, and both
 *   are at one place (D-175). A goal is a purpose and spreads across several
 *   holdings at once. A pension balance counting towards an emergency fund is
 *   the failure this feature exists to prevent.
 * - **A rate never travels without saying what kind of rate it is.** A פק"מ's
 *   stated interest is a fact and an index fund's return is an assumption, and
 *   showing the second as the first is the failure mode — so `ExpectedReturn`
 *   binds the number to its provenance and there is no way to hold one without
 *   the other. Two nullable columns in the schema, one nullable field here.
 * - **A balance says how it is known.** `HoldingProvenance` is declared, never
 *   inferred (D-176): a bank deposit with no statement against it yet must
 *   still say that a statement is what would confirm it, because that is what
 *   makes *"you have not confirmed this since March"* a sentence the app can
 *   say. Inferring it from whether readings exist would make a holding change
 *   its own kind by being neglected.
 * - **An Emergency goal is an ordinary goal** (M36 U09). Its months of
 *   expenses went to the cushion (D-360); what it aims at is an amount, typed.
 */

import type { Money } from '@/core/money.ts'
import type { LocalDate } from '@/core/time.ts'
import type { FundType } from './funds.ts'

/**
 * What a goal is for. `EMERGENCY` is the one the arithmetic treats differently:
 * its target is derived from a multiplier and it is measured against **liquid**
 * money only (docs/f07).
 */
export const SAVING_GOAL_KINDS = [
  'EMERGENCY',
  'SHORT_TERM',
  'LONG_TERM',
  'RETIREMENT',
  'EARMARKED',
] as const

export type SavingGoalKind = (typeof SAVING_GOAL_KINDS)[number]

/**
 * Where money physically sits.
 *
 * **No place is a pension or a study fund** (M36 U12, D-389): a fund is a
 * holding of its own, in no place, and `PROVIDENT` and `STUDY_FUND` went from
 * this list — a place of that kind was a second way to enter one fund, and the
 * two counted twice. `INVESTMENT` stays: it is what an account with holdings
 * keeps them in, and a place kept by hand may hold investments too.
 */
export const HOLDING_PLACE_KINDS = ['CHECKING', 'DEPOSIT', 'INVESTMENT', 'CASH', 'OTHER'] as const

export type HoldingPlaceKind = (typeof HOLDING_PLACE_KINDS)[number]

/**
 * How a deposit came to be — and, for the last two, how the *money* came to be
 * there, which is a different question the same field turns out to answer.
 *
 * `OPENING_BALANCE` is what was already in the place on the day tracking
 * started, and `GROWTH` is what the market or the bank added since. Both are in
 * the balance, because the money is genuinely there and a balance is Σ its
 * deposits with no exceptions. Neither is **saving**: docs/05's effective
 * savings rate is money the user put aside this month, and an opening balance
 * was put aside before the app existed while a gain was not put aside by anyone
 * (D-081).
 *
 * A note could not have carried this. Every figure that has to exclude them is
 * an aggregate, and an aggregate cannot read prose — the argument D-077 already
 * made for `FROM_PAYCHECK_DEDUCTION`, which exists so statistics can subtract
 * the payslip lines it would otherwise count twice.
 */
export const DEPOSIT_SOURCE_KINDS = [
  'MANUAL',
  'FROM_TRANSACTION',
  'FROM_PAYCHECK_DEDUCTION',
  'FROM_PLAN',
  'OPENING_BALANCE',
  'GROWTH',
] as const

export type DepositSourceKind = (typeof DEPOSIT_SOURCE_KINDS)[number]

/**
 * The kinds that are not money the user set aside.
 *
 * Exported as data rather than left as a condition in three places, because
 * every consumer of it is a total that would be quietly wrong in the flattering
 * direction — a savings rate inflated by a good quarter reads as virtue.
 */
export const NON_CONTRIBUTION_SOURCE_KINDS: readonly DepositSourceKind[] = [
  'OPENING_BALANCE',
  'GROWTH',
]

/**
 * Whether a rate is something the bank agreed to or something the user assumed.
 *
 * A union of two names rather than an `isContractual` boolean, for the reason
 * docs/conventions gives: each value is a different sentence on screen — "as
 * agreed with the bank" against "an assumption you chose" — and a boolean makes
 * the screen invent both. The same distinction D-066 draws between a fund's
 * stated fee and its measured one, and for the same reason.
 */
export const RETURN_BASES = ['CONTRACTUAL', 'ASSUMED'] as const

export type ReturnBasis = (typeof RETURN_BASES)[number]

/**
 * What a holding place is expected to earn, and on whose authority.
 *
 * **The number and its provenance are one field.** The schema stores two
 * nullable columns, but nothing in the domain can hold a rate without saying
 * what kind it is, which is the whole point of recording the second one:
 * presenting an assumption as a fact is the failure mode docs/f07 names, and a
 * separate flag is a flag a caller can forget to read.
 *
 * Basis points a year, before any charges: 400 is 4%. A rate is not money
 * (D-003), and this one ends up in `projectBalance`, which is integer
 * throughout.
 */
export interface ExpectedReturn {
  readonly basisPoints: number
  readonly basis: ReturnBasis
}

/**
 * Where the money physically is — **a location and nothing else** (D-175).
 *
 * The rate, the liquidity and the term used to be here, because the place was
 * the only record there was to put them on. Bank Hapoalim does not have a
 * return; the fixed deposit you hold there does, the current account beside it
 * does not, and both are at this one place. They are on `Holding` now.
 */
export interface HoldingPlace {
  readonly id: string
  readonly name: string
  readonly kind: HoldingPlaceKind
  /** Bank or broker. Free text — this is not `Institution`, which is for accounts. */
  readonly institution: string | undefined
  readonly note: string | undefined
  readonly isArchived: boolean
  /**
   * The account whose statements show this place's money (M30 U1, D-354). A
   * place **links** to an account and is not one: a deposit or cash at home has
   * no statements and names none. Optional, so a place written before it names
   * nothing.
   */
  readonly accountId?: string | undefined
}

/**
 * What form the money takes.
 *
 * `TRACK` is a pension or provident investment track; `SECURITY` is a position
 * in one security, read from a holdings statement. `CASH` is an ordinary holding rather than
 * an absence of one — **money always lands in a holding** (D-175), which is what
 * lets a brokerage account hold its cash and its funds side by side without
 * either nesting inside the other.
 */
export const HOLDING_KINDS = ['CASH', 'DEPOSIT', 'FUND', 'TRACK', 'SECURITY', 'OTHER'] as const

export type HoldingKind = (typeof HOLDING_KINDS)[number]

/**
 * **How the balance is known** (D-176), which is the question three real
 * kinds of savings actually differ on.
 *
 * `RECORDED` is Σ the movements the user entered and nothing else will ever
 * confirm it — the envelope in the drawer, the sum kept aside inside a current
 * account. `TRANSCRIBED` means a statement says what it is: a bank deposit, a
 * fund report. `VALUED` means positions times a price (M16).
 *
 * A three-value union rather than an `isTracked` boolean, because a boolean
 * cannot separate a transcribed statement from a valued portfolio and M16 needs
 * that separation to know whether a missing price matters. The same three-way
 * split the app already lives by twice: F13's snapshots are the deliberate
 * exception to "balances are always derived", and D-149 gave a reading's proof a
 * third state rather than a boolean.
 */
export const HOLDING_PROVENANCES = ['RECORDED', 'TRANSCRIBED', 'VALUED'] as const

export type HoldingProvenance = (typeof HOLDING_PROVENANCES)[number]

/**
 * What the money is held **in**, which is the thing that earns a return and the
 * thing that is or is not reachable (D-175).
 *
 * `isLiquid` is the field the emergency-fund figure turns on, and it is the
 * user's answer rather than an inference from `kind`: a פק"מ with six months to
 * run is a `DEPOSIT` and is not liquid, while one that matures next week
 * arguably is, and only the user knows which they have. It lives here rather
 * than on the place so that a brokerage account's cash can count towards an
 * emergency fund while its index fund does not — which is a better answer than
 * the whole-place flag it replaces, not merely a differently arranged one.
 *
 * `provenance` and `lastConfirmedAt` are the money map's third column, in place
 * of the rate this record just took off the place (D-176). `lastConfirmedAt`
 * absent means nobody has ever confirmed it, which is a sentence the screen says
 * rather than a blank it hides.
 */
export interface Holding {
  readonly id: string
  readonly holdingPlaceId: string
  readonly name: string
  readonly kind: HoldingKind
  readonly provenance: HoldingProvenance
  /** When the balance was last checked against whatever would confirm it. */
  readonly lastConfirmedAt: LocalDate | undefined
  /** Money reachable this week. What an emergency fund is allowed to count. */
  readonly isLiquid: boolean
  /** Absent means "nobody has said", which projects flat rather than at a guess. */
  readonly expectedReturn: ExpectedReturn | undefined
  /** When a term ends, for the holdings that have one. */
  readonly termEndDate: LocalDate | undefined
  /** What it charges a year, in basis points. A fund's two bases stay in F13. */
  readonly feeBasisPoints: number | undefined
  readonly note: string | undefined
  readonly isArchived: boolean
  /**
   * Set on the one holding that is this account's own cash — made with its
   * place's link to the account, and cleared when that link goes (M30 U1,
   * D-354). Every other holding names none.
   */
  readonly accountId?: string | undefined
  /**
   * Set on a pension, a study fund or a provident fund, and on nothing else
   * (M36 U12, D-389). **A fund is a holding**: its page, its fees and its deposit
   * check are the Funds screen's, and it is counted in every total once, as this
   * row.
   */
  readonly fundType?: FundType | undefined
}

/**
 * One thing the user is saving for. **No balance**: that is Σ its deposits.
 */
export interface SavingGoal {
  readonly id: string
  readonly name: string
  /** Open-ended goals are real: "the house fund" with no number yet. */
  readonly targetAmount: Money | undefined
  readonly targetDate: LocalDate | undefined
  readonly kind: SavingGoalKind
  /** Where deposits land unless the user says otherwise. A holding (D-175). */
  readonly defaultHoldingId: string | undefined
  /** Reached or abandoned. Keeps its history; takes no new deposits. */
  readonly isClosed: boolean
  /** Order for the splitter (F05). */
  readonly priority: number
  readonly note: string | undefined
}

/**
 * What already puts real money into a goal, so a plan must not put it there a second time (M28 F27).
 *
 * Three kinds, and a goal has one at most (M30 U4, D-357): a Money moved category whose
 * transactions become the goal's deposits (D-324), the rows that name the goal's default
 * holding — bought or sold inside an account with holdings — or the confirmed transfers
 * into and out of the bank or cash account whose own Cash the goal's money is (M30 F4, D-364).
 */
export interface GoalFeed {
  readonly kind: 'CATEGORY' | 'HOLDING' | 'TRANSFERS'
  /** The category's id, the holding's, or the account's. */
  readonly id: string
  /** Its name, as the screen and the tool say it. */
  readonly name: string
}

/**
 * One contribution, or — with a negative amount — one withdrawal.
 *
 * **Withdrawals are negative deposits** rather than an entity of their own,
 * which is what keeps a balance a single sum and avoids a whole class of bugs
 * (docs/f07). The price is that a withdrawal has to carry its reason in `note`,
 * which `validateDeposit` requires.
 *
 * `sourceRefId` is what makes a generated deposit idempotent: one deposit per
 * source ref, so re-importing a statement or re-editing a paycheck updates the
 * one that exists rather than adding another (docs/f07's invariant, and the
 * unique index migration `018` gets from `depositSourceKey`).
 */
export interface SavingDeposit {
  readonly id: string
  readonly goalId: string
  readonly date: LocalDate
  /**
   * Negative for a withdrawal, or for a loss on a `GROWTH` row. Never zero —
   * `validateDeposit` refuses one.
   */
  readonly amount: Money
  /** **Money always lands in a holding** (D-175), never in a bare place. */
  readonly holdingId: string
  readonly sourceKind: DepositSourceKind
  /** The `Transaction`, `PaycheckLine` or `Allocation` that generated it. */
  readonly sourceRefId: string | undefined
  /**
   * Ties the two legs of a move between holding places together.
   *
   * Moving ₪10,000 from checking into a פק"מ is not a contribution and must not
   * read as one: it is a negative deposit in the first holding and a positive
   * one in the second, netting to zero (docs/f07's edge case). The key is what lets
   * a screen show them as one row and `validateTransfer` check that they net.
   */
  readonly transferGroupKey: string | undefined
  readonly note: string | undefined
}
