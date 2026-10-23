/**
 * sql.js: SQLite in wasm, held in memory, saved as a real `.emd`
 * database file (D-020). The migration runner lives here too.
 *
 * The wasm binary is imported as bytes rather than fetched at runtime, which
 * is what lets this file run unchanged in a browser, in the shell, and in Node
 * — under Vitest and inside `dist-plugin/server.mjs`.
 */

import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
// Compiled into the bundle as bytes by the `fc:wasm-as-bytes` plugin, and
// handed straight to emscripten. No fetch, no second file, no network — and a
// Node build gets a database the same way a browser one does.
import wasmBinary from 'sql.js/dist/sql-wasm.wasm?bytes'

import { quoteIdentifier } from '@/domain/format/ddl.ts'

import migration001 from './migrations/001_init.sql?raw'
import migration002 from './migrations/002_categories.sql?raw'
import migration003 from './migrations/003_staged_row.sql?raw'
import migration004 from './migrations/004_printed_total.sql?raw'
import migration005 from './migrations/005_category_depth_on_update.sql?raw'
import migration006 from './migrations/006_institutions_and_onboarding.sql?raw'
import migration007 from './migrations/007_installment_group_and_original_total.sql?raw'
import migration008 from './migrations/008_category_rules.sql?raw'
import migration009 from './migrations/009_staged_row_suggested_rule.sql?raw'
import migration010 from './migrations/010_category_override.sql?raw'
import migration011 from './migrations/011_reapply.sql?raw'
import migration012 from './migrations/012_paychecks.sql?raw'
import migration013 from './migrations/013_fixed_expenses.sql?raw'
import migration014 from './migrations/014_split_plans.sql?raw'
import migration015 from './migrations/015_card_settlements.sql?raw'
import migration016 from './migrations/016_balance_check.sql?raw'
import migration017 from './migrations/017_funds.sql?raw'
import migration018 from './migrations/018_savings.sql?raw'
import migration019 from './migrations/019_deposit_origins.sql?raw'
import migration020 from './migrations/020_debts.sql?raw'
import migration021 from './migrations/021_document_templates.sql?raw'
import migration022 from './migrations/022_fund_deposits.sql?raw'
import migration023 from './migrations/023_fixed_in_split.sql?raw'
import migration024 from './migrations/024_holdings.sql?raw'
import migration025 from './migrations/025_investments.sql?raw'
import migration026 from './migrations/026_investment_templates.sql?raw'
import migration027 from './migrations/027_plan_debt_payments.sql?raw'
import migration028 from './migrations/028_security_number.sql?raw'
import migration029 from './migrations/029_trade_funding.sql?raw'
import migration030 from './migrations/030_price_precision.sql?raw'
import migration031 from './migrations/031_column_roles.sql?raw'
import migration032 from './migrations/032_formats.sql?raw'
import migration033 from './migrations/033_identities.sql?raw'
import migration034 from './migrations/034_units.sql?raw'
import migration035 from './migrations/035_links.sql?raw'
import migration036 from './migrations/036_quantities.sql?raw'
import migration037 from './migrations/037_intake.sql?raw'
import migration038 from './migrations/038_unique.sql?raw'
import migration039 from './migrations/039_scale_and_time.sql?raw'
import migration040 from './migrations/040_row_constraints.sql?raw'
import migration041 from './migrations/041_aggregate_filter.sql?raw'
import migration042 from './migrations/042_intake_header.sql?raw'
import migration043 from './migrations/043_seed.sql?raw'
import migration044 from './migrations/044_rollup.sql?raw'
import migration045 from './migrations/045_latest.sql?raw'
import migration046 from './migrations/046_rule_set.sql?raw'
import migration047 from './migrations/047_format_owner.sql?raw'
import migration048 from './migrations/048_no_ledger_tables.sql?raw'
import migration049 from './migrations/049_column_view.sql?raw'
import migration050 from './migrations/050_graph_place.sql?raw'
import migration051 from './migrations/051_reader.sql?raw'
import migration052 from './migrations/052_view_column.sql?raw'
import migration053 from './migrations/053_links.sql?raw'
import migration054 from './migrations/054_percent.sql?raw'
import migration055 from './migrations/055_derived.sql?raw'
import migration056 from './migrations/056_time.sql?raw'
import migration057 from './migrations/057_document_setting.sql?raw'
import migration058 from './migrations/058_found_by.sql?raw'
import migration059 from './migrations/059_enums.sql?raw'
import migration060 from './migrations/060_source_key.sql?raw'
import migration061 from './migrations/061_elsewhere.sql?raw'
import migration062 from './migrations/062_file.sql?raw'
import migration063 from './migrations/063_saved_view.sql?raw'
import migration064 from './migrations/064_dashboard_block.sql?raw'
import migration065 from './migrations/065_dashboard_block_size.sql?raw'

