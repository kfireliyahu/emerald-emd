import { describe, expect, it } from 'vitest'

import type { FormatDeclaration } from '@/domain/format/declaration.ts'

import {
  addsAsWords,
  dayWordOf,
  defaultCellRefusal,
  draftShape,
  fieldsRows,
  inputFormOf,
  inputViewName,
  keptSentence,
  lackingSentence,
  ONE_DAY,
  withAsked,
  withDefault,
  withMoved,
} from './inputForm.ts'

// A synthetic card charge: date, merchant and amount required, an account to link.
const charge = {
  name: 'charge',
  title: 'Card charge',
  columns: [
    { name: 'date', type: 'date', required: true, note: '' },
    { name: 'merchant', type: 'text', required: true, note: '' },
    { name: 'amount', type: 'money', required: true, note: '' },
    { name: 'account', type: 'link', target: 'account', required: false, note: '' },
  ],
  identities: [],
  aggregates: [],
} as unknown as FormatDeclaration

describe('the input view form (M55 U3)', () => {
  it('asks its fields in order, the required ones it lacks last, and names what it sets', () => {
    const form = inputFormOf(charge, { fields: ['merchant'], defaults: { date: 'today', account: 'Visa' } })
    expect(form.asked.map((each) => each.name)).toEqual(['merchant'])
    expect(form.lacking.map((each) => each.name)).toEqual(['amount'])
    expect(addsAsWords(form.sets)).toBe('date today · account Visa')
    expect(lackingSentence(charge, form.lacking[0]!)).toBe('This view does not ask amount, which every card charge needs')
  })

  it('starts a new one asking every required column, named by the title or the next free number', () => {
    expect(draftShape(charge)).toEqual({ fields: ['date', 'merchant', 'amount'], defaults: {} })
    expect(inputViewName(charge, [])).toBe('Card charge')
    expect(inputViewName(charge, ['card charge', 'Card charge 2'])).toBe('Card charge 3')
  })

  it('edits what it asks, sets and in which order, as Fields does', () => {
    const shape = withDefault(withAsked(draftShape(charge), 'date', false), 'date', 'today')
    expect(shape).toEqual({ fields: ['merchant', 'amount'], defaults: { date: 'today' } })
    expect(withMoved(shape, 'amount', 0).fields).toEqual(['amount', 'merchant'])
    expect(withDefault(shape, 'date', ' ').defaults).toEqual({})
    expect(fieldsRows(charge, shape).map((each) => each.name)).toEqual(['merchant', 'amount', 'date', 'account'])
  })

  it('takes a date default of one day and refuses a range word', () => {
    const date = charge.columns[0]!
    expect(defaultCellRefusal(date, 'today')).toBeUndefined()
    expect(defaultCellRefusal(date, '2026-11-03')).toBeUndefined()
    expect(defaultCellRefusal(date, 'this week')).toBe(ONE_DAY)
    expect(dayWordOf(date, 'Today')).toBe('today')
    expect(dayWordOf(date, '2026-11-03')).toBeUndefined()
    expect(defaultCellRefusal(charge.columns[2]!, '12.90')).toMatch(/figure and its currency/)
  })

  it('says why an Undo is kept', () => {
    expect(keptSentence(1)).toBe('Kept: 1 row links to it.')
    expect(keptSentence(2)).toBe('Kept: 2 rows link to it.')
  })
})
