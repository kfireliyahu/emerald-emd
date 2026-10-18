/**
 * A time of day, and the span between two points (M29 U4, D-335): `09:30`
 * typed plainly and kept as `HH:MM`; `end - start` of two times, two dates or
 * two instants a figure in hours or days; two times wrapping at midnight.
 */

import { describe, expect, it } from 'vitest'

import { weighIdentity } from './balance.ts'
import { column, declarationRejection, DECLARATION_LANGUAGE, type FormatDeclaration } from './declaration.ts'
import { createTableSql } from './ddl.ts'
import { readDocument, writeDocument } from './document.ts'
import { evaluateExpression, evaluateIdentity, identity, parseExpression } from './identity.ts'
import { coerceValue, identityInputsOf, type StoredRow } from './row.ts'
import { parseTime, pointOrdinal, spanBetween, timeOfDayFraction } from './span.ts'
import { SEEDED_UNITS } from './unit.ts'

function format(columns: FormatDeclaration['columns'], extra: Partial<FormatDeclaration> = {}): FormatDeclaration {
  return {
    language: DECLARATION_LANGUAGE,
    name: 'shift',
    title: 'Shift',
    notes: '',
    columns,
    identities: [],
    aggregates: [],
    nothingMustHold: true,
    ...extra,
  }
}

const SHIFT = format([
  column('date', 'date'),
  column('start', 'time'),
  column('end', 'time'),
  column('hours', 'real', { unit: 'h' }),
  column('until', 'date'),
  column('clock_in', 'instant'),
])

function row(cells: StoredRow['cells']): StoredRow {
  return { id: 'r1', cells }
}

function verdictOf(cells: StoredRow['cells'], expression = 'end - start = hours') {
  return evaluateIdentity(identity('x', expression), identityInputsOf(SHIFT, row(cells)))
}

describe('a time of day', () => {
  it('is typed plainly and kept as HH:MM', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['9', '09:00'],
      ['9:30', '09:30'],
      ['09:30', '09:30'],
      ['0930', '09:30'],
      ['930', '09:30'],
      ['9.30', '09:30'],
      ['21:05', '21:05'],
      ['00:00', '00:00'],
      ['9pm', '21:00'],
      ['9:30 PM', '21:30'],
      ['12am', '00:00'],
      ['12:15pm', '12:15'],
      ['9 a.m.', '09:00'],
      ['17:30:00', '17:30'],
      [' 7:45 ', '07:45'],
    ]
    for (const [typed, kept] of cases) expect(parseTime(typed), typed).toEqual({ ok: true, value: kept })
  })

  it('refuses what is not a time, and says how to write one', () => {
    for (const typed of ['', 'noon', '25:00', '9:60', '13pm', '0am', '9:30:15', '12345']) {
      expect(parseTime(typed).ok, typed).toBe(false)
    }
    const midnight = parseTime('24:00')
    expect(midnight.ok ? '' : midnight.error).toMatch(/end of a day is 00:00/)
    expect(timeOfDayFraction(0.375)).toBe('09:00')
    expect(timeOfDayFraction(0.99999)).toBe('00:00')
    expect(timeOfDayFraction(1.5)).toBeUndefined()
  })

  it('is a column that takes text, refuses a number, and holds no unit', () => {
    const start = column('start', 'time')
    expect(coerceValue(start, '9:30pm', undefined)).toEqual({ ok: true, value: { start: '21:30' } })
    const number = coerceValue(start, 9, undefined)
    expect(number.ok ? '' : number.error).toMatch(/written as "09:30"/)
    expect(declarationRejection(format([column('start', 'time', { unit: 'h' })]))).toMatch(/not in h/)
    expect(declarationRejection({ ...SHIFT, language: 16 })).toMatch(/format language 17/)
    expect(createTableSql(SHIFT)).toContain(`"start" GLOB '[0-2][0-9]:[0-5][0-9]' AND "start" <= '23:59'`)
  })

  it('is written to a text document as it is shown, and read back', () => {
    const written = writeDocument({
      units: SEEDED_UNITS,
      formats: [{ declaration: SHIFT, rows: [row({ date: '2026-10-03', start: '22:00', end: '06:00' })] }],
    })
    if (!written.ok) throw new Error(written.error)
    expect(written.value.map((part) => part.text).join('\n')).toContain('start: 22:00')
    const read = readDocument(written.value)
    if (!read.ok) throw new Error(read.error)
    expect(read.value.formats[0]?.rows[0]?.cells['start']).toBe('22:00')
    expect(read.value.formats[0]?.declaration.columns[1]?.type).toBe('time')
  })
})