/**
 * Numbered, additive, immutable after release. `schema_version` records the
 * highest applied number; a file written by a newer build must refuse to open
 * in an older one rather than corrupt itself.
 */
const MIGRATIONS: readonly { readonly version: number; readonly sql: string }[] = [
  { version: 1, sql: migration001 },
  { version: 2, sql: migration002 },
  { version: 3, sql: migration003 },
  { version: 4, sql: migration004 },
  { version: 5, sql: migration005 },
  { version: 6, sql: migration006 },
  { version: 7, sql: migration007 },
  { version: 8, sql: migration008 },
  { version: 9, sql: migration009 },
  { version: 10, sql: migration010 },
  { version: 11, sql: migration011 },
  { version: 12, sql: migration012 },
  { version: 13, sql: migration013 },
  { version: 14, sql: migration014 },
  { version: 15, sql: migration015 },
  { version: 16, sql: migration016 },
  { version: 17, sql: migration017 },
  { version: 18, sql: migration018 },
  { version: 19, sql: migration019 },
  { version: 20, sql: migration020 },
  { version: 21, sql: migration021 },
  { version: 22, sql: migration022 },
  { version: 23, sql: migration023 },
  { version: 24, sql: migration024 },
  { version: 25, sql: migration025 },
  { version: 26, sql: migration026 },
  { version: 27, sql: migration027 },
  { version: 28, sql: migration028 },
  { version: 29, sql: migration029 },
  { version: 30, sql: migration030 },
  { version: 31, sql: migration031 },
  { version: 32, sql: migration032 },
  { version: 33, sql: migration033 },
  { version: 34, sql: migration034 },
  { version: 35, sql: migration035 },
  { version: 36, sql: migration036 },
  { version: 37, sql: migration037 },
  { version: 38, sql: migration038 },
  { version: 39, sql: migration039 },
  { version: 40, sql: migration040 },
  { version: 41, sql: migration041 },
  { version: 42, sql: migration042 },
  { version: 43, sql: migration043 },
  { version: 44, sql: migration044 },
  { version: 45, sql: migration045 },
  { version: 46, sql: migration046 },
  { version: 47, sql: migration047 },
  { version: 48, sql: migration048 },
  { version: 49, sql: migration049 },
  { version: 50, sql: migration050 },
  { version: 51, sql: migration051 },
  { version: 52, sql: migration052 },
  { version: 53, sql: migration053 },
  { version: 54, sql: migration054 },
  { version: 55, sql: migration055 },
  { version: 56, sql: migration056 },
  { version: 57, sql: migration057 },
  { version: 58, sql: migration058 },
  { version: 59, sql: migration059 },
  { version: 60, sql: migration060 },
  { version: 61, sql: migration061 },
  { version: 62, sql: migration062 },
  { version: 63, sql: migration063 },
  { version: 64, sql: migration064 },
  { version: 65, sql: migration065 },
]

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0

let runtime: SqlJsStatic | undefined

async function sqlJs(): Promise<SqlJsStatic> {
  // Emscripten declares `wasmBinary` as an ArrayBuffer. The plugin hands over a
  // Uint8Array that owns its buffer exactly, so unwrapping it is safe.
  runtime ??= await initSqlJs({ wasmBinary: wasmBinary.buffer as ArrayBuffer })
  return runtime
}

export class SchemaTooNewError extends Error {
  constructor(
    readonly fileVersion: number,
    readonly appVersion: number,
  ) {
    super(
      `This file was saved by a newer version of the app (schema ${fileVersion}; this build understands ${appVersion}). ` +
        'Update the app rather than opening it here — opening it would corrupt it.',
    )
    this.name = 'SchemaTooNewError'
  }
}

