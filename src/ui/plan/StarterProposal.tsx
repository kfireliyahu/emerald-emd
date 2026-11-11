import { useEffect, useRef } from 'react'

import { formatMoney, money, type CurrencyCode } from '@/core/money.ts'
import { formatPercent } from '@/core/percent.ts'
import type { YearMonth } from '@/core/time.ts'
import type { StarterPlanProposal } from '@/data/repositories/categoryBudgetRepository.ts'
import type { StarterAnswer, StarterHeading, StarterLine } from '@/domain/starterPlan.ts'
import { type Translate, useDates, useT } from '@/i18n/current.ts'
import type { DateWords } from '@/i18n/dates.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'

/** What a category can be given, in the order the starter reads them. */
const CHOICES: readonly StarterAnswer[] = ['NEEDS', 'WANTS', 'SAVING', 'NONE']

/**
 * **The 50 / 30 / 20 starter, before anything is made** (M59 U4, D-580).
 *
 * *Start with 50 / 30 / 20* used to make the plan at once, and a person who
 * opened it saw buckets without knowing why Transport was a need or why Health
 * got nothing. So the button opens this: every top-level category with the
 * share it counts as, its part of the plan, what that comes to a month and why,
 * and each share changeable in place. The months what went out was read over
 * are named once, above the table. *Make plan* writes exactly this; *Cancel*
 * writes nothing. `start_plan` shows the same rows to a conversation.
 */
