import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * **The engine touches none of the pack, and this is what makes it checkable.**
 *
 * `conventions.md` states it as a grep: *`src/domain/format/` imports nothing
 * from the ledger, and nothing in the ledger imports it.* A grep is a rule
 * somebody has to remember to run, and M19 U2c was the first unit that would
 * have broken it by accident — the engine needed to ask a local model a
 * question, the four questions that already existed live in `modelTasks.ts`
 * beside a payroll vocabulary, and the obvious way to reuse the shape they
 * share is a type import that quietly makes the engine depend on the pack.
 * Extracting `modelTask.ts` is what that cost, and this is what keeps it.
 *
 * The allowed list is short on purpose. `@/core/` is the layer below both —
 * money, dates, `Result`, and the string handling a Hebrew document needs
 * (U5) — and `../modelTask.ts` is the one file lifted out of the pack's task
 * list so that neither owns it.
 */
const ALLOWED_OUTSIDE = new Set([
  '../modelTask.ts',
  '@/core/money.ts',
  '@/core/result.ts',
  '@/core/text.ts',
  '@/core/time.ts',
])

const HERE = fileURLToPath(new URL('.', import.meta.url))

const SPECIFIER = /from\s+'([^']+)'/g

describe('the engine’s edges', () => {
  it('imports nothing from the ledger pack', () => {
    for (const file of readdirSync(HERE).filter((name) => name.endsWith('.ts'))) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8')
      for (const [, specifier] of source.matchAll(SPECIFIER)) {
        if (specifier === undefined) continue
        if (specifier.startsWith('./')) continue
        if (specifier.startsWith('node:') || specifier === 'vitest') continue
        expect(ALLOWED_OUTSIDE, `${file} imports ${specifier}`).toContain(specifier)
      }
    }
  })
})
