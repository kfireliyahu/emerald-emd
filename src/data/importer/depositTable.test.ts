/**
 * The deposit table a fund report prints, read off the page (D-153).
 *
 * `fund-report-2026h1-deposits.txt` is `fund-report-2026h1.txt` with the section
 * a real report carries and the synthetic one did not: six deposits, each naming
 * the salary month it is **for** and the date it arrived, one of them three
 * months late, and a `סה"כ` line under the table that must not read as a seventh
 * deposit.
 *
 * What is tested here that no other fixture can be: the table is anchored **by
 * its heading and its column order**, so a quarter with a different number of
 * rows reads through the same template. That is the whole design, and a template
 * that had memorised this quarter's row lines would pass every other test in
 * this file.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { formatMoney } from '@/core/money.ts'
import { toISODate, toYearMonthString } from '@/core/time.ts'
import type { FundReportLines } from '@/domain/modelTasks.ts'
import type { DepositColumn, FundReportDocumentTemplate } from '@/domain/model/templates.ts'
import { reviewFundReport } from '@/domain/review.ts'

import { cellsOf, parseSalaryMonth, readDepositRow, readDepositRows } from './depositTable.ts'
import { readReportWithTemplate } from './fundLadder.ts'
import { depositTotal, readAnchoredFundReport, readFundReport } from './fundReportTemplate.ts'
import { anchorFundReport, computeLabelSignature } from './labelTemplate.ts'

const H1 = readFileSync(
  fileURLToPath(new URL('../../../fixtures/synthetic/fund-report-2026h1-deposits.txt', import.meta.url)),
  'utf8',
)

/** Employer, when it arrived, which month it is for, the salary, then the split. */
const COLUMNS: readonly DepositColumn[] = [
  { index: 0, role: 'employerName' },
  { index: 1, role: 'depositDate' },
  { index: 2, role: 'salaryMonth' },
  { index: 3, role: 'salary' },
  { index: 4, role: 'employee' },
  { index: 5, role: 'employer' },
  { index: 6, role: 'severance' },
]

const H1_LINES: FundReportLines = {
  closingBalanceLine: 21,
  openingBalanceLine: 13,
  depositsLine: 15,
  yieldLine: 16,
  feesLine: 17,
  asOfDateLine: 3,
  periodStartLine: 5,
  chargeLines: [18, 19],
  adjustmentLines: [20],
  feeRateOnDepositLine: 13,
  feeRateOnAccumulationLine: 15,
  investmentTrackLine: 32,
  employerNameLine: 6,
  expectedPensionLine: 8,
  depositTableHeaderLine: 23,
  depositColumns: COLUMNS,
}

describe('reading the rows', () => {
  it('takes every row under the heading and stops at the total line', () => {
    const { rows } = readDepositRows(H1, 23, COLUMNS)

    expect(rows).toHaveLength(6)
    expect(rows.map((row) => toYearMonthString(row.salaryMonth!))).toEqual([
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
    ])
    // `סה"כ    24,000` sits directly under the last row with two cells where the
    // heading has seven. The count test is what rejects it.
    expect(rows.every((row) => row.employerName === 'מעבדות תוכנה')).toBe(true)
  })

  it('splits each deposit into the three kinds of money', () => {
    const row = readDepositRows(H1, 23, COLUMNS).rows[0]!

    expect(formatMoney(row.employee!)).toBe('₪1,500.00')
    expect(formatMoney(row.employer!)).toBe('₪1,750.00')
    expect(formatMoney(row.severance!)).toBe('₪750.00')
    expect(formatMoney(row.salary!)).toBe('₪20,000.00')
    // The table prints no total column, so the row's total is its parts.
    expect(row.total).toBeUndefined()
    expect(formatMoney(depositTotal(row))).toBe('₪4,000.00')
    expect(toISODate(row.depositDate!)).toBe('2026-01-04')
  })

  it('refuses a line whose cells do not number the columns', () => {
    expect(readDepositRow('סה"כ    24,000', COLUMNS)).toBeUndefined()
    expect(readDepositRow('מסלול כללי                    4.90%', COLUMNS)).toBeUndefined()
  })

  it('refuses a line with the right shape and a word where a month belongs', () => {
    const line = 'מעבדות תוכנה    04/01/2026    סך הכל    20,000    1,500    1,750    750'
    expect(readDepositRow(line, COLUMNS)).toBeUndefined()
  })

  it('refuses a second heading, which has the shape of a row and no figures', () => {
    const heading = 'שם המעסיק    תאריך הפקדה    חודש שכר    שכר    תגמולי עובד    תגמולי מעסיק    פיצויים'
    expect(readDepositRow(heading, COLUMNS)).toBeUndefined()
  })

  it('keeps a single space inside a value and splits on two', () => {
    expect(cellsOf('מעבדות תוכנה    04/01/2026')).toEqual(['מעבדות תוכנה', '04/01/2026'])
  })

  it('reads a salary month whichever way round it is written', () => {
    expect(parseSalaryMonth('11/2025')).toEqual({ year: 2025, month: 11 })
    expect(parseSalaryMonth('2025-11')).toEqual({ year: 2025, month: 11 })
    expect(parseSalaryMonth('11.2025')).toEqual({ year: 2025, month: 11 })
    expect(parseSalaryMonth('11/25')).toEqual({ year: 2025, month: 11 })
    // Not a month: 13 cannot be one and neither side can be a year.
    expect(parseSalaryMonth('13/25')).toBeUndefined()
    expect(parseSalaryMonth('20,000')).toBeUndefined()
  })
})

