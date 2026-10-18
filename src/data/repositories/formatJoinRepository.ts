/**
 * **The join** — resolving a hop through a link, and folding an aggregate over
 * the rows that point back (M19 U4b,
 * [D-224](../../../docs/09-decision-log.md)).
 *
 * `aggregate.ts` and `identity.ts` do the arithmetic and know nothing about a
 * database; **this file is the only place a second table is read**, and it is
 * here rather than there for the rule that has held since the first commit:
 * `src/domain/` imports nothing from sql.js, and a join is a query.
 *
 * ## What it costs, which is the thing to watch
 *
 * A hop is **one query per link column per read**, not one per row. Resolving
 * `ingredient.kcal` over two hundred recipe lines gathers the distinct ids and
 * fetches them in a single `IN (…)`, because the version that did it per row is
 * the one that turns a twelve-note vault into a spinner. The same for an
 * aggregate: one query for the source rows, one per link they reach through.
 *
 * That is still linear in formats and unmeasured past a vault. `scale.test.ts`
 * covers none of this and says so — a declared table has never been in it.
 *
 * ## Nothing here is written down
 *
 * Every figure this file produces is computed on read and thrown away, which is
 * D-222's rule reaching the one place it would be most tempting to break. A
 * total is expensive and stable and *looks* exactly like something to cache —
 * and the vault's own failure mode was a table of totals computed once and
 * frozen into prose while its inputs moved underneath it (D-210).
 */

import type { Database } from 'sql.js'

import {
  evaluateAggregate,
  inputsWithTotals,
  isOrdered,
  namesUsedBy,
  type AggregateDeclaration,
  type AggregateValue,
  type OrderedInputs,
  type OrderedKind,
} from '@/domain/format/aggregate.ts'
import {
  isLinkType,
  labelColumn,
  moneyColumnNames,
  namingScope,
  ROW_ID_COLUMN,
  tableNameFor,
  type ColumnDeclaration,
  type FormatDeclaration,
} from '@/domain/format/declaration.ts'
import { quoteIdentifier } from '@/domain/format/ddl.ts'
import {
  compileDerived,
  derivedSelectSql,
  evaluateDerived,
  inputsWithDerived,
  type CompiledDerived,
  type DerivedValue,
} from '@/domain/format/derived.ts'
import { evaluateIdentity, type IdentityInputs } from '@/domain/format/identity.ts'
import { pendingRowId, type ReadResult, type ReadTable, type Reading, type UnlinkedName } from '@/domain/format/reading.ts'
import {
  coerceMatch,
  identityInputsOf,
  isFilled,
  isList,
  memberOf,
  scaledFigureOf,
  missingTargets,
  readValue,
  type RowVerdict,
  type StoredRow,
  type StoredValue,
} from '@/domain/format/row.ts'
import type { UnitTable } from '@/domain/format/unit.ts'

import { SEEDED_UNITS } from '@/domain/format/unit.ts'
import { isPointType, pointOrdinal } from '@/domain/format/span.ts'
import { query } from '../db/database.ts'
import { err, ok, type Result } from '@/core/result.ts'
import { listRows, readRow, storedColumnsFor } from './formatRowRepository.ts'

/** Every declaration in the document, by name — what a hop is resolved against. */
export type FormatIndex = ReadonlyMap<string, FormatDeclaration>

export function indexOf(declarations: readonly FormatDeclaration[]): FormatIndex {
  return new Map(declarations.map((each) => [each.name, each]))
}

/**
 * The inputs for a batch of rows, with one hop through every link resolved.
 *
 * **A batch rather than a row**, because the whole cost of a hop is in how many
 * times it is paid. The rows come back in the order they went in, so a caller
 * can zip them against the rows it already has.
 *
 * A link that is empty, or that names a row which is not there, contributes no
 * keys — and an expression naming one comes back `unchecked` with the column in
 * it, which is what an identity says about any figure a row does not have. A
 * dangling link is refused at the moment it is *written* (`missingTargets`); by
 * the time it is being read, the honest answer is that there is nothing there.
 */
