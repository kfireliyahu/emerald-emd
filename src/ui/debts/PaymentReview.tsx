import { useState } from 'react'

import { formatMoney } from '@/core/money.ts'
import { formatYearMonth, toISODate } from '@/core/time.ts'
import type { PaymentReview as Review, ReviewItem } from '@/data/repositories/debtRepository.ts'
import type { PaymentProvenance } from '@/domain/debt.ts'
import type { Debt } from '@/domain/model/debt.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { Chip } from '@/ui/components/Chip.tsx'
import { PAYMENT_SOURCE_LABEL } from './labels.ts'

/**
 * What the app found and has not been told it got right.
 *
 * docs/06's rule for everything inferred: a confirmation queue with the same
 * accept / edit / dismiss shape as the import review and the fixed-expense
 * candidates. Three lists rather than one, because they are three different
 * questions and only the first has an obvious answer:
 *
 * - **Discovered payments** — "is this a repayment?" Accept, or say no.
 * - **Ambiguities** — "which debt did this pay?" Never two marked payments
 *   against two balances (D-083); the row is held back until a debt is named.
 * - **Orphans** — "the row this came from is gone." Surfaced rather than
 *   deleted, because a balance that moved with no record of why is worse than
 *   one carrying a payment that needs a decision.
 *
 * **Nothing here is withheld from the balance.** An unconfirmed payment already
 * counts — the money left the account whether or not the user has agreed the app
 * read it correctly — so this queue changes marks, not figures. That is why
 * clearing it never moves a number, which is the property that makes the numbers
 * trustworthy in the first place.
 */
