import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDatabase } from '@/data/db/database.ts'
import { installDevelopmentPack } from '@/data/packs/development/pack.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import { listRows } from '@/data/repositories/formatRowRepository.ts'
import { exportEncoded, openEncoded, type DocumentEncoding } from '@/data/storage/encoding.ts'

import { recordFormatRowsTool } from './formats.ts'
import { claimUnitsTool, landUnitsTool, REPORT_MAX } from './landing.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

/**
 * **Landing a unit is one call** — M47 U3. The closing pass was a write per
 * row; `land_units` is the decisions, the unit, its review entries and the
 * milestone as one batch, and `claim_units` is the claim for a list.
 */

const NOW = Date.UTC(2026, 9, 13)

async function memoryOnDisk(encoding: DocumentEncoding, packs = true): Promise<string> {
  const db = await createDatabase()
  if (packs) {
    const installed = installDevelopmentPack(db, NOW)
    if (!installed.ok) throw new Error(installed.error)
  }
  const bytes = await exportEncoded(db, encoding)
  db.close()
  if (!bytes.ok) throw new Error(bytes.error)
  const path = join(await tempDir('emerald-landing-'), 'memory.emd')
  await writeFile(path, bytes.value)
  if (!packs) return path

  await recordFormatRowsTool.run(
    {
      path,
      format: 'milestone',
      rows: [{ ref: 'M47', title: 'A week on three documents', goal: 'Fewer turns', state: 'open', position: 47 }],
      commit: true,
    },
    NO_CLIENT,
  )
  await recordFormatRowsTool.run(
    {
      path,
      format: 'unit',
      rows: [
        { ref: 'M47 U3', milestone: 'M47', scope: 'engine', title: 'landing is one call', state: 'in_progress' },
        { ref: 'M47 U4', milestone: 'M47', scope: 'engine', title: 'next', state: 'planned' },
        { ref: 'M47 U5', milestone: 'M47', scope: 'engine', title: 'after', state: 'planned' },
      ],
      commit: true,
    },
    NO_CLIENT,
  )
  return path
}

async function rowsOf(path: string, format: string): Promise<readonly { id: string; cells: Readonly<Record<string, unknown>> }[]> {
  const { db } = await openEncoded(readFileSync(path))
  const declaration = listFormats(db).find((each) => each.name === format)
  if (declaration === undefined) throw new Error(`no ${format}`)
  const rows = listRows(db, declaration)
  db.close()
  return rows
}

async function unit(path: string, ref: string): Promise<Readonly<Record<string, unknown>>> {
  const row = (await rowsOf(path, 'unit')).find((each) => each.cells['ref'] === ref)
  if (row === undefined) throw new Error(`no ${ref}`)
  return row.cells
}

const DECISION = { ref: 'D-461', title: 'Landing is one call', question: 'How many writes?', answer: 'One.' }

function landing(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    unit: 'M47 U3',
    landed: '2026-10-13',
    files: 'src/plugin/tools/landing.ts',
    decisions: [DECISION],
    review_entries: [{ do: 'Call land_units', should: 'One call' }],
    commit: '1a2b3c4',
    ...extra,
  }
}

