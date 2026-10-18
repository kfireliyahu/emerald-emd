/**
 * Executing a fund-report template: the figures, and whatever proof the report
 * happens to carry.
 *
 * The payslip's other half (`payslipTemplate.ts`), for pension, hishtalmut,
 * provident and savings reports. A model said *where* each figure is
 * (`modelTasks.ts`); this reads *what is there*, with no model involved and none
 * reachable from here.
 *
 * > A model decides the schema; code moves the data.
 *
 * **The verifier is the difference between this file and the payslip's, and it
 * is the one F17 called the weakest of the three.** A payslip carries its own
 * arithmetic on every slip ever printed. A fund report carries **three possible
 * proofs and often none of them**:
 *
 * - the **period**: opening + deposits + yield − fees = closing
 * - the **components**: employee + employer + severance = closing
 * - the **deposit table**: every row of it added up = deposits (D-153)
 *
 * The third is the one a report that prints a table can almost always run, and
 * it proves the table's *amounts* and nothing else — not which salary month each
 * row is for, which is the field the whole reconciliation turns on.
 *
 * So a reading is `proved`, `failed`, or **`unchecked`** — and that third state
 * is a fact about Israeli fund reports rather than a hedge. Collapsing it into
 * `false` would mean no report that prints only a balance could ever be read
 * twice, and collapsing it into `true` would mean an unchecked misreading is
 * indistinguishable from a checked one. It is D-138's finding stated for a
 * different document: **a verifier proves what it checks and nothing else**, and
 * where nothing checks, the person in front of the screen is the check.
 *
 * **A percentage is not an amount.** Reports print תשואה as a percentage beside
 * a shekel figure, one line apart, and a percentage read as money is the
 * expensive error here — it would sail through the period proof by making the
 * arithmetic fail, which is fine, and through *no* proof at all on a report that
 * prints nothing else, which is not. A line whose only figure carries a `%` is
 * read as no figure.
 */

import {
  abs,
  add,
  fromMajorUnits,
  money,
  subtract,
  zero,
  type CurrencyCode,
  type Money,
} from '@/core/money.ts'
import type { LocalDate } from '@/core/time.ts'
import {
  resolveFundReportLines,
  type FundReportLines,
  type ResolvedField,
  type ResolvedTemplate,
} from '@/domain/modelTasks.ts'
import type {
  FundReportAccountFacts,
  FundReportProof,
  FundReportReading,
  ReadDeposit,
} from '@/domain/model/funds.ts'
import {
  anchorsOf,
  type DepositTableAnchor,
  type FundReportTemplate,
} from '@/domain/model/templates.ts'

import { readDepositRows } from './depositTable.ts'
import { anchorFields, resolveAnchorLine, resolveAnchors } from './labelTemplate.ts'
import { readSingleAmount } from './payslipTemplate.ts'
import { parseAmountText, parseDateText } from './normalize.ts'

/** Read one report through a **stored** template — the rung with no model on it. */
export function readAnchoredFundReport(
  template: FundReportTemplate,
  text: string,
  currency: CurrencyCode = 'ILS',
): FundReportReading {
  return readResolvedReport(
    resolveAnchors(anchorsOf(template), text),
    currency,
    depositsFromAnchor(template.depositTable, text, currency),
  )
}

/** And through a derivation that is still line numbers. */
export function readFundReport(
  template: FundReportLines,
  text: string,
  currency: CurrencyCode = 'ILS',
): FundReportReading {
  const header = template.depositTableHeaderLine
  const columns = template.depositColumns ?? []
  const rows =
    header === undefined || columns.length === 0
      ? []
      : readDepositRows(text, header, columns, currency).rows
  return readResolvedReport(resolveFundReportLines(template, text), currency, rows)
}

/**
 * The deposit rows a **stored** template finds, which is the rung with no model
 * on it.
 *
 * The heading is located by its label alone (`resolveAnchorLine`) rather than
 * through the guard every figure field goes through: that guard rejects a line
 * with no digit on it because that is how a model points at a table's headings
 * instead of at a row, and here the headings are exactly what is wanted (D-153).
 */
