/**
 * The rule-pack format — what a shipped set of built-in rules looks like on
 * disk, and the one function that turns it into rules the engine can read.
 *
 * **Built-ins are not rows in the user's document.** They are data shipped with
 * the build, merged into the rule set where rules are read (D-046). Seeding them
 * as `category_rule` rows the way migration 006 seeds institutions would mean a
 * new migration every release — migrations are immutable after release (D-020),
 * so a document created last month could never be reached by a pack written this
 * month. What the document holds instead is only the user's *opinions* about
 * them: which they switched off, and which they forked.
 *
 * The packs themselves are JSON, and that is a deliberate trade. JSON has no
 * types and no comments, in a codebase that leans on both; what it buys is that
 * a hundred merchant patterns are data rather than a hundred lines of TypeScript
 * in every diff, and that adding a market is adding a file. The types and the
 * comments come back here, in the decoder — and the safety comes from
 * `validateRule`, the same and only opinion about what a rule is that the
 * editor asks. A pack with a bad kind or an uncompilable regex fails a test,
 * not an import.
 *
 * Data-layer work, not domain: `src/domain/` may not know that rules arrive from
 * a file (docs/conventions.md). It imports the domain, never the other way.
 */

import { err, ok, type Result } from '@/core/result.ts'
import { takesPattern, validateRule } from '@/domain/categorization.ts'
import { RULE_KINDS, type CategoryRule, type RuleKind } from '@/domain/model/rules.ts'

/**
 * What every built-in rule id starts with.
 *
 * Built-in ids are readable and stable (`builtin:il.fuel.paz-yellow`) while a
 * user's rule ids come from `newId()`, so the two can never collide — which
 * matters because both end up in one list, in `transaction.matched_rule_id`, and
 * in the disabled set stored in the document.
 */
export const BUILT_IN_PREFIX = 'builtin:'

/** One market's worth of built-in rules, decoded and ready for the engine. */
export interface RulePack {
  readonly id: string
  /** What a pack picker would call it, if one ever exists. */
  readonly name: string
  /** The market it describes — `IL`. Not a locale: the app's copy is English. */
  readonly market: string
  /**
   * Bumped when the rules change. Nothing reads it yet; it is here because the
   * question "which version of the built-ins categorized this?" is asked after
   * the fact, and a pack that never carried a version cannot answer it.
   */
  readonly version: number
  readonly rules: readonly CategoryRule[]
}

/**
 * Lowercase, dot- or hyphen-separated, no spaces: `il.fuel.paz-yellow`.
 *
 * Pack rule ids are **stable across releases**, because the user's "I switched
 * this one off" points at them. A renumbered id silently switches a rule back
 * on; a reused id switches the wrong one off. They are namespaced rather than
 * numbered for exactly that reason — there is never a reason to renumber a name.
 */
const PACK_ID = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/

/**
 * The kinds a pack may ship, derived rather than listed.
 *
 * `AMOUNT_RANGE` and `ACCOUNT` are the two condition-only kinds, and both are
 * refused: a pack knows about merchants, not about *this* document's accounts
 * and this user's spending. An account id is meaningless outside the document
 * that minted it, and an amount band shipped by the app would be a claim about
 * someone's life rather than about a shop. `takesPattern` is the same question
 * the editor asks to decide whether to show the pattern field, so this set
 * cannot drift from what a pattern-matching kind is.
 */
const PACKABLE_KINDS: ReadonlySet<string> = new Set(RULE_KINDS.filter(takesPattern))

/** The engine-facing id of a rule a pack calls `packRuleId`. */
export function builtInRuleId(packRuleId: string): string {
  return `${BUILT_IN_PREFIX}${packRuleId}`
}

/**
 * A pack as it was written, checked field by field, or every reason it is not
 * one.
 *
 * Every problem is collected rather than the first thrown, because the audience
 * for this is whoever is editing the pack: "three rules point at a category that
 * does not exist" is a fix, and "rule 41 is bad" is a bisect.
 */
