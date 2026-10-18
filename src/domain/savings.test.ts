import { describe, expect, it } from 'vitest'

import { money, type Money } from '@/core/money.ts'
import { localDate, type LocalDate } from '@/core/time.ts'
import type {
  DeductionType,
  Paycheck,
  PaycheckLine,
  PaycheckWithLines,
} from '@/domain/model/paycheck.ts'
import type { Holding, HoldingPlace, SavingDeposit, SavingGoal } from '@/domain/model/savings.ts'
import {
  depositSourceKey,
  payrollDepositRef,
  depositWarnings,
  effectiveTarget,
  goalProgress,
  holdingBalances,
  liquiditySplit,
  moneyMap,
  placeBalances,
  payrollSavingDeposits,
  savingsOverview,
  validateDeposit,
  validateGoal,
  provenanceOf,
  reachableOf,
  validateHolding,
  validateHoldingPlace,
  validateTransfer,
  unconfirmedHoldings,
  type GoalFigures,
  type GoalProgressInput,
  type SavingsOverviewInput,
} from './savings.ts'

const ILS = 'ILS'

/**
 * What the document would work out about a goal from these deposits — the
 * pack's declared totals, added by hand for a test that has no document (M36
 * U03). The real fold is the engine's, and `packs/ledger/figures.test.ts` pins it.
 */
function figuresFor(
  goal: SavingGoal,
  deposits: readonly SavingDeposit[],
  holdings: readonly Holding[],
): GoalFigures {
  const mine = deposits.filter((one) => one.goalId === goal.id)
  const liquid = new Set(holdings.filter((one) => one.isLiquid).map((one) => one.id))
  const total = (rows: readonly SavingDeposit[]): Money | undefined => {
    const currencies = new Set(rows.map((one) => one.amount.currency))
    if (currencies.size > 1) return undefined
    return money(rows.reduce((sum, one) => sum + one.amount.minor, 0), rows[0]?.amount.currency ?? ILS)
  }
  const balance = total(mine)
  const growth = total(mine.filter((one) => one.sourceKind === 'GROWTH'))
  const target = goal.targetAmount
  return {
    balance,
    opening: total(mine.filter((one) => one.sourceKind === 'OPENING_BALANCE')),
    growth,
    liquid: total(mine.filter((one) => liquid.has(one.holdingId))),
    putIn: balance !== undefined && growth !== undefined ? money(balance.minor - growth.minor, balance.currency) : undefined,
    progress:
      balance === undefined || target === undefined || target.minor === 0 || target.currency !== balance.currency
        ? undefined
        : balance.minor / target.minor,
  }
}

const progressOf = (input: Omit<GoalProgressInput, 'figures'>) =>
  goalProgress({ ...input, figures: figuresFor(input.goal, input.deposits, input.holdings) })

const overviewOf = (input: Omit<SavingsOverviewInput, 'goalFigures'>) =>
  savingsOverview({
    ...input,
    goalFigures: new Map(input.goals.map((goal) => [goal.id, figuresFor(goal, input.deposits, input.holdings)])),
  })

const ils = (minor: number) => money(minor, ILS)

const TODAY = localDate(2026, 8, 15)

const GOAL_ID = 'goal-1'

function goal(overrides?: Partial<SavingGoal>): SavingGoal {
  return {
    id: GOAL_ID,
    name: 'House deposit',
    targetAmount: undefined,
    targetDate: undefined,
    kind: 'EARMARKED',
    defaultHoldingId: undefined,
    isClosed: false,
    priority: 10,
    note: undefined,
    ...overrides,
  }
}

function place(overrides?: Partial<HoldingPlace>): HoldingPlace {
  return {
    id: 'place-hapoalim',
    name: 'Hapoalim',
    kind: 'CHECKING',
    institution: 'Hapoalim',
    note: undefined,
    isArchived: false,
    ...overrides,
  }
}

/**
 * A holding, which is where liquidity and the rate live since D-175.
 *
 * The two at Hapoalim are the case that could not be expressed before: one
 * place, one reachable holding and one locked one.
 */
function holding(overrides?: Partial<Holding>): Holding {
  return {
    id: 'holding-checking',
    holdingPlaceId: 'place-hapoalim',
    name: 'Cash',
    kind: 'CASH',
    provenance: 'RECORDED',
    lastConfirmedAt: undefined,
    isLiquid: true,
    expectedReturn: undefined,
    termEndDate: undefined,
    feeBasisPoints: undefined,
    note: undefined,
    isArchived: false,
    ...overrides,
  }
}

