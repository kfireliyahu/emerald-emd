/**
 * A stack of payslips read in one go (M28 U3): each through the ladder, a
 * reader the batch worked out reused for the rest of it, and a slip ticked only
 * when its own arithmetic closes.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import type { PayslipLines } from '@/domain/modelTasks.ts'
import type { DeductionType } from '@/domain/model/paycheck.ts'
import type { PayslipDocumentTemplate } from '@/domain/model/templates.ts'

import { anchorPayslip, compareLabelSignatures, computeLabelSignature } from './labelTemplate.ts'
import { readSlipByLadder, type DerivePayslip } from './payslipLadder.ts'
import { batchDoubts, isLearned, namingKey, planSlip, readSlipBatch, type SlipFile } from './slipBatch.ts'

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

const deriveJuly: DerivePayslip = () => Promise.resolve({ kind: 'lines', lines: JULY_LINES })

function file(id: string, text: string, hash = id): SlipFile {
  return { id, name: `${id}.pdf`, hash, text }
}

function stored(): PayslipDocumentTemplate {
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

const TYPE: DeductionType = {
  id: 'type-1',
  name: 'Income tax',
  kind: 'TAX',
  reducesNet: true,
  fundAccountId: undefined,
  isSystem: false,
  sortOrder: 0,
  archived: false,
} as unknown as DeductionType

const TODAY = { year: 2026, month: 10, day: 2 }

describe('reading a batch', () => {
  it('reads every slip with a stored reader that fits, and asks nothing', async () => {
    const derive = vi.fn(deriveJuly)
    const slips = await readSlipBatch({
      files: [file('jul', JULY), file('aug', AUGUST)],
      templates: [stored()],
      derive,
    })

    expect(slips.map((slip) => slip.fit.kind)).toEqual(['fits', 'fits'])
    expect(slips.map((slip) => slip.reader)).toEqual(['tpl-1', 'tpl-1'])
    expect(derive).not.toHaveBeenCalled()
  })

  it('works a new layout out once and reads the rest of the batch with it', async () => {
    const derive = vi.fn(deriveJuly)
    const slips = await readSlipBatch({
      files: [file('jul', JULY), file('aug', AUGUST)],
      templates: [],
      derive,
    })

    // One model call for two slips: August fitted the reader July taught.
    expect(derive).toHaveBeenCalledOnce()
    expect(slips.map((slip) => slip.fit.kind)).toEqual(['new', 'new'])
    const reader = slips[0]?.reader
    expect(reader !== undefined && isLearned(reader)).toBe(true)
    expect(slips[1]?.reader).toBe(reader)
  })

  it('names a reader whose labels match and whose figures do not add up as close', async () => {
    const broken = AUGUST.replace('4,440.50', '4,441.50')
    const slips = await readSlipBatch({
      files: [file('aug', broken)],
      templates: [stored()],
    })

    expect(slips[0]?.fit).toEqual({ kind: 'close', name: 'Software Labs' })
  })

  it('says nothing read a slip when no reader matches and no model is on', async () => {
    const slips = await readSlipBatch({
      files: [file('jul', JULY)],
      templates: [],
    })
    expect(slips[0]?.fit.kind).toBe('none')
    expect(slips[0]?.reader).toBeUndefined()
  })

  it('stops where it is told to', async () => {
    let read = 0
    const slips = await readSlipBatch({
      files: [file('jul', JULY), file('aug', AUGUST)],
      templates: [stored()],
      onRead: () => (read += 1),
      stopped: () => read >= 1,
    })
    expect(slips).toHaveLength(1)
  })
})

/**
 * **August as a picture reads it** — M28 F1's fault (2), on real
 * slips: April to July share a layout, are read by OCR, and each month the
 * small print comes back garbled differently. Two of the months fell to 0.75
 * alike, under `CLOSE_ENOUGH`, so April's reader was never tried on May and the
 * model was asked again. The lines the reader anchors on are left alone, as
 * they were on the real ones; the small print around them is not.
 */
const NOISY = [1, 3, 4, 5, 12, 13, 14, 37, 38, 39, 40]
function garbled(text: string): string {
  return text
    .split('\n')
    .map((line, index) => (NOISY.includes(index + 1) ? line.replace(/([֐-׿]+)/, '$1ן') : line))
    .join('\n')
}
const AUGUST_OCR = garbled(AUGUST)

