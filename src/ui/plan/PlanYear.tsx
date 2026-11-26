import { useMemo, useState } from 'react'

import { money, type Money } from '@/core/money.ts'
import { addMonths, yearMonthOf } from '@/core/time.ts'
import { listCategories } from '@/data/repositories/categoryRepository.ts'
import { planYearAgainstActual } from '@/data/repositories/planMonthRepository.ts'
import { planYearByKind, type PlanYearLine, type PlanYearTotal } from '@/domain/planYear.ts'
import { useDates, useT, type Translate } from '@/i18n/current.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { HeadlineFigure } from '@/ui/charts/HeadlineFigure.tsx'
import { wholeMoney } from '@/ui/charts/kit.ts'
import { PlanAgainst, type PlanLine } from '@/ui/charts/PlanAgainst.tsx'
import { useCategoryPalette } from '@/ui/components/CategoryMark.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { SidePanel } from '@/ui/components/SidePanel.tsx'
import { Pager } from '@/ui/home/parts.tsx'
import { columnsOf, sectionBuckets } from '@/ui/plan/bucketGroups.ts'
import { bucketColour } from '@/ui/plan/planLook.ts'
import { today } from '@/ui/today.ts'

/**
 * **Plan's Year: how much went to each bucket this year, out of what was planned** — M64 F12
 * (D-631). The maintainer, 2026-11-26: *"if i had a monthly bucket id like to see how much total in
 * the year went to the bucket out of planned."*
 *
 * One question — *how did the year go against the plan?* — answered first: one sentence and one
 * figure, **the categories apart from the goals and debts**, since spending past a category's plan
 * is a problem and putting more into a goal or onto a debt is not. Then each bucket as a
 * `PlanAgainst` meter of what it got from January through the last month that is over, against the
 * sum of what each of those months' plans gave it, in the month's two columns; a bucket opens its
 * months beside the page. The figures are the domain's (`planYearAgainstActual` and
 * `planYearByKind`, on Home's month basis, D-607), and `plan_month` with a `year` says the same.
 */
