/**
 * What a person is shown before anything is written — M11's one review surface,
 * as a pure function.
 *
 * The rule this file exists to keep, and it is the milestone's own
 * (D-138): **the surface must separate
 * the fields the app can check from the fields only a human can.** A wrong net
 * fails the reconciliation instantly. A wrong employer contribution reconciles
 * perfectly and is still wrong, because no equation on the slip runs through
 * it — and that is not a hypothetical: it is what a real run produced, with
 * both proofs passing and every employer amount on a two-figure row dropped.
 *
 * So a review has two halves that are drawn differently and mean different
 * things:
 *
 * - **`figures`** — gross, what was deducted, and net, each carrying whether the
 *   slip's own arithmetic vouches for it. A failed check does not demote the
 *   figure that looks wrong; it un-proves all three, because a slip that does
 *   not agree with itself has vouched for none of them.
 * - **`rows`** — the deduction table, which a person reads. Nothing here is
 *   proved: the *total* is, and a line moved from one row to the next leaves
 *   that total exactly where it was.
 *
 * And `doubts`, which is what makes **one accept** honest rather than
 * careless. D-092 rejected forty clicks as "the plugin's whole value handed
 * straight back", so a batch is one action — with everything that deserves a
 * second look named above the button rather than buried in a row nobody
 * scrolled to.
 *
 * Pure TypeScript: no React, no sql.js, no DOM. It is handed a reading and the
 * document's deduction types, and it decides nothing and writes nothing.
 */

import {
  add,
  formatMoney,
  money,
  zero,
  type CurrencyCode,
  type Money,
} from '@/core/money.ts'
import { applyBasisPoints, formatPercent } from '@/core/percent.ts'
import { normalizeHeader } from '@/core/text.ts'
import { compareDates, toISODate, type LocalDate, type YearMonth } from '@/core/time.ts'
import type {
  FundBalanceSnapshot,
  FundReportAccountFacts,
  FundReportProof,
  FundReportReading,
  ReadDeposit,
} from '@/domain/model/funds.ts'
import type { DeductionType, PayslipReading } from '@/domain/model/paycheck.ts'

/** One equation the document ran on itself, and what it came to. */
export interface ReviewCheck {
  readonly label: string
  /** Absent when the slip does not print what the equation needs. */
  readonly delta: Money | undefined
  readonly passed: boolean
}

/**
 * One of the slip's three headline figures, and whether its own arithmetic
 * vouches for it.
 *
 * **`proved` is all or nothing across the three**, which is not a shortcut: the
 * two equations are over gross, the deductions and net *together*, so a failure
 * says nothing about which of them moved. Marking the one that "looks wrong"
 * would be the surface inventing a diagnosis the arithmetic did not make.
 */
export interface ReviewFigure {
  readonly field: string
  readonly label: string
  /**
   * **Absent when the document printed nothing there**, and listed anyway
   * (M16 U11).
   *
   * A figure the reader did not find used to be a figure the surface did not
   * draw, so the only thing to do about a missing gross or a missing management
   * fee was read the document again with the same template. Every figure here
   * is a field now, and a blank one is the field that says *this was not read*
   * and takes the answer — which is the whole of D-205 applied to the two
   * readers it was not argued on.
   */
  readonly amount: Money | undefined
  readonly proved: boolean
}

/**
 * One line of the deductions table as the surface draws it.
 *
 * `label` is the document's own words — read off the page, never copied by a
 * model (D-137). `deductionTypeId` is never a model's answer either: it is
 * either what a person named this row on this format before (D-145) or an exact
 * match against the document's own vocabulary, and a row that is neither is a
 * question rather than a guess.
 */
export interface ReviewRow {
  readonly field: string
  readonly line: number
  readonly label: string
  /**
   * Whether that label is a word at all.
   *
   * False when the document's font asserts the wrong Unicode for its own glyphs
   * — measured on a real slip, whose `ToUnicode` map is a subsetter's boilerplate
   * Latin table over Hebrew shapes (D-144). The **anchor keeps the raw text**,
   * which is stable and matches exactly; what changes is that the surface stops
   * printing a string that says nothing.
   */
  readonly labelIsReadable: boolean
  /**
   * Optional rather than `Money | undefined`, and it is the same distinction the
   * slip prints: a row whose employee cell is a dash **has no employee amount**,
   * where a row that simply does not carry an employer column has no such column
   * at all. `exactOptionalPropertyTypes` keeps the two apart.
   */
  readonly employee?: Money
  readonly employer?: Money
  readonly basis?: Money
  readonly deductionTypeId: string | undefined
}

