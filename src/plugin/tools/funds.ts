/**
 * Pension, hishtalmut and the other long-term funds, reachable from a
 * conversation — `funds` and `record_fund_readings` (D-112).
 *
 * The sibling of `paychecks.ts` and the reason that file exists at all: F13's
 * highest-value claim is that pairing what the payslip says was deducted
 * against what the fund says it received turns "my employer never deposited"
 * from invisible into a sentence. Both halves of that pair were app-only, so
 * the check could not be run from a conversation at all.
 *
 * Everything here is a wrapper over `fundRepository`, which is itself a
 * wrapper over `@/domain/funds.ts`. No arithmetic in this file: the
 * reconciliation, the returns and the effective fee each come back whole from
 * one call, precisely so a total and the rows under it cannot disagree.
 *
 * **A balance is a transcribed reading, not a derivation.** That is the
 * deliberate exception to "balances are always derived" (docs/conventions), and
 * it is why the write here is called `record_fund_readings` rather than
 * anything suggesting the app worked the number out. Every figure on the form
 * is optional except the balance and the date, because an empty box means "the
 * report did not say" and not zero — which the reconciliation and the fee panel
 * both branch on.
 */

import type { Database } from 'sql.js'

import { fromMajorUnits, type CurrencyCode, type Money } from '@/core/money.ts'
import {
  parseISODate,
  parseYearMonth,
  toISODate,
  toYearMonthString,
  type LocalDate,
  type YearMonth,
} from '@/core/time.ts'
import { listDeductionTypes } from '@/data/repositories/deductionTypeRepository.ts'
import {
  addSnapshot,
  createFund,
  expectedContributionsFor,
  fundAnalysis,
  fundDepositCheck,
  fundDepositChecks,
  fundMissingMonths,
  latestSnapshot,
  listFundsWithLatest,
  listSnapshots,
  replaceSnapshotDeposits,
  snapshotProblems,
  type NewFundAccount,
  type NewSnapshot,
} from '@/data/repositories/fundRepository.ts'
import { listInstitutions } from '@/data/repositories/institutionRepository.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import {
  annualFeeCost,
  componentSplit,
  effectiveFee,
  feeAgreementStatus,
  longTermSavings,
  recentContributionRate,
  snapshotFreshness,
  studyFundLiquidity,
  type ContributionBasisKind,
  type DepositPeriod,
  type DepositReconciliation,
  type EffectiveFee,
  type MonthlyDeposit,
  type FundReturns,
  type PeriodReturn,
  type SnapshotProblem,
} from '@/domain/funds.ts'
import {
  FUND_STATUSES,
  FUND_TYPES,
  type FundAccount,
  type FundBalanceSnapshot,
  type FundStatus,
  type FundType,
  type ReadDeposit,
} from '@/domain/model/funds.ts'

