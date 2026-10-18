import { describe, expect, it } from 'vitest'

import { attention, waitingCounts, type AttentionInput } from './home.ts'

function input(overrides?: Partial<AttentionInput>): AttentionInput {
  return {
    pendingSettlements: 0,
    pendingTransfers: 0,
    unmatchedCharges: 0,
    missingStatements: 0,
    uncategorized: 0,
    uncategorizedMerchants: 0,
    unconfirmedPayments: 0,
    fixedExpenseCandidates: 0,
    fundsWithoutBalance: 0,
    unconfirmedHoldings: 0,
    missingPayslipFor: undefined,
    ...overrides,
  }
}

describe('attention', () => {
  it('puts the thing everything else depends on first, whatever the counts are', () => {
    const items = attention(
      input({
        pendingSettlements: 1,
        pendingTransfers: 3,
        unmatchedCharges: 1,
        missingStatements: 2,
        uncategorized: 2,
        uncategorizedMerchants: 1,
        unconfirmedPayments: 40,
        fixedExpenseCandidates: 9,
        fundsWithoutBalance: 3,
        unconfirmedHoldings: 5,
        missingPayslipFor: { year: 2026, month: 7 },
      }),
    )

    // Two unfiled rows outrank forty unconfirmed payments, because until they
    // are filed every category total on every other screen is wrong — and one
    // undecided settlement outranks even those, because it doubles the total
    // rather than misfiling part of it (D-160).
    // Everything that makes a *total* wrong comes before the breakdown (M31 U1).
    expect(items.map((item) => item.kind)).toEqual([
      'PENDING_SETTLEMENTS',
      'PENDING_TRANSFERS',
      'UNMATCHED_CHARGES',
      'MISSING_STATEMENT',
      'UNCATEGORIZED',
      'UNCONFIRMED_PAYMENTS',
      'FIXED_EXPENSE_CANDIDATES',
      'MISSING_PAYSLIP',
      'FUND_WITHOUT_BALANCE',
      // Last, and on purpose: five balances that may have drifted matter less
      // than one that is missing from the total entirely (D-176).
      'UNCONFIRMED_HOLDING',
    ])
  })

  /**
   * The ranking that made this item worth adding: one settlement beats a
   * hundred unfiled rows. A hundred unfiled rows make the breakdown wrong; one
   * unanswered settlement makes the month's total wrong by roughly double
   * (docs/08 A3), and the queue that answers it lives on a settings screen
   * nobody opens after an import.
   */
  it('ranks one settlement above a hundred unfiled rows', () => {
    const items = attention(input({ pendingSettlements: 1, uncategorized: 100, uncategorizedMerchants: 12 }))
    expect(items.map((item) => item.kind)).toEqual(['PENDING_SETTLEMENTS', 'UNCATEGORIZED'])
    expect(items[0]?.to).toBe('/settings/accounts')
  })

  it('leaves out anything with nothing to do', () => {
    expect(attention(input())).toEqual([])
    expect(attention(input({ fundsWithoutBalance: 1 })).map((one) => one.kind)).toEqual([
      'FUND_WITHOUT_BALANCE',
    ])
  })

  it('carries the month a missing payslip is about, and counts it as one thing', () => {
    const [item] = attention(input({ missingPayslipFor: { year: 2026, month: 7 } }))
    expect(item?.kind).toBe('MISSING_PAYSLIP')
    expect(item?.count).toBe(1)
    expect(item?.period).toEqual({ year: 2026, month: 7 })
    expect(item?.to).toBe('/paychecks')
  })

  it('sends every item somewhere the fix actually is', () => {
    const items = attention(
      input({
        pendingSettlements: 1,
        uncategorized: 1,
        uncategorizedMerchants: 1,
        unconfirmedPayments: 1,
        fixedExpenseCandidates: 1,
        fundsWithoutBalance: 1,
        unconfirmedHoldings: 1,
      }),
    )
    expect(items.map((item) => item.to)).toEqual([
      '/settings/accounts',
      '/transactions/merchants',
      '/wealth/debts',
      '/plan',
      '/wealth/funds',
      '/wealth',
    ])
  })

  it('counts unfiled rows by merchant, and keeps the rows beside the count', () => {
    const [item] = attention(input({ uncategorized: 23, uncategorizedMerchants: 6 }))
    expect(item).toMatchObject({ kind: 'UNCATEGORIZED', count: 6, rows: 23 })
  })

  it('tells the notice bar how many wait and how many change a total', () => {
    const items = attention(input({ pendingSettlements: 1, pendingTransfers: 2, uncategorized: 9, uncategorizedMerchants: 4 }))
    expect(waitingCounts(items)).toEqual({ all: 7, totals: 3 })
    expect(waitingCounts([])).toEqual({ all: 0, totals: 0 })
  })
})