/** Something worth a second look, named above the accept rather than under it. */
export interface Doubt {
  readonly field: string
  readonly message: string
}

export interface PayslipReview {
  readonly reconciles: boolean
  readonly checks: readonly ReviewCheck[]
  /** Gross, what was deducted, and net — always listed, each saying whether it is proved. */
  readonly figures: readonly ReviewFigure[]
  readonly rows: readonly ReviewRow[]
  /** The employer's side. Read, worth knowing, and checked by nothing (D-138). */
  readonly employerTotal: Money
  readonly salaryMonth: YearMonth | undefined
  readonly payDate: LocalDate | undefined
  readonly doubts: readonly Doubt[]
}

/**
 * Latin-1 supplement, IPA, general punctuation, arrows and maths — where a
 * misread encoding lands. Some of these are letters in their own right (µ, ø,
 * æ), which is why the test below asks this before it asks for a letter.
 */
const SYMBOL_BLOCK = /[\u00a0-\u02ff\u2000-\u23ff]/

/**
 * Is this label a word, or a font's mistake about its own glyphs?
 *
 * The same test `pdfText.ts` applies to a run, asked here of one label so a
 * single row can be drawn honestly: at least two symbol-block characters, and
 * more of them than everything legible in the label put together.
 */
export function isReadable(label: string): boolean {
  let legible = 0
  let symbols = 0
  for (const character of label) {
    if (/\s/.test(character)) continue
    if (SYMBOL_BLOCK.test(character)) symbols++
    else if (/[\p{L}0-9]/u.test(character)) legible++
  }
  return !(symbols >= 2 && symbols > legible)
}

/**
 * The deduction type a row's label names, if the document already has one by
 * that name.
 *
 * **An exact match on the user's own table, which is a lookup and not a guess.**
 * F17 is explicit that naming a deduction is the user's — so this proposes and
 * the surface marks every proposal for the eye, and a row it cannot match is
 * named in `doubts` rather than quietly left blank. What it will not do is
 * anything fuzzy: no prefix matching, no alias table, no "contains". `פנסיה`
 * and `פנסיה מעסיק` are different lines on the same slip, and a match that
 * bridged them would put the employer's contribution where the employee's goes
 * — which reconciles, and is wrong.
 *
 * The Hebrew name is tried first because that is what the slip prints; the
 * English name is tried second so a type the user typed themselves still
 * matches an English-language slip.
 */
export function proposeDeductionType(
  label: string,
  types: readonly DeductionType[],
): string | undefined {
  const wanted = normalizeHeader(label)
  if (wanted === '') return undefined

  for (const type of types) {
    if (type.hebrewName !== undefined && normalizeHeader(type.hebrewName) === wanted) return type.id
  }
  for (const type of types) {
    if (normalizeHeader(type.name) === wanted) return type.id
  }
  return undefined
}

/**
 * What a deduction row is, by the shortest route that can answer.
 *
 * Three rungs, and the order is the same argument F17's ladder makes: the
 * answer somebody already gave beats the answer something can work out.
 *
 * 1. **`named`** — what this format was told a row is, plus anything named on
 *    this screen and not yet stored. A template carries the first (D-145); the
 *    confirm surface carries the second until an accept writes it.
 * 2. **The label matching a type's name exactly**, which is the rung that was
 *    here alone. It answers for `מס הכנסה` and every other row an employer
 *    prints under the vocabulary's own words.
 * 3. **Nothing**, which is a question for the user rather than a guess. An
 *    employer's own wording for a fund — `פנסיה אלפא מקיפה` — reaches here on
 *    the first slip of a format and never again once rung 1 has the answer.
 *
 * A named type that no longer exists in this document is treated as unnamed:
 * `named` is a stored id, deduction types can be deleted, and an id pointing at
 * nothing must ask rather than fill a form with a dangling reference.
 */
function resolveDeductionType(
  field: string,
  label: string,
  types: readonly DeductionType[],
  named: ReadonlyMap<string, string> | undefined,
): string | undefined {
  const remembered = named?.get(field)
  if (remembered !== undefined && types.some((type) => type.id === remembered)) return remembered
  return proposeDeductionType(label, types)
}

