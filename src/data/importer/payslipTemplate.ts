/**
 * Executing a payslip template: the figures, and the slip's own proof that they
 * are right.
 *
 * This is the other half of D-132. A model said *where* each field is
 * (`src/domain/modelTasks.ts`); this reads *what is there*, with no model
 * involved and none reachable from here. Which is the whole point — a template
 * is derived once and executed every month afterwards, and the executing is
 * `parseAmountText` rather than judgement.
 *
 * > A model decides the schema; code moves the data.
 *
 * **The verifier is what makes any of this safe to trust** (F17). A payslip
 * carries its own proof internally: gross, minus everything deducted from the
 * employee, equals net. If that comes out to zero the template read the slip
 * correctly, whatever route produced it; if it does not, the template is wrong
 * and is not trusted, and nobody has to have predicted *how* it was wrong. That
 * is the same rule the import path already applies to a statement's printed
 * total, and it is why the extraction below is allowed to be a first
 * approximation rather than a proof of its own.
 */

import { fromMajorUnits, subtract, sum, zero, type CurrencyCode, type Money } from '@/core/money.ts'
import { yearMonthOf, type LocalDate, type YearMonth } from '@/core/time.ts'
import type { DeductionReading, PayslipReading } from '@/domain/model/paycheck.ts'
import {
  resolveLines,
  type PayslipLines,
  type ResolvedField,
  type ResolvedTemplate,
} from '@/domain/modelTasks.ts'
import { anchorsOf, type PayslipTemplate } from '@/domain/model/templates.ts'

import { resolveAnchors } from './labelTemplate.ts'
import { parseAmountText, parseDateText } from './normalize.ts'

/**
 * What the deductions table prints where an amount does not apply.
 *
 * It matters that these are *kept* rather than skipped. The table is columnar
 * and right-aligned, so a row's amounts are read by position — and a row that
 * prints `24,500.00 — 2,040.85` means basis, no employee amount, employer
 * amount. Dropping the dash and reading two numbers left to right would make
 * the employer's severance contribution into the employee's, which is a wrong
 * number that looks entirely reasonable.
 */
const PLACEHOLDERS = new Set(['—', '–', '-', '‒', '−'])

/** A number or an explicit "nothing here", in the order they are printed. */
export function amountSlots(line: string): readonly (number | undefined)[] {
  const slots: (number | undefined)[] = []
  for (const token of line.split(/\s+/)) {
    if (token === '') continue
    if (PLACEHOLDERS.has(token)) {
      slots.push(undefined)
      continue
    }
    const value = parseAmountText(token)
    if (value !== undefined) slots.push(value)
  }
  return slots
}

/**
 * Read a deduction row's basis, employee and employer amounts.
 *
 * **Assigned from the right**, because that is how these tables are printed:
 * the employer column is last, the employee column before it, and the basis —
 * when there is one — first. Left-to-right assignment breaks on the first row
 * whose employee cell is a dash, and every real slip has one.
 */
export function readDeductionRow(line: string): {
  readonly basis?: number
  readonly employee?: number
  readonly employer?: number
} {
  const slots = amountSlots(line)
  // Right to left: the employer column is last, the employee column before it,
  // and a basis — when the row has one — is what is left over at the front. A
  // blank basis prints nothing at all (where a blank *amount* prints a dash),
  // which is why counting from the right is what makes both shapes read the
  // same way.
  const employer = slots.length >= 2 ? slots[slots.length - 1] : undefined
  const employee = slots.length >= 2 ? slots[slots.length - 2] : slots[0]
  const basis = slots.length >= 3 ? slots[slots.length - 3] : undefined
  return {
    ...(basis === undefined ? {} : { basis }),
    ...(employee === undefined ? {} : { employee }),
    ...(employer === undefined ? {} : { employer }),
  }
}

/** The single figure on a line that carries one — gross, net, a total. */
export function readSingleAmount(line: string): number | undefined {
  const slots = amountSlots(line).filter((slot): slot is number => slot !== undefined)
  return slots[slots.length - 1]
}

