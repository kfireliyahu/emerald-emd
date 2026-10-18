/**
 * **A rollup, run** (M25 E2, D-271).
 *
 * The declaration is `rollup.ts`'s and the SQL is `ddl.ts`'s; this is the
 * query, and the names of the rows a group is per. One `GROUP BY` over the
 * format's table — the fold is SQLite's and never TypeScript's, which is what
 * sixty thousand transactions need (D-267) — and one more query per rollup for
 * the labels of the linked rows the groups name.
 */

import type { Database } from 'sql.js'

import {
  labelColumn,
  ROW_ID_COLUMN,
  tableNameFor,
  type FormatDeclaration,
} from '@/domain/format/declaration.ts'
import { quoteIdentifier, rollupQuerySql, type RollupRange } from '@/domain/format/ddl.ts'
import {
  assembleRollup,
  type RollupDeclaration,
  type RollupGroup,
  type RollupQueryRow,
} from '@/domain/format/rollup.ts'
import { query } from '../db/database.ts'

export interface RollupResult {
  readonly rollup: RollupDeclaration
  readonly groups: readonly RollupGroup[]
  /** A linked row's id to what it is called, for the groups' `by`. */
  readonly labels: ReadonlyMap<string, string>
  /** The format the link points at, when there is a link — what `by` names rows of. */
  readonly target: FormatDeclaration | undefined
}

/**
 * Run one rollup of `declaration`, by name, over the months in `range`.
 *
 * `formats` is every format the document declares, for a filter's hop and the
 * link's labels. `undefined` when the format declares no rollup by that name.
 */
export function runRollup(
  db: Database,
  declaration: FormatDeclaration,
  name: string,
  formats: readonly FormatDeclaration[],
  range: RollupRange = {},
): RollupResult | undefined {
  const rollup = (declaration.rollups ?? []).find((each) => each.name === name)
  if (rollup === undefined) return undefined

  const { sql, params } = rollupQuerySql(declaration, rollup, formats, range)
  const queried: RollupQueryRow[] = query(db, sql, [...params]).map((row) => ({
    period: textOrNull(row['period']),
    by: textOrNull(row['by']),
    currency: textOrNull(row['currency']),
    figure: typeof row['figure'] === 'number' ? row['figure'] : null,
    rows: typeof row['rows'] === 'number' ? row['rows'] : 0,
    silent: typeof row['silent'] === 'number' ? row['silent'] : 0,
    silent_row: textOrNull(row['silent_row']),
  }))

  const figure = declaration.columns.find((column) => column.name === rollup.of)
  const groups = assembleRollup(rollup, declaration.name, queried, {
    money: figure?.type === 'money',
    scale: figure?.type === 'decimal' ? figure.scale : undefined,
  })

  const link = declaration.columns.find((column) => column.name === rollup.by)
  const target =
    link?.target === declaration.name ? declaration : formats.find((each) => each.name === link?.target)
  return { rollup, groups, labels: labelsOf(db, target, groups), target }
}

/** What each linked row a group names is called — its first text column (M22 U1). */
function labelsOf(
  db: Database,
  target: FormatDeclaration | undefined,
  groups: readonly RollupGroup[],
): ReadonlyMap<string, string> {
  const labels = new Map<string, string>()
  const ids = [...new Set(groups.map((group) => group.by).filter((id) => id !== undefined))]
  const label = target === undefined ? undefined : labelColumn(target)
  if (target === undefined || label === undefined || ids.length === 0) return labels
  // A few hundred at most — one group per linked row per month — so one `IN`
  // list in chunks well under SQLite's variable limit.
  for (let start = 0; start < ids.length; start += 500) {
    const chunk = ids.slice(start, start + 500)
    for (const row of query(
      db,
      `SELECT ${quoteIdentifier(ROW_ID_COLUMN)} AS id, ${quoteIdentifier(label.name)} AS label
         FROM ${quoteIdentifier(tableNameFor(target))}
        WHERE ${quoteIdentifier(ROW_ID_COLUMN)} IN (${chunk.map(() => '?').join(', ')})`,
      chunk,
    )) {
      labels.set(String(row['id']), String(row['label'] ?? row['id']))
    }
  }
  return labels
}

function textOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}
