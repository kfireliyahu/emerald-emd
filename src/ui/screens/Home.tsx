import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { minorUnitDigits, money, type CurrencyCode, type Money } from '@/core/money.ts'
import { compareYearMonths, parseYearMonth, toYearMonthString, yearMonthOf, type YearMonth } from '@/core/time.ts'
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
import { waitingCounts } from '@/domain/home.ts'
import type { ComparisonMetric } from '@/domain/statistics.ts'
import { lastFinishedMonth } from '@/domain/statistics.ts'
import type { MonthSummary } from '@/domain/model/statistics.ts'
import { statementGaps } from '@/domain/statementGaps.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { countKey } from '@/i18n/count.ts'
import { useDates, useT } from '@/i18n/current.ts'
import { HeadlineFigure } from '@/ui/charts/HeadlineFigure.tsx'
import { drawn, wholeMoney } from '@/ui/charts/kit.ts'
import { MonthStrip } from '@/ui/charts/MonthStrip.tsx'
import { PlanAgainst } from '@/ui/charts/PlanAgainst.tsx'
import { RankedBars } from '@/ui/charts/RankedBars.tsx'
import { resolvePalette } from '@/ui/charts/categoryPalette.ts'
import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { EmptyState, WaitingList } from '@/ui/components/WaitingList.tsx'
import { GuideLine } from '@/ui/guide/GuideLine.tsx'
import { budgetLines } from '@/ui/home/budgets.ts'
import { HomePanel, WHERE_LIMIT, type Panel } from '@/ui/home/HomePanel.tsx'
import { chartEnd, monthsEndingAt, neighbour, newestWithData, signedPercent, taxVersusAverage, versusAverage } from '@/ui/home/months.ts'
import { Pager, useFilePicker, useReadFiles } from '@/ui/home/parts.tsx'
import { useHomeKeys } from '@/ui/home/useHomeKeys.ts'
import { waitingLine } from '@/ui/home/WaitingList.tsx'
import { today } from '@/ui/today.ts'
import { UNCATEGORIZED_OPTION } from '@/ui/transactions/FilterBar.tsx'

/**
 * **Home · Month** — the report (M64 U5, D-616; the direction D-614, the
 * language D-615). One question: *what happened to my money this month?*
 *
 * **It answers first, in words**: the month said as one sentence, then left
 * over as the screen's one display figure. What is waiting — the questions, the
 * guide — is one quiet strip below the answer, drawn only when something needs
 * the person. Then the four flows as tiles, each opening its breakdown; the
 * fourteen months as the pager; and where it went, with the plan beside it.
 *
 * **Detail opens beside the page** (`SidePanel`), never on a page of its own: a
 * tile its breakdown, a category its rows, a waiting line its answers — and the
 * panel stays open while the months page. What the page used to hold is one
 * click behind what it explains (the keep, move or cut table is D-616's):
 * what came in behind Came in, the bills and the biggest charges behind Went
 * out, what saved was made of behind Saved. The by-month chart and *All months*
 * are the Year screen's, which holds both.
 *
 * **Every figure is the domain's and every figure is ink** (*Figures are ink,
 * a flow is a mark*). The month is `monthlyReport`, the months
 * `monthlySummaries`, taxes `monthlyTaxes`; the screen sums nothing. It opens
 * on the last finished month (D-607).
 */
