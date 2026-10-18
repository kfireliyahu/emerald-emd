import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate, type LocalDate, type YearMonth } from '@/core/time.ts'
import type {
  ExpenseObservation,
  FixedExpense,
  FixedExpenseCandidate,
} from '@/domain/model/fixed.ts'
import type { DeductionType, PaycheckWithLines } from '@/domain/model/paycheck.ts'
import { netReducingTotal, reconciliationDelta } from '@/domain/paycheck.ts'
import {
  amortizedShares,
  coverageBasisPoints,
  dayOfMonthSpread,
  detectFixedExpenses,
  fixedExpenseBasis,
  isActiveIn,
  isChargeMonth,
  nextChargeMonth,
  monthVariance,
  monthlyShare,
  proposeFixedExpense,
  validateFixedExpense,
  variationBasisPoints,
} from './fixedExpenses.ts'

const ILS = 'ILS'

/** One outflow. Amounts are given as magnitudes and stored signed (D-004). */
function charge(
  merchant: string,
  date: LocalDate,
  minor: number,
  categoryId?: string,
): ExpenseObservation {
  return {
    merchantNormalized: merchant,
    merchantRaw: merchant,
    date,
    amount: money(-minor, ILS),
    categoryId,
  }
}

const JUNE_2026: YearMonth = { year: 2026, month: 6 }

/**
 * Six months of a plausible ledger: rent to the agora, an electricity bill that
 * moves, a bimonthly water bill, and four kinds of noise that must not be
 * offered — a one-off purchase, a coffee habit with an irregular gap, a refund,
 * and a subscription that ended before the window opened.
 *
 * This is F09's first acceptance criterion in a fixture: "detection over a known
 * 6-month fixture finds the seeded recurring merchants and nothing else". The
 * rows are written here rather than read from a spreadsheet because the detector
 * is pure over rows — no xlsx is involved in any of it.
 */
function sixMonths(): readonly ExpenseObservation[] {
  const rent = [1, 2, 3, 4, 5, 6].map((month) =>
    charge('שכר דירה', localDate(2026, month, 1), 540_000, 'cat:housing'),
  )

  const electricityAmounts = [43_000, 51_000, 38_000, 61_000, 42_000, 47_000]
  const electricityDays = [9, 10, 9, 11, 10, 9]
  const electricity = electricityAmounts.map((amount, index) =>
    charge(
      'חברת החשמל',
      localDate(2026, index + 1, electricityDays[index] ?? 9),
      amount,
      'cat:utilities',
    ),
  )

  const water = [
    charge('מי אביבים', localDate(2026, 1, 20), 32_000, 'cat:utilities'),
    charge('מי אביבים', localDate(2026, 3, 20), 35_000, 'cat:utilities'),
    charge('מי אביבים', localDate(2026, 5, 20), 33_000, 'cat:utilities'),
  ]

  const noise: ExpenseObservation[] = [
    // Bought a sofa once.
    charge('רהיטים', localDate(2026, 3, 14), 250_000),
    // Two coffees in January and one in May: a four-month gap is not a cadence.
    charge('בית קפה', localDate(2026, 1, 5), 2_200),
    charge('בית קפה', localDate(2026, 1, 19), 1_800),
    charge('בית קפה', localDate(2026, 5, 7), 2_400),
    // Money coming back is not a recurring bill, however regular it is.
    { ...charge('החזר מס', localDate(2026, 2, 3), 90_000), amount: money(90_000, ILS) },
    { ...charge('החזר מס', localDate(2026, 3, 3), 90_000), amount: money(90_000, ILS) },
    { ...charge('החזר מס', localDate(2026, 4, 3), 90_000), amount: money(90_000, ILS) },
    // Cancelled before the window opened.
    charge('חדר כושר', localDate(2025, 10, 3), 19_900),
    charge('חדר כושר', localDate(2025, 11, 3), 19_900),
    charge('חדר כושר', localDate(2025, 12, 3), 19_900),
  ]

  return [...rent, ...electricity, ...water, ...noise]
}

function detect(
  observations: readonly ExpenseObservation[] = sixMonths(),
  windowMonths = 6,
  endingAt: YearMonth = JUNE_2026,
): readonly FixedExpenseCandidate[] {
  return detectFixedExpenses(observations, { endingAt, windowMonths })
}

/** The last month of a three-month fixture written across January to March. */
const MARCH_2026: YearMonth = { year: 2026, month: 3 }

function byMerchant(
  candidates: readonly FixedExpenseCandidate[],
  merchant: string,
): FixedExpenseCandidate {
  const found = candidates.find((candidate) => candidate.merchantNormalized === merchant)
  if (found === undefined) throw new Error(`no candidate for ${merchant}`)
  return found
}

