/**
 * A rule while it is being written, and the list operations the rules screen
 * performs on a rule set — F03's "rule authoring UX", as pure functions.
 *
 * The form's shape lives here rather than inside the component for one reason:
 * a thing being typed has to become a `CategoryRule` before anything can say
 * whether it is sayable, because `validateRule` is the only opinion about that
 * and there must not be a second one. `asRule` is that conversion, so the
 * editor checks the same object it saves.
 *
 * No React, no sql.js, no DOM (docs/conventions.md). Amounts arrive already
 * parsed: reading `₪1,234.56` off a statement is the importer's job, and the
 * editor calls it at the edge rather than the domain growing a second reader.
 */

import {
  containsMerchant,
  takesPattern,
  validateRule,
  type RuleProblem,
} from '@/domain/categorization.ts'
import type { CategoryRule, RuleConditions, RuleKind, RuleOrigin } from '@/domain/model/rules.ts'

/** Everything a user can type into the editor, and nothing else. */
export interface RuleDraft {
  readonly name: string
  readonly kind: RuleKind
  readonly pattern: string
  readonly targetCategoryId: string
  readonly conditions: RuleConditions
}

/**
 * What a rule is, apart from what was typed into it: identity, place in the
 * order, and the counters an import writes.
 *
 * `isEnabled` belongs here rather than in the draft because enabling is a row
 * action on the list, not a field in the form — a rule is switched off in
 * passing, without opening it.
 */
export interface RuleIdentity {
  readonly id: string
  readonly priority: number
  readonly origin: RuleOrigin
  readonly isEnabled: boolean
  readonly createdAt: number
  readonly hitCount: number
  readonly lastMatchedAt: number | undefined
}

/**
 * A new rule starts as `CONTAINS`.
 *
 * It is the kind that survives what F03's edge cases say actually varies
 * between two statements of the same shop — a branch number, a space, a
 * spelling. `EXACT_MERCHANT` is the more precise answer and the more common
 * disappointment.
 */
export const BLANK_DRAFT: RuleDraft = {
  name: '',
  kind: 'CONTAINS',
  pattern: '',
  targetCategoryId: '',
  conditions: {},
}

const DRAFT_IDENTITY: RuleIdentity = {
  id: '',
  priority: 0,
  origin: 'USER',
  isEnabled: true,
  createdAt: 0,
  hitCount: 0,
  lastMatchedAt: undefined,
}

export function draftOf(rule: CategoryRule): RuleDraft {
  return {
    name: rule.name,
    kind: rule.kind,
    pattern: rule.pattern,
    targetCategoryId: rule.targetCategoryId,
    conditions: rule.conditions,
  }
}

/**
 * A rule pre-filled from a transaction the user is looking at — F03's "create
 * rule from this merchant".
 *
 * `CONTAINS` over the **normalized** merchant, which is the form the engine
 * compares and therefore the form that already has the branch number off it.
 * Contains rather than exact for the same reason F03 gives for handling the
 * rest: what varies between two statements of one shop is a suffix, and a rule
 * written off one row should survive the next one gaining a space.
 *
 * The category is whatever the row already has, which is usually the whole
 * point — the user categorized it by hand and now wants that to keep happening.
 * Nothing is saved here; this opens the editor, and the user still presses the
 * button.
 */
export function draftFromMerchant(
  merchantNormalized: string,
  categoryId: string | undefined,
): RuleDraft {
  return {
    ...BLANK_DRAFT,
    kind: 'CONTAINS',
    pattern: merchantNormalized,
    targetCategoryId: categoryId ?? '',
  }
}

/**
 * A rule pre-filled from **part of** a merchant name — the narrow gesture, and
 * the one B9 said the provider-category one lacks (D-173).
 *
 * Selecting `שופרסל` out of `שופרסל דיל סניף 344` and asking for a rule is a
 * claim about one word, which is the property that makes it safe where a
 * provider category is not: a `CONTAINS` rule from a selection claims the shops
 * whose names carry that word, and the person drew the line themselves.
 *
 * **It refuses a selection that would not match the row it came from**, which is
 * the same care `draftFromProviderCategory` takes and for the same reason: the
 * engine compares `normalizeMerchant` on both sides (D-083), so a selection of
 * `344` off a name whose branch number normalization strips, or a stray space,
 * produces a rule that fails on the very row somebody drew it on. Undefined is
 * the offer not being made rather than an offer that will not work.
 *
 * The pattern is kept **as selected** rather than normalized, because
 * `containsMerchant` normalizes it at match time and a pre-normalized pattern
 * is a field the person cannot recognise as the words they highlighted.
 */
