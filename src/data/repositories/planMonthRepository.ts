/**
 * **One plan, one month, worked out** — what the Plan screen draws and what
 * `plan_month` answers (M28 U7, D-319), so the two cannot disagree about a
 * figure.
 *
 * It is a read. The splitter's arithmetic is `@/domain/splitter.ts` and the
 * fixed expenses' is `fixedPlanParts`; what is here is gathering what each of
 * them needs — the basis, the roles, the targets a bucket points at — and the
 * three measurements the screen shows beside a bucket: what it actually got
 * over the last three months, when a goal is reached at this rate, and whether
 * money sits in a bucket that points at nothing.
 */

import type { Database } from 'sql.js'

import { money, type Money } from '@/core/money.ts'
import { addMonths, toYearMonthString, type LocalDate, type YearMonth } from '@/core/time.ts'
import { selfDiscoveringDebts } from '@/domain/debt.ts'
import { fixedPlanParts, type FixedPlanParts } from '@/domain/fixedExpenses.ts'
import type { FixedExpense, FixedRole } from '@/domain/model/fixed.ts'
import type { FixedLineStatus } from '@/domain/model/statistics.ts'
import type { Allocation, SplitBucket, SplitPlan } from '@/domain/model/plan.ts'
import { targetAmountOf } from '@/domain/savings.ts'
import {
  applyPlan,
  monthsToReach,
  planVersusActual,
  resolveBasis,
  splitPlan as computeSplit,
  withoutAllocation,
  type ApplyPlan,
  type PlanVersusActual,
  type Suggestion,
  type ResolvedBasis,
  type SplitResult,
} from '@/domain/splitter.ts'
import { inTransaction } from '../db/database.ts'
import { listAccounts } from './accountRepository.ts'
import { listCategories } from './categoryRepository.ts'
import { applyPlanPayment, listDebts, planPayments } from './debtRepository.ts'
import { listDeductionTypes } from './deductionTypeRepository.ts'
import { listFixedExpenses } from './fixedExpenseRepository.ts'
import { listFunds } from './fundRepository.ts'
import { goalFeeds } from './goalDepositRepository.ts'
import { listPaychecks } from './paycheckRepository.ts'
import { listRoles } from './planFixedRepository.ts'
import { salaryLanded } from './salaryRepository.ts'
import { applyPlanDeposit, goalDetail, listGoals, planDeposits } from './savingsRepository.ts'
import {
  bucketActuals,
  deleteSplitBucket,
  bucketUsageCounts,
  defaultSplitPlan,
  findSplitPlan,
  listSplitBuckets,
  setPlanMonths,
  updateSplitPlan,
} from './splitPlanRepository.ts'

/** What a bucket's destination did over the months before the one planned. */
export interface Trailing {
  /** The average over the months that could be measured. */
  readonly average: Money
  /** How many of the asked months were measured at all. */
  readonly months: number
}

/** When a goal bucket gets its goal, at the rate the plan gives it. */
export type Reach =
  | { readonly kind: 'reached' }
  | { readonly kind: 'in'; readonly months: number; readonly period: YearMonth }

export interface BucketReading {
  readonly bucketId: string
  readonly trailing: Trailing | undefined
  readonly reach: Reach | undefined
  /** Money is planned for it and it points at nothing. */
  readonly noTarget: boolean
}

export interface PlanMonth {
  readonly plan: SplitPlan
  readonly allocations: readonly Allocation[]
  readonly buckets: readonly SplitBucket[]
  /** The month the plan is for. */
  readonly month: YearMonth
  /** The last complete month before it — what charges and actuals are about. */
  readonly lastComplete: YearMonth
  readonly basis: ResolvedBasis
  readonly expenses: readonly FixedExpense[]
  readonly roles: ReadonlyMap<string, FixedRole>
  readonly parts: FixedPlanParts
  readonly result: SplitResult
  /** Ids a bucket may point at and find: categories, goals, debts, funds, accounts. */
  readonly known: ReadonlySet<string>
  readonly applied: ApplyPlan
  readonly readings: ReadonlyMap<string, BucketReading>
}

