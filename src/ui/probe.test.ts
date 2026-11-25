import { describe, expect, it } from 'vitest'
import {
  aaFor,
  colourKey,
  contrast,
  density,
  headingSkips,
  limitsFor,
  over,
  overBudget,
  parseColor,
  rampSizes,
  type Limits,
  type PageNode,
} from './probe.ts'

describe('how much a screen holds (M64 U2, D-612)', () => {
  const box = (top: number, height = 20, width = 200) => ({ top, bottom: top + height, width, height })
  const text = (tag: string, words: string, top: number, more: Partial<PageNode> = {}): PageNode => ({
    tag,
    text: words,
    size: 14,
    color: 'rgb(26, 26, 26)',
    background: 'rgba(0, 0, 0, 0)',
    ...box(top),
    children: [],
    ...more,
  })
  const row = (top: number, words: string): PageNode => ({ tag: 'tr', ...box(top), children: [text('td', words, top)] })
  const page: PageNode = {
    tag: 'main',
    background: 'rgb(255, 255, 255)',
    ...box(40, 1600, 1080),
    children: [
      text('h1', 'October 2026', 48, { size: 24 }),
      // A hero figure by its size, and its decimals in a smaller step beside it.
      {
        tag: 'p',
        ...box(90, 48),
        children: [text('span', '₪12,345', 90, { size: 40 }), text('span', '.67', 100, { size: 20, color: 'rgb(92, 92, 92)' })],
      },
      // A figure the markup names, whatever its size; its parts are one figure.
      { tag: 'div', figure: true, ...box(150), children: [text('span', '4', 150), text('span', 'rows', 150)] },
      text('h2', 'Where it went', 200, { size: 16 }),
      {
        tag: 'svg',
        label: 'Spending by month',
        ...box(230, 120, 600),
        children: [{ tag: 'path', paint: ['rgb(31, 122, 92)'], ...box(240, 100, 580), children: [] }],
      },
      // An icon is not a chart.
      { tag: 'svg', ...box(360, 16, 16), children: [] },
      {
        tag: 'table',
        ...box(400, 200, 1000),
        children: [
          row(400, 'Groceries ₪1,200'),
          row(440, 'Rent ₪5,200'),
          row(480, 'Fuel ₪300'),
          // A list inside a table is the table's, not a block of its own.
          { tag: 'ul', ...box(520, 60), children: [text('li', 'a', 520), text('li', 'b', 540), text('li', 'c', 560)] },
        ],
      },
      { tag: 'ul', ...box(620, 60), children: [text('li', 'one', 620), text('li', 'two', 640), text('li', 'three', 660)] },
      // Two rows are not a list.
      { tag: 'ul', ...box(700, 40), children: [text('li', 'four', 700), text('li', 'five', 720)] },
      text('button', 'Read', 760, { primary: true, background: 'rgb(31, 122, 92)', color: 'rgb(255, 255, 255)' }),
      text('a', 'Open the year', 780, { role: 'link', color: 'rgb(31, 122, 92)' }),
      text('button', 'Not now', 790),
      // Below the fold: counted, but not above it.
      text('h3', 'Later', 900, { size: 16 }),
      text('p', 'three more words', 1200),
      // Drawn nowhere: not counted.
      text('p', 'hidden words here', 0, { width: 0, height: 0, bottom: 0 }),
    ],
  }
  const d = density(page, 800)

  it('counts the words in the screen, and those above the fold', () => {
    // October 2026 · ₪12,345 · .67 · 4 rows · Where it went · three rows of two · a b c ·
    // one two three · four five · Read · Open the year · Not now · Later · three more words
    expect(d.words).toBe(2 + 1 + 1 + 2 + 3 + 6 + 3 + 3 + 2 + 1 + 3 + 2 + 1 + 3)
    expect(d.wordsAboveFold).toBe(d.words - 4)
  })

  it('counts a heading-led section, a table, a chart and a list of three rows as one block each', () => {
    expect(d.blocks.items.map((b) => `${b.kind}:${b.label}`)).toEqual([
      'section:Where it went',
      'chart:Spending by month',
      'table:Groceries ₪1,200 Rent ₪5,200 Fuel ₪300 a b c',
      'list:one two three',
      'section:Later',
    ])
    expect(d.blocksAboveFold).toBe(4)
  })

  it('finds the headline figures by their type step or their data-figure, one figure however many parts, and never a heading', () => {
    expect(d.figures.items).toEqual([
      { text: '₪12,345.67', size: 40 },
      { text: '4 rows', size: 0 },
    ])
  })

  it('counts the actions and the primary among them, the type sizes and the colours', () => {
    expect(d.actions).toBe(3)
    expect(d.primary).toBe(1)
    expect(d.typeSizes).toEqual([14, 16, 20, 24, 40])
    expect(d.colours).toEqual(['rgb(255, 255, 255)', 'rgb(26, 26, 26)', 'rgb(31, 122, 92)', 'rgb(92, 92, 92)'])
    // The last thing ends at 1640 px: two windows of 800 and a little.
    expect(d.screens).toBe(2.1)
  })

  it('names each limit a budget sets that a screen is over, the route’s own over every route’s', () => {
    const budget = { '*': { primary: 1, words: 1000 }, '#/': { words: 20, blocks: 9, screens: 1.5 } }
    expect(limitsFor(budget, '#/')).toEqual({ primary: 1, words: 20, blocks: 9, screens: 1.5 })
    expect(limitsFor(budget, '#/year')).toEqual({ primary: 1, words: 1000 })
    expect(overBudget(d, limitsFor(budget, '#/'))).toEqual([`words ${String(d.words)} > 20`, 'screens 2.1 > 1.5'])
    expect(overBudget(d, limitsFor(budget, '#/year'))).toEqual([])
    expect(overBudget(d, { wrods: 10 } as Limits)[0]).toMatch(/^wrods is not a measure/)
  })

  it('spells a colour one way, and drops what paints nothing', () => {
    expect(colourKey('rgb(10 20 30 / 0.5)')).toBe('rgba(10, 20, 30, 0.5)')
    expect(colourKey('rgba(0, 0, 0, 0)')).toBeNull()
    expect(colourKey(undefined)).toBeNull()
  })
})

