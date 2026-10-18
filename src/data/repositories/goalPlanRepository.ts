import type { Database } from 'sql.js'

import { money, type CurrencyCode, type Money } from '@/core/money.ts'
import { monthsBetween, yearMonthOf, type LocalDate, type YearMonth } from '@/core/time.ts'
import {
  balanceAfter,
  editGoalMonthly,
  type BucketPointsAt,
  goalMonthlyFromPlan,
  goalStatus,
  neededMonthly,
  type GoalLine,
  type GoalStatus,
} from '@/domain/goalPlan.ts'
import { movedIntoGoal, suggestSplit, versusPlan, type SetAsideHeld, type Suggestion, type VersusPlan } from '@/domain/goalRhythm.ts'
import type { Allocation } from '@/domain/model/plan.ts'
import type { ComputedAllocation } from '@/domain/splitter.ts'
import { targetAmountOf, type GoalProgress, type MonthlyExpenses } from '@/domain/savings.ts'
import { query } from '../db/database.ts'
import { pausedUntilByGoal, staleSetAside } from './goalRhythmRepository.ts'
import { planMonth, type PlanMonth } from './planMonthRepository.ts'
import { listDeposits, listHoldings, savingsSummary } from './savingsRepository.ts'
import { createSplitBucket, listSplitBuckets, reorderSplitBuckets, updateSplitPlan, type NewAllocation } from './splitPlanRepository.ts'

/**
 * Goals as the deciding view reads them (M28 U8): each open goal with what Plan
 * puts toward it, where plain addition leaves it, and whether that is on time.
 *
 * **A read, and it owns no table.** The monthly amount is Plan's bucket
 * (choice 3 A), so this joins the goal's progress to the plan's computed split
 * for the month; the write is Plan's own (`updateSplitPlan`), reached from the
 * Goals screen and from `set_plan`, which is why nothing here writes.
 */
export interface GoalRow {
  readonly progress: GoalProgress
  readonly line: GoalLine
  /** The buckets that point at this goal. None means no amount is going toward it. */
  readonly bucketIds: readonly string[]
  readonly status: GoalStatus
  /** What a month would have to be to arrive on the date, when that differs from the plan. */
  readonly needed: Money | undefined
  /** Paused (S7): the month it takes money again. Its amount is given back to what is left. */
  readonly pausedUntil: YearMonth | undefined
  /** What the bank moved into it over the last three full months (S2). */
  readonly moved: Money
  /** `moved` against what Plan asked for over the months the goal was taking money (U9). */
  readonly versusPlan: VersusPlan
  /** Set-aside amounts nobody has said are still there for 90 days (S5). */
  readonly stale: readonly SetAsideHeld[]
}

export interface GoalsPlan {
  readonly month: YearMonth
  readonly currency: CurrencyCode
  readonly rows: readonly GoalRow[]
  /** The plan the amounts come from; undefined when the document has none. */
  readonly plan: PlanMonth | undefined
  readonly inGoals: Money
  readonly monthly: Money
  /** Plan's balance after every bucket: what the amounts leave. Undefined with no plan. */
  readonly left: Money | undefined
  /** Closed goals, kept as history and offered no amount. Empty unless asked for. */
  readonly closed: readonly GoalProgress[]
  /** A month's expenses, two ways (D-360). */
  readonly expenses: MonthlyExpenses
}

/** Months from `month` until a paused goal takes money again; 0 when it is not paused. */
function pausedMonths(month: YearMonth, until: YearMonth | undefined): number {
  return until === undefined ? 0 : Math.max(0, monthsBetween(month, until))
}

/** Only a rate the bank agreed to counts here; an assumed return is never kept (S6). */
function agreedRate(expected: { readonly basisPoints: number; readonly basis: string } | undefined): number | undefined {
  return expected?.basis === 'CONTRACTUAL' ? expected.basisPoints : undefined
}

