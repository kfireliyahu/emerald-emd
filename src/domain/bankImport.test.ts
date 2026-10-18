import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { normalizeMerchant } from '@/core/text.ts'
import { localDate, type LocalDate, type YearMonth } from '@/core/time.ts'
import type { BankRow, CardAccountRef, CardPeriodTotal } from '@/domain/model/banking.ts'
import {
  bankSpendingBasis,
  classifyRow,
  last4sIn,
  matchSalaries,
  planBankImport,
  salaryDepositCounts,
  salaryQuestions,
  verifyRunningBalance,
} from './bankImport.ts'

const ILS = 'ILS'

const JULY: YearMonth = { year: 2026, month: 7 }
const JUNE: YearMonth = { year: 2026, month: 6 }

let nextRef = 0

/**
 * One bank row. The description goes through `normalizeMerchant` exactly as the
 * importer does it, because half of what is under test here is what that call
 * leaves behind.
 */
function row(
  description: string,
  minor: number,
  date: LocalDate = localDate(2026, 7, 10),
  balance?: number,
): BankRow {
  nextRef += 1
  return {
    ref: `Sheet1!${nextRef}`,
    date,
    amount: money(minor, ILS),
    descriptionRaw: description,
    descriptionNormalized: normalizeMerchant(description),
    balance: balance === undefined ? undefined : money(balance, ILS),
  }
}

function card(
  id: string,
  last4: string | undefined,
  exclude?: boolean | undefined,
): CardAccountRef {
  return { id, name: `Card ${id}`, last4, excludeSettlementsFromStats: exclude }
}

function statement(accountId: string, period: YearMonth, minor: number): CardPeriodTotal {
  return { accountId, period, total: money(-minor, ILS) }
}

describe('last4sIn', () => {
  it('finds the card number the bank wrote into the description', () => {
    expect(last4sIn('כרטיס אשראי 1234')).toEqual(['1234'])
  })

  it('is not fooled by an asmachta, which has no four-digit group of its own', () => {
    // Seven overlapping four-digit substrings and no card in any of them. A run
    // counts only when the run itself is four long.
    expect(last4sIn('העברה 0123456789')).toEqual([])
  })

  it('ignores a date, whose parts are two digits each', () => {
    expect(last4sIn('חיוב 15/07 כרטיס 5678')).toEqual(['5678'])
  })

  it('returns every candidate once, in the order the bank wrote them', () => {
    expect(last4sIn('כרטיס 1234 / 5678 / 1234')).toEqual(['1234', '5678'])
  })

  it('reads the raw description, because normalization eats the digits', () => {
    // The trap this whole mechanism nearly walked into: `normalizeMerchant`
    // strips a trailing run of one to five digits as a branch number, so by the
    // time a row is staged the four digits are gone from the normalized name.
    expect(normalizeMerchant('כרטיס אשראי 1234')).toBe('כרטיס אשראי')
    expect(last4sIn(normalizeMerchant('כרטיס אשראי 1234'))).toEqual([])
  })
})

