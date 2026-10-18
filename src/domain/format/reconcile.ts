/**
 * **A declared table needs a reconciler, not a migration chain** (D-214).
 *
 * D-209 called per-document migrations *"the genuinely hard part"* and nothing
 * since made them cheaper, because they were the wrong shape of problem. The
 * fear was a document carrying tables this build never shipped. But if the
 * tables are **described by the document**, the build does not need to have
 * shipped them:
 *
 * > The declarations are the source of truth and they live in the document. On
 * > open, the app makes the tables match them.
 *
 * That is **idempotent rather than a chain**. `schema_version` keeps governing
 * the built-in tables and nothing else, and what has to be version-compatible is
 * the declaration language — one integer — rather than the set of tables, which
 * is unbounded.
 *
 * ## What it may not decide by itself
 *
 * D-214 named two, and building it found a third and a fourth. All four end the
 * same way: **the plan says what it will not do and why, nothing is written, and
 * a person answers.** A reconciler that guessed here would be the app doing the
 * thinking the user came to do, which is the rule D-211 set.
 *
 * 1. **Dropping a column that holds data.** The figures are gone and nothing
 *    says they were ever there. This is H5 at a smaller scale and with no
 *    ceremony around it — the user is mid-thought, not making an architectural
 *    decision.
 * 2. **Changing a column's type, or its unit.** The stored figures may or may
 *    not still mean what they meant. A `g` that becomes `mg` is the quietest
 *    possible corruption: every number stays, every number is wrong by a
 *    thousand, and nothing in the file records that the meaning moved.
 * 3. **Re-constraining a column that holds data** — making it required, taking
 *    a member out of an enum, tightening a bound. SQLite cannot alter a
 *    constraint in place, and applying one to rows it never saw would be a
 *    verifier proving what it did not check (D-138).
 *    **Loosening is not on this list** (M36 U08): a required column made
 *    optional refuses no value it holds, so it is copied through a nullable
 *    twin and every value is kept (`LOOSEN_COLUMN`). **Nor is a list every
 *    row fits** (M38 U6, D-412): an enum re-listed, a text made an enum or an
 *    enum made a text is the table rebuilt with every row copied
 *    (`REBUILD_TABLE`) once each value held is checked against the new list —
 *    and refused, naming the values, when one is not on it.
 * 4. **Adding a required column to a table that already has rows.** SQLite
 *    refuses it outright — *"Cannot add a NOT NULL column with default value
 *    NULL"* — and the existing rows genuinely have no answer for it.
 *
 * M24 found two more of the same kind: making a column unique over values that
 * already repeat (D-255), and adding a row constraint that rows already break
 * (D-259). Both are a rule the rows it would govern never kept.
 *
 * **A column holding no data is a different question and gets a different
 * answer.** Every one of 1 to 3 is allowed when nothing would be lost: the
 * column is dropped, or dropped and re-added in its new shape. That is what
 * makes iterating on a format the ordinary work H9 says it is — a declaration is
 * rewritten several times before the first row goes in, and a reconciler that
 * refused on principle would make the first draft permanent.
 *
 * ## What it never touches
 *
 * A table it cannot see a declaration for. The `fmt_` prefix is what makes that
 * checkable rather than promised: no built-in table carries it, so no plan can
 * name one however wrong a declaration is. That guard is what lets the engine be
 * built beside the finance app rather than on top of it (D-214).
 *
 * ## What a pack may vouch for, and a person may not
 *
 * **A pack can rebuild its own table** (M36 U09). Its code is what writes its
 * rows, so it knows what a column it retired held and what a value it renamed
 * meant — knowledge no person editing a declaration has about a table full of
 * figures. So the caller may name columns it **vouches** for, and for those
 * a column holding data is dropped (refusal 1). Its re-listed enums need no
 * vouch since M38 U6: a list every row fits is rebuilt for anybody (above).
 *
 * **Only a pack's own format is vouched for.** A declaration with no `owner`
 * is a person's, and a vouch passed for one is ignored — so nothing a person
 * types can drop a column full of their figures by way of this door.
 */

import {
  isListType,
  memberTableNameFor,
  storedColumnsOf,
  tableNameFor,
  ROW_ID_COLUMN,
  type ColumnDeclaration,
  type FormatDeclaration,
} from './declaration.ts'
import { constraintKey, constraintText, isTableConstraint } from './constraint.ts'
import {
  addColumnSql,
  columnClauses,
  createCheckTriggersSql,
  createMemberTableSql,
  dropMemberTableSql,
  createTableSql,
  createUniqueIndexSql,
  dropCheckTriggersSql,
  dropColumnSql,
  dropUniqueIndexSql,
  quoteIdentifier,
  storedColumnsFor,
} from './ddl.ts'