export function goalsPlan(
  db: Database,
  asOf: LocalDate,
  currency: CurrencyCode,
  options?: { readonly includeClosed?: boolean },
): GoalsPlan {
  const month = yearMonthOf(asOf)
  const summary = savingsSummary(db, asOf, currency, { includeClosed: options?.includeClosed === true })
  const plan = planMonth(db, { month, asOf, readings: false })
  const paused = pausedUntilByGoal(db)
  const deposits = listDeposits(db)
  const stale = staleSetAside(db, asOf)
  const holdings = new Map(listHoldings(db, { includeArchived: true }).map((holding) => [holding.id, holding]))

  const rows = summary.goals
    .filter((progress) => !progress.goal.isClosed)
    .map((progress): GoalRow => {
      const { amount, bucketIds } =
        plan === undefined
          ? { amount: money(0, currency), bucketIds: [] as readonly string[] }
          : goalMonthlyFromPlan(plan.result.allocations, progress.goal.id, currency)
      const due = progress.goal.targetDate === undefined ? undefined : yearMonthOf(progress.goal.targetDate)
      const until = paused.get(progress.goal.id)
      const stillPaused = pausedMonths(month, until)
      const line: GoalLine = {
        goalId: progress.goal.id,
        name: progress.goal.name,
        balance: progress.progressBalance,
        target: targetAmountOf(progress.target),
        due,
        monthly: amount,
        pausedMonths: stillPaused,
        agreedRateBasisPoints: agreedRate(holdings.get(progress.goal.defaultHoldingId ?? '')?.expectedReturn),
      }
      const needed = neededMonthly(line, month)
      return {
        progress,
        line,
        bucketIds,
        status: goalStatus(line, month),
        needed: needed !== undefined && needed.minor !== amount.minor ? needed : undefined,
        pausedUntil: stillPaused > 0 ? until : undefined,
        moved: movedIntoGoal(deposits, progress.goal.id, month, currency),
        versusPlan: versusPlan(deposits, progress.goal.id, month, amount, stillPaused > 0),
        stale: stale.get(progress.goal.id) ?? [],
      }
    })

  // A paused goal is not taking its amount this month: it goes back to what is left (S7).
  const taking = rows.reduce((running, row) => running + (row.pausedUntil === undefined ? row.line.monthly.minor : 0), 0)
  const given = rows.reduce((running, row) => running + (row.pausedUntil === undefined ? 0 : row.line.monthly.minor), 0)

  return {
    month,
    currency,
    rows,
    plan,
    inGoals: money(
      rows.reduce((running, row) => running + row.line.balance.minor, 0),
      currency,
    ),
    monthly: money(taking, currency),
    left: plan === undefined ? undefined : money(everythingElse(plan) + given, currency),
    closed: summary.goals.filter((progress) => progress.goal.isClosed),
    expenses: summary.monthly,
  }
}

/**
 * Plan's *Everything else*: what no bucket was given, plus what a *what's left* bucket of nothing
 * takes (M28 F10). A plan that ends in such a bucket gives every agora a job, and before F10 the
 * Goals page read that as nothing left, whatever the bucket held.
 */
export function everythingElse(plan: { readonly result: { readonly balance: Money; readonly allocations: readonly ComputedAllocation[] } }): number {
  return (
    plan.result.balance.minor +
    plan.result.allocations
      .filter((entry) => entry.allocation.mode === 'REMAINDER' && entry.bucket.targetKind === 'FREE')
      .reduce((running, entry) => running + entry.amount.minor, 0)
  )
}

/** The goals' combined balance after `months`, by plain addition. */
export function goalsAfter(rows: readonly GoalRow[], months: number, currency: CurrencyCode): Money {
  return money(
    rows.reduce((running, row) => running + balanceAfter(row.line, months).minor, 0),
    currency,
  )
}

// --- Writing a goal's monthly amount: one rule for a typed figure and a suggestion ----

function toNew(allocation: Allocation): NewAllocation {
  return {
    bucketId: allocation.bucketId,
    mode: allocation.mode,
    basisPoints: allocation.basisPoints,
    amount: allocation.amount,
    isLocked: allocation.isLocked,
  }
}

export type SetMonthlyResult = 'SET' | 'UNCHANGED' | 'NO_PLAN' | 'SEVERAL_BUCKETS'

function goalNameOf(db: Database, goalId: string): string {
  const row = query(db, 'SELECT name FROM fmt_saving_goal WHERE id = ?', [goalId])[0]
  return row === undefined ? 'Goal' : String(row['name'])
}

/** Set what goes toward a goal each month; Plan's own typed figure, through one rule (D-323). */
export function setGoalMonthly(
  db: Database,
  asOf: LocalDate,
  currency: CurrencyCode,
  goalId: string,
  minor: number,
  now: number,
): SetMonthlyResult {
  return setBucketMonthly(db, asOf, currency, 'SAVING_GOAL', goalId, goalNameOf(db, goalId), minor, now)
}

/**
 * The one write behind a goal's, a debt's and a category's monthly figure (D-327): the same
 * `changedTo` through `editGoalMonthly`, so the rest of the split moves by the one rule. Nothing
 * pointing at it gets a bucket, ahead of *What's left*. `planId` names the plan the figure is
 * read from (a category's is the plan in use for its month); omitted, it is the default.
 */
