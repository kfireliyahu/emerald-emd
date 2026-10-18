/**
 * Payslips, reachable from a conversation — `paychecks` and `record_paychecks`
 * (D-112).
 *
 * F04 has been built since M3 and the plugin could not see any of it. The
 * server's own instructions told a caller to read a payslip PDF, say what it
 * contained, and then hand the user back to the app to type it in — which is
 * the tell D-109 and D-111 both found, a screen with no tool, except worse,
 * because here there was not even a read.
 *
 * Everything here is a wrapper. `listPaychecksWithLines` loads the slips,
 * `@/domain/paycheck.ts` computes every figure, and `createPaycheck` writes.
 * Nothing in this file does arithmetic on money: a second implementation of the
 * reconciliation delta would be a second opinion on the one number the user is
 * checking against the paper in their hand.
 *
 * **The vocabulary comes back with the slips, always**, and that is the shape
 * decision worth stating. A payslip cannot be written without the id of the
 * deduction type each line names, and the app's entry screen has that as a
 * picker beside the form — structure a tool answer has to say in words (D-111).
 * Ten rows on every read is cheaper than one round trip, and the round trip is
 * the bill (D-110).
 *
 * **One write, taking a list**, dry-running through `mutatingCall` like every
 * other tool that touches rows. Editing a slip, deleting one and confirming a
 * bonus month are still app-only, and each refusal here names the screen
 * rather than leaving the caller to guess; a deduction type the slip needs is
 * `set_deduction_types`' to make (M36 F2).
 */

import { fromMajorUnits, type CurrencyCode, type Money } from '@/core/money.ts'
import {
  parseISODate,
  parseYearMonth,
  toYearMonthString,
  type LocalDate,
  type YearMonth,
} from '@/core/time.ts'
import { listDebts } from '@/data/repositories/debtRepository.ts'
import { listDeductionTypes } from '@/data/repositories/deductionTypeRepository.ts'
import { listFunds } from '@/data/repositories/fundRepository.ts'
import {
  createPaycheck,
  findPaychecksForPeriod,
  listPaychecksWithLines,
  readNoPayMonths,
  type NewPaycheckLine,
} from '@/data/repositories/paycheckRepository.ts'
import { listGoals } from '@/data/repositories/savingsRepository.ts'
import { syncPayroll } from '@/data/repositories/payrollSyncRepository.ts'
import { salaryReconciliation, slipBankStatus } from '@/data/repositories/salaryRepository.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import type { SalaryBank } from '@/domain/model/statistics.ts'
import { salaryBankWords } from '@/domain/salaryBank.ts'
import { salaryProblem } from '@/domain/statistics.ts'
import { countsAsWords, flagsAsGuessed } from '@/domain/paycheckEntry.ts'
import {
  averageNet,
  effectiveTaxRateBasisPoints,
  employerTotal,
  missingPeriods,
  payrollSavings,
  reconciliationDelta,
  totalCompensation,
  validatePaycheck,
  yearToDate,
  type PaycheckProblem,
} from '@/domain/paycheck.ts'
import type { DeductionType, PaycheckLine, PaycheckWithLines } from '@/domain/model/paycheck.ts'

import { readDocument, type OpenDocument } from '../document.ts'
import {
  capNote,
  count,
  date,
  money,
  paragraphs,
  percent,
  period,
  plural,
  section,
  table,
  verb,
} from '../format.ts'
import { mutatingCall, type Mutation } from '../write.ts'
import {
  PATH_PROP,
  ToolInputError,
  booleanProp,
  limitArg,
  numberProp,
  optionalBoolean,
  optionalNumber,
  optionalString,
  requireString,
  stringProp,
  type Args,
  type PluginTool,
} from './tool.ts'

const DEFAULT_LIMIT = 24
const LIST_MAX = 500

/** One batch of slips. A year of back-entry is twelve; the ceiling is generous. */
const BATCH_MAX = 60

/** How far back the average net is read off, matching the list screen's trend. */
const AVERAGE_MONTHS = 12

// --- shared rendering -------------------------------------------------------

/**
 * The vocabulary a line has to name, with what each type does to the figures.
 *
 * **Pays into** is the column that matters most. A pension line only becomes a
 * deposit into a fund — the thing a fund's report is checked against — because
 * its type points at the fund. A document where nobody made that link has every
 * fund answering "no payslip data" forever, so the column is printed, and
 * `set_deduction_types` sets it (M36 F1). *Counts as* is in the screen's words,
 * marked when somebody set it by hand rather than leaving the kind's guess.
 */
