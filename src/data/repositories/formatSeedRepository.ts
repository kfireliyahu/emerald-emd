/**
 * **A pack's seeded rows** — M24 U12, D-264.
 *
 * A pack is more than declarations. The ledger ships a category tree, its
 * deduction types, the institutions and its built-in rules, and M25 moves all of
 * them onto declared tables. Units already answered the question underneath
 * (origin `SEEDED` or `USER`, D-223): a later build may correct its own rows,
 * and never a row a person made or changed.
 *
 * ## What a seed is
 *
 * **A row of the pack's `.format.md`, under its `## rows`** — the file a text
 * document already is (D-244), read by `readFormat`. No second syntax: a pack's
 * format and a document's format are the same text, and the only difference is
 * who wrote the rows. Links are by name, as the text writes them (D-241), and
 * resolve as a conversation's do (D-256).
 *
 * ## Where the origin lives
 *
 * **In `format_seed`, beside the table and never in it.** A declared table
 * holds what the document says (D-209); a column saying *the pack put this
 * here* would be the engine's own bookkeeping in a table somebody declared, and
 * would show up in every read, every text and every tool.
 *
 * **Keyed by the row's name, so a seeded format's naming column must be
 * unique** (D-255). The id cannot key it: a text document mints ids from content
 * (D-247), so an id moves when a row changes and every time the text is read.
 * The name is what the pack's file calls the row, and unique is what makes it
 * one row.
 *
 * ## The four cases, and the one rule behind them
 *
 * A row is the pack's while its record says `SEEDED`, and nothing else is.
 *
 * - **No record, no row** — added, and recorded `SEEDED`.
 * - **`SEEDED`** — corrected to what this build ships, in the cells the seed
 *   carries. A column a person added to the pack's format is left alone.
 * - **No record, a row by that name** — the person's. They made it, or made it
 *   theirs by editing it (`formatRowRepository` deletes the record on an edit),
 *   and a seed never overwrites either.
 * - **`REMOVED`** — a person took it away (`deleteRows` records that), and a
 *   reseed does not bring it back.
 *
 * A `SEEDED` record whose seed a later build no longer ships is **released**:
 * the record goes and the row stays, the person's now. Removing it would be the
 * silent loss D-263 refuses, one build later.
 *
 * ## Who calls it
 *
 * **Opening a document, once a pack has rows to seed** — M25's. Nobody chooses
 * to seed, which is why `parity.test.ts` holds it beside `reconcileFormats`
 * rather than asking for a screen and a tool.
 */

import type { Database } from 'sql.js'

import { newId } from '@/core/id.ts'
import { err, ok, type Result } from '@/core/result.ts'
import { labelColumn } from '@/domain/format/declaration.ts'
import type { ParsedFormat, SeedRecord, SeedState } from '@/domain/format/document.ts'
import type { StoredRow, StoredValue } from '@/domain/format/row.ts'
import { inTransaction, query } from '../db/database.ts'
import { danglingLinks, linksByName, type FormatIndex } from './formatJoinRepository.ts'
import { insertRows, listRows, updateRow } from './formatRowRepository.ts'

/** What a seeding did, by the rows' names — each list in the order the pack has them. */
export interface Seeding {
  readonly added: readonly string[]
  readonly corrected: readonly string[]
  /** A row by the seed's name that a person made or edited. */
  readonly theirs: readonly string[]
  /** A seed a person removed, and which stays removed. */
  readonly removed: readonly string[]
  /** A seed this build no longer ships: the row stays, and is the person's now. */
  readonly released: readonly string[]
}

type Cells = Readonly<Record<string, StoredValue>>

/**
 * Seed one format's rows, idempotently — the second run of the same pack
 * changes nothing and says so.
 *
 * `formats` is the document's own index: the format is seeded as the document
 * declares it, which may be the pack's plus a column somebody added. Whole or
 * not at all — a seed that will not write refuses the format, and a link to a
 * name nothing answers is that refusal, in `danglingLinks`'s words.
 */