/** One SQL column as the database actually has it — `PRAGMA table_info` plus a count. */
export interface ObservedColumn {
  readonly name: string
  /** SQLite's declared type, upper-cased: `TEXT`, `INTEGER`, `REAL`. */
  readonly storageClass: string
  readonly notNull: boolean
  /**
   * How many different values it holds — `COUNT(DISTINCT column)`. Less than
   * `filled` is a column that cannot be made unique as it stands (D-255).
   */
  readonly distinct: number
  /** Whether the reconciler's unique index is on it. */
  readonly unique: boolean
  /**
   * The different values it holds, for a column the declaration being adopted
   * calls an enum (M36 U09) — what a vouched re-listing is checked against.
   * Missing is not asked.
   */
  readonly values?: readonly string[]
  /**
   * How many rows hold something here — `COUNT(column)`, which counts non-nulls.
   *
   * **This is the number every refusal turns on**, and it is why the observation
   * carries counts rather than only a shape. "Would anything be lost" is not
   * answerable from `PRAGMA table_info`, and a reconciler that could not ask it
   * would have to refuse every change or allow every one.
   */
  readonly filled: number
}

/** A declared table as the database actually has it. */
export interface ObservedTable {
  readonly name: string
  readonly rowCount: number
  readonly columns: readonly ObservedColumn[]
  /**
   * The keys of the row constraints whose triggers the table has (D-259) — the
   * reconciler's own, found by the name it gives them. Missing is none.
   */
  readonly checks?: readonly string[]
  /**
   * For each constraint the declaration being adopted carries, by key, how many
   * rows break it as the table stands. A constraint the table already has is
   * not asked about: its trigger has kept it.
   */
  readonly unheld?: Readonly<Record<string, number>>
  /**
   * The member tables a `links` column keeps (M27 U2, D-300), by column name,
   * each with how many members it holds. Missing is a table that is not there.
   */
  readonly members?: Readonly<Record<string, number>>
  /**
   * The table's `CREATE TABLE` as SQLite keeps it — every column definition it
   * was made or added with, verbatim (M29 F2, D-343). Missing is not known,
   * which a rename makes it, since the text still has the old names.
   */
  readonly sql?: string | undefined
}

/** Something the reconciler will do. */
export type ReconcileStep =
  | { readonly kind: 'CREATE_TABLE'; readonly column: undefined; readonly sql: readonly string[] }
  | { readonly kind: 'ADD_COLUMN'; readonly column: string; readonly sql: readonly string[] }
  | { readonly kind: 'DROP_COLUMN'; readonly column: string; readonly sql: readonly string[] }
  /**
   * **A required column made optional keeps its values** (M36 U08). SQLite
   * cannot drop a `NOT NULL` in place, so the column is copied into a nullable
   * one, dropped, and the copy renamed back — every value it held, held again.
   */
  | { readonly kind: 'LOOSEN_COLUMN'; readonly column: string; readonly sql: readonly string[] }
  /**
   * **The table made again in its declared shape, every row copied** (M36 U09)
   * — what an enum's new list takes, since SQLite cannot alter a `CHECK` and a
   * required column cannot be added beside rows to copy through. Only a pack
   * vouches for one. `column` names the columns that asked for it.
   */
  | { readonly kind: 'REBUILD_TABLE'; readonly column: string; readonly sql: readonly string[] }
  /**
   * A column keeps its values under a new name (M26 U3). `column` is the new
   * name and `from` the old; asked for, never inferred — see `planReconcile`.
   */
  | {
      readonly kind: 'RENAME_COLUMN'
      readonly column: string
      readonly from: string
      readonly sql: readonly string[]
    }
  /** A column becomes unique, or stops being — an index and nothing else (D-255). */
  | { readonly kind: 'ADD_INDEX'; readonly column: string; readonly sql: readonly string[] }
  | { readonly kind: 'DROP_INDEX'; readonly column: string; readonly sql: readonly string[] }
  /**
   * A row constraint's triggers, added or taken away (D-259). `column` is the
   * constraint's sentence, which is what a plan printed to a person names.
   * **`kept` is a constraint taken down and put back** around a rebuild — held
   * before and after, so a plan printed to a person says nothing of it (M48 U1:
   * it said *No longer held to* of one it kept).
   */
  | { readonly kind: 'ADD_CHECK'; readonly column: string; readonly sql: readonly string[]; readonly kept?: true }
  | { readonly kind: 'DROP_CHECK'; readonly column: string; readonly sql: readonly string[]; readonly kept?: true }

/** Why it will not. */
export type RefusalReason =
  | 'DROP_WITH_DATA'
  | 'TYPE_CHANGED'
  | 'UNIT_CHANGED'
  | 'TARGET_CHANGED'
  | 'CONSTRAINT_CHANGED'
  | 'REQUIRED_ON_ROWS'
  | 'STORAGE_MISMATCH'
  /** A fifth thing it will not decide: making a column unique that already repeats a value. */
  | 'NOT_UNIQUE'
  /** A sixth: adding a row constraint that rows already break (D-259). */
  | 'NOT_HELD'
  /** A rename onto a name the table already has a column under (M26 U3). */
  | 'NAME_TAKEN'

export interface Refusal {
  readonly column: string
  readonly reason: RefusalReason
  /** A sentence a person can act on. Read by someone who cannot ask a follow-up. */
  readonly detail: string
}

export interface ReconcilePlan {
  readonly format: string
  readonly table: string
  readonly steps: readonly ReconcileStep[]
  readonly refusals: readonly Refusal[]
}

/** Nothing to do and nothing to ask: the table already matches. */
export function planIsSettled(plan: ReconcilePlan): boolean {
  return plan.steps.length === 0 && plan.refusals.length === 0
}

