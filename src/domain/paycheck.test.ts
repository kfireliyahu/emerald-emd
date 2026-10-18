import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import type { DeductionType, Paycheck, PaycheckLine, PaycheckWithLines } from '@/domain/model/paycheck.ts'
import {
  averageNet,
  grossToNetSteps,
  netTrend,
  effectiveTaxRateBasisPoints,
  employerTotal,
  isIrregularCandidate,
  medianNet,
  missingPeriods,
  netReducingTotal,
  payrollSavings,
  reconciliationDelta,
  savingsRateBasisPoints,
  sortByPeriodDescending,
  taxTotal,
  totalCompensation,
  unlinkedSavingTypes,
  unresolvedLineIds,
  validatePaycheck,
  yearToDate,
  type WaterfallStep,
} from './paycheck.ts'

const ILS = 'ILS'

/** The seeds of migration 012, as the domain sees them. */
const TYPES: readonly DeductionType[] = [
  type('ded:income-tax', 'TAX', { reducesNet: true }),
  type('ded:national-insurance', 'SOCIAL_INSURANCE', { reducesNet: true }),
  type('ded:health-tax', 'HEALTH', { reducesNet: true }),
  type('ded:pension', 'PENSION', { reducesNet: true, countsAsSaving: true }),
  type('ded:study-fund', 'STUDY_FUND', { reducesNet: true, countsAsSaving: true }),
  type('ded:severance', 'SEVERANCE', { reducesNet: false, countsAsSaving: true }),
  type('ded:union-dues', 'UNION', { reducesNet: true }),
  type('ded:company-car', 'BENEFIT_IN_KIND', { reducesNet: false }),
  type('ded:other', 'OTHER_DEDUCTION', { reducesNet: true }),
]

function type(
  id: string,
  kind: DeductionType['kind'],
  flags: { readonly reducesNet?: boolean; readonly countsAsSaving?: boolean },
): DeductionType {
  return {
    id,
    name: id,
    hebrewName: undefined,
    kind,
    reducesNet: flags.reducesNet ?? true,
    countsAsSaving: flags.countsAsSaving ?? false,
    linkedSavingGoalId: undefined,
    linkedDebtId: undefined,
    linkedFundId: undefined,
    isBuiltIn: true,
    sortOrder: 0,
  }
}

function line(
  deductionTypeId: string,
  employeeMinor: number,
  employerMinor?: number,
): PaycheckLine {
  return {
    id: `line-${deductionTypeId}`,
    paycheckId: 'pay-1',
    deductionTypeId,
    employeeAmount: money(employeeMinor, ILS),
    employerAmount: employerMinor === undefined ? undefined : money(employerMinor, ILS),
    basisAmount: undefined,
    note: undefined,
    sortOrder: 0,
  }
}

function paycheck(overrides?: Partial<Paycheck>): Paycheck {
  return {
    id: 'pay-1',
    period: { year: 2026, month: 6 },
    paymentDate: localDate(2026, 7, 9),
    employerName: undefined,
    gross: money(2_500_000, ILS),
    net: money(1_753_300, ILS),
    depositedToAccountId: undefined,
    note: undefined,
    sourceKind: 'MANUAL',
    attachmentRef: undefined,
    isIrregular: false,
    ...overrides,
  }
}

/**
 * A slip that reconciles exactly: ₪25,000 gross, ₪17,533 net, and ₪7,467 of
 * itemized employee deductions, with the employer's side beside them.
 */
function realisticSlip(): PaycheckWithLines {
  return {
    paycheck: paycheck(),
    lines: [
      line('ded:income-tax', 341_250),
      line('ded:national-insurance', 106_200),
      line('ded:health-tax', 78_500),
      line('ded:pension', 150_000, 162_500),
      line('ded:study-fund', 62_500, 187_500),
      line('ded:severance', 0, 208_333),
      line('ded:union-dues', 8_250),
    ],
  }
}

