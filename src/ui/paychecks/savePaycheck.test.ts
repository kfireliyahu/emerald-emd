/**
 * Writing a batch of slips (M28 U3): every ticked slip a paycheck, and a reader
 * the batch worked out stored once — and only off a slip that reconciled.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { readSlipBatch, planSlip, type BatchSlip } from '@/data/importer/slipBatch.ts'
import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { listDeductionTypes } from '@/data/repositories/deductionTypeRepository.ts'
import { listTemplates } from '@/data/repositories/documentTemplateRepository.ts'
import { listPaychecksWithLines } from '@/data/repositories/paycheckRepository.ts'
import type { PayslipLines } from '@/domain/modelTasks.ts'

import { writeSlipBatch } from './savePaycheck.ts'

const JULY = synthetic('payslip-2026-07.txt')
const AUGUST = synthetic('payslip-2026-08.txt')

function synthetic(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../fixtures/synthetic/${name}`, import.meta.url)), 'utf8')
}

const JULY_LINES: PayslipLines = {
  grossLine: 15,
  netLine: 33,
  employeeDeductionsTotalLine: 30,
  salaryMonthLine: 6,
  payDateLine: 6,
  deductionLines: [21, 22, 23, 24, 25, 26, 27, 28].map((line) => ({
    line,
    hasEmployerColumn: [22, 24, 25, 26].includes(line),
    hasBasisColumn: [24, 25, 26].includes(line),
  })),
}

describe('writing a batch of slips', () => {
  it('writes a paycheck per slip and stores the reader it learned once', async () => {
    const db = await createLedgerDatabase()
    const types = listDeductionTypes(db)
    const type = types.find((each) => each.kind === 'TAX') ?? types[0]
    if (type === undefined) throw new Error('the ledger seeds deduction types')

    const slips = await readSlipBatch({
      files: [
        { id: 'jul', name: 'jul.pdf', hash: 'a', text: JULY },
        { id: 'aug', name: 'aug.pdf', hash: 'b', text: AUGUST },
      ],
      templates: [],
      derive: () => Promise.resolve({ kind: 'lines', lines: JULY_LINES }),
    })

    const writes = slips.map((slip: BatchSlip) => {
      const first = planSlip(slip, {
        types,
        currency: 'ILS',
        named: new Map(),
        today: { year: 2026, month: 10, day: 2 },
      })
      const named = new Map(first.unnamed.map((row) => [row.field, type.id]))
      const plan = planSlip(slip, {
        types,
        currency: 'ILS',
        named,
        today: { year: 2026, month: 10, day: 2 },
      })
      if (plan.draft === undefined) throw new Error('expected a draft')
      return { slip, draft: plan.draft, reconciles: plan.reconciles, named }
    })

    writeSlipBatch(db, writes, 1)

    expect(listPaychecksWithLines(db)).toHaveLength(2)
    const readers = listTemplates(db, 'PAYSLIP')
    expect(readers).toHaveLength(1)
    expect(readers[0]?.name).toBe('jul')
    expect(readers[0]?.useCount).toBeGreaterThanOrEqual(1)
  })

  it('teaches nothing from a slip that does not reconcile, and still writes it when ticked', async () => {
    const db = await createLedgerDatabase()
    const types = listDeductionTypes(db)
    const type = types[0]
    if (type === undefined) throw new Error('the ledger seeds deduction types')
    const broken = AUGUST.replace('4,440.50', '4,441.50')

    const [slip] = await readSlipBatch({
      files: [{ id: 'aug', name: 'aug.pdf', hash: 'b', text: broken }],
      templates: [],
      derive: () => Promise.resolve({ kind: 'lines', lines: JULY_LINES }),
    })
    if (slip === undefined) throw new Error('expected a slip')
    const first = planSlip(slip, {
      types,
      currency: 'ILS',
      named: new Map(),
      today: { year: 2026, month: 10, day: 2 },
    })
    const named = new Map(first.unnamed.map((row) => [row.field, type.id]))
    const plan = planSlip(slip, {
      types,
      currency: 'ILS',
      named,
      today: { year: 2026, month: 10, day: 2 },
    })
    expect(plan.reconciles).toBe(false)
    if (plan.draft === undefined) throw new Error('expected a draft')

    writeSlipBatch(db, [{ slip, draft: plan.draft, reconciles: plan.reconciles, named }], 1)

    expect(listPaychecksWithLines(db)).toHaveLength(1)
    expect(listTemplates(db, 'PAYSLIP')).toHaveLength(0)
  })
})
