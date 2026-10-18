import { describe, expect, it } from 'vitest'

import { fromMajorUnits } from '@/core/money.ts'
import { normalizeMerchant } from '@/core/text.ts'
import { matches } from '@/domain/categorization.ts'
import type { CategoryRule, RuleSubject } from '@/domain/model/rules.ts'
import type { ReapplyCandidate } from '@/domain/reapply.ts'
import { draftFromMerchant, draftProblems } from '@/domain/ruleEditing.ts'
import {
  INSISTENT_AFTER,
  learnedDraft,
  offerForCorrection,
  offerForDraft,
  offeredDraft,
  pastRows,
  type LearningOffer,
} from './learning.ts'

function subject(overrides: Partial<RuleSubject> = {}): RuleSubject {
  return {
    merchantNormalized: normalizeMerchant('שופרסל דיל 344'),
    providerCategory: 'סופרמרקט',
    amount: fromMajorUnits(-421.05, 'ILS'),
    accountId: 'acc-cal',
    ...overrides,
  }
}

function rule(overrides: Partial<CategoryRule> = {}): CategoryRule {
  return {
    id: 'rule-1',
    name: 'Groceries',
    kind: 'CONTAINS',
    pattern: 'שופרסל',
    targetCategoryId: 'cat:groceries',
    priority: 10,
    origin: 'USER',
    isEnabled: true,
    conditions: {},
    createdAt: 1000,
    hitCount: 0,
    lastMatchedAt: undefined,
    ...overrides,
  }
}

/** An offer that has to exist, so a test about its contents reads as one. */
function offerFor(options: {
  categoryId?: string | undefined
  corrections?: number
  rules?: readonly CategoryRule[]
  subject?: RuleSubject
}): LearningOffer {
  const offer = offerForCorrection({
    subject: options.subject ?? subject(),
    categoryId: options.categoryId ?? 'cat:groceries',
    corrections: options.corrections ?? 1,
    rules: options.rules ?? [],
  })
  if (offer === undefined) throw new Error('expected an offer to be made')
  return offer
}

/** A draft's pattern as the engine would read it once the rule is saved. */
function stored(pattern: string, kind: CategoryRule['kind']): CategoryRule {
  return rule({ kind, pattern, origin: 'LEARNED_FROM_CORRECTION' })
}

describe('offerForCorrection', () => {
  it('offers a rule for the merchant that was just corrected', () => {
    const offer = offerFor({})

    expect(offer.categoryId).toBe('cat:groceries')
    expect(offer.merchantNormalized).toBe('שופרסל דיל')
    expect(offer.insistent).toBe(false)
  })

  it('offers nothing when the category was cleared', () => {
    expect(
      offerForCorrection({ subject: subject(), categoryId: undefined, corrections: 0, rules: [] }),
    ).toBeUndefined()
  })

  it('offers nothing when the merchant normalizes to nothing', () => {
    // A cell of invisible bidi marks and nothing else, which Israeli exports do
    // produce. The rule it would make has an empty pattern, and an empty
    // pattern matches every row in the ledger — `validateRule` refuses it, and
    // the offer asks `validateRule` rather than having its own opinion.
    const nothing = normalizeMerchant('‏ ‎')
    expect(nothing).toBe('')

    expect(
      offerForCorrection({
        subject: subject({ merchantNormalized: nothing }),
        categoryId: 'cat:groceries',
        corrections: 1,
        rules: [],
      }),
    ).toBeUndefined()
  })

  it('offers nothing when a rule already puts this row in this category', () => {
    // Nothing has been learned that is not already known: the row was imported
    // before the rule was written, so it needed a hand, but the next one will
    // not. Asking anyway teaches the user to ignore the question.
    expect(
      offerForCorrection({
        subject: subject(),
        categoryId: 'cat:groceries',
        corrections: 1,
        rules: [rule()],
      }),
    ).toBeUndefined()
  })

  it('offers when the correction overruled a rule', () => {
    // The case F03 cares about most: a rule answered, the user disagreed, and
    // the disagreement is exactly the thing worth writing down.
    expect(offerFor({ categoryId: 'cat:shopping', rules: [rule()] }).categoryId).toBe(
      'cat:shopping',
    )
  })

  it('offers when the only rule that agrees is disabled', () => {
    // A disabled rule assigns nothing, so it cannot be the reason not to ask.
    // The engine decides this, rather than a second scan for a similar pattern.
    expect(offerFor({ rules: [rule({ isEnabled: false })] })).toBeDefined()
  })

  it('offers when the rule that agrees is scoped to another account', () => {
    expect(offerFor({ rules: [rule({ conditions: { scopeAccountId: 'acc-max' } })] })).toBeDefined()
  })
})