/**
 * Turn a reading into what a person is shown.
 *
 * Nothing here writes and nothing here decides. The accept that follows is the
 * human action the milestone's standing rule is about.
 *
 * `named` is what this format's template already says its deduction rows are,
 * with anything named on the surface and not yet accepted laid over it — the
 * one input here that came from a person rather than from the document.
 */
export function reviewPayslip(
  reading: PayslipReading,
  types: readonly DeductionType[],
  currency: CurrencyCode = 'ILS',
  named?: ReadonlyMap<string, string>,
): PayslipReview {
  const checks: ReviewCheck[] = [
    {
      label: 'gross − deductions − net',
      delta: reading.delta,
      passed: reading.delta?.minor === 0,
    },
    {
      label: 'deductions against the total the slip prints',
      delta: reading.statedTotalDelta,
      // A slip that prints no total has not failed this check; it has not run
      // it. Absent is not the same as zero and must not read as a pass.
      passed: reading.statedTotalDelta?.minor === 0,
    },
  ]

  const rows: ReviewRow[] = reading.deductions.map((entry) => ({
    field: entry.field,
    line: entry.line,
    label: entry.label,
    labelIsReadable: isReadable(entry.label),
    ...(entry.employee === undefined ? {} : { employee: entry.employee }),
    ...(entry.employer === undefined ? {} : { employer: entry.employer }),
    ...(entry.basis === undefined ? {} : { basis: entry.basis }),
    deductionTypeId: resolveDeductionType(entry.field, entry.label, types, named),
  }))

  const employerTotal = reading.deductions.reduce(
    (total, entry) => (entry.employer === undefined ? total : add(total, entry.employer)),
    zero(currency),
  )

  return {
    reconciles: reading.reconciles,
    checks,
    figures: figuresOf(reading),
    rows,
    employerTotal,
    salaryMonth: reading.salaryMonth,
    payDate: reading.payDate,
    doubts: doubtsIn(reading, rows, employerTotal),
  }
}

/**
 * The three figures, listed whether or not they are proved.
 *
 * A slip that does not add up still has to be shown — the whole reason the
 * surface exists is that a person can look at it — so what changes when the
 * arithmetic fails is the **claim made about** each figure, never whether it
 * appears. `proved` is that claim, and it is the flag the drawing hangs off.
 */
function figuresOf(reading: PayslipReading): readonly ReviewFigure[] {
  const proved = reading.reconciles
  // **All three, always** (M16 U11). A slip whose gross did not read is a slip
  // with a blank where the gross goes, not a strip with two figures on it: the
  // gap is the thing to see, and it is also where the correction is typed.
  return [
    { field: 'grossLine', label: 'Gross', amount: reading.gross, proved: proved && reading.gross !== undefined },
    {
      field: 'employeeDeductionsTotalLine',
      label: 'Deducted from you',
      amount: reading.statedDeductionsTotal,
      proved: proved && reading.statedDeductionsTotal !== undefined,
    },
    { field: 'netLine', label: 'Net', amount: reading.net, proved: proved && reading.net !== undefined },
  ]
}

/**
 * Everything worth saying out loud, most consequential first.
 *
 * The order is the point. A slip that does not add up invalidates every figure
 * on it, so it is said first; a row nobody can name is a line that will be
 * saved as nothing, so it is said next; and the employer column is last and
 * **always** said when there is one, because it is the case that looks fine.
 */
