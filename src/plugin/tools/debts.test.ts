import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { exportDatabase, openDatabase } from '@/data/db/database.ts'
import { listDebts, listPayments } from '@/data/repositories/debtRepository.ts'

import { createDebtsTool, recordDebtPaymentsTool } from './debts.ts'
import { debtsTool } from './wealth.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'
import { listBackups } from '../backup.ts'

async function fixture(): Promise<string> {
  const db = await createLedgerDatabase()
  const path = join(await tempDir('emerald-debts-'), 'doc.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  return path
}

async function reopen(path: string) {
  return openDatabase(await readFile(path))
}

const CAR_LOAN = {
  name: 'Car loan',
  kind: 'BANK_LOAN',
  principal_amount: 80_000,
  opened_date: '2025-01-15',
  monthly_payment: 1_500,
}

async function withDebt(path: string, extra: Record<string, unknown> = {}): Promise<void> {
  await createDebtsTool.run({ path, commit: true, debts: [{ ...CAR_LOAN, ...extra }] }, NO_CLIENT)
}

describe('create_debts', () => {
  it('dry-runs by default, writing nothing', async () => {
    const path = await fixture()
    const before = await readFile(path)

    const text = await createDebtsTool.run({ path, debts: [CAR_LOAN] }, NO_CLIENT)

    expect(text).toContain('Nothing has been written')
    expect(text).toContain('1 debt** would be created')
    expect(await readFile(path)).toEqual(before)
  })

  it('writes the principal, not a balance, and copies the document first', async () => {
    const path = await fixture()

    const text = await createDebtsTool.run(
      {
        path,
        commit: true,
        debts: [CAR_LOAN, { name: 'Owed to Dani', kind: 'PERSONAL', principal_amount: 5_000, opened_date: '2026-03-01' }],
      },
      NO_CLIENT,
    )

    expect(text).toContain('Created 2 debts')
    expect((await listBackups(path)).length).toBe(1)

    const db = await reopen(path)
    const debts = listDebts(db)
    expect(debts.length).toBe(2)
    expect(debts.find((one) => one.name === 'Car loan')?.principalAmount.minor).toBe(8_000_000)
    // `NONE` is a real answer: money owed to a friend is entered by hand.
    expect(debts.find((one) => one.name === 'Owed to Dani')?.tracking.kind).toBe('NONE')
    db.close()
  })

  it('sets up merchant tracking and says where those payments will land', async () => {
    const path = await fixture()

    const text = await createDebtsTool.run(
      { path, debts: [{ ...CAR_LOAN, tracking_kind: 'MERCHANT_PATTERN', tracking_ref: 'לאומי הלוואה' }] },
      NO_CLIENT,
    )

    expect(text).toContain('MERCHANT_PATTERN')
    // The honest half: discovery produces unconfirmed payments and the queue is
    // app-only, so a conversation that sets this up has to say so.
    expect(text).toContain('unconfirmed')
    expect(text).toContain('#/wealth/debts')
  })

  it('refuses installment-group tracking, because promoting one does more', async () => {
    const path = await fixture()

    const text = await createDebtsTool.run(
      {
        path,
        debts: [
          { ...CAR_LOAN, tracking_kind: 'CARD_INSTALLMENT_GROUP', tracking_ref: 'group-1' },
        ],
      },
      NO_CLIENT,
    )

    expect(text).toContain('app-only')
    expect(text).toContain('confirms the slices already charged')
    expect(text).toContain('Nothing to create')
  })

  it('refuses a tracking ref that names nothing, and a name it already has', async () => {
    const path = await fixture()
    await withDebt(path)

    const dupe = await createDebtsTool.run({ path, debts: [{ ...CAR_LOAN, name: 'car LOAN' }] }, NO_CLIENT)
    expect(dupe).toContain('already exists')
    expect(dupe).toContain('`record_debt_payments`')

    const badCategory = await createDebtsTool.run(
      {
        path,
        debts: [
          { name: 'Other', kind: 'OTHER', principal_amount: 100, opened_date: '2026-01-01',
            tracking_kind: 'CATEGORY', tracking_ref: 'cat:nope' },
        ],
      },
      NO_CLIENT,
    )
    expect(badCategory).toContain('no category with id cat:nope')

    const noRef = await createDebtsTool.run(
      {
        path,
        debts: [
          { name: 'Other', kind: 'OTHER', principal_amount: 100, opened_date: '2026-01-01',
            tracking_kind: 'MERCHANT_PATTERN' },
        ],
      },
      NO_CLIENT,
    )
    expect(noRef).toContain('needs a `tracking_ref`')
  })

  it('refuses what no debt can be, using the domain’s own list', async () => {
    const path = await fixture()

    const zero = await createDebtsTool.run(
      { path, debts: [{ name: 'Nothing', kind: 'OTHER', principal_amount: 0, opened_date: '2026-01-01' }] },
      NO_CLIENT,
    )
    expect(zero).toContain('counts down from')

    const backwards = await createDebtsTool.run(
      { path, debts: [{ ...CAR_LOAN, expected_end_date: '2024-01-01' }] },
      NO_CLIENT,
    )
    expect(backwards).toContain('before the date it was opened')
  })

  it('teaches the shape rather than throwing a stack trace', async () => {
    const path = await fixture()

    await expect(createDebtsTool.run({ path, debts: [] }, NO_CLIENT)).rejects.toThrow(
      /non-empty array/,
    )
    await expect(
      createDebtsTool.run({ path, debts: [{ name: 'x', kind: 'LOAN' }] }, NO_CLIENT),
    ).rejects.toThrow(/kind must be one of/)
    await expect(
      createDebtsTool.run({ path, debts: [{ name: 'x', kind: 'OTHER' }] }, NO_CLIENT),
    ).rejects.toThrow(/principal_amount/)
    await expect(
      createDebtsTool.run(
        { path, debts: [{ name: 'x', kind: 'OTHER', principal_amount: 10 }] },
        NO_CLIENT,
      ),
    ).rejects.toThrow(/opened_date/)
  })
})

describe('record_debt_payments', () => {
  it('brings the outstanding balance down, and the read tool agrees', async () => {
    const path = await fixture()
    await withDebt(path)

    const text = await recordDebtPaymentsTool.run(
      {
        path,
        commit: true,
        payments: [
          { debt: 'Car loan', amount: 1_500, date: '2026-05-01' },
          { debt: 'Car loan', amount: 1_500, date: '2026-06-01' },
        ],
      },
      NO_CLIENT,
    )

    expect(text).toContain('Recorded 2 payments')

    const db = await reopen(path)
    expect(listPayments(db).length).toBe(2)
    // Recorded by a person, so confirmed — the review queue is for answers the
    // app produced, not the user's own.
    expect(listPayments(db).every((one) => one.isConfirmed)).toBe(true)
    db.close()

    const read = await debtsTool.run({ path }, NO_CLIENT)
    expect(read).toContain('₪77,000.00')
  })

  it('is all principal unless the payment says otherwise', async () => {
    const path = await fixture()
    await withDebt(path)

    const text = await recordDebtPaymentsTool.run(
      {
        path,
        commit: true,
        payments: [{ debt: 'Car loan', amount: 1_500, date: '2026-05-01', interest_portion: 300 }],
      },
      NO_CLIENT,
    )
    expect(text).toContain('Recorded 1 payment')

    const db = await reopen(path)
    expect(listPayments(db)[0]?.interestPortion.minor).toBe(30_000)
    db.close()

    // ₪1,500 paid, ₪300 of it interest, so ₪1,200 comes off ₪80,000.
    const read = await debtsTool.run({ path }, NO_CLIENT)
    expect(read).toContain('₪78,800.00')
  })

  it('shows the principal split in the preview', async () => {
    const path = await fixture()
    await withDebt(path)

    const text = await recordDebtPaymentsTool.run(
      { path, payments: [{ debt: 'Car loan', amount: 1_500, date: '2026-05-01', interest_portion: 300 }] },
      NO_CLIENT,
    )

    expect(text).toContain('Off the principal')
    expect(text).toContain('₪1,200.00')
  })

  it('allows an overpayment and flags it', async () => {
    const path = await fixture()
    await createDebtsTool.run(
      {
        path,
        commit: true,
        debts: [{ name: 'Owed to Dani', kind: 'PERSONAL', principal_amount: 5_000, opened_date: '2026-03-01' }],
      },
      NO_CLIENT,
    )

    const text = await recordDebtPaymentsTool.run(
      { path, payments: [{ debt: 'Owed to Dani', amount: 6_000, date: '2026-06-01' }] },
      NO_CLIENT,
    )

    expect(text).toContain('1 payment** would be recorded')
    expect(text).toContain('more than the')
    expect(text).toContain('more than is outstanding')
  })

  it('refuses what no payment can be', async () => {
    const path = await fixture()
    await withDebt(path)

    const unknown = await recordDebtPaymentsTool.run(
      { path, payments: [{ debt: 'Car Loanx', amount: 100, date: '2026-06-01' }] },
      NO_CLIENT,
    )
    expect(unknown).toContain('`create_debts`')
    expect(unknown).toContain('Nothing to record')

    const negative = await recordDebtPaymentsTool.run(
      { path, payments: [{ debt: 'Car loan', amount: -100, date: '2026-06-01' }] },
      NO_CLIENT,
    )
    expect(negative).toContain('a magnitude')

    const tooMuchInterest = await recordDebtPaymentsTool.run(
      { path, payments: [{ debt: 'Car loan', amount: 100, date: '2026-06-01', interest_portion: 200 }] },
      NO_CLIENT,
    )
    expect(tooMuchInterest).toContain('larger than the payment')
  })
})
