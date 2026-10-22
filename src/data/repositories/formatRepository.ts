/**
 * The declarations as the document holds them, and the reconciliation that makes
 * its tables match them — `Format` in docs/04-data-model.md, migration 032,
 * D-216.
 *
 * **The declarations are the source of truth. The tables follow.** That is the
 * whole inversion D-214 made: a document that describes itself does not need
 * this build to have shipped its tables, so there is no migration chain to
 * accumulate — `reconcileFormats` is idempotent and runs on every open.
 *
 * Decoding is defensive, as everywhere else here: a `.emd` is a real SQLite
 * database the user can open in any tool, and a row that no longer makes sense
 * is skipped rather than thrown. A format written in a declaration language from
 * the future is skipped *loudly* — `unreadableFormats` is what the screen shows
 * — because silently ignoring it would let this build reconcile a table it does
 * not understand the declaration for.
 */

import type { Database } from 'sql.js'

import {
  aggregate,
  AGGREGATE_KINDS,
  filterPredicate,
  parseFilter,
  type AggregateDeclaration,
  type AggregateFilter,
  type AggregateKind,
} from '@/domain/format/aggregate.ts'
import {
  DECLARATION_LANGUAGE,
  isListType,
  memberTableNameFor,
  storedColumnsOf,
  tableNameFor,
  type ColumnDeclaration,
  type ColumnType,
  type FormatDeclaration,
  COLUMN_TYPES,
  TABLE_PREFIX,
} from '@/domain/format/declaration.ts'
import {
  constraintKey,
  constraintText,
  parseConstraint,
  type RowConstraint,
} from '@/domain/format/constraint.ts'
import { parseRollup, rollupText, type RollupDeclaration } from '@/domain/format/rollup.ts'
import { parseRuleSet, ruleSetText, type RuleSetDeclaration } from '@/domain/format/rule.ts'
import { foundByText, parseFoundBy } from '@/domain/format/foundBy.ts'
import { checkTriggerPrefix, constraintConditionSql, dropMemberTableSql, quoteIdentifier } from '@/domain/format/ddl.ts'
import { identity, type IdentityDeclaration } from '@/domain/format/identity.ts'
import { createDerivedViewSql, derived, derivedViewNameFor, type DerivedDeclaration } from '@/domain/format/derived.ts'
import { changeTriggersFor, isChangeTrigger } from '@/domain/format/changed.ts'
import {
  planIsApplicable,
  planReconcile,
  type ObservedColumn,
  type ObservedTable,
  type ReconcilePlan,
} from '@/domain/format/reconcile.ts'
import { inTransaction, query } from '../db/database.ts'

/**
 * A stored filter read back: the column, and what follows `is` (M36 U04). A
 * cell that does not read as one — written by hand, or by nothing this build
 * knows — is D-260's one member, as every stored filter before 19 was.
 */
function storedFilter(column: string, predicate: string): AggregateFilter {
  const parsed = parseFilter(`${column} is ${predicate}`)
  return 'problem' in parsed ? { column, is: predicate } : parsed
}
import { forgetIntakes } from './formatIntakeRepository.ts'
import { forgetSeeds } from './formatSeedRepository.ts'
import {
  forgetColumnWidths,
  forgetDashboardBlocks,
  forgetGraphPlace,
  forgetSavedViews,
  forgetViewSettings,
} from './formatViewRepository.ts'

/** Every declaration in the document, in the order they were created. */
export function listFormats(db: Database): readonly FormatDeclaration[] {
  return readFormats(db).readable
}

/** One declaration by name, or nothing. */
export function readFormat(db: Database, name: string): FormatDeclaration | undefined {
  return readFormats(db, name).readable[0]
}

/**
 * The formats this build cannot read, with the reason.
 *
 * Almost always one reason: a declaration language newer than
 * `DECLARATION_LANGUAGE`. Surfaced rather than swallowed — see the head of this
 * file.
 */
export function unreadableFormats(
  db: Database,
): readonly { readonly name: string; readonly reason: string }[] {
  return readFormats(db).unreadable
}

/**
 * Write a declaration, replacing whatever the document had under that name.
 *
 * **This does not touch the table.** Storing a declaration and making the table
 * match it are two steps on purpose: between them sits the plan, which is the
 * thing a person is shown and the thing that can refuse. `adoptFormat` is the
 * pair, and it is what every caller should use.
 */
