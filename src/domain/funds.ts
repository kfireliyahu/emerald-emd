/**
 * Pension and hishtalmut math — expected contributions, deposit reconciliation,
 * fees and returns. docs/f13-pension-and-hishtalmut.md and
 * docs/packs/ledger/05-domain-rules-and-calculations.md ("Fund math").
 *
 * Pure functions over plain values: no database, no clock, no React. Written and
 * tested before a screen exists, exactly as M2 opened with the rules engine, M3
 * with the paycheck figures, M4 with the fixed-expense detector and M5 with the
 * bank-import domain.
 *
 * Four things hold everywhere in here:
 *
 * - **A deposit is never a gain.** This is F13's acceptance criterion and it is
 *   enforced by a signature rather than by remembering: `periodReturn` demands a
 *   `ContributionBasis`, and the one basis that means "nobody knows" produces no
 *   figure at all rather than a balance delta the caller can mistake for a
 *   return (D-066). Nothing in this file hands out a bare balance change.
 * - **"Not enough data" is a variant, not an `undefined`.** One snapshot gives
 *   `NEEDS_TWO_POINTS`, not a return of zero. docs/f13: say so, don't show
 *   zeros — and a discriminated union is the version of that a caller cannot
 *   forget to check.
 * - **A rate is not money.** Fees, returns and tolerances are integer basis
 *   points (`@/core/percent.ts`). The only division that touches an amount is
 *   `applyBasisPoints`, which is integer arithmetic with half-up rounding, so no
 *   float is ever within reach of a balance (D-003).
 * - **The employer pays late, and that is not a scandal.** Every comparison
 *   between payslips and fund reports shifts the salary months back by a
 *   configurable lag and compares cumulative totals over the whole reported
 *   window, because a reconciliation that cries wolf every month is one the user
 *   stops reading (docs/f13).
 */

import { add, money, subtract, sum, zero, type CurrencyCode, type Money } from '@/core/money.ts'
import { applyBasisPoints, ratioOfBasisPoints } from '@/core/percent.ts'
import {
  addMonths,
  compareDates,
  compareYearMonths,
  daysInMonth,
  localDate,
  monthsBetween,
  parseYearMonth,
  toISODate,
  toYearMonthString,
  yearMonthOf,
  type LocalDate,
  type YearMonth,
} from '@/core/time.ts'
import type {
  ExpectedContribution,
  FeeReference,
  FundAccount,
  FundBalanceSnapshot,
  FundDeposit,
  FundFees,
  FundStatus,
} from '@/domain/model/funds.ts'
import type { DeductionType, PaycheckWithLines } from '@/domain/model/paycheck.ts'
import { projectBalance } from '@/domain/projection.ts'

// --- Integer helpers --------------------------------------------------------

/** Oldest first. The order every window below is read in. */
export function sortSnapshots(
  snapshots: readonly FundBalanceSnapshot[],
): readonly FundBalanceSnapshot[] {
  return [...snapshots].sort((a, b) => compareDates(a.asOfDate, b.asOfDate))
}

/** The same calendar day some years later, clamping 29 February to the 28th. */
function addYears(date: LocalDate, years: number): LocalDate {
  const year = date.year + years
  return localDate(year, date.month, Math.min(date.day, daysInMonth(year, date.month)))
}

// --- Expected contributions -------------------------------------------------

/**
 * What the payslips say should have reached each fund.
 *
 * **Derived, never stored** (docs/f13). A line contributes only when its
 * deduction type names a fund, which is `DeductionType.linkedFundId` and
 * not a list on the fund — the fact is already in the model from that side, and
 * a second copy is what D-037 removed from `CategoryRule`.
 *
 * **Severance is its own component**, taken from a line whose type is of kind
 * `SEVERANCE` regardless of which of the two columns it was typed into. Its tax
 * and withdrawal rules differ from the other two enough that folding it into the
 * employer share would misstate what the user can actually reach (docs/f13's
 * open question, decided in D-066).
 *
 * One record per fund per payslip, so two slips in one month — a second job, or
 * a 13th salary — stay two facts rather than being averaged into one.
 */
export function expectedContributions(
  entries: readonly PaycheckWithLines[],
  types: readonly DeductionType[],
): readonly ExpectedContribution[] {
  const byId = new Map(types.map((type) => [type.id, type]))
  const contributions: ExpectedContribution[] = []

  for (const entry of entries) {
    const currency = entry.paycheck.gross.currency
    const perFund = new Map<
      string,
      { employee: number; employer: number; severance: number; bases: Set<number> }
    >()

    for (const line of entry.lines) {
      const type = byId.get(line.deductionTypeId)
      const fundId = type?.linkedFundId
      if (type === undefined || fundId === undefined) continue

      const running = perFund.get(fundId) ?? {
        employee: 0,
        employer: 0,
        severance: 0,
        bases: new Set<number>(),
      }
      const employer = line.employerAmount?.minor ?? 0
      // Collected rather than summed: two lines feeding one fund — pension and
      // severance, on every real slip — are two shares of **one** base, so
      // adding them would double the salary. Disagreement is the interesting
      // case and is answered below by refusing to pick one (D-169).
      if (line.basisAmount !== undefined) running.bases.add(line.basisAmount.minor)

      if (type.kind === 'SEVERANCE') {
        running.severance += line.employeeAmount.minor + employer
      } else {
        running.employee += line.employeeAmount.minor
        running.employer += employer
      }

      perFund.set(fundId, running)
    }

    for (const [fundAccountId, amounts] of perFund) {
      const [base] = [...amounts.bases]
      contributions.push({
        fundAccountId,
        paycheckId: entry.paycheck.id,
        period: entry.paycheck.period,
        employee: money(amounts.employee, currency),
        employer: money(amounts.employer, currency),
        severance: money(amounts.severance, currency),
        total: money(amounts.employee + amounts.employer + amounts.severance, currency),
        salaryBasis:
          amounts.bases.size === 1 && base !== undefined ? money(base, currency) : undefined,
      })
    }
  }

  return contributions.sort(
    (a, b) =>
      compareYearMonths(a.period, b.period) ||
      a.fundAccountId.localeCompare(b.fundAccountId) ||
      a.paycheckId.localeCompare(b.paycheckId),
  )
}

/**
 * The three components and the total over a range of **salary months**,
 * inclusive at both ends.
 *
 * `paycheckCount` comes back with the money because zero payslips and zero
 * shekels are different answers: one says nothing was deducted, the other says
 * the app has not been shown the slips. Everything downstream branches on it.
 */
export interface ContributionTotal {
  readonly employee: Money
  readonly employer: Money
  readonly severance: Money
  readonly total: Money
  readonly paycheckCount: number
  readonly periodCount: number
}

export function contributionsBetween(
  contributions: readonly ExpectedContribution[],
  from: YearMonth,
  to: YearMonth,
  currency: CurrencyCode,
): ContributionTotal {
  const inRange = contributions.filter(
    (contribution) =>
      compareYearMonths(contribution.period, from) >= 0 &&
      compareYearMonths(contribution.period, to) <= 0,
  )

  return {
    employee: sum(inRange.map((one) => one.employee), currency),
    employer: sum(inRange.map((one) => one.employer), currency),
    severance: sum(inRange.map((one) => one.severance), currency),
    total: sum(inRange.map((one) => one.total), currency),
    paycheckCount: new Set(inRange.map((one) => one.paycheckId)).size,
    periodCount: new Set(inRange.map((one) => toYearMonthString(one.period))).size,
  }
}

/** How far back the contribution rate looks. A year, so a 13th salary is in it. */
export const CONTRIBUTION_RATE_WINDOW_MONTHS = 12

