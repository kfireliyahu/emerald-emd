/**
 * A declaration becomes SQL — real columns, real storage classes, real `CHECK`s
 * (M19 U1, D-214).
 *
 * **Every string this file produces is built from a validated declaration and
 * nothing else.** Names are matched against `NAME_PATTERN` before they get here
 * and quoted anyway; the only free text that reaches SQL is an enum's members
 * and they are escaped as literals. There is no path from a model's answer to
 * an executed clause, which is the same discipline as every other model surface
 * in this app: what a model may produce is a mapping or a position, never a
 * value and never a program (D-137, D-132).
 *
 * **U4b brought the key** (D-224). A `link` column carries a real `REFERENCES`
 * clause, and it is worth knowing exactly what that buys, because it is not
 * enforcement: **this app never sets `PRAGMA foreign_keys = ON`** (D-067), so
 * SQLite will not refuse a row naming an id that is not there. The clause is in
 * the file for the person who opens the `.emd` in another tool, and the refusal
 * that actually holds is in `row.ts` and names the column — which is the same
 * division U1 already made, and the same reason: *"CHECK constraint failed"*
 * with no column in it is read by a model about to try again.
 *
 * **M24 U4 brought the one index** (D-255): a `unique` column is a
 * `CREATE UNIQUE INDEX` named `<table>__<column>__unique`, separate from the
 * table so it can be added to a column that already exists and dropped without
 * rebuilding one.
 *
 * **M24 U7 brought the triggers** (D-259): a row constraint is a pair — `BEFORE
 * INSERT` and `BEFORE UPDATE` — named `<table>__check_<key>__insert` and
 * `__update`, raising the constraint's own sentence. A trigger rather than a
 * table `CHECK` for the index's reason: SQLite cannot add a `CHECK` to a table
 * that exists without rebuilding it, and a trigger is added and dropped by name.
 *
 * **M25 E1 made `one row per` the one constraint that is an index** (D-270):
 * `<table>__check_<key>__index`, partial when it has a `when`. A trigger could
 * only ask the table with a subquery on every write; the index is what SQLite
 * already does, and an index on a sixty-thousand-row table is also the lookup
 * the refusal makes.
 * Still not here: `ON DELETE` of any kind.
 * Deleting a format that another links to is refused by the repository rather
 * than cascaded, because nothing in this app is auto-deleted.
 */

import {
  isListType,
  MEMBER_COLUMNS,
  memberColumnOf,
  memberTableNameFor,
  moneyColumnNames,
  quantityColumnNames,
  ROW_ID_COLUMN,
  storedColumnsOf,
  TABLE_PREFIX,
  tableNameFor,
  type ColumnDeclaration,
  type FormatDeclaration,
} from './declaration.ts'
import { filterMembers, isEmptyTest, type AggregateFilter } from './aggregate.ts'
import { clockRange, type Weekday } from './clock.ts'
import { constraintKey, constraintText, isTableConstraint, type RowConstraint } from './constraint.ts'
import { parseDecimal } from './decimal.ts'
import { parsePercent } from './percent.ts'
import { derivedSelectSql } from './derived.ts'
import type { RollupDeclaration } from './rollup.ts'

/** SQLite identifier quoting. Doubling the quote is the whole of the escape. */
export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/** SQLite string-literal quoting, for an enum member. */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * A `CREATE TABLE` for a format, as one statement.
 *
 * `IF NOT EXISTS` is not used and that is deliberate: the reconciler decides
 * whether a table needs creating by looking, and a `CREATE TABLE IF NOT EXISTS`
 * would quietly succeed against a table of the same name with the wrong shape —
 * which is the one outcome the reconciler exists to prevent.
 */
export function createTableSql(declaration: FormatDeclaration): string {
  const lines = [
    // Every row has an identity, because U4b's links will name one. `TEXT
    // PRIMARY KEY` is what every table in this document already uses.
    `  ${quoteIdentifier(ROW_ID_COLUMN)} TEXT PRIMARY KEY NOT NULL`,
    ...declaration.columns.flatMap((column) => columnClauses(column).map((clause) => `  ${clause}`)),
  ]
  return `CREATE TABLE ${quoteIdentifier(tableNameFor(declaration))} (\n${lines.join(',\n')}\n)`
}

