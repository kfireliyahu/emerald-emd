/**
 * The serializer's two ends against a real document — M22 U4, D-244.
 *
 * `domain/format/document.ts` is the whole of the format and none of the
 * storage, because `src/domain/` imports no sql.js. This is the half that reads
 * the tables and the half that writes them back, and there is one real decision
 * in it: **a row's identity is made here and nowhere else.**
 *
 * The text names a row by what it is called and never by its id (D-241), so the
 * ids do not exist until the rows do. Writing a document back is therefore two
 * passes — the same two the first batch of decisions needed when it wrote
 * `supersedes` over ids it had just been handed (D-240) — and it is two passes
 * whether or not anything is self-referential, because a format may point at one
 * that has not been written yet.
 *
 * **A required link is why the first pass writes the name rather than nothing.**
 * The obvious first pass leaves every link null and fills it in afterwards, and
 * `review_entry.unit` is `NOT NULL`, so that pass cannot insert a single row.
 * So the name goes in the cell and the second pass writes the id over it —
 * inside one transaction, and never observable outside it, because both passes
 * either land or neither does.
 *
 * **Applying refuses a document that already has formats.** Nothing here
 * merges, and nothing is auto-deleted: reading text over a document that holds
 * rows would either duplicate them or silently drop them, and there is no third
 * behaviour that is obviously right. The direction this is for is a fresh
 * document — a clone, a checkout, a smudge — and that one is unambiguous.
 */

import type { Database } from 'sql.js'

import { derivedId } from '@/core/id.ts'
import { instantDay } from '@/core/instant.ts'
import { parseISODate } from '@/core/time.ts'
import { err, ok, type Result } from '@/core/result.ts'
import { labelColumn, type FormatDeclaration } from '@/domain/format/declaration.ts'
import {
  parsedRowRefs,
  readDocument,
  writeDocument,
  type DocumentPart,
  type ParsedDocument,
  type ParsedFormat,
  type ParsedRow,
} from '@/domain/format/document.ts'
import type { StoredValue } from '@/domain/format/row.ts'
import { inTransaction } from '../db/database.ts'
import { listIntakeContent, listReaderNames, restoreReadings } from './formatIntakeRepository.ts'
import { adoptFormat, changeMarks, listFormats, restoreChangeMarks } from './formatRepository.ts'
import { insertRows, listRows, updateRow } from './formatRowRepository.ts'
import { listSeeds, restoreSeeds } from './formatSeedRepository.ts'
import {
  graphPlaces,
  listColumnWidths,
  listViewSettings,
  restoreColumnWidths,
  restoreGraphPlaces,
  restoreSavedViews,
  restoreViewSettings,
  savedViews,
} from './formatViewRepository.ts'
import {
  addUnit,
  correctUnit,
  documentCurrency,
  listUnits,
  restoreDocumentCurrency,
} from './unitRepository.ts'

/**
 * This document's declared half as text.
 *
 * Every row of every declared table, read whole and with no limit — which is
 * the one place in this app that is deliberately true. A serialization that
 * paged would be a serialization that is not complete, and `scale.test.ts` is
 * where the cost of that gets argued if it ever becomes one.
 */
export function serializeDocument(db: Database): Result<readonly DocumentPart[], string> {
  return writeDocument({
    units: listUnits(db),
    formats: listFormats(db).map((declaration) => ({
      declaration,
      rows: listRows(db, declaration),
    })),
    seeds: listSeeds(db),
    widths: listColumnWidths(db),
    places: graphPlaces(db),
    views: listViewSettings(db),
    saved: savedViews(db),
    currency: documentCurrency(db),
    readings: listIntakeContent(db),
    readerNames: listReaderNames(db),
    // The day each format last changed (M47 U5, D-462), as it is here.
    changed: new Map([...changeMarks(db)].map(([name, at]) => [name, instantDay(at)])),
  })
}

/** The same thing from text, straight into an empty document. */
export function applyParts(
  db: Database,
  parts: readonly DocumentPart[],
  now: number,
): Result<ParsedDocument, string> {
  const parsed = readDocument(parts)
  if (!parsed.ok) return parsed

  const applied = applyDocument(db, parsed.value, now)
  return applied.ok ? ok(parsed.value) : applied
}