/**
 * A brand-new empty database, migrated to the current schema.
 *
 * `targetVersion` stops part-way. That exists so migrations can be tested the
 * only way that proves anything — build a file at the old schema, put real rows
 * in it, then open it with the new build and check nothing was lost.
 */
export async function createDatabase(targetVersion: number = SCHEMA_VERSION): Promise<Database> {
  const SQL = await sqlJs()
  const db = new SQL.Database()
  migrate(db, targetVersion)
  return db
}

/** Open an existing `.emd` file. Throws `SchemaTooNewError` if it is from the future. */
export async function openDatabase(bytes: Uint8Array): Promise<Database> {
  const db = await openDatabaseWithoutMigrating(bytes)
  migrate(db)
  return db
}

/**
 * The same file, opened and left exactly as it was found.
 *
 * The long name is the whole point of the function. `openDatabase` migrates
 * upward unconditionally, which is right inside the app — there the code that
 * migrates is the code that renders, so a document is only ever upgraded by the
 * build that is about to show it. Outside the app that is destructive: the
 * Claude plugin (docs/f14 trap 1) answers read-only questions, and a plugin one
 * schema ahead of the user's app would rewrite `schema_version` to answer one
 * and leave that app correctly refusing to open its owner's own document with
 * `SchemaTooNewError`. **Migration stays the app's job, exclusively**, so
 * anything that is not the app opens a document through here and stops if the
 * version does not match.
 */
export async function openDatabaseWithoutMigrating(bytes: Uint8Array): Promise<Database> {
  const SQL = await sqlJs()
  return new SQL.Database(bytes)
}

export function exportDatabase(db: Database): Uint8Array {
  return db.export()
}

/**
 * SQLite's own read-only switch, for a caller that must not write.
 *
 * `PRAGMA query_only` is enforced by the engine: every write fails with
 * "attempt to write a readonly database", including one that arrives through a
 * repository function or through SQL somebody typed into a conversation. That
 * is worth a great deal more than a caller promising to be careful, and it is
 * why the Claude plugin opens every document with it on (D-094) — reading is
 * the default there, and turning it off will have to be a visible line in a
 * diff rather than the absence of one.
 *
 * Reversible on purpose. It is a mode, not a property of the file, and the
 * plugin's mutating tools will need to leave it.
 */
export function setQueryOnly(db: Database, queryOnly: boolean): void {
  db.run(`PRAGMA query_only = ${queryOnly ? 1 : 0}`)
}

/**
 * The schema version a database records, without changing it.
 *
 * Read-only on purpose, and that is the only reason this is a function rather
 * than two lines inside `migrate`. `migrate` creates `schema_version` when it is
 * missing, because it is about to write to it; every other caller has to be
 * able to ask the question without altering the answer — a plugin deciding
 * whether it may read someone's document must not leave a table behind in it.
 * A database with no `schema_version` table reads as 0: either not a Financial
 * Companion document at all, or one from before migrations existed.
 */
export function readSchemaVersion(db: Database): number {
  const present = db.exec(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'",
  )
  if (present.length === 0) return 0
  const rows = db.exec('SELECT MAX(version) AS version FROM schema_version')
  const value = rows[0]?.values[0]?.[0]
  return typeof value === 'number' ? value : 0
}

/**
 * Runs every migration above the file's version, in order, inside one
 * transaction. A failure part-way leaves the file exactly as it was.
 */
