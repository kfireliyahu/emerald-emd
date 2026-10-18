/**
 * Rows of a declared table — reading, writing, correcting and removing them
 * (M19 U2, D-217).
 *
 * The one place SQL is written against a `fmt_` table, and every identifier in
 * it comes from a declaration the document itself holds: a table name from
 * `tableNameFor`, a column name from `storedColumnsOf`, both already matched
 * against `NAME_PATTERN` before they were stored and quoted again on the way
 * out. **Every value is bound, never interpolated.** There is no path from a
 * caller's string to an executed clause, which is the same discipline as the
 * rest of the model surface: what may arrive from outside is a mapping or a
 * value, never a program (D-137).
 *
 * ## Why the filters are this small
 *
 * `match`, `search`, `order` and `limit`, and nothing else. It is a deliberate
 * floor rather than a first instalment: the alternative to a shaped filter is a
 * general query, and D-095 closed that for reasons that did not stop applying
 * because the table is one the user declared. A question none of these four can
 * ask is a request for another shaped filter, decided on its own merits — a
 * window of days (D-472) was one, and a money or quantity column held to a
 * range in one currency or unit (M37 U4) another.
 *
 * ## Why nothing here reconciles
 *
 * `reconcileFormats` makes a table match its declaration and is the document
 * store's business (D-216, and D-094 before it). These functions assume a
 * settled table and their callers check: a row written through a declaration
 * the table has not caught up with would be a row with a column missing from
 * it and nobody told.
 */

import type { Database } from 'sql.js'

import {
  isLinkType,
  isListType,
  labelColumn,
  MEMBER_COLUMNS,
  memberColumnOf,
  memberTableNameFor,
  moneyColumnNames,
  quantityColumnNames,
  ROW_ID_COLUMN,
  storedColumnsOf,
  tableNameFor,
  type ColumnDeclaration,
  type FormatDeclaration,
} from '@/domain/format/declaration.ts'
import { constraintText } from '@/domain/format/constraint.ts'
import { derivedValueSql } from '@/domain/format/derived.ts'
import { rangeSql, type DateRange } from '@/domain/format/clock.ts'
import { PERCENT_PLACES } from '@/domain/format/percent.ts'
import { quoteIdentifier } from '@/domain/format/ddl.ts'
import { idsIn, type StoredRow, type StoredValue } from '@/domain/format/row.ts'
import { newId } from '@/core/id.ts'
import { MINOR_DIGITS_BY_CURRENCY } from '@/core/money.ts'
import { inTransaction, query } from '../db/database.ts'

/**
 * What to show of a declared table.
 *
 * Every field is optional and an absent one is not a filter. `match` is exact
 * equality on a stored cell — case-insensitively for the text-shaped types,
 * because a name typed back from a conversation will not match the packet's
 * capitalisation and the user does not think of that as a different value.
 */
export interface RowQuery {
  /**
   * Stored column name to the cell it must equal — or, held to several, to any
   * of them, or to none of them (M37 U3): a `HeldTo`.
   */
  readonly match?: ReadonlyMap<string, StoredValue | HeldTo>
  /**
   * A date column — or a computed date — to the days it must fall in, both
   * ends taken: a window around today already worked out by `filterQuery`
   * (M49 U2, D-472). An empty date falls in none.
   */
  readonly windows?: ReadonlyMap<string, DateRange>
  /**
   * A money or quantity column to the range its figure must fall in, in one
   * currency or unit (M37 U4): `filterQuery`'s reading of `10..50 ILS`, its
   * ends already in what the column stores — minor units for money.
   */
  readonly ranges?: ReadonlyMap<string, FigureRange>
  /**
   * The asking runtime's day, `YYYY-MM-DD`, for a computed column that reads
   * `today` — sorted or held by its value (D-472).
   */
  readonly today?: string
  /** A substring, looked for in every column as it is shown — see `searchedText`. */
  readonly search?: string
  /**
   * The document's formats, so a search can read a link by what the row it
   * names is called. Without them a link column is not searched.
   */
  readonly formats?: readonly FormatDeclaration[]
  /**
   * A stored column to order by — or a computed one (M49 U1, D-471), in the
   * SQL its view is, which needs `formats` when it reads across a link.
   */
  readonly order?: string
  readonly descending?: boolean
  readonly limit?: number
  readonly offset?: number
}

/**
 * **A column held to several values, or turned round** (M37 U3, D-476): the
 * row's cell is any of `values` — `null` among them is the empty cell — or,
 * `not`, none of them, and then an empty cell passes unless `null` is one of
 * them: D-380's `is one of`, `is not one of`, `is empty` and `is not empty`,
 * which a declared filter already said. A list column (`links`, `enums`) is
 * held by whether it lists any of them, and `null` is a list with nothing in it.
 * Compiled to one `IN`, never a re-filter of rows already read.
 */
export interface HeldTo {
  readonly values: readonly (string | number | null)[]
  readonly not?: boolean | undefined
}

/**
 * **A figure held between two ends, in one currency or unit** (M37 U4): both
 * ends taken, either left open. A row in another currency or unit, or with no
 * figure, falls outside it.
 */
export interface FigureRange {
  readonly unit: string
  readonly from?: number | undefined
  readonly to?: number | undefined
}