describe('land_units (M47 U3)', () => {
  for (const encoding of ['text', 'sqlite'] as const) {
    it(`lands a unit, its decision, its review entry and its milestone in one write, in a ${encoding} document`, async () => {
      const path = await memoryOnDisk(encoding)
      const before = readFileSync(path)

      const dry = await landUnitsTool.run({ path, units: [landing({ close_milestone: 'M47' })] }, NO_CLIENT)
      // The diff by format, in the order the steps run, and nothing on disk.
      const order = ['## decision', '## unit', '## review_entry', '## milestone'].map((heading) => dry.indexOf(heading))
      expect(order.every((at) => at >= 0)).toBe(true)
      expect([...order].sort((a, b) => a - b)).toEqual(order)
      expect(dry).toContain('Nothing has been written')
      expect(readFileSync(path).equals(before)).toBe(true)

      const done = await landUnitsTool.run({ path, units: [landing({ close_milestone: 'M47' })], commit: true }, NO_CLIENT)
      expect(done).toContain('1 row added to Decision')
      expect(done).toContain('1 row of Unit changed')

      const [decision] = await rowsOf(path, 'decision')
      // The decision takes its unit's milestone and scope, today's landing and `live`.
      expect(decision?.cells).toMatchObject({ ref: 'D-461', date: '2026-10-13', milestone: 'M47', scope: 'engine', state: 'live' })
      expect(await unit(path, 'M47 U3')).toMatchObject({
        state: 'built',
        landed: '2026-10-13',
        files: 'src/plugin/tools/landing.ts',
        // Linked to the row the same landing wrote, by its name.
        decision: decision?.id,
      })
      const [entry] = await rowsOf(path, 'review_entry')
      expect(entry?.cells).toMatchObject({ do: 'Call land_units', should: 'One call', state: 'open' })
      const [milestone] = await rowsOf(path, 'milestone')
      expect(milestone?.cells).toMatchObject({ state: 'closed' })
    })
  }

  it('lands several units in one call, one naming a decision that exists', async () => {
    const path = await memoryOnDisk('text')
    await landUnitsTool.run({ path, units: [landing()], commit: true }, NO_CLIENT)
    const answer = await landUnitsTool.run(
      { path, units: [{ unit: 'M47 U4', decision: 'D-461', commit: 'abc1234' }, { unit: 'M47 U5', same_commit: true }], commit: true },
      NO_CLIENT,
    )
    expect(answer).toContain('2 rows of Unit changed')
    const [decision] = await rowsOf(path, 'decision')
    expect(await unit(path, 'M47 U4')).toMatchObject({ state: 'built', decision: decision?.id })
    expect((await unit(path, 'M47 U5'))['decision'] ?? null).toBeNull()
  })

  it('writes nothing when one step refuses — not even the steps before it', async () => {
    const path = await memoryOnDisk('text')
    const before = readFileSync(path)
    const answer = await landUnitsTool.run(
      { path, units: [landing({ review_entries: [{ do: 'no should' }] })], commit: true },
      NO_CLIENT,
    )
    expect(answer).toContain('**Nothing was written.** The review_entry step refused')
    expect(readFileSync(path).equals(before)).toBe(true)
    expect(await unit(path, 'M47 U3')).toMatchObject({ state: 'in_progress' })
  })

  it('refuses a unit that is not there or already landed, and a key it has not got', async () => {
    const path = await memoryOnDisk('text')
    await landUnitsTool.run({ path, units: [landing()], commit: true }, NO_CLIENT)
    const answer = await landUnitsTool.run({ path, units: [{ unit: 'M47 U3' }, { unit: 'M47 U9' }] }, NO_CLIENT)
    expect(answer).toContain('It is already built.')
    expect(answer).toContain('No `unit` row has this ref.')
    await expect(landUnitsTool.run({ path, units: [{ unit: 'M47 U4', state: 'built' }] }, NO_CLIENT)).rejects.toThrow(
      'which a landing has not got',
    )
    await expect(landUnitsTool.run({ path, units: [{ unit: 'M47 U4' }, { unit: 'm47 u4' }] }, NO_CLIENT)).rejects.toThrow(
      'named twice',
    )
  })

  it('says where the formats come from in a document without the pack', async () => {
    const path = await memoryOnDisk('sqlite', false)
    const answer = await landUnitsTool.run({ path, units: [{ unit: 'M1 U1' }] }, NO_CLIENT)
    expect(answer).toContain('keep_packs')
  })
})

