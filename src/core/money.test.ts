import { describe, expect, it } from 'vitest'

import {
  abs,
  add,
  compare,
  formatMoney,
  fromMajorUnits,
  isNegative,
  money,
  negate,
  subtract,
  sum,
  zero,
} from './money.ts'

describe('money', () => {
  it('refuses anything that is not a whole number of minor units', () => {
    expect(() => money(1.5, 'ILS')).toThrow()
    expect(() => money(Number.NaN, 'ILS')).toThrow()
    expect(money(150, 'ILS').minor).toBe(150)
  })

  it('normalizes the currency code', () => {
    expect(money(1, 'ils').currency).toBe('ILS')
  })
})

describe('fromMajorUnits', () => {
  it('survives the float values a spreadsheet hands over', () => {
    // 421.05 * 100 is 42104.999999999996 in IEEE 754. This is the whole reason
    // the boundary exists.
    expect(fromMajorUnits(421.05, 'ILS').minor).toBe(42105)
    expect(fromMajorUnits(2366.5, 'ILS').minor).toBe(236650)
    expect(fromMajorUnits(1184.2, 'ILS').minor).toBe(118420)
    expect(fromMajorUnits(0.1 + 0.2, 'ILS').minor).toBe(30)
  })

  it('respects currencies that are not two-decimal', () => {
    expect(fromMajorUnits(1234, 'JPY').minor).toBe(1234)
    expect(fromMajorUnits(1.234, 'KWD').minor).toBe(1234)
  })

  it('keeps the sign', () => {
    expect(fromMajorUnits(-12.34, 'ILS').minor).toBe(-1234)
  })
})

describe('arithmetic', () => {
  it('adds and subtracts exactly', () => {
    const a = fromMajorUnits(0.1, 'ILS')
    const b = fromMajorUnits(0.2, 'ILS')
    expect(add(a, b).minor).toBe(30)
    expect(subtract(b, a).minor).toBe(10)
  })

  it('sums a statement without drift', () => {
    // The real Cal statement, to the agora.
    const amounts = [7.5, 21.7, 80, 110.00, 2361.3, 19.5].map((v) => fromMajorUnits(v, 'ILS'))
    expect(sum(amounts, 'ILS').minor).toBe(260000)
    expect(formatMoney(sum(amounts, 'ILS'))).toBe('₪2,600.00')
  })

  it('refuses to mix currencies without a rate', () => {
    expect(() => add(money(100, 'ILS'), money(100, 'USD'))).toThrow(/without an explicit rate/)
    expect(() => compare(money(100, 'ILS'), money(100, 'USD'))).toThrow()
  })

  it('negates and takes magnitude', () => {
    expect(negate(money(-500, 'ILS')).minor).toBe(500)
    expect(abs(money(-500, 'ILS')).minor).toBe(500)
    expect(isNegative(money(-1, 'ILS'))).toBe(true)
    expect(isNegative(zero('ILS'))).toBe(false)
  })
})

describe('formatMoney', () => {
  it('puts the symbol and the minus in front, and groups thousands', () => {
    expect(formatMoney(money(123456, 'ILS'))).toBe('₪1,234.56')
    expect(formatMoney(money(-123456, 'ILS'))).toBe('-₪1,234.56')
    expect(formatMoney(money(5, 'ILS'))).toBe('₪0.05')
    expect(formatMoney(money(100000000, 'ILS'))).toBe('₪1,000,000.00')
  })

  it('drops the fraction for zero-decimal currencies', () => {
    expect(formatMoney(money(1234, 'JPY'))).toBe('JPY 1,234')
  })

  it('can leave the symbol off for table columns', () => {
    expect(formatMoney(money(-123456, 'ILS'), { symbol: false })).toBe('-1,234.56')
  })
})
