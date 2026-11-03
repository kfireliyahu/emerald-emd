import { describe, expect, it } from 'vitest'

import { column, type FormatDeclaration } from './declaration.ts'
import { completionOf, dayOfWord, settledText } from './completion.ts'
import { coerceProblems, coerceRow, readValue, type StoredRow } from './row.ts'
import { blankDraft, draftOfOffered, draftOfRow, isEmpty, offeredOf, withField } from './rowDraft.ts'

/**
 * A row in a form, out of the table and back into it — M20 U1.
 *
 * The property worth holding still is the **round trip**: what the form shows
 * for a stored row, coerced again, has to be the row it started from. A screen
 * that reads `12.90` back as `1290` and writes it is the class of bug this
 * project has spent four milestones on, and it is invisible until somebody's
 * figure is a hundred times too big.
 *
 * The other half is the line `blankDraft` draws: a *unit* may be carried from
 * the last row, a *figure* may not.
 */

function declaring(...columns: FormatDeclaration['columns']): FormatDeclaration {
  return {
    language: 4,
    name: 'thing',
    title: 'Thing',
    notes: '',
    columns,
    identities: [],
    aggregates: [],
    nothingMustHold: true,
  }
}

const PRICE = column('price', 'money')

const THING = declaring(
  column('label', 'text'),
  column('count', 'integer'),
  column('ratio', 'real'),
  column('bought_on', 'date'),
  column('opened', 'boolean'),
  column('kind', 'enum', { values: ['dry', 'wet'] }),
  PRICE,
  column('amount', 'quantity'),
)

describe('a row on its way into a form', () => {
  it('offers a field for every key the tool takes, and all of them empty', () => {
    const draft = blankDraft(THING)
    expect(Object.keys(draft).sort()).toEqual(
      [
        'label',
        'count',
        'ratio',
        'bought_on',
        'opened',
        'kind',
        'price',
        'price_currency',
        'amount',
        'amount_unit',
      ].sort(),
    )
    expect(isEmpty(draft)).toBe(true)
  })

  it('carries a currency and a unit from the row before, and no figure at all', () => {
    const previous: StoredRow = {
      id: 'r1',
      cells: {
        label: 'salt',
        count: 3,
        ratio: 0.5,
        bought_on: '2026-01-02',
        opened: 1,
        kind: 'dry',
        price_minor: 1290,
        price_currency: 'ILS',
        amount: 150,
        amount_unit: 'g',
      },
    }
    const draft = blankDraft(THING, previous)
    expect(draft['price_currency']).toBe('ILS')
    expect(draft['amount_unit']).toBe('g')
    // Everything that is a value somebody would have to have meant.
    expect(draft['price']).toBe('')
    expect(draft['amount']).toBe('')
    expect(draft['label']).toBe('')
    expect(draft['count']).toBe('')
  })
})

describe('a stored row, shown and written back', () => {
  const cells = {
    label: 'olive oil',
    count: 3,
    ratio: 0.5,
    bought_on: '2026-01-02',
    opened: 1,
    kind: 'dry',
    price_minor: 1290,
    price_currency: 'ILS',
    amount: 150,
    amount_unit: 'ml',
  }
  const stored: StoredRow = { id: 'r1', cells }

  it('shows money in the major units somebody typed, not the minor units stored', () => {
    expect(draftOfRow(THING, stored)['price']).toBe('12.90')
    expect(draftOfRow(THING, stored)['price_currency']).toBe('ILS')
  })

  it('shows a quantity as its figure, with the unit in its own field', () => {
    expect(draftOfRow(THING, stored)['amount']).toBe('150')
    expect(draftOfRow(THING, stored)['amount_unit']).toBe('ml')
  })

  it('makes the round trip: shown, coerced, and the same row', () => {
    const coerced = coerceRow(THING, draftOfRow(THING, stored))
    expect(coerced.ok).toBe(true)
    if (!coerced.ok) return
    expect(coerced.value).toEqual(cells)
  })

  it('reads a boolean back as the word the select uses', () => {
    expect(draftOfRow(THING, stored)['opened']).toBe('true')
    const off = draftOfRow(THING, { id: 'r2', cells: { ...cells, opened: 0 } })
    expect(off['opened']).toBe('false')
  })

  it('leaves an absent cell as an empty field rather than as the word null', () => {
    const half = draftOfRow(THING, {
      id: 'r3',
      cells: { label: 'salt', price_minor: null, price_currency: null },
    })
    expect(half['label']).toBe('salt')
    expect(half['price']).toBe('')
    expect(half['count']).toBe('')
  })

  it('writes an emptied field back as an empty cell, not as the old value', () => {
    const cleared = withField(draftOfRow(THING, stored), 'label', '')
    const coerced = coerceRow(THING, cleared)
    expect(coerced.ok).toBe(true)
    if (!coerced.ok) return
    expect(coerced.value['label']).toBeNull()
    // And the round trip still holds for everything nobody touched.
    expect(readValue(PRICE, { id: '', cells: coerced.value })).toEqual({
      minor: 1290,
      currency: 'ILS',
    })
  })
})

/**
 * The carry has a sharp edge and this is it.
 *
 * `coerceMoney` and `coerceQuantity` both refuse *one half given, the other
 * blank* — correctly, because a caller who wrote a currency and no amount made
 * a mistake. A currency the **form** carried forward is not something anybody
 * wrote, and left in it would turn an optional money column into a required
 * one. Found by driving the screen, which is the only place it shows.
 */
