/**
 * **A reading: a document's columns pointed at a format's** — M19 U5,
 * [D-226](../../../docs/09-decision-log.md).
 *
 * This is where arrow 1 joins the other two. U1 to U4c built a format that
 * compiles, proves itself and reaches across a link; every row in one so far
 * arrived one at a time, from a conversation or a form. A person with four
 * hundred lines in a spreadsheet has no way in, and *"read a document"* is the
 * first of the three arrows the whole engine is named for.
 *
 * ## Why this is a retarget and not a second importer
 *
 * The pack has read documents onto tables since M2, and everything load-bearing
 * about how it does it is a statement about **documents**, not about money:
 *
 * > **The user maps the columns; the app only guesses** (D-013). Being wrong is
 * > cheap because the mapping is on screen next to what it produces; being
 * > silent is not.
 *
 * What was domain-bound was only ever the *vocabulary* — `ColumnRoleId`, a
 * closed list of things a card statement's columns can mean. **A declared
 * format brings its own**: the keys a reading may bind are exactly
 * `offeredKeysOf`, the same keys a conversation offers `record_format_rows`,
 * which is why a sheet and a tool call end up in the same `coerceRow` and there
 * is one answer in this build to *what is that value*.
 *
 * So the split is the one D-138 keeps asking for, and each half proves one
 * thing:
 *
 * - **a reading says which cell belongs to which key** — judgement, on screen,
 *   corrected by a person;
 * - **`row.ts` says whether that is a value of that column** — typing, the same
 *   code for every way in;
 * - **the identities say whether the rows add up** — U3, on the staged rows,
 *   before a single one is written.
 *
 * The third is the part a hand-written importer never gets for free, and it is
 * the reason `Σ rows = printed total` has been sitting in the roadmap since U3
 * waiting for *a document behind it*: the proof is not something intake
 * performs, it is the document's own declaration evaluated on what intake is
 * about to write.
 *
 * ## What a reading deliberately cannot do
 *
 * **It fills a `link` from a column only by an exact name** (M24 U9, D-261).
 * Turning `עגבניות 4.90` into a link to an ingredient was
 * [H10](../../../docs/engine.md), and the shape that would answer it by
 * accident is fuzzy matching buried in a reader with no confirm surface —
 * D-138's law waiting to be broken somewhere new. So a column of the file may
 * fill a link only when the target's naming column is declared `unique`
 * (D-255), and a cell is then the name a person uses for that row (D-256),
 * matched exactly or not at all. A cell that names nothing is a line the reading
 * refuses, by line — never a link left empty. A link may still be held **fixed
 * for the whole file**: a person picks the recipe once, and four hundred lines
 * point at it. Matching is the repository's (`resolveReadLinks`), because it is
 * a question about the document and this file has none.
 *
 * **It knows nothing about SQLite and nothing about SheetJS.** A cell arrives
 * here already typed as whatever the file said it was (`ReadCell`); the
 * adapter that makes one out of a spreadsheet lives in the data layer, because
 * `src/domain/format/` imports neither the pack nor a parser.
 */

import { cleanText, normalizeHeader, parseFigureText } from '@/core/text.ts'
import {
  inferNumericDateOrder,
  parseNumericDate,
  toISODate,
  tryLocalDate,
  type NumericDateOrder,
} from '@/core/time.ts'

import {
  companionKeyOf,
  coerceRow,
  offeredKeysOf,
  type StoredRow,
  type StoredValue,
} from './row.ts'
import { isLinkType, labelColumn, namingScope, type ColumnDeclaration, type FormatDeclaration } from './declaration.ts'
import { timeOfDayFraction } from './span.ts'
import { SEEDED_UNITS, type UnitTable } from './unit.ts'

/* ------------------------------------------------------------- what a cell is */

/**
 * One cell of a document, as the file itself typed it.
 *
 * **A discriminated union rather than a string**, because a spreadsheet already
 * knows the difference between `44087` the number and `2020-09-18` the date, and
 * a reader that flattened everything to text would have to guess it back — which
 * is how a serial number becomes a quantity of forty-four thousand. Text is the
 * case that needs parsing, and it is one case rather than all of them.
 *
 * `text` is carried on every kind so that a problem can quote the cell as the
 * person sees it in their own file, which is the only version of it they can
 * look for.
 */
export type ReadCell =
  | { readonly kind: 'empty'; readonly text: string }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'number'; readonly text: string; readonly value: number }
  | { readonly kind: 'boolean'; readonly text: string; readonly value: boolean }
  | {
      readonly kind: 'date'
      readonly text: string
      readonly year: number
      readonly month: number
      readonly day: number
    }

/** A document as a rectangle of cells. Blank rows are kept: row `i` here is row `i + 1` of the file. */
export interface ReadTable {
  readonly rows: readonly (readonly ReadCell[])[]
  readonly columnCount: number
  /**
   * Per column, what joins the members of a list **the file itself held as a
   * list** — a note's frontmatter `tags: [a, b]` (M34 U7). A mapping onto an
   * `enums` or `links` key splits by it without being told, because the file
   * said so; a spreadsheet has none, and its separator is still the person's.
   */
  readonly separators?: readonly (string | undefined)[] | undefined
  /**
   * Per row, what the file calls it where a line number names nothing a person
   * can look for — a note's file name (M34 U7). A refusal names the row by it.
   */
  readonly rowNames?: readonly (string | undefined)[] | undefined
  /**
   * Per column, whether the file wrote it **in prose** — the links a note's
   * body makes (M38 U2). A link there is a mention, not a required value, so a
   * member that names no row is left out of the row and named in the read's
   * report rather than refusing the row; and the guess maps such a column only
   * onto the one `links` column pointing where its links resolve.
   */
  readonly prose?: readonly boolean[] | undefined
  /**
   * Per column, the source whose rows its cells name **by the key each row was
   * written under** (M38 U4, D-408) — a note's items carry their note's file
   * name, and it is that note's row whatever its title. A link filled from such
   * a column is resolved through the rows that source wrote, never by a name.
   */
  readonly keyedBy?: readonly (string | undefined)[] | undefined
  /** Per column, which part of a note's item it holds (M38 U4) — guessed by what it is. */
  readonly parts?: readonly (ItemPart | undefined)[] | undefined
}