function vocabulary(document: OpenDocument): string {
  const types = listDeductionTypes(document.db)
  const funds = new Map(
    listFunds(document.db, { includeArchived: true }).map((one) => [one.id, one.name]),
  )
  const goals = new Map(
    listGoals(document.db, { includeClosed: true }).map((one) => [one.id, one.name]),
  )

  const debts = new Map(
    listDebts(document.db, { includeClosed: true }).map((one) => [one.id, one.name]),
  )

  return table(
    ['Id', 'Name', 'On the paycheck', 'Kind', 'Counts as', 'Pays into'],
    types.map((type) => [
      type.id,
      type.name,
      type.hebrewName ?? '—',
      type.kind,
      countsAsWords(type) + (flagsAsGuessed(type) ? '' : ' (set by hand)'),
      paysInto(type, funds, goals, debts),
    ]),
  )
}

function paysInto(
  type: DeductionType,
  funds: ReadonlyMap<string, string>,
  goals: ReadonlyMap<string, string>,
  debts: ReadonlyMap<string, string>,
): string {
  if (type.linkedFundId !== undefined) {
    return `fund: ${funds.get(type.linkedFundId) ?? type.linkedFundId}`
  }
  if (type.linkedSavingGoalId !== undefined) {
    return `goal: ${goals.get(type.linkedSavingGoalId) ?? type.linkedSavingGoalId}`
  }
  if (type.linkedDebtId !== undefined) return `debt: ${debts.get(type.linkedDebtId) ?? type.linkedDebtId}`
  return '—'
}

/**
 * The delta as a finding rather than a signed number.
 *
 * Zero, positive and negative are three different things to tell the user and
 * the sign alone says none of them (docs/f04's entry flow, step 4). Negative in
 * particular has one overwhelmingly likely cause — an employer share typed into
 * the employee column — and naming it is the difference between a number and a
 * diagnosis.
 */
function reconciles(delta: Money): string {
  if (delta.minor === 0) return 'to the agora'
  return delta.minor > 0 ? `${money(delta)} unexplained` : `${money(delta)} over-itemized`
}

// --- paychecks --------------------------------------------------------------

function bankCell(bank: SalaryBank | undefined): string {
  if (bank === undefined) return '—'
  if (bank.kind === 'AGREES') return 'agrees'
  if (bank.kind === 'DIFFERS') return 'DIFFERS'
  if (bank.kind === 'NO_DEPOSIT') return 'NO DEPOSIT'
  return 'not checked'
}

function slipRow(
  entry: PaycheckWithLines,
  types: readonly DeductionType[],
  bank: SalaryBank | undefined,
): readonly string[] {
  const { paycheck } = entry

  return [
    period(paycheck.period),
    date(paycheck.paymentDate),
    paycheck.employerName ?? '—',
    money(paycheck.gross),
    money(paycheck.net),
    money(employerTotal(entry)),
    money(totalCompensation(entry)),
    percent(effectiveTaxRateBasisPoints(entry, types)),
    money(payrollSavings(entry, types).total),
    reconciles(reconciliationDelta(entry, types)),
    bankCell(bank),
    [
      paycheck.isIrregular ? 'bonus month' : undefined,
      entry.lines.length === 0 ? 'no itemization' : `${count(entry.lines.length)} lines`,
    ]
      .filter((mark) => mark !== undefined)
      .join(', '),
  ]
}

function lineRows(entry: PaycheckWithLines, byId: ReadonlyMap<string, DeductionType>): string {
  if (entry.lines.length === 0) return 'No itemization.'

  return table(
    ['Deduction', 'Employee', 'Employer', 'Basis', 'Note'],
    entry.lines.map((line: PaycheckLine) => [
      byId.get(line.deductionTypeId)?.name ?? line.deductionTypeId,
      money(line.employeeAmount),
      money(line.employerAmount),
      money(line.basisAmount),
      line.note ?? '—',
    ]),
  )
}

/**
 * The slips against the deposits that paid them (D-317), in the app's own words.
 *
 * Silent when every slip agrees or could not be looked for. Otherwise one line
 * for each slip whose deposit differs or never came, and one for each deposit
 * filed as salary that no slip accounts for — never a silent pick of one side.
 */
