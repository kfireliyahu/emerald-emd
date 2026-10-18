import { describe, expect, it } from 'vitest'

import { relabel, wordsIn, type OcrWord, type PlacedRun } from './relabel.ts'

/** A run 40pt wide, 10pt type, sitting with its baseline at y=100. */
function run(text: string, over: Partial<PlacedRun> = {}): PlacedRun {
  return { text, x: 200, y: 100, width: 40, size: 10, ...over }
}

function word(text: string, x: number, y: number): OcrWord {
  return { text, x, y }
}

describe('which words belong to a run', () => {
  it('takes the ones inside its box', () => {
    const found = wordsIn(run('שלום'), [word('ביטוח', 230, 103), word('לאומי', 210, 103)])
    expect(found.map((w) => w.text)).toEqual(['ביטוח', 'לאומי'])
  })

  it('orders them right to left, whatever order they arrive in', () => {
    // The run's own order was never trustworthy — that is why OCR is here — so
    // the geometry decides.
    const found = wordsIn(run('שלום'), [word('לאומי', 210, 103), word('ביטוח', 230, 103)])
    expect(found.map((w) => w.text)).toEqual(['ביטוח', 'לאומי'])
  })

  it('reaches above the baseline further than below it', () => {
    // A baseline is not the middle of a line: letters rise above it and only
    // descenders fall below.
    expect(wordsIn(run('א'), [word('גבוה', 220, 108)])).toHaveLength(1)
    expect(wordsIn(run('א'), [word('נמוך', 220, 92)])).toHaveLength(0)
  })

  it('does not take a word from the row beneath', () => {
    expect(wordsIn(run('א'), [word('אחר', 220, 88)])).toHaveLength(0)
  })

  it('does not take a word from the column beside', () => {
    expect(wordsIn(run('א'), [word('אחר', 260, 103)])).toHaveLength(0)
  })
})

describe('relabelling a run', () => {
  it('replaces a Hebrew run with what the picture says', () => {
    // The measured case: the arithmetic recovers `ביטו`, having lost a letter
    // to a segmentation it never controlled, and the drawn page has all of it.
    const text = relabel(run('ביטו'), [word('ביטוח', 230, 103), word('לאומי', 210, 103)])
    expect(text).toBe('ביטוח לאומי')
  })

  it('never touches a run of figures, whatever OCR thinks it saw', () => {
    // The whole bargain: the PDF's figures are exact and OCR's are 41 of 45.
    const text = relabel(run('1,234.00'), [word('1.234,00', 220, 103)])
    expect(text).toBe('1,234.00')
  })

  it('keeps the recovered text where the picture has nothing there', () => {
    expect(relabel(run('פנסיה'), [])).toBe('פנסיה')
    expect(relabel(run('פנסיה'), [word('אחר', 900, 900)])).toBe('פנסיה')
  })

  it('leaves an unrecovered run alone rather than guessing at it', () => {
    // Symbol-block characters are letters by Unicode's reckoning, so a test for
    // "has letters" would hand this to OCR. A run nothing could recover is a
    // run whose position means nothing.
    const broken = String.fromCodePoint(0x2a3, 0x2a1, 0x2a5)
    expect(relabel(run(broken), [word('עובד', 220, 103)])).toBe(broken)
  })
})
