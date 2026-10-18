import { describe, expect, it } from 'vitest'

import { fromMajorUnits, money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import type { Debt } from '@/domain/model/debt.ts'
import type { FundAccount } from '@/domain/model/funds.ts'
import type { DeductionType, PaycheckWithLines } from '@/domain/model/paycheck.ts'
import type { SplitBucket } from '@/domain/model/plan.ts'
import type { Holding, HoldingPlace, SavingGoal } from '@/domain/model/savings.ts'
import type { ComputedAllocation, SplitResult } from '@/domain/splitter.ts'
import { traceLandings, traceMonth, type MonthTraceInput } from '@/domain/trace.ts'

/**
 * The trace, from underneath.
 *
 * What is worth testing here is not the arithmetic — every figure it reports was
 * computed by something else — but **where a chain stops and why**. Each of
 * these is one missing link, and the view's whole claim is that it names them
 * rather than leaving a total short with no explanation.
 */

const PERIOD = { year: 2026, month: 8 }

function type(overrides: Partial<DeductionType> = {}): DeductionType {
  return {
    id: 'dt:pension',
    name: 'Pension',
    hebrewName: undefined,
    kind: 'PENSION',
    reducesNet: true,
    countsAsSaving: true,
    linkedSavingGoalId: undefined,
    linkedDebtId: undefined,
    linkedFundId: undefined,
    isBuiltIn: true,
    sortOrder: 40,
    ...overrides,
  }
}

function entry(lines: readonly { readonly typeId: string; readonly employee: number; readonly employer?: number }[]): PaycheckWithLines {
  return {
    paycheck: {
      id: 'pc-1',
      period: PERIOD,
      paymentDate: localDate(2026, 9, 1),
      employerName: 'Acme',
      gross: fromMajorUnits(20000, 'ILS'),
      net: fromMajorUnits(14000, 'ILS'),
      depositedToAccountId: undefined,
      note: undefined,
      sourceKind: 'MANUAL',
      attachmentRef: undefined,
      isIrregular: false,
    },
    lines: lines.map((line, index) => ({
      id: `pl-${index}`,
      paycheckId: 'pc-1',
      deductionTypeId: line.typeId,
      employeeAmount: fromMajorUnits(line.employee, 'ILS'),
      employerAmount: line.employer === undefined ? undefined : fromMajorUnits(line.employer, 'ILS'),
      basisAmount: undefined,
      note: undefined,
      sortOrder: index,
    })),
  }
}

const GOAL: SavingGoal = {
  id: 'goal-1',
  name: 'House fund',
  targetAmount: undefined,
  targetDate: undefined,
  kind: 'LONG_TERM',
  defaultHoldingId: 'hold-1',
  isClosed: false,
  priority: 1,
  note: undefined,
}

const HOLDING: Holding = {
  id: 'hold-1',
  holdingPlaceId: 'place-1',
  name: 'Savings account',
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

const PLACE: HoldingPlace = {
  id: 'place-1',
  name: 'Bank Hapoalim',
  kind: 'CHECKING',
  institution: undefined,
  note: undefined,
  isArchived: false,
}

const DEBT: Debt = {
  id: 'debt-1',
  name: 'Car loan',
  kind: 'BANK_LOAN',
  principalAmount: fromMajorUnits(50000, 'ILS'),
  openedDate: localDate(2025, 1, 1),
  expectedEndDate: undefined,
  monthlyPaymentAmount: undefined,
  linkedAccountId: undefined,
  tracking: { kind: 'NONE' },
  isClosed: false,
  note: undefined,
}

const FUND: FundAccount = {
  id: 'fund-1',
  name: 'Menora pension',
  fundType: 'PENSION',
  institutionId: undefined,
  policyNumber: undefined,
  investmentTrack: undefined,
  status: 'ACTIVE',
  employerName: undefined,
  openedDate: undefined,
  firstDepositDate: undefined,
  fees: { onAccumulationBasisPoints: undefined, onDepositBasisPoints: undefined },
  feeNegotiatedUntil: undefined,
  beneficiaries: undefined,
  notes: undefined,
  isArchived: false,
}

function bucket(overrides: Partial<SplitBucket> = {}): SplitBucket {
  return {
    id: 'bucket-1',
    name: 'House fund',
    targetKind: 'SAVING_GOAL',
    targetId: 'goal-1',
    color: undefined,
    sortOrder: 1,
    isBuffer: false,
    ...overrides,
  }
}

function computed(one: SplitBucket, major: number): ComputedAllocation {
  return {
    allocation: {
      id: `alloc-${one.id}`,
      planId: 'plan-1',
      bucketId: one.id,
      mode: 'FIXED_AMOUNT',
      basisPoints: undefined,
      amount: fromMajorUnits(major, 'ILS'),
      isLocked: false,
    },
    bucket: one,
    amount: fromMajorUnits(major, 'ILS'),
    shareBasisPoints: undefined,
  }
}

function result(allocations: readonly ComputedAllocation[], balanceMajor = 0): SplitResult {
  return {
    basis: fromMajorUnits(14000, 'ILS'),
    fixedExpenses: money(0, 'ILS'),
    fixedShare: undefined,
    splittable: fromMajorUnits(14000, 'ILS'),
    allocations,
    balance: fromMajorUnits(balanceMajor, 'ILS'),
    status: balanceMajor === 0 ? 'EXACT' : 'UNALLOCATED',
  }
}

function input(overrides: Partial<MonthTraceInput> = {}): MonthTraceInput {
  return {
    period: PERIOD,
    currency: 'ILS',
    entry: entry([{ typeId: 'dt:pension', employee: 1200, employer: 1300 }]),
    types: [type()],
    goals: [GOAL],
    debts: [DEBT],
    funds: [FUND],
    holdings: [HOLDING],
    places: [PLACE],
    landedByGoal: new Map(),
    depositedByPlan: new Set(),
    paidByPlan: new Set(),
    plan: undefined,
    ...overrides,
  }
}

describe('what payroll sent out of the gross', () => {
  it('counts the employer share too, because every balance downstream does', () => {
    const trace = traceMonth(
      input({ types: [type({ linkedFundId: 'fund-1' })] }),
    )
    expect(trace.payroll[0]?.amount).toEqual(fromMajorUnits(2500, 'ILS'))
    expect(trace.payroll[0]?.end).toEqual({
      kind: 'FUND',
      fundId: 'fund-1',
      fundName: 'Menora pension',
    })
  })

  it('stops, by name, on a saving deduction that says where it pays into nothing', () => {
    const trace = traceMonth(input())
    expect(trace.payroll[0]?.end).toEqual({
      kind: 'BROKEN',
      reason: 'DEDUCTION_NAMES_NOTHING',
    })
    // The two stages are disjoint money and the total says so: ₪2,500 came out
    // of the gross before the net existed, and the whole ₪14,000 net stops
    // separately because no plan was applied to this month.
    expect(trace.stopped).toEqual(fromMajorUnits(16500, 'ILS'))
    expect(trace.followed).toEqual(money(0, 'ILS'))
  })

  it('leaves tax alone — a deduction that goes nowhere is not a broken link', () => {
    const trace = traceMonth(
      input({
        entry: entry([{ typeId: 'dt:tax', employee: 4000 }]),
        types: [type({ id: 'dt:tax', name: 'Income tax', kind: 'TAX', countsAsSaving: false })],
      }),
    )
    expect(trace.payroll).toHaveLength(0)
  })

  it('stops when the goal it names has no holding to put the money in', () => {
    const trace = traceMonth(
      input({
        types: [type({ linkedSavingGoalId: 'goal-1' })],
        goals: [{ ...GOAL, defaultHoldingId: undefined }],
      }),
    )
    expect(trace.payroll[0]?.end).toEqual({ kind: 'BROKEN', reason: 'GOAL_HAS_NO_HOLDING' })
  })

  it('follows a goal to the holding a deposit actually landed in, not the default', () => {
    const moved: Holding = { ...HOLDING, id: 'hold-2', name: 'Fixed deposit' }
    const trace = traceMonth(
      input({
        types: [type({ linkedSavingGoalId: 'goal-1' })],
        holdings: [HOLDING, moved],
        landedByGoal: new Map([['goal-1', 'hold-2']]),
      }),
    )
    expect(trace.payroll[0]?.end).toMatchObject({ kind: 'HOLDING', holdingName: 'Fixed deposit' })
  })
})

describe('what the split did with the net', () => {
  it('says so, once, when no plan was applied to the month', () => {
    const trace = traceMonth(input())
    expect(trace.split).toHaveLength(1)
    expect(trace.split[0]?.end).toEqual({ kind: 'BROKEN', reason: 'NO_PLAN_APPLIED' })
    expect(trace.split[0]?.amount).toEqual(fromMajorUnits(14000, 'ILS'))
  })

  it('refuses to follow a bucket whose suggestion was never accepted', () => {
    const trace = traceMonth(
      input({ plan: { name: 'Default', result: result([computed(bucket(), 2000)]) } }),
    )
    expect(trace.split[0]?.end).toEqual({ kind: 'BROKEN', reason: 'NOT_APPLIED' })
  })

  it('follows it once the deposit exists', () => {
    const trace = traceMonth(
      input({
        plan: { name: 'Default', result: result([computed(bucket(), 2000)]) },
        depositedByPlan: new Set(['goal-1']),
      }),
    )
    expect(trace.split[0]?.end).toMatchObject({ kind: 'HOLDING', placeName: 'Bank Hapoalim' })
  })

  it('calls a category, fixed expenses and free money spent rather than broken', () => {
    const trace = traceMonth(
      input({
        plan: {
          name: 'Default',
          result: result([
            computed(bucket({ id: 'b-cat', name: 'Groceries', targetKind: 'CATEGORY', targetId: 'cat:groceries' }), 1500),
            computed(bucket({ id: 'b-free', name: 'Fun', targetKind: 'FREE', targetId: undefined }), 800),
          ]),
        },
      }),
    )
    expect(trace.split.map((row) => row.end.kind)).toEqual(['SPENT', 'SPENT'])
    // Spent is not stopped: only the payroll line with no destination is.
    expect(trace.stopped).toEqual(fromMajorUnits(2500, 'ILS'))
  })

  it('names what the plan left over, and leaves a drawdown alone', () => {
    const left = traceMonth(
      input({ plan: { name: 'Default', result: result([], 3000) }, depositedByPlan: new Set() }),
    )
    expect(left.split.at(-1)?.end).toEqual({ kind: 'BROKEN', reason: 'NOT_ASSIGNED' })

    const over = traceMonth(
      input({ plan: { name: 'Default', result: result([], -3000) } }),
    )
    expect(over.split).toHaveLength(0)
  })

  it('stops when the debt a bucket points at is gone from the document', () => {
    const trace = traceMonth(
      input({
        debts: [],
        plan: {
          name: 'Default',
          result: result([computed(bucket({ targetKind: 'DEBT', targetId: 'debt-1' }), 900)]),
        },
        paidByPlan: new Set(['debt-1']),
      }),
    )
    expect(trace.split[0]?.end).toEqual({ kind: 'BROKEN', reason: 'TARGET_MISSING' })
  })
})

describe('where it is now', () => {
  it('counts a debt repayment as followed, so the headline and the list agree', () => {
    const trace = traceMonth(
      input({
        entry: entry([{ typeId: 'dt:loan', employee: 900 }]),
        types: [type({ id: 'dt:loan', name: 'Payroll loan', kind: 'LOAN_REPAYMENT', countsAsSaving: false, linkedDebtId: 'debt-1' })],
      }),
    )
    expect(trace.followed).toEqual(fromMajorUnits(900, 'ILS'))
    expect(traceLandings(trace, 'ILS').map((one) => one.kind)).toEqual(['DEBT'])
  })

  it('adds two arrows into one destination rather than listing it twice', () => {
    const trace = traceMonth(
      input({
        entry: entry([
          { typeId: 'dt:pension', employee: 1000 },
          { typeId: 'dt:study', employee: 500 },
        ]),
        types: [
          type({ linkedFundId: 'fund-1' }),
          type({ id: 'dt:study', name: 'Study fund', kind: 'STUDY_FUND', linkedFundId: 'fund-1' }),
        ],
      }),
    )
    const landings = traceLandings(trace, 'ILS')
    expect(landings).toHaveLength(1)
    expect(landings[0]?.amount).toEqual(fromMajorUnits(1500, 'ILS'))
  })

  it('lists nothing that only stopped or was spent', () => {
    expect(traceLandings(traceMonth(input()), 'ILS')).toEqual([])
  })
})
