/**
 * **A conversation arranges a view** — M35 U4, D-403.
 *
 * The done-test: a tool call sets a column's Show as, the header line and the
 * entry's order, and the entry's settings read back as the screen reads them;
 * an unknown column, or a way the type does not offer, is refused by name.
 */

import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDatabase, exportDatabase, openDatabase } from '@/data/db/database.ts'
import { adoptFormat } from '@/data/repositories/formatRepository.ts'
import {
  boardSettings,
  columnWidths,
  entryHeaders,
  entryInputs,
  entryPlaces,
} from '@/data/repositories/formatViewRepository.ts'
import { column, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { derived } from '@/domain/format/derived.ts'
import { entryOrder } from '@/domain/format/view.ts'

import { formatsTool } from './formats.ts'
import { NO_CLIENT } from './tool.ts'
import { arrangeViewsTool } from './views.ts'
import { tempDir } from '../../testing/tempDir'

const NOW = Date.UTC(2026, 9, 6)

const RECIPE: FormatDeclaration = {
  language: 5,
  name: 'recipe',
  title: 'Recipe',
  notes: '',
  columns: [
    column('name', 'text', { required: true }),
    column('steps', 'text'),
    column('kcal', 'real', { minimum: 0, maximum: 2000 }),
    column('state', 'enum', { values: ['idea', 'tried', 'kept'] }),
    column('course', 'enum', { values: ['main', 'side'] }),
    column('done', 'percent'),
    column('of', 'percent'),
  ],
  identities: [],
  aggregates: [],
  derived: [derived('share', 'done / of')],
  nothingMustHold: true,
}

async function recipes(): Promise<string> {
  const db = await createDatabase()
  expect(adoptFormat(db, RECIPE, NOW).refusals).toEqual([])
  const path = join(await tempDir('emerald-views-'), 'kitchen.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  return path
}

async function reopened(path: string) {
  return openDatabase(readFileSync(path))
}

describe('arrange_views (M35 U4)', () => {
  it('sets Show as, the header line and the order, dry-running first', async () => {
    const path = await recipes()
    const settings = [
      { format: 'recipe', view: 'entry', column: 'steps', show_as: 'markdown' },
      { format: 'recipe', view: 'entry', column: 'kcal', show_as: 'bar', header: true },
      { format: 'recipe', view: 'entry', column: 'share', show_as: 'ring' },
      { format: 'recipe', view: 'entry', order: ['kcal', 'steps'] },
      { format: 'recipe', view: 'board', column: 'course' },
      { format: 'recipe', view: 'table', column: 'steps', width: 320 },
    ]

    const dry = await arrangeViewsTool.run({ path, settings }, NO_CLIENT)
    expect(dry).toContain('7 view settings')
    expect(dry).toContain('**Nothing has been written.**')
    const untouched = await reopened(path)
    expect(entryInputs(untouched, 'recipe').size).toBe(0)
    untouched.close()

    const done = await arrangeViewsTool.run({ path, settings, commit: true }, NO_CLIENT)
    expect(done).not.toContain('refused')

    const db = await reopened(path)
    expect([...entryInputs(db, 'recipe')]).toEqual(
      expect.arrayContaining([
        ['steps', 'markdown'],
        ['kcal', 'bar'],
        ['share', 'ring'],
      ]),
    )
    expect([...entryHeaders(db, 'recipe')]).toEqual(['kcal'])
    // The page the screen draws: kcal, then steps, then the rest as declared.
    expect(entryOrder(RECIPE.columns, entryPlaces(db, 'recipe')).map((each) => each.name)).toEqual([
      'kcal',
      'steps',
      'name',
      'state',
      'course',
      'done',
      'of',
    ])
    expect(boardSettings(db, 'recipe').get('course')).toBe('lanes')
    expect(columnWidths(db, 'recipe').get('steps')).toBe(320)
    db.close()

    // And `formats` reads the arrangement back, with each column's ways.
    const read = await formatsTool.run({ path, format: 'recipe' }, NO_CLIENT)
    expect(read).toContain('How it is shown — `arrange_views` changes it')
    expect(read).toContain('| kcal | bar | figure, bar, slider | #1 | yes | - |')
    expect(read).toContain('| share (computed) | ring | figure, bar, ring | - | - | - |')
    expect(read).toContain('**Board:** lanes by `course`.')
  })

  it('puts a setting back to its default', async () => {
    const path = await recipes()
    await arrangeViewsTool.run(
      { path, settings: [{ format: 'recipe', view: 'entry', column: 'steps', show_as: 'mono', header: true }], commit: true },
      NO_CLIENT,
    )
    await arrangeViewsTool.run(
      {
        path,
        settings: [
          { format: 'recipe', view: 'entry', column: 'steps', show_as: null, header: false },
          { format: 'recipe', view: 'entry', order: [] },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    const db = await reopened(path)
    expect(entryInputs(db, 'recipe').size).toBe(0)
    expect(entryHeaders(db, 'recipe').size).toBe(0)
    db.close()
  })

  it('refuses an unknown column, and a way the type does not offer, naming what there is', async () => {
    const path = await recipes()
    const answer = await arrangeViewsTool.run(
      {
        path,
        settings: [
          { format: 'recipe', view: 'entry', column: 'stpes', show_as: 'markdown' },
          { format: 'recipe', view: 'entry', column: 'steps', show_as: 'bar' },
          { format: 'recipe', view: 'board', column: 'name' },
          { format: 'recipes', view: 'entry', column: 'steps', show_as: 'line' },
          { format: 'recipe', view: 'entry', column: 'share', header: true },
          { format: 'recipe', view: 'sheet', column: 'steps', show_as: 'line' },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(answer).toContain('**Nothing was written.** 6 settings were refused')
    expect(answer).toContain('recipe has no column called stpes. It has `name`, `steps`')
    expect(answer).toContain('`bar` is not a way to show `steps`; it offers line, markdown, mono')
    expect(answer).toContain('lays its lanes by an enum: `state`, `course`. `name` is not one.')
    expect(answer).toContain('This document has no format called recipes. It has `recipe`.')
    expect(answer).toContain('`share` is computed')
    expect(answer).toContain('show_as is not a table setting')

    const db = await reopened(path)
    expect(entryInputs(db, 'recipe').size).toBe(0)
    db.close()
  })
})