function depositsFromAnchor(
  table: DepositTableAnchor | undefined,
  text: string,
  currency: CurrencyCode,
): readonly ReadDeposit[] {
  if (table === undefined || table.columns.length === 0) return []
  const header = resolveAnchorLine(table.header, text)
  if (header === undefined) return []
  return readDepositRows(text, header, table.columns, currency).rows
}

/**
 * The figures, from a template already pointed at this document's lines.
 *
 * Both routes meet here, for `readResolved`'s reason: a template's worth is
 * settled by what its reading proves, and a reading that remembered where it
 * came from would invite a caller to weigh the two differently.
 */
export function readResolvedReport(
  resolved: ResolvedTemplate,
  currency: CurrencyCode = 'ILS',
  depositRows: readonly ReadDeposit[] = [],
): FundReportReading {
  const at = (field: string): ResolvedField | undefined =>
    resolved.fields.find((entry) => entry.field === field)

  const amount = (field: string): Money | undefined => {
    const found = at(field)
    if (found === undefined) return undefined
    const value = readReportAmount(found.text)
    return value === undefined ? undefined : fromMajorUnits(value, currency)
  }

  /**
   * A charge is a **magnitude**, whatever the page did with the sign.
   *
   * The first real report prints `-295` where the synthetic one printed
   * `226.77`, and both mean the same thing: money left the fund. Reading a fee
   * "as printed" therefore adds it on one report and subtracts it on the other,
   * which is how a correct document came out ₪921 wrong (D-152). A fee is never
   * a credit, so the sign carries no information and the magnitude does.
   */
  const charge = (field: string): Money | undefined => {
    const value = amount(field)
    return value === undefined ? undefined : abs(value)
  }

  const closingBalance = amount('closingBalanceLine')
  const openingBalance = amount('openingBalanceLine')
  const deposits = amount('depositsLine')
  const fees = charge('feesLine')
  const earned = amount('yieldLine')
  const employeeComponent = amount('employeeComponentLine')
  const employerComponent = amount('employerComponentLine')
  const severanceComponent = amount('severanceComponentLine')
  const expectedPension = amount('expectedPensionLine')

  const dateLine = at('asOfDateLine')?.text
  const asOfDate = dateLine === undefined ? undefined : readReportDate(dateLine)
  const startLine = at('periodStartLine')?.text
  // The **earliest** date on the line, where the as-of date is the latest: a
  // period line prints both ends, and this is the other one.
  const periodStart = startLine === undefined ? undefined : readReportDate(startLine, 'earliest')

  /**
   * Every **other** line that moves the balance — and *other* is now enforced
   * rather than assumed (D-165).
   *
   * D-152's finding is that the movements block is exhaustive: whatever else is
   * in it left the fund, so it belongs in the equation. Applied to a document
   * whose block has five lines, a derivation can name line 26 as the fee *and*
   * as a cost, and line 24 as the yield *and* as a cost — which is what the
   * second real report ever read did, and it put a report that balances to the
   * shekel ₪20 out by subtracting its own fee and its own loss twice.
   *
   * A line carries one figure here, so a charge anchored to a line an equation
   * term already reads is that term restated, never a second charge. The set is
   * the five named terms' lines, and what it removes is a **duplicate**: the
   * figure is still shown, once, under the name the template gave it.
   */
  const named = new Set(
    ['closingBalanceLine', 'openingBalanceLine', 'depositsLine', 'feesLine', 'yieldLine']
      .map((field) => at(field)?.line)
      .filter((line): line is number => line !== undefined),
  )

  // Charges are magnitudes taken away; an adjustment is signed as printed,
  // because it genuinely goes both ways.
  const charges = collect(resolved, 'charge', (text) => {
    const value = readReportAmount(text)
    return value === undefined ? undefined : Math.abs(value)
  }, currency, named)
  const adjustments = collect(resolved, 'adjustment', readReportAmount, currency, named)

  const borrowed = resolved.fields
    .filter((entry) => entry.borrowedFrom !== undefined)
    .map((entry) => ({ field: entry.field, named: entry.borrowedFrom ?? 0, used: entry.line }))

  const account: FundReportAccountFacts = {
    ...rate(at('feeRateOnDepositLine')?.text, 'feeOnDepositBasisPoints'),
    ...rate(at('feeRateOnAccumulationLine')?.text, 'feeOnAccumulationBasisPoints'),
    ...phrase(at('investmentTrackLine')?.text, 'investmentTrack'),
    ...phrase(at('employerNameLine')?.text, 'employerName'),
  }

  return restateReport(
    {
      ...(closingBalance === undefined ? {} : { closingBalance }),
      ...(openingBalance === undefined ? {} : { openingBalance }),
      ...(deposits === undefined ? {} : { deposits }),
      ...(fees === undefined ? {} : { fees }),
      ...(earned === undefined ? {} : { yield: earned }),
      ...(asOfDate === undefined ? {} : { asOfDate }),
      ...(periodStart === undefined ? {} : { periodStart }),
      ...(employeeComponent === undefined ? {} : { employeeComponent }),
      ...(employerComponent === undefined ? {} : { employerComponent }),
      ...(severanceComponent === undefined ? {} : { severanceComponent }),
      ...(expectedPension === undefined ? {} : { expectedPension }),
      charges,
      adjustments,
      depositRows,
      account,
      lines: Object.fromEntries(resolved.fields.map((entry) => [entry.field, entry.line])),
      unresolved: resolved.unresolved,
      borrowed,
      // Restated below. A reading is never assembled without its arithmetic,
      // which is why `proof` is not optional on the type and why this is the
      // only place in the app that writes a placeholder for it.
      proof: 'unchecked',
    },
    currency,
  )
}

