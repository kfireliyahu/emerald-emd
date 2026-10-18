/**
 * The label-value signature and its anchors, against two months of one slip.
 *
 * The two fixtures are the whole argument. `payslip-2026-08.txt` is July's slip
 * with the month changed, the figures moved, and **one payment row inserted** —
 * an overtime line — which shifts every line below it by one. A template that
 * remembered line numbers reads the wrong row off every field on that slip; a
 * template anchored to labels does not notice, and that is what these tests
 * check rather than assert about.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import type { PayslipLines } from '@/domain/modelTasks.ts'

import {
  anchorPayslip,
  compareLabelSignatures,
  computeLabelSignature,
  documentLabels,
  labelOf,
  labelsFromSignature,
  matchLabelTemplate,
  pairsThatReadAlike,
  resolveAnchors,
} from './labelTemplate.ts'

const JULY = readSlip('payslip-2026-07.txt')
const AUGUST = readSlip('payslip-2026-08.txt')

function readSlip(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../fixtures/synthetic/${name}`, import.meta.url)),
    'utf8',
  )
}

/** July's slip as a model answers it: line numbers, and nothing else. */
const JULY_LINES: PayslipLines = {
  grossLine: 15,
  netLine: 33,
  employeeDeductionsTotalLine: 30,
  payDateLine: 6,
  deductionLines: [
    { line: 21, hasEmployerColumn: false, hasBasisColumn: false },
    { line: 22, hasEmployerColumn: true, hasBasisColumn: false },
    { line: 23, hasEmployerColumn: false, hasBasisColumn: false },
    { line: 24, hasEmployerColumn: true, hasBasisColumn: true },
    { line: 25, hasEmployerColumn: true, hasBasisColumn: true },
    { line: 26, hasEmployerColumn: true, hasBasisColumn: true },
    { line: 27, hasEmployerColumn: false, hasBasisColumn: false },
    { line: 28, hasEmployerColumn: false, hasBasisColumn: false },
  ],
}

describe('labelOf', () => {
  it('keeps the words and drops every token with a digit in it', () => {
    expect(labelOf('סה"כ ברוטו                24,500.00')).toBe('סה"כ ברוטו')
  })

  it('keeps the gershayim, which is what a grammar could not (D-137)', () => {
    // The label is read off the document here. Nothing ever copies one.
    expect(labelOf('סה"כ ניכויי עובד     8,295.00')).toContain('סה"כ')
  })

  it('drops a date and what a date is printed beside', () => {
    expect(labelOf('תאריך תשלום: 01/08/2026   חודש שכר: 07/2026')).toBe(
      'תאריך תשלום: חודש שכר:',
    )
  })

  it('finds nothing on a rule or a blank', () => {
    expect(labelOf('────────────────────────')).toBe('')
    expect(labelOf('   ')).toBe('')
  })

  it('finds nothing on a line that is only figures', () => {
    expect(labelOf('   24,500.00     1,470.00')).toBe('')
  })
})

describe('the signature', () => {
  it('round-trips back to its labels', () => {
    const signature = computeLabelSignature(JULY)
    expect(labelsFromSignature(signature)).toEqual(documentLabels(JULY))
  })

  it('refuses a signature written by another version', () => {
    expect(labelsFromSignature('lv01ברוטו')).toBeUndefined()
  })

  it('is the same for the same document twice', () => {
    expect(computeLabelSignature(JULY)).toBe(computeLabelSignature(JULY))
  })

  it('calls next month the same format, not a new one', () => {
    const match = compareLabelSignatures(
      computeLabelSignature(JULY),
      computeLabelSignature(AUGUST),
    )

    expect(match.kind).toBe('close')
    if (match.kind !== 'close') return
    // The month's name changed and an overtime row appeared. Everything else
    // is the format, and the format is most of the page.
    expect(match.similarity).toBeGreaterThan(0.8)
    expect(match.addedLabels).toContain('שעות נוספות')
  })

  it('calls an unrelated document a different format', () => {
    const other = [
      'דוח קרן השתלמות',
      'יתרת פתיחה 10,000.00',
      'הפקדות 2,400.00',
      'תשואה 512.00',
      'דמי ניהול 61.00',
      'יתרת סגירה 12,851.00',
    ].join('\n')

    expect(
      compareLabelSignatures(computeLabelSignature(JULY), computeLabelSignature(other)).kind,
    ).toBe('none')
  })

  it('picks the closest stored template out of several', () => {
    const candidates = [
      { name: 'fund', labelSignature: computeLabelSignature('א ב ג ד ה ו ז ח') },
      { name: 'slip', labelSignature: computeLabelSignature(JULY) },
    ]

    expect(matchLabelTemplate(AUGUST, candidates)?.candidate.name).toBe('slip')
  })

  it('matches nothing when nothing is stored', () => {
    expect(matchLabelTemplate(AUGUST, [])).toBeUndefined()
  })
})

/**
 * Which stored formats compete for the same slips (08 C14).
 *
 * Two templates for one employer is not a bug — a natively read slip and an
 * OCR-read one carry slightly different labels, so they sign differently
 * (D-146, D-147) — but it is the thing that makes the match look arbitrary,
 * and it was invisible. This is the same relation the matcher uses, turned on
 * the templates themselves.
 */