/**
 * Write a parsed document into an empty one.
 *
 * The formats arrive in link order where there is one, and `readDocument` has
 * already checked every declaration against all the others (M29 F1, D-336). A
 * format adopted before the one it points at or folds is not refused for it:
 * adopting checks a table against its own declaration, SQLite takes a
 * `REFERENCES` to a table that is about to exist, and the derived views are
 * rebuilt on every adopt, so the last one sees every table.
 */
export function applyDocument(
  db: Database,
  document: ParsedDocument,
  now: number,
): Result<ParsedDocument, string> {
  const existing = listFormats(db)
  if (existing.length > 0) {
    return err(
      `This document already declares ${existing.map((each) => each.name).join(', ')}. ` +
        'Text is read into a document with no formats in it.',
    )
  }

  const units = applyUnits(db, document, now)
  if (!units.ok) return units

  // **Ids first, links second.** The first pass writes every row with its link
  // columns left null; the second fills them in, once every row a link could
  // name has an id. A document whose formats point at each other is written by
  // the same two passes as one that does not, which is why this is not
  // conditional on anything.
  const named = new Map<string, Map<string, string>>()
  const written = new Map<string, readonly { readonly id: string; readonly row: ParsedRow }[]>()

  // **Thrown rather than returned**, because `inTransaction` rolls back on an
  // exception and commits anything else. A refusal handed back as a value would
  // leave half a document written and say it had refused.
  try {
    inTransaction(db, () => {
      for (const format of document.formats) {
        const plan = adoptFormat(db, format.declaration, now)
        if (plan.refusals.length > 0) {
          throw new Refused(
            `${format.declaration.name}: ${plan.refusals.map((each) => each.detail).join(' ')}`,
          )
        }

        const ids = insertRows(
          db,
          format.declaration,
          format.rows.map((row) => ({ ...row.cells, ...row.links })),
          // **Derived, not drawn** (M22 U6, D-247). The text holds no ids, so
          // this is where a text document's rows get theirs — and random ones
          // gave the same file a different identity on every open, which broke
          // the one flow that needs an id to outlive a call: a conversation
          // reading an id from `format_rows` and writing a link over it.
          identitiesOf(format),
        )

        const naming = labelColumn(format.declaration)
        const index = new Map<string, string>()
        const pairs = format.rows.map((row, at) => {
          const id = ids[at] ?? ''
          const label = naming === undefined ? undefined : row.cells[naming.name]
          if (typeof label === 'string' && label !== '') index.set(label, id)
          return { id, row }
        })
        named.set(format.declaration.name, index)
        written.set(format.declaration.name, pairs)
      }

      for (const format of document.formats) {
        for (const { id, row } of written.get(format.declaration.name) ?? []) {
          const cells = resolveLinks(format.declaration, row, named)
          if (Object.keys(cells).length > 0) updateRow(db, format.declaration, id, cells)
        }
      }

      // After the rows, so the link pass above cannot release a seed on its way.
      restoreSeeds(db, document.seeds)
      restoreColumnWidths(db, document.widths)
      restoreGraphPlaces(db, document.places)
      restoreViewSettings(db, document.views)
      restoreSavedViews(db, document.saved)
      restoreDocumentCurrency(db, document.currency)
      // What was read in, each row found by the name the text gave it (D-408).
      const refs = new Map<string, ReadonlyMap<string, string>>()
      for (const format of document.formats) {
        const pairs = written.get(format.declaration.name) ?? []
        const named = parsedRowRefs(format.declaration, pairs.map((pair) => pair.row))
        refs.set(
          format.declaration.name,
          new Map(pairs.map((pair, at) => [refKey(named[at]), pair.id])),
        )
      }
      restoreReadings(db, document.readings, document.readerNames, (format, ref) => refs.get(format)?.get(refKey(ref)))
      // **Last, because every write above moved every mark** (M47 U5, D-462):
      // each format back to the day the text says, and one it gives none to
      // unmarked rather than dated by this read.
      restoreChangeMarks(db, marksOf(document.changed))
    })
  } catch (error) {
    if (error instanceof Refused) return err(error.message)
    throw error
  }

  return ok(document)
}