/**
 * A reading's three equations, worked out again from the figures it now holds.
 *
 * **The reader is a proposer, so its verdict cannot be a fact it stated once**
 * (M16 U11 — `restateStatement` and `restateSlip` are this function for the
 * other two documents). Every figure on the confirm surface is a field, and a
 * report is the document where that matters most: F17 calls its verifier the
 * weakest of the three, the common case prints none of the terms any equation
 * needs, and the figure the whole feature exists for — the management fee — is
 * checked by nothing at all. A fee typed in changes the period equation from
 * absent to running.
 *
 * The figures, the charges, the adjustments and the deposit rows are the
 * inputs. Everything else on the reading is carried through untouched:
 * `borrowed` and `unresolved` especially, which are the record of what the
 * *template* did, and correcting a figure does not unmake the fact that it came
 * off a line nobody pointed at.
 */
export function restateReport(
  reading: FundReportReading,
  currency: CurrencyCode = 'ILS',
): FundReportReading {
  const {
    closingBalance,
    openingBalance,
    deposits,
    fees,
    yield: earned,
    employeeComponent,
    employerComponent,
    severanceComponent,
    charges,
    adjustments,
    depositRows,
  } = reading

  // --- The three proofs, each run only where the report printed its terms ----
  let periodDelta: Money | undefined
  let tolerance: Money | undefined
  if (
    closingBalance !== undefined &&
    openingBalance !== undefined &&
    deposits !== undefined &&
    fees !== undefined &&
    earned !== undefined
  ) {
    const terms = [openingBalance, deposits, earned, fees, ...charges, ...adjustments, closingBalance]
    let expected = subtract(add(add(openingBalance, deposits), earned), fees)
    for (const entry of charges) expected = subtract(expected, entry)
    for (const entry of adjustments) expected = add(expected, entry)
    periodDelta = subtract(expected, closingBalance)
    tolerance = roundingTolerance(terms, currency)
  }

  /**
   * The **third** equation: the deposit rows summed against the deposits figure.
   *
   * The one a report that prints a table can almost always run, and it is worth
   * having for exactly that reason — a report can print a deposit table and none
   * of the movements block, and before this it would have come back `unchecked`
   * with nine transcribed rows nothing had looked at.
   *
   * **It proves the amounts and nothing else.** Which salary month a row is for,
   * and who paid it, are read off the same lines and are checked by no
   * arithmetic anywhere — and the salary month is the field the whole
   * reconciliation turns on. D-138 one more time, and the surface says so rather
   * than letting a green tick cover the page.
   */
  let depositTableDelta: Money | undefined
  if (deposits !== undefined && depositRows.length > 0) {
    const summed = depositRows.reduce<Money>(
      (total, row) => add(total, depositTotal(row, currency)),
      zero(currency),
    )
    depositTableDelta = subtract(summed, deposits)
  }

  let componentDelta: Money | undefined
  if (
    closingBalance !== undefined &&
    employeeComponent !== undefined &&
    employerComponent !== undefined &&
    severanceComponent !== undefined
  ) {
    const parts = add(add(employeeComponent, employerComponent), severanceComponent)
    componentDelta = subtract(parts, closingBalance)
  }

  const restated = { ...reading }
  // Deleted rather than spread over: `exactOptionalPropertyTypes` keeps "the
  // report prints nothing this equation needs" and "the equation came out to
  // nothing" apart, and a spread that carried an old delta through would be a
  // proof answering for a term that has since been cleared.
  delete (restated as { periodDelta?: Money }).periodDelta
  delete (restated as { tolerance?: Money }).tolerance
  delete (restated as { componentDelta?: Money }).componentDelta
  delete (restated as { depositTableDelta?: Money }).depositTableDelta

  return {
    ...restated,
    ...(periodDelta === undefined ? {} : { periodDelta }),
    ...(tolerance === undefined ? {} : { tolerance }),
    proof: proofOf(closingBalance, periodDelta, componentDelta, depositTableDelta, tolerance),
    ...(componentDelta === undefined ? {} : { componentDelta }),
    ...(depositTableDelta === undefined ? {} : { depositTableDelta }),
  }
}

