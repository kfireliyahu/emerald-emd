/**
 * **A link found by a date** (M29 F8, D-350).
 *
 * *A day worked is paid by the paycheck of its month.* A link column may say
 * how it is filled: `found by date in period` — this row's `date` falls in the
 * target's `period` — and the engine fills it **on a write**, when the link is
 * empty, from the one target row the date falls in.
 *
 * ## It stores the link, and it never searches on read
 *
 * D-224 has no traversal and no join on read, and this adds none: the rule
 * runs where D-273's rule sets run — every generic write, before the row is
 * judged, so a dry run shows it — and what it finds is stored like a link a
 * person picked. An aggregate over the link folds exactly the rows that name
 * the slip, and nothing re-decides them every time a total is read.
 *
 * ## No row and two rows are refusals, never guesses
 *
 * A day with no slip of its month, or with two, is refused **naming them**
 * (D-272's refusal to guess): a default — the first, the latest — is an
 * opinion nobody declared, and a day folded into the wrong slip is a gross
 * that proves against the wrong figure.
 *
 * ## A link a person set is theirs
 *
 * The rule fills an empty link and nothing else. A write that changes the link
 * — to a row or to nothing — is a person's and is left alone. The one link the
 * rule moves is one it would have found itself: when the date changes and the
 * link still names the row the *old* date fell in, the row is found again for
 * the new date. A link a person set to that same row is indistinguishable from
 * the rule's and is the same answer, so nothing is lost.
 *
 * ## Two grains, one word each
 *
 * - `date in period` — the same **month**. `period` may be a month or a date
 *   (a slip printed with the day it was paid is found by that day's month).
 * - `date on paid_on` — the same **day**, a date against a date.
 *
 * Which target column it is, is the person's choice: the engine knows only
 * *this date falls in that column's month* or *on that day*.
 *
 * Plain functions over plain values: the repository reads the target's rows
 * and writes what is found.
 */

import { err, ok, type Result } from '@/core/result.ts'

import type { ColumnDeclaration, FormatDeclaration } from './declaration.ts'
import type { StoredRow, StoredValue } from './row.ts'

export type FoundGrain = 'MONTH' | 'DAY'

/** How a link column is filled: this row's `from` falls in the target's `in`. */
export interface FoundBy {
  /** A date column of the format the link is on — `date`. */
  readonly from: string
  /** A date or month column of the target — `period`. */
  readonly in: string
  /** `MONTH`: the same month (`in`); `DAY`: the same day (`on`). */
  readonly grain: FoundGrain
}

const SENTENCE = /^(\w+) (in|on) (\w+)$/

const EXAMPLE = '`date in period` (the same month) or `date on paid_on` (the same day)'

/** `date in period` or `date on paid_on` — the one spelling, in a file, a row and a tool. */
export function parseFoundBy(text: string): Result<FoundBy, string> {
  const sentence = text.trim().replace(/\s+/g, ' ').replace(/^found by /, '')
  const matched = SENTENCE.exec(sentence)
  if (matched === null) {
    return err(`"${text.trim()}" is not how a link is found. Write this row's date and the target's column it falls in — ${EXAMPLE}.`)
  }
  const [, from = '', word = '', column = ''] = matched
  return ok({ from, in: column, grain: word === 'on' ? 'DAY' : 'MONTH' })
}

/** What `parseFoundBy` reads back. */
export function foundByText(found: FoundBy): string {
  return `${found.from} ${found.grain === 'DAY' ? 'on' : 'in'} ${found.in}`
}

/**
 * What is wrong with a link's `found by`, against the format it is on and the
 * one it points at — or undefined. `target` is undefined when the document
 * declares no such format, which the link's own check has already said.
 */
export function foundByRejection(
  column: ColumnDeclaration,
  found: FoundBy,
  self: FormatDeclaration,
  target: FormatDeclaration | undefined,
): string | undefined {
  const who = `${self.name}.${column.name}`
  if (column.type !== 'link') {
    return `${who} is found by ${foundByText(found)}, and only a link to one row is found — a ${column.type} is not.`
  }
  const from = self.columns.find((each) => each.name === found.from)
  if (from === undefined) {
    return `${who} is found by ${found.from}, and ${self.name} has no column called that.`
  }
  if (from.type !== 'date') {
    return `${who} is found by ${found.from}, which is a ${from.type}. A link is found by a day this row is about, so ${found.from} is a date.`
  }
  if (target === undefined) return undefined
  const into = target.columns.find((each) => each.name === found.in)
  if (into === undefined) {
    return `${who} is found by ${found.from} ${found.grain === 'DAY' ? 'on' : 'in'} ${target.name}.${found.in}, and ${target.name} has no column called that.`
  }
  if (into.type !== 'date' && into.type !== 'month') {
    return `${who} is found by ${found.from} in ${target.name}.${found.in}, which is a ${into.type}. A date falls in a month or on a date.`
  }
  if (found.grain === 'DAY' && into.type !== 'date') {
    return `${who} is found by ${found.from} on ${target.name}.${found.in}, which is a month. A day falls *in* a month — \`${found.from} in ${found.in}\`.`
  }
  return undefined
}