describe('a companion the form filled in by itself', () => {
  const previous: StoredRow = {
    id: 'r1',
    cells: { price_minor: 1290, price_currency: 'ILS', amount: 150, amount_unit: 'g' },
  }

  it('is dropped when nothing is measured in it', () => {
    const offered = offeredOf(THING, blankDraft(THING, previous))
    expect(offered['price_currency']).toBe('')
    expect(offered['amount_unit']).toBe('')
  })

  it('so an optional money column does not start out refusing', () => {
    const draft = withField(blankDraft(THING, previous), 'label', 'salt')
    const coerced = coerceRow(THING, offeredOf(THING, draft))
    expect(coerced.ok).toBe(true)
    if (!coerced.ok) return
    expect(coerced.value['price_minor']).toBeNull()
    expect(coerced.value['price_currency']).toBeNull()
  })

  it('and is kept the moment there is a figure for it to be the unit of', () => {
    const draft = withField(blankDraft(THING, previous), 'price', '4.50')
    const offered = offeredOf(THING, draft)
    expect(offered['price_currency']).toBe('ILS')
    const coerced = coerceRow(THING, offered)
    expect(coerced.ok).toBe(true)
    if (!coerced.ok) return
    expect(coerced.value['price_minor']).toBe(450)
  })

  it('leaves a row that was already stored exactly as it was', () => {
    const draft = draftOfRow(THING, {
      id: 'r2',
      cells: { label: 'oil', price_minor: 1290, price_currency: 'ILS' },
    })
    expect(offeredOf(THING, draft)['price_currency']).toBe('ILS')
  })
})

describe('what counts as untouched', () => {
  it('is blank when every field is, whitespace included', () => {
    expect(isEmpty(blankDraft(THING))).toBe(true)
    expect(isEmpty(withField(blankDraft(THING), 'label', '   '))).toBe(true)
  })

  it('stops being blank the moment anything is typed', () => {
    expect(isEmpty(withField(blankDraft(THING), 'label', 'salt'))).toBe(false)
  })

  it('counts a row holding only a carried unit as still empty', () => {
    const carried = blankDraft(THING, {
      id: 'r1',
      cells: { price_minor: 1290, price_currency: 'ILS' },
    })
    expect(isEmpty(carried)).toBe(false)
    expect(isEmpty(offeredOf(THING, carried))).toBe(true)
  })
})

describe('a line a read refused, opened in the Add (M55 U9)', () => {
  it('starts every field the line held with what it held, and leaves the rest empty', () => {
    const draft = draftOfOffered(THING, {
      label: 'סה"כ',
      count: 3,
      opened: true,
      kind: ['dry'],
      price: '',
      price_currency: 'ILS',
      unknown: 'not a field',
    })
    expect(draft).toEqual({ label: 'סה"כ', count: '3', opened: 'true', kind: 'dry', price_currency: 'ILS' })
  })

  it('is what the form offers back, so a fixed figure coerces like one typed', () => {
    const draft = { ...blankDraft(THING), ...draftOfOffered(THING, { label: 'Salt', price_currency: 'ILS' }), price: '12.90' }
    const coerced = coerceRow(THING, offeredOf(THING, draft))
    expect(coerced.ok).toBe(true)
  })
})

describe('a date typed as a word, and every problem at once (M55 U5)', () => {
  const CHARGE: FormatDeclaration = {
    ...declaring(column('date', 'date', { required: true }), column('merchant', 'text', { required: true }), column('amount', 'money')),
    name: 'charge',
    title: 'Card charge',
  }

  it('reads today, yesterday and tomorrow as the day each names, and nothing else', () => {
    expect(dayOfWord('tomorrow', '2026-11-03')).toBe('2026-11-04')
    expect(dayOfWord(' Yesterday ', '2026-11-01')).toBe('2026-10-31')
    expect(dayOfWord('today', '2026-11-03')).toBe('2026-11-03')
    expect(dayOfWord('this week', '2026-11-03')).toBeUndefined()
    expect(dayOfWord('soon', '2026-11-03')).toBeUndefined()
    expect(completionOf('date', 'tomorrow', '2026-11-03')).toEqual({ kept: '2026-11-04', rest: undefined })
    expect(settledText('date', 'tomorrow')).toBe('tomorrow')
    expect(settledText('date', '2026-09-03', '2026-11-03')).toBe('2026-09-03')
  })

  it('offers a date word as its day when today is given, and leaves every other column as typed', () => {
    const offered = offeredOf(CHARGE, { date: 'tomorrow', merchant: 'today', amount: '' }, '2026-11-03')
    expect(offered['date']).toBe('2026-11-04')
    expect(offered['merchant']).toBe('today')
    expect(offeredOf(CHARGE, { date: 'tomorrow', merchant: 'x', amount: '' })['date']).toBe('tomorrow')
  })

  it('names every column a row gets wrong, not the first', () => {
    const problems = coerceProblems(CHARGE, { date: '', merchant: '', amount: 'abc', amount_currency: 'ILS' })
    expect(problems.map((each) => each.column)).toEqual(['date', 'merchant', 'amount'])
    expect(coerceProblems(CHARGE, { date: '2026-11-03', merchant: 'Shop', amount: '' })).toEqual([])
    expect(coerceProblems(CHARGE, { nope: 'x' })).toEqual([{ column: undefined, reason: expect.any(String) }])
  })
})