describe('detectFixedExpenses', () => {
  it('finds the recurring merchants over a six-month fixture and nothing else', () => {
    expect(detect().map((candidate) => candidate.merchantNormalized)).toEqual([
      'שכר דירה',
      'חברת החשמל',
      'מי אביבים',
    ])
  })

  it('reads a rent that never moves as monthly, fixed and certain', () => {
    const rent = byMerchant(detect(), 'שכר דירה')

    expect(rent.suggestedCadence).toBe('MONTHLY')
    expect(rent.occurrences).toBe(6)
    expect(rent.medianAmount).toEqual(money(540_000, ILS))
    expect(rent.amountVariability).toBe('FIXED')
    expect(rent.amountSpreadBasisPoints).toBe(0)
    expect(rent.dayOfMonthSpread).toBe(0)
    expect(rent.dayOfMonthHint).toBe(1)
    expect(rent.confidence).toBe('HIGH')
    expect(rent.categoryId).toBe('cat:housing')
    expect(rent.lastSeen).toEqual(localDate(2026, 6, 1))
  })

  it('proposes the median, not the mean, so one anomalous month does not skew it', () => {
    const electricity = byMerchant(detect(), 'חברת החשמל')

    // The six bills mean ₪470.00 — dragged up by the one ₪610 month.
    expect(electricity.medianAmount).toEqual(money(43_000, ILS))
    expect(electricity.amountVariability).toBe('VARIABLE')
    expect(electricity.amountSpreadBasisPoints).toBeGreaterThan(1000)
    // A bill that varies is still a candidate; the label is the whole point.
    expect(electricity.confidence).toBe('MEDIUM')
  })

  it('detects a bimonthly cadence from the gaps and never calls it certain', () => {
    const water = byMerchant(detect(), 'מי אביבים')

    expect(water.suggestedCadence).toBe('BIMONTHLY')
    expect(water.occurrences).toBe(3)
    expect(water.medianAmount).toEqual(money(33_000, ILS))
    expect(water.amountVariability).toBe('FIXED')
    // Every signal is clean and it is still MEDIUM: two gaps are not a pattern.
    expect(water.confidence).toBe('MEDIUM')
  })

  it('ranks the list by confidence and then by what it costs', () => {
    expect(detect().map((candidate) => candidate.confidence)).toEqual([
      'HIGH',
      'MEDIUM',
      'MEDIUM',
    ])
  })

  it('counts a month, not a charge, when a merchant bills twice in one', () => {
    const twice = [1, 2, 3].flatMap((month) => [
      charge('חניון', localDate(2026, month, 4), 15_000),
      charge('חניון', localDate(2026, month, 18), 15_000),
    ])

    const candidate = byMerchant(detect(twice, 3, MARCH_2026), 'חניון')
    expect(candidate.occurrences).toBe(3)
    expect(candidate.months.map((month) => month.charges)).toEqual([2, 2, 2])
    // ₪300 a month, not ₪150 — the projection is what the month costs.
    expect(candidate.medianAmount).toEqual(money(30_000, ILS))
    expect(candidate.suggestedCadence).toBe('MONTHLY')
  })

  it('survives a month whose statement was never imported', () => {
    // January, February, April, May — the gaps are 1, 2, 1.
    const patchy = [1, 2, 4, 5].map((month) =>
      charge('ביטוח רכב', localDate(2026, month, 7), 41_000),
    )

    const candidate = byMerchant(detectFixedExpenses(patchy, {
      endingAt: { year: 2026, month: 5 },
      windowMonths: 5,
    }), 'ביטוח רכב')

    expect(candidate.suggestedCadence).toBe('MONTHLY')
    expect(candidate.occurrences).toBe(4)
  })

  it('never turns a single charge into a candidate, however large', () => {
    expect(detect([charge('טיסה', localDate(2026, 4, 2), 1_200_000)], 6)).toEqual([])
  })

  it('does not invent a yearly cadence it cannot have seen', () => {
    // An annual premium inside a twelve-month window is one charge, and one
    // charge is indistinguishable from a one-off. docs/f09's third user story —
    // "I add a fixed expense the app couldn't see" — is that case, by hand.
    const premium = [charge('ביטוח דירה', localDate(2026, 2, 11), 120_000)]
    expect(detect(premium, 12)).toEqual([])
  })

  it('ignores charges outside the window and money coming back', () => {
    const merchants = detect().map((candidate) => candidate.merchantNormalized)
    expect(merchants).not.toContain('חדר כושר')
    expect(merchants).not.toContain('החזר מס')
  })

  it('respects a dismissal and never re-offers what is already tracked', () => {
    const dismissed = detectFixedExpenses(sixMonths(), {
      endingAt: JUNE_2026,
      windowMonths: 6,
      dismissed: ['חברת החשמל'],
      alreadyTracked: ['שכר דירה'],
    })

    expect(dismissed.map((candidate) => candidate.merchantNormalized)).toEqual(['מי אביבים'])
  })

  it('keeps two currencies apart rather than adding minor units together', () => {
    const mixed = [1, 2, 3].flatMap((month) => [
      charge('ספק ענן', localDate(2026, month, 12), 9_900),
      {
        ...charge('ספק ענן', localDate(2026, month, 12), 2_000),
        amount: money(-2_000, 'USD'),
      },
    ])

    const candidates = detect(mixed, 3, MARCH_2026)
    expect(candidates).toHaveLength(2)
    expect(candidates.map((candidate) => candidate.currency).sort()).toEqual(['ILS', 'USD'])
  })

  it('needs windowMonths − 1 months for a monthly bill', () => {
    const twoOfThree = [1, 2].map((month) => charge('נטפליקס', localDate(2026, month, 3), 5_490))
    expect(
      detectFixedExpenses(twoOfThree, { endingAt: { year: 2026, month: 3 }, windowMonths: 3 }),
    ).toHaveLength(1)

    // The same two months inside a six-month window: two of a required five.
    expect(
      detectFixedExpenses(twoOfThree, { endingAt: { year: 2026, month: 6 }, windowMonths: 6 }),
    ).toEqual([])
  })
})