/** One fixed expense against what the ledger holds for it in a month (D-322). */
export interface FixedComparisonLine {
  readonly expenseId: string
  readonly name: string
  /** What this plan does with it; a payslip deduction is outside the choice. */
  readonly role: FixedRole | 'SLIP'
  readonly status: FixedLineStatus
  /** The charge it is expected to be, in a month it is due; undefined otherwise. */
  readonly planned: Money | undefined
  /** What matched it. Undefined unless it was charged. */
  readonly actual: Money | undefined
  readonly transactionCount: number
}

/**
 * **The plan against what happened** in one month: each bucket the way it is
 * measured (D-087) and each tracked fixed expense against its matched charges
 * (D-322). A comparison that has nothing to compare says why, in `nothing`,
 * instead of drawing an empty panel.
 */
export interface PlanActual {
  readonly period: YearMonth
  readonly versus: PlanVersusActual
  readonly ledgerHasMonth: boolean
  readonly fixed: readonly FixedComparisonLine[]
  /** Expected and actual charge of the lines this plan counts and the ledger can answer. */
  readonly fixedPlanned: Money
  readonly fixedActual: Money
  /** Why there is nothing to compare, or undefined when there is something. */
  readonly nothing: string | undefined
}

export function planAgainstActual(
  db: Database,
  pm: PlanMonth,
  period: YearMonth,
  asOf: LocalDate,
): PlanActual {
  const currency = pm.plan.currency
  const measured = bucketActuals(db, pm.buckets, period, asOf, pm.known, { currency })
  const versus = planVersusActual(pm.result, period, measured.actuals, currency)
  const expenses = new Map(pm.expenses.map((one) => [one.id, one]))

  const fixed = measured.fixed.map((line): FixedComparisonLine => {
    const expense = expenses.get(line.expenseId)
    const role: FixedComparisonLine['role'] =
      expense?.matchKind === 'PAYCHECK_DEDUCTION' ? 'SLIP' : (pm.roles.get(line.expenseId) ?? 'IGNORE')
    const due = line.status === 'CHARGED' || line.status === 'NOT_CHARGED'
    return {
      expenseId: line.expenseId,
      name: line.name,
      role,
      status: line.status,
      planned:
        due && expense !== undefined && expense.expectedAmount.currency === currency
          ? money(Math.abs(expense.expectedAmount.minor), currency)
          : undefined,
      actual: line.status === 'CHARGED' && line.outflow.currency === currency ? line.outflow : undefined,
      transactionCount: line.transactionCount,
    }
  })
  const counted = fixed.filter((one) => one.role !== 'IGNORE' && one.role !== 'SLIP' && one.planned !== undefined)
  const fixedPlanned = money(counted.reduce((total, one) => total + (one.planned?.minor ?? 0), 0), currency)
  const fixedActual = money(counted.reduce((total, one) => total + (one.actual?.minor ?? 0), 0), currency)

  const answerable = fixed.filter((one) => one.status === 'CHARGED' || one.status === 'NOT_CHARGED')
  let nothing: string | undefined
  if (versus.comparable === 0 && answerable.length === 0) {
    const month = toYearMonthString(period)
    const reasons: string[] = []
    if (!measured.ledgerHasMonth) {
      reasons.push(
        `no statement has been imported for ${month}, so what was spent (buckets for a category, bills) is unknown rather than zero`,
        'and no bucket is for a saving goal or a debt, which are recorded by hand and need no statement',
      )
    } else {
      if (fixed.length === 0) reasons.push(`no tracked bill was running in ${month}`)
      else reasons.push('the tracked bills are not due, not matched to statements, or come off the payslip')
      if (versus.lines.length === 0) reasons.push('this plan has no buckets')
      else reasons.push('no bucket is for a category, a saving goal or a debt')
    }
    nothing = `Nothing to compare for ${month}: ${reasons.join('; ')}.`
  }
  return { period, versus, ledgerHasMonth: measured.ledgerHasMonth, fixed, fixedPlanned, fixedActual, nothing }
}

