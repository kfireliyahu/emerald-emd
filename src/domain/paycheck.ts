/**
 * Paycheck math — docs/packs/ledger/05-domain-rules-and-calculations.md, "Paycheck math".
 *
 * Pure functions over plain values: no database, no clock, no React. The whole
 * of F04's acceptance criterion — "entering a real slip reproduces its net
 * exactly with a zero reconciliation delta" — is `reconciliationDelta` below,
 * which is why it is written and tested before a screen exists to show it.
 *
 * Three things hold everywhere in here:
 *
 * - **`net` is entered, never derived.** Nothing in this file computes a net.
 *   The delta is *shown*, and it is a warning rather than a blocker, because a
 *   real slip contains items the user will not itemize.
 * - **Line amounts are magnitudes** (`@/domain/model/paycheck.ts`). The sign of
 *   a deduction is its type's `reducesNet`, not a minus on the number.
 * - **A rate is not money.** Rates come back as integer basis points, so no
 *   float ever touches an amount (D-003). 2350 is 23.5%.
 *
 * Every figure takes the deduction types it needs rather than looking them up:
 * the flags decide the arithmetic, and a function that cannot see them would be
 * guessing.
 */

import { abs, add, money, sum, type CurrencyCode, type Money } from '@/core/money.ts'
import { ratioBasisPoints, shareBasisPoints } from '@/core/percent.ts'
import { addMonths, compareYearMonths, type YearMonth } from '@/core/time.ts'
import {
  TAX_KINDS,
  type DeductionType,
  type Paycheck,
  type PaycheckLine,
  type PaycheckWithLines,
} from '@/domain/model/paycheck.ts'

/**
 * How far above the median a net has to be before the app suggests the month
 * was a bonus. From docs/05; the user confirms, the app never decides.
 */
export const IRREGULAR_MULTIPLE_NUMERATOR = 3
export const IRREGULAR_MULTIPLE_DENOMINATOR = 2

function index(types: readonly DeductionType[]): ReadonlyMap<string, DeductionType> {
  return new Map(types.map((type) => [type.id, type]))
}

/**
 * Lines whose deduction type is not in the set given.
 *
 * Sums below skip these rather than guessing which side of the slip they were
 * on — a line counted as net-reducing when it was not would move the delta, and
 * the delta is the one number the user is checking the app against. A screen
 * that has some shows them: an orphaned line is money on the slip that the
 * totals are not accounting for, and that has to be visible rather than
 * absorbed.
 */
export function unresolvedLineIds(
  entry: PaycheckWithLines,
  types: readonly DeductionType[],
): readonly string[] {
  const byId = index(types)
  return entry.lines.filter((line) => !byId.has(line.deductionTypeId)).map((line) => line.id)
}

function totalWhere(
  lines: readonly PaycheckLine[],
  types: readonly DeductionType[],
  currency: CurrencyCode,
  predicate: (type: DeductionType) => boolean,
  pick: (line: PaycheckLine) => Money | undefined = (line) => line.employeeAmount,
): Money {
  const byId = index(types)
  const amounts: Money[] = []
  for (const line of lines) {
    const type = byId.get(line.deductionTypeId)
    if (type === undefined || !predicate(type)) continue
    const amount = pick(line)
    if (amount !== undefined) amounts.push(amount)
  }
  return sum(amounts, currency)
}

/** Σ of the employee amounts on lines whose type actually comes out of take-home pay. */
export function netReducingTotal(
  entry: PaycheckWithLines,
  types: readonly DeductionType[],
): Money {
  return totalWhere(entry.lines, types, entry.paycheck.gross.currency, (type) => type.reducesNet)
}

/**
 * `gross − Σ(net-reducing lines) − net`.
 *
 * Zero means the itemization accounts for every agora between gross and net.
 * Positive means something was taken that has not been entered — the entry
 * screen offers to add it as one "Other deduction" line. Negative means more
 * has been itemized than the difference allows, which is usually an employer
 * share typed into the employee column.
 *
 * Never enforced, never auto-corrected. The slip is authoritative.
 */
export function reconciliationDelta(
  entry: PaycheckWithLines,
  types: readonly DeductionType[],
): Money {
  // A stored slip's is the document's own figure — `paycheck.unexplained`, the
  // signed side of the `net` identity (M36 U03). The sum below is a draft's,
  // which has no row yet; and a stored slip's only when the document cannot
  // answer, which is a line whose type is gone and which the screen lists.
  const declared = entry.figures?.unexplained
  if (declared !== undefined) return declared
  const { gross, net } = entry.paycheck
  return money(gross.minor - netReducingTotal(entry, types).minor - net.minor, gross.currency)
}

