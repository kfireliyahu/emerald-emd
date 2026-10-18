/**
 * **A row constraint: what has to be true across the columns of one row**
 * (M24 U7, D-259).
 *
 * A bound is a fact about one cell. The ledger's `CHECK`s that span two cells
 * say one of three things and nothing else (D-252), so those three are the
 * language — and its composite `UNIQUE` indexes a fourth:
 *
 * - **required when** — `auto_track_category is required only when auto_track_kind
 *   is CATEGORY`. A column is filled when an enum is one of these
 *   members; with `only`, it is empty when it is not, which is what the debt's
 *   `CHECK` actually says.
 * - **at most one of** — `at most one of linked_goal, linked_debt, linked_fund`.
 *   This is how a reference that may name one of several formats is declared:
 *   several ordinary links, at most one set, and never a link to *any of N*
 *   formats (D-252) — D-224's one hop has to keep meaning one known table.
 * - **a sign when** — `amount is at most 0 when direction is OUTFLOW`. The
 *   transaction's rule that refunds do not inflate spending (D-004), on a
 *   `money` column, which takes no bounds of its own.
 * - **one row per** — `one row per account, natural_key`, and filtered, `one
 *   row per plan when mode is REMAINDER` (M25 E1, D-270). What `unique` says of
 *   one column (D-255), across two or more — or of one, under a condition. It
 *   is a fact about the table rather than the row, so it compiles to a `UNIQUE`
 *   index rather than a trigger, and `repeatedValues` rather than
 *   `constraintHolds` refuses it at the write.
 *
 * **Structure, never SQL** (D-216, D-137). A constraint is fields, and its text
 * is one sentence written from them and read back into them. The sentence is
 * the artefact's cell and the stored form, as an identity's equation is: no
 * reader ever meets a `CHECK` somebody typed.
 *
 * **Why nothing richer.** No `OR`, no comparison between two columns, no
 * arithmetic. Each would be one more shape the ledger never asked for, and the
 * next step from there is a free-text `CHECK` with a grammar in front of it.
 * The category tree's two-level cap is not one of these and stays code.
 *
 * This file imports nothing at run time: a constraint is judged against the
 * columns it is handed, and what a column is stored as is `ddl.ts`'s and
 * `row.ts`'s to know, so `declaration.ts` can call in here without a cycle.
 */

import { err, ok, type Result } from '@/core/result.ts'

import type { ColumnDeclaration, ColumnType } from './declaration.ts'

export const CONSTRAINT_KINDS = ['REQUIRED_WHEN', 'AT_MOST_ONE', 'SIGN_WHEN', 'ONE_PER'] as const
export type ConstraintKind = (typeof CONSTRAINT_KINDS)[number]

/** Which side of zero, and zero is on both: the ledger's rule is `<= 0` and `>= 0`. */
export const SIGNS = ['AT_MOST_ZERO', 'AT_LEAST_ZERO'] as const
export type Sign = (typeof SIGNS)[number]

/**
 * One row constraint.
 *
 * Flat rather than a union, like `ColumnDeclaration`: a field a kind does not
 * use is empty, and `constraintProblem` refuses one that is not.
 */
export interface RowConstraint {
  readonly kind: ConstraintKind
  /**
   * What it constrains — one column for `REQUIRED_WHEN` and `SIGN_WHEN`, two or
   * more for `AT_MOST_ONE`, and for `ONE_PER` the columns no two rows may share
   * all of: two or more, or one under a `when`.
   */
  readonly columns: readonly string[]
  /**
   * The enum column that decides whether it applies. Not for `AT_MOST_ONE`;
   * optional for `ONE_PER`, where it may also be one of the columns.
   */
  readonly when: string | undefined
  /** The members of `when` under which it applies. */
  readonly is: readonly string[]
  /**
   * `REQUIRED_WHEN` only: and empty when `when` is anything else. The debt's
   * rule is both halves — a reference while tracking is off is a figure
   * nothing reads, which is a lie in a cell rather than a harmless extra.
   */
  readonly only: boolean
  /** `SIGN_WHEN` only. */
  readonly sign: Sign | undefined
  /** Why it has to hold, in the person's words. Prose, stored, never parsed. */
  readonly note: string
}