export function PlanYear() {
  const t = useT()
  const dates = useDates()
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const asOf = useMemo(() => today(), [])
  // The newest year with a month that is over: in January, last year.
  const newest = addMonths(yearMonthOf(asOf), -1).year
  const [year, setYear] = useState(newest)
  const [open, setOpen] = useState<string | undefined>()

  const categories = useMemo(() => (db === undefined ? [] : listCategories(db)), [db, revision])
  const palette = useCategoryPalette(categories)
  const found = useMemo(
    () => (db === undefined ? undefined : planYearAgainstActual(db, year, asOf)),
    [db, revision, year, asOf],
  )

  if (db === undefined) return null

  // The open year in ink before the pager, as the month tab shows its month.
  const header = (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <h1 className="m-0 text-title leading-tight font-medium">{t('plan.year.title', { year })}</h1>
      <div className="flex items-center gap-3">
        <span className="font-medium tabular-nums">{year}</span>
        <Pager
          label={t('plan.year.pager')}
          prev={String(year - 1)}
          next={year < newest ? String(year + 1) : undefined}
          onPrev={() => {
            setOpen(undefined)
            setYear(year - 1)
          }}
          onNext={() => {
            setOpen(undefined)
            setYear(Math.min(newest, year + 1))
          }}
        />
      </div>
    </header>
  )

  const shell = (body: React.ReactNode, side?: React.ReactNode) => (
    <div className="flex h-full">
      <div className="h-full min-w-0 flex-1 overflow-auto">
        <div className="fc-view-enter @container flex flex-col gap-8 px-8 pt-6 pb-12">
          {header}
          {body}
        </div>
      </div>
      {side}
    </div>
  )
  const lede = (text: React.ReactNode) => <p className="m-0 max-w-[40ch] text-lede [text-wrap:balance]">{text}</p>

  if (found === undefined) return shell(lede(t('plan.year.noPlan')))
  const { reading, through } = found
  if (through === undefined || reading.months.length === 0) return shell(lede(t('plan.year.nothingYet', { year })))

  const span = { from: dates.monthName({ year, month: 1 }), to: dates.yearMonth(through) }
  const { spent, into } = planYearByKind(reading, reading.planned.currency)
  const lead = spent ?? into
  const answer =
    lead === undefined ? (
      t('plan.year.nothing', span)
    ) : (
      <>
        <Phrase
          text={sentence(t, spent === undefined ? 'into-first' : 'spent', lead)}
          parts={{ from: span.from, to: span.to, gap: <SaidAmount value={size(lead.variance)} /> }}
        />
        {spent !== undefined && into !== undefined && (
          <>
            {' '}
            <Phrase text={sentence(t, 'into', into)} parts={{ gap: <SaidAmount value={size(into.variance)} /> }} />
          </>
        )}
      </>
    )

  const sections = sectionBuckets(reading.lines, (line) => line.bucket)
  const chosen = reading.lines.find((line) => line.bucket.id === open)

  return shell(
    <>
      <div className="flex flex-col gap-6">
        {lede(answer)}
        {lead !== undefined && (
          <HeadlineFigure
            size="display"
            label={figureLabel(t, spent !== undefined, lead)}
            value={size(lead.variance)}
            change={t('plan.year.figureOf', { planned: wholeMoney(lead.planned) })}
            empty={t('plan.year.nothing', span)}
          />
        )}
      </div>
      <section className="flex flex-col gap-4 border-t border-hairline pt-6" aria-labelledby="plan-year-buckets">
        <div className="flex flex-col gap-1">
          <h2 id="plan-year-buckets" className="m-0 text-heading font-medium">
            {t('plan.year.buckets')}
          </h2>
          <p className="m-0 text-caption text-ink-secondary">{t('plan.year.lead')}</p>
        </div>
        <div className="grid grid-cols-1 gap-x-12 gap-y-6 @[52rem]:grid-cols-2">
          {columnsOf(sections).map((section, index) => (
            <div key={`${String(index)}:${section.name}`} className="flex flex-col">
              {section.name !== '' && (
                <h3 className="m-0 border-b border-hairline-strong pb-2 font-medium">
                  <Bidi>{section.name}</Bidi>
                </h3>
              )}
              <PlanAgainst
                lines={section.rows.map((line) => ({ ...meter(t, line), mark: bucketColour(line.bucket, palette) }))}
                empty={t('plan.page.noBuckets')}
                onOpen={(id) => setOpen(id)}
              />
            </div>
          ))}
        </div>
      </section>
    </>,
    chosen === undefined ? undefined : (
      <SidePanel kicker={t('plan.year.span', span)} title={<Bidi>{chosen.bucket.name}</Bidi>} onClose={() => setOpen(undefined)}>
        <BucketMonths line={chosen} />
      </SidePanel>
    ),
  )
}

type Kind = 'spent' | 'into' | 'into-first'

/** The answer's sentence for one kind of bucket: over or under said in words, never by sign. */
function sentence(t: Translate, kind: Kind, total: PlanYearTotal): string {
  const gap = total.variance.minor
  if (kind === 'spent') return t(gap > 0 ? 'plan.year.spentOver' : gap < 0 ? 'plan.year.spentUnder' : 'plan.year.spentOn')
  if (kind === 'into') return t(gap > 0 ? 'plan.year.intoMore' : gap < 0 ? 'plan.year.intoLess' : 'plan.year.intoOn')
  return t(gap > 0 ? 'plan.year.intoMoreFirst' : gap < 0 ? 'plan.year.intoLessFirst' : 'plan.year.intoOnFirst')
}

function figureLabel(t: Translate, categories: boolean, total: PlanYearTotal): string {
  const gap = total.variance.minor
  if (categories) return t(gap > 0 ? 'plan.year.figureOver' : gap < 0 ? 'plan.year.figureUnder' : 'plan.year.figureOn')
  return t(gap > 0 ? 'plan.year.figureMore' : gap < 0 ? 'plan.year.figureLess' : 'plan.year.figureInto')
}

/**
 * One bucket's meter. Only a category over its plan is left to the meter's own red *over*; under
 * or on the plan is said in words (a year that is over has nothing *left*), and a goal or a debt
 * that got more or less says so without red. A bucket no month measured shows what was planned.
 */