function salaryAgainstBank(
  document: OpenDocument,
  all: readonly PaycheckWithLines[],
  status: ReadonlyMap<string, SalaryBank>,
  currency: CurrencyCode,
): string | undefined {
  const words = { money, date }
  const lines: string[] = []
  for (const entry of all) {
    const bank = status.get(entry.paycheck.id)
    if (bank === undefined || !salaryProblem(bank)) continue
    lines.push(`- Paycheck for ${period(entry.paycheck.period)} (net ${money(entry.paycheck.net)}): ${salaryBankWords(bank, words)}.`)
  }
  for (const group of salaryReconciliation(document.db, currency)) {
    if (group.verdict !== 'NO_PAYCHECK') continue
    lines.push(`- ${money(group.total)} landed in ${period(group.period)}: ${salaryBankWords({ kind: 'NO_SLIP' }, words)}.`)
  }
  if (lines.length === 0) return undefined
  return section(
    'Salary against the bank',
    [
      'The paycheck is the figure and the deposit that paid it proves it; a deposit matched to a paycheck ' +
        'is not counted as income again, whichever month it landed in. These do not agree:',
      ...lines,
    ].join('\n'),
  )
}

function renderPaychecks(document: OpenDocument, args: Args): string {
  const types = listDeductionTypes(document.db)
  const byId = new Map(types.map((type) => [type.id, type]))
  const all = listPaychecksWithLines(document.db)
  const limit = limitArg(args, DEFAULT_LIMIT, LIST_MAX)
  const withLines = optionalBoolean(args, 'include_lines') === true

  if (all.length === 0) {
    return paragraphs(
      '**No paychecks recorded.** This is usually the largest gap in a document: without them the ' +
        'app cannot say what a month actually earned, what payroll put away, or whether an ' +
        'employer is depositing to the pension fund the paycheck says it is.',
      'Ask the user for a paycheck — a PDF or a photo — read it yourself, and write it with ' +
        '`record_paychecks`. Gross and net are the two numbers anyone can read off a paycheck, and a ' +
        'paycheck carrying only those two is still worth recording.',
      section('Deduction types', vocabulary(document)),
      'Each line of a paycheck names one of these by id. Both amounts on a line are **magnitudes** — ' +
        'what the paycheck prints — and which side of the paycheck they fall on is the type’s two flags, ' +
        'never a sign.',
    )
  }

  // Newest salary month first, which is `listPaychecksWithLines`'s own order.
  const shown = all.slice(0, limit)
  const currency = all[0]?.paycheck.gross.currency ?? documentCurrency(document.db)
  const paychecks = all.map((entry) => entry.paycheck)
  const newest = paychecks[0]?.period
  const oldest = paychecks[paychecks.length - 1]?.period
  const average = averageNet(paychecks, AVERAGE_MONTHS)
  // A month somebody said had no pay is not a gap (M31 U1, `set_no_pay_months`).
  const noPay = readNoPayMonths(document.db)
  const gaps =
    newest === undefined || oldest === undefined
      ? []
      : missingPeriods(paychecks, oldest, newest).filter((one) => !noPay.has(toYearMonthString(one)))
  const years = [...new Set(paychecks.map((one) => one.period.year))].sort((a, b) => b - a)
  const bankStatus = slipBankStatus(document.db, currency)

  return paragraphs(
    capNote(shown.length, all.length, 'paycheck', LIST_MAX) +
      (newest === undefined || oldest === undefined
        ? ''
        : ` Salary months ${period(oldest)} to ${period(newest)}.`),
    table(
      [
        'Period',
        'Paid',
        'Employer',
        'Gross',
        'Net',
        'Employer side',
        'Total comp',
        'Tax rate',
        'Payroll saving',
        'Reconciles',
        'Bank',
        'Flags',
      ],
      shown.map((entry) => slipRow(entry, types, bankStatus.get(entry.paycheck.id))),
    ),
    salaryAgainstBank(document, all, bankStatus, currency),
    `Average net over the last ${count(AVERAGE_MONTHS)} recorded months: ${money(average.amount)} — ` +
      plural(average.sampleSize, 'paycheck') +
      (average.excluded === 0
        ? '.'
        : `, with ${plural(average.excluded, 'bonus month', 'bonus months')} left out.`),
    gaps.length === 0
      ? undefined
      : `**${plural(gaps.length, 'salary month')} inside that span ${verb(gaps.length, 'has', 'have')} ` +
        'no paycheck at all**: ' +
        `${gaps.map((one) => toYearMonthString(one)).join(', ')}. A gap is information, never a ` +
        'zero — every figure here is over the paychecks that exist, not over the calendar.',
    section(
      'By year',
      table(
        ['Year', 'Paychecks', 'Gross', 'Net', 'Tax', 'Payroll saving', 'Total compensation'],
        years.map((year) => {
          const totals = yearToDate(all, year, types, currency)
          return [
            String(year),
            count(totals.paychecks),
            money(totals.gross),
            money(totals.net),
            money(totals.tax),
            money(totals.savings),
            money(totals.totalCompensation),
          ]
        }),
      ),
    ),
    !withLines
      ? undefined
      : section(
          'Itemization',
          shown
            .map((entry) =>
              [
                `**${period(entry.paycheck.period)}**` +
                  (entry.paycheck.employerName === undefined
                    ? ''
                    : ` — ${entry.paycheck.employerName}`),
                lineRows(entry, byId),
              ].join('\n\n'),
            )
            .join('\n\n'),
        ),
    section('Deduction types', vocabulary(document)),
    '**Net is entered, never derived** — the app does not argue with the paycheck. Reconciles is ' +
      '`gross − the lines that reduce net − net`: *to the agora* means the itemization accounts ' +
      'for every shekel of the difference, *unexplained* means something was taken that has not ' +
      'been entered, and *over-itemized* almost always means an employer share was typed into ' +
      'the employee column.',
    'Total comp is gross plus every employer amount — the pension and severance an employer pays ' +
      'are real money the user accrues and never sees on the net line. Tax rate is income tax, ' +
      'national insurance and health tax over gross, and nothing else.',
    '**Pays into is what makes the pension check work.** A line becomes a deposit into a fund ' +
      'only because its deduction type points at one — that link is how a fund finds its paycheck ' +
      'lines, and how `funds` can say whether an employer actually deposited. Where a pension or ' +
      'study-fund row above says —, ask the user which fund it pays into and set it with ' +
      '`set_deduction_types`, which also sets what a type counts as, and makes, renames, orders ' +
      'and removes types — everything the app’s `#/paychecks/deductions` does.',
    'Editing a saved paycheck, deleting one and confirming a month as a bonus month are app-only, at ' +
      '`#/paychecks`.',
  )
}

