import { describe, expect, it } from 'vitest'

import { column, DECLARATION_LANGUAGE, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { boardOf, lineShapeOf } from '@/domain/format/view.ts'

import { cardChoosable, chosenCards, chosenLines, lineChoosable, namedByRow } from './lineColumns.ts'

const format = (name: string, columns: FormatDeclaration['columns']): FormatDeclaration => ({
  language: DECLARATION_LANGUAGE,
  name,
  title: name,
  notes: '',
  columns,
  identities: [],
  aggregates: [],
  nothingMustHold: true,
})

const UNIT = format('unit', [
  column('ref', 'text', { required: true }),
  column('title', 'text'),
  column('brief', 'text'),
  column('milestone', 'link', { target: 'milestone' }),
  column('state', 'enum', { values: ['planned', 'built'], required: true }),
])
const LINES = new Map([['title', 'line'], ['brief', 'line']])
const named = (columns: readonly { name: string }[]) => columns.map((each) => each.name)

describe('which columns a line draws (M37 U5)', () => {
  it('offers every column but the name and what the view draws another way, and starts at what it declares', () => {
    const shape = lineShapeOf(UNIT.columns, LINES)
    const through = UNIT.columns.find((each) => each.name === 'milestone')
    const choosable = lineChoosable(UNIT, shape, through === undefined ? [] : [through])
    expect(named(choosable.columns)).toEqual(['title', 'brief', 'state'])
    expect(choosable.drawn).toEqual(['title', 'brief', 'state'])
  })

  it('draws the chosen columns in the order declared, and says the state only when chosen', () => {
    const shape = lineShapeOf(UNIT.columns, LINES)
    expect(named(chosenLines(UNIT, shape, undefined).lines)).toEqual(['title', 'brief'])
    expect(chosenLines(UNIT, shape, undefined).state).toBe(true)
    const chosen = chosenLines(UNIT, shape, ['state', 'title'])
    expect(named(chosen.lines)).toEqual(['title'])
    expect(chosen.state).toBe(true)
    // Nothing chosen is the name and the dot alone; the name is never a line.
    expect(chosenLines(UNIT, shape, ['ref'])).toEqual({ lines: [], state: false })
  })

  it('chooses a board’s cards, never its lanes', () => {
    const board = boardOf(UNIT.columns, new Map([['title', 'card'], ['milestone', 'card']]))
    if (board === undefined) throw new Error('no board')
    expect(named(cardChoosable(UNIT, board).columns)).toEqual(['title', 'brief', 'milestone'])
    expect(cardChoosable(UNIT, board).drawn).toEqual(['title', 'milestone'])
    expect(named(chosenCards(UNIT, board, ['title', 'state']))).toEqual(['title'])
  })

  it('leaves out what the group or the name already says, and keeps what was chosen (M64 F19)', () => {
    const shape = lineShapeOf(UNIT.columns, LINES)
    expect(chosenLines(UNIT, shape, undefined, true).state).toBe(false)
    expect(chosenLines(UNIT, shape, ['state'], true).state).toBe(true)
    const milestone = UNIT.columns.find((each) => each.name === 'milestone')
    const title = UNIT.columns.find((each) => each.name === 'title')
    if (milestone === undefined || title === undefined) throw new Error('no columns')
    expect(namedByRow(milestone, 'M2', 'M2 U3')).toBe(true)
    expect(namedByRow(milestone, 'M2', 'M20 U1')).toBe(false)
    expect(namedByRow(milestone, 'M2', 'Plan the year')).toBe(false)
    // Text is never left out for being in the name: only a link repeats it.
    expect(namedByRow(title, 'M2', 'M2 U3')).toBe(false)
  })
})