describe('classifyRow', () => {
  const outflow = -10_000
  const inflow = 10_000

  it.each([
    ['כרטיס אשראי 1234', outflow, 'CARD_SETTLEMENT'],
    ['ויזה כאל', outflow, 'CARD_SETTLEMENT'],
    ['משכורת חודש יולי', inflow, 'SALARY'],
    ['החזר הלוואה', outflow, 'LOAN_PAYMENT'],
    ['הוראת קבע חשמל', outflow, 'DIRECT_DEBIT'],
    ['שיק 4471', outflow, 'CHEQUE'],
    ['עמלת ניהול חשבון', outflow, 'FEE'],
    ['ריבית זכות', inflow, 'INTEREST'],
    ['העברה עצמית לחיסכון', outflow, 'INTERNAL_TRANSFER'],
    ['סופר פארם', outflow, 'OTHER_OUTFLOW'],
    ['החזר מס הכנסה', inflow, 'OTHER_INFLOW'],
  ])('reads %s as %s', (description, minor, expected) => {
    expect(classifyRow(normalizeMerchant(description), money(minor, ILS))).toBe(expected)
  })

  it('does not read rehabilitation as a cheque', () => {
    // `שיק` is a whole word or it is nothing. A substring test cannot tell a
    // cheque from `שיקום`, which is why single words are matched as tokens.
    expect(classifyRow(normalizeMerchant('מרכז שיקום'), money(outflow, ILS))).toBe('OTHER_OUTFLOW')
  })

  it('reads a mortgage paid by standing order as a loan payment', () => {
    // Both keywords match. The order of the table is the classification, and a
    // debt F08 can track is worth more than the mechanism that paid it.
    expect(classifyRow(normalizeMerchant('הוראת קבע משכנתא'), money(outflow, ILS))).toBe(
      'LOAN_PAYMENT',
    )
  })

  it('does not call a salary the user paid out an incoming salary', () => {
    expect(classifyRow(normalizeMerchant('משכורת עובד'), money(outflow, ILS))).toBe('OTHER_OUTFLOW')
  })

  it('does not call a refund from a card issuer a settlement', () => {
    expect(classifyRow(normalizeMerchant('זיכוי ויזה 1234'), money(inflow, ILS))).toBe(
      'OTHER_INFLOW',
    )
  })
})