export const paychecksTool: PluginTool = {
  definition: {
    name: 'paychecks',
    title: 'Paychecks',
    description:
      'Every paycheck recorded in the document — gross, net, the employer’s own contributions, ' +
      'total compensation, the effective tax rate, what payroll put away, and whether each ' +
      'itemization reconciles to its net. Plus the salary months with no paycheck at all, per-year ' +
      'totals, and **the deduction-type vocabulary with its ids**, which is what a line of a new ' +
      'paycheck has to name. Reads the document; changes nothing.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        limit: numberProp(
          `How many paychecks to list, newest salary month first. Default ${DEFAULT_LIMIT}, maximum ` +
            `${LIST_MAX}. The yearly totals and the vocabulary are never capped.`,
        ),
        include_lines: booleanProp(
          'Also print each listed paycheck’s itemization, line by line. Default false.',
        ),
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  run: async (args) =>
    readDocument(requireString(args, 'path'), (document) => renderPaychecks(document, args)),
}

// --- record_paychecks -------------------------------------------------------

/** One line, as the caller gave it. */
interface RequestedLine {
  readonly deductionTypeId: string
  readonly employeeMajor: number
  readonly employerMajor: number | undefined
  readonly basisMajor: number | undefined
  readonly note: string | undefined
}

/** One slip, as the caller gave it. */
interface Requested {
  readonly period: YearMonth
  readonly paymentDate: LocalDate
  readonly employerName: string | undefined
  readonly grossMajor: number
  readonly netMajor: number
  readonly note: string | undefined
  readonly isIrregular: boolean | undefined
  readonly lines: readonly RequestedLine[]
}

/** One slip, resolved against the document. */
interface Entry {
  readonly requested: Requested
  readonly kind: 'RECORD' | 'REFUSED'
  readonly gross: Money
  readonly net: Money
  readonly lines: readonly NewPaycheckLine[]
  readonly delta: Money | undefined
  readonly employerSide: Money | undefined
  readonly savings: Money | undefined
  /** Slips already recorded for this salary month and employer. A warning, never a refusal. */
  readonly alreadyThere: number
  /** Which funds this slip's lines would produce expected contributions for. */
  readonly fundsFed: readonly string[]
  /** Saving lines whose type points at nothing. The silent failure of F13. */
  readonly unlinkedSaving: readonly string[]
  readonly note: string | undefined
}