/**
 * An `ALTER TABLE … ADD COLUMN` per stored column, for a column being added to a
 * table that already exists.
 *
 * One statement per stored column rather than one per declared column, because
 * `money` is two and SQLite adds one at a time.
 *
 * **SQLite refuses a `NOT NULL` column with no default on a table that has
 * rows**, which is a third thing the reconciler cannot decide by itself — see
 * `reconcile.ts`. By the time these statements are built that question has
 * already been answered.
 */
export function addColumnSql(
  declaration: FormatDeclaration,
  column: ColumnDeclaration,
): readonly string[] {
  const table = quoteIdentifier(tableNameFor(declaration))
  return columnClauses(column).map((clause) => `ALTER TABLE ${table} ADD COLUMN ${clause}`)
}

/** The one index a `unique` column has. Its name is how `observe` finds it again. */
export function uniqueIndexName(declaration: FormatDeclaration, column: string): string {
  return `${tableNameFor(declaration)}__${column}__unique`
}

/**
 * The index that makes a column unique. Only ever built for a type in
 * `UNIQUE_TYPES`, each of which is one stored column under its own name.
 */
export function createUniqueIndexSql(declaration: FormatDeclaration, column: string): string {
  return `CREATE UNIQUE INDEX ${quoteIdentifier(uniqueIndexName(declaration, column))} ON ${quoteIdentifier(tableNameFor(declaration))} (${quoteIdentifier(column)})`
}

/**
 * Dropping it — before the column goes, too, because SQLite refuses to drop an
 * indexed column rather than taking the index with it.
 */
export function dropUniqueIndexSql(declaration: FormatDeclaration, column: string): string {
  return `DROP INDEX IF EXISTS ${quoteIdentifier(uniqueIndexName(declaration, column))}`
}

/** What a constraint's triggers are called, before the `__insert` or `__update`. */
export function checkTriggerPrefix(declaration: FormatDeclaration): string {
  return `${tableNameFor(declaration)}__check_`
}

/**
 * The SQL column a declared column's figure is in — the minor units of a
 * `money`, the amount of a `quantity`, and the column itself otherwise. A
 * constraint reads the figure: a money column is filled when it has an amount.
 */
export function figureColumnOf(
  declaration: Pick<FormatDeclaration, 'columns'>,
  name: string,
): string {
  const column = declaration.columns.find((each) => each.name === name)
  if (column?.type === 'money') return moneyColumnNames(column).minor
  if (column?.type === 'quantity') return quantityColumnNames(column).amount
  return name
}

/**
 * The condition a row keeps, as SQL — the same logic as `constraintHolds`.
 *
 * `reference` turns a stored column into what the condition reads: `NEW."x"`
 * in a trigger, `"x"` when counting the rows that break it, and `NULL` for a
 * column the table has not got yet. Every name in it was validated against the
 * declaration and is quoted anyway; the members are literals.
 *
 * `one row per` is the one that reads other rows (D-270): a row keeps it when
 * no other row of the table shares every one of its columns. So `reference`
 * has to be qualified — `"row"."x"` against `FROM <table> AS "row"` — or the
 * subquery would read its own row back. It is what counts the rows an index
 * would refuse; the index itself is `createCheckTriggersSql`'s.
 */
