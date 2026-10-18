import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearRead,
  hideRead,
  showRead,
  countTokens,
  finishRead,
  noteRead,
  readingNow,
  replaceRead,
  startRead,
} from './reading.ts'

/**
 * The store that lets a read outlive the screen that started it (D-171).
 *
 * What is worth testing is the half nobody can see: an abandoned read finishing
 * after a newer one started is the whole reason the id exists, and it is
 * exactly the case a person driving the app would have to be quick to produce.
 */
describe('the document read store', () => {
  beforeEach(() => {
    clearRead()
  })

  it('holds one read, said the way a bar can print it', () => {
    startRead({ kind: 'payslip', label: 'july.pdf' })

    expect(readingNow()?.kind).toBe('payslip')
    expect(readingNow()?.label).toBe('july.pdf')
    expect(readingNow()?.working).toBe(true)
    expect(readingNow()?.value).toBeUndefined()
  })

  it('lets a read say what it is doing, and stops saying it when it lands', () => {
    const id = startRead({ kind: 'payslip', label: 'july.pdf' })

    noteRead(id, 'Reading the words off a picture of page 1…')
    countTokens(id, 240)
    expect(readingNow()?.note).toContain('picture')
    expect(readingNow()?.tokens).toBe(240)

    finishRead(id, { value: { text: 'gross 24,500' } })
    expect(readingNow()?.working).toBe(false)
    expect(readingNow()?.note).toBeUndefined()
    expect(readingNow()?.value).toEqual({ text: 'gross 24,500' })
  })

  it('will not let an abandoned read land in the one that replaced it', () => {
    // The case the whole `id` exists for: somebody opens a second document
    // while the first is still in its OCR pass, and four seconds later the
    // first one answers. Without the guard it overwrites the read they are
    // actually looking at, with the document they gave up on.
    const first = startRead({ kind: 'payslip', label: 'june.pdf' })
    const second = startRead({ kind: 'payslip', label: 'july.pdf' })

    noteRead(first, 'still going')
    countTokens(first, 999)
    finishRead(first, { value: { text: 'june' } })

    expect(readingNow()?.id).toBe(second)
    expect(readingNow()?.label).toBe('july.pdf')
    expect(readingNow()?.working).toBe(true)
    expect(readingNow()?.note).toBeUndefined()
    expect(readingNow()?.tokens).toBe(0)
  })

  it('keeps a failed read, because its text is what a hand-picked format needs', () => {
    const id = startRead({ kind: 'report', label: 'q2.pdf' })
    finishRead(id, { value: { text: 'a report' }, problem: 'Nothing could read this document.' })

    expect(readingNow()?.problem).toBe('Nothing could read this document.')
    expect(readingNow()?.value).toEqual({ text: 'a report' })
  })

  it('lets the flow replace what it holds, but only once the read is over', () => {
    const id = startRead({ kind: 'report', label: 'q2.pdf' })

    // Mid-read there is nothing to replace, and writing here would race the
    // answer that is still coming.
    replaceRead({ text: 'typed over' })
    expect(readingNow()?.value).toBeUndefined()

    finishRead(id, { value: { text: 'a report', outcome: 'first' } })
    replaceRead({ text: 'a report', outcome: 'chosen by hand' })
    expect(readingNow()?.value).toEqual({ text: 'a report', outcome: 'chosen by hand' })
  })

  it('closes and reopens the flow without stopping the read', () => {
    // The bug the first drive found: the flow is a state of a screen, and the
    // bar that reopens it is not that screen's child. Whoever owns the flag,
    // both of them have to be able to set it.
    const id = startRead({ kind: 'payslip', label: 'july.pdf' })
    expect(readingNow()?.open).toBe(true)

    hideRead()
    expect(readingNow()?.open).toBe(false)
    expect(readingNow()?.working).toBe(true)

    noteRead(id, 'still reading')
    expect(readingNow()?.note).toBe('still reading')

    showRead()
    expect(readingNow()?.open).toBe(true)
  })

  it('is empty once the read has been collected', () => {
    const id = startRead({ kind: 'payslip', label: 'july.pdf' })
    finishRead(id, { value: {} })
    clearRead()

    expect(readingNow()).toBeUndefined()
  })
})
