/**
 * Long-term funds — the shapes. docs/f13-pension-and-hishtalmut.md.
 *
 * **A fund is a holding** (M36 U12, D-389): a `FundAccount` is the view of a
 * `holding` row whose `fund_type` is set, a `FundBalanceSnapshot` of one of its
 * `holding_reading` rows, and a `FundDeposit` of a `reading_deposit` row. The
 * names stayed because every figure below was built on them; the storage is one
 * model, so a pension can no longer be entered twice and counted twice.
 *
 * Shapes only; the arithmetic is `@/domain/funds.ts`. Plain TypeScript: no
 * React, no sql.js, no DOM, no database (docs/conventions.md).
 *
 * Four things this model insists on, because a pension is the one balance in
 * this app that grows for two completely different reasons:
 *
 * - **A deposit is never a gain.** Nothing in here is called `balance change`,
 *   and no function in the companion file hands one out. A return figure is
 *   computed from a snapshot pair *and* the contributions between them, or it is
 *   not computed at all (D-066).
 * - **A fee is basis points, not a decimal.** 0.5% is `50`. A decimal fee
 *   multiplied against a balance is a float in the money path, which is what
 *   D-003 exists to prevent and what D-056 already decided for allocation
 *   percentages.
 * - **There is no `linkedDeductionTypeIds`.** docs/f13 lists one, but the fact it
 *   names is already stored the other way round, on `DeductionType.linkedFundId`
 *   (`deduction_type.linked_holding`, D-389). A second name for one fact is the
 *   shape D-037 removed from `CategoryRule`.
 * - **Contributions are derived; an answer about them is stored.** An
 *   `ExpectedContribution` has no id because it is not a row — it is what the
 *   payslips say, recomputed every time. The one thing that cannot be
 *   re-derived is the user having chased a gap and found it harmless, which is
 *   `FundBalanceSnapshot.depositGapAcknowledged`.
 */

import type { Money } from '@/core/money.ts'
import type { LocalDate, YearMonth } from '@/core/time.ts'

export const FUND_TYPES = [
  'PENSION',
  'STUDY_FUND',
  'PROVIDENT',
  'MANAGERS_INSURANCE',
  'PROVIDENT_FOR_INVESTMENT',
] as const

export type FundType = (typeof FUND_TYPES)[number]

/**
 * `DORMANT` is the one that earns its place: a fund from a job three years ago
 * takes no new deposits and still charges fees every month, and making that
 * visible is half of why F13 exists. It is also what tells the reconciliation
 * that nothing arriving is the correct answer rather than a missing deposit.
 */
export const FUND_STATUSES = ['ACTIVE', 'DORMANT', 'CLOSED'] as const

export type FundStatus = (typeof FUND_STATUSES)[number]

/**
 * The two management fees, in basis points a year and per deposit.
 *
 * Separate from `FundAccount` because the projection compares two of them — the
 * fee the user pays and the fee they could negotiate — and neither of those is
 * a fund.
 */
export interface FundFees {
  /** דמי ניהול מהצבירה, annual, in basis points of the balance. 50 is 0.5%. */
  readonly onAccumulationBasisPoints: number | undefined
  /** דמי ניהול מהפקדה, in basis points of each contribution. 600 is 6%. */
  readonly onDepositBasisPoints: number | undefined
}

/**
 * One fund account the user holds.
 *
 * `firstDepositDate` is not decoration: it is what the study-fund liquidity date
 * counts from, and a fund report states it where a payslip cannot.
 */
