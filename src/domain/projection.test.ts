import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'

import { projectBalance } from './projection.ts'

const ils = (minor: number) => money(minor, 'ILS')

/**
 * The cases that matter are the ones where a wrong answer would flatter: a
 * contribution counted as growth, a fee that never bites. Moved here with the
 * function (D-072); the arithmetic is unchanged from where `funds.test.ts` had
 * it, which is the point of a move.
 */
describe('projectBalance', () => {
  it('is the opening balance over no years at all', () => {
    expect(
      projectBalance({
        openingBalance: ils(10_000_000),
        annualContribution: ils(1_000_000),
        years: 0,
        grossReturnBasisPoints: 500,
      }),
    ).toEqual(ils(10_000_000))
  })

  it('adds the contribution and half a year of growth on it', () => {
    // ₪0 opening, ₪1,000 a year, one year at 10%: the deposit earns half a year.
    expect(
      projectBalance({
        openingBalance: ils(0),
        annualContribution: ils(100_000),
        years: 1,
        grossReturnBasisPoints: 1_000,
      }),
    ).toEqual(ils(105_000))
  })

  it('takes the contribution fee off before the money is invested', () => {
    expect(
      projectBalance({
        openingBalance: ils(0),
        annualContribution: ils(100_000),
        years: 1,
        grossReturnBasisPoints: 0,
        feeOnContributionBasisPoints: 600,
      }),
    ).toEqual(ils(94_000))
  })

  it('lets the balance fee eat into the return', () => {
    const shared = {
      openingBalance: ils(10_000_000),
      annualContribution: ils(0),
      years: 1,
      grossReturnBasisPoints: 500,
    }
    expect(projectBalance(shared)).toEqual(ils(10_500_000))
    expect(projectBalance({ ...shared, feeOnBalanceBasisPoints: 100 })).toEqual(ils(10_400_000))
  })

  it('loses money when the fee is larger than the return', () => {
    const balance = projectBalance({
      openingBalance: ils(10_000_000),
      annualContribution: ils(0),
      years: 1,
      grossReturnBasisPoints: 200,
      feeOnBalanceBasisPoints: 300,
    })
    expect(balance.minor).toBeLessThan(10_000_000)
  })
})