export function seedRows(
  db: Database,
  seed: ParsedFormat,
  formats: FormatIndex,
  /**
   * The id a new seed is written under, where the pack has one to keep — a
   * built-in rule keeps the id transactions already name it by (M25 U2).
   */
  idOf?: (key: string) => string | undefined,
): Result<Seeding, string> {
  const declaration = formats.get(seed.declaration.name)
  if (declaration === undefined) {
    return err(`This document does not declare ${seed.declaration.name}, so it has nothing to seed.`)
  }
  const naming = labelColumn(declaration)
  if (naming?.unique !== true) {
    return err(
      `${declaration.title} is named by ${naming?.name ?? 'no text column'}, which is not ` +
        'unique. A pack seeds rows only into a format whose naming column is, because the name ' +
        'is what tells its row from a person’s.',
    )
  }

  const keys: string[] = []
  for (const row of seed.rows) {
    const key = row.cells[naming.name]
    if (typeof key !== 'string' || key === '') {
      return err(`A seed of ${declaration.title} has no ${naming.name}, which is what names it.`)
    }
    if (keys.includes(key)) return err(`${declaration.title} seeds “${key}” twice.`)
    keys.push(key)
  }

  const records = new Map(
    listSeeds(db)
      .filter((each) => each.format === declaration.name)
      .map((each) => [each.key, each.state]),
  )
  const existing = new Map<string, StoredRow>()
  for (const row of listRows(db, declaration)) {
    const name = row.cells[naming.name]
    if (typeof name === 'string') existing.set(name, row)
  }

  // Every seed gets the id it has or will have, so a seed may link to another
  // of the same format by name — a category tree's parent — in one pass.
  const ids = keys.map((key) => existing.get(key)?.id ?? idOf?.(key) ?? newId())
  const resolved = linksByName(
    db,
    declaration,
    seed.rows.map((row) => ({ ...row.cells, ...row.links })),
    formats,
    ids,
  )
  const pending = new Set(ids)
  for (const [at, cells] of resolved.entries()) {
    const dangling = danglingLinks(db, declaration, cells, formats, pending)
    if (dangling.length > 0) return err(`${keys[at] ?? ''}: ${dangling.join(' ')}`)
  }

  const added: string[] = []
  const corrected: string[] = []
  const theirs: string[] = []
  const removed: string[] = []
  const released: string[] = []

  inTransaction(db, () => {
    const toAdd: { readonly id: string; readonly cells: Cells }[] = []

    keys.forEach((key, at) => {
      const cells = resolved[at] ?? {}
      const state = records.get(key)
      const row = existing.get(key)

      if (state === 'REMOVED') {
        removed.push(key)
      } else if (state === undefined && row !== undefined) {
        theirs.push(key)
      } else if (row === undefined && state === 'SEEDED') {
        // A row the pack's record names and the table has not got went by some
        // road other than `deleteRows`. Treated as removed: bringing back what
        // somebody took away is the one outcome this file exists to prevent.
        record(db, declaration.name, key, 'REMOVED')
        removed.push(key)
      } else if (row === undefined) {
        toAdd.push({ id: ids[at] ?? newId(), cells })
        added.push(key)
      } else if (Object.entries(cells).some(([name, value]) => row.cells[name] !== value)) {
        updateRow(db, declaration, row.id, cells)
        // The edit just released it, as any edit does; this one is the pack's.
        record(db, declaration.name, key, 'SEEDED')
        corrected.push(key)
      }
    })

    insertRows(
      db,
      declaration,
      toAdd.map((each) => each.cells),
      toAdd.map((each) => each.id),
    )
    for (const key of added) record(db, declaration.name, key, 'SEEDED')

    for (const [key, state] of records) {
      if (state !== 'SEEDED' || keys.includes(key)) continue
      db.run('DELETE FROM format_seed WHERE format_name = ? AND seed_key = ?', [
        declaration.name,
        key,
      ])
      released.push(key)
    }
  })

  return ok({ added, corrected, theirs, removed, released })
}

/** Every record, in the order the text writes them. */
export function listSeeds(db: Database): readonly SeedRecord[] {
  return query(
    db,
    'SELECT format_name, seed_key, state FROM format_seed ORDER BY format_name, seed_key',
  ).flatMap((row) => {
    const format = row['format_name']
    const key = row['seed_key']
    const state = row['state']
    if (typeof format !== 'string' || typeof key !== 'string') return []
    if (state !== 'SEEDED' && state !== 'REMOVED') return []
    return [{ format, key, state }]
  })
}

/**
 * The records a text document carries, into the fresh one it is read into —
 * `applyDocument`'s, after the rows, so no edit it makes on the way releases
 * one.
 */
export function restoreSeeds(db: Database, records: readonly SeedRecord[]): void {
  if (records.length === 0) return
  inTransaction(db, () => {
    for (const each of records) record(db, each.format, each.key, each.state)
  })
}

/** Called by `deleteFormat`: the record of whose rows they were goes with the rows. */
export function forgetSeeds(db: Database, format: string): void {
  db.run('DELETE FROM format_seed WHERE format_name = ?', [format])
}

function record(db: Database, format: string, key: string, state: SeedState): void {
  db.run(
    `INSERT INTO format_seed (format_name, seed_key, state) VALUES (?, ?, ?)
       ON CONFLICT (format_name, seed_key) DO UPDATE SET state = excluded.state`,
    [format, key, state],
  )
}