interface Plan {
  readonly entries: readonly Entry[]
}

function readLine(record: Record<string, unknown>, where: string): RequestedLine {
  const deductionTypeId = optionalString(record, 'deduction_type_id')
  if (deductionTypeId === undefined) {
    throw new ToolInputError(
      `${where} needs a \`deduction_type_id\`. \`paychecks\` prints the vocabulary with its ids.`,
    )
  }

  const employeeMajor = optionalNumber(record, 'employee_amount')
  if (employeeMajor === undefined) {
    throw new ToolInputError(
      `${where} needs an \`employee_amount\`. A line carrying only an employer share still ` +
        'states the employee side as 0 — "the question does not apply" and "nothing this month" ' +
        'are different facts, and 0 is the second one.',
    )
  }

  const employerMajor = optionalNumber(record, 'employer_amount')
  const basisMajor = optionalNumber(record, 'basis_amount')

  for (const [name, value] of [
    ['employee_amount', employeeMajor],
    ['employer_amount', employerMajor],
    ['basis_amount', basisMajor],
  ] as const) {
    if (value !== undefined && value < 0) {
      throw new ToolInputError(
        `${where}.${name} must not be negative. Both amounts on a line are **magnitudes** — what ` +
          'the paycheck prints — and which side of the paycheck they fall on is the deduction type’s ' +
          'flags, never a sign.',
      )
    }
  }

  return {
    deductionTypeId,
    employeeMajor,
    employerMajor,
    basisMajor,
    note: optionalString(record, 'note'),
  }
}

function readBatch(args: Args): readonly Requested[] {
  const raw = args['paychecks']
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolInputError(
      '`paychecks` must be a non-empty array, one entry per paycheck. A year of back-entry is one ' +
        'call, not twelve.',
    )
  }
  if (raw.length > BATCH_MAX) {
    throw new ToolInputError(`That is ${raw.length} paychecks; the ceiling is ${BATCH_MAX}.`)
  }

  return raw.map((entry, index) => {
    const where = `\`paychecks[${index}]\``
    if (typeof entry !== 'object' || entry === null) {
      throw new ToolInputError(`${where} must be an object.`)
    }
    const record = entry as Record<string, unknown>

    const periodText = optionalString(record, 'period')
    const parsedPeriod = periodText === undefined ? undefined : parseYearMonth(periodText)
    if (parsedPeriod === undefined) {
      throw new ToolInputError(
        `${where}.period must be the **salary month** as YYYY-MM` +
          (periodText === undefined ? ', and is required.' : `; got "${periodText}".`),
      )
    }

    const paidText = optionalString(record, 'payment_date')
    const parsedPaid = paidText === undefined ? undefined : parseISODate(paidText)
    if (parsedPaid === undefined) {
      throw new ToolInputError(
        `${where}.payment_date must be the day the money landed, as YYYY-MM-DD` +
          (paidText === undefined
            ? ', and is required. It is not the salary month: a December salary paid in January ' +
              'is period 2025-12 with a 2026-01 payment date.'
            : `; got "${paidText}".`),
      )
    }

    const grossMajor = optionalNumber(record, 'gross')
    const netMajor = optionalNumber(record, 'net')
    if (grossMajor === undefined || netMajor === undefined) {
      throw new ToolInputError(
        `${where} needs both \`gross\` and \`net\`, in major units. They are the two numbers ` +
          'anyone can read off a paycheck, and a paycheck carrying only those two is still worth recording.',
      )
    }

    const rawLines = record['lines']
    if (rawLines !== undefined && rawLines !== null && !Array.isArray(rawLines)) {
      throw new ToolInputError(`${where}.lines must be an array.`)
    }

    return {
      period: parsedPeriod,
      paymentDate: parsedPaid,
      employerName: optionalString(record, 'employer_name'),
      grossMajor,
      netMajor,
      note: optionalString(record, 'note'),
      isIrregular: optionalBoolean(record, 'is_irregular'),
      lines: (Array.isArray(rawLines) ? rawLines : []).map((line, position) => {
        if (typeof line !== 'object' || line === null) {
          throw new ToolInputError(`${where}.lines[${position}] must be an object.`)
        }
        return readLine(line as Record<string, unknown>, `${where}.lines[${position}]`)
      }),
    }
  })
}

