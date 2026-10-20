/**
 * **The entry's list is `format_rows`** — M37 U2b (D-475 2B; parity, D-227).
 *
 * On a synthetic document of two formats and hundreds of entries, the rows the
 * list beside an entry holds are the rows `format_rows` answers for the same
 * `match`, `search` and order, one for one and in the same order — so what a
 * person pages through is what a conversation is told is there.
 */

import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDatabase, exportDatabase, openDatabase } from '@/data/db/database.ts'
import type { RowFilter } from '@/data/repositories/formatFilterRepository.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import { labelColumn } from '@/domain/format/declaration.ts'
import { declareFormatTool, formatRowsTool, recordFormatRowsTool } from '@/plugin/tools/formats.ts'
import { NO_CLIENT } from '@/plugin/tools/tool.ts'
import { tempDir } from '@/testing/tempDir'

import { addressFilter, addressView } from './addressFilter.ts'
import { entryList, heldIds, listColumns, listQuery } from './entryList.ts'

const DAY = '2026-10-14'
const STATES = ['to_read', 'reading', 'read', 'dropped'] as const
const SHAPE = { places: new Map(), chosen: new Map(), headers: new Set<string>(), long: new Set<string>() }

async function library(): Promise<string> {
  const db = await createDatabase()
  const path = join(await tempDir('emerald-list-'), 'library.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  const declared = await declareFormatTool.run(
    {
      path,
      formats: [
        { format: 'author', title: 'Author', columns: [{ name: 'name', type: 'text', required: true, unique: true }], nothing_must_hold: true },
        {
          format: 'book',
          title: 'Book',
          columns: [
            { name: 'title', type: 'text', required: true },
            { name: 'state', type: 'enum', values: [...STATES] },
            { name: 'author', type: 'link', target: 'author' },
            { name: 'finished', type: 'date' },
            { name: 'pages', type: 'integer' },
          ],
          nothing_must_hold: true,
        },
      ],
      commit: true,
    },
    NO_CLIENT,
  )
  expect(declared).not.toContain('refused')
  const authors = Array.from({ length: 30 }, (_, at) => ({ name: `Author ${String(at).padStart(2, '0')}` }))
  await recordFormatRowsTool.run({ path, format: 'author', rows: authors, commit: true }, NO_CLIENT)
  const opened = await openDatabase(readFileSync(path))
  const author = listFormats(opened).find((each) => each.name === 'author')
  if (author === undefined) throw new Error('author is declared')
  const ids = heldIds(opened, author, {})
  opened.close()
  // Three hundred and fifty books, titles out of order so the order is the list's doing.
  const books = Array.from({ length: 350 }, (_, at) => ({
    title: `Book ${String((at * 37) % 350).padStart(3, '0')}`,
    state: STATES[at % STATES.length],
    author: ids[at % ids.length],
    ...(at % 3 === 0 ? { finished: `2026-0${String((at % 9) + 1)}-1${String(at % 10)}` } : {}),
    pages: 100 + at,
  }))
  // The tool takes two hundred at a time.
  for (const batch of [books.slice(0, 175), books.slice(175)]) {
    const written = await recordFormatRowsTool.run({ path, format: 'book', rows: batch, commit: true }, NO_CLIENT)
    expect(written).not.toContain('refused')
  }
  return path
}

/** Every id `format_rows` answers, page by page — the tool's own `offset`. */
async function toolIds(
  path: string,
  filter: RowFilter,
  order: { readonly order?: string; readonly descending?: boolean } = {},
): Promise<readonly string[]> {
  const found: string[] = []
  for (let offset = 0; ; offset += 200) {
    const answer = await formatRowsTool.run(
      { path, format: 'book', columns: ['title'], limit: 200, offset, ...filter, ...order },
      NO_CLIENT,
    )
    const ids = answer.match(/^\| [0-9a-f-]{36} \|/gm)?.map((line) => line.slice(2, 38)) ?? []
    found.push(...ids)
    if (ids.length < 200) return found
  }
}

