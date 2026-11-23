import { describe, expect, it } from 'vitest'

import { column } from './declaration.ts'
import { cellValue, exportText, moneyText } from './export.ts'

/** The figures written from their digits, never through a float (M63 U1, D-601). */
describe('export values', () => {
  const row = (cells: Record<string, number | string>) => ({ id: 'r', cells })

  it('writes a percent as the fraction from its stored digits', () => {
    const fee = column('fee', 'percent')
    const spelled = (stored: number): string => exportText(cellValue(fee, row({ fee: stored })) ?? null)
    expect(spelled(125000)).toBe('0.125\n')
    expect(spelled(45)).toBe('0.000045\n')
    expect(spelled(1)).toBe('0.000001\n')
    expect(spelled(1_000_000)).toBe('1\n')
    expect(spelled(-2_500_000)).toBe('-2.5\n')
    expect(spelled(0)).toBe('0\n')
  })

  it('writes a decimal from its digits, and money at its currency’s places', () => {
    const rate = column('rate', 'decimal', { scale: 4 })
    expect(exportText(cellValue(rate, row({ rate: 31250 })) ?? null)).toBe('3.125\n')
    expect(exportText(cellValue(column('n', 'decimal', { scale: 0 }), row({ n: 35 })) ?? null)).toBe('35\n')
    expect(moneyText(1290, 'ILS')).toBe('12.90')
    expect(moneyText(-5, 'USD')).toBe('-0.05')
    expect(moneyText(1200, 'JPY')).toBe('1200')
  })

  it('spells an empty array and an empty object on one line', () => {
    expect(exportText([])).toBe('[]\n')
    expect(exportText([{ kind: 'object', entries: [] }])).toBe('[\n  {}\n]\n')
  })
})
