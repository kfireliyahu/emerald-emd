import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Database } from 'sql.js'

import { formatMoney, type CurrencyCode } from '@/core/money.ts'
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
import { traceMonth, type MonthTrace, type TraceBreak, type TraceEnd, type TraceRow } from '@/domain/trace.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'

/**
 * Where one month's money went — the payslip, the split, and the holding it is
 * sitting in today (M17's view, D-193), **as half of the month on Paychecks**
 * (M28 U4). It was a tab of its own; asked: *"where it went should not be
 * a separate tab of the paychecks"*. So it sits beside the slip it follows and
 * pages with it.
 *
 * **It writes nothing and stores nothing.** Every row is a join between records
 * that already exist — D-179's test for the view, and the thing to keep true.
 * If drawing an arrow here ever seems to need a column, the arrow is an edge
 * the app has not built, and the fix is the edge.
 *
 * **The half that stops is the half worth having.** Every row ends somewhere,
 * and where it cannot, it says which link is missing.
 */
export function WhereItWent({ period }: { readonly period: YearMonth }) {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const navigate = useNavigate()
  const key = toYearMonthString(period)
  // `revision` is the document changing under the same `db`.
  const trace = useMemo(
    () => (db === undefined ? undefined : monthTrace(db, period)),
    [db, revision, key],
  )
  if (trace === undefined) return null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="fc-label text-ink-secondary uppercase">Where it went</span>
        {trace.stopped.minor > 0 && (
          <span className="text-caption text-negative tabular-nums">{formatMoney(trace.stopped)} stops here</span>
        )}
      </div>

      <Flow
        rows={trace.split}
        empty={
          trace.planName === undefined
            ? 'No split plan was applied to this month, so the net is followed no further.'
            : 'The plan applied to this month routes nothing.'
        }
        onGo={(to) => navigate(to)}
      />

      <span className="fc-label mt-2 text-ink-secondary uppercase">Out of the gross, before you saw it</span>
      <Flow
        rows={trace.payroll}
        empty="Nothing on this paycheck is routed anywhere. A pension, a study fund or a payroll loan becomes an arrow here once its deduction type names what it pays into."
        onGo={(to) => navigate(to)}
      />
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
  if (rows.length === 0) return <p className="text-caption text-ink-secondary">{empty}</p>
  return (
    <ul className="flex flex-col">
      {rows.map((row) => (
        <li
          key={row.id}
          className="grid min-h-9 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-hairline py-1.5"
        >
          <span className={row.end.kind === 'BROKEN' ? 'text-negative' : 'text-ink-tertiary'}>
            <ActionGlyph name="arrow" size={14} />
          </span>
          <span className="min-w-0">
            <Arrival end={row.end} onGo={onGo} />
            <small className="block text-caption text-ink-secondary">
              <Bidi>{row.via}</Bidi>
            </small>
          </span>
          <span className="tabular-nums">{formatMoney(row.amount)}</span>
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
  const link = 'text-left text-ink underline-offset-4 transition-colors duration-[var(--duration-micro)] hover:underline'
  if (end.kind === 'HOLDING') {
    return (
      <button type="button" className={link} onClick={() => onGo('/wealth')}>
        <Bidi>{end.holdingName}</Bidi>
        <span className="text-ink-secondary"> at </span>
        <Bidi>{end.placeName}</Bidi>
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
        <Bidi>{end.debtName}</Bidi>
        <span className="text-ink-secondary"> paid down</span>
      </button>
    )
  }
  if (end.kind === 'SPENT') return <span className="text-ink-secondary">Spent</span>
  return (
    <span>
      <span className="text-negative">Stops here</span>
      <span className="text-ink-secondary">: {BREAK_SENTENCE[end.reason]}</span>
    </span>
  )
}

/** One sentence each, and each names **the link** rather than the money. */
const BREAK_SENTENCE: Readonly<Record<TraceBreak, string>> = {
  DEDUCTION_NAMES_NOTHING: 'this deduction type does not say which fund, goal or debt it pays into',
  GOAL_HAS_NO_HOLDING: 'the goal has no holding to put it in, so no deposit was written',
  NOT_APPLIED: 'the plan proposed this and the suggestion was never accepted',
  NO_PLAN_APPLIED: 'no split plan was applied to this month',
  NOT_ASSIGNED: 'the plan left this unassigned',
  TARGET_MISSING: 'what this is for is no longer in the document',
}