export function migrate(db: Database, targetVersion: number = SCHEMA_VERSION): void {
  db.run('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
  const from = readSchemaVersion(db)
  if (from > SCHEMA_VERSION) throw new SchemaTooNewError(from, SCHEMA_VERSION)
  if (from >= targetVersion) return

  db.run('BEGIN')
  try {
    // A derived view (D-334) names declared tables and the units table, and a
    // migration that rebuilds a table SQLite renames would fail on a view it
    // cannot resolve. The views are the reconciler's to rebuild on open.
    for (const row of db.exec(
      "SELECT name FROM sqlite_master WHERE type = 'view' AND name LIKE 'fmt!_%' ESCAPE '!'",
    )[0]?.values ?? []) {
      db.run(`DROP VIEW IF EXISTS ${quoteIdentifier(String(row[0]))}`)
    }
    for (const migration of MIGRATIONS) {
      if (migration.version <= from || migration.version > targetVersion) continue
      db.run(migration.sql)
      db.run('INSERT INTO schema_version (version) VALUES (?)', [migration.version])
    }
    db.run('COMMIT')
  } catch (error) {
    db.run('ROLLBACK')
    throw error
  }
}

/**
 * How deep the nesting is, per database.
 *
 * A `WeakMap` rather than a module-level counter because the test suite holds
 * several databases open at once, and a shared counter would have one of them
 * deciding another was already inside a transaction.
 */
const transactionDepth = new WeakMap<Database, number>()

/**
 * Run `work` in a transaction, rolling back if it throws.
 *
 * Committing an import goes through here: docs/f01 step 14 is one database
 * transaction, so a failure half-way cannot leave half a statement imported.
 *
 * **Nesting is safe**, via savepoints. SQLite refuses `BEGIN` inside a
 * transaction, so the outermost call opens a real one and every call inside it
 * takes a savepoint instead — the inner block still rolls back on its own
 * without taking the outer one down, and the whole thing still commits or
 * rolls back as a unit.
 *
 * That mattered the moment a second caller composed two operations that each
 * already used this (D-099): the plugin's `create_rule` writes a rule and then
 * runs the app's own `commitReapply`, both of which open transactions, and it
 * wants the pair to be atomic. The hazard was latent in the app too — anything
 * calling `correctCategories` from inside a `mutate` block would have hit it —
 * so this is a fix rather than an accommodation.
 */
export function inTransaction<T>(db: Database, work: () => T): T {
  const depth = transactionDepth.get(db) ?? 0
  const savepoint = `fc_savepoint_${depth}`
  const nested = depth > 0

  db.run(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN')
  transactionDepth.set(db, depth + 1)

  try {
    const result = work()
    db.run(nested ? `RELEASE ${savepoint}` : 'COMMIT')
    return result
  } catch (error) {
    // `ROLLBACK TO` rewinds to the savepoint but keeps it, so it has to be
    // released as well or the name accumulates on the transaction stack.
    if (nested) {
      db.run(`ROLLBACK TO ${savepoint}`)
      db.run(`RELEASE ${savepoint}`)
    } else {
      db.run('ROLLBACK')
    }
    throw error
  } finally {
    transactionDepth.set(db, depth)
  }
}

/** Thrown inside `rehearse` to roll its transaction back; never seen outside it. */
const REHEARSED = Symbol('rehearsed')

/**
 * **Run `work` for real and take every write back** — M34 U2 (D-395).
 *
 * A batch whose second file links to rows its first file writes can only be
 * judged by writing the first: a stand-in for "the row that will exist" is a
 * second copy of what a write does, and it would drift from the real one. So a
 * plan of several steps runs them, in order, inside a transaction that is
 * always rolled back, and what it answers is exactly what the commit will do.
 *
 * A dry run's document is opened `query_only` so a plan that writes fails
 * loudly (D-094); this is the one deliberate exception, and it is scoped: the
 * pragma is lifted for the rehearsal and put back after it, and **the document
 * the plugin opens for a dry run is never saved**, so nothing reaches the disk
 * whatever happens here.
 */
export function rehearse<T>(db: Database, work: () => T): T {
  const queryOnly = query(db, 'PRAGMA query_only')[0]?.['query_only'] === 1
  if (queryOnly) setQueryOnly(db, false)
  let answer: { readonly value: T } | undefined
  try {
    inTransaction(db, () => {
      answer = { value: work() }
      throw REHEARSED
    })
  } catch (error) {
    if (error !== REHEARSED) throw error
  } finally {
    if (queryOnly) setQueryOnly(db, true)
  }
  if (answer === undefined) throw new Error('A rehearsal ended without an answer.')
  return answer.value
}

/** A `SELECT` as plain objects. sql.js's own shape is columns-plus-value-arrays. */
export function query(
  db: Database,
  sql: string,
  params: readonly (string | number | null)[] = [],
): readonly Record<string, unknown>[] {
  const statement = db.prepare(sql)
  try {
    statement.bind(params as (string | number | null)[])
    const rows: Record<string, unknown>[] = []
    while (statement.step()) rows.push(statement.getAsObject())
    return rows
  } finally {
    statement.free()
  }
}
