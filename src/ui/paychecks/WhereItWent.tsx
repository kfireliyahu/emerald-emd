import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Database } from 'sql.js'

import type { CurrencyCode } from '@/core/money.ts'
import { toYearMonthString, type YearMonth } from '@/core/time.ts'
import { listDebts, planPayments } from '@/data/repositories/debtRepository.ts'
import { listDeductionTypes } from '@/data/repositories/deductionTypeRepository.ts'
import { listFunds } from '@/data/repositories/fundRepository.ts'
import { listPaychecksWithLines } from '@/data/repositories/paycheckRepository.ts'
import {
  generatedDepositHoldings,
  listGoals,
  listHoldingPlaces,
  listHoldings,
  planDeposits,
} from '@/data/repositories/savingsRepository.ts'
import { listFixedExpenses } from '@/data/repositories/fixedExpenseRepository.ts'
import { listRoles } from '@/data/repositories/planFixedRepository.ts'
import { findSplitPlan, listSplitBuckets, planOnMonth } from '@/data/repositories/splitPlanRepository.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import { fixedPlanParts } from '@/domain/fixedExpenses.ts'
import { resolveBasis, splitPlan } from '@/domain/splitter.ts'
import { traceMonth, type MonthTrace, type TraceEnd, type TraceRow } from '@/domain/trace.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { useT } from '@/i18n/current.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { kitMoney } from '@/ui/charts/kit.ts'
import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { EmptyState } from '@/ui/components/WaitingList.tsx'

/**
 * Where one month's money went — the payslip, the split, and the holding it is
 * sitting in today (M17's view, D-193). **Since M64 U8 (D-620) it is two halves
 * of the side panel** rather than half of the page: what the split did with the
 * net opens behind the net, and what payroll sent out of the gross before you
 * saw it opens behind the funds.
 *
 * **It writes nothing and stores nothing.** Every row is a join between records
 * that already exist — D-179's test for the view, and the thing to keep true.
 * If drawing an arrow here ever seems to need a column, the arrow is an edge
 * the app has not built, and the fix is the edge.
 *
 * **The half that stops is the half worth having.** Every row ends somewhere,
 * and where it cannot, it says which link is missing.
 */
export function WhereItWent({ period, half }: { readonly period: YearMonth; readonly half: 'split' | 'payroll' }) {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const navigate = useNavigate()
  const t = useT()
  const key = toYearMonthString(period)
  // `revision` is the document changing under the same `db`.
  const trace = useMemo(
    () => (db === undefined ? undefined : monthTrace(db, period)),
    [db, revision, key],
  )
  if (trace === undefined) return null
  const rows = half === 'split' ? trace.split : trace.payroll
  const empty =
    half === 'payroll'
      ? t('paychecks.trace.payrollEmpty')
      : trace.planName === undefined
        ? t('paychecks.trace.noPlan')
        : t('paychecks.trace.planEmpty')

  return (
    <div className="flex flex-col gap-2">
      {half === 'split' && trace.stopped.minor > 0 && (
        <span className="text-caption text-ink-secondary tabular-nums">
          <span aria-hidden className="me-1.5 inline-block size-2 rounded-full bg-negative" />
          {t('paychecks.trace.stops', { amount: kitMoney(trace.stopped) })}
        </span>
      )}
      <Flow rows={rows} empty={empty} onGo={(to) => navigate(to)} />
    </div>
  )
}

/** The month's trace, read from the document. Nothing here is stored. */
/** What the plan's fixed expenses take, by the roles that plan gave them (D-319). */
function fixedForSplit(db: Database, planId: string, period: YearMonth, currency: CurrencyCode) {
  const parts = fixedPlanParts(listFixedExpenses(db), listRoles(db, planId), period, currency)
  return { netOff: parts.netOff, inSplit: parts.inSplit }
}

