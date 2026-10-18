/**
 * **A format's derived columns, read** — M29 U3b, D-334.
 *
 * The figures come out of SQL: the same `SELECT` the format's view is made of,
 * compiled by `derived.ts` from the parsed expression, run over the rows asked
 * for. It is run here rather than read from the view so a document the
 * reconciler has not opened yet — a text `.emd` the plugin rebuilt a moment
 * ago — answers the same as one it has.
 *
 * An empty cell is given its reason by the TypeScript evaluator over the same
 * row, which names the input that is empty: the view says *nothing*, and the
 * screen says *why*.
 */

import type { Database } from 'sql.js'

import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import { evaluateDerived, type CompiledDerived, type DerivedValue } from '@/domain/format/derived.ts'
import type { StoredRow } from '@/domain/format/row.ts'
import { SEEDED_UNITS, type UnitTable } from '@/domain/format/unit.ts'

import {
  derivedCellOf,
  derivedFiguresOf,
  inputsWithAggregates,
  type FormatIndex,
} from './formatJoinRepository.ts'

/** One derived column's figure on one row. */
export interface RowDerived {
  readonly compiled: CompiledDerived
  readonly value: DerivedValue
}

/**
 * The derived figures of these rows, by row id, in declaration order.
 *
 * Empty when the format declares none. A cell SQL left empty carries the
 * sentence saying which input is missing, worked out only for those cells.
 */
export function derivedOf(
  db: Database,
  declaration: FormatDeclaration,
  rows: readonly StoredRow[],
  formats: FormatIndex,
  units: UnitTable = SEEDED_UNITS,
  /**
   * The asking runtime's day, `YYYY-MM-DD` — the app's `ui/today.ts` or the
   * plugin's — for a column that reads `today` (M49 U2, D-472). Without it
   * such a column is empty, saying so.
   */
  today?: string,
): ReadonlyMap<string, readonly RowDerived[]> {
  const out = new Map<string, readonly RowDerived[]>()
  if ((declaration.derived ?? []).length === 0 || rows.length === 0) return out
  // The SQL half lives beside the join (M29 F7): a total over this format
  // reads the same figures, so the two can never disagree about a row.
  const { compiled, figures } = derivedFiguresOf(db, declaration, rows, formats, units, today)

  for (const row of rows) {
    const found = figures.get(row.id)
    let inputs: ReturnType<typeof inputsWithAggregates> | undefined
    const values = compiled.map((each): RowDerived => {
      const value = derivedCellOf(each, found)
      if (value !== undefined) return { compiled: each, value }
      if (each.clock && today === undefined) {
        return { compiled: each, value: { kind: 'EMPTY', reason: 'It reads today, and nothing here said what day it is.' } }
      }
      inputs ??= inputsWithAggregates(db, declaration, row, formats, units)
      const worked = evaluateDerived(each, inputs, units, today)
      return {
        compiled: each,
        value:
          worked.kind === 'EMPTY'
            ? worked
            : // SQL said nothing and TypeScript has a figure: two currencies
              // met on this row.
              { kind: 'EMPTY', reason: 'Two currencies meet here, and nothing knows a rate between them.' },
      }
    })
    out.set(row.id, values)
  }
  return out
}