/** Does this date fall in this target cell, at this grain? */
export function fallsIn(date: string, value: string, grain: FoundGrain): boolean {
  return grain === 'DAY' ? date === value : date.slice(0, 7) === value.slice(0, 7)
}

/** The target rows a date falls in. */
export type Found =
  | { readonly kind: 'ONE'; readonly id: string }
  | { readonly kind: 'NONE' }
  | { readonly kind: 'MANY'; readonly ids: readonly string[] }

export function findRow(found: FoundBy, date: string, rows: readonly StoredRow[]): Found {
  const ids = rows
    .filter((row) => {
      const value = row.cells[found.in]
      return typeof value === 'string' && fallsIn(date, value, found.grain)
    })
    .map((row) => row.id)
  if (ids.length === 0) return { kind: 'NONE' }
  if (ids.length > 1) return { kind: 'MANY', ids }
  return { kind: 'ONE', id: ids[0] ?? '' }
}

/** One link a format's writes fill, with the rows it is found among. */
export interface Finder {
  /** The link column, carrying its `foundBy`. */
  readonly column: ColumnDeclaration & { readonly foundBy: FoundBy }
  readonly target: FormatDeclaration
  readonly rows: readonly StoredRow[]
}

/** The links of `declaration` that are found by a date. */
export function foundColumns(
  declaration: FormatDeclaration,
): readonly (ColumnDeclaration & { readonly foundBy: FoundBy })[] {
  return declaration.columns.filter(
    (column): column is ColumnDeclaration & { readonly foundBy: FoundBy } =>
      column.type === 'link' && column.foundBy !== undefined,
  )
}

/** A link the rule could not fill, and the cell it is about. */
export interface FoundRefusal {
  readonly column: string
  readonly reason: string
}

export interface FoundWrite {
  readonly cells: Readonly<Record<string, StoredValue>>
  readonly refusals: readonly FoundRefusal[]
}

function present(value: StoredValue | undefined): value is string {
  return typeof value === 'string' && value !== ''
}

/**
 * A write with its found links filled. `cells` is what the writer sends — every
 * column for a new row, the ones named for an edit — and `before` the row as it
 * stood, empty for a new one.
 */
export function applyFinds(
  finders: readonly Finder[],
  cells: Readonly<Record<string, StoredValue>>,
  before: Readonly<Record<string, StoredValue>> = {},
): FoundWrite {
  let result: Record<string, StoredValue> = { ...cells }
  const refusals: FoundRefusal[] = []
  for (const finder of finders) {
    const { column, rows } = finder
    const found = column.foundBy
    const linkBefore = before[column.name] ?? null
    const linkNow = column.name in cells ? (cells[column.name] ?? null) : linkBefore
    // A writer that changed the link — to a row or to nothing — said which.
    if (linkNow !== linkBefore) continue
    const dateBefore = before[found.from] ?? null
    const dateNow = found.from in cells ? (cells[found.from] ?? null) : dateBefore
    if (present(linkNow)) {
      // Moved only when the date moved and the link is the row the old date
      // fell in: the rule's own answer, asked again.
      if (dateNow === dateBefore || !present(dateBefore)) continue
      const old = findRow(found, dateBefore, rows)
      if (old.kind !== 'ONE' || old.id !== linkNow) continue
    }
    if (!present(dateNow)) continue
    const decided = findRow(found, dateNow, rows)
    if (decided.kind === 'ONE') {
      result = { ...result, [column.name]: decided.id }
      continue
    }
    refusals.push({ column: column.name, reason: refusalOf(finder, dateNow, decided) })
  }
  return { cells: result, refusals }
}

