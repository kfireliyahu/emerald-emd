import type { Category } from '@/data/repositories/categoryRepository.ts'
import type { FixedExpense, FixedRole } from '@/domain/model/fixed.ts'
import type { SplitBucket, TargetKind } from '@/domain/model/plan.ts'
import type { CategoryPalette } from '@/ui/charts/categoryPalette.ts'
import { pathArrows, tNow } from '@/i18n/words.ts'
import { MATCH_KIND_LABEL } from '@/ui/fixed/labels.ts'

/**
 * What the Plan screen calls things (M28 U7, D-319).
 *
 * Here rather than generated from the identifiers, for the reason every label
 * file in this app is: `SPLIT` reads as "Part of the split", which is the
 * sentence chosen, and no title-casing gets there.
 */
export const ROLE_LABEL: Readonly<Record<FixedRole, string>> = {
  get NET() {
    return tNow('plan.role.NET')
  },
  get SPLIT() {
    return tNow('plan.role.SPLIT')
  },
  get IGNORE() {
    return tNow('plan.role.IGNORE')
  },
}

export const KIND_LABEL: Readonly<Record<TargetKind, string>> = {
  get CATEGORY() {
    return tNow('plan.kind.CATEGORY')
  },
  get SAVING_GOAL() {
    return tNow('plan.kind.SAVING_GOAL')
  },
  get DEBT() {
    return tNow('plan.kind.DEBT')
  },
  get FUND() {
    return tNow('plan.kind.FUND')
  },
  get ACCOUNT() {
    return tNow('plan.kind.ACCOUNT')
  },
  get FREE() {
    return tNow('plan.kind.FREE')
  },
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
  if (expense.matchKind === 'MERCHANT_PATTERN') return tNow('plan.source.merchant', { name: expense.matchRef ?? '' })
  if (expense.matchKind === 'CATEGORY') {
    return tNow('plan.source.category', { path: pathArrows(categories.find((one) => one.id === expense.matchRef)?.path ?? '') })
  }
  if (expense.matchKind === 'PAYCHECK_DEDUCTION') return tNow('plan.source.paycheck')
  return MATCH_KIND_LABEL.MANUAL_ONLY
}
