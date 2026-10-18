import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate, toYearMonthString, type LocalDate, type YearMonth } from '@/core/time.ts'
import { DEFAULT_FEE_REFERENCES } from '@/data/reference/fundFeeReference.ts'
import type { FundAccount, FundBalanceSnapshot, FundDeposit } from '@/domain/model/funds.ts'
import type {
  DeductionType,
  Paycheck,
  PaycheckLine,
  PaycheckWithLines,
} from '@/domain/model/paycheck.ts'
import {
  annualFeeCost,
  componentSplit,
  contributionsBetween,
  depositKey,
  depositPeriods,
  depositsByMonth,
  distinctDeposits,
  effectiveFee,
  expectedContributions,
  feeAgreementStatus,
  feeBenchmark,
  feeDiffersMaterially,
  feeDragIllustration,
  fundDepositTotal,
  fundReturns,
  longTermSavings,
  periodReturn,
  recentContributionRate,
  reconcileDeposits,
  snapshotFreshness,
  studyFundLiquidity,
  validateSnapshot,
} from './funds.ts'

const ILS = 'ILS'

const ils = (minor: number) => money(minor, ILS)

const FUND_ID = 'fund-1'

function fund(overrides?: Partial<FundAccount>): FundAccount {
  return {
    id: FUND_ID,
    name: 'Menora pension',
    fundType: 'PENSION',
    institutionId: undefined,
    policyNumber: undefined,
    investmentTrack: undefined,
    status: 'ACTIVE',
    employerName: 'Acme',
    openedDate: undefined,
    firstDepositDate: undefined,
    fees: { onAccumulationBasisPoints: 22, onDepositBasisPoints: 149 },
    feeNegotiatedUntil: undefined,
    beneficiaries: undefined,
    notes: undefined,
    isArchived: false,
    ...overrides,
  }
}

let nextSnapshot = 0

function snapshot(
  asOfDate: LocalDate,
  totalBalance: number,
  overrides?: Partial<FundBalanceSnapshot>,
): FundBalanceSnapshot {
  nextSnapshot += 1
  return {
    id: `snap-${nextSnapshot}`,
    fundAccountId: FUND_ID,
    asOfDate,
    totalBalance: ils(totalBalance),
    employeeComponent: undefined,
    employerComponent: undefined,
    severanceComponent: undefined,
    depositsSincePrevious: undefined,
    feesChargedSincePrevious: undefined,
    returnSincePrevious: undefined,
    depositGapAcknowledged: false,
    note: undefined,
    ...overrides,
  }
}

function deductionType(overrides?: Partial<DeductionType>): DeductionType {
  return {
    id: 'type-pension',
    name: 'Pension',
    hebrewName: 'פנסיה',
    kind: 'PENSION',
    reducesNet: true,
    countsAsSaving: true,
    linkedSavingGoalId: undefined,
    linkedDebtId: undefined,
    linkedFundId: FUND_ID,
    isBuiltIn: true,
    sortOrder: 40,
    ...overrides,
  }
}

const PENSION_TYPE = deductionType()
const SEVERANCE_TYPE = deductionType({
  id: 'type-severance',
  name: 'Severance',
  kind: 'SEVERANCE',
  reducesNet: false,
  sortOrder: 60,
})
const TAX_TYPE = deductionType({
  id: 'type-tax',
  name: 'Income tax',
  kind: 'TAX',
  countsAsSaving: false,
  linkedFundId: undefined,
  sortOrder: 10,
})

const TYPES = [PENSION_TYPE, SEVERANCE_TYPE, TAX_TYPE]

function line(
  deductionTypeId: string,
  employeeMinor: number,
  employerMinor?: number,
): PaycheckLine {
  return {
    id: `line-${deductionTypeId}-${employeeMinor}-${employerMinor ?? 'x'}`,
    paycheckId: 'ignored',
    deductionTypeId,
    employeeAmount: ils(employeeMinor),
    employerAmount: employerMinor === undefined ? undefined : ils(employerMinor),
    basisAmount: undefined,
    note: undefined,
    sortOrder: 0,
  }
}

function paycheck(period: YearMonth, lines: readonly PaycheckLine[]): PaycheckWithLines {
  const slip: Paycheck = {
    id: `pay-${period.year}-${period.month}`,
    period,
    paymentDate: localDate(period.year, period.month, 28),
    employerName: 'Acme',
    gross: ils(2_000_000),
    net: ils(1_500_000),
    depositedToAccountId: undefined,
    note: undefined,
    sourceKind: 'MANUAL',
    attachmentRef: undefined,
    isIrregular: false,
  }
  return { paycheck: slip, lines }
}

/** The ordinary month: ₪500 employee, ₪750 employer, ₪833.33 severance. */
function ordinaryMonth(period: YearMonth): PaycheckWithLines {
  return paycheck(period, [
    line(TAX_TYPE.id, 300_000),
    line(PENSION_TYPE.id, 50_000, 75_000),
    line(SEVERANCE_TYPE.id, 0, 83_333),
  ])
}

function year(months: number, from = 1): readonly PaycheckWithLines[] {
  return Array.from({ length: months }, (_, index) =>
    ordinaryMonth({ year: 2026, month: from + index }),
  )
}

describe('expectedContributions', () => {
  it('reproduces a hand computation over a year of payslips', () => {
    const contributions = expectedContributions(year(12), TYPES)
    const total = contributionsBetween(
      contributions,
      { year: 2026, month: 1 },
      { year: 2026, month: 12 },
      ILS,
    )

    expect(total.employee).toEqual(ils(12 * 50_000))
    expect(total.employer).toEqual(ils(12 * 75_000))
    expect(total.severance).toEqual(ils(12 * 83_333))
    expect(total.total).toEqual(ils(12 * (50_000 + 75_000 + 83_333)))
    expect(total.paycheckCount).toBe(12)
    expect(total.periodCount).toBe(12)
  })

  it('merges the lines of one payslip into one contribution per fund', () => {
    const contributions = expectedContributions(year(1), TYPES)
    expect(contributions).toHaveLength(1)
    expect(contributions[0]?.fundAccountId).toBe(FUND_ID)
    expect(contributions[0]?.period).toEqual({ year: 2026, month: 1 })
  })

  it('keeps severance out of the employer share', () => {
    const [contribution] = expectedContributions(year(1), TYPES)
    expect(contribution?.employer).toEqual(ils(75_000))
    expect(contribution?.severance).toEqual(ils(83_333))
  })

  it('ignores lines whose type names no fund', () => {
    const entries = [paycheck({ year: 2026, month: 3 }, [line(TAX_TYPE.id, 300_000)])]
    expect(expectedContributions(entries, TYPES)).toEqual([])
  })

  it('keeps two payslips in one month apart', () => {
    const first = ordinaryMonth({ year: 2026, month: 5 })
    const second: PaycheckWithLines = {
      paycheck: { ...first.paycheck, id: 'pay-second-job' },
      lines: first.lines,
    }

    const contributions = expectedContributions([first, second], TYPES)
    expect(contributions).toHaveLength(2)

    const total = contributionsBetween(
      contributions,
      { year: 2026, month: 5 },
      { year: 2026, month: 5 },
      ILS,
    )
    expect(total.paycheckCount).toBe(2)
    expect(total.periodCount).toBe(1)
    expect(total.employee).toEqual(ils(100_000))
  })

  it('sends nothing to a fund when the link is removed', () => {
    const unlinked = TYPES.map((type) => ({ ...type, linkedFundId: undefined }))
    expect(expectedContributions(year(12), unlinked)).toEqual([])
  })
})