function refusalOf(finder: Finder, date: string, decided: Found): string {
  const { column, target, rows } = finder
  const found = column.foundBy
  const into = target.columns.find((each) => each.name === found.in)
  const shown = found.grain === 'DAY' ? date : date.slice(0, 7)
  const where =
    found.grain === 'DAY'
      ? `${found.in} ${shown}`
      : into?.type === 'month'
        ? `${found.in} ${shown}`
        : `${found.in} in ${shown}`
  if (decided.kind === 'NONE') {
    return `${column.name} is found by ${foundByText(found)}, and no ${target.title} has ${where} for the ${found.from} ${date}. Record that ${target.title} first, or name one.`
  }
  const ids = decided.kind === 'MANY' ? decided.ids : []
  const naming = target.columns.find((each) => each.type === 'text')
  const names = ids
    .map((id) => {
      const cell = naming === undefined ? undefined : rows.find((row) => row.id === id)?.cells[naming.name]
      return typeof cell === 'string' && cell !== '' ? { by: cell, shown: `"${cell}"` } : { by: id, shown: id }
    })
    .sort((a, b) => (a.by < b.by ? -1 : a.by > b.by ? 1 : 0))
    .map((each) => each.shown)
  return `${column.name} is found by ${foundByText(found)}, and ${ids.length} ${target.title} rows have ${where} — ${names.join(', ')} — so which one the ${found.from} ${date} falls in is not a guess the engine makes. Name one.`
}

/* ------------------------------------------------- applied to the rows there */

/** A row the rule would fill, the day it is found by, and the row it found. */
export interface Placement {
  readonly id: string
  /** What the row is called — its first text column — or undefined. */
  readonly name: string | undefined
  readonly date: string
  readonly to: string
  /** What the found row is called, or undefined. */
  readonly toName: string | undefined
}

/** A row whose link is empty and that the rule cannot fill, and why. */
export type Unplaced =
  | { readonly kind: 'NO_DATE'; readonly id: string; readonly name: string | undefined }
  | { readonly kind: 'NONE'; readonly id: string; readonly name: string | undefined; readonly date: string }
  | {
      readonly kind: 'MANY'
      readonly id: string
      readonly name: string | undefined
      readonly date: string
      /** What the rows it falls in are called — their ids where they have no name. */
      readonly names: readonly string[]
    }

/**
 * **What applying a found-by rule to the rows already there would do** (M29
 * F11, D-353): every row whose link is empty, placed or said why not.
 */
export interface FindPlan {
  /** The link column. */
  readonly column: string
  readonly foundBy: FoundBy
  readonly target: FormatDeclaration
  /** Every row of the format the link is on. */
  readonly rows: number
  /** Rows whose link is empty — `placements` and `unplaced` together. */
  readonly empty: number
  readonly placements: readonly Placement[]
  readonly unplaced: readonly Unplaced[]
}

/**
 * The column a row is called by — `labelColumn`'s rule (the first text
 * column), restated because `declaration.ts` imports this file.
 */
function namingOf(declaration: Pick<FormatDeclaration, 'columns'>): ColumnDeclaration | undefined {
  return declaration.columns.find((each) => each.type === 'text')
}

function nameIn(row: StoredRow | undefined, naming: ColumnDeclaration | undefined): string | undefined {
  const cell = naming === undefined || row === undefined ? undefined : row.cells[naming.name]
  return typeof cell === 'string' && cell !== '' ? cell : undefined
}

/**
 * The rule run over `rows`, the rows of the format the link is on — **only
 * where the link is empty**. A link already set, whether a person picked it or
 * the rule found it, is not asked about at all: applying to the rows there
 * fills what is missing and moves nothing (the write-time rule's promise,
 * D-350, kept on demand).
 */
export function planFinds(finder: Finder, self: Pick<FormatDeclaration, 'columns'>, rows: readonly StoredRow[]): FindPlan {
  const { column, target } = finder
  const found = column.foundBy
  const own = namingOf(self)
  const theirs = namingOf(target)
  const byId = new Map(finder.rows.map((row) => [row.id, row]))
  const placements: Placement[] = []
  const unplaced: Unplaced[] = []
  for (const row of rows) {
    if (present(row.cells[column.name])) continue
    const name = nameIn(row, own)
    const date = row.cells[found.from]
    if (!present(date)) {
      unplaced.push({ kind: 'NO_DATE', id: row.id, name })
      continue
    }
    const decided = findRow(found, date, finder.rows)
    if (decided.kind === 'ONE') {
      placements.push({ id: row.id, name, date, to: decided.id, toName: nameIn(byId.get(decided.id), theirs) })
    } else if (decided.kind === 'NONE') {
      unplaced.push({ kind: 'NONE', id: row.id, name, date })
    } else {
      const names = decided.ids.map((id) => nameIn(byId.get(id), theirs) ?? id).sort()
      unplaced.push({ kind: 'MANY', id: row.id, name, date, names })
    }
  }
  return {
    column: column.name,
    foundBy: found,
    target,
    rows: rows.length,
    empty: placements.length + unplaced.length,
    placements,
    unplaced,
  }
}

/**
 * The part of a row's date the rule matches on: the month (`2026-03`) for
 * `in`, the day for `on` — what a reason names.
 */
export function matchedOn(found: FoundBy, date: string): string {
  return found.grain === 'DAY' ? date : date.slice(0, 7)
}
