import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { SPECIMENS } from '@/ui/screens/specimens.tsx'

import { HeadlineFigure } from './HeadlineFigure.tsx'
import { barPercent, DISPLAYS, moneyParts, share, wholeMoney } from './kit.ts'
import { MonthFlow } from './MonthFlow.tsx'
import { MonthStrip } from './MonthStrip.tsx'
import { MonthTrend } from './MonthTrend.tsx'
import { PartOfWhole } from './PartOfWhole.tsx'
import { PlanAgainst } from './PlanAgainst.tsx'
import { RankedBars } from './RankedBars.tsx'
import { Sparkline } from './Sparkline.tsx'

const ils = (major: number) => money(Math.round(major * 100), 'ILS')
const html = (element: ReactElement) => renderToStaticMarkup(element)
const EMPTY = 'Nothing here this month.'
const month = (index: number) => ({ key: String(index), label: `M${String(index)}`, long: `Month ${String(index)}` })
const whole = (value: number) => wholeMoney(ils(value))

describe('the kit’s arithmetic', () => {
  it('splits a figure so its symbol and decimals can be set smaller, with a true minus', () => {
    expect(moneyParts(ils(-1234.5))).toEqual({ sign: '−', symbol: '₪', whole: '1,234', fraction: '.50' })
    expect(moneyParts(money(500, 'JPY'))).toMatchObject({ whole: '500', fraction: '' })
    expect(wholeMoney(ils(1234.5))).toBe('₪1,235')
    expect(wholeMoney(ils(-0.4))).toBe('₪0')
  })

  it('never draws a share of nothing, and never hides a small value', () => {
    expect(share(1, 0)).toBe(0)
    expect(share(1, 3)).toBe(33)
    expect(barPercent(0, 100)).toBe(0)
    expect(barPercent(0.1, 100)).toBe(2)
    expect(barPercent(-50, 100)).toBe(50)
  })
})

/** Each display, empty and negative: the empty one says the caller's sentence, the negative one keeps its sign. */
const CASES: Record<string, { readonly empty: ReactElement; readonly negative: ReactElement; readonly says: RegExp }> = {
  HeadlineFigure: {
    empty: createElement(HeadlineFigure, { label: 'Taxes', value: undefined, empty: EMPTY }),
    negative: createElement(HeadlineFigure, { label: 'Left over', value: ils(-1240.75), size: 'display', empty: EMPTY }),
    says: /−/,
  },
  Sparkline: {
    empty: createElement('p', null, createElement(Sparkline, { values: [3] }), EMPTY),
    negative: createElement(Sparkline, { values: [-3, -1, -2] }),
    says: /<path d="M/,
  },
  RankedBars: {
    empty: createElement(RankedBars, { rows: [], empty: EMPTY }),
    negative: createElement(RankedBars, { rows: [{ key: 'a', name: 'Returns', value: ils(-310) }], empty: EMPTY }),
    says: /−₪310\.00/,
  },
  PartOfWhole: {
    empty: createElement(PartOfWhole, { parts: [], label: 'Saved', empty: EMPTY }),
    negative: createElement(PartOfWhole, { parts: [{ key: 'a', name: 'Car fund', value: ils(-2000), hue: 'category-2' }], label: 'Saved', empty: EMPTY }),
    says: /−₪2,000\.00/,
  },
  PlanAgainst: {
    empty: createElement(PlanAgainst, { lines: [], empty: EMPTY }),
    negative: createElement(PlanAgainst, { lines: [{ key: 'a', name: 'Clothes', actual: ils(-120), planned: ils(400) }], empty: EMPTY }),
    says: /−₪120/,
  },
  MonthTrend: {
    empty: createElement(MonthTrend, { months: [], series: [], label: 'By month', empty: EMPTY, format: whole, tick: whole }),
    negative: createElement(MonthTrend, { months: [month(1), month(2)], series: [{ key: 'l', name: 'Left over', values: [-500, 200] }], label: 'By month', empty: EMPTY, format: whole, tick: whole }),
    says: /−₪500/,
  },
  MonthStrip: {
    empty: createElement(MonthStrip, { months: [], open: 0, label: 'By month', empty: EMPTY, format: whole, onOpen: () => undefined }),
    negative: createElement(MonthStrip, { months: [{ ...month(1), value: -500 }, { ...month(2), value: 300 }], open: 0, label: 'By month', empty: EMPTY, format: whole, onOpen: () => undefined }),
    says: /−₪500/,
  },
  MonthFlow: {
    empty: createElement(MonthFlow, { whole: { label: 'Came in', value: ils(0) }, parts: [], left: 'Left over', empty: EMPTY }),
    negative: createElement(MonthFlow, { whole: { label: 'Came in', value: ils(6200) }, parts: [{ key: 's', label: 'Spent', value: ils(7400) }], left: 'Left over', empty: EMPTY }),
    says: /−₪1,200\.00.*over/s,
  },
}

describe('every display of the kit (M64 U4, D-615)', () => {
  it('has a case here, a when-to-use and a specimen', () => {
    expect(Object.keys(CASES)).toEqual(DISPLAYS.map((display) => display.name))
    for (const display of DISPLAYS) {
      expect(display.use.length, display.name).toBeGreaterThan(20)
      expect(display.not.length, display.name).toBeGreaterThan(10)
      expect(SPECIMENS.some((specimen) => specimen.name === display.name), display.name).toBe(true)
    }
  })

  for (const [name, each] of Object.entries(CASES)) {
    it(`${name} says the caller’s one sentence when empty, and keeps a negative’s sign`, () => {
      expect(html(each.empty)).toContain(EMPTY)
      expect(html(each.negative)).toMatch(each.says)
      expect(html(each.negative)).not.toContain(EMPTY)
    })
  }

  it('says over in words, not in red alone', () => {
    const over = html(createElement(PlanAgainst, { lines: [{ key: 'a', name: 'Eating out', actual: ils(960), planned: ils(700) }], empty: EMPTY }))
    expect(over).toContain('₪260 over')
    expect(over).toContain('text-negative')
  })

  it('draws every specimen state of the page without throwing', () => {
    for (const specimen of SPECIMENS) for (const state of specimen.states) expect(() => html(createElement('div', null, state.render()))).not.toThrow()
  })
})