describe('recentContributionRate', () => {
  const monthly = 50_000 + 75_000 + 83_333

  it('is the year itself when there is a year of it', () => {
    const rate = recentContributionRate(expectedContributions(year(12), TYPES), ILS)
    expect(rate?.annual).toEqual(ils(12 * monthly))
    expect(rate?.monthsCounted).toBe(12)
    expect(rate?.from).toEqual({ year: 2026, month: 1 })
    expect(rate?.to).toEqual({ year: 2026, month: 12 })
  })

  /**
   * Three months scale to a year rather than being read as a year of three
   * months' worth. The denominator is the months with a payslip, so a month the
   * app was never shown does not halve someone's pension.
   */
  it('annualizes a partial history by the months it actually has', () => {
    const rate = recentContributionRate(expectedContributions(year(3), TYPES), ILS)
    expect(rate?.annual).toEqual(ils(12 * monthly))
    expect(rate?.monthsCounted).toBe(3)
  })

  it('looks back a year and no further', () => {
    // Fourteen months, January 2026 to February 2027: the first two fall out.
    const fourteen = [
      ...year(12),
      ordinaryMonth({ year: 2027, month: 1 }),
      ordinaryMonth({ year: 2027, month: 2 }),
    ]
    const rate = recentContributionRate(expectedContributions(fourteen, TYPES), ILS)
    expect(rate?.annual).toEqual(ils(12 * monthly))
    expect(rate?.monthsCounted).toBe(12)
    expect(rate?.from).toEqual({ year: 2026, month: 3 })
    expect(rate?.to).toEqual({ year: 2027, month: 2 })
  })

  it('has no rate at all with no payslips, rather than a rate of zero', () => {
    expect(recentContributionRate([], ILS)).toBeUndefined()
  })
})

describe('reconcileDeposits', () => {
  const contributions = expectedContributions(year(6), TYPES)
  /** Six ordinary months, as the fund would report them. */
  const sixMonths = 6 * (50_000 + 75_000 + 83_333)

  it('says so rather than showing a zero when there is one snapshot', () => {
    const result = reconcileDeposits({
      status: 'ACTIVE',
      snapshots: [snapshot(localDate(2026, 1, 31), 10_000_000)],
      contributions,
      currency: ILS,
    })
    expect(result.kind).toBe('NEEDS_TWO_POINTS')
  })

  it('raises no alarm on a normal one-month employer lag', () => {
    // Balances at 31 Jan and 31 Jul bracket the deposit months Feb–Jul, which
    // at a one-month lag are the January–June salary months — exactly the six
    // payslips that exist.
    const result = reconcileDeposits({
      status: 'ACTIVE',
      snapshots: [
        snapshot(localDate(2026, 1, 31), 10_000_000),
        snapshot(localDate(2026, 7, 31), 11_500_000, {
          depositsSincePrevious: ils(sixMonths),
        }),
      ],
      contributions,
      currency: ILS,
    })

    expect(result.kind).toBe('CHECKED')
    if (result.kind !== 'CHECKED') return
    expect(result.status).toBe('WITHIN_TOLERANCE')
    expect(result.gap).toEqual(ils(0))
    expect(result.window.depositFrom).toEqual({ year: 2026, month: 2 })
    expect(result.window.depositTo).toEqual({ year: 2026, month: 7 })
    expect(result.window.salaryFrom).toEqual({ year: 2026, month: 1 })
    expect(result.window.salaryTo).toEqual({ year: 2026, month: 6 })
  })

  it('is the lag that does it — the same figures disagree without one', () => {
    const withoutLag = reconcileDeposits({
      status: 'ACTIVE',
      snapshots: [
        snapshot(localDate(2026, 1, 31), 10_000_000),
        snapshot(localDate(2026, 7, 31), 11_500_000, {
          depositsSincePrevious: ils(sixMonths),
        }),
      ],
      contributions,
      currency: ILS,
      lagMonths: 0,
    })

    expect(withoutLag.kind).toBe('CHECKED')
    if (withoutLag.kind !== 'CHECKED') return
    // February–July covers only five of the six payslips, so the fund looks to
    // have received more than the slips can account for.
    expect(withoutLag.status).toBe('DEPOSITS_EXCEED_PAYSLIPS')
    expect(withoutLag.expected.paycheckCount).toBe(5)
  })

  it('names a real shortfall and states which way it points', () => {
    const result = reconcileDeposits({
      status: 'ACTIVE',
      snapshots: [
        snapshot(localDate(2026, 1, 31), 10_000_000),
        snapshot(localDate(2026, 7, 31), 11_300_000, {
          depositsSincePrevious: ils(sixMonths - 230_000),
        }),
      ],
      contributions,
      currency: ILS,
    })

    expect(result.kind).toBe('CHECKED')
    if (result.kind !== 'CHECKED') return
    expect(result.status).toBe('DEPOSITS_MISSING')
    expect(result.gap).toEqual(ils(230_000))
    expect(result.expected.total).toEqual(ils(sixMonths))
    expect(result.reported).toEqual(ils(sixMonths - 230_000))
  })

  it('lets a small difference pass as the rounding it is', () => {
    const result = reconcileDeposits({
      status: 'ACTIVE',
      snapshots: [
        snapshot(localDate(2026, 1, 31), 10_000_000),
        snapshot(localDate(2026, 7, 31), 11_500_000, {
          depositsSincePrevious: ils(sixMonths - 900),
        }),
      ],
      contributions,
      currency: ILS,
    })

    expect(result.kind === 'CHECKED' && result.status).toBe('WITHIN_TOLERANCE')
  })

  it('stops reporting a gap the user has chased down', () => {
    const closing = snapshot(localDate(2026, 7, 31), 11_300_000, {
      depositsSincePrevious: ils(sixMonths - 230_000),
      depositGapAcknowledged: true,
    })

    const result = reconcileDeposits({
      status: 'ACTIVE',
      snapshots: [snapshot(localDate(2026, 1, 31), 10_000_000), closing],
      contributions,
      currency: ILS,
    })

    expect(result.kind).toBe('CHECKED')
    if (result.kind !== 'CHECKED') return
    // The figures are unchanged; only the verdict is.
    expect(result.status).toBe('ACKNOWLEDGED')
    expect(result.gap).toEqual(ils(230_000))
  })

  it('sums a run of reports rather than comparing the last one alone', () => {
    const perQuarter = 3 * (50_000 + 75_000 + 83_333)
    const result = reconcileDeposits({
      status: 'ACTIVE',
      snapshots: [
        snapshot(localDate(2026, 1, 31), 10_000_000),
        snapshot(localDate(2026, 4, 30), 10_700_000, {
          depositsSincePrevious: ils(perQuarter),
        }),
        snapshot(localDate(2026, 7, 31), 11_500_000, {
          depositsSincePrevious: ils(perQuarter),
        }),
      ],
      contributions,
      currency: ILS,
    })

    expect(result.kind).toBe('CHECKED')
    if (result.kind !== 'CHECKED') return
    expect(result.window.snapshotCount).toBe(2)
    expect(result.reported).toEqual(ils(sixMonths))
    expect(result.status).toBe('WITHIN_TOLERANCE')
  })

  it('reads only the trailing run when an older report omitted its deposits', () => {
    const perQuarter = 3 * (50_000 + 75_000 + 83_333)
    const result = reconcileDeposits({
      status: 'ACTIVE',
      snapshots: [
        snapshot(localDate(2026, 1, 31), 10_000_000),
        snapshot(localDate(2026, 4, 30), 10_700_000),
        snapshot(localDate(2026, 7, 31), 11_500_000, {
          depositsSincePrevious: ils(perQuarter),
        }),
      ],
      contributions,
      currency: ILS,
    })

    expect(result.kind).toBe('CHECKED')
    if (result.kind !== 'CHECKED') return
    expect(result.window.from).toEqual(localDate(2026, 4, 30))
    expect(result.window.salaryFrom).toEqual({ year: 2026, month: 4 })
    expect(result.reported).toEqual(ils(perQuarter))
  })

  it('says the fund reported nothing rather than inventing a zero', () => {
    const result = reconcileDeposits({
      status: 'ACTIVE',
      snapshots: [
        snapshot(localDate(2026, 1, 31), 10_000_000),
        snapshot(localDate(2026, 7, 31), 11_500_000),
      ],
      contributions,
      currency: ILS,
    })
    expect(result.kind).toBe('NO_FUND_REPORT')
  })

  it('refuses to annualize two readings from the same month', () => {
    const result = reconcileDeposits({
      status: 'ACTIVE',
      snapshots: [
        snapshot(localDate(2026, 7, 1), 10_000_000),
        snapshot(localDate(2026, 7, 31), 10_100_000, { depositsSincePrevious: ils(100_000) }),
      ],
      contributions,
      currency: ILS,
    })
    expect(result.kind).toBe('WINDOW_TOO_SHORT')
  })

  it('admits it has no payslips rather than reporting the whole deposit as a surplus', () => {
    const result = reconcileDeposits({
      status: 'ACTIVE',
      snapshots: [
        snapshot(localDate(2026, 1, 31), 10_000_000),
        snapshot(localDate(2026, 7, 31), 11_500_000, { depositsSincePrevious: ils(sixMonths) }),
      ],
      contributions: [],
      currency: ILS,
    })
    expect(result.kind).toBe('NO_PAYSLIP_DATA')
  })

  it('reconciles a dormant fund that takes nothing and receives nothing', () => {
    const result = reconcileDeposits({
      status: 'DORMANT',
      snapshots: [
        snapshot(localDate(2026, 1, 31), 4_000_000),
        snapshot(localDate(2026, 7, 31), 4_050_000, { depositsSincePrevious: ils(0) }),
      ],
      contributions: [],
      currency: ILS,
    })

    expect(result.kind).toBe('CHECKED')
    if (result.kind !== 'CHECKED') return
    expect(result.status).toBe('WITHIN_TOLERANCE')
    expect(result.expected.paycheckCount).toBe(0)
  })
})