/** A plan with a refusal in it must not be applied, whole or in part. */
export function planIsApplicable(plan: ReconcilePlan): boolean {
  return plan.refusals.length === 0 && plan.steps.length > 0
}

/**
 * What it would take to make the document match `next`.
 *
 * Three inputs, because there are three things that can disagree and the
 * differences are not the same difference:
 *
 * - `next` — the declaration being adopted. On open this is also `current`.
 * - `held` (`current` below) — the declaration the document holds, or nothing for a new format.
 *   **A unit lives here and nowhere else**: SQLite has no idea a column is
 *   grams, so a unit change is only ever visible declaration-to-declaration, and
 *   it is the change with no DDL and the worst consequence.
 * - `seen` (`observed` below) — the table, or nothing if it has not been created yet.
 *
 * **On open, `next` and `current` are the same object and only the third
 * comparison runs** — which is why reconciliation of an untouched document is
 * always either empty or a straightforward create.
 */
export function planReconcile(
  next: FormatDeclaration,
  held: FormatDeclaration | undefined,
  seen: ObservedTable | undefined,
  renames: ReadonlyMap<string, string> = new Map(),
  /**
   * Columns the pack that owns `next` vouches may be rebuilt over what they
   * hold (M36 U09): dropped with data, or re-listed. Ignored for a format no
   * pack owns — see the header.
   */
  vouched: ReadonlySet<string> = new Set(),
): ReconcilePlan {
  const table = tableNameFor(next)
  const steps: ReconcileStep[] = []
  const refusals: Refusal[] = []
  const vouches = next.owner === undefined ? new Set<string>() : vouched
  const relisted: string[] = []
  // **A rename is asked for, never inferred** (M26 U3). Declaration to
  // declaration, `price` gone and `cost` arrived is a drop and an add, and
  // guessing that it was one column renamed would be the reconciler deciding
  // what a person meant. So the caller names it — `renames` maps the new name
  // to the old — and the table is renamed first and compared afterwards as
  // though it had always had the new name. A type change made in the same
  // edit is then judged exactly as it would have been without the rename.
  const { observed, current } = renameFirst(next, held, seen, renames, steps, refusals)

  if (observed === undefined) {
    // No table yet, so nothing can be lost and no comparison can matter. This is
    // the common case on open: a declaration arrived and its table follows.
    return {
      format: next.name,
      table,
      steps: [
        {
          kind: 'CREATE_TABLE',
          column: undefined,
          sql: [
            createTableSql(next),
            ...next.columns.flatMap((each) => indexOf(next, each)),
            ...next.columns.flatMap((each) => (isListType(each.type) ? [createMemberTableSql(next, each)] : [])),
            ...(next.constraints ?? []).flatMap((each) => createCheckTriggersSql(next, each)),
          ],
        },
      ],
      refusals: [],
    }
  }

  const present = new Map(observed.columns.map((column) => [column.name, column]))

  // Whether the column that stays needs its index added or taken away. Asked
  // only of a column the plan otherwise leaves alone — a rebuilt one carries
  // its index in its own `ADD_COLUMN`.
  const settleIndex = (column: ColumnDeclaration): void => {
    const seen = present.get(column.name)
    if (seen === undefined) return
    if (column.unique && !seen.unique) {
      const repeated = seen.filled - seen.distinct
      if (repeated > 0) {
        refusals.push({
          column: column.name,
          reason: 'NOT_UNIQUE',
          detail: `${column.name} is now unique, and ${rows(repeated)} in ${table} ${repeated === 1 ? 'repeats a value' : 'repeat a value'} another row already holds. Make them different first, or leave it as it was.`,
        })
        return
      }
      steps.push({ kind: 'ADD_INDEX', column: column.name, sql: [createUniqueIndexSql(next, column.name)] })
    } else if (!column.unique && seen.unique) {
      steps.push({ kind: 'DROP_INDEX', column: column.name, sql: [dropUniqueIndexSql(next, column.name)] })
    }
  }
  const currentColumns = new Map((current?.columns ?? []).map((column) => [column.name, column]))
  const declared = new Set(storedColumnsFor(next))

  const members = observed.members ?? {}
  for (const column of next.columns) {
    const was = currentColumns.get(column.name)
    // **A `links` column is a table, not a column** (M27 U2, D-300), so it is
    // settled on its own terms: made when it is missing, and when its meaning
    // moves — re-pointed, or a column that held something else — rebuilt only
    // while nothing is in it, which is the rule every other change obeys.
    // So is an `enums` column (M34 U5, D-398), whose members are words of its
    // list: a list that changes over members it holds is refused as an enum's is.
    if (isListType(column.type) || (was !== undefined && isListType(was.type))) {
      settleMembers(next, column, was, observed, members, steps, refusals)
      continue
    }
    const stored = storedColumnsOf(column)
    const held = stored.reduce((total, name) => total + (present.get(name)?.filled ?? 0), 0)
    const missing = stored.filter((name) => !present.has(name))
    const change = was === undefined ? undefined : changeBetween(was, column)

    if (missing.length === stored.length) {
      // Wholly absent, so it is an addition — unless SQLite will not take it.
      if (column.required && observed.rowCount > 0) {
        refusals.push({
          column: column.name,
          reason: 'REQUIRED_ON_ROWS',
          detail: `${column.name} is required, and ${table} already has ${rows(observed.rowCount)} with no value for it. Make it optional, or fill it in and require it afterwards.`,
        })
      } else {
        steps.push({
          kind: 'ADD_COLUMN',
          column: column.name,
          sql: [...addColumnSql(next, column), ...indexOf(next, column)],
        })
      }
      continue
    }

    if (missing.length > 0 && change === undefined) {
      // Half of a pair with no edit behind it. Only reachable if something
      // outside the app edited the file, and the honest answer is to say so
      // rather than repair it.
      //
      // **The `change === undefined` is what makes this sentence true** (U4c,
      // D-225): a `real` re-declared as a `quantity` arrives here looking
      // exactly like half a pair — the figure is there and the unit column is
      // not — and *something outside the app changed this table* would be a
      // true sentence about the wrong cause. A declaration that moved is
      // handled below, where every other change is.
      refusals.push({
        column: column.name,
        reason: 'STORAGE_MISMATCH',
        detail: `${column.name} stores itself as ${stored.join(' and ')}, and ${table} has only ${stored.filter((name) => present.has(name)).join(' and ')}. Something outside the app changed this table.`,
      })
      continue
    }

    if (change === undefined) {
      // The declaration has not moved, so the table disagreeing with it is not
      // an edit anybody made here. **This check has to come after the one
      // above, not before**: a legitimate `real` → `integer` on an empty column
      // is a table whose storage class is still the old one, and reporting that
      // as tampering would refuse the one change the reconciler is allowed to
      // make.
      const wrongClass = stored.find(
        (name) => present.get(name)?.storageClass !== storageClassOfStored(column, name),
      )
      if (wrongClass !== undefined) {
        refusals.push({
          column: column.name,
          reason: 'STORAGE_MISMATCH',
          detail: `${table}.${wrongClass} is ${present.get(wrongClass)?.storageClass ?? 'missing'} where the declaration asks for ${storageClassOfStored(column, wrongClass)}. Something outside the app changed this table.`,
        })
        continue
      }
      // **The declaration has not moved and the table has anyway** (M29 F2,
      // D-343): a column whose definition is not the one its declaration
      // compiles to. A real timesheet declared `start_hour` a time over a
      // table still checking it as a date, so every row was refused by SQLite
      // and Add did nothing at all. Empty, it is rebuilt as a type change is;
      // holding anything, it is left — what it holds may be right, and the
      // write that it refuses now says so in its own sentence.
      const definitions = observed.sql
      if (
        definitions !== undefined &&
        held === 0 &&
        missing.length === 0 &&
        !(column.required && observed.rowCount > 0) &&
        columnClauses(column).some((clause) => !definitions.includes(clause))
      ) {
        steps.push({
          kind: 'DROP_COLUMN',
          column: column.name,
          sql: stored.flatMap((stale) => [
            ...(present.get(stale)?.unique === true ? [dropUniqueIndexSql(next, stale)] : []),
            dropColumnSql(next, stale),
          ]),
        })
        steps.push({ kind: 'ADD_COLUMN', column: column.name, sql: [...addColumnSql(next, column), ...indexOf(next, column)] })
        continue
      }
      settleIndex(column)
      continue
    }

    // **Loosening is not re-constraining** (M36 U08): a column that was required
    // and is now optional refuses no value it holds, so its values are kept —
    // copied through a nullable twin, since SQLite cannot drop a NOT NULL in place.
    if (held > 0 && was !== undefined && missing.length === 0 && onlyLoosened(was, column)) {
      steps.push({ kind: 'LOOSEN_COLUMN', column: column.name, sql: loosenSql(next, column, present) })
      continue
    }
    // **A list re-declared over rows that all fit it** is rebuilt the same way
    // (M36 U09, for a pack; M38 U6, D-412, for anybody): an enum re-listed, a
    // text made an enum, an enum made a text. Nothing it holds changes meaning,
    // so it is the loosening's case and not the unit change's. A value held and
    // not listed would be refused by the copy, and is refused here instead, by
    // name — as is a column made unique over values that repeat.
    if (held > 0 && was !== undefined && missing.length === 0 && onlyRelisted(was, column)) {
      const seen = present.get(column.name)
      const values = column.type === 'enum' ? seen?.values : []
      const dropped = (values ?? []).filter((value) => !column.values.includes(value))
      const repeated = column.unique && seen?.unique !== true ? (seen?.filled ?? 0) - (seen?.distinct ?? 0) : 0
      if (values !== undefined && dropped.length === 0 && repeated === 0) {
        relisted.push(column.name)
        continue
      }
      refusals.push(
        repeated > 0
          ? {
              column: column.name,
              reason: 'NOT_UNIQUE',
              detail: `${column.name} is now unique, and ${rows(repeated)} in ${table} ${repeated === 1 ? 'repeats a value' : 'repeat a value'} another row already holds.`,
            }
          : {
              column: column.name,
              reason: was.type === column.type ? 'CONSTRAINT_CHANGED' : 'TYPE_CHANGED',
              detail:
                values === undefined
                  ? `What ${column.name} holds could not be checked against its list, so it is left as it is.`
                  : `${column.name} would allow only ${listed(column.values)}, and rows in ${table} hold ${dropped.join(', ')}. Change those rows, or list ${dropped.length === 1 ? 'it' : 'them'} too.`,
            },
      )
      continue
    }
    if (held > 0) {
      refusals.push({ column: column.name, reason: change.reason, detail: `${change.detail} ${rows(held)} in ${table} ${held === 1 ? 'holds' : 'hold'} a value for it, and what is stored may not still mean what it meant.` })
      continue
    }
    // Nothing stored, nothing to alter: a unit is a property of the declaration
    // and no SQL says it. **Unless the storage shape moved too** — a `real` in
    // grams re-declared as a `quantity` is a unit change *and* a column the
    // table has not got (U4c, D-225), and skipping it would leave the pair half
    // built with nothing saying so.
    if (change.reason === 'UNIT_CHANGED' && missing.length === 0) {
      settleIndex(column)
      continue
    }
    // Empty, so it can simply be rebuilt in its new shape. This is what makes
    // drafting a format the ordinary work H9 says it is.
    steps.push({
      kind: 'DROP_COLUMN',
      column: column.name,
      // **What the table actually has, not what the new declaration wants.**
      // The two are the same for every change that keeps a column's storage
      // shape, and they differ the moment a type change crosses the
      // one-column/two-column line — `real` to `quantity` (U4c) — where
      // dropping the new names would drop a column that is not there.
      sql: storedColumnsOf(was ?? column)
        .filter((stale) => present.has(stale))
        .flatMap((stale) => [
          ...(present.get(stale)?.unique === true ? [dropUniqueIndexSql(next, stale)] : []),
          dropColumnSql(next, stale),
        ]),
    })
    steps.push({
      kind: 'ADD_COLUMN',
      column: column.name,
      sql: [...addColumnSql(next, column), ...indexOf(next, column)],
    })
  }

  // What a vouched column is stored as, since a dropped one is seen by its SQL names (M36 U09).
  const vouchedStored = new Set([
    ...vouches,
    ...(current?.columns ?? []).filter((column) => vouches.has(column.name)).flatMap((column) => storedColumnsOf(column)),
  ])
  for (const column of observed.columns) {
    if (column.name === ROW_ID_COLUMN || declared.has(column.name)) continue
    if (column.filled > 0 && !vouchedStored.has(column.name)) {
      refusals.push({
        column: column.name,
        reason: 'DROP_WITH_DATA',
        detail: `The declaration no longer has ${column.name}, and ${rows(column.filled)} in ${table} ${column.filled === 1 ? 'holds' : 'hold'} a value for it. Put the column back, or empty it first if you meant to lose those figures.`,
      })
      continue
    }
    steps.push({
      kind: 'DROP_COLUMN',
      column: column.name,
      sql: [
        ...(column.unique ? [dropUniqueIndexSql(next, column.name)] : []),
        dropColumnSql(next, column.name),
      ],
    })
  }

  // A member table whose column the declaration no longer has as a `links` —
  // gone, or re-declared, which `settleMembers` has already answered.
  for (const [name, count] of Object.entries(members)) {
    if (next.columns.some((column) => column.name === name)) continue
    if (count > 0) {
      refusals.push({
        column: name,
        reason: 'DROP_WITH_DATA',
        detail: `The declaration no longer has ${name}, and ${table} has ${count === 1 ? 'a member' : `${String(count)} members`} listed in it. Put the column back, or clear it first if you meant to lose them.`,
      })
      continue
    }
    steps.push({ kind: 'DROP_COLUMN', column: name, sql: [dropMemberTableSql(next, { name })] })
  }

  // Last, once every other step has left the table holding each column the
  // declaration stores: the copy names them all.
  if (relisted.length > 0) {
    steps.push({ kind: 'REBUILD_TABLE', column: relisted.join(', '), sql: rebuildTableSql(next) })
  }
  settleChecks(next, observed, steps, refusals)
  return { format: next.name, table, steps, refusals }
}

