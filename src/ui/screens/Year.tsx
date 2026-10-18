import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { formatMoney, type CurrencyCode, type Money } from '@/core/money.ts'
import { formatPercent } from '@/core/percent.ts'
import {
  addMonths,
  compareYearMonths,
  formatMonthName,
  formatYearMonth,
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
    return <Centered>Open a document, or create one, to see the year.</Centered>
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
              Home · Year · {overview.monthsWithData} of 12 months in this document
            </span>
            <h1 className="m-0 text-[24px] leading-tight font-medium tracking-[-0.01em]">{year}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="secondary" size="sm" icon="read" onClick={picker.open} title="Read files (Ctrl+Shift+O)">
              Read files
            </Button>
            {picker.input}
            <Pager
              label="Year"
              prev={prev === undefined ? undefined : String(prev)}
              next={next === undefined ? undefined : String(next)}
              onPrev={() => prev !== undefined && setWanted(prev)}
              onNext={() => next !== undefined && setWanted(next)}
            />
          </div>
        </header>

        {overview.monthsWithData === 0 ? (
          <p className="max-w-prose text-ink-secondary">
            Nothing in {year}. Read a statement for a month of it, or page to a year the document holds.
          </p>
        ) : (
          <>
            <Figures>
              <Figure label="Came in" flow="in" value={overview.income}>
                net pay and other money in
              </Figure>
              <Figure label="Went out" flow="out" value={overview.expenses}>
                {overview.averageExpenses === undefined
                  ? 'on the date money left the account'
                  : `${formatMoney(overview.averageExpenses)} a month, typically`}
              </Figure>
              <Figure label="Saved" flow="saved" value={overview.saved}>
                {overview.savingsRateBasisPoints === undefined
                  ? 'moved to savings, goals and funds'
                  : `${formatPercent(overview.savingsRateBasisPoints)} of what came in`}
              </Figure>
              <Figure label="Taxes" flow="tax" value={yearTax}>
                {payroll.slips === 0
                  ? 'no paychecks this year'
                  : `off ${String(payroll.slips)} ${payroll.slips === 1 ? 'paycheck' : 'paychecks'}`}
              </Figure>
              <Figure label="Left over" flow={undefined} value={overview.balance}>
                came in, less went out
              </Figure>
            </Figures>

            {payroll.slips > 0 && (
              <p className="m-0 text-ink-secondary">
                Off the paychecks: gross {formatMoney(payroll.gross)}, of which taxes{' '}
                <span className="text-flow-tax tabular-nums">{formatMoney(payroll.tax)}</span>
                {payroll.taxRateBasisPoints === undefined ? '' : ` (${formatPercent(payroll.taxRateBasisPoints)})`}.
              </p>
            )}

            <div className="flex flex-col gap-2">
              <YearBars months={months} byMonth={byMonth} short={data.short} onOpen={open} />
              <Legend>
                <Key flow="in" bar>
                  Came in
                </Key>
                <Key flow="out" bar>
                  Went out
                </Key>
                <Key flow="saved" bar>
                  Saved
                </Key>
                <span>A dashed box is a month not in this document</span>
                <span className="ml-auto">A month opens it in Month</span>
              </Legend>
            </div>

            <section className="flex flex-col gap-3">
              <BlockHead title="Where it went, and how it moved" aside="each category, month by month" />
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
                      <span className="text-right font-mono text-caption text-ink-secondary">{count} mo</span>
                      <span className="text-right tabular-nums">{formatMoney(line.outflow)}</span>
                    </div>
                  )
                })}
                <div className="grid h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-ink font-medium">
                  <span>Went out</span>
                  <span className={`text-right tabular-nums ${FLOW_TEXT.out}`}>{formatMoney(overview.expenses)}</span>
                </div>
              </div>
            </section>

            <div className="grid grid-cols-1 gap-8 @[56rem]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
              <section className="flex flex-col gap-3">
                <BlockHead title="Where it actually goes, by shop" />
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-hairline text-label text-ink-tertiary uppercase">
                      <th className="px-3 py-2 text-left font-medium">Merchant</th>
                      <th className="px-3 py-2 text-left font-medium">Usually</th>
                      <th className="px-3 py-2 text-right font-medium">Months</th>
                      <th className="px-3 py-2 text-right font-medium">All of it</th>
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
                          <Bidi>{one.categoryName ?? 'Uncategorized'}</Bidi>
                        </td>
                        <td className="px-3 text-right tabular-nums">{one.months}</td>
                        <td className="px-3 text-right tabular-nums">{formatMoney(one.outflow)}</td>
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
              <h2 className="m-0 text-heading font-medium">The months</h2>
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
                    </tr>
                  </thead>
                  <tbody>
                    {months.map((period) => {
                      const key = toYearMonthString(period)
                      const one = byMonth.get(key)
                      if (one === undefined) {
                        return (
                          <tr key={key} className="h-10 border-b border-hairline text-ink-tertiary">
                            <td className="px-3">{formatYearMonth(period)}</td>
                            <td className="px-3" colSpan={5}>
                              {compareYearMonths(period, newestWithData(summaries) ?? period) > 0
                                ? 'Not yet'
                                : 'Not in this document'}
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
                          <td className="px-3 whitespace-nowrap">{formatYearMonth(period)}</td>
                          <td className="px-3 text-right tabular-nums text-flow-in">{formatMoney(one.income)}</td>
                          <td className="px-3 text-right tabular-nums text-flow-out">{formatMoney(one.expenses)}</td>
                          <td className="px-3 text-right tabular-nums text-flow-saved">{formatMoney(one.saved)}</td>
                          <td className="px-3 text-right tabular-nums text-flow-tax">
                            {tax === undefined ? <span className="text-ink-tertiary">—</span> : formatMoney(tax)}
                          </td>
                          <td className="px-3 text-right tabular-nums">{formatMoney(one.balance)}</td>
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
    <figure ref={width.ref} className="m-0">
      <svg
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        className="block h-auto w-full overflow-visible"
        aria-label="Came in, went out and saved by month. Choose a month to open it."
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
                  {formatMonthName(period).slice(0, 3)}
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
              aria-label={`${formatYearMonth(period)}, open it`}
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
                  part
                </text>
              )}
              <text className="fc-col-tick" x={cx} y={H - 6} textAnchor="middle">
                {formatMonthName(period).slice(0, 3)}
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
  if (now === undefined || then === undefined) return null
  const rows: readonly [string, 'in' | 'out' | 'saved' | 'tax', Money | undefined, Money | undefined][] = [
    ['Came in', 'in', then.income, now.income],
    ['Went out', 'out', then.expenses, now.expenses],
    ['Saved', 'saved', then.saved, now.saved],
    ['Taxes', 'tax', taxes.get(toYearMonthString(ago)), taxes.get(toYearMonthString(latest))],
  ]
  return (
    <section className="flex flex-col gap-3">
      <BlockHead title="The same month, a year apart" />
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-hairline text-label text-ink-tertiary uppercase">
            <th className="px-3 py-2" />
            <th className="px-3 py-2 text-right font-medium">{formatYearMonth(ago)}</th>
            <th className="px-3 py-2 text-right font-medium">{formatYearMonth(latest)}</th>
            <th className="px-3 py-2 text-right font-medium">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, flow, before, after]) => (
            <tr key={label} className="h-[34px] border-b border-hairline">
              <td className="px-3">{label}</td>
              <td className={`px-3 text-right tabular-nums ${FLOW_TEXT[flow]}`}>{before === undefined ? '—' : formatMoney(before)}</td>
              <td className={`px-3 text-right tabular-nums ${FLOW_TEXT[flow]}`}>{after === undefined ? '—' : formatMoney(after)}</td>
              <td className="px-3 text-right text-ink-secondary tabular-nums">{change(before, after)}</td>
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