describe('a reader whose labels drifted (M28 F1)', () => {
  it('is too far from the page by its labels alone, which is what the fault was', () => {
    expect(
      compareLabelSignatures(computeLabelSignature(JULY), computeLabelSignature(AUGUST_OCR)).kind,
    ).toBe('none')
  })

  it('carries a reader the batch worked out to the next slip anyway, by its figures', async () => {
    const derive = vi.fn(deriveJuly)
    const slips = await readSlipBatch({
      files: [file('jul', JULY), file('aug', AUGUST_OCR)],
      templates: [],
      derive,
    })

    expect(derive).toHaveBeenCalledOnce()
    expect(slips.map((slip) => slip.fit.kind)).toEqual(['new', 'new'])
    expect(slips[1]?.reader).toBe(slips[0]?.reader)
  })

  it('reads with a stored reader whose labels it no longer matches, and says why', async () => {
    const outcome = await readSlipByLadder({ text: AUGUST_OCR, templates: [stored()] })
    expect(outcome.kind).toBe('read')
    if (outcome.kind !== 'read') return
    expect(outcome.source).toBe('stored')
    expect(outcome.stored?.id).toBe('tpl-1')
    expect(outcome.reading.reconciles).toBe(true)
    expect(outcome.attempts.join(' ')).toContain('read differently')
  })

  it('does not read by a reader whose figures do not add up on the page', async () => {
    const outcome = await readSlipByLadder({
      text: AUGUST_OCR.replace('4,440.50', '4,441.50'),
      templates: [stored()],
    })
    expect(outcome.kind).toBe('unread')
  })
})

describe('naming the rows of a slip no reader is kept from (M28 F1)', () => {
  it('names them against the slip, so the choice is not dropped', async () => {
    // The model's answer, with the net pointed at the wrong line: read, and its
    // figures do not add up, so nothing is learned from it and it has no reader.
    const wrong: DerivePayslip = () =>
      Promise.resolve({ kind: 'lines', lines: { ...JULY_LINES, netLine: 38 } })
    const [slip] = await readSlipBatch({ files: [file('jul', JULY)], templates: [], derive: wrong })
    if (slip === undefined) throw new Error('expected a slip')
    expect(slip.fit.kind).toBe('close')
    expect(slip.reader).toBeUndefined()
    expect(namingKey(slip)).toBe('slip:jul')

    const before = planSlip(slip, { types: [TYPE], currency: 'ILS', named: new Map(), today: TODAY })
    const field = before.unnamed[0]?.field
    if (field === undefined) throw new Error('expected a row to name')
    const after = planSlip(slip, {
      types: [TYPE],
      currency: 'ILS',
      named: new Map([[field, TYPE.id]]),
      today: TODAY,
    })
    expect(after.unnamed.map((row) => row.field)).not.toContain(field)
  })
})

describe('planning a slip', () => {
  it('asks for the rows its reader cannot name, and is writable once they are named', async () => {
    const [slip] = await readSlipBatch({
      files: [file('aug', AUGUST)],
      templates: [stored()],
    })
    if (slip === undefined) throw new Error('expected a slip')

    const before = planSlip(slip, {
      types: [TYPE],
      currency: 'ILS',
      named: new Map(),
      today: TODAY,
    })
    expect(before.reconciles).toBe(true)
    expect(before.unnamed.length).toBeGreaterThan(0)
    expect(before.writable).toBe(false)
    expect(before.problem).toMatch(/need a deduction type|needs a deduction type/)

    const named = new Map(before.unnamed.map((row) => [row.field, TYPE.id]))
    const after = planSlip(slip, {
      types: [TYPE],
      currency: 'ILS',
      named,
      today: TODAY,
    })
    expect(after.writable).toBe(true)
    expect(after.problem).toBeUndefined()
    expect(after.draft?.period).toEqual({ year: 2026, month: 8 })
  })

  it('is never writable when nothing read the slip', async () => {
    const [slip] = await readSlipBatch({
      files: [file('jul', JULY)],
      templates: [],
    })
    if (slip === undefined) throw new Error('expected a slip')
    const plan = planSlip(slip, {
      types: [TYPE],
      currency: 'ILS',
      named: new Map(),
      today: TODAY,
    })
    expect(plan.writable).toBe(false)
    expect(plan.problem).toContain('No model is switched on')
  })
})

describe('what is not ticked by itself', () => {
  const july = { year: 2026, month: 7 }
  const august = { year: 2026, month: 8 }

  it('doubts the same bytes twice, a month twice, and a month the document has', () => {
    const doubts = batchDoubts(
      [
        { id: 'a', hash: 'h1', period: july },
        { id: 'b', hash: 'h1', period: july },
        { id: 'c', hash: 'h2', period: july },
        { id: 'd', hash: 'h3', period: august },
      ],
      (period) => (period.month === 8 ? 1 : 0),
    )

    expect(doubts.has('a')).toBe(false)
    expect(doubts.get('b')).toMatchObject({ same: true })
    expect(doubts.get('c')?.sentence).toContain('July 2026')
    expect(doubts.get('d')?.sentence).toContain('already has')
  })
})