describe('planBankImport', () => {
  it('matches a settlement to its card and corroborates the amount', () => {
    const plan = planBankImport({
      rows: [row('כרטיס אשראי 1234', -421_055)],
      cards: [card('cal', '1234')],
      cardPeriodTotals: [statement('cal', JULY, 421_055)],
    })

    expect(plan.settlements).toHaveLength(1)
    expect(plan.settlements[0]).toMatchObject({
      cardAccountId: 'cal',
      last4: '1234',
      confidence: 'HIGH',
      billingPeriod: JULY,
      decision: 'PENDING',
    })
    expect(plan.rows[0]?.rowClass).toBe('CARD_SETTLEMENT')
  })

  it('matches on the last-4 alone when no statement agrees, and says so', () => {
    const plan = planBankImport({
      rows: [row('כרטיס אשראי 1234', -421_055)],
      cards: [card('cal', '1234')],
      cardPeriodTotals: [statement('cal', JULY, 999_999)],
    })

    expect(plan.settlements[0]?.confidence).toBe('MEDIUM')
    expect(plan.settlements[0]?.billingPeriod).toBeUndefined()
  })

  it('sums a card charged twice in a month before comparing it to the statement', () => {
    // docs/f06's split charge. ₪2,400 and ₪1,810.55 each disagree with the
    // statement; together they are it. Comparing row by row would report two
    // failures where there is one reconciliation.
    const plan = planBankImport({
      rows: [
        row('כרטיס אשראי 1234', -240_000, localDate(2026, 7, 2)),
        row('כרטיס אשראי 1234', -181_055, localDate(2026, 7, 10)),
      ],
      cards: [card('cal', '1234')],
      cardPeriodTotals: [statement('cal', JULY, 421_055)],
    })

    expect(plan.settlements).toHaveLength(1)
    expect(plan.settlements[0]?.rows).toHaveLength(2)
    expect(plan.settlements[0]?.chargedTotal).toEqual(money(421_055, ILS))
    expect(plan.settlements[0]?.confidence).toBe('HIGH')
  })

  it('keeps two months of one card apart', () => {
    const plan = planBankImport({
      rows: [
        row('כרטיס אשראי 1234', -100_000, localDate(2026, 6, 10)),
        row('כרטיס אשראי 1234', -421_055, localDate(2026, 7, 10)),
      ],
      cards: [card('cal', '1234')],
      cardPeriodTotals: [statement('cal', JUNE, 100_000), statement('cal', JULY, 421_055)],
    })

    expect(plan.settlements).toHaveLength(2)
    expect(plan.settlements.map((group) => group.billingPeriod)).toEqual([JUNE, JULY])
    expect(plan.settlements.every((group) => group.confidence === 'HIGH')).toBe(true)
  })

  it('flags a card charge whose card this document does not have', () => {
    // The case docs/f06 says matters more than a match: a month of card spending
    // is missing from the ledger and every statistic is quietly wrong.
    const plan = planBankImport({
      rows: [row('כרטיס אשראי 9012', -89_020)],
      cards: [card('cal', '1234')],
      cardPeriodTotals: [],
    })

    expect(plan.settlements).toHaveLength(0)
    expect(plan.unmatched).toEqual([
      expect.objectContaining({ last4: '9012', chargedTotal: money(89_020, ILS) }),
    ])
    expect(plan.rows[0]?.rowClass).toBe('CARD_SETTLEMENT')
  })

  it('falls back to the amount when the bank omitted the card number, at low confidence', () => {
    const plan = planBankImport({
      rows: [row('חיוב כרטיס אשראי', -421_055)],
      cards: [card('cal', '1234')],
      cardPeriodTotals: [statement('cal', JULY, 421_055)],
    })

    expect(plan.settlements[0]).toMatchObject({
      cardAccountId: 'cal',
      confidence: 'HIGH',
      last4: undefined,
    })
  })

  it('will not attribute a card charge to a statement from last spring', () => {
    // An equal amount is a fact about two numbers, not about the row. Without
    // the date window a corroboration becomes a coincidence.
    const plan = planBankImport({
      rows: [row('חיוב כרטיס אשראי', -421_055, localDate(2026, 7, 10))],
      cards: [card('cal', '1234')],
      cardPeriodTotals: [statement('cal', { year: 2026, month: 3 }, 421_055)],
    })

    expect(plan.settlements).toHaveLength(0)
    expect(plan.unmatched[0]?.last4).toBeUndefined()
  })

  it('carries the remembered answer through as the decision', () => {
    const plan = planBankImport({
      rows: [row('כרטיס אשראי 1234', -100_000), row('כרטיס אשראי 5678', -50_000)],
      cards: [card('cal', '1234', true), card('max', '5678', false)],
      cardPeriodTotals: [],
    })

    const decisions = Object.fromEntries(
      plan.settlements.map((group) => [group.cardAccountId, group.decision]),
    )
    expect(decisions).toEqual({ cal: 'EXCLUDED', max: 'KEPT' })
  })

  it('classifies without writing anything down, so a later card statement changes the answer', () => {
    // docs/f06: order of import must not matter. The same row read against a
    // document that has since gained the card comes out differently, which is a
    // property of re-deriving rather than of a rescan that has to be remembered.
    const rows = [row('כרטיס אשראי 1234', -421_055)]
    const before = planBankImport({ rows, cards: [], cardPeriodTotals: [] })
    const after = planBankImport({
      rows,
      cards: [card('cal', '1234')],
      cardPeriodTotals: [statement('cal', JULY, 421_055)],
    })

    expect(before.unmatched).toHaveLength(1)
    expect(before.settlements).toHaveLength(0)
    expect(after.unmatched).toHaveLength(0)
    expect(after.settlements[0]?.confidence).toBe('HIGH')
  })

  describe('when the user has said which card a merchant pays', () => {
    const aliases = new Map([['חיוב חודשי', 'cal']])

    it('makes a settlement of a row no keyword names', () => {
      // The whole point: this wording is in no keyword list and carries no card
      // number, so without the alias it is an ordinary outflow and the month is
      // counted twice.
      const plain = planBankImport({
        rows: [row('חיוב חודשי', -421_055)],
        cards: [card('cal', '1234')],
        cardPeriodTotals: [],
      })
      expect(plain.settlements).toHaveLength(0)
      expect(plain.rows[0]?.rowClass).toBe('OTHER_OUTFLOW')

      const stated = planBankImport({
        rows: [row('חיוב חודשי', -421_055)],
        cards: [card('cal', '1234')],
        cardPeriodTotals: [],
        settlementAliases: aliases,
      })

      expect(stated.settlements).toHaveLength(1)
      expect(stated.settlements[0]).toMatchObject({
        cardAccountId: 'cal',
        confidence: 'MEDIUM',
        isUserStated: true,
      })
      expect(stated.rows[0]?.rowClass).toBe('CARD_SETTLEMENT')
    })

    it('still lets the amount corroborate it', () => {
      // "The user said so" and "the arithmetic agrees" are different claims, and
      // the second one still raises the confidence.
      const plan = planBankImport({
        rows: [row('חיוב חודשי', -421_055)],
        cards: [card('cal', '1234')],
        cardPeriodTotals: [statement('cal', JULY, 421_055)],
        settlementAliases: aliases,
      })

      expect(plan.settlements[0]?.confidence).toBe('HIGH')
      expect(plan.settlements[0]?.billingPeriod).toEqual(JULY)
      expect(plan.settlements[0]?.isUserStated).toBe(true)
    })

    it('covers every occurrence of the merchant, past and future', () => {
      const plan = planBankImport({
        rows: [
          row('חיוב חודשי', -300_000, localDate(2026, 6, 10)),
          row('חיוב חודשי', -421_055, localDate(2026, 7, 10)),
        ],
        cards: [card('cal', '1234')],
        cardPeriodTotals: [],
        settlementAliases: aliases,
      })

      // Two months are two settlements, as they are for a detected one.
      expect(plan.settlements).toHaveLength(2)
    })

    it('leaves a refund from the card company alone', () => {
      // Money coming back settles nothing, which is the guard `classifyRow`
      // already puts on this class. An alias must not talk its way past it.
      const plan = planBankImport({
        rows: [row('חיוב חודשי', 25_000)],
        cards: [card('cal', '1234')],
        cardPeriodTotals: [],
        settlementAliases: aliases,
      })

      expect(plan.settlements).toHaveLength(0)
      expect(plan.rows[0]?.rowClass).toBe('OTHER_INFLOW')
    })

    it('ignores an alias pointing at a card the document no longer has', () => {
      const plan = planBankImport({
        rows: [row('חיוב חודשי', -421_055)],
        cards: [card('max', '9999')],
        cardPeriodTotals: [],
        settlementAliases: aliases,
      })

      expect(plan.settlements).toHaveLength(0)
      expect(plan.rows[0]?.rowClass).toBe('OTHER_OUTFLOW')
    })

    it('says the app worked it out on its own when it did', () => {
      const plan = planBankImport({
        rows: [row('כרטיס אשראי 1234', -421_055)],
        cards: [card('cal', '1234')],
        cardPeriodTotals: [statement('cal', JULY, 421_055)],
        settlementAliases: aliases,
      })

      expect(plan.settlements[0]?.isUserStated).toBe(false)
    })
  })
})

