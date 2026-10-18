import { formatMoney } from '@/core/money.ts'
import { toISODate } from '@/core/time.ts'
import { MIN_PROMOTION_THRESHOLD } from '@/data/repositories/debtRepository.ts'
import type { InstallmentDebtCandidate } from '@/domain/debt.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { SELECT } from '@/ui/components/fieldLook.ts'

/**
 * Purchases split over several months, offered as debts.
 *
 * docs/f08 calls this the case most apps get wrong: twelve slices' worth of
 * money is owed the moment the purchase is made, and only one slice appears in
 * each statement — so the ledger shows a small charge a month and nothing shows
 * the commitment. Promoting the group is what turns it into a balance that
 * counts down.
 *
 * **The offer says whose number the principal is.** A statement that prints the
 * purchase total gives one; a statement that does not leaves slice × count,
 * which is a figure no file ever stated. `principal.basis` carries which
 * (D-083), and the difference is on screen before anyone agrees to it — because
 * an estimate accepted as a fact becomes a balance nobody can check.
 *
 * **Declining is remembered.** A purchase the user has said is not a debt must
 * not be offered again by the next import, which is the difference between an
 * offer and a nag — the same call the payment queue's dismissals make.
 */
export function SplitPurchases({
  candidates,
  threshold,
  onPromote,
  onDecline,
  onThreshold,
  onStopOffering,
}: {
  candidates: readonly InstallmentDebtCandidate[]
  threshold: number
  onPromote: (candidate: InstallmentDebtCandidate) => void
  onDecline: (candidate: InstallmentDebtCandidate) => void
  onThreshold: (threshold: number) => void
  onStopOffering: () => void
}) {
  if (candidates.length === 0) return null

  return (
    <section className="border-b border-hairline">
      <h2 className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-hairline bg-surface px-6 py-1">
        <span className="text-label text-ink-tertiary uppercase">
          {candidates.length === 1
            ? 'A purchase you are still paying for'
            : `${candidates.length} purchases you are still paying for`}
        </span>
        <label className="ml-auto flex items-center gap-2 text-caption text-ink-tertiary">
          Offer purchases split into more than
          <select
            className={`${SELECT} h-6 py-0 text-caption`}
            value={threshold}
            onChange={(event) => onThreshold(Number(event.target.value))}
            aria-label="How many payments a purchase must be split into to be offered"
          >
            {[MIN_PROMOTION_THRESHOLD, 3, 4, 6, 12].map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          payments
        </label>
        <Button variant="ghost" size="sm" onClick={onStopOffering}>
          Stop offering these
        </Button>
      </h2>

      <p className="border-b border-hairline px-6 py-2 text-caption text-ink-tertiary">
        You owe the whole of these already — only one slice of each shows up in a statement. Track
        one as a debt and the slices already charged become payments against it, with the rest
        arriving as they are billed.
      </p>

      {candidates.map((candidate) => (
        <div
          key={candidate.groupKey}
          className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-hairline px-6 py-2"
        >
          <span className="w-24 shrink-0 text-ink-tertiary tabular-nums">
            {toISODate(candidate.firstChargeDate)}
          </span>

          <span className="min-w-40 flex-1">
            <Bidi className="font-medium">{candidate.merchantRaw}</Bidi>
            <span className="ml-2 text-caption text-ink-tertiary tabular-nums">
              {candidate.slicesSeen} of {candidate.paymentCount} charged ·{' '}
              {formatMoney(candidate.sliceAmount)} each
            </span>
          </span>

          <span className="w-44 text-right">
            <span className="tabular-nums">{formatMoney(candidate.principal.amount)}</span>
            <span className="block text-caption text-ink-tertiary">
              {candidate.principal.basis === 'STATED'
                ? 'the total the statement printed'
                : `estimated — no total on the statement`}
            </span>
          </span>

          <span className="w-32 text-right text-caption text-ink-tertiary tabular-nums">
            {formatMoney(candidate.chargedSoFar)} paid so far
          </span>

          <span className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => onPromote(candidate)}>
              Track it as a debt
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onDecline(candidate)}>
              Not a debt
            </Button>
          </span>
        </div>
      ))}
    </section>
  )
}
