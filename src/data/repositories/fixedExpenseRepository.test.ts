import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { detectFixedExpenses, proposeFixedExpense } from '@/domain/fixedExpenses.ts'
import { exportDatabase, openDatabase } from '../db/database.ts'
import { createAccount } from './accountRepository.ts'
import { UNCATEGORIZED_ID } from './categoryRepository.ts'
import {
  actualsByCategory,
  actualsByMerchant,
  clearDismissal,
  confirmCandidate,
  createFixedExpense,
  deleteFixedExpense,
  dismissMerchant,
  dismissedMerchants,
  endFixedExpense,
  findFixedExpense,
  listExpenseObservations,
  merchantObservations,
  listFixedExpenses,
  readDismissals,
  trackedMerchants,
  updateFixedExpense,
} from './fixedExpenseRepository.ts'
import { setExcludedFromStats, type InsertableTransaction } from './transactionRepository.ts'

const ILS = 'ILS'
const ACCOUNT = 'acc-1'

function row(overrides: Partial<InsertableTransaction> & { id: string }): InsertableTransaction {
  return {
    accountId: ACCOUNT,
    transactionDate: localDate(2026, 1, 1),
    chargeDate: undefined,
    billingPeriod: undefined,
    amount: money(-540_000, ILS),
    direction: 'OUTFLOW',
    merchantRaw: 'שכר דירה',
    merchantNormalized: 'שכר דירה',
    providerCategory: undefined,
    cardLast4: undefined,
    reference: undefined,
    note: undefined,
    installment: undefined,
    foreign: undefined,
    naturalKey: overrides.id,
    importSessionId: undefined,
    sourceRowRef: undefined,
    ...overrides,
  }
}

/**
 * Six months of rent, three of electricity, one excluded card settlement and one
 * refund — the shapes `listExpenseObservations` has to include and leave out.
 */
async function seeded(): Promise<Database> {
  const db = await createLedgerDatabase()
  createAccount(db, { name: 'Cal – Visa 1234', kind: 'CREDIT_CARD', last4: '1234' }, 1)
  db.run("UPDATE fmt_account SET id = ? WHERE last4 = '1234'", [ACCOUNT])

  for (const month of [1, 2, 3, 4, 5, 6]) {
    insertTransaction(db, row({ id: `rent-${month}`, transactionDate: localDate(2026, month, 1) }), 1)
  }
  for (const month of [4, 5, 6]) {
    insertTransaction(
      db,
      row({
        id: `power-${month}`,
        transactionDate: localDate(2026, month, 20),
        // A charge date in the following month: the basis is charge date first
        // (D-006), so these belong to May, June and July.
        chargeDate: localDate(2026, month + 1, 2),
        amount: money(-43_000, ILS),
        merchantRaw: 'חברת החשמל',
        merchantNormalized: 'חברת החשמל',
      }),
      1,
    )
  }

  insertTransaction(
    db,
    row({
      id: 'settlement',
      transactionDate: localDate(2026, 6, 2),
      amount: money(-1_240_000, ILS),
      merchantRaw: 'חיוב כרטיס אשראי',
      merchantNormalized: 'חיוב כרטיס אשראי',
    }),
    1,
  )
  setExcludedFromStats(db, 'settlement', true, 2)

  insertTransaction(
    db,
    row({
      id: 'refund',
      transactionDate: localDate(2026, 6, 8),
      amount: money(9_900, ILS),
      direction: 'INFLOW',
      merchantRaw: 'זיכוי',
      merchantNormalized: 'זיכוי',
    }),
    1,
  )

  return db
}

