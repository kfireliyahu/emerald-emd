/**
 * **What a file wrote, and the reading that wrote it** — M19 U5,
 * [D-226](../../../docs/09-decision-log.md).
 *
 * Three jobs, and they are one idea seen from three sides:
 *
 * 1. **Commit.** The rows a reading produced go into the declared table, and a
 *    record of which rows they are goes beside it, in one transaction. Half of
 *    that is the ordinary write; the other half is the only thing that can ever
 *    undo it.
 * 2. **The ladder's memory.** A file whose header looks like one already read
 *    gets the reading that read it back, with nothing asked — rung 1 of F17's
 *    ladder said about a declared format. **Every reading in here is one a
 *    person accepted**, because an intake row is only written on commit, so
 *    there is no `confirmed` flag to get wrong.
 * 3. **Supersede.** Re-reading the same file offers to remove what that file
 *    wrote before. Both non-negotiable rules meet here and neither bends: *every
 *    import is idempotent* and *nothing is auto-deleted* — so the offer is made
 *    with a name and a count in it, and a person says yes.
 *
 * ## What makes two rows the same row, and who says
 *
 * The pack knows, because a transaction has a date and an amount and a merchant
 * and `naturalKey.ts` is allowed to say so. Here it is a fact about a format,
 * and an engine that invented one would be teaching itself a density (D-223) —
 * the specific mistake H7 was opened to prevent, in a new place. So the
 * sameness this file asserts is only what the format or the file already says:
 * **the same file**, by hash — and, since M38 U3 (D-408), **the same line of a
 * source**, by a key the reading carries: a note's file name, or the value of a
 * column the format declared unique. A source read again updates its rows by
 * that key (`source_key`), and a row a person changed since is left alone
 * (`written`).
 */

import type { Database } from 'sql.js'

import { derivedId, newId } from '@/core/id.ts'
import { isListType, type FormatDeclaration } from '@/domain/format/declaration.ts'
import type {
  IntakeContent,
  ReaderNameRecord,
  ReadingBinding,
  ReadingRecord,
  RowRef,
} from '@/domain/format/document.ts'
import {
  withPendingRows,
  type DateOrder,
  type Reading,
  type ReadingHeader,
} from '@/domain/format/reading.ts'
import { readersOf, type Reader } from '@/domain/format/reader.ts'
import { filledKeys, readingFills, stillAsWritten, writtenMark, type SourceRecord } from '@/domain/format/reread.ts'
import type { StoredValue } from '@/domain/format/row.ts'
import { stringListOf } from '@/domain/format/stringList.ts'
import { inTransaction, query } from '../db/database.ts'
import { deleteRows, insertRows, readRow, updateRow } from './formatRowRepository.ts'
import { findersFor, rulesSetting, withRules } from './formatRuleRepository.ts'

/** One file, read. */
export interface Intake {
  readonly id: string
  readonly format: string
  readonly fileName: string
  readonly fileHash: string
  /** The header this file had, as `readingSignature` writes one. */
  readonly signature: string
  readonly readAt: number
  readonly rowCount: number
  readonly reading: Reading
  /** The header row this file wrote (M24 U10), while it still has one. */
  readonly headerRowId?: string | undefined
  /** The header in the file's own order (M26 F1); absent for an older reading. */
  readonly headerCells?: readonly string[] | undefined
  /** Its reader was forgotten (M26 F1): it is no longer offered, and its rows stay. */
  readonly forgotten?: boolean | undefined
  /** What a read of a source read before did to its rows (M38 U3, D-408). */
  readonly again?: RereadCounts | undefined
}

/** A read again, in counts: what it changed, added, left, and took away. */
export interface RereadCounts {
  readonly changed: number
  readonly added: number
  readonly same: number
  /** Rows a person changed since the last read, left as they are. */
  readonly edited: number
  /** Rows whose line is gone, and stay. */
  readonly gone: number
  /** Rows whose line is gone, removed because somebody asked. */
  readonly removed: number
}

const DATE_ORDERS: readonly DateOrder[] = ['dmy', 'mdy', 'ymd']

/* ------------------------------------------------------------------ writing */