/**
 * A card line as the ledger reads it: the month is the statement's charge date
 * (D-006), and the day the shop actually charged is the purchase date beside it.
 */
function cardLine(
  merchant: string,
  chargedOn: LocalDate,
  purchasedOn: LocalDate,
  minor: number,
): ExpenseObservation {
  return { ...charge(merchant, chargedOn, minor), transactionDate: purchasedOn }
}

describe('what counts as evidence of a bill (M37 F2)', () => {
  // Two card statements, charged on the 2nd of August and of September, with
  // the same ordinary shops on both at different figures on different days —
  // the demo's ledger, which offered every one of them as a monthly bill.
  const shops: readonly (readonly [string, number, number, number, number])[] = [
    ['GREENLEAF MARKET', 4, 41_250, 17, 38_990],
    ['LITTLE BEAN CAFE', 9, 1_800, 23, 2_650],
    ['NORTHWAY FUEL', 12, 26_000, 3, 31_480],
    ['WILLOW PHARMACY', 21, 6_490, 14, 11_200],
    ['MAPLE OUTFITTERS', 27, 18_900, 8, 7_450],
  ]
  const twoStatements = shops.flatMap(([shop, augustDay, august, septemberDay, september]) => [
    cardLine(shop, localDate(2026, 8, 2), localDate(2026, 7, augustDay), august),
    cardLine(shop, localDate(2026, 9, 2), localDate(2026, 8, septemberDay), september),
  ])
  const SEPTEMBER_2026: YearMonth = { year: 2026, month: 9 }

  it('offers no shop that merely appears once on each of two statements', () => {
    expect(detect(twoStatements, 3, SEPTEMBER_2026)).toEqual([])
  })

  it('reads the day a bill keeps from the purchase, not from the statement', () => {
    // Same figure both times, but bought on the 4th and the 17th: the statement
    // charging both on the 2nd is not the shop keeping a day.
    const sameFigure = [
      cardLine('HILLTOP HARDWARE', localDate(2026, 8, 2), localDate(2026, 7, 4), 9_900),
      cardLine('HILLTOP HARDWARE', localDate(2026, 9, 2), localDate(2026, 8, 17), 9_900),
    ]
    expect(detect(sameFigure, 3, SEPTEMBER_2026)).toEqual([])
  })

  it('wants the same figure to the agora from two months, not one inside the band', () => {
    // ₪57.00 and then ₪61.50 on the 12th both times: a café, not a bill.
    const cafe = [
      cardLine('COPPER KETTLE', localDate(2026, 8, 2), localDate(2026, 7, 12), 5_700),
      cardLine('COPPER KETTLE', localDate(2026, 9, 2), localDate(2026, 8, 12), 6_150),
    ]
    expect(detect(cafe, 3, SEPTEMBER_2026)).toEqual([])
  })

  it('still offers a subscription on two statements: same figure, same day', () => {
    const streaming = [
      cardLine('STREAMBOX', localDate(2026, 8, 2), localDate(2026, 7, 14), 4_990),
      cardLine('STREAMBOX', localDate(2026, 9, 2), localDate(2026, 8, 14), 4_990),
    ]
    const candidate = byMerchant(detect([...twoStatements, ...streaming], 3, SEPTEMBER_2026), 'STREAMBOX')
    expect(candidate.suggestedCadence).toBe('MONTHLY')
    expect(candidate.amountVariability).toBe('FIXED')
    expect(candidate.dayOfMonthHint).toBe(14)
    expect(candidate.dayOfMonthSpread).toBe(0)
  })

  it('offers a genuine monthly charge across enough months, and a bill whose figure moves', () => {
    const months = [6, 7, 8, 9]
    const gym = months.map((month) =>
      cardLine('IRON GYM', localDate(2026, month, 2), localDate(2026, month - 1, 20), 21_900),
    )
    const power = months.map((month, index) =>
      cardLine('BRIGHT POWER CO.', localDate(2026, month, 2), localDate(2026, month - 1, 11), [31_000, 44_500, 52_000, 38_200][index] ?? 0),
    )
    const found = detect([...gym, ...power], 4, SEPTEMBER_2026).map(
      (candidate) => candidate.merchantNormalized,
    )
    expect(found).toEqual(['IRON GYM', 'BRIGHT POWER CO.'])
  })

  it('never offers a shop that is regular in neither figure nor day, however many months', () => {
    const groceries = [6, 7, 8, 9].flatMap((month, index) => [
      cardLine('DAILY BASKET', localDate(2026, month, 2), localDate(2026, month - 1, 3 + index * 5), 23_400 + index * 9_100),
      cardLine('DAILY BASKET', localDate(2026, month, 2), localDate(2026, month - 1, 24 - index), 12_000 + index * 4_700),
    ])
    expect(detect(groceries, 4, SEPTEMBER_2026)).toEqual([])
  })
})

