/**
 * **Many files read in one call** — M34 U2, D-395.
 *
 * The done-test, against `fixtures/synthetic/linked/`: three CSVs — the
 * ingredients, the recipes, and the lines that name one of each — read in one
 * call with every link filled; a line naming a parent that is not there refused
 * and named by file and line; and nothing written before the plan is accepted.
 * The files are given children first on purpose, so the order is the tool's.
 */

import { readFileSync } from 'node:fs'
import { copyFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createDatabase, exportDatabase, openDatabase } from '@/data/db/database.ts'
import { adoptFormat, listFormats } from '@/data/repositories/formatRepository.ts'
import { countRows, listRows } from '@/data/repositories/formatRowRepository.ts'
import { column, type FormatDeclaration } from '@/domain/format/declaration.ts'

import { declareFormatTool } from './formats.ts'
import { readOntoFormatTool } from './intake.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

const NOW = Date.UTC(2026, 9, 6)

const LINKED = (name: string): string =>
  fileURLToPath(new URL(`../../../fixtures/synthetic/linked/${name}`, import.meta.url))

const INGREDIENT: FormatDeclaration = {
  language: 5,
  name: 'ingredient',
  title: 'Ingredient',
  notes: '',
  columns: [
    column('name', 'text', { required: true, unique: true }),
    column('kcal_per_100g', 'real'),
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
  columns: [column('name', 'text', { required: true, unique: true }), column('serves', 'integer')],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

const LINE: FormatDeclaration = {
  language: 5,
  name: 'recipe_line',
  title: 'Recipe line',
  notes: '',
  columns: [
    column('recipe', 'link', { target: 'recipe', required: true }),
    column('ingredient', 'link', { target: 'ingredient', required: true }),
    column('grams', 'real', { unit: 'g' }),
  ],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

async function kitchen(): Promise<{ path: string; directory: string }> {
  const db = await createDatabase()
  for (const declaration of [INGREDIENT, RECIPE, LINE]) {
    expect(adoptFormat(db, declaration, NOW).refusals).toEqual([])
  }
  const directory = await tempDir('emerald-batch-')
  const path = join(directory, 'kitchen.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  return { path, directory }
}

/** The mapping a person confirmed — the same as the guess since a link is guessed by its header (M34 U7). */
const LINE_COLUMNS = { 0: 'recipe', 1: 'ingredient', 2: 'grams' }

/** Children first, so the order the links need is the tool's to find. */
const FILES = [
  { file: LINKED('recipe-lines.csv'), format: 'recipe_line', columns: LINE_COLUMNS },
  { file: LINKED('recipes.csv'), format: 'recipe' },
  { file: LINKED('ingredients.csv'), format: 'ingredient' },
]

function counts(path: string): Promise<readonly number[]> {
  return openDatabase(readFileSync(path)).then((db) => {
    const each = [INGREDIENT, RECIPE, LINE].map((declaration) => countRows(db, declaration))
    db.close()
    return each
  })
}

describe('read_onto_format with several files (M34 U2)', () => {
  it('plans three linked files in the order their links need, and writes nothing', async () => {
    const { path } = await kitchen()
    const dry = await readOntoFormatTool.run({ path, files: FILES }, NO_CLIENT)

    expect(dry).toContain('3 files, read in the order their links need')
    // Parents first, whatever order they were sent in.
    const order = ['recipes.csv', 'ingredients.csv', 'recipe-lines.csv'].map((name) =>
      dry.indexOf(`| ${name} |`),
    )
    expect(order.every((at) => at > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(dry).toContain('**14 rows from 3 files**')
    // A line's link shows the name the file wrote, resolved against a row that
    // does not exist yet — the rehearsal's, rolled back.
    expect(dry).toContain('recipe: Pancakes')
    expect(dry).toContain('**Nothing has been written.**')
    expect(await counts(path)).toEqual([0, 0, 0])
  })

  it('writes the lot on commit with every link filled', async () => {
    const { path } = await kitchen()
    const answer = await readOntoFormatTool.run({ path, files: FILES, commit: true }, NO_CLIENT)
    expect(answer).toContain('**14 rows written from 3 files**')

    const db = await openDatabase(readFileSync(path))
    const recipes = new Map(listRows(db, RECIPE, { limit: 10 }).map((row) => [row.id, row.cells['name']]))
    const ingredients = new Map(
      listRows(db, INGREDIENT, { limit: 10 }).map((row) => [row.id, row.cells['name']]),
    )
    const lines = listRows(db, LINE, { limit: 20 })
    expect(lines).toHaveLength(7)
    for (const line of lines) {
      expect(recipes.has(String(line.cells['recipe']))).toBe(true)
      expect(ingredients.has(String(line.cells['ingredient']))).toBe(true)
    }
    const butter = lines.find((line) => ingredients.get(String(line.cells['ingredient'])) === 'Butter')
    expect(recipes.get(String(butter?.cells['recipe']))).toBe('Shortbread')
    db.close()
  })

  it('refuses a line naming a parent that is not there, by file and line, and writes the rest', async () => {
    const { path, directory } = await kitchen()
    const lines = join(directory, 'recipe-lines.csv')
    await writeFile(
      lines,
      readFileSync(LINKED('recipe-lines.csv'), 'utf8') + 'Pancakes,Saffron,1\n',
      'utf8',
    )
    await copyFile(LINKED('recipes.csv'), join(directory, 'recipes.csv'))
    const files = [
      { file: lines, format: 'recipe_line', columns: LINE_COLUMNS },
      { file: join(directory, 'recipes.csv'), format: 'recipe' },
      { file: LINKED('ingredients.csv'), format: 'ingredient' },
    ]

    const dry = await readOntoFormatTool.run({ path, files }, NO_CLIENT)
    expect(dry).toMatch(/\| recipe-lines\.csv \| Recipe line \| 7 \| 1 \|/)
    expect(dry).toContain('1 row would not be read')
    // Its line in the file — the header is line 1 — and the name it gave.
    expect(dry).toMatch(/\| 9 \| [^|]*Saffron/)
    expect(await counts(path)).toEqual([0, 0, 0])

    const answer = await readOntoFormatTool.run({ path, files, commit: true }, NO_CLIENT)
    expect(answer).toContain('**14 rows written from 3 files**')
    expect(await counts(path)).toEqual([5, 2, 7])
  })

  it('refuses the whole lot when one file cannot be written, and says which', async () => {
    const { path, directory } = await kitchen()
    // Flour twice: a unique name repeated within a file refuses that file.
    const doubled = join(directory, 'ingredients.csv')
    await writeFile(doubled, readFileSync(LINKED('ingredients.csv'), 'utf8') + 'Flour,360\n', 'utf8')
    const files = [...FILES.slice(0, 2), { file: doubled, format: 'ingredient' }]

    const dry = await readOntoFormatTool.run({ path, files }, NO_CLIENT)
    expect(dry).toContain('**Nothing will be written.**')
    // Named first; its children cannot be either, with nothing to name.
    expect(dry).toMatch(/and ingredients\.csv, recipe-lines\.csv cannot be/)
    expect(dry).not.toContain('commit: true')

    const answer = await readOntoFormatTool.run({ path, files, commit: true }, NO_CLIENT)
    expect(answer).toContain('**Nothing will be written.**')
    expect(await counts(path)).toEqual([0, 0, 0])
  })

  it('takes the same mapping arguments per file, and refuses one and many in one call', async () => {
    const { path } = await kitchen()
    await expect(
      readOntoFormatTool.run({ path, format: 'recipe', file: LINKED('recipes.csv'), files: FILES }, NO_CLIENT),
    ).rejects.toThrow(/not both/)
    await expect(readOntoFormatTool.run({ path, files: [] }, NO_CLIENT)).rejects.toThrow(/at least one/)

    // A format the document has not got refuses the lot, and is named.
    const dry = await readOntoFormatTool.run(
      { path, files: [...FILES, { file: LINKED('recipes.csv'), format: 'menu' }] },
      NO_CLIENT,
    )
    expect(dry).toContain('**Nothing will be written.**')
    expect(dry).toContain('menu')
  })
})

describe('declare_format with several formats (M34 U2)', () => {
  const DECLARE = [
    {
      format: 'recipe_line',
      title: 'Recipe line',
      columns: [
        { name: 'recipe', type: 'link', target: 'recipe', required: true },
        { name: 'ingredient', type: 'link', target: 'ingredient', required: true },
        { name: 'grams', type: 'real', unit: 'g' },
      ],
      nothing_must_hold: true,
    },
    {
      format: 'recipe',
      title: 'Recipe',
      columns: [
        { name: 'name', type: 'text', required: true, unique: true },
        { name: 'serves', type: 'integer' },
      ],
      nothing_must_hold: true,
    },
    {
      format: 'ingredient',
      title: 'Ingredient',
      columns: [
        { name: 'name', type: 'text', required: true, unique: true },
        { name: 'kcal_per_100g', type: 'real' },
      ],
      nothing_must_hold: true,
    },
  ]

  async function bare(): Promise<string> {
    const db = await createDatabase()
    const directory = await tempDir('emerald-declare-')
    const path = join(directory, 'bare.emd')
    await writeFile(path, exportDatabase(db))
    db.close()
    return path
  }

  it('declares three linked formats in the order their links need, then reads their files', async () => {
    const path = await bare()
    const dry = await declareFormatTool.run({ path, formats: DECLARE }, NO_CLIENT)
    expect(dry).toContain('**3 formats, declared in the order their links need**: `recipe`, `ingredient`, `recipe_line`.')
    expect(dry).toContain('**Nothing has been written.**')

    const answer = await declareFormatTool.run({ path, formats: DECLARE, commit: true }, NO_CLIENT)
    expect(answer).toContain('**3 formats declared**')

    const read = await readOntoFormatTool.run({ path, files: FILES, commit: true }, NO_CLIENT)
    expect(read).toContain('**14 rows written from 3 files**')
  })

  it('declares none when one of them is wrong, and names it', async () => {
    const path = await bare()
    const wrong = [...DECLARE.slice(0, 2), { ...DECLARE[2], columns: [{ name: 'name', type: 'colour' }] }]
    const answer = await declareFormatTool.run({ path, formats: wrong, commit: true }, NO_CLIENT)
    expect(answer).toContain('**Nothing will be declared.**')
    expect(answer).toContain('`ingredient`')
    const db = await openDatabase(readFileSync(path))
    expect(listFormats(db).filter((each) => !each.name.startsWith('ledger'))).toEqual([])
    db.close()
  })
})
