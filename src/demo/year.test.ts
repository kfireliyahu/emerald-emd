/**
 * **The synthetic year** (M64 U16, D-611): `scripts/demo-year.mjs` builds
 * `.demo/year.emd` from `fixtures/synthetic/demo/year/year.json`, and the
 * cases it was made for are in what the document says about itself.
 *
 * Built here in-process, through the plugin's own tools — the same calls the
 * demo builder makes over stdio — on a fixed day, so the running month is
 * always November 2026.
 *
 * Under the month rule of D-607 and D-609 (`src/data/repositories/monthBasis.ts`):
 * a card purchase counts in the month it was bought, a month is partial until
 * every card's statement covering it is read, and saved is capped at what the
 * month left over, the rest said to come from earlier savings.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { ENGINE_TOOLS, LEDGER_TOOLS } from '@/plugin/server.ts'
import { NO_CLIENT } from '@/plugin/tools/tool.ts'
import { tempDir } from '@/testing/tempDir.ts'

import { makeYear, yearMonths } from '../../scripts/demo-year.mjs'

const YEAR: unknown = JSON.parse(
  readFileSync(new URL('../../fixtures/synthetic/demo/year/year.json', import.meta.url), 'utf8'),
)
const TODAY = { year: 2026, month: 11, day: 25 }
const TOOLS = new Map([...ENGINE_TOOLS, ...LEDGER_TOOLS].map((tool) => [tool.definition.name, tool]))

/** A tool by name, refusing the way the demo builder refuses: any answer that wrote nothing. */
async function ask(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = TOOLS.get(name)
  if (tool === undefined) throw new Error(`No tool ${name}`)
  const text = await tool.run(args, NO_CLIENT)
  if (/nothing was written|declares no formats/i.test(text)) {
    throw new Error(`${name} refused:\n${text.slice(0, 1200)}`)
  }
  return text
}

/** A figure off month_summary's table, in minor units. */
function figure(summary: string, label: string): number {
  const cell = new RegExp(`^\\| ${label} \\| (-?)₪([\\d,.]+) \\|`, 'm').exec(summary)
  if (cell === null) throw new Error(`No ${label} in:\n${summary.slice(0, 600)}`)
  return (cell[1] === '-' ? -1 : 1) * Math.round(Number((cell[2] ?? '').replace(/,/g, '')) * 100)
}

let target = ''
const month = (period: string) => ask('month_summary', { path: target, month: period })
const PARTIAL = 'figures are partial)'
/** Whether month_summary calls the month unfinished, on its first line. */
const partial = (summary: string) => (summary.split('\n')[0] ?? '').includes(PARTIAL)

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(TODAY.year, TODAY.month - 1, TODAY.day, 12))
  target = join(await tempDir('emerald-year-'), 'year.emd')
  await ask('create_document', { path: target, packs: ['ledger'] })
  await makeYear(target, YEAR, ask, TODAY)
}, 300_000)

afterAll(() => {
  vi.useRealTimers()
})

describe('the synthetic year', () => {
  it('is fourteen months, ending in the one the build runs in', async () => {
    const months = yearMonths(TODAY, 14)
    expect(months[0]?.period).toBe('2025-10')
    expect(months.at(-1)?.period).toBe('2026-11')
    const known = /Months with data: (.*)\./.exec(await month('2026-10'))?.[1]?.split(', ')
    expect(known).toEqual(months.map((one) => one.period))
  })

  it('has a running month, its figures partial', async () => {
    expect(partial(await month('2026-11'))).toBe(true)
    expect(partial(await month('2026-07'))).toBe(false)
  })

  it('misses the second card’s statement for August, so August is partial and short of it', async () => {
    // The gym is billed on the second card alone, every month: its absence is the statement's.
    const august = await month('2026-08')
    expect(partial(august)).toBe(true)
    expect(august).not.toContain('| Fitness |')
    expect(await month('2026-07')).toContain('| Fitness |')
    expect(await month('2026-09')).toContain('| Fitness |')
  })

  it('counts a card purchase in the month it was bought (D-607)', async () => {
    // October's purchases are billed on 2 and 10 November, and count in October.
    // No card statement covers November yet, so November has no card spending.
    const october = await month('2026-10')
    expect(october).toContain('| Restaurants & Cafes |')
    expect(october).toContain('| Groceries |')
    const november = await month('2026-11')
    expect(november).not.toContain('| Restaurants & Cafes |')
    expect(november).not.toContain('| Groceries |')
  })

  it('moves more to investments in July than July left over, the rest from earlier savings', async () => {
    const july = await month('2026-07')
    expect(july).toContain('| Investments | moved, 1 row | ₪30,000.00 |')
    const saved = figure(july, 'Saved')
    const earlier = figure(july, '  of which from earlier savings')
    expect(saved).toBe(figure(july, 'Balance'))
    expect(earlier).toBeGreaterThan(0)
    expect(saved + earlier).toBe(figure(july, '  moved into savings and goals'))
  })

  it('has a bonus month among its slips, and Hebrew rows left uncategorized', async () => {
    expect(await ask('paychecks', { path: target, limit: 14 })).toContain('bonus month')
    const backlog = await ask('uncategorized_merchants', { path: target })
    expect(backlog).toContain('חנות הפינה הבדויה')
    expect(backlog).toContain('Pixel Arcade')
  })
})
