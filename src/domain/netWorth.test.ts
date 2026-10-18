import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import type { Holding } from '@/domain/model/savings.ts'
import { describeGap, netWorthOf, type NetWorthInput } from './netWorth.ts'
import type { HoldingBalance } from './savings.ts'

const ILS = 'ILS'
const ils = (minor: number) => money(minor, ILS)

const HOLDING: Holding = {
  id: 'holding:box',
  holdingPlaceId: 'place:home',
  name: 'Box',
  kind: 'CASH',
  provenance: 'RECORDED',
  lastConfirmedAt: undefined,
  isLiquid: true,
  expectedReturn: undefined,
  termEndDate: undefined,
  feeBasisPoints: undefined,
  note: undefined,
  isArchived: false,
}

function row(id: string, minor: number, isLiquid = true, known = true): HoldingBalance {
  return {
    holdingId: id,
    holding: known ? { ...HOLDING, id, isLiquid } : undefined,
    balance: ils(minor),
    depositCount: 1,
    isLiquid: known && isLiquid,
    valuation: undefined,
  }
}

/** A pension: a holding with a fund type, worth its latest reading (D-389). */
function fund(id: string, minor: number): HoldingBalance {
  return {
    holdingId: id,
    holding: { ...HOLDING, id, holdingPlaceId: '', kind: 'FUND', provenance: 'TRANSCRIBED', isLiquid: false, fundType: 'PENSION' },
    balance: ils(minor),
    depositCount: 0,
    isLiquid: false,
    valuation: ils(minor),
  }
}


function input(overrides: Partial<NetWorthInput> = {}): NetWorthInput {
  return {
    asOf: localDate(2026, 10, 1),
    currency: ILS,
    statements: ils(0),
    hasStatements: false,
    holdings: [],
    inStatement: new Set(),
    held: new Set(),
    setAside: ils(0),
    debts: [],
    otherCurrencyDeposits: 0,
    ...overrides,
  }
}

describe('netWorthOf', () => {
  it('is everything owned, each once, less what is owed', () => {
    const worth = netWorthOf(
      input({
        statements: ils(20_000_00),
        hasStatements: true,
        holdings: [
          row('box', 3_000_00),
          row('broker', 7_000_00),
          row('fixed', 10_000_00, false),
          row('own-cash', 5_000_00),
          fund('pension', 90_000_00),
        ],
        held: new Set(['broker']),
        inStatement: new Set(['own-cash']),
        debts: [{ kind: 'OWED', outstanding: ils(4_000_00) }],
      }),
    )
    expect(worth.inBank).toEqual(ils(23_000_00))
    expect(worth.held).toEqual(ils(7_000_00))
    // A fund is a holding, counted once — in its own line and not in Locked (D-389).
    expect(worth.locked).toEqual(ils(10_000_00))
    expect(worth.funds).toEqual(ils(90_000_00))
    expect(worth.liabilities).toEqual(ils(4_000_00))
    // The own cash is inside the statement and counted there only.
    expect(worth.worth).toEqual(ils(20_000_00 + 3_000_00 + 7_000_00 + 10_000_00 + 90_000_00 - 4_000_00))
    expect(worth.gaps).toEqual([])
  })

  it('takes off what is only set aside, which is still inside a statement, and never below the statements', () => {
    const holdings = [row('box', 3_000_00)]
    const statements = { statements: ils(1_000_00), hasStatements: true, holdings }
    expect(netWorthOf(input({ ...statements, setAside: ils(1_000_00) })).inBank).toEqual(ils(3_000_00))
    expect(netWorthOf(input({ ...statements, setAside: ils(9_000_00) })).inBank).toEqual(ils(1_000_00))
  })

  it('keeps what is set aside while no statement balance holds it, since nothing else counts it', () => {
    expect(netWorthOf(input({ holdings: [row('box', 3_000_00)], setAside: ils(3_000_00) })).inBank).toEqual(ils(3_000_00))
  })

  it('lets the answer be negative', () => {
    const worth = netWorthOf(input({ holdings: [row('box', 1_000_00)], debts: [{ kind: 'OWED', outstanding: ils(5_000_00) }] }))
    expect(worth.worth).toEqual(ils(-4_000_00))
  })

  it('does not let an overpaid debt reduce what is owed on the others', () => {
    const worth = netWorthOf(
      input({
        debts: [
          { kind: 'OWED', outstanding: ils(-500_00) },
          { kind: 'OWED', outstanding: ils(2_000_00) },
        ],
      }),
    )
    expect(worth.liabilities).toEqual(ils(2_000_00))
  })

  it('names what it does not know instead of summing it', () => {
    const worth = netWorthOf(
      input({
        holdings: [row('gone', 1_000_00, true, false)],
        debts: [{ kind: 'OTHER_CURRENCY' }, { kind: 'UNCHECKED' }, { kind: 'UNCHECKED' }],
        otherCurrencyDeposits: 3,
      }),
    )
    expect(worth.liabilities).toEqual(ils(0))
    // A deposit naming a holding the document no longer has is locked.
    expect(worth.locked).toEqual(ils(1_000_00))
    expect(worth.gaps).toEqual([
      { kind: 'UNKNOWN_HOLDING', count: 1 },
      { kind: 'OTHER_CURRENCY_DEPOSIT', count: 3 },
      { kind: 'OTHER_CURRENCY_DEBT', count: 1 },
      { kind: 'UNCHECKED_DEBT', count: 2 },
    ])
    expect(worth.gaps.map(describeGap)).toContain('2 debts have payments in two currencies')
  })

  it('knows an empty document from a document that adds up to nothing', () => {
    expect(netWorthOf(input({})).isEmpty).toBe(true)
    expect(netWorthOf(input({ debts: [{ kind: 'OWED', outstanding: ils(0) }] })).isEmpty).toBe(false)
    expect(netWorthOf(input({ statements: ils(1_00) })).isEmpty).toBe(false)
  })
})
