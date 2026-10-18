import { describe, expect, it } from 'vitest'

import { money, type Money } from '@/core/money.ts'
import { localDate, type YearMonth } from '@/core/time.ts'
import type { FixedExpense } from '@/domain/model/fixed.ts'
import type {
  DeductionType,
  Paycheck,
  PaycheckLine,
  PaycheckWithLines,
} from '@/domain/model/paycheck.ts'
import type {
  AutoTracking,
  Debt,
  DebtPayment,
  PaymentObservation,
} from '@/domain/model/debt.ts'
import {
  DEFAULT_INSTALLMENT_PROMOTION_THRESHOLD,
  balanceOverTime,
  debtBalance,
  debtsClaiming,
  debtFixedExpenseOverlaps,
  debtObligationBasis,
  debtWarnings,
  selfDiscoveringDebts,
  debtsOverview,
  discoverPayments,
  installmentDebtCandidates,
  newPayments,
  orphanedPayments,
  outstandingInstallmentTotal,
  paymentSourceKey,
  paymentWarnings,
  payrollPaymentRef,
  draftPrincipalPart,
  projectPayoff,
  trackingOffer,
  validateDebt,
  validatePayment,
  type DebtBalance,
  type DebtFigures,
  type DebtWithPayments,
} from './debt.ts'

const ILS = 'ILS'

const ils = (minor: number) => money(minor, ILS)

const DEBT_ID = 'debt-1'

const AUGUST: YearMonth = { year: 2026, month: 8 }

function debt(overrides?: Partial<Debt>): Debt {
  return {
    id: DEBT_ID,
    name: 'Car loan',
    kind: 'BANK_LOAN',
    principalAmount: ils(6_000_00),
    openedDate: localDate(2026, 1, 1),
    expectedEndDate: undefined,
    monthlyPaymentAmount: undefined,
    linkedAccountId: undefined,
    tracking: { kind: 'NONE' },
    isClosed: false,
    note: undefined,
    ...overrides,
  }
}

let paymentSeq = 0

function payment(overrides?: Partial<DebtPayment>): DebtPayment {
  paymentSeq += 1
  const made = {
    id: `payment-${paymentSeq}`,
    debtId: DEBT_ID,
    date: localDate(2026, 2, 1),
    amount: ils(1_000_00),
    interestPortion: ils(0),
    sourceKind: 'MANUAL' as const,
    sourceRefId: undefined,
    isConfirmed: true,
    note: undefined,
    ...overrides,
  }
  // What the document works out as its principal part, as a stored row carries it.
  return { principalPart: draftPrincipalPart(made.amount, made.interestPortion), ...made }
}

/**
 * What the document would work out about a debt from these payments — the
 * pack's declared totals, added by hand for a test that has no document. The
 * real fold is the engine's, and `packs/ledger/figures.test.ts` pins it.
 */
function figuresOf(loan: Debt, payments: readonly DebtPayment[]): DebtFigures {
  const currency = loan.principalAmount.currency
  const mine = payments.filter((one) => one.debtId === loan.id)
  const total = (figures: readonly (Money | undefined)[]): Money | undefined => {
    if (figures.some((one) => one === undefined)) return undefined
    const currencies = new Set(figures.map((one) => one?.currency))
    if (currencies.size > 1) return undefined
    return money(figures.reduce((sum, one) => sum + (one?.minor ?? 0), 0), figures[0]?.currency ?? currency)
  }
  const less = (a: Money | undefined, b: Money | undefined): Money | undefined =>
    a !== undefined && b !== undefined && a.currency === b.currency ? money(a.minor - b.minor, a.currency) : undefined
  const principalPaid = total(mine.map((one) => one.principalPart))
  const totalPaid = total(mine.map((one) => one.amount))
  const unconfirmed = mine.filter((one) => !one.isConfirmed)
  return {
    principalPaid,
    totalPaid,
    interestPaid: less(totalPaid, principalPaid),
    outstanding: less(loan.principalAmount, principalPaid),
    unconfirmed: total(unconfirmed.map((one) => one.principalPart)),
    unconfirmedCount: unconfirmed.length,
    progress:
      principalPaid === undefined || loan.principalAmount.minor === 0 || principalPaid.currency !== currency
        ? undefined
        : principalPaid.minor / loan.principalAmount.minor,
  }
}

const anyBalance = (loan: Debt, payments: readonly DebtPayment[]): DebtBalance =>
  debtBalance(loan, figuresOf(loan, payments))

function balanceOf(loan: Debt, payments: readonly DebtPayment[]): Extract<DebtBalance, { kind: 'KNOWN' }> {
  const balance = anyBalance(loan, payments)
  if (balance.kind !== 'KNOWN') throw new Error('the balance is unchecked')
  return balance
}

const balancesOf = (debts: readonly DebtWithPayments[]): ReadonlyMap<string, DebtBalance> =>
  new Map(debts.map(({ debt: loan, payments }) => [loan.id, anyBalance(loan, payments)]))

const project = (loan: Debt, payments: readonly DebtPayment[], from: YearMonth) =>
  projectPayoff(loan, payments, anyBalance(loan, payments), from)

const obligation = (
  debts: readonly DebtWithPayments[],
  ...rest: Parameters<typeof debtObligationBasis> extends [unknown, unknown, ...infer R] ? R : never
) => debtObligationBasis(debts, balancesOf(debts), ...rest)

const overviewOf = (debts: readonly DebtWithPayments[], currency: string) =>
  debtsOverview(debts, balancesOf(debts), currency)

