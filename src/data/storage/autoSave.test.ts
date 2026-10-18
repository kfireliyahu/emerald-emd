import { describe, expect, it } from 'vitest'

import {
  AUTO_SAVE_CEILING_MS,
  AUTO_SAVE_IDLE_MS,
  autoSaveAt,
  canAutoSaveAtAll,
  mayAutoSave,
  type AutoSaveInputs,
} from './autoSave.ts'

const READY: AutoSaveInputs = {
  hasDocument: true,
  isDirty: true,
  isBusy: false,
  canSaveSilently: true,
  knowsTheFile: true,
  diskState: { kind: 'in-sync' },
}

describe('whether the app may write the document itself', () => {
  it('may, when there is unsaved work in a file it knows about', () => {
    expect(mayAutoSave(READY)).toBe(true)
  })

  it('may not without a document', () => {
    expect(mayAutoSave({ ...READY, hasDocument: false })).toBe(false)
  })

  it('may not when there is nothing to save', () => {
    expect(mayAutoSave({ ...READY, isDirty: false })).toBe(false)
  })

  it('may not on top of a save the user asked for, or an open in flight', () => {
    expect(mayAutoSave({ ...READY, isBusy: true })).toBe(false)
  })

  /**
   * D-155 rule 1, and the reason it is not a limitation: a document with no
   * path has nothing to save *to*, and inventing somewhere is the D-115
   * mistake. A new document stays unsaved until *Save as* names it.
   */
  it('may not create a file — a document it has never written has nowhere to go', () => {
    expect(mayAutoSave({ ...READY, knowsTheFile: false })).toBe(false)
  })

  /** Rule 6. The download adapter cannot save silently and never pretends to. */
  it('may not when every save is a download', () => {
    expect(mayAutoSave({ ...READY, canSaveSilently: false })).toBe(false)
  })

  /** Rule 2, and it is D-092's refusal rather than a second one. */
  it('may not when the file changed underneath us', () => {
    expect(mayAutoSave({ ...READY, diskState: { kind: 'changed', hasUnsavedWork: true } })).toBe(
      false,
    )
  })

  it('still may when the file cannot be read — that is not a conflict', () => {
    expect(
      mayAutoSave({ ...READY, diskState: { kind: 'unreadable', reason: 'gone' } }),
    ).toBe(true)
  })
})

describe('whether this document could ever be written automatically', () => {
  it('is a fact about where it lives, not about unsaved work', () => {
    expect(canAutoSaveAtAll({ ...READY, hasDocument: true })).toBe(true)
    expect(canAutoSaveAtAll({ hasDocument: true, canSaveSilently: true, knowsTheFile: false })).toBe(
      false,
    )
    expect(canAutoSaveAtAll({ hasDocument: true, canSaveSilently: false, knowsTheFile: true })).toBe(
      false,
    )
    expect(canAutoSaveAtAll({ hasDocument: false, canSaveSilently: true, knowsTheFile: true })).toBe(
      false,
    )
  })
})

describe('when the write happens', () => {
  it('is the debounce after a single edit', () => {
    expect(autoSaveAt(1_000, 1_000)).toBe(1_000 + AUTO_SAVE_IDLE_MS)
  })

  it('slides with the edits while they keep coming', () => {
    expect(autoSaveAt(1_000, 2_000)).toBe(2_000 + AUTO_SAVE_IDLE_MS)
  })

  it('stops sliding at the ceiling, so a long drag still lands', () => {
    // A slider dragged for a minute: the last edit is always a moment ago, and
    // without the ceiling the write would never happen.
    expect(autoSaveAt(1_000, 61_000)).toBe(1_000 + AUTO_SAVE_CEILING_MS)
  })

  it('takes its timings from the caller when asked, so the test need not wait', () => {
    expect(autoSaveAt(0, 0, { idleMs: 10, ceilingMs: 100 })).toBe(10)
    expect(autoSaveAt(0, 500, { idleMs: 10, ceilingMs: 100 })).toBe(100)
  })
})