/**
 * One column that is, or was, a `links` (M27 U2, D-300) — a member table where
 * every other type has a column. The four cases are the reconciler's usual
 * ones: missing is made; unchanged is left; changed is rebuilt when empty and
 * refused when not, because members of a list that now means something else
 * are the unit change wearing a third hat.
 */
function settleMembers(
  next: FormatDeclaration,
  column: ColumnDeclaration,
  was: ColumnDeclaration | undefined,
  observed: ObservedTable,
  members: Readonly<Record<string, number>>,
  steps: ReconcileStep[],
  refusals: Refusal[],
): void {
  const table = tableNameFor(next)
  const present = new Map(observed.columns.map((each) => [each.name, each]))
  const change = was === undefined ? undefined : changeBetween(was, column)
  const listed = members[column.name]
  // What the column holds now, whichever shape it is in.
  const held =
    was !== undefined && !isListType(was.type)
      ? storedColumnsOf(was).reduce((total, name) => total + (present.get(name)?.filled ?? 0), 0)
      : (listed ?? 0)

  if (change === undefined) {
    if (isListType(column.type) && listed === undefined) {
      steps.push({ kind: 'ADD_COLUMN', column: column.name, sql: [createMemberTableSql(next, column)] })
    }
    return
  }
  if (held > 0) {
    refusals.push({
      column: column.name,
      reason: change.reason,
      detail: `${change.detail} ${rows(held)} in ${table} ${held === 1 ? 'holds' : 'hold'} a value for it, and what is stored may not still mean what it meant.`,
    })
    return
  }
  const drop =
    was !== undefined && isListType(was.type)
      ? listed === undefined
        ? []
        : [dropMemberTableSql(next, was)]
      : storedColumnsOf(was ?? column)
          .filter((stale) => present.has(stale))
          .flatMap((stale) => [
            ...(present.get(stale)?.unique === true ? [dropUniqueIndexSql(next, stale)] : []),
            dropColumnSql(next, stale),
          ])
  if (drop.length > 0) steps.push({ kind: 'DROP_COLUMN', column: column.name, sql: drop })
  steps.push({
    kind: 'ADD_COLUMN',
    column: column.name,
    sql:
      isListType(column.type)
        ? [createMemberTableSql(next, column)]
        : [...addColumnSql(next, column), ...indexOf(next, column)],
  })
}