export function saveFormat(db: Database, declaration: FormatDeclaration, now: number): void {
  inTransaction(db, () => {
    const existing = query(db, 'SELECT created_at FROM format WHERE name = ?', [declaration.name])
    const createdAt = numberOr(existing[0]?.['created_at'], now)

    db.run('DELETE FROM format_column_value WHERE format_name = ?', [declaration.name])
    db.run('DELETE FROM format_column WHERE format_name = ?', [declaration.name])
    db.run('DELETE FROM format_identity WHERE format_name = ?', [declaration.name])
    db.run('DELETE FROM format_aggregate WHERE format_name = ?', [declaration.name])
    db.run('DELETE FROM format_constraint WHERE format_name = ?', [declaration.name])
    db.run('DELETE FROM format_rollup WHERE format_name = ?', [declaration.name])
    db.run('DELETE FROM format_rule_set WHERE format_name = ?', [declaration.name])
    db.run('DELETE FROM format_derived WHERE format_name = ?', [declaration.name])
    db.run('DELETE FROM format WHERE name = ?', [declaration.name])

    db.run(
      `INSERT INTO format (name, title, language, notes, nothing_must_hold, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        declaration.name,
        declaration.title,
        declaration.language,
        declaration.notes,
        declaration.nothingMustHold ? 1 : 0,
        createdAt,
        now,
      ],
    )
    // Which pack owns it (D-269).
    if (declaration.owner !== undefined) {
      db.run('UPDATE format SET pack = ?, pack_written = ?, pack_columns = ? WHERE name = ?', [
        declaration.owner.pack,
        declaration.owner.written,
        declaration.owner.columns.join(','),
        declaration.name,
      ])
    }

    // **The identities are stored and nothing else happens.** No DDL, no plan,
    // no refusal: an identity compiles to no SQL at all, so changing one can
    // lose nothing and the reconciler has never heard of it (D-222).
    declaration.identities.forEach((identity, position) => {
      db.run(
        `INSERT INTO format_identity
           (format_name, name, expression, tolerance_kind, tolerance_amount, note, position)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          declaration.name,
          identity.name,
          identity.expression,
          identity.tolerance.kind,
          identity.tolerance.kind === 'ABSOLUTE'
            ? identity.tolerance.amount
            : identity.tolerance.percent,
          identity.note,
          position,
        ],
      )
    })

    // Folded on read and never stored, exactly as an identity is — so this is a
    // row and nothing else happens, no DDL and no plan (U4b, D-224).
    // A filter (U8, D-260) and the order a latest picks by (M25 E3, D-272).
    declaration.aggregates.forEach((each, position) => {
      db.run(
        `INSERT INTO format_aggregate
           (format_name, name, kind, over_format, over_column, expression, unit, note, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          declaration.name,
          each.name,
          each.kind,
          each.over.format,
          // Every row of the source is the empty column (M34 U4, D-397): the
          // column is NOT NULL, and no link is ever called nothing.
          each.over.column ?? '',
          each.expression,
          each.unit ?? null,
          each.note,
          position,
        ],
      )
      if (each.where !== undefined) {
        db.run(
          'UPDATE format_aggregate SET where_column = ?, where_member = ? WHERE format_name = ? AND name = ?',
          // What follows `is` — `true`, `not TRANSFER`, `one of TAX, HEALTH`,
          // `empty` — so D-260's one member reads back as it always did (M36 U04).
          [each.where.column, filterPredicate(each.where), declaration.name, each.name],
        )
      }
      if (each.by !== undefined) {
        db.run(
          'UPDATE format_aggregate SET by_column = ? WHERE format_name = ? AND name = ?',
          [each.by, declaration.name, each.name],
        )
      }
    })

    // Stored as its sentence and read back through the parser (D-259).
    ;(declaration.constraints ?? []).forEach((each, position) => {
      db.run(
        'INSERT INTO format_constraint (format_name, rule, note, position) VALUES (?, ?, ?, ?)',
        [declaration.name, constraintText(each), each.note, position],
      )
    })

    // Its sentence, parsed on read, exactly as a constraint is (D-271).
    ;(declaration.rollups ?? []).forEach((each, position) => {
      db.run(
        'INSERT INTO format_rollup (format_name, name, works_out, note, position) VALUES (?, ?, ?, ?, ?)',
        [declaration.name, each.name, rollupText(each), each.note, position],
      )
    })

    // Its sentence again (D-273).
    ;(declaration.ruleSets ?? []).forEach((each, position) => {
      db.run(
        'INSERT INTO format_rule_set (format_name, name, sets, note, position) VALUES (?, ?, ?, ?, ?)',
        [declaration.name, each.name, ruleSetText(each), each.note, position],
      )
    })

    // Its expression as typed, parsed on every read (D-334).
    ;(declaration.derived ?? []).forEach((each, position) => {
      db.run(
        'INSERT INTO format_derived (format_name, name, expression, note, position) VALUES (?, ?, ?, ?, ?)',
        [declaration.name, each.name, each.expression, each.note, position],
      )
    })

    declaration.columns.forEach((column, position) => {
      db.run(
        `INSERT INTO format_column
           (format_name, name, type, unit, per, required, is_unique, scale, found_by, minimum, maximum, target, note, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          declaration.name,
          column.name,
          column.type,
          column.unit ?? null,
          column.per ?? null,
          column.required ? 1 : 0,
          column.unique ? 1 : 0,
          column.scale ?? null,
          column.foundBy === undefined ? null : foundByText(column.foundBy),
          column.minimum ?? null,
          column.maximum ?? null,
          column.target ?? null,
          column.note,
          position,
        ],
      )
      column.values.forEach((value, index) => {
        db.run(
          `INSERT INTO format_column_value (format_name, column_name, value, position)
           VALUES (?, ?, ?, ?)`,
          [declaration.name, column.name, value, index],
        )
      })
    })
  })
}