export function draftFromSelection(
  selection: string,
  merchantNormalized: string,
  categoryId: string | undefined,
): RuleDraft | undefined {
  const pattern = selection.trim()
  if (pattern === '' || !containsMerchant(merchantNormalized, pattern)) return undefined
  return {
    ...BLANK_DRAFT,
    kind: 'CONTAINS',
    pattern,
    targetCategoryId: categoryId ?? '',
  }
}

/**
 * A rule pre-filled from what the provider called this row — the other half of
 * "create a rule from this transaction", and a much broader claim than the
 * merchant one.
 *
 * The pattern is the provider's string **as it was printed**, because
 * `PROVIDER_CATEGORY` compares through `matchable` on both sides and that is
 * deliberately not `normalizeMerchant`: a merchant's trailing digits are a
 * branch number and a category's are part of its name. Pre-filling with
 * anything else would make the rule fail on the very row it came from.
 *
 * **This is the one pre-fill that covers rows the user has not looked at.** A
 * merchant rule claims one shop; `מזון ומשקאות` claims every grocer the card
 * issuer has ever filed under it, including the ones on next month's statement.
 * That is the point of the kind and also its risk, so this stays behind the
 * editor — where the pattern, the category and the conditions are all visible
 * before anything is saved — and out of the correction offer, which writes a
 * rule on one click (D-042).
 */
export function draftFromProviderCategory(
  providerCategory: string,
  categoryId: string | undefined,
): RuleDraft {
  return {
    ...BLANK_DRAFT,
    kind: 'PROVIDER_CATEGORY',
    pattern: providerCategory,
    targetCategoryId: categoryId ?? '',
  }
}

/**
 * Change the kind, dropping only what the new kind cannot use.
 *
 * The conditions survive on purpose: an account scope and an amount band are
 * ANDed onto every kind (D-037), so switching from "over ₪500" to "contains פז,
 * over ₪500" is one field, not a form to fill in again. The pattern does not
 * survive a switch to a condition-only kind — it would be stored, invisible,
 * and would come back if the kind were switched again.
 */
export function withKind(draft: RuleDraft, kind: RuleKind): RuleDraft {
  return { ...draft, kind, pattern: takesPattern(kind) ? draft.pattern : '' }
}

/**
 * The draft as the engine would see it.
 *
 * `identity` is the existing rule's when one is being edited, and a placeholder
 * when the editor is only asking whether what has been typed so far is valid.
 */
export function asRule(draft: RuleDraft, identity: RuleIdentity = DRAFT_IDENTITY): CategoryRule {
  return {
    ...identity,
    name: resolvedName(draft),
    kind: draft.kind,
    pattern: takesPattern(draft.kind) ? draft.pattern.trim() : '',
    targetCategoryId: draft.targetCategoryId,
    conditions: draft.conditions,
  }
}

/** What is wrong with the draft, in the engine's own words. Empty means it saves. */
export function draftProblems(draft: RuleDraft): readonly RuleProblem[] {
  return validateRule(asRule(draft))
}

/**
 * What the rule will be listed as.
 *
 * The name is optional in the form because the pattern already is the name of
 * most rules — someone writing "פז → Fuel" has said everything there is to say,
 * and asking them to name it as well is a field that gets `פז` typed into it.
 */
export function resolvedName(draft: RuleDraft): string {
  const typed = draft.name.trim()
  if (typed !== '') return typed

  if (takesPattern(draft.kind)) {
    const pattern = draft.pattern.trim()
    return pattern === '' ? 'New rule' : pattern
  }
  return draft.kind === 'ACCOUNT' ? 'Account rule' : 'Amount rule'
}

/**
 * The same ids with one moved to a position, clamped to the list.
 *
 * One function for both ways of reordering: a drag drops a rule onto another
 * rule's index, and the keyboard moves it one step. `reorderRules` then
 * re-normalizes the result in steps of ten (D-037), so what this returns is an
 * order rather than a set of numbers.
 */
export function moveTo(ids: readonly string[], id: string, index: number): readonly string[] {
  const from = ids.indexOf(id)
  if (from === -1) return ids

  const to = Math.max(0, Math.min(ids.length - 1, index))
  if (to === from) return ids

  const next = [...ids]
  next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}

/** How long a rule has to sit unused before never having fired means something. */
export const QUIET_DAYS = 90

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * A rule that has never fired, and is old enough for that to be a fact rather
 * than a coincidence — F03's "this rule never fires — it may be shadowed".
 *
 * Age matters because `hitCount` only moves when an import or a re-apply runs.
 * A rule written this morning has zero hits because nothing has happened yet,
 * and flagging it would teach the user to ignore the flag.
 */
export function neverFires(rule: CategoryRule, now: number): boolean {
  return rule.hitCount === 0 && now - rule.createdAt >= QUIET_DAYS * DAY_MS
}
