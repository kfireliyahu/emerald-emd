import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { CORE, FACETS, GLINTS, corners } from '@/ui/gem.ts'

const svg = readFileSync(fileURLToPath(new URL('./emerald.svg', import.meta.url)), 'utf8')
const drawn = [...svg.matchAll(/<path d="([^"]+)" fill="([^"]+)"/g)].map(([, d, fill]) => ({ d, fill }))

describe('the indicator is the mark', () => {
  it('has every facet of emerald.svg, in its order and its colours', () => {
    expect(FACETS.map(({ d, fill }) => ({ d, fill }))).toEqual(drawn.slice(0, 16))
  })

  it('has its core and both glints', () => {
    expect(drawn[16]?.d).toBe(CORE)
    expect(drawn.slice(17).map((each) => each.d)).toEqual(GLINTS.map(([d]) => d))
  })

  it('sends each facet out along its own line from the centre', () => {
    for (const facet of FACETS) {
      const points = corners(facet.d)
      const cx = points.reduce((sum, [x]) => sum + x, 0) / points.length
      const cy = points.reduce((sum, [, y]) => sum + y, 0) / points.length
      expect(Math.sign(facet.dx)).toBe(Math.sign(Math.round(cx - 32)))
      expect(Math.sign(facet.dy)).toBe(Math.sign(Math.round(cy - 32)))
    }
  })
})