/**
 * What a year of contributions to a fund currently comes to, and what that is
 * read off.
 *
 * Everything it was derived from comes back with it, for the reason
 * `FeeDragIllustration` hands back its assumptions: this is the opening figure
 * of a projection, and a projection that cannot say where its contribution came
 * from is a number with no provenance.
 */
export interface ContributionRate {
  /** Scaled to a year from the months that actually have payslips. */
  readonly annual: Money
  readonly from: YearMonth
  readonly to: YearMonth
  /** Months with at least one payslip. The scaling denominator, so it is shown. */
  readonly monthsCounted: number
  readonly paycheckCount: number
}

/**
 * The recent contribution rate, annualized — what the fee illustration starts
 * from before the user moves the slider.
 *
 * **The last twelve salary months, not the last one.** A 13th salary and a bonus
 * month are contributions too, and a rate read off a single month either misses
 * them entirely or is entirely one of them. Scaled by the months that actually
 * carry a payslip rather than by the calendar span, because a month with no slip
 * recorded is a month the app was not shown, not a month with no salary — and
 * dividing by it would quietly halve someone's pension.
 */
export function recentContributionRate(
  contributions: readonly ExpectedContribution[],
  currency: CurrencyCode,
): ContributionRate | undefined {
  if (contributions.length === 0) return undefined

  const to = contributions.reduce(
    (newest, one) => (compareYearMonths(one.period, newest) > 0 ? one.period : newest),
    contributions[0]?.period ?? yearMonthOf(localDate(1970, 1, 1)),
  )
  const from = addMonths(to, -(CONTRIBUTION_RATE_WINDOW_MONTHS - 1))
  const window = contributionsBetween(contributions, from, to, currency)
  if (window.periodCount === 0) return undefined

  return {
    annual: money(
      Math.round((window.total.minor * 12) / window.periodCount),
      window.total.currency,
    ),
    from,
    to,
    monthsCounted: window.periodCount,
    paycheckCount: window.paycheckCount,
  }
}

// --- The deposit table, month by month (D-153) ------------------------------

/**
 * What identifies one deposit, so the same one stated by two reports is one
 * deposit.
 *
 * **An Israeli quarterly report is year-to-date** (D-152), so Q2's deposit table
 * restates every row of Q1's. Each reading transcribes its own document
 * faithfully — that is what a snapshot is — and the duplication is resolved
 * here, once, wherever anything adds these up.
 *
 * The key is the four things a report prints about a deposit that do not depend
 * on which report printed them: the salary month it is for, who paid it, when it
 * arrived, and what it came to. A **correction** deposit for a month that
 * already had one differs in at least the date or the amount, so it survives the
 * dedupe — which is right, because it is a second deposit.
 */
export function depositKey(deposit: FundDeposit): string {
  return [
    deposit.salaryMonth === undefined ? '' : toYearMonthString(deposit.salaryMonth),
    deposit.employerName ?? '',
    deposit.depositDate === undefined ? '' : toISODate(deposit.depositDate),
    String(fundDepositTotal(deposit).minor),
  ].join('|')
}

/**
 * One row per distinct deposit, keeping the first statement of each.
 *
 * The first rather than the latest, deliberately: the earliest report to state a
 * deposit is the one closest to it in time, and a later report restating it adds
 * nothing but the opportunity to disagree.
 *
 * **"First" is the caller's order**, and after D-164 that is the order the
 * reports were *written* in rather than the order somebody happened to open
 * them: `listFundDeposits` breaks the salary-month tie by the transcribing
 * reading's date, because a backfill read newest-first would otherwise credit
 * every row to the last report that restated it.
 */
export function distinctDeposits(deposits: readonly FundDeposit[]): readonly FundDeposit[] {
  const seen = new Set<string>()
  const kept: FundDeposit[] = []
  for (const deposit of deposits) {
    const key = depositKey(deposit)
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(deposit)
  }
  return kept
}

/** What one stored deposit came to: its own total where it has one, else its parts. */
export function fundDepositTotal(deposit: FundDeposit, currency?: CurrencyCode): Money {
  if (deposit.total !== undefined) return deposit.total
  const unit =
    currency ??
    deposit.employee?.currency ??
    deposit.employer?.currency ??
    deposit.severance?.currency ??
    'ILS'
  return [deposit.employee, deposit.employer, deposit.severance].reduce<Money>(
    (total, part) => (part === undefined ? total : add(total, part)),
    zero(unit),
  )
}

/**
 * What happened in one salary month: what the payslips promised, what the fund
 * says arrived, and how late it was.
 *
 * `NO_PAYSLIP` and `NOT_REPORTED` are the two half-answers and they are kept
 * apart for the reason every union in this file is: a month with a deposit and
 * no payslip is a month the app has not been shown a slip for, and a month with
 * a payslip and no deposit is the thing this whole feature exists to find. A
 * single "mismatch" would say the same word about both.
 */
/** The three kinds of money in a deposit, which the tax and withdrawal rules tell apart. */
export type DepositPart = 'employee' | 'employer' | 'severance'

export interface MonthlyDeposit {
  readonly period: YearMonth
  readonly expected: Money | undefined
  readonly received: Money | undefined
  /** Expected minus received. **Positive means money is missing.** */
  readonly gap: Money | undefined
  readonly status: 'MATCHED' | 'MISSING' | 'EXCEEDS' | 'NO_PAYSLIP' | 'NOT_REPORTED'
  /**
   * **A part the payslips put in and the fund's rows show none of** (M36 U12,
   * D-389) — an employer's deposit that never arrived, say, while the
   * employee's did. Named, and the month is `MISSING` whatever its total says:
   * a part paid as another part is still a wrong deposit. Empty when the rows
   * print no parts at all, which is nothing claimed rather than nothing paid.
   */
  readonly missingParts: readonly DepositPart[]
  /** The latest date any deposit for this month arrived on. */
  readonly arrivedOn: LocalDate | undefined
  /**
   * How many months after the salary month the money arrived, where both are
   * known. **Read rather than assumed** — this is the whole reason the table is
   * worth transcribing, because `DEFAULT_DEPOSIT_LAG_MONTHS` is a guess and this
   * is the answer.
   */
  readonly lagMonths: number | undefined
  readonly employerNames: readonly string[]
  /**
   * The base the **fund** says it computed this month's deposit on, summed over
   * the rows that name the month (D-169).
   *
   * Absent unless every contributing row prints one: a partial sum set against a
   * whole one is a difference neither document ever claimed.
   */
  readonly fundSalary: Money | undefined
  /** The base the **payslips** print for the same month, on the same rule. */
  readonly slipSalary: Money | undefined
  /** Slip minus fund. **Positive means the fund used a smaller base than the slip printed.** */
  readonly salaryGap: Money | undefined
  /**
   * What can be said about the two bases.
   *
   * `UNKNOWN` is the ordinary answer and is not a failure — most reports print
   * no salary column, and the app's own editor did not carry the slip's base
   * until D-169. It is *not* collapsed into `AGREES`, because "the two agree"
   * and "there is nothing to compare" are exactly the two things this check
   * exists to tell apart (D-138, for the fifth time).
   */
  readonly salaryStatus: 'AGREES' | 'DIFFERS' | 'UNKNOWN'
}

/**
 * The payslips against the fund's own deposit table, **month by month**.
 *
 * `reconcileDeposits` compares one running total against another over a window,
 * because a snapshot's `depositsSincePrevious` is one figure for a whole quarter
 * and a payslip is one figure for a month — so it has to shift the payslips by a
 * guessed lag and then judge the totals, and its honest answer is a running
 * total rather than a verdict about January.
 *
 * A deposit table removes the guess. Every row names the salary month it is for,
 * so the comparison is exact and the lag becomes something *measured*: a
 * contribution for 11/2025 that arrived on 04/01/2026 is two months late, and it
 * says so rather than being averaged into a quarter that came out right.
 *
 * **It replaces nothing.** A fund whose reports print no table still has the
 * window reconciliation, which is why both live here. What this adds is a
 * sharper answer where the document supports one.
 */
