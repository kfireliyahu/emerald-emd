import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import type { RollupGroup } from '@/domain/format/rollup.ts'

import { MOST_SERIES, rollupChart } from './rollupChart.ts'

const group = (period: string | undefined, by: string | undefined, figures: RollupGroup['value'], rows = 1): RollupGroup => ({
  period,
  by,
  rows,
  value: figures,
})
const ils = (minor: number): RollupGroup['value'] => ({ kind: 'VALUE', figures: [{ value: minor, currency: 'ILS' }] })
const plain = (value: number): RollupGroup['value'] => ({ kind: 'VALUE', figures: [{ value }] })
const options = { names: new Map([['c1', 'Food'], ['c2', 'Rent']]), by: false, name: 'spent' }

describe('rollupChart: a rollup as the general chart’s series', () => {
  it('draws a month per label, first to last, with the months between as gaps', () => {
    const chart = rollupChart([group('2026-03', undefined, ils(300)), group('2026-01', undefined, ils(100))], options)
    expect(chart.labels).toEqual(['January 2026', 'February 2026', 'March 2026'])
    expect(chart.ticks).toEqual(['Jan 2026', 'Feb 2026', 'Mar 2026'])
    expect(chart.series).toHaveLength(1)
    expect(chart.series[0]?.name).toBe('spent')
    expect(chart.series[0]?.points).toEqual([money(100, 'ILS'), undefined, money(300, 'ILS')])
    expect(chart.axis).toEqual({ currency: 'ILS' })
    expect(chart.left).toEqual([])
  })

  it('draws one series per linked row, and "none" for the rows with no link', () => {
    const chart = rollupChart(
      [group('2026-01', 'c1', ils(100)), group('2026-01', 'c2', ils(4000)), group('2026-02', undefined, ils(7))],
      { ...options, by: true },
    )
    expect(chart.series.map((each) => [each.name, each.key])).toEqual([
      ['Food', 'c1'],
      ['Rent', 'c2'],
      ['none', ''],
    ])
    expect(chart.series[0]?.points).toEqual([money(100, 'ILS'), undefined])
    expect(chart.series[2]?.points).toEqual([undefined, money(7, 'ILS')])
  })

  it('says an unchecked group as the word, never as a number', () => {
    const chart = rollupChart(
      [group('2026-01', undefined, { kind: 'UNCHECKED', reason: 'Row 3 has nothing in amount.' }), group('2026-02', undefined, ils(5))],
      options,
    )
    expect(chart.series[0]?.points[0]).toEqual({ said: 'unchecked' })
  })

  it('draws a count as a plain figure in its unit', () => {
    const chart = rollupChart([group('2026-01', undefined, plain(4))], { ...options, unit: 'rows' })
    expect(chart.axis).toEqual({ unit: 'rows' })
    expect(chart.series[0]?.points).toEqual([4])
  })

  it('draws the currency most figures are in, and says the rest are in the table', () => {
    const chart = rollupChart(
      [
        group('2026-01', undefined, { kind: 'VALUE', figures: [{ value: 100, currency: 'ILS' }, { value: 9, currency: 'USD' }] }),
        group('2026-02', undefined, ils(200)),
        group('2026-03', undefined, { kind: 'VALUE', figures: [{ value: 5, currency: 'USD' }] }),
      ],
      options,
    )
    expect(chart.axis).toEqual({ currency: 'ILS' })
    expect(chart.series[0]?.points).toEqual([money(100, 'ILS'), money(200, 'ILS'), { said: 'only in USD' }])
    expect(chart.left).toContain('The chart draws ILS; figures in USD are in the table.')
  })

  it('leaves the rows with no month to the table, and says so', () => {
    const chart = rollupChart([group('2026-01', undefined, ils(1)), group(undefined, undefined, ils(2), 3)], options)
    expect(chart.labels).toEqual(['January 2026'])
    expect(chart.left).toEqual(['3 rows have no month, so they are in the table and not the chart.'])
  })

  it('draws the largest series and says how many it left out, summing none of them', () => {
    const groups = Array.from({ length: MOST_SERIES + 3 }, (_, index) => group('2026-01', `r${String(index)}`, ils((index + 1) * 100)))
    const chart = rollupChart(groups, { ...options, by: true })
    expect(chart.series).toHaveLength(MOST_SERIES)
    expect(chart.series.map((each) => each.key)).not.toContain('r0')
    expect(chart.series.map((each) => each.key)).toContain(`r${String(MOST_SERIES + 2)}`)
    expect(chart.left).toEqual([`The ${String(MOST_SERIES)} largest of ${String(MOST_SERIES + 3)} are drawn; every one is in the table.`])
  })

  it('has nothing to draw for a rollup with no month at all', () => {
    const chart = rollupChart([group(undefined, undefined, ils(2))], options)
    expect(chart.labels).toEqual([])
  })
})
