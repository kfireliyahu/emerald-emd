/**
 * A payslip, its lines, and the vocabulary a line names — docs/04-data-model.md
 * ("Income") and docs/f04-paycheck-tracking.md.
 *
 * Shapes only; the math is `@/domain/paycheck.ts`. Plain TypeScript: no React,
 * no sql.js, no DOM, no database (docs/conventions.md).
 *
 * The Israeli slip has three sides and the model keeps them distinct, because
 * confusing any two makes the savings rate and total compensation nonsense:
 *
 * - **Employee deductions** that reduce net — tax, national insurance, health,
 *   the employee share of pension and study fund, union dues, loan repayments.
 * - **Employer contributions** that never touch net but are money the user owns
 *   or accrues — the employer share of the same pension line, and severance.
 * - **Notional additions** that inflate gross for tax without being cash —
 *   company car value, meal card.
 *
 * Which side an amount is on is decided by two flags on the type and by which
 * of the two columns it was entered into, and by nothing else.
 */

import type { Money } from '@/core/money.ts'
import type { LocalDate, YearMonth } from '@/core/time.ts'

/**
 * What a deduction is, for the figures that group by it: the effective tax rate
 * sums `TAX`, `SOCIAL_INSURANCE` and `HEALTH`, and nothing else asks.
 *
 * The two flags carry the arithmetic; the kind carries the grouping. They are
 * not the same question — `PENSION` and `STUDY_FUND` share both flags and are
 * still two different rows on the slip.
 */
export const DEDUCTION_KINDS = [
  'TAX',
  'SOCIAL_INSURANCE',
  'HEALTH',
  'PENSION',
  'STUDY_FUND',
  'SEVERANCE',
  'LOAN_REPAYMENT',
  'UNION',
  'BENEFIT_IN_KIND',
  'OTHER_DEDUCTION',
  'ADDITION',
] as const

export type DeductionKind = (typeof DEDUCTION_KINDS)[number]

/** The kinds the effective tax rate is the sum of (docs/05). */
export const TAX_KINDS: readonly DeductionKind[] = ['TAX', 'SOCIAL_INSURANCE', 'HEALTH']

export const PAYCHECK_SOURCE_KINDS = ['MANUAL', 'PDF_PARSED', 'AI_PARSED'] as const

export type PaycheckSourceKind = (typeof PAYCHECK_SOURCE_KINDS)[number]

/**
 * One entry in the vocabulary — "Pension", "Income tax" — shipped or added by
 * the user.
 *
 * Rows in the document, seeded by migration 012 (D-049). A `PaycheckLine` holds
 * a real foreign key into this table, and the links and flags below are
 * per-document state that has to be stored somewhere regardless.
 */
export interface DeductionType {
  readonly id: string
  readonly name: string
  /** What the slip prints. Present on every built-in; optional on a user's own. */
  readonly hebrewName: string | undefined
  readonly kind: DeductionKind
  /** False for the employer side and for notional items. */
  readonly reducesNet: boolean
  /** True for pension, study fund and severance: wealth, not spending. */
  readonly countsAsSaving: boolean
  /** Route a line of this type into a savings balance (F07). */
  readonly linkedSavingGoalId: string | undefined
  /** A payroll-deducted loan reduces a debt (F08). */
  readonly linkedDebtId: string | undefined
  /** Which fund this feeds, producing the expected contributions F13 reconciles. */
  readonly linkedFundId: string | undefined
  /** Shipped with the app. Editable, not deletable. */
  readonly isBuiltIn: boolean
  readonly sortOrder: number
}

/**
 * One deduction or addition on the slip.
 *
 * **Both amounts are magnitudes.** "How much was taken" is what the slip prints
 * and what the user types, and the direction is the type's `reducesNet` — a
 * signed amount here would put a minus in front of a number the slip shows
 * without one. D-004's sign convention is about a transaction's direction and
 * does not reach this table.
 *
 * `employerAmount` is undefined where the type has no employer side at all,
 * which is a different fact from an employer share of zero: one says the
 * question does not apply, the other says it applies and the answer was nothing
 * this month.
 */
export interface PaycheckLine {
  readonly id: string
  readonly paycheckId: string
  readonly deductionTypeId: string
  readonly employeeAmount: Money
  readonly employerAmount: Money | undefined
  /** The salary base a percentage applied to, when the slip prints one. */
  readonly basisAmount: Money | undefined
  readonly note: string | undefined
  readonly sortOrder: number
}

/**
 * One payslip.
 *
 * `net` is **entered, never derived**. The app must never argue with the slip:
 * what it does instead is show the reconciliation delta and let the user decide
 * whether the difference is worth itemizing (`reconciliationDelta`).
 */
export interface Paycheck {
  readonly id: string
  /** The salary month, not the month it was paid in. */
  readonly period: YearMonth
  readonly paymentDate: LocalDate
  readonly employerName: string | undefined
  readonly gross: Money
  readonly net: Money
  readonly depositedToAccountId: string | undefined
  readonly note: string | undefined
  readonly sourceKind: PaycheckSourceKind
  readonly attachmentRef: string | undefined
  /** A bonus or 13th-salary month, which averages exclude. Confirmed by the user. */
  readonly isIrregular: boolean
}