/**
 * Σ of the employer side of every line that has one. A stored slip's is the
 * document's `employer_paid` (M36 U04); the sum is a draft's.
 */
export function employerTotal(entry: PaycheckWithLines): Money {
  const declared = entry.figures?.employerPaid
  if (declared !== undefined) return declared
  const currency = entry.paycheck.gross.currency
  const amounts: Money[] = []
  for (const line of entry.lines) {
    if (line.employerAmount !== undefined) amounts.push(line.employerAmount)
  }
  return sum(amounts, currency)
}

/**
 * `gross + Σ employer amounts` — what the job actually pays.
 *
 * The figure that makes the employer's pension and severance contributions
 * visible as the compensation they are, rather than as money that never
 * appeared.
 */
export function totalCompensation(entry: PaycheckWithLines): Money {
  return entry.figures?.compensation ?? add(entry.paycheck.gross, employerTotal(entry))
}

export interface PayrollSavings {
  readonly employee: Money
  readonly employer: Money
  readonly total: Money
}

/**
 * What this slip put away rather than spent: both sides of every line whose
 * type `countsAsSaving` — pension, study fund, severance.
 *
 * Split rather than one number because the two answer different questions:
 * "how much of my pay did I save" is the employee side, and "how much wealth
 * did this month add" is the total.
 */
export function payrollSavings(
  entry: PaycheckWithLines,
  types: readonly DeductionType[],
): PayrollSavings {
  const currency = entry.paycheck.gross.currency
  const saving = (type: DeductionType): boolean => type.countsAsSaving
  // A stored slip's employee side is the document's `saved_employee` (M36 U03);
  // the sum is a draft's, as `reconciliationDelta`'s is.
  const employee = entry.figures?.savedEmployee ?? totalWhere(entry.lines, types, currency, saving)
  const employer = totalWhere(entry.lines, types, currency, saving, (line) => line.employerAmount)
  return { employee, employer, total: add(employee, employer) }
}

/** One line of a slip that put money away: its type and the employee's amount. */
export interface PayrollSavingLine {
  readonly deductionTypeId: string
  readonly name: string
  readonly employee: Money
}

/**
 * The lines `payrollSavings.employee` adds up, one per line — so a figure built
 * on it can say which pension or study fund the money went to (M30 F1). Same
 * predicate, same pick: they sum to `payrollSavings(entry, types).employee`.
 */
export function payrollSavingLines(
  entry: PaycheckWithLines,
  types: readonly DeductionType[],
): readonly PayrollSavingLine[] {
  const byId = index(types)
  const lines: PayrollSavingLine[] = []
  for (const line of entry.lines) {
    const type = byId.get(line.deductionTypeId)
    if (type === undefined || !type.countsAsSaving) continue
    lines.push({ deductionTypeId: type.id, name: type.name, employee: line.employeeAmount })
  }
  return lines
}

/**
 * Σ of income tax, national insurance and health tax (docs/05). A stored slip's
 * is the document's `tax` (M36 U04); the sum is a draft's, and a stored slip's
 * only where the document cannot answer.
 */
export function taxTotal(entry: PaycheckWithLines, types: readonly DeductionType[]): Money {
  const declared = entry.figures?.tax
  if (declared !== undefined) return declared
  return totalWhere(entry.lines, types, entry.paycheck.gross.currency, (type) =>
    TAX_KINDS.includes(type.kind),
  )
}

/** `Σ(tax + national insurance + health) ÷ gross`, in basis points. */
export function effectiveTaxRateBasisPoints(
  entry: PaycheckWithLines,
  types: readonly DeductionType[],
): number | undefined {
  // The document's `tax_rate` when it has one (M36 U04); a gross of zero has none.
  const declared = entry.figures?.taxRate
  if (declared !== undefined) return shareBasisPoints(declared)
  return ratioBasisPoints(taxTotal(entry, types), entry.paycheck.gross)
}

/**
 * `(payroll savings + savings deposited in the period) ÷ total compensation`,
 * in basis points — docs/05's effective savings rate.
 *
 * `additionalSavings` is the deposits half, which lives in F07 and does not
 * exist yet. It is a parameter rather than an omission so that the definition
 * here is docs/05's whole definition, and M5 passes the deposits in rather than
 * a second version of this function appearing beside it.
 */
