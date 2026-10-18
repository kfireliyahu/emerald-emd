/**
 * The ladder, with a deriver that is a function rather than a model — which is
 * the point of it being a parameter: every rung is testable on a machine with
 * nothing installed.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import { formatMoney } from '@/core/money.ts'
import type { PayslipLines } from '@/domain/modelTasks.ts'
import type { PayslipDocumentTemplate } from '@/domain/model/templates.ts'

import { anchorPayslip, computeLabelSignature } from './labelTemplate.ts'
import {
  readSlipByLadder,
  readSlipWithTemplate,
  storesTemplate,
  type DerivePayslip,
} from './payslipLadder.ts'

const JULY = readSlip('payslip-2026-07.txt')
const AUGUST = readSlip('payslip-2026-08.txt')

function readSlip(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../fixtures/synthetic/${name}`, import.meta.url)),
    'utf8',
  )
}

const JULY_LINES: PayslipLines = {
  grossLine: 15,
  netLine: 33,
  employeeDeductionsTotalLine: 30,
  salaryMonthLine: 6,
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

/** July's slip, mapped and confirmed, as the document would hold it. */
function storedTemplate(): PayslipDocumentTemplate {
  return {
    id: 'tpl-1',
    kind: 'PAYSLIP',
    name: 'Software Labs',
    labelSignature: computeLabelSignature(JULY),
    anchors: anchorPayslip(JULY_LINES, JULY).template,
    derivedBy: 'LOCAL_MODEL',
    confirmedAt: 1,
    pinnedFields: [],
    version: 1,
    supersededAt: undefined,
    lastUsedAt: undefined,
    useCount: 0,
  }
}

const deriveJuly: DerivePayslip = () => Promise.resolve({ kind: 'lines', lines: JULY_LINES })

describe('rung 1 — a stored template', () => {
  it('reads next month’s slip with nothing asked of anything', async () => {
    const derive = vi.fn(deriveJuly)
    const outcome = await readSlipByLadder({
      text: AUGUST,
      templates: [storedTemplate()],
      derive,
    })

    expect(outcome.kind).toBe('read')
    if (outcome.kind !== 'read') return
    expect(outcome.source).toBe('stored')
    expect(outcome.stored?.name).toBe('Software Labs')
    expect(outcome.reading.reconciles).toBe(true)
    expect(formatMoney(outcome.reading.net!)).toBe('₪16,945.00')
    expect(outcome.attempts).toEqual([])
    // The condition the milestone is finished on.
    expect(derive).not.toHaveBeenCalled()
  })

  it('reads the month and the pay date off the slip', async () => {
    const outcome = await readSlipByLadder({ text: AUGUST, templates: [storedTemplate()] })

    if (outcome.kind !== 'read') throw new Error('expected a reading')
    expect(outcome.reading.salaryMonth).toEqual({ year: 2026, month: 8 })
    expect(outcome.reading.payDate).toEqual({ year: 2026, month: 9, day: 1 })
  })
})