function observation(overrides?: Partial<PaymentObservation>): PaymentObservation {
  return {
    id: 'txn-1',
    merchantNormalized: 'BANK LEUMI LOAN',
    merchantRaw: 'Bank Leumi Loan',
    date: localDate(2026, 3, 12),
    amount: ils(-1_000_00),
    categoryId: undefined,
    installment: undefined,
    ...overrides,
  }
}

function slice(
  sequence: number,
  total: number,
  overrides?: Partial<PaymentObservation>,
): PaymentObservation {
  return observation({
    id: `slice-${sequence}`,
    merchantNormalized: 'IKEA',
    merchantRaw: 'IKEA Netanya',
    date: localDate(2026, sequence, 4),
    amount: ils(-100_00),
    installment: {
      sequence,
      total,
      groupKey: 'group-sofa',
      originalTotal: ils(1_200_00),
    },
    ...overrides,
  })
}

function deductionType(overrides?: Partial<DeductionType>): DeductionType {
  return {
    id: 'type-loan',
    name: 'Employer loan',
    hebrewName: undefined,
    kind: 'LOAN_REPAYMENT',
    reducesNet: true,
    countsAsSaving: false,
    linkedSavingGoalId: undefined,
    linkedDebtId: undefined,
    linkedFundId: undefined,
    isBuiltIn: false,
    sortOrder: 10,
    ...overrides,
  }
}

function payslip(
  id: string,
  period: YearMonth,
  lines: readonly Partial<PaycheckLine>[],
): PaycheckWithLines {
  const paycheck: Paycheck = {
    id,
    period,
    paymentDate: localDate(period.year, period.month, 9),
    employerName: undefined,
    gross: ils(20_000_00),
    net: ils(15_000_00),
    depositedToAccountId: undefined,
    note: undefined,
    sourceKind: 'MANUAL',
    attachmentRef: undefined,
    isIrregular: false,
  }

  return {
    paycheck,
    lines: lines.map((line, index) => ({
      id: `${id}-line-${index}`,
      paycheckId: id,
      deductionTypeId: 'type-loan',
      employeeAmount: ils(500_00),
      employerAmount: undefined,
      basisAmount: undefined,
      note: undefined,
      sortOrder: index,
      ...line,
    })),
  }
}

function fixedExpense(overrides?: Partial<FixedExpense>): FixedExpense {
  return {
    id: 'expense-1',
    name: 'Car loan',
    categoryId: undefined,
    matchKind: 'MERCHANT_PATTERN',
    matchRef: 'Bank Leumi Loan',
    expectedAmount: ils(1_000_00),
    amountVariability: 'FIXED',
    cadence: 'MONTHLY',
    dayOfMonthHint: undefined,
    isDiscretionary: false,
    source: 'USER_DEFINED',
    isActive: true,
    startedAt: undefined,
    endedAt: undefined,
    ...overrides,
  }
}

describe('draftPrincipalPart', () => {
  it('is the payment less its interest', () => {
    expect(draftPrincipalPart(ils(1_000_00), ils(150_00))).toEqual(ils(850_00))
  })

  it('is the whole payment when no interest was recorded', () => {
    expect(draftPrincipalPart(ils(1_000_00), ils(0))).toEqual(ils(1_000_00))
  })

  it('is nothing when the interest is in another currency, as the document works it out (M36 U03)', () => {
    const mixed = payment({ amount: ils(1_000_00), interestPortion: money(50_00, 'USD') })
    expect(mixed.principalPart).toBeUndefined()
    expect(validatePayment(mixed, { debt: debt() })).toContain('MIXED_CURRENCY')
  })
})

describe('balanceOverTime', () => {
  it('opens at the principal and steps down by principal, not by amount', () => {
    const loan = debt({ principalAmount: ils(6_000_00), openedDate: localDate(2026, 1, 1) })
    const points = balanceOverTime(loan, [
      payment({ date: localDate(2026, 2, 1), amount: ils(1_000_00), interestPortion: ils(200_00) }),
      payment({ date: localDate(2026, 3, 1), amount: ils(1_000_00) }),
    ])

    expect(points).toHaveLength(3)
    expect(points[0]?.outstanding).toEqual(ils(6_000_00))
    expect(points[0]?.payment).toBeUndefined()
    // 800 of the first payment was principal, all 1,000 of the second.
    expect(points[1]?.outstanding).toEqual(ils(5_200_00))
    expect(points[2]?.outstanding).toEqual(ils(4_200_00))
  })

  it('ends where the balance says it does, whatever order the payments arrive in', () => {
    const loan = debt({ principalAmount: ils(6_000_00) })
    const payments = [
      payment({ date: localDate(2026, 3, 1) }),
      payment({ date: localDate(2026, 2, 1) }),
    ]

    expect(balanceOverTime(loan, payments).at(-1)?.outstanding).toEqual(
      balanceOf(loan, payments).outstanding,
    )
  })

  it('leaves out a payment the balance also leaves out', () => {
    const loan = debt({ principalAmount: ils(6_000_00) })
    const points = balanceOverTime(loan, [payment({ amount: { minor: 100_00, currency: 'USD' } })])

    expect(points).toHaveLength(1)
  })
})

