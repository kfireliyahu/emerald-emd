import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { formatMoney, money, type CurrencyCode } from '@/core/money.ts'
import {
  compareYearMonths,
  formatMonthShort,
  formatYearMonth,
  parseYearMonth,
  toISODate,
  toYearMonthString,
  type YearMonth,
} from '@/core/time.ts'
import { accountMonths, homeSummary } from '@/data/repositories/homeRepository.ts'
import {
  categoryObservations,
  documentCurrency,
  largestCharges,
  monthlyReport,
  monthlySummaries,
  monthlyTaxes,
} from '@/data/repositories/statisticsRepository.ts'
import { categoryBudgets } from '@/data/repositories/categoryBudgetRepository.ts'
import { listCategories } from '@/data/repositories/categoryRepository.ts'
import { categoryTree, spendUnder } from '@/data/repositories/splitPlanRepository.ts'
import { subtreeOf } from '@/domain/categoryTree.ts'
import { budgetLines } from '@/ui/home/budgets.ts'
import { waitingCounts } from '@/domain/home.ts'
import type { MonthSummary } from '@/domain/model/statistics.ts'
import { statementGaps, type StatementGap } from '@/domain/statementGaps.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { salaryBankWords } from '@/domain/salaryBank.ts'
import { salaryProblem } from '@/domain/statistics.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { MonthChart, type ChartMonth } from '@/ui/home/MonthChart.tsx'
import {
  chartEnd,
  monthsEndingAt,
  neighbour,
  newestWithData,
  signedPercent,
  taxVersusAverage,
  versusAverage,
} from '@/ui/home/months.ts'
import {
  BlockHead,
  Figure,
  Figures,
  FLOW_TEXT,
  IntakeBand,
  Key,
  Legend,
  Pager,
  useFilePicker,
  useReadFiles,
} from '@/ui/home/parts.tsx'
import { useHomeKeys } from '@/ui/home/useHomeKeys.ts'
import { GuideLine } from '@/ui/guide/GuideLine.tsx'
import { WaitingList } from '@/ui/home/WaitingList.tsx'
import { today } from '@/ui/today.ts'
import { UNCATEGORIZED_OPTION } from '@/ui/transactions/FilterBar.tsx'

/**
 * **Home · Month** — M28 U5, the approved mockup (`docs/mockups/m28-u5/home.html`).
 *
 * The month, paged the way Paychecks is (arrows and ← →, a column of the chart,
 * a row of *All months*), with the place to drop statements and payslips at the
 * top — asked: *"there should be a clear place to drop new statements …
 * and also an option for bulk reading"*. It opens on the newest month that has
 * data rather than the calendar's (S1).
 *
 * **The four flows carry their colours on the headline figures, the chart and
 * the totals, and nowhere else** (choice 2, A; D-313): a list of forty charges is
 * not forty red numbers. Left over is the difference, not a flow, and stays ink.
 *
 * **Every figure is the domain's.** The month is `monthlyReport`, the months are
 * `monthlySummaries`, taxes are `monthlyTaxes` off the slips; the screen sums
 * nothing. Left over is `balance` — came in less went out, docs/05's definition
 * — and saved sits beside it, because saving is not spending.
 */
