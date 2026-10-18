import { money, type CurrencyCode, type Money } from '@/core/money.ts'

/** One budgeted category against what the month spent in it (D-327). */
export interface BudgetLine {
  readonly categoryId: string
  readonly name: string
  readonly spent: Money
  readonly budget: Money
  /** Spent is more than the budget: drawn in the expense colour. */
  readonly over: boolean
}

/**
 * Each budgeted category's month, biggest budget first. A category's spend is its **rolled**
 * line (subcategories included, D-088), the figure the bucket is measured by on Plan; a category
 * that spent nothing is a line of zero, because an unspent budget is the answer, not an absence.
 */
export function budgetLines(
  budgets: ReadonlyMap<string, Money>,
  names: ReadonlyMap<string, string>,
  spentOf: (categoryId: string) => Money | undefined,
  currency: CurrencyCode,
): readonly BudgetLine[] {
  return [...budgets]
    .map(([categoryId, budget]): BudgetLine => {
      const spent = spentOf(categoryId) ?? money(0, currency)
      return {
        categoryId,
        name: names.get(categoryId) ?? categoryId,
        spent,
        budget,
        over: spent.minor > budget.minor,
      }
    })
    .sort((a, b) => b.budget.minor - a.budget.minor || a.name.localeCompare(b.name))
}