/**
 * One row of a report's deposit table, as it is stored (D-153).
 *
 * The split is the ordinary month's: ₪500 employee, ₪750 employer, ₪833.33
 * severance, which is ₪2,083.33 and is exactly what `ordinaryMonth` promises —
 * so a fund whose reports list every month reconciles to nothing.
 */
function deposit(
  period: YearMonth,
  arrivedOn: LocalDate,
  overrides?: Partial<FundDeposit>,
): FundDeposit {
  return {
    id: `dep-${toYearMonthString(period)}`,
    fundAccountId: FUND_ID,
    snapshotId: 'snap-1',
    employerName: 'מעבדות תוכנה',
    depositDate: arrivedOn,
    salaryMonth: period,
    employee: ils(50_000),
    employer: ils(75_000),
    severance: ils(83_333),
    total: undefined,
    salary: undefined,
    note: undefined,
    ...overrides,
  }
}

describe('distinctDeposits', () => {
  it('counts a deposit two overlapping reports both list exactly once', () => {
    // An Israeli quarterly is year-to-date, so Q2's table restates Q1's rows
    // (D-152). Each reading transcribes its own document faithfully; the
    // duplication is resolved here.
    const fromQ1 = deposit({ year: 2026, month: 1 }, localDate(2026, 2, 4))
    const fromQ2 = { ...fromQ1, id: 'other', snapshotId: 'snap-2' }

    expect(distinctDeposits([fromQ1, fromQ2])).toHaveLength(1)
    // The first statement of it is what is kept — the report closest in time.
    expect(distinctDeposits([fromQ1, fromQ2])[0]?.snapshotId).toBe('snap-1')
  })

  it('keeps a correction paid in the same month, because it is a second deposit', () => {
    const first = deposit({ year: 2026, month: 1 }, localDate(2026, 2, 4))
    const correction = {
      ...first,
      id: 'dep-correction',
      depositDate: localDate(2026, 3, 9),
      employee: ils(10_000),
    }

    expect(distinctDeposits([first, correction])).toHaveLength(2)
    expect(depositKey(first)).not.toBe(depositKey(correction))
  })
})

describe('fundDepositTotal', () => {
  it('prefers a row that printed its own total over adding the parts up', () => {
    const row = deposit({ year: 2026, month: 1 }, localDate(2026, 2, 4), { total: ils(200_000) })
    expect(fundDepositTotal(row).minor).toBe(200_000)
  })

  it('adds the parts up when the table printed no total', () => {
    expect(fundDepositTotal(deposit({ year: 2026, month: 1 }, localDate(2026, 2, 4))).minor).toBe(
      208_333,
    )
  })
})

/**
 * The payoff of transcribing the table, and the reason it needed a table of its
 * own (D-153): every row names the salary month it is **for**, so the lag stops
 * being a parameter and becomes something measured.
 */
