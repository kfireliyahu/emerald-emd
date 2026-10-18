import { readFileSync } from 'node:fs'
import { utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDatabase } from '@/data/db/database.ts'
import { installDevelopmentPack } from '@/data/packs/development/pack.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import { listRows } from '@/data/repositories/formatRowRepository.ts'
import { exportEncoded, openEncoded, type DocumentEncoding } from '@/data/storage/encoding.ts'

import { lockPathFor, LOCK_STALE_MS } from '../write.ts'
import { recordFormatRowsTool, updateFormatRowsTool } from './formats.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

/**
 * **Claiming a unit** — M27 U6. A session addresses its unit by `ref`, never by
 * an id from an earlier call, and the write says what it expects, so of two
 * sessions claiming one unit exactly one gets it.
 */

const NOW = Date.UTC(2026, 9, 1)

async function memoryOnDisk(encoding: DocumentEncoding): Promise<string> {
  const db = await createDatabase()
  const installed = installDevelopmentPack(db, NOW)
  if (!installed.ok) throw new Error(installed.error)
  const bytes = await exportEncoded(db, encoding)
  db.close()
  if (!bytes.ok) throw new Error(bytes.error)
  const path = join(await tempDir('emerald-claim-'), 'memory.emd')
  await writeFile(path, bytes.value)

  const milestone = await recordFormatRowsTool.run(
    {
      path,
      format: 'milestone',
      rows: [{ ref: 'M27', title: 'The development pack', goal: 'Its views', state: 'open', position: 27 }],
      commit: true,
    },
    NO_CLIENT,
  )
  expect(milestone).toContain('1 row')
  await recordFormatRowsTool.run(
    {
      path,
      format: 'unit',
      rows: [
        { ref: 'M27 U6', milestone: 'M27', scope: 'engine', title: 'live roadmap', state: 'planned' },
        { ref: 'M27 U7', milestone: 'M27', scope: 'engine', title: 'next', state: 'planned' },
      ],
      commit: true,
    },
    NO_CLIENT,
  )
  return path
}

async function unitRow(path: string, ref: string): Promise<Readonly<Record<string, unknown>>> {
  const { db } = await openEncoded(readFileSync(path))
  const unit = listFormats(db).find((each) => each.name === 'unit')
  if (unit === undefined) throw new Error('no unit format')
  const row = listRows(db, unit).find((each) => each.cells['ref'] === ref)
  db.close()
  if (row === undefined) throw new Error(`no ${ref}`)
  return row.cells
}

function claim(path: string, by: string): Promise<string> {
  return updateFormatRowsTool.run(
    {
      path,
      format: 'unit',
      edits: [
        {
          where: { ref: 'M27 U6' },
          expect: { state: 'planned' },
          values: { state: 'in_progress', taken_by: by, started: '2026-10-01' },
        },
      ],
      commit: true,
    },
    NO_CLIENT,
  )
}

describe('a unit is claimed by ref, on condition (M27 U6)', () => {
  for (const encoding of ['text', 'sqlite'] as const) {
    it(`moves planned to in_progress and on to built, by ref, in a ${encoding} document`, async () => {
      const path = await memoryOnDisk(encoding)
      expect(await claim(path, 'session A')).toContain('1 row of Unit changed')
      expect(await unitRow(path, 'M27 U6')).toMatchObject({
        state: 'in_progress',
        taken_by: 'session A',
        started: '2026-10-01',
      })

      const landed = await updateFormatRowsTool.run(
        {
          path,
          format: 'unit',
          edits: [
            {
              where: { ref: 'M27 U6' },
              expect: { state: 'in_progress', taken_by: 'session A' },
              values: { state: 'built', landed: '2026-10-01' },
            },
          ],
          commit: true,
        },
        NO_CLIENT,
      )
      expect(landed).toContain('1 row of Unit changed')
      expect(await unitRow(path, 'M27 U6')).toMatchObject({ state: 'built', taken_by: 'session A' })
    })
  }

  it('refuses a second claim, naming what the row holds now', async () => {
    const path = await memoryOnDisk('text')
    await claim(path, 'session A')
    const second = await claim(path, 'session B')
    expect(second).toContain('unit M27 U6 is not as this edit expected: state is in_progress, not planned')
    expect(await unitRow(path, 'M27 U6')).toMatchObject({ taken_by: 'session A' })
  })

  it('gives a unit to exactly one of two sessions claiming it at once', async () => {
    const path = await memoryOnDisk('text')
    const answers = await Promise.all([claim(path, 'session A'), claim(path, 'session B')])
    const won = answers.filter((each) => each.includes('1 row of Unit changed'))
    expect(won).toHaveLength(1)
    expect(answers.filter((each) => each.includes('not as this edit expected'))).toHaveLength(1)
    const winner = won[0] === answers[0] ? 'session A' : 'session B'
    expect(await unitRow(path, 'M27 U6')).toMatchObject({ state: 'in_progress', taken_by: winner })
  })

  it('refuses a where that names no row, or more than one', async () => {
    const path = await memoryOnDisk('text')
    const none = await updateFormatRowsTool.run(
      { path, format: 'unit', edits: [{ where: { ref: 'M27 U9' }, values: { title: 'x' } }] },
      NO_CLIENT,
    )
    expect(none).toContain('unit has no row where ref M27 U9.')
    const many = await updateFormatRowsTool.run(
      { path, format: 'unit', edits: [{ where: { state: 'planned' }, values: { title: 'x' } }] },
      NO_CLIENT,
    )
    expect(many).toContain('More than one unit row has state planned')
    const both = await updateFormatRowsTool.run(
      { path, format: 'unit', edits: [{ id: 'x', where: { ref: 'M27 U6' }, values: { title: 'x' } }] },
      NO_CLIENT,
    )
    expect(both).toContain('Name the row by `id` or by `where`, not both.')
  })

  it('refuses the whole batch when one expectation fails', async () => {
    const path = await memoryOnDisk('text')
    await claim(path, 'session A')
    const answer = await updateFormatRowsTool.run(
      {
        path,
        format: 'unit',
        edits: [
          { where: { ref: 'M27 U7' }, expect: { state: 'planned' }, values: { state: 'in_progress' } },
          { where: { ref: 'M27 U6' }, expect: { state: 'planned' }, values: { state: 'in_progress' } },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(answer).toContain('not as this edit expected')
    expect(await unitRow(path, 'M27 U7')).toMatchObject({ state: 'planned' })
  })

  it('takes over a lock its writer died holding', async () => {
    const path = await memoryOnDisk('text')
    const lock = lockPathFor(path)
    await writeFile(lock, '1 then')
    const old = (Date.now() - LOCK_STALE_MS - 1_000) / 1000
    await utimes(lock, old, old)
    expect(await claim(path, 'session A')).toContain('1 row of Unit changed')
  })
})