export function constraintConditionSql(
  declaration: Pick<FormatDeclaration, 'name' | 'columns'>,
  each: RowConstraint,
  reference: (stored: string) => string = (stored) => quoteIdentifier(stored),
): string {
  const figure = (name: string): string => reference(figureColumnOf(declaration, name))
  const appliesTo = (read: (name: string) => string): string =>
    // An empty `when` is not one of the members; `IN` would answer NULL for it.
    `COALESCE(${read(each.when ?? '')} IN (${each.is.map(quoteLiteral).join(', ')}), 0)`
  if (each.kind === 'AT_MOST_ONE') {
    return `(${each.columns.map((name) => `(${figure(name)} IS NOT NULL)`).join(' + ')}) <= 1`
  }
  if (each.kind === 'ONE_PER') {
    // A column the table has not got yet is empty in every row, and an empty
    // cell collides with nothing — nor could the subquery name it.
    const named = [...each.columns, ...(each.when === undefined ? [] : [each.when])]
    if (named.some((name) => figure(name) === 'NULL')) return '1'
    const other = (name: string): string => `"other".${quoteIdentifier(figureColumnOf(declaration, name))}`
    const same = each.columns.map((name) => `${other(name)} = ${figure(name)}`)
    const scope = each.when === undefined ? [] : [appliesTo(other)]
    return (
      `${each.columns.map((name) => `${figure(name)} IS NULL`).join(' OR ')}` +
      (each.when === undefined ? '' : ` OR NOT ${appliesTo(figure)}`) +
      ` OR NOT EXISTS (SELECT 1 FROM ${quoteIdentifier(tableNameFor(declaration))} AS "other" WHERE ` +
      [`"other".${quoteIdentifier(ROW_ID_COLUMN)} <> ${reference(ROW_ID_COLUMN)}`, ...same, ...scope].join(' AND ') +
      ')'
    )
  }
  const applies = appliesTo(figure)
  const value = figure(each.columns[0] ?? '')
  if (each.kind === 'REQUIRED_WHEN') {
    return each.only
      ? `${applies} = (${value} IS NOT NULL)`
      : `NOT ${applies} OR ${value} IS NOT NULL`
  }
  return `NOT ${applies} OR ${value} IS NULL OR ${value} ${each.sign === 'AT_LEAST_ZERO' ? '>=' : '<='} 0`
}

/**
 * The two triggers a constraint compiles to. **The message is the sentence**,
 * so even a write that reached SQLite without `row.ts` — another tool, a bug —
 * is refused in words that name the columns rather than *constraint failed*.
 */
export function createCheckTriggersSql(
  declaration: FormatDeclaration,
  each: RowConstraint,
): readonly string[] {
  const table = quoteIdentifier(tableNameFor(declaration))
  const name = `${checkTriggerPrefix(declaration)}${constraintKey(each)}`
  if (isTableConstraint(each)) {
    // `one row per` is an index (D-270). SQLite's own words when it fires are
    // *UNIQUE constraint failed*, which is why `repeatedValues` refuses first.
    const where =
      each.when === undefined
        ? ''
        : ` WHERE ${quoteIdentifier(each.when)} IN (${each.is.map(quoteLiteral).join(', ')})`
    return [
      `CREATE UNIQUE INDEX ${quoteIdentifier(`${name}__index`)} ON ${table} (${each.columns
        .map((column) => quoteIdentifier(figureColumnOf(declaration, column)))
        .join(', ')})${where}`,
    ]
  }
  const condition = constraintConditionSql(declaration, each, (stored) => `NEW.${quoteIdentifier(stored)}`)
  const message = quoteLiteral(`${declaration.name}: ${constraintText(each)}`)
  return (['insert', 'update'] as const).map(
    (event) =>
      `CREATE TRIGGER ${quoteIdentifier(`${name}__${event}`)} BEFORE ${event.toUpperCase()} ON ${table} FOR EACH ROW WHEN NOT (${condition}) BEGIN SELECT RAISE(ABORT, ${message}); END`,
  )
}

/**
 * Dropping a constraint's triggers — or its index, for `one row per` — by the
 * key its name carries. A key is all a dropped constraint leaves, so both go.
 */
export function dropCheckTriggersSql(declaration: FormatDeclaration, key: string): readonly string[] {
  const name = `${checkTriggerPrefix(declaration)}${key}`
  return [
    ...['insert', 'update'].map((event) => `DROP TRIGGER IF EXISTS ${quoteIdentifier(`${name}__${event}`)}`),
    `DROP INDEX IF EXISTS ${quoteIdentifier(`${name}__index`)}`,
  ]
}

/** Dropping one stored column. Only ever reached for a column holding no data. */
export function dropColumnSql(
  declaration: FormatDeclaration,
  storedColumn: string,
): string {
  return `ALTER TABLE ${quoteIdentifier(tableNameFor(declaration))} DROP COLUMN ${quoteIdentifier(storedColumn)}`
}

/**
 * The column definitions one declared column contributes — its name, its
 * storage class, its nullability and its checks.
 *
 * A `CHECK` is written against the column by name rather than inline, so the
 * same clause reads the same whether it arrives through `CREATE TABLE` or
 * through `ADD COLUMN`. SQLite accepts a `CHECK` on an added column, including
 * on a table that already holds rows — it is not re-verified against them, which
 * is worth knowing and is exactly why the reconciler refuses a *type* change
 * rather than adding a constraint over data it never saw.
 */
