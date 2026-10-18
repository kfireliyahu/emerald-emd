/**
 * Stored categorization rules — the `CategoryRule` of docs/04-data-model.md.
 *
 * The engine is `@/domain/categorization.ts` and knows nothing about SQL; this
 * is where a rule gets identity, timestamps and a place to live. Rules are
 * loaded whole and evaluated in memory: a rule set is tens of rows, and the
 * ordering that decides a category is a rule about kinds and origins, not
 * something an `ORDER BY` should be quietly re-deciding.
 *
 * Decoding is defensive, like every other repository here. A `.emd`
 * file is a real SQLite database the user can open in any tool, so a row that
 * no longer makes sense is skipped rather than thrown — a corrupt rule must not
 * take the import path down with it.
 */

import type { Database } from 'sql.js'

import { newId } from '@/core/id.ts'
import { money, type Money } from '@/core/money.ts'
import {
  RULE_KINDS,
  RULE_ORIGINS,
  type CategoryRule,
  type RuleConditions,
  type RuleKind,
  type RuleOrigin,
} from '@/domain/model/rules.ts'
import { inTransaction, query } from '../db/database.ts'
import { allDeclared, declared, instantOf, millisOf } from '../packs/ledger/tables.ts'
import { BUILT_IN_RULES } from '../reference/rulepacks/index.ts'
import { forgetRules } from './categoryRepository.ts'
import { deleteRows, insertRows, updateRow } from './formatRowRepository.ts'

export interface NewRule {
  readonly name: string
  readonly kind: RuleKind
  readonly pattern?: string | undefined
  readonly targetCategoryId: string
  readonly origin?: RuleOrigin | undefined
  readonly conditions?: RuleConditions | undefined
  /** Omit to put the rule at the end of its tier. */
  readonly priority?: number | undefined
  readonly isEnabled?: boolean | undefined
}

export interface RuleEdit {
  readonly name?: string | undefined
  readonly kind?: RuleKind | undefined
  readonly pattern?: string | undefined
  readonly targetCategoryId?: string | undefined
  readonly conditions?: RuleConditions | undefined
  readonly isEnabled?: boolean | undefined
}

/** The gap left between priorities, so a rule can be dropped between two others. */
export const PRIORITY_STEP = 10

/**
 * The rules are rows of the pack's `category_rule` since M25 U2 — the built-ins
 * included, which were code until then (D-046). The two bounds are money each,
 * with a currency each, where the old table shared one; they are read back as
 * one currency because a rule's bounds never had two.
 */
const SELECT = `SELECT id, name, kind, pattern, target AS target_category_id, priority, origin,
                       is_enabled, scope_account AS scope_account_id,
                       amount_min_minor, amount_max_minor,
                       COALESCE(amount_min_currency, amount_max_currency) AS amount_currency,
                       hit_count, last_matched, created
                  FROM fmt_category_rule
                 WHERE 1 = 1`

/**
 * Every live rule, enabled or not.
 *
 * The disabled ones come too: the rules screen lists them, and leaving them out
 * here would mean two different ideas of "the rule set" — the engine already
 * refuses to match a disabled rule, in one place, where it can be tested.
 */
export function listRules(db: Database): readonly CategoryRule[] {
  return decodeAll(query(db, `${SELECT} ORDER BY priority, created, name`))
}

export function findRule(db: Database, id: string): CategoryRule | undefined {
  return decodeAll(query(db, `${SELECT} AND id = ?`, [id]))[0]
}

/**
 * Add a rule at the end of its origin tier.
 *
 * A new rule going last is what makes learning from corrections safe to do
 * repeatedly (F03): each new rule is more specific than the broad ones above it
 * or it is shadowed by them, and either way nothing the user already arranged
 * moves underneath them.
 */
export function createRule(db: Database, input: NewRule, now: number): CategoryRule {
  const origin = input.origin ?? 'USER'
  const id = newId()
  const conditions = input.conditions ?? {}

  insertRows(
    db,
    declared(db, 'category_rule'),
    [
      {
        name: distinctName(db, input.name, undefined),
        kind: input.kind,
        pattern: input.pattern ?? '',
        target: input.targetCategoryId,
        priority: input.priority ?? nextPriority(db, origin),
        origin,
        is_enabled: input.isEnabled === false ? 0 : 1,
        scope_account: conditions.scopeAccountId ?? null,
        ...boundCells(conditions),
        hit_count: 0,
        last_matched: null,
        created: instantOf(now),
      },
    ],
    [id],
  )

  const created = findRule(db, id)
  if (created === undefined) throw new Error('rule did not survive insert')
  return created
}

