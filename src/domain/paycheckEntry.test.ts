import { describe, expect, it } from 'vitest'

import { money, zero } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import type { DeductionType, PaycheckWithLines } from '@/domain/model/paycheck.ts'
import {
  blankDraft,
  blankLine,
  copiedFrom,
  defaultFlags,
  flagsAsGuessed,
  guessDestination,
  kindChange,
  draftDelta,
  draftEntry,
  draftFrom,
  draftProblems,
  grossToNet,
  pickerGroups,
  recentTypeIds,
  withDifferenceAsLine,
  type PaycheckDraft,
} from './paycheckEntry.ts'

const ILS = 'ILS'
const TODAY = localDate(2026, 7, 9)

function type(
  id: string,
  kind: DeductionType['kind'],
  flags?: { readonly reducesNet?: boolean; readonly countsAsSaving?: boolean },
): DeductionType {
  return {
    id,
    name: id,
    hebrewName: undefined,
    kind,
    reducesNet: flags?.reducesNet ?? true,
    countsAsSaving: flags?.countsAsSaving ?? false,
    linkedSavingGoalId: undefined,
    linkedDebtId: undefined,
    linkedFundId: undefined,
    isBuiltIn: true,
    sortOrder: 0,
  }
}

const TYPES: readonly DeductionType[] = [
  type('ded:income-tax', 'TAX'),
  type('ded:national-insurance', 'SOCIAL_INSURANCE'),
  type('ded:pension', 'PENSION', { countsAsSaving: true }),
  type('ded:severance', 'SEVERANCE', { reducesNet: false, countsAsSaving: true }),
  type('ded:other', 'OTHER_DEDUCTION'),
]

function draft(overrides?: Partial<PaycheckDraft>): PaycheckDraft {
  return {
    ...blankDraft(TODAY, ILS),
    gross: money(2_500_000, ILS),
    net: money(1_753_300, ILS),
    ...overrides,
  }
}

function line(deductionTypeId: string, employeeMinor: number, employerMinor?: number) {
  return {
    ...blankLine(ILS, deductionTypeId),
    employee: money(employeeMinor, ILS),
    employer: employerMinor === undefined ? undefined : money(employerMinor, ILS),
  }
}

describe('blankDraft', () => {
  it('opens on last month, because that is the slip that has just arrived', () => {
    expect(blankDraft(TODAY, ILS)).toMatchObject({
      period: { year: 2026, month: 6 },
      paymentDate: TODAY,
      gross: zero(ILS),
      net: zero(ILS),
      lines: [],
    })
  })

  it('steps back over a year boundary', () => {
    expect(blankDraft(localDate(2026, 1, 9), ILS).period).toEqual({ year: 2025, month: 12 })
  })
})

describe('draftEntry', () => {
  it('is the record the draft will become, so every figure can be asked about it', () => {
    const entry = draftEntry(
      draft({ employerName: '  Acme  ', note: '  ', lines: [line('ded:income-tax', 341_250)] }),
    )

    expect(entry.paycheck.employerName).toBe('Acme')
    expect(entry.paycheck.note).toBeUndefined()
    expect(entry.lines).toHaveLength(1)
    expect(entry.lines[0]).toMatchObject({
      deductionTypeId: 'ded:income-tax',
      employeeAmount: money(341_250, ILS),
      sortOrder: 0,
    })
  })

  it('keeps a line with no type chosen, so the delta does not move when a row is half-filled', () => {
    const half = draft({ lines: [line('', 100_000)] })

    expect(draftEntry(half).lines).toHaveLength(1)
    expect(draftDelta(half, TYPES)).toEqual(money(746_700, ILS))
  })
})

describe('draftDelta', () => {
  it('is what the strip shows, and reaches zero when the itemization is complete', () => {
    const short = draft({ lines: [line('ded:income-tax', 341_250)] })
    expect(draftDelta(short, TYPES)).toEqual(money(405_450, ILS))

    const complete = draft({
      lines: [line('ded:income-tax', 341_250), line('ded:other', 405_450)],
    })
    expect(draftDelta(complete, TYPES)).toEqual(money(0, ILS))
  })

  it('ignores the employer side and lines that do not reduce net', () => {
    const withEmployer = draft({
      lines: [
        line('ded:income-tax', 746_700, 500_000),
        line('ded:severance', 0, 208_333),
      ],
    })

    expect(draftDelta(withEmployer, TYPES)).toEqual(money(0, ILS))
  })

  it('states the difference the slip itself asks to have explained', () => {
    expect(grossToNet(draft())).toEqual(money(746_700, ILS))
  })
})