export function columnClauses(column: ColumnDeclaration): readonly string[] {
  // A `links` or an `enums` column is a table of its own and no column of this
  // one (M27 U2, D-300; M34 U5, D-398) — `createMemberTableSql` below.
  if (isListType(column.type)) return []

  if (column.type === 'link') {
    // Documentation rather than enforcement — see the head of this file. The
    // target is a declaration name and the table is that name prefixed, which
    // is the one place in this file that has to know the two differ.
    const target = column.target ?? ''
    const clause = [
      quoteIdentifier(column.name),
      'TEXT',
      column.required ? 'NOT NULL' : '',
      `REFERENCES ${quoteIdentifier(`${TABLE_PREFIX}${target}`)} (${quoteIdentifier(ROW_ID_COLUMN)})`,
    ]
      .filter((part) => part !== '')
      .join(' ')
    return [clause]
  }

  if (column.type === 'quantity') {
    // **The figure keeps the declared name and the unit sits beside it** (U4c,
    // D-225). Money renames its figure to `_minor` because minor units are not
    // what the declaration called for; a quantity's amount is the amount, so
    // `amount` and `amount_unit` is what somebody opening the file in another
    // tool reads with nothing explained.
    const names = quantityColumnNames(column)
    const nullability = column.required ? ' NOT NULL' : ''
    return [
      `${quoteIdentifier(names.amount)} REAL${nullability}`,
      // **Not an `IN (…)` of the units this document knows**, and the reason is
      // the reason those units are rows at all (D-223): the list is closed at
      // the moment it is used rather than at the moment the table was made, and
      // a `CHECK` naming today's symbols would refuse a unit somebody adds
      // tomorrow, in a table nothing would then reconcile. What holds here is
      // that the cell is a symbol at all; that it is a symbol this document
      // knows is `row.ts`, which can name the column and list the alternatives.
      `${quoteIdentifier(names.unit)} TEXT${nullability} CHECK (${quoteIdentifier(names.unit)} IS NULL OR ${quoteIdentifier(names.unit)} <> '')`,
    ]
  }

  if (column.type === 'money') {
    const names = moneyColumnNames(column)
    const nullability = column.required ? ' NOT NULL' : ''
    return [
      // Minor units as an integer. The app's oldest rule, kept in a table the
      // user declared: no floating point in the money path, ever.
      `${quoteIdentifier(names.minor)} INTEGER${nullability}`,
      `${quoteIdentifier(names.currency)} TEXT${nullability} CHECK (${quoteIdentifier(names.currency)} IS NULL OR ${quoteIdentifier(names.currency)} GLOB '[A-Z][A-Z][A-Z]')`,
    ]
  }

  const quoted = quoteIdentifier(column.name)
  const checks = checksFor(column, quoted)
  return [
    [
      quoted,
      storageClassOf(column),
      column.required ? 'NOT NULL' : '',
      ...checks.map((check) => `CHECK (${check})`),
    ]
      .filter((part) => part !== '')
      .join(' '),
  ]
}

/** SQLite's five storage classes, as this language's eighteen types use them. */
function storageClassOf(column: ColumnDeclaration): string {
  switch (column.type) {
    case 'integer':
    case 'boolean':
    // A decimal is the integer the ledger's `_micro` columns always were
    // (M24 U6, D-257): the figure times ten to its scale. A percent is the same
    // shape at a fixed scale — millionths of the whole (M29 U3, D-333).
    case 'decimal':
    case 'percent':
      return 'INTEGER'
    case 'real':
      return 'REAL'
    case 'money':
    case 'quantity':
      // Unreachable — both pairs are handled above — but the switch stays
      // exhaustive so adding a type to the union is a compile error rather than
      // a silent `TEXT`.
      return 'INTEGER'
    case 'text':
    case 'date':
    case 'time':
    case 'month':
    case 'instant':
    case 'enum':
    case 'link':
    // A path and a name, as text (M47 U4, D-461).
    case 'elsewhere':
    // A path, or a local app's address, as text (M37 U6).
    case 'file':
    // Unreachable, like money's: a list stores no cell of this table.
    case 'links':
    case 'enums':
      // A row id, which is `TEXT PRIMARY KEY` in every table this document has.
      return 'TEXT'
  }
}

