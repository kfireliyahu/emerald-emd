import type { Database } from 'sql.js'

import { money, type CurrencyCode, type Money } from '@/core/money.ts'
import { distribute } from '@/core/percent.ts'
import { yearMonthOf, type LocalDate, type YearMonth } from '@/core/time.ts'
import { subtreeOf } from '@/domain/categoryTree.ts'
import { goalMonthlyFromPlan } from '@/domain/goalPlan.ts'
import { resolveBasis, type ResolvedBasis } from '@/domain/splitter.ts'
import {
  starterProposal,
  type StarterAnswer,
  type StarterHeading,
  type StarterProposal,
} from '@/domain/starterPlan.ts'
import { inTransaction } from '../db/database.ts'
import { listCategories } from './categoryRepository.ts'
import { setBucketMonthly, type SetMonthlyResult } from './goalPlanRepository.ts'
import { listPaychecks } from './paycheckRepository.ts'
import { planMonth } from './planMonthRepository.ts'
import { salaryLanded } from './salaryRepository.ts'
import {
  categoryTree,
  createSplitBucket,
  createSplitPlan,
  listSplitBuckets,
  listSplitPlans,
  planOnMonth,
  reorderSplitBuckets,
  spendUnder,
  updateSplitBucket,
  updateSplitPlan,
  type NewAllocation,
} from './splitPlanRepository.ts'
import { categoryObservations, monthlySummaries } from './statisticsRepository.ts'

/**
 * A category's target is its Plan bucket (M28 U11, D-327): one number, not two.
 *
 * **A read and one write, and no table of its own.** The budget of a category is the sum of the
 * buckets that point at it in the plan in use for the month; setting it is the write Plan's own
 * field makes (`setBucketMonthly`), so the Categories panel, Plan and the tools cannot disagree.
 * The old `monthly_target` column is gone (M36 U09).
 */

/** The plan in use for a month: the one the month was given on Plan, else the default (M31 U4). */
export function planInUse(db: Database, month: YearMonth): string | undefined {
  return planOnMonth(db, month)
}

/**
 * Each category's monthly budget for `month`. A category with no bucket, or a bucket of nothing,
 * is not in the map: a budget of nothing and no budget are not claims Home should draw.
 */
export function categoryBudgets(
  db: Database,
  asOf: LocalDate,
  currency: CurrencyCode,
  month: YearMonth = yearMonthOf(asOf),
): ReadonlyMap<string, Money> {
  const planId = planInUse(db, month)
  const plan = planId === undefined ? undefined : planMonth(db, { planId, month, asOf, readings: false })
  const budgets = new Map<string, Money>()
  if (plan === undefined) return budgets
  for (const category of listCategories(db, { includeArchived: true })) {
    const { amount, bucketIds } = goalMonthlyFromPlan(plan.result.allocations, category.id, currency, 'CATEGORY')
    if (bucketIds.length > 0 && amount.minor > 0) budgets.set(category.id, money(amount.minor, currency))
  }
  return budgets
}

/**
 * Set (or, with 0, empty) a category's budget in the plan in use for its month.
 *
 * **With no plan at all, a budget makes one** (M31 U3): the default plan, holding
 * this bucket and nothing else. It used to refuse and send the person to Plan to
 * make the thing a budget lives in, which was a step the app could take itself.
 */
export function setCategoryBudget(
  db: Database,
  asOf: LocalDate,
  currency: CurrencyCode,
  categoryId: string,
  minor: number,
  now: number,
): SetMonthlyResult {
  const month = yearMonthOf(asOf)
  const name = listCategories(db, { includeArchived: true }).find((one) => one.id === categoryId)?.name ?? 'Category'
  let planId = planInUse(db, month)
  if (planId === undefined) {
    if (minor <= 0) return 'UNCHANGED'
    planId = createSplitPlan(db, { name: 'Default', currency, isDefault: true }, now).id
  }
  return setBucketMonthly(db, asOf, currency, 'CATEGORY', categoryId, name, minor, now, planId)
}

/**
 * The top-level categories, each with what went out under it over the last
 * three months the ledger holds: what the 50/30/20 starter shares its halves by
 * (M31 U3). A budget on a heading counts everything under it (D-348), so this
 * does too.
 */
export function starterHeadings(db: Database, asOf: LocalDate, currency: CurrencyCode): readonly StarterHeading[] {
  const observations = starterMonths(db, asOf, currency).flatMap((one) => categoryObservations(db, one, { currency }))
  const tree = categoryTree(db)
  return listCategories(db)
    .filter((one) => one.parentId === undefined)
    .map((one) => ({
      id: one.id,
      name: one.name,
      kind: one.kind,
      isSystem: one.isSystem,
      spentMinor: spendUnder(observations, [], subtreeOf(tree, one.id), currency)?.amount.minor ?? 0,
    }))
}

/** The months the starter reads what went out over: the last three the ledger holds transactions in. */
export function starterMonths(db: Database, asOf: LocalDate, currency: CurrencyCode): readonly YearMonth[] {
  return monthlySummaries(db, asOf, { currency })
    .filter((one) => one.transactionCount > 0)
    .slice(-3)
    .map((one) => one.period)
}