export function depositsByMonth(input: {
  readonly deposits: readonly FundDeposit[]
  readonly contributions: readonly ExpectedContribution[]
  readonly currency: CurrencyCode
  readonly tolerance?: DepositTolerance
}): readonly MonthlyDeposit[] {
  const tolerance = input.tolerance ?? {
    basisPoints: DEFAULT_DEPOSIT_TOLERANCE_BASIS_POINTS,
    floorMinor: DEFAULT_DEPOSIT_TOLERANCE_FLOOR_MINOR,
  }

  const received = new Map<string, FundDeposit[]>()
  for (const deposit of distinctDeposits(input.deposits)) {
    // A deposit with no readable month counts towards the fund and towards no
    // month. Silently dropping it would make the months add up to less than the
    // fund received and nothing would say why.
    if (deposit.salaryMonth === undefined) continue
    const key = toYearMonthString(deposit.salaryMonth)
    const found = received.get(key)
    if (found === undefined) received.set(key, [deposit])
    else found.push(deposit)
  }

  const expected = new Map<string, ExpectedContribution[]>()
  for (const contribution of input.contributions) {
    const key = toYearMonthString(contribution.period)
    const found = expected.get(key)
    if (found === undefined) expected.set(key, [contribution])
    else found.push(contribution)
  }

  const months = [...new Set([...received.keys(), ...expected.keys()])].sort()

  const rows: MonthlyDeposit[] = []
  for (const key of months) {
    const period = parseYearMonth(key)
    if (period === undefined) continue

    const slips = expected.get(key) ?? []
    const paid = received.get(key) ?? []

    const promised =
      slips.length === 0 ? undefined : sum(slips.map((one) => one.total), input.currency)
    const arrived =
      paid.length === 0
        ? undefined
        : sum(paid.map((one) => fundDepositTotal(one, input.currency)), input.currency)

    const dates = paid
      .map((one) => one.depositDate)
      .filter((date): date is LocalDate => date !== undefined)
    const arrivedOn = dates.reduce<LocalDate | undefined>(
      (latest, date) => (latest === undefined || compareDates(date, latest) > 0 ? date : latest),
      undefined,
    )

    // The bases, on the rule the doc comment states: every contributing row has
    // to print one, or there is nothing honest to compare.
    const fundSalary = totalOf(
      paid.map((one) => one.salary),
      input.currency,
    )
    const slipSalary = totalOf(
      slips.map((one) => one.salaryBasis),
      input.currency,
    )

    const missingParts = partsMissing(slips, paid)
    const status = monthStatus(promised, arrived, tolerance)

    rows.push({
      period,
      expected: promised,
      received: arrived,
      gap: promised === undefined || arrived === undefined ? undefined : subtract(promised, arrived),
      status: missingParts.length > 0 && arrived !== undefined ? 'MISSING' : status,
      missingParts,
      arrivedOn,
      lagMonths:
        arrivedOn === undefined ? undefined : monthsBetween(period, yearMonthOf(arrivedOn)),
      employerNames: [
        ...new Set(
          paid
            .map((one) => one.employerName)
            .filter((name): name is string => name !== undefined && name !== ''),
        ),
      ],
      fundSalary,
      slipSalary,
      salaryGap:
        fundSalary === undefined || slipSalary === undefined
          ? undefined
          : subtract(slipSalary, fundSalary),
      salaryStatus: salaryStatus(slipSalary, fundSalary),
    })
  }

  return rows
}

/**
 * The sum, or nothing at all if any part of it is missing.
 *
 * The difference from `fundDepositTotal`, which treats an absent component as
 * zero: there, the components are three *parts* of a payment and a missing one
 * genuinely contributes nothing. Here the value is a **base**, and a month whose
 * second employer printed no salary column would otherwise report the first
 * employer's base as the month's — which reads as an under-report and is a
 * transcription gap.
 */
function totalOf(
  parts: readonly (Money | undefined)[],
  currency: CurrencyCode,
): Money | undefined {
  if (parts.length === 0 || parts.some((part) => part === undefined)) return undefined
  return sum(
    parts.filter((part): part is Money => part !== undefined),
    currency,
  )
}

/**
 * How far the two bases may sit apart and still be the same figure: one whole
 * unit of the currency.
 *
 * **Rounding, not tolerance.** A real Israeli pension report rounds to the
 * shekel (D-152) and a payslip prints agorot, so the same salary is printed two
 * ways by two documents that agree completely. Anything wider than that would
 * start hiding the case this exists to find, which is a fund quietly computing
 * on a base the employer never printed.
 */
const SALARY_ROUNDING_MINOR = 100

function salaryStatus(
  slip: Money | undefined,
  fund: Money | undefined,
): MonthlyDeposit['salaryStatus'] {
  if (slip === undefined || fund === undefined) return 'UNKNOWN'
  return Math.abs(subtract(slip, fund).minor) <= SALARY_ROUNDING_MINOR ? 'AGREES' : 'DIFFERS'
}

/**
 * The parts the slips put in for a month that the fund's rows show none of.
 * Only where the rows print parts: a table that prints a total alone has said
 * nothing about who paid it.
 */
function partsMissing(slips: readonly ExpectedContribution[], paid: readonly FundDeposit[]): readonly DepositPart[] {
  const printsParts = paid.some((one) => one.employee !== undefined || one.employer !== undefined || one.severance !== undefined)
  if (slips.length === 0 || !printsParts) return []
  const parts: readonly DepositPart[] = ['employee', 'employer', 'severance']
  return parts.filter((part) => {
    const promised = slips.reduce((total, one) => total + one[part].minor, 0)
    const arrived = paid.reduce((total, one) => total + (one[part]?.minor ?? 0), 0)
    return promised > 0 && arrived === 0
  })
}

function monthStatus(
  expected: Money | undefined,
  received: Money | undefined,
  tolerance: DepositTolerance,
): MonthlyDeposit['status'] {
  if (expected === undefined) return 'NO_PAYSLIP'
  if (received === undefined) return 'NOT_REPORTED'

  const gap = subtract(expected, received)
  const band = Math.max(
    applyBasisPoints(Math.abs(expected.minor), tolerance.basisPoints),
    tolerance.floorMinor,
  )
  if (Math.abs(gap.minor) <= band) return 'MATCHED'
  return gap.minor > 0 ? 'MISSING' : 'EXCEEDS'
}

// --- Deposit reconciliation -------------------------------------------------

/**
 * How many months after a salary month its contribution reaches the fund.
 *
 * One, because that is what employers do: the deduction appears on the January
 * slip and the money lands in February. Configurable because some pay on time
 * and some do not, and the whole value of this check is that it stays quiet
 * until something is genuinely wrong (docs/f13).
 */
export const DEFAULT_DEPOSIT_LAG_MONTHS = 1

/**
 * How far the fund's figure may sit from the payslips' before it is a gap: 2% of
 * what was expected, or a floor, whichever is larger.
 *
 * The floor exists because a percentage of a small window is a rounding error —
 * two months of contributions on a modest salary make 2% about ₪70, and the
 * floor keeps a ₪25 discrepancy from being a headline. Both are overridable, and
 * both are stated in the result so the screen can explain why it said nothing.
 */
export const DEFAULT_DEPOSIT_TOLERANCE_BASIS_POINTS = 200
export const DEFAULT_DEPOSIT_TOLERANCE_FLOOR_MINOR = 2_500

export interface DepositTolerance {
  readonly basisPoints: number
  readonly floorMinor: number
}