function doubtsIn(
  reading: PayslipReading,
  rows: readonly ReviewRow[],
  employerTotal: Money,
): readonly Doubt[] {
  const doubts: Doubt[] = []

  if (reading.gross === undefined) {
    doubts.push({ field: 'grossLine', message: 'Nothing was read as the gross.' })
  }
  if (reading.net === undefined) {
    doubts.push({ field: 'netLine', message: 'Nothing was read as the net.' })
  }

  if (reading.delta !== undefined && reading.delta.minor !== 0) {
    doubts.push({
      field: 'delta',
      message:
        `The slip does not add up: gross minus the deductions minus net leaves ` +
        `${formatMoney(reading.delta)}. A line was read wrongly, or one is missing.`,
    })
  }
  if (reading.statedTotalDelta !== undefined && reading.statedTotalDelta.minor !== 0) {
    doubts.push({
      field: 'statedTotalDelta',
      message:
        `The deduction lines come to ${formatMoney(reading.statedTotalDelta)} more than the ` +
        `total the slip itself prints.`,
    })
  } else if (reading.statedDeductionsTotal === undefined) {
    doubts.push({
      field: 'employeeDeductionsTotalLine',
      message:
        'The slip prints no total for what was deducted, so only one of the two checks ran.',
    })
  }

  for (const entry of reading.unresolved) {
    doubts.push({
      field: entry.field,
      message: `${fieldName(entry.field)}: ${entry.reason}.`,
    })
  }

  for (const entry of reading.borrowed) {
    doubts.push({
      field: `${entry.field}:borrowed`,
      message:
        `${fieldName(entry.field)} was named on line ${entry.named}, which carries only its name — ` +
        `the figure was taken from line ${entry.used} beside it.`,
    })
  }

  const unnamed = rows.filter((row) => row.deductionTypeId === undefined)
  if (unnamed.length > 0) {
    doubts.push({
      field: 'deductionTypes',
      message:
        `${unnamed.length === 1 ? 'One line has' : `${unnamed.length} lines have`} no deduction ` +
        `type in this document by that name. Name them below, and this format will read them ` +
        `the same way every month.`,
    })
  }

  if (reading.salaryMonth === undefined) {
    doubts.push({
      field: 'salaryMonthLine',
      message: 'No salary month was read. Set it before saving — a slip filed under the wrong month is wrong.',
    })
  }
  if (reading.payDate === undefined) {
    doubts.push({ field: 'payDateLine', message: 'No payment date was read.' })
  }

  if (employerTotal.minor !== 0) {
    doubts.push({
      field: 'employerTotal',
      message:
        `${formatMoney(employerTotal)} of employer contributions was read. Nothing on the slip ` +
        `checks that figure — both proofs are equations over your own column — so it is worth ` +
        `comparing against the page.`,
    })
  }

  return doubts
}

/** The label a field is known by on the surface, for a message about it. */
function fieldName(field: string): string {
  const match = /^deduction\[(\d+)\]$/.exec(field)
  if (match?.[1] !== undefined) return `Deduction line ${Number(match[1]) + 1}`
  switch (field) {
    case 'grossLine':
      return 'The gross'
    case 'netLine':
      return 'The net'
    case 'employeeDeductionsTotalLine':
      return 'The deductions total'
    case 'salaryMonthLine':
      return 'The salary month'
    case 'payDateLine':
      return 'The payment date'
    default:
      return field
  }
}


/* --------------------------------------------------------- a fund report */

export interface ReportReview {
  readonly proof: FundReportProof
  /** What the report says about the fund itself and the document does not (D-152). */
  readonly account: FundReportAccountFacts
  /** Both equations, listed whether or not the report printed enough to run them. */
  readonly checks: readonly ReviewCheck[]
  /**
   * Every figure the reading holds, in the order a report prints them, each
   * saying whether an equation runs through it.
   *
   * **`proved` is per figure here, where a payslip's is all-or-nothing**, and the
   * difference is the document: a slip's two equations cover the same three
   * numbers, so a failure implicates all of them. A report can print a checked
   * period and unchecked components, or the reverse — so a figure carries
   * whichever proofs it took part in, and one that took part in none says so.
   */
  readonly figures: readonly ReviewFigure[]
  /**
   * The deposit table, row by row, exactly as it will be saved (D-153).
   *
   * Shown rather than summarised, because what it adds is per-row and a total
   * cannot carry it: a row saying ₪1,750 arrived on 04/01/2026 **for 11/2025**
   * is a late deposit, and no aggregate figure anywhere on the page says so.
   */
  readonly deposits: readonly ReadDeposit[]
  /**
   * Whether the rows added up to what the report says was paid in.
   *
   * `undefined` where there is no table or no deposits figure to compare it
   * against. It is the only arithmetic these rows get, and it covers their
   * **amounts** — never their months, their dates or their employers.
   */
  readonly depositsAddUp: boolean | undefined
  readonly asOfDate: LocalDate | undefined
  readonly doubts: readonly Doubt[]
}

