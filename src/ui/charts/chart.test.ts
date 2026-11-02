import { readdirSync, readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'

import { Chart } from './Chart.tsx'
import { axisSpan, drawnValue, niceTicks, pointText, seriesColors, shortText, type ChartSeries } from './chart.ts'

const ILS = { currency: 'ILS' } as const

describe('drawnValue: money is a number only where it is drawn', () => {
  it('draws money in the axis’s currency in major units', () => {
    expect(drawnValue(money(123_450, 'ILS'), ILS)).toBe(1234.5)
    expect(drawnValue(money(500, 'JPY'), { currency: 'JPY' })).toBe(500)
  })

  it('draws nothing it would have to lie about', () => {
    expect(drawnValue(money(100, 'USD'), ILS)).toBeUndefined()
    expect(drawnValue(12, ILS)).toBeUndefined()
    expect(drawnValue(money(100, 'ILS'), { unit: 'rows' })).toBeUndefined()
    expect(drawnValue({ said: 'unchecked' }, ILS)).toBeUndefined()
    expect(drawnValue(undefined, ILS)).toBeUndefined()
    expect(drawnValue(Number.NaN, {})).toBeUndefined()
  })

  it('draws a plain figure on a plain axis', () => {
    expect(drawnValue(3, { unit: 'rows' })).toBe(3)
    expect(drawnValue(-2.5, {})).toBe(-2.5)
  })
})

describe('what a person reads', () => {
  it('says a point in full', () => {
    expect(pointText(money(123_450, 'ILS'), ILS)).toBe('₪1,234.50')
    expect(pointText(12, { unit: 'rows' })).toBe('12 rows')
    // A count in the format's word, one and many (M54 F3), and bare on a bar or a tick.
    const units = { count: { one: 'unit', many: 'units' } }
    expect(pointText(1, units)).toBe('1 unit')
    expect(pointText(2, units)).toBe('2 units')
    expect(shortText(2, units)).toBe('2')
    expect(pointText(0.1 + 0.2, {})).toBe('0.3')
    expect(pointText({ said: 'unchecked' }, ILS)).toBe('unchecked')
    expect(pointText(undefined, ILS)).toBe('nothing')
  })

  it('says a drawn value short, for a tick or a bar', () => {
    expect(shortText(1234.5, ILS)).toBe('₪1.2k')
    expect(shortText(-40, ILS)).toBe('-₪40')
    expect(shortText(25_000, ILS)).toBe('₪25k')
    expect(shortText(3_400_000, { unit: 'kg' })).toBe('3.4M kg')
    expect(shortText(0.5, {})).toBe('0.5')
  })
})

describe('the axis', () => {
  it('takes round ticks around the figures', () => {
    expect(niceTicks(0, 100, 4)).toEqual([0, 50, 100])
    expect(niceTicks(0, 0.3, 3)).toEqual([0, 0.1, 0.2, 0.3])
    expect(niceTicks(-30, 70, 4)).toEqual([-50, 0, 50, 100])
    expect(niceTicks(0, 1234, 4)).toEqual([0, 500, 1000, 1500])
    expect(niceTicks(5, 5)).toEqual([5])
  })

  it('stands bars on zero and lets a line span only what it shows', () => {
    const bars = axisSpan([40, 60], 'bars')
    expect(bars.low).toBe(0)
    expect(bars.high).toBeGreaterThanOrEqual(60)
    const line = axisSpan([40, 60], 'line')
    expect(line.low).toBeGreaterThan(0)
    expect(line.low).toBeLessThanOrEqual(40)
    expect(line.high).toBeGreaterThanOrEqual(60)
  })

  it('ticks a count in whole numbers (M54 F3)', () => {
    for (const ticks of [axisSpan([1, 1, 2], 'line', true).ticks, axisSpan([1], 'line', true).ticks, axisSpan([0, 3], 'bars', true).ticks]) {
      expect(ticks.every((tick) => Number.isInteger(tick))).toBe(true)
    }
  })

  it('has a span when every figure is the same, or zero', () => {
    for (const kind of ['bars', 'line'] as const) {
      for (const values of [[0], [7, 7], [-3]]) {
        const span = axisSpan(values, kind)
        expect(span.high).toBeGreaterThan(span.low)
      }
    }
  })
})

describe('colours', () => {
  const series = (...keys: string[]): ChartSeries[] => keys.map((key) => ({ name: key, key, points: [] }))

  it('draws one series in ink, never a hue', () => {
    expect(seriesColors(series('food'))).toEqual(['var(--color-ink-secondary)'])
  })

  it('gives several series different hues while there are hues to go round', () => {
    const keys = Array.from({ length: 11 }, (_, index) => `row-${String(index)}`)
    const colors = seriesColors(series(...keys))
    expect(new Set(colors).size).toBe(11)
    for (const color of colors) expect(color).toMatch(/^var\(--color-category-\d+\)$/)
  })

  it('keeps a series’ colour whatever order they come in, and draws none in grey', () => {
    const one = seriesColors(series('a', 'b', '', 'c'))
    const other = seriesColors(series('c', '', 'b', 'a'))
    expect(one[0]).toBe(other[3])
    expect(one[3]).toBe(other[0])
    expect(one[2]).toBe('var(--color-category-none)')
  })
})

describe('Chart', () => {
  const render = (kind: 'bars' | 'line', series: ChartSeries[]): string =>
    renderToStaticMarkup(
      createElement(Chart, {
        labels: ['January 2026', 'February 2026', 'March 2026'],
        ticks: ['Jan 2026', 'Feb 2026', 'Mar 2026'],
        series,
        axis: ILS,
        kind,
        title: 'spent by month',
        labelHeading: 'month',
      }),
    )
  const two: ChartSeries[] = [
    { name: 'Food', key: 'f', points: [money(10_000, 'ILS'), undefined, money(30_000, 'ILS')] },
    { name: 'Rent', key: 'r', points: [money(400_000, 'ILS'), { said: 'unchecked' }, money(400_000, 'ILS')] },
  ]

  it('draws bars as rects and a line as paths, the picture hidden from a screen reader', () => {
    const bars = render('bars', two)
    expect(bars.match(/class="fc-grow"/g)).toHaveLength(4)
    expect(bars).toContain('aria-hidden="true"')
    const line = render('line', two)
    expect(line.match(/class="fc-draw"/g)).toHaveLength(2)
    expect(line).not.toContain('fc-grow')
  })

  it('is read as a table: every label, every series, every point in full', () => {
    const html = render('bars', two)
    const table = /<table[^>]*>(.*)<\/table>/.exec(html)?.[1] ?? ''
    expect(table).toContain('<caption class="sr-only">spent by month</caption>')
    expect(table).toContain('<span class="sr-only">month</span>')
    expect(table).toContain('<span class="sr-only">February 2026</span>')
    expect(table).toContain('Food')
    expect(table).toContain('Rent')
    expect(table).toContain('nothing</td>')
    expect(table).toContain('unchecked</td>')
    expect(table).toContain('₪4,000.00')
  })

  it('draws nothing when nothing can be drawn', () => {
    expect(render('bars', [{ name: 'x', points: [undefined, { said: 'unchecked' }, money(1, 'USD')] }])).toBe('')
  })

  // *Every chart has its numbers* and *Charts are ink, labelled directly* (M54 F3).
  it('labels every bar, and says the figures beneath whenever the picture does not', () => {
    const one = render('bars', [two[1] as ChartSeries])
    expect(one.match(/class="fc-chart-val"/g)).toHaveLength(2)
    expect(one).toContain('<div class="sr-only"><table')
    // Several series, or a line: the figures are a table anybody can read.
    expect(render('bars', two)).toContain('<div class="mt-1 overflow-x-auto"><table')
    expect(render('line', [two[1] as ChartSeries])).toContain('<div class="mt-1 overflow-x-auto"><table')
  })

  it('names each of several lines at its end', () => {
    const line = render('line', two)
    expect(line).toMatch(/<text class="fc-col-tick"[^>]*>Food<\/text>/)
    expect(line).toMatch(/<text class="fc-col-tick"[^>]*>Rent<\/text>/)
  })
})

/**
 * **The general chart knows no ledger** (M53 U6's done-test): nothing in
 * `src/ui/charts/` imports from the pack — only the layer below both, the
 * theme's own palette names, and the bidi isolation every name needs.
 */
const ALLOWED = new Set(['react', '@/core/money.ts', '@/domain/categoryColors.ts', '@/ui/Bidi.tsx'])

describe('the chart’s edges', () => {
  it('imports nothing from the ledger pack', () => {
    const here = new URL('.', import.meta.url)
    for (const file of readdirSync(here).filter((name) => /\.tsx?$/.test(name) && !name.includes('.test.'))) {
      const source = readFileSync(new URL(file, here), 'utf8')
      for (const [, specifier] of source.matchAll(/from\s+'([^']+)'/g)) {
        if (specifier === undefined || specifier.startsWith('./')) continue
        expect(ALLOWED, `${file} imports ${specifier}`).toContain(specifier)
      }
    }
  })
})
