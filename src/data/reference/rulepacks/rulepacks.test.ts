import { describe, expect, it } from 'vitest'

import { cleanText, normalizeMerchant } from '@/core/text.ts'
import { firstMatch, validateRule } from '@/domain/categorization.ts'
import { fromMajorUnits } from '@/core/money.ts'
import { query } from '../../db/database.ts'
import { createLedgerDatabase } from '../../packs/ledger/testing.ts'
import { BUILT_IN_RULES, PACKS, SHIPPED } from './index.ts'
import { BUILT_IN_PREFIX, decodePack } from './packFormat.ts'

/**
 * The shipped packs, checked the way nothing else can check them.
 *
 * A pack is data that goes out with the build. There is no user to see it fail
 * and no import to reject it, so the test *is* the validation step: a bad kind,
 * an uncompilable regex, a duplicated id or a category that does not exist has
 * to break here rather than quietly categorize nothing in someone's document.
 */

/** Any C0 control character, written as escapes so the source stays readable. */
const CONTROL = /[\u0000-\u001F]/

/** The pack as written, so a decode failure can name the file. */
function decoded(file: string) {
  const shipped = SHIPPED.find((pack) => pack.file === file)
  expect(shipped, `${file} is not in SHIPPED`).toBeDefined()
  return decodePack(shipped?.raw)
}