describe('proposeFixedExpense — the labeling queue’s seed', () => {
  const gym = [
    charge('חדר כושר', localDate(2026, 1, 12), 19_900),
    charge('חדר כושר', localDate(2026, 2, 12), 19_900),
    charge('חדר כושר', localDate(2026, 3, 14), 19_900),
    charge('חדר כושר', localDate(2026, 4, 12), 24_900),
  ]

  it('proposes the median month, the day and the cadence the gaps read as', () => {
    const proposal = proposeFixedExpense(gym, 'חדר כושר')

    expect(proposal?.medianAmount).toEqual(money(19_900, ILS))
    expect(proposal?.cadence).toBe('MONTHLY')
    expect(proposal?.months).toHaveLength(4)
    expect(proposal?.dayOfMonthHint).toBe(12)
    // April's ₪249 is a quarter over the other three, which is what "the amount
    // moves" means here — the same threshold the detector labels a bill with.
    expect(proposal?.amountVariability).toBe('VARIABLE')
    expect(proposal?.firstSeen).toEqual(localDate(2026, 1, 12))
    expect(proposal?.lastSeen).toEqual(localDate(2026, 4, 12))
  })

  it('proposes from a single charge, which the detector refuses to offer', () => {
    const once = [charge('ביטוח רכב', localDate(2026, 3, 4), 210_000)]

    expect(
      detectFixedExpenses(once, { endingAt: JUNE_2026, windowMonths: 12 }),
    ).toEqual([])

    const proposal = proposeFixedExpense(once, 'ביטוח רכב')
    expect(proposal?.medianAmount).toEqual(money(210_000, ILS))
    expect(proposal?.months).toHaveLength(1)
  })

  it('says nothing about a cadence it cannot read, rather than defaulting to monthly', () => {
    const irregular = [
      charge('רואה חשבון', localDate(2026, 1, 3), 50_000),
      charge('רואה חשבון', localDate(2026, 6, 9), 80_000),
    ]

    expect(proposeFixedExpense(irregular, 'רואה חשבון')?.cadence).toBeUndefined()
    expect(proposeFixedExpense([charge('פעם', localDate(2026, 5, 1), 100)], 'פעם')?.cadence)
      .toBeUndefined()
  })

  it('sums a month that had two charges, exactly as the detector does', () => {
    const twice = [
      charge('סופר', localDate(2026, 1, 3), 10_000),
      charge('סופר', localDate(2026, 1, 20), 15_000),
      charge('סופר', localDate(2026, 2, 4), 25_000),
    ]

    expect(proposeFixedExpense(twice, 'סופר')?.medianAmount).toEqual(money(25_000, ILS))
    expect(proposeFixedExpense(twice, 'סופר')?.months).toHaveLength(2)
  })

  it('counts one currency and names the others, because there is no rate (D-003)', () => {
    const mixed = [
      charge('ספק', localDate(2026, 1, 5), 30_000),
      { ...charge('ספק', localDate(2026, 2, 5), 3_000), amount: money(-3_000, 'USD') },
      { ...charge('ספק', localDate(2026, 3, 5), 4_000), amount: money(-4_000, 'USD') },
    ]

    const proposal = proposeFixedExpense(mixed, 'ספק')
    expect(proposal?.currency).toBe('USD')
    expect(proposal?.months).toHaveLength(2)
    expect(proposal?.otherCurrencies).toEqual([ILS])
  })

  it('takes what the rows are already filed under, and nothing when they are not', () => {
    const filed = [
      charge('חשמל', localDate(2026, 1, 10), 30_000, 'cat:utilities'),
      charge('חשמל', localDate(2026, 2, 10), 32_000, 'cat:utilities'),
      charge('חשמל', localDate(2026, 3, 10), 31_000),
    ]

    expect(proposeFixedExpense(filed, 'חשמל')?.categoryId).toBe('cat:utilities')
    expect(proposeFixedExpense(gym, 'חדר כושר')?.categoryId).toBeUndefined()
  })

  it('has nothing to propose from an inflow, or from a name that is not there', () => {
    const refund: ExpenseObservation = {
      merchantNormalized: 'החזר',
      merchantRaw: 'החזר',
      date: localDate(2026, 2, 2),
      amount: money(5_000, ILS),
      categoryId: undefined,
    }

    expect(proposeFixedExpense([refund], 'החזר')).toBeUndefined()
    expect(proposeFixedExpense(gym, 'לא קיים')).toBeUndefined()
  })
})

