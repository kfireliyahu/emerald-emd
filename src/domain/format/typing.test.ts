/**
 * **A percent, a time and a currency, as a person types them** — M29 F3,
 * D-344. One reading each, shared by the sheet, the entry page and
 * `record_format_rows`: `coerceValue` is what all three go through, so it is
 * what is tested here, beside the hint the screens draw from it.
 */

import { describe, expect, it } from 'vitest'

import { completionOf, settledText } from './completion.ts'
import { CURRENCIES, parseCurrency } from './currency.ts'
import { column, DECLARATION_LANGUAGE, type FormatDeclaration } from './declaration.ts'
import { readDocument, readSettings, writeDocument, writeSettings } from './document.ts'
import { formatStoredPercent, readPercent } from './percent.ts'
import { coerceValue } from './row.ts'
import { blankDraft, offeredOf } from './rowDraft.ts'
import { parseTime } from './span.ts'
import { SEEDED_UNITS } from './unit.ts'

const ITEM: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'item',
  title: 'Item',
  notes: '',
  columns: [
    column('name', 'text', { required: true }),
    column('price', 'money'),
    column('vat', 'percent', { minimum: 0, maximum: 100 }),
    column('start', 'time'),
  ],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

const VAT = ITEM.columns[2]
const START = ITEM.columns[3]
const PRICE = ITEM.columns[1]
if (VAT === undefined || START === undefined || PRICE === undefined) throw new Error('no columns')

function stored(offered: unknown): unknown {
  const read = coerceValue(VAT as NonNullable<typeof VAT>, offered, undefined)
  return read.ok ? read.value['vat'] : `refused: ${read.error}`
}

describe('a percent, typed', () => {
  it('is 87% whether it is typed 87, 87% or 0.87 — from a screen or a conversation', () => {
    for (const typed of ['87', '87%', ' 87 % ', '0.87', '.87', 87, 0.87]) {
      expect(stored(typed), String(typed)).toBe(870000)
    }
  })

  it('reads a % sign as the percent, always: 0.5% is half of one', () => {
    expect(stored('0.5%')).toBe(5000)
    expect(stored('0.0045%')).toBe(45)
    expect(stored('100%')).toBe(1000000)
  })

  it('reads 1 as 1%, never as the whole — a whole is written 100', () => {
    expect(stored('1')).toBe(10000)
    expect(stored(1)).toBe(10000)
    expect(stored('100')).toBe(1000000)
    expect(stored('1.5')).toBe(15000)
    expect(stored('0')).toBe(0)
    expect(stored('0.0')).toBe(0)
  })

  it('reads a bare figure between -1 and 1 as its fraction, a negative one too', () => {
    expect(readPercent('0.5')).toEqual({ ok: true, value: 500000 })
    expect(readPercent('-0.2')).toEqual({ ok: true, value: -200000 })
    expect(readPercent('0.125')).toEqual({ ok: true, value: 125000 })
    expect(readPercent('0.000001')).toEqual({ ok: true, value: 1 })
  })

  it('refuses a seventh place of a fraction, and a fifth of a percent, rather than rounding', () => {
    const fraction = readPercent('0.1234567')
    expect(fraction.ok).toBe(false)
    if (!fraction.ok) expect(fraction.error).toContain('refused rather than rounded')
    expect(readPercent('12.34567').ok).toBe(false)
    expect(readPercent('12.34567%').ok).toBe(false)
  })

  it('refuses what is not a figure, and keeps its bounds as percents', () => {
    for (const typed of ['twelve', '12.5%%', '%', '1e-3', '1.2.3', 'abc%']) {
      expect(readPercent(typed).ok, typed).toBe(false)
    }
    // `maximum: 100` is 100%; 150 is above it, whichever way it was typed.
    expect(stored('150')).toContain('above its maximum of 100%')
    expect(stored('1.5%')).toBe(15000)
    expect(stored(true)).toContain('is a percent')
  })

  it('shows what it will be kept as while it is typed, and becomes it when left', () => {
    expect(completionOf('percent', '87')).toEqual({ kept: '87%', rest: '%' })
    expect(completionOf('percent', '0.87')).toEqual({ kept: '87%', rest: undefined })
    expect(completionOf('percent', '87%')).toBeUndefined()
    expect(completionOf('percent', '12.50')).toEqual({ kept: '12.5%', rest: undefined })
    expect(completionOf('percent', 'twelve')).toBeUndefined()
    expect(completionOf('percent', '')).toBeUndefined()
    expect(settledText('percent', '0.87')).toBe('87%')
    expect(settledText('percent', 'twelve')).toBe('twelve')
    // The settled text reads back to the same figure: leaving a field never moves it.
    for (const typed of ['87', '0.87', '0.5%', '1', '0.000001']) {
      const once = readPercent(typed)
      const again = readPercent(settledText('percent', typed))
      expect(again, typed).toEqual(once)
    }
    expect(formatStoredPercent(870000)).toBe('87%')
  })
})