import { readDocument, type OpenDocument } from '../document.ts'
import {
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
import { today } from '../today.ts'
import { mutatingCall, type Mutation } from '../write.ts'
import {
  PATH_PROP,
  ToolInputError,
  booleanProp,
  numberProp,
  optionalBoolean,
  optionalNumber,
  optionalString,
  requireString,
  stringProp,
  type Args,
  type PluginTool,
} from './tool.ts'

/** One batch of readings. Four quarterly reports a year for a decade fits. */
const BATCH_MAX = 60

// --- rendering the derived answers ------------------------------------------

/** The size of a signed amount, for a sentence that carries the direction itself. */
function magnitude(amount: Money): Money {
  return amount.minor < 0 ? { ...amount, minor: -amount.minor } : amount
}

/** The months a fund's deposit table says fell short, said first and by name (D-389). */
function shortMonths(months: readonly MonthlyDeposit[] | undefined): string | undefined {
  if (months === undefined || months.length === 0) return undefined
  const parts = [...new Set(months.flatMap((one) => one.missingParts))]
  return (
    `**failed: ${months.map((one) => period(one.period)).join(', ')} short` +
    (parts.length === 0 ? '' : `, no ${parts.join(' or ')} part`) +
    '** — the month-by-month table under `fund_id` has the working'
  )
}

/**
 * The deposit check as a cell — short enough for a table, specific enough to
 * act on.
 *
 * Every branch that is not a verdict says **why there is no verdict**, in the
 * shape `projection` uses for debts: "we cannot tell yet, and here is what
 * would let us" is a useful answer and a blank cell is not. The four ways of
 * having no answer are four different sentences on the app's screen and they
 * are four different sentences here.
 */
function depositVerdict(check: DepositReconciliation | undefined): string {
  if (check === undefined) return '—'

  switch (check.kind) {
    case 'NEEDS_TWO_POINTS':
      return `no check — ${plural(check.snapshotCount, 'reading')}, and two are needed`
    case 'NO_FUND_REPORT':
      return 'no check — the latest reading does not say what the fund received'
    case 'WINDOW_TOO_SHORT':
      return 'no check — the two newest readings fall inside one month'
    case 'NO_PAYSLIP_DATA':
      return (
        `no check — the fund reports ${money(check.reported)} received, and no paycheck covers ` +
        `salary months ${period(check.window.salaryFrom)}–${period(check.window.salaryTo)}`
      )
    case 'CHECKED':
      switch (check.status) {
        case 'WITHIN_TOLERANCE':
          return `reconciles — within ${money(check.tolerance)}`
        case 'ACKNOWLEDGED':
          return `${money(check.gap)} gap, acknowledged as explained`
        case 'DEPOSITS_MISSING':
          return `**${money(check.gap)} missing**`
        case 'DEPOSITS_EXCEED_PAYSLIPS':
          // The magnitude, because the sentence already carries the direction.
          // `gap` is expected minus reported and is negative here, and a minus
          // sign in front of "received more than" reads as the opposite finding.
          return `${money(magnitude(check.gap))} more received than the paychecks show`
      }
  }
}

/**
 * The same check as docs/f13's one clear sentence, with what to do about it.
 *
 * "Followed by what to do about it, because that is the point." A gap that is
 * merely reported is a number; a gap with the employer's payroll department
 * named after it is an action.
 */
function depositSentence(name: string, check: DepositReconciliation): string | undefined {
  if (check.kind !== 'CHECKED') return undefined

  const { window, expected, reported, gap } = check
  const preamble =
    `Paychecks for salary months ${period(window.salaryFrom)}–${period(window.salaryTo)} show ` +
    `${money(expected.total)} owed to ${name} (${plural(expected.paycheckCount, 'paycheck')}). The ` +
    `fund reports receiving ${money(reported)} between ${date(window.from)} and ` +
    `${date(window.to)}, over ${plural(window.snapshotCount, 'reading')}.`

  switch (check.status) {
    case 'WITHIN_TOLERANCE':
      return `${preamble} The difference of ${money(gap)} is inside the ${money(check.tolerance)} band, so nothing is wrong.`
    case 'ACKNOWLEDGED':
      return `${preamble} ${money(gap)} is unaccounted for, and the user has already chased this gap and recorded it as explained.`
    case 'DEPOSITS_MISSING':
      return (
        `${preamble} **${money(gap)} is unaccounted for.** That is the case worth acting on: it ` +
        'means the paycheck says the money was deducted and the fund never says it arrived. The next ' +
        'step is the employer’s payroll department, with these dates and both figures. Marking ' +
        'the gap as explained afterwards is app-only, at `#/wealth/deposits`.'
      )
    case 'DEPOSITS_EXCEED_PAYSLIPS':
      return (
        `${preamble} The fund received ${money(magnitude(gap))} more than the ` +
        `paychecks account for. A ${count(window.lagMonths)}-month deposit lag is already applied, ` +
        'so the usual causes are a salary month whose paycheck has not been recorded, or a deposit ' +
        'the user made themselves.'
      )
  }
}

function feeCell(fee: EffectiveFee, stated: number | undefined): string {
  const claimed = stated === undefined ? 'not stated' : percent(stated)

  switch (fee.kind) {
    case 'NEEDS_TWO_POINTS':
      return `${claimed} stated, not measurable — two readings are needed`
    case 'NOT_REPORTED':
      return `${claimed} stated, not measurable — no reading says what was charged`
    case 'WINDOW_TOO_SHORT':
      return `${claimed} stated, not measurable — the two newest readings fall inside one month`
    case 'NO_BALANCE':
      return `${claimed} stated, not measurable — no balance to charge a fee on`
    case 'MEASURED':
      return (
        `${percent(fee.annualBasisPoints)} measured, ${claimed} stated` +
        (fee.differenceBasisPoints === undefined || Math.abs(fee.differenceBasisPoints) < 10
          ? ''
          : ` — **${percent(Math.abs(fee.differenceBasisPoints))} apart**`)
      )
  }
}

function agreementNote(fund: FundAccount, asOf: LocalDate): string | undefined {
  const status = feeAgreementStatus(fund, asOf)
  switch (status.kind) {
    case 'NONE':
      return undefined
    case 'ACTIVE':
      return `fee agreed until ${date(status.until)}`
    case 'EXPIRING_SOON':
      return `**fee agreement expires ${date(status.until)}**`
    case 'LAPSED':
      return `**fee agreement lapsed ${date(status.since)}**`
  }
}

const FRESHNESS_TEXT = {
  NONE: 'no reading yet',
  FRESH: '',
  STALE: 'over six months old',
  VERY_STALE: '**over a year old**',
} as const

/**
 * Where the contributions a window's gain was measured against came from.
 *
 * Shown per row rather than assumed, because the two are not equally good: the
 * fund's own figure covers exactly the window the two balances bracket, while
 * the payslip fallback is the app guessing which slips the money came from and
 * shifting them by the deposit lag.
 */
const BASIS_TEXT: Readonly<Record<ContributionBasisKind, string>> = {
  FUND_REPORTED: 'the fund’s own deposit figure',
  PAYSLIP_DERIVED: 'the paychecks, shifted by the deposit lag',
  NONE_EXPECTED: 'nothing — a fund that takes no new deposits',
  UNKNOWN: '—',
}

function returnRow(one: PeriodReturn): readonly string[] {
  if (one.kind === 'CONTRIBUTIONS_UNKNOWN') {
    return [
      `${date(one.from)} → ${date(one.to)}`,
      '—',
      '—',
      '—',
      '—',
      '—',
      'no contribution figure for this window, so no return can be separated from it',
    ]
  }

  return [
    `${date(one.from)} → ${date(one.to)}`,
    money(one.openingBalance),
    money(one.closingBalance),
    money(one.contributions),
    money(one.gain),
    percent(one.basisPoints),
    BASIS_TEXT[one.basis],
  ]
}

function returnsSection(returns: FundReturns): string {
  if (returns.kind === 'NEEDS_TWO_POINTS') {
    return `No return can be computed from ${plural(returns.snapshotCount, 'reading')}. Two are needed.`
  }

  return paragraphs(
    table(
      ['Window', 'Opening', 'Closing', 'Paid in', 'Gain', 'Return', 'Contributions read off'],
      returns.periods.map(returnRow),
    ),
    returns.cumulative === undefined
      ? `No cumulative figure: no contribution figure lies behind ` +
        `${plural(returns.unknownPeriods, 'window')}, and a total over only the windows that ` +
        'worked would not be a total of the table above.'
      : `Over the whole tracked history: ${money(returns.cumulative.gain)} of gain on ` +
        `${money(returns.cumulative.contributions)} paid in, ` +
        `${percent(returns.cumulative.basisPoints)}.`,
    '**A deposit is never a gain.** Every figure here has the contributions subtracted out — the ' +
      'plain difference between two balances is wrong by exactly what was paid in, and wrong in ' +
      'the flattering direction. It is still an approximation at this granularity, and it is ' +
      'labelled one.',
  )
}

function periodsSection(periods: readonly DepositPeriod[]): string {
  if (periods.length === 0) return 'No windows to compare — a second reading is what makes one.'

  return paragraphs(
    table(
      ['Window', 'Salary months compared', 'Paychecks say', 'Fund says', 'Difference'],
      periods.map((one) => [
        `${date(one.from)} → ${date(one.to)}`,
        one.salaryFrom === undefined || one.salaryTo === undefined
          ? '—'
          : `${period(one.salaryFrom)}–${period(one.salaryTo)}`,
        one.expected === undefined
          ? '—'
          : one.expected.paycheckCount === 0
            ? '— (no paychecks)'
            : money(one.expected.total),
        money(one.reported),
        money(one.gap),
      ]),
    ),
    '**Read this as the working, not as a verdict.** A single row is exactly the month-by-month ' +
      'comparison the employer’s deposit lag makes unreliable — any one of them can be out by a ' +
      'month’s contribution with nothing wrong. The sentence above is the answer; these rows are ' +
      'what it is made of. An em dash is "not stated", never a zero.',
  )
}

/**
 * The sharp answer, where the reports printed a deposit table to build it from
 * (D-153).
 *
 * Above the windows and never instead of them. A window is one deposits figure
 * against a lag this app has to guess, and its honest output is a running total;
 * a month row is what the document itself said, so it can name the month rather
 * than the quarter. A fund whose reports print no table has no rows here and
 * loses nothing it had.
 */
function monthsSection(months: readonly MonthlyDeposit[]): string {
  if (months.length === 0) return ''

  return paragraphs(
    table(
      [
        'Salary month',
        'Paycheck says',
        'Fund received',
        'Difference',
        'Computed on',
        'Arrived',
        'Late by',
        'Check',
      ],
      [...months].reverse().map((one) => [
        period(one.period),
        money(one.expected),
        money(one.received),
        money(one.gap),
        // The base each document says the deposit was worked out on (D-169).
        // Both figures where they disagree, because the pair is the fact.
        one.salaryStatus === 'UNKNOWN'
          ? '—'
          : one.salaryStatus === 'AGREES'
            ? money(one.fundSalary)
            : `${money(one.fundSalary)} (paycheck: ${money(one.slipSalary)})`,
        one.arrivedOn === undefined ? '—' : date(one.arrivedOn),
        one.lagMonths === undefined
          ? MONTH_STATUS_TEXT[one.status]
          : one.lagMonths <= 1
            ? 'on time'
            : `${String(one.lagMonths)} months`,
        monthCheck(one),
      ]),
    ),
    '**This is the working the windows below cannot do.** Each row is one salary month against ' +
      'the deposit that names it, so the lag is measured rather than assumed and a late month ' +
      'says which month it is. An em dash is "not stated": a month with no paycheck has nothing ' +
      'to say about what was due, and a month no report covers is not a month nothing arrived in. ' +
      '**Computed on** is the salary the report and the paycheck each say the deposit was worked out from — the ' +
      'fund’s own column against the paycheck line’s base, which is not the gross. Where ' +
      'they differ, the fund used a different salary from the one the employer printed, and no ' +
      'equation on either document checks that.',
  )
}

/**
 * The month's verdict in words — and a part the payslips put in and the fund's
 * rows show none of, by name (D-389): a missing employer deposit fails out loud.
 */
function monthCheck(one: MonthlyDeposit): string {
  if (one.missingParts.length > 0) return `**failed: no ${one.missingParts.join(' or ')} part arrived**`
  switch (one.status) {
    case 'MATCHED':
      return 'matches'
    case 'MISSING':
      return '**failed: less arrived than the paychecks put in**'
    case 'EXCEEDS':
      return 'more arrived than the paychecks put in'
    default:
      return '—'
  }
}

/** What a row with no arrival date is saying, which is never "nothing arrived". */
const MONTH_STATUS_TEXT: Readonly<Record<MonthlyDeposit['status'], string>> = {
  MATCHED: '',
  MISSING: 'nothing recorded as arriving',
  EXCEEDS: '',
  NO_PAYSLIP: 'no paycheck for this month',
  NOT_REPORTED: 'no report covers it',
}

function snapshotsSection(snapshots: readonly FundBalanceSnapshot[]): string {
  if (snapshots.length === 0) return 'No readings yet.'

  return table(
    ['As of', 'Balance', 'Employee', 'Employer', 'Severance', 'Unattributed', 'Deposits', 'Fees', 'Return', 'Gap'],
    snapshots.map((snapshot) => {
      const split = componentSplit(snapshot)
      return [
        date(snapshot.asOfDate),
        money(snapshot.totalBalance),
        money(snapshot.employeeComponent),
        money(snapshot.employerComponent),
        money(snapshot.severanceComponent),
        split.isComplete ? money(split.unattributed) : '—',
        money(snapshot.depositsSincePrevious),
        money(snapshot.feesChargedSincePrevious),
        money(snapshot.returnSincePrevious),
        snapshot.depositGapAcknowledged ? 'gap acknowledged' : '',
      ]
    }),
  )
}

// --- funds ------------------------------------------------------------------

function fundManagers(document: OpenDocument): string {
  const institutions = listInstitutions(document.db, { kind: 'FUND_MANAGER' })
  return table(
    ['Id', 'Fund manager'],
    institutions.map((one) => [one.id, one.name]),
  )
}

function renderFunds(document: OpenDocument, args: Args): string {
  const asOf = today()
  const includeArchived = optionalBoolean(args, 'include_archived') === true
  const only = optionalString(args, 'fund_id')
  const currency = documentCurrency(document.db)
  const entries = listFundsWithLatest(document.db, { includeArchived })

  if (entries.length === 0) {
    return paragraphs(
      '**No pension, hishtalmut or savings funds recorded.** For most Israeli employees this is ' +
        'the largest asset they own and the one nobody looks at — the management fee is invisible ' +
        'until somebody computes what it costs, and an employer depositing late or not at all is ' +
        'invisible until the fund’s own report is put beside the paychecks.',
      'Ask the user for their fund reports — the quarterly or annual statements, usually PDFs, ' +
        'and dormant funds from previous jobs especially. Read one yourself and write what it ' +
        'says with `record_fund_readings`. A first reading with nothing but a balance and its ' +
        'date is already worth recording.',
      section('Fund types', FUND_TYPES.join(' · ')),
      section('Fund managers this document knows', fundManagers(document)),
      'Pass one of those ids as `institution_id`, or leave it out — a fund whose name says the ' +
        'manager ("Menora pension – current job") is fine.',
    )
  }

  if (only !== undefined && !entries.some((entry) => entry.fund.id === only)) {
    throw new ToolInputError(
      `No fund with id ${only} in this document` +
        (includeArchived ? '.' : '. Archived funds are excluded; pass `include_archived` to see them.'),
    )
  }

  const shown = only === undefined ? entries : entries.filter((entry) => entry.fund.id === only)
  const totals = longTermSavings(entries, currency)
  const checks = fundDepositChecks(document.db, currency, { includeArchived })
  // A month the fund's own table says fell short fails on one report (D-389).
  const short = fundMissingMonths(document.db, { includeArchived })
  const types = listDeductionTypes(document.db)
  const institutions = new Map(listInstitutions(document.db).map((one) => [one.id, one.name]))

  const rows = shown.map((entry) => {
    const { fund, latest } = entry
    const snapshots = listSnapshots(document.db, fund.id)
    const fed = types
      .filter((type) => type.linkedFundId === fund.id)
      .map((type) => type.name)
    const freshness = FRESHNESS_TEXT[snapshotFreshness(latest?.asOfDate, asOf)]
    const liquidity = studyFundLiquidity(fund)

    return [
      fund.name,
      fund.fundType,
      fund.institutionId === undefined
        ? '—'
        : (institutions.get(fund.institutionId) ?? fund.institutionId),
      fund.status,
      money(latest?.totalBalance),
      date(latest?.asOfDate) + (freshness === '' ? '' : ` (${freshness})`),
      feeCell(effectiveFee(snapshots, fund.fees.onAccumulationBasisPoints), fund.fees.onAccumulationBasisPoints),
      shortMonths(short.get(fund.id)) ?? depositVerdict(checks.get(fund.id)),
      fed.length === 0 ? '**none**' : fed.join(', '),
      [
        fund.isArchived ? 'archived' : undefined,
        agreementNote(fund, asOf),
        liquidity === undefined ? undefined : `withdrawable ${date(liquidity.liquidAt)}`,
      ]
        .filter((mark) => mark !== undefined)
        .join(', ') || '—',
    ]
  })

  const unfed = shown.filter(
    (entry) => !types.some((type) => type.linkedFundId === entry.fund.id),
  )

  const detail = only === undefined ? undefined : fundAnalysis(document.db, only)

  return paragraphs(
    only === undefined
      ? `${plural(entries.length, 'fund')}${includeArchived ? ', archived ones included' : ''}.`
      : `One fund of ${plural(entries.length, 'fund')} in this document, with its working.`,
    // Skipped when one fund is named: these are the document's totals, and
    // printing ₪305,000 above a table showing one fund reads as that fund's
    // balance. The working is what `fund_id` was asked for.
    only !== undefined
      ? undefined
      : table(
          ['Figure', 'Amount'],
          [
            ['Total long-term savings', money(totals.total)],
            ['Employee component', money(totals.employee)],
            ['Employer component', money(totals.employer)],
            ['Severance component', money(totals.severance)],
            ['Not attributed to a component', money(totals.unattributed)],
            ...(totals.dormant === 0
              ? []
              : [['Dormant funds’ fees, a year', money(totals.dormantAnnualFees)]]),
          ],
        ),
    only !== undefined
      ? undefined
      : `${plural(totals.funds, 'fund')}, ${count(totals.dormant)} of them dormant` +
        (totals.withoutSnapshot === 0
          ? '.'
          : `, and **${plural(totals.withoutSnapshot, 'fund')} ` +
            `${verb(totals.withoutSnapshot, 'has', 'have')} no reading at all** — whatever they ` +
            'hold is missing from the total above rather than counted as zero.'),
    // The components are read off the **newest** reading of each fund and no
    // other, because that is the only one describing the balance the total is.
    // A report that broke the components out last quarter and did not this
    // quarter therefore shows the whole balance as unattributed, which looks
    // like the app lost them unless it is said.
    only !== undefined || totals.unattributed.minor === 0
      ? undefined
      : `${money(totals.unattributed)} is not attributed to a component. The three components ` +
        'are read off the newest reading of each fund only — an earlier reading that broke them ' +
        'out says nothing about the balance as it stands now. Severance is kept separate ' +
        'wherever it appears, because its withdrawal and tax rules are not the other two’s.',
    table(
      [
        'Fund',
        'Type',
        'Manager',
        'Status',
        'Balance',
        'As of',
        'Fee',
        'Deposit check',
        'Fed by',
        'Flags',
      ],
      rows,
    ),
    totals.dormant === 0
      ? undefined
      : '**Dormant funds are the point of that fee column.** A balance left behind at a job three ' +
        'years ago takes no new deposits and still pays a management fee every month, and nobody ' +
        'has ever seen the yearly figure written down.',
    unfed.length === 0
      ? undefined
      : `**No deduction type points at ${plural(unfed.length, 'fund')}**: ` +
        `${unfed.map((entry) => entry.fund.name).join(', ')}. Nothing can be checked against a ` +
        'paycheck until one does, so those funds will report having no paycheck data however many ' +
        'paychecks are recorded. A fund finds its paycheck lines through that link: set it with ' +
        '`set_deduction_types`. `paychecks` prints which types are linked to what.',
    detail === undefined
      ? only === undefined
        ? 'Name one fund with `fund_id` to get its readings, its return by window, and the ' +
          'working behind its deposit check.'
        : undefined
      : paragraphs(
          section(
            `${detail.fund.name} — did the deposits arrive?`,
            depositSentence(detail.fund.name, detail.reconciliation) ??
              depositVerdict(detail.reconciliation),
          ),
          detail.months.length === 0
            ? undefined
            : section('Month by month, from the reports’ deposit tables', monthsSection(detail.months)),
          section('The working, window by window', periodsSection(detail.periods)),
          section('Readings', snapshotsSection(detail.snapshots)),
          section('Return', returnsSection(detail.returns)),
          section('The fund itself', detailNotes(document, detail.fund, currency)),
        ),
    'Every balance here is a **reading transcribed from a report**, not a figure the app derived ' +
      '— which is the deliberate exception to everything else in this document being computed. ' +
      'That is also why an as-of date that has gone stale matters: a year-old number looks ' +
      'exactly as current as one entered this morning.',
    'The app does not fetch fund performance, does not rank funds and does not recommend ' +
      'switching. Editing a fund, correcting a reading, acknowledging a gap and the fee-impact ' +
      'projection are all app-only, at `#/wealth`.',
  )
}

/** The few per-fund facts that have nowhere in a table: the track, the beneficiaries, the rate. */
function detailNotes(document: OpenDocument, fund: FundAccount, currency: CurrencyCode): string {
  const rate = recentContributionRate(expectedContributionsFor(document.db, fund.id), currency)
  const latest = latestSnapshot(document.db, fund.id)
  const yearlyFee = latest === undefined ? undefined : annualFeeCost(latest.totalBalance, fund.fees)
  const liquidity = studyFundLiquidity(fund)

  return table(
    ['Field', 'Value'],
    [
      ['Policy number', fund.policyNumber ?? '—'],
      ['Investment track', fund.investmentTrack ?? '—'],
      ['Employer', fund.employerName ?? '—'],
      ['Opened', date(fund.openedDate)],
      ['First deposit', date(fund.firstDepositDate)],
      ['Fee on accumulation', percent(fund.fees.onAccumulationBasisPoints)],
      ['Fee on deposit', percent(fund.fees.onDepositBasisPoints)],
      ['What that fee costs a year at the latest balance', money(yearlyFee)],
      [
        'Contributions, annualized from the paychecks',
        rate === undefined
          ? '— (no paycheck feeds this fund)'
          : `${money(rate.annual)}, read off ${plural(rate.monthsCounted, 'salary month')} to ${period(rate.to)}`,
      ],
      [
        'Withdrawable',
        liquidity === undefined
          ? '—'
          : `${date(liquidity.liquidAt)}, or ${date(liquidity.earlyLiquidAt)} in the circumstances the law allows`,
      ],
      ['Beneficiaries', fund.beneficiaries ?? '— (almost nobody updates this after a marriage)'],
      ['Notes', fund.notes ?? '—'],
    ],
  )
}

export const fundsTool: PluginTool = {
  definition: {
    name: 'funds',
    title: 'Pension and hishtalmut funds',
    description:
      'Every pension, study fund, provident fund and managers’ insurance the document tracks: ' +
      'the latest transcribed balance and how old it is, the management fee as stated and as ' +
      'measured against what was actually charged, what the dormant ones cost a year, and — the ' +
      'point of the feature — **whether the paychecks and the fund’s own report agree about what ' +
      'was deposited**. A fund finds its paycheck lines through the deduction types that pay into ' +
      'it — `set_deduction_types` sets that link. Name one with fund_id to also get its readings, ' +
      'its return window by window, and the working behind that check. Reads the document; ' +
      'changes nothing.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        fund_id: stringProp(
          'Narrow to one fund and add its working — readings, returns, and the expected-versus-' +
            'actual table behind the deposit verdict. Ids come from this same tool.',
        ),
        include_archived: booleanProp(
          'Include archived funds. Default false. A fund can be archived with a gap still open ' +
            'in it, so ask for them when chasing one.',
        ),
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  run: async (args) =>
    readDocument(requireString(args, 'path'), (document) => renderFunds(document, args)),
}

// --- record_fund_readings ---------------------------------------------------

/** The reading half of an entry, as the caller gave it. */
interface RequestedReading {
  readonly asOfDate: LocalDate
  readonly totalMajor: number
  readonly employeeMajor: number | undefined
  readonly employerMajor: number | undefined
  readonly severanceMajor: number | undefined
  readonly depositsMajor: number | undefined
  readonly feesMajor: number | undefined
  readonly returnMajor: number | undefined
  readonly note: string | undefined
  /** The report's per-deposit table, where it prints one (D-153). */
  readonly deposits: readonly RequestedDeposit[]
}

/**
 * One row of that table, in major units — the currency is settled per fund at
 * planning time, which is after every argument has been read.
 */
interface RequestedDeposit {
  readonly employerName: string | undefined
  readonly depositDate: LocalDate | undefined
  readonly salaryMonth: YearMonth
  readonly employeeMajor: number | undefined
  readonly employerMajor: number | undefined
  readonly severanceMajor: number | undefined
  readonly totalMajor: number | undefined
  readonly salaryMajor: number | undefined
}

/** One entry: which fund, what to create it as if it is new, and one reading. */
interface Requested {
  readonly fundId: string | undefined
  readonly name: string | undefined
  readonly fundType: FundType | undefined
  readonly status: FundStatus | undefined
  readonly institutionId: string | undefined
  readonly policyNumber: string | undefined
  readonly investmentTrack: string | undefined
  readonly employerName: string | undefined
  readonly openedDate: LocalDate | undefined
  readonly firstDepositDate: LocalDate | undefined
  readonly feeOnAccumulation: number | undefined
  readonly feeOnDeposit: number | undefined
  readonly feeNegotiatedUntil: LocalDate | undefined
  readonly agreedReturn: number | undefined
  readonly beneficiaries: string | undefined
  readonly notes: string | undefined
  readonly reading: RequestedReading | undefined
}

/** One reading, resolved and costed. */
interface PlannedReading {
  readonly requested: RequestedReading
  readonly snapshot: NewSnapshot | undefined
  /** The reading's deposit table, in the fund's own currency (D-153). */
  readonly deposits: readonly ReadDeposit[]
  readonly note: string | undefined
}

/**
 * One fund and everything the batch says about it.
 *
 * Entries are grouped rather than taken one at a time because four quarterly
 * reports for the same fund are four readings and **one** fund: a batch that
 * created a second "Menora pension" on the second report would be worse than
 * useless, since a duplicate fund splits the deposit check in half and both
 * halves then look wrong.
 */
interface Group {
  readonly label: string
  readonly existing: FundAccount | undefined
  readonly create: NewFundAccount | undefined
  readonly currency: CurrencyCode
  readonly readings: readonly PlannedReading[]
  readonly note: string | undefined
}

interface Plan {
  readonly groups: readonly Group[]
}

function readReading(record: Record<string, unknown>, where: string): RequestedReading | undefined {
  const asOfText = optionalString(record, 'as_of_date')
  const totalMajor = optionalNumber(record, 'total_balance')

  if (asOfText === undefined && totalMajor === undefined) return undefined
  if (asOfText === undefined || totalMajor === undefined) {
    throw new ToolInputError(
      `${where} gives one of \`as_of_date\` and \`total_balance\` without the other. A reading is ` +
        'a balance on a day; either give both, or neither and the entry just records the fund.',
    )
  }

  const asOfDate = parseISODate(asOfText)
  if (asOfDate === undefined) {
    throw new ToolInputError(`${where}.as_of_date must be YYYY-MM-DD; got "${asOfText}".`)
  }

  return {
    asOfDate,
    totalMajor,
    employeeMajor: optionalNumber(record, 'employee_component'),
    employerMajor: optionalNumber(record, 'employer_component'),
    severanceMajor: optionalNumber(record, 'severance_component'),
    depositsMajor: optionalNumber(record, 'deposits_since_previous'),
    feesMajor: optionalNumber(record, 'fees_charged_since_previous'),
    returnMajor: optionalNumber(record, 'return_since_previous'),
    note: optionalString(record, 'reading_note'),
    deposits: readDepositTable(record, where),
  }
}

/**
 * The deposit table a report prints, as the caller transcribed it (D-153).
 *
 * **The salary month is what makes a row worth writing**, so a row without one
 * is refused rather than stored: it would count towards the fund's total and
 * towards no month, which is the one thing this table exists to prevent.
 * Everything else on a row is optional, because a report that breaks a deposit
 * into three kinds of money and one that prints a single figure are both real.
 *
 * A row with no amount at all is refused for the reason `readDepositRow` refuses
 * one in the app: it is a heading, a total, or a line somebody miscounted.
 */
function readDepositTable(
  record: Record<string, unknown>,
  where: string,
): readonly RequestedDeposit[] {
  const raw = record['deposits']
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    throw new ToolInputError(`${where}.deposits must be a list of the report's deposit rows.`)
  }

  return raw.map((entry, index): RequestedDeposit => {
    const at = `${where}.deposits[${String(index)}]`
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new ToolInputError(`${at} must be an object.`)
    }
    const row = entry as Record<string, unknown>

    const monthText = optionalString(row, 'salary_month')
    if (monthText === undefined) {
      throw new ToolInputError(
        `${at} has no salary_month. The month a deposit is **for** is the whole reason this ` +
          'table is worth transcribing — without it a row counts towards the fund and towards no ' +
          'month. Leave the row out rather than guessing at one.',
      )
    }
    const salaryMonth = parseYearMonth(monthText)
    if (salaryMonth === undefined) {
      throw new ToolInputError(`${at}.salary_month must be YYYY-MM; got "${monthText}".`)
    }

    const employeeMajor = optionalNumber(row, 'employee')
    const employerMajor = optionalNumber(row, 'employer')
    const severanceMajor = optionalNumber(row, 'severance')
    const totalMajor = optionalNumber(row, 'total')
    if (
      employeeMajor === undefined &&
      employerMajor === undefined &&
      severanceMajor === undefined &&
      totalMajor === undefined
    ) {
      throw new ToolInputError(`${at} carries no amount, so it is not a deposit.`)
    }

    return {
      employerName: optionalString(row, 'employer_name'),
      depositDate: readDateArg(row, 'deposit_date', at),
      salaryMonth,
      employeeMajor,
      employerMajor,
      severanceMajor,
      totalMajor,
      salaryMajor: optionalNumber(row, 'salary'),
    }
  })
}