/** A day as the instant its mark is kept in: that day's local midnight, which reads back as that day here. */
function marksOf(changed: ReadonlyMap<string, string>): ReadonlyMap<string, number> {
  const marks = new Map<string, number>()
  for (const [name, day] of changed) {
    const date = parseISODate(day)
    if (date !== undefined) marks.set(name, new Date(date.year, date.month - 1, date.day).getTime())
  }
  return marks
}

function refKey(ref: { readonly name: string; readonly n: number } | undefined): string {
  return ref === undefined ? '' : `${ref.name}\u0000${String(ref.n)}`
}

/** A refusal on its way out of a transaction that has to be rolled back. */
class Refused extends Error {}

/**
 * One id per row, derived from the row.
 *
 * The format's name is in the seed so the same row under two formats is two
 * rows, and the **occurrence** is in it so two rows that are identical in every
 * column still get two ids — the case `writeFormat` already has a tiebreak for,
 * and the only one where content alone would collide. Everything in the seed is
 * something the text carries, which is what makes the id a function of the file
 * rather than of when it was opened.
 */
function identitiesOf(format: ParsedFormat): readonly string[] {
  const seen = new Map<string, number>()
  return format.rows.map((row) => {
    const content = JSON.stringify([
      Object.entries(row.cells).sort(([a], [b]) => (a < b ? -1 : 1)),
      Object.entries(row.links).sort(([a], [b]) => (a < b ? -1 : 1)),
    ])
    const occurrence = seen.get(content) ?? 0
    seen.set(content, occurrence + 1)
    return derivedId(`${format.declaration.name}\u0000${String(occurrence)}\u0000${content}`)
  })
}

/** One row's link columns, as the ids the names resolve to. */
function resolveLinks(
  declaration: FormatDeclaration,
  row: ParsedRow,
  named: ReadonlyMap<string, ReadonlyMap<string, string>>,
): Record<string, StoredValue> {
  const cells: Record<string, StoredValue> = {}

  for (const [column, written] of Object.entries(row.links)) {
    const target = declaration.columns.find((each) => each.name === column)?.target ?? ''
    // A `links` column is several names, each resolved the same way (M27 U2, D-300).
    const ids = (typeof written === 'string' ? [written] : written).map((label) => {
      const id = named.get(target)?.get(label)
      if (id === undefined) {
        throw new Refused(
          `A row of ${declaration.name} has ${column} pointing at "${label}", and ${target} has ` +
            'no row called that.',
        )
      }
      return id
    })
    cells[column] = typeof written === 'string' ? (ids[0] ?? '') : ids
  }
  return cells
}

/**
 * The units the text carries, against the ones migration 034 already seeded.
 *
 * A symbol the document has is *corrected* rather than replaced, because that is
 * the only write `unitRepository` offers for one — and it is the right one: the
 * dimension may not move, which is the reconciler's `UNIT_CHANGED` refusal in
 * another hat (D-214).
 */
function applyUnits(db: Database, document: ParsedDocument, now: number): Result<void, string> {
  const existing = new Map(listUnits(db).map((unit) => [unit.symbol, unit]))

  for (const unit of document.units) {
    const already = existing.get(unit.symbol)
    // **A seeded unit the table has not got belongs to a later schema** (M24 U6,
    // D-257). A text document is rebuilt at the schema its header names, and a
    // header saying 38 is a table with no RATIO in it: `%` is added by the
    // migration that knows the dimension, which runs next, and adding it here
    // would be refused by a CHECK that predates it.
    if (already === undefined && unit.origin === 'SEEDED') continue
    if (already === undefined) {
      const added = addUnit(db, unit, now)
      if ('problem' in added) return err(`${unit.symbol}: ${added.problem}`)
      continue
    }
    if (already.dimension !== unit.dimension) {
      return err(
        `${unit.symbol} is ${unit.dimension} in the text and ${already.dimension} in this ` +
          'document. What a unit measures is not something a read may change.',
      )
    }
    if (already.perBase === unit.perBase && already.note === unit.note) continue
    const corrected = correctUnit(db, unit.symbol, unit.perBase, unit.note)
    if ('problem' in corrected) return err(`${unit.symbol}: ${corrected.problem}`)
  }

  return ok(undefined)
}
