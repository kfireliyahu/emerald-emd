/**
 * **What reading one file would do, judged before anything is written** — the
 * plan `read_onto_format` has printed since M20 U7, moved here in M26 U5 so the
 * bulk reading screen judges a file with the same calls a conversation does.
 *
 * Two surfaces with two copies of what a reading may write is how a screen and a
 * conversation come to disagree (D-227); this is the one copy. The tool keeps
 * how the plan is *said*, and the screen how it is *drawn*.
 *
 * ## Reconciled, and what that word is allowed to mean (D-138)
 *
 * Asked of the review step: *"Can we really know it was fully reconciled
 * without anything missing?"* — so `reconciles` is narrow on purpose. A file
 * reconciles when **every line read**, **nothing blocks the write**, and **every
 * check the format declares came back proved** — on every line, and on the
 * header row where the reading writes one, which is where a printed total
 * catches a line that is missing. A format that declares nothing to add up
 * cannot reconcile at all: there was no proof, and a reading with no proof is
 * not a proved one. A reconciled file is ticked on the review screen; it is
 * still never written past it.
 */

import type { Database } from 'sql.js'

import {
  priorIntake,
  sourceRecords,
  type Intake,
  type IntakeRequest,
} from '@/data/repositories/formatIntakeRepository.ts'
import {
  danglingLinks,
  resolveReadLinks,
  stagedHeaderVerdicts,
  type FormatIndex,
} from '@/data/repositories/formatJoinRepository.ts'
import { readRow, repeatedValues, rowsLinkingTo } from '@/data/repositories/formatRowRepository.ts'
import { listUnits } from '@/data/repositories/unitRepository.ts'
import { lineTally, type LineTally } from '@/domain/format/audit.ts'
import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import { verdictSentence } from '@/domain/format/identity.ts'
import { rowWriteRefusal } from '@/domain/format/owner.ts'
import { compareRereading, lineKeys, sourceKeyOf, type Rereading, type SourceKey } from '@/domain/format/reread.ts'
import {
  headerProblems,
  readHeader,
  readingHeaderCells,
  readingProblems,
  readingSignature,
  pendingRowId,
  readRows,
  stagedRows,
  withPendingRows,
  type ReadHeader,
  type ReadResult,
  type ReadTable,
  type Reading,
  type ReadingHeader,
  type ReadingProblem,
} from '@/domain/format/reading.ts'
import {
  brokenConstraints,
  tally,
  verdictsOf,
  type RowVerdict,
  type StoredRow,
  type StoredValue,
  type Tally,
} from '@/domain/format/row.ts'
import type { UnitTable } from '@/domain/format/unit.ts'

export interface HeaderPlan {
  readonly declaration: FormatDeclaration
  readonly read: ReadHeader
  /** Its link a fixed value named and nothing answered to, in a sentence each. */
  readonly dangling: readonly string[]
  /** Its identities, over the lines about to be written. */
  readonly verdicts: readonly RowVerdict[]
}

export interface ReadingPlan {
  /** Why nothing can be written at all — a header row into a pack's format. */
  readonly blocked: string | undefined
  readonly problems: readonly ReadingProblem[]
  readonly dangling: readonly string[]
  /** Lines that would repeat a value in a unique column (D-255), each in a sentence. */
  readonly repeated: readonly string[]
  /** Lines that break a row constraint (D-259), by line. */
  readonly broken: readonly string[]
  readonly read: ReadResult | undefined
  /** Every line of the file, by what became of it (M34 U3, D-396). */
  readonly lines: LineTally | undefined
  /** Each staged line as the file wrote it, before a link's name became its id (D-261). */
  readonly shown: ReadonlyMap<string, StoredRow>
  readonly proof: Tally | undefined
  /**
   * The lines `proof` counts as failed, each with what did not add up (M26 F1) —
   * so a surface can say *which*, not only how many.
   */
  readonly failing: readonly FailingLine[]
  readonly header: HeaderPlan | undefined
  readonly units: UnitTable | undefined
  /**
   * This exact file, read onto this format before, while it still has rows —
   * and not read by key: a source read again by key says what it changes
   * instead (`again`), and offers no supersede.
   */
  readonly prior: Intake | undefined
  /** Per staged line, the key of its line in the source (M38 U3, D-408). */
  readonly keys: readonly (string | undefined)[]
  /** How the lines are keyed. */
  readonly key: SourceKey
  /** The same source read before (D-408): what this read changes, adds and finds gone. */
  readonly again: PlannedRereading | undefined
}