function readDateArg(record: Record<string, unknown>, name: string, where: string): LocalDate | undefined {
  const text = optionalString(record, name)
  if (text === undefined) return undefined
  const parsed = parseISODate(text)
  if (parsed === undefined) {
    throw new ToolInputError(`${where}.${name} must be YYYY-MM-DD; got "${text}".`)
  }
  return parsed
}

function readBasisPoints(
  record: Record<string, unknown>,
  name: string,
  where: string,
): number | undefined {
  const value = optionalNumber(record, name)
  if (value === undefined) return undefined
  if (value < 0 || !Number.isInteger(value)) {
    throw new ToolInputError(
      `${where}.${name} must be a whole number of **basis points**, not a percentage: 0.5% is 50 ` +
        `and 1.05% is 105. Got ${value}.`,
    )
  }
  return value
}

function readBatch(args: Args): readonly Requested[] {
  const raw = args['readings']
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolInputError(
      '`readings` must be a non-empty array. One entry per reading — four quarterly reports for ' +
        'one fund are four entries naming the same fund, and the fund is created once.',
    )
  }
  if (raw.length > BATCH_MAX) {
    throw new ToolInputError(`That is ${raw.length} entries; the ceiling is ${BATCH_MAX}.`)
  }

  return raw.map((entry, index) => {
    const where = `\`readings[${index}]\``
    if (typeof entry !== 'object' || entry === null) {
      throw new ToolInputError(`${where} must be an object.`)
    }
    const record = entry as Record<string, unknown>

    const fundId = optionalString(record, 'fund_id')
    const name = optionalString(record, 'name')
    if (fundId === undefined && name === undefined) {
      throw new ToolInputError(
        `${where} needs a \`fund_id\` from \`funds\`, or a \`name\`. A name that matches a fund ` +
          'already in the document attaches to it; a name that matches nothing creates the fund, ' +
          'and then also needs a `fund_type`.',
      )
    }

    const rawType = optionalString(record, 'fund_type')?.toUpperCase()
    if (rawType !== undefined && !FUND_TYPES.includes(rawType as FundType)) {
      throw new ToolInputError(`${where}.fund_type must be one of ${FUND_TYPES.join(', ')}.`)
    }

    const rawStatus = optionalString(record, 'status')?.toUpperCase()
    if (rawStatus !== undefined && !FUND_STATUSES.includes(rawStatus as FundStatus)) {
      throw new ToolInputError(`${where}.status must be one of ${FUND_STATUSES.join(', ')}.`)
    }

    return {
      fundId,
      name,
      fundType: rawType as FundType | undefined,
      status: rawStatus as FundStatus | undefined,
      institutionId: optionalString(record, 'institution_id'),
      policyNumber: optionalString(record, 'policy_number'),
      investmentTrack: optionalString(record, 'investment_track'),
      employerName: optionalString(record, 'employer_name'),
      openedDate: readDateArg(record, 'opened_date', where),
      firstDepositDate: readDateArg(record, 'first_deposit_date', where),
      feeOnAccumulation: readBasisPoints(record, 'fee_on_accumulation_basis_points', where),
      feeOnDeposit: readBasisPoints(record, 'fee_on_deposit_basis_points', where),
      feeNegotiatedUntil: readDateArg(record, 'fee_negotiated_until', where),
      agreedReturn: readBasisPoints(record, 'agreed_return_basis_points', where),
      beneficiaries: optionalString(record, 'beneficiaries'),
      notes: optionalString(record, 'notes'),
      reading: readReading(record, where),
    }
  })
}

