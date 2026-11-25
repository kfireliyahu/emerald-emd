import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { judgeBudget, readBudget } from '../../scripts/budget.mjs'

import { limitsFor, overBudget, type Density } from './probe.ts'

/** A screen's measures, as `density()` reads them, with only what a budget limits. */
function screen(words: number, primary: number, screens: number): Density {
  return {
    words,
    wordsAboveFold: words,
    blocks: { count: 3, items: [] },
    blocksAboveFold: 2,
    figures: { count: 1, items: [] },
    actions: 12,
    primary,
    typeSizes: [12, 14, 16],
    colours: ['#000'],
    screens,
  } as unknown as Density
}

/** What the probe hands back for one route: its breaches measured against the budget's limits. */
function probed(route: string, d: Density, budget: ReturnType<typeof readBudget>) {
  return { route, theme: 'light', breaches: overBudget(d, limitsFor(budget.limits, route)) }
}

describe('the density budget (M64 U4, D-615)', () => {
  const budget = readBudget({
    limits: { '*': { primary: 1 }, '#/': { words: 300, screens: 1.5 }, '#/year': { words: 400 } },
    exempt: ['#/year'],
    tools: ['#/specimen'],
  })

  it('fails a screen over its limits, naming each one', () => {
    const verdict = judgeBudget([probed('#/', screen(512, 2, 2.1), budget)], budget)
    expect(verdict.failing).toEqual(['#/ · light: primary 2 > 1', '#/ · light: words 512 > 300', '#/ · light: screens 2.1 > 1.5'])
    expect(verdict.exempted).toEqual([])
  })

  it('passes a screen inside them', () => {
    expect(judgeBudget([probed('#/', screen(280, 1, 1.2), budget)], budget)).toEqual({ failing: [], exempted: [] })
  })

  it('reports a route not redesigned yet without failing, and never budgets a tool', () => {
    const verdict = judgeBudget([probed('#/year', screen(900, 3, 4), budget), probed('#/specimen', screen(5000, 9, 20), budget)], budget)
    expect(verdict.failing).toEqual([])
    expect(verdict.exempted).toEqual(['#/year · light: primary 3 > 1', '#/year · light: words 900 > 400'])
  })

  it('still reads the plain map of limits a budget was before, with nothing exempt', () => {
    const plain = readBudget({ '*': { primary: 1 } })
    expect(plain.exempt.size).toBe(0)
    expect(judgeBudget([probed('#/', screen(10, 2, 1), plain)], plain).failing).toEqual(['#/ · light: primary 2 > 1'])
  })

  it('refuses a file that is not a budget', () => {
    expect(() => readBudget([])).toThrow()
    expect(() => readBudget({ limits: {}, exempt: 'all' })).toThrow()
  })
})

/**
 * The routes U4 left exempt: every screen, since none is redesigned yet. **The
 * list only shrinks** — a unit that redesigns a route takes it off the file's
 * `exempt` and leaves this ceiling alone; a route back on the list fails here.
 */
const CEILING = [
  '#/', '#/year', '#/transactions', '#/transactions/merchants', '#/paychecks', '#/paychecks/deductions', '#/plan',
  '#/wealth', '#/wealth/funds', '#/wealth/goals', '#/wealth/debts', '#/categories', '#/categories/rules', '#/read',
  '#/paychecks/read', '#/read/readers', '#/settings/accounts', '#/settings/packs', '#/settings/model',
  '#/settings/calendar', '#/settings/language', '#/settings/export', '#/mcp', '#/formats', '#/formats/card_charge',
  '#/formats/unit', '#/formats/card_charge/entry/new', '#/formats/card_charge/input', '#/formats/unit/board',
  '#/formats/card_charge/list', '#/formats/unit/list', '#/formats/milestone/roadmap', '#/formats/unit/ready',
  '#/formats/card_charge/dashboard', '#/dashboard', '#/agenda', '#/connections', '#/formats/card_charge/read',
]

describe('docs/redesign/budget.json', () => {
  const file = readBudget(JSON.parse(readFileSync(new URL('../../docs/redesign/budget.json', import.meta.url), 'utf8')))

  it('names only measures, and every route it exempts has limits of its own', () => {
    const nothing = { words: 0, wordsAboveFold: 0, blocks: { count: 0, items: [] }, blocksAboveFold: 0, figures: { count: 0, items: [] }, actions: 0, primary: 0, typeSizes: [], colours: [], screens: 0 } as unknown as Density
    for (const [route, limits] of Object.entries(file.limits)) {
      expect(overBudget(nothing, limits), route).toEqual([])
    }
    for (const route of file.exempt) expect(file.limits[route], route).toBeDefined()
  })

  it('exempts no route the ceiling does not — the list only shrinks', () => {
    expect([...file.exempt].filter((route) => !CEILING.includes(route))).toEqual([])
  })

  it('holds every screen to one primary action, and leaves the specimen page out', () => {
    expect(file.limits['*']?.primary).toBe(1)
    expect([...file.tools]).toEqual(['#/specimen'])
  })
})
