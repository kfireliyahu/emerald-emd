import { describe, expect, it } from 'vitest'

import type { MonthSummary } from '@/domain/model/statistics.ts'
import {
  chartEnd,
  monthsEndingAt,
  monthsOfYear,
  neighbour,
  newestWithData,
  signedPercent,
  taxVersusAverage,
  versusAverage,
  yearsWithData,
} from './months.ts'

const ym = (year: number, month: number) => ({ year, month })
const ils = (minor: number) => ({ minor, currency: 'ILS' })

function month(year: number, m: number, expenses: number): MonthSummary {
  return {
    period: ym(year, m),
    income: ils(1_000_000),
    expenses: ils(expenses),
    balance: ils(1_000_000 - expenses),
    saved: ils(0),
    savingsRateBasisPoints: 0,
    transactionCount: 10,
    isComplete: true,
  }
}

const SUMMARIES = [month(2025, 11, 100_000), month(2026, 1, 100_000), month(2026, 2, 100_000), month(2026, 3, 110_000)]

describe('Home’s months', () => {
  it('opens on the newest month that has data, and pages over the months that exist', () => {
    expect(newestWithData(SUMMARIES)).toEqual(ym(2026, 3))
    expect(newestWithData([])).toBeUndefined()
    expect(neighbour(SUMMARIES, ym(2026, 1), -1)).toEqual(ym(2025, 11))
    expect(neighbour(SUMMARIES, ym(2026, 3), 1)).toBeUndefined()
  })

  it('ends the chart at the newest month unless the month open is further back', () => {
    expect(chartEnd(ym(2026, 3), ym(2026, 3))).toEqual(ym(2026, 3))
    expect(chartEnd(ym(2024, 1), ym(2026, 3))).toEqual(ym(2024, 8))
    expect(monthsEndingAt(ym(2026, 2), 3)).toEqual([ym(2025, 12), ym(2026, 1), ym(2026, 2)])
  })

  it('a year is January to December', () => {
    expect(monthsOfYear(2026)).toHaveLength(12)
    expect(monthsOfYear(2026)[0]).toEqual(ym(2026, 1))
    expect(yearsWithData(SUMMARIES)).toEqual([2025, 2026])
  })

  it('compares a figure with the average of the three complete months before it', () => {
    expect(versusAverage(SUMMARIES, ym(2026, 3), 'expenses')).toBe(10)
    expect(versusAverage(SUMMARIES, ym(2026, 2), 'expenses')).toBeUndefined()
    expect(signedPercent(10)).toBe('+10%')
    expect(signedPercent(-3)).toBe('−3%')
  })

  it('compares taxes with the three slips before, and says nothing without three', () => {
    const taxes = new Map([
      ['2026-01', ils(500_00)],
      ['2026-02', ils(500_00)],
      ['2026-03', ils(500_00)],
      ['2026-04', ils(550_00)],
    ])
    expect(taxVersusAverage(taxes, ym(2026, 4), 'ILS')).toBe(10)
    expect(taxVersusAverage(taxes, ym(2026, 3), 'ILS')).toBeUndefined()
    expect(taxVersusAverage(taxes, ym(2026, 5), 'ILS')).toBeUndefined()
  })
})
