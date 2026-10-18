import { describe, expect, it } from 'vitest'

import { carriesToHebrew, hebrewOffsetOf, legible, recoverRun } from './glyphOrder.ts'

/** The alphabet as glyph ids, at the offset a real Arial subset used. */
const ARIAL_HEBREW = 0x2a0
/** The same alphabet in the same file's Miriam, which sits somewhere else. */
const MIRIAM_HEBREW = 0x99

function band(first: number, howMany = 27): number[] {
  return Array.from({ length: howMany }, (_, i) => first + i)
}

/** Glyph ids 3–31: `space` through `less`, the part that arrives as controls. */
const ASCII_BAND = band(3, 29)

describe('pinning the alphabet by the width of its band', () => {
  it('finds the offset when both ends of a 27-wide run are present', () => {
    expect(hebrewOffsetOf(band(ARIAL_HEBREW))).toBe(0x330)
    expect(hebrewOffsetOf(band(MIRIAM_HEBREW))).toBe(0x537)
  })

  it('tolerates the letters a page happens not to use', () => {
    // 18 of 27, which is what a real May slip's Miriam carries. Both ends are
    // still there, so the alignment is still pinned.
    const sparse = band(MIRIAM_HEBREW).filter((_, i) => i === 0 || i === 26 || i % 3 !== 0)
    expect(sparse.length).toBeLessThan(22)
    expect(hebrewOffsetOf(sparse)).toBe(0x537)
  })

  it('refuses a run whose ends do not pin it', () => {
    // 24 wide: four different alignments would fit, and none is more right.
    expect(hebrewOffsetOf(band(ARIAL_HEBREW + 3, 24))).toBeUndefined()
  })

  it('refuses a band too thin to be an alphabet', () => {
    const thin = [ARIAL_HEBREW, ARIAL_HEBREW + 1, ARIAL_HEBREW + 2, ARIAL_HEBREW + 26]
    expect(hebrewOffsetOf(thin)).toBeUndefined()
  })

  it('never mistakes the ASCII band for an alphabet', () => {
    // Space through colon is 27 glyph ids wide, which is exactly the trap: a
    // font of pure figures must yield no Hebrew offset at all.
    expect(hebrewOffsetOf(ASCII_BAND)).toBeUndefined()
  })

  it('still pins the alphabet in a font that sets figures beside it', () => {
    // The measured Miriam does both, and the ASCII half must not veto the other.
    expect(hebrewOffsetOf([...ASCII_BAND, ...band(MIRIAM_HEBREW)])).toBe(0x537)
  })

  it('refuses when two alphabets would fit, rather than choosing one', () => {
    expect(hebrewOffsetOf([...band(ARIAL_HEBREW), ...band(MIRIAM_HEBREW)])).toBeUndefined()
  })
})

describe('a font too small to pin its own offset', () => {
  const bold = band(ARIAL_HEBREW + 3, 13)

  it('takes one its own document earned', () => {
    expect(carriesToHebrew(bold, 0x330)).toBe(true)
  })

  it('rejects one that lands it anywhere else', () => {
    expect(carriesToHebrew(bold, 0x537)).toBe(false)
  })

  it('says no when there is nothing but figures to carry', () => {
    expect(carriesToHebrew(ASCII_BAND, 0x330)).toBe(false)
  })
})

describe('recovering a run', () => {
  it('reads the figures with no Hebrew offset at all', () => {
    // glyph 19 is `0`, 15 is `,`, 17 is `.` — the standard order, and the
    // whole of what a row of money needs.
    const glyphs = String.fromCodePoint(20, 15, 22, 23, 24, 17, 19, 19)
    expect(recoverRun(glyphs, undefined)).toBe('1,345.00')
  })

  it('turns the alphabet back into words, in logical order', () => {
    // `עובד` as this file's Arial draws it: visual order, right to left.
    const drawn = String.fromCodePoint(0x2a3, 0x2a1, 0x2a5, 0x2b2)
    expect(recoverRun(drawn, 0x330)).toBe('עובד')
  })

  it('leaves a row of figures in the order it was drawn', () => {
    const glyphs = String.fromCodePoint(19, 17, 19, 19)
    expect(recoverRun(glyphs, 0x330)).toBe('0.00')
  })

  it('leaves alone what neither band claims', () => {
    expect(recoverRun('₪ x', 0x330)).toBe('₪ x')
  })

  it('never touches a literal space, which is glyph 32 in the same order', () => {
    // The bug this exists to stop: U+0020 sits one past the controls, so a band
    // that ran to `at` shifted real spaces into `=`.
    expect(recoverRun('1 2', undefined)).toBe('1 2')
  })
})

describe('scoring a recovery', () => {
  it('counts letters and digits alike', () => {
    expect(legible('סה"כ 1,234.00')).toBe(9)
  })

  it('scores an unmapped glyph run at nothing, letters though Unicode calls them', () => {
    // `ʣ` (U+02A3) and `ʲ` (U+02B2) are letters by category. Counting them is
    // what once made a broken run score as high as its repair and kept it.
    expect(legible(String.fromCodePoint(0x2a3, 0x2a1, 0x2a5, 0x2b2))).toBe(0)
  })

  it('scores unmapped figure glyphs at nothing too', () => {
    expect(legible(String.fromCodePoint(19, 17, 19, 19))).toBe(0)
  })

  it('prefers the repair over the breakage in both bands', () => {
    const hebrew = String.fromCodePoint(0x2a3, 0x2a1, 0x2a5, 0x2b2)
    expect(legible(recoverRun(hebrew, 0x330))).toBeGreaterThan(legible(hebrew))
    const figures = String.fromCodePoint(20, 15, 22, 23, 24, 17, 19, 19)
    expect(legible(recoverRun(figures, undefined))).toBeGreaterThan(legible(figures))
  })
})