function meter(t: Translate, line: PlanYearLine): PlanLine {
  const base = { key: line.bucket.id, name: line.bucket.name, actual: line.actual }
  if (line.months.length === line.unmeasured) {
    return {
      ...base,
      planned: plannedInAll(line),
      unknown: line.bucket.targetKind === 'CATEGORY' ? t('plan.year.unknown') : t('plan.year.plannedNothing'),
    }
  }
  const gap = line.variance.minor
  const amount = wholeMoney(size(line.variance))
  const category = line.bucket.targetKind === 'CATEGORY'
  const note =
    gap === 0
      ? t('plan.year.gapOn')
      : category
        ? gap < 0
          ? t('plan.year.gapUnder', { amount })
          : undefined
        : t(gap > 0 ? 'plan.year.gotMore' : 'plan.year.gotLess', { amount })
  return { ...base, planned: line.planned, note }
}

/** A bucket's months: each one's plan, what it got, how far over or under, and the year's total. */
function BucketMonths({ line }: { readonly line: PlanYearLine }) {
  const t = useT()
  const dates = useDates()
  const category = line.bucket.targetKind === 'CATEGORY'
  const gapSaid = (gap: number | undefined, amount: Money): string =>
    gap === undefined
      ? t('plan.year.notMeasured')
      : gap === 0
        ? t('plan.year.gapOn')
        : t(
            category ? (gap > 0 ? 'plan.year.gapOver' : 'plan.year.gapUnder') : gap > 0 ? 'plan.year.gapMore' : 'plan.year.gapLess',
            { amount: wholeMoney(size(amount)) },
          )
  const red = (gap: number | undefined): string => (category && gap !== undefined && gap > 0 ? 'text-negative' : 'text-ink-secondary')
  const measured = line.months.length > line.unmeasured
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-ink-secondary">
        {line.over + line.under === 0
          ? t('plan.year.panelOn')
          : t(category ? 'plan.year.panelSpent' : 'plan.year.panelInto', { over: line.over, under: line.under, n: line.months.length })}
      </p>
      <table className="w-full border-collapse">
        <thead>
          <tr className="h-8 border-b border-hairline-strong text-caption text-ink-secondary">
            <th scope="col" className="pe-3 text-start font-normal">{t('plan.year.column.month')}</th>
            <th scope="col" className="pe-3 text-end font-normal">{t('plan.year.column.planned')}</th>
            <th scope="col" className="pe-3 text-end font-normal">{t('plan.year.column.got')}</th>
            <th scope="col" className="text-end font-normal">{t('plan.year.column.gap')}</th>
          </tr>
        </thead>
        <tbody>
          {line.months.map((one) => {
            const gap = one.actual === undefined ? undefined : one.actual.minor - one.planned.minor
            return (
              <tr key={`${String(one.period.year)}-${String(one.period.month)}`} className="h-10 border-b border-hairline">
                <td className="pe-3">{dates.monthName(one.period)}</td>
                <td className="pe-3 text-end tabular-nums" dir="ltr">
                  {wholeMoney(one.planned)}
                </td>
                <td className="pe-3 text-end tabular-nums" dir="ltr">
                  {one.actual === undefined ? '—' : wholeMoney(one.actual)}
                </td>
                <td className={`text-end tabular-nums ${red(gap)}`}>{gapSaid(gap, money(gap ?? 0, one.planned.currency))}</td>
              </tr>
            )
          })}
        </tbody>
        {measured && (
          <tfoot>
            <tr className="h-10 border-t border-hairline-strong font-medium">
              <th scope="row" className="pe-3 text-start font-medium">{t('plan.year.total')}</th>
              <td className="pe-3 text-end tabular-nums" dir="ltr">
                {wholeMoney(line.planned)}
              </td>
              <td className="pe-3 text-end tabular-nums" dir="ltr">
                {wholeMoney(line.actual)}
              </td>
              <td className={`text-end tabular-nums ${red(line.variance.minor)}`}>{gapSaid(line.variance.minor, line.variance)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

/** A gap's size, for words that say which way it went. */
function size(value: Money): Money {
  return money(Math.abs(value.minor), value.currency)
}

/** What every month planned a bucket no month could measure: shown beside what says so. */
function plannedInAll(line: PlanYearLine): Money {
  return money(
    line.months.reduce((total, one) => total + one.planned.minor, 0),
    line.planned.currency,
  )
}

/** An amount inside the answer: whole units, medium, kept on one line. */
function SaidAmount({ value }: { readonly value: Money }) {
  return (
    <span className="font-medium whitespace-nowrap" dir="ltr">
      {wholeMoney(value)}
    </span>
  )
}