/**
 * The renames a caller asked for, as steps, and the table and the declaration
 * it held as they will be once those steps have run.
 *
 * Each stored column is renamed in place — `ALTER TABLE … RENAME COLUMN`, so
 * every value stays where it was and SQLite rewrites any trigger that reads it.
 * The reconciler's unique index is named after its column, so a unique one is
 * dropped and made again under the new name, or the next plan would look for
 * it there and not find it.
 */
function renameFirst(
  next: FormatDeclaration,
  current: FormatDeclaration | undefined,
  observed: ObservedTable | undefined,
  renames: ReadonlyMap<string, string>,
  steps: ReconcileStep[],
  refusals: Refusal[],
): { readonly observed: ObservedTable | undefined; readonly current: FormatDeclaration | undefined } {
  if (observed === undefined || current === undefined || renames.size === 0) {
    return { observed, current }
  }
  const table = tableNameFor(next)
  let seen: ObservedTable = observed
  const moved = new Map<string, string>()
  let renamedMembers = false
  const columns = new Map(current.columns.map((column) => [column.name, column]))

  for (const [to, from] of renames) {
    const was = current.columns.find((column) => column.name === from)
    if (was === undefined || to === from || !next.columns.some((column) => column.name === to)) continue
    // A `links` column's members are a table named after it (M27 U2, D-300),
    // so it is the table that is renamed, and its rows stay where they were.
    if (isListType(was.type)) {
      const count: number | undefined = seen.members?.[from]
      columns.delete(from)
      columns.set(to, { ...was, name: to })
      steps.push({
        kind: 'RENAME_COLUMN',
        column: to,
        from,
        sql:
          count === undefined
            ? []
            : [
                `ALTER TABLE ${quoteIdentifier(memberTableNameFor(next, was))} RENAME TO ${quoteIdentifier(memberTableNameFor(next, { name: to }))}`,
              ],
      })
      if (count !== undefined) {
        const rest = Object.fromEntries(Object.entries(seen.members ?? {}).filter(([name]) => name !== from))
        seen = { ...seen, members: { ...rest, [to]: count } }
      }
      renamedMembers = true
      continue
    }
    const olds = storedColumnsOf(was)
    const news = storedColumnsOf({ ...was, name: to })
    const taken = news.find((name) => seen.columns.some((column) => column.name === name) && !olds.includes(name))
    if (taken !== undefined) {
      refusals.push({
        column: to,
        reason: 'NAME_TAKEN',
        detail: `${table} already has a column called ${taken}, so ${from} cannot take that name. Pick another, or empty and remove the one that has it first.`,
      })
      continue
    }
    const sql: string[] = []
    olds.forEach((old, index) => {
      const now = news[index]
      const found = seen.columns.find((column) => column.name === old)
      if (now === undefined || found === undefined) return
      if (found.unique) sql.push(dropUniqueIndexSql(next, old))
      sql.push(`ALTER TABLE ${quoteIdentifier(table)} RENAME COLUMN ${quoteIdentifier(old)} TO ${quoteIdentifier(now)}`)
      if (found.unique) sql.push(createUniqueIndexSql(next, now))
      moved.set(old, now)
    })
    columns.delete(from)
    columns.set(to, { ...was, name: to })
    steps.push({ kind: 'RENAME_COLUMN', column: to, from, sql })
  }
  if (moved.size === 0) {
    return renamedMembers ? { observed: seen, current: { ...current, columns: [...columns.values()] } } : { observed, current }
  }

  return {
    observed: {
      ...seen,
      columns: seen.columns.map((column) => ({ ...column, name: moved.get(column.name) ?? column.name })),
      sql: undefined,
    },
    current: { ...current, columns: [...columns.values()] },
  }
}

