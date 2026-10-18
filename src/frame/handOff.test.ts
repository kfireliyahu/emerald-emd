import { describe, expect, it } from 'vitest'

import { column, DECLARATION_LANGUAGE, type FormatDeclaration } from '@/domain/format/declaration.ts'

import { aboutMessage, selectionContext, startMessage, type Handed } from './handOff.ts'

/** A unit as the development pack declares it, cut to what the words use — and nothing here knows it is one. */
const UNIT: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'unit',
  title: 'Unit',
  notes: '',
  columns: [
    column('ref', 'text', { required: true }),
    column('title', 'text'),
    column('state', 'enum', { values: ['planned', 'built'] }),
    column('brief', 'text'),
    column('files', 'text'),
  ],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

/** The unit's entry view: `title: line #1`, `brief` and `files` as markdown. */
const ENTRY = new Map([
  ['ref', 'header'],
  ['title', 'line #1'],
  ['brief', 'markdown'],
  ['files', 'markdown'],
])

const WHERE = { name: 'memory.emd', path: 'F:/p/docs/memory.emd' }

const unit = (ref: string, cells: Record<string, string> = {}): Handed => ({
  format: UNIT,
  row: { id: `id-${ref}`, cells: { ref, title: `The ${ref} one`, state: 'planned', ...cells } },
  entry: ENTRY,
})

describe('what the frame hands the conversation, in words (M51 U7)', () => {
  it('Start this unit names the unit by its ref and title, then its brief, then where it is', () => {
    expect(startMessage(unit('M51 U8', { brief: 'Do the thing.\nThen the next.', files: 'src/a.ts' }), WHERE)).toBe(
      'Start unit M51 U8 — The M51 U8 one.\n\n' +
        'brief: Do the thing.\nThen the next.\n\n' +
        'files: src/a.ts\n\n' +
        'It is a row of unit in memory.emd (F:/p/docs/memory.emd).',
    )
    // An empty brief is left out, not said as blank.
    expect(startMessage(unit('M1 U1', { brief: '  ' }), WHERE)).toBe(
      'Start unit M1 U1 — The M1 U1 one.\n\nIt is a row of unit in memory.emd (F:/p/docs/memory.emd).',
    )
  })

  it('about a row is the same name, generic over any format', () => {
    const book: Handed = {
      format: { ...UNIT, name: 'book', title: 'Book', columns: [column('name', 'text'), column('shelf', 'text')] },
      row: { id: 'b1', cells: { name: 'Dune', shelf: 'read' } },
      entry: new Map(),
    }
    expect(aboutMessage(book, WHERE)).toBe('About book Dune. It is a row of book in memory.emd (F:/p/docs/memory.emd).')
    // A row whose label is empty is named by its id.
    expect(aboutMessage({ ...book, row: { id: 'b2', cells: {} } }, WHERE)).toMatch(/^About book b2\./)
  })

  it('a selection tells the model which rows "these" means, with the call that reads them whole', () => {
    const told = selectionContext([unit('M51 U8'), unit('M51 U9')], WHERE, '/formats/unit/ready')
    expect(told.content).toEqual([
      {
        type: 'text',
        text:
          'In the Emerald view of memory.emd (F:/p/docs/memory.emd) at /formats/unit/ready, the person has selected 2 rows: ' +
          'unit M51 U8 — The M51 U8 one; unit M51 U9 — The M51 U9 one. "These" or "this" in the conversation means them. ' +
          'Read them whole with format_rows unit match:{ref:[M51 U8, M51 U9]}.',
      },
    ])
    expect(told.structuredContent).toEqual({
      path: 'F:/p/docs/memory.emd',
      view: '/formats/unit/ready',
      rows: [
        { format: 'unit', id: 'id-M51 U8', name: 'unit M51 U8 — The M51 U8 one' },
        { format: 'unit', id: 'id-M51 U9', name: 'unit M51 U9 — The M51 U9 one' },
      ],
    })
    expect(selectionContext([unit('M1 U1')], WHERE, '/formats/unit').content[0]?.text).toContain('selected one row')
  })

  it('an emptied selection is empty content, which clears what the model was told', () => {
    expect(selectionContext([], WHERE, '/formats/unit')).toEqual({ content: [] })
  })
})