describe('claim_units (M47 U3)', () => {
  it('takes a list of planned units, and refuses all of it when one is taken', async () => {
    const path = await memoryOnDisk('text')
    const took = await claimUnitsTool.run(
      { path, units: ['M47 U4', 'M47 U5'], taken_by: 'session A', started: '2026-10-13', commit: true },
      NO_CLIENT,
    )
    expect(took).toContain('2 rows of Unit changed')
    expect(await unit(path, 'M47 U4')).toMatchObject({ state: 'in_progress', taken_by: 'session A', started: '2026-10-13' })

    const again = await claimUnitsTool.run({ path, units: ['M47 U3', 'M47 U4'], taken_by: 'session B', commit: true }, NO_CLIENT)
    expect(again).toContain('not as this edit expected')
    expect(await unit(path, 'M47 U4')).toMatchObject({ taken_by: 'session A' })
  })
})

describe('a claim records the branch, a landing the commit (M51 U2)', () => {
  it('round-trips a claim on a branch and a landing with its commit', async () => {
    const path = await memoryOnDisk('text')
    await claimUnitsTool.run(
      { path, units: ['M47 U4'], taken_by: 'session 7f3a', branch: 'claude/m47-u4', commit: true },
      NO_CLIENT,
    )
    expect(await unit(path, 'M47 U4')).toMatchObject({ state: 'in_progress', taken_by: 'session 7f3a', branch: 'claude/m47-u4' })

    const done = await landUnitsTool.run(
      { path, units: [{ unit: 'M47 U4', branch: 'claude/m47-u4', commit: '41def1fe' }], commit: true },
      NO_CLIENT,
    )
    expect(done).toContain('1 row of Unit changed')
    expect(await unit(path, 'M47 U4')).toMatchObject({ state: 'built', branch: 'claude/m47-u4', commit: '41def1fe' })
  })

  it('refuses, in the dry run, a landing from another branch than the claim’s unless told', async () => {
    const path = await memoryOnDisk('text')
    await claimUnitsTool.run({ path, units: ['M47 U4'], taken_by: 'session A', branch: 'feature', commit: true }, NO_CLIENT)
    const before = readFileSync(path)

    const dry = await landUnitsTool.run({ path, units: [{ unit: 'M47 U4', branch: 'main', commit: 'abc1234' }] }, NO_CLIENT)
    expect(dry).toContain('**Nothing was written.**')
    expect(dry).toContain('It was claimed on `feature` and this landing is on `main`.')
    expect(readFileSync(path).equals(before)).toBe(true)

    // A landing that does not say its branch is not checked; one that says so lands here.
    const told = await landUnitsTool.run(
      { path, units: [{ unit: 'M47 U4', branch: 'main', other_branch: true, commit: 'abc1234' }], commit: true },
      NO_CLIENT,
    )
    expect(told).toContain('1 row of Unit changed')
    expect(await unit(path, 'M47 U4')).toMatchObject({ state: 'built', branch: 'main', commit: 'abc1234' })
  })

  it('takes a commit only as git prints one', async () => {
    const path = await memoryOnDisk('text')
    await expect(landUnitsTool.run({ path, units: [{ unit: 'M47 U3', commit: 'HEAD' }] }, NO_CLIENT)).rejects.toThrow(
      '7 to 40 hex digits',
    )
    await expect(landUnitsTool.run({ path, units: [{ unit: 'M47 U3', other_branch: 'yes' }] }, NO_CLIENT)).rejects.toThrow(
      'must be true or false',
    )
  })
})

