import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { add, fromMajorUnits, formatMoney, zero, type Money } from '@/core/money.ts'
import type { PayslipReading } from '@/domain/model/paycheck.ts'
import type { PayslipLines } from '@/domain/modelTasks.ts'

import { anchorPayslip } from './labelTemplate.ts'
import {
  amountSlots,
  readAnchoredPayslip,
  readDeductionRow,
  readPayslip,
  readSingleAmount,
  restateSlip,
} from './payslipTemplate.ts'

/**
 * The shape of a real slip's deductions table: right-aligned columns, a dash
 * where an amount does not apply, and nothing at all where a basis does not.
 */
const SLIP = [
  'תלוש שכר — יולי 2026',
  'תאריך תשלום: 01/08/2026    חודש שכר: 07/2026',
  'תיאור            בסיס        עובד        מעסיק',
  'מס הכנסה                  3,980.50           —',
  'ביטוח לאומי               1,062.00    1,470.00',
  'פנסיה         24,500.00    1,470.00    1,592.50',
  'פיצויים       24,500.00           —    2,040.85',
  'סה"כ ניכויי עובד          6,512.50',
  'סה"כ ברוטו               24,500.00',
  'נטו לתשלום               17,987.50',
].join('\n')

const template: PayslipLines = {
  grossLine: 9,
  netLine: 10,
  employeeDeductionsTotalLine: 8,
  deductionLines: [
    { line: 4, hasEmployerColumn: false, hasBasisColumn: false },
    { line: 5, hasEmployerColumn: true, hasBasisColumn: false },
    { line: 6, hasEmployerColumn: true, hasBasisColumn: true },
    { line: 7, hasEmployerColumn: true, hasBasisColumn: true },
  ],
}

describe('amountSlots', () => {
  it('keeps a dash as a position rather than dropping it', () => {
    // Dropping it is how the employer's severance becomes the employee's.
    expect(amountSlots('פיצויים 24,500.00 — 2,040.85')).toEqual([24500, undefined, 2040.85])
  })

  it('reads the Israeli spellings of an amount', () => {
    expect(amountSlots('x 1,234.56 (89.90) 45.00-')).toEqual([1234.56, -89.9, -45])
  })

  it('ignores the label, however many words it is', () => {
    expect(amountSlots('קרן השתלמות 24,500.00 612.50')).toEqual([24500, 612.5])
  })

  it('finds nothing on a heading', () => {
    expect(amountSlots('תיאור            בסיס        עובד')).toEqual([])
  })
})

describe('readDeductionRow', () => {
  it('reads a row with all three columns', () => {
    expect(readDeductionRow('פנסיה 24,500.00 1,470.00 1,592.50')).toEqual({
      basis: 24500,
      employee: 1470,
      employer: 1592.5,
    })
  })

  it('reads a row whose employee cell is a dash', () => {
    expect(readDeductionRow('פיצויים 24,500.00 — 2,040.85')).toEqual({
      basis: 24500,
      employer: 2040.85,
    })
  })

  it('reads a two-figure row as employee and employer, not basis and employee', () => {
    // The bug the reconciliation could not see: this row's employer amount was
    // dropped, both checks still passed, and the employer total was silently
    // 1,470.00 short.
    expect(readDeductionRow('ביטוח לאומי 1,062.00 1,470.00')).toEqual({
      employee: 1062,
      employer: 1470,
    })
  })

  it('reads a row with an employee figure and a dashed employer', () => {
    expect(readDeductionRow('מס הכנסה 3,980.50 —')).toEqual({ employee: 3980.5 })
  })

  it('reads a row with one figure and nothing else', () => {
    expect(readDeductionRow('דמי ועד 45.00')).toEqual({ employee: 45 })
  })
})

describe('readSingleAmount', () => {
  it('takes the figure off a total line', () => {
    expect(readSingleAmount('סה"כ ברוטו               24,500.00')).toBe(24500)
  })

  it('is undefined where there is no figure', () => {
    expect(readSingleAmount('תשלומים')).toBeUndefined()
  })
})

