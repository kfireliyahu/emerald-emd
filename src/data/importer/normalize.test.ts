import { describe, expect, it } from 'vitest'

import { toISODate } from '@/core/time.ts'
import {
  currenciesInText,
  inferDateOrder,
  parseAmountText,
  parseCardLast4,
  parseCurrencyCell,
  parseDateText,
  parseInstallmentText,
} from './normalize.ts'
import type { SheetCell } from './sheetTable.ts'

describe('parseDateText', () => {
  it('reads the separators real files use', () => {
    // Max writes dd-MM-yyyy; other exports use slashes or dots.
    expect(parseDateText('02-07-2026', 'DMY')).toEqual({ year: 2026, month: 7, day: 2 })
    expect(parseDateText('02/07/2026', 'DMY')).toEqual({ year: 2026, month: 7, day: 2 })
    expect(parseDateText('02.07.2026', 'DMY')).toEqual({ year: 2026, month: 7, day: 2 })
  })

  it('reads the same string differently depending on the order it is told', () => {
    // This ambiguity is why the order is inferred per column instead of assumed.
    expect(toISODate(parseDateText('03/07/2026', 'DMY')!)).toBe('2026-07-03')
    expect(toISODate(parseDateText('03/07/2026', 'MDY')!)).toBe('2026-03-07')
    expect(toISODate(parseDateText('2026/07/03', 'YMD')!)).toBe('2026-07-03')
  })

  it('expands two-digit years into the recent past and near future', () => {
    expect(parseDateText('19-07-26', 'DMY')?.year).toBe(2026)
    expect(parseDateText('19-07-99', 'DMY')?.year).toBe(1999)
  })

  it('rejects anything that is not a real date', () => {
    expect(parseDateText('30-02-2026', 'DMY')).toBeUndefined()
    expect(parseDateText('שופרסל', 'DMY')).toBeUndefined()
    expect(parseDateText('', 'DMY')).toBeUndefined()
    expect(parseDateText('סה"כ', 'DMY')).toBeUndefined()
  })
})

describe('inferDateOrder', () => {
  it('uses a day above 12 as proof of day-first', () => {
    expect(inferDateOrder(['02-07-2026', '25-07-2026'])).toBe('DMY')
  })

  it('uses a second component above 12 as proof of month-first', () => {
    expect(inferDateOrder(['07/25/2026', '07/02/2026'])).toBe('MDY')
  })

  it('recognises a four-digit leading year outright', () => {
    expect(inferDateOrder(['2026-07-03'])).toBe('YMD')
  })

  it('falls back to day-first, which is what Israeli statements use', () => {
    expect(inferDateOrder(['02-07-2026', '03-07-2026'])).toBe('DMY')
    expect(inferDateOrder([])).toBe('DMY')
  })
})

describe('parseAmountText', () => {
  it('reads plain and grouped numbers', () => {
    expect(parseAmountText('421.05')).toBe(421.05)
    expect(parseAmountText('1,234.56')).toBe(1234.56)
    expect(parseAmountText('  89.90  ')).toBe(89.9)
  })

  it('strips currency symbols and codes', () => {
    expect(parseAmountText('₪ 7.50')).toBe(7.5)
    expect(parseAmountText('1200.00₪')).toBe(1200.00)
    expect(parseAmountText('$42.99')).toBe(42.99)
    expect(parseAmountText('1,234.56 ILS')).toBe(1234.56)
  })

  it('reads every way these files write a negative', () => {
    expect(parseAmountText('-1,234.56')).toBe(-1234.56)
    expect(parseAmountText('1,234.56-')).toBe(-1234.56)
    expect(parseAmountText('(1,234.56)')).toBe(-1234.56)
  })

  it('strips the Hebrew shekel words too', () => {
    // `\b` is defined on ASCII word characters, so it never fires beside a
    // Hebrew letter and these two used to fall through as unreadable.
    expect(parseAmountText('7.50 ש"ח')).toBe(7.5)
    expect(parseAmountText('1,234.56 שח')).toBe(1234.56)
  })

  it('refuses things that are not amounts', () => {
    expect(parseAmountText('סה"כ')).toBeUndefined()
    expect(parseAmountText('')).toBeUndefined()
    expect(parseAmountText('02-07-2026')).toBeUndefined()
    expect(parseAmountText('1.2.3')).toBeUndefined()
  })
})

describe('currenciesInText', () => {
  it('names what a symbol or a code stands for', () => {
    expect(currenciesInText('₪ 421.05')).toEqual(['ILS'])
    expect(currenciesInText('$1,234.56')).toEqual(['USD'])
    expect(currenciesInText('1,234.56 ILS')).toEqual(['ILS'])
    expect(currenciesInText('7.50 ש"ח')).toEqual(['ILS'])
  })

  it('reports every mention, in order, so a caller can take a majority', () => {
    expect(currenciesInText('$42.99 → 158.30 ₪')).toEqual(['USD', 'ILS'])
  })

  it('says nothing about a symbol that names more than one currency', () => {
    // ¥ is the yen and the yuan, and they disagree on minor units.
    expect(currenciesInText('¥1,200')).toEqual([])
  })

  it('does not find a code inside a word', () => {
    expect(currenciesInText('EUROSET 42.00')).toEqual([])
    expect(currenciesInText('Dennis 42.00')).toEqual([])
  })
})

describe('parseCurrencyCell', () => {
  const cell = (value: string): SheetCell => ({ kind: 'string', text: value, value })

  it('reads a symbol, a code, and the Hebrew word', () => {
    expect(parseCurrencyCell(cell('₪'))).toBe('ILS')
    expect(parseCurrencyCell(cell('usd'))).toBe('USD')
    expect(parseCurrencyCell(cell('ש"ח'))).toBe('ILS')
  })

  it('takes an unfamiliar three-letter code at face value', () => {
    expect(parseCurrencyCell(cell('chf'))).toBe('CHF')
  })

  it('wants the cell to be a currency, not to mention one', () => {
    expect(parseCurrencyCell(cell('סכום ב-$'))).toBeUndefined()
    expect(parseCurrencyCell(cell(''))).toBeUndefined()
    expect(parseCurrencyCell({ kind: 'number', text: '42', value: 42 })).toBeUndefined()
  })
})

describe('parseInstallmentText', () => {
  it('reads the Hebrew and English forms', () => {
    expect(parseInstallmentText('1 מתוך 3')).toEqual({ sequence: 1, total: 3 })
    expect(parseInstallmentText('תשלום 2 מתוך 6')).toEqual({ sequence: 2, total: 6 })
    expect(parseInstallmentText('3/12')).toEqual({ sequence: 3, total: 12 })
    expect(parseInstallmentText('2 of 5')).toEqual({ sequence: 2, total: 5 })
  })

  it('rejects an impossible counter', () => {
    expect(parseInstallmentText('5 מתוך 3')).toBeUndefined()
    expect(parseInstallmentText('רגילה')).toBeUndefined()
  })
})

describe('parseCardLast4', () => {
  it('takes the last four digits, however the cell is padded or masked', () => {
    expect(parseCardLast4('9876')).toBe('9876')
    expect(parseCardLast4('****1234')).toBe('1234')
    expect(parseCardLast4('כרטיס 4321')).toBe('4321')
    expect(parseCardLast4('12')).toBeUndefined()
  })
})