const SNAPSHOT_PROBLEM_TEXT: Readonly<Record<SnapshotProblem, string>> = {
  NEGATIVE_BALANCE: 'the balance is negative',
  COMPONENTS_DISAGREE:
    'the three stated components do not add up to the total — leave a component out rather than ' +
    'guessing it, since an empty box means "the report did not say" and not zero',
  MIXED_CURRENCY: 'the amounts are not all in one currency',
  DUPLICATE_DATE: 'this fund already has a reading for that date; correcting one is app-only',
}

function describesFund(requested: Requested): boolean {
  return (
    requested.fundType !== undefined ||
    requested.status !== undefined ||
    requested.institutionId !== undefined ||
    requested.policyNumber !== undefined ||
    requested.investmentTrack !== undefined ||
    requested.employerName !== undefined ||
    requested.openedDate !== undefined ||
    requested.firstDepositDate !== undefined ||
    requested.feeOnAccumulation !== undefined ||
    requested.feeOnDeposit !== undefined ||
    requested.feeNegotiatedUntil !== undefined ||
    requested.agreedReturn !== undefined ||
    requested.beneficiaries !== undefined ||
    requested.notes !== undefined
  )
}

/**
 * Work out what the batch would write, against the document as it is now.
 *
 * The funds are re-resolved here rather than carried over from whatever `funds`
 * printed, for the reason `mutatingCall` recomputes every plan: a fund created
 * or a reading added between the two calls should get an honest answer instead
 * of one applied blind.
 *
 * A fund is denominated in **whatever its readings already say**, falling back
 * to the document's currency for a new one — the rule `fundAnalysis` follows,
 * so a second reading of a fund recorded in euros does not silently arrive in
 * shekels.
 */