/**
 * What adopting `declaration` would do to this document, without doing it.
 *
 * **The dry run is the product here, not a nicety.** Every write surface in this
 * app shows what it will do before it does it (D-140, D-199), and a declaration
 * is the one write that can quietly change what every figure in a table *means*.
 */
export function planFor(
  db: Database,
  declaration: FormatDeclaration,
  renames: ReadonlyMap<string, string> = new Map(),
  /** Columns the owning pack vouches may be rebuilt over what they hold (M36 U09). */
  vouched: ReadonlySet<string> = new Set(),
): ReconcilePlan {
  return planReconcile(declaration, readFormat(db, declaration.name), observe(db, declaration, renames), renames, vouched)
}

/**
 * Store a declaration and make the table match it, as one transaction.
 *
 * Refuses as a unit: a plan carrying a refusal writes nothing at all, not even
 * the steps beside it. Half a format is worse than none — the declaration would
 * then describe a table the document does not have, and the next open would
 * reconcile toward it without anybody having agreed to that.
 */
export function adoptFormat(
  db: Database,
  declaration: FormatDeclaration,
  now: number,
  /** New name to old, for a column renamed rather than replaced (M26 U3). */
  renames: ReadonlyMap<string, string> = new Map(),
  /**
   * Columns the pack owning `declaration` vouches may be rebuilt over what they
   * hold — dropped with data, or an enum re-listed (M36 U09). Only a pack's
   * install passes any, and the reconciler ignores them on a person's format.
   */
  vouched: ReadonlySet<string> = new Set(),
): ReconcilePlan {
  const before = renames.size === 0 ? undefined : readFormat(db, declaration.name)
  const plan = planFor(db, declaration, renames, vouched)
  if (plan.refusals.length > 0) return plan

  inTransaction(db, () => {
    dropDerivedViews(db)
    apply(db, plan)
    saveFormat(db, declaration, now)
    if (before !== undefined) followRenames(db, before, plan)
    buildDerivedViews(db)
    keepChangeMarks(db)
  })
  return plan
}

/**
 * **What else knew a renamed column by its name** (M26 U3): its width on the
 * sheet, its input on the entry page (U6), and the keys an earlier reading of
 * a file filled, so the record of which file column wrote it still names a
 * column the format has.
 */
function followRenames(db: Database, before: FormatDeclaration, plan: ReconcilePlan): void {
  for (const step of plan.steps) {
    if (step.kind !== 'RENAME_COLUMN') continue
    const was = before.columns.find((column) => column.name === step.from)
    if (was === undefined) continue
    db.run(
      'UPDATE OR REPLACE format_column_view SET column_name = ? WHERE format_name = ? AND column_name = ?',
      [step.column, before.name, step.from],
    )
    // And its input on the entry page (M26 U6).
    db.run(
      'UPDATE OR REPLACE format_view_column SET column_name = ? WHERE format_name = ? AND column_name = ?',
      [step.column, before.name, step.from],
    )
    const olds = storedColumnsOf(was)
    const news = storedColumnsOf({ ...was, name: step.column })
    olds.forEach((old, index) => {
      const now = news[index]
      if (now === undefined) return
      db.run(
        `UPDATE OR REPLACE format_intake_column SET key_name = ?
           WHERE key_name = ? AND intake_id IN (SELECT id FROM format_intake WHERE format_name = ?)`,
        [now, old, before.name],
      )
    })
  }
}

/**
 * Make every table match its declaration. Called on open; safe to call again.
 *
 * Returns the plans it could not carry out, which is what the formats screen
 * shows. **A refusal never stops the document opening** — the table is left as
 * it is, the declaration is left as it is, and a person is asked. A reconciler
 * that threw would make a document unopenable by disagreeing with itself.
 */
export function reconcileFormats(db: Database): readonly ReconcilePlan[] {

  const refused: ReconcilePlan[] = []
  dropDerivedViews(db)
  for (const declaration of listFormats(db)) {
    // On open the stored declaration is both sides of the comparison: nothing is
    // being adopted, so only the table can disagree.
    const plan = planReconcile(declaration, declaration, observe(db, declaration))
    if (plan.refusals.length > 0) {
      refused.push(plan)
      continue
    }
    if (planIsApplicable(plan)) inTransaction(db, () => apply(db, plan))
  }
  buildDerivedViews(db)
  keepChangeMarks(db)
  return refused
}

/**
 * The plans that are not settled, without applying any of them.
 *
 * What the formats screen draws. `reconcileFormats` writes and is therefore the
 * open path's business; a screen has to be able to ask the same question during
 * a render without the answer being a mutation.
 */
export function pendingPlans(db: Database): readonly ReconcilePlan[] {
  return listFormats(db)
    .map((declaration) => planReconcile(declaration, declaration, observe(db, declaration)))
    .filter((plan) => plan.steps.length > 0 || plan.refusals.length > 0)
}

