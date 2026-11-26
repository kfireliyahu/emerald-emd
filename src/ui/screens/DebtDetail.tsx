import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'

import { formatMoney } from '@/core/money.ts'
import { formatPercent } from '@/core/percent.ts'
import { toISODate, yearMonthOf } from '@/core/time.ts'
import { deductionTypesForDebt, debtDetail } from '@/data/repositories/debtRepository.ts'
import { balanceOverTime, type PayoffProjection } from '@/domain/debt.ts'
import type { AutoTracking, DebtPayment } from '@/domain/model/debt.ts'
import { countKey } from '@/i18n/count.ts'
import { useDates, useT, type Translate } from '@/i18n/current.ts'
import type { DateWords } from '@/i18n/dates.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { ClosePane } from '@/ui/screens/ListDetail.tsx'
import { Chip } from '@/ui/components/Chip.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { BalanceLine } from '@/ui/debts/BalanceLine.tsx'
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
  const t = useT()
  const dates = useDates()

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
    return <Centered>{t('wealth.debtDetail.noDocument')}</Centered>
  }
  if (detail === undefined) {
    return (
      <Centered>
        {t('wealth.debtDetail.missing')}{' '}
        <Link to="/wealth/debts" className="text-accent underline underline-offset-4 transition-colors duration-[var(--duration-micro)] hover:text-accent-hover">
          {t('wealth.debtDetail.closePane')}
        </Link>
      </Centered>
    )
  }

  const { debt, balance, projection, payments } = detail
  const points = balanceOverTime(debt, payments)
  // What the document works out about this debt, or nothing when it cannot (M36 U03).
  const known = balance.kind === 'KNOWN' ? balance : undefined
  const newest = [...payments].reverse()
  const basisNote = payoffBasisNote(projection, t)

  return (
    <div className="fc-view-enter h-full overflow-auto">
      <div className="border-b border-hairline px-6 py-4">
        <div className="flex items-center gap-2">
          <span className="text-caption text-ink-secondary">{t('wealth.debtDetail.kicker')}</span>
          <ClosePane />
        </div>

        <div className="mt-2 flex flex-wrap items-start gap-x-8 gap-y-4">
          <ProgressRing basisPoints={known?.progressBasisPoints} size={64} />

          <div className="min-w-48 flex-1">
            <h1 className="text-title">
              <Bidi>{debt.name}</Bidi>
            </h1>
            <p className="mt-0.5 text-caption text-ink-secondary">
              {t(`wealth.kinds.debt.${debt.kind}`)}
              <> · {t('wealth.debtDetail.takenOut', { date: toISODate(debt.openedDate) })}</>
              {debt.expectedEndDate !== undefined && <> · {t('wealth.debtDetail.dueBy', { date: toISODate(debt.expectedEndDate) })}</>}
              {debt.isClosed && <> · {t('wealth.debtDetail.closed')}</>}
            </p>
            {debt.note !== undefined && (
              <p className="mt-2 max-w-2xl text-ink-secondary">
                <Bidi>{debt.note}</Bidi>
              </p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
              <Chip>{trackingSentence(debt.tracking, t)}</Chip>
              {payrollTypes.length > 0 && (
                <Chip>
                  <Phrase
                    text={t('wealth.debtDetail.alsoPayroll')}
                    parts={{ names: <Bidi>{payrollTypes.map((type) => type.name).join(t('wealth.common.listSeparator'))}</Bidi> }}
                  />
                </Chip>
              )}
              {balance.unconfirmedCount > 0 && (
                <Chip>
                  {t(countKey('wealth.debtDetail.unconfirmed', balance.unconfirmedCount), { count: balance.unconfirmedCount })}
                </Chip>
              )}
              {balance.kind === 'UNCHECKED' && <Chip problem>{t('wealth.debtDetail.uncheckedChip')}</Chip>}
            </div>
          </div>

          <div className="text-end">
            <div className="text-hero tabular-nums">
              {known === undefined
                ? t('wealth.debtDetail.unchecked')
                : formatMoney(known.isSettled ? known.principal : known.outstanding)}
            </div>
            <p className="text-caption text-ink-secondary tabular-nums">
              {known === undefined
                ? t('wealth.debtDetail.ofBorrowed', { amount: formatMoney(balance.principal) })
                : known.isSettled
                  ? known.overpaidBy === undefined
                    ? t('wealth.debtDetail.paidOff')
                    : t('wealth.debtDetail.paidOffOver', { amount: formatMoney(known.overpaidBy) })
                  : known.progressBasisPoints === undefined
                    ? t('wealth.debtDetail.stillOwed', { amount: formatMoney(known.principal) })
                    : t('wealth.debtDetail.stillOwedPaid', {
                        amount: formatMoney(known.principal),
                        percent: formatPercent(known.progressBasisPoints),
                      })}
            </p>
          </div>
        </div>
      </div>

      <section className="border-b border-hairline px-6 py-4">
        <h2 className="text-caption font-medium text-ink-secondary uppercase">{t('wealth.debtDetail.runsOut')}</h2>
        <p className="mt-1 text-heading">{payoffSentence(projection, t, dates)}</p>
        {basisNote !== undefined && <p className="mt-1 text-caption text-ink-secondary">{basisNote}</p>}
        {debt.monthlyPaymentAmount !== undefined && (
          <p className="mt-1 text-caption text-ink-secondary">
            {t('wealth.debtDetail.expected', { amount: formatMoney(debt.monthlyPaymentAmount) })}
          </p>
        )}
      </section>

      {points.length > 1 && (
        <section className="border-b border-hairline px-6 py-4">
          <h2 className="text-caption font-medium text-ink-secondary uppercase">{t('wealth.debtDetail.owed')}</h2>
          <p className="mt-1 mb-3 max-w-2xl text-caption text-ink-secondary">{t('wealth.debtDetail.owedWhy')}</p>
          <BalanceLine points={points} />
        </section>
      )}

      <section className="px-6 py-4">
        <h2 className="flex flex-wrap items-baseline justify-between gap-x-6 text-caption font-medium text-ink-secondary uppercase">
          <span>{t('wealth.debtDetail.payments')}</span>
          {known !== undefined && (
            <span className="tabular-nums">
              {t('wealth.debtDetail.paymentsSum', { total: formatMoney(known.totalPaid), principal: formatMoney(known.principalPaid) })}
              {known.interestPaid.minor !== 0 && <> · {t('wealth.debtDetail.interest', { amount: formatMoney(known.interestPaid) })}</>}
            </span>
          )}
        </h2>
      </section>

      {payments.length === 0 ? (
        <p className="px-6 pb-6 text-ink-secondary">
          {t('wealth.debtDetail.nothingYet')}{' '}
          {debt.tracking.kind === 'NONE' ? t('wealth.debtDetail.nothingManual') : t('wealth.debtDetail.nothingFound')}
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
  const t = useT()
  const principal = payment.principalPart
  const hasInterest = payment.interestPortion.minor !== 0

  return (
    <div className="flex items-baseline gap-x-4 border-b border-hairline px-6 py-2">
      <span className="w-24 shrink-0 text-ink-secondary tabular-nums">
        {toISODate(payment.date)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
        <span>
          {payment.note === undefined ? t(`wealth.kinds.paymentSource.${payment.sourceKind}`) : <Bidi>{payment.note}</Bidi>}
          {payment.note !== undefined && payment.sourceKind === 'MANUAL' && (
            <span className="ms-2 text-caption text-ink-secondary">{t('wealth.debtDetail.byHand')}</span>
          )}
        </span>
        {hasInterest && (
          <span className="text-caption text-ink-secondary tabular-nums">
            {principal === undefined
              ? t('wealth.debtDetail.twoCurrencies')
              : t('wealth.debtDetail.offBalance', { amount: formatMoney(principal) })}
          </span>
        )}
        {!payment.isConfirmed && <Chip>{t('wealth.debtDetail.notConfirmed')}</Chip>}
      </span>
      <span className="shrink-0 text-end tabular-nums">{formatMoney(payment.amount)}</span>
    </div>
  )
}

/** What this debt is watching, in one phrase, with the thing it matches on. */
function trackingSentence(tracking: AutoTracking, t: Translate): string {
  return tracking.kind === 'MERCHANT_PATTERN'
    ? t('wealth.debtDetail.tracking.MERCHANT_PATTERN', { pattern: tracking.pattern })
    : t(`wealth.debtDetail.tracking.${tracking.kind}`)
}

/**
 * When it will be paid off, or why that cannot be said (from `debts/labels.ts`, M64 F26).
 * Every "cannot say" is a sentence naming what is missing, never a dash: the domain models them
 * as separate variants so the screen can tell a debt with no schedule from one that is all interest.
 */
function payoffSentence(projection: PayoffProjection, t: Translate, dates: DateWords): string {
  switch (projection.kind) {
    case 'SETTLED':
    case 'UNCHECKED':
    case 'NO_BASIS':
    case 'NEEDS_TWO_PAYMENTS':
      return t(`wealth.debtDetail.payoff.${projection.kind}`)
    case 'NOT_REDUCING':
      return projection.basis === 'OBSERVED'
        ? t('wealth.debtDetail.payoff.NOT_REDUCING_OBSERVED')
        : t('wealth.debtDetail.payoff.NOT_REDUCING_EXPECTED')
    case 'BEYOND_HORIZON':
      return t('wealth.debtDetail.payoff.BEYOND_HORIZON', { amount: formatMoney(projection.monthlyPrincipal) })
    case 'PROJECTED':
      return t('wealth.debtDetail.payoff.PROJECTED', { month: dates.yearMonth(projection.period) })
  }
}

/** Whose figure the projection divided by, said plainly under the date. */
function payoffBasisNote(projection: PayoffProjection, t: Translate): string | undefined {
  if (projection.kind !== 'PROJECTED' && projection.kind !== 'BEYOND_HORIZON') return undefined
  const amount = formatMoney(projection.monthlyPrincipal)
  return projection.basis === 'OBSERVED'
    ? t('wealth.debtDetail.basisObserved', { amount })
    : t('wealth.debtDetail.basisExpected', { amount })
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-md">{children}</p>
    </div>
  )
}