/** A read again, with where from and which gone rows cannot be taken away. */
export interface PlannedRereading extends Rereading {
  /** The file name the source is known by. */
  readonly from: string
  /** Gone rows another row links to: named, and kept even when removing is asked. */
  readonly linked: ReadonlySet<string>
}

/** One line whose check failed, and the sentence each failed check says. */
export interface FailingLine {
  /** The staged row's id — `line 12`, the file's own line. */
  readonly id: string
  readonly sentences: readonly string[]
}

/**
 * Judge a reading of one table onto one format: every check `read_onto_format`
 * makes, and nothing written.
 */
export function planReading(
  db: Database,
  declaration: FormatDeclaration,
  table: ReadTable,
  file: { readonly name: string; readonly hash: string },
  reading: Reading,
  formats: FormatIndex,
): ReadingPlan {
  const units = listUnits(db)
  const prior = priorIntake(db, declaration.name, file.hash)
  const none: SourceKey = { kind: 'NONE' }
  const empty = {
    blocked: undefined,
    problems: [],
    dangling: [],
    repeated: [],
    broken: [],
    read: undefined,
    lines: undefined,
    shown: new Map<string, StoredRow>(),
    proof: undefined,
    failing: [],
    header: undefined,
    units,
    prior,
    keys: [],
    key: none,
    again: undefined,
  } as const

  const wanted = reading.header
  // The header row is written too, so a pack's header format is the pack's (D-269).
  const headerFormat = wanted === undefined ? undefined : formats.get(wanted.format)
  const headerLocked = headerFormat === undefined ? undefined : rowWriteRefusal(headerFormat)
  if (headerLocked !== undefined) return { ...empty, blocked: headerLocked }

  const problems = [
    ...readingProblems(declaration, reading, table, formats),
    ...(wanted === undefined
      ? []
      : headerProblems(declaration, wanted, formats.get(wanted.format), table, formats)),
  ]
  if (problems.length > 0) return { ...empty, problems }

  // A link a column fills is a name, resolved here to the row it names or the
  // line refused, by line (M24 U9, D-261).
  const raw = readRows(declaration, reading, table, units)
  // A note's items name their note by the file it was read from (M38 U4).
  const read = resolveReadLinks(db, declaration, reading, withParentLinks(db, declaration, reading, table, raw, formats), formats, table)
  const shown = new Map(stagedRows(withoutUnlinked(raw, read)).map((row) => [row.id, row]))
  const staged = stagedRows(read)

  // **Each line's key, and the source read before** (M38 U3, D-408). A reading
  // that writes a header row is read again as before: its lines belong to a
  // statement, and a second statement is a second row of it.
  const key = wanted === undefined ? sourceKeyOf(declaration, reading, table) : none
  const everyKey = lineKeys(key, table, read)
  const keys = read.rows.flatMap((row, at) => (row.cells === undefined ? [] : [everyKey[at]]))
  const again = key.kind === 'NONE' ? undefined : rereadingOf(db, declaration, file.name, key, staged, keys, read, everyKey, formats)

  // A fixed value is the same on every row, so the first staged row answers for
  // the file — and a file with no rows has no link to dangle. The link to the
  // header row holds a stand-in until the commit writes it.
  const first = staged[0]
  const checked =
    first === undefined || wanted === undefined
      ? first?.cells
      : Object.fromEntries(Object.entries(first.cells).filter(([key]) => key !== wanted.link))
  // A link to a row this read writes stands in for it until the commit (M38 U4).
  const pending = new Set(read.rows.flatMap((row) => (row.cells === undefined ? [] : [pendingRowId(row.line)])))
  const dangling = checked === undefined ? [] : danglingLinks(db, declaration, checked, formats, pending)
  // Every line, against the table and against each other.
  // A line that is a row already holds that row's values, and repeats none.
  const repeated = repeatedValues(
    db,
    declaration,
    staged.map((row) => row.cells),
    staged.map((_, at) => again?.matched[at]),
  ).map((each) => `${staged[each.row]?.id ?? ''}: ${each.message}`)
  const broken = staged.flatMap((row) =>
    brokenConstraints(declaration, row.cells).map((message) => `${row.id}: ${message}`),
  )

  return {
    blocked: undefined,
    problems: [],
    dangling,
    repeated,
    broken,
    read,
    lines: lineTally(table, reading, read),
    shown,
    proof: tally(declaration, staged, units),
    failing: failingLines(declaration, staged, units),
    header: headerPlanOf(db, declaration, wanted, table, reading, staged, formats, units),
    units,
    prior: again === undefined ? prior : undefined,
    keys,
    key,
    again,
  }
}

