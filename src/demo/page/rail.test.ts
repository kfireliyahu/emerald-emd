import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { rowAt, tones } from './rail.ts'
import { SOURCE_URL } from './page.ts'

describe('the page as a roadmap (M33 U8)', () => {
  it('the row under the eye is the last whose top has passed the mark', () => {
    expect(rowAt([0, 500, 1000], 400, false)).toBe(0)
    expect(rowAt([0, 500, 1000], 600, false)).toBe(1)
    expect(rowAt([0, 500, 1000], 1000, false)).toBe(2)
  })

  it('a page scrolled to its end is at its last row, however short that row is', () => {
    expect(rowAt([0, 500, 1000], 600, true)).toBe(2)
  })

  it('the first row when none has passed, and nothing when there are no rows', () => {
    expect(rowAt([100, 500], 0, false)).toBe(0)
    expect(rowAt([], 0, false)).toBe(-1)
  })

  it('what was read is done, the row under the eye is live, the rest wait', () => {
    expect(tones(4, 1)).toEqual(['done', 'live', 'waiting', 'waiting'])
    expect(tones(2, 0)).toEqual(['live', 'waiting'])
  })

  it('the source address is the one package.json names (D-452)', () => {
    const { repository } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
      repository?: string | { url?: string }
    }
    const named = typeof repository === 'string' ? repository : (repository?.url ?? '')
    expect(named.replace(/^git\+/, '').replace(/\.git$/, '')).toBe(SOURCE_URL)
  })
})