describe('the shipped packs', () => {
  it('all decode, and say why if they do not', () => {
    for (const shipped of SHIPPED) {
      const result = decodePack(shipped.raw)
      expect(result.ok ? [] : result.error, `${shipped.file} did not decode`).toEqual([])
    }
    expect(PACKS.length).toBe(SHIPPED.length)
  })

  it('ships the Israeli pack', () => {
    const result = decoded('il-core.json')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.id).toBe('il-core')
    expect(result.value.market).toBe('IL')
    expect(result.value.version).toBeGreaterThanOrEqual(1)
    expect(result.value.rules.length).toBeGreaterThan(50)
  })

  it('gives every rule an id that is unique across every pack', () => {
    const ids = BUILT_IN_RULES.map((rule) => rule.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('namespaces every id under the built-in prefix, so nothing collides with a stored rule', () => {
    for (const rule of BUILT_IN_RULES) {
      expect(rule.id.startsWith(BUILT_IN_PREFIX)).toBe(true)
      expect(rule.origin).toBe('BUILT_IN')
    }
  })

  it('leaves every rule saveable by the editor’s own standard', () => {
    for (const rule of BUILT_IN_RULES) {
      expect(validateRule(rule), rule.id).toEqual([])
    }
  })

  /**
   * The mistake this catches is the one a pattern list makes silently: a rule
   * written as `שופרסל דיל 344` or `paypal` is normalized to something else
   * before it is compared, so it can never match anything at all.
   */
  it('writes merchant patterns in the form the engine compares', () => {
    for (const rule of BUILT_IN_RULES) {
      if (rule.kind !== 'CONTAINS' && rule.kind !== 'EXACT_MERCHANT') continue
      expect(normalizeMerchant(rule.pattern), `${rule.id} would never fire`).toBe(rule.pattern)
    }
  })

  /** `PROVIDER_CATEGORY` compares the cleaned, uppercased string, whole. */
  it('writes provider-category patterns in their comparable form', () => {
    for (const rule of BUILT_IN_RULES) {
      if (rule.kind !== 'PROVIDER_CATEGORY') continue
      expect(cleanText(rule.pattern).toLocaleUpperCase('en'), rule.id).toBe(rule.pattern)
    }
  })

  it('keeps priorities flat, so kind specificity decides the order inside the tier', () => {
    // D-037: the comparator reads priority before specificity. A pack that gave
    // every rule its line number as a priority would take specificity out of
    // the ordering entirely, and `PROVIDER_CATEGORY` would stop sorting below
    // every merchant rule. The exceptions are deliberate and few.
    const stated = BUILT_IN_RULES.filter((rule) => rule.priority !== 0)
    expect(stated.length).toBeLessThanOrEqual(5)
  })

  /**
   * The mistake this catches actually happened while writing D-120's rules.
   * `"\bACE\b"` in JSON is not a word boundary — `\b` is JSON's own escape for
   * **backspace**, so the pattern parsed as U+0008 ACE U+0008 and matched
   * nothing, silently. It needs `"\\bACE\\b"`. Nothing else here would have
   * noticed: the rule decodes, compiles and validates; it just never fires.
   */
  it('has no control character in any pattern, which is a swallowed backslash', () => {
    for (const rule of BUILT_IN_RULES) {
      expect(CONTROL.test(rule.pattern), `${rule.id} has an escape JSON ate`).toBe(false)
    }
  })

  it('points every rule at a category the app actually seeds', async () => {
    const db = await createLedgerDatabase()
    const seeded = new Set(query(db, 'SELECT id FROM fmt_category').map((row) => String(row['id'])))

    for (const rule of BUILT_IN_RULES) {
      expect(seeded.has(rule.targetCategoryId), `${rule.id} → ${rule.targetCategoryId}`).toBe(true)
    }
  })
})

describe('what the Israeli pack categorizes', () => {
  const subject = (merchant: string, providerCategory?: string) => ({
    merchantNormalized: normalizeMerchant(merchant),
    providerCategory,
    amount: fromMajorUnits(-120, 'ILS'),
    accountId: 'acc',
  })

  // Both of these are in `fixtures/synthetic/typed-cells.xlsx`, which is the
  // end-to-end version of this check: import that file into an empty document
  // with no rules of your own and the rows arrive categorized.
  it('categorizes the two merchants the synthetic fixture contains', () => {
    expect(firstMatch(BUILT_IN_RULES, subject('שופרסל דיל 344'))?.targetCategoryId).toBe(
      'cat:groceries',
    )
    expect(firstMatch(BUILT_IN_RULES, subject('פז ילו'))?.targetCategoryId).toBe('cat:fuel')
  })

  it('lets a stated priority settle two rules of the same kind that overlap', () => {
    // `רמי לוי` is a supermarket and `רמי לוי תקשורת` is a phone bill. Both are
    // `CONTAINS`, so specificity cannot separate them and the id would.
    expect(firstMatch(BUILT_IN_RULES, subject('רמי לוי תקשורת'))?.targetCategoryId).toBe(
      'cat:connectivity',
    )
    expect(firstMatch(BUILT_IN_RULES, subject('רמי לוי שיווק'))?.targetCategoryId).toBe(
      'cat:groceries',
    )
    // Same shape: national insurance is a tax, not an insurance policy.
    expect(firstMatch(BUILT_IN_RULES, subject('ביטוח לאומי'))?.targetCategoryId).toBe('cat:taxes')
    expect(firstMatch(BUILT_IN_RULES, subject('הפניקס ביטוח'))?.targetCategoryId).toBe(
      'cat:insurance',
    )
  })

  it('reads a provider category only when no merchant rule claims the row', () => {
    // The provider-category mapping is not a tier of its own: these are
    // built-ins of that kind, and specificity puts them under every merchant
    // rule in the same tier (D-037).
    expect(firstMatch(BUILT_IN_RULES, subject('חנות כלשהי', 'מסעדות'))?.targetCategoryId).toBe(
      'cat:restaurants',
    )
    expect(firstMatch(BUILT_IN_RULES, subject('שופרסל', 'מסעדות'))?.targetCategoryId).toBe(
      'cat:groceries',
    )
  })

  it('leaves a merchant nothing claims uncategorized', () => {
    expect(firstMatch(BUILT_IN_RULES, subject('חנות הפרחים של דנה'))).toBeUndefined()
  })

  /**
   * The three D-114 measured `qwen3:8b` and `qwen3:30b-a3b` getting wrong —
   * identically, and four times the parameters did not fix two of them. Every
   * one is an Israeli brand nobody outside this market has heard of, which is
   * the whole argument that merchant identity is a rulepack problem rather than
   * a model one. They are pinned here so a future pack edit cannot lose them.
   */
  it('files the three brands two local models could not', () => {
    expect(firstMatch(BUILT_IN_RULES, subject('הוט'))?.targetCategoryId).toBe('cat:connectivity')
    expect(firstMatch(BUILT_IN_RULES, subject('ACE הרצליה'))?.targetCategoryId).toBe('cat:shopping')
    expect(firstMatch(BUILT_IN_RULES, subject('גולף אנד קו'))?.targetCategoryId).toBe('cat:shopping')
  })

  it('does not let a three-letter brand match the inside of a word', () => {
    // `ACE` is a regex with word boundaries rather than a CONTAINS for exactly
    // this reason, and REGEX outranks CONTAINS on specificity — so a false
    // positive here would beat a correct merchant rule rather than lose to one.
    expect(firstMatch(BUILT_IN_RULES, subject('MARKETPLACE'))).toBeUndefined()
    expect(firstMatch(BUILT_IN_RULES, subject('SPACE STORE'))).toBeUndefined()
  })

  it('has something to say about the categories that had no rule at all', () => {
    // Five seeded categories were unreachable from the pack until D-120: a
    // taxonomy the app ships and never fills is a taxonomy the user has to
    // discover by hand.
    expect(firstMatch(BUILT_IN_RULES, subject('מוסך אבי'))?.targetCategoryId).toBe('cat:car')
    expect(firstMatch(BUILT_IN_RULES, subject('מרפאת שיניים'))?.targetCategoryId).toBe('cat:dental')
    expect(firstMatch(BUILT_IN_RULES, subject('וטרינר רמת גן'))?.targetCategoryId).toBe('cat:pets')
    expect(firstMatch(BUILT_IN_RULES, subject('אוניברסיטת תל אביב'))?.targetCategoryId).toBe(
      'cat:education',
    )
    expect(firstMatch(BUILT_IN_RULES, subject('צהרון שקד'))?.targetCategoryId).toBe('cat:childcare')
  })
})

describe('a malformed pack', () => {
  const wellFormed = {
    id: 'test',
    name: 'Test',
    market: 'IL',
    version: 1,
    rules: [{ id: 'test.one', kind: 'CONTAINS', pattern: 'שופרסל', category: 'cat:groceries' }],
  }

  const problems = (pack: unknown): readonly string[] => {
    const result = decodePack(pack)
    return result.ok ? [] : result.error
  }

  it('decodes when it is well formed', () => {
    expect(problems(wellFormed)).toEqual([])
  })

  it('is refused for a kind the engine does not have', () => {
    expect(
      problems({ ...wellFormed, rules: [{ ...wellFormed.rules[0], kind: 'FUZZY' }] }),
    ).not.toEqual([])
  })

  it('is refused for a condition-only kind, which a pack cannot state conditions for', () => {
    // An account id means nothing outside the document that minted it, and an
    // amount band shipped by the app would be a claim about someone's life.
    expect(
      problems({ ...wellFormed, rules: [{ ...wellFormed.rules[0], kind: 'ACCOUNT' }] }),
    ).not.toEqual([])
    expect(
      problems({ ...wellFormed, rules: [{ ...wellFormed.rules[0], kind: 'AMOUNT_RANGE' }] }),
    ).not.toEqual([])
  })

  it('is refused for a regex that does not compile', () => {
    const bad = problems({
      ...wellFormed,
      rules: [{ id: 'test.one', kind: 'REGEX', pattern: '([', category: 'cat:groceries' }],
    })
    expect(bad.length).toBe(1)
    expect(bad[0]).toContain('rule 0')
  })

  it('is refused for an empty pattern, which would swallow every row', () => {
    expect(
      problems({ ...wellFormed, rules: [{ ...wellFormed.rules[0], pattern: '' }] }),
    ).not.toEqual([])
  })

  it('is refused for two rules sharing an id', () => {
    expect(
      problems({ ...wellFormed, rules: [wellFormed.rules[0], wellFormed.rules[0]] }),
    ).toEqual(['rule 1: two rules share the id builtin:test.one'])
  })

  it('is refused for an id that is not a stable namespaced name', () => {
    expect(
      problems({ ...wellFormed, rules: [{ ...wellFormed.rules[0], id: 'Rule 1' }] }),
    ).not.toEqual([])
  })

  it('is refused for missing metadata', () => {
    expect(problems({ ...wellFormed, version: 0 })).not.toEqual([])
    expect(problems({ ...wellFormed, market: '' })).not.toEqual([])
    expect(problems({ ...wellFormed, rules: [] })).not.toEqual([])
    expect(problems('not a pack at all')).not.toEqual([])
  })

  it('collects every problem rather than stopping at the first', () => {
    const bad = problems({
      ...wellFormed,
      rules: [
        { id: 'test.one', kind: 'CONTAINS', pattern: '', category: 'cat:groceries' },
        { id: 'test.two', kind: 'NOPE', pattern: 'x', category: 'cat:groceries' },
      ],
    })
    expect(bad.length).toBe(2)
  })
})