describe('rung 2 — deriving', () => {
  it('is not reached when nothing is stored and no model is on', async () => {
    const outcome = await readSlipByLadder({ text: JULY, templates: [] })

    expect(outcome.kind).toBe('unread')
    expect(outcome.attempts).toEqual(['No model is switched on, so nothing derived a template.'])
  })

  it('derives, anchors, and reads through the anchors', async () => {
    const outcome = await readSlipByLadder({ text: JULY, templates: [], derive: deriveJuly })

    expect(outcome.kind).toBe('read')
    if (outcome.kind !== 'read') return
    expect(outcome.source).toBe('derived')
    expect(outcome.stored).toBeUndefined()
    expect(outcome.signature).toBe(computeLabelSignature(JULY))
    // Anchored on the way through: what would be stored is labels, not lines.
    expect(outcome.anchors.fields[0]?.label).toBe('סה"כ ברוטו')
    expect(outcome.reading.reconciles).toBe(true)
  })

  it('is what a stored template that stopped adding up drops to', async () => {
    // The same slip, with one deduction line altered so the arithmetic breaks:
    // the stored template still matches the labels and no longer verifies.
    const changed = AUGUST.replace('4,440.50', '4,441.50')
    const derive = vi.fn(deriveJuly)

    const outcome = await readSlipByLadder({
      text: changed,
      templates: [storedTemplate()],
      derive,
    })

    expect(derive).toHaveBeenCalledOnce()
    expect(outcome.attempts[0]).toContain('do not add up')
    expect(outcome.attempts[0]).toContain('Software Labs')
  })

  it('keeps the failed reading when the deriver comes back with nothing', async () => {
    const changed = AUGUST.replace('4,440.50', '4,441.50')
    const outcome = await readSlipByLadder({
      text: changed,
      templates: [storedTemplate()],
      derive: () => Promise.resolve({ kind: 'failed', reason: 'The model did not finish in time.' }),
    })

    // Not thrown away: the surface exists to show a person a reading that did
    // not check out, and "no template" would hide the evidence.
    expect(outcome.kind).toBe('read')
    if (outcome.kind !== 'read') return
    expect(outcome.source).toBe('stored')
    expect(outcome.reading.reconciles).toBe(false)
    expect(outcome.attempts).toHaveLength(2)
    expect(outcome.attempts[1]).toBe('The model did not finish in time.')
  })

  it('says a stored template did not match, when some are stored', async () => {
    const other = ['דוח קרן', 'יתרת פתיחה 10,000.00', 'יתרת סגירה 12,851.00'].join('\n')
    const outcome = await readSlipByLadder({ text: other, templates: [storedTemplate()] })

    expect(outcome.attempts[0]).toBe('No stored template matches this document’s labels.')
  })
})

/**
 * Stepping off the ladder: the user says which format this is (D-148).
 *
 * The case it exists for is the one 08 C14 reported — two formats fit, the
 * matcher preferred the one used last, and there was no way to say which was
 * meant. What is worth testing is not that the anchors execute (rung 1 already
 * covers that) but the two things that make the correction stick: it is read
 * with the format named, and accepting it has something to store.
 */
describe('a format chosen by hand', () => {
  it('reads the slip with the one named, and keeps the account of why', () => {
    const outcome = readSlipWithTemplate({
      text: AUGUST,
      template: storedTemplate(),
      attempts: ['No stored template matches this document’s labels.'],
    })

    expect(outcome.source).toBe('chosen')
    expect(outcome.stored?.name).toBe('Software Labs')
    expect(outcome.reading.reconciles).toBe(true)
    expect(formatMoney(outcome.reading.net!)).toBe('₪16,945.00')
    // Both sentences: what the ladder tried, and then what the user did.
    expect(outcome.attempts).toHaveLength(2)
    expect(outcome.attempts[1]).toBe('You chose the format “Software Labs” for this slip.')
  })

  it('has a template to store, because the labels that missed it are unchanged', () => {
    // The premise: August signs differently from July, which is why the matcher
    // could get this wrong in the first place.
    expect(computeLabelSignature(AUGUST)).not.toBe(computeLabelSignature(JULY))

    const outcome = readSlipWithTemplate({ text: AUGUST, template: storedTemplate() })

    // Storing a second row under August's labels is what stops the same
    // correction being needed next month.
    expect(storesTemplate(outcome)).toBe(true)
    expect(outcome.signature).toBe(computeLabelSignature(AUGUST))
    expect(outcome.anchors).toEqual(storedTemplate().anchors)
  })

  it('has nothing to store when the format already covers this document', () => {
    const outcome = readSlipWithTemplate({ text: JULY, template: storedTemplate() })

    expect(outcome.signature).toBe(storedTemplate().labelSignature)
    expect(storesTemplate(outcome)).toBe(false)
  })

  it('leaves a close automatic match storing nothing, however far its labels drifted', async () => {
    const outcome = await readSlipByLadder({ text: AUGUST, templates: [storedTemplate()] })

    if (outcome.kind !== 'read') throw new Error('expected a reading')
    // The narrowness is the point: a signature that drifts a label a month
    // would otherwise breed a template a month.
    expect(outcome.source).toBe('stored')
    expect(storesTemplate(outcome)).toBe(false)
  })

  it('stores a fresh derivation, which is what the deriving rung is for', async () => {
    const outcome = await readSlipByLadder({ text: JULY, templates: [], derive: deriveJuly })

    if (outcome.kind !== 'read') throw new Error('expected a reading')
    expect(storesTemplate(outcome)).toBe(true)
  })
})