describe('listExpenseObservations', () => {
  it('reads outflows on the charge-date basis and leaves out what is not spending', async () => {
    const db = await seeded()
    const observations = listExpenseObservations(db, localDate(2026, 1, 1), localDate(2026, 12, 31))

    const merchants = new Set(observations.map((one) => one.merchantNormalized))
    expect(merchants).toEqual(new Set(['שכר דירה', 'חברת החשמל']))

    // The electricity charged on 2 May is May's, not April's.
    const power = observations.filter((one) => one.merchantNormalized === 'חברת החשמל')
    expect(power.map((one) => one.date.month)).toEqual([5, 6, 7])
  })

  it('bounds the window on the same basis it reads', async () => {
    const db = await seeded()
    const firstQuarter = listExpenseObservations(db, localDate(2026, 1, 1), localDate(2026, 3, 31))

    expect(firstQuarter).toHaveLength(3)
    expect(firstQuarter.every((one) => one.merchantNormalized === 'שכר דירה')).toBe(true)
  })

  it("reports the system category as no category rather than as 'Uncategorized'", async () => {
    const db = await seeded()
    db.run('UPDATE fmt_transaction SET category = ? WHERE id = ?', [UNCATEGORIZED_ID, 'rent-1'])

    const observations = listExpenseObservations(db, localDate(2026, 1, 1), localDate(2026, 1, 31))
    expect(observations[0]?.categoryId).toBeUndefined()
  })

  it('feeds the detector, end to end', async () => {
    const db = await seeded()
    const candidates = detectFixedExpenses(
      listExpenseObservations(db, localDate(2026, 1, 1), localDate(2026, 6, 30)),
      { endingAt: { year: 2026, month: 6 }, windowMonths: 6 },
    )

    expect(candidates.map((one) => one.merchantNormalized)).toEqual(['שכר דירה'])
    expect(candidates[0]?.medianAmount).toEqual(money(540_000, ILS))
    expect(candidates[0]?.confidence).toBe('HIGH')
  })
})

describe('merchantObservations', () => {
  it('reads one name over the whole ledger, with no window', async () => {
    const db = await seeded()

    const rent = merchantObservations(db, 'שכר דירה')
    expect(rent).toHaveLength(6)
    expect(rent.map((one) => one.date.month)).toEqual([1, 2, 3, 4, 5, 6])
    expect(merchantObservations(db, 'לא קיים')).toEqual([])
  })

  it('leaves out exactly what the detector’s read leaves out', async () => {
    const db = await seeded()

    // A card settlement is the same money as the charges under it, and a
    // refund is not spending — neither becomes a bill because somebody
    // pointed at it from the queue.
    expect(merchantObservations(db, 'חיוב כרטיס אשראי')).toEqual([])
    expect(merchantObservations(db, 'זיכוי')).toEqual([])
  })

  it('seeds a promotion the detector would never have offered', async () => {
    const db = await seeded()
    insertTransaction(
      db,
      row({
        id: 'insurance',
        transactionDate: localDate(2026, 3, 4),
        amount: money(-210_000, ILS),
        merchantRaw: 'ביטוח רכב',
        merchantNormalized: 'ביטוח רכב',
      }),
      1,
    )

    const proposal = proposeFixedExpense(merchantObservations(db, 'ביטוח רכב'), 'ביטוח רכב')
    expect(proposal?.medianAmount).toEqual(money(210_000, ILS))
    expect(proposal?.cadence).toBeUndefined()
    expect(
      detectFixedExpenses(listExpenseObservations(db, localDate(2026, 1, 1), localDate(2026, 6, 30)), {
        endingAt: { year: 2026, month: 6 },
        windowMonths: 6,
      }).map((one) => one.merchantNormalized),
    ).toEqual(['שכר דירה'])
  })
})

describe('actualsByMerchant', () => {
  it("totals a month's charges per merchant, as magnitudes", async () => {
    const db = await seeded()
    const actuals = actualsByMerchant(db, localDate(2026, 6, 1), localDate(2026, 6, 30))

    expect(actuals.get('שכר דירה')).toEqual(money(540_000, ILS))
    expect(actuals.get('חיוב כרטיס אשראי')).toBeUndefined()
    expect(actuals.get('זיכוי')).toBeUndefined()
  })
})

