import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { keystrokes } from './runner.ts'

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
