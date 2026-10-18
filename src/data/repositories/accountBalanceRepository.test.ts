import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { openingCheck } from '@/domain/accountBalances.ts'
import { accountBalances, setOpeningBalance } from './accountBalanceRepository.ts'
import { createAccount } from './accountRepository.ts'
import { createSession, setBalanceCheck, setSessionStatus } from './importSessionRepository.ts'
import { insertTransactions, type InsertableTransaction } from './transactionRepository.ts'

function transaction(
  accountId: string,
  id: string,
  minor: number,
  month: number,
  day: number,
  year = 2026,
  importSessionId?: string,
): InsertableTransaction {
  return {
    id,
    accountId,
    transactionDate: localDate(year, month, day),
    chargeDate: undefined,
    billingPeriod: undefined,
    amount: money(minor, 'ILS'),
    direction: minor < 0 ? 'OUTFLOW' : 'INFLOW',
    merchantRaw: id,
    merchantNormalized: id,
    providerCategory: undefined,
    cardLast4: undefined,
    reference: undefined,
    note: undefined,
    installment: undefined,
    foreign: undefined,
    naturalKey: id,
    importSessionId,
    sourceRowRef: undefined,
  }
}

describe('an account adds up to its last statement', () => {
  it('opening plus what the statements moved equals the last balance', () => {
    const ils = (minor: number) => money(minor, 'ILS')
    expect(openingCheck(ils(100_000), ils(-30_000), ils(70_000))).toEqual({ kind: 'ADDS_UP' })
    expect(openingCheck(ils(100_000), ils(-30_000), ils(65_000))).toEqual({
      kind: 'OFF',
      missing: ils(-5_000),
    })
    expect(openingCheck(undefined, ils(0), ils(1))).toEqual({ kind: 'UNCHECKED', reason: 'NO_OPENING' })
    expect(openingCheck(ils(1), ils(0), undefined)).toEqual({
      kind: 'UNCHECKED',
      reason: 'NO_STATEMENT_BALANCE',
    })
  })

  it('reads the opening balance, what moved since its date, and the last verified statement', async () => {
    const db = await createLedgerDatabase()
    const bank = createAccount(db, { name: 'Checking', kind: 'BANK' }, 1)
    createAccount(db, { name: 'Visa', kind: 'CREDIT_CARD' }, 1)
    insertTransactions(
      db,
      [
        transaction(bank.id, 'before', -999_900, 12, 31, 2025),
        transaction(bank.id, 'a', -30_000, 1, 5),
        transaction(bank.id, 'b', 10_000, 1, 9),
      ],
      1,
    )
    createSession(
      db,
      { id: 's1', accountId: bank.id, mappingId: undefined, fileName: 'jan.xlsx', fileHash: 'h', sheetName: undefined },
      1,
    )
    setBalanceCheck(
      db,
      's1',
      {
        kind: 'VERIFIED',
        order: 'OLDEST_FIRST',
        openingBalance: money(100_000, 'ILS'),
        closingBalance: money(80_000, 'ILS'),
        rowCount: 2,
      },
      1,
    )
    setSessionStatus(db, 's1', 'COMMITTED', 2)

    // Nothing said yet: the sum cannot be checked, and says why.
    const before = accountBalances(db, 'ILS')
    expect(before.map((one) => one.name)).toEqual(['Checking'])
    expect(before[0]?.check).toEqual({ kind: 'UNCHECKED', reason: 'NO_OPENING' })
    expect(before[0]?.statementBalance).toEqual(money(80_000, 'ILS'))

    setOpeningBalance(db, bank.id, { amount: money(100_000, 'ILS'), date: localDate(2026, 1, 1) }, 3)
    const after = accountBalances(db, 'ILS')[0]
    expect(after?.opening).toEqual(money(100_000, 'ILS'))
    // The row before the opening date is part of "everything before", not of what moved.
    expect(after?.moved).toEqual(money(-20_000, 'ILS'))
    expect(after?.check).toEqual({ kind: 'ADDS_UP' })

    setOpeningBalance(db, bank.id, { amount: money(90_000, 'ILS'), date: localDate(2026, 1, 1) }, 4)
    expect(accountBalances(db, 'ILS')[0]?.check).toEqual({ kind: 'OFF', missing: money(10_000, 'ILS') })

    setOpeningBalance(db, bank.id, undefined, 5)
    expect(accountBalances(db, 'ILS')[0]?.opening).toBeUndefined()
  })

  it('takes the balance of the statement covering the latest days, not the one read last (F24)', async () => {
    const db = await createLedgerDatabase()
    const bank = createAccount(db, { name: 'Checking', kind: 'BANK' }, 1)
    const read = (id: string, fileName: string, at: number, check: Parameters<typeof setBalanceCheck>[2]) => {
      createSession(db, { id, accountId: bank.id, mappingId: undefined, fileName, fileHash: id, sheetName: undefined }, at)
      setBalanceCheck(db, id, check, at)
    }
    const verified = (opening: number, closing: number) =>
      ({
        kind: 'VERIFIED',
        order: 'NEWEST_FIRST',
        openingBalance: money(opening, 'ILS'),
        closingBalance: money(closing, 'ILS'),
        rowCount: 2,
      }) as const

    // August to October is read first and January to August a minute after it,
    // the order a real document was read in.
    read('aug', 'aug-oct.xlsx', 1, verified(500_000, 1_750_000))
    read('jan', 'jan-aug.csv', 2, verified(1_200_000, 850_000))
    insertTransactions(
      db,
      [
        transaction(bank.id, 'aug-1', 1_000_000, 8, 10, 2026, 'aug'),
        transaction(bank.id, 'aug-2', 250_000, 9, 15, 2026, 'aug'),
        transaction(bank.id, 'jan-1', -200_000, 1, 2, 2026, 'jan'),
        transaction(bank.id, 'jan-2', -150_000, 7, 30, 2026, 'jan'),
      ],
      1,
    )
    setSessionStatus(db, 'aug', 'COMMITTED', 2)
    setSessionStatus(db, 'jan', 'COMMITTED', 3)

    const both = accountBalances(db, 'ILS')[0]
    expect(both?.statementBalance).toEqual(money(1_750_000, 'ILS'))
    expect(both?.balanceTo).toEqual(localDate(2026, 9, 15))
    expect(both?.newerWithoutBalance).toBeUndefined()

    // A later statement whose running balance did not add up: the August one's
    // balance still stands, and says it is older than what was read since.
    read('oct', 'oct.xlsx', 4, {
      kind: 'DIVERGED',
      order: 'NEWEST_FIRST',
      at: {
        ref: 'r2',
        expected: money(1, 'ILS'),
        stated: money(2, 'ILS'),
        difference: money(1, 'ILS'),
        verifiedBefore: 0,
      },
    })
    insertTransactions(db, [transaction(bank.id, 'oct-1', -50_000, 9, 30, 2026, 'oct')], 4)
    setSessionStatus(db, 'oct', 'COMMITTED', 5)
    setOpeningBalance(db, bank.id, { amount: money(500_000, 'ILS'), date: localDate(2026, 8, 1) }, 6)

    const stale = accountBalances(db, 'ILS')[0]
    expect(stale?.statementBalance).toEqual(money(1_750_000, 'ILS'))
    expect(stale?.balanceTo).toEqual(localDate(2026, 9, 15))
    expect(stale?.newerWithoutBalance).toEqual({ fileName: 'oct.xlsx', to: localDate(2026, 9, 30) })
    expect(stale?.statementTo).toEqual(localDate(2026, 9, 30))
    // What moved stops at the balance's day, so the older balance is still checked honestly.
    expect(stale?.moved).toEqual(money(1_250_000, 'ILS'))
    expect(stale?.check).toEqual({ kind: 'ADDS_UP' })
  })
})
