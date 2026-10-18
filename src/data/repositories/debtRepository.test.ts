import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { createAccount } from './accountRepository.ts'
import {
  addPayment,
  applyPlanPayment,
  clearInstallmentDecline,
  createDebt,
  DebtHasPaymentsError,
  debtDetail,
  debtsSummary,
  deleteDebt,
  dismissAmbiguity,
  dismissPayment,
  declineInstallmentGroup,
  findDebt,
  installmentCandidates,
  listDebts,
  listPaymentObservations,
  listPayments,
  paymentReview,
  planPaymentRef,
  planPayments,
  promoteInstallmentGroup,
  readInstallmentPromotion,
  resolveAmbiguity,
  setDebtClosed,
  setInstallmentOffers,
  setInstallmentThreshold,
  syncDiscoveredPayments,
  updateDebt,
} from './debtRepository.ts'
import { createDeductionType, updateDeductionType } from './deductionTypeRepository.ts'
import { createPaycheck, deletePaycheck, updatePaycheck } from './paycheckRepository.ts'
import { type InsertableTransaction } from './transactionRepository.ts'

const ILS = 'ILS'
const ils = (minor: number) => money(minor, ILS)
const NOW = 1_755_000_000_000
const ACCOUNT = 'acc-1'

function row(overrides: Partial<InsertableTransaction> & { id: string }): InsertableTransaction {
  return {
    accountId: ACCOUNT,
    transactionDate: localDate(2026, 1, 5),
    chargeDate: undefined,
    billingPeriod: undefined,
    amount: ils(-150_000),
    direction: 'OUTFLOW',
    merchantRaw: 'בנק הפועלים הלוואה',
    merchantNormalized: 'בנק הפועלים הלוואה',
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

async function withAccount(): Promise<Database> {
  const db = await createLedgerDatabase()
  createAccount(db, { name: 'Hapoalim', kind: 'BANK', last4: '4321' }, NOW)
  db.run("UPDATE fmt_account SET id = ? WHERE last4 = '4321'", [ACCOUNT])
  return db
}

/** A bank loan repaid by a standing order, and three months of it in the ledger. */
async function withLoan(): Promise<{ db: Database; debtId: string }> {
  const db = await withAccount()
  const debt = createDebt(
    db,
    {
      name: 'Car loan',
      kind: 'BANK_LOAN',
      principalAmount: ils(1_800_000),
      openedDate: localDate(2025, 12, 1),
      monthlyPaymentAmount: ils(150_000),
      tracking: { kind: 'MERCHANT_PATTERN', pattern: 'בנק הפועלים הלוואה' },
    },
    NOW,
  )

  for (const month of [1, 2, 3]) {
    insertTransaction(db, row({ id: `loan-${month}`, transactionDate: localDate(2026, month, 5) }), NOW)
  }

  return { db, debtId: debt.id }
}

describe('a plan writing a payment', () => {
  const period = { year: 2026, month: 7 }
  const shared = { planId: 'plan-1', period, bucketId: 'bucket-1' }

  /** A debt nothing watches: no tracking, no payroll link, no ledger rows. */
  async function withQuietDebt(): Promise<{ db: Database; debtId: string }> {
    const db = await withAccount()
    const debt = createDebt(
      db,
      {
        name: 'Family loan',
        kind: 'PERSONAL',
        principalAmount: ils(1_000_000),
        openedDate: localDate(2026, 1, 1),
        tracking: { kind: 'NONE' },
      },
      NOW,
    )
    return { db, debtId: debt.id }
  }

  it('writes one payment, dated the first of the month it plans', async () => {
    const { db, debtId } = await withQuietDebt()

    applyPlanPayment(db, { ...shared, debtId, amount: ils(200_000) }, NOW)

    const payments = listPayments(db, debtId)
    expect(payments).toHaveLength(1)
    // Not today: a September plan applied in August is a claim about September,
    // and "How it went" compares months on both sides.
    expect(payments[0]?.date).toEqual(localDate(2026, 7, 1))
    expect(payments[0]?.sourceKind).toBe('FROM_PLAN')
    expect(payments[0]?.sourceRefId).toBe(planPaymentRef('plan-1', period, 'bucket-1'))
    // The user pressed a button on a printed figure. That is the same act as
    // typing it, and a queue of the user's own decisions asks them twice.
    expect(payments[0]?.isConfirmed).toBe(true)
    expect(payments[0]?.interestPortion).toEqual(ils(0))
  })

  it('moves the figure on a second apply rather than adding a second payment', async () => {
    const { db, debtId } = await withQuietDebt()

    applyPlanPayment(db, { ...shared, debtId, amount: ils(200_000) }, NOW)
    applyPlanPayment(db, { ...shared, debtId, amount: ils(250_000) }, NOW)

    const payments = listPayments(db, debtId)
    expect(payments).toHaveLength(1)
    expect(payments[0]?.amount).toEqual(ils(250_000))
  })

  it('keeps two buckets of one plan apart even when they name the same debt', async () => {
    const { db, debtId } = await withQuietDebt()

    applyPlanPayment(db, { ...shared, debtId, amount: ils(200_000) }, NOW)
    applyPlanPayment(db, { ...shared, bucketId: 'bucket-2', debtId, amount: ils(50_000) }, NOW)

    // "The mortgage" and "the mortgage, extra out of the bonus" are two buckets
    // on purpose, and keying on the debt would make the second overwrite the
    // first. `planDeposits` draws the same line.
    expect(listPayments(db, debtId)).toHaveLength(2)
    expect(planPayments(db, 'plan-1', period, ILS).get(debtId)).toEqual(ils(250_000))
  })

  it('clamps an interest portion a correction made larger than the payment', async () => {
    const { db, debtId } = await withQuietDebt()
    applyPlanPayment(db, { ...shared, debtId, amount: ils(200_000) }, NOW)
    const written = listPayments(db, debtId)[0]
    if (written === undefined) throw new Error('nothing written')
    db.run('UPDATE fmt_debt_payment SET interest_minor = ? WHERE id = ?', [150_000, written.id])

    applyPlanPayment(db, { ...shared, debtId, amount: ils(100_000) }, NOW)

    // Interest above the payment makes principal negative and pushes the balance
    // up. `syncPayrollPayments` clamps for the same reason.
    expect(listPayments(db, debtId)[0]?.interestPortion).toEqual(ils(100_000))
  })

  it('reads back per month, and says nothing about another month', async () => {
    const { db, debtId } = await withQuietDebt()
    applyPlanPayment(db, { ...shared, debtId, amount: ils(200_000) }, NOW)

    expect(planPayments(db, 'plan-1', { year: 2026, month: 8 }, ILS).size).toBe(0)
    expect(planPayments(db, 'plan-2', period, ILS).size).toBe(0)
  })

  it('is left alone by the discovery sync, which owns only what it discovered', async () => {
    const { db, debtId } = await withLoan()
    applyPlanPayment(db, { ...shared, debtId, amount: ils(200_000) }, NOW)

    syncDiscoveredPayments(db, NOW)
    syncDiscoveredPayments(db, NOW)

    // Three from the ledger and one from the plan. The sync removes payroll rows
    // whose link is gone and nothing else — a plan row is not its business.
    const fromPlan = listPayments(db, debtId).filter((one) => one.sourceKind === 'FROM_PLAN')
    expect(fromPlan).toHaveLength(1)
    expect(fromPlan[0]?.amount).toEqual(ils(200_000))
  })
})

describe('debts', () => {
  it('round-trips the tracking union rather than two loose columns', async () => {
    const { db, debtId } = await withLoan()

    expect(findDebt(db, debtId)?.tracking).toEqual({
      kind: 'MERCHANT_PATTERN',
      pattern: 'בנק הפועלים הלוואה',
    })
  })

  it('clears the ref with the kind, so no mechanism reads a stale one', async () => {
    const { db, debtId } = await withLoan()

    updateDebt(db, debtId, { tracking: { kind: 'NONE' } }, NOW)

    expect(findDebt(db, debtId)?.tracking).toEqual({ kind: 'NONE' })
    const rows = db.exec('SELECT auto_track_pattern, auto_track_category FROM fmt_debt')
    expect(rows[0]?.values[0]).toEqual([null, null])
  })

  it('refuses a kind without its ref at the database, not only in the domain', async () => {
    const db = await withAccount()
    const insert = (kind: string, pattern: string | null): unknown =>
      db.run(
        `INSERT INTO fmt_debt (id, name, kind, principal_minor, principal_currency, opened,
                               auto_track_kind, auto_track_pattern, is_closed)
         VALUES (?, 'x', 'BANK_LOAN', 100, 'ILS', '2026-01-01', ?, ?, 0)`,
        [`bad-${kind}`, kind, pattern],
      )

    // The pattern and the category are two columns and the kind says which (D-259).
    expect(() => insert('CATEGORY', null)).toThrow()
    expect(() => insert('CATEGORY', 'a pattern under the wrong kind')).toThrow()
    expect(() => insert('MERCHANT_PATTERN', 'בנק הפועלים')).not.toThrow()
  })

  it('keeps a closed debt out of discovery and its history intact', async () => {
    const { db, debtId } = await withLoan()
    syncDiscoveredPayments(db, NOW)
    setDebtClosed(db, debtId, true, NOW)

    insertTransaction(db, row({ id: 'loan-4', transactionDate: localDate(2026, 4, 5) }), NOW)
    const result = syncDiscoveredPayments(db, NOW)

    expect(result.created).toBe(0)
    expect(listPayments(db, debtId)).toHaveLength(3)
  })
})

describe('listPaymentObservations', () => {
  it('reads outflows on the charge-date basis and carries the installment fields', async () => {
    const db = await withAccount()
    insertTransaction(
      db,
      row({
        id: 'slice',
        transactionDate: localDate(2026, 1, 20),
        chargeDate: localDate(2026, 2, 2),
        amount: ils(-100_000),
        installment: {
          sequence: 3,
          total: 12,
          groupKey: 'group-1',
          originalTotal: ils(1_200_000),
        },
      }),
      NOW,
    )
    insertTransaction(
      db,
      row({ id: 'refund', amount: ils(4_900), direction: 'INFLOW' }),
      NOW,
    )

    const observations = listPaymentObservations(db)

    expect(observations).toHaveLength(1)
    expect(observations[0]?.date).toEqual(localDate(2026, 2, 2))
    expect(observations[0]?.installment).toEqual({
      sequence: 3,
      total: 12,
      groupKey: 'group-1',
      originalTotal: ils(1_200_000),
    })
  })
})

describe('discovery', () => {
  it('finds a merchant-pattern repayment and marks it unconfirmed', async () => {
    const { db, debtId } = await withLoan()

    const result = syncDiscoveredPayments(db, NOW)

    expect(result.created).toBe(3)
    const payments = listPayments(db, debtId)
    expect(payments).toHaveLength(3)
    expect(payments.every((payment) => !payment.isConfirmed)).toBe(true)
    expect(payments[0]?.sourceKind).toBe('TRANSACTION')
    expect(payments[0]?.amount).toEqual(ils(150_000))
    // The row it was found in is a link, not a key (D-279).
    const linked = db.exec(
      'SELECT COUNT(*) FROM fmt_debt_payment WHERE "transaction" IS NOT NULL AND source_key IS NULL',
    )
    expect(linked[0]?.values[0]?.[0]).toBe(3)
  })

  /** F08's first acceptance criterion, as a property rather than an example. */
  it('produces the same balances when the same statements are scanned twice', async () => {
    const { db, debtId } = await withLoan()

    syncDiscoveredPayments(db, NOW)
    const first = debtDetail(db, debtId, { year: 2026, month: 4 })?.balance
    const again = syncDiscoveredPayments(db, NOW)

    expect(again.created).toBe(0)
    expect(listPayments(db, debtId)).toHaveLength(3)
    expect(debtDetail(db, debtId, { year: 2026, month: 4 })?.balance).toEqual(first)
  })

  it('finds a repayment by category', async () => {
    const db = await withAccount()
    createDebt(
      db,
      {
        name: 'Family loan',
        kind: 'PERSONAL',
        principalAmount: ils(500_000),
        openedDate: localDate(2026, 1, 1),
        tracking: { kind: 'CATEGORY', categoryId: 'cat-loans' },
      },
      NOW,
    )
    insertTransaction(db, row({ id: 'by-category', merchantNormalized: 'העברה' }), NOW)
    db.run("UPDATE fmt_transaction SET category = 'cat-loans' WHERE id = 'by-category'")

    expect(syncDiscoveredPayments(db, NOW).created).toBe(1)
  })

  it('names an installment slice as one, and only for the group that was promoted', async () => {
    const db = await withAccount()
    createDebt(
      db,
      {
        name: 'Laptop',
        kind: 'CARD_INSTALLMENTS',
        principalAmount: ils(1_200_000),
        openedDate: localDate(2026, 1, 1),
        tracking: { kind: 'CARD_INSTALLMENT_GROUP', groupKey: 'group-1' },
      },
      NOW,
    )
    insertTransaction(
      db,
      row({
        id: 'slice-1',
        amount: ils(-100_000),
        merchantNormalized: 'קספי',
        installment: { sequence: 1, total: 12, groupKey: 'group-1', originalTotal: ils(1_200_000) },
      }),
      NOW,
    )
    insertTransaction(
      db,
      row({
        id: 'other-slice',
        amount: ils(-50_000),
        merchantNormalized: 'אחר',
        installment: { sequence: 1, total: 6, groupKey: 'group-2', originalTotal: undefined },
      }),
      NOW,
    )

    syncDiscoveredPayments(db, NOW)

    const payments = listPayments(db)
    expect(payments).toHaveLength(1)
    expect(payments[0]?.sourceKind).toBe('INSTALLMENT_SLICE')
    expect(payments[0]?.note).toContain('1 of 12')
  })

  it('ignores an inflow at a tracked merchant', async () => {
    const { db } = await withLoan()
    insertTransaction(
      db,
      row({ id: 'refund', amount: ils(150_000), direction: 'INFLOW' }),
      NOW,
    )

    expect(syncDiscoveredPayments(db, NOW).created).toBe(3)
  })
})

describe('the labeling queue’s promotion', () => {
  it('points a debt at a name and discovers what is already in the ledger', async () => {
    const db = await withAccount()
    const debt = createDebt(
      db,
      {
        name: 'Car loan',
        kind: 'BANK_LOAN',
        principalAmount: ils(1_800_000),
        openedDate: localDate(2025, 12, 1),
        tracking: { kind: 'NONE' },
      },
      NOW,
    )
    for (const month of [1, 2, 3]) {
      insertTransaction(db, row({ id: `loan-${month}`, transactionDate: localDate(2026, month, 5) }), NOW)
    }

    // Nothing is discovered until the debt is told what to watch for — which is
    // the whole of what the promotion writes.
    expect(syncDiscoveredPayments(db, NOW).created).toBe(0)

    updateDebt(
      db,
      debt.id,
      { tracking: { kind: 'MERCHANT_PATTERN', pattern: 'בנק הפועלים הלוואה' } },
      NOW,
    )
    // The edit itself looks through the ledger (M28 F10); a second pass finds nothing new.
    expect(listPayments(db, debt.id)).toHaveLength(3)
    expect(syncDiscoveredPayments(db, NOW).created).toBe(0)
    // Unconfirmed, because a row the app matched is an answer the app produced.
    expect(listPayments(db, debt.id).every((payment) => !payment.isConfirmed)).toBe(true)
  })

  it('keeps the payments already found when the pattern is replaced', async () => {
    const { db, debtId } = await withLoan()
    syncDiscoveredPayments(db, NOW)

    updateDebt(db, debtId, { tracking: { kind: 'MERCHANT_PATTERN', pattern: 'משהו אחר' } }, NOW)
    syncDiscoveredPayments(db, NOW)

    // docs/f08: narrowing a pattern is a change of mind about future rows, not a
    // claim that the past payments never happened. The debts screen reports them
    // as orphaned; nothing here deletes them.
    expect(listPayments(db, debtId)).toHaveLength(3)
  })
})

describe('payroll discovery', () => {
  async function withPayrollLoan(): Promise<{ db: Database; debtId: string; typeId: string }> {
    const db = await withAccount()
    const debt = createDebt(
      db,
      {
        name: 'Employer advance',
        kind: 'PAYROLL_LOAN',
        principalAmount: ils(1_000_000),
        openedDate: localDate(2026, 1, 1),
      },
      NOW,
    )
    const type = createDeductionType(
      db,
      { name: 'Loan repayment', kind: 'LOAN_REPAYMENT', linkedDebtId: debt.id },
      NOW,
    )
    createPaycheck(
      db,
      {
        period: { year: 2026, month: 6 },
        paymentDate: localDate(2026, 7, 1),
        gross: ils(2_000_000),
        net: ils(1_400_000),
        lines: [{ deductionTypeId: type.id, employeeAmount: ils(-80_000) }],
      },
      NOW,
    )
    return { db, debtId: debt.id, typeId: type.id }
  }

  it('records one payment per slip per debt', async () => {
    const { db, debtId } = await withPayrollLoan()

    expect(syncDiscoveredPayments(db, NOW).created).toBe(1)
    const payments = listPayments(db, debtId)
    expect(payments).toHaveLength(1)
    expect(payments[0]?.sourceKind).toBe('PAYCHECK')
    expect(payments[0]?.amount).toEqual(ils(80_000))
  })

  /**
   * D-075's find, in the feature it was found for: `updatePaycheck` deletes a
   * slip's lines and writes them again, so a payment keyed on a line id would be
   * two payments after one correction.
   */
  it('moves the figure when the slip is corrected rather than adding a second row', async () => {
    const { db, debtId, typeId } = await withPayrollLoan()
    syncDiscoveredPayments(db, NOW)

    const slip = db.exec('SELECT id FROM fmt_paycheck')[0]?.values[0]?.[0]
    updatePaycheck(
      db,
      String(slip),
      { lines: [{ deductionTypeId: typeId, employeeAmount: ils(-90_000) }] },
      NOW,
    )
    const result = syncDiscoveredPayments(db, NOW)

    expect(result.created).toBe(0)
    expect(result.updated).toBe(1)
    const payments = listPayments(db, debtId)
    expect(payments).toHaveLength(1)
    expect(payments[0]?.amount).toEqual(ils(90_000))
  })

  it('takes the payment back when the deduction type stops naming the debt', async () => {
    const { db, debtId, typeId } = await withPayrollLoan()
    syncDiscoveredPayments(db, NOW)

    updateDeductionType(db, typeId, { linkedDebtId: undefined }, NOW)
    const result = syncDiscoveredPayments(db, NOW)

    expect(result.removed).toBe(1)
    expect(listPayments(db, debtId)).toHaveLength(0)
  })

  it('surfaces a payment whose payslip is gone rather than deleting it', async () => {
    const { db } = await withPayrollLoan()
    syncDiscoveredPayments(db, NOW)
    const payment = listPayments(db)[0]
    if (payment === undefined) throw new Error('no payment')
    db.run('UPDATE fmt_debt_payment SET is_confirmed = 1 WHERE id = ?', [payment.id])

    const slip = db.exec('SELECT id FROM fmt_paycheck')[0]?.values[0]?.[0]
    deletePaycheck(db, String(slip), NOW)

    const review = paymentReview(db)
    expect(review.orphaned).toHaveLength(1)
    expect(listPayments(db)).toHaveLength(1)
  })
})

describe('ambiguity', () => {
  async function withTwoClaimants(): Promise<Database> {
    const db = await withAccount()
    createDebt(
      db,
      {
        name: 'Loan A',
        kind: 'BANK_LOAN',
        principalAmount: ils(500_000),
        openedDate: localDate(2026, 1, 1),
        tracking: { kind: 'MERCHANT_PATTERN', pattern: 'בנק הפועלים הלוואה' },
      },
      NOW,
    )
    createDebt(
      db,
      {
        name: 'Loan B',
        kind: 'BANK_LOAN',
        principalAmount: ils(400_000),
        openedDate: localDate(2026, 1, 1),
        tracking: { kind: 'CATEGORY', categoryId: 'cat-loans' },
      },
      NOW,
    )
    insertTransaction(db, row({ id: 'claimed-twice' }), NOW)
    db.run("UPDATE fmt_transaction SET category = 'cat-loans' WHERE id = 'claimed-twice'")
    return db
  }

  it('asks rather than marking two payments for one row', async () => {
    const db = await withTwoClaimants()

    const result = syncDiscoveredPayments(db, NOW)

    expect(result.created).toBe(0)
    expect(result.ambiguous).toBe(1)
    expect(listPayments(db)).toHaveLength(0)
    expect(paymentReview(db).ambiguities[0]?.debts).toHaveLength(2)
  })

  it('stops asking once a debt has been named', async () => {
    const db = await withTwoClaimants()
    const match = paymentReview(db).ambiguities[0]
    if (match === undefined) throw new Error('no ambiguity')

    const payment = resolveAmbiguity(db, match, match.debtIds[0] ?? '', NOW)

    expect(payment?.isConfirmed).toBe(true)
    expect(syncDiscoveredPayments(db, NOW).ambiguous).toBe(0)
    expect(paymentReview(db).ambiguities).toHaveLength(0)
    expect(listPayments(db)).toHaveLength(1)
  })

  it('refuses a debt that was never a claimant', async () => {
    const db = await withTwoClaimants()
    const match = paymentReview(db).ambiguities[0]
    if (match === undefined) throw new Error('no ambiguity')

    expect(resolveAmbiguity(db, match, 'someone-else', NOW)).toBeUndefined()
    expect(listPayments(db)).toHaveLength(0)
  })

  it('remembers a dismissed question', async () => {
    const db = await withTwoClaimants()
    const match = paymentReview(db).ambiguities[0]
    if (match === undefined) throw new Error('no ambiguity')

    dismissAmbiguity(db, match.sourceRefId, NOW)

    expect(syncDiscoveredPayments(db, NOW).ambiguous).toBe(0)
    expect(paymentReview(db).ambiguities).toHaveLength(0)
  })
})

describe('dismissal', () => {
  it('does not find a payment again once the user has said no', async () => {
    const { db, debtId } = await withLoan()
    syncDiscoveredPayments(db, NOW)
    const payment = listPayments(db, debtId)[0]
    if (payment === undefined) throw new Error('no payment')

    dismissPayment(db, payment.id, NOW)
    const result = syncDiscoveredPayments(db, NOW)

    expect(listPayments(db, debtId)).toHaveLength(2)
    expect(result.created).toBe(0)
    expect(result.dismissed).toBe(1)
  })

  it('dismisses the row for this debt only, not for another', async () => {
    const { db, debtId } = await withLoan()
    syncDiscoveredPayments(db, NOW)
    const payment = listPayments(db, debtId)[0]
    if (payment === undefined) throw new Error('no payment')
    dismissPayment(db, payment.id, NOW)

    const other = createDebt(
      db,
      {
        name: 'Second loan',
        kind: 'BANK_LOAN',
        principalAmount: ils(300_000),
        openedDate: localDate(2026, 1, 1),
        tracking: { kind: 'CATEGORY', categoryId: 'cat-loans' },
      },
      NOW,
    )
    db.run("UPDATE fmt_transaction SET category = 'cat-loans' WHERE id = ?", [
      payment.sourceRefId ?? '',
    ])

    syncDiscoveredPayments(db, NOW)

    // The row is now claimed by the second debt alone — the first has already
    // been ruled out — so it is an answer rather than a new ambiguity between
    // two debts, one of which the user has already said no to.
    expect(listPayments(db, other.id)).toHaveLength(1)
  })
})

describe('installment promotion', () => {
  /** Four of a twelve-payment purchase charged, and a three-payment one beside it. */
  async function withSplitPurchases(): Promise<Database> {
    const db = await withAccount()
    for (const sequence of [1, 2, 3, 4]) {
      insertTransaction(
        db,
        row({
          id: `laptop-${sequence}`,
          transactionDate: localDate(2026, sequence + 3, 12),
          amount: ils(-100_000),
          merchantRaw: 'קספי מחשבים',
          merchantNormalized: 'קספי מחשבים',
          installment: {
            sequence,
            total: 12,
            groupKey: 'laptop',
            originalTotal: ils(1_200_000),
          },
        }),
        NOW,
      )
    }
    insertTransaction(
      db,
      row({
        id: 'chair-1',
        amount: ils(-40_000),
        merchantRaw: 'איקאה',
        merchantNormalized: 'איקאה',
        installment: { sequence: 1, total: 3, groupKey: 'chair', originalTotal: undefined },
      }),
      NOW,
    )
    return db
  }

  it('offers a purchase split more ways than the threshold, and not one that is not', async () => {
    const db = await withSplitPurchases()

    const candidates = installmentCandidates(db)

    expect(candidates.map((one) => one.groupKey)).toEqual(['laptop'])
    expect(candidates[0]?.principal).toEqual({ amount: ils(1_200_000), basis: 'STATED' })
    expect(candidates[0]?.remainingSlices).toBe(8)
  })

  it('offers the smaller one once the threshold is lowered', async () => {
    const db = await withSplitPurchases()

    setInstallmentThreshold(db, 2, NOW)

    expect(installmentCandidates(db).map((one) => one.groupKey)).toEqual(['chair', 'laptop'])
    expect(readInstallmentPromotion(db).threshold).toBe(2)
  })

  it('refuses a threshold that would offer things that are not splits', async () => {
    const db = await withSplitPurchases()

    setInstallmentThreshold(db, 0, NOW)

    expect(readInstallmentPromotion(db).threshold).toBe(2)
  })

  it('offers nothing at all once the prompt is switched off', async () => {
    const db = await withSplitPurchases()

    setInstallmentOffers(db, false, NOW)

    expect(installmentCandidates(db)).toEqual([])
  })

  it('stops offering a purchase the user declined, and starts again if that is undone', async () => {
    const db = await withSplitPurchases()

    declineInstallmentGroup(db, 'laptop', NOW)
    expect(installmentCandidates(db)).toEqual([])

    clearInstallmentDecline(db, 'laptop', NOW)
    expect(installmentCandidates(db).map((one) => one.groupKey)).toEqual(['laptop'])
  })

  it('makes a debt of the whole purchase and records the slices already charged', async () => {
    const db = await withSplitPurchases()
    const candidate = installmentCandidates(db)[0]
    if (candidate === undefined) throw new Error('no candidate')

    const debt = promoteInstallmentGroup(db, candidate, NOW)

    expect(debt.kind).toBe('CARD_INSTALLMENTS')
    expect(debt.principalAmount).toEqual(ils(1_200_000))
    expect(debt.openedDate).toEqual(localDate(2026, 4, 12))
    expect(debt.monthlyPaymentAmount).toEqual(ils(100_000))
    expect(debt.tracking).toEqual({ kind: 'CARD_INSTALLMENT_GROUP', groupKey: 'laptop' })

    const payments = listPayments(db, debt.id)
    expect(payments).toHaveLength(4)
    expect(payments.every((payment) => payment.sourceKind === 'INSTALLMENT_SLICE')).toBe(true)
    // Promoting the group is the confirmation. Asking again once per slice would
    // be the app disbelieving an answer it had just been given.
    expect(payments.every((payment) => payment.isConfirmed)).toBe(true)
    expect(paymentReview(db).items).toEqual([])

    const detail = debtDetail(db, debt.id, { year: 2026, month: 8 })
    expect(detail?.balance).toMatchObject({ outstanding: ils(800_000) })
  })

  it('does not offer the same purchase twice', async () => {
    const db = await withSplitPurchases()
    const candidate = installmentCandidates(db)[0]
    if (candidate === undefined) throw new Error('no candidate')

    promoteInstallmentGroup(db, candidate, NOW)

    expect(installmentCandidates(db)).toEqual([])
  })

  it('picks up the next slice when it is charged, and only once', async () => {
    const db = await withSplitPurchases()
    const candidate = installmentCandidates(db)[0]
    if (candidate === undefined) throw new Error('no candidate')
    const debt = promoteInstallmentGroup(db, candidate, NOW)

    insertTransaction(
      db,
      row({
        id: 'laptop-5',
        transactionDate: localDate(2026, 9, 12),
        amount: ils(-100_000),
        merchantRaw: 'קספי מחשבים',
        merchantNormalized: 'קספי מחשבים',
        installment: { sequence: 5, total: 12, groupKey: 'laptop', originalTotal: ils(1_200_000) },
      }),
      NOW,
    )

    expect(syncDiscoveredPayments(db, NOW).created).toBe(1)
    expect(syncDiscoveredPayments(db, NOW).created).toBe(0)
    expect(listPayments(db, debt.id)).toHaveLength(5)
    // The new one is the app's reading rather than the user's answer, so unlike
    // the four that came with the promotion it waits in the queue.
    expect(paymentReview(db).items).toHaveLength(1)
  })

  it('estimates the principal when the file never printed a total, and says so', async () => {
    const db = await withAccount()
    for (const sequence of [1, 2]) {
      insertTransaction(
        db,
        row({
          id: `sofa-${sequence}`,
          transactionDate: localDate(2026, sequence, 3),
          amount: ils(-75_000),
          merchantRaw: 'איקאה',
          merchantNormalized: 'איקאה',
          installment: { sequence, total: 6, groupKey: 'sofa', originalTotal: undefined },
        }),
        NOW,
      )
    }

    const candidate = installmentCandidates(db)[0]

    expect(candidate?.principal).toEqual({ amount: ils(450_000), basis: 'ESTIMATED' })
  })
})

describe('reading across everything', () => {
  it('summarizes in the currency the debts are actually in', async () => {
    const { db } = await withLoan()
    syncDiscoveredPayments(db, NOW)

    const summary = debtsSummary(db, { year: 2026, month: 4 })

    expect(summary.totalPrincipal).toEqual(ils(1_800_000))
    expect(summary.totalOutstanding).toEqual(ils(1_350_000))
    expect(summary.unconfirmedCount).toBe(3)
    expect(summary.openCount).toBe(1)
    // Every row's figures come from the same call the totals do.
    expect(summary.rows[0]?.balance).toMatchObject({ outstanding: ils(1_350_000) })
    expect(summary.rows[0]?.projection.kind).toBe('PROJECTED')
  })

  it('counts the slices still to be charged, promoted or not', async () => {
    const db = await withAccount()
    insertTransaction(
      db,
      row({
        id: 'slice-4',
        amount: ils(-100_000),
        installment: { sequence: 4, total: 12, groupKey: 'group-1', originalTotal: undefined },
      }),
      NOW,
    )

    // Eight of twelve still to come, at the slice amount the file states.
    expect(debtsSummary(db, { year: 2026, month: 4 }).installmentCommitment).toEqual(ils(800_000))
  })

  it('projects from the payments it has, naming the basis', async () => {
    const { db, debtId } = await withLoan()
    syncDiscoveredPayments(db, NOW)

    const detail = debtDetail(db, debtId, { year: 2026, month: 3 })

    expect(detail?.balance).toMatchObject({ outstanding: ils(1_350_000) })
    expect(detail?.projection.kind).toBe('PROJECTED')
  })
})

describe('deleting', () => {
  it('refuses while there is history, naming what to do instead', async () => {
    const { db, debtId } = await withLoan()
    syncDiscoveredPayments(db, NOW)

    expect(() => deleteDebt(db, debtId, NOW)).toThrow(DebtHasPaymentsError)
    expect(listDebts(db)).toHaveLength(1)
  })

  /** F08's third acceptance criterion. */
  it('leaves the transactions and paycheck lines where they are', async () => {
    const { db, debtId } = await withLoan()
    const type = createDeductionType(
      db,
      { name: 'Loan repayment', kind: 'LOAN_REPAYMENT', linkedDebtId: debtId },
      NOW,
    )
    createPaycheck(
      db,
      {
        period: { year: 2026, month: 6 },
        paymentDate: localDate(2026, 7, 1),
        gross: ils(2_000_000),
        net: ils(1_400_000),
        lines: [{ deductionTypeId: type.id, employeeAmount: ils(-80_000) }],
      },
      NOW,
    )

    deleteDebt(db, debtId, NOW)

    expect(listDebts(db, { includeClosed: true })).toHaveLength(0)
    expect(listPaymentObservations(db)).toHaveLength(3)
    const lines = db.exec('SELECT COUNT(*) FROM fmt_paycheck_line')
    expect(lines[0]?.values[0]?.[0]).toBe(1)
  })

  it('clears the deduction-type link, so nothing keeps discovering for it', async () => {
    const { db, debtId } = await withLoan()
    const type = createDeductionType(
      db,
      { name: 'Loan repayment', kind: 'LOAN_REPAYMENT', linkedDebtId: debtId },
      NOW,
    )

    deleteDebt(db, debtId, NOW)

    const rows = db.exec('SELECT linked_debt FROM fmt_deduction_type WHERE id = ?', [type.id])
    expect(rows[0]?.values[0]?.[0]).toBeNull()
  })
})

describe('manual payments', () => {
  it('records two identical payments as two, because the user made two', async () => {
    const { db, debtId } = await withLoan()

    addPayment(db, { debtId, date: localDate(2026, 4, 1), amount: ils(50_000) }, NOW)
    addPayment(db, { debtId, date: localDate(2026, 4, 1), amount: ils(50_000) }, NOW)

    expect(listPayments(db, debtId)).toHaveLength(2)
  })

  it('stores a magnitude whichever sign it was handed, and confirms by default', async () => {
    const { db, debtId } = await withLoan()

    const payment = addPayment(
      db,
      { debtId, date: localDate(2026, 4, 1), amount: ils(-50_000), interestPortion: ils(5_000) },
      NOW,
    )

    expect(payment.amount).toEqual(ils(50_000))
    expect(payment.isConfirmed).toBe(true)
    expect(payment.interestPortion).toEqual(ils(5_000))
  })
})