function buildPlan(document: OpenDocument, batch: readonly Requested[]): Plan {
  const documentWide = documentCurrency(document.db)
  const existingFunds = listFundsWithLatest(document.db, { includeArchived: true }).map(
    (entry) => entry.fund,
  )
  const institutions = new Set(listInstitutions(document.db).map((one) => one.id))

  // Group by the fund each entry names, keeping the batch's order.
  const order: string[] = []
  const grouped = new Map<string, Requested[]>()
  for (const requested of batch) {
    const key = requested.fundId ?? `name:${(requested.name ?? '').trim().toLowerCase()}`
    const bucket = grouped.get(key)
    if (bucket === undefined) {
      order.push(key)
      grouped.set(key, [requested])
    } else bucket.push(requested)
  }

  const groups = order.map((key): Group => {
    const members = grouped.get(key) ?? []
    const first = members[0]
    if (first === undefined) {
      return { label: key, existing: undefined, create: undefined, currency: documentWide, readings: [], note: 'empty group' }
    }

    const existing =
      first.fundId === undefined
        ? existingFunds.find(
            (fund) => fund.name.trim().toLowerCase() === (first.name ?? '').trim().toLowerCase(),
          )
        : existingFunds.find((fund) => fund.id === first.fundId)

    const label = existing?.name ?? first.name ?? (first.fundId ?? '')

    if (first.fundId !== undefined && existing === undefined) {
      return {
        label,
        existing: undefined,
        create: undefined,
        currency: documentWide,
        readings: [],
        note: `no fund with id ${first.fundId} — \`funds\` has the ids, and archived ones need \`include_archived\``,
      }
    }

    // Describing a fund that already exists is a request to edit it, and this
    // tool does not edit. Refusing beats quietly ignoring the fields, which
    // would leave a corrected fee silently unwritten.
    const describing = members.filter(describesFund)
    if (existing !== undefined && describing.length > 0) {
      return {
        label,
        existing,
        create: undefined,
        currency: documentWide,
        readings: [],
        note:
          `${label} already exists, and this entry also describes it. Changing a fund’s type, ` +
          'fees, track, status or dates is app-only, at `#/wealth`. Drop those fields to record ' +
          'the reading',
      }
    }

    let create: NewFundAccount | undefined
    if (existing === undefined) {
      const fundType = members.find((one) => one.fundType !== undefined)?.fundType
      if (fundType === undefined) {
        return {
          label,
          existing: undefined,
          create: undefined,
          currency: documentWide,
          readings: [],
          note:
            `no fund named "${label}" in this document, so it would be created — and creating one ` +
            `needs a \`fund_type\`, one of ${FUND_TYPES.join(', ')}`,
        }
      }

      const conflicting = [...new Set(members.map((one) => one.fundType).filter((one) => one !== undefined))]
      if (conflicting.length > 1) {
        return {
          label,
          existing: undefined,
          create: undefined,
          currency: documentWide,
          readings: [],
          note: `entries naming "${label}" disagree about its \`fund_type\`: ${conflicting.join(', ')}`,
        }
      }

      const pick = <K extends keyof Requested>(field: K): Requested[K] =>
        members.find((one) => one[field] !== undefined)?.[field]

      const institutionId = pick('institutionId')
      if (institutionId !== undefined && !institutions.has(institutionId)) {
        return {
          label,
          existing: undefined,
          create: undefined,
          currency: documentWide,
          readings: [],
          note: `no institution with id ${institutionId} — \`funds\` lists the fund managers with theirs`,
        }
      }

      create = {
        name: (first.name ?? '').trim(),
        fundType,
        ...(institutionId === undefined ? {} : { institutionId }),
        ...(pick('policyNumber') === undefined ? {} : { policyNumber: pick('policyNumber') }),
        ...(pick('investmentTrack') === undefined ? {} : { investmentTrack: pick('investmentTrack') }),
        ...(pick('status') === undefined ? {} : { status: pick('status') }),
        ...(pick('employerName') === undefined ? {} : { employerName: pick('employerName') }),
        ...(pick('openedDate') === undefined ? {} : { openedDate: pick('openedDate') }),
        ...(pick('firstDepositDate') === undefined ? {} : { firstDepositDate: pick('firstDepositDate') }),
        ...(pick('feeOnAccumulation') === undefined
          ? {}
          : { feeOnAccumulationBasisPoints: pick('feeOnAccumulation') }),
        ...(pick('feeOnDeposit') === undefined
          ? {}
          : { feeOnDepositBasisPoints: pick('feeOnDeposit') }),
        ...(pick('feeNegotiatedUntil') === undefined
          ? {}
          : { feeNegotiatedUntil: pick('feeNegotiatedUntil') }),
        ...(pick('agreedReturn') === undefined ? {} : { agreedReturnBasisPoints: pick('agreedReturn') }),
        ...(pick('beneficiaries') === undefined ? {} : { beneficiaries: pick('beneficiaries') }),
        ...(pick('notes') === undefined ? {} : { notes: pick('notes') }),
      }
    }

    const already = existing === undefined ? [] : listSnapshots(document.db, existing.id)
    const currency = already[0]?.totalBalance.currency ?? documentWide
    const readings = plannedReadings(document.db, members, already, currency)

    if (existing !== undefined && readings.length === 0) {
      return {
        label,
        existing,
        create: undefined,
        currency,
        readings: [],
        note: `${label} already exists and this entry carries no reading, so there is nothing to write`,
      }
    }

    return { label, existing, create, currency, readings, note: undefined }
  })

  return { groups }
}

