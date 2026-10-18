/**
 * Re-apply — running the current rules over transactions that are already in
 * the ledger (F03, "Re-apply").
 *
 * This file is the *decision*: given the rules and a set of rows, which rows
 * would change and to what. It writes nothing, reads no clock and touches no
 * database, so the preview the user approves and the change that lands are
 * computed by the same function from the same inputs — which is the only way
 * "1,204 transactions, 312 would change" can be a promise rather than an
 * estimate.
 *
 * Two rules govern what comes out of here, and both are narrower than "make the
 * ledger match the rules":
 *
 * 1. **A manually categorized row is never a candidate.** That is D-009, and it
 *    is enforced in the SQL that gathers rows rather than here — this function
 *    cannot see `categorySource` and should not have to be trusted with it.
 * 2. **Re-apply never clears a category.** A row whose rule has since been
 *    deleted, and which no current rule matches, keeps what it was given.
 *    "Nothing is auto-deleted" (docs/conventions.md), and deleting a rule does
 *    not un-happen what it categorized (D-041). Re-apply assigns; it does not
 *    retract.
 */

import { firstMatch } from '@/domain/categorization.ts'
import type { CategoryRule, RuleSubject } from '@/domain/model/rules.ts'

/** One row as re-apply sees it: what a rule matches on, and what it already has. */
export interface ReapplyCandidate {
  readonly id: string
  readonly subject: RuleSubject
  /** Undefined means uncategorized. */
  readonly categoryId: string | undefined
}

export interface ReapplyChange {
  /**
   * The row that would move. A ledger transaction when re-apply runs over the
   * ledger, and a **staged row** when it runs over an import under review
   * (D-192) — which is why this is not called `transactionId` any more.
   */
  readonly rowId: string
  /** What it holds now. Undefined means uncategorized. */
  readonly from: string | undefined
  /** What the rules say it should hold. Never undefined — re-apply does not clear. */
  readonly to: string
  /** The rule that says so, which the row will name afterwards. */
  readonly ruleId: string
}

export interface ReapplyPlan {
  /** How many rows were eligible to be looked at — the first number the preview shows. */
  readonly scanned: number
  readonly changes: readonly ReapplyChange[]
}

/**
 * What running the current rules over these rows would do.
 *
 * `firstMatch` per row, which is the same entry point an import calls, so a
 * re-apply and an import cannot disagree about what a rule set means. A row
 * whose winner already assigns the category it has is not a change and does not
 * appear — the count the user reads is rows that would *move*, not rows that
 * matched.
 */
export function planReapply(
  rules: readonly CategoryRule[],
  candidates: readonly ReapplyCandidate[],
): ReapplyPlan {
  const changes: ReapplyChange[] = []

  for (const candidate of candidates) {
    const winner = firstMatch(rules, candidate.subject)
    if (winner === undefined) continue
    if (winner.targetCategoryId === candidate.categoryId) continue

    changes.push({
      rowId: candidate.id,
      from: candidate.categoryId,
      to: winner.targetCategoryId,
      ruleId: winner.id,
    })
  }

  return { scanned: candidates.length, changes }
}