describe('reconciliationDelta', () => {
  it('is zero when the itemization accounts for every agora between gross and net', () => {
    expect(reconciliationDelta(realisticSlip(), TYPES)).toEqual(money(0, ILS))
  })

  it('is positive by exactly what has not been entered', () => {
    const slip = realisticSlip()
    const missing = { ...slip, lines: slip.lines.filter((l) => l.deductionTypeId !== 'ded:union-dues') }

    expect(reconciliationDelta(missing, TYPES)).toEqual(money(8_250, ILS))
  })

  it('is negative when more has been itemized than the difference allows', () => {
    const slip = realisticSlip()
    const overstated = { ...slip, lines: [...slip.lines, line('ded:other', 10_000)] }

    expect(reconciliationDelta(overstated, TYPES)).toEqual(money(-10_000, ILS))
  })

  it('ignores the employer side entirely', () => {
    const slip = realisticSlip()
    const generous = {
      ...slip,
      lines: slip.lines.map((l) =>
        l.deductionTypeId === 'ded:pension' ? line('ded:pension', 150_000, 999_999) : l,
      ),
    }

    expect(reconciliationDelta(generous, TYPES)).toEqual(money(0, ILS))
  })

  it('does not let a notional benefit reduce net', () => {
    const slip = realisticSlip()
    const withCar = { ...slip, lines: [...slip.lines, line('ded:company-car', 120_000)] }

    expect(reconciliationDelta(withCar, TYPES)).toEqual(money(0, ILS))
  })

  it('skips a line whose type is gone, and says which line that was', () => {
    const slip = realisticSlip()
    const orphaned = { ...slip, lines: [...slip.lines, line('ded:vanished', 50_000)] }

    expect(reconciliationDelta(orphaned, TYPES)).toEqual(money(0, ILS))
    expect(unresolvedLineIds(orphaned, TYPES)).toEqual(['line-ded:vanished'])
    expect(unresolvedLineIds(slip, TYPES)).toEqual([])
  })

  it('holds for a slip with no lines at all', () => {
    const bare: PaycheckWithLines = { paycheck: paycheck(), lines: [] }

    expect(netReducingTotal(bare, TYPES)).toEqual(money(0, ILS))
    expect(reconciliationDelta(bare, TYPES)).toEqual(money(746_700, ILS))
  })
})

describe('total compensation', () => {
  it('adds every employer amount to gross', () => {
    expect(employerTotal(realisticSlip())).toEqual(money(558_333, ILS))
    expect(totalCompensation(realisticSlip())).toEqual(money(3_058_333, ILS))
  })

  it('is gross when nothing has an employer side', () => {
    const slip: PaycheckWithLines = { paycheck: paycheck(), lines: [line('ded:income-tax', 341_250)] }

    expect(totalCompensation(slip)).toEqual(money(2_500_000, ILS))
  })
})

describe('payrollSavings', () => {
  it('counts both sides of pension, study fund and severance and nothing else', () => {
    expect(payrollSavings(realisticSlip(), TYPES)).toEqual({
      employee: money(212_500, ILS),
      employer: money(558_333, ILS),
      total: money(770_833, ILS),
    })
  })

  it('follows the flag rather than the kind, so a retagged type moves with it', () => {
    const types = TYPES.map((t) =>
      t.id === 'ded:union-dues' ? { ...t, countsAsSaving: true } : t,
    )

    expect(payrollSavings(realisticSlip(), types).employee).toEqual(money(220_750, ILS))
  })
})