describe('debtBalance', () => {
  it('counts down by principal, never by the amount paid', () => {
    const balance = balanceOf(debt({ principalAmount: ils(6_000_00) }), [
      payment({ amount: ils(1_000_00), interestPortion: ils(200_00) }),
      payment({ amount: ils(1_000_00), interestPortion: ils(200_00) }),
    ])

    expect(balance.principalPaid).toEqual(ils(1_600_00))
    expect(balance.interestPaid).toEqual(ils(400_00))
    expect(balance.totalPaid).toEqual(ils(2_000_00))
    // The flattering answer — ₪2,000 off — is the one this exists to prevent.
    expect(balance.outstanding).toEqual(ils(4_400_00))
  })

  it('counts an unconfirmed payment towards the balance and reports its share', () => {
    const balance = balanceOf(debt(), [
      payment({ amount: ils(1_000_00) }),
      payment({ amount: ils(1_000_00), isConfirmed: false }),
    ])

    expect(balance.outstanding).toEqual(ils(4_000_00))
    expect(balance.unconfirmedPrincipal).toEqual(ils(1_000_00))
    expect(balance.unconfirmedCount).toBe(1)
  })

  it('reports an overpayment rather than a negative ring', () => {
    const balance = balanceOf(debt({ principalAmount: ils(1_000_00) }), [
      payment({ amount: ils(1_250_00) }),
    ])

    expect(balance.outstanding).toEqual(ils(-250_00))
    expect(balance.overpaidBy).toEqual(ils(250_00))
    expect(balance.progressBasisPoints).toBe(10_000)
    expect(balance.isSettled).toBe(true)
  })

  it('has no progress figure at all for a debt with no principal', () => {
    expect(balanceOf(debt({ principalAmount: ils(0) }), []).progressBasisPoints).toBeUndefined()
  })

  it('is unchecked, never smaller, with a payment in another currency (D-349)', () => {
    const balance = anyBalance(debt(), [
      payment({ amount: ils(1_000_00) }),
      payment({ amount: money(300_00, 'USD') }),
    ])

    expect(balance.kind).toBe('UNCHECKED')
  })
})

describe('projectPayoff', () => {
  const monthly = (months: readonly number[]) =>
    months.map((month) =>
      payment({ date: localDate(2026, month, 1), amount: ils(1_000_00) }),
    )

  it('divides what is left by the observed monthly rate', () => {
    const projection = project(
      debt({ principalAmount: ils(6_000_00) }),
      monthly([1, 2, 3]),
      AUGUST,
    )

    expect(projection).toMatchObject({
      kind: 'PROJECTED',
      basis: 'OBSERVED',
      months: 3,
      period: { year: 2026, month: 10 },
    })
  })

  it('measures per month, not per payment', () => {
    // Three payments inside one month are one month's repayment. Dividing by the
    // count would report this debt paid off three times as fast as it is.
    const sameMonth = [
      payment({ date: localDate(2026, 1, 1), amount: ils(1_000_00) }),
      payment({ date: localDate(2026, 1, 15), amount: ils(1_000_00) }),
      payment({ date: localDate(2026, 1, 28), amount: ils(1_000_00) }),
      payment({ date: localDate(2026, 2, 1), amount: ils(3_000_00) }),
    ]

    expect(project(debt({ principalAmount: ils(12_000_00) }), sameMonth, AUGUST)).toMatchObject(
      { kind: 'PROJECTED', monthlyPrincipal: ils(3_000_00), months: 2 },
    )
  })

  it('measures a quarterly debt across its gaps', () => {
    const quarterly = [
      payment({ date: localDate(2026, 1, 1), amount: ils(900_00) }),
      payment({ date: localDate(2026, 4, 1), amount: ils(900_00) }),
      payment({ date: localDate(2026, 7, 1), amount: ils(900_00) }),
    ]

    // ₪2,700 over the seven months it spans, not ₪900 a month.
    expect(
      project(debt({ principalAmount: ils(9_000_00) }), quarterly, AUGUST),
    ).toMatchObject({ kind: 'PROJECTED', monthlyPrincipal: ils(385_71) })
  })

  it('will not state a rate from a single payment', () => {
    expect(project(debt(), monthly([1]), AUGUST)).toEqual({ kind: 'NEEDS_TWO_PAYMENTS' })
  })

  it('falls back to the expected payment when there is no history', () => {
    expect(
      project(
        debt({ principalAmount: ils(6_000_00), monthlyPaymentAmount: ils(500_00) }),
        [],
        AUGUST,
      ),
    ).toMatchObject({ kind: 'PROJECTED', basis: 'EXPECTED', months: 12 })
  })

  it('says nothing rather than zero when there is neither', () => {
    expect(project(debt(), [], AUGUST)).toEqual({ kind: 'NO_BASIS' })
  })

  it('reports a debt that is not coming down', () => {
    const allInterest = [
      payment({ date: localDate(2026, 1, 1), amount: ils(500_00), interestPortion: ils(500_00) }),
      payment({ date: localDate(2026, 2, 1), amount: ils(500_00), interestPortion: ils(500_00) }),
    ]

    expect(project(debt(), allInterest, AUGUST)).toEqual({
      kind: 'NOT_REDUCING',
      basis: 'OBSERVED',
    })
  })

  it('refuses to print a date past the horizon', () => {
    expect(
      project(
        debt({ principalAmount: ils(2_000_000_00), monthlyPaymentAmount: ils(100_00) }),
        [],
        AUGUST,
      ),
    ).toMatchObject({ kind: 'BEYOND_HORIZON' })
  })

  it('is settled once the principal is covered', () => {
    expect(
      project(debt({ principalAmount: ils(1_000_00) }), [payment({ amount: ils(1_000_00) })], AUGUST),
    ).toEqual({ kind: 'SETTLED' })
  })

  it('does not read a clock — the same document projects the same way from any month', () => {
    const payments = monthly([1, 2, 3])
    const fromAugust = project(debt(), payments, AUGUST)
    const fromJanuary = project(debt(), payments, { year: 2027, month: 1 })

    expect(fromAugust).toMatchObject({ months: 3, period: { year: 2026, month: 10 } })
    expect(fromJanuary).toMatchObject({ months: 3, period: { year: 2027, month: 3 } })
  })
})