describe('the two stability signals', () => {
  it('scores a spread against the mean, in basis points', () => {
    expect(variationBasisPoints([100, 100, 100])).toBe(0)
    expect(variationBasisPoints([500])).toBe(0)
    expect(variationBasisPoints([])).toBe(0)
    // 90 / 110 around a mean of 100 is a 10% deviation.
    expect(variationBasisPoints([90, 110])).toBe(1000)
  })

  it('reads the 31st and the 1st as one day apart, not thirty', () => {
    expect(dayOfMonthSpread([12, 12, 12])).toBe(0)
    expect(dayOfMonthSpread([8, 11])).toBe(3)
    expect(dayOfMonthSpread([31, 1, 30, 2])).toBe(3)
  })
})

describe('amortization', () => {
  it('splits a cycle so the parts sum exactly to the whole', () => {
    const shares = amortizedShares(money(100_000, ILS), 12)

    expect(shares).toHaveLength(12)
    expect(shares.reduce((total, share) => total + share.minor, 0)).toBe(100_000)
    // ₪83.33 twelve times is ₪999.96. Four months carry the extra agora.
    expect(shares.filter((share) => share.minor === 8_334)).toHaveLength(4)
    expect(shares.filter((share) => share.minor === 8_333)).toHaveLength(8)
  })

  it('gives a ₪1,200 annual premium a ₪100 monthly share', () => {
    const premium = expense({ expectedAmount: money(120_000, ILS), cadence: 'YEARLY' })
    expect(monthlyShare(premium)).toEqual(money(10_000, ILS))
  })

  it('leaves a monthly expense alone and halves a bimonthly one', () => {
    expect(monthlyShare(expense({ expectedAmount: money(43_000, ILS) }))).toEqual(
      money(43_000, ILS),
    )
    expect(
      monthlyShare(expense({ expectedAmount: money(33_000, ILS), cadence: 'BIMONTHLY' })),
    ).toEqual(money(16_500, ILS))
  })

  it('keeps the single monthly figure within an agora of every exact share', () => {
    const odd = expense({ expectedAmount: money(100_000, ILS), cadence: 'YEARLY' })
    const share = monthlyShare(odd)

    for (const exact of amortizedShares(odd.expectedAmount, 12)) {
      expect(Math.abs(exact.minor - share.minor)).toBeLessThanOrEqual(1)
    }
  })
})

