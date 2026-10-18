/**
 * **A folder of Markdown notes is a table** — M34 U7.
 *
 * The done-test, against `fixtures/synthetic/notes/`: a folder of ingredient
 * notes and a folder of recipe notes read in one call onto two formats, with
 * their links filled — Pancakes linking by `[[name]]` (one of them to a note
 * whose title is not its file name), Shortbread by `[text](file.md)` — and
 * Treacle tart, whose frontmatter names an ingredient no note is, refused and
 * named by its file. The mapping is the guess: nothing is sent but the folders.
 */

import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createDatabase, exportDatabase, openDatabase } from '@/data/db/database.ts'
import { adoptFormat } from '@/data/repositories/formatRepository.ts'
import { countRows, listRows } from '@/data/repositories/formatRowRepository.ts'
import { column, type FormatDeclaration } from '@/domain/format/declaration.ts'

import { readOntoFormatTool } from './intake.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

const NOW = Date.UTC(2026, 9, 6)

const NOTES = (name: string): string =>
  fileURLToPath(new URL(`../../../fixtures/synthetic/notes/${name}`, import.meta.url))

const INGREDIENT: FormatDeclaration = {
  language: 5,
  name: 'ingredient',
  title: 'Ingredient',
  notes: '',
  columns: [
    column('name', 'text', { required: true, unique: true }),
    column('kcal_per_100g', 'real'),
    column('tags', 'enums', { values: ['baking', 'staple', 'dairy'] }),
  ],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

const RECIPE: FormatDeclaration = {
  language: 5,
  name: 'recipe',
  title: 'Recipe',
  notes: '',
  columns: [
    column('name', 'text', { required: true, unique: true }),
    column('main', 'link', { target: 'ingredient' }),
    column('ingredients', 'links', { target: 'ingredient' }),
    column('serves', 'integer'),
  ],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

async function kitchen(): Promise<string> {
  const db = await createDatabase()
  for (const declaration of [INGREDIENT, RECIPE]) {
    expect(adoptFormat(db, declaration, NOW).refusals).toEqual([])
  }
  const path = join(await tempDir('emerald-notes-'), 'kitchen.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  return path
}

/** Recipes first, so the order the links need is the tool's to find. */
const FILES = [
  { file: NOTES('recipes'), format: 'recipe' },
  { file: NOTES('ingredients'), format: 'ingredient' },
]

describe('read_onto_format with a folder of notes (M34 U7)', () => {
  it('plans both folders from the guess alone, and names the note that links to nothing', async () => {
    const path = await kitchen()
    const dry = await readOntoFormatTool.run({ path, files: FILES }, NO_CLIENT)

    expect(dry).toContain('2 files, read in the order their links need')
    expect(dry).toMatch(/\| ingredients\/ \| Ingredient \| 4 \| 0 \|/)
    expect(dry).toMatch(/\| recipes\/ \| Recipe \| 2 \| 1 \|/)
    // Every file in the folder accounted for: four notes, and the one that is not a note.
    expect(dry).toContain('**ingredients/** — 4 notes, one row each; 1 other file not read (shopping.txt)')
    // Refused by the note's own file name, with the name it gave.
    expect(dry).toContain('1 note would not be read')
    expect(dry).toMatch(/\| Treacle tart\.md \| [^|]*Treacle/)
    expect(dry).toContain('**Nothing has been written.**')

    const db = await openDatabase(readFileSync(path))
    expect([countRows(db, INGREDIENT), countRows(db, RECIPE)]).toEqual([0, 0])
    db.close()
  })

  it('writes the lot on commit with every link filled, from either form', async () => {
    const path = await kitchen()
    const answer = await readOntoFormatTool.run({ path, files: FILES, commit: true }, NO_CLIENT)
    expect(answer).toContain('**6 rows written from 2 files**')

    const db = await openDatabase(readFileSync(path))
    const ingredients = listRows(db, INGREDIENT, { limit: 10 })
    const named = new Map(ingredients.map((row) => [row.id, row.cells['name']]))
    expect([...named.values()].sort()).toEqual(['Butter', 'Egg', 'Flour', 'Sugar'])
    const flour = ingredients.find((row) => row.cells['name'] === 'Flour')
    expect(flour?.cells['tags']).toEqual(['baking', 'staple'])
    expect(flour?.cells['kcal_per_100g']).toBe(364)

    const recipes = new Map(listRows(db, RECIPE, { limit: 10 }).map((row) => [row.cells['name'], row.cells]))
    expect([...recipes.keys()].sort()).toEqual(['Pancakes', 'Shortbread'])
    const names = (value: unknown): readonly unknown[] =>
      (Array.isArray(value) ? value : [value]).map((id) => named.get(String(id)))
    // [[name]] — and [[free-range-egg|eggs]] to the note titled Egg.
    expect(names(recipes.get('Pancakes')?.['main'])).toEqual(['Flour'])
    expect(names(recipes.get('Pancakes')?.['ingredients'])).toEqual(['Flour', 'Egg', 'Sugar'])
    // [text](file.md), in a scalar and in a list.
    expect(names(recipes.get('Shortbread')?.['main'])).toEqual(['Butter'])
    expect(names(recipes.get('Shortbread')?.['ingredients'])).toEqual(['Flour', 'Butter', 'Sugar'])
    expect(recipes.get('Shortbread')?.['serves']).toBe(12)
    db.close()
  })

  it('reads one note, and refuses a folder with none in it', async () => {
    const path = await kitchen()
    const dry = await readOntoFormatTool.run(
      { path, format: 'ingredient', file: NOTES('ingredients/Butter.md') },
      NO_CLIENT,
    )
    expect(dry).toContain('**Butter.md** — 1 note, one row each')
    expect(dry).toContain('name: Butter')

    const empty = await tempDir('emerald-no-notes-')
    await writeFile(join(empty, 'list.txt'), 'nothing', 'utf8')
    await expect(readOntoFormatTool.run({ path, format: 'ingredient', file: empty }, NO_CLIENT)).rejects.toThrow(
      /holds no \.md note — only list\.txt/,
    )
  })
})

/**
 * M38 U1's done-test: a synthetic folder holding a `._` copy and a README with
 * no extension, two notes headed alike, inline tags and a long note.
 */
describe('read_onto_format over a folder with its small faults (M38 U1)', () => {
  const MEAL: FormatDeclaration = {
    language: 5,
    name: 'meal',
    title: 'Meal',
    notes: '',
    columns: [
      column('name', 'text', { required: true, unique: true }),
      column('tags', 'enums', { values: ['breakfast', 'quick', 'slow'] }),
      column('weight', 'quantity'),
      column('body', 'text'),
    ],
    identities: [],
    aggregates: [],
    nothingMustHold: true,
  }

  const LONG = `# For 1 serving\n\n${'Stir slowly and keep stirring. '.repeat(540)}#slow`

  async function meals(): Promise<{ path: string; folder: string }> {
    const db = await createDatabase()
    expect(adoptFormat(db, MEAL, NOW).refusals).toEqual([])
    const dir = await tempDir('emerald-meals-')
    const path = join(dir, 'meals.emd')
    await writeFile(path, exportDatabase(db))
    db.close()
    const folder = join(dir, 'meals')
    await mkdir(folder)
    await writeFile(join(folder, 'Porridge.md'), '# For 1 serving\n\nOats and milk. #breakfast\n', 'utf8')
    await writeFile(join(folder, 'Overnight oats.md'), '# For 1 serving\n\nOats in yoghurt. #breakfast #quick\n', 'utf8')
    await writeFile(join(folder, 'Risotto.md'), LONG, 'utf8')
    // The copy a disk leaves beside a file it touched: binary, and named like a note.
    await writeFile(join(folder, '._Porridge.md'), Buffer.from([0, 5, 22, 7, 0, 2, 0, 0, 77, 97, 99]))
    await writeFile(join(folder, 'README'), 'What this folder is.', 'utf8')
    return { path, folder }
  }

  it('reads three notes by their file names, the tags into the list, and cuts the long one short', async () => {
    const { path, folder } = await meals()
    const dry = await readOntoFormatTool.run({ path, format: 'meal', file: folder }, NO_CLIENT)

    expect(dry).toContain('**meals/** — 3 notes, one row each; 2 other files not read (._Porridge.md, README)')
    expect(dry).not.toContain('would not be read')
    expect(dry).toMatch(/\| inline tags \| tags, split by ";" \|/)
    // A dry run shows the start of a long text and says it stopped.
    expect(dry).toContain('characters, cut short here')
    expect(dry.length).toBeLessThan(LONG.length / 2)

    await readOntoFormatTool.run({ path, format: 'meal', file: folder, commit: true }, NO_CLIENT)
    const db = await openDatabase(readFileSync(path))
    const rows = new Map(listRows(db, MEAL, { limit: 10 }).map((row) => [row.cells['name'], row.cells]))
    expect([...rows.keys()].sort()).toEqual(['Overnight oats', 'Porridge', 'Risotto'])
    expect(rows.get('Overnight oats')?.['tags']).toEqual(['breakfast', 'quick'])
    expect(rows.get('Risotto')?.['tags']).toEqual(['slow'])
    // The body is kept whole, heading and all.
    expect(rows.get('Porridge')?.['body']).toBe('# For 1 serving\n\nOats and milk. #breakfast')
    expect(rows.get('Risotto')?.['body']).toBe(LONG)
    db.close()
  })

  it('maps a guessed column to nothing with null, and keeps the rest of the mapping', async () => {
    const { path, folder } = await meals()
    // title, file, inline tags, body — the body is column 3.
    const dry = await readOntoFormatTool.run({ path, format: 'meal', file: folder, columns: { 3: null } }, NO_CLIENT)
    expect(dry).toMatch(/\| 3 \| body \| \(ignored\) \|/)
    expect(dry).toMatch(/\| 0 \| title \| name \|/)
    expect(dry).toMatch(/\| 2 \| inline tags \| tags, split by ";" \|/)
    expect(dry).toContain('one you sent as null reads nothing')
    await expect(
      readOntoFormatTool.run({ path, format: 'meal', file: folder, columns: { 3: 'nothing_here' } }, NO_CLIENT),
    ).rejects.toThrow(/or null to read nothing from it/)
  })

  it('refuses a quantity in a unit the document does not know, naming the ones it does', async () => {
    const { path } = await meals()
    const csv = join(await tempDir('emerald-units-'), 'weights.csv')
    await writeFile(csv, 'name,weight,weight unit\nB12,2.4,ug\nOats,40,g\n', 'utf8')
    const dry = await readOntoFormatTool.run({ path, format: 'meal', file: csv }, NO_CLIENT)
    expect(dry).toContain('1 row would not be read')
    expect(dry).toMatch(/weight is in ug, which is not a unit this document knows\. It knows [^|]*µg/)
  })
})

/**
 * M38 U2's done-test: a synthetic folder of dishes whose notes link only in
 * their bodies — `[[name]]`, `[text](file.md)`, an embedded `![[note#section]]`
 * — read beside the ingredient notes, fills the dish's one `links` column from
 * the guess; the link that resolves nowhere is named and its note still read.
 */
describe('read_onto_format with links in a note’s body (M38 U2)', () => {
  const DISH: FormatDeclaration = {
    language: 5,
    name: 'dish',
    title: 'Dish',
    notes: '',
    columns: [
      column('name', 'text', { required: true, unique: true }),
      column('uses', 'links', { target: 'ingredient' }),
      column('body', 'text'),
    ],
    identities: [],
    aggregates: [],
    nothingMustHold: true,
  }

  async function dishes(): Promise<{ path: string; folder: string }> {
    const db = await createDatabase()
    for (const declaration of [INGREDIENT, DISH]) expect(adoptFormat(db, declaration, NOW).refusals).toEqual([])
    const dir = await tempDir('emerald-dishes-')
    const path = join(dir, 'dishes.emd')
    await writeFile(path, exportDatabase(db))
    db.close()
    const folder = join(dir, 'dishes')
    await mkdir(folder)
    await writeFile(
      join(folder, 'Crumble.md'),
      'Rub [[Flour]] into [the butter](../ingredients/Butter.md), then ![[Sugar#Caster]] on top.\n' +
        'Some say [[Unicorn dust]]; see [the history](https://example.com/crumble.md).\n',
      'utf8',
    )
    await writeFile(join(folder, 'Omelette.md'), 'Beat [[free-range-egg|two eggs]]. `[[Not a link]]`\n', 'utf8')
    await writeFile(join(folder, 'Toast.md'), 'Bread, toasted.\n', 'utf8')
    return { path, folder }
  }

  const BOTH = (folder: string): readonly { file: string; format: string }[] => [
    { file: folder, format: 'dish' },
    { file: NOTES('ingredients'), format: 'ingredient' },
  ]

  it('guesses the body links onto the links column, names the one that resolves nowhere, and reads every note', async () => {
    const { path, folder } = await dishes()
    const dry = await readOntoFormatTool.run({ path, files: BOTH(folder) }, NO_CLIENT)

    expect(dry).toMatch(/\| body links \| uses, split by ";" \|/)
    expect(dry).toMatch(/\| dishes\/ \| Dish \| 3 \| 0 \|/)
    expect(dry).not.toContain('would not be read')
    expect(dry).toContain('1 body link names no row, and is left out')
    expect(dry).toMatch(/\| Crumble\.md \| Unicorn dust \| No ingredient is called Unicorn dust/)

    const answer = await readOntoFormatTool.run({ path, files: BOTH(folder), commit: true }, NO_CLIENT)
    expect(answer).toContain('**7 rows written from 2 files**')
    expect(answer).toContain('1 body link names no row, and is left out')

    const db = await openDatabase(readFileSync(path))
    const named = new Map(listRows(db, INGREDIENT, { limit: 10 }).map((row) => [row.id, row.cells['name']]))
    const dishRows = new Map(listRows(db, DISH, { limit: 10 }).map((row) => [row.cells['name'], row.cells]))
    const names = (value: unknown): readonly unknown[] =>
      (Array.isArray(value) ? value : []).map((id) => named.get(String(id)))
    expect(names(dishRows.get('Crumble')?.['uses'])).toEqual(['Flour', 'Butter', 'Sugar'])
    expect(names(dishRows.get('Omelette')?.['uses'])).toEqual(['Egg'])
    expect(names(dishRows.get('Toast')?.['uses'])).toEqual([])
    // The body is still the body, links and all.
    expect(dishRows.get('Crumble')?.['body']).toContain('![[Sugar#Caster]]')
    db.close()
  })

  it('reads a folder alone onto rows the document already holds, by their names', async () => {
    const { path, folder } = await dishes()
    await readOntoFormatTool.run({ path, format: 'ingredient', file: NOTES('ingredients'), commit: true }, NO_CLIENT)
    const dry = await readOntoFormatTool.run({ path, format: 'dish', file: folder }, NO_CLIENT)
    expect(dry).toMatch(/\| body links \| uses, split by ";" \|/)
    expect(dry).toMatch(/\| Crumble\.md \| Unicorn dust \|/)
    expect(dry).not.toContain('would not be read')
  })
})
