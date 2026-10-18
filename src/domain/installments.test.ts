import { describe, expect, it } from 'vitest'

import { fromMajorUnits } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { installmentGroupKey, type InstallmentPurchase } from './installments.ts'

/** A ₪1,200 sofa split twelve ways, as one slice sees it. */
function slice(overrides: Partial<InstallmentPurchase> = {}): InstallmentPurchase {
  return {
    merchantNormalized: 'איקאה',
    originalDate: localDate(2026, 3, 14),
    originalTotal: fromMajorUnits(1200, 'ILS'),
    paymentCount: 12,
    ...overrides,
  }
}

describe('installmentGroupKey', () => {
  it('agrees across two slices of one purchase', () => {
    // The two rows arrive months apart, in different files, and differ in every
    // way a slice can differ: sequence, charge date, the amount charged. What
    // they share is the purchase, which is all the key is made of.
    expect(installmentGroupKey(slice())).toBe(installmentGroupKey(slice()))
  })

  it('does not collide two different purchases', () => {
    const keys = new Set([
      installmentGroupKey(slice()),
      installmentGroupKey(slice({ merchantNormalized: 'ראמי לוי' })),
      installmentGroupKey(slice({ originalDate: localDate(2026, 3, 15) })),
      installmentGroupKey(slice({ originalTotal: fromMajorUnits(1200.5, 'ILS') })),
    ])
    expect(keys.size).toBe(4)
  })

  it('separates two same-day purchases at one merchant by price', () => {
    // The realistic near-miss: one shop, one afternoon, two plans.
    expect(installmentGroupKey(slice({ originalTotal: fromMajorUnits(1200, 'ILS') }))).not.toBe(
      installmentGroupKey(slice({ originalTotal: fromMajorUnits(2400, 'ILS') })),
    )
  })

  it('ignores the sign of the total, which is the importer’s convention and not the file’s', () => {
    // D-004 makes a charge negative on the way in. A group must not split
    // because one export wrote its amounts positive and the next wrote them
    // negative.
    expect(installmentGroupKey(slice({ originalTotal: fromMajorUnits(-1200, 'ILS') }))).toBe(
      installmentGroupKey(slice({ originalTotal: fromMajorUnits(1200, 'ILS') })),
    )
  })

  it('falls back to the payment count when the file states no total', () => {
    const withoutTotal = slice({ originalTotal: undefined })
    expect(installmentGroupKey(withoutTotal)).toBe(installmentGroupKey(withoutTotal))
    // Still not the same purchase as the one whose total is known: a stated
    // ₪1,200 and an unstated total are different facts.
    expect(installmentGroupKey(withoutTotal)).not.toBe(installmentGroupKey(slice()))
    expect(installmentGroupKey(withoutTotal)).not.toBe(
      installmentGroupKey(slice({ originalTotal: undefined, paymentCount: 6 })),
    )
  })

  it('is currency-aware, so 1200 agorot is not 1200 cents', () => {
    expect(installmentGroupKey(slice({ originalTotal: fromMajorUnits(1200, 'USD') }))).not.toBe(
      installmentGroupKey(slice()),
    )
  })
})
