import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { createAccount } from '@/data/repositories/accountRepository.ts'
import { addPayment, createDebt } from '@/data/repositories/debtRepository.ts'
import { addSnapshot, createFund } from '@/data/repositories/fundRepository.ts'
import { makePlace } from '@/data/repositories/goalWhereRepository.ts'
import { recordHoldingReading } from '@/data/repositories/holdingReadingRepository.ts'
import { createSession, setBalanceCheck, setSessionStatus } from '@/data/repositories/importSessionRepository.ts'
import {
  addDeposit,
  cashHoldingOf,
  createGoal,
  createHolding,
  createHoldingPlace,
  setPlaceAccount,
} from '@/data/repositories/savingsRepository.ts'
import { insertTransactions } from '@/data/repositories/transactionRepository.ts'

import { netWorthTable } from './netWorthRows.ts'

const NOW = 1_755_000_000_000
const AS_OF = localDate(2026, 10, 5)
const ils = (minor: number) => money(minor, 'ILS')

/** A bank account whose one verified statement ends at `closing`. */
function withStatement(db: Database, accountId: string, closing: number): void {
  const session = `s-${accountId}`
  insertTransactions(
    db,
    [
      {
        id: `t-${accountId}`,
        accountId,
        transactionDate: localDate(2026, 9, 30),
        chargeDate: undefined,
        billingPeriod: undefined,
        amount: ils(-100),
        direction: 'OUTFLOW',
        merchantRaw: 'x',
        merchantNormalized: 'x',
        providerCategory: undefined,
        cardLast4: undefined,
        reference: undefined,
        note: undefined,
        installment: undefined,
        foreign: undefined,
        naturalKey: `t-${accountId}`,
        importSessionId: session,
        sourceRowRef: undefined,
      },
    ],
    1,
  )
  createSession(db, { id: session, accountId, mappingId: undefined, fileName: 'bank.xlsx', fileHash: session, sheetName: undefined }, 1)
  setBalanceCheck(
    db,
    session,
    { kind: 'VERIFIED', order: 'OLDEST_FIRST', openingBalance: ils(closing + 100), closingBalance: ils(closing), rowCount: 1 },
    1,
  )
  setSessionStatus(db, session, 'COMMITTED', 2)
}

/** Every kind of row the mockup draws, made up: two banks, a wallet, a broker, cash at home, a fund and a loan. */
async function document() {
  const db = await createLedgerDatabase()
  const everyday = createAccount(db, { name: 'Everyday Bank', kind: 'BANK' }, NOW)
  withStatement(db, everyday.id, 20_900_00)
  const car = createGoal(db, { name: 'Car', kind: 'EARMARKED' }, NOW)
  addDeposit(db, { goalId: car.id, holdingId: cashHoldingOf(db, everyday.id)?.id ?? '', date: localDate(2026, 9, 1), amount: ils(5_000_00), sourceKind: 'FROM_TRANSACTION' }, NOW)

  const second = createAccount(db, { name: 'Second Bank', kind: 'BANK' }, NOW)
  withStatement(db, second.id, 8_450_00)
  // A fixed deposit at the bank, beside its statement: a line of the bank's row.
  const fixed = createHolding(
    db,
    { holdingPlaceId: cashHoldingOf(db, second.id)?.holdingPlaceId ?? '', name: 'Fixed deposit', kind: 'DEPOSIT', provenance: 'TRANSCRIBED', isLiquid: false },
    NOW,
  )
  recordHoldingReading(db, { holdingId: fixed.id, asOf: localDate(2026, 9, 30), value: ils(10_000_00) }, {}, NOW)

  createAccount(db, { name: 'Wallet', kind: 'CASH' }, NOW)
  createAccount(db, { name: 'Visa', kind: 'CREDIT_CARD', last4: '1234' }, NOW)

  const broker = createAccount(db, { name: 'Brokerage', kind: 'HOLDINGS' }, NOW)
  const brokerPlace = createHoldingPlace(db, { name: 'Brokerage', kind: 'INVESTMENT' }, NOW)
  setPlaceAccount(db, brokerPlace.id, broker.id, NOW)
  const index = createHolding(db, { holdingPlaceId: brokerPlace.id, name: 'World index', kind: 'FUND', provenance: 'TRANSCRIBED', isLiquid: true }, NOW)
  recordHoldingReading(db, { holdingId: index.id, asOf: localDate(2026, 7, 31), value: ils(51_640_00) }, {}, NOW)

  const home = makePlace(db, { kind: 'CASH_AT_HOME', name: 'Cash at home' }, NOW)
  recordHoldingReading(db, { holdingId: home, asOf: localDate(2026, 9, 12), value: ils(1_200_00) }, {}, NOW)

  const fund = createFund(db, { name: 'Pension', fundType: 'PENSION' }, NOW).id
  addSnapshot(db, { fundAccountId: fund, asOfDate: localDate(2026, 6, 30), totalBalance: ils(28_380_00) }, NOW)

  const loan = createDebt(
    db,
    { name: 'Car loan', kind: 'BANK_LOAN', principalAmount: ils(20_000_00), openedDate: localDate(2026, 1, 1), tracking: { kind: 'NONE' } },
    NOW,
  ).id
  addPayment(db, { debtId: loan, date: localDate(2026, 2, 1), amount: ils(6_000_00), interestPortion: ils(0) }, NOW)
  return { db, everyday, second, broker }
}

describe('Net worth is one table (M36 U08)', () => {
  it('has one row per account or place, then the funds and the debts, and no card', async () => {
    const { db } = await document()
    const table = netWorthTable(db, AS_OF, 'ILS')
    const shape = table.rows.map((row) => [
      row.group,
      row.kind === 'ACCOUNT' ? row.account.name : row.kind === 'PLACE' ? row.place.place?.name : row.kind === 'FUND' ? row.fund.name : row.debt.name,
      row.figure?.minor,
    ])
    expect(shape).toEqual([
      ['BANK', 'Everyday Bank', 20_900_00],
      ['BANK', 'Second Bank', 8_450_00 + 10_000_00],
      ['BANK', 'Wallet', 0],
      ['HOLDINGS', 'Brokerage', 51_640_00],
      ['BY_HAND', 'Cash at home', 1_200_00],
      ['FUNDS', 'Pension', 28_380_00],
      ['OWED', 'Car loan', -14_000_00],
    ])
  })

  it('adds up to the one net worth, the figure Overview, Home and the savings tool read (D-383)', async () => {
    const { db } = await document()
    const table = netWorthTable(db, AS_OF, 'ILS')
    const rows = table.rows.reduce((total, row) => total + (row.figure?.minor ?? 0), 0)
    expect(ils(rows)).toEqual(table.worth.worth)
    expect(table.worth.worth.minor).toBe(20_900_00 + 18_450_00 + 51_640_00 + 1_200_00 + 28_380_00 - 14_000_00)
  })

  it('opens a bank row to its statement, its goal parts and Cash, not for any goal (D-376)', async () => {
    const { db, everyday } = await document()
    const row = netWorthTable(db, AS_OF, 'ILS').rows.find((one) => one.kind === 'ACCOUNT' && one.account.id === everyday.id)
    if (row?.kind !== 'ACCOUNT') throw new Error('no row for the account')
    expect(row.balance?.statementBalance).toEqual(ils(20_900_00))
    expect(row.place?.statement?.parts.map((part) => [part.goalName, part.amount.minor])).toEqual([['Car', 5_000_00]])
    expect(row.place?.statement?.cash).toEqual(ils(15_900_00))
    expect(row.reach).toBe('Reachable')
  })
})
