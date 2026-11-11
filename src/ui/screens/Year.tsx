import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { formatMoney, type CurrencyCode, type Money } from '@/core/money.ts'
import { formatPercent } from '@/core/percent.ts'
import {
  addMonths,
  compareYearMonths,
  toYearMonthString,
  type YearMonth,
} from '@/core/time.ts'
import { accountMonths } from '@/data/repositories/homeRepository.ts'
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
import { fillNodes } from '@/i18n/nodes.tsx'
import { Bidi } from '@/ui/Bidi.tsx'
import { useWidth } from '@/ui/charts/useWidth.ts'
import { monthsOfYear, newestWithData, yearsWithData } from '@/ui/home/months.ts'
import { BlockHead, Figure, Figures, FLOW_TEXT, Key, Legend, Pager, useFilePicker, useReadFiles } from '@/ui/home/parts.tsx'
import { useHomeKeys } from '@/ui/home/useHomeKeys.ts'
import { Button } from '@/ui/components/Button.tsx'
import { today } from '@/ui/today.ts'

/**
 * **Home · Year** — M28 U5, the approved mockup.
 *
 * **January to December, paged by year** (choice 4, A): a year is
 * the calendar's, and a month the document does not hold is a dashed box, not a
 * zero. **Trends is part of it now** (choice 5): each category's line beside its
 * total, the merchants, and the same month a year apart are the year's, and
 * `#/trends` lands here.
 *
 * The figures are the domain's: the year is `yearlyReport`, the payslips'
 * gross and tax are `payrollYear`, the categories are `categoryBreakdown` over
 * the year and over each month of it. A month opens in Month.
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
      payroll: payrollYear(db, year, { currency }),
      categories: categoryBreakdown(yearCategoryObservations(db, year, { currency })),
      perMonth,
      merchants: merchantTotals(db, from, to, { currency, limit: 8 }),
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
  useHomeKeys({
    page: (step) => {
      const target = step === -1 ? prev : next
      if (target !== undefined) setWanted(target)
    },
    readFiles: picker.open,
  })

  if (db === undefined || data === undefined) {
    return <Centered>{t('home.year.noDocument')}</Centered>
  }

  const { overview, payroll } = data
  const months = monthsOfYear(year)
  const byMonth = new Map(summaries.map((one) => [toYearMonthString(one.period), one]))
  const yearTax = payroll.slips === 0 ? undefined : payroll.tax
  const open = (period: YearMonth): void => void navigate('/', { state: { month: toYearMonthString(period) } })
  const latest = [...months].reverse().find((period) => byMonth.has(toYearMonthString(period)))
  const ago = latest === undefined ? undefined : addMonths(latest, -12)

  return (
    <div className="h-full overflow-auto">
      <div className="fc-view-enter @container flex flex-col gap-6 px-8 pt-6 pb-12">
        <header className="flex flex-wrap items-end justify-between gap-6 border-b border-hairline pb-4">
          <div className="flex flex-col gap-1.5">
            <span className="fc-label text-ink-secondary uppercase tabular-nums">
              {t('home.year.eyebrow', { count: overview.monthsWithData })}
            </span>
            <h1 className="m-0 text-[24px] leading-tight font-medium tracking-[-0.01em]">{year}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="secondary" size="sm" icon="read" onClick={picker.open} title={t('home.year.readFilesTitle')}>
              {t('home.year.readFiles')}
            </Button>
            {picker.input}
            <Pager
              label={t('home.year.pager')}
              prev={prev === undefined ? undefined : String(prev)}
              next={next === undefined ? undefined : String(next)}
              onPrev={() => prev !== undefined && setWanted(prev)}
              onNext={() => next !== undefined && setWanted(next)}
            />
          </div>
        </header>

        {overview.monthsWithData === 0 ? (
          <p className="max-w-prose text-ink-secondary">
            {t('home.year.nothing', { year })}
          </p>
        ) : (
          <>
            <Figures>
              <Figure label={t('home.flows.cameIn')} flow="in" value={overview.income}>
                {t('home.flows.cameInNone')}
              </Figure>
              <Figure label={t('home.flows.wentOut')} flow="out" value={overview.expenses}>
                {overview.averageExpenses === undefined
                  ? t('home.flows.wentOutWhen')
                  : t('home.year.typically', { amount: formatMoney(overview.averageExpenses) })}
              </Figure>
              <Figure label={t('home.flows.saved')} flow="saved" value={overview.saved}>
                {overview.savingsRateBasisPoints === undefined
                  ? t('home.flows.savedNone')
                  : t('home.year.rate', { percent: formatPercent(overview.savingsRateBasisPoints) })}
              </Figure>
              <Figure label={t('home.flows.taxes')} flow="tax" value={yearTax}>
                {payroll.slips === 0
                  ? t('home.year.noPaychecks')
                  : t(countKey('home.year.offPaychecks', payroll.slips), { count: payroll.slips })}
              </Figure>
              <Figure label={t('home.flows.leftOver')} flow={undefined} value={overview.balance}>
                {t('home.flows.leftOverHow')}
              </Figure>
            </Figures>

            {payroll.slips > 0 && (
              <p className="m-0 text-ink-secondary">
                {fillNodes(t('home.year.payroll'), {
                  gross: formatMoney(payroll.gross),
                  tax: <span className="text-flow-tax tabular-nums">{formatMoney(payroll.tax)}</span>,
                  rate:
                    payroll.taxRateBasisPoints === undefined
                      ? ''
                      : t('home.year.payrollRate', { percent: formatPercent(payroll.taxRateBasisPoints) }),
                })}
              </p>
            )}

            <div className="flex flex-col gap-2">
              <YearBars months={months} byMonth={byMonth} short={data.short} onOpen={open} />
              <Legend>
                <Key flow="in" bar>
                  {t('home.flows.cameIn')}
                </Key>
                <Key flow="out" bar>
                  {t('home.flows.wentOut')}
                </Key>
                <Key flow="saved" bar>
                  {t('home.flows.saved')}
                </Key>
                <span>{t('home.year.legendDashed')}</span>
                <span className="ms-auto">{t('home.year.legendOpens')}</span>
              </Legend>
            </div>

            <section className="flex flex-col gap-3">
              <BlockHead title={t('home.year.moved')} aside={t('home.year.movedAside')} />
              <div>
                {data.categories.map((line) => {
                  const key = line.categoryId ?? 'none'
                  const series = months.map((period) => {
                    const lines = data.perMonth.get(toYearMonthString(period))
                    if (lines === undefined) return undefined
                    return lines.find((one) => one.categoryId === line.categoryId)?.outflow.minor ?? 0
                  })
                  const count = series.filter((value) => value !== undefined && value > 0).length
                  return (
                    <div
                      key={key}
                      className="grid h-[34px] grid-cols-[minmax(0,1fr)_140px_64px_110px] items-center gap-3 border-b border-hairline"
                    >
                      <span className="flex min-w-0">
                        <Bidi className="min-w-0 truncate">{line.name}</Bidi>
                      </span>
                      <Spark series={series} />
                      <span className="text-end font-mono text-caption text-ink-secondary">{t('home.year.monthsCount', { count })}</span>
                      <span className="text-end tabular-nums">{formatMoney(line.outflow)}</span>
                    </div>
                  )
                })}
                <div className="grid h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-ink font-medium">
                  <span>{t('home.flows.wentOut')}</span>
                  <span className={`text-end tabular-nums ${FLOW_TEXT.out}`}>{formatMoney(overview.expenses)}</span>
                </div>
              </div>
            </section>

            <div className="grid grid-cols-1 gap-8 @[56rem]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
              <section className="flex flex-col gap-3">
                <BlockHead title={t('home.year.byShop')} />
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-hairline text-label text-ink-tertiary uppercase">
                      <th className="px-3 py-2 text-start font-medium">{t('home.year.merchant')}</th>
                      <th className="px-3 py-2 text-start font-medium">{t('home.year.usually')}</th>
                      <th className="px-3 py-2 text-end font-medium">{t('home.year.months')}</th>
                      <th className="px-3 py-2 text-end font-medium">{t('home.year.allOfIt')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.merchants.map((one) => (
                      <tr
                        key={one.merchantNormalized}
                        className="h-10 cursor-pointer border-b border-hairline transition-colors duration-[var(--duration-micro)] hover:bg-surface"
                        onClick={() => navigate('/transactions', { state: { search: one.merchantRaw } })}
                      >
                        <td className="px-3">
                          <Bidi>{one.merchantRaw}</Bidi>
                        </td>
                        <td className="px-3 text-ink-secondary">
                          <Bidi>{one.categoryName ?? t('home.flows.uncategorized')}</Bidi>
                        </td>
                        <td className="px-3 text-end tabular-nums">{one.months}</td>
                        <td className="px-3 text-end tabular-nums">{formatMoney(one.outflow)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              {latest !== undefined && ago !== undefined && byMonth.has(toYearMonthString(ago)) && (
                <YearApart
                  latest={latest}
                  ago={ago}
                  now={byMonth.get(toYearMonthString(latest))}
                  then={byMonth.get(toYearMonthString(ago))}
                  taxes={data.taxes}
                />
              )}
            </div>

            <section className="flex flex-col gap-3">
              <h2 className="m-0 text-heading font-medium">{t('home.year.theMonths')}</h2>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-hairline text-label text-ink-tertiary uppercase">
                      <th className="px-3 py-2 text-start font-medium">{t('home.flows.month')}</th>
                      <th className="px-3 py-2 text-end font-medium">{t('home.flows.cameIn')}</th>
                      <th className="px-3 py-2 text-end font-medium">{t('home.flows.wentOut')}</th>
                      <th className="px-3 py-2 text-end font-medium">{t('home.flows.saved')}</th>
                      <th className="px-3 py-2 text-end font-medium">{t('home.flows.taxes')}</th>
                      <th className="px-3 py-2 text-end font-medium">{t('home.flows.leftOver')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {months.map((period) => {
                      const key = toYearMonthString(period)
                      const one = byMonth.get(key)
                      if (one === undefined) {
                        return (
                          <tr key={key} className="h-10 border-b border-hairline text-ink-tertiary">
                            <td className="px-3">{dates.yearMonth(period)}</td>
                            <td className="px-3" colSpan={5}>
                              {compareYearMonths(period, newestWithData(summaries) ?? period) > 0
                                ? t('home.year.notYet')
                                : t('home.year.notHeld')}
                            </td>
                          </tr>
                        )
                      }
                      const tax = data.taxes.get(key)
                      return (
                        <tr
                          key={key}
                          tabIndex={0}
                          onClick={() => open(period)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && event.target === event.currentTarget) open(period)
                          }}
                          className="h-10 cursor-pointer border-b border-hairline transition-colors duration-[var(--duration-micro)] hover:bg-surface"
                        >
                          <td className="px-3 whitespace-nowrap">{dates.yearMonth(period)}</td>
                          <td className="px-3 text-end tabular-nums text-flow-in">{formatMoney(one.income)}</td>
                          <td className="px-3 text-end tabular-nums text-flow-out">{formatMoney(one.expenses)}</td>
                          <td className="px-3 text-end tabular-nums text-flow-saved">{formatMoney(one.saved)}</td>
                          <td className="px-3 text-end tabular-nums text-flow-tax">
                            {tax === undefined ? <span className="text-ink-tertiary">—</span> : formatMoney(tax)}
                          </td>
                          <td className="px-3 text-end tabular-nums">{formatMoney(one.balance)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * The year as bars: came in, went out and saved for each month, in their flows'
 * colours; a month the document does not hold is a dashed box. A month is a
 * button that opens it in Month.
 */
