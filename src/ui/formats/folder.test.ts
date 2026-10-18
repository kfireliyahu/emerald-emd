import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDatabase, exportDatabase, openDatabase } from '@/data/db/database.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import { declareFormatTool, formatRowsTool, recordFormatRowsTool } from '@/plugin/tools/formats.ts'
import { NO_CLIENT } from '@/plugin/tools/tool.ts'
import { tempDir } from '@/testing/tempDir'
import { entryAt } from '@/ui/RailFolder.tsx'
import { folderIsOpen, toggled } from '@/ui/railFolders.ts'

import { FOLDER_SIZE, folderOf } from './folder.ts'

/**
 * **A format's folder in the rail is `format_rows order limit:12 search`** —
 * M37 U2 (D-475, D-227). A made-up shelf of three hundred books, named out of
 * order, a few by an author the filter line looks for in another column.
 */

const BOOK = {
  format: 'book',
  title: 'Book',
  columns: [
    { name: 'name', type: 'text', required: true },
    { name: 'author', type: 'text' },
    { name: 'state', type: 'enum', values: ['unread', 'reading', 'read'] },
  ],
  nothing_must_hold: true,
}

const WORDS = ['Amber', 'Birch', 'Cedar', 'Delta', 'Ember', 'Fable', 'Grove', 'Harbor', 'Iris', 'Juniper']
const BOOKS = Array.from({ length: 300 }, (_, index) => ({
  // Out of order on purpose: the folder sorts by name, never by when a row came in.
  name: `${WORDS[(index * 7) % WORDS.length] ?? ''} ${String(1000 - index)}`,
  author: index % 25 === 0 ? 'Dana Sample' : 'Someone Else',
  state: ['unread', 'reading', 'read'][index % 3],
}))

async function shelf(): Promise<string> {
  const db = await createDatabase()
  const path = join(await tempDir('emerald-folder-'), 'shelf.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  expect(await declareFormatTool.run({ path, formats: [BOOK], commit: true }, NO_CLIENT)).not.toMatch(/refus/i)
  for (const start of [0, 150]) {
    const rows = BOOKS.slice(start, start + 150)
    expect(await recordFormatRowsTool.run({ path, format: 'book', rows, commit: true }, NO_CLIENT)).toMatch(/added/i)
  }
  return path
}

/** The books a text answer names, in the order it names them. */
function named(text: string): readonly string[] {
  return BOOKS.map((book) => book.name)
    .filter((name) => text.includes(`| ${name} |`))
    .sort((a, b) => text.indexOf(`| ${a} |`) - text.indexOf(`| ${b} |`))
}

describe('a format as a folder in the rail', () => {
  it('draws the first twelve in the format’s order, as format_rows reads them', async () => {
    const path = await shelf()
    const db = await openDatabase(readFileSync(path))
    const declarations = listFormats(db)
    const book = declarations.find((each) => each.name === 'book')
    if (book === undefined) throw new Error('no book format')

    const folder = folderOf(db, book, declarations, '')
    expect(folder.total).toBe(300)
    expect(folder.found).toBe(300)
    expect(folder.stated).toBe(true)
    expect(folder.entries).toHaveLength(FOLDER_SIZE)
    const told = await formatRowsTool.run({ path, format: 'book', limit: FOLDER_SIZE, columns: ['name'] }, NO_CLIENT)
    expect(folder.entries.map((entry) => entry.title)).toEqual(named(told))
    expect(folder.entries.map((entry) => entry.title)).toEqual(
      [...BOOKS.map((each) => each.name)].sort().slice(0, FOLDER_SIZE),
    )

    // The filter line is the Table's search, reading every column: an author finds books.
    const held = folderOf(db, book, declarations, 'dana')
    expect(held.found).toBe(12)
    const searched = await formatRowsTool.run(
      { path, format: 'book', search: 'dana', limit: FOLDER_SIZE, columns: ['name'] },
      NO_CLIENT,
    )
    expect(held.entries.map((entry) => entry.title)).toEqual(named(searched))
    expect(folderOf(db, book, declarations, 'nothing holds this').found).toBe(0)
    db.close()
  })

  it('always holds the entry open, after the twelve when it is past them', async () => {
    const path = await shelf()
    const db = await openDatabase(readFileSync(path))
    const declarations = listFormats(db)
    const book = declarations.find((each) => each.name === 'book')
    if (book === undefined) throw new Error('no book format')
    const last = folderOf(db, book, declarations, 'Juniper')
    const far = last.entries.at(-1)
    if (far === undefined) throw new Error('no entry')

    const folder = folderOf(db, book, declarations, '', far.id)
    expect(folder.entries).toHaveLength(FOLDER_SIZE + 1)
    expect(folder.entries.at(-1)?.id).toBe(far.id)
    // One already among the twelve is not drawn twice.
    const first = folder.entries[0]?.id
    expect(folderOf(db, book, declarations, '', first).entries).toHaveLength(FOLDER_SIZE)
    db.close()
  })
})

describe('which folders are open', () => {
  it('opens the one you are in by itself, and lets the arrow shut it', () => {
    const none = new Set<string>()
    expect(folderIsOpen(none, 'book', false)).toBe(false)
    expect(folderIsOpen(none, 'book', true)).toBe(true)

    const shut = toggled(none, 'book', true)
    expect(folderIsOpen(shut, 'book', true)).toBe(false)
    const reopened = toggled(shut, 'book', true)
    expect(folderIsOpen(reopened, 'book', true)).toBe(true)
    expect(folderIsOpen(reopened, 'book', false)).toBe(true)

    // Several at once.
    const both = toggled(toggled(none, 'book', false), 'recipe', false)
    expect(folderIsOpen(both, 'book', false) && folderIsOpen(both, 'recipe', false)).toBe(true)
  })

  it('reads the entry a path is on, and no entry for a new one or the table', () => {
    expect(entryAt('book', '/formats/book/entry/abc')).toBe('abc')
    expect(entryAt('book', '/formats/book/entry/new')).toBeUndefined()
    expect(entryAt('book', '/formats/book')).toBeUndefined()
    expect(entryAt('book', '/formats/bookshelf/entry/abc')).toBeUndefined()
  })
})