describe('rates', () => {
  it('sums the three tax kinds and reports the rate in basis points', () => {
    expect(taxTotal(realisticSlip(), TYPES)).toEqual(money(525_950, ILS))
    expect(effectiveTaxRateBasisPoints(realisticSlip(), TYPES)).toBe(2104)
  })

  // The rounding and the zero-denominator rules moved to core/percent.test.ts
  // with `ratioBasisPoints` itself; what stays here is what they mean on a slip.
  it('has no answer when the whole is zero', () => {
    const unpaid: PaycheckWithLines = {
      paycheck: paycheck({ gross: money(0, ILS), net: money(0, ILS) }),
      lines: [],
    }
    expect(effectiveTaxRateBasisPoints(unpaid, TYPES)).toBeUndefined()
  })

  it('measures the savings rate against total compensation, deposits included', () => {
    // ₪7,708.33 saved against ₪30,583.33 of total compensation.
    expect(savingsRateBasisPoints(realisticSlip(), TYPES)).toBe(2520)
    // Plus ₪1,000 put aside by hand that month, which is F07's half of docs/05's definition.
    expect(savingsRateBasisPoints(realisticSlip(), TYPES, money(100_000, ILS))).toBe(2847)
  })
})

describe('validatePaycheck', () => {
  it('passes a slip that does not reconcile — the delta is information, not an error', () => {
    const slip = realisticSlip()
    const short = { ...slip, lines: slip.lines.slice(0, 2) }

    expect(validatePaycheck(short)).toEqual([])
  })

  it('rejects a negative net', () => {
    const slip: PaycheckWithLines = { paycheck: paycheck({ net: money(-100, ILS) }), lines: [] }

    expect(validatePaycheck(slip)).toContain('NEGATIVE_NET')
  })

  it('rejects a net above gross, which is the two fields swapped', () => {
    const slip: PaycheckWithLines = {
      paycheck: paycheck({ gross: money(1_753_300, ILS), net: money(2_500_000, ILS) }),
      lines: [],
    }

    expect(validatePaycheck(slip)).toEqual(['NET_ABOVE_GROSS'])
  })

  it('rejects a line in another currency once, not once per line', () => {
    const slip: PaycheckWithLines = {
      paycheck: paycheck(),
      lines: [
        { ...line('ded:income-tax', 1), employeeAmount: money(1, 'USD') },
        { ...line('ded:health-tax', 1), employeeAmount: money(1, 'EUR') },
      ],
    }

    expect(validatePaycheck(slip)).toEqual(['MIXED_CURRENCY'])
  })

  it('rejects a negative amount on a line, since lines hold magnitudes', () => {
    const slip: PaycheckWithLines = { paycheck: paycheck(), lines: [line('ded:income-tax', -100)] }

    expect(validatePaycheck(slip)).toEqual(['NEGATIVE_LINE'])
  })
})