describe('actualsByCategory', () => {
  it('answers the other half of what the ledger can be asked', async () => {
    const db = await seeded()
    db.run("UPDATE fmt_transaction SET category = 'cat:housing' WHERE id = 'rent-6'")

    const actuals = actualsByCategory(db, localDate(2026, 6, 1), localDate(2026, 6, 30))
    expect(actuals.get('cat:housing')).toEqual(money(540_000, ILS))
    // A category-matched expense that the ledger *can* answer is therefore not
    // reported missing; one it cannot answer at all is `NOT_TRACKED`, not
    // missing (`monthVariance`).
    expect(actuals.size).toBe(1)
  })
})

describe('fixed expense CRUD', () => {
  it('round-trips every field through a real file', async () => {
    const db = await createLedgerDatabase()
    const created = createFixedExpense(
      db,
      {
        name: 'Home insurance',
        matchKind: 'MANUAL_ONLY',
        expectedAmount: money(120_000, ILS),
        cadence: 'YEARLY',
        amountVariability: 'FIXED',
        dayOfMonthHint: 11,
        isDiscretionary: false,
        startedAt: localDate(2026, 2, 11),
      },
      10,
    )

    const reopened = await openDatabase(exportDatabase(db))
    const found = findFixedExpense(reopened, created.id)

    expect(found).toEqual(created)
    expect(found?.cadence).toBe('YEARLY')
    expect(found?.startedAt).toEqual(localDate(2026, 2, 11))
    expect(found?.source).toBe('USER_DEFINED')
  })

  it('edits in place and leaves out what was left out', async () => {
    const db = await createLedgerDatabase()
    const created = createFixedExpense(
      db,
      { name: 'Gym', matchKind: 'MERCHANT_PATTERN', matchRef: 'חדר כושר', expectedAmount: money(19_900, ILS) },
      10,
    )

    updateFixedExpense(db, created.id, { expectedAmount: money(22_900, ILS) }, 20)
    const edited = findFixedExpense(db, created.id)

    expect(edited?.expectedAmount).toEqual(money(22_900, ILS))
    expect(edited?.name).toBe('Gym')
    expect(edited?.matchRef).toBe('חדר כושר')
  })

  it('ends a subscription without losing it, and soft-deletes on request', async () => {
    const db = await createLedgerDatabase()
    const created = createFixedExpense(
      db,
      { name: 'Netflix', matchKind: 'MERCHANT_PATTERN', matchRef: 'נטפליקס', expectedAmount: money(5_490, ILS) },
      10,
    )

    endFixedExpense(db, created.id, localDate(2026, 6, 30), 20)
    const ended = findFixedExpense(db, created.id)
    expect(ended?.endedAt).toEqual(localDate(2026, 6, 30))
    expect(ended?.isActive).toBe(false)

    deleteFixedExpense(db, created.id, 30)
    expect(findFixedExpense(db, created.id)).toBeUndefined()
    expect(listFixedExpenses(db)).toEqual([])
  })

  it('lists the dearest first and names what is already tracked', async () => {
    const db = await createLedgerDatabase()
    createFixedExpense(
      db,
      { name: 'Gym', matchKind: 'MERCHANT_PATTERN', matchRef: 'חדר כושר', expectedAmount: money(19_900, ILS) },
      10,
    )
    createFixedExpense(
      db,
      { name: 'Rent', matchKind: 'MERCHANT_PATTERN', matchRef: 'שכר דירה', expectedAmount: money(540_000, ILS) },
      10,
    )
    createFixedExpense(
      db,
      { name: 'Pension', matchKind: 'PAYCHECK_DEDUCTION', matchRef: 'ded:pension', expectedAmount: money(150_000, ILS) },
      10,
    )

    expect(listFixedExpenses(db).map((one) => one.name)).toEqual(['Rent', 'Pension', 'Gym'])
    // Only merchant patterns can shadow a candidate; a payroll deduction never
    // came from the ledger and cannot be suggested from it either.
    expect([...trackedMerchants(db)].sort()).toEqual(['חדר כושר', 'שכר דירה'])
  })
})