describe('readPayslip', () => {
  const reading = readPayslip(template, SLIP)

  it('reads the figures the template pointed at', () => {
    expect(reading.gross && formatMoney(reading.gross)).toBe('₪24,500.00')
    expect(reading.net && formatMoney(reading.net)).toBe('₪17,987.50')
    expect(reading.deductions).toHaveLength(4)
  })

  it('takes each label off the document, gershayim intact', () => {
    expect(reading.deductions.map((entry) => entry.label)).toEqual([
      'מס הכנסה',
      'ביטוח לאומי',
      'פנסיה',
      'פיצויים',
    ])
  })

  it('reconciles the slip against itself, twice', () => {
    // 24,500.00 − 6,512.50 = 17,987.50, and the printed total agrees.
    expect(reading.delta?.minor).toBe(0)
    expect(reading.statedTotalDelta?.minor).toBe(0)
    expect(reading.reconciles).toBe(true)
  })

  it('never gives a deduction a kind — that is the user’s (D-132)', () => {
    for (const entry of reading.deductions) {
      expect(entry).not.toHaveProperty('kind')
      expect(entry).not.toHaveProperty('deductionTypeId')
    }
  })

  it('fails to reconcile when a deduction line was missed', () => {
    // Dropping מס הכנסה, the one line whose 3,980.50 the equation needs. Note
    // that dropping פיצויים instead would change nothing — its employee cell is
    // a dash — which is its own reminder that this proof covers the employee
    // column and only the employee column.
    const short: PayslipLines = { ...template, deductionLines: template.deductionLines.slice(1) }
    const bad = readPayslip(short, SLIP)
    expect(bad.reconciles).toBe(false)
    expect(bad.delta?.minor).toBe(398050)
  })

  it('catches with the second check what the first would have let through', () => {
    // Gross misread by exactly the amount of a missed deduction: the
    // gross-minus-net equation still comes out zero, and the printed total
    // does not. This is why there are two.
    const slip = SLIP.replace('סה"כ ברוטו               24,500.00', 'סה"כ ברוטו               20,519.50')
    const short: PayslipLines = { ...template, deductionLines: template.deductionLines.slice(1) }
    const bad = readPayslip(short, slip)
    expect(bad.delta?.minor).toBe(0)
    expect(bad.statedTotalDelta?.minor).not.toBe(0)
    expect(bad.reconciles).toBe(false)
  })

  it('does not claim to reconcile when the slip printed no total', () => {
    const noTotal: PayslipLines = { ...template }
    const stripped = { ...noTotal }
    delete (stripped as { employeeDeductionsTotalLine?: number }).employeeDeductionsTotalLine
    const reduced = readPayslip(stripped, SLIP)
    expect(reduced.statedTotalDelta).toBeUndefined()
    // The one proof it does have still has to pass.
    expect(reduced.reconciles).toBe(true)
  })

  it('reports an unresolved field rather than dropping it', () => {
    const heading: PayslipLines = {
      ...template,
      deductionLines: [{ line: 3, hasEmployerColumn: false, hasBasisColumn: false }],
    }
    const bad = readPayslip(heading, SLIP)
    expect(bad.unresolved).toContainEqual({
      field: 'deduction[0]',
      reason: 'line 3 has no figure on it',
    })
  })

  it('survives a template that points at nothing at all', () => {
    const nonsense: PayslipLines = { grossLine: 900, netLine: 901, deductionLines: [] }
    const bad = readPayslip(nonsense, SLIP)
    expect(bad.reconciles).toBe(false)
    expect(bad.gross).toBeUndefined()
    expect(bad.unresolved).toHaveLength(2)
  })
})

/**
 * The condition M11 is finished on: a second document of a known format read
 * with no model involved.
 *
 * July's slip is derived once — the line numbers below are a model's answer —
 * and anchored. August's slip is then read through what that produced, and
 * August is not July: an overtime row was inserted at line 13, so every field
 * the template knows about sits one line lower than it was found at. Nothing
 * here re-derives anything, and the reading proves itself twice over.
 */