function YearBars({
  months,
  byMonth,
  short,
  onOpen,
}: {
  months: readonly YearMonth[]
  byMonth: ReadonlyMap<string, MonthSummary>
  short: ReadonlySet<string>
  onOpen: (period: YearMonth) => void
}) {
  const t = useT()
  const dates = useDates()
  const width = useWidth()
  const W = width.value
  const H = 190
  const pad = { top: 24, bottom: 26, side: 10 }
  const values = months.flatMap((period) => {
    const one = byMonth.get(toYearMonthString(period))
    return one === undefined ? [] : [one.income.minor, one.expenses.minor, one.saved.minor]
  })
  const high = Math.max(1, ...values) * 1.08
  const column = (W - pad.side * 2) / 12
  const bar = Math.min(18, column / 4)
  const tall = (minor: number): number => ((H - pad.top - pad.bottom) * Math.max(0, minor)) / high
  const base = H - pad.bottom

  return (
    <figure ref={width.ref} className="m-0" dir="ltr">
      <svg
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        className="block h-auto w-full overflow-visible"
        aria-label={t('home.year.barsLabel')}
      >
        {months.map((period, index) => {
          const key = toYearMonthString(period)
          const one = byMonth.get(key)
          const cx = pad.side + column * index + column / 2
          if (one === undefined) {
            return (
              <g key={key} aria-hidden>
                <rect
                  x={cx - column / 2 + 6}
                  y={pad.top}
                  width={Math.max(0, column - 12)}
                  height={H - pad.top - pad.bottom}
                  fill="none"
                  stroke="var(--color-hairline-strong)"
                  strokeDasharray="3 3"
                />
                <text className="fc-col-tick" x={cx} y={H - 6} textAnchor="middle">
                  {dates.monthAbbrev(period)}
                </text>
              </g>
            )
          }
          return (
            <g
              key={key}
              className="fc-col"
              role="button"
              tabIndex={0}
              aria-label={t('home.year.openMonth', { month: dates.yearMonth(period) })}
              onClick={() => onOpen(period)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onOpen(period)
                }
              }}
            >
              <rect className="fc-col-hit" x={cx - column / 2} y={0} width={column} height={H - pad.bottom + 4} />
              <rect className="fc-col-sel" x={cx - column / 2 + 0.5} y={0.5} width={Math.max(0, column - 1)} height={H - pad.bottom + 3} />
              <rect x={cx - bar * 1.5 - 2} y={base - tall(one.income.minor)} width={bar} height={tall(one.income.minor)} className="fill-flow-in" />
              <rect x={cx - bar / 2} y={base - tall(one.expenses.minor)} width={bar} height={tall(one.expenses.minor)} className="fill-flow-out" />
              <rect x={cx + bar / 2 + 2} y={base - tall(one.saved.minor)} width={bar} height={tall(one.saved.minor)} className="fill-flow-saved" />
              {short.has(key) && (
                <text x={cx} y={base - tall(one.expenses.minor) - 6} textAnchor="middle" className="fc-col-part">
                  {t('home.flows.part')}
                </text>
              )}
              <text className="fc-col-tick" x={cx} y={H - 6} textAnchor="middle">
                {dates.monthAbbrev(period)}
              </text>
            </g>
          )
        })}
      </svg>
    </figure>
  )
}

