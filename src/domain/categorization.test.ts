import { describe, expect, it } from 'vitest'

import { fromMajorUnits } from '@/core/money.ts'
import { normalizeMerchant } from '@/core/text.ts'
import type { CategoryRule, RuleSubject } from '@/domain/model/rules.ts'
import { compareRules, explain, firstMatch, matches, sortRules, validateRule } from './categorization.ts'

function rule(overrides: Partial<CategoryRule> = {}): CategoryRule {
  return {
    id: 'rule-1',
    name: 'A rule',
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

function subject(overrides: Partial<RuleSubject> = {}): RuleSubject {
  return {
    merchantNormalized: normalizeMerchant('שופרסל דיל 344'),
    providerCategory: 'סופרמרקט',
    amount: fromMajorUnits(-421.05, 'ILS'),
    accountId: 'acc-cal',
    ...overrides,
  }
}

describe('matches', () => {
  it('compares an exact rule in the same normalized form as the subject', () => {
    // The pattern goes through `normalizeMerchant` too, so the branch number in
    // the name the user copied off the transaction cannot stop it matching.
    expect(matches(rule({ kind: 'EXACT_MERCHANT', pattern: 'שופרסל דיל 344' }), subject())).toBe(true)
    expect(matches(rule({ kind: 'EXACT_MERCHANT', pattern: 'שופרסל דיל' }), subject())).toBe(true)
  })

  it('does not let an exact rule match a longer name', () => {
    expect(matches(rule({ kind: 'EXACT_MERCHANT', pattern: 'שופרסל' }), subject())).toBe(false)
  })

  it('matches a substring for CONTAINS, and nothing at all for an empty pattern', () => {
    expect(matches(rule({ pattern: 'שופרסל' }), subject())).toBe(true)
    expect(matches(rule({ pattern: '   ' }), subject())).toBe(false)
  })

  it('matches a regex case-insensitively, because the subject is uppercased', () => {
    const paypal = subject({ merchantNormalized: normalizeMerchant('PayPal *Steam') })
    expect(matches(rule({ kind: 'REGEX', pattern: 'paypal' }), paypal)).toBe(true)
    expect(matches(rule({ kind: 'REGEX', pattern: '^paypal' }), paypal)).toBe(true)
    // Anchored at the wrong end: the rule is still a regex, not a substring.
    expect(matches(rule({ kind: 'REGEX', pattern: '^steam' }), paypal)).toBe(false)
  })

  it('treats a regex that does not compile as matching nothing', () => {
    expect(matches(rule({ kind: 'REGEX', pattern: '(' }), subject())).toBe(false)
  })

  it('matches a provider category exactly, keeping digits a merchant rule would strip', () => {
    const rows = subject({ providerCategory: ' סופרמרקט ' })
    expect(matches(rule({ kind: 'PROVIDER_CATEGORY', pattern: 'סופרמרקט' }), rows)).toBe(true)
    expect(matches(rule({ kind: 'PROVIDER_CATEGORY', pattern: 'דלק' }), rows)).toBe(false)

    const numbered = subject({ providerCategory: 'ענף 24' })
    expect(matches(rule({ kind: 'PROVIDER_CATEGORY', pattern: 'ענף 24' }), numbered)).toBe(true)
  })

  it('never matches a provider-category rule when the file stated no category', () => {
    expect(
      matches(rule({ kind: 'PROVIDER_CATEGORY', pattern: 'סופרמרקט' }), subject({ providerCategory: undefined })),
    ).toBe(false)
  })

  it('reads amount bounds as magnitudes, so an outflow is inside them', () => {
    // The charge is -421.05: signed, because the importer makes spending
    // negative (D-004). "Between 100 and 500" has to mean the size of it.
    const band = rule({
      kind: 'AMOUNT_RANGE',
      pattern: '',
      conditions: { amountMin: fromMajorUnits(100, 'ILS'), amountMax: fromMajorUnits(500, 'ILS') },
    })
    expect(matches(band, subject())).toBe(true)
    expect(matches(band, subject({ amount: fromMajorUnits(-620, 'ILS') }))).toBe(false)
    expect(matches(band, subject({ amount: fromMajorUnits(-50, 'ILS') }))).toBe(false)
  })

  it('refuses an amount rule with no bounds rather than matching everything', () => {
    expect(matches(rule({ kind: 'AMOUNT_RANGE', pattern: '', conditions: {} }), subject())).toBe(false)
  })

  it('refuses to compare bounds across currencies', () => {
    const band = rule({
      kind: 'AMOUNT_RANGE',
      pattern: '',
      conditions: { amountMin: fromMajorUnits(10, 'USD') },
    })
    expect(matches(band, subject())).toBe(false)
  })

  it('matches an account rule only on its own account, and needs one', () => {
    const business = rule({ kind: 'ACCOUNT', pattern: '', conditions: { scopeAccountId: 'acc-cal' } })
    expect(matches(business, subject())).toBe(true)
    expect(matches(business, subject({ accountId: 'acc-max' }))).toBe(false)
    expect(matches(rule({ kind: 'ACCOUNT', pattern: '', conditions: {} }), subject())).toBe(false)
  })

  it('ANDs a kind with its conditions', () => {
    const scoped = rule({ pattern: 'שופרסל', conditions: { scopeAccountId: 'acc-max' } })
    expect(matches(scoped, subject())).toBe(false)
    expect(matches(scoped, subject({ accountId: 'acc-max' }))).toBe(true)
  })

  it('never matches a disabled rule', () => {
    expect(matches(rule({ isEnabled: false }), subject())).toBe(false)
  })
})

describe('rule order', () => {
  it('puts a user rule above a learned one, and both above a built-in', () => {
    const user = rule({ id: 'a', origin: 'USER', priority: 900 })
    const learned = rule({ id: 'b', origin: 'LEARNED_FROM_CORRECTION', priority: 1 })
    const builtIn = rule({ id: 'c', origin: 'BUILT_IN', priority: 0, kind: 'EXACT_MERCHANT' })

    expect(sortRules([builtIn, learned, user]).map((found) => found.id)).toEqual(['a', 'b', 'c'])
  })

  it('lets priority beat specificity inside a tier', () => {
    // A broad rule the user dragged to the top wins over a precise one below
    // it. That is what dragging is for.
    const broad = rule({ id: 'a', kind: 'CONTAINS', priority: 10 })
    const precise = rule({ id: 'b', kind: 'EXACT_MERCHANT', priority: 20 })
    expect(sortRules([precise, broad]).map((found) => found.id)).toEqual(['a', 'b'])
  })

  it('breaks a priority tie by how specific the kind is', () => {
    const kinds = [
      rule({ id: 'account', kind: 'ACCOUNT' }),
      rule({ id: 'provider', kind: 'PROVIDER_CATEGORY' }),
      rule({ id: 'exact', kind: 'EXACT_MERCHANT' }),
      rule({ id: 'amount', kind: 'AMOUNT_RANGE' }),
      rule({ id: 'contains', kind: 'CONTAINS' }),
      rule({ id: 'regex', kind: 'REGEX' }),
    ]
    expect(sortRules(kinds).map((found) => found.id)).toEqual([
      'exact',
      'regex',
      'contains',
      'provider',
      'amount',
      'account',
    ])
  })

  it('breaks a specificity tie by age, and an age tie by id', () => {
    const older = rule({ id: 'z', createdAt: 100 })
    const newer = rule({ id: 'a', createdAt: 200 })
    expect(sortRules([newer, older]).map((found) => found.id)).toEqual(['z', 'a'])

    const twins = [rule({ id: 'b' }), rule({ id: 'a' })]
    expect(sortRules(twins).map((found) => found.id)).toEqual(['a', 'b'])
  })

  it('is a total order — comparing a rule with itself is a tie', () => {
    const only = rule()
    expect(compareRules(only, only)).toBe(0)
  })

  it('does not mutate what it was given', () => {
    const rules = [rule({ id: 'b' }), rule({ id: 'a' })]
    sortRules(rules)
    expect(rules.map((found) => found.id)).toEqual(['b', 'a'])
  })
})

describe('firstMatch and explain', () => {
  const rules = [
    rule({ id: 'groceries', kind: 'EXACT_MERCHANT', pattern: 'שופרסל דיל', targetCategoryId: 'cat:groceries' }),
    rule({ id: 'broad', kind: 'CONTAINS', pattern: 'שופרסל', targetCategoryId: 'cat:shopping' }),
    rule({ id: 'fuel', kind: 'CONTAINS', pattern: 'פז', targetCategoryId: 'cat:fuel' }),
  ]

  it('returns the winner and stops', () => {
    expect(firstMatch(rules, subject())?.id).toBe('groceries')
  })

  it('reports nothing when no rule fires', () => {
    const nothing = subject({ merchantNormalized: 'AMAZON.COM', providerCategory: undefined })
    expect(firstMatch(rules, nothing)).toBeUndefined()
    expect(explain(rules, nothing)).toEqual({ winner: undefined, shadowed: [] })
  })

  it('names what the winner shadows, in the order they would win next', () => {
    const explained = explain(rules, subject())
    expect(explained.winner?.id).toBe('groceries')
    expect(explained.shadowed.map((found) => found.id)).toEqual(['broad'])
  })

  it('agrees with itself: the test box and an import cannot diverge', () => {
    // F03's acceptance criterion, as a test rather than as a hope. Every
    // subject that reaches the engine has to resolve the same way twice.
    const subjects = [
      subject(),
      subject({ merchantNormalized: 'PAZ YELLOW' }),
      subject({ merchantNormalized: normalizeMerchant('שופרסל אקספרס'), accountId: 'acc-max' }),
      subject({ merchantNormalized: 'AMAZON.COM', providerCategory: undefined }),
    ]

    for (const one of subjects) {
      expect(firstMatch(rules, one)?.id).toBe(explain(rules, one).winner?.id)
    }
  })
})

describe('validateRule', () => {
  it('passes a rule that is ready to save', () => {
    expect(validateRule(rule())).toEqual([])
  })

  it('catches a pattern-shaped rule with no pattern', () => {
    expect(validateRule(rule({ pattern: ' ' }))).toEqual([
      { field: 'pattern', message: 'This kind of rule needs something to match on' },
    ])
  })

  it('reports why a regex will not compile, rather than leaving it to fail at import', () => {
    const problems = validateRule(rule({ kind: 'REGEX', pattern: '([a-z' }))
    expect(problems).toHaveLength(1)
    expect(problems[0]?.field).toBe('pattern')
    expect(problems[0]?.message).not.toBe('')
  })

  it('rejects a pattern long enough to be a paste accident', () => {
    const problems = validateRule(rule({ pattern: 'א'.repeat(201) }))
    expect(problems.map((problem) => problem.field)).toEqual(['pattern'])
  })

  it('asks the two condition-only kinds for their condition', () => {
    expect(validateRule(rule({ kind: 'AMOUNT_RANGE', pattern: '', conditions: {} }))).toEqual([
      { field: 'conditions', message: 'An amount rule needs a minimum or a maximum' },
    ])
    expect(validateRule(rule({ kind: 'ACCOUNT', pattern: '', conditions: {} }))).toEqual([
      { field: 'conditions', message: 'An account rule needs an account' },
    ])
  })

  it('catches bounds that cannot both be true', () => {
    const inverted = rule({
      conditions: { amountMin: fromMajorUnits(500, 'ILS'), amountMax: fromMajorUnits(100, 'ILS') },
    })
    expect(validateRule(inverted)).toEqual([
      { field: 'conditions', message: 'The minimum is above the maximum' },
    ])

    const mixed = rule({
      conditions: { amountMin: fromMajorUnits(10, 'USD'), amountMax: fromMajorUnits(100, 'ILS') },
    })
    expect(validateRule(mixed)).toEqual([
      { field: 'conditions', message: 'The two bounds are in different currencies' },
    ])
  })

  it('wants a category to assign', () => {
    expect(validateRule(rule({ targetCategoryId: '' })).map((problem) => problem.field)).toEqual([
      'targetCategoryId',
    ])
  })
})