describe('a stored template, on the following month', () => {
  const JULY = readSlip('payslip-2026-07.txt')
  const AUGUST = readSlip('payslip-2026-08.txt')

  const JULY_LINES: PayslipLines = {
    grossLine: 15,
    netLine: 33,
    employeeDeductionsTotalLine: 30,
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

  it('reads July with the line numbers it was derived from', () => {
    const reading = readPayslip(JULY_LINES, JULY)

    expect(formatMoney(reading.gross!)).toBe('₪24,500.00')
    expect(formatMoney(reading.net!)).toBe('₪16,205.00')
    expect(reading.reconciles).toBe(true)
  })

  it('reads August through the anchors, and August agrees with itself', () => {
    const { template } = anchorPayslip(JULY_LINES, JULY)
    const reading = readAnchoredPayslip(template, AUGUST)

    expect(reading.unresolved).toEqual([])
    expect(formatMoney(reading.gross!)).toBe('₪25,700.00')
    expect(formatMoney(reading.net!)).toBe('₪16,945.00')
    expect(reading.deductions).toHaveLength(8)
    // Both proofs, on a slip nothing was asked about.
    expect(formatMoney(reading.delta!)).toBe('₪0.00')
    expect(formatMoney(reading.statedTotalDelta!)).toBe('₪0.00')
    expect(reading.reconciles).toBe(true)
  })

  it('reads the employer column, which no equation checks (D-138)', () => {
    const { template } = anchorPayslip(JULY_LINES, JULY)
    const reading = readAnchoredPayslip(template, AUGUST)

    // 1,470.00 + 1,592.50 + 1,837.50 + 2,040.85. The figure a person has to
    // look at, and the one the reconciliation would let through if it moved.
    const employer = reading.deductions.reduce(
      (total, entry) => (entry.employer === undefined ? total : add(total, entry.employer)),
      zero('ILS'),
    )
    expect(formatMoney(employer)).toBe('₪6,940.85')
  })

  it('does not reconcile when the template is pointed at the wrong slip', () => {
    // The other half of the same rule: a template is trusted *while* it
    // verifies. A fund report shares no label with a payslip, so nothing
    // resolves and nothing is quietly read.
    const { template } = anchorPayslip(JULY_LINES, JULY)
    const reading = readAnchoredPayslip(template, 'יתרת פתיחה 10,000.00\nיתרת סגירה 12,851.00')

    expect(reading.reconciles).toBe(false)
    expect(reading.unresolved.length).toBeGreaterThan(0)
  })
})

function readSlip(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../fixtures/synthetic/${name}`, import.meta.url)),
    'utf8',
  )
}

/**
 * The confirm surface's half of D-205: every figure the template produced is a
 * field there, and the slip's own two proofs have to be about what was typed
 * rather than about what was read.
 */
/**
 * One headline figure typed over or cleared, exactly the way the confirm
 * surface commits one: **a blank field is the key absent**, not a key holding
 * `undefined`, because that is what keeps "the slip printed no total" apart
 * from "the total is nothing".
 */
function typed(
  reading: PayslipReading,
  key: 'gross' | 'net' | 'statedDeductionsTotal',
  amount: Money | undefined,
): PayslipReading {
  const next = { ...reading }
  delete next[key]
  return amount === undefined ? next : { ...next, [key]: amount }
}

describe('restateSlip — the reading, corrected', () => {
  const reading = readPayslip(template, SLIP)

  it('re-runs both equations over a figure typed over', () => {
    // The gross misread by ₪100. Both proofs are equations over the employee
    // column, so the first moves and the second does not.
    const wrong = restateSlip(typed(reading, 'gross', fromMajorUnits(24_600, 'ILS')))

    expect(wrong.delta && formatMoney(wrong.delta)).toBe('₪100.00')
    expect(wrong.statedTotalDelta?.minor).toBe(0)
    expect(wrong.reconciles).toBe(false)

    // And typing it back is not a one-way trip: the verdict follows the figures.
    expect(restateSlip(typed(wrong, 'gross', reading.gross)).reconciles).toBe(true)
  })

  it('follows a deduction line, which moves the total the equation uses', () => {
    const deductions = reading.deductions.map((entry, index) =>
      index === 0 ? { ...entry, employee: fromMajorUnits(3_880.5, 'ILS') } : entry,
    )
    const short = restateSlip({ ...reading, deductions })

    // ₪100 less deducted: the slip no longer adds up either way.
    expect(short.delta && formatMoney(short.delta)).toBe('₪100.00')
    expect(short.statedTotalDelta && formatMoney(short.statedTotalDelta)).toBe('-₪100.00')
    expect(short.reconciles).toBe(false)
  })

  it('makes the second proof run when a total the template missed is typed in', () => {
    // A slip that prints no total has not failed the second check; it has not
    // run it, and the first alone still reconciles. What typing the total in
    // buys is the independent proof — `delta` can come out zero with a line
    // missed *and* the gross misread by the same amount, and this would not.
    const missing = restateSlip(typed(reading, 'statedDeductionsTotal', undefined))
    expect(missing.statedTotalDelta).toBeUndefined()
    expect(missing.reconciles).toBe(true)

    const back = restateSlip(typed(missing, 'statedDeductionsTotal', fromMajorUnits(6_512.5, 'ILS')))
    expect(back.statedTotalDelta?.minor).toBe(0)
    expect(back.reconciles).toBe(true)

    // And a total typed in that the lines do not come to is a slip that stops
    // reconciling — which is the check earning its place.
    const off = restateSlip(typed(missing, 'statedDeductionsTotal', fromMajorUnits(6_500, 'ILS')))
    expect(off.statedTotalDelta && formatMoney(off.statedTotalDelta)).toBe('₪12.50')
    expect(off.reconciles).toBe(false)
  })

  it('clears a delta when the figure it needs is cleared, rather than keeping the old one', () => {
    // A blank field means the document printed nothing there. A spread that
    // carried the previous delta through would leave a proof standing for a
    // figure nobody can see.
    const blank = restateSlip(typed(reading, 'gross', undefined))
    expect(blank.delta).toBeUndefined()
    expect(blank.reconciles).toBe(false)
  })

  it('carries the template’s own account of itself through untouched', () => {
    const edited = restateSlip(typed(reading, 'net', fromMajorUnits(1, 'ILS')))
    // Where each figure was found, and what the template could not resolve, are
    // facts about the read rather than about the figures.
    expect(edited.lines).toEqual(reading.lines)
    expect(edited.unresolved).toEqual(reading.unresolved)
    expect(edited.borrowed).toEqual(reading.borrowed)
  })
})