/**
 * Change a rule in place.
 *
 * Fields left out are left alone, and `priority` is not editable here — order
 * is what `reorderRules` is for, and letting two paths write it is how a list
 * ends up with two rules claiming one position.
 */
export function updateRule(db: Database, id: string, edit: RuleEdit, _now: number): void {
  const existing = findRule(db, id)
  if (existing === undefined) return

  const conditions = edit.conditions ?? existing.conditions
  // Only the cells the edit changes: an edit that names nothing new is not an
  // edit, and must not make a built-in the person's (D-264).
  const cells: Record<string, string | number | null> = {
    kind: edit.kind ?? existing.kind,
    pattern: edit.pattern ?? existing.pattern,
    target: edit.targetCategoryId ?? existing.targetCategoryId,
    is_enabled: (edit.isEnabled ?? existing.isEnabled) ? 1 : 0,
    scope_account: conditions.scopeAccountId ?? null,
    ...boundCells(conditions),
  }
  if (edit.name !== undefined && edit.name !== existing.name) cells['name'] = distinctName(db, edit.name, id)
  updateRow(db, declared(db, 'category_rule'), id, cells)
}

export function setRuleEnabled(db: Database, id: string, isEnabled: boolean, _now: number): void {
  updateRow(db, declared(db, 'category_rule'), id, { is_enabled: isEnabled ? 1 : 0 })
}

/**
 * Removed, not soft-deleted, since M25 U2 (D-266) — through the engine, so a
 * built-in taken away is recorded removed and no later build brings it back.
 */
export function deleteRule(db: Database, id: string, _now: number): void {
  inTransaction(db, () => {
    forgetRules(db, [id])
    deleteRows(db, declared(db, 'category_rule'), [id], allDeclared(db))
  })
}

/**
 * **A rule's name is one rule's** since M25 U2 — it is what a text document and
 * a seed name the row by. A name another rule has is told apart with a number,
 * because a rule is named by its pattern by default and two rules on one
 * pattern of different kinds is ordinary.
 */
function distinctName(db: Database, name: string, except: string | undefined): string {
  const taken = new Set(
    query(db, 'SELECT name FROM fmt_category_rule WHERE id IS NOT ?', [except ?? null]).map((row) =>
      String(row['name']),
    ),
  )
  if (!taken.has(name)) return name
  for (let at = 2; ; at += 1) {
    const next = `${name} (${String(at)})`
    if (!taken.has(next)) return next
  }
}

/**
 * Write a new order, as the ids the user dragged into it.
 *
 * Priorities are re-normalized to `PRIORITY_STEP` apart rather than patched,
 * which is the whole reason they are integers and not a linked list: after any
 * reorder the numbers are 10, 20, 30 again, and a rule inserted between two of
 * them has somewhere to go. Rules not named keep their own priority and sort
 * after — a reorder of one tier must not silently renumber another.
 */
export function reorderRules(db: Database, orderedIds: readonly string[], _now: number): void {
  orderedIds.forEach((id, index) => {
    const rules = declared(db, 'category_rule')
    updateRow(db, rules, id, { priority: (index + 1) * PRIORITY_STEP })
  })
}

/**
 * Record that a rule fired.
 *
 * Counted here rather than inside the engine because the engine is pure: it
 * answers what *would* match, and the test box asks it constantly. Only a real
 * import or re-apply calls this.
 */
export function recordHits(db: Database, ruleIds: readonly string[], now: number): void {
  // Straight SQL rather than `updateRow`: a hit is what the rule did, not an
  // opinion somebody had about it, and must not make a built-in the person's.
  for (const id of ruleIds) {
    db.run(
      `UPDATE fmt_category_rule SET hit_count = COALESCE(hit_count, 0) + 1, last_matched = ? WHERE id = ?`,
      [instantOf(now), id],
    )
  }
}