/** The parts of a note's item the guess maps by what they are, not by their header's words (M38 U4). */
export type ItemPart = 'figure' | 'unit' | 'link' | 'checked' | 'text'

/**
 * What a link to **a row this same read writes** holds until that row exists
 * (M38 U4): the line it is read from. The row's id is drawn when the read is
 * written, in the same transaction, and every such link is set to it there
 * (`recordIntake`) — so two notes of one folder that link each other are both
 * filled.
 */
export function pendingRowId(line: number): string {
  return `(this read's line ${String(line + 1)})`
}

/**
 * A row's links to rows of its own read, each set to the id `idOf` gives its
 * line — or left standing in when it gives none (M38 U4).
 */
export function withPendingRows(
  declaration: Pick<FormatDeclaration, 'name' | 'columns'>,
  cells: Readonly<Record<string, StoredValue>>,
  idOf: (line: number) => string | undefined,
): Readonly<Record<string, StoredValue>> {
  let out: Record<string, StoredValue> | undefined
  const swap = (value: string): string => {
    const line = pendingRowLine(value)
    return line === undefined ? value : (idOf(line) ?? value)
  }
  for (const column of declaration.columns) {
    if (!isLinkType(column.type) || column.target !== declaration.name) continue
    const value = cells[column.name]
    if (typeof value === 'string') {
      const next = swap(value)
      if (next !== value) (out ??= { ...cells })[column.name] = next
    } else if (Array.isArray(value)) {
      const next = (value as readonly string[]).map(swap)
      if (next.some((each, at) => each !== value[at])) (out ??= { ...cells })[column.name] = next
    }
  }
  return out ?? cells
}