describe('depositsByMonth', () => {
  const contributions = expectedContributions(year(3), TYPES)

  it('matches each salary month against the deposit that names it', () => {
    const months = depositsByMonth({
      deposits: [
        deposit({ year: 2026, month: 1 }, localDate(2026, 2, 4)),
        deposit({ year: 2026, month: 2 }, localDate(2026, 3, 4)),
        deposit({ year: 2026, month: 3 }, localDate(2026, 4, 4)),
      ],
      contributions,
      currency: ILS,
    })

    expect(months).toHaveLength(3)
    expect(months.every((month) => month.status === 'MATCHED')).toBe(true)
    expect(months.every((month) => month.gap?.minor === 0)).toBe(true)
    // One month between the salary month and the money arriving: on time.
    expect(months.map((month) => month.lagMonths)).toEqual([1, 1, 1])
  })

  /**
   * The backfill case, and the one thing D-164's unit was told to watch.
   *
   * Four quarterlies, each year-to-date, so Q4's table restates Q1's, Q2's and
   * Q3's — three months stated four times, three more stated three times, and
   * so on. Without the dedupe every month reads `EXCEEDS` by a multiple, which
   * is the shape of an employer overpaying: exactly the false alarm this
   * feature exists not to raise.
   */
  it('does not count a month twice when four year-to-date reports all state it', () => {
    const rows: FundDeposit[] = []
    for (const through of [3, 6, 9, 12]) {
      for (let month = 1; month <= Math.min(through, 3); month += 1) {
        rows.push(
          deposit({ year: 2026, month }, localDate(2026, month + 1, 4), {
            id: `q${through}-${month}`,
            snapshotId: `snap-q${through}`,
          }),
        )
      }
    }

    // Twelve rows stated, because that is what the four documents say.
    expect(rows).toHaveLength(12)

    const months = depositsByMonth({ deposits: rows, contributions, currency: ILS })

    expect(months).toHaveLength(3)
    expect(months.every((month) => month.status === 'MATCHED')).toBe(true)
    expect(months.every((month) => month.gap?.minor === 0)).toBe(true)
  })

  it('measures how late a deposit was rather than assuming a lag', () => {
    // February's contribution turns up in June. A cumulative window over the
    // quarter comes out right and says nothing; this says which month and by
    // how much.
    const months = depositsByMonth({
      deposits: [
        deposit({ year: 2026, month: 1 }, localDate(2026, 2, 4)),
        deposit({ year: 2026, month: 2 }, localDate(2026, 6, 4)),
        deposit({ year: 2026, month: 3 }, localDate(2026, 4, 4)),
      ],
      contributions,
      currency: ILS,
    })

    expect(months[1]?.lagMonths).toBe(4)
    expect(months[1]?.status).toBe('MATCHED')
  })

  it('names a month the payslips expected and no deposit covers', () => {
    const months = depositsByMonth({
      deposits: [
        deposit({ year: 2026, month: 1 }, localDate(2026, 2, 4)),
        deposit({ year: 2026, month: 3 }, localDate(2026, 4, 4)),
      ],
      contributions,
      currency: ILS,
    })

    const february = months.find((month) => month.period.month === 2)
    expect(february?.status).toBe('NOT_REPORTED')
    // **Not a gap of the whole month**: nothing was reported, which is a
    // different sentence from "₪2,083.33 is missing" and is why the union has
    // five members rather than a number and a boolean.
    expect(february?.gap).toBeUndefined()
    expect(february?.received).toBeUndefined()
  })

  it('names a deposit the app has no payslip for', () => {
    const months = depositsByMonth({
      deposits: [deposit({ year: 2025, month: 12 }, localDate(2026, 1, 4))],
      contributions,
      currency: ILS,
    })

    const december = months.find((month) => month.period.year === 2025)
    expect(december?.status).toBe('NO_PAYSLIP')
    expect(december?.expected).toBeUndefined()
  })

  it('reports a short deposit as money missing, within a tolerance', () => {
    const months = depositsByMonth({
      deposits: [
        deposit({ year: 2026, month: 1 }, localDate(2026, 2, 4), { employer: ils(70_000) }),
      ],
      contributions,
      currency: ILS,
    })

    const january = months.find((month) => month.period.month === 1)
    expect(january?.status).toBe('MISSING')
    // Positive means money is missing, as everywhere else in this file.
    expect(january?.gap?.minor).toBe(5_000)
  })

  it('leaves a deposit with no readable month out of every month and says nothing else', () => {
    const months = depositsByMonth({
      deposits: [
        deposit({ year: 2026, month: 1 }, localDate(2026, 2, 4), { salaryMonth: undefined }),
      ],
      contributions,
      currency: ILS,
    })

    // Three months from the payslips, and none of them claims the orphan.
    expect(months).toHaveLength(3)
    expect(months.every((month) => month.received === undefined)).toBe(true)
  })
})

describe('depositPeriods', () => {
  const contributions = expectedContributions(year(6), TYPES)
  const perQuarter = 3 * (50_000 + 75_000 + 83_333)

  it('shows the working behind the headline, one row per window', () => {
    const periods = depositPeriods({
      status: 'ACTIVE',
      snapshots: [
        snapshot(localDate(2026, 1, 31), 10_000_000),
        snapshot(localDate(2026, 4, 30), 10_700_000, { depositsSincePrevious: ils(perQuarter) }),
        snapshot(localDate(2026, 7, 31), 11_500_000, { depositsSincePrevious: ils(perQuarter) }),
      ],
      contributions,
      currency: ILS,
    })

    expect(periods).toHaveLength(2)
    expect(periods[0]?.salaryFrom).toEqual({ year: 2026, month: 1 })
    expect(periods[0]?.salaryTo).toEqual({ year: 2026, month: 3 })
    expect(periods[0]?.expected?.total).toEqual(ils(perQuarter))
    expect(periods[0]?.gap).toEqual(ils(0))
    expect(periods[1]?.salaryFrom).toEqual({ year: 2026, month: 4 })
  })

  it('adds up to what the cumulative check reports', () => {
    // The two are one arithmetic seen two ways, and a table that did not sum to
    // the sentence above it would be the worse kind of wrong.
    const snapshots = [
      snapshot(localDate(2026, 1, 31), 10_000_000),
      snapshot(localDate(2026, 4, 30), 10_700_000, { depositsSincePrevious: ils(perQuarter) }),
      snapshot(localDate(2026, 7, 31), 11_400_000, {
        depositsSincePrevious: ils(perQuarter - 120_000),
      }),
    ]
    const input = { status: 'ACTIVE' as const, snapshots, contributions, currency: ILS }

    const rows = depositPeriods(input)
    const headline = reconcileDeposits(input)

    const summed = rows.reduce((total, row) => total + (row.gap?.minor ?? 0), 0)
    expect(headline.kind === 'CHECKED' && headline.gap.minor).toBe(summed)
    expect(summed).toBe(120_000)
  })

  it('leaves a row unjudged rather than guessing at it', () => {
    const periods = depositPeriods({
      status: 'ACTIVE',
      snapshots: [
        snapshot(localDate(2026, 1, 31), 10_000_000),
        snapshot(localDate(2026, 7, 31), 11_500_000),
      ],
      contributions,
      currency: ILS,
    })

    expect(periods[0]?.reported).toBeUndefined()
    expect(periods[0]?.gap).toBeUndefined()
    // The payslip side is still worth showing: it is what the fund *should*
    // have received, whether or not it said what it got.
    expect(periods[0]?.expected?.paycheckCount).toBe(6)
  })

  it('has nothing to show for a single reading', () => {
    expect(
      depositPeriods({
        status: 'ACTIVE',
        snapshots: [snapshot(localDate(2026, 1, 31), 10_000_000)],
        contributions,
        currency: ILS,
      }),
    ).toEqual([])
  })

  it('reports a window inside one month without a salary range to compare', () => {
    const periods = depositPeriods({
      status: 'ACTIVE',
      snapshots: [
        snapshot(localDate(2026, 7, 1), 10_000_000),
        snapshot(localDate(2026, 7, 31), 10_100_000, { depositsSincePrevious: ils(100_000) }),
      ],
      contributions,
      currency: ILS,
    })

    expect(periods[0]?.expected).toBeUndefined()
    expect(periods[0]?.salaryFrom).toBeUndefined()
    expect(periods[0]?.reported).toEqual(ils(100_000))
    expect(periods[0]?.gap).toBeUndefined()
  })
})