export function savingsRateBasisPoints(
  entry: PaycheckWithLines,
  types: readonly DeductionType[],
  additionalSavings?: Money,
): number | undefined {
  const saved = payrollSavings(entry, types).total
  const total = additionalSavings === undefined ? saved : add(saved, additionalSavings)
  return ratioBasisPoints(total, totalCompensation(entry))
}

export type PaycheckProblem =
  | 'NEGATIVE_NET'
  | 'NEGATIVE_GROSS'
  | 'NET_ABOVE_GROSS'
  | 'NEGATIVE_LINE'
  | 'MIXED_CURRENCY'

/**
 * What makes a slip unenterable, and nothing else.
 *
 * Deliberately short. A non-zero reconciliation delta is **not** here: it is
 * information, not an error, and blocking on it would be the app arguing with
 * the slip. What is here is the set of things that cannot be true of any
 * payslip — a negative net is a typo (docs/f04), a net above gross means the
 * two fields were swapped, and a line in another currency would make every sum
 * below throw rather than answer.
 */
export function validatePaycheck(
  entry: PaycheckWithLines,
): readonly PaycheckProblem[] {
  const problems: PaycheckProblem[] = []
  const { gross, net } = entry.paycheck

  if (net.minor < 0) problems.push('NEGATIVE_NET')
  if (gross.minor < 0) problems.push('NEGATIVE_GROSS')
  if (gross.currency !== net.currency) problems.push('MIXED_CURRENCY')
  else if (net.minor > gross.minor) problems.push('NET_ABOVE_GROSS')

  const amounts = entry.lines.flatMap((line) =>
    [line.employeeAmount, line.employerAmount, line.basisAmount].filter(
      (amount): amount is Money => amount !== undefined,
    ),
  )
  if (amounts.some((amount) => amount.currency !== gross.currency)) problems.push('MIXED_CURRENCY')
  if (amounts.some((amount) => amount.minor < 0)) problems.push('NEGATIVE_LINE')

  return [...new Set(problems)]
}

/** Newest salary month first. The order every list and every average reads in. */
export function sortByPeriodDescending(
  paychecks: readonly Paycheck[],
): readonly Paycheck[] {
  return [...paychecks].sort(
    (a, b) => compareYearMonths(b.period, a.period) || (a.employerName ?? '').localeCompare(b.employerName ?? ''),
  )
}

/**
 * The median net of a set of slips, or nothing if there are none.
 *
 * Median rather than mean, for the same reason fixed-expense detection uses one
 * (docs/05): one bonus month must not drag the figure that decides which months
 * are bonus months. An even count takes the lower of the two middles rather than
 * averaging them — it keeps the result an amount that actually occurred, and
 * halving an odd number of agorot would invent one that did not.
 */
export function medianNet(paychecks: readonly Paycheck[]): Money | undefined {
  if (paychecks.length === 0) return undefined
  const sorted = [...paychecks].sort((a, b) => a.net.minor - b.net.minor)
  return sorted[Math.floor((sorted.length - 1) / 2)]?.net
}

/**
 * Whether a slip looks like a bonus month, judged against the *others*.
 *
 * Comparing against a median that includes the candidate would let the month in
 * question pull the line it is being measured against — with three slips, one of
 * them double, the doubled one can end up being the median.
 *
 * Integer comparison: `net × 2 > median × 3` is `net > 1.5 × median` without a
 * float. Answering true is a suggestion; `isIrregular` is only ever set by the
 * user confirming it (docs/05).
 */
export function isIrregularCandidate(
  candidate: Paycheck,
  others: readonly Paycheck[],
): boolean {
  const median = medianNet(others.filter((other) => other.id !== candidate.id))
  if (median === undefined || median.minor <= 0) return false
  return (
    candidate.net.minor * IRREGULAR_MULTIPLE_DENOMINATOR >
    median.minor * IRREGULAR_MULTIPLE_NUMERATOR
  )
}

export interface AverageNet {
  readonly amount: Money | undefined
  /** How many slips the average is of. Shown with it: an average of two is not an average. */
  readonly sampleSize: number
  /** Months left out for being irregular. Named so the UI can say "excluding 1 bonus month". */
  readonly excluded: number
}

/**
 * The mean net of the most recent `months` slips, bonus months excluded.
 *
 * Excluded by default and only by the flag the user confirmed — a month the app
 * merely suspects is still in the average, because a number quietly computed
 * over a different set than the one on screen is worse than a skewed one.
 *
 * Rounded half-up to the agora, in integers. The sample size comes back with
 * the amount because a missing month is information (docs/f04): the average of
 * the three slips that exist is not the average of the last twelve months, and
 * the screen has to be able to say which it is showing.
 */