/**
 * The row constraints' triggers (D-259): one the declaration dropped goes, one
 * it added comes — unless rows already break it, which is `NOT_HELD`.
 *
 * **Drops first and adds last.** A trigger names columns, and SQLite will not
 * drop a column a trigger reads; a new constraint may read a column this plan
 * adds. So when the plan drops any column, every trigger the table keeps is
 * taken down first and put back last — the rows they govern are the rows they
 * governed, since only an empty column is ever dropped.
 */
function settleChecks(
  next: FormatDeclaration,
  observed: ObservedTable,
  steps: ReconcileStep[],
  refusals: Refusal[],
): void {
  const present = new Set(observed.checks ?? [])
  const declared = new Map((next.constraints ?? []).map((each) => [constraintKey(each), each]))
  const rebuilding = steps.some(
    (step) => step.kind === 'DROP_COLUMN' || step.kind === 'LOOSEN_COLUMN' || step.kind === 'REBUILD_TABLE',
  )
  const drops: ReconcileStep[] = []
  const adds: ReconcileStep[] = []

  for (const key of present) {
    const kept = declared.get(key)
    if (kept !== undefined && !rebuilding) continue
    drops.push({
      kind: 'DROP_CHECK',
      column: kept === undefined ? key : constraintText(kept),
      sql: dropCheckTriggersSql(next, key),
      ...(kept === undefined ? {} : { kept: true as const }),
    })
  }
  for (const [key, each] of declared) {
    const text = constraintText(each)
    if (!present.has(key)) {
      const broken = observed.unheld?.[key] ?? 0
      if (broken > 0) {
        refusals.push({
          column: each.columns[0] ?? text,
          reason: 'NOT_HELD',
          detail: isTableConstraint(each)
            ? `"${text}" is new, and ${rows(broken)} in ${observed.name} share those values with another row already. Make them different first, or leave the constraint out.`
            : `"${text}" is new, and ${rows(broken)} in ${observed.name} ${broken === 1 ? 'breaks' : 'break'} it already. Correct ${broken === 1 ? 'it' : 'them'} first, or leave the constraint out.`,
        })
        continue
      }
    } else if (!rebuilding) {
      continue
    }
    adds.push({
      kind: 'ADD_CHECK',
      column: text,
      sql: createCheckTriggersSql(next, each),
      ...(present.has(key) ? { kept: true as const } : {}),
    })
  }
  steps.unshift(...drops)
  steps.push(...adds)
}