const HAPOALIM = place()
const BROKER = place({
  id: 'place-broker',
  name: 'Interactive Brokers',
  kind: 'INVESTMENT',
  institution: 'IBKR',
})

const CHECKING = holding()
const PAKAM = holding({
  id: 'holding-pakam',
  name: 'פק"מ',
  kind: 'DEPOSIT',
  isLiquid: false,
  expectedReturn: { basisPoints: 400, basis: 'CONTRACTUAL' },
})
const BROKERAGE = holding({
  id: 'holding-brokerage',
  holdingPlaceId: 'place-broker',
  name: 'Index fund',
  kind: 'FUND',
  isLiquid: false,
  expectedReturn: { basisPoints: 600, basis: 'ASSUMED' },
})
/** A pension: a holding with a fund type, in no place (D-389). */
const PENSION = holding({
  id: 'fund-1',
  holdingPlaceId: '',
  name: 'Pension',
  kind: 'FUND',
  isLiquid: false,
  fundType: 'PENSION',
})

let nextDeposit = 0

function deposit(
  date: LocalDate,
  minor: number,
  overrides?: Partial<SavingDeposit>,
): SavingDeposit {
  nextDeposit += 1
  return {
    id: `deposit-${nextDeposit}`,
    goalId: GOAL_ID,
    date,
    amount: ils(minor),
    holdingId: CHECKING.id,
    sourceKind: 'MANUAL',
    sourceRefId: undefined,
    transferGroupKey: undefined,
    note: undefined,
    ...overrides,
  }
}