function plannedReadings(
  db: Database,
  members: readonly Requested[],
  already: readonly FundBalanceSnapshot[],
  currency: CurrencyCode,
): readonly PlannedReading[] {
  const seen = [...already]

  return members
    .map((one) => one.reading)
    .filter((reading): reading is RequestedReading => reading !== undefined)
    .sort((a, b) => toISODate(a.asOfDate).localeCompare(toISODate(b.asOfDate)))
    .map((requested): PlannedReading => {
      const amount = (value: number | undefined): Money | undefined =>
        value === undefined ? undefined : fromMajorUnits(value, currency)

      const snapshot: NewSnapshot = {
        // Filled in at commit time; the fund may not exist yet.
        fundAccountId: '',
        asOfDate: requested.asOfDate,
        totalBalance: fromMajorUnits(requested.totalMajor, currency),
        ...(amount(requested.employeeMajor) === undefined
          ? {}
          : { employeeComponent: amount(requested.employeeMajor) }),
        ...(amount(requested.employerMajor) === undefined
          ? {}
          : { employerComponent: amount(requested.employerMajor) }),
        ...(amount(requested.severanceMajor) === undefined
          ? {}
          : { severanceComponent: amount(requested.severanceMajor) }),
        ...(amount(requested.depositsMajor) === undefined
          ? {}
          : { depositsSincePrevious: amount(requested.depositsMajor) }),
        ...(amount(requested.feesMajor) === undefined
          ? {}
          : { feesChargedSincePrevious: amount(requested.feesMajor) }),
        ...(amount(requested.returnMajor) === undefined
          ? {}
          : { returnSincePrevious: amount(requested.returnMajor) }),
        ...(requested.note === undefined ? {} : { note: requested.note }),
      }

      // `snapshotProblems` judges a stored shape, so it gets one — with a
      // placeholder id, which is exactly what it compares by when looking for a
      // clashing date. The parts against the total are the pack's identity
      // (D-280), judged by the document's declaration as the screen's are.
      const asStored: FundBalanceSnapshot = {
        id: '',
        fundAccountId: '',
        asOfDate: snapshot.asOfDate,
        totalBalance: snapshot.totalBalance,
        employeeComponent: snapshot.employeeComponent,
        employerComponent: snapshot.employerComponent,
        severanceComponent: snapshot.severanceComponent,
        depositsSincePrevious: snapshot.depositsSincePrevious,
        feesChargedSincePrevious: snapshot.feesChargedSincePrevious,
        returnSincePrevious: snapshot.returnSincePrevious,
        depositGapAcknowledged: false,
        note: snapshot.note,
      }

      const deposits = requested.deposits.map(
        (row): ReadDeposit => ({
          employerName: row.employerName,
          depositDate: row.depositDate,
          salaryMonth: row.salaryMonth,
          employee: amount(row.employeeMajor),
          employer: amount(row.employerMajor),
          severance: amount(row.severanceMajor),
          total: amount(row.totalMajor),
          salary: amount(row.salaryMajor),
          note: undefined,
        }),
      )

      const problems = snapshotProblems(db, asStored, seen).problems
      if (problems.length > 0) {
        return {
          requested,
          snapshot: undefined,
          deposits: [],
          note: problems.map((problem) => SNAPSHOT_PROBLEM_TEXT[problem]).join('; '),
        }
      }

      // Counted against the ones after it, so two entries in this batch for the
      // same day are caught here rather than by the unique index at commit.
      seen.push({ ...asStored, id: `pending:${toISODate(requested.asOfDate)}` })
      return { requested, snapshot, deposits, note: undefined }
    })
}

