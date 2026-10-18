import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'

import { formatMoney } from '@/core/money.ts'
import { formatPercent } from '@/core/percent.ts'
import { toISODate, yearMonthOf } from '@/core/time.ts'
import { deductionTypesForDebt, debtDetail } from '@/data/repositories/debtRepository.ts'
import { balanceOverTime } from '@/domain/debt.ts'
import type { DebtPayment } from '@/domain/model/debt.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { ClosePane } from '@/ui/screens/ListDetail.tsx'
import { Chip } from '@/ui/components/Chip.tsx'
import { BalanceLine } from '@/ui/debts/BalanceLine.tsx'
import {
  DEBT_KIND_LABEL,
  PAYMENT_SOURCE_LABEL,
  payoffBasisNote,
  payoffSentence,
  TRACK_KIND_LABEL,
} from '@/ui/debts/labels.ts'
import { ProgressRing } from '@/ui/savings/ProgressRing.tsx'
import { today } from '@/ui/today.ts'

/**
 * One debt: what is left, how it got there, and when it runs out.
 *
 * Every figure comes from one `debtDetail` call (D-084), so the ring, the
 * outstanding figure, the chart and the projection cannot disagree — the rule
 * `fundAnalysis` exists for (D-071). What this screen adds over the card is the
 * working: the payments the balance is a subtraction of, each naming where it
 * came from, and the step chart that shows what a mostly-interest payment does
 * to a balance.
 *
 * **The history is the evidence, so it shows the split.** A payment's principal
 * is what moved the balance and its interest is what did not, and printing only
 * the amount would leave the reader unable to check the number above it.
 */
