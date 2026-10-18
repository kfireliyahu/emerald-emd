/**
 * The gate a model's answer goes through, tested without a model.
 *
 * A grammar was sent; a grammar is not a guarantee. Every shape here is one a
 * runtime that ignored it, or an older build of one, can hand back.
 */

import { describe, expect, it } from 'vitest'

import { toFundReportLines, toPayslipLines } from './derive.ts'

describe('toPayslipLines', () => {
  it('reads the answer the task asks for', () => {
    expect(
      toPayslipLines({
        grossLine: 15,
        netLine: 33,
        employeeDeductionsTotalLine: 30,
        deductionLines: [{ line: 21, hasEmployerColumn: false, hasBasisColumn: true }],
      }),
    ).toEqual({
      grossLine: 15,
      netLine: 33,
      employeeDeductionsTotalLine: 30,
      deductionLines: [{ line: 21, hasEmployerColumn: false, hasBasisColumn: true }],
    })
  })

  it('refuses an answer with no gross or no net', () => {
    expect(toPayslipLines({ netLine: 33, deductionLines: [] })).toBeUndefined()
    expect(toPayslipLines({ grossLine: 15, deductionLines: [] })).toBeUndefined()
  })

  it('refuses a line number that is a string, however numeric it looks', () => {
    expect(toPayslipLines({ grossLine: '15', netLine: 33, deductionLines: [] })).toBeUndefined()
  })

  it('refuses a line number below one, which is not a line', () => {
    expect(toPayslipLines({ grossLine: 0, netLine: 33, deductionLines: [] })).toBeUndefined()
  })

  it('drops a deduction entry with no line rather than defaulting one', () => {
    // A defaulted line points somewhere, and somewhere is where a wrong figure
    // comes from.
    const lines = toPayslipLines({
      grossLine: 15,
      netLine: 33,
      deductionLines: [{ hasEmployerColumn: true }, { line: 22 }],
    })

    expect(lines?.deductionLines).toEqual([
      { line: 22, hasEmployerColumn: false, hasBasisColumn: false },
    ])
  })

  it('leaves out an optional field the answer did not have', () => {
    const lines = toPayslipLines({ grossLine: 15, netLine: 33, deductionLines: [] })

    expect(lines).not.toHaveProperty('employeeDeductionsTotalLine')
    expect(lines).not.toHaveProperty('payDateLine')
  })

  it('refuses prose, an array, and nothing at all', () => {
    expect(toPayslipLines('the gross is on line 15')).toBeUndefined()
    expect(toPayslipLines([{ grossLine: 15 }])).toBeUndefined()
    expect(toPayslipLines(undefined)).toBeUndefined()
    expect(toPayslipLines(null)).toBeUndefined()
  })

  it('has nowhere to put a figure, which is the property to keep', () => {
    // The task's schema has no money field in it; this is the other half of
    // that claim, tested rather than asserted (D-132).
    const lines = toPayslipLines({
      grossLine: 15,
      netLine: 33,
      gross: 24500,
      deductionLines: [{ line: 21, amount: 3980.5 }],
    })

    expect(JSON.stringify(lines)).not.toContain('24500')
    expect(JSON.stringify(lines)).not.toContain('3980')
  })
})

describe('toFundReportLines', () => {
  it('takes an answer that names the one figure a report exists to state', () => {
    expect(toFundReportLines({ closingBalanceLine: 17, feesLine: 15 })).toEqual({
      closingBalanceLine: 17,
      feesLine: 15,
      // Always present, because the reader iterates them: a report with no
      // costs beside its fee has an empty list rather than a missing one.
      chargeLines: [],
      adjustmentLines: [],
    })
  })

  it('takes the cost and adjustment lists, and drops what is not a line', () => {
    // The terms a real report needs and the synthetic one never had (D-152).
    expect(
      toFundReportLines({
        closingBalanceLine: 43,
        chargeLines: [38, '40', 0, 42],
        adjustmentLines: 'line 44',
      }),
    ).toMatchObject({ chargeLines: [38, 42], adjustmentLines: [] })
  })

  it('refuses an answer with no closing balance, however much else it names', () => {
    // A template that missed the balance is pointing at the wrong page, and
    // falling to the next rung beats storing a map of a report's footer.
    expect(toFundReportLines({ openingBalanceLine: 12, feesLine: 15 })).toBeUndefined()
  })

  it('drops every leaf that is not a line number, even when a grammar was sent', () => {
    // Both runtimes will constrain decoding to the schema and neither is
    // obliged to. A figure that arrived where a line belongs is not a line.
    expect(
      toFundReportLines({ closingBalanceLine: 17, feesLine: '226.77', yieldLine: 0 }),
    ).toEqual({ closingBalanceLine: 17, chargeLines: [], adjustmentLines: [] })
  })

  it('is nothing for an answer that is not an object at all', () => {
    expect(toFundReportLines('430,565.98')).toBeUndefined()
    expect(toFundReportLines([17])).toBeUndefined()
    expect(toFundReportLines(null)).toBeUndefined()
  })
})