describe('debtObligationBasis', () => {
  const withPayments = (d: Debt): DebtWithPayments => ({ debt: d, payments: [] })

  it('totals the debts whose payments really do come out of net', () => {
    const basis = obligation(
      [
        withPayments(debt({ id: 'a', monthlyPaymentAmount: ils(1_000_00) })),
        withPayments(debt({ id: 'b', monthlyPaymentAmount: ils(500_00) })),
      ],
      [],
      [],
      AUGUST,
      ILS,
    )

    expect(basis.total).toEqual(ils(1_500_00))
    expect(basis.subtracted).toHaveLength(2)
  })

  it('never subtracts a payroll-deducted loan, which is already out of net', () => {
    const loan = debt({ id: 'payroll-loan', monthlyPaymentAmount: ils(1_500_00) })
    const basis = obligation(
      [withPayments(loan)],
      [deductionType({ linkedDebtId: 'payroll-loan' })],
      [],
      AUGUST,
      ILS,
    )

    expect(basis.total).toEqual(ils(0))
    expect(basis.alreadyOutOfNet.map((d) => d.id)).toEqual(['payroll-loan'])
    expect(basis.subtracted).toEqual([])
  })

  it('never subtracts a card-installment debt, which is already in the spending', () => {
    const purchase = debt({
      id: 'sofa',
      kind: 'CARD_INSTALLMENTS',
      monthlyPaymentAmount: ils(100_00),
      tracking: { kind: 'CARD_INSTALLMENT_GROUP', groupKey: 'group-sofa' },
    })

    const basis = obligation([withPayments(purchase)], [], [], AUGUST, ILS)

    expect(basis.total).toEqual(ils(0))
    expect(basis.alreadyInSpending.map((d) => d.id)).toEqual(['sofa'])
  })

  it('never subtracts a standing order the user also recorded as a fixed expense', () => {
    const loan = debt({
      id: 'car',
      monthlyPaymentAmount: ils(1_000_00),
      tracking: { kind: 'MERCHANT_PATTERN', pattern: 'Bank Leumi Loan' },
    })

    const basis = obligation(
      [withPayments(loan)],
      [],
      [fixedExpense({ matchRef: 'bank leumi loan' })],
      AUGUST,
      ILS,
    )

    expect(basis.total).toEqual(ils(0))
    expect(basis.alreadyAFixedExpense.map((d) => d.id)).toEqual(['car'])
  })

  it('subtracts a debt whose fixed expense is no longer live', () => {
    const loan = debt({
      id: 'car',
      monthlyPaymentAmount: ils(1_000_00),
      tracking: { kind: 'MERCHANT_PATTERN', pattern: 'Bank Leumi Loan' },
    })

    const basis = obligation(
      [withPayments(loan)],
      [],
      [fixedExpense({ isActive: false })],
      AUGUST,
      ILS,
    )

    expect(basis.total).toEqual(ils(1_000_00))
  })

  it('shows a debt with no stated payment rather than guessing one', () => {
    const basis = obligation([withPayments(debt({ id: 'friend' }))], [], [], AUGUST, ILS)

    expect(basis.noStatedPayment.map((d) => d.id)).toEqual(['friend'])
    expect(basis.total).toEqual(ils(0))
  })

  it('leaves a settled debt out of the month it is settled in', () => {
    const settled: DebtWithPayments = {
      debt: debt({ id: 'done', principalAmount: ils(1_000_00), monthlyPaymentAmount: ils(500_00) }),
      payments: [payment({ debtId: 'done', amount: ils(1_000_00) })],
    }

    expect(obligation([settled], [], [], AUGUST, ILS).total).toEqual(ils(0))
  })

  it('lists an obligation in another currency instead of converting it', () => {
    const basis = obligation(
      [withPayments(debt({ id: 'usd', monthlyPaymentAmount: money(300_00, 'USD') }))],
      [],
      [],
      AUGUST,
      ILS,
    )

    expect(basis.otherCurrency).toHaveLength(1)
    expect(basis.total).toEqual(ils(0))
  })
})

describe('debtFixedExpenseOverlaps', () => {
  it('finds a debt and an expense watching one merchant, whatever the spelling', () => {
    const loan = debt({ tracking: { kind: 'MERCHANT_PATTERN', pattern: '  bank leumi loan ' } })

    expect(debtFixedExpenseOverlaps([loan], [fixedExpense()])).toEqual([
      { debtId: DEBT_ID, expenseId: 'expense-1', ref: '  bank leumi loan ' },
    ])
  })

  it('finds one watching a category', () => {
    const loan = debt({ tracking: { kind: 'CATEGORY', categoryId: 'cat-loans' } })
    const expense = fixedExpense({ matchKind: 'CATEGORY', matchRef: 'cat-loans' })

    expect(debtFixedExpenseOverlaps([loan], [expense])).toHaveLength(1)
  })

  it('does not confuse a category id with a merchant pattern', () => {
    const loan = debt({ tracking: { kind: 'CATEGORY', categoryId: 'Bank Leumi Loan' } })

    expect(debtFixedExpenseOverlaps([loan], [fixedExpense()])).toEqual([])
  })
})

