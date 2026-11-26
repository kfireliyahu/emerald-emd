import { useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'

import { abs, formatMoney, type Money } from '@/core/money.ts'
import { formatPercent } from '@/core/percent.ts'
import { monthsBetween, toISODate, toYearMonthString, yearMonthOf } from '@/core/time.ts'
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
import { READ_GLYPH } from '@/ui/components/ActionGlyph.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { Chip } from '@/ui/components/Chip.tsx'
import { ContextMenu, type MenuItem } from '@/ui/components/ContextMenu.tsx'
import { MoreButton } from '@/ui/wealth/rowMenu.tsx'
import { wholeMoney } from '@/ui/charts/kit.ts'
import { BalanceChart } from '@/ui/funds/BalanceChart.tsx'
import { ReportIntake } from '@/ui/funds/ReportIntake.tsx'
import { blankSnapshot, SnapshotForm } from '@/ui/funds/SnapshotEditor.tsx'
import { SidePanel } from '@/ui/components/SidePanel.tsx'
import { countKey } from '@/i18n/count.ts'
import { useDates, useT, type Translate } from '@/i18n/current.ts'
import { Phrase } from '@/ui/components/Phrase.tsx'
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
  const t = useT()
  const { fundId } = useParams<{ fundId: string }>()

  const [editing, setEditing] = useState<Editing | undefined>()
  /** Pressed, or asked for by a read in the store that wants showing (D-171). */
  // A report dropped on Home's Read files arrives in the navigation's state (M36 U10).
  // Read once: leaving the reader lets them go, so *Read a fund report* later starts empty.
  const [dropped, setDropped] = useState((useLocation().state as { files?: readonly File[] } | null)?.files)
  const [reading, setReading] = useState(dropped !== undefined && dropped.length > 0)
  const held = useDocumentRead()
  const showReader = reading || (held?.kind === 'report' && held.open)
  const [problem, setProblem] = useState<string | undefined>()
  const [menu, setMenu] = useState<{ readonly at: { x: number; y: number }; readonly title: string; readonly items: readonly MenuItem[] } | undefined>()

  const analysis = useMemo(
    () => (db === undefined || fundId === undefined ? undefined : fundAnalysis(db, fundId)),
    [db, revision, fundId],
  )

  if (db === undefined) {
    return <Centered>{t('wealth.fundDetail.noDocument')}</Centered>
  }

  if (analysis === undefined) {
    return (
      <Centered>
        {t('wealth.fundDetail.missing')}{' '}
        <Link to="/wealth/funds" className="text-accent underline underline-offset-4 transition-colors duration-[var(--duration-micro)] hover:text-accent-hover">
          {t('wealth.fundDetail.closePane')}
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

  // A reading typed by hand is a form beside the page (D-617, M64 F3): it opens in the
  // fund's own pane, and saving or leaving puts the fund back where it was.
  // Over the fund pane, the fund still mounted behind it, so leaving puts
  // focus back on what opened it.
  const form =
    editing === undefined ? undefined : (
      <div className="absolute inset-y-0 end-0 z-20 flex">
        <SidePanel
          title={editing.isNew ? t('wealth.reading.addTitle') : t('wealth.reading.editTitle')}
          kicker={fund.name}
          onClose={() => setEditing(undefined)}
        >
        <SnapshotForm
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
        </SidePanel>
      </div>
    )

  const agreement = feeAgreementStatus(fund, now)
  const benchmark = feeBenchmark(fund, DEFAULT_FEE_REFERENCES)
  const liquidity = studyFundLiquidity(fund)
  const split = latest === undefined ? undefined : componentSplit(latest)
  const annualCost = latest === undefined ? undefined : annualFeeCost(latest.totalBalance, fund.fees)
  // What the document says about the policy, kept as written (and isolated: it may be Hebrew).
  const about = [fund.employerName, fund.investmentTrack, fund.policyNumber]
    .filter((value) => value !== undefined && value !== '')
    .join(' · ')
  const severance =
    split === undefined || split.severance.minor === 0 ? undefined : (
      <Figure label={t('wealth.fundDetail.severance')} hint={t('wealth.fundDetail.severanceHint')}>
        <span className="text-heading font-medium text-ink-secondary tabular-nums">{formatMoney(split.severance)}</span>
      </Figure>
    )
  // A table of dashes says nothing (M64 F60): a table is drawn when one of its rows
  // has both sides to compare, and otherwise it collapses to the note that says so.
  const monthsCheckable = months.some((month) => month.expected !== undefined && month.received !== undefined)
  const periodsCheckable = periods.some((period) => hasPayslips(period) && period.reported !== undefined)

  return (
    <>
    {form}
    <div className="fc-view-enter flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline px-6 py-2">
        {/* No breadcrumb: the list it belongs to is the pane on the left
            (D-130), so a link back to it would point at what you can see. */}
        <Bidi className="text-ink">{fund.name}</Bidi>

        <Button
          variant="secondary"
          size="sm"
          className="ms-auto"
          onClick={() =>
            setEditing({ isNew: true, snapshot: blankSnapshot(fund.id, now, currency) })
          }
        >
          {t('wealth.reading.add')}
        </Button>

        {/* Says what it does rather than what is behind it: on a machine with no
            model this reads a report in a format the document already knows, and
            otherwise it is the way to teach it one. */}
        <Button variant="secondary" size="sm" icon={READ_GLYPH.report} onClick={() => setReading(true)}>
          {t('wealth.fundDetail.readReport')}
        </Button>
        <Button variant="ghost" size="sm" onClick={closePane}>
          {t('wealth.fundDetail.close')}
        </Button>
      </div>

      {problem !== undefined && (
        <div className="fc-pop-enter flex shrink-0 items-center gap-4 border-b border-hairline bg-surface px-6 py-2">
          <span className="text-negative">{problem}</span>
          <Button variant="ghost" size="sm" className="ms-auto" onClick={() => setProblem(undefined)}>
            {t('wealth.common.dismiss')}
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        {/* The answer first, in words (M64 F60): what it is worth, whether its
            deposits arrived, what its fee costs — each part then has its section. */}
        <p className="m-0 max-w-[40ch] text-lede [text-wrap:balance]" data-answer="fund">
          <FundAnswer
            name={fund.name}
            latest={latest}
            reconciliation={reconciliation}
            annualCost={annualCost}
          />
        </p>
        <p className="m-0 mt-2 text-caption text-ink-secondary">
          {t(`wealth.kinds.fund.${fund.fundType}`)} · {t(`wealth.kinds.fundStatus.${fund.status}`)}
          {about !== '' && (
            <>
              {' · '}
              <Bidi>{about}</Bidi>
            </>
          )}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
          {agreement.kind === 'LAPSED' && (
            <Chip problem>{t('wealth.fundDetail.lapsed', { date: toISODate(agreement.since) })}</Chip>
          )}
          {agreement.kind === 'EXPIRING_SOON' && (
            <Chip>{t('wealth.fundDetail.expiring', { date: toISODate(agreement.until) })}</Chip>
          )}
          {liquidity !== undefined && (
            <Chip>
              {t('wealth.fundDetail.withdrawable', {
                date: toISODate(liquidity.liquidAt),
                first: toISODate(liquidity.firstDepositDate),
              })}
            </Chip>
          )}
          {fund.beneficiaries !== undefined && (
            <Chip>
              <Phrase text={t('wealth.fundDetail.beneficiaries')} parts={{ names: <Bidi>{fund.beneficiaries}</Bidi> }} />
            </Chip>
          )}
        </div>

        <Section title={t('wealth.fundDetail.worthTitle')}>
          {returns.kind === 'NEEDS_TWO_POINTS' ? (
            <Empty>
              {returns.snapshotCount === 0 ? t('wealth.fundDetail.noReadings') : t('wealth.fundDetail.oneReading')}
            </Empty>
          ) : (
            <>
              <BalanceChart snapshots={snapshots} periods={returns.periods} />

              {returns.cumulative !== undefined && (
                <div className="mt-4 grid grid-cols-3 items-start gap-x-6 gap-y-4">
                  <Figure label={t('wealth.fundDetail.paidIn')} hint={trackedSpan(snapshots, t)}>
                    <span className="text-heading font-medium tabular-nums">
                      {formatMoney(returns.cumulative.contributions)}
                    </span>
                  </Figure>
                  <Figure label={t('wealth.fundDetail.earned')} hint={t('wealth.fundDetail.earnedHint')}>
                    <span
                      className={`text-heading font-medium tabular-nums ${
                        returns.cumulative.gain.minor < 0 ? 'text-negative' : ''
                      }`}
                    >
                      {formatMoney(returns.cumulative.gain)}
                    </span>
                  </Figure>
                  <Figure label={t('wealth.fundDetail.return')} hint={t('wealth.fundDetail.returnHint')}>
                    <span className="text-heading font-medium tabular-nums">
                      {formatPercent(returns.cumulative.basisPoints)}
                    </span>
                  </Figure>
                  {severance}
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
                <p className="mt-3 flex max-w-2xl flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-secondary">
                  <span>
                    {t(countKey('wealth.fundDetail.short', trackedMonths(snapshots)), { count: trackedMonths(snapshots) })}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => setReading(true)}>
                    {t('wealth.fundDetail.readOld')}
                  </Button>
                </p>
              )}

              {returns.cumulative === undefined && (
                <p className="mt-3 max-w-2xl text-caption text-ink-secondary">
                  {t(countKey('wealth.fundDetail.noTotal', returns.unknownPeriods), { count: returns.unknownPeriods })}
                </p>
              )}
            </>
          )}
          {/* Severance sits beside the totals when there are any, and on its own otherwise. */}
          {(returns.kind === 'NEEDS_TWO_POINTS' || returns.cumulative === undefined) && severance !== undefined && (
            <div className="mt-4">{severance}</div>
          )}
        </Section>

        <Section title={t('wealth.fundDetail.depositsTitle')}>
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
                  {reconciliation.status === 'ACKNOWLEDGED' ? t('wealth.fundDetail.reportAgain') : t('wealth.fundDetail.chased')}
                </Button>
                <span className="text-caption text-ink-secondary">{t('wealth.fundDetail.chasedWhy')}</span>
              </div>
            )}

          {linkedTypes.length === 0 ? (
            <p className="mt-3 max-w-2xl text-caption text-ink-secondary">
              <Phrase
                text={t('wealth.fundDetail.noLink')}
                parts={{
                  link: (
                    <Link to="/paychecks/deductions" className="text-accent underline underline-offset-4 transition-colors duration-[var(--duration-micro)] hover:text-accent-hover">
                      {t('wealth.fundDetail.noLinkLink')}
                    </Link>
                  ),
                }}
              />
            </p>
          ) : (
            <p className="mt-3 text-caption text-ink-secondary">
              <Phrase
                text={t('wealth.fundDetail.fedBy')}
                parts={{ names: <Bidi>{linkedTypes.map((type) => type.name).join(t('wealth.common.listSeparator'))}</Bidi> }}
              />
            </p>
          )}

          {monthsCheckable && <MonthTable months={months} />}
          {periodsCheckable && <PeriodTable periods={periods} />}
          {(months.length > 0 || periods.length > 0) && !monthsCheckable && !periodsCheckable && (
            <p className="mt-3 max-w-2xl text-caption text-ink-secondary">{t('wealth.fundDetail.nothingToCheck')}</p>
          )}
        </Section>

        <Section title={t('wealth.fundDetail.fee.title')}>
          <div className="grid grid-cols-2 items-start gap-x-6 gap-y-4">
            <Figure label={t('wealth.fundDetail.fee.stated')} hint={t('wealth.fundDetail.fee.statedHint')}>
              <span className="text-heading font-medium tabular-nums">
                {fund.fees.onAccumulationBasisPoints === undefined
                  ? '—'
                  : formatPercent(fund.fees.onAccumulationBasisPoints, { digits: 2 })}
              </span>
            </Figure>

            <Figure label={t('wealth.fundDetail.fee.paid')} hint={feeHint(fee, t)}>
              <span
                className={`text-heading font-medium tabular-nums ${
                  feeDiffersMaterially(fee) ? 'text-negative' : ''
                }`}
              >
                {fee.kind === 'MEASURED'
                  ? formatPercent(fee.annualBasisPoints, { digits: 2 })
                  : '—'}
              </span>
            </Figure>

            {annualCost !== undefined && (
              <Figure label={t('wealth.fundDetail.fee.year')} hint={t('wealth.fundDetail.fee.yearHint')}>
                <span className="text-heading font-medium tabular-nums">
                  {formatMoney(annualCost)}
                </span>
              </Figure>
            )}

            <Figure label={t('wealth.fundDetail.fee.onDeposit')} hint={t('wealth.fundDetail.fee.onDepositHint')}>
              <span className="text-heading font-medium tabular-nums">
                {fund.fees.onDepositBasisPoints === undefined
                  ? '—'
                  : formatPercent(fund.fees.onDepositBasisPoints, { digits: 2 })}
              </span>
            </Figure>
          </div>

          {benchmark.reference !== undefined && benchmark.onAccumulation !== undefined && (
            <p className="mt-3 max-w-2xl text-caption text-ink-secondary">
              {t('wealth.fundDetail.fee.ceiling', {
                type: t(`wealth.kinds.fund.${fund.fundType}`).toLowerCase(),
                balanceCap: formatPercent(benchmark.onAccumulation.capBasisPoints, { digits: 2 }),
                depositCap: formatPercent(benchmark.onDeposit?.capBasisPoints, { digits: 2 }),
                typical: formatPercent(benchmark.onAccumulation.typicalBasisPoints, { digits: 2 }),
                date: toISODate(benchmark.reference.asOf),
              })}
            </p>
          )}
        </Section>

        <Section title={t('wealth.fundDetail.readings.title')}>
          {snapshots.length === 0 ? (
            <Empty>{t('wealth.fundDetail.readings.empty')}</Empty>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-hairline text-caption font-medium text-ink-secondary uppercase">
                  <th className="py-2 pe-3 text-start font-medium">{t('wealth.fundDetail.readings.asOf')}</th>
                  <th className="py-2 pe-3 text-end font-medium">{t('wealth.fundDetail.readings.balance')}</th>
                  <th className="py-2 pe-3 text-end font-medium">{t('wealth.fundDetail.readings.deposits')}</th>
                  <th className="w-7 py-2">
                    <span className="sr-only">{t('wealth.fundDetail.readings.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...snapshots].reverse().map((snapshot) => (
                  <tr key={snapshot.id} className="border-b border-hairline">
                    {/* Four columns, so every figure fits the detail's width (M64 F59):
                        the note stacks under its date, the fees under the deposits, and
                        Edit and Delete are the row's one menu. */}
                    <td className="py-1.5 pe-3 align-top">
                      <span className="block whitespace-nowrap tabular-nums">{toISODate(snapshot.asOfDate)}</span>
                      {snapshot.note !== undefined && (
                        <span className="block text-caption text-ink-secondary">
                          <Bidi>{snapshot.note}</Bidi>
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pe-3 text-end align-top whitespace-nowrap tabular-nums">
                      {formatMoney(snapshot.totalBalance)}
                    </td>
                    <td className="py-1.5 pe-3 text-end align-top whitespace-nowrap tabular-nums">
                      {snapshot.depositsSincePrevious === undefined
                        ? '—'
                        : formatMoney(snapshot.depositsSincePrevious)}
                      {snapshot.feesChargedSincePrevious !== undefined && (
                        <span className="block text-caption text-ink-secondary">
                          {t('wealth.fundDetail.readings.feesLine', { amount: formatMoney(snapshot.feesChargedSincePrevious) })}
                        </span>
                      )}
                    </td>
                    <td className="py-1 text-end align-top">
                      <MoreButton
                        label={t('wealth.common.moreFor', { name: toISODate(snapshot.asOfDate) })}
                        onMenu={(at) =>
                          setMenu({
                            at,
                            title: toISODate(snapshot.asOfDate),
                            items: [
                              { label: t('wealth.common.edit'), icon: 'edit', onChoose: () => setEditing({ isNew: false, snapshot }) },
                              {
                                label: t('wealth.common.delete'),
                                icon: 'trash',
                                onChoose: () => write((database, at) => deleteSnapshot(database, snapshot.id, at)),
                              },
                            ],
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>
    </div>
    {menu !== undefined && (
      <ContextMenu key={menu.title} at={menu.at} items={menu.items} onClose={() => setMenu(undefined)} header={{ title: menu.title }} />
    )}
    </>
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
function trackedSpan(snapshots: readonly FundBalanceSnapshot[], t: Translate): string {
  const first = snapshots[0]
  const last = snapshots[snapshots.length - 1]
  if (first === undefined || last === undefined) return t('wealth.fundDetail.spanUnknown')
  return t('wealth.fundDetail.span', { from: toISODate(first.asOfDate), to: toISODate(last.asOfDate) })
}

function Verdict({
  reconciliation,
  fundName,
}: {
  reconciliation: DepositReconciliation
  fundName: string
}) {
  const t = useT()
  const dates = useDates()
  if (reconciliation.kind === 'NEEDS_TWO_POINTS') {
    return (
      <Empty>
        {reconciliation.snapshotCount === 0 ? t('wealth.fundDetail.verdict.noReadings') : t('wealth.fundDetail.verdict.oneReading')}
      </Empty>
    )
  }
  if (reconciliation.kind === 'NO_FUND_REPORT') {
    return <Empty>{t('wealth.fundDetail.verdict.noReport')}</Empty>
  }
  if (reconciliation.kind === 'WINDOW_TOO_SHORT') {
    return <Empty>{t('wealth.fundDetail.verdict.tooShort')}</Empty>
  }
  if (reconciliation.kind === 'NO_PAYSLIP_DATA') {
    return (
      <Empty>
        <Phrase
          text={t('wealth.fundDetail.verdict.noPayslips')}
          parts={{ fund: <Bidi>{fundName}</Bidi>, amount: formatMoney(reconciliation.reported) }}
        />
      </Empty>
    )
  }

  const { expected, reported, gap, window, status } = reconciliation
  const missing = status === 'DEPOSITS_MISSING'

  return (
    <div>
      <p className={`max-w-2xl ${missing ? 'text-negative' : ''}`}>
        {t('wealth.fundDetail.verdict.said', {
          expected: formatMoney(expected.total),
          from: dates.yearMonth(window.salaryFrom),
          to: dates.yearMonth(window.salaryTo),
          reported: formatMoney(reported),
        })}{' '}
        {gap.minor === 0
          ? t('wealth.fundDetail.verdict.agree')
          : missing
            ? t('wealth.fundDetail.verdict.missing', { amount: formatMoney(gap) })
            : status === 'DEPOSITS_EXCEED_PAYSLIPS'
              ? // The gap is expected minus reported, so a surplus is negative.
                // Printed raw it reads "-₪500.00 more arrived", which is a
                // double negative in a sentence whose whole job is to be plain.
                t('wealth.fundDetail.verdict.exceeds', { amount: formatMoney(abs(gap)) })
              : t('wealth.fundDetail.verdict.differs', { amount: formatMoney(gap) })}
      </p>
      <p className="mt-1 text-caption text-ink-secondary">
        {t(countKey('wealth.fundDetail.verdict.how', expected.paycheckCount), {
          count: expected.paycheckCount,
          lag: window.lagMonths,
          tolerance: formatMoney(reconciliation.tolerance),
        })}
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
 * **The lag is measured here and it is said under the month.** A contribution
 * for 11/2025 that arrived on 04/01/2026 is two months late, which no cumulative
 * window can say — and being able to see *which* months are late is most of what
 * somebody chasing an employer needs.
 *
 * **Four columns, so every figure fits the detail's column** (M64 F59): how late
 * a month's deposit was, and the day it arrived, stack under the month; the base
 * it was computed on stacks under its difference, and only where the two
 * documents disagree on it (BaseNote says the rest once).
 */
function MonthTable({ months }: { months: readonly MonthlyDeposit[] }) {
  const t = useT()
  const dates = useDates()
  return (
    <div className="mt-4">
      <p className="text-caption font-medium text-ink-secondary uppercase">{t('wealth.fundDetail.months.title')}</p>
      <table className="mt-2 w-full">
        <thead>
          <tr className="border-b border-hairline text-caption font-medium text-ink-secondary uppercase">
            <th className="py-2 pe-3 text-start font-medium">{t('wealth.fundDetail.months.salaryMonth')}</th>
            <th className="py-2 pe-3 text-end font-medium">{t('wealth.fundDetail.months.paycheckSays')}</th>
            <th className="py-2 pe-3 text-end font-medium">{t('wealth.fundDetail.months.fundReceived')}</th>
            <th className="py-2 text-end font-medium">{t('wealth.fundDetail.months.difference')}</th>
          </tr>
        </thead>
        <tbody>
          {[...months].reverse().map((month) => (
            <tr key={toYearMonthString(month.period)} className="border-b border-hairline">
              <td className="py-1.5 pe-3 align-top">
                <span className="block whitespace-nowrap tabular-nums">{dates.monthShort(month.period)}</span>
                <span className="block text-caption text-ink-secondary">
                  {month.lagMonths === undefined
                    ? monthStatusHint(month.status, t)
                    : month.lagMonths <= 1
                      ? t('wealth.fundDetail.months.onTime')
                      : t(countKey('wealth.fundDetail.months.late', month.lagMonths), { count: month.lagMonths })}
                </span>
                {month.arrivedOn !== undefined && (
                  <span className="block text-caption whitespace-nowrap text-ink-secondary tabular-nums">
                    {t('wealth.fundDetail.months.arrivedOn', { date: dates.dayMonth(month.arrivedOn) })}
                  </span>
                )}
              </td>
              {/* An em dash, never a zero: a month with no payslip has nothing
                  to say about what was due, and a month the reports do not
                  mention is not a month nothing arrived in — it may simply be
                  outside every report this document holds. */}
              <td className="py-1.5 pe-3 text-end align-top whitespace-nowrap tabular-nums">
                {month.expected === undefined ? '—' : formatMoney(month.expected)}
              </td>
              <td className="py-1.5 pe-3 text-end align-top whitespace-nowrap tabular-nums">
                {month.received === undefined ? '—' : formatMoney(month.received)}
              </td>
              <td className="py-1.5 text-end align-top tabular-nums">
                <span className={`whitespace-nowrap ${month.status === 'MISSING' ? 'text-negative' : ''}`}>
                  {month.gap === undefined ? '—' : formatMoney(month.gap)}
                </span>
                {/* A part the slips put in and the rows show none of fails by
                    name, whatever the total says (D-389). */}
                {month.missingParts.length > 0 && (
                  <span className="block text-caption text-negative">
                    {t('wealth.fundDetail.months.noPart', {
                      parts: month.missingParts
                        .map((part) => t(`wealth.kinds.depositPart.${part}`))
                        .join(t('wealth.fundDetail.months.partOr')),
                    })}
                  </span>
                )}
                {/* The base the two documents each say the deposit was worked out
                    on (D-169), only where they disagree: both figures, because the
                    interesting fact is the pair, and the fund's is the one marked —
                    it is the number the deposit was actually computed from. */}
                {month.salaryStatus === 'DIFFERS' && month.fundSalary !== undefined && month.slipSalary !== undefined && (
                  <span className="block text-caption text-ink-secondary">
                    <Phrase
                      text={t('wealth.fundDetail.months.basePair')}
                      parts={{
                        fund: <span className="text-negative">{formatMoney(month.fundSalary)}</span>,
                        slip: formatMoney(month.slipSalary),
                      }}
                    />
                  </span>
                )}
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
 * What the base each deposit was computed on is saying, said once under the
 * table rather than as a column on every row.
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
  const t = useT()

  if (known.length === 0) {
    return <p className="mt-2 max-w-prose text-caption text-ink-secondary">{t('wealth.fundDetail.months.baseNone')}</p>
  }

  if (differs.length === 0) {
    return <p className="mt-2 max-w-prose text-caption text-ink-secondary">{t('wealth.fundDetail.months.baseAgrees')}</p>
  }

  const short = differs.filter((month) => (month.salaryGap?.minor ?? 0) > 0)

  return (
    <p className="mt-2 max-w-prose text-caption text-ink">
      {t(countKey('wealth.fundDetail.months.baseDiffers', differs.length), { count: differs.length })}{' '}
      {short.length > 0 ? (
        <Phrase
          text={t(short.length === differs.length ? 'wealth.fundDetail.months.baseLess' : 'wealth.fundDetail.months.baseLessSome')}
          parts={{ less: <strong>{t('wealth.fundDetail.months.less')}</strong> }}
        />
      ) : (
        t('wealth.fundDetail.months.baseMore')
      )}{' '}
      {t('wealth.fundDetail.months.baseUnchecked')}
    </p>
  )
}

/** What a row with no arrival date is saying, which is never "nothing arrived". */
function monthStatusHint(status: MonthlyDeposit['status'], t: Translate): string {
  return status === 'MATCHED' || status === 'EXCEEDS' ? '' : t(`wealth.fundDetail.months.status.${status}`)
}

/**
 * The working behind the verdict — one window per pair of rows (M64 F59): the
 * window's readings and salary months on a line of their own, its three figures
 * under it, so every figure fits the detail's column.
 */
function PeriodTable({ periods }: { periods: readonly DepositPeriod[] }) {
  const t = useT()
  const dates = useDates()
  return (
    <table className="mt-4 w-full">
      <thead>
        <tr className="border-b border-hairline text-caption font-medium text-ink-secondary uppercase">
          <th className="py-2 pe-3 text-end font-medium">{t('wealth.fundDetail.periods.paychecksSay')}</th>
          <th className="py-2 pe-3 text-end font-medium">{t('wealth.fundDetail.periods.fundSays')}</th>
          <th className="py-2 text-end font-medium">{t('wealth.fundDetail.periods.difference')}</th>
        </tr>
      </thead>
      {[...periods].reverse().map((period) => (
        <tbody key={period.closingSnapshotId} className="border-b border-hairline">
          <tr>
            <th scope="rowgroup" colSpan={3} className="pt-2 text-start text-caption font-normal text-ink-secondary tabular-nums">
              {period.salaryFrom === undefined || period.salaryTo === undefined
                ? t('wealth.fundDetail.periods.window', { from: toISODate(period.from), to: toISODate(period.to) })
                : t('wealth.fundDetail.periods.windowSalary', {
                    from: toISODate(period.from),
                    to: toISODate(period.to),
                    salaryFrom: dates.monthShort(period.salaryFrom),
                    salaryTo: dates.monthShort(period.salaryTo),
                  })}
            </th>
          </tr>
          <tr>
            {/* **No payslips is not ₪0.00.** A window the app has no slips for
                has nothing to say about what was due, and printing a zero there
                would turn "I do not know" into "nothing was owed" — which then
                makes every difference in the row look like a surplus. */}
            <td className="pe-3 pb-1.5 text-end whitespace-nowrap tabular-nums">
              {hasPayslips(period) ? formatMoney(period.expected.total) : '—'}
            </td>
            <td className="pe-3 pb-1.5 text-end whitespace-nowrap tabular-nums">
              {period.reported === undefined ? '—' : formatMoney(period.reported)}
            </td>
            <td
              className={`pb-1.5 text-end whitespace-nowrap tabular-nums ${
                hasPayslips(period) && period.gap !== undefined && period.gap.minor > 0 ? 'text-negative' : ''
              }`}
            >
              {hasPayslips(period) && period.gap !== undefined ? formatMoney(period.gap) : '—'}
            </td>
          </tr>
        </tbody>
      ))}
    </table>
  )
}

/**
 * The fund's answer, in three plain sentences (M64 F60): what it is worth, whether
 * its deposits arrived, and what its fee costs a year. Each one has its section
 * below, with the working; a part with no answer says which, never a zero.
 */
function FundAnswer({
  name,
  latest,
  reconciliation,
  annualCost,
}: {
  name: string
  latest: FundBalanceSnapshot | undefined
  reconciliation: DepositReconciliation
  annualCost: Money | undefined
}) {
  const t = useT()
  const dates = useDates()
  const fund = <Bidi>{name}</Bidi>
  const worth =
    latest === undefined ? (
      <Phrase text={t('wealth.fundDetail.answer.noWorth')} parts={{ name: fund }} />
    ) : (
      <Phrase
        text={t('wealth.fundDetail.answer.worth')}
        parts={{ name: fund, balance: wholeMoney(latest.totalBalance), month: dates.monthShort(yearMonthOf(latest.asOfDate)) }}
      />
    )
  const deposits =
    reconciliation.kind !== 'CHECKED'
      ? t('wealth.fundDetail.answer.depositsUnchecked')
      : reconciliation.status === 'WITHIN_TOLERANCE'
        ? t('wealth.fundDetail.answer.depositsArrived')
        : reconciliation.status === 'DEPOSITS_MISSING'
          ? t('wealth.fundDetail.answer.depositsMissing', { amount: wholeMoney(reconciliation.gap) })
          : reconciliation.status === 'DEPOSITS_EXCEED_PAYSLIPS'
            ? t('wealth.fundDetail.answer.depositsExceed', { amount: wholeMoney(abs(reconciliation.gap)) })
            : t('wealth.fundDetail.answer.depositsExplained', { amount: wholeMoney(abs(reconciliation.gap)) })
  const fee =
    annualCost === undefined
      ? t('wealth.fundDetail.answer.feeUnknown')
      : t('wealth.fundDetail.answer.fee', { cost: wholeMoney(annualCost) })
  return (
    <>
      {worth} {deposits} {fee}
    </>
  )
}

function feeHint(fee: EffectiveFee, t: Translate): string {
  if (fee.kind === 'NEEDS_TWO_POINTS') return t('wealth.fundDetail.fee.needsTwo')
  if (fee.kind === 'NOT_REPORTED') return t('wealth.fundDetail.fee.notReported')
  if (fee.kind === 'WINDOW_TOO_SHORT') return t('wealth.fundDetail.fee.tooShort')
  if (fee.kind === 'NO_BALANCE') return t('wealth.fundDetail.fee.noBalance')
  if (fee.differenceBasisPoints === undefined) {
    return t(countKey('wealth.fundDetail.fee.annualized', fee.months), { count: fee.months })
  }
  if (feeDiffersMaterially(fee)) {
    return t('wealth.fundDetail.fee.differs', { percent: formatPercent(fee.differenceBasisPoints, { digits: 2 }) })
  }
  // Within a tenth of a percent is the rounding of a quarterly figure, not a
  // discrepancy. Saying so is the difference between a check people read and
  // one they learn to ignore.
  return t(countKey('wealth.fundDetail.fee.inLine', fee.months), { count: fee.months })
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 border-b border-hairline pb-2 text-caption font-medium text-ink-secondary uppercase">
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
    <div className="flex flex-col items-start gap-0.5">
      <span className="text-caption font-medium text-ink-secondary uppercase">{label}</span>
      {children}
      {hint !== undefined && hint !== '' && (
        <span className="text-caption text-ink-secondary">{hint}</span>
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
