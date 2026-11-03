import { describe, expect, it } from 'vitest'
import { aaFor, contrast, headingSkips, over, parseColor, rampSizes } from './probe.ts'

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