describe('discoverPayments', () => {
  const base = { transactions: [], paychecks: [], deductionTypes: [] }

  it('finds a standing order by merchant pattern', () => {
    const loan = debt({ tracking: { kind: 'MERCHANT_PATTERN', pattern: 'leumi loan' } })
    const found = discoverPayments({ ...base, debts: [loan], transactions: [observation()] })

    expect(found.payments).toHaveLength(1)
    expect(found.payments[0]).toMatchObject({
      debtId: DEBT_ID,
      sourceKind: 'TRANSACTION',
      sourceRefId: 'txn-1',
      amount: ils(1_000_00),
    })
    expect(found.payments[0]?.provenance).toMatchObject({ merchantRaw: 'Bank Leumi Loan' })
  })

  it('ignores a refund at the same merchant', () => {
    const loan = debt({ tracking: { kind: 'MERCHANT_PATTERN', pattern: 'leumi loan' } })
    const refund = observation({ amount: ils(1_000_00) })

    expect(discoverPayments({ ...base, debts: [loan], transactions: [refund] }).payments).toEqual([])
  })

  it('finds a payment by category', () => {
    const loan = debt({ tracking: { kind: 'CATEGORY', categoryId: 'cat-loans' } })
    const row = observation({ categoryId: 'cat-loans', merchantNormalized: 'ANYTHING' })

    expect(discoverPayments({ ...base, debts: [loan], transactions: [row] }).payments).toHaveLength(1)
  })

  it('finds an installment slice and names which one it is', () => {
    const purchase = debt({
      tracking: { kind: 'CARD_INSTALLMENT_GROUP', groupKey: 'group-sofa' },
    })
    const found = discoverPayments({ ...base, debts: [purchase], transactions: [slice(3, 12)] })

    expect(found.payments[0]?.sourceKind).toBe('INSTALLMENT_SLICE')
    expect(found.payments[0]?.provenance).toMatchObject({ sequence: 3, total: 12 })
  })

  it('calls a slice reached by a merchant pattern an ordinary transaction', () => {
    const loan = debt({ tracking: { kind: 'MERCHANT_PATTERN', pattern: 'IKEA' } })
    const found = discoverPayments({ ...base, debts: [loan], transactions: [slice(3, 12)] })

    expect(found.payments[0]?.sourceKind).toBe('TRANSACTION')
  })

  it('produces a question, not two payments, when two debts claim one row', () => {
    const byPattern = debt({ id: 'a', tracking: { kind: 'MERCHANT_PATTERN', pattern: 'leumi' } })
    const byCategory = debt({ id: 'b', tracking: { kind: 'CATEGORY', categoryId: 'cat-loans' } })
    const row = observation({ categoryId: 'cat-loans' })

    const found = discoverPayments({ ...base, debts: [byPattern, byCategory], transactions: [row] })

    expect(found.payments).toEqual([])
    expect(found.ambiguous).toHaveLength(1)
    expect(found.ambiguous[0]?.debtIds).toEqual(['a', 'b'])
  })

  it('ignores a closed debt', () => {
    const closed = debt({
      isClosed: true,
      tracking: { kind: 'MERCHANT_PATTERN', pattern: 'leumi loan' },
    })

    expect(discoverPayments({ ...base, debts: [closed], transactions: [observation()] }).payments)
      .toEqual([])
  })

  it('finds a payroll repayment through the deduction type, not the debt', () => {
    const loan = debt({ id: 'employer-loan' })
    const found = discoverPayments({
      ...base,
      debts: [loan],
      paychecks: [payslip('slip-7', { year: 2026, month: 7 }, [{}])],
      deductionTypes: [deductionType({ linkedDebtId: 'employer-loan' })],
    })

    expect(found.payments).toHaveLength(1)
    expect(found.payments[0]).toMatchObject({
      debtId: 'employer-loan',
      sourceKind: 'PAYCHECK',
      sourceRefId: 'slip-7:employer-loan',
      amount: ils(500_00),
    })
  })

  it('emits one payment per payslip per debt, whatever the lines do', () => {
    // A `PaycheckLine.id` does not survive an edit (D-075), so two lines of the
    // same type must not become two payments keyed on ids that will not exist
    // after the next correction.
    const loan = debt({ id: 'employer-loan' })
    const input = {
      ...base,
      debts: [loan],
      deductionTypes: [deductionType({ linkedDebtId: 'employer-loan' })],
    }

    const once = discoverPayments({
      ...input,
      paychecks: [payslip('slip-7', { year: 2026, month: 7 }, [{}])],
    })
    const twice = discoverPayments({
      ...input,
      paychecks: [
        payslip('slip-7', { year: 2026, month: 7 }, [
          { employeeAmount: ils(300_00) },
          { employeeAmount: ils(200_00) },
        ]),
      ],
    })

    expect(twice.payments).toHaveLength(1)
    expect(twice.payments[0]?.amount).toEqual(ils(500_00))
    expect(twice.payments[0]?.sourceRefId).toBe(once.payments[0]?.sourceRefId)
  })

  it('is a question about the set: one pass sees an ambiguity two passes could not', () => {
    const found = discoverPayments({
      ...base,
      debts: [
        debt({ id: 'a', tracking: { kind: 'MERCHANT_PATTERN', pattern: 'IKEA' } }),
        debt({ id: 'b', tracking: { kind: 'CARD_INSTALLMENT_GROUP', groupKey: 'group-sofa' } }),
      ],
      transactions: [slice(3, 12)],
    })

    expect(found.payments).toEqual([])
    expect(found.ambiguous).toHaveLength(1)
  })

  it('drops a claim the user has already said no to', () => {
    const loan = debt({ tracking: { kind: 'MERCHANT_PATTERN', pattern: 'leumi loan' } })
    const found = discoverPayments({
      ...base,
      debts: [loan],
      transactions: [observation()],
      dismissedKeys: new Set([`${DEBT_ID}:TRANSACTION:txn-1`]),
    })

    expect(found.payments).toEqual([])
    expect(found.dismissed).toBe(1)
  })

  /**
   * The reason a dismissal belongs in here rather than in a filter over the
   * result: it removes a *claimant*, and with one claimant left the row is an
   * answer. Filtered afterwards it would come back as an ambiguity between two
   * debts, one of which the user has already ruled out — the same question in a
   * shape the same answer cannot resolve.
   */
  it('resolves an ambiguity when one of the claimants has been dismissed', () => {
    const input = {
      ...base,
      debts: [
        debt({ id: 'a', tracking: { kind: 'MERCHANT_PATTERN' as const, pattern: 'IKEA' } }),
        debt({
          id: 'b',
          tracking: { kind: 'CARD_INSTALLMENT_GROUP' as const, groupKey: 'group-sofa' },
        }),
      ],
      transactions: [slice(3, 12)],
    }

    const found = discoverPayments({
      ...input,
      dismissedKeys: new Set(['a:TRANSACTION:slice-3']),
    })

    expect(found.ambiguous).toEqual([])
    expect(found.payments).toHaveLength(1)
    expect(found.payments[0]?.debtId).toBe('b')
    expect(found.payments[0]?.sourceKind).toBe('INSTALLMENT_SLICE')
  })

  it('drops a payroll payment the user has dismissed', () => {
    const found = discoverPayments({
      ...base,
      debts: [debt({ id: 'employer-loan' })],
      paychecks: [payslip('slip-7', { year: 2026, month: 7 }, [{}])],
      deductionTypes: [deductionType({ linkedDebtId: 'employer-loan' })],
      dismissedKeys: new Set(['employer-loan:PAYCHECK:slip-7:employer-loan']),
    })

    expect(found.payments).toEqual([])
    expect(found.dismissed).toBe(1)
  })
})