describe('withDifferenceAsLine', () => {
  it('adds exactly what is unaccounted for, as one line', () => {
    const short = draft({ lines: [line('ded:income-tax', 341_250)] })

    const fixed = withDifferenceAsLine(short, 'ded:other', TYPES)

    expect(fixed.lines).toHaveLength(2)
    expect(fixed.lines[1]).toMatchObject({
      deductionTypeId: 'ded:other',
      employee: money(405_450, ILS),
    })
    expect(draftDelta(fixed, TYPES)).toEqual(money(0, ILS))
  })

  it('has nothing to add when the delta is zero or negative', () => {
    const balanced = draft({ lines: [line('ded:income-tax', 746_700)] })
    expect(withDifferenceAsLine(balanced, 'ded:other', TYPES)).toBe(balanced)

    const over = draft({ lines: [line('ded:income-tax', 800_000)] })
    expect(withDifferenceAsLine(over, 'ded:other', TYPES)).toBe(over)
  })
})

describe('draftProblems', () => {
  it('says nothing about a slip that does not reconcile', () => {
    expect(draftProblems(draft({ lines: [] }))).toEqual([])
  })

  it('defers the money questions to validatePaycheck', () => {
    expect(draftProblems(draft({ net: money(-1, ILS) }))).toContain('NEGATIVE_NET')
    expect(
      draftProblems(draft({ gross: money(1_000, ILS), net: money(2_000, ILS) })),
    ).toContain('NET_ABOVE_GROSS')
  })

  it('adds the one question that belongs to the form', () => {
    expect(draftProblems(draft({ lines: [line('', 100)] }))).toEqual(['LINE_WITHOUT_TYPE'])
  })
})

describe('copiedFrom', () => {
  const previous: PaycheckWithLines = {
    paycheck: {
      id: 'pay-june',
      period: { year: 2026, month: 6 },
      paymentDate: localDate(2026, 7, 9),
      employerName: 'Acme',
      gross: money(2_500_000, ILS),
      net: money(1_753_300, ILS),
      depositedToAccountId: undefined,
      note: 'includes back pay',
      sourceKind: 'MANUAL',
      attachmentRef: undefined,
      isIrregular: true,
    },
    lines: [
      {
        id: 'line-1',
        paycheckId: 'pay-june',
        deductionTypeId: 'ded:income-tax',
        employeeAmount: money(341_250, ILS),
        employerAmount: undefined,
        basisAmount: undefined,
        note: undefined,
        sortOrder: 0,
      },
      {
        id: 'line-2',
        paycheckId: 'pay-june',
        deductionTypeId: 'ded:pension',
        employeeAmount: money(150_000, ILS),
        employerAmount: money(162_500, ILS),
        basisAmount: undefined,
        note: undefined,
        sortOrder: 10,
      },
    ],
  }

  it('brings every line across with its amounts', () => {
    const next = copiedFrom(previous, localDate(2026, 8, 9))

    expect(next.lines).toHaveLength(2)
    expect(next.lines[1]).toMatchObject({
      deductionTypeId: 'ded:pension',
      employee: money(150_000, ILS),
      employer: money(162_500, ILS),
    })
    expect(next.gross).toEqual(money(2_500_000, ILS))
    expect(next.employerName).toBe('Acme')
  })

  it('steps the month forward and leaves last month behind', () => {
    const next = copiedFrom(previous, localDate(2026, 8, 9))

    expect(next.period).toEqual({ year: 2026, month: 7 })
    expect(next.paymentDate).toEqual(localDate(2026, 8, 9))
    // A bonus month is not a template, and last month's note is not this month's.
    expect(next.isIrregular).toBe(false)
    expect(next.note).toBe('')
  })

  it('gives the copied lines their own identity', () => {
    const next = copiedFrom(previous, localDate(2026, 8, 9))

    expect(next.lines.map((l) => l.key)).not.toEqual(['line-1', 'line-2'])
    expect(new Set(next.lines.map((l) => l.key)).size).toBe(2)
  })

  it('rolls a December slip into January', () => {
    const december = {
      ...previous,
      paycheck: { ...previous.paycheck, period: { year: 2025, month: 12 } },
    }

    expect(copiedFrom(december, TODAY).period).toEqual({ year: 2026, month: 1 })
  })

  it('round-trips a saved slip back into the form it was typed in', () => {
    const reopened = draftFrom(previous)

    expect(reopened.period).toEqual({ year: 2026, month: 6 })
    expect(reopened.isIrregular).toBe(true)
    expect(reopened.note).toBe('includes back pay')
    expect(reopened.lines[0]?.key).toBe('line-1')
  })
})