/**
 * The date on a line that carries one, taken token by token.
 *
 * `parseDateText` is anchored — it reads a *cell*, and a cell in a spreadsheet
 * holds a date and nothing else. A payslip line holds a label as well, so the
 * line is split and each token offered in turn. Reusing that parser rather than
 * writing a second date regex is the point: the century window and the three
 * separators are already decided there, and two answers to "is 26 the year
 * 2026" is one too many.
 *
 * **Day-first, and not inferred.** `inferDateOrder` needs a column of dates to
 * have an opinion, and a slip prints one. Israeli payslips are day-first, and
 * the ambiguous half of the month is where a person looking at the confirm
 * surface is the check — which is exactly what the surface is for.
 */
export function readPayDate(line: string): LocalDate | undefined {
  for (const token of line.split(/\s+/)) {
    const date = parseDateText(token, 'DMY')
    if (date !== undefined) return date
  }
  return undefined
}

/** `07/2026` — a month and a year, which is what a salary month is printed as. */
const MONTH_YEAR = /^(\d{1,2})[./-](\d{4})$/

/**
 * The salary month a line states.
 *
 * A bare `MM/YYYY` wins over a full date on the same line, and on a real slip
 * they *are* the same line: `תאריך תשלום: 01/08/2026   חודש שכר: 07/2026` prints
 * the pay date and the month it is for side by side, and they are not the same
 * month. Taking the full date's month would file August's payment against
 * August, which is a slip in the wrong month with every figure right.
 */
export function readSalaryMonth(line: string): YearMonth | undefined {
  for (const token of line.split(/\s+/)) {
    const match = MONTH_YEAR.exec(token)
    const month = Number(match?.[1])
    const year = Number(match?.[2])
    if (match !== null && month >= 1 && month <= 12) return { year, month }
  }

  const date = readPayDate(line)
  return date === undefined ? undefined : yearMonthOf(date)
}

/**
 * Read one payslip through one template.
 *
 * Nothing here is written anywhere and nothing is decided: a `PayslipReading`
 * is what a confirm surface shows a person (M11). In particular **no deduction
 * is given a kind** — the template says a line is a deduction and where; the
 * user says it is pension and what it pays into (D-132).
 */
export function readPayslip(
  template: PayslipLines,
  text: string,
  currency: CurrencyCode = 'ILS',
): PayslipReading {
  return readResolved(resolveLines(template, text), currency)
}

/**
 * The same slip, read through a **stored** template — the path with no model on
 * it at all.
 *
 * This is F17's first rung and the milestone's done-when condition in one
 * function: the second slip of a known format resolves its anchors against its
 * own labels, reads its figures, and proves itself, with nothing derived and
 * nothing asked. The reading it produces is the same object either route
 * produces, and the arithmetic below cannot tell which route it came from —
 * which is what makes "trusted while it reconciles" a property of the template
 * rather than of the deriver (D-139).
 */
export function readAnchoredPayslip(
  template: PayslipTemplate,
  text: string,
  currency: CurrencyCode = 'ILS',
): PayslipReading {
  return readResolved(resolveAnchors(anchorsOf(template), text), currency)
}

/**
 * The figures, from a template that has already been pointed at this document's
 * lines.
 *
 * Both routes meet here, and the join is deliberate: a template's worth is
 * settled by what its reading reconciles to, and a reading that remembered
 * where it came from would invite a caller to weigh the two differently.
 */