export function inputsFor(
  db: Database,
  declaration: FormatDeclaration,
  rows: readonly StoredRow[],
  formats: FormatIndex,
): readonly IdentityInputs[] {
  const base = rows.map((row) => ({ ...identityInputsOf(declaration, row), id: row.id }))
  if (rows.length === 0) return base

  const numbers = base.map((each) => new Map(each.numbers))
  const currencies = base.map((each) => new Map(each.currencies))
  const units = base.map((each) => new Map(each.units ?? []))
  // The far side's ratios, under the same dotted keys (U4c, D-225). A density
  // is a fact about the ingredient and a recipe line only points at it, so
  // `ingredient.density` is where a bridge is almost always found.
  const per = base.map((each) => new Map(each.per ?? []))
  // An enum or boolean one hop away, for a filter (U8, D-260):
  // `deduction_type.reduces_net` is what decides whether a line reduces net.
  const members = base.map((each) => new Map(each.members ?? []))
  // A decimal's or a percent's exact figure one hop away (M29 U3, D-333).
  const exact = base.map((each) => new Map(each.exact ?? []))
  // A date, a time or an instant one hop away (M29 U4, D-335).
  const points = base.map((each) => new Map(each.points ?? []))
  // Whether a column one hop away holds anything, for `is empty` (M36 U04).
  const filled = base.map((each) => new Set(each.filled ?? []))

  for (const link of declaration.columns) {
    if (link.type !== 'link' || link.target === undefined) continue
    const target = formats.get(link.target)
    if (target === undefined) continue

    // The distinct ids this batch reaches for, fetched once. A recipe of
    // fourteen lines using flour twice asks for flour once.
    const wanted = new Set<string>()
    for (const row of rows) {
      const id = row.cells[link.name]
      if (typeof id === 'string' && id !== '') wanted.add(id)
    }
    if (wanted.size === 0) continue

    const reached = rowsByIdIn(db, target, [...wanted])
    for (const [index, row] of rows.entries()) {
      const id = row.cells[link.name]
      if (typeof id !== 'string') continue
      const other = reached.get(id)
      if (other === undefined) continue
      for (const column of target.columns) {
        const value = readValue(column, other)
        const key = `${link.name}.${column.name}`
        const cell = other.cells[column.name]
        if (isFilled(column, other)) filled[index]?.add(key)
        const member = memberOf(column, other)
        if (member !== undefined) {
          members[index]?.set(key, member)
          continue
        }
        if (isPointType(column.type)) {
          const ordinal = pointOrdinal(column.type, cell)
          if (ordinal !== undefined) points[index]?.set(key, { type: column.type, ordinal })
          continue
        }
        if (column.type === 'decimal' || column.type === 'percent') {
          // The figure, as `identityInputsOf` enters it on its own row (D-257,
          // D-333): `readValue` hands either back as text, for printing.
          const figure = scaledFigureOf(column, cell)
          if (figure !== undefined) {
            numbers[index]?.set(key, figure.value)
            exact[index]?.set(key, figure.exact)
          }
        } else if (typeof value === 'number') {
          numbers[index]?.set(key, value)
        } else if (typeof value === 'object' && value !== null && 'minor' in value) {
          numbers[index]?.set(key, value.minor)
          currencies[index]?.set(key, value.currency)
        } else if (typeof value === 'object' && value !== null && 'amount' in value) {
          // A quantity one hop away, and **its unit comes from the row it was
          // read from** rather than from the column (U4c, D-225) — which is the
          // whole of what the type is, said once more across a join.
          numbers[index]?.set(key, value.amount)
          units[index]?.set(key, value.unit)
        }
        if (column.unit !== undefined) units[index]?.set(key, column.unit)
        if (column.per !== undefined) per[index]?.set(key, column.per)
      }
    }
  }

  return base.map((each, index) => ({
    id: each.id,
    numbers: numbers[index] ?? each.numbers,
    currencies: currencies[index] ?? each.currencies,
    units: units[index] ?? new Map<string, string>(),
    per: per[index] ?? new Map<string, string>(),
    members: members[index] ?? new Map<string, string>(),
    exact: exact[index] ?? new Map(),
    points: points[index] ?? new Map(),
    filled: filled[index] ?? new Set<string>(),
  }))
}

/** One aggregate, folded over the rows of its source that name this row. */
export function foldAggregate(
  db: Database,
  declaration: AggregateDeclaration,
  rowId: string,
  formats: FormatIndex,
  units: UnitTable = SEEDED_UNITS,
): AggregateValue {
  const source = formats.get(declaration.over.format)
  if (source === undefined) {
    return {
      kind: 'UNCHECKED',
      reason: `This document no longer declares ${declaration.over.format}, so there are no rows to gather.`,
    }
  }
  // `every course` gathers every row and names no link (M34 U4, D-397).
  const over = declaration.over.column
  if (over !== undefined) {
    const link = source.columns.find((each) => each.name === over)
    if (link === undefined || !isLinkType(link.type)) {
      return {
        kind: 'UNCHECKED',
        reason: `${declaration.over.format} no longer has a link called ${over}, so nothing points here.`,
      }
    }
  }

  if (isOrdered(declaration.kind) && declaration.by !== undefined) {
    return foldLatest(db, declaration, declaration.kind, declaration.by, source, rowId, formats, units)
  }

  const rows = over === undefined ? listRows(db, source) : listRows(db, source, { match: new Map([[over, rowId]]) })
  return evaluateAggregate(declaration, gathered(db, declaration, source, rows, formats, units), units)
}

/**
 * The inputs of the rows a total gathers, with **the worked-out columns it
 * names** beside their stored ones (M29 F7, D-334) — read out of the same SQL
 * the source's view is, so each is the figure its row shows, rounded per row
 * (D-333). Nothing extra is read when the total names none.
 */
