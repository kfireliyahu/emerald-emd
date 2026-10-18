import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { agreedGrowthAfter, balanceAfter, monthsToTarget, type GoalLine } from './goalPlan.ts'
import { isStaleSetAside, movedIntoGoal, movedWindow, suggestSplit, versusPlan, type SetAsideHeld } from './goalRhythm.ts'
import type { SavingDeposit } from './model/savings.ts'

const ils = (minor: number) => money(minor, 'ILS')
const from = { year: 2026, month: 10 }

function line(over: Partial<GoalLine> & { goalId: string }): GoalLine {
  return {
    name: over.goalId,
    balance: ils(0),
    target: ils(120_000),
    due: { year: 2027, month: 10 },
    monthly: ils(0),
    ...over,
  }
}

function deposit(goalId: string, date: [number, number, number], minor: number, kind: SavingDeposit['sourceKind']): SavingDeposit {
  return {
    id: `${goalId}${date.join('-')}${kind}`,
    goalId,
    date: localDate(...date),
    amount: ils(minor),
    holdingId: 'h',
    sourceKind: kind,
    sourceRefId: undefined,
    transferGroupKey: undefined,
    note: undefined,
  }
}

describe('a paused goal (S7)', () => {
  it('adds nothing for the paused months, then carries on, and is reached that much later', () => {
    const base = line({ goalId: 'g', monthly: ils(10_000), target: ils(50_000) })
    const paused = { ...base, pausedMonths: 1 }
    expect(balanceAfter(base, 3).minor).toBe(30_000)
    expect(balanceAfter(paused, 3).minor).toBe(20_000)
    expect(monthsToTarget(base)).toBe(5)
    expect(monthsToTarget(paused)).toBe(6)
  })
})

describe('a bank-agreed rate (S6)', () => {
  it('is the difference it makes, zero without one, and never inside the plain figure', () => {
    const base = line({ goalId: 'g', balance: ils(1_200_000), monthly: ils(0), target: undefined })
    expect(agreedGrowthAfter(base, 12).minor).toBe(0)
    const agreed = { ...base, agreedRateBasisPoints: 400 }
    // 1,200,000 at 4% a year, a twelfth a month, rounded each month: a little over 4%.
    const growth = agreedGrowthAfter(agreed, 12).minor
    expect(growth).toBeGreaterThan(48_000)
    expect(growth).toBeLessThan(50_000)
    expect(balanceAfter(agreed, 12).minor).toBe(1_200_000)
  })
})

describe('planned against moved (S2)', () => {
  it('counts only what the bank moved in the three full months before this one', () => {
    const window = movedWindow(from)
    expect(window.start).toBe('2026-07-01')
    expect(window.end).toBe('2026-10-01')
    const deposits = [
      deposit('g', [2026, 7, 1], 100_000, 'FROM_TRANSACTION'),
      deposit('g', [2026, 9, 30], 50_000, 'FROM_TRANSACTION'),
      deposit('g', [2026, 6, 30], 999, 'FROM_TRANSACTION'), // before the window
      deposit('g', [2026, 10, 1], 999, 'FROM_TRANSACTION'), // this month: not a full one
      deposit('g', [2026, 8, 1], 77_000, 'MANUAL'), // set aside moves nothing
      deposit('g', [2026, 8, 2], 5_000, 'OPENING_BALANCE'),
      deposit('other', [2026, 8, 1], 1, 'FROM_TRANSACTION'),
    ]
    expect(movedIntoGoal(deposits, 'g', from, 'ILS').minor).toBe(150_000)
  })
})