/**
 * **Take buckets out of a plan, and give each one's share to the bucket on its
 * right** (M28 F8, D-322), in that bucket's own unit; past the last bucket the
 * share is the money not given a job. A bucket no other plan uses is deleted
 * with it, since there is nothing left that could use it; one another plan
 * still allocates to stays, as a bucket always did. One transaction.
 */
export function removePlanBuckets(
  db: Database,
  planId: string,
  bucketIds: readonly string[],
  month: YearMonth,
  asOf: LocalDate,
  now: number,
): { readonly removed: readonly string[]; readonly deleted: readonly string[] } {
  const pm = planMonth(db, { planId, month, asOf, readings: false })
  if (pm === undefined) return { removed: [], deleted: [] }
  const splittable = pm.result.splittable
  const order = pm.result.allocations.map((one) => one.allocation.id)

  let allocations: readonly Allocation[] = pm.allocations
  const removed: string[] = []
  for (const bucketId of bucketIds) {
    const leaving = allocations.find((one) => one.bucketId === bucketId)
    if (leaving === undefined) continue
    allocations = withoutAllocation(allocations, leaving.id, splittable, { order })
    removed.push(bucketId)
  }
  if (removed.length === 0) return { removed: [], deleted: [] }

  const deleted: string[] = []
  inTransaction(db, () => {
    updateSplitPlan(
      db,
      planId,
      {
        allocations: allocations.map((one) => ({
          bucketId: one.bucketId,
          mode: one.mode,
          basisPoints: one.basisPoints,
          amount: one.amount,
          isLocked: one.isLocked,
        })),
      },
      now,
    )
    const uses = bucketUsageCounts(db)
    for (const bucketId of removed) {
      if ((uses.get(bucketId) ?? 0) === 0) {
        deleteSplitBucket(db, bucketId, now)
        deleted.push(bucketId)
      }
    }
  })
  return { removed, deleted }
}

/** How many months back a bucket's "what it actually got" looks. */
export const TRAILING_MONTHS = 3

export function planMonth(
  db: Database,
  input: {
    readonly planId?: string | undefined
    readonly month: YearMonth
    readonly asOf: LocalDate
    /** False skips the three measured months — for a plan only drawn beside another. */
    readonly readings?: boolean
  },
): PlanMonth | undefined {
  const loaded = input.planId === undefined ? defaultSplitPlan(db) : findSplitPlan(db, input.planId)
  if (loaded === undefined) return undefined
  const { plan, allocations } = loaded
  const currency = plan.currency

  const buckets = listSplitBuckets(db)
  const lastComplete = addMonths(input.month, -1)
  const expenses = listFixedExpenses(db)
  const roles = listRoles(db, plan.id)
  const parts = fixedPlanParts(expenses, roles, input.month, currency)
  // No payslip, so the salary that came in (M31 U3) — read only then, because the scan is the dear part.
  const paychecks = listPaychecks(db)
  const basis = resolveBasis(plan, paychecks, paychecks.length === 0 ? salaryLanded(db, currency) : [])
  const result = computeSplit(plan, buckets, allocations, basis.amount, {
    netOff: parts.netOff,
    inSplit: parts.inSplit,
  })

  const categories = listCategories(db)
  const goals = listGoals(db)
  const debts = listDebts(db)
  const known = new Set([
    ...categories.map((one) => one.id),
    ...goals.map((one) => one.id),
    ...debts.map((one) => one.id),
    // Archived ones still exist: a bucket pointing at one is not orphaned.
    ...listFunds(db, { includeArchived: true }).map((one) => one.id),
    ...listAccounts(db, { includeArchived: true }).map((one) => one.id),
  ])

  const targets = new Map<string, Money>([
    ...planDeposits(db, plan.id, input.month, currency),
    ...planPayments(db, plan.id, input.month, currency),
  ])
  const applied = applyPlan(
    result,
    input.month,
    targets,
    known,
    selfDiscoveringDebts(debts, listDeductionTypes(db)),
    goalFeeds(db),
  )

  // S1: what each bucket actually got, over the months before this one.
  const sums = new Map<string, { total: number; months: number }>()
  for (let back = 1; back <= (input.readings === false ? 0 : TRAILING_MONTHS); back += 1) {
    const measured = bucketActuals(db, buckets, addMonths(input.month, -back), input.asOf, known, {
      currency,
    })
    for (const [bucketId, actual] of measured.actuals) {
      if (actual.amount.currency !== currency) continue
      // A month with nothing recorded is not a month the bucket got nothing.
      if (actual.rowCount === 0 && actual.amount.minor === 0) continue
      const held = sums.get(bucketId) ?? { total: 0, months: 0 }
      sums.set(bucketId, { total: held.total + actual.amount.minor, months: held.months + 1 })
    }
  }

  const readings = new Map<string, BucketReading>()
  for (const entry of result.allocations) {
    const { bucket } = entry
    const measured = sums.get(bucket.id)
    const trailing =
      measured === undefined || measured.months === 0
        ? undefined
        : {
            average: money(Math.round(measured.total / measured.months), currency),
            months: measured.months,
          }

    let reach: Reach | undefined
    if (
      input.readings !== false &&
      bucket.targetKind === 'SAVING_GOAL' &&
      bucket.targetId !== undefined &&
      known.has(bucket.targetId)
    ) {
      const detail = goalDetail(db, bucket.targetId, input.asOf, currency)
      const target = detail === undefined ? undefined : targetAmountOf(detail.target)
      if (detail !== undefined && target !== undefined) {
        const away = monthsToReach(
          money(target.minor - detail.progressBalance.minor, currency),
          entry.amount,
        )
        if (away === 'reached') reach = { kind: 'reached' }
        else if (away !== undefined) {
          reach = { kind: 'in', months: away, period: addMonths(input.month, away - 1) }
        }
      }
    }

    const orphaned = bucket.targetId !== undefined && !known.has(bucket.targetId)
    const pointsAtNothing = bucket.targetKind === 'FREE' || orphaned
    readings.set(bucket.id, {
      bucketId: bucket.id,
      trailing,
      reach,
      noTarget: pointsAtNothing && entry.allocation.mode !== 'REMAINDER' && entry.amount.minor > 0,
    })
  }

  return {
    plan,
    allocations,
    buckets,
    month: input.month,
    lastComplete,
    basis,
    expenses,
    roles,
    parts,
    result,
    known,
    applied,
    readings,
  }
}

