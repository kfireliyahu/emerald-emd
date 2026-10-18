import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDatabase } from '@/data/db/database.ts'
import { installDevelopmentPack } from '@/data/packs/development/pack.ts'
import { exportEncoded } from '@/data/storage/encoding.ts'

import { dispatchPlan, dispatchPlanTool, ONLY_AS_GOOD, pathsOf, sharedPath } from './dispatch.ts'
import { recordFormatRowsTool } from './formats.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

/**
 * **Which ready units can run at once** — M51 U4. A unit's `paths` are one
 * per line, and `dispatch_plan` says which units share one and so go one
 * after another; a unit with none is unknown, never safe.
 */

describe('a unit’s paths (M51 U4)', () => {
  it('are one per line, trimmed, with \\ as / and ./ dropped, each once', () => {
    expect(pathsOf('src/a.ts\r\n  .\\src\\b.ts \n\nsrc/a.ts\n').paths).toEqual(['src/a.ts', 'src/b.ts'])
    expect(pathsOf(undefined).paths).toEqual([])
    expect(pathsOf('').paths).toEqual([])
  })

  it('name a line that holds a comma or a space, kept whole rather than split', () => {
    const read = pathsOf('src/a.ts, src/b.ts\nsrc/c.ts')
    expect(read.paths).toEqual(['src/a.ts, src/b.ts', 'src/c.ts'])
    expect(read.odd).toEqual(['src/a.ts, src/b.ts'])
  })

  it('share a file when they are one, and a folder when it holds the other', () => {
    expect(sharedPath('src/plugin/catalog.ts', 'src/plugin/Catalog.ts')).toBe('src/plugin/catalog.ts')
    expect(sharedPath('src/plugin/tools/', 'src/plugin/tools/landing.ts')).toBe('src/plugin/tools/')
    expect(sharedPath('src/plugin/tools/landing.ts', 'src/plugin/tools')).toBe('src/plugin/tools')
    expect(sharedPath('src/plugin/tool', 'src/plugin/tools/landing.ts')).toBeUndefined()
    expect(sharedPath('src/a.ts', 'src/b.ts')).toBeUndefined()
  })
})

describe('the plan (M51 U4)', () => {
  it('puts five units, four sharing one path, as one at once and four one after another', () => {
    const plan = dispatchPlan([
      { ref: 'U1', paths: ['src/shared.ts', 'src/one.ts'] },
      { ref: 'U2', paths: ['src/shared.ts'] },
      { ref: 'U3', paths: ['src/alone.ts'] },
      { ref: 'U4', paths: ['src/shared.ts', 'docs/four.md'] },
      { ref: 'U5', paths: ['src/shared.ts'] },
    ])
    expect(plan.atOnce).toEqual(['U3'])
    expect(plan.sequences).toEqual([['U1', 'U2', 'U4', 'U5']])
    expect(plan.unknown).toEqual([])
    expect(plan.overlaps).toHaveLength(6)
  })

  it('reports a unit with no paths as unknown, never as at once', () => {
    const plan = dispatchPlan([
      { ref: 'U1', paths: ['src/a.ts'] },
      { ref: 'U2', paths: [] },
    ])
    expect(plan.atOnce).toEqual(['U1'])
    expect(plan.unknown).toEqual(['U2'])
  })

  it('joins units through a third, and puts a unit already running first', () => {
    const plan = dispatchPlan(
      [
        { ref: 'U1', paths: ['src/a.ts'] },
        { ref: 'U2', paths: ['src/a.ts', 'src/b.ts'] },
        { ref: 'U3', paths: ['src/b.ts'] },
        { ref: 'U4', paths: ['src/tools/x.ts'] },
      ],
      [
        { ref: 'R1', paths: ['src/tools/'] },
        { ref: 'R2', paths: ['src/tools/y.ts'] },
      ],
    )
    expect(plan.sequences).toEqual([['R1', 'U4'], ['U1', 'U2', 'U3']])
    expect(plan.atOnce).toEqual([])
    // Two running units are not a pair this answers for.
    expect(plan.overlaps.some((each) => each.a === 'R1' && each.b === 'R2')).toBe(false)
  })
})

