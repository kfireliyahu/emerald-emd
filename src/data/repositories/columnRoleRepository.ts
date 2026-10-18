/**
 * The two reading vocabularies as the document holds them — `ColumnRole` in
 * docs/04-data-model.md, the ledger pack's `column_role` since M25 U8.
 *
 * **`deduction_type` is the precedent and the argument** (012, D-049, D-209): a
 * real table whose rows the user creates. Correctness never came from a
 * vocabulary being fixed, only from its being real.
 *
 * **The roles this build ships are the code's, and only an added one is a row**
 * (M25 U8). Migration 031 seeded them as rows, but a shipped role's meaning is
 * compiled in — a reader switches on it — and nothing may add, remove or
 * reorder one without a build. So a vocabulary is `SEEDED_ROLES` in their
 * order, then what this document added, by the `position` each was given.
 *
 * Decoding is defensive, as everywhere else here: a `.emd` is a real SQLite
 * database the user can open in any tool, and a row that no longer makes sense
 * is skipped rather than thrown.
 *
 * **There is no remove.** Adding a role is this unit's claim; taking one away
 * asks what becomes of the stored mappings that name it, which is H9 at a
 * smaller scale and deserves its own answer rather than a line here (D-212).
 */

import type { Database } from 'sql.js'

import {
  SEEDED_ROLES,
  roleRejection,
  type ColumnRoleId,
  type ColumnRoleRow,
  type RoleVocabulary,
} from '@/domain/model/columnRoles.ts'
import { query } from '../db/database.ts'
import { declared } from '../packs/ledger/tables.ts'
import { insertRows } from './formatRowRepository.ts'

/**
 * One vocabulary, in the order it is offered and the order it enters a grammar:
 * the shipped roles in the order their `const` has them, so a model sees exactly
 * the list it always saw, then the added ones.
 *
 * A document that keeps no ledger still has the shipped roles — a reader asks
 * before anything is written.
 */
export function listColumnRoles(
  db: Database,
  vocabulary: RoleVocabulary,
): readonly ColumnRoleRow[] {
  const shipped: readonly string[] = SEEDED_ROLES[vocabulary]
  const seeded = shipped.map(
    (role, position): ColumnRoleRow => ({ vocabulary, role, origin: 'SEEDED', position }),
  )
  const added = query(
    db,
    'SELECT role, position FROM fmt_column_role WHERE vocabulary = ? ORDER BY position, role',
    [vocabulary],
  ).flatMap((row): ColumnRoleRow[] => {
    const role = row['role']
    if (typeof role !== 'string' || role === '' || shipped.includes(role)) return []
    return [{ vocabulary, role, origin: 'USER', position: shipped.length + Number(row['position'] ?? 0) }]
  })
  return [...seeded, ...added]
}

/**
 * Just the names, which is what a grammar's `enum` and a picker both want.
 *
 * **This is the function that keeps D-114 true.** The list handed to a model is
 * still closed — it is simply read from here at task time instead of from a
 * `const`.
 */
export function columnRoleIds(
  db: Database,
  vocabulary: RoleVocabulary,
): readonly ColumnRoleId[] {
  return listColumnRoles(db, vocabulary).map((row) => row.role)
}

/**
 * A role somebody added because a document printed a column this build cannot
 * name — **named, not stored** (D-211).
 *
 * Always `USER`: a shipped role is the code's, because seeded means *a reader
 * narrows on this and does something particular*, and no row can make that
 * true of itself.
 *
 * Rejections come back as the sentence to print rather than as a thrown error.
 * Adding a role is something a person does mid-thought, in a mapper, with a
 * file open — the failure is a message beside a text box, never a screen that
 * went away.
 */
export function addColumnRole(
  db: Database,
  vocabulary: RoleVocabulary,
  role: string,
  _now: number,
): { readonly kind: 'added'; readonly row: ColumnRoleRow } | { readonly kind: 'rejected'; readonly reason: string } {
  const existing = listColumnRoles(db, vocabulary)
  const rejection = roleRejection(role, existing)
  if (rejection !== undefined) return { kind: 'rejected', reason: rejection }

  const trimmed = role.trim()
  const shipped = SEEDED_ROLES[vocabulary].length
  const position = existing.reduce((highest, row) => Math.max(highest, row.position), shipped - 1) + 1
  insertRows(db, declared(db, 'column_role'), [{ role: trimmed, vocabulary, position: position - shipped }])

  return { kind: 'added', row: { vocabulary, role: trimmed, origin: 'USER', position } }
}