/** The starter as the screen and `start_plan` show it, before anything is made (M59 U4, D-580). */
export interface StarterPlanProposal extends StarterProposal {
  readonly currency: CurrencyCode
  /** The months what went out was read over, oldest first; empty when the ledger holds none. */
  readonly months: readonly YearMonth[]
  /** What the plan would split — the last paycheck, else the salary that came in; undefined with neither. */
  readonly basis: ResolvedBasis | undefined
  /** Each bucket's amount a month: by its category's id, or by its share for one in its own name. */
  readonly amounts: ReadonlyMap<string, Money>
  /** A category a bucket already points at, and that bucket's name: the plan uses it rather than another. */
  readonly kept: ReadonlyMap<string, string>
  /** The document has a plan already: the starter is for the first one. */
  readonly planExists: boolean
}

/** What a new plan splits: the default basis, my last paycheck, as `planMonth` resolves it. */
function starterBasis(db: Database, currency: CurrencyCode): ResolvedBasis | undefined {
  const paychecks = listPaychecks(db)
  const plan = {
    id: '',
    name: 'Default',
    basisKind: 'LAST_PAYCHECK' as const,
    basisPaycheckId: undefined,
    basisMonths: undefined,
    customAmount: undefined,
    currency,
    isDefault: true,
  }
  const basis = resolveBasis(plan, paychecks, paychecks.length === 0 ? salaryLanded(db, currency) : [])
  return basis.unavailable || basis.amount.minor <= 0 ? undefined : basis
}

/**
 * **The 50 / 30 / 20 starter, shown before it is made** (M59 U4, D-580): every top-level
 * category with its share, its part, what that comes to a month and why. `answers` is the
 * person's say about any of them; what is shown is exactly what `makeStarterPlan` writes.
 */
export function starterPlanProposal(
  db: Database,
  asOf: LocalDate,
  currency: CurrencyCode,
  answers: ReadonlyMap<string, StarterAnswer>,
): StarterPlanProposal {
  const proposal = starterProposal(starterHeadings(db, asOf, currency), answers)
  const basis = starterBasis(db, currency)
  const amounts = new Map<string, Money>()
  if (basis !== undefined) {
    // The splitter's own division of a plan of percentages that add up to the whole.
    const parts = distribute(basis.amount.minor, proposal.buckets.map((one) => one.basisPoints))
    proposal.buckets.forEach((one, index) => amounts.set(one.categoryId ?? one.share, money(parts[index] ?? 0, currency)))
  }
  const kept = new Map(
    listSplitBuckets(db).flatMap((one) =>
      one.targetKind === 'CATEGORY' && one.targetId !== undefined ? [[one.targetId, one.name] as const] : [],
    ),
  )
  return {
    ...proposal,
    currency,
    months: starterMonths(db, asOf, currency),
    basis,
    amounts,
    kept,
    planExists: listSplitPlans(db).length > 0,
  }
}

/**
 * **Make the starter**: the default plan, one bucket per part of the proposal — a bucket already
 * on the category is the one used (M31 U3), and it takes the share it is made for — in the
 * starter's order. Refused while a plan exists or a heading still waits for an answer. The plan's id.
 */
export function makeStarterPlan(
  db: Database,
  asOf: LocalDate,
  currency: CurrencyCode,
  answers: ReadonlyMap<string, StarterAnswer>,
  now: number,
): string {
  const proposal = starterPlanProposal(db, asOf, currency, answers)
  if (proposal.planExists) throw new Error('This document has a plan already; the starter makes the first one.')
  if (proposal.unanswered.length > 0) {
    throw new Error(`Say which share ${proposal.unanswered.map((one) => one.name).join(', ')} is first.`)
  }
  let planId = ''
  inTransaction(db, () => {
    planId = createSplitPlan(db, { name: 'Default', currency, isDefault: true }, now).id
    const held = listSplitBuckets(db)
    const allocations: NewAllocation[] = proposal.buckets.map((entry) => ({
      bucketId:
        held.find((one) => entry.categoryId !== undefined && one.targetKind === 'CATEGORY' && one.targetId === entry.categoryId)
          ?.id ??
        createSplitBucket(
          db,
          entry.categoryId === undefined
            ? { name: entry.name, share: entry.share }
            : { name: entry.name, targetKind: 'CATEGORY', targetId: entry.categoryId, share: entry.share },
          now,
        ).id,
      mode: 'PERCENTAGE',
      basisPoints: entry.basisPoints,
    }))
    updateSplitPlan(db, planId, { allocations }, now)
    // A bucket already there takes the share it is used for now, and the starter's order (M31 U4).
    for (const [index, entry] of allocations.entries()) {
      const share = proposal.buckets[index]?.share
      if (share !== undefined) updateSplitBucket(db, entry.bucketId, { share }, now)
    }
    const placed = allocations.map((entry) => entry.bucketId)
    reorderSplitBuckets(db, [...placed, ...held.map((one) => one.id).filter((id) => !placed.includes(id))], now)
  })
  return planId
}