describe('the list beside an entry (M37 U2b)', () => {
  it('holds the rows format_rows answers for the same match, search and order', async () => {
    const path = await library()
    const db = await openDatabase(readFileSync(path))
    const declarations = listFormats(db)
    const book = declarations.find((each) => each.name === 'book')
    if (book === undefined) throw new Error('book is declared')
    const order = { column: labelColumn(book)?.name ?? 'title', descending: false }

    for (const address of [
      '',
      '?search=Book 1',
      '?state=reading',
      '?state=read&search=7',
      '?search=Author 03',
      // Several, turned round, and empty (M37 U3, D-476).
      '?state=reading,read',
      '?state!=reading',
      '?finished=',
      '?finished!=&state!=read,to_read',
    ]) {
      const filter = addressFilter(address)
      const listed = entryList(db, book, declarations, listQuery(db, book, declarations, filter, order, DAY), SHAPE)
      const told = await toolIds(path, filter)
      expect(listed.map((row) => row.id), address).toEqual(told)
      expect(listed.length, address).toBeGreaterThan(0)
    }
    // Hundreds, not a page of them: the list is uncapped where the Table stops at 200.
    expect(entryList(db, book, declarations, listQuery(db, book, declarations, {}, order, DAY), SHAPE)).toHaveLength(350)
    db.close()
  })

  /**
   * **The pager walks the table's sort** (M42 F14): the sort rides in the
   * address beside the filter, so the entry page, drawn afresh on its own
   * route, reads the order the table was in — and pages through what
   * `format_rows` answers for the same `order` and `descending`.
   */
  it('holds the rows in the order the address carries, as format_rows answers them', async () => {
    const path = await library()
    const db = await openDatabase(readFileSync(path))
    const declarations = listFormats(db)
    const book = declarations.find((each) => each.name === 'book')
    if (book === undefined) throw new Error('book is declared')

    for (const [address, told] of [
      ['?order:pages=descending', { order: 'pages', descending: true }],
      ['?state=read&order:finished=ascending', { order: 'finished', descending: false }],
      ['?search=Book 1&order:state=descending', { order: 'state', descending: true }],
    ] as const) {
      const { filter, order } = addressView(address)
      expect(order, address).toEqual({ column: told.order, descending: told.descending })
      const listed = entryList(db, book, declarations, listQuery(db, book, declarations, filter, order, DAY), SHAPE)
      expect(listed.map((row) => row.id), address).toEqual(await toolIds(path, filter, told))
    }
    // Most pages first: not the name's order the screen falls back to.
    const [most] = entryList(db, book, declarations, listQuery(db, book, declarations, {}, { column: 'pages', descending: true }, DAY), SHAPE)
    const [named] = entryList(db, book, declarations, listQuery(db, book, declarations, {}, { column: 'title', descending: false }, DAY), SHAPE)
    expect(most?.id).not.toBe(named?.id)
    db.close()
  })

  it('says a row as the entry heads it: its title over the first two columns of its header line', async () => {
    const path = await library()
    const db = await openDatabase(readFileSync(path))
    const declarations = listFormats(db)
    const book = declarations.find((each) => each.name === 'book')
    if (book === undefined) throw new Error('book is declared')
    const { title, line } = listColumns(book, SHAPE)
    expect(title?.name).toBe('title')
    expect(line.map((column) => column.name)).toEqual(['state', 'author'])

    const [first] = entryList(db, book, declarations, listQuery(db, book, declarations, {}, { column: 'title', descending: false }, DAY), SHAPE)
    expect(first?.title).toBe('Book 000')
    // An enum is its member, drawn as a dot; a link is the name of the row it names.
    expect(first?.line[0]).toEqual({ column: 'state', text: 'to read', member: 'to_read' })
    expect(first?.line[1]?.text).toMatch(/^Author \d\d$/)
    db.close()
  })
})