/** The line a `pendingRowId` stands for, or `undefined` for any other value. */
export function pendingRowLine(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const match = /^\(this read's line (\d+)\)$/.exec(value)
  return match === null ? undefined : Number(match[1]) - 1
}

/** How a row of a table is named to a person: its own name, else its line. */
export function rowLabel(table: ReadTable | undefined, line: number): string {
  return table?.rowNames?.[line] ?? `line ${String(line + 1)}`
}

/**
 * Which way round a written date is.
 *
 * `@/core/time.ts`'s, which the pack's importer reads through as well (M45 F1),
 * and not the pack's `DateOrder`, for the reason the boundary test exists. It
 * is three answers because there are only three, and
 * `ymd` is here because an export that writes `2026-09-18` is ordinary and
 * reading it as day-first silently fails on the nineteenth of every month.
 */
export type DateOrder = NumericDateOrder

/* --------------------------------------------------------- what a reading is */

/**
 * One sheet column, bound to one key of the format.
 *
 * `key` is a member of `offeredKeysOf(declaration)` — a column's own name, or
 * the companion key of a two-column type (`amount_currency`, `amount_unit`).
 * **Binding keys rather than columns is what makes `money` and `quantity` work
 * without a special case**: a file with a currency column and a file whose
 * currency is the same on every row differ in where the key's value comes from
 * and in nothing else.
 */
export interface ReadingColumn {
  /** The index of the column in the file. */
  readonly index: number
  readonly key: string
  /**
   * What splits one cell into several members, for a column read onto an
   * `enums` key (M34 U5, D-398) — `,` for `vegan, quick`. **Stated by the
   * mapping and never guessed**: absent, a cell is one member, and one that is
   * not on the list is refused by name like any other.
   */
  readonly separator?: string | undefined
}

/** A key whose value is the same for every row of this file, chosen once by a person. */
export interface ReadingFixed {
  readonly key: string
  readonly value: string
}

/**
 * How one kind of document is read onto one format.
 *
 * This is the artefact the ladder stores and matches: read a file whose header
 * looks like one already read, and the reading that read it is offered back
 * with nothing asked.
 */
export interface Reading {
  /** The format this reads onto, by name. */
  readonly format: string
  /** Index of the header row in the table. Rows under it are data. */
  readonly headerRow: number
  readonly dateOrder: DateOrder
  readonly columns: readonly ReadingColumn[]
  /** Keys no column supplies: a currency for the whole file, a unit, a parent row. */
  readonly fixed: readonly ReadingFixed[]
  /**
   * The one row of a second format this file also writes, and every line links
   * to (M24 U10, D-262) — a statement's printed total, its period, its card.
   * Absent is a reading of lines and nothing else, which every reading was.
   */
  readonly header?: ReadingHeader | undefined
}

/**
 * One key of the header row, filled by one cell of the file.
 *
 * **A position and never a value** (D-137): a model says *the total is the last
 * row, first column* and code reads the cell. `row` counts from 0 like
 * `headerRow`, and **below zero counts from the end** — `-1` is the file's last
 * row that holds anything — because a printed total sits under the lines, and
 * its row moves with every statement while its distance from the end does not.
 */
export interface ReadingHeaderCell {
  readonly key: string
  readonly row: number
  readonly index: number
}

/** The header row a reading writes: which format, which link of the lines, and where its values are. */
export interface ReadingHeader {
  /** The format the header row is a row of — `statement`. */
  readonly format: string
  /** The lines' `link` column that points at it — `statement`. Filled by the reading, never by the file. */
  readonly link: string
  readonly cells: readonly ReadingHeaderCell[]
  /** Keys whose value is the same for the whole file: the card, a currency. */
  readonly fixed: readonly ReadingFixed[]
}

/**
 * What a line's link to its header holds until the header row exists.
 *
 * The header is written first, in the same transaction, and every line's link
 * is set to its id there (`recordIntake`); until then this is what a dry run
 * shows in that column, and it reads as what it is.
 */
export const PENDING_HEADER = "(this file's header row)"

/* ------------------------------------------------------------ the signature */

/**
 * What makes two files the same kind of file: their header cells, normalized
 * and sorted.
 *
 * Sorted, because a provider that moves a column has not changed what the
 * document is — the reading's own indexes are what move, and a near match is
 * worth showing rather than a mismatch. Kept as text rather than hashed, for
 * D-139's reason one level up: a hash answers *same or not*, and what a stored
 * reading needs is *how close*.
 */
export function readingSignature(table: ReadTable, headerRow: number): string {
  const row = table.rows[headerRow] ?? []
  return row
    .map((cell) => normalizeHeader(cell.text))
    .filter((text) => text !== '')
    .sort()
    .join('|')
}

/**
 * The header in the order the file has it, normalized as the signature is —
 * one entry per column, `''` where the header cell is empty (M26 F1).
 *
 * The signature is sorted so a moved column is still recognised; this is the
 * half it threw away, kept beside it so a reader can tell that a column moved
 * and follow it by name rather than read the wrong one by position.
 */
export function readingHeaderCells(table: ReadTable, headerRow: number): readonly string[] {
  const row = table.rows[headerRow] ?? []
  return Array.from({ length: Math.max(table.columnCount, row.length) }, (_, index) =>
    normalizeHeader(row[index]?.text ?? ''),
  )
}

/**
 * How much two signatures have in common: the intersection over the union.
 *
 * `1` is the same header; `0` shares no cell with it. The caller decides what
 * is close enough, because *close* means something different to a surface
 * offering a reading back and to one warning that a column has moved.
 */
export function signatureOverlap(a: string, b: string): number {
  const left = new Set(a.split('|').filter((each) => each !== ''))
  const right = new Set(b.split('|').filter((each) => each !== ''))
  if (left.size === 0 && right.size === 0) return 1
  let shared = 0
  for (const each of left) if (right.has(each)) shared += 1
  return shared / (left.size + right.size - shared)
}

/* --------------------------------------------------- refusing before it runs */

/**
 * What is wrong with a reading, said before it is executed against a single
 * row.
 *
 * The house pattern, and it is the third time it has earned itself:
 * `declarationProblems` judges a declaration before it compiles, `columnRejection`
 * judges a column, and this judges a reading. **The alternative is four hundred
 * identical row problems** saying a currency is missing, which is a screen a
 * person cannot act on — the fault is in the mapping, once, and that is where it
 * should be drawn.
 *
 * Every problem names the key it is about so the surface can put it beside the
 * select that caused it, which is what D-219 bought and what makes an editor
 * different from a box that rejects.
 */
export interface ReadingProblem {
  /** The key this is about, or `undefined` when it is about the reading as a whole. */
  readonly key: string | undefined
  readonly message: string
}

export function readingProblems(
  declaration: FormatDeclaration,
  reading: Reading,
  table: ReadTable | undefined,
  /**
   * The document's formats, by name — what a link bound to a column is judged
   * against (M24 U9). Without them no column may fill a link, which is the
   * answer a caller that cannot look gets.
   */
  formats?: ReadonlyMap<string, Pick<FormatDeclaration, 'columns'>>,
): readonly ReadingProblem[] {
  const problems: ReadingProblem[] = []

  if (reading.format !== declaration.name) {
    problems.push({
      key: undefined,
      message: `This reading is for ${reading.format}, and the format is ${declaration.name}.`,
    })
    return problems
  }

  const known = new Set(offeredKeysOf(declaration))
  const bound = new Map<string, number>()

  for (const each of reading.columns) {
    if (!known.has(each.key)) {
      problems.push({
        key: each.key,
        message: `${declaration.name} has no ${each.key}. Its keys are ${[...known].join(', ')}.`,
      })
      continue
    }
    bound.set(each.key, (bound.get(each.key) ?? 0) + 1)
    // A separator splits a cell into members, which only several of a list has.
    if (each.separator !== undefined) {
      const column = declaration.columns.find((one) => one.name === each.key)
      if (each.separator === '') {
        problems.push({ key: each.key, message: `${each.key} is split by a separator with nothing in it. Name one, like a comma.` })
      } else if (column?.type !== 'enums' && column?.type !== 'links') {
        problems.push({
          key: each.key,
          message: `${each.key} is split by "${each.separator}", and only a column holding several of a list is split.`,
        })
      }
    }
  }

  for (const each of reading.fixed) {
    if (!known.has(each.key)) {
      problems.push({
        key: each.key,
        message: `${declaration.name} has no ${each.key}. Its keys are ${[...known].join(', ')}.`,
      })
      continue
    }
    if (cleanText(each.value) === '') continue
    bound.set(each.key, (bound.get(each.key) ?? 0) + 1)
  }

  // The header's link is the reading's to fill (M24 U10): a column or a fixed
  // value for it as well would be two answers to which row a line belongs to.
  const headerLink = reading.header?.link
  if (headerLink !== undefined && known.has(headerLink)) {
    bound.set(headerLink, (bound.get(headerLink) ?? 0) + 1)
  }

  for (const [key, count] of bound) {
    if (count > 1) {
      problems.push({
        key,
        message:
          key === headerLink
            ? `${key} is the link to this file's header row, so the reading fills it — not a column and not a fixed value.`
            : `${key} is filled ${count} times over. A key takes one column or one fixed value, not both.`,
      })
    }
  }

  for (const column of declaration.columns) {
    const companion = companionKeyOf(column)
    const hasValue = bound.has(column.name)

    if (column.required && !hasValue) {
      problems.push({
        key: column.name,
        message: `${column.name} is required, so a column of the file has to fill it.`,
      })
    }

    if (companion !== undefined && hasValue && !bound.has(companion)) {
      problems.push({
        key: companion,
        message: companionDemand(column, companion),
      })
    }

    if (companion !== undefined && !hasValue && bound.has(companion)) {
      problems.push({
        key: companion,
        message: `${companion} is filled and ${column.name} is not, so there is nothing for it to be about.`,
      })
    }

    // **A link is read off the page only by a name that is a name** (M24 U9,
    // D-261): the target's naming column has to be unique, or a cell could
    // name two rows and the first of them would be a guess stored.
    //
    // **A column keyed by a source is the exception** (M38 U4): a note's item
    // names its note by the file the row was written from, which is one row
    // whatever the note is called — so it fills one `link`, unique name or not.
    const keyed = reading.columns.some(
      (each) => each.key === column.name && table?.keyedBy?.[each.index] !== undefined,
    )
    if (keyed && isLinkType(column.type)) {
      if (column.type !== 'link' || column.target === undefined || formats?.get(column.target) === undefined) {
        problems.push({
          key: column.name,
          message: `${column.name} is filled from the note each item sits in, which is one row — so only a link to the notes' format can take it.`,
        })
      }
    } else if (!keyed && isLinkType(column.type) && reading.columns.some((each) => each.key === column.name)) {
      const problem = linkColumnProblem(column, formats, parentsOf(declaration, bound))
      if (problem !== undefined) problems.push({ key: column.name, message: problem })
    }
  }

  if (bound.size === 0) {
    problems.push({ key: undefined, message: 'Nothing is mapped yet.' })
  }

  if (table !== undefined) {
    if (reading.headerRow < 0 || reading.headerRow >= table.rows.length) {
      problems.push({ key: undefined, message: 'The header row is not a row of this file.' })
    }
    for (const each of reading.columns) {
      if (each.index < 0 || each.index >= table.columnCount) {
        problems.push({
          key: each.key,
          message: `${each.key} is mapped to a column this file does not have.`,
        })
      }
    }
  }

  return problems
}

export function linkColumnProblem(
  column: ColumnDeclaration,
  formats: ReadonlyMap<string, Pick<FormatDeclaration, 'columns' | 'constraints'>> | undefined,
  /**
   * The formats this reading names a parent row of — a link held fixed or read
   * from a column (M48 U1). A target that is one row per parent and name is
   * named within that parent, so its name need not be unique in the document.
   */
  parents: ReadonlySet<string> = new Set(),
): string | undefined {
  const target = column.target ?? 'another format'
  const instead = `Or pick one ${target} for the whole file.`
  const declared = column.target === undefined ? undefined : formats?.get(column.target)
  if (declared === undefined) {
    return `${column.name} points at a row of ${target}, and a column of a file cannot fill it here. ${instead}`
  }
  const naming = labelColumn(declared)
  if (naming === undefined) {
    return (
      `${column.name} points at a row of ${target}, which has no text column to call a row by, ` +
      `so no cell of a file can name one. ${instead}`
    )
  }
  if (naming.unique !== true) {
    const scope = namingScope(declared)
    if (scope !== undefined && parents.has(scope.target)) return undefined
    const within =
      scope === undefined
        ? ''
        : ` Or fill this file's ${scope.target} — ${target} is one row per ${scope.name}, ${naming.name}, so a ${naming.name} is read within it.`
    return (
      `${column.name} points at a row of ${target}, and a column of a file may fill it only by ` +
      `${target}'s ${naming.name} — which is not unique, so a cell could name two rows. ` +
      `Declare ${naming.name} unique first.${within} ${instead}`
    )
  }
  return undefined
}

/**
 * The formats a reading's `link` columns point at — those it fills, when
 * `bound` says which, or every one, for a guess that cannot know yet (M48 U1).
 */
function parentsOf(declaration: FormatDeclaration, bound?: ReadonlyMap<string, number>): ReadonlySet<string> {
  return new Set(
    declaration.columns.flatMap((column) =>
      column.type === 'link' && column.target !== undefined && (bound === undefined || bound.has(column.name))
        ? [column.target]
        : [],
    ),
  )
}

function companionDemand(column: ColumnDeclaration, companion: string): string {
  if (column.type === 'money') {
    return (
      `${column.name} is money, so every row needs ${companion}: a column of the file, ` +
      'or one currency for the whole file if it only holds one.'
    )
  }
  return (
    `${column.name} is a quantity, so every row needs ${companion}: a column of the file, ` +
    'or one unit for the whole file if every row is in the same one.'
  )
}

/* --------------------------------------------------------- the header row */

/**
 * What is wrong with a reading's header, said before it runs (M24 U10, D-262).
 *
 * `readingProblems`' twin for the one row, and the same rules: every key is
 * one the header format offers, filled once, a required column is filled, a
 * figure has its currency, a position is a cell of this file. And two that
 * only a header has: **the link has to be a link of the lines to that format**,
 * or the lines belong to nothing; and a header link filled by a cell names its
 * row only by a unique name, as a line's does (D-261).
 *
 * `headerDeclaration` is `undefined` when the document declares no such
 * format — a problem this says, rather than one the caller has to.
 */
export function headerProblems(
  declaration: FormatDeclaration,
  header: ReadingHeader,
  headerDeclaration: FormatDeclaration | undefined,
  table: ReadTable | undefined,
  formats?: ReadonlyMap<string, Pick<FormatDeclaration, 'columns'>>,
): readonly ReadingProblem[] {
  const problems: ReadingProblem[] = []
  const at = (message: string, key?: string): void => {
    problems.push({ key: key ?? header.link, message })
  }

  if (headerDeclaration === undefined) {
    at(`This document declares no format called ${header.format} for the header row to be a row of.`)
    return problems
  }
  if (header.format === declaration.name) {
    at('The header row has to be a row of another format: a line is not its own statement.')
    return problems
  }

  const link = declaration.columns.find((column) => column.name === header.link)
  if (link === undefined || link.type !== 'link' || link.target !== header.format) {
    at(
      `${declaration.name} has no link called ${header.link} pointing at ${header.format}, so its ` +
        'lines could not belong to the header row. Add one first (`connect_formats`).',
    )
  }

  const known = new Set(offeredKeysOf(headerDeclaration))
  const bound = new Map<string, number>()
  const bind = (key: string): void => {
    if (!known.has(key)) {
      at(`${header.format} has no ${key}. Its keys are ${[...known].join(', ')}.`, key)
      return
    }
    bound.set(key, (bound.get(key) ?? 0) + 1)
  }
  for (const each of header.cells) bind(each.key)
  for (const each of header.fixed) if (cleanText(each.value) !== '') bind(each.key)

  for (const [key, count] of bound) {
    if (count > 1) at(`${key} is filled ${count} times over in the header. One cell or one value.`, key)
  }

  for (const column of headerDeclaration.columns) {
    const companion = companionKeyOf(column)
    const hasValue = bound.has(column.name)
    if (column.required && !hasValue) {
      at(
        `${header.format}'s ${column.name} is required, so a cell of the file or a fixed value has to fill it.`,
        column.name,
      )
    }
    if (companion !== undefined && hasValue && !bound.has(companion)) {
      at(companionDemand(column, companion), companion)
    }
    if (column.type === 'link' && header.cells.some((each) => each.key === column.name)) {
      const problem = linkColumnProblem(column, formats)
      if (problem !== undefined) at(problem, column.name)
    }
  }

  if (table !== undefined) {
    for (const each of header.cells) {
      const row = positionRow(table, each.row)
      if (row === undefined || each.index < 0 || each.index >= table.columnCount) {
        at(
          `${each.key} is read from row ${each.row}, column ${each.index}, which is not a cell of this file.`,
          each.key,
        )
      }
    }
  }

  return problems
}

/**
 * A position's row in this file, or nothing when there is no such row.
 *
 * Below zero counts back from the **last row that holds anything**, not the
 * last row of the rectangle: a spreadsheet trails blank rows, and a `-1` that
 * landed on one would read nothing on every statement.
 */
export function positionRow(table: ReadTable, row: number): number | undefined {
  if (!Number.isInteger(row)) return undefined
  if (row >= 0) return row < table.rows.length ? row : undefined
  let last = table.rows.length - 1
  while (last >= 0 && (table.rows[last] ?? []).every((cell) => cell.kind === 'empty')) last -= 1
  const found = last + 1 + row
  return found >= 0 && found <= last ? found : undefined
}

/** The header row, read — the one row a reading writes into its header format. */
export interface ReadHeader {
  readonly offered: Readonly<Record<string, unknown>>
  readonly cells: Readonly<Record<string, StoredValue>> | undefined
  readonly problem: string | undefined
}

/**
 * Read the header row off the file.
 *
 * **The same `valueOf` and `coerceRow` a line goes through**, so `19000.00₪`
 * under the lines is the figure it would be in the amount column. An empty cell
 * offers nothing, and a required column then refuses the header by name — **and
 * the whole file with it**, because lines whose statement did not read have
 * nothing to belong to.
 */
export function readHeader(
  declaration: FormatDeclaration,
  header: ReadingHeader,
  table: ReadTable,
  order: DateOrder,
  units: UnitTable = SEEDED_UNITS,
): ReadHeader {
  const offered: Record<string, unknown> = {}
  for (const each of header.fixed) {
    const value = cleanText(each.value)
    if (value !== '') offered[each.key] = value
  }

  for (const each of header.cells) {
    const row = positionRow(table, each.row)
    if (row === undefined) continue
    const cell = table.rows[row]?.[each.index]
    if (cell === undefined || cell.kind === 'empty') continue
    const column = declaration.columns.find(
      (one) => one.name === each.key || companionKeyOf(one) === each.key,
    )
    offered[each.key] = column === undefined ? cell.text : valueOf(cell, each.key, column, order)
  }

  const coerced = coerceRow(declaration, offered, units)
  return {
    offered,
    cells: coerced.ok ? coerced.value : undefined,
    problem: coerced.ok ? undefined : `The header row: ${coerced.error}`,
  }
}

/* ------------------------------------------------------------- reading rows */

/** One row of the file, read. */
export interface ReadRow {
  /** The row's index in the file, so a problem names a line a person can go and look at. */
  readonly line: number
  /** What the reading offered, in `coerceRow`'s vocabulary. */
  readonly offered: Readonly<Record<string, unknown>>
  /** The cells, when this row typed. */
  readonly cells: Readonly<Record<string, StoredValue>> | undefined
  /** Why it did not, when it did not. */
  readonly problem: string | undefined
  /**
   * The links a prose column named that no row answers to (M38 U2) — left out
   * of `cells` and said in the report, the row still read.
   */
  readonly unlinked?: readonly UnlinkedName[] | undefined
}

/** One link written in prose that names no row, and was left out. */
export interface UnlinkedName {
  /** The links column it would have filled. */
  readonly key: string
  /** The name as the file wrote it. */
  readonly name: string
  readonly reason: string
}

export interface ReadResult {
  readonly rows: readonly ReadRow[]
  /** Rows under the header that were blank in every mapped column, and are not rows at all. */
  readonly blank: number
}

/**
 * Run a reading over a file.
 *
 * **Every row is kept, including the ones that failed** — the same rule the
 * pack's ladder states about a whole document (D-149): a reading that threw away
 * what it could not type would be hiding the evidence from the one surface built
 * to show it. A row that did not type has a problem and no cells, and the
 * confirm surface draws it in place.
 *
 * A row blank in every mapped column is not a row. Spreadsheets have trailing
 * emptiness, and counting it as four hundred failures would bury the three
 * failures that matter.
 */
export function readRows(
  declaration: FormatDeclaration,
  reading: Reading,
  table: ReadTable,
  units: UnitTable = SEEDED_UNITS,
): ReadResult {
  const rows: ReadRow[] = []
  let blank = 0

  const fixed: Record<string, unknown> = {}
  for (const each of reading.fixed) {
    const value = cleanText(each.value)
    if (value !== '') fixed[each.key] = value
  }
  // Every line belongs to the header row, which does not exist until the
  // reading is committed — so the link holds a stand-in that says so (U10).
  if (reading.header !== undefined) fixed[reading.header.link] = PENDING_HEADER
  // A row a header cell is read from is the header's and not a line: a printed
  // total under the lines is not a line that failed to type.
  const headerRows = new Set<number>()
  for (const each of reading.header?.cells ?? []) {
    const row = positionRow(table, each.row)
    if (row !== undefined) headerRows.add(row)
  }

  const keyTypes = new Map<string, ColumnDeclaration>()
  for (const column of declaration.columns) {
    keyTypes.set(column.name, column)
    const companion = companionKeyOf(column)
    if (companion !== undefined) keyTypes.set(companion, column)
  }

  for (let line = reading.headerRow + 1; line < table.rows.length; line += 1) {
    if (headerRows.has(line)) continue
    const row = table.rows[line] ?? []
    const offered: Record<string, unknown> = { ...fixed }
    let anything = false

    for (const each of reading.columns) {
      const cell = row[each.index]
      if (cell === undefined || cell.kind === 'empty') continue
      anything = true
      const column = keyTypes.get(each.key)
      offered[each.key] =
        column === undefined ? cell.text : valueOf(cell, each.key, column, reading.dateOrder, each.separator)
    }

    if (!anything) {
      blank += 1
      continue
    }

    // **A currency or a unit fixed for the file is what its amounts are in**
    // (M38 U1), so a row with no amount takes none: a currency with nothing
    // beside it was refused, line after line, for a figure the file never had.
    for (const each of reading.fixed) {
      const column = keyTypes.get(each.key)
      if (column === undefined || companionKeyOf(column) !== each.key) continue
      if (offered[column.name] === undefined) delete offered[each.key]
    }

    const coerced = coerceRow(declaration, offered, units)
    rows.push({
      line,
      offered,
      cells: coerced.ok ? coerced.value : undefined,
      problem: coerced.ok ? undefined : coerced.error,
    })
  }

  return { rows, blank }
}

/**
 * The rows that typed, as rows a tally can be taken of.
 *
 * **The id is the line of the file and not a row's identity**, because these
 * rows do not exist yet — one is minted when a person commits. Nothing that
 * judges a row reads its id (`identityInputsOf` takes cells), and what the
 * surface actually needs is a stable key per staged row, which the line is. The
 * point of the whole function is one line long: *the confirm surface does not
 * verify the import, the declaration does* — `tally(declaration, stagedRows(read))`
 * is U3 run over rows on their way in.
 */
export function stagedRows(read: ReadResult): readonly StoredRow[] {
  return read.rows.flatMap((row) =>
    row.cells === undefined ? [] : [{ id: `line ${row.line + 1}`, cells: row.cells }],
  )
}

/**
 * One cell, as the value `coerceRow` is owed for that key.
 *
 * **The conversions here are the file's, not the column's.** A number cell is a
 * number, a date cell is an ISO date, and a text cell is parsed only where the
 * column it is bound to wants something a spreadsheet writes as text — which is
 * why this takes the column rather than guessing from the cell. Everything about
 * whether the result is *allowed* is `coerceValue`'s, one layer down, and is not
 * repeated here: two places deciding what a value is, is the shape D-138 keeps
 * finding a bug in.
 */
function valueOf(
  cell: ReadCell,
  key: string,
  column: ColumnDeclaration,
  order: DateOrder,
  separator?: string | undefined,
): unknown {
  // A companion key — a currency code, a unit symbol — is text whatever the
  // cell's kind, and `coerceValue` is what judges it.
  if (key !== column.name) return cell.text.trim()
  // **Several of a list, split by what the mapping states** (M34 U5, D-398) —
  // `vegan, quick` by `,` — and each member then judged by `coerceValue`, so
  // one off the list refuses the line by name. Nothing between two separators
  // is no member: `vegan,,quick` is two.
  if (column.type === 'enums' || column.type === 'links') {
    const text = cell.text.trim()
    if (separator === undefined || separator === '') return [text]
    return text
      .split(separator)
      .map((each) => each.trim())
      .filter((each) => each !== '')
  }
  // A link is a name, whatever the file typed it as: a card's last four digits
  // are a number to a spreadsheet and `0417` to a person, and the text is the
  // one that keeps its zero (M24 U9).
  if (column.type === 'link') return cell.text.trim()

  switch (cell.kind) {
    case 'number':
      if (column.type === 'decimal') {
        // A spreadsheet's number is a double, and `0.1 + 0.2` is how it stores
        // a 0.3 somebody typed. Fifteen significant digits is every digit a
        // double can hold from a person's keyboard and none of its noise; what
        // is left is still refused, never rounded, past the column's places.
        return String(Number(cell.value.toPrecision(15)))
      }
      if (column.type === 'time') {
        // A spreadsheet keeps 09:30 as 0.395833…, a fraction of a day (D-335).
        return timeOfDayFraction(cell.value) ?? cell.text.trim()
      }
      if (column.type === 'percent') {
        // A spreadsheet keeps `12.5%` as 0.125 and shows the sign; what it
        // shows is what a person typed (D-333). A plain number is read as typed (D-344).
        if (cell.text.trim().endsWith('%')) return cell.text.trim()
        return String(Number(cell.value.toPrecision(15)))
      }
      return column.type === 'text' || column.type === 'date' ? cell.text : cell.value
    case 'boolean':
      return column.type === 'text' ? cell.text : cell.value
    case 'date':
      if (column.type === 'month' && cell.day === 1) {
        // A spreadsheet has no month type: a period is a date on the first,
        // formatted to hide the day. Any other day is a day, and is left for
        // `coerceValue` to refuse rather than cut down to its month.
        return `${String(cell.year).padStart(4, '0')}-${String(cell.month).padStart(2, '0')}`
      }
      return column.type === 'date'
        ? (isoOf(cell.year, cell.month, cell.day) ?? cell.text)
        : cell.text
    case 'text':
      return fromText(cell.text, column, order)
    default:
      return undefined
  }
}

function fromText(text: string, column: ColumnDeclaration, order: DateOrder): unknown {
  switch (column.type) {
    case 'integer':
    case 'real':
    case 'money':
    case 'quantity':
      return parseFigure(text) ?? text
    case 'date':
      return parseDateText(text, order) ?? text
    default:
      return text.trim()
  }
}

function isoOf(year: number, month: number, day: number): string | undefined {
  const date = tryLocalDate(year, month, day)
  return date === undefined ? undefined : toISODate(date)
}

/**
 * A figure as a document writes one — `parseFigureText`, the reader the pack's
 * importer uses too (M45 F1), told to strip the currency symbols and `%`.
 *
 * `undefined` rather than a guess when it does not parse, so the text goes to
 * `coerceValue` and the refusal names the column.
 */
export function parseFigure(text: string): number | undefined {
  return parseFigureText(text, FIGURE_NOISE)
}

/** What a figure may carry beside its digits: a currency symbol, or a percent sign. */
const FIGURE_NOISE = /[₪$€£%]/g

/**
 * A written date, in the order the reading says this file writes them — the one
 * reader the importer uses too (`parseNumericDate`, M45 F1): a space between the
 * parts is a separator and `26` is 2026, because real statements print both.
 */
export function parseDateText(text: string, order: DateOrder): string | undefined {
  const date = parseNumericDate(cleanText(text), order)
  return date === undefined ? undefined : toISODate(date)
}

/**
 * Which way round this file writes its dates, from the dates themselves —
 * `inferNumericDateOrder`, shared with the importer, which says how the
 * evidence is weighed.
 *
 * A column with a day over twelve in it answers the question outright. One with
 * none is genuinely ambiguous — `03/04/2026` is two different days and no amount
 * of looking at it decides which — so the answer is the honest default and the
 * mapper shows it as a select rather than as a fact.
 */
export function inferDateOrder(texts: readonly string[]): DateOrder {
  return inferNumericDateOrder(texts.map(cleanText))
}

/* ------------------------------------------------------------- the guessing */

/** How far down a header may be. The pack's real files put theirs on row 4. */
export const HEADER_SEARCH_DEPTH = 20

/**
 * Guess which row is the header and which column is which key.
 *
 * **A guess and nothing more** (D-013). It is shown in a grid beside what it
 * produces and every column is one select away from being corrected, so being
 * wrong costs a click and being silent costs a person the whole mapping. What
 * it will not do is invent a match: a header with nothing like it among the
 * format's keys is left unmapped rather than attached to whichever key scored
 * least badly, because a wrong mapping that parses is D-114's reference column
 * read as an amount — a file that imports cleanly and is wrong in every figure.
 */
export function guessReading(
  declaration: FormatDeclaration,
  table: ReadTable,
  formats?: ReadonlyMap<string, Pick<FormatDeclaration, 'columns'>>,
  /**
   * The formats the table's prose links name rows of, as the caller found them
   * (`proseLinkNames`) — absent when it could not look, and then a prose column
   * is guessed only when the format has one `links` column a cell can fill.
   */
  into?: ReadonlySet<string>,
  /**
   * The format the rows a keyed column names are rows of (M38 U4) — the one a
   * folder's notes are read onto, when its items are read beside it. Absent,
   * the keyed column is guessed onto nothing.
   */
  parent?: string,
): Reading {
  const headerRow = findHeaderRow(table)
  const header = table.rows[headerRow] ?? []

  const taken = new Set<string>()
  const columns: ReadingColumn[] = []

  for (const [index, cell] of header.entries()) {
    // A prose column is no header to match by its words (`body links` is not
    // the `body` column); it is guessed below, by where its links go.
    if (table.prose?.[index] === true) continue
    // A note's item's parts and its way back to its note are guessed by what
    // they are, below (M38 U4) — `link` is not a column called link.
    if (table.parts?.[index] !== undefined || table.keyedBy?.[index] !== undefined) continue
    const key = matchKey(declaration, cell.text, taken, formats)
    if (key === undefined) continue
    taken.add(key)
    // A list the file held as a list is split the way the file joined it.
    const separator = table.separators?.[index]
    const type = declaration.columns.find((column) => column.name === key)?.type
    columns.push(
      separator !== undefined && (type === 'enums' || type === 'links') ? { index, key, separator } : { index, key },
    )
  }

  // **A body's links go onto the one `links` column pointing where they
  // resolve** (M38 U2): exactly one, or none — two would be a guess between
  // them, and the guess is shown and one click from changed either way.
  for (const [index] of header.entries()) {
    if (table.prose?.[index] !== true) continue
    const fits = declaration.columns.filter(
      (column) =>
        column.type === 'links' &&
        !taken.has(column.name) &&
        formats !== undefined &&
        linkColumnProblem(column, formats, parentsOf(declaration)) === undefined &&
        (into === undefined || (column.target !== undefined && into.has(column.target))),
    )
    const only = fits.length === 1 ? fits[0] : undefined
    if (only === undefined) continue
    taken.add(only.name)
    const separator = table.separators?.[index]
    columns.push(separator === undefined ? { index, key: only.name } : { index, key: only.name, separator })
  }
  columns.push(...itemGuess(declaration, table, header.length, taken, formats, parent))
  columns.sort((a, b) => a.index - b.index)

  const dateColumns = columns.filter(
    (each) =>
      declaration.columns.find((column) => column.name === each.key)?.type === 'date',
  )
  const samples: string[] = []
  for (let line = headerRow + 1; line < table.rows.length && samples.length < 40; line += 1) {
    for (const each of dateColumns) {
      const cell = table.rows[line]?.[each.index]
      if (cell !== undefined && cell.kind === 'text') samples.push(cell.text)
    }
  }

  return {
    format: declaration.name,
    headerRow,
    dateOrder: inferDateOrder(samples),
    columns,
    fixed: [],
  }
}

/**
 * **A note's item, mapped by what its parts are** (M38 U4): its note onto the
 * one `link` pointing at the format the notes are read onto; its figure and
 * unit onto the one `quantity` (or, with no unit read, the one number column);
 * its link onto the one other `link` a cell can fill; a checkbox onto the one
 * `boolean`; its words onto the column a row is called by. **Exactly one, or
 * none**, as a body's links are guessed — the guess is shown, and two would be
 * a choice between them.
 */
function itemGuess(
  declaration: FormatDeclaration,
  table: ReadTable,
  width: number,
  taken: Set<string>,
  formats: ReadonlyMap<string, Pick<FormatDeclaration, 'columns'>> | undefined,
  parent: string | undefined,
): readonly ReadingColumn[] {
  const at = (part: ItemPart): number => (table.parts ?? []).indexOf(part)
  const free = (column: ColumnDeclaration): boolean => !taken.has(column.name)
  const only = <T>(list: readonly T[]): T | undefined => (list.length === 1 ? list[0] : undefined)
  const columns: ReadingColumn[] = []
  const bind = (index: number, key: string | undefined): void => {
    if (index < 0 || index >= width || key === undefined || taken.has(key)) return
    taken.add(key)
    columns.push({ index, key })
  }

  const keyed = (table.keyedBy ?? []).findIndex((each) => each !== undefined)
  if (keyed !== -1 && parent !== undefined) {
    bind(keyed, only(declaration.columns.filter((column) => column.type === 'link' && column.target === parent && free(column)))?.name)
  }
  if (table.parts === undefined) return columns

  const quantity = only(declaration.columns.filter((column) => column.type === 'quantity' && free(column)))
  if (quantity !== undefined) {
    bind(at('figure'), quantity.name)
    bind(at('unit'), companionKeyOf(quantity))
  } else {
    const numeric = only(
      declaration.columns.filter((column) => ['integer', 'decimal', 'real'].includes(column.type) && free(column)),
    )
    bind(at('figure'), numeric?.name)
  }
  bind(
    at('link'),
    only(
      declaration.columns.filter(
        (column) =>
          column.type === 'link' &&
          column.target !== parent &&
          free(column) &&
          formats !== undefined &&
          linkColumnProblem(column, formats, parentsOf(declaration)) === undefined,
      ),
    )?.name,
  )
  bind(at('checked'), only(declaration.columns.filter((column) => column.type === 'boolean' && free(column)))?.name)
  const label = labelColumn(declaration)
  if (label !== undefined && label.type === 'text' && free(label)) bind(at('text'), label.name)
  return columns
}

/**
 * Every name a table's prose columns link to, under its header row, each once
 * (M38 U2) — what a caller asks the document about to find the formats those
 * links resolve into, for `guessReading`'s `into`.
 */
export function proseLinkNames(table: ReadTable): readonly string[] {
  const at = (table.prose ?? []).flatMap((prose, index) => (prose ? [index] : []))
  if (at.length === 0) return []
  const names = new Set<string>()
  const headerRow = findHeaderRow(table)
  for (const row of table.rows.slice(headerRow + 1)) {
    for (const index of at) {
      const cell = row[index]
      if (cell === undefined || cell.kind === 'empty') continue
      const separator = table.separators?.[index]
      const members = separator === undefined ? [cell.text] : cell.text.split(separator)
      for (const member of members) if (member.trim() !== '') names.add(member.trim())
    }
  }
  return [...names]
}

/**
 * The row that looks most like a row of column names.
 *
 * What a header row has: several short text cells, all different from each
 * other. What it does not have: numbers and dates. That is the pack's
 * `scoreHeaderRow` said about any document rather than about a statement, and it
 * is the one piece of its guessing that was never about money.
 */
export function findHeaderRow(table: ReadTable): number {
  let best = 0
  let bestScore = -1

  const depth = Math.min(table.rows.length, HEADER_SEARCH_DEPTH)
  for (let index = 0; index < depth; index += 1) {
    const score = scoreHeaderRow(table.rows[index] ?? [])
    if (score > bestScore) {
      best = index
      bestScore = score
    }
  }
  return best
}

function scoreHeaderRow(row: readonly ReadCell[]): number {
  const seen = new Set<string>()
  let labels = 0
  let typed = 0
  let repeats = 0

  for (const cell of row) {
    if (cell.kind === 'empty') continue
    if (cell.kind === 'number' || cell.kind === 'date' || cell.kind === 'boolean') {
      typed += 1
      continue
    }
    const text = normalizeHeader(cell.text)
    if (text === '' || text.length > 40) continue
    if (seen.has(text)) repeats += 1
    seen.add(text)
    labels += 1
  }

  return labels - typed * 2 - repeats
}

/**
 * The key a header cell names, or nothing.
 *
 * Three rounds, narrowest first: the key as spelled, the column's title, then
 * the header as words against the key as words. A `key` already taken by an
 * earlier column is not offered twice — a file with two columns called `amount`
 * has one of them meaning something else, and the person is the one who knows
 * which.
 */
export function matchKey(
  declaration: FormatDeclaration,
  header: string,
  taken: ReadonlySet<string>,
  formats?: ReadonlyMap<string, Pick<FormatDeclaration, 'columns'>>,
): string | undefined {
  const text = normalizeHeader(header)
  if (text === '') return undefined

  const label = labelColumn(declaration)
  const candidates: { readonly key: string; readonly words: readonly string[] }[] = []
  const links: { readonly key: string; readonly words: readonly string[] }[] = []
  for (const column of declaration.columns) {
    // **A link is guessed only by a header that names it** (M34 U7, D-400), and
    // only where a cell can fill it at all — the row it points at is called by
    // a unique name (D-261). The guess is shown before anything is written, and
    // a cell naming no row is still refused by line.
    if (isLinkType(column.type)) {
      if (formats !== undefined && linkColumnProblem(column, formats, parentsOf(declaration)) === undefined) {
        links.push({ key: column.name, words: wordsOf(column.name, undefined) })
      }
      continue
    }
    // The column a row is called by answers to `name` and `title` too — the
    // header a list of things most often has over the thing's name (M34 U7).
    const words = wordsOf(column.name, column.unit)
    candidates.push({ key: column.name, words: column === label ? [...words, 'name', 'title'] : words })
    const companion = companionKeyOf(column)
    if (companion !== undefined) {
      candidates.push({
        key: companion,
        words: [
          ...wordsOf(companion, undefined),
          ...(column.type === 'money' ? ['currency', 'ccy'] : ['unit', 'units', 'uom']),
        ],
      })
    }
  }

  const free = candidates.filter((each) => !taken.has(each.key))
  const freeLinks = links.filter((each) => !taken.has(each.key))

  for (const each of [...free, ...freeLinks]) {
    if (normalizeHeader(each.key) === text) return each.key
  }
  for (const each of [...free, ...freeLinks]) {
    if (each.words[0] === text || (free.includes(each) && each.words.includes(text))) return each.key
  }

  const words = text.split(' ').filter((word) => word.length > 2)
  if (words.length === 0) return undefined
  for (const each of free) {
    if (words.some((word) => each.words.includes(word))) return each.key
  }
  return undefined
}

/**
 * The words a key answers to: its own, spaced out, and the unit it is in.
 *
 * The column's **note is deliberately not searched** — it is prose, often a
 * paragraph, and a column whose note happens to mention *date* would swallow the
 * date column. What a unit buys is the vault's own spelling: `energy_kcal` is
 * also `kcal`, which is what a spreadsheet's header actually says.
 */
function wordsOf(name: string, unit: string | undefined): readonly string[] {
  const spaced = name.replace(/_/g, ' ').toLowerCase()
  const words = [spaced, ...spaced.split(' ')]
  if (unit !== undefined && unit.trim() !== '') words.push(unit.trim().toLowerCase())
  return words
}