describe('bankSpendingBasis', () => {
  const groceries = row('סופר פארם', -20_000)

  it('leaves an excluded settlement out of the total', () => {
    const plan = planBankImport({
      rows: [groceries, row('כרטיס אשראי 1234', -421_055)],
      cards: [card('cal', '1234', true)],
      cardPeriodTotals: [statement('cal', JULY, 421_055)],
    })

    const basis = bankSpendingBasis(plan, ILS)
    expect(basis.total).toEqual(money(-20_000, ILS))
    expect(basis.excludedSettlements).toHaveLength(1)
    expect(basis.counted).toHaveLength(1)
  })

  it('leaves an undecided settlement out too, which is the direction that cannot double', () => {
    const plan = planBankImport({
      rows: [groceries, row('כרטיס אשראי 1234', -421_055)],
      cards: [card('cal', '1234')],
      cardPeriodTotals: [statement('cal', JULY, 421_055)],
    })

    const basis = bankSpendingBasis(plan, ILS)
    expect(basis.total).toEqual(money(-20_000, ILS))
    expect(basis.undecidedSettlements).toHaveLength(1)
    expect(basis.excludedSettlements).toHaveLength(0)
  })

  it('counts a settlement the user chose to keep, and still names the card to invert', () => {
    const plan = planBankImport({
      rows: [groceries, row('כרטיס אשראי 1234', -421_055)],
      cards: [card('cal', '1234', false)],
      cardPeriodTotals: [statement('cal', JULY, 421_055)],
    })

    const basis = bankSpendingBasis(plan, ILS)
    expect(basis.total).toEqual(money(-441_055, ILS))
    // docs/f06's inversion: the card's own transactions for this period are what
    // must come out instead, and the group says which card and which period.
    expect(plan.settlements[0]).toMatchObject({ cardAccountId: 'cal', billingPeriod: JULY })
  })

  it('counts a card charge it could not attribute, because nothing else has counted it', () => {
    const plan = planBankImport({
      rows: [row('כרטיס אשראי 9012', -89_020)],
      cards: [],
      cardPeriodTotals: [],
    })

    expect(bankSpendingBasis(plan, ILS).total).toEqual(money(-89_020, ILS))
  })

  it('keeps salary and internal transfers out of spending, and shows them', () => {
    const plan = planBankImport({
      rows: [groceries, row('משכורת', 1_200_000), row('העברה עצמית לחיסכון', -100_000)],
      cards: [],
      cardPeriodTotals: [],
    })

    const basis = bankSpendingBasis(plan, ILS)
    expect(basis.total).toEqual(money(-20_000, ILS))
    expect(basis.notSpending.map((entry) => entry.rowClass)).toEqual(['SALARY', 'INTERNAL_TRANSFER'])
  })

  it('lists a row in another currency rather than converting it', () => {
    const foreign: BankRow = { ...row('AMAZON', -5_000), amount: money(-5_000, 'USD') }
    const plan = planBankImport({ rows: [groceries, foreign], cards: [], cardPeriodTotals: [] })

    const basis = bankSpendingBasis(plan, ILS)
    expect(basis.total).toEqual(money(-20_000, ILS))
    expect(basis.otherCurrency).toEqual([foreign])
  })

  it('totals to zero on an empty import rather than throwing', () => {
    const plan = planBankImport({ rows: [], cards: [], cardPeriodTotals: [] })
    expect(bankSpendingBasis(plan, ILS).total).toEqual(money(0, ILS))
  })
})