/**
 * Give back hits an undone re-apply had counted.
 *
 * The counterpart to `recordHits`, and it exists for one reason: the "this rule
 * never fires" view is only worth having if the number under it is true. A
 * re-apply that moved three hundred rows and was then taken back must not leave
 * three hundred hits behind, or the one view whose whole value is being trusted
 * starts lying about the busiest rules first.
 *
 * `last_matched_at` is deliberately **not** rolled back. It is "when did this
 * rule last do something", and the honest answer after an undo is still today —
 * the rule did match, and the user changed their mind about the result.
 * Reconstructing the previous timestamp would mean storing it per row to
 * un-store it later, which is a lot of machinery for a date in a caption.
 */
export function unrecordHits(db: Database, ruleIds: readonly string[]): void {
  for (const id of ruleIds) {
    db.run(`UPDATE fmt_category_rule SET hit_count = MAX(0, COALESCE(hit_count, 0) - 1) WHERE id = ?`, [id])
  }
}

function nextPriority(db: Database, origin: RuleOrigin): number {
  const rows = query(
    db,
    `SELECT MAX(priority) AS top FROM fmt_category_rule WHERE origin = ?`,
    [origin],
  )
  const top = rows[0]?.['top']
  return top == null ? PRIORITY_STEP : Number(top) + PRIORITY_STEP
}

/** The two bounds as the four cells they are stored in: magnitudes, each with its currency. */
function boundCells(conditions: RuleConditions): Record<string, number | string | null> {
  const { amountMin, amountMax } = conditions
  return {
    amount_min_minor: amountMin === undefined ? null : Math.abs(amountMin.minor),
    amount_min_currency: amountMin?.currency ?? null,
    amount_max_minor: amountMax === undefined ? null : Math.abs(amountMax.minor),
    amount_max_currency: amountMax?.currency ?? null,
  }
}

/**
 * What a built-in is called on a screen. Its row is named by its rule-pack id
 * (`il.fuel.delek`, D-266), because a built-in's name defaults to its pattern
 * and two of them share one; the name a person reads is still the pack's.
 */
const SHIPPED_NAMES: ReadonlyMap<string, string> = new Map(BUILT_IN_RULES.map((rule) => [rule.id, rule.name]))

const VALID_KINDS: ReadonlySet<string> = new Set<string>(RULE_KINDS)
const VALID_ORIGINS: ReadonlySet<string> = new Set<string>(RULE_ORIGINS)

function decodeAll(rows: readonly Record<string, unknown>[]): readonly CategoryRule[] {
  const rules: CategoryRule[] = []
  for (const row of rows) {
    const rule = decode(row)
    if (rule !== undefined) rules.push(rule)
  }
  return rules
}

function decode(row: Record<string, unknown>): CategoryRule | undefined {
  const kind = String(row['kind'])
  const origin = String(row['origin'])
  // A kind or origin this build has not heard of is a rule it cannot evaluate,
  // and guessing at one would be worse than leaving it out: the user would see
  // a category assigned by something the rules screen cannot describe.
  if (!VALID_KINDS.has(kind) || !VALID_ORIGINS.has(origin)) return undefined

  const currency = row['amount_currency'] == null ? undefined : String(row['amount_currency'])

  const id = String(row['id'])
  return {
    id,
    name: (origin === 'BUILT_IN' ? SHIPPED_NAMES.get(id) : undefined) ?? String(row['name']),
    kind: kind as RuleKind,
    pattern: row['pattern'] == null ? '' : String(row['pattern']),
    targetCategoryId: String(row['target_category_id']),
    priority: Number(row['priority'] ?? 0),
    origin: origin as RuleOrigin,
    isEnabled: Number(row['is_enabled'] ?? 0) === 1,
    conditions: {
      scopeAccountId: row['scope_account_id'] == null ? undefined : String(row['scope_account_id']),
      amountMin: bound(row['amount_min_minor'], currency),
      amountMax: bound(row['amount_max_minor'], currency),
    },
    createdAt: millisOf(row['created']) ?? 0,
    hitCount: Number(row['hit_count'] ?? 0),
    lastMatchedAt: millisOf(row['last_matched']),
  }
}

/** A bound without a currency is not a bound; the engine would refuse it anyway. */
function bound(value: unknown, currency: string | undefined): Money | undefined {
  if (value == null || currency === undefined) return undefined
  return money(Math.abs(Number(value)), currency)
}