describe('which months an expense is live and charged in', () => {
  it('counts whole cycles from the start date', () => {
    const water = expense({
      cadence: 'BIMONTHLY',
      startedAt: localDate(2026, 1, 20),
      expectedAmount: money(33_000, ILS),
    })

    expect(isChargeMonth(water, { year: 2026, month: 1 })).toBe(true)
    expect(isChargeMonth(water, { year: 2026, month: 2 })).toBe(false)
    expect(isChargeMonth(water, { year: 2026, month: 3 })).toBe(true)
    expect(isChargeMonth(water, { year: 2027, month: 1 })).toBe(true)
    // Before it started at all.
    expect(isChargeMonth(water, { year: 2025, month: 11 })).toBe(false)
  })

  it('will not guess a charge month it has no anchor for', () => {
    expect(isChargeMonth(expense({ cadence: 'QUARTERLY' }), JUNE_2026)).toBe(false)
    expect(isChargeMonth(expense({ cadence: 'IRREGULAR' }), JUNE_2026)).toBe(false)
    expect(isChargeMonth(expense({ cadence: 'MONTHLY' }), JUNE_2026)).toBe(true)
  })

  it('stops projecting a cancelled subscription', () => {
    const cancelled = expense({
      startedAt: localDate(2025, 3, 1),
      endedAt: localDate(2026, 4, 30),
    })

    expect(isActiveIn(cancelled, { year: 2026, month: 4 })).toBe(true)
    expect(isActiveIn(cancelled, { year: 2026, month: 5 })).toBe(false)
    expect(isActiveIn(cancelled, { year: 2025, month: 2 })).toBe(false)
    expect(isActiveIn(expense({ isActive: false }), JUNE_2026)).toBe(false)
  })
})

describe('fixedExpenseBasis', () => {
  const rent = expense({ id: 'rent', name: 'Rent', expectedAmount: money(540_000, ILS) })
  const gym = expense({
    id: 'gym',
    name: 'Gym',
    expectedAmount: money(19_900, ILS),
    source: 'DETECTED_CONFIRMED',
    isDiscretionary: true,
  })
  const pension = expense({
    id: 'pension',
    name: 'Pension',
    matchKind: 'PAYCHECK_DEDUCTION',
    matchRef: 'ded:pension',
    expectedAmount: money(150_000, ILS),
  })

  it('counts every live expense, detected and confirmed ones beside the typed', () => {
    expect(fixedExpenseBasis([rent, gym], JUNE_2026, ILS).total).toEqual(money(559_900, ILS))
  })

  it('lists an expense in another currency rather than converting it', () => {
    const dollars = expense({ id: 'saas', expectedAmount: money(2_000, 'USD') })
    const basis = fixedExpenseBasis([rent, dollars], JUNE_2026, ILS)

    expect(basis.total).toEqual(money(540_000, ILS))
    expect(basis.otherCurrency.map((one) => one.id)).toEqual(['saas'])
  })

  it('amortizes a non-monthly expense into the monthly total', () => {
    const premium = expense({
      id: 'insurance',
      expectedAmount: money(120_000, ILS),
      cadence: 'YEARLY',
      startedAt: localDate(2026, 2, 11),
    })

    const basis = fixedExpenseBasis([rent, premium], JUNE_2026, ILS)
    expect(basis.total).toEqual(money(550_000, ILS))
    // ...and June is not the month the real ₪1,200 lands in.
    expect(isChargeMonth(premium, JUNE_2026)).toBe(false)
    expect(isChargeMonth(premium, { year: 2027, month: 2 })).toBe(true)
  })

  /**
   * docs/f09: "subtracting a payroll deduction from net twice makes every plan
   * wrong. It deserves an explicit test."
   *
   * This is it, and it is a real one rather than a notional one — M3 built the
   * paycheck lines it matches against, so the same ₪1,500 can be followed
   * through both halves of the arithmetic at once.
   */
  it('never subtracts a payroll deduction from net a second time', () => {
    const slip = paycheckWithPension()

    // The slip's own arithmetic closes: pension is already out of net.
    expect(reconciliationDelta(slip, DEDUCTION_TYPES)).toEqual(money(0, ILS))
    expect(netReducingTotal(slip, DEDUCTION_TYPES)).toEqual(money(550_000, ILS))

    const basis = fixedExpenseBasis([rent, pension], JUNE_2026, ILS)

    expect(basis.total).toEqual(money(540_000, ILS))
    expect(basis.subtracted.map((one) => one.id)).toEqual(['rent'])
    expect(basis.alreadyOutOfNet.map((one) => one.id)).toEqual(['pension'])

    // What the splitter plans against, and what it would have been had the rule
    // not held: exactly the pension line lower, which is the bug.
    const plannable = slip.paycheck.net.minor - basis.total.minor
    expect(plannable).toBe(1_410_000)
    expect(plannable - pension.expectedAmount.minor).toBe(1_260_000)
  })

  it('keeps a payroll deduction out of the total even in another currency', () => {
    const foreign = { ...pension, expectedAmount: money(1_000, 'USD') }
    const basis = fixedExpenseBasis([rent, foreign], JUNE_2026, ILS)

    expect(basis.alreadyOutOfNet.map((one) => one.id)).toEqual(['pension'])
    expect(basis.otherCurrency).toEqual([])
  })
})