describe('balances', () => {
  it('is the sum of the deposits it was given, withdrawals included', () => {
    const deposits = [
      deposit(localDate(2026, 5, 1), 100_000),
      deposit(localDate(2026, 6, 1), 250_050),
      deposit(localDate(2026, 7, 1), -50_000, { note: 'Boiler' }),
    ]

    const progress = progressOf({
      goal: goal(),
      deposits,
      holdings: [CHECKING],
      asOf: TODAY,
      currency: ILS,
    })

    expect(progress.balance).toEqual(ils(300_050))
    expect(progress.contributed).toEqual(ils(350_050))
    expect(progress.withdrawn).toEqual(ils(-50_000))
    expect(progress.depositCount).toBe(3)
  })

  it('splits the balance four ways, and the four sum to it', () => {
    // D-081's invariant. The split exists so a screen never has to subtract one
    // figure from another to find out how much of a balance the user is
    // responsible for.
    const deposits = [
      deposit(localDate(2026, 1, 1), 200_000, { sourceKind: 'OPENING_BALANCE' }),
      deposit(localDate(2026, 5, 1), 100_000),
      deposit(localDate(2026, 6, 1), -30_000, { note: 'Boiler' }),
      deposit(localDate(2026, 6, 30), 8_400, { sourceKind: 'GROWTH' }),
      deposit(localDate(2026, 7, 31), -3_100, { sourceKind: 'GROWTH' }),
    ]

    const progress = progressOf({
      goal: goal(),
      deposits,
      holdings: [CHECKING],
      asOf: TODAY,
      currency: ILS,
    })

    expect(progress.openingBalance).toEqual(ils(200_000))
    expect(progress.contributed).toEqual(ils(100_000))
    expect(progress.withdrawn).toEqual(ils(-30_000))
    expect(progress.growth).toEqual(ils(5_300))
    expect(progress.balance).toEqual(ils(275_300))
    expect(
      progress.openingBalance.minor +
        progress.contributed.minor +
        progress.withdrawn.minor +
        progress.growth.minor,
    ).toBe(progress.balance.minor)
  })

  it('does not report growth or an opening balance as saving', () => {
    // The reason the kinds exist. A goal fed by nothing but a good quarter is
    // not one the user is feeding, and both the streak and the completion
    // estimate have to say so (D-081).
    const asOf = localDate(2026, 8, 15)
    const growthOnly = progressOf({
      goal: goal({ targetAmount: ils(500_000) }),
      deposits: [
        deposit(localDate(2026, 6, 1), 300_000, { sourceKind: 'OPENING_BALANCE' }),
        deposit(localDate(2026, 7, 1), 20_000, { sourceKind: 'GROWTH' }),
        deposit(localDate(2026, 8, 1), 20_000, { sourceKind: 'GROWTH' }),
      ],
      holdings: [CHECKING],
      asOf,
      currency: ILS,
    })

    expect(growthOnly.activity.streakMonths).toBe(0)
    expect(growthOnly.activity.lastDepositDate).toBeUndefined()
    expect(growthOnly.completion.kind).toBe('NOT_AT_THIS_RATE')

    // And the same figures with the same money contributed rather than grown.
    const contributed = progressOf({
      goal: goal({ targetAmount: ils(500_000) }),
      deposits: [
        deposit(localDate(2026, 6, 1), 300_000, { sourceKind: 'OPENING_BALANCE' }),
        deposit(localDate(2026, 7, 1), 20_000),
        deposit(localDate(2026, 8, 1), 20_000),
      ],
      holdings: [CHECKING],
      asOf,
      currency: ILS,
    })

    expect(contributed.activity.streakMonths).toBe(2)
    expect(contributed.completion.kind).toBe('PROJECTED')
  })

  it('holds Σ deposits === balance over any arrangement of amounts', () => {
    // F07's first acceptance criterion, as the property it is written as.
    const amounts = [1, -1, 999_999, -450_000, 33, 0 + 7, -8, 120_000, -119_999, 5]
    for (let cut = 0; cut <= amounts.length; cut += 1) {
      const slice = amounts.slice(0, cut)
      const deposits = slice.map((minor, index) =>
        deposit(localDate(2026, 1 + (index % 7), 1 + index), minor, { note: 'x' }),
      )
      const expected = slice.reduce((running, minor) => running + minor, 0)

      const progress = progressOf({
        goal: goal(),
        deposits,
        holdings: [CHECKING],
        asOf: TODAY,
        currency: ILS,
      })

      expect(progress.balance.minor).toBe(expected)
    }
  })

  it('is unchecked, never smaller, with a deposit in another currency — and lists it (D-349)', () => {
    const progress = progressOf({
      goal: goal(),
      deposits: [
        deposit(localDate(2026, 6, 1), 100_000),
        deposit(localDate(2026, 6, 2), 50_000, { amount: money(50_000, 'USD') }),
      ],
      holdings: [CHECKING],
      asOf: TODAY,
      currency: ILS,
    })

    expect(progress.unchecked).toBeDefined()
    expect(progress.progressBasisPoints).toBeUndefined()
    expect(progress.otherCurrency).toHaveLength(1)
  })

  it('keeps a place with nothing in it, and gives an unknown place a row', () => {
    const balances = holdingBalances(
      [deposit(localDate(2026, 6, 1), 80_000, { holdingId: 'holding-gone' })],
      [CHECKING, PAKAM],
      ILS,
    )

    expect(balances.map((row) => row.holdingId)).toEqual([
      CHECKING.id,
      PAKAM.id,
      'holding-gone',
    ])
    expect(balances[0]?.balance).toEqual(ils(0))
    expect(balances[2]?.holding).toBeUndefined()
    expect(balances[2]?.isLiquid).toBe(false)
  })
})

describe('liquidity', () => {
  it('splits into liquid and locked, and the two sum to the total', () => {
    const balances = holdingBalances(
      [
        deposit(localDate(2026, 6, 1), 400_000),
        deposit(localDate(2026, 6, 2), 1_000_000, { holdingId: PAKAM.id }),
      ],
      [CHECKING, PAKAM, PENSION],
      ILS,
      new Map([[PENSION.id, ils(9_500_000)]]),
    )

    // A fund is one of the holdings (D-389): locked, and counted once.
    const split = liquiditySplit(balances, ILS)

    expect(split.liquid).toEqual(ils(400_000))
    expect(split.locked).toEqual(ils(10_500_000))
    expect(split.total).toEqual(ils(10_900_000))
    expect(split.liquid.minor + split.locked.minor).toBe(split.total.minor)
  })

  it('counts an unrecognized holding as locked, never as reachable', () => {
    const balances = holdingBalances(
      [deposit(localDate(2026, 6, 1), 300_000, { holdingId: 'holding-gone' })],
      [CHECKING],
      ILS,
    )
    const split = liquiditySplit(balances, ILS)

    expect(split.liquid).toEqual(ils(0))
    expect(split.locked).toEqual(ils(300_000))
    expect(split.unknownHoldingIds).toEqual(['holding-gone'])
  })
})