describe('newPayments', () => {
  const loan = debt({ tracking: { kind: 'MERCHANT_PATTERN', pattern: 'leumi loan' } })

  const discovered = () =>
    discoverPayments({
      debts: [loan],
      transactions: [observation()],
      paychecks: [],
      deductionTypes: [],
    }).payments

  it('offers a payment the document does not have', () => {
    expect(newPayments(discovered(), [])).toHaveLength(1)
  })

  it('offers nothing on a second import of the same statement', () => {
    const recorded = payment({ sourceKind: 'TRANSACTION', sourceRefId: 'txn-1' })

    expect(newPayments(discovered(), [recorded])).toEqual([])
  })

  it('keeps three months of statements at the same balance when imported twice', () => {
    const months = [3, 4, 5].map((month) =>
      observation({ id: `txn-${month}`, date: localDate(2026, month, 12) }),
    )
    const scan = () =>
      discoverPayments({ debts: [loan], transactions: months, paychecks: [], deductionTypes: [] })
        .payments

    const first = scan().map((found, index) =>
      payment({
        id: `p-${index}`,
        amount: found.amount,
        sourceKind: found.sourceKind,
        sourceRefId: found.sourceRefId,
        isConfirmed: false,
      }),
    )

    expect(balanceOf(loan, first).outstanding).toEqual(ils(3_000_00))
    expect(newPayments(scan(), first)).toEqual([])
    expect(balanceOf(loan, first).outstanding).toEqual(ils(3_000_00))
  })

  it('tells two debts apart when both are paid by the same row', () => {
    const key = (debtId: string) => paymentSourceKey(debtId, 'TRANSACTION', 'txn-1')

    expect(key('a')).not.toBe(key('b'))
    expect(paymentSourceKey('a', 'MANUAL', undefined)).toBeUndefined()
  })

  it('keys a payroll payment on the payslip and the debt', () => {
    expect(payrollPaymentRef('slip-7', 'debt-1')).toBe('slip-7:debt-1')
  })
})

describe('orphanedPayments', () => {
  it('surfaces a payment whose transaction is gone', () => {
    const payments = [
      payment({ id: 'a', sourceKind: 'TRANSACTION', sourceRefId: 'txn-1' }),
      payment({ id: 'b', sourceKind: 'TRANSACTION', sourceRefId: 'txn-2' }),
      payment({ id: 'c' }),
    ]

    expect(orphanedPayments(payments, new Set(['txn-1'])).map((p) => p.id)).toEqual(['b'])
  })

  it('never calls a manual payment orphaned', () => {
    expect(orphanedPayments([payment()], new Set())).toEqual([])
  })

  it('never calls a plan payment orphaned either', () => {
    // A plan bucket is not a row `paymentReview` enumerates, so a "not MANUAL"
    // test reported every one of these as orphaned the moment it was written —
    // on the screen whose whole job is to be believed (D-190).
    const fromPlan = payment({
      id: 'p',
      sourceKind: 'FROM_PLAN',
      sourceRefId: 'plan-1:2026-07:bucket-1',
    })

    expect(orphanedPayments([fromPlan], new Set())).toEqual([])
  })
})

