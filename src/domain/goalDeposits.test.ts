import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import {
  isCushionMonths,
  monthsToBasisPoints,
  originOf,
  originSplit,
  sourceKindForOrigin,
  wantedDeposit,
} from './goalDeposits.ts'
import type { DepositSourceKind, SavingDeposit } from './model/savings.ts'

function deposit(minor: number, sourceKind: DepositSourceKind): SavingDeposit {
  return {
    id: `${sourceKind}${String(minor)}`,
    goalId: 'g',
    date: localDate(2026, 9, 1),
    amount: money(minor, 'ILS'),
    holdingId: 'h',
    sourceKind,
    sourceRefId: undefined,
    transferGroupKey: undefined,
    note: undefined,
  }
}

describe('the three deposit kinds', () => {
  it('reads a kind off the source, so nothing is stored twice', () => {
    expect(originOf('FROM_TRANSACTION')).toBe('DERIVED')
    expect(originOf('FROM_PAYCHECK_DEDUCTION')).toBe('DERIVED')
    expect(originOf('MANUAL')).toBe('SET_ASIDE')
    expect(originOf('FROM_PLAN')).toBe('SET_ASIDE')
    expect(originOf('OPENING_BALANCE')).toBe('ALREADY_THERE')
    expect(originOf('GROWTH')).toBe('GROWTH')
  })

  it('a person only ever types set aside and was already there', () => {
    expect(sourceKindForOrigin('SET_ASIDE')).toBe('MANUAL')
    expect(sourceKindForOrigin('ALREADY_THERE')).toBe('OPENING_BALANCE')
  })

  it('splits a balance into the kinds and the kinds add to it exactly, withdrawals included', () => {
    const rows = [
      deposit(200_000, 'FROM_TRANSACTION'),
      deposit(-50_000, 'FROM_TRANSACTION'),
      deposit(120_000, 'MANUAL'),
      deposit(1_000_000, 'OPENING_BALANCE'),
      deposit(7_000, 'GROWTH'),
    ]
    const split = originSplit(rows, 'ILS')
    expect(split.DERIVED.minor).toBe(150_000)
    expect(split.SET_ASIDE.minor).toBe(120_000)
    expect(split.ALREADY_THERE.minor).toBe(1_000_000)
    expect(split.GROWTH.minor).toBe(7_000)
    const sum = Object.values(split).reduce((running, one) => running + one.minor, 0)
    expect(sum).toBe(rows.reduce((running, one) => running + one.amount.minor, 0))
  })
})

describe('deposits derived from the bank', () => {
  const transaction = { id: 't1', date: '2026-10-02', minor: -213_100, currency: 'ILS' as const }

  it('money out of the bank is a deposit into the goal, keyed by the transaction', () => {
    expect(wantedDeposit(transaction)).toEqual({ key: 't1', date: '2026-10-02', minor: 213_100, currency: 'ILS' })
  })
})

describe('the cushion', () => {
  it('is a number of months above zero and at most two years', () => {
    expect(isCushionMonths(3)).toBe(true)
    expect(isCushionMonths(4.5)).toBe(true)
    expect(isCushionMonths(0)).toBe(false)
    expect(isCushionMonths(-1)).toBe(false)
    expect(isCushionMonths(25)).toBe(false)
    expect(isCushionMonths(Number.NaN)).toBe(false)
    expect(isCushionMonths(0.001)).toBe(false)
  })

  it('stores months as the basis points an emergency goal uses', () => {
    expect(monthsToBasisPoints(3)).toBe(30_000)
    expect(monthsToBasisPoints(4.5)).toBe(45_000)
  })
})
