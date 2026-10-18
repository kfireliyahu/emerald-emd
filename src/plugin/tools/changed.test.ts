/**
 * **A format nobody reads says so** (M47 U5, D-462): `formats` prints when each
 * format last changed beside its row count, a write moves only its own, and
 * `start_here` names the formats beyond the packs' that were touched longest ago.
 */

import { describe, expect, it } from 'vitest'

import { instantDay } from '@/core/instant.ts'

import { markedSite } from '../../testing/markedSite'
import { formatsTool, recordFormatRowsTool } from './formats.ts'
import { startHereTool } from './startHere.ts'
import { NO_CLIENT } from './tool.ts'

/** The fixture is built in `src/testing/`, since nothing under `src/plugin/` may hold SQL (D-095). */
const site = markedSite

describe('when each format last changed (M47 U5, D-462)', () => {
  it('is printed beside every format’s row count, and in its declaration', async () => {
    const path = await site(false)
    const answer = await formatsTool.run({ path }, NO_CLIENT)
    expect(answer).toContain('| Rows | Last changed |')
    expect(answer).toMatch(/\| copy_slot \| fmt_copy_slot \| 1 \| 2 \| 2026-10-06 \|/)
    expect(answer).toMatch(/\| dns_record \| fmt_dns_record \| 1 \| 1 \| 2026-10-09 \|/)

    const one = await formatsTool.run({ path, format: 'copy_slot' }, NO_CLIENT)
    expect(one).toContain('2 rows, last changed 2026-10-06.')
  })

  for (const old of [false, true]) {
    it(`moves only the written format’s — ${old ? 'in a document saved before there were marks' : 'in a document with them'}`, async () => {
      const path = await site(old)
      await recordFormatRowsTool.run({ path, format: 'dns_record', rows: [{ key: 'mail' }], commit: true }, NO_CLIENT)
      const answer = await formatsTool.run({ path }, NO_CLIENT)
      expect(answer).toMatch(/\| copy_slot \| fmt_copy_slot \| 1 \| 2 \| 2026-10-06 \|/)
      expect(answer).toContain(`| dns_record | fmt_dns_record | 1 | 2 | ${instantDay(Date.now())} |`)
    })
  }

  it('start_here names the formats beyond the packs’ touched longest ago, oldest first', async () => {
    const path = await site(false)
    const answer = await startHereTool.run({ path }, NO_CLIENT)
    expect(answer).toContain(
      '**Untouched longest:** `copy_slot` · 2 rows · last changed 2026-10-06; `dns_record` · 1 row · last changed 2026-10-09.',
    )
  })
})