export function Home() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const navigate = useNavigate()
  const landing = useLocation().state as Landing

  const asOf = today()
  const currency: CurrencyCode = useMemo(() => (db === undefined ? 'ILS' : documentCurrency(db)), [db, revision])
  const summaries = useMemo(
    () => (db === undefined ? [] : monthlySummaries(db, asOf, { currency })),
    [db, revision, currency],
  )
  const taxes = useMemo(() => (db === undefined ? new Map() : monthlyTaxes(db, { currency })), [db, revision, currency])
  const newest = newestWithData(summaries)

  const [wanted, setWanted] = useState<YearMonth | undefined>(() =>
    landing?.month === undefined ? undefined : parseYearMonth(landing.month),
  )
  const period = wanted ?? newest
  const [swap, setSwap] = useState<{ side: 'l' | 'r'; turn: number }>({ side: 'r', turn: 0 })
  const [arrived] = useState(() => new Set(landing?.arrived ?? []))
  const [wrote, setWrote] = useState(landing?.wrote)

  const report = useMemo(
    () => (db === undefined || period === undefined ? undefined : monthlyReport(db, period, asOf, { currency })),
    [db, revision, period, currency],
  )
  /** Each budgeted category against the month (D-327): the budget is its bucket in the plan in use. */
  const budgeted = useMemo(() => {
    if (db === undefined || period === undefined || report === undefined) return []
    const budgets = categoryBudgets(db, asOf, currency, period)
    if (budgets.size === 0) return []
    const names = new Map(listCategories(db, { includeArchived: true }).map((one) => [one.id, one.path]))
    // A budget on a category counts everything under it, as Plan's bucket does (M28 F29, D-348).
    const observations = categoryObservations(db, period, { currency })
    const tree = categoryTree(db)
    return budgetLines(
      budgets,
      names,
      (id) => spendUnder(observations, report.moved, subtreeOf(tree, id), currency)?.amount,
      currency,
    )
  }, [db, revision, period, report, currency])
  // The rows went out counts, and no other (M30 F1): not a bank row that pays a card.
  const largest = useMemo(
    () => (db === undefined || period === undefined ? [] : largestCharges(db, period, 5, { currency })),
    [db, revision, period, currency],
  )
  const summary = useMemo(() => (db === undefined ? undefined : homeSummary(db, asOf, currency)), [db, revision, currency])
  const gaps = useMemo(() => (db === undefined ? [] : statementGaps(accountMonths(db), newest)), [db, revision, newest])

  const readFiles = useReadFiles()
  const picker = useFilePicker(readFiles)

  const go = (target: YearMonth | undefined): void => {
    if (target === undefined || period === undefined || compareYearMonths(target, period) === 0) return
    setSwap((current) => ({ side: compareYearMonths(target, period) > 0 ? 'r' : 'l', turn: current.turn + 1 }))
    setWrote(undefined)
    setWanted(target)
  }
  const prev = period === undefined ? undefined : neighbour(summaries, period, -1)
  const next = period === undefined ? undefined : neighbour(summaries, period, 1)
  useHomeKeys({ page: (step) => go(step === -1 ? prev : next), readFiles: picker.open })

  if (db === undefined || summary === undefined) {
    return <Centered>Open a document, or create one, to see where you stand.</Centered>
  }

  const addByHand = (): void => void navigate('/paychecks', { state: { add: true } })
  const waiting = waitingCounts(summary.attention).all

  const shown = report?.summary
  // What saved is made of, each part once (M30 F1): the figure says where it came from.
  const savedParts =
    report === undefined
      ? []
      : [
          { label: 'moved', amount: money(report.moved.reduce((total, one) => total + one.netMinor, 0), currency), any: report.moved.length > 0 },
          { label: 'off the paycheck', amount: money(report.savedFrom.slips.reduce((total, one) => total + one.amount.minor, 0), currency), any: report.savedFrom.slips.length > 0 },
          { label: 'into goals', amount: money(report.savedFrom.goals.reduce((total, one) => total + one.amount.minor, 0), currency), any: report.savedFrom.goals.length > 0 },
        ].filter((part) => part.any)
  const missingHere = period === undefined ? [] : gaps.filter((gap) => compareYearMonths(gap.period, period) === 0)
  const tax = period === undefined ? undefined : taxes.get(toYearMonthString(period))

  const drillTo = (category?: string): void => {
    if (period === undefined) return
    navigate('/transactions', {
      state: {
        period: toYearMonthString(period),
        ...(category === undefined ? {} : { category, withSubcategories: category !== UNCATEGORIZED_OPTION }),
      },
    })
  }

  return (
    <div className="h-full overflow-auto">
      <div className="fc-view-enter @container flex flex-col gap-6 px-8 pt-6 pb-12">
        <header className="flex flex-wrap items-end justify-between gap-6 border-b border-hairline pb-4">
          <div className="flex flex-col gap-1.5">
            <span className="fc-label text-ink-secondary uppercase">
              Home · Month
              {shown !== undefined && !shown.isComplete && ' · in progress'}
            </span>
            <h1 className="m-0 text-[24px] leading-tight font-medium tracking-[-0.01em]" data-guide="home.title">
              {period === undefined ? 'Month' : formatYearMonth(period)}
            </h1>
          </div>
          {period !== undefined && (
            <Pager
              label="Month"
              prev={prev === undefined ? undefined : formatMonthShort(prev)}
              next={next === undefined ? undefined : formatMonthShort(next)}
              onPrev={() => go(prev)}
              onNext={() => go(next)}
            />
          )}
        </header>

        {wrote !== undefined && (
          <div className="fc-pop-enter flex flex-wrap items-center gap-3 bg-accent-soft px-3.5 py-2.5 text-ink-secondary">
            <ActionGlyph name="check" />
            <span className="text-ink">Written: {wrote}.</span>
            <span>
              {waiting === 0
                ? 'The new rows flash below. Nothing waits for an answer.'
                : `${String(waiting)} ${waiting === 1 ? 'answer waits' : 'answers wait'}, below.`}
            </span>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setWrote(undefined)}>
              Dismiss
            </Button>
          </div>
        )}

        <IntakeBand onAddByHand={addByHand} />
        {picker.input}

        {/* Getting started is the guide's line now, and where it resumes (M28 U9, D-330). */}
        <GuideLine />

        {/* Every question the app has, answered here (M31 U1, D-367): above the
            month, because the month's figures are wrong until it is answered. */}
        {!summary.isEmpty && <WaitingList items={summary.attention} currency={currency} onRead={picker.open} />}

        {summary.isEmpty || period === undefined || report === undefined ? (
          <p className="max-w-prose text-ink-secondary">
            Nothing here yet. Read a card or bank statement — drop it on the band above, or anywhere in this
            window — and the month is built out of it.
          </p>
        ) : (
          <>
            <Figures>
              <Figure label="Came in" flow="in" value={shown?.income}>
                {report.detail.payroll.minor > 0
                  ? `net pay ${formatMoney(report.detail.payroll)}${report.detail.other.minor > 0 ? ` and ${formatMoney(report.detail.other)} more` : ''}`
                  : 'net pay and other money in'}
                <Versus value={versusAverage(summaries, period, 'income')} />
              </Figure>
              <Figure label="Went out" flow="out" value={shown?.expenses}>
                {missingHere.length > 0 ? (
                  <span className="text-negative">
                    {missingHere.length === 1 ? `${accountLabel(missingHere[0])} missing` : `${String(missingHere.length)} statements missing`}
                  </span>
                ) : (
                  'on the date money left the account'
                )}
                <Versus value={versusAverage(summaries, period, 'expenses')} />
              </Figure>
              <Figure label="Saved" flow="saved" value={shown?.saved}>
                {savedParts.length > 0
                  ? `${savedParts.map((part) => `${formatMoney(part.amount)} ${part.label}`).join(', ')}, listed below`
                  : 'moved to savings, goals and funds'}
                <Versus value={versusAverage(summaries, period, 'saved')} />
              </Figure>
              <Figure label="Taxes" flow="tax" value={tax}>
                {tax === undefined ? 'no paycheck for this month' : 'income tax, insurance and health, off the paycheck'}
                <Versus value={taxVersusAverage(taxes, period, currency)} />
              </Figure>
              <Figure label="Left over" flow={undefined} value={shown?.balance}>
                came in, less went out
              </Figure>
            </Figures>

            <div className="flex flex-col gap-2">
              <MonthChart months={chartMonths(summaries, gaps, period, newest ?? period)} selected={period} onPick={go} />
              <Legend>
                <Key flow="in">Came in</Key>
                <Key flow="out">Went out</Key>
                <span>Saved and taxes are in the figures above and the table below</span>
                <span className="ml-auto">A column opens its month · ← → page</span>
              </Legend>
            </div>

            <div
              key={`${toYearMonthString(period)}:${String(swap.turn)}`}
              className={`grid grid-cols-1 gap-8 @[45rem]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] ${swap.turn === 0 ? '' : `fc-swap-${swap.side}`}`}
            >
              <section className="flex flex-col gap-3">
                <BlockHead title="Where it went" aside={`${String(report.categories.length)} categories`} />
                <div>
                  {report.categories.map((line) => {
                    const top = report.categories[0]?.outflow.minor ?? 1
                    const none = line.categoryId === undefined
                    return (
                      <button
                        key={line.categoryId ?? 'none'}
                        type="button"
                        onClick={() => drillTo(line.categoryId ?? UNCATEGORIZED_OPTION)}
                        data-tour={`went-${line.categoryId ?? 'none'}`}
                        className="grid h-[34px] w-full grid-cols-[minmax(0,1fr)_120px_100px] items-center gap-3 border-b border-hairline text-left transition-colors duration-[var(--duration-micro)] hover:bg-surface"
                      >
                        <span title={line.name} className="flex min-w-0 items-baseline gap-x-1">
                          <Bidi className="min-w-0 truncate">{line.name}</Bidi>
                          {none && (
                            <span className="min-w-0 truncate text-caption text-ink-secondary">
                              · {line.transactionCount} rows, on Transactions
                            </span>
                          )}
                        </span>
                        <span
                          aria-hidden
                          className={`h-1.5 ${none ? 'fc-bar-unknown' : 'bg-ink/70'}`}
                          style={{ width: `${String(Math.max(4, Math.round((120 * line.outflow.minor) / Math.max(1, top))))}px` }}
                        />
                        <span className="text-right tabular-nums">{formatMoney(line.outflow)}</span>
                      </button>
                    )
                  })}
                  <SplitRow
                    label="Bills"
                    note={`${String(report.split.lines.filter((one) => one.status === 'CHARGED').length)} tracked, charged this month`}
                    value={formatMoney(report.split.fixed)}
                  />
                  <SplitRow label="Everything else" value={formatMoney(report.split.variable)} />
                  <Total label="Went out" flow="out" value={formatMoney(report.summary?.expenses ?? report.split.expenses)} />
                </div>

                {budgeted.length > 0 && (
                  <div className="mt-3 flex flex-col gap-3">
                    <BlockHead title="Against the plan" aside="each category's bucket on Plan" />
                    <div>
                      {budgeted.map((line) => (
                        <button
                          key={line.categoryId}
                          type="button"
                          onClick={() => drillTo(line.categoryId)}
                          className="grid h-[34px] w-full grid-cols-[minmax(0,1fr)_120px_130px] items-center gap-3 border-b border-hairline text-left transition-colors duration-[var(--duration-micro)] hover:bg-surface"
                        >
                          <span className="flex min-w-0">
                            <Bidi className="min-w-0 truncate">{line.name}</Bidi>
                          </span>
                          <span aria-hidden className="h-1.5 w-[120px] bg-hairline">
                            <span
                              className={`block h-full ${line.over ? 'bg-flow-out' : 'bg-ink/70'}`}
                              style={{ width: `${String(Math.min(100, Math.round((100 * line.spent.minor) / Math.max(1, line.budget.minor))))}%` }}
                            />
                          </span>
                          <span className={`text-right tabular-nums ${line.over ? FLOW_TEXT.out : ''}`}>
                            {formatMoney(line.spent)} / {formatMoney(line.budget)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {savedParts.length > 0 && (
                  <div className="mt-3 flex flex-col gap-3">
                    <BlockHead title="Saved" aside="what makes the figure above; moved is not in went out" />
                    <div>
                      {report.moved.map((line) => (
                        <SavedRow
                          key={`moved-${line.categoryId ?? 'none'}`}
                          name={line.name}
                          note={`moved · ${line.transactionCount === 1 ? '1 row' : `${String(line.transactionCount)} rows`}`}
                          value={formatMoney(money(line.netMinor, currency))}
                          onClick={() => drillTo(line.categoryId ?? UNCATEGORIZED_OPTION)}
                        />
                      ))}
                      {report.savedFrom.slips.map((line) => (
                        <SavedRow
                          key={`slip-${line.deductionTypeId}`}
                          name={line.name}
                          note="off the paycheck, your part"
                          value={formatMoney(line.amount)}
                          onClick={() => navigate('/paychecks')}
                        />
                      ))}
                      {report.savedFrom.goals.map((line) => (
                        <SavedRow
                          key={`goal-${line.goalId}`}
                          name={line.name}
                          note={`into the goal · ${line.count === 1 ? '1 deposit' : `${String(line.count)} deposits`}`}
                          value={formatMoney(line.amount)}
                          onClick={() => navigate(`/wealth/goals/${line.goalId}`)}
                        />
                      ))}
                      <Total label="Saved" flow="saved" value={formatMoney(shown?.saved ?? money(0, currency))} />
                    </div>
                  </div>
                )}
              </section>

              <section className="flex flex-col gap-3">
                <BlockHead title="What came in" />
                <div>
                  {report.detail.lines.map((line) => (
                    <div key={`${line.kind}:${line.ref}`} className="grid h-[34px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-hairline">
                      <span title={line.name} className="flex min-w-0 items-baseline gap-x-1">
                        <Bidi className="min-w-0 truncate">{line.name}</Bidi>
                        <span className="min-w-0 truncate">
                          <span className="text-caption text-ink-secondary">
                            {line.kind === 'PAYSLIP' ? 'net pay, off the paycheck' : line.count > 1 ? `${String(line.count)} payments` : <Bidi>{line.categoryName ?? ''}</Bidi>}
                          </span>
                          {line.salary !== undefined && line.salary.kind !== 'UNCHECKED' && (
                            <span className={`text-caption ${salaryProblem(line.salary) ? 'text-negative' : 'text-ink-tertiary'}`}>
                              {' · '}
                              {salaryBankWords(line.salary, { money: formatMoney, date: (day) => toISODate(day) })}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="text-right tabular-nums">{formatMoney(line.amount)}</span>
                    </div>
                  ))}
                  <Total label="Came in" flow="in" value={formatMoney(report.detail.total)} />
                </div>

              </section>
            </div>

            {largest.length > 0 && (
              <section className="flex flex-col gap-3">
                <BlockHead title="Biggest single charges" />
                <table className="w-full border-collapse">
                  <tbody>
                    {largest.map((one) => (
                      <tr key={one.id} className="h-10 border-b border-hairline">
                        <td className="w-28 px-3 font-mono text-caption text-ink-secondary">
                          {toISODate(one.chargeDate ?? one.transactionDate)}
                        </td>
                        <td className="px-3">
                          <Bidi>{one.merchantRaw}</Bidi>
                        </td>
                        <td className="px-3 text-ink-secondary">
                          <Bidi>{one.categoryPath ?? 'Uncategorized'}</Bidi>
                        </td>
                        <td className="px-3 text-right tabular-nums">{formatMoney(one.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            <AllMonths
              summaries={summaries}
              taxes={taxes}
              gaps={gaps}
              open={period}
              arrived={arrived}
              onOpen={(month) => {
                go(month)
                document.querySelector('main .overflow-auto')?.scrollTo?.({ top: 0 })
              }}
              onRead={picker.open}
            />
          </>
        )}
      </div>
    </div>
  )
}

/** What a Write asked Home to open on, and what it wrote. */
type Landing = { readonly month?: string; readonly arrived?: readonly string[]; readonly wrote?: string } | null

/** The chart's months, from the summaries: a gap is a month the document does not hold. */
function chartMonths(
  summaries: readonly MonthSummary[],
  gaps: readonly StatementGap[],
  shown: YearMonth,
  newest: YearMonth,
): readonly ChartMonth[] {
  const byMonth = new Map(summaries.map((one) => [toYearMonthString(one.period), one]))
  const short = new Set(gaps.map((gap) => toYearMonthString(gap.period)))
  return monthsEndingAt(chartEnd(shown, newest)).map((period) => {
    const one = byMonth.get(toYearMonthString(period))
    return { period, came: one?.income, went: one?.expenses, part: short.has(toYearMonthString(period)) }
  })
}

function accountLabel(gap: StatementGap | undefined): string {
  if (gap === undefined) return ''
  return gap.last4 === undefined ? gap.name : `${gap.name.replace(/\s*\d{4}$/, '')} ···${gap.last4}`
}

function Versus({ value }: { value: number | undefined }) {
  if (value === undefined) return null
  return <span className="block text-ink-secondary">{signedPercent(value)} vs 3-month average</span>
}

/** One of the two parts went out is made of: the tracked fixed bills, and the rest. */
function SplitRow({ label, note, value }: { label: string; note?: string; value: string }) {
  return (
    <div className="grid h-[34px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-hairline">
      <span>
        {label}
        {note !== undefined && <span className="text-caption text-ink-secondary"> · {note}</span>}
      </span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  )
}

/** One part of the month's saved, opening the rows, the slips or the goal behind it. */
function SavedRow({ name, note, value, onClick }: { name: string; note: string; value: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid h-[34px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-hairline text-left transition-colors duration-[var(--duration-micro)] hover:bg-surface"
    >
      <span title={name} className="flex min-w-0 items-baseline gap-x-1">
        <Bidi className="min-w-0 truncate">{name}</Bidi>
        <span className="shrink-0 text-caption text-ink-secondary">{note}</span>
      </span>
      <span className="text-right tabular-nums">{value}</span>
    </button>
  )
}

function Total({ label, flow, value }: { label: string; flow: 'in' | 'out' | 'saved'; value: string }) {
  return (
    <div className="grid h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-ink font-medium">
      <span>{label}</span>
      <span className={`text-right tabular-nums ${FLOW_TEXT[flow]}`}>{value}</span>
    </div>
  )
}

/**
 * Every month, newest first — a row opens it above. **A missing statement is a
 * row of its own, with Read** (S2), the way a missing payslip
 * is a row of Paychecks.
 */
function AllMonths({
  summaries,
  taxes,
  gaps,
  open,
  arrived,
  onOpen,
  onRead,
}: {
  summaries: readonly MonthSummary[]
  taxes: ReadonlyMap<string, { minor: number; currency: string }>
  gaps: readonly StatementGap[]
  open: YearMonth
  arrived: ReadonlySet<string>
  onOpen: (month: YearMonth) => void
  onRead: () => void
}) {
  const newestFirst = [...summaries].reverse()
  return (
    <section className="mt-2 flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 text-heading font-medium">All months</h2>
        <span className="text-caption text-ink-secondary">A row opens its month above.</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-hairline text-label text-ink-tertiary uppercase">
              <th className="px-3 py-2 text-left font-medium">Month</th>
              <th className="px-3 py-2 text-right font-medium">Came in</th>
              <th className="px-3 py-2 text-right font-medium">Went out</th>
              <th className="px-3 py-2 text-right font-medium">Saved</th>
              <th className="px-3 py-2 text-right font-medium">Taxes</th>
              <th className="px-3 py-2 text-right font-medium">Left over</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {newestFirst.map((one) => {
              const key = toYearMonthString(one.period)
              const missing = gaps.filter((gap) => toYearMonthString(gap.period) === key)
              const on = compareYearMonths(one.period, open) === 0
              const tax = taxes.get(key)
              return [
                <tr
                  key={key}
                  tabIndex={0}
                  aria-current={on ? 'true' : undefined}
                  onClick={() => onOpen(one.period)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && event.target === event.currentTarget) onOpen(one.period)
                  }}
                  className={`h-10 cursor-pointer border-b border-hairline transition-colors duration-[var(--duration-micro)] ${
                    on ? 'fc-row-on' : 'hover:bg-surface'
                  } ${arrived.has(key) ? 'fc-arrived' : ''}`}
                >
                  <td className="px-3 whitespace-nowrap">
                    {formatYearMonth(one.period)}
                    {missing.length > 0 && <span className="fc-state ml-2" data-tone="negative">
                        <span className="fc-state-dot" />
                        part
                      </span>}
                  </td>
                  <td className="px-3 text-right tabular-nums text-flow-in">{formatMoney(one.income)}</td>
                  <td className="px-3 text-right tabular-nums text-flow-out">{formatMoney(one.expenses)}</td>
                  <td className="px-3 text-right tabular-nums text-flow-saved">{formatMoney(one.saved)}</td>
                  <td className="px-3 text-right tabular-nums text-flow-tax">
                    {tax === undefined ? <span className="text-ink-tertiary">—</span> : formatMoney(tax)}
                  </td>
                  <td className="px-3 text-right tabular-nums">{formatMoney(one.balance)}</td>
                  <td />
                </tr>,
                ...missing.map((gap) => (
                  <tr key={`${key}:${gap.accountId}`} className="h-10 border-b border-hairline text-ink-tertiary">
                    <td className="py-0 pr-3 pl-7 whitespace-nowrap">
                      {accountLabel(gap)} · {formatYearMonth(gap.period)}
                    </td>
                    <td className="px-3" colSpan={5}>
                      No statement read for this month
                    </td>
                    <td className="px-3 text-right">
                      <Button variant="ghost" size="sm" onClick={onRead}>
                        Read
                      </Button>
                    </td>
                  </tr>
                )),
              ]
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <div className="max-w-md">{children}</div>
    </div>
  )
}
