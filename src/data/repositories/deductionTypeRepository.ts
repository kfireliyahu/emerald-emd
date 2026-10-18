/**
 * The deduction vocabulary — `DeductionType` in docs/04-data-model.md, the
 * ledger pack's `deduction_type` since M25 U7 (D-281), its built-ins the pack's
 * seeds under the `ded:` ids migration 012 gave them.
 *
 * **Rows in the document, not data shipped beside it** (D-049). The built-in
 * rules of D-046 went the other way for reasons that do not apply here: a
 * `paycheck_line` holds a real foreign key into this table, and a deduction type
 * carries per-document state — its links to a fund, a goal or a debt, its two
 * flags, its place in the picker — that has to be stored somewhere regardless.
 * Israeli payroll vocabulary is closed enough that a migration per release is
 * not the cost it would have been for merchant rules.
 *
 * Decoding is defensive, as everywhere else here: a `.emd` file is a
 * real SQLite database the user can open in any tool, and a row that no longer
 * makes sense is skipped rather than thrown.
 */

import type { Database } from 'sql.js'

import { DEDUCTION_KINDS, type DeductionKind, type DeductionType } from '@/domain/model/paycheck.ts'
import type { StoredValue } from '@/domain/format/row.ts'
import { inTransaction, query } from '../db/database.ts'
import { allDeclared, declared } from '../packs/ledger/tables.ts'
import { deleteRows, insertRows, updateRow } from './formatRowRepository.ts'

export interface NewDeductionType {
  readonly name: string
  readonly hebrewName?: string | undefined
  readonly kind: DeductionKind
  readonly reducesNet?: boolean | undefined
  readonly countsAsSaving?: boolean | undefined
  readonly linkedSavingGoalId?: string | undefined
  readonly linkedDebtId?: string | undefined
  readonly linkedFundId?: string | undefined
}

export interface DeductionTypeEdit {
  readonly name?: string | undefined
  readonly hebrewName?: string | undefined
  readonly kind?: DeductionKind | undefined
  readonly reducesNet?: boolean | undefined
  readonly countsAsSaving?: boolean | undefined
  readonly linkedSavingGoalId?: string | undefined
  readonly linkedDebtId?: string | undefined
  readonly linkedFundId?: string | undefined
}

const SORT_STEP = 10

const SELECT = `SELECT id, name, hebrew_name, kind, reduces_net, counts_as_saving,
                       linked_saving_goal AS linked_saving_goal_id, linked_debt AS linked_debt_id,
                       linked_holding AS linked_fund_id, is_built_in, sort_order
                  FROM fmt_deduction_type
                 WHERE 1 = 1`

/**
 * The whole vocabulary, in picker order.
 *
 * Built-ins and the user's own together, sorted only by `sort_order`: which of
 * the two a type is decides whether it can be deleted, not where it appears. A
 * user who adds "Parking" and drags it to the top has said where they want it.
 */
export function listDeductionTypes(db: Database): readonly DeductionType[] {
  return decodeAll(query(db, `${SELECT} ORDER BY sort_order, name`))
}

export function findDeductionType(db: Database, id: string): DeductionType | undefined {
  return decodeAll(query(db, `${SELECT} AND id = ?`, [id]))[0]
}

export class DuplicateDeductionTypeError extends Error {
  constructor(readonly typeName: string) {
    super(`There is already a deduction type called ${typeName}. Use that one, or give this one another name.`)
    this.name = 'DuplicateDeductionTypeError'
  }
}

/**
 * A name another type already has, refused by name first: `name` is unique in
 * the pack's declaration — the built-ins are seeded by it (D-264) — and "there
 * is already a Pension" is a sentence where a constraint violation is not.
 */
function refuseTakenName(db: Database, name: string, except?: string): void {
  const taken = query(db, 'SELECT id FROM fmt_deduction_type WHERE name = ? AND id IS NOT ?', [
    name,
    except ?? null,
  ])
  if (taken.length > 0) throw new DuplicateDeductionTypeError(name)
}

