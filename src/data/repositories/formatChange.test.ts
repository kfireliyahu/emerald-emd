/**
 * **When each format last changed** (M47 U5, D-462): one mark per format, moved
 * by every write to its rows and by nothing else, kept by a text document as
 * well as a binary one.
 */

import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'

import { instantDay } from '@/core/instant.ts'
import { parse } from '@/domain/format/artefact.ts'
import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import { CHANGED_PART, readDocument } from '@/domain/format/document.ts'
import { createDatabase, query } from '../db/database.ts'
import { applyParts, serializeDocument } from './formatDocumentRepository.ts'
import { adoptFormat, changeMarks, keepChangeMarks, listFormats, reconcileFormats } from './formatRepository.ts'
import { deleteRows, insertRows, updateRow } from './formatRowRepository.ts'

const NOW = Date.UTC(2026, 8, 20)

/** A long time ago, so a mark the clock moved is plainly not this one. */
const LONG_AGO = new Date(2026, 0, 2).getTime()

const BOOK = `---
format: book
title: Book
language: 23
---

| column | type | points at | unit | per | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| title | text |  |  |  | yes | yes |  |  |  |  |
`

const SHELF = `---
format: shelf
title: Shelf
language: 23
---

| column | type | points at | unit | per | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| name | text |  |  |  | yes | yes |  |  |  |  |
| books | links | book |  |  | no | no |  |  |  |  |
| tags | enums |  |  |  | no | no | old, new |  |  |  |
`

function declared(text: string): FormatDeclaration {
  const parsed = parse(text)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.value
}

async function twoFormats(): Promise<{ db: Database; book: FormatDeclaration; shelf: FormatDeclaration }> {
  const db = await createDatabase()
  const book = declared(BOOK)
  const shelf = declared(SHELF)
  expect(adoptFormat(db, book, NOW).refusals).toEqual([])
  expect(adoptFormat(db, shelf, NOW).refusals).toEqual([])
  return { db, book, shelf }
}

function backdate(db: Database): void {
  db.run('UPDATE format SET updated_at = ?', [LONG_AGO])
}

describe('a format’s mark (M47 U5, D-462)', () => {
  it('is set when the format is declared', async () => {
    const { db } = await twoFormats()
    expect([...changeMarks(db)]).toEqual([
      ['book', NOW],
      ['shelf', NOW],
    ])
  })

  it('moves with a row added, changed or removed — its own format’s, and only its own', async () => {
    const { db, book } = await twoFormats()
    backdate(db)

    const [id] = insertRows(db, book, [{ title: 'Dune' }])
    expect(changeMarks(db).get('book')).toBeGreaterThan(LONG_AGO)
    expect(changeMarks(db).get('shelf')).toBe(LONG_AGO)

    backdate(db)
    updateRow(db, book, id ?? '', { title: 'Dune Messiah' })
    expect(changeMarks(db).get('book')).toBeGreaterThan(LONG_AGO)
    expect(changeMarks(db).get('shelf')).toBe(LONG_AGO)

    backdate(db)
    deleteRows(db, book, [id ?? ''], listFormats(db))
    expect(changeMarks(db).get('book')).toBeGreaterThan(LONG_AGO)
    expect(changeMarks(db).get('shelf')).toBe(LONG_AGO)
  })

  it('moves with a write in raw SQL, as a pack’s repositories make', async () => {
    const { db } = await twoFormats()
    backdate(db)
    db.run("INSERT INTO fmt_book (id, title) VALUES ('b1', 'Emma')")
    expect(changeMarks(db).get('book')).toBeGreaterThan(LONG_AGO)
    expect(changeMarks(db).get('shelf')).toBe(LONG_AGO)
  })

  it('moves the owner’s mark when only a member of a list changes', async () => {
    const { db, book, shelf } = await twoFormats()
    const [dune] = insertRows(db, book, [{ title: 'Dune' }])
    const [top] = insertRows(db, shelf, [{ name: 'Top' }])
    backdate(db)

    updateRow(db, shelf, top ?? '', { books: [dune ?? ''] })
    expect(changeMarks(db).get('shelf')).toBeGreaterThan(LONG_AGO)
    expect(changeMarks(db).get('book')).toBe(LONG_AGO)

    backdate(db)
    db.run(`DELETE FROM "fmt_shelf__books"`)
    expect(changeMarks(db).get('shelf')).toBeGreaterThan(LONG_AGO)
    expect(changeMarks(db).get('book')).toBe(LONG_AGO)
  })

  it('is not moved by opening: reconciling and keeping the triggers write no row', async () => {
    const { db, book } = await twoFormats()
    insertRows(db, book, [{ title: 'Dune' }])
    backdate(db)
    reconcileFormats(db)
    keepChangeMarks(db)
    reconcileFormats(db)
    expect(changeMarks(db).get('book')).toBe(LONG_AGO)
    expect(changeMarks(db).get('shelf')).toBe(LONG_AGO)
  })

  it('comes back after a table is rebuilt, and goes with a table that is gone', async () => {
    const { db, book } = await twoFormats()
    // A document from before there were marks: no triggers at all.
    for (const row of query(db, "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%changed%'")) {
      db.run(`DROP TRIGGER "${String(row['name'])}"`)
    }
    backdate(db)
    insertRows(db, book, [{ title: 'Dune' }])
    expect(changeMarks(db).get('book')).toBe(LONG_AGO)

    keepChangeMarks(db)
    insertRows(db, book, [{ title: 'Emma' }])
    expect(changeMarks(db).get('book')).toBeGreaterThan(LONG_AGO)
    // Three per table: book's own, shelf's, and each of shelf's two lists.
    const triggers = () =>
      query(db, "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%__changed__%'").length
    expect(triggers()).toBe(12)
    keepChangeMarks(db)
    expect(triggers()).toBe(12)
  })
})

