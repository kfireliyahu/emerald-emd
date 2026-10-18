import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import {
  balanceAfter,
  goalStatus,
  monthsToTarget,
  neededMonthly,
  type GoalLine,
} from './goalPlan.ts'

const from = { year: 2026, month: 10 }
const line = (over: Partial<GoalLine> = {}): GoalLine => ({
  goalId: 'g',
  name: 'Holiday',
  balance: money(100_000, 'ILS'),
  target: money(500_000, 'ILS'),
  due: { year: 2027, month: 2 },
  monthly: money(100_000, 'ILS'),
  ...over,
})

describe('goalPlan', () => {
  it('adds the monthly amount and stops at the target', () => {
    expect(balanceAfter(line(), 2).minor).toBe(300_000)
    expect(balanceAfter(line(), 12).minor).toBe(500_000)
  })

  it('never takes money away from a goal already past its target, and counts no interest', () => {
    expect(balanceAfter(line({ balance: money(600_000, 'ILS') }), 6).minor).toBe(600_000)
    expect(balanceAfter(line({ target: undefined }), 3).minor).toBe(400_000)
  })

  it('says how long, by plain addition', () => {
    expect(monthsToTarget(line())).toBe(4)
    expect(monthsToTarget(line({ monthly: money(0, 'ILS') }))).toBeUndefined()
    expect(monthsToTarget(line({ balance: money(500_000, 'ILS') }))).toBe(0)
  })

  it('is on time, late, or has no money going toward it', () => {
    // Oct + 4 months is Feb 2027, which is the date.
    expect(goalStatus(line(), from).kind).toBe('ON_TIME')
    const late = goalStatus(line({ monthly: money(50_000, 'ILS') }), from)
    expect(late).toMatchObject({ kind: 'LATE', monthsLate: 4 })
    expect(goalStatus(line({ monthly: money(0, 'ILS') }), from).kind).toBe('NO_MONEY')
    expect(goalStatus(line({ due: undefined }), from).kind).toBe('NO_DATE')
    expect(goalStatus(line({ target: undefined }), from).kind).toBe('NO_TARGET')
    expect(goalStatus(line({ balance: money(500_000, 'ILS') }), from).kind).toBe('REACHED')
  })

  it('needs the shortfall over the months to the date, the count the projection uses', () => {
    // Oct 2026 to Feb 2027 is four months: 400,000 / 4, and four of them arrive on time.
    expect(neededMonthly(line(), from)?.minor).toBe(100_000)
    // 399,999 over four months is 99,999.75: rounded up, never down.
    expect(neededMonthly(line({ balance: money(100_001, 'ILS') }), from)?.minor).toBe(100_000)
    expect(neededMonthly(line({ due: undefined }), from)).toBeUndefined()
    // A date already past asks for the whole shortfall now.
    expect(neededMonthly(line({ due: { year: 2026, month: 8 } }), from)?.minor).toBe(400_000)
  })
})
