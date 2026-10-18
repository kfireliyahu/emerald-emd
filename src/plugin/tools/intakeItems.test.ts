/**
 * **A note's list items as rows of another format** — M38 U4's done-test.
 *
 * A synthetic recipe note with six ingredient lines under `## Ingredients` and
 * a method under `## Method`, read beside the synthetic ingredient notes: one
 * recipe row, five line rows linked to it and to their ingredients, and the
 * line naming an ingredient no note is refused and named by its note and place
 * — with the line tally still summing. The recipe's name is not unique: an item
 * finds its note by the file it sits in, never by a name.
 *
 * And the limit M38 U2 named: two notes of one folder that link each other,
 * in their bodies and in a frontmatter link, are both filled in one read.
 */

import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createDatabase, exportDatabase, openDatabase } from '@/data/db/database.ts'
import { adoptFormat } from '@/data/repositories/formatRepository.ts'
import { listRows } from '@/data/repositories/formatRowRepository.ts'
import { column, type FormatDeclaration } from '@/domain/format/declaration.ts'

import { readOntoFormatTool } from './intake.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

const NOW = Date.UTC(2026, 9, 6)

const INGREDIENTS = fileURLToPath(new URL('../../../fixtures/synthetic/notes/ingredients', import.meta.url))

const INGREDIENT: FormatDeclaration = {
  language: 5,
  name: 'ingredient',
  title: 'Ingredient',
  notes: '',
  columns: [column('name', 'text', { required: true, unique: true }), column('kcal_per_100g', 'real')],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

/** Its name is **not** unique: two recipes may share one, and an item still finds its own. */
const RECIPE: FormatDeclaration = {
  language: 5,
  name: 'recipe',
  title: 'Recipe',
  notes: '',
  columns: [column('name', 'text', { required: true }), column('serves', 'integer')],
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
    column('name', 'text'),
    column('recipe', 'link', { target: 'recipe', required: true }),
    column('ingredient', 'link', { target: 'ingredient', required: true }),
    column('amount', 'quantity'),
  ],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

const PANCAKES = [
  '---',
  'serves: 4',
  '---',
  '## Ingredients',
  '',
  '- 200 g [[Flour]], sifted',
  '- 1 1/2 tbsp [[Sugar]]',
  '- 50 g [[Butter]], melted',
  '- 120 ml [[free-range-egg|beaten egg]]',
  '- 10 g [Flour](../ingredients/Flour.md) for dusting',
  '- 5 g [[Unicorn dust]]',
  '',
  '## Method',
  '',
  '1. Whisk everything but the dusting flour.',
  '2. Fry in [[Butter]].',
  '',
].join('\n')

async function kitchen(): Promise<{ path: string; recipes: string }> {
  const db = await createDatabase()
  for (const declaration of [INGREDIENT, RECIPE, LINE]) expect(adoptFormat(db, declaration, NOW).refusals).toEqual([])
  const dir = await tempDir('emerald-items-')
  const path = join(dir, 'kitchen.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  const recipes = join(dir, 'recipes')
  await mkdir(recipes)
  await writeFile(join(recipes, 'Pancakes.md'), PANCAKES, 'utf8')
  return { path, recipes }
}

const FILES = (recipes: string, under = 'Ingredients'): readonly Record<string, unknown>[] => [
  { file: recipes, format: 'recipe_line', items: 'list', under },
  { file: recipes, format: 'recipe' },
  { file: INGREDIENTS, format: 'ingredient' },
]

describe('read_onto_format with a note’s list items (M38 U4)', () => {
  it('plans a recipe row and its lines from the guess, and names the line that names no ingredient', async () => {
    const { path, recipes } = await kitchen()
    const dry = await readOntoFormatTool.run({ path, files: FILES(recipes) }, NO_CLIENT)

    expect(dry).toContain('3 files, read in the order their links need')
    // The lines after the recipe they belong to and the ingredients they name.
    expect(dry).toMatch(/\| 3 \| recipes\/ · list items under Ingredients \| Recipe line \| 5 \| 1 \|/)
    expect(dry).toContain('**recipes/ · list items under Ingredients** — 6 items from 1 note')
    // The guess, by what each part is.
    expect(dry).toMatch(/\| note \| recipe \|/)
    expect(dry).toMatch(/\| figure \| amount \|/)
    expect(dry).toMatch(/\| unit \| amount_unit \|/)
    expect(dry).toMatch(/\| link \| ingredient \|/)
    expect(dry).toMatch(/\| text \| name \|/)
    expect(dry).toContain('1 item would not be read')
    expect(dry).toMatch(/\| Pancakes\.md, item 6 \| [^|]*Unicorn dust/)
    // The line tally still sums: the heading, five read, one refused.
    expect(dry).toContain('7 lines: 1 heading, 5 read, 1 refused.')
    expect(dry).toContain('**Nothing has been written.**')
  })

  it('writes the recipe and five lines, each linked to it and to its ingredient', async () => {
    const { path, recipes } = await kitchen()
    const answer = await readOntoFormatTool.run({ path, files: FILES(recipes), commit: true }, NO_CLIENT)
    expect(answer).toContain('**10 rows written from 3 files**')

    const db = await openDatabase(readFileSync(path))
    const ingredients = new Map(listRows(db, INGREDIENT, { limit: 10 }).map((row) => [row.id, row.cells['name']]))
    const [recipe, ...others] = listRows(db, RECIPE, { limit: 10 })
    expect(others).toEqual([])
    expect(recipe?.cells['name']).toBe('Pancakes')
    expect(recipe?.cells['serves']).toBe(4)

    const lines = listRows(db, LINE, { limit: 10 })
    expect(lines).toHaveLength(5)
    expect(lines.every((row) => row.cells['recipe'] === recipe?.id)).toBe(true)
    const read = lines
      .map((row) => [ingredients.get(String(row.cells['ingredient'])), row.cells['amount'], row.cells['amount_unit'], row.cells['name']])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])) || Number(a[1]) - Number(b[1]))
    expect(read).toEqual([
      ['Butter', 50, 'g', 'Butter, melted'],
      ['Egg', 120, 'ml', 'beaten egg'],
      ['Flour', 10, 'g', 'Flour for dusting'],
      ['Flour', 200, 'g', 'Flour, sifted'],
      ['Sugar', 1.5, 'tbsp', 'Sugar'],
    ])
    db.close()
  })

  it('reads the items again by their note and place: an edited line changes its row, a new one adds one', async () => {
    const { path, recipes } = await kitchen()
    await readOntoFormatTool.run({ path, files: FILES(recipes), commit: true }, NO_CLIENT)
    await writeFile(
      join(recipes, 'Pancakes.md'),
      PANCAKES.replace('- 50 g [[Butter]], melted', '- 60 g [[Butter]], melted').replace(
        '- 5 g [[Unicorn dust]]',
        '- 5 g [[Unicorn dust]]\n- 2 g [[Sugar]] to finish',
      ),
      'utf8',
    )
    const dry = await readOntoFormatTool.run({ path, files: FILES(recipes) }, NO_CLIENT)
    expect(dry).toContain('This read changes 1 row, adds 1, and finds 4 as they were.')
    expect(dry).toContain('- “Butter, melted” (Pancakes.md, item 3): amount')

    await readOntoFormatTool.run({ path, files: FILES(recipes), commit: true }, NO_CLIENT)
    const db = await openDatabase(readFileSync(path))
    const lines = listRows(db, LINE, { limit: 10 })
    expect(lines).toHaveLength(6)
    expect(lines.map((row) => row.cells['amount']).sort((a, b) => Number(a) - Number(b))).toEqual([2, 10, 60, 120, 200, 1.5].sort((a, b) => a - b))
    expect(listRows(db, RECIPE, { limit: 10 })).toHaveLength(1)
    db.close()
  })

  it('refuses an `under` that names no heading, naming the ones that hold items', async () => {
    const { path, recipes } = await kitchen()
    await expect(readOntoFormatTool.run({ path, files: FILES(recipes, 'Sauce') }, NO_CLIENT)).rejects.toThrow(
      /under a heading called Sauce\. Its items are under Ingredients, Method\./,
    )
  })
})

