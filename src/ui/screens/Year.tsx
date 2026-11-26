import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { formatMoney, minorUnitDigits, money, type CurrencyCode, type Money } from '@/core/money.ts'
import { formatPercent } from '@/core/percent.ts'
import { addMonths, compareYearMonths, toYearMonthString, yearMonthOf, type YearMonth } from '@/core/time.ts'
import { accountMonths } from '@/data/repositories/homeRepository.ts'
import { categoryMerchants } from '@/data/repositories/categoryRepository.ts'
import {
  categoryMonths,
  documentCurrency,
  merchantTotals,
  monthlySummaries,
  monthlyTaxes,
  payrollYear,
  yearCategoryObservations,
  yearlyReport,
} from '@/data/repositories/statisticsRepository.ts'
import type { MonthSummary } from '@/domain/model/statistics.ts'
import { statementGaps } from '@/domain/statementGaps.ts'
import { categoryBreakdown } from '@/domain/statistics.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { countKey } from '@/i18n/count.ts'
import { useDates, useT } from '@/i18n/current.ts'
import { HeadlineFigure } from '@/ui/charts/HeadlineFigure.tsx'
import { drawn, wholeMoney } from '@/ui/charts/kit.ts'
import { MonthTrend } from '@/ui/charts/MonthTrend.tsx'
import { RankedBars } from '@/ui/charts/RankedBars.tsx'
import { shortText } from '@/ui/charts/chart.ts'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { SidePanel } from '@/ui/components/SidePanel.tsx'
import { EmptyState, WaitingList } from '@/ui/components/WaitingList.tsx'
import { monthsOfYear, newestWithData, signedPercent, yearsWithData } from '@/ui/home/months.ts'
import { Pager, useFilePicker, useReadFiles } from '@/ui/home/parts.tsx'
import { useHomeKeys } from '@/ui/home/useHomeKeys.ts'
import { today } from '@/ui/today.ts'

/** What the Year's panel holds: a total's breakdown, one category's months, or the rest of them. */
type Panel =
  | { readonly kind: 'shops' }
  | { readonly kind: 'tax' }
  | { readonly kind: 'rest' }
  | { readonly kind: 'category'; readonly id: string }

/** How many categories the page ranks before the rest fold into one line. */
const MOVED_LIMIT = 6

/**
 * **Year** — the report (M64 U11, D-623; the direction D-614, the language
 * D-615). One question: *how did this year go, month by month?*
 *
 * **It answers first, in words**: the year said as one sentence, then what was
 * left over as the screen's one display figure. A month missing a statement is
 * one line below the answer. Then the four totals as tiles against last year,
 * the months as a trend with every month's figures under it — **the one place
 * every month is read and opened**, since Home moved its All months and its
 * by-month chart here (D-616) — and where it went, each category with how it
 * moved.
 *
 * **A month opens on Home**: a row of the months, or a month on the trend.
 * **Detail opens beside the page** (`SidePanel`): a category its months and its
 * shops, Went out the shops of the year, Taxes what the paychecks say. The same
 * month a year apart is the trend's dashed line, not a table of its own.
 *
 * The figures are the domain's: the year is `yearlyReport`, the payslips' gross
 * and tax are `payrollYear`, the categories `categoryBreakdown` over the year
 * and over each month of it. The screen sums nothing.
 */