describe('the span between two points', () => {
  it('wraps two times at midnight, without a conditional', () => {
    expect(spanBetween('time', 17 * 60 + 30, 9 * 60)).toEqual({ n: 510n, d: 60n })
    expect(spanBetween('time', 6 * 60, 22 * 60)).toEqual({ n: 480n, d: 60n })
    expect(spanBetween('time', 500, 500)).toEqual({ n: 0n, d: 60n })
    expect(pointOrdinal('date', '1970-01-01')).toBe(0)
    expect(pointOrdinal('date', '2024-03-01')! - pointOrdinal('date', '2024-02-28')!).toBe(2)
    expect(pointOrdinal('date', '2000-01-01')).toBe(10957)
    expect(pointOrdinal('time', '23:59')).toBe(1439)
    expect(pointOrdinal('time', '9:00')).toBeUndefined()
  })

  it('proves hours = end - start on a shift, past midnight too', () => {
    expect(verdictOf({ start: '09:00', end: '17:30', hours: 8.5 })).toMatchObject({ kind: 'PROVED' })
    expect(verdictOf({ start: '22:00', end: '06:00', hours: 8 })).toMatchObject({ kind: 'PROVED' })
    expect(verdictOf({ start: '22:00', end: '06:00', hours: 9 })).toMatchObject({ kind: 'FAILED', left: 8 })
    expect(verdictOf({ start: '09:00', end: null, hours: 8 })).toMatchObject({
      kind: 'UNCHECKED',
      reason: expect.stringMatching(/nothing in end/),
    })
    expect(verdictOf({ start: '09:00', end: '09:20', hours: 20 }, '(end - start) in min = hours')).toMatchObject({
      kind: 'PROVED',
    })
    expect(verdictOf({ date: '2026-10-01', until: '2026-10-08', hours: 7 }, 'until - date = hours')).toMatchObject({
      kind: 'PROVED',
    })
  })

  it('is exact, and in hours or days', () => {
    const inputs = identityInputsOf(SHIFT, row({ start: '08:40', end: '17:00', date: '2026-01-01', until: '2026-03-01' }))
    const hours = parseExpression('end - start')
    const days = parseExpression('until - date')
    if ('problem' in hours || 'problem' in days) throw new Error('does not parse')
    expect(evaluateExpression(hours, inputs)).toMatchObject({ unit: 'h', exact: { n: 25n, d: 3n } })
    expect(evaluateExpression(days, inputs)).toMatchObject({ value: 59, unit: 'day' })
  })

  it('is refused anywhere but end - start of two of one kind', () => {
    const rejected = (expression: string): string | undefined =>
      declarationRejection(format(SHIFT.columns, { identities: [identity('x', expression)], nothingMustHold: false }))
    expect(rejected('end - start = hours')).toBeUndefined()
    expect(rejected('(end - start) in min = hours * 60')).toBeUndefined()
    expect(rejected('end + start = hours')).toMatch(/end is a time — a point/)
    expect(rejected('start = hours')).toMatch(/start is a time/)
    expect(rejected('end - date = hours')).toMatch(/takes a date from a time/)
    expect(rejected('end - clock_in = hours')).toMatch(/takes an instant from a time/)
    expect(rejected('(until - date) in kg = hours')).toMatch(/two different things|time and/)
  })

  it('is one span, not two chips on a pan', () => {
    const inputs = identityInputsOf(SHIFT, row({ start: '09:00', end: '17:30', hours: 8.5 }))
    expect(weighIdentity(identity('x', 'end - start = hours'), inputs)).toBeUndefined()
  })
})