/**
 * Which stretch of time was compared, in both calendars.
 *
 * Two ranges rather than one, and both are shown: the months the fund's figures
 * cover, and the salary months those were compared against. The second is the
 * first shifted back by the lag, and a user looking at a gap has to be able to
 * see exactly which slips were counted before they believe the number.
 */
export interface ReconciliationWindow {
  readonly openingSnapshotId: string
  readonly closingSnapshotId: string
  readonly from: LocalDate
  readonly to: LocalDate
  readonly depositFrom: YearMonth
  readonly depositTo: YearMonth
  readonly salaryFrom: YearMonth
  readonly salaryTo: YearMonth
  readonly lagMonths: number
  /** How many snapshots the reported total is the sum of. */
  readonly snapshotCount: number
}

export type DepositStatus =
  | 'WITHIN_TOLERANCE'
  | 'DEPOSITS_MISSING'
  | 'DEPOSITS_EXCEED_PAYSLIPS'
  | 'ACKNOWLEDGED'

/**
 * The answer to "did my employer actually deposit", which is the highest-value
 * thing this feature does.
 *
 * A union rather than a record of optional numbers, because the four ways of
 * having no answer are four different sentences on screen and none of them is a
 * zero: no second snapshot, no reported deposits, two readings inside one month,
 * and no payslips covering the period.
 */
export type DepositReconciliation =
  | { readonly kind: 'NEEDS_TWO_POINTS'; readonly snapshotCount: number }
  | { readonly kind: 'NO_FUND_REPORT'; readonly snapshotCount: number }
  | { readonly kind: 'WINDOW_TOO_SHORT'; readonly from: LocalDate; readonly to: LocalDate }
  | {
      readonly kind: 'NO_PAYSLIP_DATA'
      readonly window: ReconciliationWindow
      readonly reported: Money
    }
  | {
      readonly kind: 'CHECKED'
      readonly status: DepositStatus
      readonly window: ReconciliationWindow
      readonly expected: ContributionTotal
      /** What the fund says it received over the window. */
      readonly reported: Money
      /** Expected minus reported. **Positive means money is missing.** */
      readonly gap: Money
      /** The band `gap` was judged against, as an amount, so the screen can say it. */
      readonly tolerance: Money
    }

export interface DepositReconciliationInput {
  readonly status: FundStatus
  /** Every snapshot of one fund, in any order. */
  readonly snapshots: readonly FundBalanceSnapshot[]
  /** Every expected contribution to that fund, in any order. */
  readonly contributions: readonly ExpectedContribution[]
  readonly currency: CurrencyCode
  readonly lagMonths?: number
  readonly tolerance?: DepositTolerance
}

/**
 * The months a window covers, counted whole.
 *
 * A snapshot dated mid-month loses the part-month at the start, which is the
 * price of comparing a monthly payroll against a quarterly report. It is not
 * hidden: the months counted come back in the window and the screen prints them,
 * so a user who spots a missing January can see that January was never in it.
 */
function depositMonths(
  from: LocalDate,
  to: LocalDate,
): { readonly from: YearMonth; readonly to: YearMonth } | undefined {
  const first = addMonths(yearMonthOf(from), 1)
  const last = yearMonthOf(to)
  return compareYearMonths(first, last) > 0 ? undefined : { from: first, to: last }
}

/**
 * Compare what the payslips promised against what the fund says it received.
 *
 * **Cumulative over the longest run the fund reported**, not month by month:
 * docs/f13 asks for exactly this, because a one-month lag makes every single
 * month look wrong while the running total stays right. The run is the trailing
 * one — every snapshot from the most recent backwards for as long as each states
 * `depositsSincePrevious` — so the freshest continuous stretch of evidence is
 * what gets judged.
 *
 * **A fund that takes no deposits is not missing them.** A dormant or closed
 * fund with no payslips and nothing reported reconciles, rather than being
 * reported as having no payslip data forever.
 */
export function reconcileDeposits(input: DepositReconciliationInput): DepositReconciliation {
  const snapshots = sortSnapshots(input.snapshots)
  if (snapshots.length < 2) {
    return { kind: 'NEEDS_TWO_POINTS', snapshotCount: snapshots.length }
  }

  const closing = snapshots[snapshots.length - 1]
  if (closing === undefined || closing.depositsSincePrevious === undefined) {
    return { kind: 'NO_FUND_REPORT', snapshotCount: snapshots.length }
  }

  // Walk back while each snapshot still states what it received. The one where
  // the chain stops is the opening balance of the window, and its own figure
  // belongs to the window before this one.
  let openingIndex = snapshots.length - 2
  while (openingIndex > 0 && snapshots[openingIndex]?.depositsSincePrevious !== undefined) {
    openingIndex -= 1
  }

  const opening = snapshots[openingIndex]
  if (opening === undefined) return { kind: 'NO_FUND_REPORT', snapshotCount: snapshots.length }

  const months = depositMonths(opening.asOfDate, closing.asOfDate)
  if (months === undefined) {
    return { kind: 'WINDOW_TOO_SHORT', from: opening.asOfDate, to: closing.asOfDate }
  }

  const counted = snapshots.slice(openingIndex + 1)
  const reported = sum(
    counted.map((snapshot) => snapshot.depositsSincePrevious ?? money(0, input.currency)),
    input.currency,
  )

  const lagMonths = input.lagMonths ?? DEFAULT_DEPOSIT_LAG_MONTHS
  const window: ReconciliationWindow = {
    openingSnapshotId: opening.id,
    closingSnapshotId: closing.id,
    from: opening.asOfDate,
    to: closing.asOfDate,
    depositFrom: months.from,
    depositTo: months.to,
    salaryFrom: addMonths(months.from, -lagMonths),
    salaryTo: addMonths(months.to, -lagMonths),
    lagMonths,
    snapshotCount: counted.length,
  }

  const expected = contributionsBetween(
    input.contributions,
    window.salaryFrom,
    window.salaryTo,
    input.currency,
  )

  if (expected.paycheckCount === 0) {
    const takesDeposits = input.status === 'ACTIVE'
    if (takesDeposits || reported.minor !== 0) {
      return { kind: 'NO_PAYSLIP_DATA', window, reported }
    }
  }

  const tolerance = input.tolerance ?? {
    basisPoints: DEFAULT_DEPOSIT_TOLERANCE_BASIS_POINTS,
    floorMinor: DEFAULT_DEPOSIT_TOLERANCE_FLOOR_MINOR,
  }
  const band = Math.max(
    tolerance.floorMinor,
    Math.abs(applyBasisPoints(expected.total.minor, tolerance.basisPoints)),
  )

  const gap = subtract(expected.total, reported)
  const status: DepositStatus =
    Math.abs(gap.minor) <= band
      ? 'WITHIN_TOLERANCE'
      : closing.depositGapAcknowledged
        ? 'ACKNOWLEDGED'
        : gap.minor > 0
          ? 'DEPOSITS_MISSING'
          : 'DEPOSITS_EXCEED_PAYSLIPS'

  return {
    kind: 'CHECKED',
    status,
    window,
    expected,
    reported,
    gap,
    tolerance: money(band, input.currency),
  }
}

/**
 * One window between two readings, with what the payslips promised and what the
 * fund says arrived — docs/f13's expected-versus-actual table, by period.
 *
 * The companion to `reconcileDeposits` rather than a replacement for it. That
 * one answers "is anything missing" over the longest run the fund reported,
 * cumulatively, because that is the only comparison a one-month lag does not
 * make noise of. This one shows the working: which windows the totals are made
 * of, so a user who does not believe the headline can see where it came from.
 *
 * **Read it as evidence, not as a verdict.** A single window is exactly the
 * month-by-month comparison the lag makes unreliable, and any row here can be
 * out by a month's contribution without anything being wrong.
 */
