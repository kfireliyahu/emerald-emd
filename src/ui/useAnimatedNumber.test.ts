import { describe, expect, it } from 'vitest'

import { COUNT_DURATION_MS, countAt, easeOut } from './useAnimatedNumber.ts'

/**
 * The arithmetic half of the count-up. The hook itself needs a DOM and a frame
 * clock and this suite has neither by design, so what is tested here is the
 * part that can be wrong in a way a person would not see: the last frame, the
 * rounding, and the direction.
 */
describe('the count-up curve', () => {
  it('starts at nothing and ends at everything', () => {
    expect(easeOut(0)).toBe(0)
    expect(easeOut(1)).toBe(1)
  })

  it('is ahead of linear the whole way — fast first, settling', () => {
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(easeOut(t)).toBeGreaterThan(t)
    }
  })

  it('clamps rather than overshooting, because a figure never passes its value', () => {
    expect(easeOut(1.5)).toBe(1)
    expect(easeOut(-0.5)).toBe(0)
  })
})

describe('where a count is at', () => {
  it('is the old value before the first frame', () => {
    expect(countAt(1000, 5000, 0)).toBe(1000)
  })

  it('is the target exactly at the end, not near it', () => {
    expect(countAt(1000, 5000, COUNT_DURATION_MS)).toBe(5000)
    expect(countAt(1000, 5000, COUNT_DURATION_MS + 40)).toBe(5000)
  })

  it('never lands an agora short — every frame is a whole minor unit', () => {
    for (let elapsed = 0; elapsed <= COUNT_DURATION_MS; elapsed += 7) {
      expect(Number.isInteger(countAt(0, 123_457, elapsed))).toBe(true)
    }
  })

  it('counts down as readily as up', () => {
    const half = countAt(5000, 1000, COUNT_DURATION_MS / 2)
    expect(half).toBeLessThan(5000)
    expect(half).toBeGreaterThan(1000)
  })

  it('crosses zero without stopping there — a balance can go negative', () => {
    const half = countAt(2000, -2000, COUNT_DURATION_MS / 2)
    expect(half).toBeLessThan(0)
    expect(countAt(2000, -2000, COUNT_DURATION_MS)).toBe(-2000)
  })

  it('moves monotonically, so no frame reads as a bounce', () => {
    let previous = countAt(0, 90_000, 0)
    for (let elapsed = 1; elapsed <= COUNT_DURATION_MS; elapsed += 1) {
      const value = countAt(0, 90_000, elapsed)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
    expect(previous).toBe(90_000)
  })

  it('snaps when there is no duration to spend', () => {
    expect(countAt(1000, 5000, 0, 0)).toBe(5000)
  })
})
