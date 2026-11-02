import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * A truncated name from a document keeps its start (M28 F17, F20).
 *
 * The ellipsis has to be on the element that carries `dir="auto"` — the `Bidi`
 * span — and not on a box around it: an LTR box that truncates clips its right
 * edge, and a Hebrew name inside it starts on the right, so the reader sees its
 * tail. The fix is the one CategoryMark and By merchant use: the wrapper is a
 * `flex min-w-0`, and `<Bidi className="min-w-0 truncate">` does the clipping.
 *
 * This scan finds a `truncate` class whose element runs into a `<Bidi>` —
 * straight away, or after words or a fragment before it (`Delete <Bidi>`,
 * `under <Bidi>`: M54 F6 widened it from the first case alone) — anywhere
 * under `src/ui`. A table cell is the one place the wrapper cannot be a flex
 * box; there the `Bidi` is `block truncate` itself.
 *
 * **Its only exceptions are the parked ledger's** (D-265: no work is taken
 * from it), each named with how many it holds, so the count can only fall.
 */
const TRUNCATING_WRAPPER =
  /className=(?:"[^"]*\btruncate\b[^"]*"|\{`[^`]*\btruncate\b[^`]*`\})[^<]{0,300}?>(?:[^<]|<>)*<Bidi[\s>]/g

/** The ledger's, parked: a category's parent, and the plan's buckets, months and pointers. */
const PARKED = {
  'categories/ParentPicker.tsx': 1,
  'plan/BucketTable.tsx': 1,
  'plan/MonthRow.tsx': 1,
  'plan/PointsAt.tsx': 1,
}

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sources(path)
    return entry.name.endsWith('.tsx') ? [path] : []
  })
}

describe('truncated document names', () => {
  it('put the ellipsis on the Bidi span, not on a box around it', () => {
    const root = import.meta.dirname
    const found: Record<string, number> = {}
    for (const file of sources(root)) {
      const count = readFileSync(file, 'utf8').match(TRUNCATING_WRAPPER)?.length ?? 0
      if (count > 0) found[relative(root, file).replaceAll('\\', '/')] = count
    }
    expect(found).toEqual(PARKED)
  })
})