describe('installmentDebtCandidates', () => {
  const slices = [slice(1, 12), slice(2, 12), slice(3, 12)]

  it('offers a purchase split more ways than the threshold', () => {
    const [candidate] = installmentDebtCandidates(slices)

    expect(candidate).toMatchObject({
      groupKey: 'group-sofa',
      paymentCount: 12,
      slicesSeen: 3,
      remainingSlices: 9,
      chargedSoFar: ils(300_00),
      sliceAmount: ils(100_00),
      principal: { amount: ils(1_200_00), basis: 'STATED' },
    })
  })

  it('does not offer a purchase split three ways', () => {
    expect(installmentDebtCandidates([slice(1, 3), slice(2, 3)])).toEqual([])
    expect(DEFAULT_INSTALLMENT_PROMOTION_THRESHOLD).toBe(3)
  })

  it('says when the principal is an estimate rather than what the file printed', () => {
    const unstated = slices.map((s) => ({
      ...s,
      installment: { ...s.installment, originalTotal: undefined } as PaymentObservation['installment'],
    }))

    expect(installmentDebtCandidates(unstated)[0]?.principal).toEqual({
      amount: ils(1_200_00),
      basis: 'ESTIMATED',
    })
  })

  it('does not offer a group the user already promoted', () => {
    expect(
      installmentDebtCandidates(slices, { promotedGroupKeys: new Set(['group-sofa']) }),
    ).toEqual([])
  })

  it('takes the first and last charge from the dates, not the sequence order', () => {
    const outOfOrder = [slice(3, 12), slice(1, 12), slice(2, 12)]
    const [candidate] = installmentDebtCandidates(outOfOrder)

    expect(candidate?.firstChargeDate).toEqual(localDate(2026, 1, 4))
    expect(candidate?.lastChargeDate).toEqual(localDate(2026, 3, 4))
  })
})

describe('outstandingInstallmentTotal', () => {
  it('counts what is still to be charged, never what already was', () => {
    // Nine slices of ₪100 left of a twelve-slice sofa. The three already charged
    // are in the spending totals and must not also be reported as owed.
    expect(outstandingInstallmentTotal([slice(1, 12), slice(2, 12), slice(3, 12)], ILS)).toEqual(
      ils(900_00),
    )
  })

  it('is zero once the last slice has landed', () => {
    const finished = Array.from({ length: 12 }, (_, index) => slice(index + 1, 12))

    expect(outstandingInstallmentTotal(finished, ILS)).toEqual(ils(0))
  })

  it('ignores an ordinary charge', () => {
    expect(outstandingInstallmentTotal([observation()], ILS)).toEqual(ils(0))
  })
})

describe('debtsOverview', () => {
  it('totals what is owed, and does not let an overpaid debt pay off another', () => {
    const overview = overviewOf(
      [
        { debt: debt({ id: 'a', principalAmount: ils(5_000_00) }), payments: [] },
        {
          debt: debt({ id: 'b', principalAmount: ils(1_000_00) }),
          payments: [payment({ debtId: 'b', amount: ils(1_500_00) })],
        },
      ],
      ILS,
    )

    expect(overview.totalPrincipal).toEqual(ils(6_000_00))
    expect(overview.totalOutstanding).toEqual(ils(5_000_00))
    expect(overview.settledButOpenCount).toBe(1)
  })

  it('counts unconfirmed payments across every debt', () => {
    const overview = overviewOf(
      [
        { debt: debt({ id: 'a' }), payments: [payment({ debtId: 'a', isConfirmed: false })] },
        { debt: debt({ id: 'b' }), payments: [payment({ debtId: 'b', isConfirmed: false })] },
      ],
      ILS,
    )

    expect(overview.unconfirmedCount).toBe(2)
  })

  it('leaves a closed debt out of the totals but still counts it', () => {
    const overview = overviewOf([{ debt: debt({ isClosed: true }), payments: [] }], ILS)

    expect(overview.totalPrincipal).toEqual(ils(0))
    expect(overview.closedCount).toBe(1)
    expect(overview.openCount).toBe(0)
  })
})

describe('validateDebt', () => {
  it('accepts a debt with no end date and no monthly payment', () => {
    expect(validateDebt(debt())).toEqual([])
  })

  it('refuses a tracking kind with nothing to match on', () => {
    expect(validateDebt(debt({ tracking: { kind: 'MERCHANT_PATTERN', pattern: '   ' } }))).toEqual([
      'EMPTY_TRACKING_REF',
    ])
  })

  it('refuses a principal of nothing, a backwards end date and a mixed currency', () => {
    const problems = validateDebt(
      debt({
        principalAmount: ils(0),
        openedDate: localDate(2026, 6, 1),
        expectedEndDate: localDate(2026, 1, 1),
        monthlyPaymentAmount: money(100_00, 'USD'),
      }),
    )

    expect(problems).toContain('NON_POSITIVE_PRINCIPAL')
    expect(problems).toContain('ENDS_BEFORE_IT_STARTS')
    expect(problems).toContain('MIXED_CURRENCY')
  })
})