describe('history', () => {
  function slip(id: string, year: number, month: number, netMinor: number, isIrregular = false): Paycheck {
    return paycheck({ id, period: { year, month }, net: money(netMinor, ILS), isIrregular })
  }

  it('sorts by salary month, newest first', () => {
    const sorted = sortByPeriodDescending([
      slip('a', 2026, 1, 100),
      slip('b', 2025, 12, 100),
      slip('c', 2026, 3, 100),
    ])

    expect(sorted.map((p) => p.id)).toEqual(['c', 'a', 'b'])
  })

  it('takes the median net, and the lower middle of an even count', () => {
    expect(medianNet([])).toBeUndefined()
    expect(medianNet([slip('a', 2026, 1, 300), slip('b', 2026, 2, 100), slip('c', 2026, 3, 200)]))
      .toEqual(money(200, ILS))
    expect(medianNet([slip('a', 2026, 1, 100), slip('b', 2026, 2, 300)])).toEqual(money(100, ILS))
  })

  it('suggests a bonus month by comparing it against the other months only', () => {
    const january = slip('a', 2026, 1, 1_750_000)
    const regular = [january, slip('b', 2026, 2, 1_760_000), slip('c', 2026, 3, 1_740_000)]
    const bonus = slip('d', 2026, 4, 3_500_000)
    const history = [...regular, bonus]

    expect(isIrregularCandidate(bonus, history)).toBe(true)
    // The bonus is in the set it is measured against, and must not drag the line up.
    expect(isIrregularCandidate(january, history)).toBe(false)
  })

  it('does not call a raise a bonus', () => {
    const raised = slip('c', 2026, 3, 2_100_000)
    const history = [slip('a', 2026, 1, 1_750_000), slip('b', 2026, 2, 1_750_000), raised]

    expect(isIrregularCandidate(raised, history)).toBe(false)
  })

  it('has nothing to compare a first paycheck against', () => {
    const only = slip('a', 2026, 1, 9_999_999)

    expect(isIrregularCandidate(only, [only])).toBe(false)
  })

  it('averages the last N nets, excluding confirmed bonus months', () => {
    const history = [
      slip('a', 2026, 1, 1_700_000),
      slip('b', 2026, 2, 1_800_000),
      slip('c', 2026, 3, 3_400_000, true),
    ]

    expect(averageNet(history, 12)).toEqual({
      amount: money(1_750_000, ILS),
      sampleSize: 2,
      excluded: 1,
    })
    expect(averageNet(history, 12, { includeIrregular: true })).toEqual({
      amount: money(2_300_000, ILS),
      sampleSize: 3,
      excluded: 0,
    })
  })

  it('averages only the window asked for, newest first', () => {
    const history = [
      slip('a', 2026, 1, 1_000_000),
      slip('b', 2026, 2, 2_000_000),
      slip('c', 2026, 3, 3_000_000),
    ]

    expect(averageNet(history, 2).amount).toEqual(money(2_500_000, ILS))
  })

  it('rounds the average half-up to the agora', () => {
    const history = [slip('a', 2026, 1, 10_001), slip('b', 2026, 2, 10_002)]

    expect(averageNet(history, 12).amount).toEqual(money(10_002, ILS))
  })

  it('has no average with nothing to average', () => {
    expect(averageNet([], 12)).toEqual({ amount: undefined, sampleSize: 0, excluded: 0 })
    expect(averageNet([slip('a', 2026, 1, 100, true)], 12)).toEqual({
      amount: undefined,
      sampleSize: 0,
      excluded: 1,
    })
  })

  it('names the salary months with no slip, across a year boundary', () => {
    const history = [slip('a', 2025, 11, 100), slip('b', 2026, 1, 100)]

    expect(missingPeriods(history, { year: 2025, month: 11 }, { year: 2026, month: 2 })).toEqual([
      { year: 2025, month: 12 },
      { year: 2026, month: 2 },
    ])
    expect(missingPeriods(history, { year: 2026, month: 3 }, { year: 2026, month: 1 })).toEqual([])
  })
})

