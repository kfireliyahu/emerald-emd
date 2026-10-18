/**
 * A percent column (M29 U3, D-333): entered and shown as `12.5%`, stored as
 * millionths of the whole, and read by an identity as its fraction — exactly.
 */

import { describe, expect, it } from 'vitest'

import { column, declarationProblems, DECLARATION_LANGUAGE, type FormatDeclaration } from './declaration.ts'
import { createTableSql } from './ddl.ts'
import { readDocument, writeDocument } from './document.ts'
import { evaluateIdentity, identity } from './identity.ts'
import { formatStoredPercent, parsePercent, percentFigure, roundHalfAway } from './percent.ts'
import { coerceValue, identityInputsOf, readValue, type StoredRow } from './row.ts'
import { SEEDED_UNITS } from './unit.ts'

function format(columns: FormatDeclaration['columns'], extra: Partial<FormatDeclaration> = {}): FormatDeclaration {
  return {
    language: DECLARATION_LANGUAGE,
    name: 'item',
    title: 'Item',
    notes: '',
    columns,
    identities: [],
    aggregates: [],
    nothingMustHold: true,
    ...extra,
  }
}

const PRICED = format(
  [
    column('name', 'text', { required: true }),
    column('price', 'money'),
    column('vat', 'percent', { minimum: 0, maximum: 100 }),
    column('total', 'money'),
  ],
  {
    nothingMustHold: false,
    identities: [identity('with_vat', 'price * (1 + vat) = total')],
  },
)

function row(cells: StoredRow['cells']): StoredRow {
  return { id: 'r1', cells }
}

function verdictOf(cells: StoredRow['cells'], expression = 'price * (1 + vat) = total') {
  return evaluateIdentity(identity('x', expression), identityInputsOf(PRICED, row(cells)))
}

describe('the figure', () => {
  it('is the percent as written, with or without its sign, never the fraction', () => {
    expect(parsePercent('12.5')).toEqual({ ok: true, value: 125000 })
    expect(parsePercent('12.5%')).toEqual({ ok: true, value: 125000 })
    expect(parsePercent(' 17 % ')).toEqual({ ok: true, value: 170000 })
    expect(parsePercent(17)).toEqual({ ok: true, value: 170000 })
    // 0.125 is an eighth of a percent, not 12.5% — the figure is the percent.
    expect(parsePercent(0.125)).toEqual({ ok: true, value: 1250 })
    expect(parsePercent('-2.5')).toEqual({ ok: true, value: -25000 })
    expect(parsePercent('0.0045')).toEqual({ ok: true, value: 45 })
  })

  it('keeps four places and refuses a fifth rather than rounding it', () => {
    const refused = parsePercent('12.34567')
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.error).toContain('refused rather than rounded')
      expect(refused.error).toContain('a percent keeps 4')
    }
    expect(parsePercent('twelve').ok).toBe(false)
    expect(parsePercent('12.5%%').ok).toBe(false)
  })

  it('prints as it was entered, without the places it does not need', () => {
    expect(formatStoredPercent(125000)).toBe('12.5%')
    expect(formatStoredPercent(170000)).toBe('17%')
    expect(formatStoredPercent(1000000)).toBe('100%')
    expect(formatStoredPercent(0)).toBe('0%')
    expect(formatStoredPercent(45)).toBe('0.0045%')
    expect(formatStoredPercent(-25000)).toBe('-2.5%')
    expect(percentFigure(38750)).toBe('3.875')
  })
})

describe('rounding a money figure', () => {
  it('takes halves away from zero, so a refund rounds like its charge', () => {
    expect(roundHalfAway(25n, 10n)).toBe(3n)
    expect(roundHalfAway(-25n, 10n)).toBe(-3n)
    expect(roundHalfAway(24n, 10n)).toBe(2n)
    expect(roundHalfAway(-24n, 10n)).toBe(-2n)
    expect(roundHalfAway(233883n, 100n)).toBe(2339n)
    expect(roundHalfAway(0n, 7n)).toBe(0n)
  })
})