export function StarterProposal({
  proposal,
  onChoose,
  onMake,
  onCancel,
  problem,
}: {
  proposal: StarterPlanProposal
  onChoose: (heading: StarterHeading, answer: StarterAnswer) => void
  onMake: () => void
  onCancel: () => void
  /** Why Make plan did not make it, when it did not. */
  problem?: string | undefined
}) {
  // The keyboard lands on the proposal it opened, not back on the page's start.
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])
  const t = useT()
  const dates = useDates()
  const basis = proposal.basis
  const amountOf = (key: string): string => {
    const amount = proposal.amounts.get(key)
    return amount === undefined ? '—' : formatMoney(amount)
  }
  const ownName = proposal.buckets.filter((one) => one.categoryId === undefined)
  const waiting = proposal.unanswered.length

  return (
    <div
      className="fc-view-enter mx-auto flex w-full max-w-4xl flex-col gap-5 px-6 py-8"
      data-guide="plan.split plan.fixed"
      data-testid="starter-proposal"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel()
      }}
    >
      <div className="flex flex-col gap-2">
        <h1 ref={heading} tabIndex={-1} className="m-0 text-title focus:outline-none">
          {t('plan.starter.title')}
        </h1>
        <p className="m-0 max-w-2xl text-ink-secondary">
          {leadWords(t, dates, proposal.months)}{' '}
          {basis === undefined
            ? t('plan.starter.noBasis')
            : t(basis.fromSalary === undefined ? 'plan.starter.basisPaycheck' : 'plan.starter.basisSalary', {
                amount: formatMoney(basis.amount),
              })}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-start">
          <thead>
            <tr className="border-b border-hairline text-label text-ink-secondary uppercase">
              <th scope="col" className="py-2 pe-4 font-medium">
                {t('plan.starter.column.category')}
              </th>
              <th scope="col" className="py-2 pe-4 font-medium">
                {t('plan.starter.column.countsAs')}
              </th>
              <th scope="col" className="py-2 pe-4 text-end font-medium">
                {t('plan.starter.column.part')}
              </th>
              <th scope="col" className="py-2 pe-4 text-end font-medium">
                {t('plan.starter.column.aMonth')}
              </th>
              <th scope="col" className="py-2 font-medium">
                {t('plan.starter.column.why')}
              </th>
            </tr>
          </thead>
          <tbody>
            {proposal.lines.map((line) => {
              const { heading } = line
              const fixed = line.placedBy === 'NOT_SPLIT'
              const outOfPlan = line.basisPoints === 0
              return (
                <tr key={heading.name} className="h-10 border-b border-hairline" data-category={heading.id}>
                  <th scope="row" className={`py-1 pe-4 font-normal ${outOfPlan ? 'text-ink-secondary' : 'text-ink'}`}>
                    <span className="flex max-w-56 min-w-0" title={heading.name}>
                      <Bidi className="min-w-0 truncate">{heading.name}</Bidi>
                    </span>
                  </th>
                  <td className="py-1 pe-4">
                    {fixed ? (
                      <span className="text-caption text-ink-secondary">{t('plan.starter.answer.NONE')}</span>
                    ) : (
                      <span role="group" aria-label={t('plan.starter.countsAsLabel', { name: heading.name })} className="inline-flex gap-0.5">
                        {CHOICES.map((choice) => (
                          <button
                            key={choice}
                            type="button"
                            aria-pressed={line.answer === choice}
                            onClick={() => onChoose(heading, choice)}
                            className={`h-7 px-2 text-caption whitespace-nowrap ${
                              line.answer === choice
                                ? 'bg-elevated font-medium text-ink'
                                : 'text-ink-secondary hover:bg-surface hover:text-ink'
                            }`}
                          >
                            {t(`plan.starter.answer.${choice}`)}
                          </button>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="py-1 pe-4 text-end tabular-nums">{outOfPlan ? '—' : formatPercent(line.basisPoints)}</td>
                  <td className="py-1 pe-4 text-end tabular-nums">{outOfPlan ? '—' : amountOf(heading.id)}</td>
                  <td className={`py-1 text-caption ${line.answer === undefined ? 'text-ink' : 'text-ink-secondary'}`}>
                    {whyWords(t, line, proposal.months.length, proposal.currency, proposal.kept.get(heading.id))}
                  </td>
                </tr>
              )
            })}
            {ownName.map((bucket) => (
              <tr key={bucket.share} className="h-10 border-b border-hairline">
                <th scope="row" className="py-1 pe-4 font-normal text-ink">
                  {bucket.name}
                </th>
                <td className="py-1 pe-4 text-caption text-ink-secondary">{t(`plan.starter.answer.${bucket.share}`)}</td>
                <td className="py-1 pe-4 text-end tabular-nums">{formatPercent(bucket.basisPoints)}</td>
                <td className="py-1 pe-4 text-end tabular-nums">{amountOf(bucket.share)}</td>
                <td className="py-1 text-caption text-ink-secondary">
                  {t('plan.starter.ownBucket', { share: t(`plan.starter.answer.${bucket.share}`).toLowerCase() })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {problem !== undefined ? (
          <p className="m-0 me-auto text-negative" role="alert">
            {problem}
          </p>
        ) : (
          waiting > 0 && (
            <p className="m-0 me-auto text-ink-secondary" role="status">
              {waiting === 1 ? t('plan.starter.waitingOne') : t('plan.starter.waitingMany', { n: waiting })}
            </p>
          )
        )}
        <Button variant="secondary" onClick={onCancel}>
          {t('plan.starter.cancel')}
        </Button>
        <Button variant="primary" disabled={waiting > 0} onClick={onMake}>
          {t('plan.starter.make')}
        </Button>
      </div>
    </div>
  )
}

/**
 * The months what went out was read over, said once, in the language now — the
 * screen's own words for `starterWindow` and `starterWhy`, which stay English
 * for `start_plan` (D-583: what a model reads stays English; M60 U5, D-590).
 */
function leadWords(t: Translate, dates: DateWords, months: readonly YearMonth[]): string {
  const first = months[0]
  const last = months.at(-1)
  if (first === undefined || last === undefined) return t('plan.starter.leadEvenly')
  if (months.length === 1) return t('plan.starter.leadOverOne', { window: dates.yearMonth(last) })
  const from = first.year === last.year ? dates.monthAbbrev(first) : dates.monthShort(first)
  return t('plan.starter.leadOverRange', { from, to: dates.monthShort(last) })
}

/** Why a heading is where it is and how its part was sized: *Needs by default · ₪1,200.00 a month went out*. */
function whyWords(
  t: Translate,
  line: StarterLine,
  months: number,
  currency: CurrencyCode,
  keptBucket: string | undefined,
): string {
  const { heading, answer, placedBy } = line
  const share = t(`plan.starter.answer.${answer ?? 'NONE'}`)
  const placed =
    placedBy === 'DEFAULT'
      ? t('plan.starter.why.byDefault', { answer: share })
      : placedBy === 'KIND'
        ? t(heading.kind === 'SAVING' ? 'plan.starter.why.savingCategory' : 'plan.starter.why.debtIsNeed')
        : placedBy === 'CHOSEN'
          ? t('plan.starter.why.chosen')
          : placedBy === 'NOT_SPLIT'
            ? t(
                heading.kind === 'INCOME'
                  ? 'plan.starter.why.income'
                  : heading.kind === 'TRANSFER'
                    ? 'plan.starter.why.moved'
                    : 'plan.starter.why.unsorted',
              )
            : t('plan.starter.why.ask')
  const sized =
    line.sizedBy === 'SPENT'
      ? t('plan.starter.why.spent', {
          amount: formatMoney(money(Math.round(heading.spentMinor / Math.max(1, months)), currency)),
        })
      : line.sizedBy === 'EVENLY'
        ? t('plan.starter.why.evenly')
        : line.sizedBy === 'WHOLE'
          ? t('plan.starter.why.whole', { share: share.toLowerCase() })
          : line.sizedBy === 'NOTHING_OUT'
            ? t('plan.starter.why.nothingOut')
            : undefined
  const kept = keptBucket === undefined || line.basisPoints === 0 ? undefined : t('plan.starter.why.keeps', { name: keptBucket })
  return [placed, sized, kept].filter((part) => part !== undefined).join(' · ')
}
