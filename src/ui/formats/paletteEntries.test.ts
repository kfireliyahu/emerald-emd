import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDatabase, exportDatabase, openDatabase } from '@/data/db/database.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import { declareFormatTool, recordFormatRowsTool } from '@/plugin/tools/formats.ts'
import { searchDocumentTool } from '@/plugin/tools/searchDocument.ts'
import { NO_CLIENT } from '@/plugin/tools/tool.ts'
import { tempDir } from '@/testing/tempDir'
import { addressFilter } from '@/ui/formats/addressFilter.ts'
import { entryAt } from '@/ui/RailFolder.tsx'

import {
  ENTRIES_PER_FORMAT,
  entryAddress,
  moreAddress,
  paletteEntries,
  snippetOf,
  type PaletteEntryGroup,
} from './paletteEntries.ts'

/**
 * **The palette finds entries, as `search_document` does** — M37 U2c (D-475 3B,
 * D-227). A made-up notebook of three formats and several hundred entries: a
 * shelf of books, a box of recipes, a list of places — a few named so that the
 * ranking has something to decide, one in Hebrew.
 */

const BOOK = {
  format: 'book',
  title: 'Book',
  columns: [
    { name: 'name', type: 'text', required: true },
    { name: 'author', type: 'text' },
    { name: 'shelf_note', type: 'text' },
  ],
  nothing_must_hold: true,
}
const RECIPE = {
  format: 'recipe',
  title: 'Recipe',
  columns: [
    { name: 'name', type: 'text', required: true },
    { name: 'method', type: 'text' },
  ],
  nothing_must_hold: true,
}
const PLACE = {
  format: 'place',
  title: 'Place',
  columns: [
    { name: 'name', type: 'text', required: true },
    { name: 'street', type: 'text' },
  ],
  nothing_must_hold: true,
}

const WORDS = ['Amber', 'Birch', 'Cedar', 'Delta', 'Ember', 'Fable', 'Grove', 'Harbor', 'Iris', 'Juniper']
const BOOKS = [
  ...Array.from({ length: 240 }, (_, index) => ({
    name: `${WORDS[(index * 7) % WORDS.length] ?? ''} ${String(1000 - index)}`,
    author: index % 30 === 0 ? 'Dana Sample' : 'Someone Else',
    shelf_note: index === 17 ? 'Lent to the neighbour with the quince tree' : 'On the shelf',
  })),
  // A name that holds "quince" without starting a word with it, and one where a word does.
  { name: 'Marmalade of Aquinceland', author: 'Someone Else' },
  { name: 'The Quince Year', author: 'Someone Else' },
]
const RECIPES = [
  ...Array.from({ length: 180 }, (_, index) => ({
    name: `${WORDS[index % WORDS.length] ?? ''} stew ${String(index)}`,
    method: index % 20 === 0 ? 'Simmer with a little saffron' : 'Bake slowly',
  })),
  { name: 'Quince paste', method: 'Cook the quince down for hours' },
  { name: 'שקשוקה 2', method: 'Eggs in a pan of tomato and saffron' },
]
const PLACES = Array.from({ length: 90 }, (_, index) => ({
  name: `Corner ${String(index)}`,
  street: index % 45 === 0 ? 'Saffron Row' : 'High Street',
}))