export function decodePack(raw: unknown): Result<RulePack, readonly string[]> {
  if (!isRecord(raw)) return err(['A pack is a JSON object'])

  const problems: string[] = []

  const id = requiredId(raw['id'], 'id', problems)
  const name = requiredText(raw['name'], 'name', problems)
  const market = requiredText(raw['market'], 'market', problems)
  const version = raw['version']
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    problems.push('`version` must be a whole number, 1 or more')
  }

  const rawRules = raw['rules']
  if (!Array.isArray(rawRules) || rawRules.length === 0) {
    problems.push('`rules` must be a non-empty array')
    return err(problems)
  }

  const rules: CategoryRule[] = []
  const seen = new Set<string>()

  rawRules.forEach((rawRule, index) => {
    const decoded = decodeRule(rawRule, index, problems)
    if (decoded === undefined) return
    if (seen.has(decoded.id)) {
      problems.push(`rule ${index}: two rules share the id ${decoded.id}`)
      return
    }
    seen.add(decoded.id)
    rules.push(decoded)
  })

  if (problems.length > 0) return err(problems)

  return ok({
    id: id ?? '',
    name: name ?? '',
    market: market ?? '',
    version: version as number,
    rules,
  })
}

/**
 * One rule from a pack, as the engine's own `CategoryRule`.
 *
 * The fields a stored rule has and a shipped one cannot are filled in here and
 * are the same for every built-in:
 *
 * - **`priority` is 0 by default**, and that is load-bearing. The comparator
 *   reads priority *before* kind specificity (D-037), so giving each rule its
 *   position in the file as a priority would silently take specificity out of
 *   the ordering — and specificity below the built-in tier is the whole reason
 *   the provider-category mapping could stop being a tier of its own. Flat
 *   priorities mean `EXACT` still beats `CONTAINS` still beats
 *   `PROVIDER_CATEGORY`, exactly as F03's resolution order says. A pack may
 *   still state one, for the handful of cases where two rules of the *same*
 *   kind overlap and the wrong one would win — `רמי לוי תקשורת` is a phone bill
 *   and `רמי לוי` is a supermarket.
 * - **`createdAt` is 0 and `hitCount` is 0**, because neither means anything for
 *   a rule that arrived with the app. Nothing displays them; see the rules
 *   screen, which shows a built-in no counter rather than a misleading zero.
 */
function decodeRule(
  raw: unknown,
  index: number,
  problems: string[],
): CategoryRule | undefined {
  const at = `rule ${index}`
  if (!isRecord(raw)) {
    problems.push(`${at}: not an object`)
    return undefined
  }

  const id = requiredId(raw['id'], `${at}.id`, problems)
  const kind = raw['kind']
  const pattern = raw['pattern']
  const category = raw['category']
  const priority = raw['priority'] ?? 0
  const name = raw['name'] ?? pattern

  if (typeof kind !== 'string' || !PACKABLE_KINDS.has(kind)) {
    problems.push(
      `${at}: \`kind\` must be one of ${[...PACKABLE_KINDS].join(', ')} — a pack ships merchant knowledge, not amounts or accounts`,
    )
    return undefined
  }
  if (typeof pattern !== 'string' || pattern === '') {
    problems.push(`${at}: \`pattern\` must be a non-empty string`)
    return undefined
  }
  if (typeof category !== 'string' || category === '') {
    problems.push(`${at}: \`category\` must be a category id`)
    return undefined
  }
  if (typeof name !== 'string' || name === '') {
    problems.push(`${at}: \`name\` must be a non-empty string when it is given`)
    return undefined
  }
  if (typeof priority !== 'number' || !Number.isInteger(priority)) {
    problems.push(`${at}: \`priority\` must be a whole number when it is given`)
    return undefined
  }
  if (id === undefined) return undefined

  const rule: CategoryRule = {
    id: builtInRuleId(id),
    name,
    kind: kind as RuleKind,
    pattern,
    targetCategoryId: category,
    priority,
    origin: 'BUILT_IN',
    isEnabled: true,
    conditions: {},
    createdAt: 0,
    hitCount: 0,
    lastMatchedAt: undefined,
  }

  // The editor's opinion, asked of a shipped rule. There is exactly one idea in
  // this app of what a saveable rule is, and a pack does not get a second one:
  // an uncompilable regex or an over-long pattern is the same mistake wherever
  // it was typed.
  for (const problem of validateRule(rule)) {
    problems.push(`${at}: ${problem.message}`)
  }

  return rule
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredText(value: unknown, field: string, problems: string[]): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    problems.push(`\`${field}\` must be a non-empty string`)
    return undefined
  }
  return value
}

function requiredId(value: unknown, field: string, problems: string[]): string | undefined {
  const text = requiredText(value, field, problems)
  if (text === undefined) return undefined
  if (!PACK_ID.test(text)) {
    problems.push(`\`${field}\` must be lowercase and dotted, like il.fuel.paz-yellow`)
    return undefined
  }
  return text
}
