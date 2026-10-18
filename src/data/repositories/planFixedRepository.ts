/**
 * What each fixed expense does to each plan — the `plan_fixed_expense` rows
 * (M28 U7, D-319), and the one-time step that brings a document up from the two
 * plan-wide settings they replaced.
 *
 * **No row means the plan ignores the expense**, which is how a bill you have
 * only just started tracking arrives: counted nowhere until somebody picks.
 * Setting `IGNORE` is a row too, so the choice was made rather than defaulted.
 */

import type { Database } from 'sql.js'

import { FIXED_ROLES, type FixedRole } from '@/domain/model/fixed.ts'
import { inTransaction, query } from '../db/database.ts'
import { allDeclared, declared } from '../packs/ledger/tables.ts'
import { deleteRows, insertRows, updateRow } from './formatRowRepository.ts'

const FORMAT = 'plan_fixed_expense'
const TABLE = 'fmt_plan_fixed_expense'

const VALID: ReadonlySet<string> = new Set<string>(FIXED_ROLES)

/** Every role one plan has given, by fixed expense. */
export function listRoles(db: Database, planId: string): ReadonlyMap<string, FixedRole> {
  return new Map(
    query(db, `SELECT fixed_expense, role FROM ${TABLE} WHERE plan = ?`, [planId]).flatMap((row) => {
      const role = String(row['role'])
      return VALID.has(role) ? [[String(row['fixed_expense']), role as FixedRole] as const] : []
    }),
  )
}

/** Every plan's roles at once, for the tools that list plans. */
export function listAllRoles(db: Database): ReadonlyMap<string, ReadonlyMap<string, FixedRole>> {
  const plans = new Map<string, Map<string, FixedRole>>()
  for (const row of query(db, `SELECT plan, fixed_expense, role FROM ${TABLE}`)) {
    const role = String(row['role'])
    if (!VALID.has(role)) continue
    const own = plans.get(String(row['plan'])) ?? new Map<string, FixedRole>()
    own.set(String(row['fixed_expense']), role as FixedRole)
    plans.set(String(row['plan']), own)
  }
  return plans
}

export interface RoleEntry {
  readonly planId: string
  readonly fixedExpenseId: string
  readonly role: FixedRole
}

/**
 * Give roles, one row per plan and expense: an existing row is changed in
 * place and a missing one made, in one transaction.
 */
export function setRoles(db: Database, entries: readonly RoleEntry[]): void {
  if (entries.length === 0) return
  const format = declared(db, FORMAT)
  inTransaction(db, () => {
    for (const entry of entries) {
      const held = query(db, `SELECT id FROM ${TABLE} WHERE plan = ? AND fixed_expense = ?`, [
        entry.planId,
        entry.fixedExpenseId,
      ])[0]
      if (held !== undefined) {
        updateRow(db, format, String(held['id']), { role: entry.role })
      } else {
        insertRows(db, format, [
          { plan: entry.planId, fixed_expense: entry.fixedExpenseId, role: entry.role },
        ])
      }
    }
  })
}

/** A plan is going: its roles go with it, since a role is only ever its own. */
export function removePlanRoles(db: Database, planId: string): void {
  removeWhere(db, 'plan', planId)
}

/** A fixed expense is going: no plan has a say about it any more. */
export function removeExpenseRoles(db: Database, fixedExpenseId: string): void {
  removeWhere(db, 'fixed_expense', fixedExpenseId)
}

function removeWhere(db: Database, column: 'plan' | 'fixed_expense', id: string): void {
  const ids = query(db, `SELECT id FROM ${TABLE} WHERE ${column} = ?`, [id]).map((row) => String(row['id']))
  if (ids.length === 0) return
  deleteRows(db, declared(db, FORMAT), ids, allDeclared(db))
}

/** A copy of a plan starts with the roles of the plan it was copied from. */
export function copyRoles(db: Database, fromPlanId: string, toPlanId: string): void {
  setRoles(
    db,
    [...listRoles(db, fromPlanId)].map(([fixedExpenseId, role]) => ({
      planId: toPlanId,
      fixedExpenseId,
      role,
    })),
  )
}