describe('selfDiscoveringDebts', () => {
  it('finds a debt the ledger already pays, and one the payslip does', () => {
    const tracked = debt({ id: 'a', tracking: { kind: 'MERCHANT_PATTERN', pattern: 'Leumi' } })
    const payroll = debt({ id: 'b', tracking: { kind: 'NONE' } })

    const found = selfDiscoveringDebts(
      [tracked, payroll],
      [deductionType({ linkedDebtId: 'b' })],
    )

    expect([...found].sort()).toEqual(['a', 'b'])
  })

  it('says nothing about a debt nobody watches', () => {
    expect(selfDiscoveringDebts([debt({ tracking: { kind: 'NONE' } })], [])).toEqual(new Set())
  })

  it('leaves a closed debt out, because discovery already does', () => {
    const closed = debt({
      id: 'a',
      isClosed: true,
      tracking: { kind: 'MERCHANT_PATTERN', pattern: 'Leumi' },
    })

    expect(selfDiscoveringDebts([closed], [deductionType({ linkedDebtId: 'a' })])).toEqual(new Set())
  })

  it('ignores a link to a debt this document does not have', () => {
    // `deleteDebt` clears these, so a dangling link is a document mid-repair
    // rather than a state to warn about.
    expect(selfDiscoveringDebts([], [deductionType({ linkedDebtId: 'gone' })])).toEqual(new Set())
  })
})

describe('debtWarnings', () => {
  const tracking: AutoTracking = { kind: 'MERCHANT_PATTERN', pattern: 'Bank Leumi Loan' }

  it('warns when another debt watches the same pattern', () => {
    const mine = debt({ id: 'a', tracking })
    const rival = debt({ id: 'b', tracking: { kind: 'MERCHANT_PATTERN', pattern: 'bank leumi loan' } })

    expect(debtWarnings(mine, [rival], [])).toEqual(['TRACKING_SHARED_WITH_ANOTHER_DEBT'])
  })

  it('warns when a fixed expense already watches it', () => {
    expect(debtWarnings(debt({ tracking }), [], [fixedExpense()])).toEqual([
      'TRACKING_SHARED_WITH_FIXED_EXPENSE',
    ])
  })

  it('says nothing about a debt tracked by hand', () => {
    expect(debtWarnings(debt(), [debt({ id: 'other' })], [fixedExpense()])).toEqual([])
  })
})

describe('validatePayment and paymentWarnings', () => {
  it('blocks a payment into a closed debt', () => {
    expect(validatePayment(payment(), { debt: debt({ isClosed: true }) })).toEqual(['CLOSED_DEBT'])
  })

  it('refuses interest larger than the payment', () => {
    expect(
      validatePayment(payment({ amount: ils(100_00), interestPortion: ils(150_00) }), {
        debt: debt(),
      }),
    ).toEqual(['INTEREST_EXCEEDS_PAYMENT'])
  })

  it('allows an overpayment, and warns about it', () => {
    const over = payment({ amount: ils(9_000_00) })

    expect(validatePayment(over, { debt: debt() })).toEqual([])
    expect(paymentWarnings(over, debt(), [])).toEqual(['EXCEEDS_OUTSTANDING'])
  })

  it('does not warn about an edited payment on account of itself', () => {
    const existing = payment({ id: 'p1', amount: ils(6_000_00) })
    const edited = { ...existing, amount: ils(5_900_00) }

    expect(paymentWarnings(edited, debt(), [existing])).toEqual([])
  })
})

describe('trackingOffer — what the labeling queue’s promotion would do', () => {
  it('takes nothing away from a debt that watches for nothing', () => {
    expect(trackingOffer(debt(), 'BANK LEUMI LOAN')).toEqual({ kind: 'FREE' })
  })

  it('says a debt already claims these charges when its pattern covers the name', () => {
    const loan = debt({ tracking: { kind: 'MERCHANT_PATTERN', pattern: 'leumi' } })

    expect(trackingOffer(loan, 'BANK LEUMI LOAN')).toEqual({ kind: 'ALREADY', pattern: 'leumi' })
  })

  it('names the mechanism it would replace, pattern or category', () => {
    const other = debt({ tracking: { kind: 'MERCHANT_PATTERN', pattern: 'discount' } })
    const byCategory = debt({ tracking: { kind: 'CATEGORY', categoryId: 'cat-loans' } })

    expect(trackingOffer(other, 'BANK LEUMI LOAN')).toEqual({
      kind: 'REPLACES',
      current: { kind: 'MERCHANT_PATTERN', pattern: 'discount' },
    })
    expect(trackingOffer(byCategory, 'BANK LEUMI LOAN')).toEqual({
      kind: 'REPLACES',
      current: { kind: 'CATEGORY', categoryId: 'cat-loans' },
    })
  })

  it('refuses a split purchase, whose slices would stop being found', () => {
    const sofa = debt({ tracking: { kind: 'CARD_INSTALLMENT_GROUP', groupKey: 'group-sofa' } })

    expect(trackingOffer(sofa, 'IKEA')).toEqual({ kind: 'REFUSED', reason: 'INSTALLMENT_GROUP' })
  })

  it('refuses a closed debt before it looks at what it tracks', () => {
    const closed = debt({ isClosed: true, tracking: { kind: 'NONE' } })

    expect(trackingOffer(closed, 'BANK LEUMI LOAN')).toEqual({ kind: 'REFUSED', reason: 'CLOSED' })
  })

  it('lists the debts already claiming a name — the ones a second claim would make ambiguous', () => {
    const leumi = debt({ id: 'a', tracking: { kind: 'MERCHANT_PATTERN', pattern: 'leumi' } })
    const free = debt({ id: 'b' })
    const closed = debt({
      id: 'c',
      isClosed: true,
      tracking: { kind: 'MERCHANT_PATTERN', pattern: 'leumi' },
    })

    expect(debtsClaiming([leumi, free, closed], 'BANK LEUMI LOAN')).toEqual([leumi])
  })
})
