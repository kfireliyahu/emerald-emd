import { describe, expect, it } from 'vitest'

import { money } from './money.ts'
import {
  applyBasisPoints,
  basisPointsText,
  distribute,
  distributeWithBuffer,
  formatPercent,
  ratioBasisPoints,
  ratioOfBasisPoints,
} from './percent.ts'

const ILS = 'ILS'

describe('applyBasisPoints', () => {
  it('takes a percentage of an amount without leaving integers', () => {
    // 0.5% of ₪120,000.
    expect(applyBasisPoints(12_000_000, 50)).toBe(60_000)
  })

  it('rounds half-up and keeps the sign', () => {
    expect(applyBasisPoints(101, 50)).toBe(1)
    expect(applyBasisPoints(-101, 50)).toBe(-1)
    expect(applyBasisPoints(12_345, 0)).toBe(0)
  })

  it('undoes what ratioBasisPoints measured', () => {
    const rate = ratioBasisPoints(money(25_000, ILS), money(100_000, ILS))
    expect(applyBasisPoints(100_000, rate ?? 0)).toBe(25_000)
  })
})

describe('ratioBasisPoints', () => {
  it('rounds half-up and stays integer', () => {
    expect(ratioBasisPoints(money(1, ILS), money(8, ILS))).toBe(1250)
    expect(ratioBasisPoints(money(1, ILS), money(3, ILS))).toBe(3333)
    expect(ratioBasisPoints(money(1, ILS), money(16, ILS))).toBe(625)
    // 0.00005 exactly — the half that has to go up.
    expect(ratioBasisPoints(money(1, ILS), money(20_000, ILS))).toBe(1)
  })

  it('has no answer when the whole is zero', () => {
    expect(ratioBasisPoints(money(500, ILS), money(0, ILS))).toBeUndefined()
  })

  it('keeps the sign of the ratio, not of either side', () => {
    expect(ratioBasisPoints(money(-25, ILS), money(100, ILS))).toBe(-2500)
    expect(ratioBasisPoints(money(25, ILS), money(-100, ILS))).toBe(-2500)
    expect(ratioBasisPoints(money(-25, ILS), money(-100, ILS))).toBe(2500)
  })

  it('refuses to compare two currencies by never being asked to', () => {
    // Not a throw — a type. `ratioBasisPoints` takes Money so a cross-currency
    // ratio cannot be written; `ratioOfBasisPoints` is the plain-number door.
    expect(ratioOfBasisPoints(3, 4)).toBe(7500)
    expect(ratioOfBasisPoints(1, 0)).toBeUndefined()
  })
})

describe('distribute', () => {
  const sums = (parts: readonly number[]): number =>
    parts.reduce((total, part) => total + part, 0)

  it('splits exactly, with nothing left over', () => {
    // 100 agorot three ways is 33.33 each, which is 99.99. Someone gets an agora.
    expect(distribute(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(sums(distribute(100, [1, 1, 1]))).toBe(100)
  })

  it('gives the spare agorot to the largest remainders, ties to the earlier weight', () => {
    // Thirds of 10: floors are 3, 3, 3 and the remainders are equal, so the
    // single spare goes to the first — the same plan splits the same way twice.
    expect(distribute(10, [1, 1, 1])).toEqual([4, 3, 3])
    expect(distribute(10, [50, 30, 20])).toEqual([5, 3, 2])
    // 7 split 1:2 is 2.33 / 4.66 — the second has the bigger remainder.
    expect(distribute(7, [1, 2])).toEqual([2, 5])
  })

  it('is exact over a hundred random splits', () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const total = seed * 7919
      const weights = [seed % 11, (seed * 3) % 7, (seed * 5) % 13, 1]
      expect(sums(distribute(total, weights))).toBe(total)
    }
  })

  it('splits evenly when every weight is zero', () => {
    expect(distribute(9, [0, 0, 0])).toEqual([3, 3, 3])
    expect(distribute(10, [0, 0, 0])).toEqual([4, 3, 3])
  })

  it('handles a negative total, which is what an over-subtracted basis produces', () => {
    expect(distribute(-100, [1, 1, 1])).toEqual([-34, -33, -33])
    expect(sums(distribute(-100, [1, 1, 1]))).toBe(-100)
  })

  it('has nothing to say about nothing', () => {
    expect(distribute(500, [])).toEqual([])
    expect(distribute(0, [1, 2, 3])).toEqual([0, 0, 0])
  })
})

describe('distributeWithBuffer', () => {
  it('hands every spare agora to the buffer instead of spreading them', () => {
    // Without a buffer the two spare agorot go to the largest remainders.
    expect(distribute(100, [1, 1, 1, 1, 1, 1])).toEqual([17, 17, 17, 17, 16, 16])
    // With one, they all land in the same place, and it is the same total: the
    // other five floor to 16, and the buffer is defined as the 20 they left.
    expect(distributeWithBuffer(100, [1, 1, 1, 1, 1, 1], 0)).toEqual([20, 16, 16, 16, 16, 16])
    expect(distributeWithBuffer(100, [1, 1, 1, 1, 1, 1], 5)).toEqual([16, 16, 16, 16, 16, 20])
  })

  it('falls back to largest remainder when the buffer is not one of the parts', () => {
    expect(distributeWithBuffer(10, [1, 1, 1], -1)).toEqual(distribute(10, [1, 1, 1]))
    expect(distributeWithBuffer(10, [1, 1, 1], 9)).toEqual(distribute(10, [1, 1, 1]))
  })
})

describe('formatPercent', () => {
  it('is the one place a rate becomes a float', () => {
    expect(formatPercent(2104)).toBe('21.04%')
    expect(formatPercent(2350)).toBe('23.5%')
    expect(formatPercent(1700)).toBe('17%')
    expect(formatPercent(3333, { digits: 0 })).toBe('33%')
    expect(formatPercent(undefined)).toBe('—')
  })

  it('shows every basis-point figure one way: up to two decimals, trailing zeros trimmed (M45 F1)', () => {
    expect(basisPointsText(1250)).toBe('12.5')
    expect(basisPointsText(35)).toBe('0.35')
    expect(basisPointsText(10000)).toBe('100')
    expect(basisPointsText(-1249)).toBe('-12.49')
    expect(basisPointsText(0)).toBe('0')
  })
})
