import { describe, expect, it } from 'vitest'

import { column, DECLARATION_LANGUAGE, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { readViews, writeWidths } from '@/domain/format/document.ts'
import { boardOf, lanesOf } from '@/domain/format/view.ts'
import { createDatabase } from '../db/database.ts'
import { applyParts, serializeDocument } from './formatDocumentRepository.ts'
import { adoptFormat, deleteFormat } from './formatRepository.ts'
import { insertRows } from './formatRowRepository.ts'
import { boardSettings, setBoardLanes, setEntryInput } from './formatViewRepository.ts'

/** A board: one format's rows as cards in lanes, one per member of an enum (M27 U3, D-301). */

const NOW = Date.UTC(2026, 9, 1)

const TASK: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'task',
  title: 'Task',
  notes: '',
  columns: [
    column('name', 'text', { required: true }),
    column('note', 'text'),
    column('state', 'enum', { values: ['todo', 'doing', 'done'], required: true }),
    column('size', 'enum', { values: ['small', 'large'] }),
    column('hours', 'integer'),
  ],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

async function withTasks() {
  const db = await createDatabase()
  expect(adoptFormat(db, TASK, NOW).refusals).toEqual([])
  insertRows(db, TASK, [
    { name: 'Write', state: 'todo', size: 'small' },
    { name: 'Test', state: 'todo' },
  ])
  return db
}

describe('a board', () => {
  it('is drawn for any format with an enum, by its first enum when none is named', () => {
    const shape = boardOf(TASK.columns, new Map())
    expect(shape?.lanes.name).toBe('state')
    expect(shape?.name?.name).toBe('name')
    expect(shape?.cards).toEqual([])
    const plain = TASK.columns.filter((each) => each.type !== 'enum')
    expect(boardOf(plain, new Map())).toBeUndefined()
  })

  it('lays its lanes by the enum a setting names, and falls back when that is no longer one', () => {
    expect(boardOf(TASK.columns, new Map([['size', 'lanes']]))?.lanes.name).toBe('size')
    expect(boardOf(TASK.columns, new Map([['hours', 'lanes']]))?.lanes.name).toBe('state')
  })

  it('shows on a card the name and the columns that say card, and nothing else', () => {
    const shape = boardOf(TASK.columns, new Map([['note', 'card'], ['hours', 'card'], ['state', 'card']]))
    // The lanes column is the lane, not a line on the card.
    expect(shape?.cards.map((each) => each.name)).toEqual(['note', 'hours'])
  })

  it('gives every member a lane, empty or not, and rows with none a lane of their own last', () => {
    const rows = [
      { id: 'a', state: 'todo' },
      { id: 'b', state: undefined },
      { id: 'c', state: 'todo' },
    ]
    const lanes = lanesOf(['todo', 'doing', 'done'], rows, (row) => row.state)
    expect(lanes.map((lane) => [lane.member, lane.rows.map((row) => row.id)])).toEqual([
      ['todo', ['a', 'c']],
      ['doing', []],
      ['done', []],
      [undefined, ['b']],
    ])
    expect(lanesOf(['todo'], [{ id: 'a', state: 'todo' }], (row) => row.state)).toHaveLength(1)
  })

  it('keeps which enum its lanes are per document, beside an entry’s inputs', async () => {
    const db = await withTasks()
    setEntryInput(db, 'task', 'state', 'buttons')
    setBoardLanes(db, 'task', 'size')
    expect(boardSettings(db, 'task')).toEqual(new Map([['size', 'lanes']]))
    setBoardLanes(db, 'task', 'state')
    expect(boardSettings(db, 'task')).toEqual(new Map([['state', 'lanes']]))
    setBoardLanes(db, 'task', undefined)
    expect(boardSettings(db, 'task').size).toBe(0)
    deleteFormat(db, 'task')
    expect(boardSettings(db, 'task').size).toBe(0)
  })

  it('survives a document stored as text', async () => {
    const db = await withTasks()
    setBoardLanes(db, 'task', 'size')
    db.run(
      "INSERT INTO format_view_column (format_name, view, column_name, setting) VALUES ('task', 'board', 'note', 'card')",
    )
    const parts = serializeDocument(db)
    if (!parts.ok) throw new Error(parts.error)
    const views = parts.value.find((part) => part.name === 'views.md')
    expect(views?.text).toContain('### task board\nnote: card\nsize: lanes')

    const back = await createDatabase()
    const applied = applyParts(back, parts.value, NOW)
    if (!applied.ok) throw new Error(applied.error)
    expect(boardSettings(back, 'task')).toEqual(
      new Map([
        ['note', 'card'],
        ['size', 'lanes'],
      ]),
    )
  })

  it('refuses a word a board does not keep, naming it', () => {
    const text = writeWidths([], [{ format: 'task', view: 'board', column: 'state', setting: 'lanes' }])
    expect(readViews(text).ok).toBe(true)
    const wrong = readViews(text.replace('state: lanes', 'state: columns'))
    expect(wrong.ok).toBe(false)
    if (!wrong.ok) expect(wrong.error).toContain('lanes or card')
  })
})
