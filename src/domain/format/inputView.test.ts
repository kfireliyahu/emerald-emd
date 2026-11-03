import { describe, expect, it } from 'vitest'

import { dayOfDefault, heldExactly, inputDraft, inputViewRefusals } from './inputView.ts'
import { entryDefaults } from './view.ts'
import type { FormatDeclaration } from './declaration.ts'

/** A card charge, declared by hand: the shape `inputViewRefusals` reads. */
const CHARGE = {
  name: 'charge',
  title: 'Card charge',
  columns: [
    { name: 'merchant', type: 'text', required: true },
    { name: 'amount', type: 'money', required: true },
    { name: 'date', type: 'date', required: true },
    { name: 'state', type: 'enum', values: ['pending', 'cleared'], required: true },
    { name: 'tip', type: 'integer', required: false, minimum: 0 },
  ],
  aggregates: [],
  derived: [{ name: 'week', expression: 'date' }],
} as unknown as FormatDeclaration

describe('an input view’s defaults (M55 U2, D-536)', () => {
  it('works a word naming one day out on the day it is used, and a date as itself', () => {
    expect(dayOfDefault('today', '2026-03-01')).toBe('2026-03-01')
    expect(dayOfDefault('yesterday', '2026-03-01')).toBe('2026-02-28')
    expect(dayOfDefault('Tomorrow', '2026-12-31')).toBe('2027-01-01')
    expect(dayOfDefault('2026-05-05', '2026-03-01')).toBe('2026-05-05')
    expect(dayOfDefault('this week', '2026-03-01')).toBeUndefined()
    expect(dayOfDefault('within 7 days', '2026-03-01')).toBeUndefined()
  })

  it('refuses a range word, a value its column refuses, a computed column and a required one left out — every reason at once', () => {
    const reasons = inputViewRefusals(CHARGE, {
      fields: ['merchant', 'week'],
      defaults: { date: 'within 7 days', state: 'void', tip: '-2', amount: ['1 ILS', '2 ILS'] },
    })
    expect(reasons).toEqual([
      'week is worked out, so an input view cannot ask it.',
      'date’s default names more than one day (within 7 days); a date’s default is today, yesterday, tomorrow or a date.',
      expect.stringMatching(/^state’s default: .*void/),
      expect.stringMatching(/^tip’s default: .*minimum/),
      expect.stringMatching(/^amount’s default is one value/),
    ])
    expect(inputViewRefusals(CHARGE, { fields: ['merchant'], defaults: {} })).toEqual([
      'Card charge needs amount, and this view neither asks it nor gives it a default.',
      'Card charge needs date, and this view neither asks it nor gives it a default.',
      'Card charge needs state, and this view neither asks it nor gives it a default.',
    ])
    expect(inputViewRefusals(CHARGE, { fields: ['merchant', 'amount'], defaults: { date: 'yesterday', state: 'pending' } })).toEqual([])
  })

  it('is one rule: the input view’s defaults, then the address’s exact values, then a first member', () => {
    const day = '2026-11-03'
    const input = inputDraft(CHARGE, { date: 'today', amount: '12.90 ILS' }, day)
    expect(input).toEqual({ date: day, amount: '12.90', amount_currency: 'ILS' })
    const address = heldExactly(CHARGE, { date: 'yesterday', state: 'cleared' }, day)
    expect(address).toEqual({ date: '2026-11-02', state: 'cleared' })
    const columns = CHARGE.columns.map((each) => ({ ...each, values: each.values ?? [] }))
    expect(entryDefaults(columns, new Set(), { input, address })).toEqual({ date: day, amount: '12.90', amount_currency: 'ILS', state: 'cleared' })
    expect(entryDefaults(columns, new Set(), { address })).toEqual({ date: '2026-11-02', state: 'cleared' })
    expect(entryDefaults(columns)).toEqual({ state: 'pending' })
    // What quick add's group sets is left to it, its companion with it.
    expect(entryDefaults(columns, new Set(['amount', 'state']), { input, address })).toEqual({ date: day })
  })
})