async function notebook(): Promise<string> {
  const db = await createDatabase()
  const path = join(await tempDir('emerald-palette-'), 'notebook.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  const declared = await declareFormatTool.run({ path, formats: [BOOK, RECIPE, PLACE], commit: true }, NO_CLIENT)
  expect(declared).not.toMatch(/refus/i)
  for (const [format, rows] of [['book', BOOKS], ['recipe', RECIPES], ['place', PLACES]] as const) {
    for (let start = 0; start < rows.length; start += 150) {
      const said = await recordFormatRowsTool.run(
        { path, format, rows: rows.slice(start, start + 150), commit: true },
        NO_CLIENT,
      )
      expect(said).toMatch(/added/i)
    }
  }
  return path
}

async function opened(path: string) {
  const db = await openDatabase(readFileSync(path))
  return { db, declarations: listFormats(db) }
}

const ids = (groups: readonly PaletteEntryGroup[]): string[] =>
  groups.flatMap((group) => group.entries.map((entry) => `${group.format.name}:${entry.id}`)).sort()

describe('the palette’s entries (M37 U2c)', () => {
  it('are search_document’s rows for the same text — no second search', async () => {
    const path = await notebook()
    const { db, declarations } = await opened(path)
    for (const text of ['quince', 'saffron', 'Dana', 'שקשוקה', 'stew 1']) {
      const groups = paletteEntries(db, text, declarations)
      const answer = await searchDocumentTool.run({ path, terms: [text] }, NO_CLIENT)
      const held = groups.reduce((sum, group) => sum + group.entries.length, 0)
      expect(held).toBeGreaterThan(0)
      // The count the conversation is told is the count the palette holds…
      const told = /: (\d+) rows? in (\d+) formats?/.exec(answer)
      expect(told?.[1]).toBe(String(held))
      expect(told?.[2]).toBe(String(groups.length))
      // …and every row it lists is one the palette lists, by id.
      const answered = [...answer.matchAll(/^\| ([0-9a-f-]{36}) \|/gm)].map((match) => match[1])
      expect(new Set(answered)).toEqual(new Set(groups.flatMap((group) => group.entries.map((entry) => entry.id))))
    }
    db.close()
  })

  it('reaches an entry by its name — a name that starts with it, a word that does, one that holds it', async () => {
    const path = await notebook()
    const { db, declarations } = await opened(path)
    const groups = paletteEntries(db, 'quince', declarations)

    // The recipe whose name starts with it leads, so its format comes first.
    expect(groups.map((group) => group.format.name)).toEqual(['recipe', 'book'])
    const recipe = groups[0]?.entries ?? []
    expect(recipe[0]).toMatchObject({ name: 'Quince paste', rank: 0 })
    const book = groups[1]?.entries ?? []
    expect(book.map((entry) => [entry.name, entry.rank])).toEqual([
      ['The Quince Year', 1],
      ['Marmalade of Aquinceland', 2],
      [expect.stringMatching(/^\w+ \d+$/), 3],
    ])
    // Found by its name, it names no column.
    expect(book[0]?.column).toBeUndefined()

    const target = book[0]
    if (target === undefined || groups[1] === undefined) throw new Error('no book')
    // It lands on the one entry view, with no search for the list to keep.
    const address = entryAddress(groups[1].format, target.id)
    expect(entryAt('book', address)).toBe(target.id)
    expect(address).not.toContain('?')
    db.close()
  })

  it('reaches an entry by text in another column, the column named', async () => {
    const path = await notebook()
    const { db, declarations } = await opened(path)
    const book = paletteEntries(db, 'neighbour', declarations)
    expect(book).toHaveLength(1)
    const found = book[0]?.entries[0]
    expect(found).toMatchObject({ rank: 3, column: 'shelf_note', text: 'Lent to the neighbour with the quince tree' })
    expect(found?.name).toBe(BOOKS[17]?.name)

    // Hebrew is found as typed, by its name.
    const hebrew = paletteEntries(db, 'שקשוקה', declarations)
    expect(hebrew[0]?.entries[0]).toMatchObject({ name: 'שקשוקה 2', rank: 0 })
    db.close()
  })

  it('counts past four a format, and n more opens the format’s list holding the search', async () => {
    const path = await notebook()
    const { db, declarations } = await opened(path)
    const groups = paletteEntries(db, 'saffron', declarations)
    // Ten recipes (nine by their method, one more by its own), two places.
    const recipe = groups.find((group) => group.format.name === 'recipe')
    if (recipe === undefined) throw new Error('no recipe')
    expect(recipe.entries.length).toBeGreaterThan(ENTRIES_PER_FORMAT)
    expect(recipe.entries.every((entry) => entry.column === 'method')).toBe(true)
    expect(groups.find((group) => group.format.name === 'place')?.entries).toHaveLength(2)

    const address = moreAddress(db, recipe.format, declarations, ' saffron ', recipe.entries[0]?.id)
    const [route, query] = address.split('?')
    expect(addressFilter(query ?? '')).toEqual({ search: 'saffron' })
    const landed = entryAt('recipe', route ?? '')
    // On an entry the search holds: one of the palette's own.
    expect(recipe.entries.map((entry) => entry.id)).toContain(landed)
    db.close()
  })

  it('finds nothing at all under two characters, and orders by name within a rank', async () => {
    const path = await notebook()
    const { db, declarations } = await opened(path)
    expect(paletteEntries(db, '', declarations)).toEqual([])
    expect(paletteEntries(db, ' a ', declarations)).toEqual([])
    expect(ids(paletteEntries(db, 'ju', declarations)).length).toBeGreaterThan(0)

    const stew = paletteEntries(db, 'juniper', declarations)
    for (const group of stew) {
      const names = group.entries.filter((entry) => entry.rank === 0).map((entry) => entry.name)
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
    }
    db.close()
  })
})

describe('the text around a match', () => {
  it('cuts 28 before and 40 after, on one line, and says where it cut', () => {
    const text = `${'x'.repeat(50)} the\nquince ${'y'.repeat(60)}`
    const snippet = snippetOf(text, 'QUINCE')
    expect(snippet?.hit).toBe('quince')
    expect(snippet?.before).toHaveLength(28)
    expect(snippet?.before.endsWith('the ')).toBe(true)
    expect(snippet?.after).toHaveLength(40)
    expect(snippet?.leading && snippet.trailing).toBe(true)
    expect(snippetOf('Quince', 'quince')).toEqual({ before: '', hit: 'Quince', after: '', leading: false, trailing: false })
    expect(snippetOf('nothing here', 'quince')).toBeUndefined()
  })
})
