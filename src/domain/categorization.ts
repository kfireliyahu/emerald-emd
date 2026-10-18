/**
 * The categorization engine — F03.
 *
 * A pure function from a list of rules and one transaction's facts to the rule
 * that categorizes it. No database, no clock, no randomness: the same rules and
 * the same subject give the same answer forever, which is F03's first design
 * commitment and the thing that makes the rules screen's test box trustworthy.
 *
 * Two entry points, deliberately:
 *
 * - `firstMatch` stops at the winner, and is what an import calls.
 * - `explain` keeps going and reports what else matched, and is what the test
 *   box and the transaction's provenance view call.
 *
 * They share one comparator and one predicate, so the test box cannot disagree
 * with an actual import — F03 makes that an acceptance criterion, and two
 * separate implementations is the obvious way to fail it.
 *
 * Plain functions over plain values: no React, no sql.js, no DOM
 * (docs/conventions.md).
 */

import { abs, type Money } from '@/core/money.ts'
import type { Result } from '@/core/result.ts'
import { cleanText, foldText, normalizeMerchant } from '@/core/text.ts'
import { compilePattern, MAX_PATTERN_LENGTH, patternMatches } from '@/domain/format/rule.ts'
import type { CategoryRule, RuleConditions, RuleKind, RuleSubject } from '@/domain/model/rules.ts'

/**
 * How narrow a kind's claim is, lower being narrower.
 *
 * From F03's resolution order, with `AMOUNT_RANGE` — which F03's list omits —
 * placed above `ACCOUNT`: an amount band picks out some of an account's
 * charges, and "this account" picks out all of them.
 */
const SPECIFICITY: Readonly<Record<RuleKind, number>> = {
  EXACT_MERCHANT: 0,
  REGEX: 1,
  CONTAINS: 2,
  PROVIDER_CATEGORY: 3,
  AMOUNT_RANGE: 4,
  ACCOUNT: 5,
}

const ORIGIN_TIER: Readonly<Record<CategoryRule['origin'], number>> = {
  USER: 0,
  LEARNED_FROM_CORRECTION: 1,
  AI_SUGGESTED: 2,
  BUILT_IN: 3,
}

/** The engine's bound on a pattern (D-273), re-exported for the rules screen. */
export { MAX_PATTERN_LENGTH }

export interface Explanation {
  /** The rule that assigns the category, or undefined for uncategorized. */
  readonly winner: CategoryRule | undefined
  /**
   * Rules that also matched and lost. Ordered as they were evaluated, so the
   * first of them is the one that would win if the winner were deleted — which
   * is what the rules screen's "shadowed by" link needs.
   */
  readonly shadowed: readonly CategoryRule[]
}

/**
 * Rule order: origin tier, then the user's own priority, then how specific the
 * kind is, then age.
 *
 * The id is the final tiebreak and is never expected to be reached. It is here
 * because "deterministic" has to mean deterministic: two rules created in the
 * same millisecond with everything else equal would otherwise resolve by
 * whatever order the caller happened to pass them in.
 */