export interface DepositPeriod {
  readonly openingSnapshotId: string
  readonly closingSnapshotId: string
  readonly from: LocalDate
  readonly to: LocalDate
  /** The salary months compared, already shifted back by the lag. */
  readonly salaryFrom: YearMonth | undefined
  readonly salaryTo: YearMonth | undefined
  /** What the payslips say. Absent when the window spans no whole month. */
  readonly expected: ContributionTotal | undefined
  /** What the fund says it received. Absent when the report did not state it. */
  readonly reported: Money | undefined
  /** Expected minus reported, when both are known. Positive means missing. */
  readonly gap: Money | undefined
}

export function depositPeriods(input: DepositReconciliationInput): readonly DepositPeriod[] {
  const snapshots = sortSnapshots(input.snapshots)
  const lagMonths = input.lagMonths ?? DEFAULT_DEPOSIT_LAG_MONTHS
  const periods: DepositPeriod[] = []

  for (let index = 1; index < snapshots.length; index += 1) {
    const opening = snapshots[index - 1]
    const closing = snapshots[index]
    if (opening === undefined || closing === undefined) continue

    const months = depositMonths(opening.asOfDate, closing.asOfDate)
    const salaryFrom = months === undefined ? undefined : addMonths(months.from, -lagMonths)
    const salaryTo = months === undefined ? undefined : addMonths(months.to, -lagMonths)
    const expected =
      salaryFrom === undefined || salaryTo === undefined
        ? undefined
        : contributionsBetween(input.contributions, salaryFrom, salaryTo, input.currency)
    const reported = closing.depositsSincePrevious

    periods.push({
      openingSnapshotId: opening.id,
      closingSnapshotId: closing.id,
      from: opening.asOfDate,
      to: closing.asOfDate,
      salaryFrom,
      salaryTo,
      expected,
      reported,
      gap:
        expected === undefined || reported === undefined
          ? undefined
          : subtract(expected.total, reported),
    })
  }

  return periods
}

// --- Returns ----------------------------------------------------------------

/**
 * Where the contributions figure in a return calculation came from.
 *
 * The whole of F13's third acceptance criterion is that this parameter exists.
 * A balance that went from ₪100,000 to ₪118,000 while ₪18,000 was paid in earned
 * nothing, and the only way to be sure a screen never claims otherwise is to
 * make the contributions impossible to omit.
 *
 * - `FUND_REPORTED` is `depositsSincePrevious` — what actually entered the
 *   account over exactly the window the balances bracket. It wins when present.
 * - `PAYSLIP_DERIVED` is the fallback, lag-shifted, and is an estimate: the
 *   payslips say what was deducted, not what arrived.
 * - `NONE_EXPECTED` is a fact, not a guess — a dormant or closed fund takes no
 *   deposits, so zero is the right number and a return can be computed.
 * - `UNKNOWN` produces **no figure at all**. Not a zero, not a balance delta.
 */
export type ContributionBasis =
  | { readonly kind: 'FUND_REPORTED'; readonly amount: Money }
  | { readonly kind: 'PAYSLIP_DERIVED'; readonly amount: Money }
  | { readonly kind: 'NONE_EXPECTED' }
  | { readonly kind: 'UNKNOWN' }

export type ContributionBasisKind = ContributionBasis['kind']

/** The basis for one window, choosing the fund's own figure over the payslips'. */
export function contributionBasisFor(
  reported: Money | undefined,
  fromPayslips: ContributionTotal | undefined,
  status: FundStatus,
): ContributionBasis {
  if (reported !== undefined) return { kind: 'FUND_REPORTED', amount: reported }
  if (fromPayslips !== undefined && fromPayslips.paycheckCount > 0) {
    return { kind: 'PAYSLIP_DERIVED', amount: fromPayslips.total }
  }
  if (status !== 'ACTIVE') return { kind: 'NONE_EXPECTED' }
  return { kind: 'UNKNOWN' }
}

/**
 * One window's return, or the honest admission that it cannot be computed.
 *
 * `gain` is **net of fees**, because that is what the balance shows: the fund
 * takes its management fee out of the same pot. `gainBeforeFees` is there when
 * the report states what was charged, and the difference between the two is the
 * fee panel's entire argument.
 *
 * `basisPoints` is Modified Dietz with contributions assumed to arrive evenly —
 * `gain ÷ (opening balance + half the contributions)`. docs/f13 calls this an
 * approximation and requires it be labelled one, which is why the variant is
 * named `APPROXIMATE` rather than `RETURN`.
 */
export type PeriodReturn =
  | {
      readonly kind: 'CONTRIBUTIONS_UNKNOWN'
      readonly from: LocalDate
      readonly to: LocalDate
    }
  | {
      readonly kind: 'APPROXIMATE'
      readonly from: LocalDate
      readonly to: LocalDate
      readonly openingBalance: Money
      readonly closingBalance: Money
      readonly contributions: Money
      readonly basis: ContributionBasisKind
      readonly gain: Money
      readonly feesCharged: Money | undefined
      readonly gainBeforeFees: Money | undefined
      readonly basisPoints: number | undefined
    }

/**
 * The return between two snapshots, given what was paid in between them.
 *
 * There is no overload that takes only two balances. That is the point: the
 * subtraction a caller would otherwise do is wrong by exactly the contributions,
 * and it is wrong in the flattering direction.
 */
export function periodReturn(
  opening: FundBalanceSnapshot,
  closing: FundBalanceSnapshot,
  basis: ContributionBasis,
): PeriodReturn {
  if (basis.kind === 'UNKNOWN') {
    return { kind: 'CONTRIBUTIONS_UNKNOWN', from: opening.asOfDate, to: closing.asOfDate }
  }

  const currency = closing.totalBalance.currency
  const contributions = basis.kind === 'NONE_EXPECTED' ? money(0, currency) : basis.amount
  const gain = subtract(subtract(closing.totalBalance, opening.totalBalance), contributions)
  const fees = closing.feesChargedSincePrevious

  return {
    kind: 'APPROXIMATE',
    from: opening.asOfDate,
    to: closing.asOfDate,
    openingBalance: opening.totalBalance,
    closingBalance: closing.totalBalance,
    contributions,
    basis: basis.kind,
    gain,
    feesCharged: fees,
    gainBeforeFees: fees === undefined ? undefined : add(gain, fees),
    basisPoints: ratioOfBasisPoints(
      gain.minor,
      opening.totalBalance.minor + Math.trunc(contributions.minor / 2),
    ),
  }
}

export interface CumulativeReturn {
  readonly gain: Money
  readonly contributions: Money
  readonly basisPoints: number | undefined
}

/**
 * Every window of a fund's history, and the whole span when every window is
 * computable.
 *
 * `cumulative` is absent the moment one window's contributions are unknown,
 * rather than being a sum over the windows that happened to work — a total
 * quietly computed over a different set than the chart beside it shows is the
 * worse kind of wrong (the argument `averageNet` makes about sample size).
 */
export type FundReturns =
  | { readonly kind: 'NEEDS_TWO_POINTS'; readonly snapshotCount: number }
  | {
      readonly kind: 'SERIES'
      readonly periods: readonly PeriodReturn[]
      readonly cumulative: CumulativeReturn | undefined
      readonly unknownPeriods: number
    }

export interface FundReturnsInput {
  readonly status: FundStatus
  readonly snapshots: readonly FundBalanceSnapshot[]
  readonly contributions: readonly ExpectedContribution[]
  readonly currency: CurrencyCode
  readonly lagMonths?: number
}

