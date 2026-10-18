import { describe, expect, it } from 'vitest'

import {
  barPoint,
  fractionAt,
  morphPoint,
  ringDims,
  ringPoint,
  segmentPath,
  unwrapFraction,
} from '@/ui/plan/ringGeometry.ts'
import { parsePlanView } from '@/ui/plan/usePlanView.ts'

const dims = ringDims(280, 600, 60, 64)

describe('ring geometry', () => {
  it('puts 0 at 12 o\'clock and goes clockwise', () => {
    const top = ringPoint(0, dims.outer, dims)
    expect(top.x).toBeCloseTo(dims.cx)
    expect(top.y).toBeCloseTo(dims.cy - dims.outer)
    const right = ringPoint(0.25, dims.outer, dims)
    expect(right.x).toBeCloseTo(dims.cx + dims.outer)
    expect(right.y).toBeCloseTo(dims.cy)
    const bottom = ringPoint(0.5, dims.inner, dims)
    expect(bottom.y).toBeCloseTo(dims.cy + dims.inner)
  })

  it('reads a pointer back as the same fraction', () => {
    for (const f of [0, 0.1, 0.25, 0.5, 0.77, 0.999]) {
      const p = ringPoint(f, 100, dims)
      expect(fractionAt(p.x - dims.cx, p.y - dims.cy)).toBeCloseTo(f, 6)
    }
  })

  it('morphs from the bar at 0 to the ring at 1, and halfway is neither', () => {
    expect(morphPoint(0.3, 0, 0, dims)).toEqual(barPoint(0.3, 0, dims))
    const end = morphPoint(0.3, 1, 1, dims)
    const ring = ringPoint(0.3, dims.inner, dims)
    expect(end.x).toBeCloseTo(ring.x)
    expect(end.y).toBeCloseTo(ring.y)
    const mid = morphPoint(0.3, 0, 0.5, dims)
    expect(mid.x).toBeCloseTo((barPoint(0.3, 0, dims).x + ringPoint(0.3, dims.outer, dims).x) / 2)
  })

  it('closes a segment outline and uses more samples for a longer arc', () => {
    const short = segmentPath(0.1, 0.12, 1, dims)
    const long = segmentPath(0.1, 0.6, 1, dims)
    expect(short.endsWith('Z')).toBe(true)
    expect(long.length).toBeGreaterThan(short.length)
  })

  it('continues across the 12 o\'clock seam rather than jumping', () => {
    expect(unwrapFraction(0.02, 0.98)).toBeCloseTo(1.02)
    expect(unwrapFraction(0.98, 0.02)).toBeCloseTo(-0.02)
    expect(unwrapFraction(0.4, 0.35)).toBeCloseTo(0.4)
  })

  it('dragging round the ring maps to the same minor units the bar would', () => {
    const total = 1_000_00
    const p = ringPoint(0.4, 120, dims)
    const edge = Math.min(Math.max(unwrapFraction(fractionAt(p.x - dims.cx, p.y - dims.cy), 0.38), 0), 1) * total
    expect(Math.round(edge)).toBe(40_000)
  })

  it('remembers only a known view', () => {
    expect(parsePlanView('ring')).toBe('ring')
    expect(parsePlanView('bar')).toBe('bar')
    expect(parsePlanView('pie')).toBe('bar')
    expect(parsePlanView(null)).toBe('bar')
  })
})
