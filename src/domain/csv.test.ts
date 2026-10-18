import { describe, expect, it } from 'vitest'

import { csvField, neutralize, toCsv } from './csv.ts'

describe('csvField', () => {
  it('leaves an ordinary value alone', () => {
    expect(csvField('שופרסל דיל')).toBe('שופרסל דיל')
    expect(csvField('-421.05')).toBe('-421.05')
    expect(csvField('')).toBe('')
  })

  it('quotes a value containing the separator, a quote, or a newline', () => {
    expect(csvField('Groceries, weekly')).toBe('"Groceries, weekly"')
    expect(csvField('say "hello"')).toBe('"say ""hello"""')
    expect(csvField('two\nlines')).toBe('"two\nlines"')
  })

  it('quotes edge whitespace, which a reader would otherwise eat', () => {
    expect(csvField(' leading')).toBe('" leading"')
    expect(csvField('trailing ')).toBe('"trailing "')
  })
})

describe('neutralize', () => {
  it('defuses a merchant name that is a formula', () => {
    // Merchant text comes from a statement file. It is data, not instruction —
    // and a spreadsheet evaluates on open, which is what makes CSV the place
    // that matters.
    expect(neutralize('=HYPERLINK("http://x","click")')).toBe(
      `'=HYPERLINK("http://x","click")`,
    )
    expect(neutralize('@SUM(1+1)')).toBe(`'@SUM(1+1)`)
    expect(neutralize('+1234')).toBe(`'+1234`)
    expect(neutralize('\t=1+1')).toBe(`'\t=1+1`)
  })

  it('leaves negative numbers as numbers, which is the whole difficulty', () => {
    // A blanket guard on `-` would make every outflow in the file a text cell
    // and the Amount column would stop summing.
    expect(neutralize('-421.05')).toBe('-421.05')
    expect(neutralize('-1')).toBe('-1')
    expect(neutralize('0')).toBe('0')
  })

  it('still guards something that only looks numeric', () => {
    expect(neutralize('-1+2')).toBe(`'-1+2`)
    expect(neutralize('-cmd')).toBe(`'-cmd`)
  })

  it('survives the round trip through a field', () => {
    // Guarded first, then quoted — otherwise the apostrophe lands outside the
    // quotes and the reader sees a stray character rather than a text marker.
    expect(csvField('=1,2')).toBe(`"'=1,2"`)
  })
})

describe('toCsv', () => {
  it('joins rows with CRLF, as RFC 4180 and Excel both want', () => {
    expect(
      toCsv([
        ['Month', 'Expenses'],
        ['2026-07', '-4210.50'],
      ]),
    ).toBe('Month,Expenses\r\n2026-07,-4210.50')
  })

  it('treats the header like any other row, because the escaping rules do', () => {
    expect(toCsv([['a,b'], ['c']])).toBe('"a,b"\r\nc')
  })

  it('is empty for no rows', () => {
    expect(toCsv([])).toBe('')
  })
})