async function memoryOnDisk(): Promise<string> {
  const db = await createDatabase()
  const installed = installDevelopmentPack(db, Date.UTC(2026, 9, 18))
  if (!installed.ok) throw new Error(installed.error)
  const bytes = await exportEncoded(db, 'text')
  db.close()
  if (!bytes.ok) throw new Error(bytes.error)
  const path = join(await tempDir('emerald-dispatch-'), 'memory.emd')
  await writeFile(path, bytes.value)
  const write = async (format: string, rows: readonly Record<string, unknown>[]): Promise<void> => {
    const said = await recordFormatRowsTool.run({ path, format, rows, commit: true }, NO_CLIENT)
    if (!said.includes('added to')) throw new Error(said)
  }
  await write('milestone', [{ ref: 'M60', title: 'Dispatch', goal: 'Run at once', state: 'open', position: 60 }])
  await write('decision', [
    { ref: 'D-460', date: '2026-10-10', milestone: 'M47', scope: 'engine', title: 'Landing is one call', question: 'How many?', answer: 'One.', state: 'live' },
  ])
  const unit = (ref: string, paths: string | undefined, extra: Record<string, unknown> = {}) => ({
    ref,
    milestone: 'M60',
    scope: 'engine',
    title: `the ${ref} unit`,
    state: 'planned',
    ...(paths === undefined ? {} : { paths }),
    ...extra,
  })
  await write('unit', [
    unit('M60 U0', 'src/plugin/catalog.ts', { state: 'in_progress' }),
    unit('M60 U1', 'src/shared.ts\nsrc/one.ts', { brief: 'Follows D-460 and D-999.' }),
    unit('M60 U2', 'src/shared.ts'),
    unit('M60 U3', 'src/alone.ts'),
    unit('M60 U4', 'src/shared.ts\ndocs/four.md'),
    unit('M60 U5', 'src/shared.ts'),
    unit('M60 U6', undefined),
    unit('M60 U7', 'src/plugin/catalog.ts'),
  ])
  await write('unit', [unit('M60 U8', 'src/later.ts', { blocks: ['M60 U2'] })])
  return path
}

describe('dispatch_plan (M51 U4)', () => {
  it('answers which ready units run at once, which wait, which are unknown, and why the rest are not ready', async () => {
    const path = await memoryOnDisk()
    const said = await dispatchPlanTool.run(
      { path, units: ['M60 U1', 'M60 U2', 'M60 U3', 'M60 U4', 'M60 U5', 'M60 U6', 'M60 U7', 'M60 U8', 'M60 U0', 'M60 U99'] },
      NO_CLIENT,
    )
    const section = (title: string): string => said.split(`## ${title}`)[1]?.split('\n## ')[0] ?? ''

    expect(section('At once')).toContain('**M60 U3**')
    expect(section('At once')).not.toContain('M60 U1')
    expect(section('One after another')).toContain('**M60 U1** → **M60 U2** → **M60 U4** → **M60 U5**')
    expect(section('One after another')).toContain('**M60 U0** (in progress) → **M60 U7**')
    expect(section('One after another')).toContain('`src/shared.ts`')
    expect(section('Unknown')).toContain('**M60 U6**')
    expect(section('Not ready')).toContain('**M60 U8** — it waits on M60 U2 (planned)')
    expect(section('Not ready')).toContain('**M60 U0** — it is in_progress')
    expect(section('Not ready')).toContain('**M60 U99** — no unit has this ref')

    // Each ready unit's brief, the decisions it names that exist, and its paths.
    expect(said).toContain('### M60 U1 — the M60 U1 unit')
    expect(said).toContain('- D-460 — Landing is one call')
    expect(said).not.toContain('D-999 —')
    expect(said).toContain('**Paths:** none written — unknown')
    expect(said).toContain(ONLY_AS_GOOD)
  })

  it('takes every ready unit when none is named', async () => {
    const path = await memoryOnDisk()
    const said = await dispatchPlanTool.run({ path }, NO_CLIENT)
    expect(said).toContain('### M60 U3')
    expect(said).not.toContain('### M60 U8')
    expect(said).not.toContain('## Not ready')
  })
})
