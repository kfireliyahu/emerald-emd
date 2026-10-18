import { describe, expect, it } from 'vitest'

import { localDate } from '@/core/time.ts'
import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { createAccount } from './accountRepository.ts'
import { addPayment, createDebt } from './debtRepository.ts'
import { addSnapshot, createFund } from './fundRepository.ts'
import { netWorth } from './netWorthRepository.ts'
import {
  addDeposit,
  createGoal,
  createHolding,
  createHoldingPlace,
  documentMoneyMap,
  listHoldings,
  savingsSummary,
  setPlaceAccount,
} from './savingsRepository.ts'

const NOW = 1_755_000_000_000
const AS_OF = localDate(2026, 10, 1)
const ils = (minor: number) => ({ minor, currency: 'ILS' as const })
const usd = (minor: number) => ({ minor, currency: 'USD' as const })

/**
 * M30 F1: In the bank counted the money a goal holds at a broker, because a goal
 * fed by a holding there (D-357) is liquid goal money — and F10 added every
 * liquid goal holding to the statements. An account with holdings is not the bank.
 */
describe('goal money outside the bank', () => {
  async function setUp() {
    const db = await createLedgerDatabase()
    const broker = createAccount(db, { name: 'Broker', kind: 'HOLDINGS' }, NOW)
    const brokerPlace = createHoldingPlace(db, { name: 'Broker place', kind: 'INVESTMENT' }, NOW)
    const link = setPlaceAccount(db, brokerPlace.id, broker.id, NOW)
    const fund = createHolding(
      db,
      { holdingPlaceId: brokerPlace.id, name: 'An index fund', kind: 'SECURITY', provenance: 'TRANSCRIBED', isLiquid: true },
      NOW,
    )
    const savings = createHoldingPlace(db, { name: 'Savings elsewhere', kind: 'DEPOSIT' }, NOW)
    const box = createHolding(
      db,
      { holdingPlaceId: savings.id, name: 'Box', kind: 'CASH', provenance: 'RECORDED', isLiquid: true },
      NOW,
    )
    const goal = createGoal(db, { name: 'Trip', kind: 'EARMARKED' }, NOW)
    return { db, broker, cash: link.cashHolding, fund, box, goal }
  }

  it('counts a goal holding at an account with holdings as held, never as outside', async () => {
    const { db, fund, cash, goal } = await setUp()
    addDeposit(db, { goalId: goal.id, holdingId: fund.id, date: localDate(2026, 6, 8), amount: ils(700_000), sourceKind: 'FROM_TRANSACTION' }, NOW)
    addDeposit(db, { goalId: goal.id, holdingId: cash?.id ?? '', date: localDate(2026, 6, 8), amount: ils(50_000), sourceKind: 'FROM_TRANSACTION' }, NOW)

    const read = netWorth(db, AS_OF, 'ILS')
    expect(read.inBank.minor).toBe(0)
    expect(read.held.minor).toBe(750_000)
    expect(read.worth.minor).toBe(750_000)
  })

  it('still counts a goal saved outside the bank, and what is set aside while no statement holds it', async () => {
    const { db, box, fund, goal } = await setUp()
    addDeposit(db, { goalId: goal.id, holdingId: box.id, date: localDate(2026, 5, 1), amount: ils(30_000), sourceKind: 'FROM_TRANSACTION' }, NOW)
    addDeposit(db, { goalId: goal.id, holdingId: box.id, date: localDate(2026, 5, 2), amount: ils(10_000), sourceKind: 'MANUAL' }, NOW)
    addDeposit(db, { goalId: goal.id, holdingId: fund.id, date: localDate(2026, 5, 3), amount: ils(90_000), sourceKind: 'FROM_TRANSACTION' }, NOW)

    const read = netWorth(db, AS_OF, 'ILS')
    // No bank account has a statement balance, so the 10,000 set aside is inside none (M36 U07).
    expect(read.inBank.minor).toBe(40_000)
    expect(read.held.minor).toBe(90_000)
  })

  it('reads nothing after the day it is asked about', async () => {
    const { db, fund, goal } = await setUp()
    addDeposit(db, { goalId: goal.id, holdingId: fund.id, date: localDate(2026, 11, 1), amount: ils(5_000), sourceKind: 'FROM_TRANSACTION' }, NOW)
    expect(netWorth(db, AS_OF, 'ILS').held.minor).toBe(0)
  })
})