/**
 * The source read before, against this read — `undefined` when no reading of a
 * file by this name keyed its rows, which is a first read.
 */
function rereadingOf(
  db: Database,
  declaration: FormatDeclaration,
  from: string,
  key: SourceKey,
  staged: readonly StoredRow[],
  keys: readonly (string | undefined)[],
  read: ReadResult,
  everyKey: readonly (string | undefined)[],
  formats: FormatIndex,
): PlannedRereading | undefined {
  const records = sourceRecords(db, declaration.name, from)
  if (records.length === 0) return undefined
  const current = new Map<string, StoredRow>()
  for (const record of records) {
    if (current.has(record.rowId)) continue
    const row = readRow(db, declaration, record.rowId)
    if (row !== undefined) current.set(record.rowId, row)
  }
  if (current.size === 0) return undefined
  // A link to a row of this read that is a row already is compared as that
  // row's id, so a note linking a note it linked before is the same (M38 U4).
  const byKey = new Map<string, string>()
  for (const record of records) if (current.has(record.rowId) && !byKey.has(record.key)) byKey.set(record.key, record.rowId)
  const keyOfLine = new Map(read.rows.map((row, at) => [row.line, everyKey[at]]))
  const compared_staged = staged.map((row) => ({
    ...row,
    cells: withPendingRows(declaration, row.cells, (line) => {
      const each = keyOfLine.get(line)
      return each === undefined ? undefined : byKey.get(each)
    }),
  }))
  const refused = new Set(
    read.rows.flatMap((row, at) => {
      const each = everyKey[at]
      return row.cells === undefined && each !== undefined ? [each] : []
    }),
  )
  const compared = compareRereading({ declaration, key, staged: compared_staged, keys, refused, records, current })
  const linking = rowsLinkingTo(db, declaration, compared.gone.map((each) => each.rowId), formats.values())
  return {
    ...compared,
    from,
    linked: new Set(linking.flatMap((each) => [...each.counts.keys()])),
  }
}

/**
 * **A note's items, each set to its note's row** (M38 U4): a column keyed by a
 * source (`ReadTable.keyedBy`) holds the key a row of that source was written
 * under — a note's file name — and is filled with that row's id, found in what
 * the source's reads recorded (D-408). A batch writes the folder's notes before
 * their items, so a note read in the same call is found. A key no row of the
 * source holds refuses its line, naming the note.
 */