describe('the third equation', () => {
  it('proves the rows against what the report says was paid in', () => {
    const reading = readFundReport(H1_LINES, H1)

    expect(reading.depositRows).toHaveLength(6)
    // Six deposits of ₪4,000 against `כספים שהופקדו לקרן 24,000`.
    expect(reading.depositTableDelta?.minor).toBe(0)
    expect(reading.proof).toBe('proved')
  })

  it('notices a row it failed to read', () => {
    // The heading one line late: the first row is skipped, five are found, and
    // the table is ₪4,000 short of the figure it is measured against.
    const reading = readFundReport({ ...H1_LINES, depositTableHeaderLine: 24 }, H1)

    expect(reading.depositRows).toHaveLength(5)
    expect(formatMoney(reading.depositTableDelta!)).toBe('-₪4,000.00')
    expect(reading.proof).toBe('failed')
  })

  it('says nothing when there is no table to check', () => {
    const { depositTableHeaderLine, depositColumns, ...withoutTable } = H1_LINES
    const reading = readFundReport(withoutTable, H1)

    expect(reading.depositRows).toEqual([])
    expect(reading.depositTableDelta).toBeUndefined()
    // The period equation still runs, so the report is still proved.
    expect(reading.proof).toBe('proved')
  })
})

describe('what the surface says about it', () => {
  it('names the rows and says the month is checked by nothing', () => {
    const review = reviewFundReport(readFundReport(H1_LINES, H1))

    expect(review.deposits).toHaveLength(6)
    expect(review.depositsAddUp).toBe(true)
    expect(review.checks.map((check) => check.label)).toContain(
      'the deposit table adds up to what was paid in',
    )

    // **D-138, said out loud even when the sum passes** — the amounts are
    // proved and the salary month beside them is not, and it is the field every
    // later deposit check is keyed on.
    const doubt = review.doubts.find((one) => one.field === 'depositRows')
    expect(doubt?.message).toContain('6 deposits')
    expect(doubt?.message).toContain('checked by nothing at all')
  })
})

describe('the anchored route — the one with no model on it', () => {
  it('reads a later report with a different number of rows', () => {
    const template = anchorFundReport(H1_LINES, H1).template
    expect(template.depositTable?.columns).toEqual(COLUMNS)

    // Next quarter: two more deposits, and the totals moved with them. A
    // template that had stored this quarter's row lines would read six.
    const later = H1.replace(
      'מעבדות תוכנה    04/06/2026    05/2026    20,000    1,500    1,750    750',
      [
        'מעבדות תוכנה    04/06/2026    05/2026    20,000    1,500    1,750    750',
        'מעבדות תוכנה    04/07/2026    06/2026    20,000    1,500    1,750    750',
        'מעבדות תוכנה    04/08/2026    07/2026    20,000    1,500    1,750    750',
      ].join('\n'),
    ).replace('24,000        דמי ניהול מחיסכון', '32,000        דמי ניהול מחיסכון')

    const reading = readAnchoredFundReport(template, later)
    expect(reading.depositRows).toHaveLength(8)
    expect(reading.depositTableDelta?.minor).toBe(0)
  })

  it('survives a line inserted above the table, which moves every line number', () => {
    const template = anchorFundReport(H1_LINES, H1).template
    const shifted = H1.replace(
      'ד. פירוט ההפקדות שהתקבלו בקרן',
      'הודעה: מסלול ההשקעה שונה ביום 01.04.2026\nד. פירוט ההפקדות שהתקבלו בקרן',
    )

    expect(readAnchoredFundReport(template, shifted).depositRows).toHaveLength(6)
  })

  it('goes through the ladder with no model and no question', () => {
    const stored: FundReportDocumentTemplate = {
      id: 'tpl-h1-deposits',
      kind: 'FUND_REPORT',
      name: 'Synthetic pension, half-yearly',
      labelSignature: computeLabelSignature(H1),
      anchors: anchorFundReport(H1_LINES, H1).template,
      derivedBy: 'LOCAL_MODEL',
      confirmedAt: 1,
      pinnedFields: [],
      version: 1,
      supersededAt: undefined,
      lastUsedAt: undefined,
      useCount: 0,
    }

    const outcome = readReportWithTemplate({ text: H1, template: stored })
    expect(outcome.kind).toBe('read')
    expect(outcome.reading.depositRows).toHaveLength(6)
    expect(outcome.reading.proof).toBe('proved')
  })
})
