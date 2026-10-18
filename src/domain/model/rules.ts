/**
 * A categorization rule, and the thing a rule is evaluated against.
 *
 * Shapes only — the engine is `@/domain/categorization.ts`. Both are plain
 * TypeScript: no React, no sql.js, no DOM, and no database. F03's fourth design
 * commitment is that a rule can be evaluated against a merchant string, a
 * provider category, an amount and an account, which is exactly `RuleSubject`
 * below and nothing more.
 */

import type { Money } from '@/core/money.ts'

/**
 * What a rule matches on.
 *
 * The first three test the **normalized** merchant, `PROVIDER_CATEGORY` tests
 * the provider's own category string, and the last two test nothing but their
 * conditions — "everything on the business card", "anything over ₪500".
 *
 * docs/04 also listed `COMPOSITE`, "AND of merchant + amount + account". It is
 * absent because every rule already carries conditions and every rule already
 * ANDs them: a `CONTAINS` rule with an amount band and an account scope *is*
 * the composite, and a second name for it would put two identical choices in
 * front of the user. See D-037.
 */
export const RULE_KINDS = [
  'EXACT_MERCHANT',
  'CONTAINS',
  'REGEX',
  'PROVIDER_CATEGORY',
  'AMOUNT_RANGE',
  'ACCOUNT',
] as const

export type RuleKind = (typeof RULE_KINDS)[number]

/**
 * Where a rule came from. Also its tier in the resolution order: a rule the
 * user wrote outranks one the app learned, which outranks one it shipped.
 *
 * `AI_SUGGESTED` is inert until confirmed — nothing a model offers is
 * auto-accepted (the `rule` rows) — and confirming one makes it a
 * `USER` rule. It has a tier so that an unconfirmed suggestion which somehow
 * reaches the engine loses to everything the user has actually approved.
 */
export const RULE_ORIGINS = ['USER', 'LEARNED_FROM_CORRECTION', 'AI_SUGGESTED', 'BUILT_IN'] as const

export type RuleOrigin = (typeof RULE_ORIGINS)[number]

/**
 * Extra tests any rule may carry, ANDed with its kind's own test.
 *
 * Bounds are **magnitudes**: a card statement's charges are negative by the
 * app's own convention (D-004), so "between 100 and 500" would otherwise match
 * nothing at all. Comparing `abs` is what makes the number the user typed mean
 * what they meant by it.
 */
export interface RuleConditions {
  readonly scopeAccountId?: string | undefined
  readonly amountMin?: Money | undefined
  readonly amountMax?: Money | undefined
}

export interface CategoryRule {
  readonly id: string
  readonly name: string
  readonly kind: RuleKind
  /** Meaning depends on `kind`; empty for the two condition-only kinds. */
  readonly pattern: string
  readonly targetCategoryId: string
  /** Lower wins, within an origin tier. Drag-order in the UI; see D-037. */
  readonly priority: number
  readonly origin: RuleOrigin
  readonly isEnabled: boolean
  readonly conditions: RuleConditions
  /** Breaks a tie between two rules that agree on everything else. */
  readonly createdAt: number
  readonly hitCount: number
  readonly lastMatchedAt: number | undefined
}

/**
 * What a rule is tested against: one transaction, reduced to the four facts
 * that can decide a category.
 *
 * `merchantNormalized` rather than the raw name, because that is the form
 * `normalizeMerchant` guarantees a branch number cannot vary — and it is the
 * form patterns are stored in, so the two are comparable by construction.
 */
export interface RuleSubject {
  readonly merchantNormalized: string
  readonly providerCategory: string | undefined
  readonly amount: Money
  readonly accountId: string
}
