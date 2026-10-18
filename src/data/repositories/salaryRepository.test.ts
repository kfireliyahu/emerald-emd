/**
 * A salary comes in once, and the slip and the deposit agree (M28 F5, D-317).
 *
 * A real case, synthesised: April's slip is paid on 5 May, May's on 8
 * June, and the deposit that arrived on 3 May was filed under Salary with the
 * clearing house's name on it. Home's May showed May's slip *and* that deposit,
 * which is April's pay: two salaries, a month apart, side by side.
 */

import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { createAccount } from './accountRepository.ts'
import { query } from '../db/database.ts'
import { setCategoryManually } from './categoryRepository.ts'
import { createPaycheck } from './paycheckRepository.ts'
import { salaryCoveredRefs, salaryReconciliation, setSalaryDecision, slipBankStatus } from './salaryRepository.ts'
import { incomeObservations, monthlyReport } from './statisticsRepository.ts'
import { findTransactionById, type InsertableTransaction } from './transactionRepository.ts'

const ils = (minor: number) => money(minor, 'ILS')
const NOW = 1_755_000_000_000
const AS_OF = localDate(2026, 8, 12)

function row(id: string, minor: number, date: ReturnType<typeof localDate>, name: string): InsertableTransaction {
  return {
    id,
    accountId: 'bank',
    transactionDate: date,
    chargeDate: undefined,
    billingPeriod: undefined,
    amount: ils(minor),
    direction: minor > 0 ? 'INFLOW' : 'OUTFLOW',
    merchantRaw: name,
    merchantNormalized: name,
    providerCategory: undefined,
    cardLast4: undefined,
    reference: undefined,
    note: undefined,
    installment: undefined,
    foreign: undefined,
    naturalKey: id,
    importSessionId: undefined,
    sourceRowRef: undefined,
  }
}

const slip = (db: Database, month: number, paid: ReturnType<typeof localDate>, net: number) =>
  createPaycheck(
    db,
    { period: { year: 2026, month }, paymentDate: paid, gross: ils(net + 5_000_00), net: ils(net) },
    NOW,
  )

async function setup(): Promise<{ db: Database; salary: string }> {
  const db = await createLedgerDatabase()
  createAccount(db, { name: 'Bank', kind: 'BANK', last4: '4321' }, NOW)
  db.run("UPDATE fmt_account SET id = 'bank' WHERE last4 = '4321'")
  const salary = String(query(db, "SELECT id FROM fmt_category WHERE name = 'Salary'")[0]?.['id'])
  return { db, salary }
}

/** A deposit with a clearing house's name on it, filed under Salary by the person. */
function deposit(db: Database, salary: string, id: string, minor: number, date: ReturnType<typeof localDate>): void {
  insertTransaction(db, row(id, minor, date, 'העברה מאקמי'), NOW)
  const stored = String(query(db, 'SELECT id FROM fmt_transaction WHERE natural_key = ?', [id])[0]?.['id'])
  setCategoryManually(db, stored, salary, NOW)
}

