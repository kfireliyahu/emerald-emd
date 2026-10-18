import { describe, expect, it } from 'vitest'

import { marksDiffer } from '../../../electron/bridge.ts'
import { compareToDisk, copyFileName, followsDisk, wouldOverwrite } from './externalChange.ts'

const mark = { lastModified: 1_700_000_000_000, size: 4096 }

describe('compareToDisk', () => {
  it('is unwatched when the adapter has no file to watch', () => {
    expect(compareToDisk(mark, { kind: 'unwatched' }, false)).toEqual({ kind: 'unwatched' })
  })

  it('is unwatched before the first read or write, even with a readable file', () => {
    // A new document that has never been saved has nothing to compare against,
    // and "in-sync" would be a claim we cannot make.
    expect(compareToDisk(undefined, { kind: 'mark', mark }, false)).toEqual({ kind: 'unwatched' })
  })

  it('is in sync when the mark is unchanged', () => {
    expect(compareToDisk(mark, { kind: 'mark', mark: { ...mark } }, true)).toEqual({
      kind: 'in-sync',
    })
  })

  it('reports a changed timestamp, carrying whether there is work to lose', () => {
    const later = { ...mark, lastModified: mark.lastModified + 1000 }
    expect(compareToDisk(mark, { kind: 'mark', mark: later }, false)).toEqual({
      kind: 'changed',
      hasUnsavedWork: false,
    })
    expect(compareToDisk(mark, { kind: 'mark', mark: later }, true)).toEqual({
      kind: 'changed',
      hasUnsavedWork: true,
    })
  })

  it('reports a changed size even when the timestamp did not move', () => {
    // A writer that preserves mtime still changes the length of the database.
    const resized = { ...mark, size: mark.size + 4096 }
    expect(compareToDisk(mark, { kind: 'mark', mark: resized }, false)).toEqual({
      kind: 'changed',
      hasUnsavedWork: false,
    })
  })

  it('passes an unreadable file through with its reason', () => {
    expect(compareToDisk(mark, { kind: 'unreadable', reason: 'file moved' }, true)).toEqual({
      kind: 'unreadable',
      reason: 'file moved',
    })
  })

  it('never says a save would overwrite unless the file really changed', () => {
    expect(wouldOverwrite({ kind: 'unwatched' })).toBe(false)
    expect(wouldOverwrite({ kind: 'in-sync' })).toBe(false)
    expect(wouldOverwrite({ kind: 'unreadable', reason: 'gone' })).toBe(false)
    expect(wouldOverwrite({ kind: 'changed', hasUnsavedWork: false })).toBe(true)
  })
})

describe('marksDiffer', () => {
  it('compares both facts', () => {
    expect(marksDiffer(mark, { ...mark })).toBe(false)
    expect(marksDiffer(mark, { ...mark, size: 1 })).toBe(true)
    expect(marksDiffer(mark, { ...mark, lastModified: 1 })).toBe(true)
  })
})

describe('copyFileName', () => {
  it('inserts the suffix before the extension', () => {
    expect(copyFileName('untitled-2026-08.emd')).toBe(
      'untitled-2026-08 (copy).emd',
    )
  })

  it('does not stack copies', () => {
    expect(copyFileName('finances (copy).emd')).toBe('finances (copy).emd')
  })

  it('handles a name with no extension and a dotfile', () => {
    expect(copyFileName('finances')).toBe('finances (copy)')
    expect(copyFileName('.emd')).toBe('.emd (copy)')
  })
})

describe('followsDisk (M27 U6)', () => {
  it('re-reads a changed file only when nothing here is unsaved', () => {
    expect(followsDisk({ kind: 'changed', hasUnsavedWork: false })).toBe(true)
    expect(followsDisk({ kind: 'changed', hasUnsavedWork: true })).toBe(false)
    expect(followsDisk({ kind: 'in-sync' })).toBe(false)
    expect(followsDisk({ kind: 'unwatched' })).toBe(false)
    expect(followsDisk({ kind: 'unreadable', reason: 'gone' })).toBe(false)
  })
})