const REPORT_LABEL: Readonly<Record<string, string>> = {
  closingBalance: 'Balance',
  openingBalance: 'Opening balance',
  deposits: 'Paid in',
  fees: 'Fees charged',
  yield: 'Earned',
  employeeComponent: 'Your contributions',
  employerComponent: 'Employer contributions',
  severanceComponent: 'Severance',
}

/** The order a report prints them, which is the order the form asks for them. */
const REPORT_ORDER = [
  'closingBalance',
  'openingBalance',
  'deposits',
  'yield',
  'fees',
  'employeeComponent',
  'employerComponent',
  'severanceComponent',
] as const

/**
 * What a person is shown before a read fund report becomes a reading.
 *
 * The same two halves as a payslip's, drawn from a document with a much weaker
 * claim on itself. **The doubts are where most of the value is here**, because
 * the common case is a report that prints a balance and a fee and nothing that
 * ties them together — `proof: 'unchecked'` — and the honest surface for that is
 * one that says out loud that nothing was verified, rather than one that looks
 * exactly like a verified read.
 *
 * **A missing fee is a doubt, not a silence.** F13 exists because nobody knows
 * what their fees are, so a report the app read without finding one is the
 * single most likely place for that to go quietly wrong.
 */
export function reviewFundReport(
  reading: FundReportReading,
  /** The reading this document would follow, if the fund has one. */
  previousAsOf?: LocalDate | undefined,
): ReportReview {
  // Within the rounding the report admits to, not exactly zero: a report that
  // rounds every figure to the shekel cannot make seven of them add to nothing
  // (D-152), and demanding it makes a correct report unreadable.
  const slack = reading.tolerance?.minor ?? 0
  const period: ReviewCheck = {
    label:
      reading.charges.length + reading.adjustments.length > 0
        ? 'opening + paid in + earned − fees − costs = balance'
        : 'opening + paid in + earned − fees = balance',
    delta: reading.periodDelta,
    passed: reading.periodDelta !== undefined && Math.abs(reading.periodDelta.minor) <= slack,
  }
  const components: ReviewCheck = {
    label: 'the three components add up to the balance',
    delta: reading.componentDelta,
    passed: reading.componentDelta?.minor === 0,
  }
  // The third equation (D-153), and on a report that prints a deposit table it
  // is usually the one that can run. It is listed beside the other two whether
  // or not it ran, for the reason all three are: an equation that could not run
  // is a fact about the document worth seeing.
  const depositTable: ReviewCheck = {
    label: 'the deposit table adds up to what was paid in',
    delta: reading.depositTableDelta,
    passed:
      reading.depositTableDelta !== undefined &&
      Math.abs(reading.depositTableDelta.minor) <= slack,
  }

  const inPeriodProof = new Set(['closingBalance', 'openingBalance', 'deposits', 'yield', 'fees'])
  const inComponentProof = new Set([
    'closingBalance',
    'employeeComponent',
    'employerComponent',
    'severanceComponent',
  ])

  // **All eight, always** (M16 U11), where the loop used to skip whatever the
  // report did not print. A fee that was not read is the single most likely
  // thing on this surface to go quietly wrong — F13 exists because nobody knows
  // what their fees are — and a row that is not drawn cannot be corrected. The
  // blank is the doubt and the remedy in one place.
  const figures: ReviewFigure[] = []
  for (const field of REPORT_ORDER) {
    const amount = reading[field]
    const proved =
      amount !== undefined &&
      ((period.passed && inPeriodProof.has(field)) ||
        (components.passed && inComponentProof.has(field)) ||
        (depositTable.passed && field === 'deposits'))
    figures.push({ field, label: REPORT_LABEL[field] ?? field, amount, proved })
  }
  // The costs beside the fee, and whatever moved the balance for other reasons.
  // Listed rather than folded into the fee: an insurance cost is not a
  // management fee, and a person comparing this against the page needs to find
  // each line where the page prints it (D-152).
  reading.charges.forEach((amount, index) =>
    figures.push({ field: `charge[${index}]`, label: 'Cost', amount, proved: period.passed }),
  )
  reading.adjustments.forEach((amount, index) =>
    figures.push({
      field: `adjustment[${index}]`,
      label: 'Adjustment',
      amount,
      proved: period.passed,
    }),
  )
  if (reading.expectedPension !== undefined) {
    figures.push({
      field: 'expectedPension',
      label: 'Projected pension, monthly',
      amount: reading.expectedPension,
      proved: false,
    })
  }

  const doubts: Doubt[] = []

  /**
   * **The rows are checked for money and for nothing else** — D-138, for the
   * third document and the fourth time.
   *
   * The equation above proves the amounts. The salary month beside each of them
   * is what the reconciliation will key on for the rest of this fund's life, and
   * no arithmetic on the page touches it. Saying so here is the whole of the
   * handling, and it is deliberately said even when the table adds up — that is
   * precisely when a person stops looking.
   */
  if (reading.depositRows.length > 0) {
    doubts.push({
      field: 'depositRows',
      message:
        `${reading.depositRows.length} deposits were read off the table. ` +
        (depositTable.delta === undefined
          ? 'Nothing on the report checks them. '
          : depositTable.passed
            ? 'Their amounts add up to what the report says was paid in. '
            : `Their amounts are ${formatMoney(depositTable.delta)} away from what the report ` +
              'says was paid in, so a row was misread or one was missed. ') +
        'Which salary month each one is for is checked by nothing at all, and it is what every ' +
        'later deposit check is keyed on — read the months against the page.',
    })
  }
  const monthless = reading.depositRows.filter((row) => row.salaryMonth === undefined).length
  if (monthless > 0) {
    doubts.push({
      field: 'depositMonths',
      message:
        `${monthless} of the deposits carry no salary month, so they count towards the total and ` +
        'towards no month. If the table has a salary-month column, the format is not reading it.',
    })
  }

  if (reading.proof === 'unchecked') {
    doubts.push({
      field: 'proof',
      message:
        'Nothing on this report checks these figures against each other — it does not print ' +
        'enough for any of its equations to run. Read them against the page before you save.',
    })
  }
  if (period.delta !== undefined && !period.passed) {
    doubts.push({
      field: 'periodDelta',
      message:
        'The period does not add up: opening plus what was paid in and earned, less the fees and ' +
        `costs, is ${formatMoney(period.delta)} away from the closing balance.`,
    })
  }
  if (components.delta !== undefined && !components.passed) {
    doubts.push({
      field: 'componentDelta',
      message: `The three components are ${formatMoney(components.delta)} away from the balance.`,
    })
  }
  if (reading.closingBalance === undefined) {
    doubts.push({
      field: 'closingBalance',
      message: 'No balance was read at all, which is the one figure a report exists to state.',
    })
  }
  if (reading.fees === undefined) {
    doubts.push({
      field: 'fees',
      message:
        'No management fee was read. If the report prints one, it is worth adding by hand — the ' +
        'fee is the figure this app exists to keep in front of you.',
    })
  }
  if (reading.deposits === undefined) {
    doubts.push({
      field: 'deposits',
      message:
        'No deposit total was read. Without it this reading cannot be compared against what your ' +
        'payslips say was sent.',
    })
  }

  // **The trap a real report springs** (D-152): an Israeli quarterly statement
  // is year-to-date, so "paid in" covers the period printed on it and not the
  // window since your last reading. Two of them in one year double-count unless
  // somebody notices, and the only place to notice is here.
  if (reading.periodStart !== undefined) {
    const covers = `${toISODate(reading.periodStart)} to ${
      reading.asOfDate === undefined ? 'the report’s date' : toISODate(reading.asOfDate)
    }`
    doubts.push({
      field: 'periodStart',
      message:
        `This report covers ${covers}. Everything in the movements above is for that whole ` +
        'period — so if you already have a reading inside it, what was paid in and charged is ' +
        'counted from the report’s start, not from that reading.',
    })
  }

  if (previousAsOf !== undefined && reading.periodStart !== undefined) {
    if (compareDates(reading.periodStart, previousAsOf) <= 0) {
      doubts.push({
        field: 'overlap',
        message:
          `Your last reading is dated ${toISODate(previousAsOf)}, which is inside this report’s ` +
          'period. Saving both leaves the same deposits counted twice — either correct what is ' +
          'paid in below, or delete the earlier reading.',
      })
    }
  }

  // The deposit fee explains part of what was charged, and saying how much is
  // the closest this document comes to checking its own fee — which is the
  // figure F13 exists for.
  const depositRate = reading.account.feeOnDepositBasisPoints
  if (depositRate !== undefined && reading.deposits !== undefined && reading.fees !== undefined) {
    const onDeposits = money(
      applyBasisPoints(reading.deposits.minor, depositRate),
      reading.deposits.currency,
    )
    doubts.push({
      field: 'feeRate',
      message:
        `At ${formatPercent(depositRate, { digits: 2 })} of the ${formatMoney(reading.deposits)} paid in, the ` +
        `deposit fee alone accounts for ${formatMoney(onDeposits)} of the ` +
        `${formatMoney(reading.fees)} charged. The rest is the fee on the balance.`,
    })
  }

  for (const entry of reading.borrowed) {
    doubts.push({
      field: entry.field,
      message:
        `${REPORT_LABEL[stripLine(entry.field)] ?? entry.field} was taken from line ${entry.used}, ` +
        `beside the line ${entry.named} the template names — a boxed figure whose name and number ` +
        'are printed apart.',
    })
  }
  for (const entry of reading.unresolved) {
    doubts.push({
      field: entry.field,
      message: `${REPORT_LABEL[stripLine(entry.field)] ?? entry.field}: ${entry.reason}.`,
    })
  }

  return {
    proof: reading.proof,
    account: reading.account,
    checks: [period, components, depositTable],
    figures,
    deposits: reading.depositRows,
    depositsAddUp: depositTable.delta === undefined ? undefined : depositTable.passed,
    asOfDate: reading.asOfDate,
    doubts,
  }
}