export function compareRules(a: CategoryRule, b: CategoryRule): number {
  const tier = ORIGIN_TIER[a.origin] - ORIGIN_TIER[b.origin]
  if (tier !== 0) return tier

  if (a.priority !== b.priority) return a.priority - b.priority

  const specificity = SPECIFICITY[a.kind] - SPECIFICITY[b.kind]
  if (specificity !== 0) return specificity

  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** The rules in evaluation order. Never mutates the input. */
export function sortRules(rules: readonly CategoryRule[]): readonly CategoryRule[] {
  return [...rules].sort(compareRules)
}

/**
 * The rule that categorizes this transaction, or undefined.
 *
 * Stops at the first match, as F03 specifies. The caller is responsible for the
 * step above this one: a transaction the user categorized by hand never reaches
 * the engine at all (D-009).
 */
export function firstMatch(
  rules: readonly CategoryRule[],
  subject: RuleSubject,
): CategoryRule | undefined {
  const cache = new Map<string, RegExp | undefined>()
  for (const rule of sortRules(rules)) {
    if (matches(rule, subject, cache)) return rule
  }
  return undefined
}

/**
 * The winner and everything it shadows.
 *
 * The same order and the same predicate as `firstMatch`, without the early
 * exit. Two rules matching one transaction is normal rather than an error
 * (F03) — what the user needs is to see which won and why.
 */
export function explain(rules: readonly CategoryRule[], subject: RuleSubject): Explanation {
  const cache = new Map<string, RegExp | undefined>()
  const matched: CategoryRule[] = []

  for (const rule of sortRules(rules)) {
    if (matches(rule, subject, cache)) matched.push(rule)
  }

  const [winner, ...shadowed] = matched
  return { winner, shadowed }
}

/**
 * Does this one rule match?
 *
 * `cache` is a per-call memo of compiled regexes, passed in rather than held at
 * module level so the engine keeps no state between calls. A statement is 400
 * rows against the same rule set, and recompiling every pattern 400 times is
 * the one performance trap in here.
 */
export function matches(
  rule: CategoryRule,
  subject: RuleSubject,
  cache: Map<string, RegExp | undefined> = new Map(),
): boolean {
  if (!rule.isEnabled) return false
  if (!conditionsHold(rule.conditions, subject)) return false

  // **The three text kinds are the engine's predicate** (M25 E4, D-273) —
  // `equals`, `contains` and `regex` of the `categories` rule set the pack
  // declares on `category_rule`. What stays here is the pack's: a pattern is
  // normalized as a merchant name is (D-083) before the engine compares.
  switch (rule.kind) {
    case 'EXACT_MERCHANT':
      return patternMatches('EQUALS', normalizeMerchant(rule.pattern), subject.merchantNormalized, cache)
    case 'CONTAINS':
      return containsMerchant(subject.merchantNormalized, rule.pattern)
    case 'REGEX':
      // A pattern that does not compile matches nothing. It is caught at
      // authoring time by `validateRule`; this is the guard for a rule that
      // reached the database anyway, in a document edited by hand.
      return patternMatches('REGEX', rule.pattern, subject.merchantNormalized, cache)
    case 'PROVIDER_CATEGORY': {
      if (subject.providerCategory === undefined) return false
      const pattern = foldText(rule.pattern)
      return pattern !== '' && foldText(subject.providerCategory) === pattern
    }
    // Both condition-only kinds are their conditions, which have already been
    // checked. What is left is to refuse a rule that states none: an amount
    // range with no bounds, or an account rule with no account, would match
    // every transaction in the ledger.
    case 'AMOUNT_RANGE':
      return hasBound(rule.conditions)
    case 'ACCOUNT':
      return rule.conditions.scopeAccountId !== undefined
  }
}

/**
 * Does this merchant contain this pattern?
 *
 * The `CONTAINS` rule kind's predicate, exported because F08's debts match a
 * merchant pattern too — a mortgage's standing order is found by the same
 * question a rule asks, and two spellings of "does this merchant match" would be
 * two answers that can disagree about a leading space or a branch number. Both
 * sides go through `normalizeMerchant`, which is what makes `שופרסל דיל 344` and
 * `שופרסל` one merchant rather than two (D-083).
 *
 * An empty pattern matches nothing rather than everything, which is the one
 * behaviour a `.includes` would get exactly backwards.
 */
export function containsMerchant(merchantNormalized: string, pattern: string): boolean {
  return patternMatches('CONTAINS', normalizeMerchant(pattern), merchantNormalized)
}

/**
 * Does this kind match on a pattern, or only on its conditions?
 *
 * Exported because the editor asks the same question to decide whether to show
 * the field at all, and two spellings of one fact can disagree.
 */
export function takesPattern(kind: RuleKind): boolean {
  return kind !== 'AMOUNT_RANGE' && kind !== 'ACCOUNT'
}

function conditionsHold(conditions: RuleConditions, subject: RuleSubject): boolean {
  if (conditions.scopeAccountId !== undefined && conditions.scopeAccountId !== subject.accountId) {
    return false
  }

  const magnitude = abs(subject.amount)
  const { amountMin, amountMax } = conditions

  // A bound in another currency is not a smaller or larger number, it is a
  // different question. Refusing to match is the honest answer until the app
  // has a rate to convert with.
  if (amountMin !== undefined) {
    if (amountMin.currency !== magnitude.currency) return false
    if (magnitude.minor < abs(amountMin).minor) return false
  }
  if (amountMax !== undefined) {
    if (amountMax.currency !== magnitude.currency) return false
    if (magnitude.minor > abs(amountMax).minor) return false
  }

  return true
}

function hasBound(conditions: RuleConditions): boolean {
  return conditions.amountMin !== undefined || conditions.amountMax !== undefined
}

/**
 * Compile a user-supplied regex, or say why it will not.
 *
 * Case-insensitive because the subject is `merchantNormalized`, whose Latin
 * text is already uppercase — without the flag a user typing `paypal` writes a
 * rule that can never fire. There is no case-sensitive option for the same
 * reason: the matching form has one casing by construction (D-037).
 */
export function compileRegex(pattern: string): Result<RegExp, string> {
  return compilePattern(pattern)
}

export interface RuleProblem {
  readonly field: 'pattern' | 'conditions' | 'targetCategoryId'
  readonly message: string
}

/**
 * What is wrong with a rule, before it is saved. Empty means it can be.
 *
 * F03 asks for regexes to be compiled on save and shown inline rather than
 * failing silently at import time, and this is where that happens. It is also
 * where a rule that would match *everything* is stopped: a `CONTAINS` rule with
 * an empty pattern is not a broad rule, it is a mistake that would swallow a
 * whole statement.
 */
export function validateRule(rule: CategoryRule): readonly RuleProblem[] {
  const problems: RuleProblem[] = []

  if (rule.targetCategoryId === '') {
    problems.push({ field: 'targetCategoryId', message: 'Pick a category to assign' })
  }

  if (takesPattern(rule.kind)) {
    if (cleanText(rule.pattern) === '') {
      problems.push({ field: 'pattern', message: 'This kind of rule needs something to match on' })
    } else if (rule.pattern.length > MAX_PATTERN_LENGTH) {
      problems.push({
        field: 'pattern',
        message: `Pattern is longer than ${MAX_PATTERN_LENGTH} characters`,
      })
    } else if (rule.kind === 'REGEX') {
      const compiled = compileRegex(rule.pattern)
      if (!compiled.ok) problems.push({ field: 'pattern', message: compiled.error })
    }
  }

  if (rule.kind === 'AMOUNT_RANGE' && !hasBound(rule.conditions)) {
    problems.push({ field: 'conditions', message: 'An amount rule needs a minimum or a maximum' })
  }
  if (rule.kind === 'ACCOUNT' && rule.conditions.scopeAccountId === undefined) {
    problems.push({ field: 'conditions', message: 'An account rule needs an account' })
  }

  problems.push(...boundProblems(rule.conditions.amountMin, rule.conditions.amountMax))

  return problems
}

function boundProblems(min: Money | undefined, max: Money | undefined): readonly RuleProblem[] {
  if (min === undefined || max === undefined) return []
  if (min.currency !== max.currency) {
    return [{ field: 'conditions', message: 'The two bounds are in different currencies' }]
  }
  if (abs(min).minor > abs(max).minor) {
    return [{ field: 'conditions', message: 'The minimum is above the maximum' }]
  }
  return []
}