describe('progress against a target', () => {
  it('divides the shortfall over the months remaining, this month included', () => {
    const progress = progressOf({
      goal: goal({ targetAmount: ils(1_000_000), targetDate: localDate(2026, 12, 31) }),
      deposits: [deposit(localDate(2026, 6, 1), 500_000)],
      holdings: [CHECKING],
      asOf: TODAY,
      currency: ILS,
    })

    // August through December is five months, and ₪5,000 over five is ₪1,000.
    expect(progress.required).toEqual({
      kind: 'REQUIRED',
      amount: ils(100_000),
      shortfall: ils(500_000),
      monthsRemaining: 5,
    })
    expect(progress.progressBasisPoints).toBe(5_000)
  })

  it('rounds the required amount up, so N payments reach the target', () => {
    const progress = progressOf({
      goal: goal({ targetAmount: ils(100_001), targetDate: localDate(2026, 10, 1) }),
      deposits: [],
      holdings: [CHECKING],
      asOf: TODAY,
      currency: ILS,
    })

    expect(progress.required.kind).toBe('REQUIRED')
    if (progress.required.kind !== 'REQUIRED') return
    expect(progress.required.amount.minor * progress.required.monthsRemaining).toBeGreaterThanOrEqual(
      100_001,
    )
  })

  it('says overdue rather than dividing by zero or going negative', () => {
    const progress = progressOf({
      goal: goal({ targetAmount: ils(1_000_000), targetDate: localDate(2026, 5, 31) }),
      deposits: [deposit(localDate(2026, 1, 1), 200_000)],
      holdings: [CHECKING],
      asOf: TODAY,
      currency: ILS,
    })

    expect(progress.required).toEqual({
      kind: 'OVERDUE',
      shortfall: ils(800_000),
      targetDate: localDate(2026, 5, 31),
      monthsPast: 3,
    })
  })

  it('asks for the whole shortfall when the target month is this month', () => {
    const progress = progressOf({
      goal: goal({ targetAmount: ils(300_000), targetDate: localDate(2026, 8, 31) }),
      deposits: [deposit(localDate(2026, 7, 1), 100_000)],
      holdings: [CHECKING],
      asOf: TODAY,
      currency: ILS,
    })

    expect(progress.required).toEqual({
      kind: 'REQUIRED',
      amount: ils(200_000),
      shortfall: ils(200_000),
      monthsRemaining: 1,
    })
  })

  it('has no required figure and no ring for an open-ended goal', () => {
    const progress = progressOf({
      goal: goal(),
      deposits: [deposit(localDate(2026, 6, 1), 100_000)],
      holdings: [CHECKING],
      asOf: TODAY,
      currency: ILS,
    })

    expect(progress.target).toEqual({ kind: 'NONE' })
    expect(progress.required).toEqual({ kind: 'NO_TARGET' })
    expect(progress.progressBasisPoints).toBeUndefined()
    expect(progress.completion).toEqual({ kind: 'NO_TARGET' })
  })
})

describe('projected completion', () => {
  it('projects from the last three months of net contributions', () => {
    const progress = progressOf({
      goal: goal({ targetAmount: ils(1_000_000) }),
      deposits: [
        deposit(localDate(2026, 6, 5), 100_000),
        deposit(localDate(2026, 7, 5), 100_000),
        deposit(localDate(2026, 8, 5), 100_000),
      ],
      holdings: [CHECKING],
      asOf: TODAY,
      currency: ILS,
    })

    expect(progress.completion).toEqual({
      kind: 'PROJECTED',
      monthlyRate: ils(100_000),
      months: 7,
      period: { year: 2027, month: 3 },
      from: { year: 2026, month: 6 },
      to: { year: 2026, month: 8 },
    })
  })

  it('will not project at a rate of zero or less', () => {
    const progress = progressOf({
      goal: goal({ targetAmount: ils(1_000_000) }),
      deposits: [
        deposit(localDate(2026, 1, 5), 300_000),
        deposit(localDate(2026, 7, 5), -20_000, { note: 'Car' }),
      ],
      holdings: [CHECKING],
      asOf: TODAY,
      currency: ILS,
    })

    expect(progress.completion.kind).toBe('NOT_AT_THIS_RATE')
  })

  it('refuses to print a date fifty years out', () => {
    const progress = progressOf({
      goal: goal({ targetAmount: ils(40_000_000) }),
      deposits: [deposit(localDate(2026, 8, 1), 500)],
      holdings: [CHECKING],
      asOf: TODAY,
      currency: ILS,
    })

    expect(progress.completion.kind).toBe('BEYOND_HORIZON')
  })
})