/** `closingBalanceLine` is the template's name for what the reading calls `closingBalance`. */
function stripLine(field: string): string {
  return field.endsWith('Line') ? field.slice(0, -'Line'.length) : field
}

/**
 * The reading as a snapshot draft — what the form opens with.
 *
 * **Nothing is invented.** A figure the report did not print stays undefined,
 * because empty means "not stated" and not zero, and the fee and deposit
 * reconciliations both branch on that distinction. The balance is the exception
 * and only because the form cannot open without one: a reading with no balance
 * is `failed`, and the surface says so before this is reached.
 */
export function snapshotFromReport(
  reading: FundReportReading,
  fundAccountId: string,
  fallbackDate: LocalDate,
  currency: CurrencyCode = 'ILS',
): FundBalanceSnapshot {
  return {
    id: 'new',
    fundAccountId,
    asOfDate: reading.asOfDate ?? fallbackDate,
    totalBalance: reading.closingBalance ?? zero(currency),
    employeeComponent: reading.employeeComponent,
    employerComponent: reading.employerComponent,
    severanceComponent: reading.severanceComponent,
    depositsSincePrevious: reading.deposits,
    feesChargedSincePrevious: reading.fees,
    returnSincePrevious: reading.yield,
    depositGapAcknowledged: false,
    // Everything the report stated that has no column of its own (D-152).
    note: reportNote(reading),
  }
}

