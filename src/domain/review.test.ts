import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import type { DeductionType, PayslipReading } from '@/domain/model/paycheck.ts'

import { isReadable, proposeDeductionType, reviewPayslip } from './review.ts'

const ILS = 'ILS'

function type(id: string, name: string, hebrewName?: string): DeductionType {
  return {
    id,
    name,
    hebrewName,
    kind: 'TAX',
    reducesNet: true,
    countsAsSaving: false,
    linkedSavingGoalId: undefined,
    linkedDebtId: undefined,
    linkedFundId: undefined,
    isBuiltIn: true,
    sortOrder: 0,
  }
}

const TYPES: readonly DeductionType[] = [
  type('ded:income-tax', 'Income tax', 'מס הכנסה'),
  type('ded:pension', 'Pension', 'פנסיה'),
  type('ded:union', 'Union dues'),
]

/** A slip that agrees with itself: 24,500 − 6,512.50 − 17,987.50 = 0. */
function reading(overrides: Partial<PayslipReading> = {}): PayslipReading {
  return {
    gross: money(2_450_000, ILS),
    net: money(1_798_750, ILS),
    statedDeductionsTotal: money(651_250, ILS),
    salaryMonth: { year: 2026, month: 7 },
    payDate: localDate(2026, 8, 1),
    deductions: [
      { field: 'deduction[0]', line: 21, label: 'מס הכנסה', employee: money(398_050, ILS) },
      {
        field: 'deduction[1]',
        line: 24,
        label: 'פנסיה',
        employee: money(147_000, ILS),
        employer: money(159_250, ILS),
        basis: money(2_450_000, ILS),
      },
      { field: 'deduction[2]', line: 27, label: 'דמי ועד', employee: money(106_200, ILS) },
    ],
    lines: { grossLine: 8, netLine: 30, employeeDeductionsTotalLine: 28 },
    unresolved: [],
    borrowed: [],
    delta: money(0, ILS),
    statedTotalDelta: money(0, ILS),
    reconciles: true,
    ...overrides,
  }
}

/**
 * A reading with a field taken off it.
 *
 * `exactOptionalPropertyTypes` means an absent field and a field holding
 * `undefined` are different types, and this file cares about exactly that
 * distinction — so a test for "the slip printed no total" has to actually
 * remove the key rather than set it to nothing.
 */
function without(base: PayslipReading, ...keys: readonly (keyof PayslipReading)[]): PayslipReading {
  const copy: Record<string, unknown> = { ...base }
  for (const key of keys) delete copy[key]
  return copy as unknown as PayslipReading
}

describe('proposeDeductionType', () => {
  it('matches the Hebrew name the slip prints', () => {
    expect(proposeDeductionType('מס הכנסה', TYPES)).toBe('ded:income-tax')
  })

  it('matches an English name for a type the user typed themselves', () => {
    expect(proposeDeductionType('Union dues', TYPES)).toBe('ded:union')
  })

  it('will not match a longer label that merely starts the same way', () => {
    // `פנסיה` and `פנסיה מעסיק` are two lines on one slip. A match that bridged
    // them puts the employer's contribution where the employee's goes, and
    // reconciles while doing it.
    expect(proposeDeductionType('פנסיה מעסיק', TYPES)).toBeUndefined()
  })

  it('proposes nothing for a label the document has no type for', () => {
    expect(proposeDeductionType('החזר הלוואה', TYPES)).toBeUndefined()
  })
})

describe('what the slip proved', () => {
  it('vouches for gross, net and the total when both checks passed', () => {
    const review = reviewPayslip(reading(), TYPES)

    expect(review.reconciles).toBe(true)
    expect(review.figures.map((figure) => figure.field)).toEqual([
      'grossLine',
      'employeeDeductionsTotalLine',
      'netLine',
    ])
    expect(review.figures.every((figure) => figure.proved)).toBe(true)
    expect(review.checks.every((check) => check.passed)).toBe(true)
  })

  it('vouches for nothing at all when one check failed', () => {
    // Not "demote the figure that is wrong" — the equations are over all three
    // at once, so a failure says nothing about which of them moved.
    const review = reviewPayslip(
      reading({ delta: money(-4_500, ILS), reconciles: false }),
      TYPES,
    )

    // Still shown — a person is here to look at them — and vouched for by nothing.
    expect(review.figures).toHaveLength(3)
    expect(review.figures.some((figure) => figure.proved)).toBe(false)
    expect(review.doubts[0]?.field).toBe('delta')
    expect(review.doubts[0]?.message).toContain('₪')
  })

  it('does not read a missing check as a passing one', () => {
    const review = reviewPayslip(
      without(reading({ reconciles: false }), 'statedDeductionsTotal', 'statedTotalDelta'),
      TYPES,
    )

    const stated = review.checks[1]
    expect(stated?.delta).toBeUndefined()
    expect(stated?.passed).toBe(false)
    expect(review.doubts.some((doubt) => doubt.message.includes('only one of the two checks'))).toBe(
      true,
    )
  })

  it('never puts a deduction line among the proved figures', () => {
    // The total is proved; a line moved into the next row leaves it untouched.
    const review = reviewPayslip(reading(), TYPES)
    expect(review.figures.some((figure) => figure.field.startsWith('deduction'))).toBe(false)
  })
})