describe('a child proposes its landing as an inbox row, and the manager lands them in one dry run (M51 U3)', () => {
  const SENDER = 'F:/projects/financial-companion/docs/memory.emd'

  /** An inbox row as a child writes it: prose for a person, then the landing in one fenced block. */
  function proposal(unitRef: string, landing: Record<string, unknown> | string, extra: Record<string, unknown> = {}) {
    const block = typeof landing === 'string' ? landing : JSON.stringify(landing, null, 2)
    return {
      subject: `Landing ${unitRef}`,
      from: SENDER,
      sent_on: '2026-10-17',
      refs: unitRef,
      state: 'new',
      body: `Built ${unitRef}; the tests near it pass.\n\n\`\`\`json\n${block}\n\`\`\`\n`,
      ...extra,
    }
  }

  async function propose(path: string, rows: readonly Record<string, unknown>[]): Promise<readonly string[]> {
    const wrote = await recordFormatRowsTool.run({ path, format: 'inbox', rows, commit: true }, NO_CLIENT)
    expect(wrote).toContain(`${String(rows.length)} row`)
    const inbox = await rowsOf(path, 'inbox')
    return rows.map((row) => {
      const found = inbox.find((each) => each.cells['subject'] === row['subject'])
      if (found === undefined) throw new Error(`no ${String(row['subject'])}`)
      return found.id
    })
  }

  async function claimed(path: string): Promise<void> {
    for (const [ref, branch] of [['M47 U4', 'child-4'], ['M47 U5', 'child-5']] as const) {
      await claimUnitsTool.run({ path, units: [ref], taken_by: 'driver', branch, commit: true }, NO_CLIENT)
    }
  }

  it('lands three proposals with one dry run and one commit, and the inbox rows end applied', async () => {
    const path = await memoryOnDisk('text')
    await claimed(path)
    const ids = await propose(path, [
      proposal('M47 U3', landing({ commit: 'aaaa111' })),
      proposal('M47 U4', { unit: 'M47 U4', files: 'a.ts', branch: 'child-4', commit: 'bbbb222', decisions: [{ ref: 'D-462', title: 't', question: 'q', answer: 'a' }] }),
      proposal('M47 U5', { unit: 'M47 U5', branch: 'child-5', commit: 'cccc333', review_entries: [{ do: 'Open it', should: 'Work' }] }),
    ])
    const before = readFileSync(path)

    const dry = await landUnitsTool.run({ path, inbox: ids }, NO_CLIENT)
    expect(dry).toContain('Nothing has been written')
    expect(dry).toContain('## inbox')
    expect(readFileSync(path).equals(before)).toBe(true)

    const done = await landUnitsTool.run({ path, inbox: ids, commit: true }, NO_CLIENT)
    expect(done).toContain('3 rows of Unit changed')
    expect(done).toContain('3 rows of Inbox changed')

    const decisions = await rowsOf(path, 'decision')
    const d462 = decisions.find((each) => each.cells['ref'] === 'D-462')
    expect(await unit(path, 'M47 U3')).toMatchObject({ state: 'built', commit: 'aaaa111' })
    expect(await unit(path, 'M47 U4')).toMatchObject({ state: 'built', branch: 'child-4', commit: 'bbbb222', files: 'a.ts', decision: d462?.id })
    expect(await unit(path, 'M47 U5')).toMatchObject({ state: 'built', branch: 'child-5', commit: 'cccc333' })
    expect((await rowsOf(path, 'review_entry')).map((each) => each.cells['do']).sort()).toEqual(['Call land_units', 'Open it'])

    const units = await rowsOf(path, 'unit')
    const inbox = await rowsOf(path, 'inbox')
    expect(inbox.map((each) => each.cells['state'])).toEqual(['applied', 'applied', 'applied'])
    const u4 = inbox.find((each) => each.cells['refs'] === 'M47 U4')
    expect(u4?.cells).toMatchObject({
      became_unit: units.find((each) => each.cells['ref'] === 'M47 U4')?.id,
      answered_by: d462?.id,
    })

    // A proposal lands once.
    const again = await landUnitsTool.run({ path, inbox: [inbox[0]?.id ?? ''] }, NO_CLIENT)
    expect(again).toContain('**Nothing was written.**')
    expect(again).toContain('It is already applied')
  })

  it('refuses the whole batch when one proposal is malformed, and names it', async () => {
    const path = await memoryOnDisk('text')
    const ids = await propose(path, [
      proposal('M47 U3', landing()),
      proposal('M47 U4', '{ "unit": "M47 U4", files: oops }'),
      { ...proposal('M47 U5', {}), subject: 'Prose only', body: 'Done, all green.' },
      proposal('M47 U5', { unit: 'M47 U5', close_milestone: 'M47' }, { subject: 'Closes the milestone' }),
      proposal('M47 U4', { unit: 'M47 U5' }, { subject: 'Says another unit' }),
    ])
    const before = readFileSync(path)
    const answer = await landUnitsTool.run({ path, inbox: ids, commit: true }, NO_CLIENT)
    expect(answer).toContain('**Nothing was written.**')
    expect(answer).toContain(`inbox ${ids[1] ?? ''} (Landing M47 U4)`)
    expect(answer).toContain('Its landing is not JSON')
    expect(answer).toContain('(Prose only)')
    expect(answer).toContain('not a proposal')
    expect(answer).toContain('`close_milestone`, which a landing has not got')
    expect(answer).toContain('Its `refs` say `M47 U4`, and its landing is M47 U5.')
    expect(answer).not.toContain(`inbox ${ids[0] ?? ''}`)
    expect(readFileSync(path).equals(before)).toBe(true)
    expect((await rowsOf(path, 'inbox')).every((each) => each.cells['state'] === 'new')).toBe(true)
  })

  it('checks a proposal’s branch against the claim, and the manager may land it off the branch', async () => {
    const path = await memoryOnDisk('text')
    await claimed(path)
    const [id] = await propose(path, [proposal('M47 U4', { unit: 'M47 U4', branch: 'elsewhere', commit: 'dddd444' })])
    const refused = await landUnitsTool.run({ path, inbox: [id] }, NO_CLIENT)
    expect(refused).toContain('It was claimed on `child-4` and this landing is on `elsewhere`.')

    const told = await landUnitsTool.run({ path, inbox: [{ id, other_branch: true }], commit: true }, NO_CLIENT)
    expect(told).toContain('1 row of Inbox changed')
    expect(await unit(path, 'M47 U4')).toMatchObject({ state: 'built', branch: 'elsewhere', commit: 'dddd444' })
  })

  it('refuses a unit both written out and proposed, an id it has not got, and a call naming nothing', async () => {
    const path = await memoryOnDisk('text')
    const [id] = await propose(path, [proposal('M47 U3', landing())])
    const twice = await landUnitsTool.run({ path, units: [{ unit: 'M47 U3' }], inbox: [id] }, NO_CLIENT)
    expect(twice).toContain('It is named twice')
    const missing = await landUnitsTool.run({ path, inbox: ['not-an-id'] }, NO_CLIENT)
    expect(missing).toContain('No `inbox` row has this id')
    await expect(landUnitsTool.run({ path }, NO_CLIENT)).rejects.toThrow('Name what to land')
    await expect(landUnitsTool.run({ path, inbox: [{ id, files: 'x' }] }, NO_CLIENT)).rejects.toThrow('lands as its child wrote it')
  })
})

