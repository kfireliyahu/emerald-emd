import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import type { HoldingWorth } from '@/domain/holdingReadings.ts'
import type { Holding } from '@/domain/model/savings.ts'

import { checkedOf, newFigureFor, readingWanted } from './holdingCheck.ts'

const TODAY = localDate(2026, 10, 5)

function holding(extra: Partial<Holding> = {}): Holding {
  return {
    id: 'h1',
    holdingPlaceId: 'p1',
    name: 'Deposit',
    kind: 'DEPOSIT',
    provenance: 'RECORDED',
    lastConfirmedAt: undefined,
    isLiquid: false,
    expectedReturn: undefined,
    termEndDate: undefined,
    feeBasisPoints: undefined,
    note: undefined,
    isArchived: false,
    ...extra,
  }
}

function worth(asOf: string): HoldingWorth {
  return {
    holdingId: 'h1',
    asOf,
    reading: money(100_000, 'ILS'),
    worth: money(100_000, 'ILS'),
    putIn: undefined,
    growth: undefined,
  }
}

describe('checkedOf (M36 U01)', () => {
  it('says nothing and asks nothing of an account’s own Cash: the statement is its figure', () => {
    const cash = holding({ kind: 'CASH', accountId: 'acc1' })
    expect(checkedOf(cash, TODAY, undefined, true)).toEqual({ phrase: undefined, askable: false })
  })

  it('still says never checked, and asks, for a holding nobody has counted', () => {
    expect(checkedOf(holding(), TODAY, undefined, false)).toEqual({ phrase: 'never checked', askable: true })
  })

  it('takes a reading’s day as the last check when it is the later', () => {
    const counted = holding({ lastConfirmedAt: localDate(2026, 6, 1) })
    expect(checkedOf(counted, TODAY, worth('2026-09-01'), false).phrase).toBe('checked 2026-09-01 — 1 month ago')
    expect(checkedOf(counted, TODAY, undefined, false).phrase).toBe('checked 2026-06-01 — 4 months ago')
  })
})

describe('New figure lands on the holding it was about (M36 U01)', () => {
  it('names the holding in the navigation, and the places read it back', () => {
    const figure = newFigureFor('h1')
    expect(figure.to).toBe('/wealth')
    expect(readingWanted(figure.state)).toBe('h1')
  })

  it('reads nothing from a navigation that named no holding', () => {
    expect(readingWanted(null)).toBeUndefined()
    expect(readingWanted(undefined)).toBeUndefined()
    expect(readingWanted({ add: true })).toBeUndefined()
    expect(readingWanted({ reading: 3 })).toBeUndefined()
  })
})