describe('a salary comes in once', () => {
  it('pairs the deposit with the slip of the month before, and counts the slip alone in each month', async () => {
    const { db, salary } = await setup()
    slip(db, 4, localDate(2026, 5, 5), 15_291_00)
    slip(db, 5, localDate(2026, 6, 8), 18_033_00)
    deposit(db, salary, 'd-may', 15_291_00, localDate(2026, 5, 3))
    deposit(db, salary, 'd-jun', 18_033_00, localDate(2026, 6, 6))

    const may = incomeObservations(db, { year: 2026, month: 5 })

    // One line, the slip for May, not the deposit that is April's pay.
    expect(may.map((one) => [one.kind, one.amount])).toEqual([['PAYSLIP', ils(18_033_00)]])
    expect(may[0]?.salary).toMatchObject({ kind: 'AGREES', landed: ils(18_033_00) })
    expect(monthlyReport(db, { year: 2026, month: 5 }, AS_OF).summary?.income).toEqual(ils(18_033_00))
    expect(monthlyReport(db, { year: 2026, month: 4 }, AS_OF).summary?.income).toEqual(ils(15_291_00))
    expect(monthlyReport(db, { year: 2026, month: 5 }, AS_OF).detail.problems).toBe(0)
    expect(salaryCoveredRefs(db).size).toBe(2)
  })

  it('is order-blind: the deposit first, the slips entered afterwards', async () => {
    const { db, salary } = await setup()
    // A slip for another month, so the document keeps slips at all.
    slip(db, 1, localDate(2026, 2, 9), 14_015_00)
    deposit(db, salary, 'd-may', 15_291_00, localDate(2026, 5, 3))
    // No slip yet: the deposit is the only evidence and is counted, and said to have no slip.
    const before = incomeObservations(db, { year: 2026, month: 5 })
    expect(before).toHaveLength(1)
    expect(before[0]?.salary).toEqual({ kind: 'NO_SLIP' })

    slip(db, 4, localDate(2026, 5, 5), 15_291_00)
    expect(incomeObservations(db, { year: 2026, month: 5 })).toEqual([])
  })

  it('shows a disagreeing deposit with its gap, and still counts the slip once', async () => {
    const { db, salary } = await setup()
    slip(db, 4, localDate(2026, 5, 5), 15_291_00)
    deposit(db, salary, 'd-may', 15_291_00 - 2_742_00, localDate(2026, 5, 3))

    const april = incomeObservations(db, { year: 2026, month: 4 })
    expect(april[0]?.salary).toMatchObject({ kind: 'DIFFERS', difference: ils(-2_742_00) })
    expect(monthlyReport(db, { year: 2026, month: 4 }, AS_OF).summary?.income).toEqual(ils(15_291_00))
    expect(monthlyReport(db, { year: 2026, month: 4 }, AS_OF).detail.problems).toBe(1)
    expect(incomeObservations(db, { year: 2026, month: 5 })).toEqual([])
  })

  it('says a second deposit is a gap, not another salary', async () => {
    const { db, salary } = await setup()
    slip(db, 4, localDate(2026, 5, 5), 15_291_00)
    deposit(db, salary, 'd-1', 15_291_00, localDate(2026, 5, 3))
    deposit(db, salary, 'd-2', 2_742_00, localDate(2026, 5, 20))

    const groups = salaryReconciliation(db)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ verdict: 'DIFFERS', difference: ils(2_742_00) })
  })

  it('says a slip with no deposit, only where the bank statements cover it', async () => {
    const { db, salary } = await setup()
    const paid = slip(db, 4, localDate(2026, 5, 5), 15_291_00)
    const old = slip(db, 1, localDate(2026, 2, 9), 14_015_00)
    deposit(db, salary, 'd-other', 777_00, localDate(2026, 6, 1))
    insertTransaction(db, row('rent', -3_000_00, localDate(2026, 5, 10), 'landlord'), NOW)

    const status = slipBankStatus(db)
    expect(status.get(paid.paycheck.id)?.kind).toBe('NO_DEPOSIT')
    // No bank row in February: nothing was looked for, so nothing is said to be missing.
    expect(status.get(old.paycheck.id)?.kind).toBe('UNCHECKED')
  })

  it('keeps a matched deposit counted when the person says it is extra', async () => {
    const { db, salary } = await setup()
    slip(db, 4, localDate(2026, 5, 5), 15_291_00)
    deposit(db, salary, 'd-may', 17_000_00, localDate(2026, 5, 3))
    const [group] = salaryReconciliation(db)
    setSalaryDecision(db, group!, 'COUNTED', NOW)

    expect(salaryCoveredRefs(db).size).toBe(0)
  })

  it('reads the answer beside the match and never writes it onto the row (M36 U04)', async () => {
    const { db, salary } = await setup()
    slip(db, 4, localDate(2026, 5, 5), 15_291_00)
    deposit(db, salary, 'd-jul', 9_000_00, localDate(2026, 7, 3))
    const stored = String(query(db, "SELECT id FROM fmt_transaction WHERE natural_key = 'd-jul'")[0]?.['id'])
    const group = salaryReconciliation(db).find((each) => each.verdict === 'NO_PAYCHECK')
    if (group === undefined) throw new Error('no deposit without a slip')

    setSalaryDecision(db, group, 'EXCLUDED', NOW)
    expect(salaryCoveredRefs(db).has(stored)).toBe(true)
    expect(findTransactionById(db, stored)?.isExcludedFromStats).toBe(false)

    setSalaryDecision(db, group, 'PENDING', NOW)
    expect(salaryCoveredRefs(db).has(stored)).toBe(false)
  })
})
