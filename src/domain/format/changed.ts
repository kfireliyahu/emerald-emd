/**
 * **When each format last changed** (M47 U5, D-462).
 *
 * site.emd's `copy_slot` and `asset` were declared by a session nobody had
 * asked, never read again, and went stale — their keys outlived a rename and a
 * unit was marked built over thirty placeholder rows — and nothing said so,
 * because a document knew how many rows a format had and never when anybody
 * last touched one. So each format carries one mark: the last moment a row of
 * it was added, changed or removed, or its declaration changed.
 *
 * **One mark per format, in the column the format already had.** `format`
 * has carried `updated_at` since schema 32, written when a declaration was
 * saved and read by nothing; it is the mark now, so there is no migration and
 * no document lags behind for it. A per-row timestamp was the rejected
 * alternative: an engine column on every table that a person never declared.
 *
 * **Written by every write, by SQLite rather than by the callers.** Rows of a
 * declared table are written by the engine's repositories and by thirty of the
 * ledger's, half of them in raw SQL, so a mark a caller had to remember would be
 * a mark somebody forgot. Each declared table — and each member table of a
 * `links` or `enums` column, whose rows are the format's too — gets three
 * `AFTER` triggers that set the mark to the moment of the write. They name no
 * column of the table, so no reconcile step has to take them down; a table the
 * reconciler rebuilds loses them with the old table, and they are put back
 * after every reconcile and adopt, and on every open the plugin makes.
 *
 * Named `<table>__changed__<event>`, which no constraint trigger
 * (`<table>__check_…`) and no member table can be.
 */

import { quoteIdentifier, quoteLiteral } from './ddl.ts'
import { isListType, memberTableNameFor, tableNameFor, type FormatDeclaration } from './declaration.ts'

const EVENTS = ['insert', 'update', 'delete'] as const

/** What marks a format's change triggers, after the table's name. */
export const CHANGED_TRIGGER_MARKER = '__changed__'

/**
 * Now, in epoch milliseconds, as SQLite reads its own clock — the unit
 * `format.updated_at` has always been in.
 */
const NOW_MS_SQL = "CAST(ROUND((julianday('now') - 2440587.5) * 86400000) AS INTEGER)"

/** One trigger: its name, the table it is on, and the statement that makes it. */
export interface ChangeTrigger {
  readonly name: string
  readonly table: string
  readonly sql: string
}

/** Every table a format's rows live in: its own, and one per `links` or `enums` column. */
function tablesOf(declaration: FormatDeclaration): readonly string[] {
  return [
    tableNameFor(declaration),
    ...declaration.columns.filter((column) => isListType(column.type)).map((column) => memberTableNameFor(declaration, column)),
  ]
}

/** The triggers that keep `declaration`'s mark — three per table its rows live in. */
export function changeTriggersFor(declaration: FormatDeclaration): readonly ChangeTrigger[] {
  return tablesOf(declaration).flatMap((table) =>
    EVENTS.map((event) => {
      const name = `${table}${CHANGED_TRIGGER_MARKER}${event}`
      return {
        name,
        table,
        sql:
          `CREATE TRIGGER ${quoteIdentifier(name)} AFTER ${event.toUpperCase()} ON ${quoteIdentifier(table)} ` +
          `FOR EACH ROW BEGIN UPDATE format SET updated_at = ${NOW_MS_SQL} ` +
          `WHERE name = ${quoteLiteral(declaration.name)}; END`,
      }
    }),
  )
}

/** Whether a trigger's name is one of the marks' — so a stale one can be found and dropped. */
export function isChangeTrigger(name: string): boolean {
  return /__changed__(insert|update|delete)$/.test(name)
}
