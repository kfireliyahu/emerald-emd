/**
 * **Many files read in one go, each onto its format** — M34 U2, D-395.
 *
 * The trial's largest cost was rows typed through the chat: a person with three
 * linked spreadsheets — the parents, the children, the lines that name both —
 * could read one file per call, and the second call could not see the rows the
 * first was only about to write. This is the whole lot as one plan.
 *
 * ## In the order the links need
 *
 * A file onto a format that links to another format of the batch is read after
 * the file that writes that format's rows, so a line can name a row read
 * earlier in the same call. Otherwise the order given is kept. A ring — two
 * formats that link to each other — has no order that fills every link; it is
 * read in the order given, and the lines that name a row not yet there are
 * refused by line like any other line naming nothing.
 *
 * ## One plan, before anything is written
 *
 * The plan is the write, rehearsed (`rehearse`): each file is judged by
 * `planReading` — the one judgement a single file gets, on the screen and in a
 * conversation — and, when it may be written, written, so the next file is
 * judged against it; then every write is rolled back. So a link to a row from an
 * earlier file resolves exactly as it will on commit, a unique value repeated
 * across two files is refused like one repeated within one, and the plan is
 * never a second copy of what writing does.
 *
 * **A batch is written whole or not at all.** A file that may not be written —
 * a broken mapping, a repeated unique value, a fixed link to nothing, or no line
 * that reads — refuses the batch. A *line* that does not read, a link naming a
 * parent that is not there among them, is refused and named by file and line,
 * and the rest of its file is written: the same bargain a single file has.
 *
 * Nothing here knows what kind of file a table came from. A `.csv`, an `.xlsx`
 * and, from U7, a note are each a `ReadTable` by the time they get here.
 */

import type { Database } from 'sql.js'

import { inTransaction, rehearse } from '@/data/db/database.ts'
import { auditFormat } from '@/data/repositories/formatAuditRepository.ts'
import { recordIntake, type Intake } from '@/data/repositories/formatIntakeRepository.ts'
import type { FormatIndex } from '@/data/repositories/formatJoinRepository.ts'
import type { FormatAudit } from '@/domain/format/audit.ts'
import { isLinkType, type FormatDeclaration } from '@/domain/format/declaration.ts'
import type { ReadTable, Reading } from '@/domain/format/reading.ts'

import { intakeRequestOf, planReading, planWrites, type ReadingPlan } from './readingPlan.ts'

/** One file of a batch, with the format it is read onto and how. */
export interface BatchFile {
  /** What the person calls it — the file's name. */
  readonly name: string
  readonly hash: string
  readonly table: ReadTable
  readonly declaration: FormatDeclaration
  readonly reading: Reading
  /**
   * Take away the rows of this source whose line is gone, when it was read
   * before (M38 U3, D-408). Never assumed: gone rows are named and kept.
   */
  readonly removeGone?: boolean | undefined
}

export interface BatchPlan {
  /** Positions in the list given, in the order the files are read. */
  readonly order: readonly number[]
  /** Each file's plan, at its position in the list given. */
  readonly plans: readonly ReadingPlan[]
  /**
   * What the engine sees in each format written, once the whole lot is in
   * (M34 U3, D-396) — rehearsed for a plan, so it is said before the commit.
   * Empty when the batch may not be written: a part-read batch is no state.
   */
  readonly audits: readonly FormatAudit[]
}

export interface BatchWritten extends BatchPlan {
  /** What each file wrote, at its position in the list given; empty when nothing was. */
  readonly intakes: readonly (Intake | undefined)[]
}

/**
 * The order the files are read in: a file after every file whose format it
 * links to, and otherwise as given. A header row a file writes counts as a row
 * of that file, so a file linking to that header's format waits for it.
 */