/**
 * The checks a column's declared properties become.
 *
 * Each one is `column IS NULL OR …`, so an optional column may be empty and a
 * required one is already refused by `NOT NULL`. Writing it the other way — a
 * check that a `NULL` fails — would make every optional column secretly
 * mandatory, which is the kind of bug a declaration language gets to have once.
 */
function checksFor(column: ColumnDeclaration, quoted: string): readonly string[] {
  const checks: string[] = []
  const nullable = `${quoted} IS NULL OR `

  switch (column.type) {
    case 'date':
      // Date-only, `YYYY-MM-DD`, never an epoch (D-023). `GLOB` is the only
      // pattern SQLite offers that distinguishes a digit, and it is what
      // `024_holdings` already uses for the same shape.
      checks.push(`${nullable}${quoted} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`)
      break
    case 'month':
      // `YYYY-MM` (M24 U6, D-257). The GLOB holds the shape and the first digit
      // of the month; `row.ts` refuses a thirteenth month with the column named.
      checks.push(`${nullable}${quoted} GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]'`)
      break
    case 'instant':
      // One spelling of a moment, in UTC to the millisecond — which is what
      // makes the column sort by time as text, and two equal moments equal.
      checks.push(
        `${nullable}${quoted} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'`,
      )
      break
    case 'time':
      // `HH:MM` in twenty-four hours (M29 U4, D-335): the GLOB holds the shape
      // and the comparison the hour, so `24:00` and `25:61` never reach a row.
      checks.push(`${nullable}(${quoted} GLOB '[0-2][0-9]:[0-5][0-9]' AND ${quoted} <= '23:59')`)
      break
    case 'elsewhere':
      // A path ending in `.emd`, a space, and a name (M47 U4, D-461). The shape
      // and nothing else: whether the other file is there is a read's question.
      checks.push(`${nullable}lower(${quoted}) GLOB '*.emd ?*'`)
      break
    case 'file':
      // Not empty (M37 U6). Whether the file is there is a read's question,
      // and a file that has gone never stops a write.
      checks.push(`${nullable}length(trim(${quoted})) > 0`)
      break
    case 'boolean':
      checks.push(`${nullable}${quoted} IN (0, 1)`)
      break
    case 'enum':
      checks.push(`${nullable}${quoted} IN (${column.values.map(quoteLiteral).join(', ')})`)
      break
    case 'integer':
    case 'real':
    case 'decimal':
    case 'percent':
    case 'text':
    case 'money':
    case 'quantity':
    case 'link':
    case 'links':
    // Its members' `CHECK` is on the member table (M34 U5, D-398).
    case 'enums':
      // A link's constraint is the `REFERENCES` clause above, and what actually
      // holds it is `row.ts` — see the head of this file.
      break
  }

  if (column.minimum !== undefined) checks.push(`${nullable}${quoted} >= ${boundOf(column, column.minimum)}`)
  if (column.maximum !== undefined) checks.push(`${nullable}${quoted} <= ${boundOf(column, column.maximum)}`)
  return checks
}

/**
 * A bound as the stored cell compares against it — the figure itself, or for a
 * `decimal` or a `percent` the integer it is stored as. `declaration.ts` has already refused a
 * bound the column could not hold, so the parse here cannot fail.
 */
function boundOf(column: ColumnDeclaration, bound: number): string {
  if (column.type === 'percent') {
    const stored = parsePercent(String(bound))
    return stored.ok ? String(stored.value) : String(bound)
  }
  if (column.type !== 'decimal' || column.scale === undefined) return String(bound)
  const scaled = parseDecimal(String(bound), column.scale)
  return scaled.ok ? String(scaled.value) : String(bound)
}

/**
 * The table a `links` column keeps its members in (M27 U2, D-300): one row per
 * member, the row it belongs to, the row it names, and its place in the list.
 *
 * **A table and not a delimited cell**, for the two things a cell cannot do: a
 * member whose row is deleted is a row a query finds by id rather than a name
 * buried in text, and a name with the separator in it is not a question. The
 * primary key refuses the same member twice in one list. `REFERENCES` is
 * documentation, as on a `link` — see the head of this file.
 */