function withParentLinks(
  db: Database,
  declaration: FormatDeclaration,
  reading: Reading,
  table: ReadTable,
  raw: ReadResult,
  formats: FormatIndex,
): ReadResult {
  const keyed = reading.columns.flatMap((each) => {
    const source = table.keyedBy?.[each.index]
    const column = declaration.columns.find((one) => one.name === each.key)
    const target = column?.type === 'link' && column.target !== undefined ? formats.get(column.target) : undefined
    return source === undefined || target === undefined ? [] : [{ key: each.key, source, target }]
  })
  if (keyed.length === 0) return raw
  const found = keyed.map((each) => {
    const byKey = new Map<string, string>()
    for (const record of sourceRecords(db, each.target.name, each.source)) {
      if (!byKey.has(record.key) && readRow(db, each.target, record.rowId) !== undefined) byKey.set(record.key, record.rowId)
    }
    return { ...each, byKey }
  })
  return {
    ...raw,
    rows: raw.rows.map((row) => {
      if (row.cells === undefined) return row
      let cells = row.cells
      for (const each of found) {
        const value = cells[each.key]
        if (typeof value !== 'string' || value === '') continue
        const id = each.byKey.get(value)
        if (id === undefined) {
          return {
            ...row,
            cells: undefined,
            problem:
              `${value} is not a row of ${each.target.title} read from ${each.source}, so this item has no row to ` +
              `belong to. Read the folder onto ${each.target.title} too — in the same call, or before.`,
          }
        }
        cells = { ...cells, [each.key]: id }
      }
      return { ...row, cells }
    }),
  }
}

/** The gone rows a read again would take away when asked: those nothing links to. */
export function removableGone(again: PlannedRereading): readonly string[] {
  return again.gone.filter((each) => !again.linked.has(each.rowId)).map((each) => each.rowId)
}

/**
 * The rows as the file wrote them, less the body links that named no row
 * (M38 U2) — so a dry run shows what is written and not a name left out.
 */
function withoutUnlinked(raw: ReadResult, read: ReadResult): ReadResult {
  return {
    ...raw,
    rows: raw.rows.map((row, at) => {
      const unlinked = read.rows[at]?.unlinked ?? []
      if (row.cells === undefined || unlinked.length === 0) return row
      const cells: Record<string, StoredValue> = { ...row.cells }
      for (const key of new Set(unlinked.map((each) => each.key))) {
        const value = cells[key]
        if (!Array.isArray(value)) continue
        const left = new Set(unlinked.filter((each) => each.key === key).map((each) => each.name))
        const kept = (value as readonly string[]).filter((member) => !left.has(member))
        if (kept.length > 0) cells[key] = kept
        else delete cells[key]
      }
      return { ...row, cells }
    }),
  }
}

/**
 * The header row, read and judged (U10). Its identities are folded over the
 * staged lines, **which is the printed-total check as a declaration**.
 */
function headerPlanOf(
  db: Database,
  lines: FormatDeclaration,
  header: ReadingHeader | undefined,
  table: ReadTable,
  reading: Reading,
  staged: readonly StoredRow[],
  formats: FormatIndex,
  units: UnitTable,
): HeaderPlan | undefined {
  if (header === undefined) return undefined
  const declaration = formats.get(header.format)
  if (declaration === undefined) return undefined

  const raw = readHeader(declaration, header, table, reading.dateOrder, units)
  if (raw.cells === undefined) return { declaration, read: raw, dangling: [], verdicts: [] }

  const asRead = resolveReadLinks(
    db,
    declaration,
    {
      format: header.format,
      headerRow: 0,
      dateOrder: reading.dateOrder,
      columns: header.cells.map((each) => ({ index: each.index, key: each.key })),
      fixed: header.fixed,
    },
    { rows: [{ line: -1, offered: raw.offered, cells: raw.cells, problem: undefined }], blank: 0 },
    formats,
  ).rows[0]
  const cells = asRead?.cells
  if (cells === undefined) {
    return {
      declaration,
      read: { ...raw, cells: undefined, problem: `The header row: ${asRead?.problem ?? 'a link names nothing.'}` },
      dangling: [],
      verdicts: [],
    }
  }

  const row = { id: 'header', cells }
  return {
    declaration,
    read: { ...raw, cells },
    dangling: danglingLinks(db, declaration, cells, formats),
    verdicts: stagedHeaderVerdicts(
      db,
      { declaration, row },
      { declaration: lines, link: header.link, rows: staged },
      formats,
      units,
    ),
  }
}