/** Forget a declaration and drop its table. The caller has already asked. */
/**
 * Every format whose link column points at this one (U4b, D-224).
 *
 * **Nothing is auto-deleted and nothing cascades**, so this is what a delete has
 * to be checked against: dropping `ingredient` while `recipe_line.ingredient`
 * names its rows leaves a column full of ids that resolve to nothing and an
 * aggregate that folds to `unchecked` forever. The refusal names the formats,
 * because the fix is to edit them and the person needs to know which.
 */
export function formatsPointingAt(db: Database, name: string): readonly string[] {
  return listFormats(db)
    .filter(
      (declaration) =>
        declaration.name !== name &&
        (declaration.columns.some((column) => column.type === 'link' && column.target === name) ||
          declaration.aggregates.some((each) => each.over.format === name) ||
          // A rule set over a deleted format would set nothing forever (D-273).
          (declaration.ruleSets ?? []).some((each) => each.target === name)),
    )
    .map((declaration) => declaration.name)
}

export function deleteFormat(db: Database, name: string): void {
  const declaration = readFormat(db, name)
  inTransaction(db, () => {
    dropDerivedViews(db)
    if (declaration !== undefined) {
      db.run(`DROP TABLE IF EXISTS ${quoteIdentifier(tableNameFor(declaration))}`)
      for (const column of declaration.columns) {
        if (isListType(column.type)) db.run(dropMemberTableSql(declaration, column))
      }
    }
    db.run('DELETE FROM format_column_value WHERE format_name = ?', [name])
    db.run('DELETE FROM format_column WHERE format_name = ?', [name])
    db.run('DELETE FROM format_identity WHERE format_name = ?', [name])
    db.run('DELETE FROM format_aggregate WHERE format_name = ?', [name])
    db.run('DELETE FROM format_constraint WHERE format_name = ?', [name])
    db.run('DELETE FROM format_rollup WHERE format_name = ?', [name])
    db.run('DELETE FROM format_rule_set WHERE format_name = ?', [name])
    db.run('DELETE FROM format_derived WHERE format_name = ?', [name])
    // The record of which file wrote which rows goes with the rows (U5, D-226).
    // There is no foreign key to do it — this app never runs
    // `PRAGMA foreign_keys = ON` (D-067) — so what would be left is provenance
    // pointing at ids in a table that no longer exists.
    forgetIntakes(db, name)
    forgetSeeds(db, name)
    forgetColumnWidths(db, name)
    forgetGraphPlace(db, name)
    forgetViewSettings(db, name)
    forgetSavedViews(db, name)
    forgetDashboardBlocks(db, name)
    db.run('DELETE FROM format WHERE name = ?', [name])
    buildDerivedViews(db)
  })
}

/** How many rows a declared format holds. */
export function rowCountOf(db: Database, declaration: FormatDeclaration): number {
  const observed = observe(db, declaration)
  return observed?.rowCount ?? 0
}

/**
 * The table as SQLite actually has it, or nothing if it is not there.
 *
 * **The counts come back in one query rather than one per column.**
 * `COUNT(column)` counts non-nulls, and every refusal in the reconciler turns on
 * whether a column holds anything — so a twenty-five column format would
 * otherwise cost twenty-five statements on every open, for a question that is
 * one `SELECT`.
 */