describe('moved against planned reads only the months the goal was taking money (U9)', () => {
  const monthly = ils(100_000)

  it('compares a goal older than the window over all three months', () => {
    const deposits = [deposit('g', [2026, 1, 5], 20_000, 'OPENING_BALANCE'), deposit('g', [2026, 8, 1], 150_000, 'FROM_TRANSACTION')]
    expect(versusPlan(deposits, 'g', from, monthly, false)).toEqual({
      kind: 'COMPARED',
      months: 3,
      planned: ils(300_000),
      difference: ils(-150_000),
    })
  })

  it('a goal that began inside the window is compared from its first month only', () => {
    const deposits = [deposit('g', [2026, 9, 10], 100_000, 'FROM_TRANSACTION')]
    expect(versusPlan(deposits, 'g', from, monthly, false)).toEqual({
      kind: 'COMPARED',
      months: 1,
      planned: ils(100_000),
      difference: ils(0),
    })
  })

  it('a goal made this month, or with nothing in it, has nothing to compare yet', () => {
    expect(versusPlan([], 'g', from, monthly, false)).toEqual({ kind: 'NOTHING_YET' })
    const made = [deposit('g', [2026, 10, 2], 40_000, 'OPENING_BALANCE'), deposit('other', [2025, 1, 1], 1, 'FROM_TRANSACTION')]
    expect(versusPlan(made, 'g', from, monthly, false)).toEqual({ kind: 'NOTHING_YET' })
  })

  it('a paused goal is not compared, however old', () => {
    const deposits = [deposit('g', [2025, 1, 5], 20_000, 'FROM_TRANSACTION')]
    expect(versusPlan(deposits, 'g', from, monthly, true)).toEqual({ kind: 'PAUSED' })
  })
})

describe('is it still set aside (S5)', () => {
  const held = (setAside: [number, number, number], said: [number, number, number]): SetAsideHeld => ({
    depositId: 'd',
    goalId: 'g',
    date: localDate(...setAside),
    lastSaidOn: localDate(...said),
    amount: ils(10_000),
  })
  it('asks after more than 90 days, counted from the last time anyone said so', () => {
    const asOf = localDate(2026, 10, 3)
    expect(isStaleSetAside(held([2026, 7, 4], [2026, 7, 4]), asOf)).toBe(true) // 91 days
    expect(isStaleSetAside(held([2026, 7, 5], [2026, 7, 5]), asOf)).toBe(false) // 90 days exactly is not yet
    expect(isStaleSetAside(held([2026, 7, 6], [2026, 7, 6]), asOf)).toBe(false)
    expect(isStaleSetAside(held([2026, 1, 1], [2026, 9, 1]), asOf)).toBe(false) // confirmed since
  })
})

describe('suggest a split (S3)', () => {
  it('fills goals by nearest date, a goal with no date last, and runs out honestly (M36 U11)', () => {
    const undated = line({ goalId: 'undated', target: ils(600_000), due: undefined })
    const near = line({ goalId: 'near', target: ils(120_000), due: { year: 2027, month: 1 } })
    const far = line({ goalId: 'far', target: ils(240_000), due: { year: 2027, month: 10 } })
    const result = suggestSplit(
      [
        { line: far, paused: false },
        { line: undated, paused: false },
        { line: near, paused: false },
      ],
      ils(100_000),
      from,
    )
    const byId = Object.fromEntries(result.amounts.map((one) => [one.goalId, one]))
    // Three months to January for 120,000 is 40,000, and it comes first.
    expect(byId['near']?.amount.minor).toBe(40_000)
    expect(byId['near']?.reason).toBe('ON_TIME')
    // Twelve months for 240,000 is 20,000.
    expect(byId['far']?.amount.minor).toBe(20_000)
    expect(byId['far']?.reason).toBe('ON_TIME')
    // No date: a year of 600,000 is 50,000 a month, but only 40,000 is left — whatever its kind (M36 U11).
    expect(byId['undated']?.amount.minor).toBe(40_000)
    expect(byId['undated']?.wanted.minor).toBe(50_000)
    expect(byId['undated']?.reason).toBe('WHAT_IS_LEFT')
    expect(result.left.minor).toBe(0)
    // The goals' own order is kept, not the order they were filled.
    expect(result.amounts.map((one) => one.goalId)).toEqual(['far', 'undated', 'near'])
  })

  it('leaves reached, target-less and paused goals alone and gives nothing when nothing is left', () => {
    const result = suggestSplit(
      [
        { line: line({ goalId: 'done', balance: ils(120_000) }), paused: false },
        { line: line({ goalId: 'open', target: undefined }), paused: false },
        { line: line({ goalId: 'rest' }), paused: true },
        { line: line({ goalId: 'late' }), paused: false },
      ],
      ils(0),
      from,
    )
    expect(result.amounts.map((one) => one.reason)).toEqual(['REACHED', 'NO_TARGET', 'PAUSED', 'NOTHING_LEFT'])
    expect(result.amounts.every((one) => one.amount.minor === 0)).toBe(true)
  })
})