export interface IntakeRequest {
  readonly declaration: FormatDeclaration
  readonly reading: Reading
  readonly fileName: string
  readonly fileHash: string
  readonly signature: string
  /** The header in the file's own order, `readingHeaderCells` (M26 F1). */
  readonly headerCells?: readonly string[] | undefined
  readonly rows: readonly Readonly<Record<string, StoredValue>>[]
  /**
   * Per row, the line of the file it was read from (M38 U4) — what a link to a
   * row of this same read stands in for (`pendingRowId`) until the row's id is
   * drawn here. Absent, no row links to another of its read.
   */
  readonly lines?: readonly number[] | undefined
  /**
   * The header row, as `readHeader` typed it, when the reading has one (M24
   * U10). Written first, and every line's link is set to its id.
   */
  readonly header?: {
    readonly declaration: FormatDeclaration
    readonly cells: Readonly<Record<string, StoredValue>>
  }
  /**
   * Per row, the key of its line in the source (M38 U3, D-408) — a note's file
   * name, or the value of the unique column that keys the read — so a later
   * read of the same source finds the row again.
   */
  readonly keys?: readonly (string | undefined)[] | undefined
  /** A read of a source read before (D-408): which rows the lines are, and what to do. */
  readonly again?: IntakeAgain | undefined
  readonly now: number
}

/** What a read again writes, decided by its plan (`compareRereading`). */
export interface IntakeAgain {
  /** Per row, the row of the source it is; `undefined` adds one. */
  readonly matched: readonly (string | undefined)[]
  /** Per row, whether its cells are written over that row. */
  readonly update: readonly boolean[]
  /** Rows of the source whose line is gone, to take away — only when asked. */
  readonly remove: readonly string[]
  /** The document's formats, which a row taken away is checked against. */
  readonly formats: ReadonlyMap<string, FormatDeclaration>
  readonly counts: RereadCounts
}

/**
 * Write the rows and the record of them, together or not at all.
 *
 * One transaction, for `stageImport`'s reason a milestone earlier: a failure
 * half way that left the rows without the record would leave a document that
 * cannot be told what it just did, and superseding is the whole reason the
 * record exists.
 */