describe('verifyRunningBalance', () => {
  it('verifies an oldest-first file and reports the two ends', () => {
    const check = verifyRunningBalance([
      row('פתיחה', -10_000, localDate(2026, 7, 1), 990_000),
      row('שכירות', -500_000, localDate(2026, 7, 2), 490_000),
      row('משכורת', 1_200_000, localDate(2026, 7, 3), 1_690_000),
    ])

    expect(check).toEqual({
      kind: 'VERIFIED',
      order: 'OLDEST_FIRST',
      openingBalance: money(1_000_000, ILS),
      closingBalance: money(1_690_000, ILS),
      rowCount: 3,
    })
  })

  it('verifies the same file exported newest-first', () => {
    const check = verifyRunningBalance([
      row('משכורת', 1_200_000, localDate(2026, 7, 3), 1_690_000),
      row('שכירות', -500_000, localDate(2026, 7, 2), 490_000),
      row('פתיחה', -10_000, localDate(2026, 7, 1), 990_000),
    ])

    expect(check).toMatchObject({
      kind: 'VERIFIED',
      order: 'NEWEST_FIRST',
      openingBalance: money(1_000_000, ILS),
      closingBalance: money(1_690_000, ILS),
    })
  })

  it('holds the sentence it exists for: opening plus every amount is the closing balance', () => {
    const rows = [
      row('א', -10_000, localDate(2026, 7, 1), 990_000),
      row('ב', -500_000, localDate(2026, 7, 2), 490_000),
      row('ג', 1_200_000, localDate(2026, 7, 3), 1_690_000),
    ]
    const check = verifyRunningBalance(rows)
    if (check.kind !== 'VERIFIED') throw new Error('expected a verified check')

    const summed = rows.reduce((total, entry) => total + entry.amount.minor, check.openingBalance.minor)
    expect(summed).toBe(check.closingBalance.minor)
  })

  it('names the first row where the arithmetic and the file disagree', () => {
    const check = verifyRunningBalance([
      row('א', -10_000, localDate(2026, 7, 1), 990_000),
      row('ב', -500_000, localDate(2026, 7, 2), 490_000),
      // A thousands separator read as a decimal point: the file says the balance
      // dropped by ₪5,000 and the parse read ₪50.
      row('ג', -5_000, localDate(2026, 7, 3), -10_000),
    ])

    expect(check).toEqual({
      kind: 'DIVERGED',
      order: 'OLDEST_FIRST',
      at: {
        ref: 'Sheet1!' + String(nextRef),
        expected: money(485_000, ILS),
        stated: money(-10_000, ILS),
        difference: money(-495_000, ILS),
        verifiedBefore: 1,
      },
    })
  })

  it('catches every amount sign-flipped, which is the mapping error it is for', () => {
    // A `credit` column pointed at the debits: the file's balance falls and the
    // parse says it rose. Nothing else in the import would notice — the totals
    // are all the right size.
    const check = verifyRunningBalance([
      row('א', 500_000, localDate(2026, 7, 1), 500_000),
      row('ב', 200_000, localDate(2026, 7, 2), 300_000),
      row('ג', 100_000, localDate(2026, 7, 3), 200_000),
    ])

    expect(check.kind).toBe('DIVERGED')
  })

  it('cannot tell two equal amounts apart from the same file reversed', () => {
    // The known limit, pinned rather than left to be discovered. Reading the
    // chain from the other end rescues a sign flip exactly when every
    // consecutive pair of amounts is equal, which needs a two-row statement of
    // identical amounts. A third distinct amount ends it — the test above.
    const check = verifyRunningBalance([
      row('א', 500_000, localDate(2026, 7, 1), 1_000_000),
      row('ב', 500_000, localDate(2026, 7, 2), 500_000),
    ])

    expect(check).toMatchObject({ kind: 'VERIFIED', order: 'NEWEST_FIRST' })
  })

  it('says nothing when the file has no balance column', () => {
    const check = verifyRunningBalance([row('א', -10_000), row('ב', -20_000)])
    expect(check).toEqual({ kind: 'UNAVAILABLE', reason: 'NO_BALANCE_COLUMN' })
  })

  it('refuses to verify a chain with a hole in it', () => {
    // A check that skipped a row is not a check.
    const check = verifyRunningBalance([
      row('א', -10_000, localDate(2026, 7, 1), 990_000),
      row('ב', -500_000, localDate(2026, 7, 2)),
      row('ג', 1_200_000, localDate(2026, 7, 3), 1_690_000),
    ])
    expect(check).toEqual({ kind: 'UNAVAILABLE', reason: 'INCOMPLETE' })
  })

  it('has nothing to chain with one row', () => {
    const check = verifyRunningBalance([row('א', -10_000, localDate(2026, 7, 1), 990_000)])
    expect(check).toEqual({ kind: 'UNAVAILABLE', reason: 'TOO_FEW_ROWS' })
  })

  it('will not mix currencies rather than throwing on the first addition', () => {
    const shekels = row('א', -10_000, localDate(2026, 7, 1), 990_000)
    const dollars: BankRow = {
      ...row('ב', -20_000, localDate(2026, 7, 2), 970_000),
      amount: money(-20_000, 'USD'),
    }
    expect(verifyRunningBalance([shekels, dollars])).toEqual({
      kind: 'UNAVAILABLE',
      reason: 'MIXED_CURRENCY',
    })
  })
})

