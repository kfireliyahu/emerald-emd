import { describe, expect, it } from 'vitest'

import { advanceBatch, batchTotal, inBatch, NO_BATCH, startBatch } from './reportBatch.tsx'

const file = (name: string) => new File(['x'], name, { type: 'application/pdf' })

describe('a stack of reports read in one sitting', () => {
  it('hands the reader the first and holds the rest unopened', () => {
    const batch = startBatch([file('q1.pdf'), file('q2.pdf'), file('q3.pdf')], NO_BATCH)

    expect(batch.opening?.name).toBe('q1.pdf')
    expect(batch.queued.map((one) => one.name)).toEqual(['q2.pdf', 'q3.pdf'])
    expect(batchTotal(batch)).toBe(3)
  })

  it('remounts the reader on every document, so nothing carries over', () => {
    const first = startBatch([file('q1.pdf'), file('q2.pdf')], NO_BATCH)
    const second = advanceBatch(first, 'saved')

    // The key. A reader carrying the last report's text and typed-over fee into
    // the next one is the mistake the queue would otherwise make easy.
    expect(second.step).not.toBe(first.step)
  })

  it('records what became of each document, in order', () => {
    let batch = startBatch([file('q1.pdf'), file('q2.pdf'), file('q3.pdf')], NO_BATCH)
    batch = advanceBatch(batch, 'saved')
    batch = advanceBatch(batch, 'skipped')

    expect(batch.done).toEqual([
      { name: 'q1.pdf', outcome: 'saved' },
      { name: 'q2.pdf', outcome: 'skipped' },
    ])
    expect(batch.opening?.name).toBe('q3.pdf')
    // The total does not shrink as the stack is worked through: "report 3 of 3".
    expect(batchTotal(batch)).toBe(3)
  })

  it('runs out rather than looping', () => {
    let batch = startBatch([file('only.pdf')], NO_BATCH)
    batch = advanceBatch(batch, 'saved')

    expect(batch.opening).toBeUndefined()
    expect(batch.queued).toEqual([])
    expect(batch.done).toHaveLength(1)
  })

  it('is quiet until there is a stack', () => {
    expect(inBatch(NO_BATCH)).toBe(false)
    // One document opened on its own is not a batch and says nothing about one.
    expect(inBatch(startBatch([file('one.pdf')], NO_BATCH))).toBe(false)
    expect(inBatch(startBatch([file('one.pdf'), file('two.pdf')], NO_BATCH))).toBe(true)
  })

  it('keeps what is already done when another handful is picked up', () => {
    let batch = startBatch([file('q1.pdf')], NO_BATCH)
    batch = advanceBatch(batch, 'saved')
    batch = startBatch([file('q2.pdf'), file('q3.pdf')], batch)

    expect(batch.done.map((one) => one.name)).toEqual(['q1.pdf'])
    expect(batchTotal(batch)).toBe(3)
  })
})