export function createMemberTableSql(declaration: FormatDeclaration, column: ColumnDeclaration): string {
  const owner = quoteIdentifier(tableNameFor(declaration))
  const target = quoteIdentifier(`${TABLE_PREFIX}${column.target ?? ''}`)
  const id = quoteIdentifier(ROW_ID_COLUMN)
  const row = quoteIdentifier(MEMBER_COLUMNS.row)
  const member = quoteIdentifier(memberColumnOf(column))
  const position = quoteIdentifier(MEMBER_COLUMNS.position)
  // **Several of a list** (M34 U5, D-398): the member is the word itself, and
  // the `CHECK` names the list — so every member is checked by SQLite as an
  // enum's one value is, and never a word inside a delimited cell.
  if (column.type === 'enums') {
    return (
      `CREATE TABLE ${quoteIdentifier(memberTableNameFor(declaration, column))} (
` +
      `  ${row} TEXT NOT NULL REFERENCES ${owner} (${id}),
` +
      `  ${member} TEXT NOT NULL CHECK (${member} IN (${column.values.map(quoteLiteral).join(', ')})),
` +
      `  ${position} INTEGER NOT NULL,
` +
      `  PRIMARY KEY (${row}, ${member})
)`
    )
  }
  return (
    `CREATE TABLE ${quoteIdentifier(memberTableNameFor(declaration, column))} (
` +
    `  ${row} TEXT NOT NULL REFERENCES ${owner} (${id}),
` +
    `  ${member} TEXT NOT NULL REFERENCES ${target} (${id}),
` +
    `  ${position} INTEGER NOT NULL,
` +
    `  PRIMARY KEY (${row}, ${member})
)`
  )
}

/** Dropping one — only ever when it holds nothing, which the reconciler decides. */
export function dropMemberTableSql(declaration: FormatDeclaration, column: Pick<ColumnDeclaration, 'name'>): string {
  return `DROP TABLE IF EXISTS ${quoteIdentifier(memberTableNameFor(declaration, column))}`
}

/** Every SQL column a declaration occupies, `id` included, in order. */
export function storedColumnsFor(declaration: FormatDeclaration): readonly string[] {
  return [ROW_ID_COLUMN, ...declaration.columns.flatMap(storedColumnsOf)]
}

/* ------------------------------------------------------------- a filter */

/** Whether an empty cell leaves a filter undecided — D-260's `is` and `is one of` only. */
function undecidable(filter: AggregateFilter): boolean {
  return filter.not !== true && !isEmptyTest(filter)
}

/**
 * One filter as a condition on `sql`, the cell it reads (M36 U04, D-380).
 * `members` are the member literals or placeholders, already in SQL.
 *
 * `keepUndecided` is a rollup's: a row with nothing where D-260's `is` reads is
 * kept, so its group can say it is `unchecked` rather than quietly smaller. A
 * condition that has to say yes or no — `spendable`'s — drops it instead.
 *
 * A window around today (D-472) is the days it takes once `today` is known, as
 * the engine's own `YYYY-MM-DD` literals; a reader that was told no today has
 * no answer to give, and says so rather than guessing one.
 */
export function filterConditionSql(
  sql: string,
  filter: AggregateFilter,
  members: readonly string[],
  keepUndecided: boolean,
  today?: string,
  /** The document's first day of the week, for `this week` (D-528); Monday when not said. */
  weekStart?: Weekday,
): string {
  if (filter.clock !== undefined) {
    const range = today === undefined ? undefined : clockRange(filter.clock, today, weekStart)
    if (range === undefined) throw new Error(`where ${filter.column} is ${filter.is} needs to be told what day it is.`)
    const parts = [
      ...(range.from === undefined ? [] : [`${sql} >= ${quoteLiteral(range.from)}`]),
      ...(range.through === undefined ? [] : [`${sql} <= ${quoteLiteral(range.through)}`]),
    ]
    const within = `(${parts.join(' AND ')})`
    return keepUndecided ? `(${within} OR ${sql} IS NULL)` : within
  }
  const empty = `(${sql} IS NULL OR ${sql} = '')`
  if (isEmptyTest(filter)) return filter.not === true ? `NOT ${empty}` : empty
  const among = `${sql} IN (${members.join(', ')})`
  if (filter.not === true) return `(${sql} IS NULL OR ${sql} NOT IN (${members.join(', ')}))`
  return keepUndecided ? `(${among} OR ${sql} IS NULL)` : among
}