/** The types a sign may be put on: a figure with a zero. */
const SIGNED_TYPES: ReadonlySet<ColumnType> = new Set<ColumnType>([
  'integer',
  'real',
  'decimal',
  'percent',
  'money',
  'quantity',
])

/**
 * The types `one row per` may name: a value two rows can be equal in exactly.
 * `UNIQUE_TYPES` (D-255) and, since a column here is one of several, the ones
 * too coarse to be unique alone — an enum, a boolean, a moment. Not a `real`
 * (a float's equality), and not `money` or `quantity`, which are two columns
 * each. Listed rather than built from `UNIQUE_TYPES`, which would be an import
 * cycle; `constraint.test.ts` holds the two together.
 */
export const ONE_PER_TYPES: ReadonlySet<ColumnType> = new Set<ColumnType>([
  'text',
  'integer',
  'date',
  'link',
  'decimal',
  'month',
  'instant',
  'enum',
  'boolean',
])

/**
 * Whether a constraint is kept by an index rather than by triggers — a fact
 * about the table, which no single row can be judged on (D-270).
 */
export function isTableConstraint(each: Pick<RowConstraint, 'kind'>): boolean {
  return each.kind === 'ONE_PER'
}

/** A constraint, filled in with the defaults a kind does not use. */
export function rowConstraint(
  kind: ConstraintKind,
  columns: readonly string[],
  extra: Partial<Omit<RowConstraint, 'kind' | 'columns'>> = {},
): RowConstraint {
  return {
    kind,
    columns,
    when: extra.when,
    is: extra.is ?? [],
    only: extra.only ?? false,
    sign: extra.sign,
    note: extra.note ?? '',
  }
}

/**
 * The constraint as one sentence — the artefact's cell, the stored form, and
 * what a refusal quotes. Deterministic, and `parseConstraint` reads back
 * exactly what this writes.
 */
export function constraintText(each: RowConstraint): string {
  const members = each.is.join(', ')
  switch (each.kind) {
    case 'REQUIRED_WHEN':
      return `${each.columns[0] ?? ''} is required ${each.only ? 'only ' : ''}when ${each.when ?? ''} is ${members}`
    case 'AT_MOST_ONE':
      return `at most one of ${each.columns.join(', ')}`
    case 'SIGN_WHEN':
      return `${each.columns[0] ?? ''} is ${each.sign === 'AT_LEAST_ZERO' ? 'at least' : 'at most'} 0 when ${each.when ?? ''} is ${members}`
    case 'ONE_PER':
      return `one row per ${each.columns.join(', ')}${each.when === undefined ? '' : ` when ${each.when} is ${members}`}`
  }
}

const REQUIRED_PATTERN = /^(\w+) is required (only )?when (\w+) is (.+)$/
const AT_MOST_ONE_PATTERN = /^at most one of (.+)$/
const SIGN_PATTERN = /^(\w+) is (at most|at least) 0 when (\w+) is (.+)$/
const ONE_PER_PATTERN = /^one row per (.+?)(?: when (\w+) is (.+))?$/

/**
 * A sentence back into a constraint, or the sentence saying what the four
 * shapes are. Only the shape is read here; whether the columns exist is
 * `constraintProblem`'s.
 */
