import { useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'

import { abs, formatMoney } from '@/core/money.ts'
import { formatPercent } from '@/core/percent.ts'
import { formatMonthShort, formatYearMonth, monthsBetween, toISODate, toYearMonthString, yearMonthOf } from '@/core/time.ts'
import { DEFAULT_FEE_REFERENCES } from '@/data/reference/fundFeeReference.ts'
import {
  acknowledgeDepositGap,
  addSnapshot,
  deleteSnapshot,
  fundAnalysis,
  updateSnapshot,
} from '@/data/repositories/fundRepository.ts'
import {
  annualFeeCost,
  componentSplit,
  feeAgreementStatus,
  feeBenchmark,
  feeDiffersMaterially,
  studyFundLiquidity,
  type ContributionTotal,
  type DepositPeriod,
  type DepositReconciliation,
  type EffectiveFee,
  type MonthlyDeposit,
} from '@/domain/funds.ts'
import type { FundBalanceSnapshot } from '@/domain/model/funds.ts'
import { hideRead, useDocumentRead } from '@/state/reading.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { Chip } from '@/ui/components/Chip.tsx'
import { BalanceChart } from '@/ui/funds/BalanceChart.tsx'
import { DEPOSIT_STATUS_LABEL, FUND_TYPE_LABEL } from '@/ui/funds/labels.ts'
import { ReportIntake } from '@/ui/funds/ReportIntake.tsx'
import { blankSnapshot, SnapshotEditor } from '@/ui/funds/SnapshotEditor.tsx'
import { today } from '@/ui/today.ts'
import { useClosePane } from '@/ui/screens/ListDetail.tsx'

/**
 * One fund, in full — docs/f13's fund detail screen.
 *
 * Four things, in the order someone actually asks them: what is it worth and
 * why did it move, did the deposits arrive, what is the fee really costing, and
 * what are the readings this is all derived from.
 *
 * **Every figure comes from one `fundAnalysis` call.** The reconciliation, the
 * return series, the per-period table and the effective fee take the same three
 * inputs, and a screen assembling them itself could use the lag in one place and
 * not the next, or hand the return the wrong contributions — which is the one
 * thing D-066's signature exists to prevent (D-067).
 *
 * **The verdict is a sentence, and the table is its working.** docs/f13 asks for
 * one clear sentence about the gap; a table of windows underneath is what makes
 * that sentence checkable rather than merely believable, which is the same
 * argument the detail panel's provenance section makes about an imported row.
 */
export function FundDetail() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const closePane = useClosePane()
  const { fundId } = useParams<{ fundId: string }>()

  const [editing, setEditing] = useState<Editing | undefined>()
  /** Pressed, or asked for by a read in the store that wants showing (D-171). */
  // A report dropped on Home's Read files arrives in the navigation's state (M36 U10).
  // Read once: leaving the reader lets them go, so *Read a report* later starts empty.
  const [dropped, setDropped] = useState((useLocation().state as { files?: readonly File[] } | null)?.files)
  const [reading, setReading] = useState(dropped !== undefined && dropped.length > 0)
  const held = useDocumentRead()
  const showReader = reading || (held?.kind === 'report' && held.open)
  const [problem, setProblem] = useState<string | undefined>()

  const analysis = useMemo(
    () => (db === undefined || fundId === undefined ? undefined : fundAnalysis(db, fundId)),
    [db, revision, fundId],
  )

  if (db === undefined) {
    return <Centered>Open a document to see a fund.</Centered>
  }

  if (analysis === undefined) {
    return (
      <Centered>
        No such fund — it may have been deleted.{' '}
        <Link to="/wealth/funds" className="text-accent underline underline-offset-4 transition-colors duration-[var(--duration-micro)] hover:text-accent-hover">
          Close this pane
        </Link>
        .
      </Centered>
    )
  }

  const { fund, snapshots, reconciliation, periods, months, returns, fee, linkedTypes } =
    analysis
  const currency = snapshots[0]?.totalBalance.currency ?? 'ILS'
  const latest = snapshots[snapshots.length - 1]
  const now = today()

  const write = (work: (database: import('sql.js').Database, at: number) => void): boolean => {
    setProblem(undefined)
    try {
      mutate((database) => work(database, Date.now()))
      return true
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  /**
   * The whole report loop lives in `ReportIntake` (D-166) — the stack, the
   * confirm surface, the accept rules and the form it fills — because
   * onboarding needs the same thing and two copies of the accept rules is how
   * two surfaces come to disagree about what a report taught the document.
   *
   * What stays here is the *manual* reading: Add reading and Edit reading,
   * which are this screen's own and have no document behind them.
   */
  if (showReader) {
    return (
      <ReportIntake
        fund={fund}
        currency={currency}
        onLeave={() => {
          setReading(false)
          setDropped(undefined)
          hideRead()
        }}
        onProblem={setProblem}
        files={dropped}
      />
    )
  }

  if (editing !== undefined) {
    return (
      <SnapshotEditor
        key={editing.snapshot.id}
        initial={editing.snapshot}
        isNew={editing.isNew}
        currency={currency}
        existing={snapshots}
        fundName={fund.name}
        onSave={(snapshot) => {
          const saved = write((database, at) => {
            if (editing.isNew) {
              addSnapshot(
                database,
                {
                  fundAccountId: snapshot.fundAccountId,
                  asOfDate: snapshot.asOfDate,
                  totalBalance: snapshot.totalBalance,
                  employeeComponent: snapshot.employeeComponent,
                  employerComponent: snapshot.employerComponent,
                  severanceComponent: snapshot.severanceComponent,
                  depositsSincePrevious: snapshot.depositsSincePrevious,
                  feesChargedSincePrevious: snapshot.feesChargedSincePrevious,
                  returnSincePrevious: snapshot.returnSincePrevious,
                  note: snapshot.note,
                },
                at,
              )
            } else {
              updateSnapshot(database, snapshot.id, snapshot, at)
            }
          })
          if (saved) setEditing(undefined)
        }}
        onCancel={() => setEditing(undefined)}
      />
    )
  }

  const agreement = feeAgreementStatus(fund, now)
  const benchmark = feeBenchmark(fund, DEFAULT_FEE_REFERENCES)
  const liquidity = studyFundLiquidity(fund)
  const split = latest === undefined ? undefined : componentSplit(latest)
  const annualCost = latest === undefined ? undefined : annualFeeCost(latest.totalBalance, fund.fees)

  return (
    <div className="fc-view-enter flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline px-6 py-2">
        {/* No breadcrumb: the list it belongs to is the pane on the left
            (D-130), so a link back to it would point at what you can see. */}
        <Bidi className="text-ink">{fund.name}</Bidi>

        <Button
          variant="primary"
          size="sm"
          className="ml-auto"
          onClick={() =>
            setEditing({ isNew: true, snapshot: blankSnapshot(fund.id, now, currency) })
          }
        >
          Add reading
        </Button>

        {/* Says what it does rather than what is behind it: on a machine with no
            model this reads a report in a format the document already knows, and
            otherwise it is the way to teach it one. */}
        <Button variant="secondary" size="sm" onClick={() => setReading(true)}>
          Read a report
        </Button>
        <Button variant="ghost" size="sm" onClick={closePane}>
          Close
        </Button>
      </div>

      {problem !== undefined && (
        <div className="fc-pop-enter flex shrink-0 items-center gap-4 border-b border-hairline bg-surface px-6 py-2">
          <span className="text-negative">{problem}</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setProblem(undefined)}>
            Dismiss
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
          <Figure
            label="Balance"
            hint={latest === undefined ? 'no reading yet' : `as of ${toISODate(latest.asOfDate)}`}
          >
            <span className="text-hero tabular-nums">
              {latest === undefined ? '—' : formatMoney(latest.totalBalance)}
            </span>
          </Figure>

          {split !== undefined && split.severance.minor !== 0 && (
            <Figure label="Of which severance" hint="different withdrawal terms and tax">
              <span className="text-secondary-number text-ink-secondary tabular-nums">
                {formatMoney(split.severance)}
              </span>
            </Figure>
          )}

          <Figure
            label={FUND_TYPE_LABEL[fund.fundType]}
            hint={[fund.employerName, fund.investmentTrack, fund.policyNumber]
              .filter((value) => value !== undefined)
              .join(' · ')}
          >
            <span className="text-secondary-number text-ink-secondary">
              {fund.status === 'ACTIVE' ? 'Active' : fund.status === 'DORMANT' ? 'Dormant' : 'Closed'}
            </span>
          </Figure>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
          {agreement.kind === 'LAPSED' && (
            <Chip problem>Fee agreement ended {toISODate(agreement.since)}</Chip>
          )}
          {agreement.kind === 'EXPIRING_SOON' && (
            <Chip>Fee agreement ends {toISODate(agreement.until)}</Chip>
          )}
          {liquidity !== undefined && (
            <Chip>
              Withdrawable {toISODate(liquidity.liquidAt)} · six years from{' '}
              {toISODate(liquidity.firstDepositDate)}
            </Chip>
          )}
          {fund.beneficiaries !== undefined && <Chip>Beneficiaries: {fund.beneficiaries}</Chip>}
        </div>

        <Section title="What it is worth, and why it moved">
          {returns.kind === 'NEEDS_TWO_POINTS' ? (
            <Empty>
              {returns.snapshotCount === 0
                ? 'No readings yet. One gives you a balance.'
                : 'One reading gives a balance and nothing else. A second is what every return and fee figure is computed from.'}
            </Empty>
          ) : (
            <>
              <BalanceChart snapshots={snapshots} periods={returns.periods} />

              {returns.cumulative !== undefined && (
                <div className="mt-4 flex flex-wrap items-end gap-x-10 gap-y-4">
                  <Figure label="Paid in" hint={trackedSpan(snapshots)}>
                    <span className="text-secondary-number tabular-nums">
                      {formatMoney(returns.cumulative.contributions)}
                    </span>
                  </Figure>
                  <Figure label="Earned" hint="net of the fees the fund took out of it">
                    <span
                      className={`text-secondary-number tabular-nums ${
                        returns.cumulative.gain.minor < 0 ? 'text-negative' : ''
                      }`}
                    >
                      {formatMoney(returns.cumulative.gain)}
                    </span>
                  </Figure>
                  <Figure label="Return" hint="approximate — contributions assumed to arrive evenly">
                    <span className="text-secondary-number tabular-nums">
                      {formatPercent(returns.cumulative.basisPoints)}
                    </span>
                  </Figure>
                </div>
              )}

              {/* **What "the whole tracked history" is actually a history of**
                  (D-164). It is the readings, and a fund opened in 2016 whose
                  first reading is from March reports a return and a fee drag
                  over a window it did not live through — while looking exactly
                  like one that has been tracked for a decade. The reports that
                  would fix it exist on paper, so the sentence that says the
                  window is short is also the way into reading them. */}
              {returns.cumulative !== undefined && trackedMonths(snapshots) < SHORT_HISTORY && (
                <p className="mt-3 flex max-w-2xl flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-tertiary">
                  <span>
                    Everything above covers the {trackedMonths(snapshots)} months your readings
                    span, not the fund's life. If it is older than that, its past quarterlies say
                    what happened before you started transcribing.
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => setReading(true)}>
                    Read the old ones
                  </Button>
                </p>
              )}

              {returns.cumulative === undefined && (
                <p className="mt-3 max-w-2xl text-caption text-ink-tertiary">
                  No total for the whole history: {returns.unknownPeriods}{' '}
                  {returns.unknownPeriods === 1 ? 'period has' : 'periods have'} nothing to say what
                  was paid in, and a total over the rest would cover a different span than the chart
                  above. Record the deposits on those readings, or link a paycheck deduction type to
                  this fund.
                </p>
              )}
            </>
          )}
        </Section>

        <Section title="Did the deposits arrive">
          <Verdict reconciliation={reconciliation} fundName={fund.name} />

          {reconciliation.kind === 'CHECKED' &&
            reconciliation.status !== 'WITHIN_TOLERANCE' &&
            latest !== undefined && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    write((database, at) =>
                      acknowledgeDepositGap(
                        database,
                        reconciliation.window.closingSnapshotId,
                        reconciliation.status !== 'ACKNOWLEDGED',
                        at,
                      ),
                    )
                  }
                >
                  {reconciliation.status === 'ACKNOWLEDGED'
                    ? 'Report this gap again'
                    : 'I chased this and it is explained'}
                </Button>
                <span className="text-caption text-ink-tertiary">
                  The figures do not change — only whether the app keeps raising it.
                </span>
              </div>
            )}

          {linkedTypes.length === 0 ? (
            <p className="mt-3 max-w-2xl text-caption text-ink-tertiary">
              No paycheck deduction type feeds this fund yet, so there is nothing to compare the
              fund's own figures against. Link one on the{' '}
              <Link to="/paychecks/deductions" className="text-accent underline underline-offset-4 transition-colors duration-[var(--duration-micro)] hover:text-accent-hover">
                deduction types
              </Link>{' '}
              screen.
            </p>
          ) : (
            <p className="mt-3 text-caption text-ink-tertiary">
              Fed by {linkedTypes.map((type) => type.name).join(', ')}.
            </p>
          )}

          {months.length > 0 && <MonthTable months={months} />}
          {periods.length > 0 && <PeriodTable periods={periods} />}
        </Section>

        <Section title="What the fee costs">
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
            <Figure label="Stated" hint="what you told the app the policy says">
              <span className="text-secondary-number tabular-nums">
                {fund.fees.onAccumulationBasisPoints === undefined
                  ? '—'
                  : formatPercent(fund.fees.onAccumulationBasisPoints, { digits: 2 })}
              </span>
            </Figure>

            <Figure label="Actually paid" hint={feeHint(fee)}>
              <span
                className={`text-secondary-number tabular-nums ${
                  feeDiffersMaterially(fee) ? 'text-negative' : ''
                }`}
              >
                {fee.kind === 'MEASURED'
                  ? formatPercent(fee.annualBasisPoints, { digits: 2 })
                  : '—'}
              </span>
            </Figure>

            {annualCost !== undefined && (
              <Figure label="A year, at this balance" hint="at the stated fee">
                <span className="text-secondary-number tabular-nums">
                  {formatMoney(annualCost)}
                </span>
              </Figure>
            )}

            <Figure label="On each deposit" hint="taken before the money is invested">
              <span className="text-secondary-number tabular-nums">
                {fund.fees.onDepositBasisPoints === undefined
                  ? '—'
                  : formatPercent(fund.fees.onDepositBasisPoints, { digits: 2 })}
              </span>
            </Figure>
          </div>

          {benchmark.reference !== undefined && benchmark.onAccumulation !== undefined && (
            <p className="mt-3 max-w-2xl text-caption text-ink-tertiary">
              The ceiling for a {FUND_TYPE_LABEL[fund.fundType].toLowerCase()} is{' '}
              {formatPercent(benchmark.onAccumulation.capBasisPoints, { digits: 2 })} on the balance
              and {formatPercent(benchmark.onDeposit?.capBasisPoints, { digits: 2 })} on deposits;
              what is usually negotiated is{' '}
              {formatPercent(benchmark.onAccumulation.typicalBasisPoints, { digits: 2 })}. Those are
              the app's shipped figures as of {toISODate(benchmark.reference.asOf)} — check them
              against the regulator before acting on them.
            </p>
          )}
        </Section>

        <Section title="The readings this is derived from">
          {snapshots.length === 0 ? (
            <Empty>Nothing transcribed yet.</Empty>
          ) : (
            <table className="w-full max-w-3xl">
              <thead>
                <tr className="border-b border-hairline text-label text-ink-tertiary uppercase">
                  <th className="py-2 pr-6 text-left font-medium">As of</th>
                  <th className="py-2 pr-6 text-right font-medium">Balance</th>
                  <th className="py-2 pr-6 text-right font-medium">Deposits</th>
                  <th className="py-2 pr-6 text-right font-medium">Fees</th>
                  <th className="py-2 pr-6 text-left font-medium">Note</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {[...snapshots].reverse().map((snapshot) => (
                  <tr key={snapshot.id} className="border-b border-hairline">
                    <td className="py-1.5 pr-6 whitespace-nowrap tabular-nums">
                      {toISODate(snapshot.asOfDate)}
                    </td>
                    <td className="py-1.5 pr-6 text-right tabular-nums">
                      {formatMoney(snapshot.totalBalance)}
                    </td>
                    <td className="py-1.5 pr-6 text-right text-ink-secondary tabular-nums">
                      {snapshot.depositsSincePrevious === undefined
                        ? '—'
                        : formatMoney(snapshot.depositsSincePrevious)}
                    </td>
                    <td className="py-1.5 pr-6 text-right text-ink-secondary tabular-nums">
                      {snapshot.feesChargedSincePrevious === undefined
                        ? '—'
                        : formatMoney(snapshot.feesChargedSincePrevious)}
                    </td>
                    <td className="py-1.5 pr-6 text-caption text-ink-tertiary">
                      {snapshot.note ?? ''}
                    </td>
                    <td className="py-1.5 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing({ isNew: false, snapshot })}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => write((database, at) => deleteSnapshot(database, snapshot.id, at))}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>
    </div>
  )
}

/** A reading typed in or corrected by hand. A read one belongs to `ReportIntake`. */
interface Editing {
  readonly isNew: boolean
  readonly snapshot: FundBalanceSnapshot
}

/**
 * docs/f13's one clear sentence, and the figures it is made of.
 *
 * Every way of having no answer says which thing is missing. On this screen
 * more than anywhere, silence and "everything is fine" must not look alike.
 */
/**
 * Under two years of readings is short, and the number is a judgement rather
 * than a rule.
 *
 * It is where a cumulative return stops being a fact about the fund and starts
 * being a fact about a couple of quarters — long enough that one bad month
 * dominates it, short enough that the person reading it has almost certainly
 * been in the fund for longer.
 */
const SHORT_HISTORY = 24

function trackedMonths(snapshots: readonly FundBalanceSnapshot[]): number {
  const first = snapshots[0]
  const last = snapshots[snapshots.length - 1]
  if (first === undefined || last === undefined) return 0
  return monthsBetween(yearMonthOf(first.asOfDate), yearMonthOf(last.asOfDate))
}

/** The window the figures actually cover, printed rather than implied. */
function trackedSpan(snapshots: readonly FundBalanceSnapshot[]): string {
  const first = snapshots[0]
  const last = snapshots[snapshots.length - 1]
  if (first === undefined || last === undefined) return 'over the tracked history'
  return `${toISODate(first.asOfDate)} to ${toISODate(last.asOfDate)}`
}

function Verdict({
  reconciliation,
  fundName,
}: {
  reconciliation: DepositReconciliation
  fundName: string
}) {
  if (reconciliation.kind === 'NEEDS_TWO_POINTS') {
    return (
      <Empty>
        {reconciliation.snapshotCount === 0
          ? 'No readings yet, so there is nothing to compare your paychecks against.'
          : 'One reading. A deposit check needs two, because what it compares is what arrived between them.'}
      </Empty>
    )
  }
  if (reconciliation.kind === 'NO_FUND_REPORT') {
    return (
      <Empty>
        None of the readings says what the fund received. That figure is on the report as
        "הפקדות" — add it to a reading and this check starts working.
      </Empty>
    )
  }
  if (reconciliation.kind === 'WINDOW_TOO_SHORT') {
    return <Empty>Two readings inside one month is too short a window to compare.</Empty>
  }
  if (reconciliation.kind === 'NO_PAYSLIP_DATA') {
    return (
      <Empty>
        {fundName} reports receiving {formatMoney(reconciliation.reported)} over this period, and
        there are no paychecks covering it to compare that against.
      </Empty>
    )
  }

  const { expected, reported, gap, window, status } = reconciliation
  const missing = status === 'DEPOSITS_MISSING'

  return (
    <div>
      <p className={`max-w-2xl ${missing ? 'text-negative' : ''}`}>
        Your paychecks show {formatMoney(expected.total)} due to this fund for{' '}
        {formatYearMonth(window.salaryFrom)} to {formatYearMonth(window.salaryTo)}. The fund
        reports receiving {formatMoney(reported)}.{' '}
        {gap.minor === 0
          ? 'They agree exactly.'
          : missing
            ? `${formatMoney(gap)} is unaccounted for.`
            : status === 'DEPOSITS_EXCEED_PAYSLIPS'
              ? // The gap is expected minus reported, so a surplus is negative.
                // Printed raw it reads "-₪500.00 more arrived", which is a
                // double negative in a sentence whose whole job is to be plain.
                `${formatMoney(abs(gap))} more arrived than the paychecks account for — usually a month of an earlier period landing inside this one.`
              : `The difference is ${formatMoney(gap)}.`}
      </p>
      <p className="mt-1 text-caption text-ink-tertiary">
        {DEPOSIT_STATUS_LABEL[status]} · {expected.paycheckCount}{' '}
        {expected.paycheckCount === 1 ? 'paycheck' : 'paychecks'}, compared with a{' '}
        {window.lagMonths}-month lag and a tolerance of {formatMoney(reconciliation.tolerance)}.
      </p>
    </div>
  )
}

/** Whether this window has any payslip behind its expected figure at all. */
function hasPayslips(
  period: DepositPeriod,
): period is DepositPeriod & { expected: ContributionTotal } {
  return period.expected !== undefined && period.expected.paycheckCount > 0
}

/**
 * The working behind the verdict when the reports printed a deposit table — one
 * row per **salary month**, which is as sharp as this check gets (D-153).
 *
 * Above the window table rather than instead of it. The windows are the answer
 * that always works, built from one deposits figure per reading and a lag this
 * app has to guess; this is the answer the document itself gave, and where both
 * exist, seeing the sharp one first and the always-available one under it is
 * what makes the two agreeing meaningful.
 *
 * **The lag is measured here and it is a column.** A contribution for 11/2025
 * that arrived on 04/01/2026 is two months late, which no cumulative window can
 * say — and being able to see *which* months are late is most of what somebody
 * chasing an employer needs.
 */
function MonthTable({ months }: { months: readonly MonthlyDeposit[] }) {
  return (
    <div className="mt-4 max-w-3xl overflow-x-auto">
      <p className="text-label text-ink-tertiary uppercase">Month by month, from the reports</p>
      <table className="mt-2 w-full">
        <thead>
          <tr className="border-b border-hairline text-label text-ink-tertiary uppercase">
            <th className="py-2 pr-6 text-left font-medium">Salary month</th>
            <th className="py-2 pr-6 text-right font-medium">Paycheck says</th>
            <th className="py-2 pr-6 text-right font-medium">Fund received</th>
            <th className="py-2 pr-6 text-right font-medium">Difference</th>
            {/* The base the two documents each say the deposit was worked out
                on (D-169) — the payslip's `basisAmount` against the fund's own
                salary column, and neither of them is the gross. */}
            <th className="py-2 pr-6 text-right font-medium">Computed on</th>
            <th className="py-2 pr-6 text-left font-medium">Arrived</th>
            <th className="py-2 text-left font-medium">Late by</th>
          </tr>
        </thead>
        <tbody>
          {[...months].reverse().map((month) => (
            <tr key={toYearMonthString(month.period)} className="border-b border-hairline">
              <td className="py-1.5 pr-6 whitespace-nowrap tabular-nums">
                {formatMonthShort(month.period)}
              </td>
              {/* An em dash, never a zero: a month with no payslip has nothing
                  to say about what was due, and a month the reports do not
                  mention is not a month nothing arrived in — it may simply be
                  outside every report this document holds. */}
              <td className="py-1.5 pr-6 text-right tabular-nums">
                {month.expected === undefined ? '—' : formatMoney(month.expected)}
              </td>
              <td className="py-1.5 pr-6 text-right tabular-nums">
                {month.received === undefined ? '—' : formatMoney(month.received)}
              </td>
              <td
                className={`py-1.5 pr-6 text-right tabular-nums ${
                  month.status === 'MISSING' ? 'text-negative' : ''
                }`}
              >
                {month.gap === undefined ? '—' : formatMoney(month.gap)}
                {/* A part the slips put in and the rows show none of fails by
                    name, whatever the total says (D-389). */}
                {month.missingParts.length > 0 && (
                  <span className="block text-caption whitespace-nowrap">
                    no {month.missingParts.join(' or ')} part
                  </span>
                )}
              </td>
              <td className="py-1.5 pr-6 text-right tabular-nums">
                {month.fundSalary === undefined || month.slipSalary === undefined ? (
                  <span className="text-ink-tertiary">—</span>
                ) : month.salaryStatus === 'AGREES' ? (
                  <span className="text-ink-secondary">{formatMoney(month.fundSalary)}</span>
                ) : (
                  // Both figures, because the interesting fact is the pair. The
                  // fund's is the one marked: it is the number the deposit was
                  // actually computed from.
                  <span className="whitespace-nowrap">
                    <span className="text-negative">{formatMoney(month.fundSalary)}</span>
                    <span className="text-caption text-ink-tertiary">
                      {' '}
                      vs {formatMoney(month.slipSalary)}
                    </span>
                  </span>
                )}
              </td>
              <td className="py-1.5 pr-6 whitespace-nowrap text-ink-secondary tabular-nums">
                {month.arrivedOn === undefined ? '—' : toISODate(month.arrivedOn)}
              </td>
              <td className="py-1.5 whitespace-nowrap text-caption text-ink-tertiary">
                {month.lagMonths === undefined
                  ? MONTH_STATUS_HINT[month.status]
                  : month.lagMonths <= 1
                    ? 'on time'
                    : `${String(month.lagMonths)} months`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <BaseNote months={months} />
    </div>
  )
}

/**
 * What the *Computed on* column is saying, said once under the table rather
 * than as a hint on every row.
 *
 * **Three sentences because there are three answers, and the third is the one
 * that matters** (D-169). A base neither document prints is not agreement; a
 * base both print and agree on is the fund working from the salary the employer
 * declared; and a base the fund used that is *smaller* than the slip's is the
 * shape of an under-report — which no equation on either document runs through,
 * which is D-138's law for the fifth time, and which is why it is written down
 * here instead of left as a red figure to interpret.
 */
function BaseNote({ months }: { months: readonly MonthlyDeposit[] }) {
  const differs = months.filter((month) => month.salaryStatus === 'DIFFERS')
  const known = months.filter((month) => month.salaryStatus !== 'UNKNOWN')

  if (known.length === 0) {
    return (
      <p className="mt-2 max-w-prose text-caption text-ink-tertiary">
        Nothing in <em>Computed on</em> yet: it needs both a report that prints a salary column and
        paychecks whose pension line prints its base. Neither is universal, and the app only began
        keeping the paycheck’s base recently — so paychecks saved before that have none.
      </p>
    )
  }

  if (differs.length === 0) {
    return (
      <p className="mt-2 max-w-prose text-caption text-ink-tertiary">
        Where the report and the paycheck both print a base, they agree — the fund worked from the same salary your
        paycheck says it should have.
      </p>
    )
  }

  const short = differs.filter((month) => (month.salaryGap?.minor ?? 0) > 0)

  return (
    <p className="mt-2 max-w-prose text-caption text-ink">
      {differs.length === 1 ? 'One month’s' : `${String(differs.length)} months’`} base does not
      match:{' '}
      {short.length > 0 ? (
        <>
          the fund computed on <strong>less</strong> than the paycheck printed
          {short.length === differs.length ? '' : ' in some of them'}, which is worth asking about
          even where the amount that arrived looks right — the contribution is a percentage of that
          figure, so the same rate on a smaller base is a smaller pension.
        </>
      ) : (
        <>
          the fund computed on more than the paycheck printed, which usually means a component the
          paycheck does not itemize is pensionable after all.
        </>
      )}{' '}
      Nothing checks this on either document.
    </p>
  )
}

/** What a row with no arrival date is saying, which is never "nothing arrived". */
const MONTH_STATUS_HINT: Readonly<Record<MonthlyDeposit['status'], string>> = {
  MATCHED: '',
  MISSING: 'nothing recorded as arriving',
  EXCEEDS: '',
  NO_PAYSLIP: 'no paycheck for this month',
  NOT_REPORTED: 'no report covers it',
}

/** The working behind the verdict — one row per window. */
function PeriodTable({ periods }: { periods: readonly DepositPeriod[] }) {
  return (
    <table className="mt-4 w-full max-w-3xl">
      <thead>
        <tr className="border-b border-hairline text-label text-ink-tertiary uppercase">
          <th className="py-2 pr-6 text-left font-medium">Period</th>
          <th className="py-2 pr-6 text-left font-medium">Salary months</th>
          <th className="py-2 pr-6 text-right font-medium">Paychecks say</th>
          <th className="py-2 pr-6 text-right font-medium">Fund says</th>
          <th className="py-2 text-right font-medium">Difference</th>
        </tr>
      </thead>
      <tbody>
        {[...periods].reverse().map((period) => (
          <tr key={period.closingSnapshotId} className="border-b border-hairline">
            <td className="py-1.5 pr-6 whitespace-nowrap text-ink-secondary tabular-nums">
              {toISODate(period.from)} → {toISODate(period.to)}
            </td>
            <td className="py-1.5 pr-6 whitespace-nowrap text-ink-secondary tabular-nums">
              {period.salaryFrom === undefined || period.salaryTo === undefined
                ? '—'
                : `${formatMonthShort(period.salaryFrom)} — ${formatMonthShort(period.salaryTo)}`}
            </td>
            {/* **No payslips is not ₪0.00.** A window the app has no slips for
                has nothing to say about what was due, and printing a zero there
                would turn "I do not know" into "nothing was owed" — which then
                makes every difference in the row look like a surplus. */}
            <td className="py-1.5 pr-6 text-right tabular-nums">
              {hasPayslips(period) ? formatMoney(period.expected.total) : '—'}
            </td>
            <td className="py-1.5 pr-6 text-right tabular-nums">
              {period.reported === undefined ? '—' : formatMoney(period.reported)}
            </td>
            <td
              className={`py-1.5 text-right tabular-nums ${
                hasPayslips(period) && period.gap !== undefined && period.gap.minor > 0
                  ? 'text-negative'
                  : ''
              }`}
            >
              {hasPayslips(period) && period.gap !== undefined ? formatMoney(period.gap) : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function feeHint(fee: EffectiveFee): string {
  if (fee.kind === 'NEEDS_TWO_POINTS') return 'needs two readings'
  if (fee.kind === 'NOT_REPORTED') return 'no reading says what was charged'
  if (fee.kind === 'WINDOW_TOO_SHORT') return 'the last two readings are inside one month'
  if (fee.kind === 'NO_BALANCE') return 'no balance to charge a fee on'
  if (fee.differenceBasisPoints === undefined) {
    return `charged over ${String(fee.months)} months, annualized`
  }
  if (feeDiffersMaterially(fee)) {
    return `${formatPercent(fee.differenceBasisPoints, { digits: 2 })} more than the policy says — worth a phone call`
  }
  // Within a tenth of a percent is the rounding of a quarterly figure, not a
  // discrepancy. Saying so is the difference between a check people read and
  // one they learn to ignore.
  return `in line with the policy, over ${String(fee.months)} months`
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 border-b border-hairline pb-2 text-label text-ink-tertiary uppercase">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Figure({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string | undefined
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-label text-ink-tertiary uppercase">{label}</span>
      {children}
      {hint !== undefined && hint !== '' && (
        <span className="text-caption text-ink-tertiary">{hint}</span>
      )}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="max-w-2xl text-ink-secondary">{children}</p>
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-md">{children}</p>
    </div>
  )
}