describe('matchSalaries', () => {
  const ils = (minor: number) => money(minor, ILS)

  /** A salary deposit, classified the way the importer would classify it. */
  function salary(minor: number, date: LocalDate) {
    const bankRow = row('משכורת חברת אקמי', minor, date)
    return { row: bankRow, rowClass: 'SALARY' as const }
  }

  function slip(id: string, period: YearMonth, net: number) {
    return { id, period, net: ils(net) }
  }

  it('matches a deposit against the payslip it paid, a month back', () => {
    const groups = matchSalaries({
      // Paid on the ninth of August for the July slip — the Israeli norm.
      rows: [salary(1_500_000, localDate(2026, 8, 9))],
      paychecks: [slip('pay-july', JULY, 1_500_000)],
      currency: ILS,
    })

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      verdict: 'MATCHED',
      paycheckId: 'pay-july',
      paycheckPeriod: JULY,
      total: ils(1_500_000),
      difference: ils(0),
      decision: 'PENDING',
    })
  })

  it('matches one paid inside its own month just as well', () => {
    const groups = matchSalaries({
      rows: [salary(1_500_000, localDate(2026, 7, 31))],
      paychecks: [slip('pay-july', JULY, 1_500_000)],
      currency: ILS,
    })

    expect(groups[0]?.verdict).toBe('MATCHED')
  })

  it('sums two deposits in one month before comparing', () => {
    const groups = matchSalaries({
      rows: [salary(1_000_000, localDate(2026, 8, 9)), salary(500_000, localDate(2026, 8, 20))],
      paychecks: [slip('pay-july', JULY, 1_500_000)],
      currency: ILS,
    })

    expect(groups).toHaveLength(1)
    expect(groups[0]?.rows).toHaveLength(2)
    expect(groups[0]?.verdict).toBe('MATCHED')
  })

  it('surfaces a disagreement rather than picking a figure', () => {
    const groups = matchSalaries({
      rows: [salary(1_512_000, localDate(2026, 8, 9))],
      paychecks: [slip('pay-july', JULY, 1_500_000)],
      currency: ILS,
    })

    expect(groups[0]).toMatchObject({
      verdict: 'DIFFERS',
      net: ils(1_500_000),
      total: ils(1_512_000),
      // Positive: more arrived than the slip accounts for.
      difference: ils(12_000),
    })
  })

  it('prefers the payslip whose net the deposit equals, whichever month it is for', () => {
    const groups = matchSalaries({
      rows: [salary(1_400_000, localDate(2026, 8, 9))],
      // August's slip is closer in time; July's is the one that matches to the agora.
      paychecks: [slip('pay-aug', { year: 2026, month: 8 }, 1_390_000), slip('pay-july', JULY, 1_400_000)],
      currency: ILS,
    })

    expect(groups[0]).toMatchObject({ verdict: 'MATCHED', paycheckId: 'pay-july' })
  })

  it('does not let a deposit with no slip take the next month slip and put every month one out (D-317)', () => {
    const groups = matchSalaries({
      // December's pay (no December slip), then January's, February's: each exact.
      rows: [
        salary(1_184_100, localDate(2026, 1, 4)),
        salary(1_600_000, localDate(2026, 2, 9)),
        salary(1_401_300, localDate(2026, 3, 4)),
      ],
      paychecks: [
        slip('pay-jan', { year: 2026, month: 1 }, 1_600_000),
        slip('pay-feb', { year: 2026, month: 2 }, 1_401_300),
      ],
      currency: ILS,
    })

    expect(groups.map((group) => [group.verdict, group.paycheckId])).toEqual([
      ['NO_PAYCHECK', undefined],
      ['MATCHED', 'pay-jan'],
      ['MATCHED', 'pay-feb'],
    ])
  })

  it('lets one payslip be claimed by one month only', () => {
    const groups = matchSalaries({
      rows: [salary(1_500_000, localDate(2026, 7, 9)), salary(1_500_000, localDate(2026, 8, 9))],
      paychecks: [slip('pay-june', JUNE, 1_500_000)],
      currency: ILS,
    })

    expect(groups.map((group) => group.verdict)).toEqual(['MATCHED', 'NO_PAYCHECK'])
    expect(groups[1]?.paycheckId).toBeUndefined()
  })

  it('says nothing about money leaving the account', () => {
    const groups = matchSalaries({
      rows: [{ row: row('משכורת', -1_500_000, localDate(2026, 8, 9)), rowClass: 'SALARY' as const }],
      paychecks: [slip('pay-july', JULY, 1_500_000)],
      currency: ILS,
    })

    expect(groups).toEqual([])
  })

  it('carries the answer the user already gave', () => {
    const groups = matchSalaries({
      rows: [salary(1_500_000, localDate(2026, 8, 9))],
      paychecks: [slip('pay-july', JULY, 1_500_000)],
      currency: ILS,
      decisions: new Map([['2026-08', 'EXCLUDED' as const]]),
    })

    expect(groups[0]?.decision).toBe('EXCLUDED')
    // Answered and matching: nothing left to ask about.
    expect(salaryQuestions(groups)).toEqual([])
  })

  it('takes a deposit the person filed as salary whatever its text says (D-317)', () => {
    const clearingHouse = { row: row('העברה מאקמי', 1_500_000, localDate(2026, 5, 3)), rowClass: 'OTHER_INFLOW' as const }
    const input = { rows: [clearingHouse], paychecks: [slip('pay-april', { year: 2026, month: 4 }, 1_500_000)], currency: ILS }

    expect(matchSalaries(input)).toEqual([])
    const groups = matchSalaries({ ...input, filedAsSalary: new Set([clearingHouse.row.ref]) })
    expect(groups[0]).toMatchObject({ verdict: 'MATCHED', paycheckId: 'pay-april' })
  })

  it('picks, between two slips of one net, the one paid nearest the deposit', () => {
    const groups = matchSalaries({
      rows: [salary(1_600_000, localDate(2026, 4, 5))],
      paychecks: [
        { ...slip('pay-jan', { year: 2026, month: 3 }, 1_600_000), paidOn: localDate(2026, 2, 9) },
        { ...slip('pay-mar', { year: 2026, month: 4 }, 1_600_000), paidOn: localDate(2026, 4, 5) },
      ],
      currency: ILS,
    })

    expect(groups[0]?.paycheckId).toBe('pay-mar')
  })

  it('counts a deposit only when the person says so or no slip accounts for it (D-317)', () => {
    const base = { period: JULY, rows: [], total: ils(1), paycheckId: undefined, paycheckPeriod: undefined, net: undefined, difference: undefined }
    expect(salaryDepositCounts({ ...base, verdict: 'MATCHED', decision: 'PENDING' })).toBe(false)
    expect(salaryDepositCounts({ ...base, verdict: 'DIFFERS', decision: 'PENDING' })).toBe(false)
    expect(salaryDepositCounts({ ...base, verdict: 'NO_PAYCHECK', decision: 'PENDING' })).toBe(true)
    expect(salaryDepositCounts({ ...base, verdict: 'MATCHED', decision: 'COUNTED' })).toBe(true)
  })

  it('keeps asking about a disagreement even once it is answered', () => {
    const groups = matchSalaries({
      rows: [salary(1_512_000, localDate(2026, 8, 9))],
      paychecks: [slip('pay-july', JULY, 1_500_000)],
      currency: ILS,
      decisions: new Map([['2026-08', 'EXCLUDED' as const]]),
    })

    expect(salaryQuestions(groups)).toHaveLength(1)
  })
})