export function recordIntake(db: Database, request: IntakeRequest): Intake {
  const id = intakeId(db, request.declaration.name, request.fileName, request.fileHash, request.now)

  const header = request.reading.header
  if ((header === undefined) !== (request.header === undefined)) {
    throw new Error('A reading with a header row is written with that row, and one without is written without.')
  }

  return inTransaction(db, () => {
    // **The header first**, because every line points at it: a statement is one
    // row the lines belong to, and its id is only known once it exists (U10).
    const headerRowId =
      header === undefined || request.header === undefined
        ? undefined
        : insertRows(db, request.header.declaration, [request.header.cells])[0]
    const again = request.again
    // **Each row's id, drawn before any is written** (M38 U4): the row it is,
    // read again, or a new one — so a link to a row of this same read, held as
    // the line it is read from, is set to that row's id before the write.
    const rowIds = request.rows.map((_, at) => again?.matched[at] ?? newId())
    const idOfLine = new Map((request.lines ?? []).map((line, at) => [line, rowIds[at]]))
    const linked = request.rows.map((cells) => {
      const own = withPendingRows(request.declaration, cells, (line) => idOfLine.get(line))
      return header === undefined || headerRowId === undefined ? own : { ...own, [header.link]: headerRowId }
    })
    // A rule set over this format sets what it matches (M25 E4, D-273): a
    // statement read onto `transaction` arrives sorted, as a row written by
    // hand does.
    const rules = rulesSetting(db, request.declaration)
    // A link found by a date (D-350) is found here too, and a line with no row
    // to find — or two — refuses the file, naming it, rather than landing unlinked.
    const finders = findersFor(db, request.declaration)
    // A line that is a row already is written over it, as the file says it —
    // and a line that is new is written as a first read writes it (D-408).
    const fresh = linked.flatMap((cells, at) => (again?.matched[at] === undefined ? [{ cells, at }] : []))
    const rows = fresh.map(({ cells, at }) => {
      const ruled = withRules(db, request.declaration, cells, {}, rules, finders)
      if (ruled.refusals.length > 0) {
        throw new Error(`Line ${String(at + 1)}: ${ruled.refusals.map((one) => one.reason).join(' ')}`)
      }
      return ruled.cells
    })
    const inserted = insertRows(
      db,
      request.declaration,
      rows,
      fresh.map(({ at }) => rowIds[at] ?? newId()),
    )
    // What this reading fills, and no column it never maps (M50 U3).
    const filled = filledKeys(linked, readingFills(request.declaration, request.reading))
    const written = new Map<number, string>()
    fresh.forEach(({ at }, k) => {
      const rowId = inserted[k]
      if (rowId !== undefined) written.set(at, rowId)
    })
    if (again !== undefined) {
      for (const [at, rowId] of again.matched.entries()) {
        if (rowId === undefined) continue
        const cells = linked[at]
        if (again.update[at] === true && cells !== undefined) {
          updateRow(db, request.declaration, rowId, cleared(request.declaration, cells, filled))
        }
        written.set(at, rowId)
      }
    }
    const ids = [...written.entries()].sort(([a], [b]) => a - b).map(([, rowId]) => rowId)

    db.run(
      `INSERT INTO format_intake
         (id, format_name, file_name, file_hash, signature, header_row, date_order, read_at, row_count,
          header_format, header_link, header_cells)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        request.declaration.name,
        request.fileName,
        request.fileHash,
        request.signature,
        request.reading.headerRow,
        request.reading.dateOrder,
        request.now,
        ids.length,
        header?.format ?? null,
        header?.link ?? null,
        request.headerCells === undefined ? null : JSON.stringify(request.headerCells),
      ],
    )

    for (const column of request.reading.columns) {
      // A separator is kept with its column (M34 U5, D-398), so a reader read
      // again splits a cell the way it did the first time.
      db.run(
        `INSERT INTO format_intake_column (intake_id, key_name, source_index, fixed_value, separator)
         VALUES (?, ?, ?, NULL, ?)`,
        [id, column.key, column.index, column.separator ?? null],
      )
    }
    for (const fixed of request.reading.fixed) {
      if (fixed.value.trim() === '') continue
      db.run(
        `INSERT INTO format_intake_column (intake_id, key_name, source_index, fixed_value)
         VALUES (?, ?, NULL, ?)`,
        [id, fixed.key, fixed.value],
      )
    }

    // Each row with the key of its line and the mark of what was put in it
    // (D-408). A row read before moves to this reading — from this source, or
    // from another file that wrote it and this one found by its unique column
    // (M50 U3): its records under the readings before go, so a row is held by
    // the one reading that last wrote it, and superseding an older reading
    // never takes back a row a later one updated.
    for (const [at, rowId] of [...written.entries()].sort(([a], [b]) => a - b)) {
      const key = request.keys?.[at]
      const previous = again?.matched[at] === undefined ? undefined : priorRecord(db, request.declaration.name, rowId)
      if (previous !== undefined) {
        db.run(
          `DELETE FROM format_intake_row WHERE row_id = ? AND format_name IS NULL AND intake_id IN
             (SELECT id FROM format_intake WHERE format_name = ?)`,
          [rowId, request.declaration.name],
        )
      }
      const now = readRow(db, request.declaration, rowId)
      // A row a person changed since keeps the mark it had, so it stays theirs —
      // unless this read wrote over it, which makes what it holds the read's.
      const kept =
        again?.update[at] !== true &&
        previous?.written !== undefined &&
        now !== undefined &&
        !stillAsWritten(now.cells, previous.written)
          ? previous.written
          : undefined
      const mark = kept ?? (now === undefined ? null : writtenMark(request.declaration, now.cells, filled))
      db.run(
        `INSERT INTO format_intake_row (intake_id, row_id, source_key, written) VALUES (?, ?, ?, ?)`,
        [id, rowId, key ?? null, key === undefined ? null : mark],
      )
    }

    // The rows whose line is gone, taken away because somebody asked (D-408).
    let removed = 0
    if (again !== undefined && again.remove.length > 0) {
      removed = deleteRows(db, request.declaration, again.remove, again.formats.values()).length
      for (const rowId of again.remove) {
        db.run(
          `DELETE FROM format_intake_row WHERE row_id = ? AND format_name IS NULL AND intake_id IN
             (SELECT id FROM format_intake WHERE format_name = ? AND file_name = ?)`,
          [rowId, request.declaration.name, request.fileName],
        )
      }
    }
    if (again !== undefined) {
      // The readings before keep what they still hold — a row whose line is gone.
      db.run(
        `UPDATE format_intake SET row_count =
           (SELECT COUNT(*) FROM format_intake_row r WHERE r.intake_id = format_intake.id)
         WHERE format_name = ? AND id <> ?`,
        [request.declaration.name, id],
      )
    }

    if (header !== undefined && headerRowId !== undefined) {
      // The header is a row this file wrote, so superseding takes it back too —
      // which is why it is recorded with the format it is a row of.
      db.run(`INSERT INTO format_intake_row (intake_id, row_id, format_name) VALUES (?, ?, ?)`, [
        id,
        headerRowId,
        header.format,
      ])
      for (const cell of header.cells) {
        db.run(
          `INSERT INTO format_intake_header_cell (intake_id, key_name, source_row, source_index, fixed_value)
           VALUES (?, ?, ?, ?, NULL)`,
          [id, cell.key, cell.row, cell.index],
        )
      }
      for (const fixed of header.fixed) {
        if (fixed.value.trim() === '') continue
        db.run(
          `INSERT INTO format_intake_header_cell (intake_id, key_name, source_row, source_index, fixed_value)
           VALUES (?, ?, NULL, NULL, ?)`,
          [id, fixed.key, fixed.value],
        )
      }
    }

    return {
      id,
      format: request.declaration.name,
      fileName: request.fileName,
      fileHash: request.fileHash,
      signature: request.signature,
      readAt: request.now,
      rowCount: ids.length,
      reading: request.reading,
      headerRowId,
      headerCells: request.headerCells,
      ...(again === undefined ? {} : { again: { ...again.counts, removed } }),
    }
  })
}

/**
 * The reading's id: **derived**, from the format, the file and the moment it
 * was read, so a text document — which mints its ids on open (D-247) — gives
 * the reading the same id every time, and `supersede_reading` can be handed one
 * from an earlier call. A second read of the same file in the same millisecond
 * draws one.
 */
function intakeId(db: Database, format: string, fileName: string, fileHash: string, readAt: number): string {
  const id = derivedId(['intake', format, fileName, fileHash, String(readAt)].join('\u0000'))
  const taken = query(db, `SELECT 1 FROM format_intake WHERE id = ?`, [id]).length > 0
  return taken ? newId() : id
}

/**
 * A line's cells over the row it is: every key this read fills, and the ones
 * this line left empty cleared — a note whose frontmatter lost a key is a row
 * that lost that value.
 */
function cleared(
  declaration: FormatDeclaration,
  cells: Readonly<Record<string, StoredValue>>,
  filled: readonly string[],
): Record<string, StoredValue> {
  const lists = new Set(declaration.columns.filter((column) => isListType(column.type)).map((column) => column.name))
  const out: Record<string, StoredValue> = {}
  for (const key of filled) out[key] = cells[key] ?? (lists.has(key) ? [] : null)
  return out
}

/** The record a row read before has now, from whichever file: under which reading, and its mark. */
function priorRecord(
  db: Database,
  format: string,
  rowId: string,
): { readonly intakeId: string; readonly written: string | undefined } | undefined {
  const row = query(
    db,
    `SELECT r.intake_id, r.written FROM format_intake_row r JOIN format_intake i ON i.id = r.intake_id
      WHERE i.format_name = ? AND r.row_id = ? AND r.format_name IS NULL
      ORDER BY i.read_at DESC, i.id DESC LIMIT 1`,
    [format, rowId],
  )[0]
  if (row === undefined) return undefined
  return {
    intakeId: String(row['intake_id']),
    written: typeof row['written'] === 'string' ? row['written'] : undefined,
  }
}

/**
 * Every row a source wrote before, by the key of its line (M38 U3, D-408) — the
 * readings of this format from a file of this name, newest first. A source is
 * its name, not its bytes: a corrected export has a new hash and is the same
 * source. A row without a key was read before keys existed and is not here.
 */
export function sourceRecords(db: Database, format: string, fileName: string): readonly SourceRecord[] {
  return query(
    db,
    `SELECT r.row_id, r.source_key, r.written FROM format_intake_row r JOIN format_intake i ON i.id = r.intake_id
      WHERE i.format_name = ? AND i.file_name = ? AND r.format_name IS NULL AND r.source_key IS NOT NULL
      ORDER BY i.read_at DESC, i.id DESC`,
    [format, fileName],
  ).map((row) => ({
    rowId: String(row['row_id']),
    key: String(row['source_key']),
    written: typeof row['written'] === 'string' ? row['written'] : undefined,
  }))
}

/**
 * Each row's latest record, whichever file read it, by the key of its line —
 * for rows a read finds by a unique column rather than by its own source
 * (M50 U3). A row no reading wrote has none, and nothing marks it as written.
 */
export function rowRecords(db: Database, format: string, rowIds: readonly string[]): ReadonlyMap<string, string | undefined> {
  const out = new Map<string, string | undefined>()
  for (const rowId of new Set(rowIds)) {
    const record = priorRecord(db, format, rowId)
    if (record !== undefined) out.set(rowId, record.written)
  }
  return out
}

/** The formats a file of this name was read onto, each once (M38 U4). */
export function formatsReadFrom(db: Database, fileName: string): readonly string[] {
  return query(db, `SELECT DISTINCT format_name FROM format_intake WHERE file_name = ? ORDER BY format_name`, [fileName]).map(
    (row) => String(row['format_name']),
  )
}

/* ------------------------------------------------------------------ reading */

/** Every file read onto this format, most recent first. */
export function listIntakes(db: Database, format: string): readonly Intake[] {
  const rows = query(
    db,
    `SELECT id, format_name, file_name, file_hash, signature, read_at, row_count, header_row, date_order,
            header_format, header_link, header_cells, forgotten
       FROM format_intake WHERE format_name = ? ORDER BY read_at DESC, id DESC`,
    [format],
  )
  return rows.map((row) => intakeOf(db, row))
}

/**
 * The last time this exact file was read onto this format **and still has rows
 * to show for it**.
 *
 * The narrowest true question about sameness, and the only one asked: a person
 * who exported the same file twice gets an offer to supersede, and a person who
 * exported a longer one gets no offer at all, because two files that differ by a
 * row are not the same file and the engine has nothing to say about which of
 * their rows are the same rows.
 *
 * `row_count > 0` is what keeps the offer honest after a supersede: the record
 * outlives the rows on purpose (see `supersedeIntake`), and offering to remove
 * rows that are already gone would be a button that does nothing — the shape
 * D-138 keeps finding a bug in.
 */
export function priorIntake(
  db: Database,
  format: string,
  fileHash: string,
): Intake | undefined {
  const rows = query(
    db,
    `SELECT id, format_name, file_name, file_hash, signature, read_at, row_count, header_row, date_order,
            header_format, header_link, header_cells, forgotten
       FROM format_intake WHERE format_name = ? AND file_hash = ? AND row_count > 0
      ORDER BY read_at DESC, id DESC LIMIT 1`,
    [format, fileHash],
  )
  const row = rows[0]
  return row === undefined ? undefined : intakeOf(db, row)
}

/* --------------------------------------------------------------- unmaking it */

/**
 * Remove what one intake wrote — and **keep the reading that wrote it**.
 *
 * The rows go, the record of which rows they were goes, and the reading stays
 * with `row_count` at nothing. That asymmetry was found by driving the screen:
 * superseding and then re-reading the same file is the *ordinary* flow, and a
 * version that forgot the mapping at the same time took away the thing the
 * person was about to need one click later. **Removing rows is not the same act
 * as forgetting how to read a document**, and `forgetIntakes` is the one that
 * does the second.
 *
 * Returns how many rows actually went. A row somebody has since deleted by hand
 * is not an error here — the count is the truth about what happened, and a
 * caller that reported the intake's own `row_count` would be reporting what was
 * once true.
 */
export function supersedeIntake(
  db: Database,
  intakeId: string,
  declaration: FormatDeclaration,
  /**
   * The document's formats, for a reading that wrote a header row into another
   * one (M24 U10). Without it such a reading is refused whole rather than half
   * taken back — the lines gone and their statement left standing.
   */
  formats: ReadonlyMap<string, FormatDeclaration> = new Map(),
): number {
  return inTransaction(db, () => {
    const recorded = query(
      db,
      `SELECT row_id, format_name FROM format_intake_row WHERE intake_id = ?`,
      [intakeId],
    )
    const ids = recorded
      .filter((row) => row['format_name'] === null)
      .map((row) => String(row['row_id']))
    const headers = recorded.filter((row) => row['format_name'] !== null)

    const removed = deleteRows(db, declaration, ids, formats.values())
    for (const row of headers) {
      const name = String(row['format_name'])
      const header = formats.get(name)
      if (header === undefined) {
        throw new Error(`This reading wrote a header row into ${name}, which is not a format given here.`)
      }
      deleteRows(db, header, [String(row['row_id'])], formats.values())
    }

    db.run(`DELETE FROM format_intake_row WHERE intake_id = ?`, [intakeId])
    db.run(`UPDATE format_intake SET row_count = 0 WHERE id = ?`, [intakeId])

    return removed.length
  })
}

/**
 * Forget every intake of a format whose table is going.
 *
 * Called by `deleteFormat`, because there is no foreign key to do it: this app
 * never runs `PRAGMA foreign_keys = ON` (D-067), so the rule that holds is the
 * one written here. The rows are already going with the table; what would
 * otherwise be left is a record pointing at ids in a table that no longer
 * exists.
 */
export function forgetIntakes(db: Database, format: string): void {
  inTransaction(db, () => {
    db.run(
      `DELETE FROM format_intake_row WHERE intake_id IN
         (SELECT id FROM format_intake WHERE format_name = ?)`,
      [format],
    )
    db.run(
      `DELETE FROM format_intake_column WHERE intake_id IN
         (SELECT id FROM format_intake WHERE format_name = ?)`,
      [format],
    )
    db.run(
      `DELETE FROM format_intake_header_cell WHERE intake_id IN
         (SELECT id FROM format_intake WHERE format_name = ?)`,
      [format],
    )
    db.run(`DELETE FROM format_intake WHERE format_name = ?`, [format])
    db.run(`DELETE FROM format_reader WHERE format_name = ?`, [format])
  })
}

/* ------------------------------------------------------------------- reading it back */

function intakeOf(db: Database, row: Record<string, unknown>): Intake {
  const id = String(row['id'])
  const format = String(row['format_name'])
  const order = String(row['date_order'])

  const bindings = query(
    db,
    `SELECT key_name, source_index, fixed_value, separator FROM format_intake_column
      WHERE intake_id = ? ORDER BY source_index, key_name`,
    [id],
  )
  const headerFormat = row['header_format']
  const headerLink = row['header_link']
  const header =
    typeof headerFormat === 'string' && typeof headerLink === 'string'
      ? headerOf(db, id, headerFormat, headerLink)
      : undefined
  const headerRowId = query(
    db,
    `SELECT row_id FROM format_intake_row WHERE intake_id = ? AND format_name IS NOT NULL LIMIT 1`,
    [id],
  )[0]?.['row_id']

  return {
    id,
    format,
    fileName: String(row['file_name']),
    fileHash: String(row['file_hash']),
    signature: String(row['signature']),
    readAt: Number(row['read_at']),
    rowCount: Number(row['row_count']),
    reading: {
      format,
      headerRow: Number(row['header_row']),
      dateOrder: DATE_ORDERS.find((each) => each === order) ?? 'dmy',
      columns: bindings
        .filter((each) => each['source_index'] !== null)
        .map((each) => ({
          index: Number(each['source_index']),
          key: String(each['key_name']),
          ...(typeof each['separator'] === 'string' ? { separator: each['separator'] } : {}),
        })),
      fixed: bindings
        .filter((each) => each['source_index'] === null)
        .map((each) => ({ key: String(each['key_name']), value: String(each['fixed_value']) })),
      ...(header === undefined ? {} : { header }),
    },
    headerRowId: typeof headerRowId === 'string' ? headerRowId : undefined,
    headerCells: headerCellsOf(row['header_cells']),
    forgotten: row['forgotten'] === 1,
  }
}

const headerCellsOf = stringListOf

function headerOf(db: Database, intakeId: string, format: string, link: string): ReadingHeader {
  const bindings = query(
    db,
    `SELECT key_name, source_row, source_index, fixed_value FROM format_intake_header_cell
      WHERE intake_id = ? ORDER BY key_name`,
    [intakeId],
  )
  return {
    format,
    link,
    cells: bindings
      .filter((each) => each['source_index'] !== null)
      .map((each) => ({
        key: String(each['key_name']),
        row: Number(each['source_row']),
        index: Number(each['source_index']),
      })),
    fixed: bindings
      .filter((each) => each['source_index'] === null)
      .map((each) => ({ key: String(each['key_name']), value: String(each['fixed_value']) })),
  }
}

/* ------------------------------------------------------------------- readers */

/**
 * The readers this format has (M26 U5): every accepted reading, grouped by the
 * header it was made for, newest first. `readersOf` is the grouping; this is
 * only where the readings come from.
 */
export function listReaders(db: Database, format: string): readonly Reader[] {
  const names = new Map(
    query(db, `SELECT signature, name FROM format_reader WHERE format_name = ?`, [format]).map(
      (row) => [String(row['signature']), String(row['name'])] as const,
    ),
  )
  return readersOf(
    listIntakes(db, format)
      .filter((intake) => intake.forgotten !== true)
      .map((intake) => ({
        signature: intake.signature,
        reading: intake.reading,
        headerCells: intake.headerCells,
        fileName: intake.fileName,
        readAt: intake.readAt,
      })),
    names,
  )
}

/**
 * Give a reader a name (M26 F1), or take the one it has back — an empty name is
 * the file it last read again. Kept by the header it was made for, so a reading
 * accepted later for the same layout keeps the name.
 */
export function renameReader(db: Database, format: string, signature: string, name: string): void {
  const trimmed = name.trim()
  if (trimmed === '') {
    db.run(`DELETE FROM format_reader WHERE format_name = ? AND signature = ?`, [format, signature])
    return
  }
  db.run(
    `INSERT INTO format_reader (format_name, signature, name) VALUES (?, ?, ?)
       ON CONFLICT (format_name, signature) DO UPDATE SET name = excluded.name`,
    [format, signature, trimmed],
  )
}

/**
 * Forget a reader (M26 F1): its readings stop being offered to a file, and its
 * name goes. **Nothing it wrote goes** — the rows stay, and so does the record of
 * which rows they are, so `supersedeIntake` can still take them back. Reading a
 * file of that layout again makes a new reader.
 *
 * Returns how many readings it forgot; nothing, for a reader the format has not got.
 */
export function forgetReader(db: Database, format: string, signature: string): number {
  return inTransaction(db, () => {
    const count = query(
      db,
      `SELECT COUNT(*) AS n FROM format_intake WHERE format_name = ? AND signature = ? AND forgotten = 0`,
      [format, signature],
    )[0]?.['n']
    db.run(`UPDATE format_intake SET forgotten = 1 WHERE format_name = ? AND signature = ?`, [
      format,
      signature,
    ])
    db.run(`DELETE FROM format_reader WHERE format_name = ? AND signature = ?`, [format, signature])
    return typeof count === 'number' ? count : 0
  })
}

/* ------------------------------------------------------------------- as text */

/**
 * Every reading the document holds, as the text writes them (M38 U3, D-408):
 * each with its mapping and the rows it wrote, by id — `writeDocument` turns
 * the ids into the names the text uses.
 */
export function listIntakeContent(db: Database): readonly IntakeContent[] {
  const bindings = groupBy(
    query(db, `SELECT intake_id, key_name, source_index, fixed_value, separator FROM format_intake_column`),
  )
  const headers = groupBy(
    query(db, `SELECT intake_id, key_name, source_row, source_index, fixed_value FROM format_intake_header_cell`),
  )
  const rows = groupBy(query(db, `SELECT intake_id, row_id, format_name, source_key, written FROM format_intake_row`))
  return query(
    db,
    `SELECT id, format_name, file_name, file_hash, signature, header_row, date_order, read_at, row_count,
            header_format, header_link, header_cells, forgotten FROM format_intake`,
  ).map((row) => {
    const id = String(row['id'])
    return {
      format: String(row['format_name']),
      file: String(row['file_name']),
      hash: String(row['file_hash']),
      signature: String(row['signature']),
      readAt: Number(row['read_at']),
      headerRow: Number(row['header_row']),
      dateOrder: String(row['date_order']),
      rowCount: Number(row['row_count']),
      headerFormat: textOf(row['header_format']),
      headerLink: textOf(row['header_link']),
      headerCells: textOf(row['header_cells']),
      forgotten: row['forgotten'] === 1,
      columns: (bindings.get(id) ?? []).map((each) => bindingOf(each, false)),
      header: (headers.get(id) ?? []).map((each) => bindingOf(each, true)),
      rows: (rows.get(id) ?? []).map((each) => ({
        id: String(each['row_id']),
        format: textOf(each['format_name']),
        key: textOf(each['source_key']),
        written: textOf(each['written']),
      })),
    }
  })
}

/** The names people gave readers. */
export function listReaderNames(db: Database): readonly ReaderNameRecord[] {
  return query(db, `SELECT format_name, signature, name FROM format_reader`).map((row) => ({
    format: String(row['format_name']),
    signature: String(row['signature']),
    name: String(row['name']),
  }))
}

/**
 * Write the readings a text held back into a document whose rows it has just
 * written — each row found by `rowOf` from the name the text gave it. A row the
 * text names and the document has not got is left out: it is no row the
 * reading can take back. Each reading's id is derived as `recordIntake`
 * derives it, so the same text gives the same ids on every open.
 */
export function restoreReadings(
  db: Database,
  readings: readonly ReadingRecord[],
  readerNames: readonly ReaderNameRecord[],
  rowOf: (format: string, ref: RowRef) => string | undefined,
): void {
  for (const reading of readings) {
    const id = intakeId(db, reading.format, reading.file, reading.hash, reading.readAt)
    db.run(
      `INSERT INTO format_intake
         (id, format_name, file_name, file_hash, signature, header_row, date_order, read_at, row_count,
          header_format, header_link, header_cells, forgotten)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        reading.format,
        reading.file,
        reading.hash,
        reading.signature,
        reading.headerRow,
        reading.dateOrder,
        reading.readAt,
        reading.rowCount,
        reading.headerFormat ?? null,
        reading.headerLink ?? null,
        reading.headerCells ?? null,
        reading.forgotten ? 1 : 0,
      ],
    )
    for (const each of reading.columns) {
      db.run(
        `INSERT INTO format_intake_column (intake_id, key_name, source_index, fixed_value, separator)
         VALUES (?, ?, ?, ?, ?)`,
        [id, each.key, each.index ?? null, each.fixed ?? null, each.separator ?? null],
      )
    }
    for (const each of reading.header) {
      db.run(
        `INSERT INTO format_intake_header_cell (intake_id, key_name, source_row, source_index, fixed_value)
         VALUES (?, ?, ?, ?, ?)`,
        [id, each.key, each.row ?? null, each.index ?? null, each.fixed ?? null],
      )
    }
    for (const row of reading.rows) {
      const rowId = rowOf(row.format ?? reading.format, row.row)
      if (rowId === undefined) continue
      db.run(
        `INSERT OR IGNORE INTO format_intake_row (intake_id, row_id, format_name, source_key, written)
         VALUES (?, ?, ?, ?, ?)`,
        [id, rowId, row.format ?? null, row.key ?? null, row.written ?? null],
      )
    }
  }
  for (const each of readerNames) {
    db.run(`INSERT OR REPLACE INTO format_reader (format_name, signature, name) VALUES (?, ?, ?)`, [
      each.format,
      each.signature,
      each.name,
    ])
  }
}

function groupBy(rows: readonly Record<string, unknown>[]): ReadonlyMap<string, Record<string, unknown>[]> {
  const out = new Map<string, Record<string, unknown>[]>()
  for (const row of rows) {
    const key = String(row['intake_id'])
    out.set(key, [...(out.get(key) ?? []), row])
  }
  return out
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function bindingOf(row: Record<string, unknown>, header: boolean): ReadingBinding {
  const number = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined)
  return {
    key: String(row['key_name']),
    ...(header ? { row: number(row['source_row']) } : {}),
    index: number(row['source_index']),
    fixed: textOf(row['fixed_value']),
    ...(header ? {} : { separator: textOf(row['separator']) }),
  }
}
