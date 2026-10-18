/**
 * The rule set — every rule the document holds, the built-ins included.
 *
 * There is one answer in this app to "what rules are there", and this is it.
 * Every caller that used to ask `listRules` asks `loadRules` instead: the import
 * path, the rules screen, the test box, re-apply, and the transaction detail
 * panel's provenance. If two of them disagreed, the test box would stop being
 * the thing that makes the engine trustworthy (F03).
 *
 * **Built-ins are rows since M25 U2** (D-268), seeded by the ledger pack from
 * the rule packs. Until then they shipped with the build and the document held
 * only the person's opinions about them, in one setting (D-046); the pack folds
 * that setting into the rows on the first open and removes it. The two
 * opinions are what they were:
 *
 * - **switched off** is the row's `is_enabled`, and an edit — so the row is the
 *   person's from then on, and no later build turns it back on (D-264);
 * - **forked** is a normal `USER` rule plus the built-in switched off. F03's
 *   "editing a built-in forks it into a user rule" is exactly those two writes.
 *
 * A built-in whose category the document does not have is simply not seeded,
 * which is what "inert" was when built-ins were code.
 */

import type { Database } from 'sql.js'

import type { CategoryRule } from '@/domain/model/rules.ts'
import { createRule, listRules, setRuleEnabled, type NewRule } from './categoryRuleRepository.ts'

/**
 * The rules the engine sees, in no particular order.
 *
 * Not sorted here: `sortRules` is the engine's own and every entry point calls
 * it, so ordering this list would be a second, quieter opinion about evaluation
 * order (D-037).
 */
export function loadRules(db: Database): readonly CategoryRule[] {
  return listRules(db)
}

/** Switch a built-in off, or back on — an edit of its row, like any rule's. */
export function setBuiltInEnabled(
  db: Database,
  ruleId: string,
  isEnabled: boolean,
  now: number,
): void {
  setRuleEnabled(db, ruleId, isEnabled, now)
}

/**
 * F03's "editing a built-in forks it into a user rule".
 *
 * The copy is a `USER` rule, so it sits above every built-in by tier and takes
 * over whatever the original matched; the original is switched off so the two
 * cannot both be read as live answers to the same question. Both writes or
 * neither — the caller wraps this in its own mutation, which is one SQL
 * transaction (`documentStore.mutate`).
 */
export function forkBuiltIn(
  db: Database,
  ruleId: string,
  input: Omit<NewRule, 'origin'>,
  now: number,
): CategoryRule {
  const created = createRule(db, { ...input, origin: 'USER' }, now)
  setBuiltInEnabled(db, ruleId, false, now)
  return created
}