export interface FundAccount {
  readonly id: string
  readonly name: string
  readonly fundType: FundType
  readonly institutionId: string | undefined
  readonly policyNumber: string | undefined
  readonly investmentTrack: string | undefined
  readonly status: FundStatus
  /** Which job it belongs to. Dormant funds from old jobs are the common case. */
  readonly employerName: string | undefined
  readonly openedDate: LocalDate | undefined
  readonly firstDepositDate: LocalDate | undefined
  readonly fees: FundFees
  /** Fee agreements expire and silently revert to the default. */
  readonly feeNegotiatedUntil: LocalDate | undefined
  /** A yearly return the provider agreed to, in basis points. Not an assumption: it is shown apart from one (M28 U8, S6). */
  readonly agreedReturnBasisPoints?: number | undefined
  readonly beneficiaries: string | undefined
  readonly notes: string | undefined
  readonly isArchived: boolean
}

/**
 * A point-in-time reading, transcribed from a fund report or the fund's website.
 *
 * The deliberate exception to "balances are always derived" (docs/conventions):
 * there is no deposit stream to derive one from, because the app never sees the
 * fund's own ledger.
 *
 * **`depositsSincePrevious` is the fund's claim**, covering the period since the
 * snapshot before this one. On the earliest snapshot of a fund it covers no
 * window this document can see, so nothing reads it there.
 */
export interface FundBalanceSnapshot {
  readonly id: string
  readonly fundAccountId: string
  readonly asOfDate: LocalDate
  readonly totalBalance: Money
  /** Different tax and withdrawal rules; reports usually break these out. */
  readonly employeeComponent: Money | undefined
  readonly employerComponent: Money | undefined
  readonly severanceComponent: Money | undefined
  /** What the fund says it received. Compared against the payslips. */
  readonly depositsSincePrevious: Money | undefined
  /** What the fund says it charged. The only way to see the fee actually paid. */
  readonly feesChargedSincePrevious: Money | undefined
  /** What the fund says it earned, as printed. Never what this app computes. */
  readonly returnSincePrevious: Money | undefined
  /**
   * The user chased the deposit gap ending at this snapshot and found it
   * explained — a timing offset, a correction next quarter, an employer who
   * paid late.
   *
   * Stored because it cannot be re-derived: everything else about the
   * reconciliation is recomputed from payslips and snapshots, and this is the
   * one fact that lives only in the user's head. The same argument
   * `CardSettlementLink.userDecision` won (D-061), and the answer sits on a row
   * that already exists rather than in a table of its own.
   */
  readonly depositGapAcknowledged: boolean
  readonly note: string | undefined
}

/**
 * One row of the deposit table a fund report prints — the other side of an
 * `ExpectedContribution`, and the only place this app ever learns what the fund
 * says it received **per month** rather than per period (D-153).
 *
 * **`salaryMonth` is the whole point.** Everything else here a report's totals
 * already imply; the salary month does not, and without it a payroll month has
 * to be matched to a deposit date through a guessed lag — which is what
 * `reconcileDeposits` does, and why its answer is a running total over a window
 * rather than a verdict about January. A row that says *this ₪1,750 is for
 * 11/2025, and it arrived on 04/01/2026* answers both questions outright.
 *
 * **Transcribed, not derived**, and every amount is optional for
 * `FundBalanceSnapshot`'s reason: absent means the report did not print it,
 * which is a different fact from zero. A row with no amount at all is not a row
 * and is never built.
 *
 * **Duplicates across readings are expected and are kept.** An Israeli
 * quarterly is year-to-date (D-152), so Q2's table restates every row of Q1's.
 * Each reading transcribes its own document faithfully and `distinctDeposits`
 * dedupes when anything aggregates — the same division of labour as everywhere
 * else in F13: transcribe faithfully, reconcile afterwards.
 */
export interface FundDeposit {
  readonly id: string
  readonly fundAccountId: string
  /** The reading this row was transcribed from. A deposit is what a report said. */
  readonly snapshotId: string
  readonly employerName: string | undefined
  /** When the money reached the fund. */
  readonly depositDate: LocalDate | undefined
  /** The salary month it is **for**. The column this table exists for. */
  readonly salaryMonth: YearMonth | undefined
  readonly employee: Money | undefined
  readonly employer: Money | undefined
  readonly severance: Money | undefined
  /** The row's own total column, where it has one. Never a computed sum. */
  readonly total: Money | undefined
  /** The salary the deposit was computed on, where the table prints it. */
  readonly salary: Money | undefined
  readonly note: string | undefined
}