/** A type the user added, placed at the end of the list. */
export function createDeductionType(
  db: Database,
  input: NewDeductionType,
  _now: number,
): DeductionType {
  refuseTakenName(db, input.name)
  const [id = ''] = insertRows(db, declared(db, 'deduction_type'), [
    {
      ...typeColumns({
        name: input.name,
        hebrewName: input.hebrewName,
        kind: input.kind,
        reducesNet: input.reducesNet !== false,
        countsAsSaving: input.countsAsSaving === true,
        linkedSavingGoalId: input.linkedSavingGoalId,
        linkedDebtId: input.linkedDebtId,
        linkedFundId: input.linkedFundId,
      }),
      is_built_in: 0,
      sort_order: nextSortOrder(db),
    },
  ])

  const created = findDeductionType(db, id)
  if (created === undefined) throw new Error('deduction type did not survive insert')
  return created
}

/**
 * Change a type in place. Fields left out are left alone.
 *
 * A built-in is editable, deliberately: an employer that calls the health tax
 * something else, or a pension line that should feed a fund, is a fact about
 * this document and not a reason to make the user rebuild the vocabulary. What
 * a built-in cannot do is disappear (`deleteDeductionType`).
 *
 * The links are settable to nothing, which is why each one is read from the
 * edit's own key presence rather than with `??` — `linkedDebtId: undefined` in
 * an edit that names it means "unlink", and coalescing would silently keep it.
 */
export function updateDeductionType(
  db: Database,
  id: string,
  edit: DeductionTypeEdit,
  _now: number,
): void {
  const existing = findDeductionType(db, id)
  if (existing === undefined) return
  if (edit.name !== undefined) refuseTakenName(db, edit.name, id)

  const pick = <K extends keyof DeductionTypeEdit>(
    key: K,
    current: DeductionTypeEdit[K],
  ): DeductionTypeEdit[K] => (key in edit ? edit[key] : current)

  // Through the engine, so a built-in somebody edits is theirs from then on and
  // no later build puts its old flags back (D-264).
  updateRow(
    db,
    declared(db, 'deduction_type'),
    id,
    typeColumns({
      name: edit.name ?? existing.name,
      hebrewName: pick('hebrewName', existing.hebrewName),
      kind: edit.kind ?? existing.kind,
      reducesNet: edit.reducesNet ?? existing.reducesNet,
      countsAsSaving: edit.countsAsSaving ?? existing.countsAsSaving,
      linkedSavingGoalId: pick('linkedSavingGoalId', existing.linkedSavingGoalId),
      linkedDebtId: pick('linkedDebtId', existing.linkedDebtId),
      linkedFundId: pick('linkedFundId', existing.linkedFundId),
    }),
  )
}

/**
 * Take a goal, a debt or a fund off every type that feeds it — what removing
 * one of those does first, so the removal leaves no link naming nothing.
 */
export function unlinkDeductionTypes(
  db: Database,
  column: 'linked_saving_goal' | 'linked_debt' | 'linked_holding',
  targetId: string,
): void {
  const types = declared(db, 'deduction_type')
  for (const row of query(db, `SELECT id FROM fmt_deduction_type WHERE ${column} = ?`, [targetId])) {
    updateRow(db, types, String(row['id']), { [column]: null })
  }
}

interface TypeFields {
  readonly name: string
  readonly hebrewName: string | undefined
  readonly kind: DeductionKind
  readonly reducesNet: boolean
  readonly countsAsSaving: boolean
  readonly linkedSavingGoalId: string | undefined
  readonly linkedDebtId: string | undefined
  readonly linkedFundId: string | undefined
}

function typeColumns(type: TypeFields): Record<string, StoredValue> {
  return {
    name: type.name,
    hebrew_name: type.hebrewName ?? null,
    kind: type.kind,
    reduces_net: type.reducesNet ? 1 : 0,
    counts_as_saving: type.countsAsSaving ? 1 : 0,
    linked_saving_goal: type.linkedSavingGoalId ?? null,
    linked_debt: type.linkedDebtId ?? null,
    linked_holding: type.linkedFundId ?? null,
  }
}

/**
 * How many paycheck lines name each type, in one query.
 *
 * The types screen needs this for every row at once — to say what a flag change
 * will move, and to know which rows can be deleted — and asking per row would
 * be one query per type on every render.
 */
export function deductionTypeUsageCounts(db: Database): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()

  for (const row of query(
    db,
    `SELECT deduction_type AS id, COUNT(*) AS n
       FROM fmt_paycheck_line
      GROUP BY deduction_type`,
  )) {
    counts.set(String(row['id']), Number(row['n'] ?? 0))
  }

  return counts
}

