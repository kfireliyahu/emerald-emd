import { describe, expect, it } from 'vitest'

import { fromMajorUnits, money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { createLedgerDatabase, insertTransaction } from '../packs/ledger/testing.ts'
import { createAccount } from './accountRepository.ts'
import { addPayment, confirmPayment, createDebt } from './debtRepository.ts'
import { waitingItems } from './homeRepository.ts'
import { skipMerchant } from './labelingQueueRepository.ts'
import { createPaycheck, readNoPayMonths, setNoPayMonths } from './paycheckRepository.ts'

const ILS = 'ILS'
const AUGUST = localDate(2026, 8, 15)

describe('what waits for an answer (M31 U1)', () => {
  it('asks for last month’s payslip until it is read or said to have had no pay', async () => {
    const db = await createLedgerDatabase()
    createPaycheck(
      db,
      { period: { year: 2026, month: 6 }, paymentDate: localDate(2026, 7, 9), gross: money(2_500_000, ILS), net: money(1_753_300, ILS) },
      1,
    )
    const kinds = (): readonly string[] => waitingItems(db, AUGUST, ILS).map((item) => item.kind)

    expect(waitingItems(db, AUGUST, ILS).find((item) => item.kind === 'MISSING_PAYSLIP')?.period).toEqual({ year: 2026, month: 7 })

    setNoPayMonths(db, [{ year: 2026, month: 7 }], true, 2)
    expect(readNoPayMonths(db)).toEqual(new Set(['2026-07']))
    expect(kinds()).not.toContain('MISSING_PAYSLIP')

    setNoPayMonths(db, [{ year: 2026, month: 7 }], false, 3)
    expect(kinds()).toContain('MISSING_PAYSLIP')
  })

  it('counts the payments to confirm the ledger’s start view asks about, and nothing once it is put away (M36 U06)', async () => {
    const db = await createLedgerDatabase()
    const debt = createDebt(
      db,
      {
        name: 'Car loan',
        kind: 'BANK_LOAN',
        principalAmount: money(1_800_000, ILS),
        openedDate: localDate(2025, 12, 1),
        tracking: { kind: 'NONE' },
      },
      1,
    )
    const read = addPayment(db, { debtId: debt.id, date: localDate(2026, 7, 1), amount: money(150_000, ILS), isConfirmed: false }, 1)
    addPayment(db, { debtId: debt.id, date: localDate(2026, 6, 1), amount: money(150_000, ILS) }, 1)
    const count = (): number | undefined => waitingItems(db, AUGUST, ILS).find((item) => item.kind === 'UNCONFIRMED_PAYMENTS')?.count

    expect(count()).toBe(1)
    confirmPayment(db, read.id, 2)
    expect(count()).toBeUndefined()

    addPayment(db, { debtId: debt.id, date: localDate(2026, 8, 1), amount: money(150_000, ILS), isConfirmed: false }, 3)
    db.run(`DELETE FROM format_view_column WHERE format_name = 'debt_payment' AND view = 'start'`)
    expect(count()).toBeUndefined()
  })

  it('counts the rows By merchant still asks about, and not a skipped merchant’s', async () => {
    const db = await createLedgerDatabase()
    const card = createAccount(db, { name: 'Card', kind: 'CREDIT_CARD' }, 1)
    for (const [id, merchant] of [['a', 'Corner Cafe'], ['b', 'Corner Cafe'], ['c', 'Bookshop']] as const) {
      insertTransaction(
        db,
        {
          id,
          accountId: card.id,
          transactionDate: localDate(2026, 7, 3),
          chargeDate: localDate(2026, 7, 3),
          billingPeriod: { year: 2026, month: 7 },
          amount: fromMajorUnits(-40, ILS),
          direction: 'OUTFLOW',
          merchantRaw: merchant,
          merchantNormalized: merchant,
          providerCategory: undefined,
          cardLast4: undefined,
          reference: undefined,
          note: undefined,
          installment: undefined,
          foreign: undefined,
          naturalKey: `key-${id}`,
          importSessionId: undefined,
          sourceRowRef: undefined,
        },
        1,
      )
    }
    const item = () => waitingItems(db, AUGUST, ILS).find((one) => one.kind === 'UNCATEGORIZED')

    expect(item()).toMatchObject({ count: 2, rows: 3 })
    skipMerchant(db, 'Corner Cafe', 2)
    expect(item()).toMatchObject({ count: 1, rows: 1 })
    skipMerchant(db, 'Bookshop', 3)
    expect(item()).toBeUndefined()
  })

  it('waits for nothing in an empty document', async () => {
    const db = await createLedgerDatabase()
    expect(waitingItems(db, AUGUST, ILS)).toEqual([])
  })
})