describe('periodReturn', () => {
  it('never reports a deposit as a gain', () => {
    const opening = snapshot(localDate(2026, 1, 31), 10_000_000)
    const closing = snapshot(localDate(2026, 7, 31), 11_800_000, {
      depositsSincePrevious: ils(1_800_000),
    })

    const result = periodReturn(opening, closing, {
      kind: 'FUND_REPORTED',
      amount: ils(1_800_000),
    })

    expect(result.kind).toBe('APPROXIMATE')
    if (result.kind !== 'APPROXIMATE') return
    expect(result.gain).toEqual(ils(0))
    expect(result.basisPoints).toBe(0)
  })

  it('separates the gain from the contributions that were paid in', () => {
    const opening = snapshot(localDate(2026, 1, 31), 10_000_000)
    const closing = snapshot(localDate(2026, 7, 31), 12_000_000, {
      depositsSincePrevious: ils(1_800_000),
    })

    const result = periodReturn(opening, closing, {
      kind: 'FUND_REPORTED',
      amount: ils(1_800_000),
    })

    expect(result.kind === 'APPROXIMATE' && result.gain).toEqual(ils(200_000))
    // ₪2,000 against ₪100,000 plus half of ₪18,000 — 1.83%, not 2%.
    expect(result.kind === 'APPROXIMATE' && result.basisPoints).toBe(183)
  })

  it('hands out no figure at all when nobody knows what was paid in', () => {
    const result = periodReturn(
      snapshot(localDate(2026, 1, 31), 10_000_000),
      snapshot(localDate(2026, 7, 31), 11_800_000),
      { kind: 'UNKNOWN' },
    )

    // The variant carries the window and nothing else: there is no balance
    // change on it for a screen to print as a return.
    expect(result.kind).toBe('CONTRIBUTIONS_UNKNOWN')
    expect(Object.keys(result).sort()).toEqual(['from', 'kind', 'to'])
  })

  it('treats a dormant fund as taking nothing, which is a fact and not a guess', () => {
    const result = periodReturn(
      snapshot(localDate(2026, 1, 31), 4_000_000),
      snapshot(localDate(2026, 7, 31), 4_120_000),
      { kind: 'NONE_EXPECTED' },
    )

    expect(result.kind).toBe('APPROXIMATE')
    if (result.kind !== 'APPROXIMATE') return
    expect(result.contributions).toEqual(ils(0))
    expect(result.gain).toEqual(ils(120_000))
  })

  it('shows the gain the fees came out of, when the report states them', () => {
    const result = periodReturn(
      snapshot(localDate(2026, 1, 31), 10_000_000),
      snapshot(localDate(2026, 7, 31), 10_200_000, { feesChargedSincePrevious: ils(30_000) }),
      { kind: 'NONE_EXPECTED' },
    )

    expect(result.kind === 'APPROXIMATE' && result.gain).toEqual(ils(200_000))
    expect(result.kind === 'APPROXIMATE' && result.gainBeforeFees).toEqual(ils(230_000))
  })

  it('reports a losing period as the loss it was', () => {
    const result = periodReturn(
      snapshot(localDate(2026, 1, 31), 10_000_000),
      snapshot(localDate(2026, 7, 31), 9_400_000),
      { kind: 'NONE_EXPECTED' },
    )

    expect(result.kind === 'APPROXIMATE' && result.gain).toEqual(ils(-600_000))
    expect(result.kind === 'APPROXIMATE' && result.basisPoints).toBe(-600)
  })
})

describe('fundReturns', () => {
  it('needs two points before it says anything', () => {
    const result = fundReturns({
      status: 'ACTIVE',
      snapshots: [snapshot(localDate(2026, 1, 31), 10_000_000)],
      contributions: [],
      currency: ILS,
    })

    expect(result).toEqual({ kind: 'NEEDS_TWO_POINTS', snapshotCount: 1 })
  })

  it('falls back to the payslips, lag and all, when the fund states no deposits', () => {
    const result = fundReturns({
      status: 'ACTIVE',
      snapshots: [
        snapshot(localDate(2026, 1, 31), 10_000_000),
        snapshot(localDate(2026, 7, 31), 11_500_000),
      ],
      contributions: expectedContributions(year(6), TYPES),
      currency: ILS,
    })

    expect(result.kind).toBe('SERIES')
    if (result.kind !== 'SERIES') return
    const [period] = result.periods
    expect(period?.kind).toBe('APPROXIMATE')
    if (period?.kind !== 'APPROXIMATE') return
    expect(period.basis).toBe('PAYSLIP_DERIVED')
    expect(period.contributions).toEqual(ils(6 * (50_000 + 75_000 + 83_333)))
  })

  it('withholds the cumulative figure when one window is unknown', () => {
    const result = fundReturns({
      status: 'ACTIVE',
      snapshots: [
        snapshot(localDate(2026, 1, 31), 10_000_000),
        snapshot(localDate(2026, 4, 30), 10_700_000),
        snapshot(localDate(2026, 7, 31), 11_500_000, { depositsSincePrevious: ils(700_000) }),
      ],
      contributions: [],
      currency: ILS,
    })

    expect(result.kind).toBe('SERIES')
    if (result.kind !== 'SERIES') return
    expect(result.unknownPeriods).toBe(1)
    expect(result.cumulative).toBeUndefined()
  })

  it('adds up the windows when every one of them is known', () => {
    const result = fundReturns({
      status: 'DORMANT',
      snapshots: [
        snapshot(localDate(2026, 1, 31), 4_000_000),
        snapshot(localDate(2026, 4, 30), 4_100_000),
        snapshot(localDate(2026, 7, 31), 4_250_000),
      ],
      contributions: [],
      currency: ILS,
    })

    expect(result.kind).toBe('SERIES')
    if (result.kind !== 'SERIES') return
    expect(result.unknownPeriods).toBe(0)
    expect(result.cumulative?.gain).toEqual(ils(250_000))
    expect(result.cumulative?.basisPoints).toBe(625)
  })
})

