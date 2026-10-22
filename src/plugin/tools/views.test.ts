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
  entryAsked,
  entryHeaders,
  entryHidden,
  entryInputs,
  entryPlaces,
} from '@/data/repositories/formatViewRepository.ts'
import { column, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { derived } from '@/domain/format/derived.ts'
import { entryOrder } from '@/domain/format/view.ts'

import { declareFormatTool, extendFormatTool, formatsTool } from './formats.ts'
import { storeDocumentAsTool } from './storeAs.ts'
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

  it('hides a column and marks one for a new entry, as the Fields list does (M53 U2)', async () => {
    const path = await recipes()
    const done = await arrangeViewsTool.run(
      {
        path,
        settings: [
          { format: 'recipe', view: 'entry', column: 'course', hidden: true },
          { format: 'recipe', view: 'entry', column: 'kcal', new_entry: true, hidden: true },
          { format: 'recipe', view: 'entry', order: ['kcal', 'course'] },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(done).toContain('| recipe | entry | course | shown | shown | hidden |')
    expect(done).toContain('| recipe | entry | kcal | new entry | - | asks |')

    const db = await reopened(path)
    // What the screen reads: hidden and asked beside the order, which kept them.
    expect(entryHidden(db, 'recipe')).toEqual(new Set(['course', 'kcal']))
    expect(entryAsked(db, 'recipe')).toEqual(new Set(['kcal']))
    expect(entryPlaces(db, 'recipe').get('kcal')).toBe(1)
    db.close()
    const read = await formatsTool.run({ path, format: 'recipe' }, NO_CLIENT)
    expect(read).toContain('| kcal | - | figure, bar, slider | #1 | - | hidden | asks | - |')

    // The title, a required column and a computed one are never hidden.
    const refused = await arrangeViewsTool.run(
      {
        path,
        settings: [
          { format: 'recipe', view: 'entry', column: 'name', hidden: true },
          { format: 'recipe', view: 'entry', column: 'share', hidden: true },
          { format: 'recipe', view: 'entry', column: 'steps', hidden: 'yes' },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(refused).toContain('3 settings were refused')
    expect(refused).toContain('`name` is required')
    expect(refused).toContain('`share` is computed')
    expect(refused).toContain('`hidden` is true or false.')

    // Shown again, and no longer asked for.
    await arrangeViewsTool.run(
      {
        path,
        settings: [
          { format: 'recipe', view: 'entry', column: 'course', hidden: false },
          { format: 'recipe', view: 'entry', column: 'kcal', hidden: false, new_entry: false },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    const back = await reopened(path)
    expect(entryHidden(back, 'recipe').size).toBe(0)
    expect(entryAsked(back, 'recipe').size).toBe(0)
    back.close()
  })

  it('refuses hiding the column an entry draws as its title, required or not', async () => {
    const db = await createDatabase()
    const loose: FormatDeclaration = { ...RECIPE, name: 'note', title: 'Note', columns: [column('heading', 'text'), column('body', 'text')], derived: [] }
    expect(adoptFormat(db, loose, NOW).refusals).toEqual([])
    const path = join(await tempDir('emerald-views-'), 'notes.emd')
    await writeFile(path, exportDatabase(db))
    db.close()
    const answer = await arrangeViewsTool.run(
      { path, settings: [{ format: 'note', view: 'entry', column: 'heading', hidden: true }], commit: true },
      NO_CLIENT,
    )
    expect(answer).toContain('`heading` is the title of note’s entry')
  })
})

/**
 * **An entry's order comes back as it was sent** (M42 F11): set in one commit
 * with a board's lanes, an agenda's date and other entry settings, and kept by
 * an `extend_format` that adds columns, which go after it. Title is declared
 * tenth here and sent first, the shape of the report.
 */
describe('an entry order kept exactly (M42 F11)', () => {
  const COLUMNS = [
    { name: 'ref', type: 'text' },
    { name: 'notes', type: 'text' },
    { name: 'owner', type: 'text' },
    { name: 'due', type: 'date' },
    { name: 'state', type: 'enum', values: ['open', 'in_progress', 'done', 'dropped'] },
    { name: 'priority', type: 'enum', values: ['low', 'high'] },
    { name: 'started', type: 'date' },
    { name: 'estimate', type: 'real' },
    { name: 'areas', type: 'links', target: 'area' },
    { name: 'title', type: 'text', required: true },
    { name: 'flag', type: 'boolean' },
    { name: 'source', type: 'text' },
  ]
  const ORDER = ['title', 'state', 'areas', 'due', 'priority', 'owner', 'started', 'estimate', 'notes', 'ref', 'source', 'flag']

  /** What a dry run of the same order says the entry runs in now. */
  async function stored(path: string): Promise<string> {
    const dry = await arrangeViewsTool.run({ path, settings: [{ format: 'task', view: 'entry', order: ORDER }] }, NO_CLIENT)
    return dry.split('\n').find((line) => line.startsWith('| task | entry | - | order |'))?.split('|')[5]?.trim() ?? ''
  }

  for (const encoding of ['sqlite', 'text'] as const) {
    it(`keeps it through one commit of several settings and an extend_format, stored as ${encoding}`, async () => {
      const db = await createDatabase()
      const path = join(await tempDir('emerald-views-'), 'work.emd')
      await writeFile(path, exportDatabase(db))
      db.close()
      const area = { format: 'area', title: 'Area', columns: [{ name: 'name', type: 'text', required: true }], nothing_must_hold: true }
      const task = { format: 'task', title: 'Task', columns: COLUMNS, nothing_must_hold: true }
      expect(await declareFormatTool.run({ path, formats: [area, task], commit: true }, NO_CLIENT)).not.toMatch(/refus/i)
      if (encoding === 'text') await storeDocumentAsTool.run({ path, as: 'text', commit: true }, NO_CLIENT)

      const set = await arrangeViewsTool.run(
        {
          path,
          settings: [
            { format: 'task', view: 'entry', column: 'notes', show_as: 'markdown' },
            { format: 'task', view: 'board', column: 'state' },
            { format: 'task', view: 'agenda', column: 'due', setting: 'date' },
            { format: 'task', view: 'entry', order: ORDER },
            { format: 'task', view: 'entry', column: 'owner', header: true },
          ],
          commit: true,
        },
        NO_CLIENT,
      )
      expect(set).not.toContain('refused')
      expect(await stored(path)).toBe(ORDER.join(', '))

      const extended = await extendFormatTool.run(
        {
          path,
          format: 'task',
          columns: [
            { name: 'blocks', type: 'links', target: 'task' },
            { name: 'parent', type: 'link', target: 'area' },
            { name: 'tags', type: 'links', target: 'area' },
          ],
          constraints: [{ rule: 'owner is required when state is in_progress', note: 'Somebody has it.' }],
          commit: true,
        },
        NO_CLIENT,
      )
      expect(extended).toContain('Added')
      expect(await stored(path)).toBe([...ORDER, 'blocks', 'parent', 'tags'].join(', '))
      // And the declaration's own order only grew at the end.
      const read = await formatsTool.run({ path, format: 'task' }, NO_CLIENT)
      const declared = [...COLUMNS.map((each) => each.name), 'blocks', 'parent', 'tags']
      const at = declared.map((name) => read.indexOf(`| ${name} |`))
      expect(at.every((each) => each >= 0)).toBe(true)
      expect([...at].sort((a, b) => a - b)).toEqual(at)
    })
  }
})