describe('what a person has to look at', () => {
  it('always names the employer total, because no equation touches it', () => {
    const review = reviewPayslip(reading(), TYPES)

    expect(review.employerTotal).toEqual(money(159_250, ILS))
    const doubt = review.doubts.find((entry) => entry.field === 'employerTotal')
    expect(doubt?.message).toContain('₪1,592.50')
    expect(doubt?.message).toContain('Nothing on the slip')
  })

  it('says so when it could not name a deduction line, and counts them', () => {
    const review = reviewPayslip(reading(), TYPES)

    expect(review.rows.map((row) => row.deductionTypeId)).toEqual([
      'ded:income-tax',
      'ded:pension',
      undefined,
    ])
    const doubt = review.doubts.find((entry) => entry.field === 'deductionTypes')
    expect(doubt?.message).toContain('One line has')
    expect(doubt?.message).toContain('read them the same way every month')
  })

  it('carries a row’s dash across as an absent amount, not a zero', () => {
    const review = reviewPayslip(
      reading({
        deductions: [
          { field: 'deduction[0]', line: 26, label: 'פיצויים', employer: money(204_085, ILS) },
        ],
        reconciles: false,
      }),
      TYPES,
    )

    expect(review.rows[0]?.employee).toBeUndefined()
    expect(review.rows[0]?.employer).toEqual(money(204_085, ILS))
  })

  it('reports a field the template named and the slip did not have', () => {
    const review = reviewPayslip(
      reading({ unresolved: [{ field: 'deduction[3]', reason: 'no line reads “ניכוי הלוואה”' }] }),
      TYPES,
    )

    const doubt = review.doubts.find((entry) => entry.field === 'deduction[3]')
    expect(doubt?.message).toBe('Deduction line 4: no line reads “ניכוי הלוואה”.')
  })

  it('asks for the month rather than guessing one', () => {
    const review = reviewPayslip(without(reading(), 'salaryMonth'), TYPES)

    expect(review.salaryMonth).toBeUndefined()
    expect(review.doubts.some((doubt) => doubt.field === 'salaryMonthLine')).toBe(true)
  })

  it('has nothing to say about a slip that read cleanly and named everything', () => {
    const clean = reviewPayslip(
      reading({
        deductions: [
          { field: 'deduction[0]', line: 21, label: 'מס הכנסה', employee: money(651_250, ILS) },
        ],
      }),
      TYPES,
    )

    expect(clean.doubts).toEqual([])
  })
})

describe('a row this format has already been named', () => {
  /** The case D-145 exists for: an employer's own wording for a fund. */
  const employerWording = reading({
    deductions: [
      { field: 'deduction[0]', line: 21, label: 'מס הכנסה', employee: money(398_050, ILS) },
      { field: 'deduction[1]', line: 24, label: 'פנסיה אלפא מקיפה', employee: money(253_200, ILS) },
    ],
    reconciles: false,
  })

  it('asks about a label no deduction type matches', () => {
    const review = reviewPayslip(employerWording, TYPES)

    expect(review.rows[1]?.deductionTypeId).toBeUndefined()
    expect(review.doubts.some((doubt) => doubt.field === 'deductionTypes')).toBe(true)
  })

  it('stops asking once the format says what that row is', () => {
    const review = reviewPayslip(
      employerWording,
      TYPES,
      ILS,
      new Map([['deduction[1]', 'ded:pension']]),
    )

    expect(review.rows[1]?.deductionTypeId).toBe('ded:pension')
    expect(review.doubts.some((doubt) => doubt.field === 'deductionTypes')).toBe(false)
  })

  it('asks again when the named type has since been deleted', () => {
    const review = reviewPayslip(
      employerWording,
      TYPES,
      ILS,
      new Map([['deduction[1]', 'ded:gone']]),
    )

    expect(review.rows[1]?.deductionTypeId).toBeUndefined()
  })

  it('never lets a naming reach a row the exact match already answered', () => {
    // `deduction[0]` is `מס הכנסה`, which the vocabulary names outright. A
    // naming keyed to a different row must not travel to it.
    const review = reviewPayslip(
      employerWording,
      TYPES,
      ILS,
      new Map([['deduction[1]', 'ded:pension']]),
    )

    expect(review.rows[0]?.deductionTypeId).toBe('ded:income-tax')
  })

  it('keys a row by its anchor rather than by its place in the array', () => {
    // One anchor resolved to nothing, so the second reading is `deduction[2]`.
    // Keyed by position, this naming would land on the wrong line.
    const review = reviewPayslip(
      reading({
        deductions: [
          { field: 'deduction[0]', line: 21, label: 'מס הכנסה', employee: money(398_050, ILS) },
          { field: 'deduction[2]', line: 27, label: 'פנסיה אלפא מקיפה', employee: money(253_200, ILS) },
        ],
        reconciles: false,
      }),
      TYPES,
      ILS,
      new Map([['deduction[2]', 'ded:pension']]),
    )

    expect(review.rows[1]?.deductionTypeId).toBe('ded:pension')
  })
})

describe('a label that is not a word', () => {
  it('marks a row whose font asserts the wrong Unicode for its own glyphs', () => {
    const review = reviewPayslip(
      reading({
        deductions: [
          { field: 'deduction[0]', line: 47, label: 'ª»«¬ª »≈', employee: money(418_000, ILS) },
          { field: 'deduction[1]', line: 48, label: 'מס הכנסה', employee: money(233_250, ILS) },
        ],
      }),
      TYPES,
    )

    expect(review.rows.map((row) => row.labelIsReadable)).toEqual([false, true])
    // The raw text is kept: it is what the template anchors to, and it matches
    // exactly month to month even though nobody can read it.
    expect(review.rows[0]?.label).toBe('ª»«¬ª »≈')
  })

  it('reads an ordinary label, symbols and all', () => {
    expect(isReadable('סה"כ ניכויי עובד')).toBe(true)
    expect(isReadable('Union dues (₪)')).toBe(true)
    expect(isReadable('—')).toBe(true)
    expect(isReadable('ª»«¬ª »≈')).toBe(false)
  })
})
