import { describe, expect, it } from 'vitest'

import {
  dominantCategory,
  groupWeight,
  orderGroups,
  settledCount,
  type MerchantGroup,
} from './merchantGroups.ts'

function group(overrides: Partial<MerchantGroup> = {}): MerchantGroup {
  return {
    merchantNormalized: 'שופרסל',
    merchantRaw: 'שופרסל דיל',
    count: 4,
    totals: [{ currency: 'ILS', outflowMinor: 40000, inflowMinor: 0 }],
    settled: [],
    providerCategories: [],
    ...overrides,
  }
}

describe('groupWeight', () => {
  it('is the outflow when there is one currency', () => {
    expect(groupWeight(group())).toBe(40000)
  })

  it('is the largest single currency, never the sum of two', () => {
    // 200 agorot and 200 cents are not 400 of anything (D-003).
    const mixed = group({
      totals: [
        { currency: 'ILS', outflowMinor: 30000, inflowMinor: 0 },
        { currency: 'USD', outflowMinor: 50000, inflowMinor: 0 },
      ],
    })
    expect(groupWeight(mixed)).toBe(50000)
  })

  it('is zero for a group that is all inflow', () => {
    expect(groupWeight(group({ totals: [{ currency: 'ILS', outflowMinor: 0, inflowMinor: 900 }] }))).toBe(0)
  })

  it('is zero for a group with no totals at all', () => {
    expect(groupWeight(group({ totals: [] }))).toBe(0)
  })
})

describe('dominantCategory', () => {
  it('is nothing for a merchant that has never been categorized', () => {
    expect(dominantCategory(group())).toBeUndefined()
  })

  it('is the most common of the settled rows', () => {
    const it_ = group({
      settled: [
        { categoryId: 'cat:restaurants', count: 4 },
        { categoryId: 'cat:groceries', count: 14 },
      ],
    })
    expect(dominantCategory(it_)).toEqual({ categoryId: 'cat:groceries', count: 14 })
  })

  it('breaks a tie the same way every time', () => {
    const tied = group({
      settled: [
        { categoryId: 'cat:restaurants', count: 3 },
        { categoryId: 'cat:groceries', count: 3 },
      ],
    })
    expect(dominantCategory(tied)?.categoryId).toBe('cat:groceries')
    // Order in, same answer out: the hint must not depend on how SQL returned it.
    expect(dominantCategory({ ...tied, settled: [...tied.settled].reverse() })?.categoryId).toBe(
      'cat:groceries',
    )
  })

  it('offers a hint from a single row rather than withholding it', () => {
    // No threshold: the screen shows "1 already Groceries" and the user reads it.
    expect(dominantCategory(group({ settled: [{ categoryId: 'cat:groceries', count: 1 }] }))).toEqual({
      categoryId: 'cat:groceries',
      count: 1,
    })
  })
})

describe('settledCount', () => {
  it('adds up every category the merchant has been put in', () => {
    expect(
      settledCount(
        group({
          settled: [
            { categoryId: 'cat:groceries', count: 14 },
            { categoryId: 'cat:restaurants', count: 6 },
          ],
        }),
      ),
    ).toBe(20)
  })

  it('is zero for an untouched merchant', () => {
    expect(settledCount(group())).toBe(0)
  })
})

describe('orderGroups', () => {
  const shufersal = group({ merchantNormalized: 'שופרסל', count: 30, totals: [{ currency: 'ILS', outflowMinor: 10000, inflowMinor: 0 }] })
  const paz = group({ merchantNormalized: 'פז ילו', count: 4, totals: [{ currency: 'ILS', outflowMinor: 90000, inflowMinor: 0 }] })
  const aroma = group({ merchantNormalized: 'ארומה', count: 12, totals: [{ currency: 'ILS', outflowMinor: 5000, inflowMinor: 0 }] })
  const all = [paz, aroma, shufersal]

  it('puts the most work first by default', () => {
    expect(orderGroups(all, 'COUNT').map((g) => g.merchantNormalized)).toEqual([
      'שופרסל',
      'ארומה',
      'פז ילו',
    ])
  })

  it('puts the most money first when asked', () => {
    expect(orderGroups(all, 'AMOUNT').map((g) => g.merchantNormalized)).toEqual([
      'פז ילו',
      'שופרסל',
      'ארומה',
    ])
  })

  it('sorts by name when asked', () => {
    expect(orderGroups(all, 'NAME')[0]?.merchantNormalized).toBe('ארומה')
  })

  it('never mutates what it was given', () => {
    const input = [...all]
    orderGroups(input, 'COUNT')
    expect(input).toEqual(all)
  })

  it('is stable when the primary key ties, so rows do not swap between renders', () => {
    const a = group({ merchantNormalized: 'AAA', count: 5 })
    const b = group({ merchantNormalized: 'BBB', count: 5 })
    expect(orderGroups([b, a], 'COUNT').map((g) => g.merchantNormalized)).toEqual(['AAA', 'BBB'])
    expect(orderGroups([a, b], 'COUNT').map((g) => g.merchantNormalized)).toEqual(['AAA', 'BBB'])
  })
})