function planTable(plan: Plan): string {
  const rows: string[][] = []

  for (const group of plan.groups) {
    if (group.note !== undefined) {
      rows.push([group.label, 'nothing', '—', '—', '—', '—', '—', group.note])
      continue
    }

    // The creation is announced once, on the first reading of the group, and
    // the rest say what they are. Repeating "new fund" on all four quarterly
    // reports would read as four funds, which is the one misreading this
    // grouping exists to prevent.
    let creation = group.create === undefined ? undefined : `**creates a new ${group.create.fundType}**`

    for (const reading of group.readings) {
      const what = creation ?? 'reading added'
      creation = undefined

      rows.push([
        group.label,
        reading.note === undefined ? what : 'nothing',
        date(reading.requested.asOfDate),
        money(reading.snapshot?.totalBalance),
        money(reading.snapshot?.depositsSincePrevious),
        money(reading.snapshot?.feesChargedSincePrevious),
        money(reading.snapshot?.returnSincePrevious),
        reading.note ?? '—',
      ])
    }

    if (creation !== undefined) {
      rows.push([group.label, creation, '—', '—', '—', '—', '—', 'the fund, with no reading yet'])
    }
  }

  return table(
    ['Fund', 'What happens', 'As of', 'Balance', 'Fund says it received', 'Fees charged', 'Return', 'Note'],
    rows,
  )
}

function describePlan(plan: Plan): string {
  const usable = plan.groups.filter((group) => group.note === undefined)
  const creating = usable.filter((group) => group.create !== undefined)
  const writable = usable.flatMap((group) =>
    group.readings.filter((reading) => reading.snapshot !== undefined),
  )
  const refused = plan.groups.filter((group) => group.note !== undefined)
  const badReadings = usable.flatMap((group) =>
    group.readings.filter((reading) => reading.snapshot === undefined),
  )

  return paragraphs(
    writable.length === 0 && creating.length === 0
      ? '**Nothing to write.** The reasons are in the table.'
      : `**${plural(writable.length, 'reading')}** would be recorded` +
        (creating.length === 0 ? '' : `, and ${plural(creating.length, 'fund')} created`) +
        (refused.length + badReadings.length === 0
          ? '.'
          : `, with ${plural(refused.length + badReadings.length, 'entry', 'entries')} refused.`),
    planTable(plan),
    creating.length === 0
      ? undefined
      : `**Would create ${plural(creating.length, 'fund')} the document does not have yet**: ` +
        `${creating.map((group) => group.label).join(', ')}. Check the names against what the ` +
        'user already has — a typo makes a second fund, and a fund split in two makes both ' +
        'halves of its deposit check look wrong.',
    depositLine(plan),
    writable.length === 0
      ? undefined
      : 'A balance is transcribed exactly as the report prints it. Leave a box out where the ' +
        'report is silent: an absent component or an absent deposit figure means "the report did ' +
        'not say", and a 0 would be read as a claim that nothing was there.',
    'Recording a reading is what lets the deposit check run — the answer to whether an employer ' +
      'actually deposited what the paychecks say it deducted. That check needs **two** readings ' +
      'that both state what the fund received, and paychecks whose deduction type points at the ' +
      'fund.',
  )
}

/**
 * What the deposit tables in this batch would write, named by the months they
 * cover (D-153).
 *
 * A count would not be enough. The value of the table is per row and per
 * **month** — a deposit for 11/2025 that arrived in January is late, and no
 * total says so — so a dry run that only said "9 rows" would be asking for
 * agreement to something it had not shown.
 */
function depositLine(plan: Plan): string | undefined {
  const months: string[] = []
  let rows = 0

  for (const group of plan.groups) {
    for (const reading of group.readings) {
      rows += reading.deposits.length
      for (const deposit of reading.deposits) {
        // Never undefined on this path — `readDepositTable` refuses a row
        // without one — but the shared shape allows it, because the app reads
        // tables off a page and a page can print a row it cannot read.
        if (deposit.salaryMonth === undefined) continue
        months.push(toYearMonthString(deposit.salaryMonth))
      }
    }
  }
  if (rows === 0) return undefined

  const distinct = [...new Set(months)].sort()
  const span =
    distinct.length === 1
      ? distinct[0]
      : `${distinct[0] ?? ''} to ${distinct[distinct.length - 1] ?? ''}`

  return (
    `**${plural(rows, 'deposit')}** would be written with those readings, covering salary ` +
    `${distinct.length === 1 ? 'month' : `months ${String(distinct.length)}`} ${span}. ` +
    'Each one records the month it is **for**, which is what lets the deposit check say *which* ' +
    'month is missing rather than that a quarter is short. Nothing on a report checks that ' +
    'column, so it is worth reading back against the page.'
  )
}

