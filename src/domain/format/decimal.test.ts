import { describe, expect, it } from 'vitest'

import { decimalValue, formatDecimal, parseDecimal } from './decimal.ts'

/** The stored integer, or the refusal, as one value a test can compare. */
function scaled(offered: string | number, scale: number): number | string {
  const parsed = parseDecimal(offered, scale)
  return parsed.ok ? parsed.value : parsed.error
}

describe('a decimal (M24 U6, D-257)', () => {
  it('is split at its point by the digits, never through a float', () => {
    expect(scaled('3.5', 6)).toBe(3500000)
    expect(scaled('0.07', 2)).toBe(7)
    // `421.05 * 100` is `42104.999999999996`; the digits are 42105.
    expect(scaled('421.05', 2)).toBe(42105)
    expect(scaled(421.05, 2)).toBe(42105)
    expect(scaled('-0.5', 1)).toBe(-5)
    expect(scaled('12', 3)).toBe(12000)
    expect(scaled('.25', 2)).toBe(25)
    expect(scaled('1,234.5', 2)).toBe(123450)
  })

  it('forgives trailing zeros past its places and nothing else', () => {
    expect(scaled('1.500', 2)).toBe(150)
    expect(scaled('3.14159', 2)).toContain('refused rather than rounded')
  })

  it('refuses what is not a figure, an exponent, and a figure too large to hold exactly', () => {
    expect(scaled('about four', 2)).toContain('not a figure')
    expect(scaled('.', 2)).toContain('not a figure')
    expect(scaled('-', 2)).toContain('not a figure')
    expect(scaled(1e-7, 9)).toContain('exponent')
    expect(scaled('99999999999', 9)).toContain('too large')
    expect(scaled(Number.NaN, 2)).toContain('not a figure')
  })

  it('reads back at exactly its places, and a negative zero is zero', () => {
    expect(formatDecimal(3500000, 6)).toBe('3.500000')
    expect(formatDecimal(7, 2)).toBe('0.07')
    expect(formatDecimal(-5, 1)).toBe('-0.5')
    expect(formatDecimal(0, 2)).toBe('0.00')
    expect(scaled('-0.00', 2)).toBe(0)
    expect(decimalValue(3500, 4)).toBe(0.35)
  })
})