export function observe(
  db: Database,
  declaration: FormatDeclaration,
  /** New name to old, so a column renamed in the same change is read where it still is. */
  renames: ReadonlyMap<string, string> = new Map(),
): ObservedTable | undefined {
  const table = tableNameFor(declaration)
  const exists = db.exec("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", [table])
  if (exists.length === 0) return undefined
  // What every column was made or added with, verbatim (M29 F2, D-343).
  const made = exists[0]?.values[0]?.[0]
  const sql = typeof made === 'string' ? made : undefined

  const info = query(db, `PRAGMA table_info(${quoteIdentifier(table)})`)
  const names = info.map((row) => String(row['name'] ?? '')).filter((name) => name !== '')
  if (names.length === 0) return undefined

  const counts = query(
    db,
    `SELECT COUNT(*) AS rows, ${names
      .map(
        (name, index) =>
          `COUNT(${quoteIdentifier(name)}) AS c${index}, COUNT(DISTINCT ${quoteIdentifier(name)}) AS d${index}`,
      )
      .join(', ')} FROM ${quoteIdentifier(table)}`,
  )[0]

  // The reconciler's own indexes, found by the name it gives them (D-255).
  // Nobody else's index is read as a declared constraint.
  const unique = new Set(
    query(db, "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?", [table])
      .map((row) => String(row['name'] ?? ''))
      .filter((name) => name.startsWith(`${table}__`) && name.endsWith('__unique'))
      .map((name) => name.slice(table.length + 2, -'__unique'.length)),
  )

  // The constraints' triggers, found by the name the reconciler gives them
  // (D-259), and for each constraint the table has not got yet, how many rows
  // already break it. A column the table lacks reads as empty, which is what
  // it will hold once it is added.
  const prefix = checkTriggerPrefix(declaration)
  const checks = [
    ...new Set(
      // `one row per` is an index rather than a pair of triggers (D-270).
      query(db, "SELECT name FROM sqlite_master WHERE type IN ('trigger', 'index') AND tbl_name = ?", [table])
        .map((row) => String(row['name'] ?? ''))
        .filter((name) => name.startsWith(prefix))
        .map((name) => name.slice(prefix.length).replace(/__(insert|update|index)$/, '')),
    ),
  ]
  const unheld: Record<string, number> = {}
  for (const each of declaration.constraints ?? []) {
    const key = constraintKey(each)
    if (checks.includes(key)) continue
    unheld[key] = numberOr(
      query(
        db,
        `SELECT COUNT(*) AS n FROM ${quoteIdentifier(table)} AS "row" WHERE NOT (${breakingCondition(declaration, each, names)})`,
      )[0]?.['n'],
      0,
    )
  }

  // What an enum column holds (M36 U09): what a re-listed enum, or a text made
  // one, is checked against (M38 U6) — under its old name, when it is renamed too.
  const enums = new Set(
    declaration.columns
      .filter((each) => each.type === 'enum')
      .flatMap((each) => [each.name, ...[...renames].filter(([to]) => to === each.name).map(([, from]) => from)]),
  )
  const columns: ObservedColumn[] = info.map((row, index) => ({
    ...(enums.has(String(row['name'] ?? ''))
      ? {
          values: query(
            db,
            `SELECT DISTINCT ${quoteIdentifier(String(row['name'] ?? ''))} AS v FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier(String(row['name'] ?? ''))} IS NOT NULL`,
          ).map((one) => String(one['v'])),
        }
      : {}),
    name: String(row['name'] ?? ''),
    // SQLite keeps the declared type verbatim; the app only ever writes the
    // three storage classes the DDL uses, and anything else is a table nobody
    // here created.
    storageClass: String(row['type'] ?? '').toUpperCase(),
    notNull: numberOr(row['notnull'], 0) === 1,
    filled: numberOr(counts?.[`c${index}`], 0),
    distinct: numberOr(counts?.[`d${index}`], 0),
    unique: unique.has(String(row['name'] ?? '')),
  }))

  // The member tables of its `links` columns (M27 U2, D-300), found by the
  // name the reconciler gives them — `<table>__<column>` — with what each holds.
  const members: Record<string, number> = {}
  for (const row of query(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND substr(name, 1, ?) = ?", [
    table.length + 2,
    `${table}__`,
  ])) {
    const name = String(row['name'] ?? '')
    const column = name.slice(table.length + 2)
    if (column === '') continue
    members[column] = numberOr(query(db, `SELECT COUNT(*) AS n FROM ${quoteIdentifier(name)}`)[0]?.['n'], 0)
  }

  return { name: table, rowCount: numberOr(counts?.['rows'], 0), columns, checks, unheld, members, sql }
}

/**
 * The rows that break a constraint, by id — what a refusal lists so a person
 * can find them (D-259). At most `limit`, since the count is in the refusal.
 */
export function rowsBreaking(
  db: Database,
  declaration: FormatDeclaration,
  each: RowConstraint,
  limit = 10,
): readonly string[] {
  const table = tableNameFor(declaration)
  const names = query(db, `PRAGMA table_info(${quoteIdentifier(table)})`).map((row) =>
    String(row['name'] ?? ''),
  )
  if (names.length === 0) return []
  return query(
    db,
    `SELECT "row".id AS id FROM ${quoteIdentifier(table)} AS "row" WHERE NOT (${breakingCondition(declaration, each, names)}) ORDER BY "row".id LIMIT ?`,
    [limit],
  ).map((row) => String(row['id'] ?? ''))
}

/**
 * The rows that hold something in any of these stored columns, by id — and,
 * given `listed`, something not on that list (M38 U6, D-412). What a refusal to
 * drop a column or re-list one names, so the rows can be changed first.
 */
export function rowsHolding(
  db: Database,
  declaration: FormatDeclaration,
  stored: readonly string[],
  listed?: readonly string[] | undefined,
  limit = 10,
): readonly string[] {
  const table = tableNameFor(declaration)
  const present = new Set(
    query(db, `PRAGMA table_info(${quoteIdentifier(table)})`).map((row) => String(row['name'] ?? '')),
  )
  const names = stored.filter((name) => present.has(name))
  if (names.length === 0) return []
  const held = names.map((name) => `${quoteIdentifier(name)} IS NOT NULL`).join(' OR ')
  const outside =
    listed === undefined || listed.length === 0
      ? ''
      : ` AND ${quoteIdentifier(names[0] ?? '')} NOT IN (${listed.map(() => '?').join(', ')})`
  return query(
    db,
    `SELECT id FROM ${quoteIdentifier(table)} WHERE (${held})${outside} ORDER BY id LIMIT ?`,
    [...(listed ?? []), limit],
  ).map((row) => String(row['id'] ?? ''))
}