/**
 * A rollup's filters as one condition on a table aliased `alias`, members as
 * literals — **what a query outside the rollup reads to see the same rows**
 * (M36 U04): the ledger's statistics read `transaction.spending`'s, so which
 * rows count is said once, in the declaration. A hop is a subquery on the
 * linked row's id rather than a join, so the condition drops into any `WHERE`.
 *
 * `skip` names columns whose filters the caller says itself — a direction, when
 * the query reads both ways. Every identifier comes from a declaration
 * `rollupRejection` passed, and every member is one the column declares.
 */
export function rollupFilterSql(
  declaration: FormatDeclaration,
  each: RollupDeclaration,
  neighbours: readonly FormatDeclaration[],
  alias: string,
  skip: readonly string[] = [],
  today?: string,
  weekStart?: Weekday,
): string {
  const parts: string[] = []
  for (const filter of each.where) {
    if (skip.includes(filter.column)) continue
    const [first = '', second] = filter.column.split('.')
    const own = declaration.columns.find((one) => one.name === first)
    let column: ColumnDeclaration | undefined
    let sql: string
    if (second === undefined) {
      column = own
      sql = `${alias}.${quoteIdentifier(column === undefined ? first : (storedColumnsOf(column)[0] ?? first))}`
    } else {
      const target = own?.target === declaration.name ? declaration : neighbours.find((one) => one.name === own?.target)
      column = target?.columns.find((one) => one.name === second)
      const read = quoteIdentifier(column === undefined ? second : (storedColumnsOf(column)[0] ?? second))
      sql = `(SELECT h.${read} FROM ${quoteIdentifier(tableNameFor(target ?? { name: own?.target ?? '' }))} AS h WHERE h.${quoteIdentifier(ROW_ID_COLUMN)} = ${alias}.${quoteIdentifier(first)})`
    }
    const members = filterMembers(filter).map((member) =>
      column?.type === 'boolean' ? (member === 'true' ? '1' : '0') : quoteLiteral(member),
    )
    parts.push(filterConditionSql(sql, filter, members, false, today, weekStart))
  }
  return parts.length === 0 ? '1 = 1' : parts.join(' AND ')
}

/* ------------------------------------------------------------- a rollup */

/** The months a rollup is asked for, both ends included, as `YYYY-MM`. */
export interface RollupRange {
  readonly from?: string | undefined
  readonly to?: string | undefined
  /** `YYYY-MM-DD`, for a filter that reads the day (D-472) — the asking runtime's. */
  readonly today?: string | undefined
  /** The document's first day of the week, for `this week` (D-528) — Monday when not said. */
  readonly weekStart?: Weekday | undefined
}

/**
 * A rollup as one `GROUP BY` (M25 E2, D-271) — the aliases are
 * `RollupQueryRow`'s.
 *
 * Grouped by the month, the link and, for money, the currency: a sum across
 * two currencies is not a figure. A row a filter cannot decide is kept in its
 * group and counted as `silent`, as is a row with nothing to fold, so the group
 * can say it is unchecked rather than quietly smaller (D-138). One hop for a
 * filter is a `LEFT JOIN` onto the linked table, and a link that is empty
 * leaves the hop's column `NULL` — undecided, and so silent, too.
 *
 * Every identifier comes from a declaration `rollupRejection` passed, and the
 * members and months are bound parameters; nothing a person typed is spliced.
 */
