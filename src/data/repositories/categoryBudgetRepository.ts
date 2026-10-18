import type { Database } from 'sql.js'

import { money, type CurrencyCode, type Money } from '@/core/money.ts'
import { yearMonthOf, type LocalDate, type YearMonth } from '@/core/time.ts'
import { subtreeOf } from '@/domain/categoryTree.ts'
import { goalMonthlyFromPlan } from '@/domain/goalPlan.ts'
import type { StarterHeading } from '@/domain/starterPlan.ts'
import { listCategories } from './categoryRepository.ts'
import { setBucketMonthly, type SetMonthlyResult } from './goalPlanRepository.ts'
import { planMonth } from './planMonthRepository.ts'
import { categoryTree, createSplitPlan, planOnMonth, spendUnder } from './splitPlanRepository.ts'
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
  const months = monthlySummaries(db, asOf, { currency })
    .filter((one) => one.transactionCount > 0)
    .slice(-3)
  const observations = months.flatMap((one) => categoryObservations(db, one.period, { currency }))
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