/**
 * **Use this plan for a month** — what the suggestions the plan made become
 * (D-319; the record line on Plan, M31 U4, and `plan_month` with `commit`).
 *
 * One transaction for the lot: the plan is stamped with the month, and a stamp
 * that landed while half the targets did not would be a lie the document tells
 * about itself. A deposit and a payment are upserted on the plan, the month and
 * the bucket, so applying twice moves them instead of doubling them (D-075,
 * D-190). The stamp is written even when nothing else is: it is what makes this the plan in use
 * for the month, which is where a category's budget is read from (D-327).
 *
 * **A goal real money already feeds takes no planned deposit** (M28 F27, D-341): `applyPlan` keeps it
 * out of `changes`, and this refuses it again for a caller that passes one anyway, so the guarantee
 * is the write's and not the screen's.
 */
export function applySuggestions(
  db: Database,
  planId: string,
  month: YearMonth,
  accepted: readonly Suggestion[],
  now: number,
): void {

  const feeds = goalFeeds(db)
  inTransaction(db, () => {
    for (const suggestion of accepted) {
      if (suggestion.kind === 'SAVING_DEPOSIT') {
        if (feeds.has(suggestion.targetId)) continue
        applyPlanDeposit(
          db,
          {
            planId,
            period: suggestion.period,
            bucketId: suggestion.bucket.id,
            goalId: suggestion.targetId,
            amount: suggestion.amount,
          },
          now,
        )
      } else if (suggestion.kind === 'DEBT_PAYMENT') {
        applyPlanPayment(
          db,
          {
            planId,
            period: suggestion.period,
            bucketId: suggestion.bucket.id,
            debtId: suggestion.targetId,
            amount: suggestion.amount,
          },
          now,
        )
      }
    }
    // Recording for a month gives the month this plan (M31 U4), as the stamp did.
    setPlanMonths(db, planId, [month], [])
  })
}