export function DebtDetail() {
  const { debtId } = useParams<{ debtId: string }>()
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)

  const asOf = today()

  const detail = useMemo(
    () => (db === undefined || debtId === undefined ? undefined : debtDetail(db, debtId, yearMonthOf(asOf))),
    [db, revision, debtId],
  )
  const payrollTypes = useMemo(
    () => (db === undefined || debtId === undefined ? [] : deductionTypesForDebt(db, debtId)),
    [db, revision, debtId],
  )

  if (db === undefined) {
    return <Centered>Open a document to see a debt.</Centered>
  }
  if (detail === undefined) {
    return (
      <Centered>
        That debt is not in this document.{' '}
        <Link to="/wealth/debts" className="text-accent underline underline-offset-4 transition-colors duration-[var(--duration-micro)] hover:text-accent-hover">
          Close this pane
        </Link>
      </Centered>
    )
  }

  const { debt, balance, projection, payments } = detail
  const points = balanceOverTime(debt, payments)
  // What the document works out about this debt, or nothing when it cannot (M36 U03).
  const known = balance.kind === 'KNOWN' ? balance : undefined
  const newest = [...payments].reverse()

  return (
    <div className="fc-view-enter h-full overflow-auto">
      <div className="border-b border-hairline px-6 py-4">
        <div className="flex items-center gap-2">
          <span className="text-caption text-ink-tertiary">Debts</span>
          <ClosePane />
        </div>

        <div className="mt-2 flex flex-wrap items-start gap-x-8 gap-y-4">
          <ProgressRing basisPoints={known?.progressBasisPoints} size={64} />

          <div className="min-w-48 flex-1">
            <h1 className="text-title">
              <Bidi>{debt.name}</Bidi>
            </h1>
            <p className="mt-0.5 text-caption text-ink-tertiary">
              {DEBT_KIND_LABEL[debt.kind]}
              <> · taken out {toISODate(debt.openedDate)}</>
              {debt.expectedEndDate !== undefined && <> · due by {toISODate(debt.expectedEndDate)}</>}
              {debt.isClosed && <> · closed</>}
            </p>
            {debt.note !== undefined && (
              <p className="mt-2 max-w-2xl text-ink-secondary">
                <Bidi>{debt.note}</Bidi>
              </p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
              <Chip>{trackingSentence(debt)}</Chip>
              {payrollTypes.length > 0 && (
                <Chip>
                  also repaid from your paycheck ·{' '}
                  <Bidi>{payrollTypes.map((type) => type.name).join(', ')}</Bidi>
                </Chip>
              )}
              {balance.unconfirmedCount > 0 && (
                <Chip>
                  {balance.unconfirmedCount} of these are the app's reading, not yet confirmed
                </Chip>
              )}
              {balance.kind === 'UNCHECKED' && <Chip problem>unchecked · {balance.reason}</Chip>}
            </div>
          </div>

          <div className="text-right">
            <div className="text-hero tabular-nums">
              {known === undefined
                ? 'Unchecked'
                : formatMoney(known.isSettled ? known.principal : known.outstanding)}
            </div>
            <p className="text-caption text-ink-tertiary tabular-nums">
              {known === undefined
                ? `of ${formatMoney(balance.principal)} borrowed`
                : known.isSettled
                  ? known.overpaidBy === undefined
                    ? 'paid off'
                    : `paid off · ${formatMoney(known.overpaidBy)} over`
                  : `still owed of ${formatMoney(known.principal)}${
                      known.progressBasisPoints === undefined
                        ? ''
                        : ` · ${formatPercent(known.progressBasisPoints)} paid`
                    }`}
            </p>
          </div>
        </div>
      </div>

      <section className="border-b border-hairline px-6 py-4">
        <h2 className="text-label text-ink-tertiary uppercase">When it runs out</h2>
        <p className="mt-1 text-heading">{payoffSentence(projection)}</p>
        {payoffBasisNote(projection) !== undefined && (
          <p className="mt-1 text-caption text-ink-tertiary">{payoffBasisNote(projection)}</p>
        )}
        {debt.monthlyPaymentAmount !== undefined && (
          <p className="mt-1 text-caption text-ink-tertiary">
            You entered {formatMoney(debt.monthlyPaymentAmount)} a month as the expected payment.
          </p>
        )}
      </section>

      {points.length > 1 && (
        <section className="border-b border-hairline px-6 py-4">
          <h2 className="text-label text-ink-tertiary uppercase">What was owed</h2>
          <p className="mt-1 mb-3 max-w-2xl text-caption text-ink-tertiary">
            It steps down by the principal of each payment. A payment that was mostly interest
            barely moves it, which is the point of drawing this rather than a line between two
            numbers.
          </p>
          <BalanceLine points={points} />
        </section>
      )}

      <section className="px-6 py-4">
        <h2 className="flex flex-wrap items-baseline justify-between gap-x-6 text-label text-ink-tertiary uppercase">
          <span>Payments</span>
          {known !== undefined && (
            <span className="tabular-nums">
              {formatMoney(known.totalPaid)} paid · {formatMoney(known.principalPaid)} of it off
              the balance
              {known.interestPaid.minor !== 0 && <> · {formatMoney(known.interestPaid)} interest</>}
            </span>
          )}
        </h2>
      </section>

      {payments.length === 0 ? (
        <p className="px-6 pb-6 text-ink-secondary">
          Nothing recorded yet.{' '}
          {debt.tracking.kind === 'NONE'
            ? 'This debt is not watching for anything, so its payments are the ones you enter.'
            : 'Payments found in an import land in the review queue on the debts screen.'}
        </p>
      ) : (
        <div className="border-t border-hairline">
          {newest.map((payment) => (
            <PaymentRow key={payment.id} payment={payment} />
          ))}
        </div>
      )}
    </div>
  )
}

function PaymentRow({ payment }: { payment: DebtPayment }) {
  const principal = payment.principalPart
  const hasInterest = payment.interestPortion.minor !== 0

  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-hairline px-6 py-2">
      <span className="w-24 shrink-0 text-ink-tertiary tabular-nums">
        {toISODate(payment.date)}
      </span>
      <span className="min-w-40 flex-1">
        <Bidi>{payment.note ?? PAYMENT_SOURCE_LABEL[payment.sourceKind]}</Bidi>
        {payment.note !== undefined && payment.sourceKind === 'MANUAL' && (
          <span className="ml-2 text-caption text-ink-tertiary">entered by hand</span>
        )}
      </span>
      {!payment.isConfirmed && <Chip>not confirmed</Chip>}
      <span className="w-32 text-right text-caption text-ink-tertiary tabular-nums">
        {hasInterest ? (principal === undefined ? 'two currencies' : `${formatMoney(principal)} off the balance`) : ''}
      </span>
      <span className="w-28 text-right tabular-nums">{formatMoney(payment.amount)}</span>
    </div>
  )
}

/** What this debt is watching, in one phrase, with the thing it matches on. */
function trackingSentence(debt: {
  readonly tracking: import('@/domain/model/debt.ts').AutoTracking
}): string {
  switch (debt.tracking.kind) {
    case 'NONE':
      return TRACK_KIND_LABEL.NONE.toLowerCase()
    case 'MERCHANT_PATTERN':
      return `payments from “${debt.tracking.pattern}”`
    case 'CATEGORY':
      return 'payments categorized under one category'
    case 'CARD_INSTALLMENT_GROUP':
      return 'the slices of one split purchase'
  }
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-md">{children}</p>
    </div>
  )
}