/**
 * The constraint over the table as it stands. A stored column it has not got
 * reads as `NULL`, which is what it will hold once the plan adds it. Read
 * against `FROM <table> AS "row"`, qualified, since `one row per` asks the
 * same table in a subquery (D-270).
 */
function breakingCondition(
  declaration: FormatDeclaration,
  each: RowConstraint,
  names: readonly string[],
): string {
  const present = new Set(names)
  return constraintConditionSql(declaration, each, (stored) =>
    present.has(stored) ? `"row".${quoteIdentifier(stored)}` : 'NULL',
  )
}

/**
 * Every `fmt_` table with no declaration behind it.
 *
 * Orphans, and they are left strictly alone. A declaration deleted outside the
 * app, or a document from a build with a format this one never had — either way
 * the table holds figures somebody meant to keep, and the reconciler's rule is
 * that it only touches what it can see a declaration for.
 */
export function orphanedTables(db: Database): readonly string[] {
  const declared = new Set(
    listFormats(db).flatMap((each) => [
      tableNameFor(each),
      ...each.columns.flatMap((column) => (isListType(column.type) ? [memberTableNameFor(each, column)] : [])),
    ]),
  )
  return query(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ? ORDER BY name",
    [`${TABLE_PREFIX}%`],
  )
    .map((row) => String(row['name'] ?? ''))
    .filter((name) => name !== '' && !declared.has(name))
}

/**
 * Every derived view, dropped (D-334) — before anything alters a declared
 * table, because a view naming a column being dropped or renamed would refuse
 * the change, and a stale one would answer with the old shape.
 */
export function dropDerivedViews(db: Database): void {
  for (const row of query(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'view' AND name LIKE ? ESCAPE '!'",
    [`${TABLE_PREFIX.replace('_', '!_')}%`],
  )) {
    db.run(`DROP VIEW IF EXISTS ${quoteIdentifier(String(row['name'] ?? ''))}`)
  }
}

/**
 * A view per format with a derived column, compiled from the declarations as
 * they are now (D-334). One that will not compile or will not read — a
 * neighbour it names was deleted since — is left out rather than left broken:
 * its figures are then empty on every surface, and the declaration's own
 * problems say why.
 */
export function buildDerivedViews(db: Database): void {
  const formats = listFormats(db)
  for (const declaration of formats) {
    if ((declaration.derived ?? []).length === 0) continue
    const sql = createDerivedViewSql(
      declaration,
      formats.filter((each) => each.name !== declaration.name),
    )
    if (sql === undefined) continue
    try {
      db.run(sql)
      db.exec(`SELECT * FROM ${quoteIdentifier(derivedViewNameFor(declaration))} LIMIT 0`)
    } catch {
      db.run(`DROP VIEW IF EXISTS ${quoteIdentifier(derivedViewNameFor(declaration))}`)
    }
  }
}

/**
 * **The triggers that keep each format's mark** (M47 U5, D-462): made where a
 * table lacks them, dropped where they name a table that is gone or a format
 * that no longer has it. Idempotent, and one read of `sqlite_master` when
 * nothing is missing — it runs on every open and every adopt.
 */
export function keepChangeMarks(db: Database): void {
  const wanted = new Map(listFormats(db).flatMap((declaration) => changeTriggersFor(declaration).map((each) => [each.name, each])))
  const tables = new Set(
    query(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ?", [`${TABLE_PREFIX}%`]).map((row) =>
      String(row['name'] ?? ''),
    ),
  )
  const present = new Set<string>()
  for (const row of query(db, "SELECT name FROM sqlite_master WHERE type = 'trigger'")) {
    const name = String(row['name'] ?? '')
    if (!isChangeTrigger(name)) continue
    if (wanted.has(name)) present.add(name)
    else db.run(`DROP TRIGGER IF EXISTS ${quoteIdentifier(name)}`)
  }
  for (const [name, trigger] of wanted) {
    // A table the reconciler refused to make has nothing to mark yet.
    if (!present.has(name) && tables.has(trigger.table)) db.run(trigger.sql)
  }
}

/**
 * **When each format last changed** (M47 U5, D-462), in epoch milliseconds: a
 * row added, changed or removed, or its declaration. A format with no mark —
 * a text document written before there were marks — is absent rather than
 * dated by the moment it was read.
 */
export function changeMarks(db: Database): ReadonlyMap<string, number> {
  return new Map(
    query(db, 'SELECT name, updated_at FROM format WHERE updated_at > 0').map((row) => [
      String(row['name'] ?? ''),
      numberOr(row['updated_at'], 0),
    ]),
  )
}

/**
 * Put back the marks a text document carries, after its rows were written into
 * a fresh copy — which moved every mark to the moment of the read. A format the
 * text gives no mark is left unmarked.
 */