/** One category's year as a line — what Trends drew one at a time. A gap is a month not held. */
function Spark({ series }: { series: readonly (number | undefined)[] }) {
  const values = series.filter((value): value is number => value !== undefined)
  if (values.length < 2) return <span aria-hidden />
  const high = Math.max(...values)
  const low = Math.min(...values)
  const w = 140
  const h = 22
  let d = ''
  let open = false
  series.forEach((value, index) => {
    if (value === undefined) {
      open = false
      return
    }
    const x = (index * (w - 4)) / 11 + 2
    const y = h - 3 - ((h - 6) * (value - low)) / (high - low || 1)
    d += `${open ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
    open = true
  })
  return (
    <svg width={w} height={h} viewBox={`0 0 ${String(w)} ${String(h)}`} aria-hidden className="block">
      <path d={d} fill="none" stroke="var(--color-ink-secondary)" strokeWidth={1.25} />
    </svg>
  )
}

/** The same month, a year apart — the comparison seasonality does not confound. Was on Trends. */
function YearApart({
  latest,
  ago,
  now,
  then,
  taxes,
}: {
  latest: YearMonth
  ago: YearMonth
  now: MonthSummary | undefined
  then: MonthSummary | undefined
  taxes: ReadonlyMap<string, Money>
}) {
  const t = useT()
  const dates = useDates()
  if (now === undefined || then === undefined) return null
  const rows: readonly [string, 'in' | 'out' | 'saved' | 'tax', Money | undefined, Money | undefined][] = [
    [t('home.flows.cameIn'), 'in', then.income, now.income],
    [t('home.flows.wentOut'), 'out', then.expenses, now.expenses],
    [t('home.flows.saved'), 'saved', then.saved, now.saved],
    [t('home.flows.taxes'), 'tax', taxes.get(toYearMonthString(ago)), taxes.get(toYearMonthString(latest))],
  ]
  return (
    <section className="flex flex-col gap-3">
      <BlockHead title={t('home.year.yearApart')} />
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-hairline text-label text-ink-tertiary uppercase">
            <th className="px-3 py-2" />
            <th className="px-3 py-2 text-end font-medium">{dates.yearMonth(ago)}</th>
            <th className="px-3 py-2 text-end font-medium">{dates.yearMonth(latest)}</th>
            <th className="px-3 py-2 text-end font-medium">{t('home.year.change')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, flow, before, after]) => (
            <tr key={flow} className="h-[34px] border-b border-hairline">
              <td className="px-3">{label}</td>
              <td className={`px-3 text-end tabular-nums ${FLOW_TEXT[flow]}`}>{before === undefined ? '—' : formatMoney(before)}</td>
              <td className={`px-3 text-end tabular-nums ${FLOW_TEXT[flow]}`}>{after === undefined ? '—' : formatMoney(after)}</td>
              <td className="px-3 text-end text-ink-secondary tabular-nums">{change(before, after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function change(before: Money | undefined, after: Money | undefined): string {
  if (before === undefined || after === undefined || before.minor === 0) return '—'
  const percent = Math.round(((after.minor - before.minor) * 100) / before.minor)
  return `${percent >= 0 ? '+' : '−'}${String(Math.abs(percent))}%`
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <div className="max-w-md">{children}</div>
    </div>
  )
}
