/**
 * **A batch of new rows, judged whole before any of it is written** — M26 U2.
 *
 * `record_format_rows` has done this since M19 U2, inside the plugin. A paste
 * on a format's sheet is the same thing — a block of rows, typed and checked
 * like any write, applied whole or not at all — so the plan moved here and both
 * halves call it. Two copies of *what makes a batch acceptable* is how a screen
 * and a conversation come to disagree about one document (D-227, D-234).
 *
 * **Read-only.** It asks the document and writes nothing; the write is still
 * the caller's `insertRows`, which is the capability both halves already share.
 *
 * The order is the tool's, unchanged: coerce each row (the document's own
 * units), draw ids so a link may name a row of the same batch (D-256), resolve
 * links written as names, apply the rule sets over this format (D-273), refuse
 * a link that names nothing and a broken row constraint (D-259), and last a
 * unique value repeated in the table or the batch (D-255).
 */

import type { Database } from 'sql.js'

import { newId } from '@/core/id.ts'
import { isLinkType, type FormatDeclaration } from '@/domain/format/declaration.ts'
import {
  brokenConstraints,
  coerceRow,
  coerceValue,
  companionKeyOf,
  selfLinks,
  type StoredValue,
} from '@/domain/format/row.ts'
import { danglingLinks, indexOf, linksByColumns, linksByName } from './formatJoinRepository.ts'
import { listFormats } from './formatRepository.ts'
import { repeatedValues, tableRefusals } from './formatRowRepository.ts'
import { findersFor, rulesSetting, withRules } from './formatRuleRepository.ts'
import { listUnits } from './unitRepository.ts'

type Cells = Readonly<Record<string, StoredValue>>

/** One row of the batch that would be written. */
export interface StagedRow {
  /** Which of the rows offered, from 0. */
  readonly index: number
  /** As coerced, before a link's name became its id — what a dry run prints. */
  readonly typed: Cells
  /** With every link written as a name resolved, before the rules ran. */
  readonly named: Cells
  /** What `insertRows` would store. */
  readonly cells: Cells
  /** Drawn here, so a row of the batch can be named by another one. */
  readonly id: string
}

/**
 * One row the batch refuses, and **the cell, when there is one** — a sheet
 * marks it, and a refusal that names no cell sends a person reading every one.
 * A row constraint or an unknown key is about the row, and names none.
 */
export interface RefusedRow {
  readonly index: number
  readonly column: string | undefined
  readonly reason: string
}

export interface RowBatch {
  readonly accepted: readonly StagedRow[]
  /** In the order the rows were offered. Empty is the only state that writes. */
  readonly refusals: readonly RefusedRow[]
}

export function stageRows(
  db: Database,
  declaration: FormatDeclaration,
  offered: readonly Readonly<Record<string, unknown>>[],
  listed: readonly FormatDeclaration[] = listFormats(db),
): RowBatch {
  const units = listUnits(db)
  const formats = indexOf(listed)
  const rules = rulesSetting(db, declaration, listed)
  const finders = findersFor(db, declaration, listed)
  const refusals: RefusedRow[] = []
  const typed: { index: number; cells: Cells }[] = []

  offered.forEach((given, index) => {
    // A link named by columns of its row (M38 U5), resolved before it is typed.
    const byColumns = linksByColumns(db, declaration, given, formats)
    if (!byColumns.ok) {
      refusals.push({ index, column: byColumns.error.column, reason: byColumns.error.reason })
      return
    }
    const row = byColumns.value
    const coerced = coerceRow(declaration, row, units)
    if (coerced.ok) typed.push({ index, cells: coerced.value })
    else refusals.push({ index, column: failingColumn(declaration, row, units), reason: coerced.error })
  })

  const ids = typed.map(() => newId())
  const named = linksByName(
    db,
    declaration,
    typed.map((each) => each.cells),
    formats,
    ids,
  )
  const pending = new Set(ids)
  const accepted: StagedRow[] = []

  typed.forEach((each, at) => {
    const resolved = named[at] ?? each.cells
    const ruled = withRules(db, declaration, resolved, {}, rules, finders)
    // A link found by a date that found no row, or two (D-350): refused, by name.
    const unfound = ruled.refusals[0]
    if (unfound !== undefined) {
      refusals.push({ index: each.index, column: unfound.column, reason: ruled.refusals.map((one) => one.reason).join(' ') })
      return
    }
    const cells = ruled.cells
    const dangling = danglingLinks(db, declaration, cells, formats, pending)
    if (dangling.length > 0) {
      const column = declaration.columns.find(
        (one) =>
          isLinkType(one.type) &&
          danglingLinks(db, declaration, { [one.name]: cells[one.name] ?? null }, formats, pending).length > 0,
      )
      refusals.push({ index: each.index, column: column?.name, reason: dangling.join(' ') })
      return
    }
    const id = ids[at] ?? newId()
    // A batch can name its own rows by name (D-256), and so a row can name
    // itself — refused here as an edit is (M27 U5, D-303).
    const self = selfLinks(declaration, id, cells)
    if (self.length > 0) {
      const column = declaration.columns.find((one) => selfLinks(declaration, id, { [one.name]: cells[one.name] ?? null }).length > 0)
      refusals.push({ index: each.index, column: column?.name, reason: self.join(' ') })
      return
    }
    const broken = brokenConstraints(declaration, cells)
    if (broken.length > 0) {
      refusals.push({ index: each.index, column: undefined, reason: broken.join(' ') })
      return
    }
    accepted.push({ index: each.index, typed: each.cells, named: resolved, cells, id })
  })

  // Across the batch as well as against the table, so once over every row.
  for (const repeat of repeatedValues(
    db,
    declaration,
    accepted.map((each) => each.cells),
  )) {
    refusals.push({
      index: accepted[repeat.row]?.index ?? repeat.row,
      column: repeat.column,
      reason: repeat.message,
    })
  }

  // **And the table's own word, last** (M29 F2, D-343): a batch every check
  // above accepted is written and taken back, so a write that would throw is a
  // refusal with a row and a column rather than an exception after the fact.
  if (refusals.length === 0) {
    const staged = tableRefusals(
      db,
      declaration,
      accepted.map((each) => each.cells),
      { drawn: accepted.map((each) => each.id) },
    )
    for (const refused of staged) {
      refusals.push({
        index: accepted[refused.at]?.index ?? refused.at,
        column: refused.column,
        reason: refused.reason,
      })
    }
  }

  refusals.sort((a, b) => a.index - b.index)
  return { accepted, refusals }
}

/**
 * The column `coerceRow` stopped at, found by asking each one alone — the same
 * `coerceValue` it runs, in the same order, so the first to refuse is the one
 * its sentence is about. An unknown key refuses before any column is asked, and
 * names none.
 */
function failingColumn(
  declaration: FormatDeclaration,
  row: Readonly<Record<string, unknown>>,
  units: ReturnType<typeof listUnits>,
): string | undefined {
  for (const column of declaration.columns) {
    const companion = companionKeyOf(column)
    const one = coerceValue(
      column,
      row[column.name],
      companion === undefined ? undefined : row[companion],
      units,
    )
    if (!one.ok) return column.name
  }
  return undefined
}