describe('the third repeat', () => {
  it('is quiet below the threshold and insistent from it on', () => {
    expect(INSISTENT_AFTER).toBe(3)
    expect(offerFor({ corrections: 1 }).insistent).toBe(false)
    expect(offerFor({ corrections: 2 }).insistent).toBe(false)
    expect(offerFor({ corrections: 3 }).insistent).toBe(true)
    expect(offerFor({ corrections: 4 }).insistent).toBe(true)
  })

  it('carries the count, so the offer can say it out loud', () => {
    expect(offerFor({ corrections: 3 }).corrections).toBe(3)
  })
})

describe('the draft an offer produces', () => {
  it('is a contains rule over the normalized merchant (D-373)', () => {
    const draft = learnedDraft(normalizeMerchant('שופרסל דיל 344'), 'cat:groceries')

    expect(draft.kind).toBe('CONTAINS')
    expect(draft.pattern).toBe('שופרסל דיל')
    expect(draft.targetCategoryId).toBe('cat:groceries')
    expect(draft.conditions).toEqual({})
  })

  it('saves — the editor would not refuse it', () => {
    expect(draftProblems(offerFor({}).draft)).toEqual([])
  })

  it('fires on the very row it was created from', () => {
    // The D-041 failure mode: a rule pre-filled with the *raw* merchant would
    // never match the row that prompted it, because the engine matches the
    // normalized form.
    const corrected = subject()
    const offer = offerFor({ subject: corrected })

    expect(matches(stored(offer.draft.pattern, offer.draft.kind), corrected)).toBe(true)
  })

  it('survives the same shop at another branch, and a name that grows past it', () => {
    // Exact covered the first and missed the second every month: what follows
    // a branch number is not something normalization takes off.
    const offer = offerFor({})
    const rule = stored(offer.draft.pattern, offer.draft.kind)

    expect(matches(rule, subject({ merchantNormalized: normalizeMerchant('שופרסל דיל 812') }))).toBe(true)
    expect(matches(rule, subject({ merchantNormalized: normalizeMerchant('שופרסל דיל 344 חולון') }))).toBe(true)
  })
})

describe('editing the offer', () => {
  it('leaves the offer alone when nothing is touched', () => {
    const offer = offerFor({})

    expect(offeredDraft(offer, { pattern: offer.draft.pattern, categoryId: offer.categoryId })).toEqual(
      offer.draft,
    )
  })

  it('stays one kind when the pattern is shortened, and still fires on its row', () => {
    const corrected = subject()
    const draft = offeredDraft(offerFor({ subject: corrected }), { pattern: 'שופרסל', categoryId: 'cat:groceries' })

    expect(draft.kind).toBe('CONTAINS')
    expect(matches(stored(draft.pattern, draft.kind), corrected)).toBe(true)
  })

  it('takes the category chosen in the offer', () => {
    const draft = offeredDraft(offerFor({}), { pattern: 'שופרסל דיל', categoryId: 'cat:eating-out' })

    expect(draft.targetCategoryId).toBe('cat:eating-out')
  })

  it('refuses an emptied field, or no category, the way the editor would', () => {
    expect(draftProblems(offeredDraft(offerFor({}), { pattern: '   ', categoryId: 'cat:groceries' }))).not.toEqual([])
    expect(draftProblems(offeredDraft(offerFor({}), { pattern: 'שופרסל', categoryId: undefined }))).not.toEqual([])
  })
})

describe('offerForDraft', () => {
  it('is the same offer for a rule somebody asked for, with no category yet', () => {
    const offer = offerForDraft('שופרסל דיל', draftFromMerchant('שופרסל דיל', undefined))

    expect(offer.categoryId).toBe('')
    expect(offer.draft.kind).toBe('CONTAINS')
    expect(offer.insistent).toBe(false)
  })
})

describe('pastRows', () => {
  const candidate = (id: string, merchant: string, categoryId?: string): ReapplyCandidate => ({
    id,
    subject: subject({ merchantNormalized: normalizeMerchant(merchant) }),
    categoryId,
  })
  const draft = learnedDraft('שופרסל דיל', 'cat:groceries')

  it('counts the rows the rule would file, and none it would leave', () => {
    const rows = [
      candidate('a', 'שופרסל דיל 344'),
      candidate('b', 'שופרסל דיל 812 חולון'),
      candidate('c', 'שופרסל דיל 344', 'cat:groceries'),
      candidate('d', 'רמי לוי'),
    ]

    expect(pastRows(draft, [], rows)).toBe(2)
  })

  it('leaves a row a rule the user wrote already answers', () => {
    const mine = rule({ pattern: 'שופרסל', targetCategoryId: 'cat:household' })

    expect(pastRows(draft, [mine], [candidate('a', 'שופרסל דיל 344', 'cat:household')])).toBe(0)
  })

  it('is nothing while the draft could not be saved', () => {
    expect(pastRows({ ...draft, pattern: '' }, [], [candidate('a', 'שופרסל דיל')])).toBe(0)
  })
})