/**
 * What one deposit row came to — its own total column where it printed one, and
 * otherwise its three components added up.
 *
 * The printed total is preferred rather than checked against the sum, because a
 * report that rounds to the shekel rounds each of the four figures separately
 * and the sum genuinely misses. What checks the transcription is the whole table
 * against the period's deposits figure: one comparison over the table, rather
 * than one per row over four rounded numbers.
 */
export function depositTotal(row: ReadDeposit, currency: CurrencyCode = 'ILS'): Money {
  if (row.total !== undefined) return row.total
  return [row.employee, row.employer, row.severance].reduce<Money>(
    (total, part) => (part === undefined ? total : add(total, part)),
    zero(currency),
  )
}

/** Every `charge[0]`, `adjustment[1]` … the template found, in order. */
function collect(
  resolved: ResolvedTemplate,
  prefix: string,
  read: (text: string) => number | undefined,
  currency: CurrencyCode,
  /** Lines an equation term already reads. A charge on one is that term again. */
  exclude: ReadonlySet<number> = new Set(),
): readonly Money[] {
  const pattern = new RegExp(`^${prefix}\\[(\\d+)\\]$`)
  const found: { index: number; amount: Money }[] = []

  for (const entry of resolved.fields) {
    const match = pattern.exec(entry.field)
    if (match === null) continue
    if (exclude.has(entry.line)) continue
    const value = read(entry.text)
    if (value === undefined) continue
    found.push({ index: Number(match[1]), amount: fromMajorUnits(value, currency) })
  }

  return found.sort((a, b) => a.index - b.index).map((entry) => entry.amount)
}

/**
 * How far out an equation is allowed to be, because the report rounds.
 *
 * The first real one says so at its foot — *הנתונים הכספיים המוצגים בדוח
 * מעוגלים לשקל הקרוב* — and with seven terms rounded to the shekel the sum can
 * legitimately miss by several. Demanding zero there makes a correct report
 * unreadable, which is worse than the alternative by the width of one shekel.
 *
 * **The trigger is the figures, not the sentence.** Every term being a whole
 * number of shekels is what says a report was rounded; a report carrying agorot
 * is exact and gets no slack at all. Half a unit per term, rounded up, which is
 * the largest error rounding can produce.
 */