describe('contribution activity', () => {
  it('counts consecutive months and lets last month keep the streak', () => {
    const progress = progressOf({
      goal: goal(),
      deposits: [
        deposit(localDate(2026, 5, 3), 50_000),
        deposit(localDate(2026, 6, 3), 50_000),
        deposit(localDate(2026, 7, 3), 50_000),
      ],
      holdings: [CHECKING],
      asOf: TODAY,
      currency: ILS,
    })

    expect(progress.activity.streakMonths).toBe(3)
    expect(progress.activity.monthsSinceLastDeposit).toBe(1)
    expect(progress.activity.monthsWithContribution).toBe(3)
  })

  it('does not let a withdrawal hold a streak open', () => {
    const progress = progressOf({
      goal: goal(),
      deposits: [
        deposit(localDate(2026, 6, 3), 50_000),
        deposit(localDate(2026, 7, 3), -50_000, { note: 'Repairs' }),
        deposit(localDate(2026, 8, 3), -10_000, { note: 'Repairs' }),
      ],
      holdings: [CHECKING],
      asOf: TODAY,
      currency: ILS,
    })

    expect(progress.activity.streakMonths).toBe(0)
    expect(progress.activity.lastDepositDate).toEqual(localDate(2026, 6, 3))
  })
})

describe('an Emergency goal (M36 U09)', () => {
  it('is an ordinary goal: measured by its whole balance against the amount it stores', () => {
    const progress = progressOf({
      goal: goal({ id: 'goal-emergency', name: 'Emergency fund', kind: 'EMERGENCY', targetAmount: ils(2_400_000) }),
      deposits: [
        deposit(localDate(2026, 5, 1), 1_500_000, { goalId: 'goal-emergency' }),
        deposit(localDate(2026, 5, 2), 2_000_000, { goalId: 'goal-emergency', holdingId: PAKAM.id }),
      ],
      holdings: [CHECKING, PAKAM],
      asOf: TODAY,
      currency: ILS,
    })

    expect(progress.progressBalance).toEqual(progress.balance)
    expect(progress.target).toEqual({ kind: 'AMOUNT', amount: ils(2_400_000) })
    expect(effectiveTarget(goal({ kind: 'EMERGENCY' }))).toEqual({ kind: 'NONE' })
  })
})

describe('the overview', () => {
  it('is one pass over goals, holdings and funds, and the totals reconcile', () => {
    const houseGoal = goal({ id: 'goal-house', name: 'House' })
    const carGoal = goal({ id: 'goal-car', name: 'Car' })

    const overview = overviewOf({
      goals: [houseGoal, carGoal],
      deposits: [
        deposit(localDate(2026, 6, 1), 500_000, { goalId: houseGoal.id }),
        deposit(localDate(2026, 6, 2), 1_200_000, {
          goalId: houseGoal.id,
          holdingId: PAKAM.id,
        }),
        deposit(localDate(2026, 6, 3), 300_000, { goalId: carGoal.id }),
        deposit(localDate(2026, 6, 4), 90_000, { goalId: 'goal-deleted' }),
      ],
      holdings: [CHECKING, PAKAM, PENSION],
      places: [HAPOALIM],
      asOf: TODAY,
      currency: ILS,
      valuations: new Map([[PENSION.id, ils(4_000_000)]]),
    })

    expect(overview.inGoals).toEqual(ils(2_000_000))
    expect(overview.liquidity.liquid).toEqual(ils(800_000))
    expect(overview.liquidity.locked).toEqual(ils(5_200_000))
    expect(overview.liquidity.total).toEqual(ils(6_000_000))
    expect(overview.orphaned).toHaveLength(1)

    // **One cell per place**, so the house goal's cash and its פק"מ at the same
    // bank are one figure rather than two columns saying the same thing about
    // where its money is (D-176).
    expect(overview.cells).toEqual([
      { goalId: 'goal-house', holdingPlaceId: HAPOALIM.id, balance: ils(1_700_000) },
      { goalId: 'goal-car', holdingPlaceId: HAPOALIM.id, balance: ils(300_000) },
    ])
  })

  it('survives a document with nothing in it', () => {
    const overview = overviewOf({
      goals: [],
      deposits: [],
      holdings: [],
      places: [],
      asOf: TODAY,
      currency: ILS,
    })

    expect(overview.liquidity.total).toEqual(ils(0))
    expect(overview.goals).toEqual([])
    expect(overview.cells).toEqual([])
  })
})