describe('formats that read alike', () => {
  it('pairs two templates a single document could match either of', () => {
    const july = { name: 'July', labelSignature: computeLabelSignature(JULY) }
    const august = { name: 'August', labelSignature: computeLabelSignature(AUGUST) }

    const pairs = pairsThatReadAlike([july, august])

    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.map((one) => one.name)).toEqual(['July', 'August'])
  })

  it('pairs nothing when the formats are genuinely different documents', () => {
    const slip = { name: 'slip', labelSignature: computeLabelSignature(JULY) }
    const fund = {
      name: 'fund',
      labelSignature: computeLabelSignature(
        ['דוח קרן', 'יתרת פתיחה 10,000.00', 'דמי ניהול', 'יתרת סגירה 12,851.00'].join('\n'),
      ),
    }

    expect(pairsThatReadAlike([slip, fund])).toEqual([])
  })

  it('says nothing about a format on its own', () => {
    expect(pairsThatReadAlike([{ labelSignature: computeLabelSignature(JULY) }])).toEqual([])
  })
})

describe('anchoring, and then reading a later document', () => {
  it('turns line numbers into labels and keeps the columns with their row', () => {
    const { template, unanchored } = anchorPayslip(JULY_LINES, JULY)

    expect(unanchored).toEqual([])
    expect(template.fields.map((field) => field.field)).toEqual([
      'grossLine',
      'netLine',
      'employeeDeductionsTotalLine',
      'payDateLine',
    ])
    expect(template.fields[0]?.label).toBe('סה"כ ברוטו')
    expect(template.deductions).toHaveLength(8)
    expect(template.deductions[3]).toMatchObject({
      label: 'פנסיה',
      hasEmployerColumn: true,
      hasBasisColumn: true,
    })
  })

  it('finds every field on next month’s slip, where the slip has moved it', () => {
    const { template } = anchorPayslip(JULY_LINES, JULY)
    const anchors = [...template.fields, ...template.deductions]
    const resolved = resolveAnchors(anchors, AUGUST)

    expect(resolved.unresolved).toEqual([])

    // August inserted an overtime row at line 13. Everything under it is one
    // line lower than the template was derived at, and the pay date above it is
    // exactly where it was — which is the point: neither of those facts was
    // known to anything here, and neither had to be.
    const INSERTED_AT = 13
    for (const field of resolved.fields) {
      const anchor = anchors.find((entry) => entry.field === field.field)
      const derived = anchor?.derivedLine ?? 0
      expect({ field: field.field, line: field.line }).toEqual({
        field: field.field,
        line: derived >= INSERTED_AT ? derived + 1 : derived,
      })
    }
  })

  it('says which field it could not find rather than finding the wrong one', () => {
    const { template } = anchorPayslip(JULY_LINES, JULY)
    const withoutTheLoan = AUGUST.split('\n')
      .filter((line) => !line.includes('ניכוי הלוואה'))
      .join('\n')

    const resolved = resolveAnchors([...template.fields, ...template.deductions], withoutTheLoan)

    expect(resolved.unresolved).toHaveLength(1)
    expect(resolved.unresolved[0]?.field).toBe('deduction[7]')
    expect(resolved.unresolved[0]?.reason).toContain('ניכוי הלוואה')
    // And the fields under it are still found, because nothing was counted.
    expect(resolved.fields.some((field) => field.field === 'netLine')).toBe(true)
  })

  it('tells two lines with the same label apart', () => {
    const document = [
      'מס הכנסה        3,980.50',
      'סה"כ ברוטו     24,500.00',
      'מס הכנסה       27,863.50',
      'נטו לתשלום     17,987.50',
    ].join('\n')

    const first = { field: 'monthly', label: 'מס הכנסה', occurrence: 0, derivedLine: 1 }
    const second = { field: 'yearToDate', label: 'מס הכנסה', occurrence: 1, derivedLine: 3 }

    const resolved = resolveAnchors([first, second], document)
    expect(resolved.fields.map((field) => field.line)).toEqual([1, 3])
  })

  it('takes the only line carrying a label when the ordinal is gone', () => {
    // A month with one fewer of something. Refusing this would re-derive a
    // template that is working.
    const document = ['סה"כ ברוטו 24,500.00', 'מס הכנסה 3,980.50'].join('\n')
    const anchor = { field: 'tax', label: 'מס הכנסה', occurrence: 1, derivedLine: 3 }

    expect(resolveAnchors([anchor], document).fields[0]?.line).toBe(2)
  })

  it('will not anchor a field whose line carries no words', () => {
    const document = ['סה"כ ברוטו 24,500.00', '   17,987.50'].join('\n')
    const { template, unanchored } = anchorPayslip(
      { grossLine: 1, netLine: 2, deductionLines: [] },
      document,
    )

    expect(template.fields.map((field) => field.field)).toEqual(['grossLine'])
    expect(unanchored[0]?.field).toBe('netLine')
  })
})