export function averageNet(
  paychecks: readonly Paycheck[],
  months: number,
  options?: { readonly includeIrregular?: boolean },
): AverageNet {
  const recent = sortByPeriodDescending(paychecks).slice(0, Math.max(0, months))
  const included = options?.includeIrregular === true
    ? recent
    : recent.filter((paycheck) => !paycheck.isIrregular)

  const first = included[0]
  if (first === undefined) {
    return { amount: undefined, sampleSize: 0, excluded: recent.length }
  }

  const total = sum(
    included.map((paycheck) => paycheck.net),
    first.net.currency,
  )
  const n = included.length
  const magnitude = Math.floor((Math.abs(total.minor) * 2 + n) / (n * 2))

  return {
    amount: money(total.minor < 0 ? -magnitude : magnitude, total.currency),
    sampleSize: n,
    excluded: recent.length - n,
  }
}

export interface YearToDate {
  readonly gross: Money
  readonly net: Money
  readonly tax: Money
  readonly savings: Money
  readonly totalCompensation: Money
  /** How many slips are in it. A year with four slips is a partial year and says so. */
  readonly paychecks: number
}

/**
 * Gross, net, tax and payroll savings for one calendar year, summed over the
 * slips whose **period** falls in it.
 *
 * By salary month rather than payment date: a December salary paid in January
 * is December's everywhere else in the app, and a year total that disagreed
 * with the list it is the sum of would be the worse kind of wrong.
 */
export function yearToDate(
  entries: readonly PaycheckWithLines[],
  year: number,
  types: readonly DeductionType[],
  currency: CurrencyCode,
): YearToDate {
  const inYear = entries.filter((entry) => entry.paycheck.period.year === year)

  return {
    gross: sum(inYear.map((entry) => entry.paycheck.gross), currency),
    net: sum(inYear.map((entry) => entry.paycheck.net), currency),
    tax: sum(inYear.map((entry) => taxTotal(entry, types)), currency),
    savings: sum(inYear.map((entry) => payrollSavings(entry, types).total), currency),
    totalCompensation: sum(inYear.map((entry) => totalCompensation(entry)), currency),
    paychecks: inYear.length,
  }
}

export type WaterfallStepKind = 'GROSS' | 'DEDUCTION' | 'UNEXPLAINED' | 'NET'

/**
 * One step of the gross→net waterfall.
 *
 * `amount` is always a **magnitude** — how much this step takes out, or, for the
 * two ends, the figure itself. Which direction it moves is the kind, plus
 * `isAddBack` for the one step that can go either way.
 */
export interface WaterfallStep {
  readonly kind: WaterfallStepKind
  /** The line this step is. Absent on the two ends and on the unexplained step. */
  readonly lineId: string | undefined
  readonly deductionTypeId: string | undefined
  readonly amount: Money
  /** True when the unexplained step puts money back rather than taking it out. */
  readonly isAddBack: boolean
  /** What is left after this step. The last one is the net, exactly. */
  readonly runningTotal: Money
}

/**
 * Gross to net as the steps between them — the waterfall of docs/f04, which is
 * the clearest presentation of a payslip there is and the reason that screen
 * exists.
 *
 * **The steps sum to net. Always.** That is F04's acceptance criterion, and it
 * is met by the one step that makes it honest: when the itemization does not
 * account for the whole difference, the remainder appears as an explicit
 * `UNEXPLAINED` step rather than the chart quietly not adding up. A negative
 * delta — more itemized than the difference allows — comes back as the same
 * step with `isAddBack`, because the arithmetic has to close either way.
 *
 * Only net-reducing lines are steps: the employer's side never touched net, and
 * putting it in this chart is the mistake the chart exists to make visible.
 * Lines of zero are left out — a step that drops nothing is a row that says
 * nothing — and so are lines whose type is missing, for the same reason
 * `reconciliationDelta` skips them: they are counted in what is unexplained.
 */