function gathered(
  db: Database,
  declaration: AggregateDeclaration,
  source: FormatDeclaration,
  rows: readonly StoredRow[],
  formats: FormatIndex,
  units: UnitTable,
): readonly IdentityInputs[] {
  const inputs = inputsFor(db, source, rows, formats)
  const used = new Set(namesUsedBy(declaration))
  if (!(source.derived ?? []).some((each) => used.has(each.name))) return inputs
  const { compiled, figures } = derivedFiguresOf(db, source, rows, formats, units)
  return inputs.map((each, index) => {
    const found = figures.get(rows[index]?.id ?? '')
    return inputsWithDerived(
      each,
      compiled.flatMap((one) => {
        const value = derivedCellOf(one, found)
        return value === undefined ? [] : [{ name: one.declaration.name, value }]
      }),
    )
  })
}

const CHUNK = 500

/**
 * The derived figures of these rows as SQL computes them — the `SELECT` the
 * format's view is made of, by row id (D-334). Run here rather than read from
 * the view so a document the reconciler has not opened yet answers the same.
 * Nothing when the format declares none or one does not compile.
 */
export function derivedFiguresOf(
  db: Database,
  declaration: FormatDeclaration,
  rows: readonly StoredRow[],
  formats: FormatIndex,
  units: UnitTable = SEEDED_UNITS,
  /** The asking runtime's day, `YYYY-MM-DD`, for a column that reads `today` (D-472). */
  today?: string,
): {
  readonly compiled: readonly CompiledDerived[]
  readonly figures: ReadonlyMap<string, Record<string, unknown>>
} {
  const figures = new Map<string, Record<string, unknown>>()
  if ((declaration.derived ?? []).length === 0 || rows.length === 0) return { compiled: [], figures }
  const neighbours = [...formats.values()].filter((each) => each.name !== declaration.name)
  const { compiled, problems } = compileDerived(declaration, neighbours, units, today)
  const select = derivedSelectSql(declaration, neighbours, false, today)
  if (select !== undefined && problems.length === 0) {
    const ids = rows.map((row) => row.id)
    for (let at = 0; at < ids.length; at += CHUNK) {
      const chunk = ids.slice(at, at + CHUNK)
      for (const found of query(
        db,
        `${select} WHERE t.${quoteIdentifier(ROW_ID_COLUMN)} IN (${chunk.map(() => '?').join(', ')})`,
        chunk,
      )) {
        figures.set(String(found[ROW_ID_COLUMN]), found)
      }
    }
  }
  return { compiled, figures }
}