const PROBLEM_TEXT: Readonly<Record<PaycheckProblem, string>> = {
  NEGATIVE_NET: 'net is negative, which is almost certainly a typo',
  NEGATIVE_GROSS: 'gross is negative',
  NET_ABOVE_GROSS: 'net is larger than gross — the two figures look swapped',
  NEGATIVE_LINE: 'a line amount is negative',
  MIXED_CURRENCY: 'the amounts are not all in one currency',
}

/**
 * Work out what each slip would record, against the document as it is now.
 *
 * Every judgement is the domain's. `validatePaycheck` decides what is
 * unenterable and `reconciliationDelta` decides whether the itemization adds
 * up, so the preview says exactly what the entry screen's strip would say for
 * the same numbers. A non-zero delta is deliberately **not** a refusal: it is
 * information, and blocking on it would be the app arguing with the slip
 * (docs/f04).
 */
function buildPlan(document: OpenDocument, batch: readonly Requested[]): Plan {
  const currency = documentCurrency(document.db)
  const types = listDeductionTypes(document.db)
  const byId = new Map(types.map((type) => [type.id, type]))
  const funds = new Map(
    listFunds(document.db, { includeArchived: true }).map((one) => [one.id, one.name]),
  )

  return {
    entries: batch.map((requested) => {
      const gross = fromMajorUnits(requested.grossMajor, currency)
      const net = fromMajorUnits(requested.netMajor, currency)

      const unknown = [
        ...new Set(
          requested.lines.map((line) => line.deductionTypeId).filter((id) => !byId.has(id)),
        ),
      ]
      if (unknown.length > 0) {
        return refused(
          requested,
          gross,
          net,
          `no deduction type with id ${unknown.join(', ')}. \`paychecks\` prints every id this ` +
            'document has. Anything the list cannot express goes on `ded:other` with a `note`, or ' +
            'make the type first with `set_deduction_types` (the app’s `#/paychecks/deductions`)',
        )
      }

      const lines: readonly NewPaycheckLine[] = requested.lines.map((line) => ({
        deductionTypeId: line.deductionTypeId,
        employeeAmount: fromMajorUnits(line.employeeMajor, currency),
        ...(line.employerMajor === undefined
          ? {}
          : { employerAmount: fromMajorUnits(line.employerMajor, currency) }),
        ...(line.basisMajor === undefined
          ? {}
          : { basisAmount: fromMajorUnits(line.basisMajor, currency) }),
        ...(line.note === undefined ? {} : { note: line.note }),
      }))

      // The shape the domain judges, carrying the ids it never reads. Built here
      // rather than reimplementing the checks, so the preview and the app's own
      // entry screen answer the same question about the same slip.
      const asEntry: PaycheckWithLines = {
        paycheck: {
          id: '',
          period: requested.period,
          paymentDate: requested.paymentDate,
          employerName: requested.employerName,
          gross,
          net,
          depositedToAccountId: undefined,
          note: requested.note,
          sourceKind: 'MANUAL',
          attachmentRef: undefined,
          isIrregular: requested.isIrregular === true,
        },
        lines: lines.map((line, position) => ({
          id: '',
          paycheckId: '',
          deductionTypeId: line.deductionTypeId,
          employeeAmount: line.employeeAmount,
          employerAmount: line.employerAmount,
          basisAmount: line.basisAmount,
          note: line.note,
          sortOrder: position * 10,
        })),
      }

      const problems = validatePaycheck(asEntry)
      if (problems.length > 0) {
        return refused(
          requested,
          gross,
          net,
          problems.map((problem) => PROBLEM_TEXT[problem]).join('; '),
        )
      }

      const fed = new Set<string>()
      const unlinked = new Set<string>()
      for (const line of requested.lines) {
        const type = byId.get(line.deductionTypeId)
        if (type === undefined) continue
        if (type.linkedFundId !== undefined) {
          fed.add(funds.get(type.linkedFundId) ?? type.linkedFundId)
        } else if (type.countsAsSaving && type.linkedSavingGoalId === undefined) {
          unlinked.add(type.name)
        }
      }

      return {
        requested,
        kind: 'RECORD' as const,
        gross,
        net,
        lines,
        delta: reconciliationDelta(asEntry, types),
        employerSide: employerTotal(asEntry),
        savings: payrollSavings(asEntry, types).total,
        alreadyThere: findPaychecksForPeriod(document.db, requested.period, requested.employerName)
          .length,
        fundsFed: [...fed],
        unlinkedSaving: [...unlinked],
        note: undefined,
      }
    }),
  }
}

