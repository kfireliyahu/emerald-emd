import { describe, expect, it } from 'vitest'

import { column, DECLARATION_LANGUAGE, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { readPlaces, readViews, writePlaces, writeWidths } from '@/domain/format/document.ts'
import {
  entryLayout,
  entryOrder,
  movedTo,
  movedWithin,
  wayOf,
  readEntrySetting,
  writeEntrySetting,
} from '@/domain/format/view.ts'
import { createDatabase } from '../db/database.ts'
import { applyParts, serializeDocument } from './formatDocumentRepository.ts'
import { adoptFormat, deleteFormat } from './formatRepository.ts'
import { insertRows } from './formatRowRepository.ts'
import {
  clearGraphPlaces,
  columnWidths,
  entryAsked,
  entryHeaders,
  entryHidden,
  entryInputs,
  entryPlaces,
  graphPlaces,
  setColumnWidth,
  setEntryAsked,
  setEntryHidden,
  setEntryInput,
  setEntryOrder,
  setGraphPlaces,
  restoreViewSettings,
} from './formatViewRepository.ts'

/** A sheet's column widths, kept per document and beside the declaration (M26 U2, D-289). */

const NOW = Date.UTC(2026, 9, 1)

const BOOK: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'book',
  title: 'Book',
  notes: '',
  columns: [column('title', 'text', { required: true }), column('pages', 'integer')],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

async function withBook() {
  const db = await createDatabase()
  expect(adoptFormat(db, BOOK, NOW).refusals).toEqual([])
  insertRows(db, BOOK, [{ title: 'Dune', pages: 412 }])
  return db
}

describe('column widths', () => {
  it('are set, bounded, and cleared back to the type’s width', async () => {
    const db = await withBook()
    setColumnWidth(db, 'book', 'title', 260.4)
    setColumnWidth(db, 'book', 'pages', 5)
    expect(columnWidths(db, 'book')).toEqual(new Map([['title', 260], ['pages', 48]]))
    setColumnWidth(db, 'book', 'pages', undefined)
    expect(columnWidths(db, 'book')).toEqual(new Map([['title', 260]]))
  })

  it('go with the format they size', async () => {
    const db = await withBook()
    setColumnWidth(db, 'book', 'title', 260)
    deleteFormat(db, 'book')
    expect(columnWidths(db, 'book').size).toBe(0)
  })

  it('survive a document stored as text, and only for columns that exist', async () => {
    const db = await withBook()
    setColumnWidth(db, 'book', 'title', 260)
    setColumnWidth(db, 'book', 'gone', 90)
    const parts = serializeDocument(db)
    if (!parts.ok) throw new Error(parts.error)
    const views = parts.value.find((part) => part.name === 'views.md')
    expect(views?.text).toContain('### book\ntitle: 260')
    expect(views?.text).not.toContain('gone')

    const back = await createDatabase()
    const applied = applyParts(back, parts.value, NOW)
    if (!applied.ok) throw new Error(applied.error)
    expect(columnWidths(back, 'book')).toEqual(new Map([['title', 260]]))
  })

  it('writes no views part when nothing was sized', async () => {
    const db = await withBook()
    const parts = serializeDocument(db)
    if (!parts.ok) throw new Error(parts.error)
    expect(parts.value.some((part) => part.name === 'views.md')).toBe(false)
  })

  it('refuses a width the sheet would not take, naming it', () => {
    const text = writeWidths([{ format: 'book', column: 'title', width: 260 }])
    const read = readViews(text)
    expect(read.ok && read.value.widths).toEqual([{ format: 'book', column: 'title', width: 260 }])
    const wrong = readViews(text.replace('260', '9000'))
    expect(wrong.ok).toBe(false)
    if (!wrong.ok) expect(wrong.error).toContain('9000')
  })
})

/** Where the bubbles sit on the connections canvas, kept the same way (M26 U4, D-291). */
describe('graph places', () => {
  it('are set, moved, bounded and cleared', async () => {
    const db = await withBook()
    setGraphPlaces(db, [{ kind: 'FORMAT', name: 'book', x: 10.6, y: -20 }])
    setGraphPlaces(db, [
      { kind: 'FORMAT', name: 'book', x: 40, y: 50 },
      { kind: 'PACK', name: 'ledger', x: 9e9, y: 0 },
    ])
    expect(graphPlaces(db)).toEqual([
      { kind: 'FORMAT', name: 'book', x: 40, y: 50 },
      { kind: 'PACK', name: 'ledger', x: 100_000, y: 0 },
    ])
    clearGraphPlaces(db)
    expect(graphPlaces(db)).toEqual([])
  })

  it('go with the format they place', async () => {
    const db = await withBook()
    setGraphPlaces(db, [{ kind: 'FORMAT', name: 'book', x: 1, y: 2 }])
    deleteFormat(db, 'book')
    expect(graphPlaces(db)).toEqual([])
  })

  it('survive a document stored as text, and only for what is still there', async () => {
    const db = await withBook()
    setGraphPlaces(db, [
      { kind: 'FORMAT', name: 'book', x: -120, y: 40 },
      { kind: 'FORMAT', name: 'gone', x: 1, y: 1 },
      { kind: 'PACK', name: 'ledger', x: 5, y: 5 },
    ])
    const parts = serializeDocument(db)
    if (!parts.ok) throw new Error(parts.error)
    const graph = parts.value.find((part) => part.name === 'graph.md')
    expect(graph?.text).toContain('### book\nx: -120\ny: 40')
    expect(graph?.text).not.toContain('gone')
    // No format here is the ledger's, so its group has nothing to answer to.
    expect(graph?.text).not.toContain('ledger')

    const back = await createDatabase()
    const applied = applyParts(back, parts.value, NOW)
    if (!applied.ok) throw new Error(applied.error)
    expect(graphPlaces(back)).toEqual([{ kind: 'FORMAT', name: 'book', x: -120, y: 40 }])
  })

  it('reads a pack’s place apart from a format of the same name, and refuses a bad one', () => {
    const text = writePlaces([
      { kind: 'PACK', name: 'book', x: 3, y: 4 },
      { kind: 'FORMAT', name: 'book', x: 1, y: 2 },
    ])
    expect(text).toContain('### book\nof: pack\nx: 3')
    expect(readPlaces(text)).toEqual({
      ok: true,
      value: [
        { kind: 'FORMAT', name: 'book', x: 1, y: 2 },
        { kind: 'PACK', name: 'book', x: 3, y: 4 },
      ],
    })
    const wrong = readPlaces(text.replace('x: 1', 'x: 1.5'))
    expect(wrong.ok).toBe(false)
    if (!wrong.ok) expect(wrong.error).toContain('1.5')
  })
})

/**
 * How each column is shown on the entry, kept the same way (M26 U6, D-294; Show
 * as since M35 U3, D-402 — the set per type is `view.test.ts`'s).
 */
describe('entry inputs', () => {
  it('are set, changed and cleared back to the default', async () => {
    const db = await withBook()
    setEntryInput(db, 'book', 'title', 'markdown')
    expect(entryInputs(db, 'book')).toEqual(new Map([['title', 'markdown']]))
    setEntryInput(db, 'book', 'title', 'line')
    expect(entryInputs(db, 'book')).toEqual(new Map([['title', 'line']]))
    setEntryInput(db, 'book', 'title', undefined)
    expect(entryInputs(db, 'book').size).toBe(0)
  })

  it('follow a renamed column and go with the format', async () => {
    const db = await withBook()
    setEntryInput(db, 'book', 'title', 'markdown')
    const renamed: FormatDeclaration = {
      ...BOOK,
      columns: [column('name', 'text', { required: true }), column('pages', 'integer')],
    }
    expect(adoptFormat(db, renamed, NOW, new Map([['name', 'title']])).refusals).toEqual([])
    expect(entryInputs(db, 'book')).toEqual(new Map([['name', 'markdown']]))
    deleteFormat(db, 'book')
    expect(entryInputs(db, 'book').size).toBe(0)
  })

  it('survive a document stored as text, beside the widths, and only where they still fit', async () => {
    const db = await withBook()
    setColumnWidth(db, 'book', 'title', 260)
    setEntryInput(db, 'book', 'title', 'markdown')
    setEntryInput(db, 'book', 'gone', 'markdown')
    // `pages` is an integer, so a markdown choice there is read by nobody.
    setEntryInput(db, 'book', 'pages', 'markdown')
    const parts = serializeDocument(db)
    if (!parts.ok) throw new Error(parts.error)
    const views = parts.value.find((part) => part.name === 'views.md')
    expect(views?.text).toContain('### book\ntitle: 260\n\n### book entry\ntitle: markdown')
    expect(views?.text).not.toContain('gone')
    expect(views?.text).not.toContain('pages')

    const back = await createDatabase()
    const applied = applyParts(back, parts.value, NOW)
    if (!applied.ok) throw new Error(applied.error)
    expect(entryInputs(back, 'book')).toEqual(new Map([['title', 'markdown']]))
    expect(columnWidths(back, 'book')).toEqual(new Map([['title', 260]]))
  })

  it('refuses a view or an input this app does not have, naming it', () => {
    const text = writeWidths([], [{ format: 'book', view: 'entry', column: 'title', setting: 'markdown' }])
    expect(readViews(text)).toEqual({
      ok: true,
      value: { widths: [], views: [{ format: 'book', view: 'entry', column: 'title', setting: 'markdown' }], saved: [] },
    })
    const view = readViews(text.replace('book entry', 'book gallery'))
    expect(view.ok).toBe(false)
    if (!view.ok) expect(view.error).toContain('gallery')
    const input = readViews(text.replace('title: markdown', 'title: wysiwyg'))
    expect(input.ok).toBe(false)
    if (!input.ok) expect(input.error).toContain('wysiwyg')
  })
})

describe('the entry’s parts (M35 U2, D-401)', () => {
  const NOTE = [
    column('written', 'date'),
    column('title', 'text', { required: true }),
    column('state', 'enum', { values: ['open', 'done'] }),
    column('energy', 'integer'),
    column('price', 'money'),
    column('project', 'link', { target: 'project' }),
    column('topics', 'links', { target: 'topic' }),
    column('code', 'text'),
    column('body', 'text'),
    column('kept', 'boolean'),
    column('labels', 'enums', { values: ['a', 'b'] }),
  ]
  const names = (columns: readonly { name: string }[]) => columns.map((each) => each.name)

  it('puts the first line of text in the title and every other column in one part', () => {
    const layout = entryLayout(NOTE, (each) => wayOf(each, undefined), new Set())
    expect(layout.title?.name).toBe('title')
    expect(names(layout.header)).toEqual(['written', 'state', 'project', 'kept', 'labels'])
    expect(names(layout.figures)).toEqual(['energy', 'price'])
    expect(names(layout.texts)).toEqual(['code', 'body'])
    expect(names(layout.links)).toEqual(['topics'])
  })

  it('takes a column the view puts in the header line, and a title the view moved', () => {
    const order = entryOrder(NOTE, new Map([['code', 1]]))
    const layout = entryLayout(order, (each) => wayOf(each, undefined), new Set(['energy']))
    expect(layout.title?.name).toBe('code')
    expect(names(layout.header)).toEqual(['written', 'state', 'energy', 'project', 'kept', 'labels'])
    expect(names(layout.texts)).toEqual(['title', 'body'])
    // A text read as markdown is never the title.
    const marked = entryLayout(NOTE, (each) => (each.name === 'title' ? 'markdown' : wayOf(each, undefined)), new Set())
    expect(marked.title?.name).toBe('code')
  })

  it('keeps the header word through an input and an order being set', async () => {
    const db = await withBook()
    restoreViewSettings(db, [{ format: 'book', view: 'entry', column: 'pages', setting: 'header' }])
    setEntryInput(db, 'book', 'pages', 'slider')
    setEntryOrder(db, 'book', ['pages', 'title'])
    expect(entryHeaders(db, 'book')).toEqual(new Set(['pages']))
    setEntryOrder(db, 'book', undefined)
    setEntryInput(db, 'book', 'pages', undefined)
    expect(entryHeaders(db, 'book')).toEqual(new Set(['pages']))
  })
})

describe('entry order', () => {
  it('reads and writes a setting as an input, a place, or both', () => {
    expect(readEntrySetting('markdown')).toEqual({ way: 'markdown', place: undefined, header: undefined })
    expect(readEntrySetting('#2')).toEqual({ way: undefined, place: 2, header: undefined })
    expect(readEntrySetting('markdown #2')).toEqual({ way: 'markdown', place: 2, header: undefined })
    // The header line (M35 U2, D-401): what a page's `line` said.
    expect(readEntrySetting('header #1')).toEqual({ way: undefined, place: 1, header: true })
    expect(writeEntrySetting({ way: 'line', place: 1, header: true })).toBe('line #1 header')
    for (const bad of ['#0', '#x', 'markdown markdown', '#1 #2', 'wysiwyg #2', 'header header', '']) {
      expect(readEntrySetting(bad)).toBeUndefined()
    }
    expect(writeEntrySetting({ way: 'markdown', place: 2 })).toBe('markdown #2')
    expect(writeEntrySetting({ place: 3 })).toBe('#3')
    expect(writeEntrySetting({})).toBeUndefined()
  })

  it('puts placed columns first by place, and the rest after in the declaration’s order', () => {
    const columns = ['a', 'b', 'c', 'd'].map((name) => ({ name }))
    const names = (places: [string, number][]) =>
      entryOrder(columns, new Map(places)).map((each) => each.name)
    expect(names([])).toEqual(['a', 'b', 'c', 'd'])
    expect(names([['c', 1], ['a', 2]])).toEqual(['c', 'a', 'b', 'd'])
    // A column added after the page was arranged lands at the foot.
    expect(names([['d', 1], ['c', 2], ['b', 3]])).toEqual(['d', 'c', 'b', 'a'])
    expect(movedTo(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(movedTo(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    expect(movedTo(['a', 'b', 'c'], 0, 5)).toEqual(['a', 'b', 'c'])
  })

  it('is set beside each column’s input, keeps it, and goes back to the declaration’s', async () => {
    const db = await withBook()
    setEntryInput(db, 'book', 'title', 'markdown')
    setEntryOrder(db, 'book', ['pages', 'title'])
    expect(entryPlaces(db, 'book')).toEqual(new Map([['pages', 1], ['title', 2]]))
    expect(entryInputs(db, 'book')).toEqual(new Map([['title', 'markdown']]))
    // Clearing an input keeps the place, and choosing one keeps it too.
    setEntryInput(db, 'book', 'title', undefined)
    expect(entryPlaces(db, 'book').get('title')).toBe(2)
    setEntryInput(db, 'book', 'pages', 'bar')
    expect(entryPlaces(db, 'book').get('pages')).toBe(1)
    setEntryOrder(db, 'book', undefined)
    expect(entryPlaces(db, 'book').size).toBe(0)
    expect(entryInputs(db, 'book')).toEqual(new Map([['pages', 'bar']]))
  })

  it('survives a document stored as text, and a place outlives an input that no longer fits', async () => {
    const db = await withBook()
    setEntryInput(db, 'book', 'title', 'markdown')
    // `pages` is an integer, so markdown is read by nobody — but its place is.
    setEntryInput(db, 'book', 'pages', 'markdown')
    setEntryOrder(db, 'book', ['pages', 'title'])
    const parts = serializeDocument(db)
    if (!parts.ok) throw new Error(parts.error)
    const views = parts.value.find((part) => part.name === 'views.md')
    expect(views?.text).toContain('### book entry\npages: #1\ntitle: markdown #2')

    const back = await createDatabase()
    const applied = applyParts(back, parts.value, NOW)
    if (!applied.ok) throw new Error(applied.error)
    expect(entryPlaces(back, 'book')).toEqual(new Map([['pages', 1], ['title', 2]]))
    expect(entryInputs(back, 'book')).toEqual(new Map([['title', 'markdown']]))
    expect(readViews(views?.text.replace('#1', '#first') ?? '').ok).toBe(false)
  })

  it('moves a column within its part, leaving the title and the other parts where they were (M53 U2)', () => {
    // title, state (line), notes (text), due (line), body (text)
    const names = ['title', 'state', 'notes', 'due', 'body']
    expect(movedWithin(names, ['notes', 'body'], 1, 0)).toEqual(['title', 'state', 'body', 'due', 'notes'])
    expect(movedWithin(names, ['state', 'due'], 0, 1)).toEqual(['title', 'due', 'notes', 'state', 'body'])
    expect(movedWithin(names, ['state', 'due'], 0, 0)).toBe(names)
    expect(movedWithin(names, ['state', 'due'], 0, 4)).toBe(names)
  })

  it('keeps a column hidden and asked for beside its place and way, through a text document (M53 U2)', async () => {
    expect(readEntrySetting('markdown #2 hidden new')).toEqual({ way: 'markdown', place: 2, hidden: true, asked: true })
    expect(writeEntrySetting({ place: 1, hidden: true })).toBe('#1 hidden')
    expect(writeEntrySetting({ asked: true })).toBe('new')
    for (const bad of ['hidden hidden', 'new new', 'shown']) expect(readEntrySetting(bad)).toBeUndefined()
    // The longest a setting can be still fits the table's CHECK.
    expect(writeEntrySetting({ way: 'relative', place: 1234, header: true, hidden: true, asked: true })?.length).toBeLessThanOrEqual(32)

    const db = await withBook()
    setEntryOrder(db, 'book', ['pages', 'title'])
    setEntryHidden(db, 'book', 'pages', true)
    setEntryAsked(db, 'book', 'pages', true)
    expect(entryHidden(db, 'book')).toEqual(new Set(['pages']))
    expect(entryAsked(db, 'book')).toEqual(new Set(['pages']))
    expect(entryPlaces(db, 'book').get('pages')).toBe(1)
    // A new order keeps both.
    setEntryOrder(db, 'book', undefined)
    expect(entryHidden(db, 'book')).toEqual(new Set(['pages']))

    const parts = serializeDocument(db)
    if (!parts.ok) throw new Error(parts.error)
    const views = parts.value.find((part) => part.name === 'views.md')
    expect(views?.text).toContain('### book entry\npages: hidden new')
    const back = await createDatabase()
    const applied = applyParts(back, parts.value, NOW)
    if (!applied.ok) throw new Error(applied.error)
    expect(entryHidden(back, 'book')).toEqual(new Set(['pages']))
    expect(entryAsked(back, 'book')).toEqual(new Set(['pages']))

    setEntryHidden(db, 'book', 'pages', false)
    setEntryAsked(db, 'book', 'pages', false)
    expect(entryHidden(db, 'book').size).toBe(0)
    expect(entryAsked(db, 'book').size).toBe(0)
  })

  it('keeps how a worked-out column is shown, and drops a retired word, through a text document (D-402)', async () => {
    const db = await createDatabase()
    const scored: FormatDeclaration = {
      ...BOOK,
      name: 'scored',
      title: 'Scored',
      columns: [column('title', 'text', { required: true }), column('before', 'percent'), column('after', 'percent')],
      derived: [{ name: 'shift', expression: 'before - after', note: '' }],
    }
    expect(adoptFormat(db, scored, NOW).refusals).toEqual([])
    setEntryInput(db, 'scored', 'shift', 'ring')
    restoreViewSettings(db, [{ format: 'scored', view: 'entry', column: 'before', setting: 'field #2' }])
    const parts = serializeDocument(db)
    if (!parts.ok) throw new Error(parts.error)
    const views = parts.value.find((part) => part.name === 'views.md')
    expect(views?.text).toContain('### scored entry\nbefore: #2\nshift: ring')

    const back = await createDatabase()
    const applied = applyParts(back, parts.value, NOW)
    if (!applied.ok) throw new Error(applied.error)
    expect(entryInputs(back, 'scored')).toEqual(new Map([['shift', 'ring']]))
    expect(entryPlaces(back, 'scored')).toEqual(new Map([['before', 2]]))
  })
})