export function readingOrder(files: readonly BatchFile[], formats: FormatIndex): readonly number[] {
  const writes = files.map(
    (file) => new Set([file.declaration.name, ...(file.reading.header === undefined ? [] : [file.reading.header.format])]),
  )
  const needs = files.map((file, at) => {
    const linked = new Set<string>()
    const header = file.reading.header === undefined ? undefined : formats.get(file.reading.header.format)
    for (const declaration of [file.declaration, ...(header === undefined ? [] : [header])]) {
      for (const column of declaration.columns) {
        if (isLinkType(column.type) && column.target !== undefined) linked.add(column.target)
      }
    }
    // A file never waits for itself: a format linking to its own rows is read
    // in the order it is written.
    for (const own of writes[at] ?? []) linked.delete(own)
    return linked
  })

  const order: number[] = []
  const placed = new Set<number>()
  while (order.length < files.length) {
    const next = files.findIndex(
      (_, at) =>
        !placed.has(at) &&
        files.every(
          (__, other) =>
            other === at ||
            placed.has(other) ||
            ![...(writes[other] ?? [])].some((name) => needs[at]?.has(name) === true),
        ),
    )
    // A ring: nothing is free, so the first file left goes next.
    const taken = next === -1 ? files.findIndex((_, at) => !placed.has(at)) : next
    order.push(taken)
    placed.add(taken)
  }
  return order
}

/** Whether the batch may be written: every file of it may be (`planWrites`). */
export function batchWrites(plan: BatchPlan): boolean {
  return plan.plans.length > 0 && plan.plans.every(planWrites)
}

/**
 * Judge a batch, every file against the files before it, and write nothing —
 * the rehearsal the file comment argues for.
 */
export function planBatch(
  db: Database,
  files: readonly BatchFile[],
  formats: FormatIndex,
  now: number,
): BatchPlan {
  return rehearse(db, () => run(db, files, formats, now))
}

/**
 * Write a batch: judged again in order, and written whole only when every file
 * of it may be. **Refused, it writes nothing**, and the answer says why file by
 * file — the same plans `planBatch` gives.
 */
export function writeBatch(
  db: Database,
  files: readonly BatchFile[],
  formats: FormatIndex,
  now: number,
): BatchWritten {
  const rehearsed = planBatch(db, files, formats, now)
  if (!batchWrites(rehearsed)) return { ...rehearsed, intakes: files.map(() => undefined) }
  return inTransaction(db, () => run(db, files, formats, now))
}

function run(db: Database, files: readonly BatchFile[], formats: FormatIndex, now: number): BatchWritten {
  const order = readingOrder(files, formats)
  const plans: ReadingPlan[] = []
  const intakes: (Intake | undefined)[] = files.map(() => undefined)
  for (const at of order) {
    const file = files[at]
    if (file === undefined) continue
    const plan = planReading(db, file.declaration, file.table, file, file.reading, formats)
    plans[at] = plan
    if (planWrites(plan)) {
      intakes[at] = recordIntake(
        db,
        intakeRequestOf(plan, file.declaration, file.reading, file.table, file, now, formats),
      )
    }
  }
  const audits = batchWrites({ order, plans, audits: [] })
    ? auditWritten(db, files.filter((_, at) => intakes[at] !== undefined), formats)
    : []
  return { order, plans, audits, intakes }
}

/**
 * What the engine sees in every format these files wrote — each file's own and
 * its header row's — once (M34 U3, D-396). Called after the writes, for real or
 * inside a rehearsal.
 */
export function auditWritten(
  db: Database,
  files: readonly Pick<BatchFile, 'declaration' | 'reading'>[],
  formats: FormatIndex,
): readonly FormatAudit[] {
  const names = new Set(
    files.flatMap((file) => [
      file.declaration.name,
      ...(file.reading.header === undefined ? [] : [file.reading.header.format]),
    ]),
  )
  return [...names].flatMap((name) => {
    const declaration = formats.get(name)
    return declaration === undefined ? [] : [auditFormat(db, declaration, formats)]
  })
}
