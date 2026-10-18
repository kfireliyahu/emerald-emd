import { describe, expect, it } from 'vitest'

import { column as declared, DECLARATION_LANGUAGE, type FormatDeclaration } from '@/domain/format/declaration.ts'
import {
  declarationOf,
  draftOf,
  draftProblems,
  moveColumn,
  newColumn,
  newDraft,
  originOf,
  pruned,
} from '@/domain/format/draft.ts'
import { chooseType, creationOf, inDraftOrder, openingShape, sheetMark, type Shape } from '@/ui/formats/shape.ts'

/**
 * M26 F3: *"whenever i try to pick a different type for the column it goes
 * back to text"*. The tile changed the draft and then the focus, and the
 * second change was built from the draft before the first.
 */
describe('chooseType', () => {
  const column = newColumn()
  const draft = { ...newDraft(), columns: [column] }
  const fresh: Shape = { draft, focus: { kind: 'COLUMN', key: column.key, chosen: false } }

  it('keeps the type picked and marks it chosen, in one value', () => {
    const next = chooseType(fresh, 'integer')
    expect(next.draft.columns[0]?.type).toBe('integer')
    expect(next.focus).toEqual({ kind: 'COLUMN', key: column.key, chosen: true })
  })

  it('reopens the tiles on Change without losing the type', () => {
    const picked = chooseType(fresh, 'date')
    const reopened = chooseType(picked, 'date')
    expect(reopened.draft.columns[0]?.type).toBe('date')
    expect(reopened.focus).toEqual({ kind: 'COLUMN', key: column.key, chosen: false })
    expect(chooseType(reopened, 'money').draft.columns[0]?.type).toBe('money')
  })

  it('touches only the column it is open on', () => {
    const other = newColumn()
    const two: Shape = { ...fresh, draft: { ...draft, columns: [column, other] } }
    const next = chooseType(two, 'real')
    expect(next.draft.columns[1]).toBe(other)
  })
})

/**
 * M29 U1 (D-331): a new format is the editor on an empty one, so where it
 * opens and what Create waits on are questions about the draft, answered here.
 */
describe('openingShape', () => {
  it('opens an empty format on its first column, with the type still to pick', () => {
    const draft = newDraft()
    const shape = openingShape(draft)
    expect(shape.focus).toEqual({ kind: 'COLUMN', key: draft.columns[0]?.key, chosen: false })
  })

  it('opens a filled draft on its first column, already typed — what adds up is not waited on (D-345)', () => {
    const column = { ...newColumn(), name: 'price', type: 'real' as const }
    const draft = { ...newDraft(), columns: [column] }
    expect(openingShape(draft).focus).toEqual({ kind: 'COLUMN', key: column.key, chosen: true })
  })

  it('hands a draft with no column one, since the panel is where a column is added', () => {
    const shape = openingShape({ ...newDraft(), columns: [] })
    expect(shape.draft.columns).toHaveLength(1)
    expect(shape.focus.kind).toBe('COLUMN')
  })
})

describe('creationOf', () => {
  it('names what an untouched format waits on instead of drawing it red', () => {
    const draft = pruned(newDraft())
    const creation = creationOf(draft, draftProblems(draft))
    expect(creation.shown).toEqual([])
    expect(creation.waiting).toEqual(['what one of them is called', 'a column'])
  })

  it('draws a problem somebody caused, and stops waiting once each is said', () => {
    const draft = {
      ...newDraft(),
      title: 'Book',
      name: 'book',
      columns: [{ ...newColumn(), name: 'pages', type: 'integer' as const, minimum: 'many' }],
    }
    const creation = creationOf(draft, draftProblems(draft))
    expect(creation.waiting).toEqual([])
    expect(creation.shown.length).toBeGreaterThan(0)
    expect(creation.shown.every((each) => each.where.kind === 'COLUMN')).toBe(true)
  })

  it('still draws a name the document already uses', () => {
    const draft = { ...newDraft(), title: 'Book', name: 'book', columns: [{ ...newColumn(), name: 'pages' }] }
    const existing = declarationOf(draft)
    const creation = creationOf(draft, draftProblems(draft, [existing]))
    expect(creation.shown.some((each) => each.message.includes('already has a format called book'))).toBe(true)
  })
})

