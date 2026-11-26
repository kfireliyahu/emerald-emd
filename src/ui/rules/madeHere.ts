import type { Database } from 'sql.js'

import { createRule } from '@/data/repositories/categoryRuleRepository.ts'
import type { CategoryRule } from '@/domain/model/rules.ts'
import { asRule, draftProblems, type RuleDraft } from '@/domain/ruleEditing.ts'

/*
 * **A rule made where it was asked for** (M64 F15, D-634): the write and the
 * hand-over behind `RuleFromHere.tsx`, kept apart from React so they are tested
 * without a screen.
 */

/** Writes a draft as a rule of the person's own, shaped the way Rules' own save shapes it. */
export function makeRule(database: Database, draft: RuleDraft, now: number): CategoryRule | undefined {
  if (draftProblems(draft).length > 0) return undefined
  const shaped = asRule(draft)
  return createRule(
    database,
    {
      name: shaped.name,
      kind: shaped.kind,
      pattern: shaped.pattern,
      targetCategoryId: shaped.targetCategoryId,
      conditions: shaped.conditions,
    },
    now,
  )
}

/** The rule a screen asked Rules to open, checked rather than trusted: router state is anyone's. */
export function arrivedRuleId(state: unknown): string | undefined {
  if (typeof state !== 'object' || state === null) return undefined
  const rule = (state as { rule?: unknown }).rule
  return typeof rule === 'string' && rule !== '' ? rule : undefined
}
