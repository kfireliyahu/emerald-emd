/**
 * Learning from corrections — F03's fifth design commitment.
 *
 * Correcting a category offers to write a rule. That offer is how the rule set
 * grows for someone who never opens the rules screen, and it is the reason the
 * built-in set can wait: a rule the user's own history taught the app beats a
 * rule the app guessed at.
 *
 * Everything here is a pure function over plain values — no React, no sql.js,
 * no DOM (docs/conventions.md). What is *not* here is as deliberate as what is:
 * nothing in this file writes anything. It decides whether there is an offer
 * worth making and what the offer would create, and a rule exists only after
 * the user clicks. "Nothing is auto-anything" is the rule this unit is most
 * likely to break.
 */

import { asRule, draftProblems, type RuleDraft, type RuleIdentity } from '@/domain/ruleEditing.ts'
import { firstMatch } from '@/domain/categorization.ts'
import type { CategoryRule, RuleSubject } from '@/domain/model/rules.ts'
import { planReapply, type ReapplyCandidate } from '@/domain/reapply.ts'

/**
 * How many corrections of one merchant to one category before the offer stops
 * being a quiet aside.
 *
 * F03's number. The third time is when a coincidence has become a habit, and
 * the point of saying so more loudly is that the user has now done by hand,
 * three times, the exact thing one click would have stopped.
 */
export const INSISTENT_AFTER = 3

/** What just happened, and what the rule set currently makes of the same row. */
export interface CorrectionFacts {
  /** The corrected transaction, as the engine sees it. */
  readonly subject: RuleSubject
  /** The category the user chose. Undefined when they cleared it instead. */
  readonly categoryId: string | undefined
  /**
   * How many *different* transactions of this merchant the user has now put in
   * this category by hand, this one included. One is the ordinary case.
   */
  readonly corrections: number
  /** Every live rule, so the offer can tell whether one already says this. */
  readonly rules: readonly CategoryRule[]
}

export interface LearningOffer {
  readonly merchantNormalized: string
  readonly categoryId: string
  readonly corrections: number
  /** The third repeat and beyond: the same offer, said more plainly. */
  readonly insistent: boolean
  /** Exactly what the offer would create, and nothing is created until it is clicked. */
  readonly draft: RuleDraft
}

/**
 * The offer to make after a correction, or nothing.
 *
 * Nothing, in three cases, and each is a question that would be silly to ask:
 *
 * - The user **cleared** the category. "Always categorize this as nothing" is
 *   not a rule anyone means to write.
 * - The rule it would create **could not be saved** — an empty normalized
 *   merchant, no category. `draftProblems` is asked rather than re-deriving the
 *   conditions, so the offer can never propose something the editor would
 *   refuse; there is one opinion about what a valid rule is.
 * - A rule **already says this**. Not "a rule exists for this merchant" — the
 *   engine is asked what it would do with this exact row, so a correction that
 *   overrules a rule still gets the offer (that is the case F03 cares about
 *   most), while a row that was merely imported before the rule was written
 *   does not ask the user to write it twice.
 */
export function offerForCorrection(facts: CorrectionFacts): LearningOffer | undefined {
  const { subject, categoryId, corrections, rules } = facts
  if (categoryId === undefined) return undefined

  const draft = learnedDraft(subject.merchantNormalized, categoryId)
  if (draftProblems(draft).length > 0) return undefined

  if (firstMatch(rules, subject)?.targetCategoryId === categoryId) return undefined

  return {
    merchantNormalized: subject.merchantNormalized,
    categoryId,
    corrections,
    insistent: corrections >= INSISTENT_AFTER,
    draft,
  }
}

/**
 * What a learned rule is: a merchant name **contained**, in that category.
 *
 * **`CONTAINS`, the one kind every way of making a rule writes (D-373).** It
 * used to be `EXACT_MERCHANT` here and `CONTAINS` everywhere else (D-042), and
 * the two are wrong in different ways on real merchant strings:
 *
 * - **Exact misses quietly and every month.** `normalizeMerchant` takes a
 *   trailing branch number off, and nothing else — `שופרסל דיל 344 חולון`,
 *   `AMZN MKTP US*2K4LM1AB3` and a ten-digit terminal number all change past
 *   it, so the rule never fires and the row is back in By merchant next month.
 *   And a shortened pattern, the one edit the offer invites, matches nothing at
 *   all as exact, which is why the offer had to switch kinds behind the field.
 * - **Contains can claim too much**: a short name inside a longer, different
 *   one. That is the error you can see before it is written — the offer counts
 *   the rows it would file — and every row it files names it afterwards.
 *
 * So the field is the whole control: the full merchant by default, shortened to
 * the part that stays the same when the rest does not.
 */
export function learnedDraft(merchantNormalized: string, categoryId: string): RuleDraft {
  return {
    name: '',
    kind: 'CONTAINS',
    pattern: merchantNormalized,
    targetCategoryId: categoryId,
    conditions: {},
  }
}

/**
 * The offer for a rule somebody asked for — the row menu's and the detail
 * panel's "rule from this merchant" (D-373) — rather than one a correction
 * prompted. The same offer, so there is one place a rule is made from a row; the
 * category may still be empty, and the offer asks for it.
 */
export function offerForDraft(merchantNormalized: string, draft: RuleDraft): LearningOffer {
  return {
    merchantNormalized,
    categoryId: draft.targetCategoryId,
    corrections: 0,
    insistent: false,
    draft: { ...draft, kind: 'CONTAINS' },
  }
}

/** The offer's rule as the user has edited it: whatever they typed, in whatever category. */
export function offeredDraft(
  offer: LearningOffer,
  edit: { readonly pattern: string; readonly categoryId: string | undefined },
): RuleDraft {
  return { ...offer.draft, pattern: edit.pattern, targetCategoryId: edit.categoryId ?? '' }
}

/** Where a rule not yet written would sit: last of the learned tier, as `createRule` puts it. */
const OFFERED: RuleIdentity = {
  id: 'offered',
  priority: Number.MAX_SAFE_INTEGER,
  origin: 'LEARNED_FROM_CORRECTION',
  isEnabled: true,
  createdAt: Number.MAX_SAFE_INTEGER,
  hitCount: 0,
  lastMatchedAt: undefined,
}

/**
 * How many rows already here the offered rule would file — the rows "and the
 * earlier ones" would move, counted before anything is written.
 *
 * The same plan the write makes (`planReapply` with the rule among the others,
 * keeping only what it wins), so the number cannot disagree with what pressing
 * the button does. The candidates are the rows nobody chose by hand.
 */
export function pastRows(
  draft: RuleDraft,
  rules: readonly CategoryRule[],
  candidates: readonly ReapplyCandidate[],
): number {
  if (draftProblems(draft).length > 0) return 0
  const offered = asRule(draft, OFFERED)
  const reached = candidates.filter((one) => firstMatch([offered], one.subject) !== undefined)
  return planReapply([...rules, offered], reached).changes.filter((change) => change.ruleId === OFFERED.id)
    .length
}
