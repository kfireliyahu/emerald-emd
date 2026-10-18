import { describe, expect, it } from 'vitest'

import { inView, planFlip, type Box } from '@/ui/motion/flip.ts'
import { motionOn } from '@/ui/motion/motion.ts'
import { screenOf } from '@/ui/screens/ListDetail.tsx'

const row = (top: number): Box => ({ left: 0, top, width: 400, height: 30 })
const boxes = (entries: Record<string, number>): Map<string, Box> =>
  new Map(Object.entries(entries).map(([key, top]) => [key, row(top)]))

describe('planFlip — M39 U1', () => {
  it('a row added: it grows in, and the rows below play back from where they were', () => {
    const before = boxes({ a: 0, b: 30, c: 60 })
    const after = boxes({ a: 0, new: 30, b: 60, c: 90 })
    const plan = planFlip({ before, after, existed: new Set(before.keys()), crowd: 3 })
    expect(plan.enters).toEqual(['new'])
    expect(plan.exits).toEqual([])
    // `a` did not move, so it does not animate at all.
    expect(plan.moves).toEqual([
      { key: 'b', dx: 0, dy: -30 },
      { key: 'c', dx: 0, dy: -30 },
    ])
  })

  it('a row removed: it shrinks out, and the rows below slide up into its place', () => {
    const before = boxes({ a: 0, b: 30, c: 60 })
    const after = boxes({ a: 0, c: 30 })
    const plan = planFlip({ before, after, existed: new Set(before.keys()), crowd: 3 })
    expect(plan.exits).toEqual(['b'])
    expect(plan.moves).toEqual([{ key: 'c', dx: 0, dy: 30 }])
  })

  it('a crowd is a list replaced, and nothing moves at all', () => {
    const before = boxes({ a: 0, b: 30, c: 60, d: 90, e: 120 })
    const after = boxes({ a: 0 })
    const plan = planFlip({ before, after, existed: new Set(before.keys()), crowd: 3 })
    expect(plan).toEqual({ moves: [], enters: [], exits: [] })
  })

  it('a row scrolled into view by a removal is not new, and is not grown in', () => {
    const before = boxes({ a: 0, b: 30 })
    const after = boxes({ b: 0, c: 30 })
    const plan = planFlip({ before, after, existed: new Set(['a', 'b', 'c']), crowd: 3 })
    expect(plan.enters).toEqual([])
    expect(plan.exits).toEqual(['a'])
  })

  it('a cell plays only its own move, not the row it sits in', () => {
    const before = new Map<string, Box>([
      ['row', { left: 0, top: 30, width: 400, height: 30 }],
      ['cell', { left: 100, top: 30, width: 100, height: 30 }],
    ])
    const after = new Map<string, Box>([
      ['row', { left: 0, top: 60, width: 400, height: 30 }],
      ['cell', { left: 100, top: 60, width: 100, height: 30 }],
    ])
    const plan = planFlip({ before, after, existed: new Set(before.keys()), crowd: 3, parents: new Map([['cell', 'row']]) })
    expect(plan.moves).toEqual([{ key: 'row', dx: 0, dy: -30 }])
  })

  it('less than half a pixel is rounding, not a move', () => {
    const plan = planFlip({ before: boxes({ a: 0 }), after: boxes({ a: 0.3 }), existed: new Set(['a']), crowd: 3 })
    expect(plan.moves).toEqual([])
  })
})

describe('inView', () => {
  const view: Box = { left: 0, top: 100, width: 800, height: 300 }
  it('measures what you can see and one margin either side, and nothing further', () => {
    expect(inView(row(150), view, 50)).toBe(true)
    expect(inView(row(440), view, 50)).toBe(true)
    expect(inView(row(460), view, 50)).toBe(false)
    expect(inView(row(10), view, 50)).toBe(false)
  })
})

describe('the switch', () => {
  it('moves nothing where nothing can be animated', () => {
    // No DOM here: all four motions are on everywhere else (U3), and off under reduced motion.
    expect(motionOn()).toBe(false)
  })
})

describe('navigating (M39 U3)', () => {
  it('keys a list’s detail pane to the list, so opening it is not a new screen', () => {
    expect(screenOf('/wealth/funds/3')).toBe('/wealth/funds')
    expect(screenOf('/wealth/goals/7')).toBe('/wealth/goals')
    expect(screenOf('/wealth/debts/2')).toBe('/wealth/debts')
    expect(screenOf('/wealth/funds')).toBe('/wealth/funds')
  })

  it('keys an entry to its format’s list, so paging keeps the list (M37 U2b)', () => {
    expect(screenOf('/formats/book/entry/0c0af4de')).toBe('/formats/book/entry')
    expect(screenOf('/formats/book/entry/new')).toBe('/formats/book/entry')
    expect(screenOf('/formats/book')).toBe('/formats/book')
  })

  it('leaves every other address its own screen', () => {
    expect(screenOf('/wealth/fees')).toBe('/wealth/fees')
    expect(screenOf('/formats/recipe')).toBe('/formats/recipe')
    expect(screenOf('/wealth/fundsX/3')).toBe('/wealth/fundsX/3')
  })
})