/**
 * The balance-over-time chart's data, with contributions and returns separated —
 * which is the only way that chart is worth drawing.
 *
 * The fund's own `depositsSincePrevious` needs **no lag**: it states what
 * arrived inside exactly the window the two balances bracket. The lag applies
 * only to the payslip fallback, where the app is guessing which slips the money
 * came from.
 */
export function fundReturns(input: FundReturnsInput): FundReturns {
  const snapshots = sortSnapshots(input.snapshots)
  if (snapshots.length < 2) {
    return { kind: 'NEEDS_TWO_POINTS', snapshotCount: snapshots.length }
  }

  const lagMonths = input.lagMonths ?? DEFAULT_DEPOSIT_LAG_MONTHS
  const periods: PeriodReturn[] = []

  for (let index = 1; index < snapshots.length; index += 1) {
    const opening = snapshots[index - 1]
    const closing = snapshots[index]
    if (opening === undefined || closing === undefined) continue

    const months = depositMonths(opening.asOfDate, closing.asOfDate)
    const fromPayslips =
      months === undefined
        ? undefined
        : contributionsBetween(
            input.contributions,
            addMonths(months.from, -lagMonths),
            addMonths(months.to, -lagMonths),
            input.currency,
          )

    periods.push(
      periodReturn(
        opening,
        closing,
        contributionBasisFor(closing.depositsSincePrevious, fromPayslips, input.status),
      ),
    )
  }

  const unknownPeriods = periods.filter((period) => period.kind === 'CONTRIBUTIONS_UNKNOWN').length
  const first = snapshots[0]

  if (unknownPeriods > 0 || first === undefined) {
    return { kind: 'SERIES', periods, cumulative: undefined, unknownPeriods }
  }

  const known = periods.filter(
    (period): period is Extract<PeriodReturn, { kind: 'APPROXIMATE' }> =>
      period.kind === 'APPROXIMATE',
  )
  const gain = sum(known.map((period) => period.gain), input.currency)
  const contributions = sum(known.map((period) => period.contributions), input.currency)

  return {
    kind: 'SERIES',
    periods,
    cumulative: {
      gain,
      contributions,
      basisPoints: ratioOfBasisPoints(
        gain.minor,
        first.totalBalance.minor + Math.trunc(contributions.minor / 2),
      ),
    },
    unknownPeriods,
  }
}

// --- Fees -------------------------------------------------------------------

/**
 * What the fee actually cost, against what the fund says it charges.
 *
 * The four ways of not knowing are separate variants because they are separate
 * sentences: no second snapshot, a report that omitted the fee line, two
 * readings inside one month (annualizing which would multiply a rounding error
 * by twelve), and a fund with no balance to charge a fee on.
 */
export type EffectiveFee =
  | { readonly kind: 'NEEDS_TWO_POINTS'; readonly snapshotCount: number }
  | { readonly kind: 'NOT_REPORTED' }
  | { readonly kind: 'WINDOW_TOO_SHORT' }
  | { readonly kind: 'NO_BALANCE' }
  | {
      readonly kind: 'MEASURED'
      readonly annualBasisPoints: number
      readonly feesCharged: Money
      readonly averageBalance: Money
      readonly months: number
      readonly statedBasisPoints: number | undefined
      /** Measured minus stated. Positive means the fee is higher than claimed. */
      readonly differenceBasisPoints: number | undefined
    }

/**
 * `fees charged ÷ average balance`, annualized — the number that catches a fee
 * agreement that quietly expired.
 *
 * Measured over the **most recent** window, because that is the fee being paid
 * now. The average balance is the mean of the two endpoints, which is all a
 * snapshot series can offer and is honest at this granularity.
 */
export function effectiveFee(
  snapshots: readonly FundBalanceSnapshot[],
  statedBasisPoints: number | undefined,
): EffectiveFee {
  const sorted = sortSnapshots(snapshots)
  if (sorted.length < 2) return { kind: 'NEEDS_TWO_POINTS', snapshotCount: sorted.length }

  const opening = sorted[sorted.length - 2]
  const closing = sorted[sorted.length - 1]
  if (opening === undefined || closing === undefined) {
    return { kind: 'NEEDS_TWO_POINTS', snapshotCount: sorted.length }
  }

  const fees = closing.feesChargedSincePrevious
  if (fees === undefined) return { kind: 'NOT_REPORTED' }

  const months = monthsBetween(yearMonthOf(opening.asOfDate), yearMonthOf(closing.asOfDate))
  if (months < 1) return { kind: 'WINDOW_TOO_SHORT' }

  const endpoints = opening.totalBalance.minor + closing.totalBalance.minor
  // × 12 to annualize and × 2 to take the mean of the endpoints, both folded
  // into one ratio so the division happens once, at the end, in integers.
  const annualBasisPoints = ratioOfBasisPoints(fees.minor * 24, endpoints * months)
  if (annualBasisPoints === undefined) return { kind: 'NO_BALANCE' }

  return {
    kind: 'MEASURED',
    annualBasisPoints,
    feesCharged: fees,
    averageBalance: money(Math.round(endpoints / 2), closing.totalBalance.currency),
    months,
    statedBasisPoints,
    differenceBasisPoints:
      statedBasisPoints === undefined ? undefined : annualBasisPoints - statedBasisPoints,
  }
}

/**
 * How far the measured fee may sit from the stated one before it means
 * anything: 0.1% a year.
 *
 * A fee measured over one quarter and annualized carries the rounding of a
 * three-month figure — ₪130 against ₪101,450 comes out at 0.51% where the
 * policy says 0.50%, and calling that a discrepancy is the same crying-wolf
 * failure the deposit tolerance exists to prevent. What this threshold is for is
 * the real case: an agreement that lapsed and reverted to a default, which moves
 * the fee by tenths of a percent, not hundredths.
 */
export const FEE_DISCREPANCY_BASIS_POINTS = 10

/** Whether a measured fee is far enough from the stated one to be worth saying. */
export function feeDiffersMaterially(fee: EffectiveFee): boolean {
  return (
    fee.kind === 'MEASURED' &&
    fee.differenceBasisPoints !== undefined &&
    fee.differenceBasisPoints >= FEE_DISCREPANCY_BASIS_POINTS
  )
}

export type FeeStanding = 'NOT_STATED' | 'ABOVE_CAP' | 'ABOVE_TYPICAL' | 'AT_OR_BELOW_TYPICAL'

export interface FeeComparison {
  readonly basisPoints: number | undefined
  readonly capBasisPoints: number
  readonly typicalBasisPoints: number
  readonly standing: FeeStanding
}

export interface FeeBenchmark {
  readonly onAccumulation: FeeComparison | undefined
  readonly onDeposit: FeeComparison | undefined
  /** The reference row used, so the screen can print its date and source. */
  readonly reference: FeeReference | undefined
}

function compareAgainst(
  basisPoints: number | undefined,
  capBasisPoints: number,
  typicalBasisPoints: number,
): FeeComparison {
  const standing: FeeStanding =
    basisPoints === undefined
      ? 'NOT_STATED'
      : basisPoints > capBasisPoints
        ? 'ABOVE_CAP'
        : basisPoints > typicalBasisPoints
          ? 'ABOVE_TYPICAL'
          : 'AT_OR_BELOW_TYPICAL'
  return { basisPoints, capBasisPoints, typicalBasisPoints, standing }
}

/**
 * Where this fund's fees sit against the cap and against what is normally
 * negotiated.
 *
 * The references are **given**, never looked up (D-066): they ship with the app
 * and the document may disagree, and a domain function that reached for a table
 * would silently outrank the user's own numbers. `ABOVE_CAP` is a real outcome
 * rather than a bug — a fee recorded above the cap usually means the fund is
 * charging an old policy's rate, or that the figure was transcribed wrong, and
 * both are worth a look.
 */