describe('payroll savings', () => {
  function paycheck(id: string, month: number): Paycheck {
    return {
      id,
      period: { year: 2026, month },
      paymentDate: localDate(2026, month, 9),
      employerName: 'Acme',
      gross: ils(2_500_000),
      net: ils(1_800_000),
      depositedToAccountId: undefined,
      note: undefined,
      sourceKind: 'MANUAL',
      attachmentRef: undefined,
      isIrregular: false,
    }
  }

  function line(id: string, paycheckId: string): PaycheckLine {
    return {
      id,
      paycheckId,
      deductionTypeId: 'type-hishtalmut',
      employeeAmount: ils(60_000),
      employerAmount: ils(180_000),
      basisAmount: undefined,
      note: undefined,
      sortOrder: 1,
    }
  }

  const type: DeductionType = {
    id: 'type-hishtalmut',
    name: 'Study fund',
    hebrewName: 'קרן השתלמות',
    kind: 'STUDY_FUND',
    reducesNet: true,
    countsAsSaving: true,
    linkedSavingGoalId: GOAL_ID,
    linkedDebtId: undefined,
    linkedFundId: undefined,
    isBuiltIn: true,
    sortOrder: 3,
  }

  const entries: readonly PaycheckWithLines[] = [
    { paycheck: paycheck('pay-1', 6), lines: [line('line-1', 'pay-1')] },
    { paycheck: paycheck('pay-2', 7), lines: [line('line-2', 'pay-2')] },
  ]

  it('derives one deposit per payslip, both sides counted', () => {
    const derived = payrollSavingDeposits(entries, [type], [goal()])

    expect(derived).toHaveLength(2)
    expect(derived[0]).toMatchObject({
      goalId: GOAL_ID,
      sourceRefId: `pay-1:${GOAL_ID}`,
      amount: ils(240_000),
      date: localDate(2026, 6, 9),
    })
  })

  it('sums two lines feeding one goal into one deposit', () => {
    const twoLines: readonly PaycheckWithLines[] = [
      {
        paycheck: paycheck('pay-3', 8),
        lines: [
          line('line-a', 'pay-3'),
          { ...line('line-b', 'pay-3'), deductionTypeId: 'type-pension' },
        ],
      },
    ]
    const pension: DeductionType = { ...type, id: 'type-pension', name: 'Pension', kind: 'PENSION' }

    const derived = payrollSavingDeposits(twoLines, [type, pension], [goal()])

    expect(derived).toHaveLength(1)
    expect(derived[0]?.amount).toEqual(ils(480_000))
  })

  it('keys the deposit on the payslip and the goal, which survive an edit', () => {
    // `updatePaycheck` deletes a slip's lines and writes them again, so a line
    // id does not survive a correction — a deposit keyed on one would be
    // deleted and recreated by every edit.
    const edited: readonly PaycheckWithLines[] = [
      { paycheck: paycheck('pay-1', 6), lines: [line('line-99-rewritten', 'pay-1')] },
    ]

    expect(payrollSavingDeposits(edited, [type], [goal()])[0]?.sourceRefId).toBe(
      payrollSavingDeposits(entries, [type], [goal()])[0]?.sourceRefId,
    )
  })

  it('produces nothing when the type points nowhere', () => {
    expect(
      payrollSavingDeposits(entries, [{ ...type, linkedSavingGoalId: undefined }], [goal()]),
    ).toEqual([])
  })

  it('keys a generated deposit by its source, and a manual one not at all', () => {
    const ref = payrollDepositRef('pay-1', GOAL_ID)
    expect(depositSourceKey('FROM_PAYCHECK_DEDUCTION', ref)).toBe(
      `FROM_PAYCHECK_DEDUCTION:${ref}`,
    )
    expect(depositSourceKey('MANUAL', ref)).toBeUndefined()
    expect(depositSourceKey('FROM_TRANSACTION', undefined)).toBeUndefined()
  })
})