/** How many paycheck lines name this type. What deleting one has to ask. */
export function deductionTypeUsage(db: Database, id: string): number {
  const rows = query(
    db,
    'SELECT COUNT(*) AS n FROM fmt_paycheck_line WHERE deduction_type = ?',
    [id],
  )
  return Number(rows[0]?.['n'] ?? 0)
}

export class DeductionTypeInUseError extends Error {
  constructor(
    readonly usage: number,
    readonly isBuiltIn: boolean,
  ) {
    super(
      isBuiltIn
        ? 'Built-in deduction types cannot be deleted. Edit it, or leave it out of your paychecks.'
        : 'This deduction type is used by a paycheck. Remove those lines first.',
    )
    this.name = 'DeductionTypeInUseError'
  }
}

/**
 * Delete a type the user added and nothing uses. Anything else is refused.
 *
 * Refused rather than cascaded, for the reason `deleteCategory` refuses:
 * removing a type that a year of payslips names would rewrite what those slips
 * said. A built-in is never deletable — it is the vocabulary the app promises to
 * know, and a document missing "Income tax" would be a document the entry screen
 * cannot describe.
 *
 * **Removed, not soft-deleted**, since M25 U7: a declared row is there or it
 * is not (D-266). A fixed expense matched by it stands in the way too, and the
 * engine's refusal names it.
 */
export function deleteDeductionType(db: Database, id: string, _now: number): void {
  const existing = findDeductionType(db, id)
  if (existing === undefined) return

  const usage = deductionTypeUsage(db, id)
  if (existing.isBuiltIn || usage > 0) throw new DeductionTypeInUseError(usage, existing.isBuiltIn)

  deleteRows(db, declared(db, 'deduction_type'), [id], allDeclared(db))
}

/**
 * Write a new picker order, as the ids the user dragged into it.
 *
 * Re-normalized in steps of ten rather than patched, exactly as `reorderRules`
 * does and for the same reason: after any reorder the numbers are 10, 20, 30
 * again, and a type inserted between two of them has somewhere to go.
 */
export function reorderDeductionTypes(
  db: Database,
  orderedIds: readonly string[],
  _now: number,
): void {
  const types = declared(db, 'deduction_type')
  inTransaction(db, () => {
    orderedIds.forEach((id, position) => {
      updateRow(db, types, id, { sort_order: (position + 1) * SORT_STEP })
    })
  })
}

function nextSortOrder(db: Database): number {
  const rows = query(db, 'SELECT MAX(sort_order) AS top FROM fmt_deduction_type')
  const top = rows[0]?.['top']
  return top == null ? SORT_STEP : Number(top) + SORT_STEP
}

const VALID_KINDS: ReadonlySet<string> = new Set<string>(DEDUCTION_KINDS)

function decodeAll(rows: readonly Record<string, unknown>[]): readonly DeductionType[] {
  const types: DeductionType[] = []
  for (const row of rows) {
    const type = decode(row)
    if (type !== undefined) types.push(type)
  }
  return types
}

function decode(row: Record<string, unknown>): DeductionType | undefined {
  const kind = String(row['kind'])
  // A kind this build has not heard of is a type it cannot place on either side
  // of the slip, and guessing would move a number the user is checking.
  if (!VALID_KINDS.has(kind)) return undefined

  return {
    id: String(row['id']),
    name: String(row['name']),
    hebrewName: row['hebrew_name'] == null ? undefined : String(row['hebrew_name']),
    kind: kind as DeductionKind,
    reducesNet: Number(row['reduces_net'] ?? 0) === 1,
    countsAsSaving: Number(row['counts_as_saving'] ?? 0) === 1,
    linkedSavingGoalId:
      row['linked_saving_goal_id'] == null ? undefined : String(row['linked_saving_goal_id']),
    linkedDebtId: row['linked_debt_id'] == null ? undefined : String(row['linked_debt_id']),
    linkedFundId:
      row['linked_fund_id'] == null ? undefined : String(row['linked_fund_id']),
    isBuiltIn: Number(row['is_built_in'] ?? 0) === 1,
    sortOrder: Number(row['sort_order'] ?? 0),
  }
}