describe('monthVariance', () => {
  const rent = expense({ expectedAmount: money(540_000, ILS), startedAt: localDate(2025, 1, 1) })
  const electricity = expense({
    expectedAmount: money(43_000, ILS),
    amountVariability: 'VARIABLE',
    startedAt: localDate(2025, 1, 1),
  })

  it('says nothing when a charge lands inside tolerance', () => {
    const within = monthVariance(rent, money(556_000, ILS), JUNE_2026)
    expect(within.status).toBe('WITHIN')
    expect(within.delta).toEqual(money(16_000, ILS))
    expect(within.deltaBasisPoints).toBe(296)
  })

  it('surfaces a rent increase and tolerates the same swing on a variable bill', () => {
    expect(monthVariance(rent, money(640_000, ILS), JUNE_2026).status).toBe('HIGHER')
    // The same 18.5% on electricity is an ordinary summer.
    expect(monthVariance(electricity, money(50_960, ILS), JUNE_2026).status).toBe('WITHIN')
    expect(monthVariance(electricity, money(61_200, ILS), JUNE_2026).status).toBe('HIGHER')
    expect(monthVariance(rent, money(400_000, ILS), JUNE_2026).status).toBe('LOWER')
  })

  it('calls a missing monthly charge missing, and a bimonthly off-month nothing', () => {
    expect(monthVariance(rent, undefined, JUNE_2026).status).toBe('MISSING')

    const water = expense({
      expectedAmount: money(33_000, ILS),
      cadence: 'BIMONTHLY',
      startedAt: localDate(2026, 1, 20),
    })
    expect(monthVariance(water, undefined, { year: 2026, month: 2 }).status).toBe('NOT_DUE')
    expect(monthVariance(water, undefined, { year: 2026, month: 3 }).status).toBe('MISSING')
  })

  it('never calls a payroll deduction missing, however long it goes unmatched', () => {
    // Nothing in the ledger can match it: the payslip already accounted for it.
    // Reporting it as a missing payment would fire an import warning every month
    // for an expense that is behaving exactly as declared.
    const pension = expense({
      name: 'Pension',
      matchKind: 'PAYCHECK_DEDUCTION',
      matchRef: 'ded:pension',
      expectedAmount: money(150_000, ILS),
    })
    expect(monthVariance(pension, undefined, JUNE_2026).status).toBe('NOT_TRACKED')

    const manual = expense({ matchKind: 'MANUAL_ONLY', matchRef: undefined })
    expect(monthVariance(manual, undefined, JUNE_2026).status).toBe('NOT_TRACKED')

    // A category-matched one is answerable, so silence about it is still news.
    const byCategory = expense({
      matchKind: 'CATEGORY',
      matchRef: 'cat:utilities',
      startedAt: localDate(2025, 1, 1),
    })
    expect(monthVariance(byCategory, undefined, JUNE_2026).status).toBe('MISSING')
  })

  it('has nothing to say about an expense that is not live', () => {
    const ended = expense({
      expectedAmount: money(19_900, ILS),
      endedAt: localDate(2026, 3, 31),
    })
    expect(monthVariance(ended, undefined, JUNE_2026).status).toBe('NOT_DUE')
  })
})

describe('validateFixedExpense', () => {
  it('accepts an ordinary one, and a zero amount', () => {
    expect(validateFixedExpense(expense())).toEqual([])
    expect(validateFixedExpense(expense({ expectedAmount: money(0, ILS) }))).toEqual([])
  })

  it('refuses what cannot be true of any fixed expense', () => {
    expect(validateFixedExpense(expense({ name: '   ' }))).toEqual(['NO_NAME'])
    expect(validateFixedExpense(expense({ expectedAmount: money(-100, ILS) }))).toEqual([
      'NEGATIVE_AMOUNT',
    ])
    expect(validateFixedExpense(expense({ matchRef: undefined }))).toEqual(['MISSING_MATCH_REF'])
    expect(
      validateFixedExpense(
        expense({ startedAt: localDate(2026, 6, 1), endedAt: localDate(2026, 3, 1) }),
      ),
    ).toEqual(['ENDED_BEFORE_STARTED'])
  })

  it('asks a non-monthly cadence for the anchor its charge months are counted from', () => {
    expect(validateFixedExpense(expense({ cadence: 'QUARTERLY' }))).toEqual(['ANCHOR_REQUIRED'])
    expect(
      validateFixedExpense(expense({ cadence: 'QUARTERLY', startedAt: localDate(2026, 2, 1) })),
    ).toEqual([])
    // Irregular has no cycle, so it has nothing to count from and is not asked.
    expect(validateFixedExpense(expense({ cadence: 'IRREGULAR' }))).toEqual([])
  })

  it('needs nothing to match against when nothing is matched', () => {
    expect(validateFixedExpense(expense({ matchKind: 'MANUAL_ONLY', matchRef: undefined }))).toEqual(
      [],
    )
  })
})