describe('validation', () => {
  it('accepts an open-ended goal', () => {
    expect(validateGoal(goal())).toEqual([])
  })

  it('refuses a rate nobody could have been offered — on the holding, since D-175', () => {
    expect(
      validateHolding(holding({ expectedReturn: { basisPoints: 500_000, basis: 'ASSUMED' } })),
    ).toEqual(['RETURN_OUT_OF_RANGE'])
    expect(validateHolding(PAKAM)).toEqual([])
    expect(validateHolding(holding({ feeBasisPoints: 500_000 }))).toEqual(['FEE_OUT_OF_RANGE'])
  })

  it('works out whether a holding is reachable from its kind and its term (M36 U11)', () => {
    expect(reachableOf('CASH', undefined, TODAY)).toBe(true)
    expect(reachableOf('SECURITY', undefined, TODAY)).toBe(true)
    expect(reachableOf('DEPOSIT', undefined, TODAY)).toBe(false)
    expect(reachableOf('TRACK', undefined, TODAY)).toBe(false)
    // A term that has not ended locks even cash; one that has ended frees a deposit.
    expect(reachableOf('CASH', localDate(2099, 1, 1), TODAY)).toBe(false)
    expect(reachableOf('DEPOSIT', TODAY, TODAY)).toBe(true)
  })

  it('reads where a figure comes from off the readings (M36 U11)', () => {
    expect(provenanceOf([])).toBe('RECORDED')
    expect(provenanceOf([{ quantityMicro: undefined }])).toBe('TRANSCRIBED')
    expect(provenanceOf([{ quantityMicro: undefined }, { quantityMicro: 3_000_000 }])).toBe('VALUED')
  })

  it('asks a place for a name and nothing else', () => {
    expect(validateHoldingPlace(HAPOALIM)).toEqual([])
    expect(validateHoldingPlace(place({ name: '  ' }))).toEqual(['NO_NAME'])
  })

  it('blocks a deposit into a closed goal and a withdrawal with no reason', () => {
    expect(
      validateDeposit(deposit(TODAY, 100_000), {
        goal: goal({ isClosed: true }),
        holdings: [CHECKING],
      }),
    ).toEqual(['CLOSED_GOAL'])

    expect(
      validateDeposit(deposit(TODAY, -100_000), { goal: goal(), holdings: [CHECKING] }),
    ).toEqual(['WITHDRAWAL_WITHOUT_REASON'])

    expect(validateDeposit(deposit(TODAY, 0), { goal: goal(), holdings: [CHECKING] })).toEqual([
      'ZERO_AMOUNT',
    ])
  })

  it('does not demand a reason for a loss, which is what the kind already says', () => {
    // Requiring "what the money went on" for a market fall leaves one way to
    // record it — as a withdrawal — and every spending figure downstream would
    // believe it (D-081).
    expect(
      validateDeposit(deposit(TODAY, -12_000, { sourceKind: 'GROWTH' }), {
        goal: goal(),
        holdings: [CHECKING],
      }),
    ).toEqual([])
  })

  it('allows a withdrawal larger than the balance, and warns', () => {
    const existing = [deposit(localDate(2026, 6, 1), 100_000)]
    const withdrawal = deposit(TODAY, -150_000, { note: 'Emergency' })

    expect(validateDeposit(withdrawal, { goal: goal(), holdings: [CHECKING] })).toEqual([])
    expect(depositWarnings(withdrawal, existing)).toEqual(['WITHDRAWAL_EXCEEDS_BALANCE'])
  })

  it('does not warn about a withdrawal being edited against itself', () => {
    const withdrawal = deposit(TODAY, -80_000, { note: 'Emergency' })
    const existing = [deposit(localDate(2026, 6, 1), 100_000), withdrawal]

    expect(depositWarnings(withdrawal, existing)).toEqual([])
  })

  it('checks that the two legs of a transfer net to zero', () => {
    const key = 'transfer-1'
    const out = deposit(TODAY, -1_000_000, { transferGroupKey: key, note: 'To the פק"מ' })
    const into = deposit(TODAY, 1_000_000, {
      transferGroupKey: key,
      holdingId: PAKAM.id,
    })

    expect(validateTransfer([out, into])).toEqual([])
    expect(validateTransfer([out])).toEqual(['NOT_TWO_LEGS'])
    expect(
      validateTransfer([out, { ...into, amount: ils(900_000) }]),
    ).toEqual(['DOES_NOT_NET_TO_ZERO'])
    expect(
      validateTransfer([out, { ...into, holdingId: CHECKING.id }]),
    ).toEqual(['SAME_HOLDING'])
  })
})