export function PaymentReview({
  review,
  onConfirm,
  onConfirmAll,
  onDismiss,
  onEdit,
  onResolve,
  onDismissAmbiguity,
  onTighten,
  onDeleteOrphan,
}: {
  review: Review
  onConfirm: (item: ReviewItem) => void
  onConfirmAll: () => void
  onDismiss: (item: ReviewItem) => void
  onEdit: (item: ReviewItem) => void
  onResolve: (index: number, debtId: string) => void
  onDismissAmbiguity: (index: number) => void
  /** Offered after a dismissal on a merchant-tracked debt: narrow the pattern. */
  onTighten: (debt: Debt) => void
  onDeleteOrphan: (item: ReviewItem) => void
}) {
  const [dismissed, setDismissed] = useState<Debt | undefined>()

  const nothing =
    review.items.length === 0 && review.ambiguities.length === 0 && review.orphaned.length === 0

  if (nothing) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
        <p className="max-w-md">
          Nothing waiting. Payments found in a statement or a paycheck land here first, so no balance
          moves on the app's word alone.
        </p>
      </div>
    )
  }

  return (
    <div>
      {review.items.length > 0 && (
        <section>
          <h2 className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-hairline bg-surface px-6 py-1">
            <span className="text-label text-ink-tertiary uppercase">
              Found, and counting towards the balance already
            </span>
            <Button variant="ghost" size="sm" onClick={onConfirmAll}>
              Accept all {review.items.length}
            </Button>
          </h2>

          {review.items.map((item) => (
            <PaymentLine
              key={item.payment.id}
              item={item}
              onConfirm={() => onConfirm(item)}
              onEdit={() => onEdit(item)}
              onDismiss={() => {
                onDismiss(item)
                // The offer to narrow the pattern only makes sense for the
                // mechanism a pattern belongs to, and only right after a
                // dismissal — docs/f08 asks for it there and nowhere else.
                if (item.debt.tracking.kind === 'MERCHANT_PATTERN') setDismissed(item.debt)
              }}
            />
          ))}

          {dismissed !== undefined && (
            <div className="fc-pop-enter flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline bg-surface px-6 py-2">
              <span className="text-ink-secondary">
                That one will not come back. If others like it keep turning up,{' '}
                <Bidi className="font-medium">{dismissed.name}</Bidi> is matching on “
                {dismissed.tracking.kind === 'MERCHANT_PATTERN' ? dismissed.tracking.pattern : ''}”.
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const debt = dismissed
                  setDismissed(undefined)
                  onTighten(debt)
                }}
              >
                Narrow the pattern
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDismissed(undefined)}>
                Leave it
              </Button>
            </div>
          )}
        </section>
      )}

      {review.ambiguities.length > 0 && (
        <section>
          <h2 className="border-b border-hairline bg-surface px-6 py-1 text-label text-ink-tertiary uppercase">
            Which debt did this pay?
          </h2>
          <p className="border-b border-hairline px-6 py-2 text-caption text-ink-tertiary">
            More than one debt is watching these rows. Nothing has been counted against either —
            marking both would double the money that actually moved.
          </p>

          {review.ambiguities.map((match, index) => (
            <div
              key={match.sourceRefId}
              className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-hairline px-6 py-2"
            >
              <span className="w-24 shrink-0 text-ink-tertiary tabular-nums">
                {match.provenance.kind === 'PAYCHECK'
                  ? formatYearMonth(match.provenance.period)
                  : toISODate(match.provenance.date)}
              </span>
              <span className="min-w-40 flex-1">
                <Bidi>{describeProvenance(match.provenance)}</Bidi>
              </span>
              <span className="w-28 text-right tabular-nums">{formatMoney(match.amount)}</span>
              <span className="flex flex-wrap items-center gap-2">
                {match.debts.map((debt) => (
                  <Button
                    key={debt.id}
                    variant="secondary"
                    size="sm"
                    onClick={() => onResolve(index, debt.id)}
                  >
                    <Bidi>{debt.name}</Bidi>
                  </Button>
                ))}
                <Button variant="ghost" size="sm" onClick={() => onDismissAmbiguity(index)}>
                  Neither
                </Button>
              </span>
            </div>
          ))}
        </section>
      )}

      {review.orphaned.length > 0 && (
        <section>
          <h2 className="border-b border-hairline bg-surface px-6 py-1 text-label text-ink-tertiary uppercase">
            The row behind these is gone
          </h2>
          <p className="border-b border-hairline px-6 py-2 text-caption text-ink-tertiary">
            The transaction or paycheck each of these came from is no longer in the document. They
            are still counted, because deleting a payment on the app's own initiative would move a
            balance with nothing on screen to explain it.
          </p>

          {review.orphaned.map((item) => (
            <div
              key={item.payment.id}
              className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-hairline px-6 py-2"
            >
              <span className="w-24 shrink-0 text-ink-tertiary tabular-nums">
                {toISODate(item.payment.date)}
              </span>
              <span className="min-w-40 flex-1">
                <Bidi className="font-medium">{item.debt.name}</Bidi>
                <span className="ml-2 text-caption text-ink-tertiary">
                  <Bidi>{item.payment.note ?? PAYMENT_SOURCE_LABEL[item.payment.sourceKind]}</Bidi>
                </span>
              </span>
              <span className="w-28 text-right tabular-nums">
                {formatMoney(item.payment.amount)}
              </span>
              <span className="flex gap-2">
                <Chip problem>source gone</Chip>
                <Button variant="ghost" size="sm" onClick={() => onDeleteOrphan(item)}>
                  Remove it
                </Button>
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

/**
 * Where a payment came from, in a sentence.
 *
 * The provenance is regenerated by the scan and carries the merchant, the
 * payslip period or the "3 of 12" — F08's second acceptance criterion. The note
 * written at discovery is the fallback: it says the same thing, in the words
 * that were true when the row was read, which is what survives if the
 * transaction has since been recategorized out of the debt's reach.
 */
function provenanceSentence(item: ReviewItem): string {
  if (item.provenance !== undefined) return describeProvenance(item.provenance)
  return item.payment.note ?? PAYMENT_SOURCE_LABEL[item.payment.sourceKind]
}

function describeProvenance(provenance: PaymentProvenance): string {
  switch (provenance.kind) {
    case 'TRANSACTION':
      return provenance.merchantRaw
    case 'INSTALLMENT_SLICE':
      return `${provenance.merchantRaw} · payment ${provenance.sequence} of ${provenance.total}`
    case 'PAYCHECK':
      return `the ${formatYearMonth(provenance.period)} paycheck`
  }
}

/** One found payment, with Yes, Edit and Not a payment — here and in Home's waiting list (M31 U1). */
export function PaymentLine({
  item,
  onConfirm,
  onEdit,
  onDismiss,
}: {
  item: ReviewItem
  onConfirm: () => void
  onEdit: () => void
  onDismiss: () => void
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-hairline px-6 py-2">
      <span className="w-24 shrink-0 text-ink-tertiary tabular-nums">{toISODate(item.payment.date)}</span>
      <span className="min-w-40 flex-1">
        <Bidi className="font-medium">{item.debt.name}</Bidi>
        <span className="ml-2 text-caption text-ink-tertiary">
          <Bidi>{provenanceSentence(item)}</Bidi>
        </span>
      </span>
      <span className="w-28 text-right tabular-nums">{formatMoney(item.payment.amount)}</span>
      <span className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={onConfirm}>
          Yes, it is
        </Button>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Not a payment
        </Button>
      </span>
    </div>
  )
}
