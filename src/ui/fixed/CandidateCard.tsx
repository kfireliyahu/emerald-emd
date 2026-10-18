import { useState } from 'react'

import { formatMoney } from '@/core/money.ts'
import { formatPercent } from '@/core/percent.ts'
import { formatMonthShort, toISODate } from '@/core/time.ts'
import { CADENCES, type Cadence, type FixedExpenseCandidate } from '@/domain/model/fixed.ts'
import { coverageBasisPoints } from '@/domain/fixedExpenses.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { Chip } from '@/ui/components/Chip.tsx'
import { FIELD, SELECT } from '@/ui/components/fieldLook.ts'
import { AmountHistory } from '@/ui/fixed/AmountHistory.tsx'
import { readCandidateChoice, type CandidateChoice } from '@/ui/fixed/candidateChoice.ts'
import { CADENCE_LABEL } from '@/ui/fixed/labels.ts'

/**
 * One detected candidate, with the evidence that produced it — docs/f09's
 * candidate review.
 *
 * **The working is on the card.** Occurrences, the month-by-month amounts, the
 * day it usually lands on and how far the amounts move are all here, because the
 * user is being asked to agree with an inference and cannot do that from a
 * confidence badge alone. Confidence is shown, but it is the summary of what is
 * beside it rather than a substitute for it.
 *
 * The amount and the cadence are editable **before** confirming rather than
 * after: the median is a proposal, and the moment the user knows it is wrong is
 * while they are looking at the six months it came from.
 */
export function CandidateCard({
  candidate,
  windowMonths,
  onConfirm,
  onDismiss,
}: {
  candidate: FixedExpenseCandidate
  windowMonths: number
  /** What the person agreed to — the amount and cadence as they were left, never the median they changed. */
  onConfirm: (choice: CandidateChoice) => void
  onDismiss: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [amountText, setAmountText] = useState(formatMoney(candidate.medianAmount, { symbol: false }))
  const [cadence, setCadence] = useState<Cadence>(candidate.suggestedCadence)

  const choice = readCandidateChoice(amountText, cadence, candidate.currency)

  const coverage = coverageBasisPoints(candidate, windowMonths)
  const first = candidate.months[0]
  const last = candidate.months.at(-1)

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-hairline px-4 py-3">
      <div className="min-w-56 flex-1">
        <Bidi className="font-medium">{candidate.merchantRaw}</Bidi>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1">
          <Chip>{CONFIDENCE_LABEL[candidate.confidence]}</Chip>
          <span className="text-caption text-ink-tertiary tabular-nums">
            {candidate.occurrences === 1 ? '1 month' : `${candidate.occurrences} months`}
            {coverage !== undefined && coverage < 10_000 && <> of {formatPercent(coverage, { digits: 0 })}</>}
            {' · '}
            {CADENCE_LABEL[candidate.suggestedCadence].toLocaleLowerCase()}
            {candidate.amountVariability === 'VARIABLE' && <> · amount moves</>}
          </span>
          <span className="text-caption text-ink-tertiary tabular-nums">
            usually the {candidate.dayOfMonthHint}
            {ordinal(candidate.dayOfMonthHint)}
            {candidate.dayOfMonthSpread > 0 && <> ± {candidate.dayOfMonthSpread}d</>}
            {' · last '}
            {toISODate(candidate.lastSeen)}
          </span>
        </div>
      </div>

      <div className="flex flex-col items-end gap-1">
        <AmountHistory months={candidate.months} />
        <span className="text-caption text-ink-tertiary tabular-nums">
          {first === undefined ? '' : formatMonthShort(first.period)}
          {last !== undefined && last !== first && <> → {formatMonthShort(last.period)}</>}
        </span>
      </div>

      {editing ? (
        <div className="fc-view-enter flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-caption text-ink-secondary">
            Amount
            <input
              className={`${FIELD} w-28 text-right tabular-nums`}
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
              aria-label="Expected amount"
            />
          </label>
          <select
            className={`${SELECT} h-8`}
            value={cadence}
            onChange={(event) => setCadence(event.target.value as Cadence)}
            aria-label="Cadence"
          >
            {CADENCES.map((option) => (
              <option key={option} value={option}>
                {CADENCE_LABEL[option]}
              </option>
            ))}
          </select>
          <Button
            variant="primary"
            size="sm"
            disabled={choice === undefined}
            onClick={() => {
              if (choice !== undefined) onConfirm(choice)
            }}
          >
            Add it
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="w-28 text-right text-secondary-number tabular-nums">
            {formatMoney(candidate.medianAmount)}
          </span>
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              onConfirm({ expectedAmount: candidate.medianAmount, cadence: candidate.suggestedCadence })
            }
          >
            Track it
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            Change…
          </Button>
          {/* Dismissing is permanent until cleared, and the screen says so where
              the button is rather than in a dialog after the fact (D-053). */}
          <Button variant="ghost" size="sm" onClick={onDismiss} title="Never suggest this merchant">
            Not a bill
          </Button>
        </div>
      )}
    </div>
  )
}

const CONFIDENCE_LABEL = {
  HIGH: 'looks certain',
  MEDIUM: 'looks likely',
  LOW: 'a guess',
} as const

/** `1st`, `2nd`, `3rd`, `11th`. English UI copy, so English ordinals. */
function ordinal(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return 'th'
  return { 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] ?? 'th'
}