export function Year() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const navigate = useNavigate()
  const asOf = today()
  const t = useT()
  const dates = useDates()

  const currency: CurrencyCode = useMemo(() => (db === undefined ? 'ILS' : documentCurrency(db)), [db, revision])
  const summaries = useMemo(
    () => (db === undefined ? [] : monthlySummaries(db, asOf, { currency })),
    [db, revision, currency],
  )
  const years = yearsWithData(summaries)
  const [wanted, setWanted] = useState<number | undefined>()
  const [panel, setPanel] = useState<Panel | undefined>()
  const year = wanted ?? newestWithData(summaries)?.year ?? asOf.year

  const data = useMemo(() => {
    if (db === undefined) return undefined
    const months = monthsOfYear(year)
    const from = months[0] ?? { year, month: 1 }
    const to = months[11] ?? { year, month: 12 }
    const byMonth = categoryMonths(db, from, to, { currency })
    const perMonth = new Map(
      [...byMonth].map(([key, observations]) => [key, categoryBreakdown(observations)] as const),
    )
    return {
      overview: yearlyReport(db, year, asOf, { currency }),
      before: yearlyReport(db, year - 1, asOf, { currency }),
      payroll: payrollYear(db, year, { currency }),
      categories: categoryBreakdown(yearCategoryObservations(db, year, { currency })),
      perMonth,
      merchants: merchantTotals(db, from, to, { currency, limit: 12 }),
      taxes: monthlyTaxes(db, { currency }),
      short: new Set(
        statementGaps(accountMonths(db), newestWithData(summaries)).map((gap) => toYearMonthString(gap.period)),
      ),
    }
  }, [db, revision, year, currency, summaries])

  const readFiles = useReadFiles()
  const picker = useFilePicker(readFiles)
  const at = years.indexOf(year)
  const prev = at > 0 ? years[at - 1] : undefined
  const next = at >= 0 && at < years.length - 1 ? years[at + 1] : undefined
  const page = (target: number | undefined): void => {
    if (target !== undefined) setWanted(target)
  }
  useHomeKeys({ page: (step) => page(step === -1 ? prev : next), readFiles: picker.open })

  if (db === undefined || data === undefined) {
    return <Centered>{t('home.year.noDocument')}</Centered>
  }

  const { overview, before, payroll } = data
  const months = monthsOfYear(year)
  const byMonth = new Map(summaries.map((one) => [toYearMonthString(one.period), one]))
  const yearTax = payroll.slips === 0 ? undefined : payroll.tax
  const openMonth = (period: YearMonth): void => void navigate('/', { state: { month: toYearMonthString(period) } })
  const newest = newestWithData(summaries)
  const running = year === yearMonthOf(asOf).year
  const short = months.filter((period) => data.short.has(toYearMonthString(period)))
  // Two years are compared only month for month: a year of three months against
  // one of twelve says nothing about either.
  const comparable = before.monthsWithData > 0 && before.monthsWithData === overview.monthsWithData
  const versus = (now: Money, then: Money): string | undefined => {
    if (!comparable || then.minor === 0) return undefined
    const percent = Math.round(((now.minor - then.minor) * 100) / Math.abs(then.minor))
    return t('home.year.versus', { percent: signedPercent(percent), year: year - 1 })
  }
  const amount = (value: number): string => wholeMoney(money(Math.round(value * 10 ** minorUnitDigits(currency)), currency))
  const trendOf = (pick: (one: MonthSummary) => Money): readonly (number | undefined)[] =>
    months.map((period) => {
      const one = byMonth.get(toYearMonthString(period))
      return one === undefined ? undefined : drawn(pick(one))
    })
  // The same month a year apart (was its own table): what went out then, beside what went out now.
  const yearBefore = (period: YearMonth): MonthSummary | undefined => byMonth.get(toYearMonthString(addMonths(period, -12)))
  const showBefore = months.some((period) => yearBefore(period) !== undefined)
  const categoryTrend = (categoryId: string | undefined) =>
    months.map((period) => {
      const lines = data.perMonth.get(toYearMonthString(period))
      if (lines === undefined) return undefined
      const minor = lines.find((one) => one.categoryId === categoryId)?.outflow.minor ?? 0
      return minor / 10 ** minorUnitDigits(currency)
    })

  const pageBody = (
    <div className="fc-view-enter @container flex flex-col gap-8 px-8 pt-6 pb-12">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <h1 className="m-0 text-title leading-tight font-medium tabular-nums" aria-live="polite">
          {year}
        </h1>
        <Pager
          label={t('home.year.pager')}
          prev={prev === undefined ? undefined : String(prev)}
          next={next === undefined ? undefined : String(next)}
          onPrev={() => page(prev)}
          onNext={() => page(next)}
        />
        {picker.input}
      </header>

      {overview.monthsWithData === 0 ? (
        <EmptyState say={t('home.year.nothing', { year })} verb={t('home.year.readFiles')} onDo={picker.open} />
      ) : (
        <>
          <div key={year} className="flex flex-col gap-6">
            <p className="m-0 max-w-[30ch] text-lede [text-wrap:balance]">
              {/* The tiles below carry the amounts: the sentence says which way the year went. */}
              {t(
                overview.income.minor >= overview.expenses.minor
                  ? running ? 'home.year.moreInSoFar' : 'home.year.moreIn'
                  : running ? 'home.year.moreOutSoFar' : 'home.year.moreOut',
                { year },
              )}
            </p>
            <HeadlineFigure
              size="display"
              label={t('home.flows.leftOver')}
              value={overview.balance}
              change={versus(overview.balance, before.balance) ?? t('home.flows.leftOverHow')}
              empty={t('home.flows.leftOverHow')}
            />
          </div>

          <WaitingList
            label={t('home.year.waiting')}
            items={
              short.length === 0
                ? []
                : [
                    {
                      key: 'missing',
                      say: t(countKey('home.year.missing', short.length), { count: short.length }),
                      why: t('home.year.missingWhy', { months: short.map((period) => dates.monthName(period)).join(', ') }),
                      verb: t('home.year.readFiles'),
                      onDo: picker.open,
                    },
                  ]
            }
          />

          <div className="grid grid-cols-1 gap-x-8 gap-y-6 border-t border-hairline pt-6 @[40rem]:grid-cols-2 @[64rem]:grid-cols-4" data-block>
            <HeadlineFigure
              label={t('home.flows.cameIn')}
              value={overview.income}
              trend={trendOf((one) => one.income)}
              change={versus(overview.income, before.income)}
              empty={t('home.flows.cameInNone')}
            />
            <HeadlineFigure
              label={t('home.flows.wentOut')}
              value={overview.expenses}
              trend={trendOf((one) => one.expenses)}
              change={
                versus(overview.expenses, before.expenses) ??
                (overview.averageExpenses === undefined
                  ? undefined
                  : t('home.year.typically', { amount: formatMoney(overview.averageExpenses) }))
              }
              empty={t('home.flows.wentOutWhen')}
              onOpen={() => setPanel({ kind: 'shops' })}
            />
            <HeadlineFigure
              label={t('home.flows.saved')}
              value={overview.saved}
              trend={trendOf((one) => one.saved)}
              change={
                overview.savingsRateBasisPoints === undefined
                  ? undefined
                  : t('home.year.rate', { percent: formatPercent(overview.savingsRateBasisPoints) })
              }
              empty={t('home.flows.savedNone')}
            />
            <HeadlineFigure
              label={t('home.flows.taxes')}
              value={yearTax}
              change={payroll.slips === 0 ? undefined : t(countKey('home.year.offPaychecks', payroll.slips), { count: payroll.slips })}
              empty={t('home.year.noPaychecks')}
              {...(payroll.slips === 0 ? {} : { onOpen: () => setPanel({ kind: 'tax' }) })}
            />
          </div>

          <section className="flex flex-col gap-3" aria-labelledby="year-months">
            <h2 id="year-months" className="m-0 text-heading font-medium">
              {t('home.year.theMonths')}
            </h2>
            {/* Every month, read and opened here since Home moved its All months off (D-616): a row opens it on Home. */}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-hairline text-caption text-ink-secondary">
                    <th className="px-3 py-2 text-start font-medium">{t('home.flows.month')}</th>
                    <th className="px-3 py-2 text-end font-medium">{t('home.flows.cameIn')}</th>
                    <th className="px-3 py-2 text-end font-medium">{t('home.flows.wentOut')}</th>
                    <th className="px-3 py-2 text-end font-medium">{t('home.flows.saved')}</th>
                    <th className="px-3 py-2 text-end font-medium">{t('home.flows.taxes')}</th>
                    <th className="px-3 py-2 text-end font-medium">{t('home.flows.leftOver')}</th>
                    {showBefore && <th className="px-3 py-2 text-end font-medium">{t('home.year.wentOutIn', { year: year - 1 })}</th>}
                  </tr>
                </thead>
                <tbody>
                  {months.map((period) => {
                    const key = toYearMonthString(period)
                    const one = byMonth.get(key)
                    if (one === undefined) {
                      return (
                        <tr key={key} className="h-10 border-b border-hairline text-ink-secondary">
                          <td className="px-3 whitespace-nowrap">{dates.yearMonth(period)}</td>
                          <td className="px-3" colSpan={showBefore ? 6 : 5}>
                            {compareYearMonths(period, newest ?? period) > 0 ? t('home.year.notYet') : t('home.year.notHeld')}
                          </td>
                        </tr>
                      )
                    }
                    const tax = data.taxes.get(key)
                    const ago = yearBefore(period)
                    return (
                      <tr
                        key={key}
                        tabIndex={0}
                        aria-label={t('home.year.openMonth', { month: dates.yearMonth(period) })}
                        onClick={() => openMonth(period)}
                        data-month-row
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget) return
                          if (event.key === 'Enter') openMonth(period)
                          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                            event.preventDefault()
                            const rows = [...(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[data-month-row]') ?? [])]
                            rows[rows.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1)]?.focus()
                          }
                        }}
                        className="h-10 cursor-pointer border-b border-hairline transition-colors duration-[var(--duration-micro)] hover:bg-surface focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                      >
                        <td className="px-3 whitespace-nowrap">
                          {dates.yearMonth(period)}
                          {data.short.has(key) && <span className="ms-2 text-caption text-ink-secondary">{t('home.flows.part')}</span>}
                          {compareYearMonths(period, yearMonthOf(asOf)) === 0 && (
                            <span className="ms-2 text-caption text-ink-secondary">{t('home.year.soFar')}</span>
                          )}
                        </td>
                        <td className="px-3 text-end tabular-nums">{formatMoney(one.income)}</td>
                        <td className="px-3 text-end tabular-nums">{formatMoney(one.expenses)}</td>
                        <td className="px-3 text-end tabular-nums">{formatMoney(one.saved)}</td>
                        <td className="px-3 text-end tabular-nums">{tax === undefined ? '—' : formatMoney(tax)}</td>
                        <td className="px-3 text-end tabular-nums">{formatMoney(one.balance)}</td>
                        {showBefore && (
                          <td className="px-3 text-end text-ink-secondary tabular-nums">
                            {ago === undefined ? "—" : formatMoney(ago.expenses)}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="year-moved">
            <h2 id="year-moved" className="m-0 text-heading font-medium">
              {t('home.year.moved')}
            </h2>
            <RankedBars
              rows={data.categories.map((line) => ({
                key: line.categoryId ?? 'none',
                name: line.name,
                value: line.outflow,
                trend: categoryTrend(line.categoryId),
              }))}
              limit={MOVED_LIMIT}
              empty={t('home.year.movedEmpty', { year })}
              total={{ label: t('home.flows.wentOut'), value: overview.expenses }}
              onOpen={(key) => setPanel({ kind: 'category', id: key })}
              onMore={() => setPanel({ kind: 'rest' })}
            />
          </section>
        </>
      )}
    </div>
  )

  const closePanel = (): void => setPanel(undefined)
  const panelBody = (() => {
    if (panel === undefined || overview.monthsWithData === 0) return undefined
    const kicker = String(year)
    if (panel.kind === 'tax') {
      return (
        <SidePanel kicker={kicker} title={t('home.flows.taxes')} onClose={closePanel}>
          <p className="m-0">
            <Phrase
              text={t('home.year.payroll')}
              parts={{
                gross: <span className="tabular-nums">{formatMoney(payroll.gross)}</span>,
                tax: <span className="tabular-nums">{formatMoney(payroll.tax)}</span>,
                rate:
                  payroll.taxRateBasisPoints === undefined
                    ? ''
                    : t('home.year.payrollRate', { percent: formatPercent(payroll.taxRateBasisPoints) }),
              }}
            />
          </p>
          <button type="button" className="fc-text-action self-start" onClick={() => void navigate('/paychecks')}>
            {t('home.year.openPaychecks')}
          </button>
        </SidePanel>
      )
    }
    if (panel.kind === 'shops') {
      return (
        <SidePanel kicker={kicker} title={t('home.year.byShop')} onClose={closePanel}>
          <RankedBars
            rows={data.merchants.map((one) => ({
              key: one.merchantNormalized,
              name: one.merchantRaw,
              value: one.outflow,
              note: t('home.year.shopNote', {
                category: one.categoryName ?? t('home.flows.uncategorized'),
                count: one.months,
              }),
            }))}
            limit={data.merchants.length}
            empty={t('home.year.movedEmpty', { year })}
            onOpen={(key) => {
              const one = data.merchants.find((each) => each.merchantNormalized === key)
              if (one !== undefined) void navigate('/transactions', { state: { search: one.merchantRaw } })
            }}
          />
        </SidePanel>
      )
    }
    if (panel.kind === 'rest') {
      return (
        <SidePanel kicker={kicker} title={t('home.year.moved')} onClose={closePanel}>
          <RankedBars
            rows={data.categories.slice(MOVED_LIMIT).map((line) => ({
              key: line.categoryId ?? 'none',
              name: line.name,
              value: line.outflow,
              trend: categoryTrend(line.categoryId),
            }))}
            limit={data.categories.length}
            empty={t('home.year.movedEmpty', { year })}
            onOpen={(key) => setPanel({ kind: 'category', id: key })}
          />
        </SidePanel>
      )
    }
    const id = panel.id === 'none' ? undefined : panel.id
    const line = data.categories.find((one) => (one.categoryId ?? 'none') === panel.id)
    if (line === undefined) return undefined
    const shops =
      id === undefined
        ? []
        : categoryMerchants(db, id, toYearMonthString(months[0]!), toYearMonthString(months[11]!), currency, 6)
    return (
      <SidePanel kicker={kicker} title={line.name} onClose={closePanel}>
        <HeadlineFigure label={t('home.flows.wentOut')} value={line.outflow} empty={t('home.year.movedEmpty', { year })} />
        <MonthTrend
          months={months.map((period) => ({ key: toYearMonthString(period), label: dates.monthAbbrev(period), long: dates.yearMonth(period) }))}
          series={[{ key: 'out', name: line.name, values: categoryTrend(line.categoryId) }]}
          label={t('home.year.categoryTrend', { name: line.name })}
          empty={t('home.year.movedEmpty', { year })}
          format={amount}
          tick={(value) => shortText(value, { currency })}
          onOpen={(index) => {
            const period = months[index]
            if (period !== undefined && byMonth.has(toYearMonthString(period))) openMonth(period)
          }}
        />
        {shops.length > 0 && (
          <section className="flex flex-col gap-2" aria-labelledby="year-shops">
            <h3 id="year-shops" className="m-0 text-body font-medium">
              {t('home.year.whereItGoes')}
            </h3>
            <RankedBars
              rows={shops.map((one) => ({ key: one.merchantRaw, name: one.merchantRaw, value: money(one.outflowMinor, currency) }))}
              limit={shops.length}
              empty=""
            />
          </section>
        )}
        <button
          type="button"
          className="fc-text-action self-start"
          onClick={() => void navigate('/transactions', { state: id === undefined ? {} : { category: id, withSubcategories: true } })}
        >
          {t('home.year.itsRows')}
        </button>
      </SidePanel>
    )
  })()

  return (
    <div className="flex h-full">
      <div className="h-full min-w-0 flex-1 overflow-auto">{pageBody}</div>
      {panelBody}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <div className="max-w-md">{children}</div>
    </div>
  )
}