export function rollupQuerySql(
  declaration: FormatDeclaration,
  each: RollupDeclaration,
  neighbours: readonly FormatDeclaration[],
  range: RollupRange = {},
): { readonly sql: string; readonly params: readonly (string | number)[] } {
  const row = (name: string): string => `"row".${quoteIdentifier(name)}`
  const params: (string | number)[] = []

  const periods = [each.period.column, ...(each.period.fallback === undefined ? [] : [each.period.fallback])]
  const basis = periods.length === 1 ? row(periods[0] ?? '') : `COALESCE(${periods.map(row).join(', ')})`
  const period = each.period.truncate ? `substr(${basis}, 1, 7)` : basis

  const figure = declaration.columns.find((column) => column.name === each.of)
  const money = figure?.type === 'money'
  // A derived figure is read off the rows its view's SQL makes (M29 U4,
  // D-335): the same `SELECT`, so the hours a rollup sums are the hours each
  // row shows.
  const worked =
    figure === undefined && each.of !== '' && (declaration.derived ?? []).some((one) => one.name === each.of)
      ? derivedSelectSql(declaration, neighbours.filter((one) => one.name !== declaration.name), true, range.today)
      : undefined
  const figureSql =
    figure !== undefined
      ? row(money ? moneyColumnNames(figure).minor : figure.name)
      : worked !== undefined
        ? row(each.of)
        : undefined
  const currency = money && figure !== undefined ? row(moneyColumnNames(figure).currency) : 'NULL'

  const joins: string[] = []
  const deciders: { readonly sql: string; readonly filter: AggregateFilter; readonly members: readonly (string | number)[] }[] = []
  for (const filter of each.where) {
    const [first = '', second] = filter.column.split('.')
    let column: ColumnDeclaration | undefined
    let sql: string
    if (second === undefined) {
      column = declaration.columns.find((one) => one.name === first)
      // A money column's figure is its minor units, which is what is empty.
      sql = row(column === undefined ? first : (storedColumnsOf(column)[0] ?? first))
    } else {
      const link = declaration.columns.find((one) => one.name === first)
      const target =
        link?.target === declaration.name ? declaration : neighbours.find((one) => one.name === link?.target)
      column = target?.columns.find((one) => one.name === second)
      const alias = quoteIdentifier(`hop_${first}`)
      if (!joins.some((each) => each.includes(alias)) && target !== undefined) {
        joins.push(
          `LEFT JOIN ${quoteIdentifier(tableNameFor(target))} AS ${alias} ON ${alias}.${quoteIdentifier(ROW_ID_COLUMN)} = ${row(first)}`,
        )
      }
      sql = `${alias}.${quoteIdentifier(column === undefined ? second : (storedColumnsOf(column)[0] ?? second))}`
    }
    deciders.push({
      sql,
      filter,
      members: filterMembers(filter).map((member) =>
        column?.type === 'boolean' ? (member === 'true' ? 1 : 0) : member,
      ),
    })
  }

  // D-260's `is` keeps an empty cell, as silent; `is not` takes it, and an
  // empty test decides it (M36 U04, D-380).
  const where: string[] = []
  for (const decider of deciders) {
    where.push(filterConditionSql(decider.sql, decider.filter, decider.members.map(() => '?'), true, range.today, range.weekStart))
    params.push(...decider.members)
  }
  if (range.from !== undefined) {
    where.push(`${period} >= ?`)
    params.push(range.from)
  }
  if (range.to !== undefined) {
    where.push(`${period} <= ?`)
    params.push(range.to)
  }

  const silentWhen = [
    ...(figureSql === undefined ? [] : [`${figureSql} IS NULL`]),
    ...deciders.filter((decider) => undecidable(decider.filter)).map((decider) => `${decider.sql} IS NULL`),
  ]
  const silent = silentWhen.length === 0 ? '0' : silentWhen.join(' OR ')
  const fold =
    figureSql === undefined
      ? 'NULL'
      : each.kind === 'SUM'
        ? `SUM(${figureSql})`
        : each.kind === 'AVERAGE'
          ? `AVG(${figureSql})`
          : each.kind === 'MINIMUM'
            ? `MIN(${figureSql})`
            : each.kind === 'MAXIMUM'
              ? `MAX(${figureSql})`
              : 'NULL'
  const by = each.by === undefined ? 'NULL' : row(each.by)
  const id = row(ROW_ID_COLUMN)

  const sql = [
    `SELECT ${period} AS "period", ${by} AS "by", ${currency} AS "currency",`,
    `       ${fold} AS "figure", COUNT(*) AS "rows",`,
    `       SUM(CASE WHEN ${silent} THEN 1 ELSE 0 END) AS "silent",`,
    `       MIN(CASE WHEN ${silent} THEN ${id} END) AS "silent_row"`,
    `  FROM ${worked === undefined ? quoteIdentifier(tableNameFor(declaration)) : `(${worked})`} AS "row"`,
    ...joins.map((join) => `  ${join}`),
    ...(where.length === 0 ? [] : [` WHERE ${where.join('\n   AND ')}`]),
    ` GROUP BY 1, 2, 3`,
    ` ORDER BY 1, 2, 3`,
  ].join('\n')
  return { sql, params }
}