describe('a link between two notes of one folder (M38 U4, lifting M38 U2’s limit)', () => {
  const DISH: FormatDeclaration = {
    language: 5,
    name: 'dish',
    title: 'Dish',
    notes: '',
    columns: [
      column('name', 'text', { required: true, unique: true }),
      column('side', 'link', { target: 'dish' }),
      column('pairs', 'links', { target: 'dish' }),
    ],
    identities: [],
    aggregates: [],
    nothingMustHold: true,
  }

  it('fills both notes’ body links to each other, and a frontmatter link, in one read — and reads the same again', async () => {
    const db = await createDatabase()
    expect(adoptFormat(db, DISH, NOW).refusals).toEqual([])
    const dir = await tempDir('emerald-pairs-')
    const path = join(dir, 'dishes.emd')
    await writeFile(path, exportDatabase(db))
    db.close()
    const folder = join(dir, 'dishes')
    await mkdir(folder)
    await writeFile(join(folder, 'Bread.md'), 'Good with [[Soup]].\n', 'utf8')
    await writeFile(join(folder, 'Soup.md'), '---\nside: "[[Bread]]"\n---\nServe with [crusty bread](Bread.md).\n', 'utf8')

    const dry = await readOntoFormatTool.run({ path, format: 'dish', file: folder }, NO_CLIENT)
    expect(dry).toMatch(/\| body links \| pairs, split by ";" \|/)
    expect(dry).toMatch(/\| side \| side \|/)
    expect(dry).not.toContain('names no row, and')
    expect(dry).toContain(['- side: Bread', '- pairs: Bread'].join('\n'))

    await readOntoFormatTool.run({ path, format: 'dish', file: folder, commit: true }, NO_CLIENT)
    const written = await openDatabase(readFileSync(path))
    const rows = listRows(written, DISH, { limit: 10 })
    const id = new Map(rows.map((row) => [row.cells['name'], row.id]))
    const cells = new Map(rows.map((row) => [row.cells['name'], row.cells]))
    expect(cells.get('Bread')?.['pairs']).toEqual([id.get('Soup')])
    expect(cells.get('Soup')?.['pairs']).toEqual([id.get('Bread')])
    expect(cells.get('Soup')?.['side']).toBe(id.get('Bread'))
    written.close()

    // Read again unchanged: the links name the rows they name already.
    const again = await readOntoFormatTool.run({ path, format: 'dish', file: folder }, NO_CLIENT)
    expect(again).toContain('finds 2 as they were. **Nothing has changed since the last read**')
  })
})