export function Home() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const navigate = useNavigate()
  const landing = useLocation().state as Landing
  const t = useT()
  const dates = useDates()

  const asOf = today()
  const currency: CurrencyCode = useMemo(() => (db === undefined ? 'ILS' : documentCurrency(db)), [db, revision])
  const summaries = useMemo(
    () => (db === undefined ? [] : monthlySummaries(db, asOf, { currency })),
    [db, revision, currency],
  )
  const taxes = useMemo(() => (db === undefined ? new Map<string, Money>() : monthlyTaxes(db, { currency })), [db, revision, currency])
  const newest = newestWithData(summaries)
  // Home opens on the last finished month, not the one still running (D-607).
  const opening = useMemo(() => lastFinishedMonth(summaries), [summaries])

  const [wanted, setWanted] = useState<YearMonth | undefined>(() =>
    landing?.month === undefined ? undefined : parseYearMonth(landing.month),
  )
  const period = wanted ?? opening
  const [swap, setSwap] = useState<{ side: 'l' | 'r'; turn: number }>({ side: 'r', turn: 0 })
  const [wrote, setWrote] = useState(landing?.wrote)
  const [panel, setPanel] = useState<Panel | undefined>(undefined)

  const report = useMemo(
    () => (db === undefined || period === undefined ? undefined : monthlyReport(db, period, asOf, { currency })),
    [db, revision, period, currency],
  )
  const palette = useMemo(() => resolvePalette(db === undefined ? [] : listCategories(db, { includeArchived: true })), [db, revision])
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
    return <Centered>{t('home.month.noDocument')}</Centered>
  }

  const waiting = waitingCounts(summary.attention).all
  const shown = report?.summary
  const missingHere = period === undefined ? [] : gaps.filter((gap) => compareYearMonths(gap.period, period) === 0)
  const tax = period === undefined ? undefined : taxes.get(toYearMonthString(period))
  const versus = (value: number | undefined): string | undefined =>
    value === undefined ? undefined : t('home.month.versus', { percent: signedPercent(value) })
  const trendOf = (metric: ComparisonMetric): readonly (number | undefined)[] =>
    period === undefined ? [] : recent(summaries, period).map((one) => (one === undefined ? undefined : drawn(pick(one, metric))))
  const open = (next: Panel) => setPanel(next)
  const drillTo = (category?: string): void => {
    if (period === undefined) return
    navigate('/transactions', {
      state: {
        period: toYearMonthString(period),
        ...(category === undefined ? {} : { category, withSubcategories: category !== UNCATEGORIZED_OPTION }),
      },
    })
  }

  const strip = (
    <>
      <WaitingList
        label={t('home.waiting.title')}
        items={summary.attention.map((item) => ({
          key: item.kind,
          ...waitingLine(item, t, dates),
          verb: item.kind === 'UNCATEGORIZED' ? t('home.waiting.uncategorized.action') : t('home.waiting.answer'),
          ...(item.kind === 'UNCATEGORIZED' ? { tour: 'choose-categories' } : {}),
          onDo: () => (item.kind === 'UNCATEGORIZED' ? void navigate(item.to) : open({ kind: 'waiting', item: item.kind })),
        }))}
      />
      {/* Getting started is the guide's line (M28 U9, D-330), in the same strip. */}
      <GuideLine />
    </>
  )

  const page = (
    <div className="fc-view-enter @container flex flex-col gap-8 px-8 pt-6 pb-12">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <h1 className="m-0 text-title leading-tight font-medium" data-guide="home.title" aria-live="polite">
            {period === undefined ? t('home.month.title') : dates.yearMonth(period)}
            {shown !== undefined && !shown.isComplete && (
              <span className="text-heading font-normal text-ink-secondary">{t('home.month.inProgress')}</span>
            )}
          </h1>
          {period !== undefined && (
            <Pager
              label={t('home.month.pager')}
              prev={prev === undefined ? undefined : dates.monthShort(prev)}
              next={next === undefined ? undefined : dates.monthShort(next)}
              onPrev={() => go(prev)}
              onNext={() => go(next)}
            />
          )}
        </div>
        {/* Drop a file anywhere and it is read the same way (the window's drop). */}
        <Button variant="primary" icon="read" onClick={picker.open} title={t('home.month.readFilesTitle')} data-tour="read-files" data-guide="home.read">
          {t('home.month.readFiles')}
        </Button>
        {picker.input}
      </header>

      {wrote !== undefined && (
        <div className="fc-pop-enter flex flex-wrap items-center gap-3 bg-accent-soft px-4 py-2 text-ink-secondary">
          <ActionGlyph name="check" />
          <span className="text-ink">{t('home.month.written', { wrote })}</span>
          <span>
            {waiting === 0 ? t('home.month.flash') : t(countKey('home.month.answersWait', waiting), { count: waiting })}
          </span>
          <Button variant="ghost" size="sm" className="ms-auto" onClick={() => setWrote(undefined)}>
            {t('home.month.dismiss')}
          </Button>
        </div>
      )}

      {/* Before anything is read: one sentence, the strip, and Read files above (M59 U6, D-582). */}
      {summary.isEmpty || period === undefined || report === undefined || shown === undefined ? (
        <>
          <EmptyState say={t('home.month.empty')} />
          {strip}
        </>
      ) : (
        <>
          <div
            key={`${toYearMonthString(period)}:${String(swap.turn)}`}
            className={`flex flex-col gap-6 ${swap.turn === 0 ? '' : `fc-swap-${swap.side}`}`}
          >
            {/* The two amounts carry the sentence's weight, and never break (the comp's). */}
            <p className="m-0 max-w-[26ch] text-lede [text-wrap:balance]">
              <Phrase
                text={
                  shown.income.minor === 0
                    ? t('home.month.sentenceNothingIn', { month: dates.monthName(period) })
                    : t('home.month.sentence', { month: dates.monthName(period) })
                }
                parts={{
                  came: <SaidAmount value={shown.income} />,
                  went: <SaidAmount value={shown.expenses} />,
                }}
              />
            </p>
            <HeadlineFigure
              size="display"
              label={t('home.flows.leftOver')}
              value={shown.balance}
              change={versus(versusAverage(summaries, period, 'balance')) ?? t('home.flows.leftOverHow')}
              empty={t('home.flows.leftOverHow')}
            />
          </div>

          {strip}

          <div className="grid grid-cols-1 gap-x-8 gap-y-6 border-t border-hairline pt-6 @[40rem]:grid-cols-2 @[64rem]:grid-cols-4" data-block>
            <HeadlineFigure
              label={t('home.flows.cameIn')}
              value={shown.income}
              change={versus(versusAverage(summaries, period, 'income'))}
              trend={trendOf('income')}
              empty={t('home.month.cameInEmpty')}
              onOpen={() => open({ kind: 'in' })}
            />
            <HeadlineFigure
              label={t('home.flows.wentOut')}
              value={shown.expenses}
              change={
                missingHere.length > 0
                  ? t(countKey('home.month.missing', missingHere.length), { count: missingHere.length })
                  : versus(versusAverage(summaries, period, 'expenses'))
              }
              trend={trendOf('expenses')}
              empty={t('home.month.whereEmpty')}
              onOpen={() => open({ kind: 'out' })}
            />
            <HeadlineFigure
              label={t('home.flows.saved')}
              value={shown.saved}
              change={versus(versusAverage(summaries, period, 'saved'))}
              trend={trendOf('saved')}
              empty={t('home.month.savedEmpty')}
              onOpen={() => open({ kind: 'saved' })}
            />
            <HeadlineFigure
              label={t('home.flows.taxes')}
              value={tax}
              change={versus(taxVersusAverage(taxes, period, currency))}
              trend={monthsEndingAt(period, TREND_MONTHS).map((month) => {
                const one = taxes.get(toYearMonthString(month))
                return one === undefined ? undefined : drawn(one)
              })}
              empty={t('home.month.noPaycheck')}
              onOpen={() => open({ kind: 'tax' })}
            />
          </div>

          <section className="flex flex-col gap-3" aria-labelledby="home-months">
            <h2 id="home-months" className="m-0 text-heading font-medium">
              {t('home.month.stripLabel')}
            </h2>
            <MonthStrip
              months={monthsEndingAt(chartEnd(period, newest ?? period)).map((month) => {
                const key = toYearMonthString(month)
                const one = summaries.find((each) => toYearMonthString(each.period) === key)
                return {
                  key,
                  label: dates.monthAbbrev(month),
                  long: dates.yearMonth(month),
                  value: one === undefined ? undefined : drawn(one.balance),
                  // Hollow is the month still running, never a past month with a statement missing.
                  running: compareYearMonths(month, yearMonthOf(asOf)) === 0,
                  note: gaps.some((gap) => toYearMonthString(gap.period) === key) ? t('home.month.stripMissing') : undefined,
                }
              })}
              open={monthsEndingAt(chartEnd(period, newest ?? period)).findIndex((month) => compareYearMonths(month, period) === 0)}
              label={t('home.month.stripLabel')}
              empty={t('home.month.stripEmpty')}
              format={(value) => wholeMoney(money(Math.round(value * 10 ** minorUnitDigits(currency)), currency))}
              onOpen={(index) => go(monthsEndingAt(chartEnd(period, newest ?? period))[index])}
            />
          </section>

          <div
            key={`cols:${toYearMonthString(period)}:${String(swap.turn)}`}
            className={`grid grid-cols-1 gap-x-12 gap-y-8 @[52rem]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] ${swap.turn === 0 ? '' : `fc-swap-${swap.side}`}`}
          >
            <section className="flex flex-col gap-3" aria-labelledby="home-where">
              <h2 id="home-where" className="m-0 text-heading font-medium">
                {t('home.month.whereItWent')}
              </h2>
              <RankedBars
                rows={report.categories.map((line) => ({
                  key: line.categoryId ?? UNCATEGORIZED_OPTION,
                  name: line.name,
                  value: line.outflow,
                  tour: `went-${line.categoryId ?? 'none'}`,
                  ...(line.categoryId === undefined
                    ? { note: t(countKey('home.month.uncategorizedRows', line.transactionCount), { count: line.transactionCount }) }
                    : {}),
                }))}
                limit={WHERE_LIMIT}
                empty={t('home.month.whereEmpty')}
                total={{ label: t('home.flows.wentOut'), value: shown.expenses }}
                onOpen={(key) => open({ kind: 'category', id: key })}
                onMore={() => open({ kind: 'rest' })}
              />
            </section>
            {budgeted.length > 0 && (
              <section className="flex flex-col gap-3" aria-labelledby="home-plan">
                <h2 id="home-plan" className="m-0 text-heading font-medium">
                  {t('home.month.againstPlan')}
                </h2>
                <PlanAgainst
                  lines={budgeted.map((line) => ({ key: line.categoryId, name: line.name, actual: line.spent, planned: line.budget }))}
                  empty={t('home.month.planEmpty')}
                  onOpen={(key) => open({ kind: 'category', id: key })}
                />
              </section>
            )}
          </div>
        </>
      )}
    </div>
  )

  return (
    <div className="flex h-full">
      <div className="h-full min-w-0 flex-1 overflow-auto">{page}</div>
      {panel !== undefined && period !== undefined && report !== undefined && (
        <HomePanel
          panel={panel}
          period={period}
          report={report}
          largest={largest}
          tax={tax}
          attention={summary.attention}
          currency={currency}
          palette={palette}
          onPanel={setPanel}
          onRead={picker.open}
          onDrill={drillTo}
          onClose={() => setPanel(undefined)}
        />
      )}
    </div>
  )
}

/** What a Write asked Home to open on, and what it wrote. */
type Landing = { readonly month?: string; readonly arrived?: readonly string[]; readonly wrote?: string } | null

/** How many months a tile's trend draws, the open one last. */
const TREND_MONTHS = 6

/** The months a tile's trend draws, oldest first, the open one last; a month with no data is nothing. */
function recent(summaries: readonly MonthSummary[], period: YearMonth): readonly (MonthSummary | undefined)[] {
  const byMonth = new Map(summaries.map((one) => [toYearMonthString(one.period), one]))
  return monthsEndingAt(period, TREND_MONTHS).map((month) => byMonth.get(toYearMonthString(month)))
}

function pick(summary: MonthSummary, metric: ComparisonMetric): Money {
  switch (metric) {
    case 'income':
      return summary.income
    case 'expenses':
      return summary.expenses
    case 'saved':
      return summary.saved
    case 'balance':
      return summary.balance
  }
}

/** An amount inside the month's sentence: whole units, medium, kept on one line. */
function SaidAmount({ value }: { readonly value: Money }) {
  return (
    <span className="font-medium whitespace-nowrap" dir="ltr">
      {wholeMoney(value)}
    </span>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <div className="max-w-md">{children}</div>
    </div>
  )
}