export function roundingTolerance(terms: readonly Money[], currency: CurrencyCode): Money {
  const rounded = terms.every((term) => term.minor % 100 === 0)
  if (!rounded || terms.length === 0) return zero(currency)
  return money(Math.ceil(terms.length * 50), currency)
}

/** A percentage on a line, as basis points. `1.05%` is 105. */
export function readRateBasisPoints(line: string): number | undefined {
  for (const token of line.split(/\s+/)) {
    if (!token.includes('%')) continue
    const value = parseAmountText(token.replace('%', ''))
    if (value === undefined) continue
    return Math.round(value * 100)
  }
  return undefined
}

function rate(line: string | undefined, field: 'feeOnDepositBasisPoints' | 'feeOnAccumulationBasisPoints') {
  if (line === undefined) return {}
  const basisPoints = readRateBasisPoints(line)
  return basisPoints === undefined ? {} : { [field]: basisPoints }
}

/**
 * The value on a labelled line — a track name, an employer.
 *
 * The only place this file reads *text* rather than a figure, and it is read off
 * the document by code exactly as a payslip's labels are (D-137): a model gave
 * the line, never the words.
 */
function phrase(line: string | undefined, field: 'investmentTrack' | 'employerName') {
  if (line === undefined) return {}
  const text = valueOnLine(line)
  return text === '' ? {} : { [field]: text }
}

/**
 * What follows the **last** colon on a line, with the figures dropped.
 *
 * A real report prints three facts on one line — `שם העמית/ה: … מספר ת"ז: …
 * שם המעסיק: אקמי` — and a line number cannot say which of them was meant. The
 * first attempt took the first segment and returned the member's own name where
 * the employer belonged (D-152). The last colon gets that line right and leaves
 * an unlabelled one (`מסלול מניות 10.95%`) alone.
 *
 * It is a heuristic and it is allowed to be, because nothing downstream trusts
 * it: these facts sit in the half of the confirm surface that nothing checks,
 * and a wrong word is a word a person can see is wrong.
 */