function applyPlan(document: OpenDocument, plan: Plan): string {
  const now = Date.now()
  const done: string[][] = []
  const created: string[] = []
  const touched: FundAccount[] = []

  for (const group of plan.groups) {
    if (group.note !== undefined) continue

    const fund =
      group.create === undefined ? group.existing : createFund(document.db, group.create, now)
    if (fund === undefined) continue
    if (group.create !== undefined) created.push(fund.name)
    touched.push(fund)

    for (const reading of group.readings) {
      if (reading.snapshot === undefined) continue
      const saved = addSnapshot(document.db, { ...reading.snapshot, fundAccountId: fund.id }, now)
      // The report's deposit table, against the reading it came off — after the
      // insert, because a deposit row belongs to a snapshot that exists (D-153).
      if (reading.deposits.length > 0) {
        replaceSnapshotDeposits(document.db, saved.id, fund.id, reading.deposits, now)
      }
      done.push([
        fund.name,
        date(saved.asOfDate),
        money(saved.totalBalance),
        money(saved.depositsSincePrevious),
        money(saved.feesChargedSincePrevious),
      ])
    }
  }

  // The payoff, computed after the write rather than promised before it: the
  // whole reason a reading is worth transcribing is what the check says once it
  // is in. Recomputed from the document as it now stands, inside the same
  // transaction, so the sentence and the file cannot disagree — including for a
  // fund this very batch created, which two reports in one call can already
  // give a verdict.
  const currency = documentCurrency(document.db)
  const verdicts = touched
    .map((fund) => {
      const check = fundDepositCheck(document.db, fund.id, currency)
      return check === undefined ? undefined : `**${fund.name}** — ${depositVerdict(check)}`
    })
    .filter((one): one is string => one !== undefined)

  const refusals = plan.groups.filter((group) => group.note !== undefined)

  const depositRows = plan.groups.reduce(
    (total, group) =>
      total + group.readings.reduce((count, reading) => count + reading.deposits.length, 0),
    0,
  )

  return paragraphs(
    `Recorded ${plural(done.length, 'reading')}` +
      (depositRows === 0 ? '' : ` and ${plural(depositRows, 'deposit')}`) +
      (created.length === 0 ? '.' : `, and created ${plural(created.length, 'fund')}: ${created.join(', ')}.`),
    done.length === 0
      ? undefined
      : table(['Fund', 'As of', 'Balance', 'Fund says it received', 'Fees charged'], done),
    verdicts.length === 0 ? undefined : section('Where the deposit check stands now', verdicts.join('\n\n')),
    refusals.length === 0
      ? undefined
      : `Refused: ${refusals.map((group) => `${group.label} — ${group.note ?? ''}`).join('; ')}.`,
    '`funds` shows them all with the fees and the verdicts; naming one with `fund_id` gives its ' +
      'readings and the working. Correcting a reading, editing a fund and acknowledging a gap ' +
      'are app-only, at `#/wealth`.',
  )
}

export const recordFundReadingsTool: PluginTool = {
  definition: {
    name: 'record_fund_readings',
    title: 'Record fund balances from a report',
    description:
      'Transcribe what a pension, hishtalmut, provident or managers’-insurance report says into ' +
      'the document — **several readings in one call**. Each entry names a fund by fund_id or by ' +
      'name, and carries one reading: the balance and its date, plus whatever else the report ' +
      'printed. A name that matches no fund creates it, once per batch, so four quarterly ' +
      'reports for one fund are four entries naming the same fund. **Leave out anything the ' +
      'report did not state** — an empty field means "not stated", and a 0 would be read as a ' +
      'stated zero. **Dry-runs by default**: it returns what it would write and writes nothing until ' +
      'called again with commit true. The document is copied to a timestamped .bak first. ' +
      'Editing a fund or correcting a reading already written is app-only.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        readings: {
          type: 'array',
          description: `One entry per reading. Up to ${String(BATCH_MAX)} in a call.`,
          items: {
            type: 'object',
            properties: {
              fund_id: stringProp('An existing fund, from `funds`.'),
              name: stringProp(
                'The fund by name instead. Matches an existing fund case-insensitively; matches ' +
                  'nothing and the fund is created, which also needs `fund_type`.',
              ),
              fund_type: stringProp(
                `One of ${FUND_TYPES.join(', ')}. Required only when creating a fund.`,
              ),
              status: stringProp(
                `One of ${FUND_STATUSES.join(', ')}. Default ACTIVE. DORMANT is a fund from a ` +
                  'previous job that takes no new deposits and still charges fees — worth setting, ' +
                  'because it is also what tells the deposit check that nothing arriving is correct.',
              ),
              institution_id: stringProp('The managing company, by id from `funds`.'),
              policy_number: stringProp('For reference and for matching future statements.'),
              investment_track: stringProp('What the report calls the track, as free text.'),
              employer_name: stringProp('Which job this fund belongs to.'),
              opened_date: stringProp('YYYY-MM-DD.'),
              first_deposit_date: stringProp(
                'YYYY-MM-DD. For a study fund this is what the six-year withdrawal date is ' +
                  'counted from, and nothing else can work it out.',
              ),
              fee_on_accumulation_basis_points: numberProp(
                'דמי ניהול מהצבירה, in **basis points** a year: 0.5% is 50, 1.05% is 105.',
              ),
              fee_on_deposit_basis_points: numberProp(
                'דמי ניהול מהפקדה, in basis points of each contribution.',
              ),
              fee_negotiated_until: stringProp(
                'YYYY-MM-DD. Fee agreements expire and silently revert to the default rate, which ' +
                  'is exactly the thing nobody notices.',
              ),
              agreed_return_basis_points: numberProp(
                'A yearly return the provider agreed to in writing, in **basis points**: 4% is 400. ' +
                  'Only a rate in the contract; an expected return is an assumption and goes nowhere here.',
              ),
              beneficiaries: stringProp('Free text.'),
              notes: stringProp('Anything else about the fund.'),
              as_of_date: stringProp('The date the reading is of, as YYYY-MM-DD.'),
              total_balance: numberProp('The total balance the report prints, in major units.'),
              employee_component: numberProp('The employee’s component, where the report breaks it out.'),
              employer_component: numberProp('The employer’s component, where the report breaks it out.'),
              severance_component: numberProp(
                'The severance (פיצויים) component. Its tax and withdrawal rules differ from the ' +
                  'other two, so it is never folded into them.',
              ),
              deposits_since_previous: numberProp(
                'What the fund says it **received** since the previous reading. This is the ' +
                  'number the paychecks get compared against, so it is the single most valuable ' +
                  'field here. May be negative — a severance withdrawal is recorded as exactly that.',
              ),
              fees_charged_since_previous: numberProp(
                'What the fund says it charged over the same period, which is what makes the ' +
                  'measured fee possible.',
              ),
              return_since_previous: numberProp(
                'The return figure the report prints. Never one the app computed.',
              ),
              deposits: {
                type: 'array',
                description:
                  'The report’s per-deposit table (פירוט ההפקדות), one entry per row, where it ' +
                  'prints one. This is the most valuable thing on a pension report after the ' +
                  'balance: every row names the salary month it is **for**, which is what turns ' +
                  '"the quarter is ₪2,000 short" into "February never arrived". Transcribe the ' +
                  'rows as printed and leave the field out entirely if the report has no such ' +
                  'table. Rows repeated by a later year-to-date report are fine — the document ' +
                  'counts each deposit once.',
                items: {
                  type: 'object',
                  properties: {
                    salary_month: stringProp(
                      'REQUIRED. The salary month this deposit is **for**, as YYYY-MM — not the ' +
                        'month it arrived. A row without it is refused rather than stored, ' +
                        'because it would count towards the fund and towards no month.',
                    ),
                    deposit_date: stringProp('When the money reached the fund, as YYYY-MM-DD.'),
                    employer_name: stringProp('Who paid it in, as the row prints it.'),
                    employee: numberProp('תגמולי עובד — the employee’s own contribution.'),
                    employer: numberProp('תגמולי מעסיק — the employer’s.'),
                    severance: numberProp('פיצויים — severance.'),
                    total: numberProp(
                      'The row’s own total column, where the table prints one. Leave it out ' +
                        'rather than adding the three up: the document derives that itself.',
                    ),
                    salary: numberProp('The salary the deposit was computed on, if printed.'),
                  },
                  required: ['salary_month'],
                  additionalProperties: false,
                },
              },
              reading_note: stringProp('Anything about this particular reading.'),
            },
            required: [],
            additionalProperties: false,
          },
        },
        commit: booleanProp('Default false. False previews the batch; true writes it.'),
      },
      required: ['path', 'readings'],
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