describe('the column', () => {
  it('stores the integer, shows the percent, and refuses outside its bounds', () => {
    const vat = PRICED.columns[2]
    if (vat === undefined) throw new Error('no vat')
    expect(coerceValue(vat, '17%', undefined)).toEqual({ ok: true, value: { vat: 170000 } })
    expect(coerceValue(vat, 12.5, undefined)).toEqual({ ok: true, value: { vat: 125000 } })
    const above = coerceValue(vat, '150', undefined)
    expect(above.ok).toBe(false)
    if (!above.ok) expect(above.error).toContain('above its maximum of 100%')
    const fifth = coerceValue(vat, '1.23456', undefined)
    expect(fifth.ok).toBe(false)
    expect(readValue(vat, row({ vat: 125000 }))).toBe('12.5%')
  })

  it('compiles to an INTEGER whose bounds are in millionths', () => {
    const sql = createTableSql(PRICED)
    expect(sql).toMatch(/"vat" INTEGER/)
    expect(sql).toContain('"vat" >= 0')
    expect(sql).toContain('"vat" <= 1000000')
  })

  it('needs language 15, takes no unit, and a bound it could hold', () => {
    const problems = (declaration: FormatDeclaration): string =>
      declarationProblems(declaration).map((each) => each.message).join(' | ')
    expect(problems(PRICED)).toBe('')
    expect(problems({ ...PRICED, language: 14 })).toContain('format language 15')
    expect(problems(format([column('vat', 'percent', { unit: 'g' })]))).toContain('a share')
    expect(problems(format([column('vat', 'percent', { maximum: 0.00001 })]))).toContain('could not hold')
    expect(problems(format([column('vat', 'percent', { scale: 2 })]))).toContain('only a decimal')
  })

  it('is written to a text document as it is shown, and read back to the integer', () => {
    const written = writeDocument({
      units: SEEDED_UNITS,
      formats: [{ declaration: PRICED, rows: [row({ name: 'Lamp', vat: 125000, price_minor: 1000, price_currency: 'ILS' })] }],
    })
    if (!written.ok) throw new Error(written.error)
    const text = written.value.map((part) => part.text).join('\n')
    expect(text).toContain('vat: 12.5%')
    const read = readDocument(written.value)
    if (!read.ok) throw new Error(read.error)
    expect(read.value.formats[0]?.rows[0]?.cells['vat']).toBe(125000)
    expect(read.value.formats[0]?.declaration.columns[2]?.type).toBe('percent')
  })
})

describe('in an identity', () => {
  const money = (minor: number) => ({ minor, currency: 'ILS' })
  const cells = (price: number, vat: number, total: number): StoredRow['cells'] => ({
    name: 'x',
    price_minor: money(price).minor,
    price_currency: 'ILS',
    vat,
    total_minor: money(total).minor,
    total_currency: 'ILS',
  })

  it('reads as its fraction, exactly: 100 agorot at 15% is 115, with no float drift', () => {
    // As doubles, 100 * (1 + 0.15) is 114.99999999999999; held exactly it is 115.
    expect(verdictOf(cells(100, 150000, 115))).toMatchObject({ kind: 'PROVED', left: 115, difference: 0 })
    expect(verdictOf(cells(1000, 170000, 1170))).toMatchObject({ kind: 'PROVED', difference: 0 })
    expect(verdictOf(cells(1000, 170000, 1171))).toMatchObject({ kind: 'FAILED', difference: 1 })
  })

  it('rounds a money side to the agora, halves away from zero', () => {
    // 1999 × 1.17 = 2338.83 → 2339.
    expect(verdictOf(cells(1999, 170000, 2339))).toMatchObject({ kind: 'PROVED', left: 2339 })
    expect(verdictOf(cells(1999, 170000, 2338)).kind).toBe('FAILED')
    // 10 × 1.25 = 12.5 → 13, and a refund of it −12.5 → −13.
    expect(verdictOf(cells(10, 250000, 13)).kind).toBe('PROVED')
    expect(verdictOf(cells(-10, 250000, -13)).kind).toBe('PROVED')
  })

  it('takes an agorot tolerance from the rounded figure', () => {
    const verdict = evaluateIdentity(
      identity('x', 'price * (1 + vat) = total', { tolerance: { kind: 'ABSOLUTE', amount: 1 } }),
      identityInputsOf(PRICED, row(cells(1999, 170000, 2338))),
    )
    expect(verdict).toMatchObject({ kind: 'PROVED', difference: 1, allowed: 1 })
  })

  it('compares exactly where no money is involved, with no rounding at all', () => {
    const rates = format(
      [column('a', 'percent'), column('b', 'percent'), column('sum', 'percent')],
      { nothingMustHold: false, identities: [identity('adds', 'a + b = sum')] },
    )
    // 0.1 + 0.2 is 0.30000000000000004 as doubles.
    const inputs = identityInputsOf(rates, row({ a: 100000, b: 200000, sum: 300000 }))
    expect(evaluateIdentity(identity('adds', 'a + b = sum'), inputs)).toMatchObject({
      kind: 'PROVED',
      difference: 0,
    })
    // A tolerance on a percent identity is in its fraction: a hundredth of a
    // point is 0.0001.
    const off = identityInputsOf(rates, row({ a: 100000, b: 200000, sum: 300100 }))
    expect(
      evaluateIdentity(identity('adds', 'a + b = sum', { tolerance: { kind: 'ABSOLUTE', amount: 0.0001 } }), off),
    ).toMatchObject({ kind: 'PROVED' })
    expect(evaluateIdentity(identity('adds', 'a + b = sum'), off).kind).toBe('FAILED')
  })

  it('reads a literal rate exactly too', () => {
    expect(verdictOf(cells(1000, 0, 1170), 'price * 1.17 = total').kind).toBe('PROVED')
  })
})
