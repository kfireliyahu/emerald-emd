import { describe, expect, it } from 'vitest'

import {
  anchorsOf,
  carryPinnedFields,
  deductionsOf,
  type DocumentTemplate,
  type PayslipTemplate,
} from './templates.ts'

const derived: PayslipTemplate = {
  shape: 'payslip',
  fields: [
    { field: 'grossLine', label: 'סה"כ ברוטו', occurrence: 0, derivedLine: 15 },
    { field: 'netLine', label: 'נטו', occurrence: 0, derivedLine: 33 },
  ],
  deductions: [
    {
      field: 'deduction[0]',
      label: 'פנסיה',
      occurrence: 0,
      derivedLine: 24,
      hasEmployerColumn: true,
      hasBasisColumn: true,
    },
  ],
}

function stored(
  anchors: PayslipTemplate,
  pinnedFields: readonly string[],
): DocumentTemplate {
  return {
    id: 'tpl-1',
    kind: 'PAYSLIP',
    name: 'Software Labs',
    labelSignature: 'lv1',
    anchors,
    derivedBy: 'LOCAL_MODEL',
    confirmedAt: 1,
    pinnedFields,
    version: 1,
    supersededAt: undefined,
    lastUsedAt: undefined,
    useCount: 0,
  }
}

describe('anchorsOf', () => {
  it('is every anchor in a template, single fields and rows alike', () => {
    expect(anchorsOf(derived).map((anchor) => anchor.field)).toEqual([
      'grossLine',
      'netLine',
      'deduction[0]',
    ])
  })
})

describe('carryPinnedFields', () => {
  it('changes nothing when the user has corrected nothing', () => {
    expect(carryPinnedFields(stored(derived, []), derived)).toBe(derived)
  })

  it('keeps the corrected anchor and re-derives everything else', () => {
    const previous = stored(
      {
        ...derived,
        fields: [
          { field: 'grossLine', label: 'ברוטו ישן', occurrence: 0, derivedLine: 9 },
          { field: 'netLine', label: 'שולם בפועל', occurrence: 1, derivedLine: 40 },
        ],
      },
      ['netLine'],
    )

    const merged = carryPinnedFields(previous, derived)
    expect(merged.fields.find((field) => field.field === 'netLine')).toEqual({
      field: 'netLine',
      label: 'שולם בפועל',
      occurrence: 1,
      derivedLine: 40,
    })
    // The label the user did not touch is the fresh one, not the stale one.
    expect(merged.fields.find((field) => field.field === 'grossLine')?.label).toBe('סה"כ ברוטו')
  })

  it('keeps a pinned deduction’s columns with its label', () => {
    const previous = stored(
      {
        ...derived,
        deductions: [
          {
            field: 'deduction[0]',
            label: 'קרן פנסיה',
            occurrence: 0,
            derivedLine: 24,
            hasEmployerColumn: true,
            hasBasisColumn: false,
          },
        ],
      },
      ['deduction[0]'],
    )

    expect(deductionsOf(carryPinnedFields(previous, derived))[0]).toEqual({
      field: 'deduction[0]',
      label: 'קרן פנסיה',
      occurrence: 0,
      derivedLine: 24,
      hasEmployerColumn: true,
      hasBasisColumn: false,
    })
  })

  it('keeps a pinned field the fresh derivation does not have', () => {
    const previous = stored(
      {
        ...derived,
        fields: [
          ...derived.fields,
          { field: 'payDateLine', label: 'תאריך תשלום:', occurrence: 0, derivedLine: 6 },
        ],
      },
      ['payDateLine'],
    )

    const merged = carryPinnedFields(previous, derived)
    expect(merged.fields.map((field) => field.field)).toEqual([
      'grossLine',
      'netLine',
      'payDateLine',
    ])
  })

  it('carries nothing for a field the previous template never had', () => {
    const previous = stored(derived, ['salaryMonthLine'])
    expect(carryPinnedFields(previous, derived)).toBe(derived)
  })
})