export function readResolved(
  resolved: ResolvedTemplate,
  currency: CurrencyCode = 'ILS',
): PayslipReading {
  const at = (field: string): ResolvedField | undefined =>
    resolved.fields.find((entry) => entry.field === field)

  const single = (field: string): Money | undefined => {
    const found = at(field)
    if (found === undefined) return undefined
    const value = readSingleAmount(found.text)
    return value === undefined ? undefined : fromMajorUnits(value, currency)
  }

  const gross = single('grossLine')
  const net = single('netLine')
  const statedDeductionsTotal = single('employeeDeductionsTotalLine')

  const monthLine = at('salaryMonthLine')?.text
  const dateLine = at('payDateLine')?.text
  const salaryMonth = monthLine === undefined ? undefined : readSalaryMonth(monthLine)
  const payDate = dateLine === undefined ? undefined : readPayDate(dateLine)

  const deductions: DeductionReading[] = []
  for (const entry of resolved.fields) {
    if (!DEDUCTION_FIELD.test(entry.field)) continue
    const row = readDeductionRow(entry.text)
    deductions.push({
      field: entry.field,
      line: entry.line,
      // Everything up to the first figure is the label — and it comes from the
      // document, which is what stops a grammar mangling it (D-137).
      label: entry.text.split(/\s{2,}|\t/)[0]?.trim() ?? entry.text.trim(),
      ...(row.employee === undefined ? {} : { employee: fromMajorUnits(row.employee, currency) }),
      ...(row.employer === undefined ? {} : { employer: fromMajorUnits(row.employer, currency) }),
      ...(row.basis === undefined ? {} : { basis: fromMajorUnits(row.basis, currency) }),
    })
  }

  const borrowed = resolved.fields
    .filter((entry) => entry.borrowedFrom !== undefined)
    .map((entry) => ({ field: entry.field, named: entry.borrowedFrom ?? 0, used: entry.line }))

  // Which line each field was read off, for a surface that can show the page
  // (D-168). The deduction rows already carried theirs; the three figures the
  // strip proves never did, and they are the ones a person most wants to find
  // on the document.
  const lines: Record<string, number> = {}
  for (const entry of resolved.fields) lines[entry.field] = entry.line

  return restateSlip(
    {
      ...(gross === undefined ? {} : { gross }),
      ...(net === undefined ? {} : { net }),
      ...(statedDeductionsTotal === undefined ? {} : { statedDeductionsTotal }),
      ...(salaryMonth === undefined ? {} : { salaryMonth }),
      ...(payDate === undefined ? {} : { payDate }),
      deductions,
      lines,
      unresolved: resolved.unresolved,
      borrowed,
      // Restated below. A reading is never assembled without its arithmetic,
      // which is why `reconciles` is not optional on the type and why this is
      // the only place in the app that writes a placeholder for it.
      reconciles: false,
    },
    currency,
  )
}

/**
 * A reading's own two proofs, worked out again from the figures it now holds.
 *
 * **The reader is a proposer, so its verdict cannot be a fact it stated once**
 * (M16 U11, and `restateStatement` is the same function for a broker
 * statement). Every figure on the confirm surface is a field: a gross typed
 * over changes `delta`, a deduction line typed over changes both proofs, and a
 * total the slip printed and the template missed turns the second proof from
 * absent into a check that runs. A screen whose strip still described the
 * figures the *template* produced would be D-138's law broken one layer up — a
 * verifier proving something nobody is looking at.
 *
 * `gross`, `net`, `statedDeductionsTotal` and the deduction rows' employee
 * amounts are the inputs; everything else on the reading is carried through
 * untouched. `borrowed` and `unresolved` especially: they are the record of
 * what the *template* did, and correcting a figure does not unmake the fact
 * that it came off a line nobody pointed at.
 */
export function restateSlip(
  reading: PayslipReading,
  currency: CurrencyCode = 'ILS',
): PayslipReading {
  const { gross, net, statedDeductionsTotal } = reading

  const deducted = sum(
    reading.deductions.map((entry) => entry.employee ?? zero(currency)),
    currency,
  )

  let delta: Money | undefined
  if (gross !== undefined && net !== undefined) {
    delta = subtract(subtract(gross, deducted), net)
  }

  const statedTotalDelta =
    statedDeductionsTotal === undefined ? undefined : subtract(deducted, statedDeductionsTotal)

  const restated = { ...reading }
  // Deleted rather than set to `undefined`: `exactOptionalPropertyTypes` keeps
  // "the slip prints no total" and "the total is nothing" apart, and a spread
  // that carried the old delta through would be the second proof answering for
  // a figure that has since been cleared.
  delete (restated as { delta?: Money }).delta
  delete (restated as { statedTotalDelta?: Money }).statedTotalDelta

  return {
    ...restated,
    ...(delta === undefined ? {} : { delta }),
    ...(statedTotalDelta === undefined ? {} : { statedTotalDelta }),
    // Both checks, where both exist. A template is trusted only while it
    // verifies (F17), and one of two proofs passing is not that.
    reconciles: delta !== undefined && delta.minor === 0 && (statedTotalDelta?.minor ?? 0) === 0,
  }
}

/** `deduction[0]` and its siblings, as `payslipFieldLines` names them. */
const DEDUCTION_FIELD = /^deduction\[\d+\]$/
