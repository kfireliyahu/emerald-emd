import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { keystrokes, verticalScroll } from './runner.ts'

describe('a watched type step (M54 U8)', () => {
  it('types after what the field holds, a character at a time', () => {
    expect(keystrokes('Wee', 'kend')).toEqual(['Week', 'Weeke', 'Weeken', 'Weekend'])
  })

  it('types a replace over the old value, never leaving the field empty', () => {
    // The timesheet tour's row 25: End emptied first moved to the empty group,
    // field-end unmounted, and step 26 found nothing.
    const written = keystrokes('', '15:30')
    expect(written).toEqual(['1', '15', '15:', '15:3', '15:30'])
    expect(written).not.toContain('')
  })

  it('writes what fast-forward writes when there is nothing to type', () => {
    expect(keystrokes('', '')).toEqual([''])
    expect(keystrokes('kept', '')).toEqual(['kept'])
  })

  it('is the only way the player writes a field while it is watched', () => {
    const player = readFileSync('src/demo/tour/player.ts', 'utf8')
    expect(player).not.toMatch(/setText\(element, ''\)/)
    expect(player).toMatch(/for \(const text of keystrokes\(before, value\)\)/)
  })
})

describe('a box brought into view is brought well into it (M54 F11)', () => {
  const outer = { top: 0, height: 759 }

  it('leaves a box clear of both edges where it is', () => {
    expect(verticalScroll(outer, { top: 300, height: 40 }, 24)).toBe(0)
  })

  it('centres a box on the bottom edge rather than scrolling it to just inside it', () => {
    // ledger 5/5: the Groceries row sat on the frame's bottom edge, its verdict below the fold.
    const by = verticalScroll(outer, { top: 697, height: 42 }, 24)
    expect(697 - by).toBeCloseTo((759 - 42) / 2)
  })

  it('puts a box taller than the room at the top, with the margin', () => {
    expect(verticalScroll(outer, { top: 900, height: 800 }, 24)).toBe(900 - 24)
  })
})
