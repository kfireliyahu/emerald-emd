/**
 * The two reading vocabularies, as data rather than as `const` arrays.
 *
 * **What moved and what did not** (D-212, M19 U1). The lists themselves are
 * unchanged and still declared where they were — `COLUMN_ROLES` in
 * `./importing.ts`, `DEPOSIT_COLUMN_ROLES` in `./templates.ts`. What is new is
 * that they are a **seed** rather than the whole vocabulary: a document carries
 * its own rows, seeded with exactly these, and a person can add one when a real
 * file prints a column this build has no name for (D-208).
 *
 * **This is not the same as opening the lists, and the difference is the whole
 * design.** A vocabulary is handed to a model as a JSON Schema `enum`, and
 * unaided a model asked to use an app's vocabulary invents members of it
 * (D-114). The list stays **closed at the moment the model is asked** — it is
 * built from the document's rows at task time instead of from a `const`. What
 * changed is only that the rows can differ between documents.
 *
 * **A seeded role and an added role are different kinds of thing** (D-211):
 *
 * - A **seeded** role has a meaning compiled in. A reader narrows on it and
 *   does something particular with the cell — `amount` is parsed as money,
 *   `date` as a date.
 * - An **added** role is **named, not stored**. Nothing narrows on it and no
 *   figure is kept. It exists so a model has a right answer for a column no
 *   seeded role names, rather than the nearest one that does — the mistake
 *   D-208 was about. It still beats `ignore`, because the column keeps its
 *   name for when a format declares a column to hold it (M19 U5).
 *
 * **That is why the guards below exist rather than a widened union.** A stored
 * mapping holds a `ColumnRoleId`, which is a string; a reader asks
 * `isStatementRole` or `isDepositRole` first and, past that guard, is back
 * inside the literal union the compiler checks exhaustively. An added role
 * cannot reach those switches, which is what "nothing reads it" means in the
 * type system rather than only in prose.
 */

import { COLUMN_ROLES, type ColumnRole } from './importing.ts'
import { DEPOSIT_COLUMN_ROLES, type DepositColumnRole } from './templates.ts'

/**
 * Which reading a role belongs to.
 *
 * Two, because there are two tables these documents print and each has its
 * own idea of what a column can mean. A role is unique within its vocabulary
 * and says nothing about the other. A broker statement's holdings and trades
 * were two more, until investments left the ledger (D-283); `column_role` no
 * longer declares them either, and a document still holding such a row is its
 * owner's to fix (M45 F1).
 */
export const ROLE_VOCABULARIES = ['STATEMENT', 'DEPOSIT'] as const

export type RoleVocabulary = (typeof ROLE_VOCABULARIES)[number]

/**
 * A role as a mapping stores it.
 *
 * Deliberately `string` and not a union. A mapping may name a role somebody
 * added to this document, and no build can know that name — which is the point.
 * Narrow with the guards below before doing anything with the cell.
 */
export type ColumnRoleId = string

/** Where a row came from, and therefore whether any code understands it. */
export type ColumnRoleOrigin = 'SEEDED' | 'USER'

/** One row of `column_role`. */
export interface ColumnRoleRow {
  readonly vocabulary: RoleVocabulary
  readonly role: ColumnRoleId
  readonly origin: ColumnRoleOrigin
  /** The order roles are offered in, and the order they enter the grammar. */
  readonly position: number
}

/**
 * What migration 031 seeds, by vocabulary — and what a test compares the seeded
 * rows against, so the two can never drift.
 */
export const SEEDED_ROLES = {
  STATEMENT: COLUMN_ROLES,
  DEPOSIT: DEPOSIT_COLUMN_ROLES,
} as const satisfies Readonly<Record<RoleVocabulary, readonly string[]>>

const STATEMENT_SET: ReadonlySet<string> = new Set(COLUMN_ROLES)
const DEPOSIT_SET: ReadonlySet<string> = new Set(DEPOSIT_COLUMN_ROLES)

/**
 * Is this a role this build understands?
 *
 * One per vocabulary rather than one generic, because each returns a different
 * union and a caller wants that union narrowed, not a boolean. Past one of
 * these, a `switch` is exhaustive again.
 */
export const isStatementRole = (role: ColumnRoleId): role is ColumnRole =>
  STATEMENT_SET.has(role)

export const isDepositRole = (role: ColumnRoleId): role is DepositColumnRole =>
  DEPOSIT_SET.has(role)


/**
 * What a role a person types has to look like before it is written.
 *
 * The same shape as the seeded ones — a lowerCamelCase identifier — because it
 * goes into a grammar's `enum` and is read back out of a model's answer. A role
 * carrying a space, a quote or Hebrew would be a string the decoder has to
 * escape, and an escaped string inside a grammar is the exact shape that
 * truncated `סה"כ ברוטו` at its gershayim (D-137).
 */
export const ROLE_PATTERN = /^[a-z][A-Za-z0-9]{0,31}$/

/**
 * Why this role may not be added, or `undefined` if it may.
 *
 * Returns the sentence a form prints, because every one of these is a thing the
 * person needs told rather than a condition a caller re-words.
 */
export function roleRejection(
  role: string,
  existing: readonly ColumnRoleRow[],
): string | undefined {
  const trimmed = role.trim()
  if (trimmed === '') return 'A role needs a name.'
  if (!ROLE_PATTERN.test(trimmed)) {
    return 'Use a short name like cost or settlementDate — letters and digits, starting lowercase.'
  }
  if (existing.some((row) => row.role === trimmed)) {
    return `This reading already has a role called ${trimmed}.`
  }
  return undefined
}