export function valueOnLine(line: string): string {
  const colon = line.lastIndexOf(':')
  const tail = colon === -1 ? line : line.slice(colon + 1)

  // With no label, the value is the **first column** rather than every word on
  // the line. A deposit table's row reads `אקמי  04/01/2026  11/2025  17,500 …`
  // and joining what is left of it after the figures gives a sentence from the
  // far side of the page — which is what the first real report produced where an
  // employer belonged.
  const columns = tail
    .split(/\s{2,}|	/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
  const chosen = colon === -1 ? (columns[0] ?? '') : columns.join(' ')

  return chosen
    .split(/\s+/)
    .filter((token) => token !== '' && !/^[-+(]?[\d,.%)]+$/.test(token))
    .join(' ')
    .trim()
}

/**
 * A report with no closing balance has not been read at all, whatever else came
 * back: the balance is the one figure a fund report exists to state, and a
 * template that missed it is pointing at the wrong document.
 *
 * Otherwise: every proof that ran has to come out to zero, and a report where
 * none ran is `unchecked`.
 */
function proofOf(
  closingBalance: Money | undefined,
  periodDelta: Money | undefined,
  componentDelta: Money | undefined,
  depositTableDelta: Money | undefined,
  tolerance: Money | undefined,
): FundReportProof {
  if (closingBalance === undefined) return 'failed'
  const slack = tolerance?.minor ?? 0
  const ran: { delta: Money; slack: number }[] = []
  // Only the period equation gets the rounding slack: the components are three
  // figures against one, where the period is seven, and a report that rounds
  // its components rounds them into the same total.
  if (periodDelta !== undefined) ran.push({ delta: periodDelta, slack })
  if (componentDelta !== undefined) ran.push({ delta: componentDelta, slack: 0 })
  // The deposit table gets the period equation's slack, for the period
  // equation's reason: a report that rounds every figure to the shekel rounds
  // each row of the table too, and nine rounded rows against one rounded total
  // can legitimately miss by several.
  if (depositTableDelta !== undefined) ran.push({ delta: depositTableDelta, slack })
  if (ran.length === 0) return 'unchecked'
  return ran.every((entry) => Math.abs(entry.delta.minor) <= entry.slack) ? 'proved' : 'failed'
}

/**
 * The date a reading is *as of*, which is the **latest** date on the line.
 *
 * A payslip's line carries one date and `readPayDate` takes the first one. A
 * report's carries two — `לתקופה: 01/01/2026 — 31/03/2026` — and a snapshot is
 * dated at the end of the period it describes, not the start. Taking the latest
 * rather than the last is deliberate: the extracted order of a right-to-left
 * line is not something to depend on, and "the end of the period" is a fact
 * about the dates themselves.
 */
export function readReportDate(
  line: string,
  which: 'latest' | 'earliest' = 'latest',
): LocalDate | undefined {
  let best: LocalDate | undefined
  for (const token of line.split(/\s+/)) {
    const date = parseDateText(token, 'DMY')
    if (date === undefined) continue
    if (best === undefined) {
      best = date
      continue
    }
    const order = compareDates(date, best)
    if (which === 'latest' ? order > 0 : order < 0) best = date
  }
  return best
}

function compareDates(one: LocalDate, other: LocalDate): number {
  if (one.year !== other.year) return one.year - other.year
  if (one.month !== other.month) return one.month - other.month
  return one.day - other.day
}

/**
 * The amount on a line, ignoring a percentage.
 *
 * `readSingleAmount` takes the last figure on the line, which is right for a
 * payslip and wrong here: `תשואה 4.2%   רווח 3,140.55` and `דמי ניהול 0.5%
 * 412.30` both print a rate and a sum on one line, in either order. A token
 * carrying a `%` is dropped before the line is read, so what is left is money.
 */
export function readReportAmount(line: string): number | undefined {
  const cleaned = line
    .split(/\s+/)
    .filter((token) => !token.includes('%'))
    .join(' ')
  return readSingleAmount(cleaned)
}

/**
 * Move a field's anchor to the line that actually carries the value a person
 * typed — a **value** correction turned into a **location** correction.
 *
 * This is the answer to the one thing a real report proved a better prompt
 * cannot fix (D-152). The two facts no equation runs through — the fee rate and
 * the employer — are the two the model got wrong, because a report prints its
 * own fee beside a market average and prints the employer's name in a deposit
 * table as well as at the top. D-138 again: **a figure nothing checks needs a
 * person, not a better prompt.**
 *
 * What makes the correction worth making once is that it does not stay a value.
 * The person corrects `1.05%` to `1.00%`; this finds the line on the page that
 * says `1.00%`, anchors the field to *that* line's label, and the template now
 * points at `דמי ניהול מהפקדה` for good. Next quarter reads it with no model and
 * no question — which is exactly what D-145 did for a deduction row's name, one
 * level down: a template stays a map of locations, and the correction sticks to
 * the format rather than to the document.
 *
 * A value that appears nowhere on the page moves nothing. The person typed
 * something the document does not say, which is their right and is not a
 * location.
 */
export function retargetToValue(
  anchors: FundReportTemplate,
  field: string,
  text: string,
  matches: (line: string) => boolean,
): FundReportTemplate {
  const lines = text.split(/\r?\n/)
  const found = lines.findIndex((line) => matches(line))
  if (found === -1) return anchors

  const { anchors: replacement } = anchorFields([{ field, line: found + 1 }], text)
  const anchor = replacement[0]
  if (anchor === undefined) return anchors

  const fields = anchors.fields.some((one) => one.field === field)
    ? anchors.fields.map((one) => (one.field === field ? anchor : one))
    : [...anchors.fields, anchor]

  return { shape: 'fundReport', fields }
}
