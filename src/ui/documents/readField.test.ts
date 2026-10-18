import { describe, expect, it } from 'vitest'

import { formatMoney, fromMajorUnits } from '@/core/money.ts'

import { acceptsFigureText, figureFromText, figureText } from './ReadField.tsx'

const ILS = 'ILS'

/**
 * The three rules a field a reader's figure lives in has to keep (M16 U10).
 *
 * There is no error state on the confirm surface and no accept the surface
 * blocks, which only works if a field cannot come to hold something no parser
 * can read. So the guard is on the keystroke, and it has to let every half-typed
 * state through while refusing the ones that are not on the way anywhere.
 */
describe('what a figure field will accept', () => {
  it('lets a figure be typed one character at a time', () => {
    for (const text of ['', '-', '1', '1.', '1.5', '-0.25', '1,', '1,5']) {
      expect(acceptsFigureText(text)).toBe(true)
    }
  })

  it('refuses what is not on the way to a figure', () => {
    for (const text of ['a', '1.2.3', '1-2', '₪5', '1 2', '--1']) {
      expect(acceptsFigureText(text)).toBe(false)
    }
  })

  it('reads a comma as the decimal separator, because the grouping ones are gone', () => {
    expect(figureFromText('1,5')).toBe(1.5)
    expect(figureFromText('1.5')).toBe(1.5)
  })

  /**
   * **A blank field means the document printed nothing there.** Every
   * three-state check in the app — `unchecked`, `no value printed`, a price
   * absent rather than zero — rests on the difference, and a field that
   * committed `0` for an empty box would turn a row nobody has read into a row
   * claiming to be worth nothing.
   */
  it('gives nothing for a blank field, and nothing for a half-typed sign', () => {
    expect(figureFromText('')).toBeUndefined()
    expect(figureFromText('   ')).toBeUndefined()
    expect(figureFromText('-')).toBeUndefined()
  })
})

/**
 * The other half of a field: what it shows before anybody types.
 *
 * A figure goes into the box through its own formatter, so the digits are cut
 * out of the integer rather than arrived at by dividing (D-003) — and the
 * grouping commas come off, because a person about to edit ₪1,234.00 should not
 * have to delete a comma first.
 */
describe('a figure as text to type over', () => {
  it('round-trips an amount without moving it', () => {
    const amount = fromMajorUnits(1234.5, ILS)
    expect(figureText(formatMoney(amount, { symbol: false }))).toBe('1234.50')
    expect(fromMajorUnits(figureFromText('1234.50') ?? 0, ILS)).toEqual(amount)

  })

  it('keeps a negative figure negative', () => {
    expect(figureText(formatMoney(fromMajorUnits(-40.5, ILS), { symbol: false }))).toBe('-40.50')
    expect(figureFromText('-40.50')).toBe(-40.5)
  })
})
