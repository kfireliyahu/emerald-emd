import { describe, expect, it } from 'vitest'

import { fromMajorUnits } from '@/core/money.ts'
import { normalizeMerchant } from '@/core/text.ts'
import type { CategoryRule, RuleSubject } from '@/domain/model/rules.ts'
import { planReapply, type ReapplyCandidate } from './reapply.ts'

function subject(overrides: Partial<RuleSubject> = {}): RuleSubject {
  return {
    merchantNormalized: normalizeMerchant('שופרסל דיל 344'),
    providerCategory: 'סופרמרקט',
    amount: fromMajorUnits(-421.05, 'ILS'),
    accountId: 'acc-cal',
    ...overrides,
  }
}

function candidate(
  id: string,
  categoryId: string | undefined,
  overrides: Partial<RuleSubject> = {},
): ReapplyCandidate {
  return { id, categoryId, subject: subject(overrides) }
}

function rule(overrides: Partial<CategoryRule> = {}): CategoryRule {
  return {
    id: 'rule-groceries',
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

describe('planReapply', () => {
  it('counts every row it looked at, and changes only the ones that would move', () => {
    const plan = planReapply(
      [rule()],
      [
        candidate('t1', undefined),
        candidate('t2', 'cat:groceries'),
        candidate('t3', undefined, { merchantNormalized: normalizeMerchant('פז יעל') }),
      ],
    )

    expect(plan.scanned).toBe(3)
    expect(plan.changes).toEqual([
      { rowId: 't1', from: undefined, to: 'cat:groceries', ruleId: 'rule-groceries' },
    ])
  })

  it('names the rule that will be recorded on the row', () => {
    const plan = planReapply([rule({ id: 'rule-7' })], [candidate('t1', undefined)])

    expect(plan.changes[0]?.ruleId).toBe('rule-7')
  })

  it('moves a row whose category disagrees with the rules', () => {
    const plan = planReapply([rule()], [candidate('t1', 'cat:shopping')])

    expect(plan.changes[0]).toEqual({
      rowId: 't1',
      from: 'cat:shopping',
      to: 'cat:groceries',
      ruleId: 'rule-groceries',
    })
  })

  it('never clears a category when no rule matches', () => {
    // The row was categorized by a rule that has since been deleted. Nothing
    // matches it now, and re-apply assigns — it does not retract. Deleting a
    // rule does not un-happen what it categorized (D-041), and nothing in this
    // app is auto-deleted.
    const orphan = candidate('t1', 'cat:fuel', {
      merchantNormalized: normalizeMerchant('חנות שנסגרה'),
    })

    expect(planReapply([rule()], [orphan]).changes).toEqual([])
  })

  it('agrees with the engine about which rule wins', () => {
    // Not a second opinion about precedence: the plan calls `firstMatch`, so a
    // broad rule the user dragged above a precise one decides a re-apply the
    // same way it decides an import.
    const broad = rule({ id: 'broad', priority: 10, pattern: 'שופרסל', targetCategoryId: 'cat:shopping' })
    const precise = rule({
      id: 'precise',
      priority: 20,
      kind: 'EXACT_MERCHANT',
      pattern: 'שופרסל דיל',
      targetCategoryId: 'cat:groceries',
    })

    expect(planReapply([broad, precise], [candidate('t1', undefined)]).changes[0]?.to).toBe(
      'cat:shopping',
    )
  })

  it('ignores disabled rules, as the engine does', () => {
    expect(planReapply([rule({ isEnabled: false })], [candidate('t1', undefined)]).changes).toEqual(
      [],
    )
  })

  it('is empty over an empty ledger and over an empty rule set', () => {
    expect(planReapply([rule()], [])).toEqual({ scanned: 0, changes: [] })
    expect(planReapply([], [candidate('t1', undefined)])).toEqual({ scanned: 1, changes: [] })
  })

  it('is deterministic — the preview and the commit read the same answer', () => {
    // F03's whole preview promise rests on this: the number the user approves is
    // produced by the same call that produces the rows that land.
    const rules = [rule(), rule({ id: 'other', priority: 5, pattern: 'פז', targetCategoryId: 'cat:fuel' })]
    const rows = [
      candidate('t1', undefined),
      candidate('t2', undefined, { merchantNormalized: normalizeMerchant('פז יעל') }),
      candidate('t3', 'cat:groceries'),
    ]

    expect(planReapply(rules, rows)).toEqual(planReapply(rules, rows))
  })
})