/**
 * How one column's declaration changed, or nothing.
 *
 * Ordered by how badly it ends. A **unit** change is first because it is the one
 * that alters no SQL at all: the column keeps its type, its constraints and
 * every figure in it, and only the meaning moves. Nothing downstream would ever
 * notice.
 */
function changeBetween(
  was: ColumnDeclaration,
  now: ColumnDeclaration,
): { readonly reason: RefusalReason; readonly detail: string } | undefined {
  // **A link that re-points is a unit change wearing another hat** (U4b,
  // D-224). It alters no SQL, loses no row, and every id in the column still
  // resolves — against a different format, to a different thing. Nothing in the
  // table records that the meaning moved, which is the property that put the
  // unit change first in this list.
  if (was.target !== now.target) {
    return {
      reason: 'TARGET_CHANGED',
      detail: `${now.name} pointed at ${was.target ?? 'nothing'} and now points at ${now.target ?? 'nothing'}.`,
    }
  }
  if (was.unit !== now.unit) {
    return {
      reason: 'UNIT_CHANGED',
      detail: `${now.name} was ${unitWord(was.unit)} and is now ${unitWord(now.unit)}.`,
    }
  }
  // **The other half of a ratio is the same danger** (U4c, D-225). A density
  // that was `g` per `ml` and is now `g` per `l` alters no SQL, loses no row,
  // and makes every figure bridged through it wrong by a thousand — which is
  // the exact shape that put the unit change at the top of this list.
  if (was.per !== now.per) {
    return {
      reason: 'UNIT_CHANGED',
      detail: `${now.name} was ${perWord(was)} and is now ${perWord(now)}.`,
    }
  }
  if (was.type !== now.type) {
    return {
      reason: 'TYPE_CHANGED',
      detail: `${now.name} was a ${was.type} and is now a ${now.type}.`,
    }
  }
  // **A decimal that moves its point re-means every figure by ten** (M24 U6,
  // D-257): `350` at two places is 3.50 and at three is 0.350. It alters no
  // storage class, which is exactly the unit change's danger — and it is filed
  // as a change of type rather than of unit because an empty column still has
  // to be rebuilt, since its bounds are compiled onto the stored integer.
  if (was.scale !== now.scale) {
    return {
      reason: 'TYPE_CHANGED',
      detail: `${now.name} kept ${String(was.scale)} places and now keeps ${String(now.scale)}.`,
    }
  }
  if (was.required !== now.required) {
    return {
      reason: 'CONSTRAINT_CHANGED',
      detail: `${now.name} ${now.required ? 'was optional and is now required' : 'was required and is now optional'}.`,
    }
  }
  if (!sameValues(was.values, now.values)) {
    return {
      reason: 'CONSTRAINT_CHANGED',
      detail: `${now.name} allowed ${listed(was.values)} and now allows ${listed(now.values)}.`,
    }
  }
  if (was.minimum !== now.minimum || was.maximum !== now.maximum) {
    return {
      reason: 'CONSTRAINT_CHANGED',
      detail: `${now.name} was bounded ${bound(was)} and is now bounded ${bound(now)}.`,
    }
  }
  return undefined
}