describe('effectiveFee', () => {
  it('needs two points, and says so instead of reporting no fee', () => {
    expect(effectiveFee([snapshot(localDate(2026, 1, 31), 10_000_000)], 22)).toEqual({
      kind: 'NEEDS_TWO_POINTS',
      snapshotCount: 1,
    })
  })

  it('annualizes what was actually charged against the average balance', () => {
    const result = effectiveFee(
      [
        snapshot(localDate(2026, 1, 31), 10_000_000),
        snapshot(localDate(2027, 1, 31), 10_000_000, {
          feesChargedSincePrevious: ils(50_000),
        }),
      ],
      22,
    )

    expect(result.kind).toBe('MEASURED')
    if (result.kind !== 'MEASURED') return
    // ₪500 on ₪100,000 over twelve months is 0.5%.
    expect(result.annualBasisPoints).toBe(50)
    expect(result.months).toBe(12)
    expect(result.averageBalance).toEqual(ils(10_000_000))
    // The stated 0.22% is not what is being paid — the agreement lapsed.
    expect(result.differenceBasisPoints).toBe(28)
  })

  it('annualizes a half-year window rather than reading it as a year', () => {
    const result = effectiveFee(
      [
        snapshot(localDate(2026, 1, 31), 10_000_000),
        snapshot(localDate(2026, 7, 31), 10_000_000, {
          feesChargedSincePrevious: ils(25_000),
        }),
      ],
      undefined,
    )

    expect(result.kind === 'MEASURED' && result.annualBasisPoints).toBe(50)
    expect(result.kind === 'MEASURED' && result.differenceBasisPoints).toBeUndefined()
  })

  it('says the report omitted the fee rather than reporting zero', () => {
    const result = effectiveFee(
      [
        snapshot(localDate(2026, 1, 31), 10_000_000),
        snapshot(localDate(2026, 7, 31), 10_500_000),
      ],
      22,
    )
    expect(result.kind).toBe('NOT_REPORTED')
  })

  it('refuses a window shorter than a month', () => {
    const result = effectiveFee(
      [
        snapshot(localDate(2026, 7, 1), 10_000_000),
        snapshot(localDate(2026, 7, 31), 10_000_000, { feesChargedSincePrevious: ils(1_000) }),
      ],
      22,
    )
    expect(result.kind).toBe('WINDOW_TOO_SHORT')
  })
})

describe('feeDiffersMaterially', () => {
  const measured = (fees: number, opening: number, closing: number, stated: number) =>
    effectiveFee(
      [
        snapshot(localDate(2026, 3, 31), opening),
        snapshot(localDate(2026, 6, 30), closing, { feesChargedSincePrevious: ils(fees) }),
      ],
      stated,
    )

  it('stays quiet about the rounding of a quarterly figure', () => {
    // ₪130 on about ₪101,450 annualizes to 0.51% where the policy says 0.50%.
    // Calling that a discrepancy is the crying-wolf failure this whole feature
    // is built to avoid.
    const fee = measured(13_000, 9_980_000, 10_310_000, 50)
    expect(fee.kind === 'MEASURED' && fee.annualBasisPoints).toBe(51)
    expect(feeDiffersMaterially(fee)).toBe(false)
  })

  it('speaks up when an agreement has lapsed to a default fee', () => {
    // 1.05% charged against a stated 0.22% — the real case, and it moves the
    // figure by tenths of a percent rather than hundredths.
    const fee = measured(26_500, 10_000_000, 10_000_000, 22)
    expect(feeDiffersMaterially(fee)).toBe(true)
  })

  it('says nothing about a fee it could not measure', () => {
    expect(feeDiffersMaterially({ kind: 'NOT_REPORTED' })).toBe(false)
    expect(feeDiffersMaterially({ kind: 'NEEDS_TWO_POINTS', snapshotCount: 1 })).toBe(false)
  })

  it('never calls a fee lower than stated a discrepancy', () => {
    const fee = measured(1_000, 10_000_000, 10_000_000, 50)
    expect(feeDiffersMaterially(fee)).toBe(false)
  })
})

describe('feeBenchmark', () => {
  it('places a default fee above what is ordinarily negotiated', () => {
    const result = feeBenchmark(
      fund({ fees: { onAccumulationBasisPoints: 50, onDepositBasisPoints: 600 } }),
      DEFAULT_FEE_REFERENCES,
    )

    expect(result.onAccumulation?.standing).toBe('ABOVE_TYPICAL')
    expect(result.onDeposit?.standing).toBe('ABOVE_TYPICAL')
    expect(result.reference?.fundType).toBe('PENSION')
  })

  it('flags a fee above the ceiling, which is a transcription error or an old policy', () => {
    const result = feeBenchmark(
      fund({ fees: { onAccumulationBasisPoints: 105, onDepositBasisPoints: 600 } }),
      DEFAULT_FEE_REFERENCES,
    )
    expect(result.onAccumulation?.standing).toBe('ABOVE_CAP')
  })

  it('says nothing about a fee nobody entered', () => {
    const result = feeBenchmark(
      fund({ fees: { onAccumulationBasisPoints: undefined, onDepositBasisPoints: undefined } }),
      DEFAULT_FEE_REFERENCES,
    )
    expect(result.onAccumulation?.standing).toBe('NOT_STATED')
  })

  it('compares a study fund against the study-fund row', () => {
    const result = feeBenchmark(
      fund({
        fundType: 'STUDY_FUND',
        fees: { onAccumulationBasisPoints: 55, onDepositBasisPoints: 0 },
      }),
      DEFAULT_FEE_REFERENCES,
    )
    expect(result.onAccumulation?.standing).toBe('AT_OR_BELOW_TYPICAL')
    expect(result.onAccumulation?.capBasisPoints).toBe(105)
  })

  it('answers nothing at all when the references do not cover the type', () => {
    expect(feeBenchmark(fund(), []).reference).toBeUndefined()
  })
})

describe('annualFeeCost', () => {
  it('prices a forgotten fund', () => {
    expect(
      annualFeeCost(ils(4_000_000), { onAccumulationBasisPoints: 105, onDepositBasisPoints: 0 }),
    ).toEqual(ils(42_000))
  })

  it('will not guess a fee that was never entered', () => {
    expect(
      annualFeeCost(ils(4_000_000), {
        onAccumulationBasisPoints: undefined,
        onDepositBasisPoints: undefined,
      }),
    ).toBeUndefined()
  })
})