export function restoreChangeMarks(db: Database, marks: ReadonlyMap<string, number>): void {
  for (const declaration of listFormats(db)) {
    db.run('UPDATE format SET updated_at = ? WHERE name = ?', [marks.get(declaration.name) ?? 0, declaration.name])
  }
}

function apply(db: Database, plan: ReconcilePlan): void {
  for (const step of plan.steps) {
    for (const statement of step.sql) db.run(statement)
  }
}

interface ReadFormats {
  readonly readable: readonly FormatDeclaration[]
  readonly unreadable: readonly { readonly name: string; readonly reason: string }[]
}

function readFormats(db: Database, only?: string): ReadFormats {
  // One format's rows, when one is asked for: each declaration reads on its
  // own, and a write that resolves its format per call (M25 U3) must not parse
  // thirty-four of them to find one.
  const scope = only === undefined ? '' : 'WHERE format_name = ? '
  const scoped = only === undefined ? [] : [only]
  const readable: FormatDeclaration[] = []
  const unreadable: { name: string; reason: string }[] = []

  const values = new Map<string, string[]>()
  for (const row of query(
    db,
    `SELECT format_name, column_name, value FROM format_column_value
      ${scope}ORDER BY format_name, column_name, position`,
    scoped,
  )) {
    const key = `${String(row['format_name'])} ${String(row['column_name'])}`
    const list = values.get(key) ?? []
    list.push(String(row['value'] ?? ''))
    values.set(key, list)
  }

  const columns = new Map<string, ColumnDeclaration[]>()
  for (const row of query(
    db,
    `SELECT format_name, name, type, unit, per, required, is_unique, scale, found_by, minimum, maximum, target, note
       FROM format_column ${scope}ORDER BY format_name, position, name`,
    scoped,
  )) {
    const format = String(row['format_name'] ?? '')
    const name = String(row['name'] ?? '')
    const type = String(row['type'] ?? '')
    if (format === '' || name === '' || !(COLUMN_TYPES as readonly string[]).includes(type)) continue
    const list = columns.get(format) ?? []
    const found = typeof row['found_by'] === 'string' && row['found_by'] !== '' ? parseFoundBy(row['found_by']) : undefined
    list.push({
      name,
      type: type as ColumnType,
      unit: typeof row['unit'] === 'string' && row['unit'] !== '' ? row['unit'] : undefined,
      per: typeof row['per'] === 'string' && row['per'] !== '' ? row['per'] : undefined,
      required: numberOr(row['required'], 0) === 1,
      unique: numberOr(row['is_unique'], 0) === 1,
      scale: typeof row['scale'] === 'number' ? row['scale'] : undefined,
      values: values.get(`${format} ${name}`) ?? [],
      minimum: typeof row['minimum'] === 'number' ? row['minimum'] : undefined,
      maximum: typeof row['maximum'] === 'number' ? row['maximum'] : undefined,
      target: typeof row['target'] === 'string' && row['target'] !== '' ? row['target'] : undefined,
      ...(found?.ok === true ? { foundBy: found.value } : {}),
      note: String(row['note'] ?? ''),
    })
    columns.set(format, list)
  }

  const aggregates = new Map<string, AggregateDeclaration[]>()
  for (const row of query(
    db,
    `SELECT format_name, name, kind, over_format, over_column, expression, unit, note, where_column, where_member, by_column
       FROM format_aggregate ${scope}ORDER BY format_name, position, name`,
    scoped,
  )) {
    const format = String(row['format_name'] ?? '')
    const name = String(row['name'] ?? '')
    const kind = String(row['kind'] ?? '')
    if (format === '' || name === '') continue
    if (!(AGGREGATE_KINDS as readonly string[]).includes(kind)) continue
    const list = aggregates.get(format) ?? []
    list.push(
      aggregate(
        name,
        kind as AggregateKind,
        {
          format: String(row['over_format'] ?? ''),
          column:
            typeof row['over_column'] === 'string' && row['over_column'] !== '' ? row['over_column'] : undefined,
        },
        {
          expression: String(row['expression'] ?? ''),
          unit: typeof row['unit'] === 'string' && row['unit'] !== '' ? row['unit'] : undefined,
          note: String(row['note'] ?? ''),
          where:
            typeof row['where_column'] === 'string' && typeof row['where_member'] === 'string'
              ? storedFilter(row['where_column'], row['where_member'])
              : undefined,
          by: typeof row['by_column'] === 'string' ? row['by_column'] : undefined,
        },
      ),
    )
    aggregates.set(format, list)
  }

  const identities = new Map<string, IdentityDeclaration[]>()
  for (const row of query(
    db,
    `SELECT format_name, name, expression, tolerance_kind, tolerance_amount, note
       FROM format_identity ${scope}ORDER BY format_name, position, name`,
    scoped,
  )) {
    const format = String(row['format_name'] ?? '')
    const name = String(row['name'] ?? '')
    if (format === '' || name === '') continue
    const amount = numberOr(row['tolerance_amount'], 0)
    const list = identities.get(format) ?? []
    list.push(
      identity(name, String(row['expression'] ?? ''), {
        tolerance:
          row['tolerance_kind'] === 'RELATIVE'
            ? { kind: 'RELATIVE', percent: amount }
            : { kind: 'ABSOLUTE', amount },
        note: String(row['note'] ?? ''),
      }),
    )
    identities.set(format, list)
  }

  // A rule that no longer parses makes its format unreadable rather than
  // quietly unconstrained — a format read without the rule it declared would
  // be reconciled into dropping its trigger.
  const constraints = new Map<string, RowConstraint[]>()
  const unparsed = new Map<string, string>()
  for (const row of query(
    db,
    `SELECT format_name, rule, note FROM format_constraint ${scope}ORDER BY format_name, position`,
    scoped,
  )) {
    const format = String(row['format_name'] ?? '')
    const parsed = parseConstraint(String(row['rule'] ?? ''), String(row['note'] ?? ''))
    if (!parsed.ok) {
      unparsed.set(format, parsed.error)
      continue
    }
    const list = constraints.get(format) ?? []
    list.push(parsed.value)
    constraints.set(format, list)
  }

  const rollups = new Map<string, RollupDeclaration[]>()
  for (const row of query(
    db,
    `SELECT format_name, name, works_out, note FROM format_rollup ${scope}ORDER BY format_name, position`,
    scoped,
  )) {
    const format = String(row['format_name'] ?? '')
    const parsed = parseRollup(String(row['name'] ?? ''), String(row['works_out'] ?? ''), String(row['note'] ?? ''))
    if (!parsed.ok) {
      unparsed.set(format, parsed.error)
      continue
    }
    const list = rollups.get(format) ?? []
    list.push(parsed.value)
    rollups.set(format, list)
  }

  const ruleSets = new Map<string, RuleSetDeclaration[]>()
  for (const row of query(
    db,
    `SELECT format_name, name, sets, note FROM format_rule_set ${scope}ORDER BY format_name, position`,
    scoped,
  )) {
    const format = String(row['format_name'] ?? '')
    const parsed = parseRuleSet(String(row['name'] ?? ''), String(row['sets'] ?? ''), String(row['note'] ?? ''))
    if (!parsed.ok) {
      unparsed.set(format, parsed.error)
      continue
    }
    const list = ruleSets.get(format) ?? []
    list.push(parsed.value)
    ruleSets.set(format, list)
  }

  const derivedOf = new Map<string, DerivedDeclaration[]>()
  for (const row of query(
    db,
    `SELECT format_name, name, expression, note FROM format_derived ${scope}ORDER BY format_name, position`,
    scoped,
  )) {
    const format = String(row['format_name'] ?? '')
    const list = derivedOf.get(format) ?? []
    list.push(derived(String(row['name'] ?? ''), String(row['expression'] ?? ''), String(row['note'] ?? '')))
    derivedOf.set(format, list)
  }

  for (const row of query(
    db,
    'SELECT name, title, language, notes, nothing_must_hold, pack, pack_written, pack_columns' +
      ` FROM format ${only === undefined ? '' : 'WHERE name = ? '}ORDER BY created_at, name`,
    scoped,
  )) {
    const name = String(row['name'] ?? '')
    if (name === '') continue
    const language = numberOr(row['language'], 0)
    if (language > DECLARATION_LANGUAGE) {
      unreadable.push({
        name,
        reason: `Written in format language ${language}; this build understands ${DECLARATION_LANGUAGE}. Update the app — its table is left exactly as it is.`,
      })
      continue
    }
    const broken = unparsed.get(name)
    if (broken !== undefined) {
      unreadable.push({ name, reason: `A row constraint, a rollup or a rule set does not read: ${broken}` })
      continue
    }
    const declared = columns.get(name) ?? []
    if (declared.length === 0) {
      unreadable.push({ name, reason: 'The declaration has no columns.' })
      continue
    }
    readable.push({
      language,
      name,
      title: String(row['title'] ?? name),
      notes: String(row['notes'] ?? ''),
      columns: declared,
      identities: identities.get(name) ?? [],
      aggregates: aggregates.get(name) ?? [],
      ...(constraints.has(name) ? { constraints: constraints.get(name) ?? [] } : {}),
      ...(rollups.has(name) ? { rollups: rollups.get(name) ?? [] } : {}),
      ...(ruleSets.has(name) ? { ruleSets: ruleSets.get(name) ?? [] } : {}),
      ...(derivedOf.has(name) ? { derived: derivedOf.get(name) ?? [] } : {}),
      ...(typeof row['pack'] === 'string' && row['pack'] !== ''
        ? {
            owner: {
              pack: row['pack'],
              written: String(row['pack_written'] ?? ''),
              columns: String(row['pack_columns'] ?? '')
                .split(',')
                .filter((each) => each !== ''),
            },
          }
        : {}),
      nothingMustHold: numberOr(row['nothing_must_hold'], 0) === 1,
    })
  }

  return { readable, unreadable }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Re-exported so a caller needs one import to name a declared table's columns. */
export { storedColumnsOf }