describe('a time of day, typed', () => {
  it('takes twenty-four hours or am and pm, with or without a colon', () => {
    const cases: [string, string][] = [
      ['14:30', '14:30'],
      ['1430', '14:30'],
      ['2:30pm', '14:30'],
      ['2:30 PM', '14:30'],
      ['2:30 p.m.', '14:30'],
      ['230pm', '14:30'],
      ['2pm', '14:00'],
      ['12am', '00:00'],
      ['12:15 pm', '12:15'],
      ['9', '09:00'],
      ['0930', '09:30'],
      ['9.30', '09:30'],
      ['00:00', '00:00'],
      ['23:59', '23:59'],
    ]
    for (const [typed, kept] of cases) {
      expect(parseTime(typed), typed).toEqual({ ok: true, value: kept })
      const read = coerceValue(START as NonNullable<typeof START>, typed, undefined)
      expect(read.ok && read.value['start'], typed).toBe(kept)
    }
  })

  it('refuses an hour or a minute that does not exist, and a number', () => {
    for (const typed of ['25:00', '24:00', '14:60', '13pm', '0am', '2:30 xm', '1430.5', '12345', 'noonish', '']) {
      expect(parseTime(typed).ok, typed).toBe(false)
    }
    expect(coerceValue(START as NonNullable<typeof START>, 14.5, undefined).ok).toBe(false)
  })

  it('shows the time it will be kept as while it is typed', () => {
    expect(completionOf('time', '230pm')).toEqual({ kept: '14:30', rest: undefined })
    expect(completionOf('time', '14')).toEqual({ kept: '14:00', rest: ':00' })
    expect(completionOf('time', '14:30')).toBeUndefined()
    expect(completionOf('time', '25')).toBeUndefined()
    expect(settledText('time', '1430')).toBe('14:30')
    expect(completionOf('text', '87')).toBeUndefined()
  })
})

describe('a currency', () => {
  it('is three letters, any case, listed or not', () => {
    expect(parseCurrency('ils')).toEqual({ ok: true, value: 'ILS' })
    expect(parseCurrency(' USD ')).toEqual({ ok: true, value: 'USD' })
    expect(parseCurrency('XAU')).toEqual({ ok: true, value: 'XAU' })
  })

  it('refuses a sign by naming the codes it could be, and anything else plainly', () => {
    const dollar = parseCurrency('$')
    expect(dollar.ok).toBe(false)
    if (!dollar.ok) expect(dollar.error).toContain('USD')
    for (const typed of ['shekel', 'US', 'US$', '', '12']) expect(parseCurrency(typed).ok, typed).toBe(false)
  })

  it('lists every code once, each with a sign, and none whose places the engine would get wrong', () => {
    const codes = CURRENCIES.map((each) => each.code)
    expect(new Set(codes).size).toBe(codes.length)
    for (const each of CURRENCIES) {
      expect(each.code).toMatch(/^[A-Z]{3}$/)
      expect(each.sign.length).toBeGreaterThan(0)
    }
    // Three-place dinars the money rule does not know (JOD, OMR) stay typed, not listed.
    expect(codes).not.toContain('JOD')
    expect(codes).not.toContain('OMR')
  })

  it('names the codes a money cell refuses a sign for', () => {
    const read = coerceValue(PRICE as NonNullable<typeof PRICE>, '12.90', '€')
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.error).toContain('EUR')
    expect(coerceValue(PRICE as NonNullable<typeof PRICE>, '12.90', 'eur')).toEqual({
      ok: true,
      value: { price_minor: 1290, price_currency: 'EUR' },
    })
  })
})

describe("the document's currency", () => {
  it('is what a new row starts in when no row above says one', () => {
    const blank = blankDraft(ITEM, undefined, 'ILS')
    expect(blank['price_currency']).toBe('ILS')
    // A row above still wins: it is the currency this format is actually kept in.
    const carried = blankDraft(ITEM, { id: 'a', cells: { price_currency: 'USD' } }, 'ILS')
    expect(carried['price_currency']).toBe('USD')
    expect(blankDraft(ITEM)['price_currency']).toBe('')
  })

  it('is offered only beside a figure, so it never makes an empty row a row', () => {
    const blank = blankDraft(ITEM, undefined, 'ILS')
    expect(offeredOf(ITEM, blank)['price_currency']).toBe('')
    expect(offeredOf(ITEM, { ...blank, price: '12.90' })['price_currency']).toBe('ILS')
  })

  it('is kept in a text document, one line, and read back', () => {
    expect(writeSettings('ILS')).toBe('---\nemerald: settings\n---\n\ncurrency: ILS\n')
    expect(readSettings(writeSettings('EUR'))).toEqual({ ok: true, value: 'EUR' })
    expect(readSettings('---\nemerald: settings\n---\n\ncurrency: $\n').ok).toBe(false)
    expect(readSettings('---\nemerald: settings\n---\n\ncolour: green\n').ok).toBe(false)

    const content = { units: SEEDED_UNITS, formats: [{ declaration: ITEM, rows: [] }] }
    const without = writeDocument(content)
    if (!without.ok) throw new Error(without.error)
    expect(without.value.some((part) => part.name === 'settings.md')).toBe(false)

    const parts = writeDocument({ ...content, currency: 'ILS' })
    if (!parts.ok) throw new Error(parts.error)
    const read = readDocument(parts.value)
    expect(read.ok && read.value.currency).toBe('ILS')
    const none = readDocument(without.value)
    expect(none.ok && none.value.currency).toBeUndefined()
  })
})
