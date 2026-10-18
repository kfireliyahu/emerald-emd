import { describe, expect, it } from 'vitest'
import { PACE, speedOf, travelAt } from './player.ts'
import { choiceOf, readingTime, rowOf, sceneAt, scenesOf, selectorOf, type TourStep } from './steps.ts'

describe('a tour is scenes: a dot per caption, not per row (P2)', () => {
  const steps: TourStep[] = [
    { action: 'say', caption: 'One' },
    { anchor: 'a', action: 'click', caption: 'Two', beside: 'paper.png' },
    { anchor: 'b', action: 'click' },
    { anchor: 'c', action: 'type', value: 'x' },
    { action: 'say', caption: 'Three' },
  ]

  it('gives each caption the rows up to the next one', () => {
    expect(scenesOf(steps)).toEqual([
      { caption: 'One', first: 0, last: 0 },
      { caption: 'Two', first: 1, last: 3, beside: 'paper.png' },
      { caption: 'Three', first: 4, last: 4 },
    ])
  })

  it('finds the scene a row belongs to, which is where a replay comes back to', () => {
    const scenes = scenesOf(steps)
    expect([0, 1, 2, 3, 4].map((step) => sceneAt(scenes, step))).toEqual([0, 1, 1, 1, 2])
  })

  it('refuses a tour whose first row says nothing', () => {
    expect(() => scenesOf([{ anchor: 'a', action: 'click' }])).toThrow(/starts with a caption/)
  })
})

describe('pacing (2026-10-07)', () => {
  it('holds a caption by its length, and only by its length', () => {
    expect(readingTime('a'.repeat(80))).toBeGreaterThan(readingTime('a'.repeat(20)))
    expect(readingTime('Create it.')).toBe(readingTime('Typed it.!'))
  })
})

describe('anchors', () => {
  it('reads a choice by its text and anything else as a data-tour name', () => {
    expect(choiceOf('choice:AMAZON.COM')).toBe('AMAZON.COM')
    expect(choiceOf('foot-price')).toBeUndefined()
    expect(rowOf('row:CORNER MARKET')).toBe('CORNER MARKET')
    expect(rowOf('choice:CORNER MARKET')).toBeUndefined()
    expect(selectorOf('foot-paid_with')).toBe('[data-tour="foot-paid_with"]')
  })
})

describe('the speed control (2026-10-07)', () => {
  it('keeps a speed inside half to twice, and anything else is 1', () => {
    expect([speedOf('0.5'), speedOf(2), speedOf('1.25')]).toEqual([0.5, 2, 1.25])
    expect([speedOf('3'), speedOf('0.1'), speedOf(null), speedOf('fast')]).toEqual([1, 1, 1, 1])
  })

  it("moves the ring's travel and the crop's pan with the holds", () => {
    expect(travelAt(1)).toBe(PACE.travel)
    expect(travelAt(2)).toBe(Math.round(PACE.travel / 2))
    expect(travelAt(0.5)).toBe(PACE.travel * 2)
  })
})