/** One view cell as a value, or nothing when SQL left it empty. */
export function derivedCellOf(
  each: CompiledDerived,
  found: Record<string, unknown> | undefined,
): DerivedValue | undefined {
  if (found === undefined) return undefined
  if (each.type.kind === 'MONEY') {
    const names = moneyColumnNames({ name: each.declaration.name })
    const minor = found[names.minor]
    if (typeof minor !== 'number') return undefined
    const currency = found[names.currency]
    return { kind: 'MONEY', minor, currency: typeof currency === 'string' ? currency : undefined }
  }
  const value = found[each.declaration.name]
  if (each.type.kind === 'DATE') {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? { kind: 'DATE', date: value } : undefined
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return { kind: 'NUMBER', value, unit: each.type.unit }
}

/**
 * A `latest` or `earliest` (M25 E3, D-272), **picked in SQL where it can be**.
 *
 * With no filter, the only rows that can decide the answer are the ones at the
 * greatest (least) order — one, or several that tie — and the ones with no
 * order at all, which might be it. One query finds those and one counts the
 * rest, so a format with ten years of daily readings reads two rows rather
 * than two thousand. A filter may reach through a link, which a `WHERE` here
 * would have to join for; then every row is read and `aggregate.ts` decides,
 * which is the same answer at a cost nobody has measured a need to cut.
 */
function foldLatest(
  db: Database,
  declaration: AggregateDeclaration,
  kind: OrderedKind,
  by: string,
  source: FormatDeclaration,
  rowId: string,
  formats: FormatIndex,
  units: UnitTable,
): AggregateValue {
  const link = declaration.over.column
  let rows: readonly StoredRow[]
  let among: number | undefined
  // A list is a table of its own (M27 U2, D-300), so its rows are found by
  // membership through `listRows` rather than by the column this query names.
  const many = source.columns.some((each) => each.name === link && each.type === 'links')
  if (declaration.where === undefined && !many) {
    const table = quoteIdentifier(tableNameFor(source))
    const order = quoteIdentifier(by)
    // Every row of the source names no link and binds nothing (D-397).
    const on = link === undefined ? '1' : `${quoteIdentifier(link)} = ?`
    const bound = link === undefined ? [] : [rowId]
    const extreme = kind === 'LATEST' ? 'MAX' : 'MIN'
    const ids = query(
      db,
      `SELECT ${quoteIdentifier(ROW_ID_COLUMN)} AS "id" FROM ${table}
        WHERE ${on} AND (${order} IS NULL OR ${order} = (SELECT ${extreme}(${order}) FROM ${table} WHERE ${on}))`,
      [...bound, ...bound],
    ).map((each) => String(each['id']))
    rows = ids.flatMap((id) => {
      const found = readRow(db, source, id)
      return found === undefined ? [] : [found]
    })
    const counted = query(db, `SELECT COUNT(*) AS "n" FROM ${table} WHERE ${on}`, bound)[0]?.['n']
    among = typeof counted === 'number' ? counted : undefined
  } else {
    rows = link === undefined ? listRows(db, source) : listRows(db, source, { match: new Map([[link, rowId]]) })
  }

  return evaluateAggregate(
    declaration,
    ordered(gathered(db, declaration, source, rows, formats, units), rows, by),
    units,
    among,
  )
}

/** The inputs, each with what its row holds in the order column — nothing when that is empty. */
function ordered(
  inputs: readonly IdentityInputs[],
  rows: readonly StoredRow[],
  by: string | undefined,
): readonly OrderedInputs[] {
  if (by === undefined) return inputs
  return inputs.map((each, index) => {
    const order = rows[index]?.cells[by]
    return typeof order === 'number' || (typeof order === 'string' && order !== '')
      ? { ...each, order }
      : each
  })
}

/**
 * The links in these cells that name a row that is not there (U4b, D-224).
 *
 * `missingTargets` decides what a dangling link *is* and writes the sentence;
 * this supplies the looking-up, because `src/domain/` imports no sql.js. It is
 * here rather than beside the write for the reason the rest of this file is:
 * it reads a second table.
 *
 * **One implementation, reached by both surfaces** (M20's parity rule). The
 * plugin checked links before a write from the moment links existed; U1's row
 * form is the second caller, and a second copy of this is how a screen and a
 * tool come to hold different opinions about the same document.
 */
export function danglingLinks(
  db: Database,
  declaration: FormatDeclaration,
  cells: Readonly<Record<string, StoredValue>>,
  formats: FormatIndex,
  pending: ReadonlySet<string> = new Set(),
): readonly string[] {
  return missingTargets(
    declaration,
    cells,
    (format, id) => {
      if (format === declaration.name && pending.has(id)) return true
      const target = formats.get(format)
      return target !== undefined && readRow(db, target, id) !== undefined
    },
    (format) => {
      const target = formats.get(format)
      const naming = target === undefined ? undefined : labelColumn(target)
      return naming === undefined ? undefined : { name: naming.name, unique: naming.unique === true }
    },
    // A name two rows hold names them both (M48 U1), so the refusal says which.
    (format, name) => {
      const target = formats.get(format)
      if (target === undefined) return { holders: [], within: undefined }
      const parent = parentOf(db, declaration, target, cells, formats)
      return {
        holders: namesHeldBy(db, target, name, parent),
        within: parent === undefined ? undefined : { column: parent.column, label: parent.label },
      }
    },
  )
}

/**
 * These rows with every link that was written as a *name* swapped for the id
 * of the row it names (M24 U5, D-256).
 *
 * **An id first, then a name, then nothing.** A value that is already a row's
 * id is kept, so every caller that wrote ids goes on working. Otherwise, if the
 * target's naming column — `labelColumn`, the one D-241 reads a link back as —
 * is `unique`, a row holding that value is the row meant. A naming column that
 * is not unique names nothing: two rows may share it, and the first of them is
 * a guess. A value neither resolves is left exactly as it came, for
 * `danglingLinks` to refuse with the reason.
 *
 * `batch` is for rows not written yet: the ids they will be written under, one
 * per row, in order. A link into its own format may then name a row of the same
 * batch, which is how two decisions that supersede each other are written in
 * one call rather than two passes and a `format_rows` between them.
 *
 * **Read-only.** It asks the document and writes nothing — the write is still
 * the caller's `insertRows` or `updateRow`, and so still both halves' one path.
 */
export function linksByName(
  db: Database,
  declaration: FormatDeclaration,
  rows: readonly Readonly<Record<string, StoredValue>>[],
  formats: FormatIndex,
  batch: readonly (string | undefined)[] = [],
): readonly Readonly<Record<string, StoredValue>>[] {
  // A one-row link first, so a list named within its parent (M48 U1) reads the
  // parent as the id it resolved to.
  const links = declaration.columns
    .filter(
      (column): column is ColumnDeclaration & { target: string } =>
        isLinkType(column.type) && column.target !== undefined,
    )
    .sort((a, b) => Number(a.type === 'links') - Number(b.type === 'links'))
  if (links.length === 0) return rows

  // The batch's own names, for a link into this format. Only a unique naming
  // column is read, for the reason above; a repeat inside the batch is
  // `repeatedValues`'s refusal, so the first holder here is never a choice.
  const own = labelColumn(declaration)
  const batchNames = new Map<string, string>()
  if (own?.unique === true) {
    rows.forEach((cells, at) => {
      const name = cells[own.name]
      const id = batch[at]
      if (typeof name === 'string' && name !== '' && id !== undefined && !batchNames.has(name)) {
        batchNames.set(name, id)
      }
    })
  }
  const pending = new Set(batch.filter((id): id is string => id !== undefined))

  return rows.map((cells) => {
    let resolved: Record<string, StoredValue> | undefined
    for (const column of links) {
      const target = formats.get(column.target)
      if (target === undefined) continue
      const self = column.target === declaration.name
      // **Within its parent, when the target is one row per parent and name**
      // (M48 U1): the row's own link to that parent says which rows the name is
      // looked for among, and only those.
      const parent = parentOf(db, declaration, target, resolved ?? cells, formats)
      // One value, resolved as an id, else a unique name, else left as it came.
      const resolve = (value: string): string => {
        if ((self && pending.has(value)) || readRow(db, target, value) !== undefined) return value
        if (parent !== undefined) return onlyHolder(namesHeldBy(db, target, value, parent)) ?? value
        return (self ? batchNames.get(value) : undefined) ?? idNamed(db, target, value) ?? value
      }
      const value = cells[column.name]
      // **Each member of a list the same way** (M27 U2, D-300), so a list can
      // mix ids and names and a name nothing holds is still refused by name.
      if (isList(value)) {
        const ids = value.map(resolve)
        if (ids.every((id, at) => id === value[at])) continue
        resolved ??= { ...cells }
        resolved[column.name] = ids
        continue
      }
      if (typeof value !== 'string' || value === '') continue
      const id = resolve(value)
      if (id === value) continue
      resolved ??= { ...cells }
      resolved[column.name] = id
    }
    return resolved ?? cells
  })
}

/**
 * A reading's rows with every link a **column of the file** filled resolved to
 * the row it names — or the line refused, by line (M24 U9, D-261; H10).
 *
 * The same `linksByName` a conversation's rows go through, so a cell and a
 * tool call have one answer to *which row is that*: an id, else the target's
 * unique name, matched exactly, else nothing. **Nothing is a refusal of that
 * line and never an empty link** — a card statement whose third card is not in
 * the document has lines that belong to *something*, and writing them with no
 * account would be the sum that skipped a row (D-224) arriving from the other
 * side. A line refused here is drawn like one that did not type, with the
 * cell it named.
 *
 * A link held **fixed** for the file is resolved too, so it may be a name as
 * well as an id; whether it names anything stays the caller's whole-file
 * check, because one bad fixed value is one mistake and not four hundred.
 *
 * **A column the file wrote in prose is the exception** (M38 U2): the links a
 * note's body makes are mentions, not a value the row needs, so a member that
 * names no row is left out of the row and kept in `unlinked`, for the report to
 * name — the note is still read. Only a required column, emptied by that, still
 * refuses its line: then the value *is* needed.
 *
 * **Read-only**, like `linksByName`: nothing is written until the reading is.
 */
export function resolveReadLinks(
  db: Database,
  declaration: FormatDeclaration,
  reading: Reading,
  read: ReadResult,
  formats: FormatIndex,
  table?: ReadTable,
): ReadResult {
  const typed = read.rows.filter((row) => row.cells !== undefined)
  if (typed.length === 0 || !declaration.columns.some((column) => isLinkType(column.type))) {
    return read
  }
  // **A link to a row this same read writes is filled** (M38 U4): it holds the
  // line it names until the commit draws that row's id. A row that is refused
  // writes nothing, so a link to it is taken back and the read run again, until
  // no link names a row that will not be there.
  const alive = new Set(typed.map((row) => row.line))
  for (;;) {
    const result = resolveOnce(db, declaration, reading, read, formats, table, alive)
    const refused = result.rows.filter((row) => row.cells === undefined && alive.has(row.line))
    if (refused.length === 0) return result
    for (const row of refused) alive.delete(row.line)
  }
}

function resolveOnce(
  db: Database,
  declaration: FormatDeclaration,
  reading: Reading,
  read: ReadResult,
  formats: FormatIndex,
  table: ReadTable | undefined,
  alive: ReadonlySet<number>,
): ReadResult {
  const prose = new Set(
    reading.columns.flatMap((each) => (table?.prose?.[each.index] === true ? [each.key] : [])),
  )
  const bound = new Set(reading.columns.map((each) => each.key))
  // A `links` cell is a list of names, each resolved the same way (M34 U7).
  const fromFile = declaration.columns.filter(
    (column) => isLinkType(column.type) && bound.has(column.name) && !prose.has(column.name),
  )
  const mentioned = declaration.columns.filter(
    (column) => column.type === 'links' && column.target !== undefined && prose.has(column.name),
  )
  const typedRows = read.rows.filter((row) => row.cells !== undefined)
  const typed = typedRows.map((row) => row.cells ?? {})
  // The rows of this read that will be written, each by the line it stands in
  // for until it is (`pendingRowId`).
  const batch = typedRows.map((row) => (alive.has(row.line) ? pendingRowId(row.line) : undefined))
  const pending = new Set(batch.filter((id): id is string => id !== undefined))
  // The names this read's own rows are called by: a link to one that is not
  // written this time is said as that rather than as naming nothing.
  const own = labelColumn(declaration)
  const ownNames = new Set(
    own === undefined ? [] : typed.flatMap((cells) => (typeof cells[own.name] === 'string' ? [cells[own.name] as string] : [])),
  )

  const named = linksByName(db, declaration, typed, formats, batch)
  let at = 0
  const rows = read.rows.map((row) => {
    if (row.cells === undefined) return row
    const raw = row.cells
    let cells = named[at] ?? row.cells
    at += 1

    const unlinked: UnlinkedName[] = []
    for (const column of mentioned) {
      const value = cells[column.name]
      const written = raw[column.name]
      if (!isList(value)) continue
      const kept: string[] = []
      value.forEach((member, index) => {
        if (danglingLinks(db, declaration, { [column.name]: [member] }, formats, pending).length === 0) {
          kept.push(member)
          return
        }
        const name = isList(written) ? (written[index] ?? member) : member
        const target = column.target === undefined ? undefined : formats.get(column.target)
        const parent = target === undefined ? undefined : parentOf(db, declaration, target, cells, formats)
        const holders = target === undefined ? [] : namesHeldBy(db, target, name, parent)
        unlinked.push({
          key: column.name,
          name,
          reason:
            column.target === declaration.name && ownNames.has(name)
              ? `${name} is not read this time, so ${column.name} leaves it out.`
              : holders.length > 1
                ? `${holders.length > 5 ? 'More than five' : String(holders.length)} ${column.target ?? 'row'} rows are called ${name} (${holders.slice(0, 5).join(', ')}), so ${column.name} leaves it out rather than guess.`
                : `No ${column.target ?? 'row'}${parent === undefined ? '' : ` of ${parent.label}`} is called ${name}, so ${column.name} leaves it out.`,
        })
      })
      if (kept.length === value.length) continue
      const next: Record<string, StoredValue> = { ...cells }
      if (kept.length > 0) next[column.name] = kept
      else if (column.required === true) {
        return { ...row, cells: undefined, problem: unlinked.map((each) => each.reason).join(' ') }
      } else delete next[column.name]
      cells = next
    }
    const withUnlinked = unlinked.length === 0 ? {} : { unlinked }

    if (fromFile.length === 0) return { ...row, cells, ...withUnlinked }
    const only: Record<string, StoredValue> = {}
    for (const column of fromFile) {
      const value = cells[column.name]
      if (value !== undefined) only[column.name] = value
    }
    const dangling = danglingLinks(db, declaration, only, formats, pending)
    return dangling.length === 0
      ? { ...row, cells, ...withUnlinked }
      : { ...row, cells: undefined, problem: dangling.join(' ') }
  })
  return { ...read, rows }
}

/**
 * The formats some of these names are rows of, among the formats this one's
 * `links` columns point at (M38 U2) — what `guessReading` is told as `into`, so
 * a body's links go onto the column pointing where they resolve. A name is a
 * row by its id or the target's unique name in the document, or among the
 * names `alongside` says another file of the same read writes onto a format.
 */
export function formatsNamed(
  db: Database,
  declaration: FormatDeclaration,
  names: readonly string[],
  formats: FormatIndex,
  alongside: readonly { readonly format: string; readonly names: ReadonlySet<string> }[] = [],
): ReadonlySet<string> {
  const found = new Set<string>()
  if (names.length === 0) return found
  for (const column of declaration.columns) {
    const name = column.target
    if (column.type !== 'links' || name === undefined || found.has(name)) continue
    if (alongside.some((each) => each.format === name && names.some((one) => each.names.has(one)))) {
      found.add(name)
      continue
    }
    const target = formats.get(name)
    const naming = target === undefined ? undefined : labelColumn(target)
    // A name within its parent is a name too (M48 U1), and the read says whether it found one.
    if (target === undefined || naming === undefined || (naming.unique !== true && namingScope(target) === undefined)) continue
    // In pages, so a vault's every link is a handful of queries, not one each.
    for (let from = 0; from < names.length && !found.has(name); from += 400) {
      const page = names.slice(from, from + 400)
      const marks = page.map(() => '?').join(', ')
      const hit = query(
        db,
        `SELECT 1 AS hit FROM ${quoteIdentifier(tableNameFor(target))} ` +
          `WHERE ${quoteIdentifier(naming.name)} IN (${marks}) OR ${quoteIdentifier(ROW_ID_COLUMN)} IN (${marks}) LIMIT 1`,
        [...page, ...page],
      )
      if (hit.length > 0) found.add(name)
    }
  }
  return found
}

/**
 * The parent a name is looked for within (M48 U1): when `target` is one row per
 * a link and its naming column (`namingScope`), and this row links to a row of
 * that same format by its one `link` column to it, that row — its id, and the
 * name it is called by, for a sentence.
 */
export function parentOf(
  db: Database,
  declaration: FormatDeclaration,
  target: FormatDeclaration,
  cells: Readonly<Record<string, StoredValue>>,
  formats: FormatIndex,
): { readonly column: string; readonly id: string; readonly label: string } | undefined {
  const scope = namingScope(target)
  if (scope === undefined) return undefined
  const mine = declaration.columns.filter((column) => column.type === 'link' && column.target === scope.target)
  const only = mine.length === 1 ? mine[0] : undefined
  const value = only === undefined ? undefined : cells[only.name]
  const parentFormat = formats.get(scope.target)
  if (typeof value !== 'string' || parentFormat === undefined) return undefined
  const row = readRow(db, parentFormat, value)
  if (row === undefined) return undefined
  const naming = labelColumn(parentFormat)
  const label = naming === undefined ? undefined : row.cells[naming.name]
  return { column: scope.name, id: value, label: typeof label === 'string' && label !== '' ? label : value }
}

/** The rows of `target` called `name` — within one parent, when given — up to six. */
export function namesHeldBy(
  db: Database,
  target: FormatDeclaration,
  name: string,
  parent?: { readonly column: string; readonly id: string },
): readonly string[] {
  const naming = labelColumn(target)
  if (naming === undefined) return []
  const within = parent === undefined ? '' : ` AND ${quoteIdentifier(parent.column)} = ?`
  return query(
    db,
    `SELECT ${quoteIdentifier(ROW_ID_COLUMN)} AS id FROM ${quoteIdentifier(tableNameFor(target))} ` +
      `WHERE ${quoteIdentifier(naming.name)} = ?${within} LIMIT 6`,
    parent === undefined ? [name] : [name, parent.id],
  ).flatMap((found) => (typeof found['id'] === 'string' ? [found['id']] : []))
}

function onlyHolder(ids: readonly string[]): string | undefined {
  return ids.length === 1 ? ids[0] : undefined
}

/** The id of the row a unique naming column says is called this, if any. */
/**
 * The row a name names. **A name that repeats in a column not declared unique
 * still names a row when exactly one holds it now** (M38 U5): the link stores
 * the id it resolved to, so nothing is guessed later, and two holders are
 * still nobody — refused, with the way to tell them apart.
 */
function idNamed(db: Database, target: FormatDeclaration, name: string): string | undefined {
  const naming = labelColumn(target)
  if (naming === undefined) return undefined
  const found = query(
    db,
    `SELECT ${quoteIdentifier(ROW_ID_COLUMN)} AS id FROM ${quoteIdentifier(tableNameFor(target))} ` +
      `WHERE ${quoteIdentifier(naming.name)} = ? LIMIT 2`,
    [name],
  )
  const id = found[0]?.['id']
  return found.length === 1 && typeof id === 'string' ? id : undefined
}

/**
 * A link written as **columns of the row it names** — `{name: "Salt", brand:
 * "Acme"}` — swapped for that row's id (M38 U5), before anything is coerced.
 *
 * The trial pasted 55 ids in a second pass because a name repeated; a name
 * plus one more column is how a person tells two rows apart, and it is a
 * `match` on the target, so it is the same equality `format_rows` filters by.
 * Exactly one row, or a refusal naming how many: two holders is a guess, and
 * a link resolved to the first of them is the guess stored (D-256).
 */
export function linksByColumns(
  db: Database,
  declaration: FormatDeclaration,
  offered: Readonly<Record<string, unknown>>,
  formats: FormatIndex,
): Result<Readonly<Record<string, unknown>>, { readonly column: string; readonly reason: string }> {
  let resolved: Record<string, unknown> | undefined
  for (const column of declaration.columns) {
    if (!isLinkType(column.type) || column.target === undefined) continue
    const value = offered[column.name]
    const target = formats.get(column.target)
    const isObject = (one: unknown): one is Record<string, unknown> =>
      typeof one === 'object' && one !== null && !Array.isArray(one)
    if (target === undefined || !(isObject(value) || (Array.isArray(value) && value.some(isObject)))) continue

    const one = (by: Record<string, unknown>): Result<string, string> => {
      const match = new Map<string, StoredValue>()
      for (const [name, wanted] of Object.entries(by)) {
        const named = target.columns.find((each) => each.name === name)
        if (named === undefined) {
          return err(`${column.name} names its ${target.name} by ${name}, which ${target.name} has not got.`)
        }
        const cell = coerceMatch(named, wanted)
        if (!cell.ok) return err(`${column.name}: ${cell.error}`)
        match.set(name, cell.value)
      }
      if (match.size === 0) return err(`${column.name} was given an empty object; name the row by its columns.`)
      const found = listRows(db, target, { match, limit: 2 })
      const said = [...Object.entries(by)].map(([name, wanted]) => `${name} ${JSON.stringify(wanted)}`).join(', ')
      if (found.length === 1 && found[0] !== undefined) return ok(found[0].id)
      return err(
        found.length === 0
          ? `${column.name}: no ${target.name} row has ${said}.`
          : `${column.name}: more than one ${target.name} row has ${said}. Add a column that tells them apart, or give the id.`,
      )
    }

    const members = Array.isArray(value) ? value : [value]
    const ids: unknown[] = []
    for (const member of members) {
      if (!isObject(member)) {
        ids.push(member)
        continue
      }
      const id = one(member)
      if (!id.ok) return err({ column: column.name, reason: id.error })
      ids.push(id.value)
    }
    resolved ??= { ...offered }
    resolved[column.name] = Array.isArray(value) ? ids : ids[0]
  }
  return ok(resolved ?? offered)
}

/** One row's aggregate, by name — what a surface prints beside the row. */
export interface RowAggregate {
  readonly aggregate: AggregateDeclaration
  readonly value: AggregateValue
}

/**
 * Every aggregate a format declares, folded for one row.
 *
 * **Computed on read like a verdict and for the same reason** (D-222). A caller
 * that wants them for many rows pays for each, which is the honest cost of a
 * fold and the reason `#/formats` shows a tally rather than a column of totals.
 */
export function aggregatesOf(
  db: Database,
  declaration: FormatDeclaration,
  row: StoredRow,
  formats: FormatIndex,
  units: UnitTable = SEEDED_UNITS,
): readonly RowAggregate[] {
  return declaration.aggregates.map((each) => ({
    aggregate: each,
    value: foldAggregate(db, each, row.id, formats, units),
  }))
}

/**
 * One row's identity inputs with its aggregates folded in beside them (U4b).
 *
 * **This is what lets an identity be written about a total.** `total_kcal /
 * servings = per_serving_kcal` is the sentence a recipe card prints, and until
 * a figure worked out across a link could be named by an identity it was a
 * number the app computed and nobody checked. An aggregate that will not fold
 * puts no key here, so the identity naming it says `unchecked` — which is the
 * third state arriving through the join exactly as it arrives through an empty
 * column.
 */
export function inputsWithAggregates(
  db: Database,
  declaration: FormatDeclaration,
  row: StoredRow,
  formats: FormatIndex,
  units: UnitTable = SEEDED_UNITS,
): IdentityInputs {
  const [base] = inputsFor(db, declaration, [row], formats)
  // A total of money is in its currency, so an identity comparing it to a
  // figure in another refuses rather than proves (M29 F7, D-138).
  return inputsWithTotals(
    base ?? { id: row.id, numbers: new Map(), currencies: new Map() },
    aggregatesOf(db, declaration, row, formats, units),
  )
}

/**
 * What a header row's identities say about it **before it or its lines exist**
 * (M24 U10, D-262).
 *
 * A reading's dry run writes nothing, so `foldAggregate` has no row to gather
 * round. An aggregate over the reading's own lines — the header format's link
 * back from them — folds the staged lines instead; one over anything else has
 * no rows yet and puts no key in, so an identity naming it is `unchecked`. That
 * is the printed-total check a statement import used to be code for, run as the
 * document's own declaration: `lines_total = printed_total`, exact on money.
 */
export function stagedHeaderVerdicts(
  db: Database,
  header: { readonly declaration: FormatDeclaration; readonly row: StoredRow },
  lines: {
    readonly declaration: FormatDeclaration
    readonly link: string
    readonly rows: readonly StoredRow[]
  },
  formats: FormatIndex,
  units: UnitTable = SEEDED_UNITS,
): readonly RowVerdict[] {
  const [base] = inputsFor(db, header.declaration, [header.row], formats)
  // Staged lines are in no table yet, so their worked-out figures come from
  // the evaluator the view is held to rather than from the view (M29 F7).
  const { compiled } = compileDerived(
    lines.declaration,
    [...formats.values()].filter((each) => each.name !== lines.declaration.name),
    units,
  )
  const staged = inputsFor(db, lines.declaration, lines.rows, formats).map((each) =>
    inputsWithDerived(
      each,
      compiled.map((one) => ({ name: one.declaration.name, value: evaluateDerived(one, each, units) })),
    ),
  )
  const inputs = inputsWithTotals(
    base ?? { id: header.row.id, numbers: new Map(), currencies: new Map() },
    header.declaration.aggregates
      .filter((each) => each.over.format === lines.declaration.name && each.over.column === lines.link)
      .map((each) => ({ aggregate: each, value: evaluateAggregate(each, ordered(staged, lines.rows, each.by), units) })),
  )
  return header.declaration.identities.map((identity) => ({
    identity,
    verdict: evaluateIdentity(identity, inputs, units),
  }))
}

/** The rows of `declaration` whose id is one of these, by id. */
function rowsByIdIn(
  db: Database,
  declaration: FormatDeclaration,
  ids: readonly string[],
): ReadonlyMap<string, StoredRow> {
  const stored = storedColumnsFor(declaration)
  const placeholders = ids.map(() => '?').join(', ')
  const rows = query(
    db,
    `SELECT ${stored.map(quoteIdentifier).join(', ')} FROM ` +
      `${quoteIdentifier(tableNameFor(declaration))} ` +
      `WHERE ${quoteIdentifier(ROW_ID_COLUMN)} IN (${placeholders})`,
    [...ids],
  )
  const found = new Map<string, StoredRow>()
  for (const row of rows) {
    const cells: Record<string, StoredValueLike> = {}
    for (const name of stored) cells[name] = normalize(row[name])
    const id = cells[ROW_ID_COLUMN]
    if (typeof id === 'string') found.set(id, { id, cells })
  }
  return found
}

type StoredValueLike = string | number | null

function normalize(value: unknown): StoredValueLike {
  if (typeof value === 'string' || typeof value === 'number') return value
  return null
}

/** Re-exported so a caller resolving a hop needs one import. */
export type { ColumnDeclaration }