/**
 * What one payslip says should reach one fund.
 *
 * **Derived, never stored** — no id, no created-at, nothing to keep in sync. It
 * is recomputed from `PaycheckLine` × `DeductionType.linkedFundId` every
 * time anything asks, which is what docs/f13 means by "derived, not entered".
 *
 * Three components rather than one number because they are three different
 * kinds of money: the employee's own, the employer's, and severance, whose tax
 * and withdrawal rules differ enough that merging it misleads (docs/f13's open
 * question, answered in D-066).
 */
export interface ExpectedContribution {
  readonly fundAccountId: string
  readonly paycheckId: string
  /** The salary month, which is what the lag is applied to. */
  readonly period: YearMonth
  readonly employee: Money
  readonly employer: Money
  readonly severance: Money
  readonly total: Money
  /**
   * The base the slip says these amounts were computed on — `PaycheckLine`'s
   * `basisAmount`, and **not the gross** (D-169).
   *
   * A pensionable base is routinely less than the gross: overtime, a car
   * allowance and a one-off bonus are pay and are usually not pensionable. So
   * this is the only figure on the slip that can be set against the base the
   * fund's own deposit table prints, and comparing the gross instead would
   * report a difference on every correct slip in the country.
   *
   * Absent when the slip prints no base, and absent when the lines feeding one
   * fund disagree about it — a partial answer here would be a false gap.
   */
  readonly salaryBasis: Money | undefined
}

/**
 * Regulatory caps and typical negotiated fees, for one fund type.
 *
 * **Shipped with the app, overridable in the document** — D-046's answer, and
 * for D-046's reason: nothing holds a foreign key to a benchmark, and a cap
 * changes when the regulator changes it rather than per document. The shipped
 * table is `@/data/reference/fundFeeReference.ts`; every function in
 * `@/domain/funds.ts` is *given* these rather than looking them up, so a
 * document that disagrees with the shipped numbers wins without the domain
 * knowing there was a disagreement.
 *
 * `asOf` and `source` are not metadata. A stale cap presented as current would
 * be worse than no benchmark at all (docs/f13), so the date it was true on
 * travels with the number and the screen shows it.
 */
export interface FeeReference {
  readonly fundType: FundType
  readonly capOnAccumulationBasisPoints: number
  readonly capOnDepositBasisPoints: number
  readonly typicalOnAccumulationBasisPoints: number
  readonly typicalOnDepositBasisPoints: number
  readonly asOf: LocalDate
  readonly source: string
}

/**
 * How well a fund report checked itself.
 *
 * `unchecked` is not a soft `failed`. It says every proof this document could
 * have run was unavailable because the figures those proofs need are not on the
 * page — which is the ordinary case for an annual pension statement that prints
 * a balance, a fee, and nothing to tie them together.
 *
 * F17 calls this the weakest of the three verifiers and it is honest about why.
 * A payslip carries its arithmetic on every slip ever printed; a report prints
 * *opening + deposits + yield − fees = closing* only sometimes, the three
 * components of the balance only sometimes, and a deposit table to add up only
 * sometimes (D-153). Collapsing the third state into
 * `false` would mean no report that prints only a balance could ever be read
 * twice; collapsing it into `true` would make an unchecked misreading
 * indistinguishable from a checked one. It is D-138 stated for a different
 * document: **a verifier proves what it checks and nothing else**, and where
 * nothing checks, the person in front of the screen is the check.
 */
export type FundReportProof = 'proved' | 'failed' | 'unchecked'