/**
 * M36 U07: the one net worth reads the funds and the debts as the document
 * declares them — a fund's latest `balance`, a debt's `outstanding` — and names
 * what it cannot sum.
 */
describe('the declared parts', () => {
  it('takes each fund at its latest report and each debt at what its payments leave', async () => {
    const db = await createLedgerDatabase()
    const fund = createFund(db, { name: 'Pension', fundType: 'PENSION' }, NOW).id
    addSnapshot(db, { fundAccountId: fund, asOfDate: localDate(2026, 3, 31), totalBalance: ils(5_000_000) }, NOW)
    addSnapshot(db, { fundAccountId: fund, asOfDate: localDate(2026, 6, 30), totalBalance: ils(5_200_000) }, NOW)
    createFund(db, { name: 'Never read', fundType: 'STUDY_FUND' }, NOW)
    const loan = createDebt(
      db,
      { name: 'Loan', kind: 'PERSONAL', principalAmount: ils(1_000_000), openedDate: localDate(2026, 1, 1), tracking: { kind: 'NONE' } },
      NOW,
    ).id
    addPayment(db, { debtId: loan, date: localDate(2026, 2, 1), amount: ils(100_000), interestPortion: ils(15_000) }, NOW)

    const read = netWorth(db, AS_OF, 'ILS')
    expect(read.funds.minor).toBe(5_200_000)
    expect(read.liabilities.minor).toBe(915_000)
    expect(read.worth.minor).toBe(5_200_000 - 915_000)
    // A fund never read is a holding worth nothing anyone has read (D-389): Home asks for its report.
    expect(read.gaps).toEqual([])

    // A payment in another currency: the debt is not one figure, so it is named, not summed (D-349).
    addPayment(db, { debtId: loan, date: localDate(2026, 3, 1), amount: usd(10_000) }, NOW)
    const after = netWorth(db, AS_OF, 'ILS')
    expect(after.liabilities.minor).toBe(0)
    expect(after.gaps).toContainEqual({ kind: 'UNCHECKED_DEBT', count: 1 })
  })
})

/**
 * M36 U12 (D-389): **a fund is a holding**, so it is counted once — by net worth,
 * by the savings split and by the money map alike — and nowhere as a place's
 * line. Before, its balance came in beside the holdings, and a pension kept both
 * ways counted twice.
 */
describe('a fund is a holding', () => {
  it('counts once everywhere a total is drawn', async () => {
    const db = await createLedgerDatabase()
    const box = createHoldingPlace(db, { name: 'Box', kind: 'CASH' }, NOW)
    const cash = createHolding(
      db,
      { holdingPlaceId: box.id, name: 'Cash', kind: 'CASH', provenance: 'RECORDED', isLiquid: true },
      NOW,
    ).id
    const goal = createGoal(db, { name: 'Trip', kind: 'EARMARKED', defaultHoldingId: cash }, NOW).id
    addDeposit(db, { goalId: goal, holdingId: cash, date: localDate(2026, 5, 1), amount: ils(100_000), sourceKind: 'MANUAL' }, NOW)
    const pension = createFund(db, { name: 'Pension', fundType: 'PENSION' }, NOW).id
    addSnapshot(db, { fundAccountId: pension, asOfDate: localDate(2026, 6, 30), totalBalance: ils(5_000_000) }, NOW)

    const worth = netWorth(db, AS_OF, 'ILS')
    expect(worth.funds.minor).toBe(5_000_000)
    expect(worth.locked.minor).toBe(0)
    expect(worth.worth.minor).toBe(5_000_000 + 100_000)

    const summary = savingsSummary(db, AS_OF, 'ILS')
    expect(summary.liquidity.locked.minor).toBe(5_000_000)
    expect(summary.liquidity.total.minor).toBe(5_100_000)

    const map = documentMoneyMap(db, 'ILS')
    expect(map.funds.map((one) => [one.fundId, one.balance.minor])).toEqual([[pension, 5_000_000]])
    expect(map.places.flatMap((one) => one.holdings.map((row) => row.holdingId))).toEqual([cash])
    expect(map.liquidity.total.minor).toBe(5_100_000)

    // And never a holding a place offers.
    expect(listHoldings(db, { includeArchived: true }).map((one) => one.id)).toEqual([cash])
  })
})