export function parseConstraint(text: string, note = ''): Result<RowConstraint, string> {
  const sentence = text.trim().replace(/\s+/g, ' ')
  const list = (cell: string): readonly string[] =>
    cell.split(',').map((each) => each.trim()).filter((each) => each !== '')

  const required = REQUIRED_PATTERN.exec(sentence)
  if (required !== null) {
    return ok(
      rowConstraint('REQUIRED_WHEN', [required[1] ?? ''], {
        only: required[2] !== undefined,
        when: required[3],
        is: list(required[4] ?? ''),
        note,
      }),
    )
  }
  const oneOf = AT_MOST_ONE_PATTERN.exec(sentence)
  if (oneOf !== null) return ok(rowConstraint('AT_MOST_ONE', list(oneOf[1] ?? ''), { note }))
  const sign = SIGN_PATTERN.exec(sentence)
  if (sign !== null) {
    return ok(
      rowConstraint('SIGN_WHEN', [sign[1] ?? ''], {
        sign: sign[2] === 'at least' ? 'AT_LEAST_ZERO' : 'AT_MOST_ZERO',
        when: sign[3],
        is: list(sign[4] ?? ''),
        note,
      }),
    )
  }
  const onePer = ONE_PER_PATTERN.exec(sentence)
  if (onePer !== null) {
    return ok(
      rowConstraint('ONE_PER', list(onePer[1] ?? ''), {
        when: onePer[2],
        is: onePer[2] === undefined ? [] : list(onePer[3] ?? ''),
        note,
      }),
    )
  }
  return err(
    `"${sentence}" is not a constraint this build reads. There are four: ` +
      '`x is required when kind is A, B` (add `only` before `when` for "and empty otherwise"), ' +
      '`at most one of a, b, c`, `amount is at most 0 when direction is OUTFLOW` (or `at least`), ' +
      'and `one row per a, b` (optionally `when kind is A, B`).',
  )
}

/**
 * Why a constraint cannot stand against these columns, or nothing.
 *
 * **Each refusal is a constraint that could never be kept, or one that could
 * never be broken** — a column that is already required cannot be at most one
 * of anything, and a member the enum does not have is a condition that never
 * comes true. Both would be a rule the document shows and nothing ever tests.
 */
export function constraintProblem(
  each: RowConstraint,
  columns: readonly ColumnDeclaration[],
): string | undefined {
  const text = constraintText(each)
  const named = new Map(columns.map((column) => [column.name, column]))

  if (!(CONSTRAINT_KINDS as readonly string[]).includes(each.kind)) {
    return `A constraint is ${CONSTRAINT_KINDS.join(', ')}, not ${String(each.kind)}.`
  }
  for (const name of each.columns) {
    if (!named.has(name)) return `The constraint "${text}" names ${name}, which this format has not got.`
  }
  if (new Set(each.columns).size !== each.columns.length) {
    return `The constraint "${text}" names a column twice.`
  }

  if (each.kind === 'AT_MOST_ONE') {
    if (each.columns.length < 2) {
      return `"${text}" names ${each.columns.length === 0 ? 'no column' : 'one column'}; at most one of something needs two or more.`
    }
    const required = each.columns.find((name) => named.get(name)?.required === true)
    if (required !== undefined) {
      return `"${text}" names ${required}, which is required and so always set — the others could never be.`
    }
    if (each.when !== undefined || each.is.length > 0 || each.sign !== undefined || each.only) {
      return `"${text}" applies always; it takes no \`when\`, members, sign or \`only\`.`
    }
    return undefined
  }

  if (each.kind === 'ONE_PER') {
    if (each.columns.length === 0) return `"${text}" names no column.`
    if (each.columns.length === 1 && each.when === undefined) {
      return `"${text}" names one column and no condition; that is the column's own \`unique\`.`
    }
    for (const name of each.columns) {
      const column = named.get(name)
      if (column !== undefined && !ONE_PER_TYPES.has(column.type)) {
        return `"${text}" names ${name}, which is a ${column.type}; one row per takes ${[...ONE_PER_TYPES].join(', ')}.`
      }
    }
    if (each.sign !== undefined || each.only) return `"${text}" takes no sign or \`only\`.`
    if (each.when === undefined) {
      return each.is.length > 0 ? `"${text}" names members and no enum.` : undefined
    }
    return deciderProblem(each, named, text)
  }

  if (each.columns.length !== 1) {
    return `"${text}" constrains one column and names ${each.columns.length}.`
  }
  const target = named.get(each.columns[0] ?? '')
  if (each.when !== undefined && each.when !== '' && each.when === target?.name) {
    return `"${text}" is decided by the column it constrains.`
  }
  const decider = deciderProblem(each, named, text)
  if (decider !== undefined) return decider

  if (each.kind === 'REQUIRED_WHEN') {
    if (target?.required === true) {
      return `"${text}" is about ${target.name}, which is already required on every row.`
    }
    if (each.sign !== undefined) return `"${text}" is about being filled; it takes no sign.`
    return undefined
  }

  // SIGN_WHEN
  if (target === undefined || !SIGNED_TYPES.has(target.type)) {
    return `"${text}" puts a sign on ${target?.name ?? 'nothing'}, which is a ${target?.type ?? 'missing column'}; a sign goes on ${[...SIGNED_TYPES].join(', ')}.`
  }
  if (each.sign === undefined || !(SIGNS as readonly string[]).includes(each.sign)) {
    return `"${text}" does not say which side of zero.`
  }
  if (each.only) return `"${text}" takes no \`only\`; that is for required.`
  return undefined
}

