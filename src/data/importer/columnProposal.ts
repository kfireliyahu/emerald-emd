/**
 * A model's answer about a statement's columns, validated and applied — F17's
 * **tabular** rung 2, and the one place a model has something to beat.
 *
 * `headerAliases.ts` is the deterministic guesser and it is right most of the
 * time; D-114 measured it mapping a **reference column to `amount`**, which is
 * a statement that imports cleanly and is wrong in every figure. A proposal here
 * costs one call per format, is applied to a draft the user is already looking
 * at, and is verified by the two things the mapper already does: a live parse
 * preview, and the parsed total against the total the file prints (D-013).
 *
 * > A model decides the schema; code moves the data.
 *
 * **Nothing here is a value**, as everywhere else in F17: the answer is column
 * *indexes* and one enum, the same shape `guessMapping` produces, and this file
 * would drop a cell's contents if a runtime handed one over.
 *
 * **It replaces the column roles rather than merging with them.** The button
 * that calls this is pressed deliberately, on a grid the user can see, and every
 * column is one select away from being corrected — so a merge that silently kept
 * half of the old guess would be harder to reason about than a clean answer,
 * not easier. The header row, the currency and the date orders are untouched:
 * they are not what was asked about.
 */

import type { SheetTable } from './sheetTable.ts'
import { cleanText } from '@/core/text.ts'
import {
  AMOUNT_CONVENTIONS,
  type AmountConvention,
  type DraftMapping,
} from '@/domain/model/importing.ts'
import type { ColumnRoleId } from '@/domain/model/columnRoles.ts'
import type { StatementContext } from '@/domain/modelTasks.ts'

export interface ColumnProposal {
  readonly columns: readonly { readonly index: number; readonly role: ColumnRoleId }[]
  readonly amountConvention: AmountConvention
}

/** How many data rows a model is shown. Enough to tell a date from a reference. */
const SAMPLE_ROWS = 4

/**
 * What the model is handed: the header row as read, and a few rows under it.
 *
 * Rows rather than a description of them, because the whole reason a model beats
 * an alias table here is that `1234` under a header called `אסמכתא` looks like
 * an amount to a string matcher and does not to anything that can read four of
 * them in a row.
 */
export function statementContext(
  table: SheetTable,
  mapping: DraftMapping,
  roles: readonly ColumnRoleId[],
): StatementContext {
  const headers = (table.rows[mapping.headerRowIndex] ?? []).map((cell) => cleanText(cell?.text ?? ''))
  const sampleRows: string[][] = []

  for (
    let index = mapping.dataStartRowIndex;
    index < table.rows.length && sampleRows.length < SAMPLE_ROWS;
    index++
  ) {
    const row = table.rows[index]
    if (row === undefined) continue
    const cells = row.map((cell) => cleanText(cell?.text ?? ''))
    if (cells.every((cell) => cell === '')) continue
    sampleRows.push(cells)
  }

  return { headers, sampleRows, roles }
}

/**
 * The proposal, if it is one.
 *
 * The same gate the payslip and fund-report validators are, with two rules a
 * template of line numbers does not need: **no role twice, and no column twice**.
 * `withColumnRole` enforces uniqueness one assignment at a time; a whole map
 * arriving at once has to be checked before it is trusted, and a mapping with
 * two `amount` columns is a mapping that parses the wrong one.
 *
 * A later entry wins on a repeat, which is arbitrary but deterministic — what
 * matters is that the result is a map a person can read off the grid.
 */
export function toColumnProposal(
  value: unknown,
  /**
   * What **this document** calls a role (D-213) — the same array the grammar's
   * `enum` was built from, so an answer inside the list a model was given is an
   * answer this accepts. Checking against the `const` instead would refuse
   * exactly the role somebody added for a column no release could name (D-208).
   */
  roles: readonly ColumnRoleId[],
): ColumnProposal | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>

  const convention = record['amountConvention']
  if (typeof convention !== 'string') return undefined
  if (!(AMOUNT_CONVENTIONS as readonly string[]).includes(convention)) return undefined

  const rows = record['columns']
  if (!Array.isArray(rows)) return undefined

  const known = new Set<string>(roles)
  const byIndex = new Map<number, ColumnRoleId>()
  const byRole = new Map<ColumnRoleId, number>()

  for (const entry of rows) {
    if (typeof entry !== 'object' || entry === null) continue
    const row = entry as Record<string, unknown>
    const index = row['index']
    const role = row['role']
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) continue
    if (typeof role !== 'string') continue
    if (!known.has(role)) continue

    const named = role
    const heldBy = byRole.get(named)
    if (heldBy !== undefined) byIndex.delete(heldBy)
    byIndex.delete(index)
    byIndex.set(index, named)
    byRole.set(named, index)
  }

  if (byIndex.size === 0) return undefined

  return {
    columns: [...byIndex].map(([index, role]) => ({ index, role })),
    amountConvention: convention as AmountConvention,
  }
}

/**
 * The proposal on the draft the user is looking at.
 *
 * Columns the proposal does not name are **unassigned**, which is the honest
 * reading of an answer that left them out: a model told to omit a role it cannot
 * find has said the column has no role, and keeping the old guess for it would
 * mix two answers into one map nobody gave.
 */
export function applyColumnProposal(
  mapping: DraftMapping,
  proposal: ColumnProposal,
): DraftMapping {
  const columnRoles = new Map<number, ColumnRoleId>()
  for (const { index, role } of proposal.columns) columnRoles.set(index, role)

  return { ...mapping, columnRoles, amountConvention: proposal.amountConvention }
}
