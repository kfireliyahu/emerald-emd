import { useEffect, useRef } from 'react'

import { formatMoney } from '@/core/money.ts'
import { formatPercent } from '@/core/percent.ts'
import type { StarterPlanProposal } from '@/data/repositories/categoryBudgetRepository.ts'
import {
  STARTER_ANSWER_NAME,
  starterWhy,
  starterWindow,
  type StarterAnswer,
  type StarterHeading,
} from '@/domain/starterPlan.ts'
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
  const window = starterWindow(proposal.months)
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
          Start with 50 / 30 / 20
        </h1>
        <p className="m-0 max-w-2xl text-ink-secondary">
          Half to needs, 30% to wants and 20% to saving, each share divided among its categories by what went out under
          each {window === undefined ? '— nothing has gone out yet, so evenly' : `over ${window}`}.{' '}
          {basis === undefined
            ? 'With no paycheck or salary in the ledger yet, the parts are percentages only.'
            : `Of ${formatMoney(basis.amount)} a month, ${basis.fromSalary === undefined ? 'your last paycheck' : 'the salary that came in'}.`}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-hairline text-label text-ink-secondary uppercase">
              <th scope="col" className="py-2 pr-4 font-medium">
                Category
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Counts as
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Part
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                A month
              </th>
              <th scope="col" className="py-2 font-medium">
                Why
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
                  <th scope="row" className={`py-1 pr-4 font-normal ${outOfPlan ? 'text-ink-secondary' : 'text-ink'}`}>
                    <span className="flex max-w-56 min-w-0" title={heading.name}>
                      <Bidi className="min-w-0 truncate">{heading.name}</Bidi>
                    </span>
                  </th>
                  <td className="py-1 pr-4">
                    {fixed ? (
                      <span className="text-caption text-ink-secondary">{STARTER_ANSWER_NAME.NONE}</span>
                    ) : (
                      <span role="group" aria-label={`What ${heading.name} counts as`} className="inline-flex gap-0.5">
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
                            {STARTER_ANSWER_NAME[choice]}
                          </button>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="py-1 pr-4 text-right tabular-nums">{outOfPlan ? '—' : formatPercent(line.basisPoints)}</td>
                  <td className="py-1 pr-4 text-right tabular-nums">{outOfPlan ? '—' : amountOf(heading.id)}</td>
                  <td className={`py-1 text-caption ${line.answer === undefined ? 'text-ink' : 'text-ink-secondary'}`}>
                    {starterWhy(line, proposal.months.length, proposal.currency, proposal.kept.get(heading.id))}
                  </td>
                </tr>
              )
            })}
            {ownName.map((bucket) => (
              <tr key={bucket.share} className="h-10 border-b border-hairline">
                <th scope="row" className="py-1 pr-4 font-normal text-ink">
                  {bucket.name}
                </th>
                <td className="py-1 pr-4 text-caption text-ink-secondary">{STARTER_ANSWER_NAME[bucket.share]}</td>
                <td className="py-1 pr-4 text-right tabular-nums">{formatPercent(bucket.basisPoints)}</td>
                <td className="py-1 pr-4 text-right tabular-nums">{amountOf(bucket.share)}</td>
                <td className="py-1 text-caption text-ink-secondary">
                  No category is {STARTER_ANSWER_NAME[bucket.share].toLowerCase()}: a bucket of its own
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {problem !== undefined ? (
          <p className="m-0 mr-auto text-negative" role="alert">
            {problem}
          </p>
        ) : (
          waiting > 0 && (
            <p className="m-0 mr-auto text-ink-secondary" role="status">
              Say what {waiting === 1 ? 'one category counts' : `${String(waiting)} categories count`} as first.
            </p>
          )
        )}
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={waiting > 0} onClick={onMake}>
          Make plan
        </Button>
      </div>
    </div>
  )
}