export function monthTrace(db: Database, period: YearMonth): MonthTrace {
  const entries = listPaychecksWithLines(db)
  const currency = documentCurrency(db)
  const key = toYearMonthString(period)
  const entry = entries.find((one) => toYearMonthString(one.paycheck.period) === key)

  // The plan **this month is on** (M31 U4): the one it was given, else the default.
  const applied = planOnMonth(db, period)
  const loaded = applied === undefined ? undefined : findSplitPlan(db, applied)
  const result =
    loaded === undefined
      ? undefined
      : splitPlan(
          loaded.plan,
          listSplitBuckets(db),
          loaded.allocations,
          resolveBasis(loaded.plan, entries.map((one) => one.paycheck)).amount,
          fixedForSplit(db, loaded.plan.id, period, loaded.plan.currency),
        )

  return traceMonth({
    period,
    currency,
    entry,
    types: listDeductionTypes(db),
    goals: listGoals(db, { includeClosed: true }),
    debts: listDebts(db, { includeClosed: true }),
    funds: listFunds(db, { includeArchived: true }),
    holdings: listHoldings(db, { includeArchived: true }),
    places: listHoldingPlaces(db, { includeArchived: true }),
    landedByGoal: generatedDepositHoldings(db, period, entry?.paycheck.id, applied),
    depositedByPlan:
      applied === undefined ? new Set<string>() : new Set(planDeposits(db, applied, period, currency).keys()),
    paidByPlan:
      applied === undefined ? new Set<string>() : new Set(planPayments(db, applied, period, currency).keys()),
    plan: loaded === undefined || result === undefined ? undefined : { name: loaded.plan.name, result },
  })
}

/**
 * One half of the month, as arrows: what, where it arrived, how much. A list
 * rather than a diagram, so the eye can run down it and find *stops here*.
 */
function Flow({
  rows,
  empty,
  onGo,
}: {
  rows: readonly TraceRow[]
  empty: string
  onGo: (to: string) => void
}) {
  if (rows.length === 0) return <EmptyState say={empty} />
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {rows.map((row) => (
        <li
          key={row.id}
          className="grid min-h-10 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-hairline py-1.5"
        >
          <span className={`rtl:-scale-x-100 ${row.end.kind === 'BROKEN' ? 'text-negative' : 'text-ink-secondary'}`}>
            <ActionGlyph name="arrow" size={14} />
          </span>
          <span className="min-w-0">
            <Arrival end={row.end} onGo={onGo} />
            <small className="block text-caption text-ink-secondary">
              <Bidi>{row.via}</Bidi>
            </small>
          </span>
          <span className="tabular-nums" dir="ltr">{kitMoney(row.amount)}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Where one row arrived, or the sentence naming the link that is missing. Only
 * the two words are coloured: a whole sentence in `negative` turns an ordinary
 * month into a screen that looks like an error.
 */
function Arrival({ end, onGo }: { end: TraceEnd; onGo: (to: string) => void }) {
  const t = useT()
  const link = 'text-start text-ink underline-offset-4 transition-colors duration-[var(--duration-micro)] hover:underline'
  if (end.kind === 'HOLDING') {
    return (
      <button type="button" className={link} onClick={() => onGo('/wealth')}>
        <Phrase text={t('paychecks.trace.at')} parts={{ holding: <Bidi>{end.holdingName}</Bidi>, place: <Bidi>{end.placeName}</Bidi> }} />
      </button>
    )
  }
  if (end.kind === 'FUND') {
    // The chain ends at the fund on purpose: a fund's balance is what the
    // report says, not a sum of these (F13's exception to derived balances).
    return (
      <button type="button" className={link} onClick={() => onGo('/wealth/funds')}>
        <Bidi>{end.fundName}</Bidi>
      </button>
    )
  }
  if (end.kind === 'DEBT') {
    return (
      <button type="button" className={link} onClick={() => onGo('/wealth/debts')}>
        <Phrase text={t('paychecks.trace.paidDown')} parts={{ debt: <Bidi>{end.debtName}</Bidi> }} />
      </button>
    )
  }
  if (end.kind === 'SPENT') return <span className="text-ink-secondary">{t('paychecks.trace.spent')}</span>
  // One sentence each, and each names **the link** rather than the money.
  return <span className="text-ink-secondary">{t('paychecks.trace.stopsHere', { why: t(`paychecks.trace.breaks.${end.reason}`) })}</span>
}