export function feeBenchmark(
  fund: FundAccount,
  references: readonly FeeReference[],
): FeeBenchmark {
  const reference = references.find((one) => one.fundType === fund.fundType)
  if (reference === undefined) {
    return { onAccumulation: undefined, onDeposit: undefined, reference: undefined }
  }

  return {
    onAccumulation: compareAgainst(
      fund.fees.onAccumulationBasisPoints,
      reference.capOnAccumulationBasisPoints,
      reference.typicalOnAccumulationBasisPoints,
    ),
    onDeposit: compareAgainst(
      fund.fees.onDepositBasisPoints,
      reference.capOnDepositBasisPoints,
      reference.typicalOnDepositBasisPoints,
    ),
    reference,
  }
}

/**
 * What a balance costs in management fees over a year at a stated fee.
 *
 * The dormant-fund number: a ₪40,000 balance from a job three years ago is still
 * paying this every year, and nobody has ever seen it written down.
 */
export function annualFeeCost(balance: Money, fees: FundFees): Money | undefined {
  const rate = fees.onAccumulationBasisPoints
  if (rate === undefined) return undefined
  return money(applyBasisPoints(balance.minor, rate), balance.currency)
}

/**
 * The three assumed gross returns the fee illustration is drawn across, in
 * basis points: 3%, 5%, 7%.
 *
 * A range rather than a number, because any single assumed rate is a guess and
 * presenting one is a forecast the app has no business making (docs/f13's open
 * question). Exported so the screen's sliders start here and so a caller can
 * pass its own.
 */
export const DEFAULT_GROSS_RETURN_SCENARIOS: readonly number[] = [300, 500, 700]

/**
 * A fund's two fees in the shape a projection takes them.
 *
 * `projectBalance` moved to `@/domain/projection.ts` on its second caller and
 * takes plain basis points, because a savings account's charges occupy the same
 * two slots without being a pension's (D-072). This is the translation, in one
 * place, so nothing can put the deposit fee in the balance slot.
 */
function asProjectionFees(fees: FundFees): {
  readonly feeOnBalanceBasisPoints: number | undefined
  readonly feeOnContributionBasisPoints: number | undefined
} {
  return {
    feeOnBalanceBasisPoints: fees.onAccumulationBasisPoints,
    feeOnContributionBasisPoints: fees.onDepositBasisPoints,
  }
}

export interface FeeDragScenario {
  readonly grossReturnBasisPoints: number
  readonly atCurrentFees: Money
  readonly atTargetFees: Money
  /** What the fee difference costs over the whole projection. Never negative by design. */
  readonly difference: Money
  /**
   * **What the balance at today's fees is made of**, and the three parts are an
   * identity rather than three separate estimates:
   * `paidIn + grossGrowth − feesTaken === atCurrentFees`, exactly, in minor
   * units (D-082).
   *
   * `feesTaken` is measured against the **same projection with the fees set to
   * zero**, not inferred from the fee rate. A fee on the balance is charged on
   * money that would itself have compounded, so the amount it costs over forty
   * years is several times the amount it was charged — which is the entire
   * argument this screen exists to make, and subtracting rates would understate
   * it silently.
   */
  readonly paidIn: Money
  /** What the money earned before any fee came off. */
  readonly grossGrowth: Money
  /** The compounded cost of today's fees, not the sum of the fees charged. */
  readonly feesTaken: Money
}

/**
 * The projection, with its assumptions attached.
 *
 * Every input comes back out. docs/f13 requires the assumptions to be on screen
 * and to visibly change the answer, and a result that carried only numbers would
 * make that the screen's problem to remember.
 */
export interface FeeDragIllustration {
  readonly years: number
  readonly openingBalance: Money
  readonly annualContribution: Money
  readonly currentFees: FundFees
  readonly targetFees: FundFees
  readonly scenarios: readonly FeeDragScenario[]
}

export interface FeeDragInput {
  readonly openingBalance: Money
  readonly annualContribution: Money
  readonly years: number
  readonly currentFees: FundFees
  readonly targetFees: FundFees
  readonly grossReturnBasisPoints?: readonly number[]
}

export function feeDragIllustration(input: FeeDragInput): FeeDragIllustration {
  const returns = input.grossReturnBasisPoints ?? DEFAULT_GROSS_RETURN_SCENARIOS

  return {
    years: input.years,
    openingBalance: input.openingBalance,
    annualContribution: input.annualContribution,
    currentFees: input.currentFees,
    targetFees: input.targetFees,
    scenarios: returns.map((grossReturnBasisPoints) => {
      const shared = {
        openingBalance: input.openingBalance,
        annualContribution: input.annualContribution,
        years: input.years,
        grossReturnBasisPoints,
      }
      const atCurrentFees = projectBalance({ ...shared, ...asProjectionFees(input.currentFees) })
      const atTargetFees = projectBalance({ ...shared, ...asProjectionFees(input.targetFees) })

      // The same projection with no fees at all. Not a scenario the user is
      // offered — a fund with no management fee does not exist — but the only
      // honest measure of what the fee costs, since the charge compounds away
      // with the money it was taken from.
      const beforeFees = projectBalance(shared)
      const paidIn = money(
        input.openingBalance.minor +
          input.annualContribution.minor * Math.max(0, Math.trunc(input.years)),
        input.openingBalance.currency,
      )

      return {
        grossReturnBasisPoints,
        atCurrentFees,
        atTargetFees,
        difference: subtract(atTargetFees, atCurrentFees),
        paidIn,
        grossGrowth: subtract(beforeFees, paidIn),
        feesTaken: subtract(beforeFees, atCurrentFees),
      }
    }),
  }
}

export type FeeAgreementStatus =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'ACTIVE'; readonly until: LocalDate }
  | { readonly kind: 'EXPIRING_SOON'; readonly until: LocalDate }
  | { readonly kind: 'LAPSED'; readonly since: LocalDate }

/** How many months of warning a fee agreement's expiry gets. */
export const FEE_EXPIRY_WARNING_MONTHS = 3

/**
 * Whether the negotiated fee is still negotiated.
 *
 * Reverting to the default fee when an agreement expires is silent, common, and
 * expensive, so the date is worth more than it costs (docs/f13). `asOf` is a
 * parameter because the domain has no clock (docs/03).
 */
export function feeAgreementStatus(fund: FundAccount, asOf: LocalDate): FeeAgreementStatus {
  const until = fund.feeNegotiatedUntil
  if (until === undefined) return { kind: 'NONE' }
  if (compareDates(until, asOf) < 0) return { kind: 'LAPSED', since: until }

  const warnFrom = addMonths(yearMonthOf(asOf), FEE_EXPIRY_WARNING_MONTHS)
  return compareYearMonths(yearMonthOf(until), warnFrom) <= 0
    ? { kind: 'EXPIRING_SOON', until }
    : { kind: 'ACTIVE', until }
}

// --- Components, totals and liquidity ---------------------------------------

/**
 * A balance split into the three kinds of money it is made of.
 *
 * Severance comes out separately everywhere it appears, which is D-066's answer
 * to docs/f13's open question: its withdrawal and tax treatment differ enough
 * that a single "balance" is a misleading answer to "what do I have". The
 * remainder that the stated components do not account for is named
 * `unattributed` rather than being folded into one of them.
 */
export interface ComponentSplit {
  readonly total: Money
  readonly employee: Money
  readonly employer: Money
  readonly severance: Money
  readonly unattributed: Money
  /** True when the report broke out all three. Otherwise the split is partial. */
  readonly isComplete: boolean
}

