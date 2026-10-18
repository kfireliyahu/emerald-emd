import { describe, expect, it } from 'vitest'

import { fromMajorUnits } from '@/core/money.ts'
import { normalizeMerchant } from '@/core/text.ts'
import { matches } from '@/domain/categorization.ts'
import type { CategoryRule } from '@/domain/model/rules.ts'
import {
  BLANK_DRAFT,
  QUIET_DAYS,
  asRule,
  draftFromMerchant,
  draftFromProviderCategory,
  draftFromSelection,
  draftOf,
  draftProblems,
  moveTo,
  neverFires,
  resolvedName,
  withKind,
  type RuleDraft,
} from './ruleEditing.ts'

function draft(overrides: Partial<RuleDraft> = {}): RuleDraft {
  return { ...BLANK_DRAFT, pattern: 'שופרסל', targetCategoryId: 'cat:groceries', ...overrides }
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

describe('draft and rule', () => {
  it('round-trips a rule through the editor unchanged', () => {
    const existing = rule({
      kind: 'REGEX',
      pattern: '^paz',
      conditions: { scopeAccountId: 'acc-cal', amountMin: fromMajorUnits(100, 'ILS') },
    })
    const identity = {
      id: existing.id,
      priority: existing.priority,
      origin: existing.origin,
      isEnabled: existing.isEnabled,
      createdAt: existing.createdAt,
      hitCount: existing.hitCount,
      lastMatchedAt: existing.lastMatchedAt,
    }

    expect(asRule(draftOf(existing), identity)).toEqual(existing)
  })

  it('trims the pattern it saves, and stores none for a condition-only kind', () => {
    expect(asRule(draft({ pattern: '  פז  ' })).pattern).toBe('פז')
    expect(
      asRule(
        draft({ kind: 'AMOUNT_RANGE', pattern: 'left over', conditions: { amountMin: fromMajorUnits(500, 'ILS') } }),
      ).pattern,
    ).toBe('')
  })

  it('keeps the conditions across a change of kind, and drops a pattern the new kind cannot use', () => {
    const scoped = draft({ conditions: { scopeAccountId: 'acc-cal' } })

    const amount = withKind(scoped, 'AMOUNT_RANGE')
    expect(amount.pattern).toBe('')
    expect(amount.conditions).toEqual({ scopeAccountId: 'acc-cal' })

    // And back again: the pattern is gone rather than lurking, so nothing the
    // user cannot see comes back with it.
    expect(withKind(amount, 'CONTAINS').pattern).toBe('')
  })

  it('validates through the engine, so the editor cannot disagree with an import', () => {
    expect(draftProblems(draft())).toEqual([])
    expect(draftProblems(draft({ targetCategoryId: '' })).map((problem) => problem.field)).toEqual([
      'targetCategoryId',
    ])
    expect(draftProblems(draft({ kind: 'REGEX', pattern: '([a-z' }))).toHaveLength(1)
    expect(draftProblems(draft({ kind: 'AMOUNT_RANGE' })).map((problem) => problem.field)).toEqual([
      'conditions',
    ])
  })
})

describe('draftFromMerchant', () => {
  it('pre-fills a contains rule over the form the engine compares', () => {
    // The normalized name, not the raw one: it is what `matches` tests against,
    // so a rule pre-filled with anything else could fail to match the very row
    // it was created from.
    const subject = normalizeMerchant('שופרסל דיל 344')
    const prefilled = draftFromMerchant(subject, 'cat:groceries')

    expect(prefilled.kind).toBe('CONTAINS')
    expect(prefilled.pattern).toBe('שופרסל דיל')
    expect(prefilled.targetCategoryId).toBe('cat:groceries')
    expect(draftProblems(prefilled)).toEqual([])
  })

  it('is valid apart from the category when the row has none', () => {
    const prefilled = draftFromMerchant('PAYPAL', undefined)
    expect(prefilled.targetCategoryId).toBe('')
    expect(draftProblems(prefilled).map((problem) => problem.field)).toEqual(['targetCategoryId'])
  })

  it('matches the row it came from', () => {
    // The point of the whole feature, as a test: a rule made from a merchant
    // fires on that merchant.
    const subject = normalizeMerchant('שופרסל דיל 344')
    const rule = asRule(draftFromMerchant(subject, 'cat:groceries'))

    expect(
      matches(rule, {
        merchantNormalized: subject,
        providerCategory: undefined,
        amount: fromMajorUnits(-421.05, 'ILS'),
        accountId: 'acc-cal',
      }),
    ).toBe(true)
  })
})

describe('draftFromProviderCategory', () => {
  it('pre-fills the provider string as printed, not the normalized merchant form', () => {
    // `normalizeMerchant` strips a trailing run of digits as a branch number,
    // which is right for a shop and wrong for a category that ends in one. The
    // engine compares provider categories through `matchable` instead, so the
    // raw string is the comparable one.
    const prefilled = draftFromProviderCategory('דלק ותחבורה 2', 'cat:fuel')

    expect(prefilled.kind).toBe('PROVIDER_CATEGORY')
    expect(prefilled.pattern).toBe('דלק ותחבורה 2')
    expect(prefilled.targetCategoryId).toBe('cat:fuel')
    expect(draftProblems(prefilled)).toEqual([])
  })

  it('is valid apart from the category when the row has none', () => {
    const prefilled = draftFromProviderCategory('מזון ומשקאות', undefined)
    expect(prefilled.targetCategoryId).toBe('')
    expect(draftProblems(prefilled).map((problem) => problem.field)).toEqual(['targetCategoryId'])
  })

  it('matches the row it came from, and only on the provider category', () => {
    // The point of the feature: the rule fires on the row it was written from,
    // whatever the merchant is — and does not fire on a row the provider filed
    // somewhere else, however similar the shop.
    const rule = asRule(draftFromProviderCategory('מזון ומשקאות', 'cat:groceries'))

    expect(
      matches(rule, {
        merchantNormalized: normalizeMerchant('שופרסל דיל 344'),
        providerCategory: 'מזון ומשקאות',
        amount: fromMajorUnits(-421.05, 'ILS'),
        accountId: 'acc-cal',
      }),
    ).toBe(true)

    expect(
      matches(rule, {
        merchantNormalized: normalizeMerchant('שופרסל דיל 344'),
        providerCategory: 'פנאי ובידור',
        amount: fromMajorUnits(-421.05, 'ILS'),
        accountId: 'acc-cal',
      }),
    ).toBe(false)
  })
})

describe('resolvedName', () => {
  it('prefers what the user typed', () => {
    expect(resolvedName(draft({ name: '  Groceries  ' }))).toBe('Groceries')
  })

  it('falls back to the pattern, which is what most rules are called anyway', () => {
    expect(resolvedName(draft({ pattern: 'פז' }))).toBe('פז')
    expect(resolvedName(draft({ pattern: '' }))).toBe('New rule')
  })

  it('names the two condition-only kinds after their condition', () => {
    expect(resolvedName(draft({ kind: 'ACCOUNT', pattern: '' }))).toBe('Account rule')
    expect(resolvedName(draft({ kind: 'AMOUNT_RANGE', pattern: '' }))).toBe('Amount rule')
  })
})

describe('moveTo', () => {
  const ids = ['a', 'b', 'c']

  it('moves an id to a position', () => {
    expect(moveTo(ids, 'c', 0)).toEqual(['c', 'a', 'b'])
    expect(moveTo(ids, 'a', 2)).toEqual(['b', 'c', 'a'])
    expect(moveTo(ids, 'b', 2)).toEqual(['a', 'c', 'b'])
  })

  it('clamps at both ends rather than dropping the id off one', () => {
    expect(moveTo(ids, 'a', -1)).toEqual(ids)
    expect(moveTo(ids, 'c', 9)).toEqual(ids)
  })

  it('returns the list it was given when nothing moves', () => {
    expect(moveTo(ids, 'b', 1)).toBe(ids)
    expect(moveTo(ids, 'missing', 0)).toBe(ids)
  })

  it('does not mutate what it was given', () => {
    const original = [...ids]
    moveTo(ids, 'a', 2)
    expect(ids).toEqual(original)
  })
})

describe('neverFires', () => {
  const now = 1_000_000_000_000
  const quiet = QUIET_DAYS * 24 * 60 * 60 * 1000

  it('flags an old rule that has never matched anything', () => {
    expect(neverFires(rule({ createdAt: now - quiet }), now)).toBe(true)
  })

  it('says nothing about a rule that has not had the chance yet', () => {
    // Zero hits on a rule written this morning is not evidence of anything —
    // no import has run since.
    expect(neverFires(rule({ createdAt: now - 1000 }), now)).toBe(false)
  })

  it('says nothing about a rule that has fired', () => {
    expect(neverFires(rule({ createdAt: now - quiet, hitCount: 1 }), now)).toBe(false)
  })
})

/**
 * D-173's narrow gesture: a rule from the words somebody highlighted, which is
 * the property B9 said the provider-category rule lacks.
 */
describe('draftFromSelection', () => {
  const subject = normalizeMerchant('שופרסל דיל סניף 344')

  it('makes a contains rule out of the highlighted words', () => {
    const prefilled = draftFromSelection('שופרסל', subject, 'cat:groceries')

    expect(prefilled?.kind).toBe('CONTAINS')
    // As highlighted, not normalized: `containsMerchant` normalizes the pattern
    // at match time, and a pre-normalized pattern is a field the person cannot
    // recognise as the words they selected.
    expect(prefilled?.pattern).toBe('שופרסל')
    expect(prefilled?.targetCategoryId).toBe('cat:groceries')
  })

  it('trims what a selection drags in at its edges', () => {
    expect(draftFromSelection('  שופרסל \n', subject, undefined)?.pattern).toBe('שופרסל')
  })

  it('refuses a selection that would not match the row it came from', () => {
    // The whole care of it. The engine normalizes both sides (D-083), so a
    // selection the normalization removes produces a rule that fails on its own
    // example — and an offer that cannot work is worse than no offer.
    expect(draftFromSelection('344', subject, undefined)).toBeUndefined()
    expect(draftFromSelection('', subject, undefined)).toBeUndefined()
    expect(draftFromSelection('   ', subject, undefined)).toBeUndefined()
    expect(draftFromSelection('פז', subject, undefined)).toBeUndefined()
  })

  it('carries no category when the row has none', () => {
    expect(draftFromSelection('שופרסל', subject, undefined)?.targetCategoryId).toBe('')
  })
})