describe('the type picker', () => {
  function entry(year: number, month: number, typeIds: readonly string[]): PaycheckWithLines {
    return {
      paycheck: {
        id: `pay-${year}-${month}`,
        period: { year, month },
        paymentDate: TODAY,
        employerName: undefined,
        gross: money(1, ILS),
        net: money(1, ILS),
        depositedToAccountId: undefined,
        note: undefined,
        sourceKind: 'MANUAL',
        attachmentRef: undefined,
        isIrregular: false,
      },
      lines: typeIds.map((deductionTypeId, position) => ({
        id: `${deductionTypeId}-${position}`,
        paycheckId: `pay-${year}-${month}`,
        deductionTypeId,
        employeeAmount: money(1, ILS),
        employerAmount: undefined,
        basisAmount: undefined,
        note: undefined,
        sortOrder: position,
      })),
    }
  }

  it('takes recents from the newest slips first', () => {
    const recents = recentTypeIds([
      entry(2025, 1, ['ded:severance']),
      entry(2026, 6, ['ded:income-tax', 'ded:pension']),
    ])

    expect(recents).toEqual(['ded:income-tax', 'ded:pension', 'ded:severance'])
  })

  it('has no recents in a document with no paychecks', () => {
    expect(recentTypeIds([])).toEqual([])
    expect(pickerGroups(TYPES, []).map((group) => group.label)).toEqual([
      'Tax',
      'National insurance',
      'Pension',
      'Severance',
      'Other deduction',
    ])
  })

  it('leads with recents and never repeats one below', () => {
    const groups = pickerGroups(TYPES, ['ded:pension', 'ded:income-tax'])

    expect(groups[0]?.label).toBe('Recently used')
    expect(groups[0]?.types.map((t) => t.id)).toEqual(['ded:pension', 'ded:income-tax'])
    expect(groups.slice(1).flatMap((group) => group.types.map((t) => t.id))).toEqual([
      'ded:national-insurance',
      'ded:severance',
      'ded:other',
    ])
  })

  it('ignores a recent id whose type is gone', () => {
    const groups = pickerGroups(TYPES, ['ded:vanished', 'ded:pension'])

    expect(groups[0]?.types.map((t) => t.id)).toEqual(['ded:pension'])
  })
})

describe('defaultFlags', () => {
  it('knows which side of the slip each kind lands on', () => {
    expect(defaultFlags('TAX')).toEqual({ reducesNet: true, countsAsSaving: false })
    expect(defaultFlags('PENSION')).toEqual({ reducesNet: true, countsAsSaving: true })
    expect(defaultFlags('STUDY_FUND')).toEqual({ reducesNet: true, countsAsSaving: true })
    expect(defaultFlags('SEVERANCE')).toEqual({ reducesNet: false, countsAsSaving: true })
    expect(defaultFlags('BENEFIT_IN_KIND')).toEqual({ reducesNet: false, countsAsSaving: false })
    expect(defaultFlags('ADDITION')).toEqual({ reducesNet: false, countsAsSaving: false })
    expect(defaultFlags('LOAN_REPAYMENT')).toEqual({ reducesNet: true, countsAsSaving: false })
  })
})

describe('a deduction type guesses, and asks only to confirm (M36 U11)', () => {
  const pension = { kind: 'PENSION', reducesNet: true, countsAsSaving: true } as const

  it('carries the flags with a kind change while they are still the guess, and never over a hand-set one', () => {
    expect(flagsAsGuessed(pension)).toBe(true)
    expect(kindChange(pension, 'SEVERANCE')).toEqual({ kind: 'SEVERANCE', reducesNet: false, countsAsSaving: true })
    const byHand = { ...pension, reducesNet: false }
    expect(flagsAsGuessed(byHand)).toBe(false)
    expect(kindChange(byHand, 'TAX')).toEqual({ kind: 'TAX' })
  })

  it('guesses what a line pays into only when there is exactly one candidate', () => {
    const fund = (id: string, fundType: string, isArchived = false) => ({ id, fundType, isArchived })
    const debt = (id: string, kind: string, isClosed = false) => ({ id, kind, isClosed })
    expect(guessDestination(pension, [fund('p', 'PENSION'), fund('s', 'STUDY_FUND')], [])).toEqual({ kind: 'fund', id: 'p' })
    expect(guessDestination(pension, [fund('p', 'PENSION'), fund('q', 'MANAGERS_INSURANCE')], [])).toBeUndefined()
    expect(guessDestination(pension, [fund('p', 'PENSION', true)], [])).toBeUndefined()
    // A line that is not saving is offered no fund, so none is guessed.
    expect(guessDestination({ kind: 'PENSION', countsAsSaving: false }, [fund('p', 'PENSION')], [])).toBeUndefined()
    expect(guessDestination({ kind: 'STUDY_FUND', countsAsSaving: true }, [fund('s', 'STUDY_FUND')], [])).toEqual({ kind: 'fund', id: 's' })
    expect(guessDestination({ kind: 'LOAN_REPAYMENT', countsAsSaving: false }, [], [debt('d', 'PAYROLL_LOAN'), debt('m', 'MORTGAGE')])).toEqual({ kind: 'debt', id: 'd' })
    expect(guessDestination({ kind: 'LOAN_REPAYMENT', countsAsSaving: false }, [], [debt('d', 'PAYROLL_LOAN', true)])).toBeUndefined()
    expect(guessDestination({ kind: 'TAX', countsAsSaving: false }, [fund('p', 'PENSION')], [])).toBeUndefined()
  })
})