/**
 * What is wrong with the enum that decides a constraint and the members it
 * names, or nothing. It is an enum of the same format, and a member it has not
 * got is a condition that never comes true.
 */
function deciderProblem(
  each: RowConstraint,
  named: ReadonlyMap<string, ColumnDeclaration>,
  text: string,
): string | undefined {
  const when = each.when === undefined ? undefined : named.get(each.when)
  if (each.when === undefined || each.when === '') return `"${text}" does not say which enum decides it.`
  if (when === undefined) return `The constraint "${text}" names ${each.when}, which this format has not got.`
  if (when.type !== 'enum') {
    return `"${text}" is decided by ${when.name}, which is a ${when.type}; a constraint is decided by an enum.`
  }
  if (each.is.length === 0) return `"${text}" names no member of ${when.name}.`
  for (const member of each.is) {
    if (!when.values.includes(member)) {
      return `"${text}" names ${member}, and ${when.name} is one of ${when.values.join(', ')}.`
    }
  }
  if (new Set(each.is).size !== each.is.length) return `"${text}" names a member twice.`
  return undefined
}

/**
 * Whether one row keeps it, given how to read a column's figure — its stored
 * value, `null` when empty. The same logic `ddl.ts` compiles into SQL, so the
 * dry run refuses exactly what the trigger would.
 *
 * `when` empty is *not one of the members*: a rule that applies when the
 * direction is OUTFLOW does not apply to a row with no direction.
 */
export function constraintHolds(
  each: RowConstraint,
  figure: (column: string) => string | number | null,
): boolean {
  // A fact about the table, not the row: `repeatedValues` judges it (D-270).
  if (each.kind === 'ONE_PER') return true
  if (each.kind === 'AT_MOST_ONE') {
    return each.columns.filter((name) => figure(name) !== null).length <= 1
  }
  const decider = figure(each.when ?? '')
  const applies = typeof decider === 'string' && each.is.includes(decider)
  const value = figure(each.columns[0] ?? '')
  if (each.kind === 'REQUIRED_WHEN') {
    if (applies) return value !== null
    return each.only ? value === null : true
  }
  if (!applies || value === null) return true
  const number = typeof value === 'number' ? value : Number(value)
  return each.sign === 'AT_LEAST_ZERO' ? number >= 0 : number <= 0
}

/**
 * A short, stable key for a constraint — what the reconciler names its trigger
 * after, so a constraint that changes is a different trigger and one that does
 * not is found again. FNV-1a over the sentence; the note is prose and changing
 * it re-constrains nothing.
 */
export function constraintKey(each: RowConstraint): string {
  let hash = 0x811c9dc5
  for (const char of constraintText(each)) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