function refused(requested: Requested, gross: Money, net: Money, why: string): Entry {
  return {
    requested,
    kind: 'REFUSED',
    gross,
    net,
    lines: [],
    delta: undefined,
    employerSide: undefined,
    savings: undefined,
    alreadyThere: 0,
    fundsFed: [],
    unlinkedSaving: [],
    note: why,
  }
}

function planTable(plan: Plan): string {
  return table(
    [
      'Period',
      'Paid',
      'Employer',
      'Gross',
      'Net',
      'Employer side',
      'Payroll saving',
      'Lines',
      'Reconciles',
      'What happens',
    ],
    plan.entries.map((entry) => [
      period(entry.requested.period),
      date(entry.requested.paymentDate),
      entry.requested.employerName ?? '—',
      money(entry.gross),
      money(entry.net),
      money(entry.employerSide),
      money(entry.savings),
      count(entry.lines.length),
      entry.delta === undefined ? '—' : reconciles(entry.delta),
      entry.note ??
        (entry.alreadyThere === 0
          ? 'recorded'
          : `recorded — this salary month and employer already have ` +
            `${plural(entry.alreadyThere, 'paycheck')}`),
    ]),
  )
}

function describePlan(plan: Plan): string {
  const doing = plan.entries.filter((entry) => entry.kind !== 'REFUSED')
  const refusals = plan.entries.length - doing.length
  const off = doing.filter((entry) => (entry.delta?.minor ?? 0) !== 0)
  const duplicates = doing.filter((entry) => entry.alreadyThere > 0)
  const fed = [...new Set(doing.flatMap((entry) => entry.fundsFed))]
  const unlinked = [...new Set(doing.flatMap((entry) => entry.unlinkedSaving))]

  return paragraphs(
    doing.length === 0
      ? '**Nothing to record.** Every paycheck was refused; the reasons are in the table.'
      : `**${plural(doing.length, 'paycheck')}** would be recorded` +
        (refusals === 0 ? '' : `, and ${plural(refusals, 'paycheck')} refused`) +
        '.',
    planTable(plan),
    off.length === 0
      ? undefined
      : `**The itemization does not reconcile on ${plural(off.length, 'paycheck')}.** That is not an ` +
        'error and not a ' +
        'reason to change a number — the paycheck is authoritative and the app never argues with ' +
        'it. Show the user the difference and ask what it was: an unexplained remainder can go ' +
        'on `ded:other` as one line, and *over-itemized* usually means an employer share was ' +
        'typed into the employee column.',
    duplicates.length === 0
      ? undefined
      : `**${plural(duplicates.length, 'paycheck')} would be a second paycheck for a salary month that ` +
        'already has one.** That is allowed on purpose — a 13th salary or a second job is ' +
        'exactly this — but it is also what running the same batch twice looks like. Nothing ' +
        'here deduplicates, so check with the user before committing.',
    fed.length === 0
      ? undefined
      : `Contributions from these paychecks would count towards: ${fed.join(', ')}. \`funds\` ` +
        'reconciles them against what each fund reports actually receiving.',
    unlinked.length === 0
      ? undefined
      : `**${plural(unlinked.length, 'saving deduction')} ${verb(unlinked.length, 'points', 'point')} ` +
        'at no fund**: ' +
        `${unlinked.join(', ')}. The money still counts as payroll saving, but no fund can be ` +
        'checked against it — the deposit check that catches an employer not depositing needs ' +
        'the type to name the fund — `set_deduction_types` sets it.',
  )
}