/** A paycheck with the lines that belong to it. What every figure below reads. */
export interface PaycheckWithLines {
  readonly paycheck: Paycheck
  readonly lines: readonly PaycheckLine[]
  /**
   * **What the document works out about a stored slip** (M36 U03) — the
   * figures the pack declares on `paycheck`, read by the repository. Absent on
   * a draft, which has no row to work them out on; a figure inside is
   * `undefined` when the engine would not give one (a line whose type the
   * document no longer has).
   */
  readonly figures?: PaycheckFigures | undefined
}

/** A stored slip's declared figures (M36 U03). */
export interface PaycheckFigures {
  /** `unexplained`: `gross - deducted - net` — what the `net` identity fails by, signed. */
  readonly unexplained: Money | undefined
  /** `saved_employee`: the employee's side of the lines whose type counts as saving. */
  readonly savedEmployee: Money | undefined
  /** `employer_paid`: the employer's side of every line that has one (M36 U04). */
  readonly employerPaid?: Money | undefined
  /** `tax`: income tax, national insurance and health tax (M36 U04). */
  readonly tax?: Money | undefined
  /** `compensation`: `gross + employer_paid` (M36 U04). */
  readonly compensation?: Money | undefined
  /** `tax_rate`: `tax / gross`, a share; undefined when gross is zero (M36 U04). */
  readonly taxRate?: number | undefined
}

/* ------------------------------------------- a payslip, before it is a record */

/**
 * What executing a mapping template found on one document.
 *
 * **Types here rather than beside the executor that produces them**, which is
 * `src/data/importer/payslipTemplate.ts`. The executor has to live in the data
 * layer — it reads text with the importer's own amount parser (D-138) — and the
 * review that decides what a person is shown has to live in the domain. Types
 * are the one thing both may hold, and the dependency arrow only points one
 * way: `data/` may import `domain/`, never the reverse (docs/02).
 *
 * The same split `DraftMapping` already takes: the shape in `domain/model/`,
 * the algorithm over it in `data/importer/`.
 */
export interface DeductionReading {
  /**
   * Which anchor produced this row — `deduction[0]` and its siblings.
   *
   * Carried rather than re-derived from this array's index, which is what the
   * review surface used to do. The two agree only while every deduction anchor
   * resolved: one anchor that pointed at a blank line makes `deductions[1]` the
   * reading of `deduction[2]`, and everything keyed by position after it names
   * the wrong row — a doubt about the wrong line, and, now that a naming is
   * stored against the format, a naming on the wrong one.
   */
  readonly field: string
  readonly line: number
  /** The label as printed, read off the document rather than copied by a model. */
  readonly label: string
  readonly employee?: Money
  readonly employer?: Money
  readonly basis?: Money
}

/**
 * Everything a template found on one slip, and whether the slip agrees.
 *
 * `delta` is the point. Zero means the itemization accounts for every agora and
 * the template can be trusted for next month's slip; anything else means it
 * cannot, and F17 says that routes to re-derivation rather than to a warning.
 */
export interface PayslipReading {
  readonly gross?: Money
  readonly net?: Money
  readonly statedDeductionsTotal?: Money
  /**
   * The month the pay is for, and the day it was paid.
   *
   * Values, read off the lines a template names, exactly as the figures are — a
   * date is not a thing a model is ever asked for (D-132). Absent when the
   * template names no such line or the line prints nothing date-shaped, which is
   * the honest answer: the confirm surface asks for it rather than guessing, and
   * a slip filed under the wrong month is wrong in a way every figure on it
   * being right does not fix.
   */
  readonly salaryMonth?: YearMonth
  readonly payDate?: LocalDate
  readonly deductions: readonly DeductionReading[]
  /**
   * Which line of the document each field was read off, by field name.
   *
   * **The reading's own account of where it looked**, which is what lets a
   * confirm surface point at the page rather than name a line number nobody can
   * check (D-168). A field the template did not resolve is simply absent, the
   * same as its figure is.
   */
  readonly lines: Readonly<Record<string, number>>
  readonly unresolved: readonly { readonly field: string; readonly reason: string }[]
  /**
   * Fields whose figure was on a line the template did not name — a boxed total,
   * whose name and number sit on separate lines once the page is flattened.
   *
   * Reported rather than hidden. The reading is checked by the same arithmetic
   * either way, and a person looking at the surface should know that a figure
   * came from somewhere nobody pointed at.
   */
  readonly borrowed: readonly {
    readonly field: string
    readonly named: number
    readonly used: number
  }[]
  /** `gross − Σ employee deductions − net`. Zero is the slip agreeing with itself. */
  readonly delta?: Money
  /**
   * `Σ employee deductions − the total the slip printed`, when it printed one.
   *
   * A second proof, independent of the first: `delta` can come out zero with a
   * deduction line missed *and* the gross misread by the same amount, and this
   * would not. Absent when the slip does not print a total, which is the honest
   * answer rather than a pass.
   */
  readonly statedTotalDelta?: Money
  readonly reconciles: boolean
}