describe('feeDragIllustration', () => {
  const input = {
    openingBalance: ils(30_000_000),
    annualContribution: ils(3_600_000),
    years: 25,
    currentFees: { onAccumulationBasisPoints: 50, onDepositBasisPoints: 600 },
    targetFees: { onAccumulationBasisPoints: 20, onDepositBasisPoints: 150 },
  }

  it('answers as a range across return assumptions, never as one number', () => {
    const result = feeDragIllustration(input)
    expect(result.scenarios.map((scenario) => scenario.grossReturnBasisPoints)).toEqual([
      300, 500, 700,
    ])
  })

  it('hands back every assumption it used', () => {
    const result = feeDragIllustration(input)
    expect(result.years).toBe(25)
    expect(result.currentFees).toEqual(input.currentFees)
    expect(result.targetFees).toEqual(input.targetFees)
    expect(result.annualContribution).toEqual(ils(3_600_000))
  })

  it('makes the lower fee worth money, and more of it the longer it runs', () => {
    const result = feeDragIllustration(input)
    const shorter = feeDragIllustration({ ...input, years: 10 })

    for (const scenario of result.scenarios) {
      expect(scenario.difference.minor).toBeGreaterThan(0)
      expect(scenario.atTargetFees.minor).toBeGreaterThan(scenario.atCurrentFees.minor)
    }
    expect(result.scenarios[1]?.difference.minor).toBeGreaterThan(
      shorter.scenarios[1]?.difference.minor ?? 0,
    )
  })

  it('changes visibly when the assumption changes', () => {
    const result = feeDragIllustration({ ...input, grossReturnBasisPoints: [300, 900] })
    expect(result.scenarios).toHaveLength(2)
    expect(result.scenarios[1]?.atCurrentFees.minor).toBeGreaterThan(
      result.scenarios[0]?.atCurrentFees.minor ?? 0,
    )
  })

  it('splits the projected balance into what was paid in, what it earned, and what the fee took', () => {
    // D-082's identity, as the property it is: the three parts are not three
    // estimates that happen to be close, they reconstruct the figure exactly.
    for (const scenario of feeDragIllustration(input).scenarios) {
      expect(scenario.paidIn).toEqual(ils(30_000_000 + 3_600_000 * 25))
      expect(scenario.grossGrowth.minor).toBeGreaterThan(0)
      expect(scenario.feesTaken.minor).toBeGreaterThan(0)
      expect(
        scenario.paidIn.minor + scenario.grossGrowth.minor - scenario.feesTaken.minor,
      ).toBe(scenario.atCurrentFees.minor)
    }
  })

  it('costs more in fees than the fee rate applied to the deposits', () => {
    // The point of measuring `feesTaken` against a fee-free projection rather
    // than from the rates: a charge on the balance is taken from money that
    // would have gone on compounding, so over 25 years it costs a multiple of
    // what was charged in any one of them.
    const [, moderate] = feeDragIllustration(input).scenarios
    expect(moderate).toBeDefined()
    if (moderate === undefined) return

    // A flat 0.5% a year on the *opening* balance alone, never compounded.
    const naive = (30_000_000 * 50) / 10_000 * 25
    expect(moderate.feesTaken.minor).toBeGreaterThan(naive)
  })

  it('takes nothing when there are no fees', () => {
    const free = feeDragIllustration({
      ...input,
      currentFees: { onAccumulationBasisPoints: 0, onDepositBasisPoints: 0 },
    })
    for (const scenario of free.scenarios) {
      expect(scenario.feesTaken).toEqual(ils(0))
      expect(scenario.paidIn.minor + scenario.grossGrowth.minor).toBe(scenario.atCurrentFees.minor)
    }
  })
})

describe('feeAgreementStatus', () => {
  it('has nothing to say without a date', () => {
    expect(feeAgreementStatus(fund(), localDate(2026, 8, 14))).toEqual({ kind: 'NONE' })
  })

  it('warns before the agreement expires, because reverting is silent', () => {
    const result = feeAgreementStatus(
      fund({ feeNegotiatedUntil: localDate(2026, 10, 1) }),
      localDate(2026, 8, 14),
    )
    expect(result.kind).toBe('EXPIRING_SOON')
  })

  it('leaves a distant agreement alone', () => {
    const result = feeAgreementStatus(
      fund({ feeNegotiatedUntil: localDate(2028, 1, 1) }),
      localDate(2026, 8, 14),
    )
    expect(result.kind).toBe('ACTIVE')
  })

  it('reports one that has already lapsed', () => {
    const result = feeAgreementStatus(
      fund({ feeNegotiatedUntil: localDate(2026, 3, 1) }),
      localDate(2026, 8, 14),
    )
    expect(result).toEqual({ kind: 'LAPSED', since: localDate(2026, 3, 1) })
  })
})

describe('componentSplit', () => {
  it('names what the components do not account for rather than hiding it', () => {
    const split = componentSplit(
      snapshot(localDate(2026, 7, 31), 10_000_000, {
        employeeComponent: ils(3_000_000),
        employerComponent: ils(5_000_000),
      }),
    )

    expect(split.severance).toEqual(ils(0))
    expect(split.unattributed).toEqual(ils(2_000_000))
    expect(split.isComplete).toBe(false)
  })

  it('adds up exactly when the report broke out all three', () => {
    const split = componentSplit(
      snapshot(localDate(2026, 7, 31), 10_000_000, {
        employeeComponent: ils(3_000_000),
        employerComponent: ils(5_000_000),
        severanceComponent: ils(2_000_000),
      }),
    )

    expect(split.isComplete).toBe(true)
    expect(split.unattributed).toEqual(ils(0))
  })
})

describe('longTermSavings', () => {
  it('keeps severance visible instead of folding it into the balance', () => {
    const totals = longTermSavings(
      [
        {
          fund: fund(),
          latest: snapshot(localDate(2026, 7, 31), 10_000_000, {
            employeeComponent: ils(3_000_000),
            employerComponent: ils(5_000_000),
            severanceComponent: ils(2_000_000),
          }),
        },
      ],
      ILS,
    )

    expect(totals.total).toEqual(ils(10_000_000))
    expect(totals.severance).toEqual(ils(2_000_000))
  })

  it('counts the funds it cannot total rather than pretending they are empty', () => {
    const totals = longTermSavings(
      [
        { fund: fund(), latest: snapshot(localDate(2026, 7, 31), 10_000_000) },
        { fund: fund({ id: 'fund-2' }), latest: undefined },
      ],
      ILS,
    )

    expect(totals.funds).toBe(2)
    expect(totals.withoutSnapshot).toBe(1)
    expect(totals.total).toEqual(ils(10_000_000))
  })

  it('prices what the dormant funds cost each year', () => {
    const totals = longTermSavings(
      [
        {
          fund: fund({
            id: 'old-job',
            status: 'DORMANT',
            fees: { onAccumulationBasisPoints: 105, onDepositBasisPoints: 0 },
          }),
          latest: snapshot(localDate(2026, 7, 31), 4_000_000),
        },
        { fund: fund(), latest: snapshot(localDate(2026, 7, 31), 10_000_000) },
      ],
      ILS,
    )

    expect(totals.dormant).toBe(1)
    expect(totals.dormantAnnualFees).toEqual(ils(42_000))
  })
})