function applyPlan(document: OpenDocument, plan: Plan): string {
  const now = Date.now()
  const done: string[][] = []

  for (const entry of plan.entries) {
    if (entry.kind === 'REFUSED') continue

    const saved = createPaycheck(
      document.db,
      {
        period: entry.requested.period,
        paymentDate: entry.requested.paymentDate,
        ...(entry.requested.employerName === undefined
          ? {}
          : { employerName: entry.requested.employerName }),
        gross: entry.gross,
        net: entry.net,
        ...(entry.requested.note === undefined ? {} : { note: entry.requested.note }),
        ...(entry.requested.isIrregular === undefined
          ? {}
          : { isIrregular: entry.requested.isIrregular }),
        lines: entry.lines,
      },
      now,
    )

    done.push([
      period(saved.paycheck.period),
      money(saved.paycheck.gross),
      money(saved.paycheck.net),
      count(saved.lines.length),
      entry.delta === undefined ? '—' : reconciles(entry.delta),
    ])
  }

  // What a slip sets off, as on a screen (M36 U01): the deposits its saving lines
  // owe a goal and the payments its lines make on a debt. Inside the same write.
  if (done.length > 0) syncPayroll(document.db, now)

  const refusals = plan.entries.filter((entry) => entry.kind === 'REFUSED')

  return paragraphs(
    `Recorded ${plural(done.length, 'paycheck')}.`,
    done.length === 0 ? undefined : table(['Period', 'Gross', 'Net', 'Lines', 'Reconciles'], done),
    refusals.length === 0
      ? undefined
      : `Refused: ${refusals
          .map((entry) => `${period(entry.requested.period)} — ${entry.note ?? ''}`)
          .join('; ')}.`,
    '`paychecks` lists them with the yearly totals and the months still missing. Editing a paycheck, ' +
      'deleting one and marking a month as a bonus month are app-only, at `#/paychecks`.',
  )
}

export const recordPaychecksTool: PluginTool = {
  definition: {
    name: 'record_paychecks',
    title: 'Record paychecks',
    description:
      'Write paychecks into the document — **several in one call**, one entry per paycheck. Each needs ' +
      'the salary month, the payment date, gross and net; an itemization is optional, and each ' +
      'of its lines names a deduction type by id from `paychecks`. Read a paycheck PDF or photo ' +
      'yourself and this is where what it says goes. **Dry-runs by default**: it returns what it ' +
      'would record, including whether each paycheck’s itemization reconciles to its net, and writes ' +
      'nothing until called again with commit true. Nothing here deduplicates — a second paycheck ' +
      'for a salary month is allowed, because a 13th salary is exactly that. The document is ' +
      'copied to a timestamped .bak before anything is written.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        paychecks: {
          type: 'array',
          description: `One entry per paycheck. Up to ${String(BATCH_MAX)} in a call.`,
          items: {
            type: 'object',
            properties: {
              period: stringProp(
                'The **salary month** as YYYY-MM — the month the pay is for, not the month it was ' +
                  'paid in.',
              ),
              payment_date: stringProp('The day the money landed, as YYYY-MM-DD.'),
              gross: numberProp('Gross pay in major units, as the paycheck prints it.'),
              net: numberProp(
                'Net pay in major units. **Entered, never computed** — the app does not argue ' +
                  'with the paycheck.',
              ),
              employer_name: stringProp(
                'Which employer. Needed only when the user has more than one.',
              ),
              note: stringProp(
                'Anything about this paycheck worth keeping — a retroactive correction, say.',
              ),
              is_irregular: booleanProp(
                'True for a 13th salary or a bonus month, which averages then leave out. Only ' +
                  'ever on the user’s say-so.',
              ),
              lines: {
                type: 'array',
                description:
                  'The itemization. Every line names a deduction type by id; `paychecks` prints ' +
                  'the vocabulary. Anything the list cannot express goes on `ded:other` with a note.',
                items: {
                  type: 'object',
                  properties: {
                    deduction_type_id: stringProp('An id from the vocabulary `paychecks` prints.'),
                    employee_amount: numberProp(
                      'What came off the employee’s side, in major units, as a **magnitude** — ' +
                        'the paycheck prints no minus and neither should this. 0 is a real answer.',
                    ),
                    employer_amount: numberProp(
                      'The employer’s share of the same line, where the paycheck states one. Leave it ' +
                        'out when the type has no employer side at all — that is a different ' +
                        'fact from a share of zero.',
                    ),
                    basis_amount: numberProp(
                      'The salary base a percentage applied to, where the paycheck prints one.',
                    ),
                    note: stringProp('What the paycheck called this line, when it is not obvious.'),
                  },
                  required: ['deduction_type_id', 'employee_amount'],
                  additionalProperties: false,
                },
              },
            },
            required: ['period', 'payment_date', 'gross', 'net'],
            additionalProperties: false,
          },
        },
        commit: booleanProp('Default false. False previews the batch; true writes it.'),
      },
      required: ['path', 'paychecks'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const commit = args['commit'] === true
    const batch = readBatch(args)

    const mutation: Mutation<Plan> = {
      plan: (document) => buildPlan(document, batch),
      describe: describePlan,
      apply: applyPlan,
    }

    return mutatingCall(path, commit, mutation)
  },
}