export function setBucketMonthly(
  db: Database,
  asOf: LocalDate,
  currency: CurrencyCode,
  kind: BucketPointsAt,
  targetId: string,
  bucketName: string,
  minor: number,
  now: number,
  planId?: string,
): SetMonthlyResult {
  const month = yearMonthOf(asOf)
  const plan = planMonth(db, { month, asOf, readings: false, planId })
  if (plan === undefined) return 'NO_PLAN'
  const current = goalMonthlyFromPlan(plan.result.allocations, targetId, currency, kind).amount.minor
  if (current === minor) return 'UNCHANGED'
  const edit = editGoalMonthly(
    plan.allocations,
    plan.buckets,
    targetId,
    minor,
    plan.result.splittable,
    plan.result.allocations.map((entry) => entry.allocation.id),
    current,
    kind,
  )
  if (edit.kind === 'ALLOCATIONS') {
    updateSplitPlan(db, plan.plan.id, { allocations: edit.allocations.map(toNew) }, now)
    return 'SET'
  }
  if (edit.kind === 'SEVERAL_BUCKETS') return 'SEVERAL_BUCKETS'
  if (minor <= 0) return 'UNCHANGED'
  const bucketId =
    edit.existingBucketId ?? createSplitBucket(db, { name: bucketName, targetKind: kind, targetId }, now).id
  const added: NewAllocation = { bucketId, mode: 'FIXED_AMOUNT', amount: money(minor, currency) }
  const kept = plan.allocations.map(toNew)
  const remainder = kept.findIndex((one) => one.mode === 'REMAINDER')
  const next = remainder === -1 ? [...kept, added] : [...kept.slice(0, remainder), added, ...kept.slice(remainder)]
  updateSplitPlan(db, plan.plan.id, { allocations: next }, now)
  // The list is drawn in the buckets' own order, so the new one is placed before *What's left*
  // there too; appended, it sat after it on Plan (M28 F10).
  const rest = kept[remainder]
  if (rest !== undefined && edit.existingBucketId === undefined) {
    const order = listSplitBuckets(db).map((bucket) => bucket.id).filter((id) => id !== bucketId)
    const at = order.indexOf(rest.bucketId)
    if (at !== -1) reorderSplitBuckets(db, [...order.slice(0, at), bucketId, ...order.slice(at)], now)
  }
  return 'SET'
}

// --- S3: suggest a split -----------------------------------------------------

/**
 * Goals by nearest date, inside what Plan has for
 * goals: what they take now plus what Plan has left. The read half of
 * `suggest_goal_amounts` and of the Suggest a split button.
 */
export function suggestGoalSplit(db: Database, asOf: LocalDate, currency: CurrencyCode): Suggestion | undefined {
  const read = goalsPlan(db, asOf, currency)
  if (read.plan === undefined || read.left === undefined || read.rows.length === 0) return undefined
  // What Plan can give goals: what they take now, what is unassigned, and what an Everything-else
  // bucket sized as the remainder would otherwise take. Fixed expenses and the other buckets stay put.
  const remainder = read.plan.result.allocations
    .filter((entry) => entry.allocation.mode === 'REMAINDER')
    .reduce((running, entry) => running + entry.amount.minor, 0)
  // `left` already holds a what's-left bucket of nothing (F10), so that part is not counted twice.
  const freeRemainder = everythingElse(read.plan) - read.plan.result.balance.minor
  const pool = money(Math.max(0, read.monthly.minor + read.left.minor + remainder - freeRemainder), currency)
  return suggestSplit(
    read.rows.map((row) => ({
      line: row.line,
      paused: row.pausedUntil !== undefined,
    })),
    pool,
    read.month,
  )
}

/** Write a suggestion: each goal's amount through Plan's own rule, one fresh read per goal. */
export function applyGoalSplit(
  db: Database,
  asOf: LocalDate,
  currency: CurrencyCode,
  suggestion: Suggestion,
  now: number,
): { readonly set: number; readonly problems: readonly string[] } {
  const problems: string[] = []
  let set = 0
  // Goals that give back first, so the ones that take find the room: writing in the
  // order of the suggestion would push a later, smaller amount into overflow.
  const ordered = [...suggestion.amounts].sort((a, b) => a.amount.minor - b.amount.minor)
  for (const amount of ordered) {
    if (amount.reason === 'PAUSED' || amount.reason === 'REACHED' || amount.reason === 'NO_TARGET') continue
    const result = setGoalMonthly(db, asOf, currency, amount.goalId, amount.amount.minor, now)
    if (result === 'SET') set += 1
    if (result === 'SEVERAL_BUCKETS') {
      problems.push(`${amount.name}: several of Plan's buckets are for it; edit them on Plan.`)
    }
    if (result === 'NO_PLAN') problems.push('The document has no plan.')
  }
  return { set, problems }
}