/** M29 U2, D-332: the sheet draws the stored columns in the order being saved. */
describe('inDraftOrder', () => {
  const book: FormatDeclaration = {
    language: DECLARATION_LANGUAGE,
    name: 'book',
    title: 'Book',
    notes: '',
    columns: [declared('title', 'text'), declared('pages', 'integer'), declared('author', 'text')],
    identities: [],
    aggregates: [],
    nothingMustHold: true,
  }
  const draft = draftOf(book)
  const origin = originOf(draft)
  const [title, pages, author] = draft.columns.map((each) => each.key)
  const names = (each: FormatDeclaration): string[] => each.columns.map((one) => one.name)

  it('is the stored declaration itself while nothing has moved', () => {
    expect(inDraftOrder(book, draft, origin)).toBe(book)
  })

  it('follows a move, and keeps a renamed column under the name its entries are stored by', () => {
    const moved = moveColumn(draft, author ?? '', title)
    const renamed = { ...moved, columns: moved.columns.map((each) => (each.key === pages ? { ...each, name: 'leaves' } : each)) }
    expect(names(inDraftOrder(book, renamed, origin))).toEqual(['author', 'title', 'pages'])
  })

  it('keeps a removed column in its place until Save takes it', () => {
    const removed = { ...draft, columns: draft.columns.filter((each) => each.key !== pages) }
    const moved = moveColumn(removed, author ?? '', title)
    expect(names(inDraftOrder(book, moved, origin))).toEqual(['author', 'pages', 'title'])
  })
})

/**
 * M29 F4, D-345: *"only highlight the selected column that is being added so
 * he knows the dialog at the bottom is of a column."* One header, or none.
 */
describe('sheetMark', () => {
  const book: FormatDeclaration = {
    language: DECLARATION_LANGUAGE,
    name: 'book',
    title: 'Book',
    notes: '',
    columns: [declared('title', 'text'), declared('pages', 'integer')],
    identities: [],
    aggregates: [],
    derived: [{ name: 'per_page', expression: 'pages', note: '' }],
    nothingMustHold: true,
  }
  const draft = draftOf(book)
  const origin = originOf(draft)
  const pages = draft.columns[1]?.key ?? ''

  it('marks the column the panel is open on, under the name the sheet draws it by', () => {
    const renamed = { ...draft, columns: draft.columns.map((each) => (each.key === pages ? { ...each, name: 'leaves' } : each)) }
    const shape: Shape = { draft: renamed, focus: { kind: 'COLUMN', key: pages, chosen: true } }
    expect(sheetMark(shape, origin, book)).toEqual({ kind: 'COLUMN', name: 'pages' })
  })

  it('gives a column not on the sheet yet a header of its own, named as far as it is typed', () => {
    const column = { ...newColumn(), name: ' author ' }
    const shape: Shape = { draft: { ...draft, columns: [...draft.columns, column] }, focus: { kind: 'COLUMN', key: column.key, chosen: false } }
    expect(sheetMark(shape, origin, book)).toEqual({ kind: 'NEW', name: 'author', key: column.key })
  })

  it('marks a worked-out column by its name, and nothing for what adds up', () => {
    const key = draft.derived?.[0]?.key ?? ''
    expect(sheetMark({ draft, focus: { kind: 'DERIVED', key } }, origin, book)).toEqual({ kind: 'DERIVED', name: 'per_page' })
    expect(sheetMark({ draft, focus: { kind: 'ADDS_UP' } }, origin, book)).toBeUndefined()
  })
})