/** Whether a held value is several (or turned round) rather than one cell. */
export function isHeldTo(value: StoredValue | HeldTo): value is HeldTo {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** How many rows a query would find, before any limit is applied. */
export function countRows(db: Database, declaration: FormatDeclaration, query_: RowQuery = {}): number {
  const where = whereClause(declaration, query_)
  const rows = query(
    db,
    `SELECT COUNT(*) AS found FROM ${quoteIdentifier(tableNameFor(declaration))}${where.sql}`,
    sqlBindings(where.bindings),
  )
  const found = rows[0]?.['found']
  return typeof found === 'number' ? found : 0
}

/** The rows themselves, in the order asked for. */
export function listRows(
  db: Database,
  declaration: FormatDeclaration,
  query_: RowQuery = {},
): readonly StoredRow[] {
  const stored = storedColumnsFor(declaration)
  const where = whereClause(declaration, query_)

  const order = orderClause(declaration, query_)
  const limit = query_.limit === undefined ? '' : ` LIMIT ${Math.max(0, Math.floor(query_.limit))}`
  const offset =
    query_.offset === undefined || query_.offset <= 0
      ? ''
      : ` OFFSET ${Math.floor(query_.offset)}`

  const rows = query(
    db,
    `SELECT ${stored.map(quoteIdentifier).join(', ')} FROM ` +
      `${quoteIdentifier(tableNameFor(declaration))}${where.sql}${order}${limit}${offset}`,
    sqlBindings(where.bindings),
  ).map((row) => toStoredRow(stored, row))
  return withMembers(db, declaration, rows)
}

/**
 * **One value of a column and how many rows hold it** (M37 U4). `value` is the
 * stored cell — an id for a link, a member for a list, the currency or unit
 * for money and a quantity, with that figure's `least` and `most` — and `null`
 * is the empty cell, or a list with nothing in it.
 */
export interface ValueCount {
  readonly value: string | number | null
  readonly count: number
  readonly least?: number | undefined
  readonly most?: number | undefined
}

/**
 * **What one column holds among the rows a query finds, counted** (M37 U4):
 * `GROUP BY` over the same `WHERE` `listRows` and `countRows` read, so a count
 * is the rows that holding the column to that value would leave — never a list
 * of rows tallied afterwards. Text is grouped folded, as `match` compares it,
 * the spelling shown being one of the group's; a list column counts the rows
 * listing each member; money and a quantity count per currency or unit, with
 * the least and most figure in each.
 */
export function valueCounts(
  db: Database,
  declaration: FormatDeclaration,
  column: ColumnDeclaration,
  query_: RowQuery = {},
): readonly ValueCount[] {
  const table = quoteIdentifier(tableNameFor(declaration))
  const where = whereClause(declaration, query_)
  const bound = sqlBindings(where.bindings)
  const counted = (rows: readonly Record<string, unknown>[]): ValueCount[] =>
    rows.map((row) => {
      const value = row['value']
      const least = row['least']
      const most = row['most']
      return {
        value: typeof value === 'string' || typeof value === 'number' ? value : null,
        count: typeof row['found'] === 'number' ? row['found'] : 0,
        ...(typeof least === 'number' ? { least } : {}),
        ...(typeof most === 'number' ? { most } : {}),
      }
    })

  if (isListType(column.type)) {
    const members = quoteIdentifier(memberTableNameFor(declaration, column))
    const row = quoteIdentifier(MEMBER_COLUMNS.row)
    const id = quoteIdentifier(ROW_ID_COLUMN)
    const found = `SELECT ${id} FROM ${table}${where.sql}`
    const listed = query(
      db,
      `SELECT ${quoteIdentifier(memberColumnOf(column))} AS value, COUNT(DISTINCT ${row}) AS found ` +
        `FROM ${members} WHERE ${row} IN (${found}) GROUP BY value`,
      bound,
    )
    const none = query(
      db,
      `SELECT COUNT(*) AS found FROM ${table}${where.sql === '' ? ' WHERE ' : `${where.sql} AND `}${id} NOT IN (SELECT ${row} FROM ${members})`,
      bound,
    )
    const empty = typeof none[0]?.['found'] === 'number' ? none[0]['found'] : 0
    return [...counted(listed), ...(empty === 0 ? [] : [{ value: null, count: empty }])]
  }

  if (column.type === 'money' || column.type === 'quantity') {
    const [figure, unit] =
      column.type === 'money'
        ? [moneyColumnNames(column).minor, moneyColumnNames(column).currency]
        : [quantityColumnNames(column).amount, quantityColumnNames(column).unit]
    return counted(
      query(
        db,
        `SELECT ${quoteIdentifier(unit)} AS value, COUNT(*) AS found, MIN(${quoteIdentifier(figure)}) AS least, ` +
          `MAX(${quoteIdentifier(figure)}) AS most FROM ${table}${where.sql} GROUP BY value`,
        bound,
      ),
    )
  }

  const cell = quoteIdentifier(column.name)
  return counted(
    query(
      db,
      `SELECT MIN(${cell}) AS value, COUNT(*) AS found FROM ${table}${where.sql} ` +
        `GROUP BY CASE WHEN typeof(${cell}) = 'text' THEN LOWER(${cell}) ELSE ${cell} END`,
      bound,
    ),
  )
}

/**
 * Whether a column holds a passage anywhere — a value longer than `longest`, or
 * one with a line break: a thing to search, not to list (M37 U4).
 */
export function holdsPassages(db: Database, declaration: FormatDeclaration, column: ColumnDeclaration, longest: number): boolean {
  if (isListType(column.type) || column.type === 'money' || column.type === 'quantity') return false
  const cell = quoteIdentifier(column.name)
  return (
    query(
      db,
      `SELECT 1 AS found FROM ${quoteIdentifier(tableNameFor(declaration))} WHERE typeof(${cell}) = 'text' ` +
        `AND (LENGTH(${cell}) > ? OR INSTR(${cell}, char(10)) > 0) LIMIT 1`,
      [longest],
    ).length > 0
  )
}

/**
 * Rows with each `links` column's members put in their cells, in order (M27
 * U2, D-300) — read from the column's own table in one query per column and
 * chunk, never one per row. A row with none holds an empty list.
 */
export function withMembers(
  db: Database,
  declaration: FormatDeclaration,
  rows: readonly StoredRow[],
): readonly StoredRow[] {
  // And each `enums` column's, which are words of its list (M34 U5, D-398).
  const lists = declaration.columns.filter((column) => isListType(column.type))
  if (lists.length === 0 || rows.length === 0) return rows
  const found = new Map<string, Map<string, string[]>>()
  const ids = rows.map((row) => row.id)
  for (const column of lists) {
    const byRow = new Map<string, string[]>()
    for (let start = 0; start < ids.length; start += LINK_CHUNK) {
      const chunk = ids.slice(start, start + LINK_CHUNK)
      for (const member of query(
        db,
        `SELECT ${quoteIdentifier(MEMBER_COLUMNS.row)} AS row_id, ${quoteIdentifier(memberColumnOf(column))} AS member_id ` +
          `FROM ${quoteIdentifier(memberTableNameFor(declaration, column))} ` +
          `WHERE ${quoteIdentifier(MEMBER_COLUMNS.row)} IN (${chunk.map(() => '?').join(', ')}) ` +
          `ORDER BY ${quoteIdentifier(MEMBER_COLUMNS.row)}, ${quoteIdentifier(MEMBER_COLUMNS.position)}`,
        chunk,
      )) {
        const owner = String(member['row_id'])
        const list = byRow.get(owner) ?? []
        list.push(String(member['member_id']))
        byRow.set(owner, list)
      }
    }
    found.set(column.name, byRow)
  }
  return rows.map((row) => ({
    id: row.id,
    cells: {
      ...row.cells,
      ...Object.fromEntries(lists.map((column) => [column.name, found.get(column.name)?.get(row.id) ?? []])),
    },
  }))
}

/**
 * Replace one row's members of every `links` column `cells` names — the whole
 * list, in the order given, since an edit to a list is the list it leaves.
 */
function writeMembers(
  db: Database,
  declaration: FormatDeclaration,
  id: string,
  cells: Readonly<Record<string, StoredValue>>,
): void {
  for (const column of declaration.columns) {
    if (!isListType(column.type) || !(column.name in cells)) continue
    const table = quoteIdentifier(memberTableNameFor(declaration, column))
    db.run(`DELETE FROM ${table} WHERE ${quoteIdentifier(MEMBER_COLUMNS.row)} = ?`, [id])
    const members = [...new Set(idsIn(cells[column.name]))]
    members.forEach((member, position) => {
      db.run(
        `INSERT INTO ${table} (${quoteIdentifier(MEMBER_COLUMNS.row)}, ${quoteIdentifier(memberColumnOf(column))}, ` +
          `${quoteIdentifier(MEMBER_COLUMNS.position)}) VALUES (?, ?, ?)`,
        [id, member, position],
      )
    })
  }
}

/** A list is never bound — it is a table of its own — so a binding is a scalar. */
function sqlBindings(values: readonly StoredValue[]): (string | number | null)[] {
  return values.map((value) => (typeof value === 'string' || typeof value === 'number' ? value : null))
}

/**
 * What the rows a link *points at* are called, for every link in this batch.
 *
 * **A link stores a generated id and nothing else** — which is right, because a
 * name is a column somebody may edit and an identity must not move when they do
 * — but it means a reader is handed
 * `supersedes: 0c0af4de-6da3-4935-9201-54246964ddca` where they expect
 * `D-232`. M22 U1 found that against this project's own memory, and it is the
 * engine's problem rather than that document's: it lands the first time anybody
 * declares two formats that point at each other.
 *
 * **Resolved by the ids actually referenced rather than by reading the target
 * whole.** The pickers this rule came from take the first page of the target
 * and accept missing the rest, which is fine when a person is choosing from a
 * list and wrong when they are reading a row: the one row a link names is the
 * one that must resolve, whether it is the third of three or the four
 * thousandth.
 *
 * One flat map across every link column, because an id is unique across the
 * whole document and a map per column would be the same entries under more
 * keys. An id with no entry is a link whose row is gone — `danglingLinks` is
 * what says so; this only declines to invent a name for it.
 */
export function linkLabels(
  db: Database,
  rows: readonly StoredRow[],
  declaration: FormatDeclaration,
  declared: readonly FormatDeclaration[],
): ReadonlyMap<string, string> {
  const labels = new Map<string, string>()
  if (rows.length === 0) return labels

  for (const column of declaration.columns) {
    if (!isLinkType(column.type) || column.target === undefined) continue
    const target = declared.find((each) => each.name === column.target)
    if (target === undefined) continue
    const naming = labelColumn(target)
    if (naming === undefined) continue

    // A `links` cell is several ids (M27 U2, D-300), each named the same way.
    const wanted = [...new Set(rows.flatMap((row) => idsIn(row.cells[column.name])))].filter(
      (id) => !labels.has(id),
    )
    if (wanted.length === 0) continue

    // Identifiers come from the declaration and every value is bound, which is
    // this file's whole discipline — a caller's string never reaches a clause.
    const found = query(
      db,
      `SELECT ${quoteIdentifier(ROW_ID_COLUMN)}, ${quoteIdentifier(naming.name)} FROM ` +
        `${quoteIdentifier(tableNameFor(target))} WHERE ${quoteIdentifier(ROW_ID_COLUMN)} IN ` +
        `(${wanted.map(() => '?').join(', ')})`,
      wanted,
    )
    for (const row of found) {
      const id = row[ROW_ID_COLUMN]
      const label = row[naming.name]
      if (typeof id !== 'string') continue
      if (typeof label !== 'string' || label === '') continue
      labels.set(id, label)
    }
  }
  return labels
}

/** One row by the identity the document gave it, or nothing. */
export function readRow(
  db: Database,
  declaration: FormatDeclaration,
  id: string,
): StoredRow | undefined {
  const stored = storedColumnsFor(declaration)
  const rows = query(
    db,
    `SELECT ${stored.map(quoteIdentifier).join(', ')} FROM ` +
      `${quoteIdentifier(tableNameFor(declaration))} WHERE ${quoteIdentifier(ROW_ID_COLUMN)} = ?`,
    [id],
  )
  const row = rows[0]
  return row === undefined ? undefined : withMembers(db, declaration, [toStoredRow(stored, row)])[0]
}


/**
 * Write rows, and give each the identity U4b's links will name.
 *
 * The ids are returned in the order the cells came in, because a caller that
 * just wrote thirty rows is the one caller who can still say which is which,
 * and asking it to search for them afterwards is a round trip for something
 * this function already knows.
 *
 * **`ids` is for the one caller whose ids must not be random** (M22 U6, D-247):
 * a document read from text has no ids in the file and mints them here, so
 * drawing them at random would give the same file a different identity on every
 * open. `formatDocumentRepository` derives them from the rows instead. Every
 * other caller leaves this out and gets `newId`.
 */
export function insertRows(
  db: Database,
  declaration: FormatDeclaration,
  rows: readonly Readonly<Record<string, StoredValue>>[],
  ids?: readonly string[],
): readonly string[] {
  const stored = declaration.columns.flatMap(storedColumnsOf)
  const columns = [ROW_ID_COLUMN, ...stored]
  const sql =
    `INSERT INTO ${quoteIdentifier(tableNameFor(declaration))} ` +
    `(${columns.map(quoteIdentifier).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`

  // One statement for the batch: compiling the insert again for every row was
  // most of what sixty thousand of them cost (M25 U3).
  return inTransaction(db, () => {
    const statement = db.prepare(sql)
    try {
      return rows.map((cells, at) => {
        const id = ids?.[at] ?? newId()
        statement.run(sqlBindings([id, ...stored.map((name) => cells[name] ?? null)]))
        writeMembers(db, declaration, id, cells)
        return id
      })
    } finally {
      statement.free()
    }
  })
}

/**
 * Change the cells named and leave the rest alone.
 *
 * Returns whether the row was there. A caller asking to edit a row that is gone
 * has a stale id rather than a failed write, and it is the difference between
 * "nothing changed" and "something is wrong" that the answer has to carry.
 */
export function updateRow(
  db: Database,
  declaration: FormatDeclaration,
  id: string,
  cells: Readonly<Record<string, StoredValue>>,
): boolean {
  const names = Object.keys(cells)
  if (names.length === 0) return readRow(db, declaration, id) !== undefined

  releaseSeeds(db, declaration, [id], 'EDITED', cells)
  // A `links` column is its own table (M27 U2, D-300), so it is not a column
  // the `UPDATE` can set.
  const lists = new Set(declaration.columns.filter((column) => isListType(column.type)).map((column) => column.name))
  const scalars = names.filter((name) => !lists.has(name))
  if (scalars.length < names.length) {
    if (readRow(db, declaration, id) === undefined) return false
    writeMembers(db, declaration, id, cells)
    if (scalars.length === 0) return true
  }
  const assignments = scalars.map((name) => `${quoteIdentifier(name)} = ?`).join(', ')
  db.run(
    `UPDATE ${quoteIdentifier(tableNameFor(declaration))} SET ${assignments} ` +
      `WHERE ${quoteIdentifier(ROW_ID_COLUMN)} = ?`,
    sqlBindings([...scalars.map((name) => cells[name] ?? null), id]),
  )
  return db.getRowsModified() > 0 || scalars.length < names.length
}

/** A row the table itself would not take, by its place in the rows asked about. */
export interface TableRefusal {
  readonly at: number
  /** The declared column SQLite named, when it named one. */
  readonly column: string | undefined
  readonly reason: string
}

/**
 * **What the table itself would say to these rows** — asked by writing them and
 * taking the write back (M29 F2, D-343).
 *
 * Every check before this one is the engine's reading of the declaration, and
 * a write that passed them all once threw from inside `mutate`, where a button
 * press has nobody to tell: Add was pressed and *"nothing happened. not
 * even an error."* The table is the last word on what it holds, so it is asked
 * the same question the write will ask it, before the write — and a refusal
 * comes back as a row and a column like every other one.
 *
 * One dry run for the batch; only when that is refused is each row asked alone,
 * to say which. `{ existing }` asks about an edit of that row instead.
 */
export function tableRefusals(
  db: Database,
  declaration: FormatDeclaration,
  rows: readonly Readonly<Record<string, StoredValue>>[],
  /** The ids the rows will be written under, or the one row being edited. */
  ids?: { readonly drawn: readonly string[] } | { readonly existing: string },
): readonly TableRefusal[] {
  const write = (batch: readonly Readonly<Record<string, StoredValue>>[], from: number): void => {
    if (ids !== undefined && 'existing' in ids) {
      for (const cells of batch) updateRow(db, declaration, ids.existing, cells)
    } else insertRows(db, declaration, batch, ids?.drawn.slice(from, from + batch.length))
  }
  // A document open read-only (the plugin's dry run, D-094) cannot be asked
  // this way; its commit opens it writable and asks then.
  if (rows.length === 0 || isQueryOnly(db) || dryRun(db, () => write(rows, 0)) === undefined) return []
  const refusals: TableRefusal[] = []
  rows.forEach((cells, at) => {
    const error = dryRun(db, () => write([cells], at))
    if (error !== undefined) refusals.push({ at, ...describeTableError(declaration, error) })
  })
  // Each alone is taken and together they are not — say so of the first rather
  // than nothing of any.
  if (refusals.length === 0) {
    const error = dryRun(db, () => write(rows, 0))
    if (error !== undefined) refusals.push({ at: 0, ...describeTableError(declaration, error) })
  }
  return refusals
}

function isQueryOnly(db: Database): boolean {
  return db.exec('PRAGMA query_only')[0]?.values[0]?.[0] === 1
}

/** Taken back whatever happened: a write's error, or nothing when it would have stood. */
const TAKEN_BACK = Symbol('taken back')
function dryRun(db: Database, work: () => void): unknown {
  try {
    inTransaction(db, () => {
      work()
      throw TAKEN_BACK
    })
  } catch (error) {
    return error === TAKEN_BACK ? undefined : error
  }
  return undefined
}

/**
 * SQLite's refusal, as the declared column it is about and a sentence.
 *
 * SQLite names the stored column — `CHECK constraint failed: start_hour`,
 * `NOT NULL constraint failed: fmt_shift.price_minor` — so a money's or a
 * quantity's half is read back to the column that was declared.
 */
export function describeTableError(
  declaration: FormatDeclaration,
  error: unknown,
): { readonly column: string | undefined; readonly reason: string } {
  const message = error instanceof Error ? error.message : String(error)
  const words = new Set(message.split(/[^A-Za-z0-9_]+/))
  const column = declaration.columns.find((each) => storedColumnsOf(each).some((name) => words.has(name)))
  return {
    column: column?.name,
    reason: `The document’s table would not take ${column === undefined ? 'this row' : column.name} (${message}).`,
  }
}

/**
 * The rows of one format that name, through one link column, rows about to be
 * removed (M24 U11, D-263).
 */
export interface LinkingRows {
  readonly format: FormatDeclaration
  readonly column: string
  /** A removed row's id to how many rows name it through this column. */
  readonly counts: ReadonlyMap<string, number>
}

/**
 * Every link that removing these rows would leave naming nothing.
 *
 * A row that is itself among `ids` does not count: a batch that takes a row
 * and the row that links to it away together leaves nothing dangling. Ids are
 * sent in chunks so a reading's thousand lines stay under SQLite's bound limit.
 */
export function rowsLinkingTo(
  db: Database,
  declaration: FormatDeclaration,
  ids: readonly string[],
  formats: Iterable<FormatDeclaration>,
): readonly LinkingRows[] {
  const going = new Set(ids)
  const found: LinkingRows[] = []
  if (going.size === 0) return found

  for (const format of formats) {
    for (const column of format.columns) {
      if (!isLinkType(column.type) || column.target !== declaration.name) continue

      const counts = new Map<string, number>()
      for (let start = 0; start < ids.length; start += LINK_CHUNK) {
        const chunk = ids.slice(start, start + LINK_CHUNK)
        // A member of a `links` list names a row as surely as a link does, so
        // deleting it is refused the same way (M27 U2, D-300): a list that
        // quietly lost a member is the sum that skipped a row.
        const rows = query(
          db,
          column.type === 'links'
            ? `SELECT ${quoteIdentifier(MEMBER_COLUMNS.row)} AS id, ${quoteIdentifier(MEMBER_COLUMNS.member)} AS target ` +
                `FROM ${quoteIdentifier(memberTableNameFor(format, column))} WHERE ${quoteIdentifier(MEMBER_COLUMNS.member)} IN ` +
                `(${chunk.map(() => '?').join(', ')})`
            : `SELECT ${quoteIdentifier(ROW_ID_COLUMN)} AS id, ${quoteIdentifier(column.name)} AS target ` +
                `FROM ${quoteIdentifier(tableNameFor(format))} WHERE ${quoteIdentifier(column.name)} IN ` +
                `(${chunk.map(() => '?').join(', ')})`,
          chunk,
        )
        for (const row of rows) {
          if (format.name === declaration.name && going.has(String(row['id']))) continue
          const target = String(row['target'])
          counts.set(target, (counts.get(target) ?? 0) + 1)
        }
      }
      if (counts.size > 0) found.push({ format, column: column.name, counts })
    }
  }
  return found
}

const LINK_CHUNK = 500

/**
 * What `rowsLinkingTo` found, as sentences — one per linking column, each row
 * named by its label where it has one. The same words on the screen and in a
 * conversation, because they are the same refusal.
 */
export function linkingSentences(
  db: Database,
  declaration: FormatDeclaration,
  linking: readonly LinkingRows[],
): readonly string[] {
  const naming = labelColumn(declaration)
  const nameOf = (id: string): string => {
    const cell = naming === undefined ? undefined : readRow(db, declaration, id)?.cells[naming.name]
    return typeof cell === 'string' && cell !== '' ? `“${cell}”` : id
  }
  return linking.map(({ format, column, counts }) => {
    const total = [...counts.values()].reduce((sum, each) => sum + each, 0)
    const named = [...counts]
      .map(([id, count]) => (counts.size === 1 ? nameOf(id) : `${nameOf(id)} (${String(count)})`))
      .join(', ')
    return `${String(total)} ${total === 1 ? 'row' : 'rows'} of ${format.title} name ${named} through ${column}.`
  })
}

/**
 * Refused: removing these rows would leave links naming nothing (D-263).
 *
 * Thrown by `deleteRows` rather than returned, so a caller that forgot to ask
 * first cannot delete through it — the rule lives in the one write both halves
 * share, not in each of them.
 */
export class LinkedRowsError extends Error {
  constructor(
    readonly declaration: FormatDeclaration,
    readonly linking: readonly LinkingRows[],
    sentences: readonly string[],
  ) {
    super(
      `Nothing was removed from ${declaration.title}: other rows still link to it. ` +
        `${sentences.join(' ')} Re-link or clear those first; nothing is removed on anybody’s behalf.`,
    )
  }
}

/**
 * Remove rows by id. Returns the ids that were actually there.
 *
 * **Refused whole, with `LinkedRowsError`, while any row of `formats` still
 * links to one of them** (M24 U11, D-263). No foreign key would stop it — this
 * app never turns them on (D-067) — so a write refused a dangling link and a
 * delete made one silently. Cascading instead would be the same silent loss one
 * step removed, so the caller re-links or clears first.
 */
export function deleteRows(
  db: Database,
  declaration: FormatDeclaration,
  ids: readonly string[],
  /** Every format in the document; the ones whose links could dangle. */
  formats: Iterable<FormatDeclaration>,
): readonly string[] {
  const linking = rowsLinkingTo(db, declaration, ids, formats)
  if (linking.length > 0) {
    throw new LinkedRowsError(declaration, linking, linkingSentences(db, declaration, linking))
  }

  const sql =
    `DELETE FROM ${quoteIdentifier(tableNameFor(declaration))} ` +
    `WHERE ${quoteIdentifier(ROW_ID_COLUMN)} = ?`

  const lists = declaration.columns.filter((column) => isListType(column.type))
  return inTransaction(db, () => {
    releaseSeeds(db, declaration, ids, 'REMOVED')
    return ids.filter((id) => {
      // A removed row's own lists go with it: they are its cells.
      for (const column of lists) {
        db.run(
          `DELETE FROM ${quoteIdentifier(memberTableNameFor(declaration, column))} WHERE ${quoteIdentifier(MEMBER_COLUMNS.row)} = ?`,
          [id],
        )
      }
      db.run(sql, [id])
      return db.getRowsModified() > 0
    })
  })
}

/**
 * **A seeded row a person touches is theirs from then on** (M24 U12, D-264).
 *
 * Here and not in each caller, for D-263's reason: the screen, the tool and a
 * supersede all edit and remove through these two functions, so none of them
 * can forget. An edit deletes the record, and the pack never writes that row
 * again; a removal leaves `REMOVED`, so a reseed does not bring back a row
 * somebody took away. Read by the row's name *before* the write, because an
 * edit may be the rename.
 *
 * `format_seed` is otherwise `formatSeedRepository`'s; these two statements
 * are here because that file writes rows through this one.
 */
function releaseSeeds(
  db: Database,
  declaration: FormatDeclaration,
  ids: readonly string[],
  as: 'EDITED' | 'REMOVED',
  /** An edit's new cells: one that changes nothing is not an edit. */
  cells: Readonly<Record<string, StoredValue>> = {},
): void {
  const naming = labelColumn(declaration)
  if (naming === undefined) return
  const seeded = new Set(
    query(db, `SELECT seed_key FROM format_seed WHERE format_name = ? AND state = 'SEEDED'`, [
      declaration.name,
    ]).map((row) => String(row['seed_key'])),
  )
  if (seeded.size === 0) return

  for (const id of ids) {
    const row = readRow(db, declaration, id)
    const name = row?.cells[naming.name]
    if (typeof name !== 'string' || !seeded.has(name)) continue
    const unchanged = Object.entries(cells).every(([key, value]) => row?.cells[key] === value)
    if (as === 'EDITED' && unchanged) continue
    // **A rename takes the seed away** (M25 U2). With the record deleted, the
    // next seeding would find no record and no row by the seed's name, and add
    // the pack's row back beside the one the person renamed.
    const renamed = naming.name in cells && cells[naming.name] !== name
    db.run(
      as === 'EDITED' && !renamed
        ? 'DELETE FROM format_seed WHERE format_name = ? AND seed_key = ?'
        : `UPDATE format_seed SET state = 'REMOVED' WHERE format_name = ? AND seed_key = ?`,
      [declaration.name, name],
    )
  }
}

/** Every SQL column a declaration occupies, `id` first — the read order. */
/**
 * Every SQL column a declaration occupies, `id` included.
 *
 * Exported since U4b so the join reads a linked row with the same column list
 * this file writes one with — two of these would eventually disagree about a
 * money pair, in a figure nobody was checking.
 */
export function storedColumnsFor(declaration: FormatDeclaration): readonly string[] {
  return [ROW_ID_COLUMN, ...declaration.columns.flatMap(storedColumnsOf)]
}

function toStoredRow(
  stored: readonly string[],
  row: Readonly<Record<string, unknown>>,
): StoredRow {
  const cells: Record<string, StoredValue> = {}
  for (const name of stored) {
    if (name === ROW_ID_COLUMN) continue
    const value = row[name]
    cells[name] =
      typeof value === 'string' || typeof value === 'number' ? value : null
  }
  return { id: String(row[ROW_ID_COLUMN] ?? ''), cells }
}

/**
 * The filters, as one clause with its bindings.
 *
 * A `match` on a text-shaped column compares folded, and a `search` folds too —
 * `LOWER` rather than `COLLATE NOCASE`, because SQLite's built-in NOCASE folds
 * ASCII only and half the strings this app stores are Hebrew. `LOWER` folds no
 * more of them, but it folds the same amount on every column rather than
 * differing by how the column was declared.
 */
function whereClause(
  declaration: FormatDeclaration,
  query_: RowQuery,
): { readonly sql: string; readonly bindings: readonly StoredValue[] } {
  const conditions: string[] = []
  const bindings: StoredValue[] = []

  for (const [name, value] of query_.match ?? new Map<string, StoredValue | HeldTo>()) {
    const column = columnOf(declaration, name)
    // A computed date is held to a value in the SQL its view is (D-471).
    const quoted = (column === undefined ? computedSql(declaration, name, query_) : undefined) ?? quoteIdentifier(name)
    const held: HeldTo = isHeldTo(value)
      ? value
      : { values: [Array.isArray(value) ? (idsIn(value)[0] ?? null) : (value as string | number | null)] }
    const members = held.values.filter((each): each is string | number => each !== null)
    const empty = held.values.some((each) => each === null)
    if (members.length === 0 && !empty) {
      // Held to nothing at all: no row is any of none, and every row is none of them.
      if (held.not !== true) conditions.push('0 = 1')
      continue
    }
    const anyOf: string[] = []
    // **A `links` column matches a row that lists the one named** (M27 U2,
    // D-300) — membership, since a list equal to one id is not the question
    // anybody asks — and `null` matches a row whose list is empty.
    // So does an `enums` column, a row holding the one member named (M34 U5,
    // D-398) — `match:{tags: vegan}` is the recipes tagged vegan. Several named
    // is a row listing any of them (M37 U3).
    if (column !== undefined && isListType(column.type)) {
      const table = quoteIdentifier(memberTableNameFor(declaration, column))
      const row = quoteIdentifier(MEMBER_COLUMNS.row)
      if (members.length > 0) {
        anyOf.push(
          `${quoteIdentifier(ROW_ID_COLUMN)} IN (SELECT ${row} FROM ${table} WHERE ` +
            `${quoteIdentifier(memberColumnOf(column))} IN (${members.map(() => '?').join(', ')}))`,
        )
        bindings.push(...members.map(String))
      }
      if (empty) anyOf.push(`${quoteIdentifier(ROW_ID_COLUMN)} NOT IN (SELECT ${row} FROM ${table})`)
    } else {
      // Text compares folded, a figure as itself; an empty cell is `IS NULL`.
      const texts = members.filter((each): each is string => typeof each === 'string')
      const figures = members.filter((each): each is number => typeof each === 'number')
      if (texts.length > 0) {
        anyOf.push(`LOWER(${quoted}) IN (${texts.map(() => 'LOWER(?)').join(', ')})`)
        bindings.push(...texts)
      }
      if (figures.length > 0) {
        anyOf.push(`${quoted} IN (${figures.map(() => '?').join(', ')})`)
        bindings.push(...figures)
      }
      if (empty) anyOf.push(`${quoted} IS NULL`)
    }
    const either = anyOf.length === 1 ? (anyOf[0] ?? '') : `(${anyOf.join(' OR ')})`
    // **`is not` lets an empty cell through** (D-380): the comparison is unknown
    // there, and an uncategorised line is not a transfer — so it is read as no.
    conditions.push(held.not === true ? `NOT COALESCE(${either}, 0)` : either)
  }

  for (const [name, range] of query_.windows ?? new Map<string, DateRange>()) {
    const quoted = (columnOf(declaration, name) === undefined ? computedSql(declaration, name, query_) : undefined) ?? quoteIdentifier(name)
    const window = rangeSql(quoted, range)
    conditions.push(window.sql)
    bindings.push(...window.bindings)
  }

  for (const [name, range] of query_.ranges ?? new Map<string, FigureRange>()) {
    const column = columnOf(declaration, name)
    if (column === undefined || (column.type !== 'money' && column.type !== 'quantity')) continue
    const [figure, unit] =
      column.type === 'money'
        ? [moneyColumnNames(column).minor, moneyColumnNames(column).currency]
        : [quantityColumnNames(column).amount, quantityColumnNames(column).unit]
    conditions.push(`${quoteIdentifier(unit)} = ?`)
    bindings.push(range.unit)
    if (range.from !== undefined) {
      conditions.push(`${quoteIdentifier(figure)} >= ?`)
      bindings.push(range.from)
    }
    if (range.to !== undefined) {
      conditions.push(`${quoteIdentifier(figure)} <= ?`)
      bindings.push(range.to)
    }
  }

  const search = query_.search?.trim()
  if (search !== undefined && search !== '') {
    const searchable = declaration.columns
      .map((column) => searchedText(column, query_.formats ?? [], declaration))
      .filter((expression): expression is string => expression !== undefined)
    if (searchable.length === 0) {
      // Nothing to look in is not the same as nothing matching, and answering
      // "no rows" to a search over a format with nothing searchable would read
      // as the data being absent rather than the question being unanswerable.
      conditions.push('0 = 1')
    } else {
      conditions.push(
        `(${searchable.map((expression) => `LOWER(${expression}) LIKE LOWER(?) ESCAPE '\\'`).join(' OR ')})`,
      )
      for (const _ of searchable) bindings.push(`%${escapeLike(search)}%`)
    }
  }

  return {
    sql: conditions.length === 0 ? '' : ` WHERE ${conditions.join(' AND ')}`,
    bindings,
  }
}

/**
 * **A column as the text a search looks in — every column, as it is shown**
 * (M26 U2). Until then a search read the text and enum columns only, so a
 * date, a figure or a link on screen was a thing nobody could find.
 *
 * The expression renders what the table prints, so `12.9` finds a price shown
 * as `₪12.90` and `D-240` finds a row whose `supersedes` names it:
 *
 * - **money** is minor units beside a code; it is written back as major units
 *   with the currency's own digits (`core/money.ts`), and the code is searched
 *   too. Integer arithmetic only — no float enters the money path to be found.
 * - **decimal** is the integer times ten to its scale, written back the same way;
 *   a **percent** too, at its four places and with its sign (D-333).
 * - **a link** is searched by what the row it names is called — the target's
 *   `labelColumn`, one hop (D-224) — and needs the document's formats handed in;
 *   without them it is not searched rather than searched as an id nobody reads.
 *
 * **A yes/no column is not searched, and it is the only one.** It prints `yes`
 * or `no`, so a search for `e` or `o` would match every row that holds a value;
 * a filter on it is `match`, which is exact. Nothing on screen says so — the
 * column is simply not something a substring can mean.
 */
export function searchedText(
  column: ColumnDeclaration,
  formats: readonly FormatDeclaration[],
  declaration: FormatDeclaration,
): string | undefined {
  const quoted = quoteIdentifier(column.name)
  switch (column.type) {
    case 'links': {
      // Every member's name, as the list prints them (M27 U2, D-300).
      const target = formats.find((each) => each.name === column.target)
      const naming = target === undefined ? undefined : labelColumn(target)
      if (target === undefined || naming === undefined) return undefined
      const members = quoteIdentifier(memberTableNameFor(declaration, column))
      return (
        `(SELECT group_concat(t.${quoteIdentifier(naming.name)}, ', ') FROM ${members} AS m ` +
        `JOIN ${quoteIdentifier(tableNameFor(target))} AS t ON t.${quoteIdentifier(ROW_ID_COLUMN)} = m.${quoteIdentifier(MEMBER_COLUMNS.member)} ` +
        `WHERE m.${quoteIdentifier(MEMBER_COLUMNS.row)} = ${quoteIdentifier(tableNameFor(declaration))}.${quoteIdentifier(ROW_ID_COLUMN)})`
      )
    }
    case 'enums': {
      // Every member, as the list prints them (M34 U5, D-398).
      const members = quoteIdentifier(memberTableNameFor(declaration, column))
      return (
        `(SELECT group_concat(m.${quoteIdentifier(memberColumnOf(column))}, ', ') FROM ${members} AS m ` +
        `WHERE m.${quoteIdentifier(MEMBER_COLUMNS.row)} = ${quoteIdentifier(tableNameFor(declaration))}.${quoteIdentifier(ROW_ID_COLUMN)})`
      )
    }
    case 'text':
    case 'enum':
    case 'date':
    case 'time':
    case 'month':
    case 'instant':
    case 'elsewhere':
    case 'file':
      return quoted
    case 'integer':
    case 'real':
      return figureText(quoted)
    case 'quantity':
      return `(${figureText(quoted)} || ' ' || IFNULL(${quoteIdentifier(quantityColumnNames(column).unit)}, ''))`
    case 'decimal':
      return scaledText(quoted, String(column.scale ?? 0), String(10 ** (column.scale ?? 0)))
    case 'percent':
      // As it prints — `12.5%` — so its trailing zeros go (D-333). Four places
      // always, so there is always a point for the zeros to stop at.
      return `(RTRIM(RTRIM(${scaledText(quoted, String(PERCENT_PLACES), String(10 ** PERCENT_PLACES))}, '0'), '.') || '%')`
    case 'money': {
      const names = moneyColumnNames(column)
      const minor = quoteIdentifier(names.minor)
      const currency = quoteIdentifier(names.currency)
      // Codes are three letters from `core/money.ts`, never from a document.
      const entries = Object.entries(MINOR_DIGITS_BY_CURRENCY)
      const by = (value: (places: number) => number): string =>
        `(CASE UPPER(${currency}) ${entries
          .map(([code, places]) => `WHEN '${code}' THEN ${String(value(places))}`)
          .join(' ')} ELSE ${String(value(2))} END)`
      return `(${scaledText(minor, by((places) => places), by((places) => 10 ** places))} || ' ' || IFNULL(${currency}, ''))`
    }
    case 'link': {
      const target = formats.find((each) => each.name === column.target)
      const naming = target === undefined ? undefined : labelColumn(target)
      if (target === undefined || naming === undefined) return undefined
      return (
        `(SELECT ${quoteIdentifier(naming.name)} FROM ${quoteIdentifier(tableNameFor(target))} ` +
        `WHERE ${quoteIdentifier(ROW_ID_COLUMN)} = ${quoted})`
      )
    }
    case 'boolean':
      return undefined
  }
}

/**
 * A figure as JavaScript prints it: SQLite writes a whole `REAL` as `750.0`,
 * and the table shows `750`.
 */
function figureText(figure: string): string {
  return (
    `(CASE WHEN ${figure} = CAST(${figure} AS INTEGER) ` +
    `THEN CAST(CAST(${figure} AS INTEGER) AS TEXT) ELSE CAST(${figure} AS TEXT) END)`
  )
}

/**
 * An integer with `places` implied decimals, as the decimal it stands for —
 * `-1290` at 2 is `-12.90`. `places` and `unit` (ten to the places) are SQL,
 * so money can ask its currency. Integer division and remainder only, and
 * `printf` pads the fraction.
 */
function scaledText(integer: string, places: string, unit: string): string {
  const magnitude = `ABS(${integer})`
  return (
    `(CASE WHEN ${integer} IS NULL THEN NULL ` +
    `WHEN ${places} = 0 THEN CAST(${integer} AS TEXT) ` +
    `ELSE (CASE WHEN ${integer} < 0 THEN '-' ELSE '' END) || (${magnitude} / ${unit}) || '.' || ` +
    `printf('%0*d', ${places}, ${magnitude} % ${unit}) END)`
  )
}

/**
 * Order by a *declared* column, or by the row's own identity.
 *
 * A name no declaration carries falls back to `id` rather than reaching SQLite
 * — it is quoted either way, so this is not about injection; it is that an
 * unknown column would abort the read with a message about a table nobody
 * asked about, where the caller's mistake was a typo in one argument.
 */
function orderClause(declaration: FormatDeclaration, query_: RowQuery): string {
  const identity = ` ORDER BY ${quoteIdentifier(ROW_ID_COLUMN)} ASC`
  if (query_.order === undefined) return identity

  const column = columnOf(declaration, query_.order)
  const direction = query_.descending === true ? 'DESC' : 'ASC'
  // A computed column sorts by what its view says (M49 U1, D-471).
  const computed = column === undefined ? computedSql(declaration, query_.order, query_) : undefined
  if (computed !== undefined) return ` ORDER BY ${computed} ${direction}, ${quoteIdentifier(ROW_ID_COLUMN)} ASC`
  // A list has no one value to sort by (M27 U2, D-300).
  if (column === undefined || isListType(column.type)) return identity

  const stored = column.type === 'money' ? moneyColumnNames(column).minor : column.name
  return ` ORDER BY ${quoteIdentifier(stored)} ${direction}, ${quoteIdentifier(ROW_ID_COLUMN)} ASC`
}

/** A computed column's value for the row being read, or nothing when it is not one that compiles. */
function computedSql(declaration: FormatDeclaration, name: string, query_: RowQuery): string | undefined {
  if (!(declaration.derived ?? []).some((each) => each.name === name)) return undefined
  const neighbours = (query_.formats ?? []).filter((each) => each.name !== declaration.name)
  return derivedValueSql(declaration, neighbours, name, undefined, query_.today)?.sql
}

function columnOf(declaration: FormatDeclaration, name: string): ColumnDeclaration | undefined {
  return declaration.columns.find((column) => column.name === name)
}

/** `%`, `_` and the escape itself, so a search for "50%" finds one. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

/** One unique value a write would repeat (M24 U4, D-255). */
export interface Repeat {
  /** Which of the rows handed in, from 0. */
  readonly row: number
  readonly column: string
  readonly message: string
}

/**
 * The values these rows would repeat in a `unique` column — held by a row
 * already in the table, or by an earlier row of the same batch.
 *
 * **Refused at the moment it is written, naming the column and the row that
 * already holds the value** (D-242's first half). The `UNIQUE` index would
 * refuse it too, with *"UNIQUE constraint failed: fmt_decision.ref"* — which is
 * true, names no row, and is read by a model about to try again. This is
 * `danglingLinks`'s shape for the same reason, and every surface that writes
 * rows calls both.
 *
 * `ids` is for an update: a row keeping its own value is not a repeat of
 * itself. A column the cells do not name is not checked — an update of three
 * columns cannot collide in a fourth.
 *
 * **Judged by where the batch ends** (M48 U1): a row of the table that is also
 * a row of the batch holds what the batch hands in for it, not what it holds
 * now — so moving `Current` from one semester to the next is one batch, and
 * `update_format_rows` writes it in an order the table takes.
 */
export function repeatedValues(
  db: Database,
  declaration: FormatDeclaration,
  rows: readonly Readonly<Record<string, StoredValue>>[],
  ids: readonly (string | undefined)[] = [],
): readonly Repeat[] {
  const unique = declaration.columns.filter((column) => column.unique)
  const onePer = (declaration.constraints ?? []).filter((each) => each.kind === 'ONE_PER')
  if (unique.length === 0 && onePer.length === 0) return []
  const table = quoteIdentifier(tableNameFor(declaration))
  const repeats: Repeat[] = []
  const shownAs = (value: StoredValue): string =>
    typeof value === 'string' ? `"${value}"` : String(value)
  // The rows of the table this batch rewrites in all these columns: what they
  // hold now is not where they end, and the batch is compared with itself.
  const rewritten = (columns: readonly string[]): ReadonlySet<string> =>
    new Set(
      rows.flatMap((cells, at) => {
        const id = ids[at]
        return id !== undefined && columns.every((name) => cells[name] !== undefined) ? [id] : []
      }),
    )
  const holderOf = (sql: string, bound: readonly (string | number)[], self: string, batch: ReadonlySet<string>): unknown =>
    query(db, sql, [...bound, self])
      .map((found) => found['id'])
      .find((id) => typeof id !== 'string' || !batch.has(id))

  for (const column of unique) {
    const seen = new Map<string, number>()
    const batch = rewritten([column.name])
    const sql =
      `SELECT ${quoteIdentifier(ROW_ID_COLUMN)} AS id FROM ${table} ` +
      `WHERE ${quoteIdentifier(column.name)} = ? AND ${quoteIdentifier(ROW_ID_COLUMN)} <> ? LIMIT ${String(batch.size + 1)}`
    rows.forEach((cells, row) => {
      const value = cells[column.name]
      if (value === undefined || value === null || typeof value === 'object') return
      const shown = typeof value === 'string' ? `"${value}"` : String(value)
      const key = `${typeof value}:${String(value)}`
      const earlier = seen.get(key)
      if (earlier !== undefined) {
        repeats.push({
          row,
          column: column.name,
          message: `${column.name} is ${shown} here and in row ${String(earlier + 1)} of the same batch. It is unique, so each value is held once.`,
        })
        return
      }
      seen.set(key, row)
      const holder = holderOf(sql, [value], ids[row] ?? '', batch)
      if (holder !== undefined) {
        repeats.push({
          row,
          column: column.name,
          message: `${column.name} is ${shown}, which the row ${String(holder)} already holds. It is unique, so each value is held once.`,
        })
      }
    })
  }

  // `one row per` (M25 E1, D-270): the same question over several columns,
  // asked only of a row that fills every one of them and — when it has a
  // `when` — is one of its members, since the index covers no other. An update
  // has to hand in the row as it would stand, or a change to one column of two
  // could not be judged.
  for (const each of onePer) {
    const text = constraintText(each)
    const scope = each.when === undefined ? '' : ` AND ${quoteIdentifier(each.when)} IN (${each.is.map(() => '?').join(', ')})`
    const batch = rewritten([...each.columns, ...(each.when === undefined ? [] : [each.when])])
    const sql =
      `SELECT ${quoteIdentifier(ROW_ID_COLUMN)} AS id FROM ${table} WHERE ` +
      each.columns.map((name) => `${quoteIdentifier(name)} = ?`).join(' AND ') +
      `${scope} AND ${quoteIdentifier(ROW_ID_COLUMN)} <> ? LIMIT ${String(batch.size + 1)}`
    const seen = new Map<string, number>()
    rows.forEach((cells, row) => {
      const values = each.columns.map((name) => cells[name] ?? null)
      if (values.some((value) => value === null)) return
      if (each.when !== undefined) {
        const decider = cells[each.when]
        if (typeof decider !== 'string' || !each.is.includes(decider)) return
      }
      const named = `${each.columns.join(', ')} ${each.columns.length === 1 ? 'is' : 'are'} ${values.map((value) => shownAs(value as StoredValue)).join(', ')}`
      const key = JSON.stringify(values.map((value) => [typeof value, String(value)]))
      const earlier = seen.get(key)
      if (earlier !== undefined) {
        repeats.push({
          row,
          column: each.columns[0] ?? text,
          message: `${named} here and in row ${String(earlier + 1)} of the same batch, and the format says "${text}".`,
        })
        return
      }
      seen.set(key, row)
      const holder = holderOf(sql, [...(values as (string | number)[]), ...each.is], ids[row] ?? '', batch)
      if (holder !== undefined) {
        repeats.push({
          row,
          column: each.columns[0] ?? text,
          message: `${named}, which the row ${String(holder)} already holds, and the format says "${text}".`,
        })
      }
    })
  }
  return repeats.sort((a, b) => a.row - b.row)
}

/**
 * The values a column holds more than once, most-repeated first — what a person
 * has to make different before the column can be unique (D-255). The
 * reconciler says *how many* rows repeat; this says *which*, because a count
 * is not something anybody can go and fix.
 */
export function repeatsIn(
  db: Database,
  declaration: FormatDeclaration,
  column: string,
  limit = 10,
): readonly { readonly value: StoredValue; readonly rows: number }[] {
  const quoted = quoteIdentifier(column)
  return query(
    db,
    `SELECT ${quoted} AS value, COUNT(*) AS rows FROM ${quoteIdentifier(tableNameFor(declaration))} ` +
      `WHERE ${quoted} IS NOT NULL GROUP BY ${quoted} HAVING COUNT(*) > 1 ` +
      `ORDER BY COUNT(*) DESC, ${quoted} LIMIT ?`,
    [limit],
  ).map((row) => ({ value: (row['value'] ?? null) as StoredValue, rows: Number(row['rows'] ?? 0) }))
}