describe('grossToNetSteps', () => {
  /**
   * Walk the steps the way the chart draws them — start at gross, apply each
   * one — and report where that lands. This is the acceptance criterion in
   * arithmetic: it has to be the net.
   */
  function walk(steps: readonly WaterfallStep[]): number {
    let running = steps[0]?.amount.minor ?? 0
    for (const step of steps) {
      if (step.kind === 'DEDUCTION') running -= step.amount.minor
      if (step.kind === 'UNEXPLAINED') {
        running += step.isAddBack ? step.amount.minor : -step.amount.minor
      }
    }
    return running
  }

  it('walks from gross to net, one step per net-reducing line', () => {
    const steps = grossToNetSteps(realisticSlip(), TYPES)

    expect(steps.map((step) => step.kind)).toEqual([
      'GROSS',
      'DEDUCTION',
      'DEDUCTION',
      'DEDUCTION',
      'DEDUCTION',
      'DEDUCTION',
      'DEDUCTION',
      'NET',
    ])
    expect(steps[1]).toMatchObject({
      deductionTypeId: 'ded:income-tax',
      amount: money(341_250, ILS),
      runningTotal: money(2_158_750, ILS),
    })
  })

  it('ends on the net, exactly — F04’s acceptance criterion', () => {
    const steps = grossToNetSteps(realisticSlip(), TYPES)

    expect(steps.at(-1)?.kind).toBe('NET')
    expect(steps.at(-1)?.runningTotal).toEqual(money(1_753_300, ILS))
    expect(walk(steps)).toBe(1_753_300)
  })

  it('leaves the employer side and the notional benefits out', () => {
    const slip = realisticSlip()
    const withCar = { ...slip, lines: [...slip.lines, line('ded:company-car', 120_000)] }

    // Severance is employer-only and the car is notional: neither is a step.
    const ids = grossToNetSteps(withCar, TYPES).map((step) => step.deductionTypeId)
    expect(ids).not.toContain('ded:severance')
    expect(ids).not.toContain('ded:company-car')
  })

  it('shows what is not itemized as its own step rather than not adding up', () => {
    const slip = realisticSlip()
    const short = { ...slip, lines: slip.lines.filter((l) => l.deductionTypeId !== 'ded:union-dues') }

    const steps = grossToNetSteps(short, TYPES)
    const unexplained = steps.find((step) => step.kind === 'UNEXPLAINED')

    expect(unexplained).toMatchObject({ amount: money(8_250, ILS), isAddBack: false })
    expect(steps.at(-1)?.runningTotal).toEqual(money(1_753_300, ILS))
    expect(walk(steps)).toBe(1_753_300)
  })

  it('closes the arithmetic the other way when more is itemized than fits', () => {
    const slip = realisticSlip()
    const over = { ...slip, lines: [...slip.lines, line('ded:other', 10_000)] }

    const steps = grossToNetSteps(over, TYPES)
    const unexplained = steps.find((step) => step.kind === 'UNEXPLAINED')

    expect(unexplained).toMatchObject({ amount: money(10_000, ILS), isAddBack: true })
    expect(steps.at(-1)?.runningTotal).toEqual(money(1_753_300, ILS))
    expect(walk(steps)).toBe(1_753_300)
  })

  it('drops steps that would drop nothing', () => {
    const slip = realisticSlip()
    const withEmpty = { ...slip, lines: [...slip.lines, line('ded:other', 0)] }

    expect(grossToNetSteps(withEmpty, TYPES).filter((step) => step.kind === 'DEDUCTION')).toHaveLength(6)
  })

  it('is two steps for a slip with nothing itemized at all', () => {
    const bare: PaycheckWithLines = { paycheck: paycheck(), lines: [] }
    const steps = grossToNetSteps(bare, TYPES)

    expect(steps.map((step) => step.kind)).toEqual(['GROSS', 'UNEXPLAINED', 'NET'])
    expect(steps.at(-1)?.runningTotal).toEqual(money(1_753_300, ILS))
  })
})

describe('netTrend', () => {
  function slip(id: string, year: number, month: number, netMinor: number): Paycheck {
    return paycheck({ id, period: { year, month }, net: money(netMinor, ILS) })
  }

  it('is one point per month of the window, newest last', () => {
    const points = netTrend(
      [slip('a', 2026, 4, 1_700_000), slip('b', 2026, 6, 1_750_000)],
      3,
      { year: 2026, month: 6 },
    )

    expect(points.map((point) => point.period)).toEqual([
      { year: 2026, month: 4 },
      { year: 2026, month: 5 },
      { year: 2026, month: 6 },
    ])
    expect(points.at(-1)?.net).toEqual(money(1_750_000, ILS))
  })

  it('starts at the first slip rather than at an empty edge of the window', () => {
    const points = netTrend([slip('a', 2026, 6, 1_750_000)], 12, { year: 2026, month: 6 })

    // One paycheck is one point, not one point and eleven months of blank chart.
    expect(points).toHaveLength(1)
    expect(points[0]?.period).toEqual({ year: 2026, month: 6 })
  })

  it('leaves a month with no slip empty rather than joining across it', () => {
    const points = netTrend(
      [slip('a', 2026, 4, 1_700_000), slip('c', 2026, 6, 1_800_000)],
      3,
      { year: 2026, month: 6 },
    )

    expect(points.map((point) => point.net?.minor)).toEqual([1_700_000, undefined, 1_800_000])
  })

  it('sums two slips in one month, which is what a second job looks like', () => {
    const points = netTrend(
      [slip('a', 2026, 6, 1_200_000), slip('b', 2026, 6, 600_000)],
      1,
      { year: 2026, month: 6 },
    )

    expect(points[0]?.net).toEqual(money(1_800_000, ILS))
  })

  it('crosses a year boundary and survives an empty document', () => {
    const points = netTrend([slip('a', 2025, 12, 100)], 2, { year: 2026, month: 1 })

    expect(points.map((point) => point.period)).toEqual([
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
    ])
    expect(netTrend([], 3, { year: 2026, month: 6 }).every((point) => point.net === undefined)).toBe(
      true,
    )
    expect(netTrend([], 0, { year: 2026, month: 6 })).toEqual([])
  })
})