describe('a text document’s marks (M47 U5, D-462)', () => {
  it('writes the day each format last changed as its own part, and reads it back', async () => {
    const { db, book } = await twoFormats()
    insertRows(db, book, [{ title: 'Dune' }])
    db.run("UPDATE format SET updated_at = ? WHERE name = 'shelf'", [LONG_AGO])

    const parts = serializeDocument(db)
    if (!parts.ok) throw new Error(parts.error)
    const changed = parts.value.find((part) => part.name === CHANGED_PART)
    expect(changed?.text).toBe(
      ['---', 'emerald: changed', '---', '', `book: ${instantDay(Date.now())}`, 'shelf: 2026-01-02', ''].join('\n'),
    )

    // Read back into a fresh copy — which writes every row, and so moved every
    // mark to the moment of the read — and the days are the text's again.
    const fresh = await createDatabase()
    const applied = applyParts(fresh, parts.value, NOW)
    if (!applied.ok) throw new Error(applied.error)
    expect(instantDay(changeMarks(fresh).get('shelf') ?? 0)).toBe('2026-01-02')
    expect(instantDay(changeMarks(fresh).get('book') ?? 0)).toBe(instantDay(Date.now()))

    // And text → document → text is still byte-identical.
    const again = serializeDocument(fresh)
    if (!again.ok) throw new Error(again.error)
    expect(again.value).toEqual(parts.value)
  })

  it('leaves a format the text gives no mark unmarked, rather than dated by the read', async () => {
    const { db, book } = await twoFormats()
    insertRows(db, book, [{ title: 'Dune' }])
    db.run("UPDATE format SET updated_at = 0 WHERE name = 'book'")

    const parts = serializeDocument(db)
    if (!parts.ok) throw new Error(parts.error)
    const parsed = readDocument(parts.value)
    if (!parsed.ok) throw new Error(parsed.error)
    expect([...parsed.value.changed.keys()]).toEqual(['shelf'])

    const fresh = await createDatabase()
    const applied = applyParts(fresh, parts.value, NOW)
    if (!applied.ok) throw new Error(applied.error)
    expect(changeMarks(fresh).has('book')).toBe(false)
    expect(changeMarks(fresh).has('shelf')).toBe(true)
  })

  it('writes no part when no format carries a mark, so an older text reads back unchanged', async () => {
    const { db } = await twoFormats()
    db.run('UPDATE format SET updated_at = 0')
    const parts = serializeDocument(db)
    if (!parts.ok) throw new Error(parts.error)
    expect(parts.value.some((part) => part.name === CHANGED_PART)).toBe(false)
  })
})