/**
 * What a fund report says, as read — the `PayslipReading` of F13's documents.
 *
 * Nothing here is written anywhere and nothing is decided: this is what a
 * confirm surface shows a person, and what `snapshotFromReport` turns into a
 * draft they save themselves.
 *
 * Every figure is optional and **absent means the report did not print it**, not
 * zero — the same distinction `SnapshotEditor` already keeps, and the one the
 * reconciliation and the fee panel both branch on.
 */
export interface FundReportAccountFacts {
  /** דמי ניהול מהפקדה, as basis points. 1.00% is 100. */
  readonly feeOnDepositBasisPoints?: number
  /** דמי ניהול מהצבירה / מחיסכון. */
  readonly feeOnAccumulationBasisPoints?: number
  readonly investmentTrack?: string
  readonly employerName?: string
}

/**
 * A deposit row as **read off a report**, before anything has agreed to it.
 *
 * `FundDeposit` without the three ids, for the same reason `FundReportReading`
 * is not a `FundBalanceSnapshot`: this is what a confirm surface shows a
 * person, and it becomes a row only when they save the reading it belongs to.
 */
export type ReadDeposit = Omit<FundDeposit, 'id' | 'fundAccountId' | 'snapshotId'>

export interface FundReportReading {
  readonly closingBalance?: Money
  readonly openingBalance?: Money
  readonly deposits?: Money
  readonly fees?: Money
  readonly yield?: Money
  readonly asOfDate?: LocalDate
  /** Where the period begins. A report that is year-to-date says so here. */
  readonly periodStart?: LocalDate
  readonly employeeComponent?: Money
  readonly employerComponent?: Money
  readonly severanceComponent?: Money
  /** The monthly pension the report projects, where it projects one. */
  readonly expectedPension?: Money
  /**
   * Everything else that left the fund — insurance costs beside the management
   * fee — as **magnitudes**, and everything that moved it either way.
   *
   * They exist because the first real report has both and the equation without
   * them is off by their sum (D-152).
   */
  readonly charges: readonly Money[]
  readonly adjustments: readonly Money[]
  /**
   * The deposit table, row by row, where the report prints one (D-153).
   *
   * Empty means the template names no table or the document has none — never
   * that the fund received nothing. What makes these worth reading at all is
   * `salaryMonth`: it is the one fact on a fund report that no total implies.
   */
  readonly depositRows: readonly ReadDeposit[]
  /**
   * What the report says about the **account** rather than about the period.
   *
   * The fees especially: F13 exists because nobody knows what their fees are,
   * and the report is the only document that states them. Kept apart from the
   * figures because they are written to a different row — the fund, not the
   * snapshot.
   */
  readonly account: FundReportAccountFacts
  /**
   * Which line of the document each field was read off, by field name —
   * the reading's own account of where it looked (D-168), and what lets the
   * confirm surface point at the page instead of naming a line number.
   */
  readonly lines: Readonly<Record<string, number>>
  /** Fields the template named that this document could not answer. */
  readonly unresolved: readonly { readonly field: string; readonly reason: string }[]
  /** A figure taken from the line next door — a boxed total (D-143). */
  readonly borrowed: readonly {
    readonly field: string
    readonly named: number
    readonly used: number
  }[]
  /** opening + deposits + yield − fees − closing, when all five are printed. */
  readonly periodDelta?: Money
  /** employee + employer + severance − closing, when all four are printed. */
  readonly componentDelta?: Money
  /**
   * The deposit rows summed, minus the deposits figure — the **third** equation,
   * and on a report that prints a table it is usually the one that can run.
   *
   * It proves the amounts in the table and nothing else. Which salary month a
   * deposit is for, and who paid it, are read off the same rows and are checked
   * by no arithmetic anywhere — D-138, and the reason the surface says so
   * (D-153).
   */
  readonly depositTableDelta?: Money
  /**
   * How far out the period equation may legitimately be, because the report
   * rounds its figures to the shekel and says so (D-152). Zero for a report
   * that prints agorot.
   */
  readonly tolerance?: Money
  readonly proof: FundReportProof
}
