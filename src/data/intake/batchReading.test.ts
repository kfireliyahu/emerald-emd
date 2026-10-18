import { describe, expect, it } from 'vitest'

import { createDatabase, query, rehearse, setQueryOnly } from '@/data/db/database.ts'
import { indexOf } from '@/data/repositories/formatJoinRepository.ts'
import { adoptFormat, listFormats } from '@/data/repositories/formatRepository.ts'
import { countRows } from '@/data/repositories/formatRowRepository.ts'
import { column, type FormatDeclaration } from '@/domain/format/declaration.ts'
import type { ReadTable, Reading } from '@/domain/format/reading.ts'

import { batchWrites, planBatch, readingOrder, writeBatch, type BatchFile } from './batchReading.ts'

const NOW = Date.UTC(2026, 9, 6)

function format(name: string, columns: FormatDeclaration['columns']): FormatDeclaration {
  return { language: 5, name, title: name, notes: '', columns, identities: [], aggregates: [], nothingMustHold: true }
}

const SHELF = format('shelf', [column('name', 'text', { required: true, unique: true })])
const BOOK = format('book', [
  column('title', 'text', { required: true, unique: true }),
  column('shelf', 'link', { target: 'shelf', required: true }),
])
const NOTE = format('note', [
  column('text', 'text', { required: true }),
  column('book', 'link', { target: 'book', required: true }),
])

function table(lines: readonly (readonly string[])[]): ReadTable {
  return {
    columnCount: lines[0]?.length ?? 0,
    rows: lines.map((cells) => cells.map((text) => ({ kind: 'text' as const, text }))),
  }
}

function file(declaration: FormatDeclaration, lines: readonly (readonly string[])[]): BatchFile {
  const reading: Reading = {
    format: declaration.name,
    headerRow: 0,
    dateOrder: 'dmy',
    columns: (lines[0] ?? []).map((key, index) => ({ index, key })),
    fixed: [],
  }
  return { name: `${declaration.name}.csv`, hash: declaration.name, table: table(lines), declaration, reading }
}

const NOTES = file(NOTE, [['text', 'book'], ['Read twice', 'Dune'], ['Lent out', 'Emma'], ['Missing', 'Ulysses']])
const BOOKS = file(BOOK, [['title', 'shelf'], ['Dune', 'Top'], ['Emma', 'Bottom']])
const SHELVES = file(SHELF, [['name'], ['Top'], ['Bottom']])

async function library() {
  const db = await createDatabase()
  for (const declaration of [SHELF, BOOK, NOTE]) expect(adoptFormat(db, declaration, NOW).refusals).toEqual([])
  return { db, formats: indexOf(listFormats(db)) }
}

describe('a batch of files (M34 U2, D-395)', () => {
  it('reads each file after the files whose formats it links to, and otherwise as given', async () => {
    const { formats } = await library()
    expect(readingOrder([NOTES, BOOKS, SHELVES], formats)).toEqual([2, 1, 0])
    expect(readingOrder([SHELVES, NOTES, BOOKS], formats)).toEqual([0, 2, 1])
    // Two files onto one format keep their order.
    expect(readingOrder([BOOKS, SHELVES, BOOKS], formats)).toEqual([1, 0, 2])
  })

  it('judges every file against the ones before it, and writes nothing', async () => {
    const { db, formats } = await library()
    const plan = planBatch(db, [NOTES, BOOKS, SHELVES], formats, NOW)
    expect(batchWrites(plan)).toBe(true)
    // The note naming a book no file has is refused by its line; the rest read.
    const notes = plan.plans[0]?.read?.rows ?? []
    expect(notes.filter((row) => row.cells !== undefined)).toHaveLength(2)
    expect(notes.find((row) => row.cells === undefined)?.problem).toContain('Ulysses')
    expect([SHELF, BOOK, NOTE].map((each) => countRows(db, each))).toEqual([0, 0, 0])
  })

  it('writes the lot in order, or nothing when one file cannot be written', async () => {
    const { db, formats } = await library()
    const refused = writeBatch(db, [NOTES, file(BOOK, [['title', 'shelf'], ['Dune', 'Top'], ['Dune', 'Top']]), SHELVES], formats, NOW)
    expect(batchWrites(refused)).toBe(false)
    expect(refused.intakes.every((each) => each === undefined)).toBe(true)
    expect([SHELF, BOOK, NOTE].map((each) => countRows(db, each))).toEqual([0, 0, 0])

    const written = writeBatch(db, [NOTES, BOOKS, SHELVES], formats, NOW)
    expect(written.intakes.map((each) => each?.rowCount)).toEqual([2, 2, 2])
    expect([SHELF, BOOK, NOTE].map((each) => countRows(db, each))).toEqual([2, 2, 2])
  })

  it('a rehearsal takes its writes back and leaves a read-only document read-only', async () => {
    const { db } = await library()
    setQueryOnly(db, true)
    const seen = rehearse(db, () => {
      db.run(`INSERT INTO fmt_shelf (id, name) VALUES ('x', 'Middle')`)
      return countRows(db, SHELF)
    })
    expect(seen).toBe(1)
    expect(countRows(db, SHELF)).toBe(0)
    expect(query(db, 'PRAGMA query_only')[0]?.['query_only']).toBe(1)
  })
})