describe('a stalled claim is taken over, and a landing names its commit and keeps its report (M51 F4)', () => {
  it('takes over only a unit in progress under the taker named, keeping the one it replaced', async () => {
    const path = await memoryOnDisk('text')
    await claimUnitsTool.run({ path, units: ['M47 U4'], taken_by: 'session A', started: '2026-10-16', commit: true }, NO_CLIENT)
    const before = readFileSync(path)

    const wrong = await claimUnitsTool.run({ path, units: ['M47 U4'], taken_by: 'driver', take_over: 'session B', commit: true }, NO_CLIENT)
    expect(wrong).toContain('It is held by `session A`, not `session B`')
    const planned = await claimUnitsTool.run({ path, units: ['M47 U5'], taken_by: 'driver', take_over: 'session A', commit: true }, NO_CLIENT)
    expect(planned).toContain('claim it without `take_over`')
    // A plain claim of a unit in progress is still refused: taking it over is said, never done by accident.
    const plain = await claimUnitsTool.run({ path, units: ['M47 U4'], taken_by: 'driver', commit: true }, NO_CLIENT)
    expect(plain).toContain('not as this edit expected')
    expect(readFileSync(path).equals(before)).toBe(true)

    const took = await claimUnitsTool.run(
      { path, units: ['M47 U4'], taken_by: 'driver', take_over: 'session a', branch: 'main', started: '2026-10-18', commit: true },
      NO_CLIENT,
    )
    expect(took).toContain('1 row of Unit changed')
    expect(await unit(path, 'M47 U4')).toMatchObject({
      state: 'in_progress',
      taken_by: 'driver',
      started: '2026-10-18',
      branch: 'main',
      taken_over_from: 'session A (2026-10-16)',
    })

    await claimUnitsTool.run({ path, units: ['M47 U4'], taken_by: 'driver 2', take_over: 'driver', started: '2026-10-19', commit: true }, NO_CLIENT)
    expect((await unit(path, 'M47 U4'))['taken_over_from']).toBe('session A (2026-10-16); driver (2026-10-18)')
  })

  it('refuses a landing that names no commit unless it says the work is in the same commit', async () => {
    const path = await memoryOnDisk('text')
    const before = readFileSync(path)
    const bare = await landUnitsTool.run({ path, units: [{ unit: 'M47 U3' }], commit: true }, NO_CLIENT)
    expect(bare).toContain('It names no `commit`')
    expect(bare).toContain('same_commit: true')
    expect(readFileSync(path).equals(before)).toBe(true)
    await expect(
      landUnitsTool.run({ path, units: [{ unit: 'M47 U3', commit: 'abc1234', same_commit: true }] }, NO_CLIENT),
    ).rejects.toThrow('one or the other')

    await landUnitsTool.run({ path, units: [{ unit: 'M47 U3', same_commit: true }], commit: true }, NO_CLIENT)
    const landed = await unit(path, 'M47 U3')
    expect(landed).toMatchObject({ state: 'built' })
    expect(landed['commit'] ?? null).toBeNull()
  })

  it('keeps the builder’s report on the unit, written out or proposed, and refuses a transcript', async () => {
    const path = await memoryOnDisk('text')
    const report = 'Landed 1a2b3c4; docs:check green.\nLeft: the skill’s order.'
    await landUnitsTool.run({ path, units: [landing({ report })], commit: true }, NO_CLIENT)
    expect(await unit(path, 'M47 U3')).toMatchObject({ state: 'built', report })

    await claimUnitsTool.run({ path, units: ['M47 U4'], taken_by: 'driver', commit: true }, NO_CLIENT)
    const body = `Built M47 U4.\n\n\`\`\`json\n${JSON.stringify({ unit: 'M47 U4', commit: 'bbbb222', report: 'All of it, here.' })}\n\`\`\`\n`
    await recordFormatRowsTool.run(
      { path, format: 'inbox', rows: [{ subject: 'Landing M47 U4', from: 'child', sent_on: '2026-10-18', refs: 'M47 U4', state: 'new', body }], commit: true },
      NO_CLIENT,
    )
    const [proposed] = await rowsOf(path, 'inbox')
    await landUnitsTool.run({ path, inbox: [proposed?.id], commit: true }, NO_CLIENT)
    expect(await unit(path, 'M47 U4')).toMatchObject({ state: 'built', commit: 'bbbb222', report: 'All of it, here.' })

    await expect(
      landUnitsTool.run({ path, units: [{ unit: 'M47 U5', same_commit: true, report: 'x'.repeat(REPORT_MAX + 1) }] }, NO_CLIENT),
    ).rejects.toThrow('not the transcript')
  })
})
