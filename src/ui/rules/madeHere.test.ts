import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { deleteRule, findRule } from '@/data/repositories/categoryRuleRepository.ts'
import { draftFromMerchant, draftFromProviderCategory } from '@/domain/ruleEditing.ts'
import { arrivedRuleId, makeRule } from '@/ui/rules/madeHere.ts'

/**
 * **A rule made where it was asked for** (M64 F15, D-634) — the maintainer:
 * *"im at transactions creating a rule for a transaction. i dont wanna go to
 * rules."*
 */
describe('a rule made outside Rules', () => {
  it('is written as Rules writes one, a rule of the person’s own', async () => {
    const db = await createLedgerDatabase({ builtInRules: false })
    const made = makeRule(db, draftFromProviderCategory('Restaurants', 'cat:dining'), 1000)
    expect(made).toBeDefined()
    const read = made === undefined ? undefined : findRule(db, made.id)
    expect(read).toMatchObject({ kind: 'PROVIDER_CATEGORY', pattern: 'Restaurants', targetCategoryId: 'cat:dining', origin: 'USER' })
  })

  it('writes nothing for a draft the editor would refuse', async () => {
    const db = await createLedgerDatabase({ builtInRules: false })
    expect(makeRule(db, draftFromMerchant('', undefined), 1000)).toBeUndefined()
  })

  it('goes away whole with its Undo', async () => {
    const db = await createLedgerDatabase({ builtInRules: false })
    const made = makeRule(db, draftFromMerchant('COFFEE', 'cat:dining'), 1000)
    if (made === undefined) throw new Error('no rule made')
    deleteRule(db, made.id, 2000)
    expect(findRule(db, made.id)).toBeUndefined()
  })

  it('hands Rules the rule to open, checked rather than trusted', () => {
    expect(arrivedRuleId({ rule: 'r-1' })).toBe('r-1')
    expect(arrivedRuleId({ rule: '' })).toBeUndefined()
    expect(arrivedRuleId({ rule: 4 })).toBeUndefined()
    expect(arrivedRuleId({ draft: {} })).toBeUndefined()
    expect(arrivedRuleId(null)).toBeUndefined()
  })

  // Every path that makes a rule from Transactions or By merchant — a row's
  // menu, the detail panel, the learning offer, a merchant's menu, a heading —
  // stays on its screen: none hands Rules a draft any more. Going to Rules is
  // offered (the Rules item, Open in Rules), never done.
  it.each(['src/ui/screens/Transactions.tsx', 'src/ui/screens/ByMerchant.tsx'])('%s never sends a draft to Rules', (path) => {
    const source = readFileSync(path, 'utf8')
    expect(source).not.toMatch(/navigate\('\/categories\/rules',\s*\{\s*state:\s*\{\s*draft/)
    expect(source).toMatch(/<RuleFormPanel/)
    expect(source).toMatch(/<OpenInRules/)
  })
})