describe('snapshotFreshness', () => {
  const today = localDate(2026, 8, 14)

  it('has nothing to be old about when there is no reading', () => {
    expect(snapshotFreshness(undefined, today)).toBe('NONE')
  })

  it('trusts a reading from this quarter', () => {
    expect(snapshotFreshness(localDate(2026, 6, 30), today)).toBe('FRESH')
  })

  it('flags one that has outlived two statements', () => {
    expect(snapshotFreshness(localDate(2026, 2, 28), today)).toBe('STALE')
  })

  it('flags one that predates a year of contributions and fees', () => {
    expect(snapshotFreshness(localDate(2025, 8, 31), today)).toBe('VERY_STALE')
  })

  it('does not call a report dated ahead of the calendar stale', () => {
    expect(snapshotFreshness(localDate(2026, 9, 30), today)).toBe('FRESH')
  })
})

describe('studyFundLiquidity', () => {
  it('counts six years from the first deposit', () => {
    const result = studyFundLiquidity(
      fund({ fundType: 'STUDY_FUND', firstDepositDate: localDate(2024, 3, 15) }),
    )

    expect(result?.liquidAt).toEqual(localDate(2030, 3, 15))
    expect(result?.earlyLiquidAt).toEqual(localDate(2027, 3, 15))
  })

  it('clamps a leap day rather than throwing', () => {
    const result = studyFundLiquidity(
      fund({ fundType: 'STUDY_FUND', firstDepositDate: localDate(2024, 2, 29) }),
    )
    expect(result?.liquidAt).toEqual(localDate(2030, 2, 28))
  })

  it('will not guess from the opening date', () => {
    const result = studyFundLiquidity(
      fund({ fundType: 'STUDY_FUND', openedDate: localDate(2024, 1, 1) }),
    )
    expect(result).toBeUndefined()
  })

  it('has nothing to say about a pension fund', () => {
    expect(studyFundLiquidity(fund({ firstDepositDate: localDate(2024, 3, 15) }))).toBeUndefined()
  })
})

describe('validateSnapshot', () => {
  const clean = snapshot(localDate(2026, 7, 31), 10_000_000)

  it('accepts an ordinary reading', () => {
    expect(validateSnapshot(clean, [])).toEqual([])
  })

  it('refuses a negative balance', () => {
    expect(validateSnapshot(snapshot(localDate(2026, 7, 31), -1), [])).toContain(
      'NEGATIVE_BALANCE',
    )
  })

  it('allows the negative movement a severance withdrawal is', () => {
    const problems = validateSnapshot(
      snapshot(localDate(2026, 7, 31), 6_000_000, {
        depositsSincePrevious: ils(-4_000_000),
        note: 'severance withdrawn on leaving',
      }),
      [],
    )
    expect(problems).toEqual([])
  })

  it('refuses a second reading for a date the fund already has', () => {
    const problems = validateSnapshot(snapshot(localDate(2026, 7, 31), 10_100_000), [clean])
    expect(problems).toContain('DUPLICATE_DATE')
  })

  it('refuses a component in another currency', () => {
    const problems = validateSnapshot(
      snapshot(localDate(2026, 7, 31), 10_000_000, {
        employeeComponent: money(3_000_000, 'USD'),
      }),
      [],
    )
    expect(problems).toContain('MIXED_CURRENCY')
  })
})

/**
 * The base each document says the deposit was worked out on — D-169, and the
 * fifth sighting of D-138's law: no equation on either document runs through
 * this figure, so nothing but a comparison can find it wrong.
 */
describe('the salary a deposit was computed on', () => {
  /** A slip whose pension and severance lines both print the same base. */
  function monthOn(period: YearMonth, basisMinor: number): PaycheckWithLines {
    const withBasis = (one: PaycheckLine): PaycheckLine => ({
      ...one,
      basisAmount: ils(basisMinor),
    })
    return paycheck(period, [
      line(TAX_TYPE.id, 300_000),
      withBasis(line(PENSION_TYPE.id, 50_000, 75_000)),
      withBasis(line(SEVERANCE_TYPE.id, 0, 83_333)),
    ])
  }

  const period = { year: 2026, month: 1 } as const
  const arrived = localDate(2026, 2, 4)

  it('takes one base from the several lines that feed one fund', () => {
    // Pension and severance are two shares of **one** salary. Summing them
    // would report a base twice the size of the one the slip printed.
    const [contribution] = expectedContributions([monthOn(period, 2_450_000)], TYPES)
    expect(contribution?.salaryBasis).toEqual(ils(2_450_000))
  })

  it('refuses to name a base when the fund is fed by lines that disagree', () => {
    const mixed = paycheck(period, [
      { ...line(PENSION_TYPE.id, 50_000, 75_000), basisAmount: ils(2_450_000) },
      { ...line(SEVERANCE_TYPE.id, 0, 83_333), basisAmount: ils(2_000_000) },
    ])
    const [contribution] = expectedContributions([mixed], TYPES)
    expect(contribution?.salaryBasis).toBeUndefined()
  })

  it('says the two agree when they do, to the shekel', () => {
    // A real report rounds to the shekel and a payslip prints agorot, so the
    // same salary is printed two ways by two documents that agree completely.
    const [month] = depositsByMonth({
      deposits: [deposit(period, arrived, { salary: ils(2_450_000) })],
      contributions: expectedContributions([monthOn(period, 2_450_040)], TYPES),
      currency: ILS,
    })

    expect(month?.salaryStatus).toBe('AGREES')
    expect(month?.salaryGap).toEqual(ils(40))
  })

  it('finds a fund computing on less than the payslip printed', () => {
    const [month] = depositsByMonth({
      deposits: [deposit(period, arrived, { salary: ils(2_000_000) })],
      contributions: expectedContributions([monthOn(period, 2_450_000)], TYPES),
      currency: ILS,
    })

    expect(month?.salaryStatus).toBe('DIFFERS')
    // Positive: the fund used the smaller figure, which is the direction that
    // costs the user a pension.
    expect(month?.salaryGap).toEqual(ils(450_000))
    expect(month?.fundSalary).toEqual(ils(2_000_000))
    expect(month?.slipSalary).toEqual(ils(2_450_000))
  })

  it('says nothing rather than agreeing when a document prints no base', () => {
    // The whole point of the third state. A report with no salary column and a
    // slip with no base is not two documents agreeing.
    const [month] = depositsByMonth({
      deposits: [deposit(period, arrived)],
      contributions: expectedContributions([ordinaryMonth(period)], TYPES),
      currency: ILS,
    })

    expect(month?.salaryStatus).toBe('UNKNOWN')
    expect(month?.salaryGap).toBeUndefined()
  })

  it('will not compare a partial sum against a whole one', () => {
    // Two employers in one month, one of whose rows prints no salary. Taking
    // the one base that is stated would read as an under-report of half a
    // salary — a transcription gap wearing the costume of a finding.
    const [month] = depositsByMonth({
      deposits: [
        deposit(period, arrived, { id: 'a', salary: ils(1_200_000) }),
        deposit(period, arrived, { id: 'b', employerName: 'Other', salary: undefined }),
      ],
      contributions: expectedContributions([monthOn(period, 2_450_000)], TYPES),
      currency: ILS,
    })

    expect(month?.fundSalary).toBeUndefined()
    expect(month?.salaryStatus).toBe('UNKNOWN')
  })
})