describe('confirming a candidate', () => {
  async function candidate(db: Database) {
    const found = detectFixedExpenses(
      listExpenseObservations(db, localDate(2026, 1, 1), localDate(2026, 6, 30)),
      { endingAt: { year: 2026, month: 6 }, windowMonths: 6 },
    )[0]
    if (found === undefined) throw new Error('the fixture stopped producing a candidate')
    return found
  }

  it('turns the detector output into a row, anchored to the first month seen', async () => {
    const db = await seeded()
    const confirmed = confirmCandidate(db, await candidate(db), undefined, 10)

    expect(confirmed.matchKind).toBe('MERCHANT_PATTERN')
    expect(confirmed.matchRef).toBe('שכר דירה')
    expect(confirmed.expectedAmount).toEqual(money(540_000, ILS))
    expect(confirmed.cadence).toBe('MONTHLY')
    expect(confirmed.source).toBe('DETECTED_CONFIRMED')
    expect(confirmed.startedAt).toEqual(localDate(2026, 1, 1))
  })

  it('is idempotent — confirming twice updates rather than duplicates', async () => {
    const db = await seeded()
    const found = await candidate(db)

    const first = confirmCandidate(db, found, undefined, 10)
    const second = confirmCandidate(db, found, { expectedAmount: money(560_000, ILS) }, 20)

    expect(second.id).toBe(first.id)
    expect(listFixedExpenses(db)).toHaveLength(1)
    expect(second.expectedAmount).toEqual(money(560_000, ILS))
  })

  it('takes the amount and cadence the user changed before agreeing', async () => {
    const db = await seeded()
    const confirmed = confirmCandidate(
      db,
      await candidate(db),
      { name: 'Rent', cadence: 'QUARTERLY', expectedAmount: money(1_620_000, ILS) },
      10,
    )

    expect(confirmed.name).toBe('Rent')
    expect(confirmed.cadence).toBe('QUARTERLY')
    expect(confirmed.expectedAmount).toEqual(money(1_620_000, ILS))
  })

  it('brings a merchant back rather than leaving the old row switched off', async () => {
    const db = await seeded()
    const found = await candidate(db)

    const first = confirmCandidate(db, found, undefined, 10)
    endFixedExpense(db, first.id, localDate(2026, 3, 31), 20)
    const again = confirmCandidate(db, found, undefined, 30)

    expect(again.id).toBe(first.id)
    expect(again.isActive).toBe(true)
  })
})

describe('dismissals', () => {
  it('remembers a merchant the user said no to, and when', async () => {
    const db = await createLedgerDatabase()
    dismissMerchant(db, 'בית קפה', 1_700_000)

    expect(dismissedMerchants(db)).toEqual(['בית קפה'])
    expect(readDismissals(db).get('בית קפה')).toBe(1_700_000)
  })

  it('survives a save and reopen, which is the whole point of storing it', async () => {
    const db = await createLedgerDatabase()
    dismissMerchant(db, 'בית קפה', 1)
    dismissMerchant(db, 'רהיטים', 2)

    const reopened = await openDatabase(exportDatabase(db))
    expect([...dismissedMerchants(reopened)].sort()).toEqual(['בית קפה', 'רהיטים'])
  })

  it('can be cleared, so the merchant is suggested again', async () => {
    const db = await createLedgerDatabase()
    dismissMerchant(db, 'בית קפה', 1)
    clearDismissal(db, 'בית קפה', 2)
    clearDismissal(db, 'never dismissed', 3)

    expect(dismissedMerchants(db)).toEqual([])
  })

  it('reads a setting somebody edited by hand as no dismissals rather than throwing', async () => {
    const db = await createLedgerDatabase()
    db.run("INSERT INTO fmt_setting (id, key, value) VALUES ('hand', 'fixedExpenses.dismissed', ?)", [
      'not json at all',
    ])

    expect(dismissedMerchants(db)).toEqual([])
  })

  it('keeps a dismissed merchant out of the detector', async () => {
    const db = await seeded()
    dismissMerchant(db, 'שכר דירה', 5)

    const candidates = detectFixedExpenses(
      listExpenseObservations(db, localDate(2026, 1, 1), localDate(2026, 6, 30)),
      {
        endingAt: { year: 2026, month: 6 },
        windowMonths: 6,
        dismissed: dismissedMerchants(db),
      },
    )

    expect(candidates).toEqual([])
  })
})