describe('the probe’s arithmetic', () => {
  it('reads the colours a browser computes', () => {
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 })
    expect(parseColor('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 })
    expect(parseColor('rgb(10 20 30 / 0.25)')).toEqual({ r: 10, g: 20, b: 30, a: 0.25 })
    expect(parseColor('transparent')).toBeNull()
  })

  it('works out WCAG’s ratio, and lays a translucent colour over its backdrop', () => {
    const black = { r: 0, g: 0, b: 0, a: 1 }
    const white = { r: 255, g: 255, b: 255, a: 1 }
    expect(contrast(black, white)).toBeCloseTo(21, 5)
    expect(contrast(white, white)).toBeCloseTo(1, 5)
    expect(contrast({ r: 118, g: 118, b: 118, a: 1 }, white)).toBeCloseTo(4.54, 1)
    expect(over({ ...black, a: 0.5 }, white)).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 })
  })

  it('asks 3 of large text and 4.5 of the rest', () => {
    expect(aaFor(14, 400)).toBe(4.5)
    expect(aaFor(24, 400)).toBe(3)
    expect(aaFor(19, 700)).toBe(3)
    expect(aaFor(19, 600)).toBe(4.5)
  })

  it('takes the ramp from the size properties alone', () => {
    expect(
      rampSizes([
        ['--text-body', '14px'],
        ['--text-body--line-height', '1.5'],
        ['--text-label', ' 11px '],
        ['--text-caption', '12px'],
        ['--text-body', '14px'],
        ['--color-ink', '#000'],
      ]),
    ).toEqual([11, 12, 14])
  })

  it('names the heading levels that skip one', () => {
    expect(headingSkips([1, 2, 3, 2, 4])).toEqual(['h2 → h4'])
    expect(headingSkips([2, 3, 3])).toEqual([])
  })
})
