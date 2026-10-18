import type { Category } from '@/data/repositories/categoryRepository.ts'
import type { FixedExpense, FixedRole } from '@/domain/model/fixed.ts'
import type { SplitBucket, TargetKind } from '@/domain/model/plan.ts'
import type { CategoryPalette } from '@/ui/charts/categoryPalette.ts'
import { MATCH_KIND_LABEL } from '@/ui/fixed/labels.ts'

/**
 * What the Plan screen calls things (M28 U7, D-319).
 *
 * Here rather than generated from the identifiers, for the reason every label
 * file in this app is: `SPLIT` reads as "Part of the split", which is the
 * sentence chosen, and no title-casing gets there.
 */
export const ROLE_LABEL: Readonly<Record<FixedRole, string>> = {
  NET: 'Out of net',
  SPLIT: 'Part of the split',
  IGNORE: 'Ignore',
}

export const KIND_LABEL: Readonly<Record<TargetKind, string>> = {
  CATEGORY: 'Category',
  SAVING_GOAL: 'Goal',
  DEBT: 'Debt',
  FUND: 'Fund',
  ACCOUNT: 'Account',
  FREE: 'Nothing in particular',
}

/**
 * **A bucket takes the colour of what it points at** (D-319), not one by
 * position: a category its own hue (D-314), saved's darker green for a goal, a
 * fund or an account (D-313), and neutral for a debt or for nothing. The same
 * thing is therefore the same colour on this bar, on Home and in Categories.
 */
export function bucketColour(
  bucket: Pick<SplitBucket, 'targetKind' | 'targetId'>,
  palette: CategoryPalette,
): string {
  switch (bucket.targetKind) {
    case 'CATEGORY':
      return palette.colorOf(bucket.targetId)
    case 'SAVING_GOAL':
    case 'FUND':
    case 'ACCOUNT':
      return 'var(--color-flow-saved)'
    case 'DEBT':
    case 'FREE':
      return 'var(--color-ink-tertiary)'
  }
}

/** Where a fixed expense is recognised from, in a few words. */
export function sourceText(expense: FixedExpense, categories: readonly Category[]): string {
  if (expense.matchKind === 'MERCHANT_PATTERN') return `Merchant: ${expense.matchRef ?? ''}`
  if (expense.matchKind === 'CATEGORY') {
    return `Category: ${categories.find((one) => one.id === expense.matchRef)?.path ?? ''}`
  }
  if (expense.matchKind === 'PAYCHECK_DEDUCTION') return 'Taken from your paycheck'
  return MATCH_KIND_LABEL.MANUAL_ONLY
}
