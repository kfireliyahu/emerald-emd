import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * **A header's hidden control takes no width** (M29 F6). The move grip and Edit
 * were `opacity-0` and kept their space, so a time column at 80px truncated its
 * name to one letter. Every class string in the sheet that reveals something on
 * a header hover has to collapse it to `w-0` at rest as well.
 */
describe('a format sheet header', () => {
  it('hides its controls without keeping their width', () => {
    const source = readFileSync(join(import.meta.dirname, 'RowSheet.tsx'), 'utf8')
    const revealing = [...source.matchAll(/(['"`])([^'"`]*group-hover\/head:opacity-100[^'"`]*)\1/g)].map(
      (match) => match[2] ?? '',
    )
    expect(revealing.length).toBeGreaterThan(0)
    expect(revealing.filter((classes) => !/(^|\s)w-0(\s|$)/.test(classes))).toEqual([])
  })
})