describe('yearToDate', () => {
  it('sums by salary month, not by the date the money landed', () => {
    const december: PaycheckWithLines = {
      paycheck: paycheck({
        id: 'pay-dec',
        period: { year: 2025, month: 12 },
        // Paid in January, and still December's.
        paymentDate: localDate(2026, 1, 9),
      }),
      lines: realisticSlip().lines,
    }
    const june = realisticSlip()

    const ytd = yearToDate([december, june], 2026, TYPES, ILS)

    expect(ytd.paychecks).toBe(1)
    expect(ytd.gross).toEqual(money(2_500_000, ILS))
    expect(ytd.net).toEqual(money(1_753_300, ILS))
    expect(ytd.tax).toEqual(money(525_950, ILS))
    expect(ytd.savings).toEqual(money(770_833, ILS))
    expect(ytd.totalCompensation).toEqual(money(3_058_333, ILS))
  })

  it('is zero rather than absent for a year with no slips', () => {
    expect(yearToDate([], 2019, TYPES, ILS)).toEqual({
      gross: money(0, ILS),
      net: money(0, ILS),
      tax: money(0, ILS),
      savings: money(0, ILS),
      totalCompensation: money(0, ILS),
      paychecks: 0,
    })
  })
})

/**
 * D-170's finding, as the sentence a screen can say: a pension line with no
 * fund behind it makes every fund surface downstream report a missing document
 * rather than a missing link.
 */
describe('unlinkedSavingTypes', () => {
  const linked = (one: DeductionType, to: string): DeductionType => ({
    ...one,
    linkedFundId: to,
  })

  it('names the saving lines on a slip that pay into nothing', () => {
    const found = unlinkedSavingTypes(TYPES, [realisticSlip()])
    expect(found.map((one) => one.id)).toEqual(['ded:pension', 'ded:study-fund', 'ded:severance'])
  })

  it('says nothing about a type nobody is contributing to', () => {
    // The vocabulary ships with more types than any employer uses, and a
    // permanent notice about a study fund that is on no slip is furniture.
    const slip: PaycheckWithLines = {
      paycheck: paycheck(),
      lines: [line('ded:income-tax', 341_250), line('ded:pension', 150_000, 162_500)],
    }
    expect(unlinkedSavingTypes(TYPES, [slip]).map((one) => one.id)).toEqual(['ded:pension'])
  })

  it('counts a type that pays into anything at all as answered', () => {
    const types = TYPES.map((one) =>
      one.id === 'ded:pension'
        ? linked(one, 'fund-1')
        : one.id === 'ded:study-fund'
          ? { ...one, linkedSavingGoalId: 'goal-1' }
          : one.id === 'ded:severance'
            ? { ...one, linkedDebtId: 'debt-1' }
            : one,
    )
    expect(unlinkedSavingTypes(types, [realisticSlip()])).toEqual([])
  })

  it('ignores a line that is not saving, however unlinked', () => {
    // Income tax pays into nothing by nature, and offering to link it is what
    // D-085 keeps off the screen in the first place.
    const found = unlinkedSavingTypes(TYPES, [realisticSlip()])
    expect(found.map((one) => one.id)).not.toContain('ded:income-tax')
  })
})
