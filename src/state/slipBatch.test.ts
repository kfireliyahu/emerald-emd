/**
 * The batch outlives the screen that started it (M28 F1): what a run writes is
 * kept in the store, belongs to one document, and a Stop is heard between slips.
 */

import { afterEach, describe, expect, it } from 'vitest'

import type { BatchSlip } from '@/data/importer/slipBatch.ts'

import {
  clearSlipBatch,
  isLive,
  resumeSlipBatch,
  slipBatchNow,
  slipBatchStopping,
  stopSlipBatch,
  updateSlipBatch,
} from './slipBatch.ts'

const slip = { file: { id: 'jan' } } as unknown as BatchSlip

afterEach(clearSlipBatch)

describe('the batch being read', () => {
  it('keeps what a run wrote with no screen looking, for the document it was read against', () => {
    const document = {}
    updateSlipBatch((state) => ({ ...state, owner: document, progress: 'Reading jan.pdf — 1 of 2…' }))
    updateSlipBatch((state) => ({ ...state, slips: [...state.slips, slip] }))

    expect(slipBatchNow().slips).toHaveLength(1)
    expect(isLive(slipBatchNow(), document)).toBe(true)
    // Another document open: not its batch, and nothing says it is.
    expect(isLive(slipBatchNow(), {})).toBe(false)
  })

  it('is not live once read and written, or never started', () => {
    expect(isLive(slipBatchNow(), undefined)).toBe(false)
    const document = {}
    updateSlipBatch((state) => ({ ...state, owner: document }))
    expect(isLive(slipBatchNow(), document)).toBe(false)
  })

  it('hears a stop until the next run starts', () => {
    stopSlipBatch()
    expect(slipBatchStopping()).toBe(true)
    resumeSlipBatch()
    expect(slipBatchStopping()).toBe(false)
  })
})