/**
 * What the report says about the **fund** that differs from what the document
 * holds — the second half of "everything that can be inferred" (D-152).
 *
 * The fees especially. F13 exists because nobody knows what their management
 * fees are, and the quarterly report is the one document that states them; a
 * reading that transcribed the balance and threw the rate away would be missing
 * the point of the feature.
 *
 * **A change is proposed, never applied here.** This is a pure comparison; the
 * accept on the confirm surface is the human action that writes it, and the
 * surface lists every line of it first.
 */
export interface AccountChange {
  readonly field: 'feeOnDepositBasisPoints' | 'feeOnAccumulationBasisPoints' | 'investmentTrack' | 'employerName'
  readonly label: string
  /** What the document says today, in words. Absent when it says nothing. */
  readonly from: string | undefined
  readonly to: string
}

/** What a person typed over, keyed by field. Text, because a rate is typed as `1.00%`. */
export type AccountEdits = Partial<Record<AccountChange['field'], string>>

/**
 * The facts as they will be written, with what the user typed laid over what was
 * read.
 *
 * A rate is parsed back out of the text they typed — `1.00%`, `1.00`, `1%` all
 * mean the same hundred basis points — and a value that parses to nothing is
 * dropped rather than written as zero, because "I cleared this field" is not
 * "the fee is nothing".
 */