/**
 * Whether the one change between two declarations of a column is its list —
 * an enum re-listed, a text made an enum or an enum made a text — and, perhaps,
 * that it stopped being required (M36 U09, M38 U6). Which values the rows hold
 * is asked separately.
 */
function onlyRelisted(was: ColumnDeclaration, now: ColumnDeclaration): boolean {
  const listy = (column: ColumnDeclaration): boolean => column.type === 'enum' || column.type === 'text'
  return (
    listy(was) &&
    listy(now) &&
    (was.type === 'enum' || now.type === 'enum') &&
    (now.required ? was.required : true) &&
    changeBetween({ ...was, type: now.type, values: now.values, required: now.required }, now) === undefined
  )
}

/** Whether the one change between two declarations of a column is that it stopped being required. */
function onlyLoosened(was: ColumnDeclaration, now: ColumnDeclaration): boolean {
  return was.required && !now.required && changeBetween({ ...was, required: false }, now) === undefined
}

/**
 * A required column made optional, its values kept: each stored column is
 * copied into a nullable twin, dropped with its index, and the twin renamed
 * back and indexed again. The twin is the column under another name, so a
 * pair (`money`, `quantity`) moves pair for pair.
 */
function loosenSql(
  next: FormatDeclaration,
  column: ColumnDeclaration,
  present: ReadonlyMap<string, { readonly unique: boolean }>,
): readonly string[] {
  const table = quoteIdentifier(tableNameFor(next))
  const twin: ColumnDeclaration = { ...column, name: `${column.name}__loosened`, unique: false }
  const olds = storedColumnsOf(column)
  const news = storedColumnsOf(twin)
  return [
    ...addColumnSql(next, twin),
    `UPDATE ${table} SET ${olds.map((old, index) => `${quoteIdentifier(news[index] ?? old)} = ${quoteIdentifier(old)}`).join(', ')}`,
    ...olds.flatMap((old) => [
      ...(present.get(old)?.unique === true ? [dropUniqueIndexSql(next, old)] : []),
      dropColumnSql(next, old),
    ]),
    ...olds.map((old, index) => `ALTER TABLE ${table} RENAME COLUMN ${quoteIdentifier(news[index] ?? old)} TO ${quoteIdentifier(old)}`),
    ...indexOf(next, column),
  ]
}

/**
 * The table made again under a working name, every row copied across, the old
 * one dropped — its triggers and indexes with it — and the new one renamed into
 * its place and indexed (M36 U09). The row constraints' triggers come back in
 * `settleChecks`, as for any plan that drops a column; a `links` column's
 * member table is a table of its own and is not touched.
 */
function rebuildTableSql(next: FormatDeclaration): readonly string[] {
  const table = tableNameFor(next)
  const working = `${table}__rebuilt`
  const named = createTableSql(next).replace(quoteIdentifier(table), quoteIdentifier(working))
  const columns = storedColumnsFor(next).map(quoteIdentifier).join(', ')
  return [
    named,
    `INSERT INTO ${quoteIdentifier(working)} (${columns}) SELECT ${columns} FROM ${quoteIdentifier(table)}`,
    `DROP TABLE ${quoteIdentifier(table)}`,
    `ALTER TABLE ${quoteIdentifier(working)} RENAME TO ${quoteIdentifier(table)}`,
    ...next.columns.flatMap((each) => indexOf(next, each)),
  ]
}

/** The index a column brings with it when it is made, or none. */
function indexOf(declaration: FormatDeclaration, column: ColumnDeclaration): readonly string[] {
  return column.unique ? [createUniqueIndexSql(declaration, column.name)] : []
}

/** What storage class one of a declared column's SQL columns should have. */
function storageClassOfStored(column: ColumnDeclaration, stored: string): string {
  if (column.type === 'money') return stored.endsWith('_minor') ? 'INTEGER' : 'TEXT'
  // A quantity's figure keeps the declared name and its unit takes the suffix,
  // which is the opposite arrangement to money and the reason this is a second
  // line rather than a cleverer one.
  if (column.type === 'quantity') return stored === column.name ? 'REAL' : 'TEXT'
  switch (column.type) {
    case 'integer':
    case 'boolean':
    case 'decimal':
    case 'percent':
      return 'INTEGER'
    case 'real':
      return 'REAL'
    case 'text':
    case 'date':
    case 'time':
    case 'month':
    case 'instant':
    case 'enum':
    case 'link':
    case 'links':
    case 'enums':
    case 'elsewhere':
    case 'file':
      return 'TEXT'
  }
}

function sameValues(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function unitWord(unit: string | undefined): string {
  return unit === undefined ? 'unitless' : `in ${unit}`
}

/** `g per ml`, or what a column that is no longer a ratio has become. */
function perWord(column: ColumnDeclaration): string {
  if (column.per === undefined) return 'a plain figure'
  return `${column.unit ?? 'something'} per ${column.per}`
}

function listed(values: readonly string[]): string {
  return values.length === 0 ? 'anything' : values.join(', ')
}

function bound(column: ColumnDeclaration): string {
  const low = column.minimum === undefined ? '−∞' : String(column.minimum)
  const high = column.maximum === undefined ? '∞' : String(column.maximum)
  return `${low} to ${high}`
}

function rows(count: number): string {
  return count === 1 ? '1 row' : `${count} rows`
}
