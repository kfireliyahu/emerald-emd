import { describe, expect, it } from 'vitest'

import { roleForHeader } from './headerAliases.ts'

describe('roleForHeader', () => {
  it('reads a qualified purchase-date header as the ordinary date', () => {
    // These three used to have a role of their own, which nothing read (D-036).
    // Containment now sends them to `date`, which is the right answer: a column
    // called "original transaction date" still states when the purchase
    // happened, and that is what `date` means.
    expect(roleForHeader('תאריך עסקה מקורי')).toBe('date')
    expect(roleForHeader('תאריך רכישה מקורי')).toBe('date')
    expect(roleForHeader('original transaction date')).toBe('date')
  })

  it('keeps the charge columns from losing to a fuzzier date or amount match', () => {
    expect(roleForHeader('תאריך חיוב')).toBe('chargeDate')
    expect(roleForHeader('סכום חיוב')).toBe('amount')
  })

  it('still tells the original amount and its currency apart', () => {
    expect(roleForHeader('סכום עסקה')).toBe('originalAmount')
    expect(roleForHeader('מטבע עסקה מקורי')).toBe('originalCurrency')
  })

  it('says nothing about a header it does not recognise', () => {
    expect(roleForHeader('')).toBeUndefined()
    expect(roleForHeader('שדה כלשהו')).toBeUndefined()
  })
})