export function editedFacts(
  facts: FundReportAccountFacts,
  edits: AccountEdits,
): FundReportAccountFacts {
  const rate = (text: string | undefined): number | undefined => {
    if (text === undefined) return undefined
    const trimmed = text.replace('%', '').trim()
    // **A blank field is not a fee of zero.** `Number('')` is 0, which would
    // write "this fund charges nothing" from an empty box — the expensive
    // direction for the one figure F13 exists to keep honest.
    if (trimmed === '') return undefined
    const value = Number(trimmed)
    return Number.isFinite(value) ? Math.round(value * 100) : undefined
  }

  const deposit = rate(edits.feeOnDepositBasisPoints) ?? facts.feeOnDepositBasisPoints
  const accumulation =
    rate(edits.feeOnAccumulationBasisPoints) ?? facts.feeOnAccumulationBasisPoints
  const track = edits.investmentTrack?.trim() ?? facts.investmentTrack
  const employer = edits.employerName?.trim() ?? facts.employerName

  return {
    ...(deposit === undefined ? {} : { feeOnDepositBasisPoints: deposit }),
    ...(accumulation === undefined ? {} : { feeOnAccumulationBasisPoints: accumulation }),
    ...(track === undefined || track === '' ? {} : { investmentTrack: track }),
    ...(employer === undefined || employer === '' ? {} : { employerName: employer }),
  }
}

const ACCOUNT_LABEL: Readonly<Record<AccountChange['field'], string>> = {
  feeOnDepositBasisPoints: 'Fee on deposits',
  feeOnAccumulationBasisPoints: 'Fee on the balance',
  investmentTrack: 'Investment track',
  employerName: 'Employer',
}

export function accountChanges(
  facts: FundReportAccountFacts,
  fund: {
    readonly fees: { readonly onDepositBasisPoints?: number | undefined; readonly onAccumulationBasisPoints?: number | undefined }
    readonly investmentTrack?: string | undefined
    readonly employerName?: string | undefined
  },
): readonly AccountChange[] {
  const changes: AccountChange[] = []

  const rate = (
    field: 'feeOnDepositBasisPoints' | 'feeOnAccumulationBasisPoints',
    read: number | undefined,
    held: number | undefined,
  ): void => {
    if (read === undefined || read === held) return
    changes.push({
      field,
      label: ACCOUNT_LABEL[field],
      from: held === undefined ? undefined : formatPercent(held, { digits: 2 }),
      to: formatPercent(read, { digits: 2 }),
    })
  }

  const text = (
    field: 'investmentTrack' | 'employerName',
    read: string | undefined,
    held: string | undefined,
  ): void => {
    if (read === undefined || read === '' || read === held) return
    changes.push({
      field,
      label: ACCOUNT_LABEL[field],
      from: held === undefined || held === '' ? undefined : held,
      to: read,
    })
  }

  rate('feeOnDepositBasisPoints', facts.feeOnDepositBasisPoints, fund.fees.onDepositBasisPoints)
  rate(
    'feeOnAccumulationBasisPoints',
    facts.feeOnAccumulationBasisPoints,
    fund.fees.onAccumulationBasisPoints,
  )
  text('investmentTrack', facts.investmentTrack, fund.investmentTrack)
  text('employerName', facts.employerName, fund.employerName)

  return changes
}

/**
 * Everything the report stated that has nowhere else to go, as one line of note.
 *
 * The alternative is throwing it away, and a projected pension or an investment
 * track read off the page and then dropped is exactly what "everything that can
 * be inferred" was asked to stop. A note is a field the snapshot already has, it
 * is shown on the reading, and it costs no migration — which is what makes this
 * the right home rather than four columns nothing else reads.
 */
export function reportNote(reading: FundReportReading): string | undefined {
  const parts: string[] = []
  if (reading.periodStart !== undefined && reading.asOfDate !== undefined) {
    parts.push(`Covers ${toISODate(reading.periodStart)} to ${toISODate(reading.asOfDate)}`)
  }
  if (reading.expectedPension !== undefined) {
    parts.push(`Projected pension ${formatMoney(reading.expectedPension)}/mo`)
  }
  if (reading.account.investmentTrack !== undefined) {
    parts.push(`Track: ${reading.account.investmentTrack}`)
  }
  for (const charge of reading.charges) {
    parts.push(`Cost ${formatMoney(charge)}`)
  }
  for (const adjustment of reading.adjustments) {
    parts.push(`Adjustment ${formatMoney(adjustment)}`)
  }
  return parts.length === 0 ? undefined : parts.join(' · ')
}