describe('coverageBasisPoints', () => {
  it('measures months seen against months the cadence expected', () => {
    const candidates = detect()
    expect(coverageBasisPoints(byMerchant(candidates, 'שכר דירה'), 6)).toBe(10_000)
    expect(coverageBasisPoints(byMerchant(candidates, 'מי אביבים'), 6)).toBe(10_000)
  })
})

function expense(overrides?: Partial<FixedExpense>): FixedExpense {
  return {
    id: 'fx',
    name: 'Fixed expense',
    categoryId: undefined,
    matchKind: 'MERCHANT_PATTERN',
    matchRef: 'merchant',
    expectedAmount: money(10_000, ILS),
    amountVariability: 'FIXED',
    cadence: 'MONTHLY',
    dayOfMonthHint: undefined,
    isDiscretionary: false,
    source: 'DETECTED_CONFIRMED',
    isActive: true,
    startedAt: undefined,
    endedAt: undefined,
    ...overrides,
  }
}

const DEDUCTION_TYPES: readonly DeductionType[] = [
  deductionType({ id: 'ded:income-tax', name: 'Income tax', kind: 'TAX' }),
  deductionType({
    id: 'ded:pension',
    name: 'Pension',
    kind: 'PENSION',
    countsAsSaving: true,
  }),
]

function deductionType(overrides: Partial<DeductionType> & { id: string }): DeductionType {
  return {
    name: overrides.id,
    hebrewName: undefined,
    kind: 'OTHER_DEDUCTION',
    reducesNet: true,
    countsAsSaving: false,
    linkedSavingGoalId: undefined,
    linkedDebtId: undefined,
    linkedFundId: undefined,
    isBuiltIn: true,
    sortOrder: 0,
    ...overrides,
  }
}

/** ₪25,000 gross, ₪4,000 of tax, ₪1,500 of pension, ₪19,500 net. It closes. */
function paycheckWithPension(): PaycheckWithLines {
  return {
    paycheck: {
      id: 'pay',
      period: JUNE_2026,
      paymentDate: localDate(2026, 7, 9),
      employerName: 'Acme',
      gross: money(2_500_000, ILS),
      net: money(1_950_000, ILS),
      depositedToAccountId: undefined,
      note: undefined,
      sourceKind: 'MANUAL',
      attachmentRef: undefined,
      isIrregular: false,
    },
    lines: [
      {
        id: 'line:tax',
        paycheckId: 'pay',
        deductionTypeId: 'ded:income-tax',
        employeeAmount: money(400_000, ILS),
        employerAmount: undefined,
        basisAmount: undefined,
        note: undefined,
        sortOrder: 0,
      },
      {
        id: 'line:pension',
        paycheckId: 'pay',
        deductionTypeId: 'ded:pension',
        employeeAmount: money(150_000, ILS),
        employerAmount: money(162_500, ILS),
        basisAmount: undefined,
        note: undefined,
        sortOrder: 10,
      },
    ],
  }
}

describe('when a bill is next due (M28 U7, S3)', () => {
  it('finds the next charging month from a month on, this one included', () => {
    const insurance = expense({
      cadence: 'YEARLY',
      startedAt: localDate(2025, 11, 14),
      expectedAmount: money(372_000, ILS),
    })

    expect(nextChargeMonth(insurance, { year: 2026, month: 10 })).toEqual({ year: 2026, month: 11 })
    expect(nextChargeMonth(insurance, { year: 2026, month: 11 })).toEqual({ year: 2026, month: 11 })
    expect(nextChargeMonth(insurance, { year: 2026, month: 12 })).toEqual({ year: 2027, month: 11 })
  })

  it('has none for a bill with no cycle to count from, or one that has ended', () => {
    expect(nextChargeMonth(expense({ cadence: 'IRREGULAR' }), { year: 2026, month: 10 })).toBeUndefined()
    expect(
      nextChargeMonth(expense({ cadence: 'YEARLY', startedAt: undefined }), { year: 2026, month: 10 }),
    ).toBeUndefined()
    expect(
      nextChargeMonth(expense({ cadence: 'MONTHLY', isActive: false }), { year: 2026, month: 10 }),
    ).toBeUndefined()
  })
})