/** The lines with a check that failed — the rows `tally` counts as failed, by name. */
function failingLines(
  declaration: FormatDeclaration,
  staged: readonly StoredRow[],
  units: UnitTable,
): readonly FailingLine[] {
  return staged.flatMap((row) => {
    const sentences = verdictsOf(declaration, row, units)
      .filter((each) => each.verdict.kind === 'FAILED')
      .map((each) => verdictSentence(each.identity, each.verdict))
    return sentences.length === 0 ? [] : [{ id: row.id, sentences }]
  })
}

/** The header row would not be written: it did not read, or a link of it names nothing. */
export function headerRefuses(plan: ReadingPlan): boolean {
  const header = plan.header
  return header !== undefined && (header.read.cells === undefined || header.dangling.length > 0)
}

/** How many lines read, and how many would not. */
export function lineCounts(plan: ReadingPlan): { readonly typed: number; readonly failed: number } {
  const rows = plan.read?.rows ?? []
  const failed = rows.filter((row) => row.cells === undefined).length
  return { typed: rows.length - failed, failed }
}

/**
 * Whether this plan may be written at all. A file with lines that would not
 * type may still be written — the lines that read are written and the rest are
 * named — but nothing is written over a refusal.
 */
export function planWrites(plan: ReadingPlan): boolean {
  return (
    plan.blocked === undefined &&
    plan.problems.length === 0 &&
    plan.dangling.length === 0 &&
    plan.repeated.length === 0 &&
    plan.broken.length === 0 &&
    !headerRefuses(plan) &&
    lineCounts(plan).typed > 0
  )
}

/**
 * **Reconciled**, in the narrow sense the file comment argues: every line read,
 * the write is allowed, and every check the format declares — on the lines and
 * on the header row — came back proved, with at least one check to prove.
 */
export function reconciles(plan: ReadingPlan): boolean {
  if (!planWrites(plan)) return false
  if (lineCounts(plan).failed > 0) return false
  const proof = plan.proof
  if (proof === undefined || proof.failed > 0 || proof.unchecked > 0) return false
  const header = plan.header?.verdicts ?? []
  if (header.some((each) => each.verdict.kind !== 'PROVED')) return false
  return proof.proved > 0 || header.length > 0
}

/**
 * The write a plan describes, as `recordIntake` takes it. `removeGone` takes
 * away the rows of a source read again whose line is gone (D-408) — asked for,
 * never assumed — less the ones another row links to.
 */
export function intakeRequestOf(
  plan: ReadingPlan,
  declaration: FormatDeclaration,
  reading: Reading,
  table: ReadTable,
  file: { readonly name: string; readonly hash: string; readonly removeGone?: boolean | undefined },
  now: number,
  formats: FormatIndex = new Map(),
): IntakeRequest {
  const rows = plan.read === undefined ? [] : stagedRows(plan.read).map((row) => row.cells)
  const again = plan.again
  const remove = again === undefined || file.removeGone !== true ? [] : removableGone(again)
  return {
    declaration,
    reading,
    lines: plan.read === undefined ? [] : plan.read.rows.flatMap((row) => (row.cells === undefined ? [] : [row.line])),
    fileName: file.name,
    fileHash: file.hash,
    signature: readingSignature(table, reading.headerRow),
    headerCells: readingHeaderCells(table, reading.headerRow),
    rows,
    ...(plan.header?.read.cells === undefined
      ? {}
      : { header: { declaration: plan.header.declaration, cells: plan.header.read.cells } }),
    keys: plan.keys,
    ...(again === undefined
      ? {}
      : {
          again: {
            matched: again.matched,
            update: again.update,
            remove,
            formats,
            counts: {
              changed: again.changed.length,
              added: again.added.length,
              same: again.same,
              edited: again.edited.length,
              gone: again.gone.length - remove.length,
              removed: remove.length,
            },
          },
        }),
    now,
  }
}

/**
 * Whether a plan writes anything at all: a first read writes its rows; a read
 * again only what changed, was added, or was asked to go (D-408).
 */
export function planChanges(plan: ReadingPlan, removeGone = false): boolean {
  const again = plan.again
  if (again === undefined) return lineCounts(plan).typed > 0
  return again.changed.length > 0 || again.added.length > 0 || (removeGone && removableGone(again).length > 0)
}