describe('the money map', () => {
  it('gathers holdings under their place and keeps liquid + locked = total', () => {
    const map = moneyMap({
      deposits: [
        deposit(localDate(2026, 6, 1), 400_000),
        deposit(localDate(2026, 6, 2), 1_000_000, { holdingId: PAKAM.id }),
        deposit(localDate(2026, 6, 3), 250_000, { holdingId: BROKERAGE.id }),
      ],
      holdings: [CHECKING, PAKAM, BROKERAGE, PENSION],
      places: [HAPOALIM, BROKER],
      valuations: new Map([[PENSION.id, ils(9_500_000)]]),
      funds: [
        {
          fundId: 'fund-1',
          name: 'Menora pension',
          institution: 'Menora',
          balance: ils(9_500_000),
          asOf: localDate(2026, 3, 31),
        },
      ],
      currency: ILS,
    })

    const hapoalim = map.places.find((row) => row.holdingPlaceId === HAPOALIM.id)
    expect(hapoalim?.holdings).toHaveLength(2)
    expect(hapoalim?.balance).toEqual(ils(1_400_000))
    // The bank is neither reachable nor locked; the two things it holds are.
    expect(hapoalim?.liquid).toEqual(ils(400_000))
    expect(hapoalim?.locked).toEqual(ils(1_000_000))

    expect(map.funds[0]?.provenance).toBe('TRANSCRIBED')
    expect(map.funds[0]?.isLiquid).toBe(false)

    expect(map.funds[0]?.balance).toEqual(ils(9_500_000))
    // A fund is a holding in no place: a row of its own, never an orphan (D-389).
    expect(map.places.some((row) => row.holdingPlaceId === '')).toBe(false)

    expect(map.liquidity.liquid).toEqual(ils(400_000))
    expect(map.liquidity.total).toEqual(ils(11_150_000))
    expect(map.liquidity.liquid.minor + map.liquidity.locked.minor).toBe(
      map.liquidity.total.minor,
    )
  })

  it('keeps money whose holding is gone, in a row of its own, counted as locked', () => {
    const map = moneyMap({
      deposits: [deposit(localDate(2026, 6, 1), 300_000, { holdingId: 'holding-gone' })],
      holdings: [CHECKING],
      places: [HAPOALIM],
      currency: ILS,
    })

    const orphan = map.places.find((row) => row.place === undefined)
    expect(orphan?.balance).toEqual(ils(300_000))
    expect(map.liquidity.liquid).toEqual(ils(0))
    expect(map.liquidity.locked).toEqual(ils(300_000))
    expect(map.unknownHoldingIds).toEqual(['holding-gone'])
  })

  it('lists a place with no holdings rather than hiding it', () => {
    const rows = placeBalances(holdingBalances([], [CHECKING], ILS), [HAPOALIM, BROKER], ILS)
    expect(rows).toHaveLength(2)
    expect(rows[1]?.holdings).toEqual([])
    expect(rows[1]?.balance).toEqual(ils(0))
  })
})

describe('what nobody has confirmed', () => {
  const balances = () =>
    holdingBalances(
      [
        deposit(localDate(2026, 1, 1), 400_000),
        deposit(localDate(2026, 1, 2), 900_000, { holdingId: PAKAM.id }),
        deposit(localDate(2026, 1, 3), 0, { holdingId: BROKERAGE.id }),
      ],
      [
        CHECKING,
        holding({
          id: PAKAM.id,
          name: PAKAM.name,
          kind: 'DEPOSIT',
          isLiquid: false,
          lastConfirmedAt: localDate(2026, 8, 1),
        }),
        BROKERAGE,
      ],
      ILS,
    )

  it('names the never-checked with no months rather than a large number', () => {
    const stale = unconfirmedHoldings(balances(), TODAY)
    expect(stale.map((one) => one.holdingId)).toEqual([CHECKING.id])
    expect(stale[0]?.monthsSince).toBeUndefined()
  })

  it('leaves alone what was checked recently, and an empty holding entirely', () => {
    const stale = unconfirmedHoldings(balances(), TODAY)
    // The פק"מ was confirmed two weeks ago; the brokerage holds nothing, so
    // there is nothing about it that could be wrong.
    expect(stale.some((one) => one.holdingId === PAKAM.id)).toBe(false)
    expect(stale.some((one) => one.holdingId === BROKERAGE.id)).toBe(false)
  })

  it('counts the months once enough of them have passed', () => {
    const old = holdingBalances(
      [deposit(localDate(2025, 1, 1), 400_000)],
      [holding({ lastConfirmedAt: localDate(2025, 9, 15) })],
      ILS,
    )
    expect(unconfirmedHoldings(old, TODAY)[0]?.monthsSince).toBe(11)
  })
})