export function componentSplit(snapshot: FundBalanceSnapshot): ComponentSplit {
  const currency = snapshot.totalBalance.currency
  const nothing = money(0, currency)
  const employee = snapshot.employeeComponent ?? nothing
  const employer = snapshot.employerComponent ?? nothing
  const severance = snapshot.severanceComponent ?? nothing

  return {
    total: snapshot.totalBalance,
    employee,
    employer,
    severance,
    unattributed: money(
      snapshot.totalBalance.minor - employee.minor - employer.minor - severance.minor,
      currency,
    ),
    isComplete:
      snapshot.employeeComponent !== undefined &&
      snapshot.employerComponent !== undefined &&
      snapshot.severanceComponent !== undefined,
  }
}

/** One fund and its most recent reading, which is what every total below is of. */
export interface FundWithLatest {
  readonly fund: FundAccount
  readonly latest: FundBalanceSnapshot | undefined
}

export interface LongTermSavings {
  readonly total: Money
  readonly employee: Money
  readonly employer: Money
  readonly severance: Money
  readonly unattributed: Money
  readonly funds: number
  readonly dormant: number
  /** Funds with no snapshot at all. Their balance is not in `total` and cannot be. */
  readonly withoutSnapshot: number
  /** What the dormant funds cost in fees a year, where the fee is known. */
  readonly dormantAnnualFees: Money
}

/**
 * Total long-term savings, split by component.
 *
 * Always **locked** money — F07 shows it beside liquid savings and never inside
 * them. `withoutSnapshot` is reported rather than assumed to be zero: a fund
 * nobody has entered a balance for is missing from the total, and a total that
 * did not say so would be quietly wrong by however much that fund holds.
 *
 * Archived funds are the caller's to filter; closed ones are not excluded here
 * either, because a closed fund with a balance still has that balance.
 */
export function longTermSavings(
  entries: readonly FundWithLatest[],
  currency: CurrencyCode,
): LongTermSavings {
  const splits = entries
    .map((entry) => entry.latest)
    .filter((latest): latest is FundBalanceSnapshot => latest !== undefined)
    .map(componentSplit)

  const dormantCosts = entries
    .filter((entry) => entry.fund.status === 'DORMANT' && entry.latest !== undefined)
    .map((entry) =>
      annualFeeCost(
        entry.latest?.totalBalance ?? money(0, currency),
        entry.fund.fees,
      ) ?? money(0, currency),
    )

  return {
    total: sum(splits.map((split) => split.total), currency),
    employee: sum(splits.map((split) => split.employee), currency),
    employer: sum(splits.map((split) => split.employer), currency),
    severance: sum(splits.map((split) => split.severance), currency),
    unattributed: sum(splits.map((split) => split.unattributed), currency),
    funds: entries.length,
    dormant: entries.filter((entry) => entry.fund.status === 'DORMANT').length,
    withoutSnapshot: entries.filter((entry) => entry.latest === undefined).length,
    dormantAnnualFees: sum(dormantCosts, currency),
  }
}

/**
 * How old a reading may be before the screen says so, in months.
 *
 * docs/08 lists "pension data goes stale" as a named risk — the balances here
 * are transcribed by hand, so a fund's numbers can be a year old and look
 * exactly as current as one entered this morning. The mitigation it names is a
 * prominent as-of indicator, and that indicator needs a threshold that is the
 * same on every screen rather than one each.
 *
 * Six months because that is roughly the reporting cadence: a fund that sends
 * quarterly statements has had two since. Twelve because at that point the
 * figure predates a whole year of contributions and fees.
 */
export const SNAPSHOT_STALE_MONTHS = 6
export const SNAPSHOT_VERY_STALE_MONTHS = 12

export type SnapshotFreshness = 'NONE' | 'FRESH' | 'STALE' | 'VERY_STALE'

/**
 * How much to trust the balance on screen, judged in whole months.
 *
 * `NONE` is its own answer rather than the stalest one: a fund with no reading
 * at all has no balance to be old, and the screen's job there is to ask for a
 * first one rather than to warn about the age of nothing.
 *
 * A reading dated in the future is `FRESH` — someone transcribing a report
 * dated the end of this quarter is ahead of the calendar, not wrong.
 */
export function snapshotFreshness(
  asOfDate: LocalDate | undefined,
  asOf: LocalDate,
): SnapshotFreshness {
  if (asOfDate === undefined) return 'NONE'
  const months = monthsBetween(yearMonthOf(asOfDate), yearMonthOf(asOf))
  if (months >= SNAPSHOT_VERY_STALE_MONTHS) return 'VERY_STALE'
  if (months >= SNAPSHOT_STALE_MONTHS) return 'STALE'
  return 'FRESH'
}

/** Years from the first deposit before a study fund may be withdrawn. */
export const STUDY_FUND_LIQUIDITY_YEARS = 6
/** The shorter wait, which applies at retirement age and for study purposes. */
export const STUDY_FUND_EARLY_LIQUIDITY_YEARS = 3

export interface StudyFundLiquidity {
  readonly firstDepositDate: LocalDate
  readonly liquidAt: LocalDate
  readonly earlyLiquidAt: LocalDate
}

/**
 * When a study fund becomes withdrawable — six years from the first deposit,
 * three in the circumstances the law allows.
 *
 * A small feature people genuinely want and rarely know (docs/f13). Nothing
 * without a `firstDepositDate` can answer it, and guessing from `openedDate`
 * would put a date on a screen that is wrong by however long the first deposit
 * took, so it returns nothing instead.
 */
export function studyFundLiquidity(fund: FundAccount): StudyFundLiquidity | undefined {
  if (fund.fundType !== 'STUDY_FUND') return undefined
  const first = fund.firstDepositDate
  if (first === undefined) return undefined

  return {
    firstDepositDate: first,
    liquidAt: addYears(first, STUDY_FUND_LIQUIDITY_YEARS),
    earlyLiquidAt: addYears(first, STUDY_FUND_EARLY_LIQUIDITY_YEARS),
  }
}

// --- Validation -------------------------------------------------------------

export type SnapshotProblem =
  | 'NEGATIVE_BALANCE'
  | 'COMPONENTS_DISAGREE'
  | 'MIXED_CURRENCY'
  | 'DUPLICATE_DATE'

/**
 * What makes a snapshot unenterable — docs/04's invariants, and nothing else.
 *
 * Deliberately short, in the shape of `validatePaycheck`. A **negative
 * `depositsSincePrevious` is not here**: docs/f13 records a severance withdrawal
 * as exactly that, a negative movement with a note.
 *
 * **Nor are the parts against the total** (M25 U6, D-280). That is the ledger
 * pack's `parts` identity on `holding_reading`, judged by the engine, and
 * `snapshotProblems` in the repository adds `COMPONENTS_DISAGREE` when it
 * fails — a second sum here would be a second answer to the question.
 */
export function validateSnapshot(
  snapshot: FundBalanceSnapshot,
  existing: readonly FundBalanceSnapshot[],
): readonly SnapshotProblem[] {
  const problems: SnapshotProblem[] = []
  const currency = snapshot.totalBalance.currency

  if (snapshot.totalBalance.minor < 0) problems.push('NEGATIVE_BALANCE')

  const amounts = [
    snapshot.employeeComponent,
    snapshot.employerComponent,
    snapshot.severanceComponent,
    snapshot.depositsSincePrevious,
    snapshot.feesChargedSincePrevious,
    snapshot.returnSincePrevious,
  ].filter((amount): amount is Money => amount !== undefined)

  if (amounts.some((amount) => amount.currency !== currency)) problems.push('MIXED_CURRENCY')

  if (
    existing.some(
      (other) => other.id !== snapshot.id && compareDates(other.asOfDate, snapshot.asOfDate) === 0,
    )
  ) {
    problems.push('DUPLICATE_DATE')
  }

  return [...new Set(problems)]
}