export function grossToNetSteps(
  entry: PaycheckWithLines,
  types: readonly DeductionType[],
): readonly WaterfallStep[] {
  const { gross, net } = entry.paycheck
  const currency = gross.currency
  const byId = new Map(types.map((type) => [type.id, type]))

  const steps: WaterfallStep[] = [
    {
      kind: 'GROSS',
      lineId: undefined,
      deductionTypeId: undefined,
      amount: gross,
      isAddBack: false,
      runningTotal: gross,
    },
  ]

  let running = gross.minor
  for (const line of entry.lines) {
    const type = byId.get(line.deductionTypeId)
    if (type === undefined || !type.reducesNet || line.employeeAmount.minor === 0) continue

    running -= line.employeeAmount.minor
    steps.push({
      kind: 'DEDUCTION',
      lineId: line.id,
      deductionTypeId: line.deductionTypeId,
      amount: line.employeeAmount,
      isAddBack: false,
      runningTotal: money(running, currency),
    })
  }

  const delta = reconciliationDelta(entry, types)
  if (delta.minor !== 0) {
    running -= delta.minor
    steps.push({
      kind: 'UNEXPLAINED',
      lineId: undefined,
      deductionTypeId: undefined,
      amount: abs(delta),
      isAddBack: delta.minor < 0,
      runningTotal: money(running, currency),
    })
  }

  steps.push({
    kind: 'NET',
    lineId: undefined,
    deductionTypeId: undefined,
    amount: net,
    isAddBack: false,
    runningTotal: net,
  })

  return steps
}

export interface NetPoint {
  readonly period: YearMonth
  /** Nothing recorded for this month. A gap is information (docs/f04). */
  readonly net: Money | undefined
}

/**
 * Net by salary month over a window, gaps included.
 *
 * The gaps are the point: a month with no slip is drawn as a break in the line
 * and named underneath, rather than the chart joining the two months either
 * side of it into a trend that never happened.
 *
 * **Two slips in one month are summed**, which is what docs/f04 says statistics
 * do with a second job — and what a bonus month means too. Irregular months are
 * *not* excluded here: this is what happened, and it is the averages that leave
 * bonuses out.
 *
 * `months` is a **maximum**. Empty months before the first slip are dropped, so
 * a document with three paychecks draws three points across the width instead
 * of three points and nine months of blank chart — and the gaps that remain are
 * the ones that mean something: months inside a working history with no slip
 * recorded.
 */
export function netTrend(
  paychecks: readonly Paycheck[],
  months: number,
  endingAt: YearMonth,
): readonly NetPoint[] {
  const points: NetPoint[] = []

  for (let step = Math.max(0, months) - 1; step >= 0; step -= 1) {
    const period = addMonths(endingAt, -step)
    const inMonth = paychecks.filter(
      (paycheck) =>
        paycheck.period.year === period.year && paycheck.period.month === period.month,
    )
    const first = inMonth[0]

    points.push({
      period,
      net:
        first === undefined
          ? undefined
          : sum(
              inMonth.map((paycheck) => paycheck.net),
              first.net.currency,
            ),
    })
  }

  const first = points.findIndex((point) => point.net !== undefined)
  return first <= 0 ? points : points.slice(first)
}

/** Which salary months in a range have no slip at all — docs/f04's "a gap is information". */
export function missingPeriods(
  paychecks: readonly Paycheck[],
  from: YearMonth,
  to: YearMonth,
): readonly YearMonth[] {
  if (compareYearMonths(from, to) > 0) return []

  const present = new Set(
    paychecks.map((paycheck) => `${paycheck.period.year}-${paycheck.period.month}`),
  )
  const gaps: YearMonth[] = []

  for (
    let period: YearMonth = from;
    compareYearMonths(period, to) <= 0;
    period = addMonths(period, 1)
  ) {
    if (!present.has(`${period.year}-${period.month}`)) gaps.push(period)
  }

  return gaps
}

/**
 * Saving deduction types that appear on a slip and say what they pay into —
 * and the ones that do not (D-170).
 *
 * **The question a screen has to ask before it can tell you about a screen you
 * have never opened.** A pension line on a payslip with no
 * `linkedFundId` produces no expected contribution, so the fund's
 * deposit check compares against nothing, the deposit table's salary column is
 * set against nothing, and every one of those surfaces reports *"no payslips
 * cover this"* — which reads as a missing document rather than as a missing
 * link. This is what turns that into a sentence a person can act on.
 *
 * **Only types that are on a slip.** The vocabulary ships with more types than
 * any one employer uses, and naming a study fund nobody contributes to would
 * make the notice permanent furniture on a screen where it is meant to be a
 * finding. A saving type with a goal or a debt behind it is answered too: it
 * pays into something, just not a fund.
 */
export function unlinkedSavingTypes(
  types: readonly DeductionType[],
  entries: readonly PaycheckWithLines[],
): readonly DeductionType[] {
  const used = new Set(entries.flatMap((entry) => entry.lines.map((line) => line.deductionTypeId)))
  return types.filter(
    (type) =>
      type.countsAsSaving &&
      used.has(type.id) &&
      type.linkedFundId === undefined &&
      type.linkedSavingGoalId === undefined &&
      type.linkedDebtId === undefined,
  )
}
