import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDatabase } from '@/data/db/database.ts'
import { installDevelopmentPack } from '@/data/packs/development/pack.ts'
import { exportEncoded, type DocumentEncoding } from '@/data/storage/encoding.ts'

import { formatRowsTool, recordFormatRowsTool } from './tools/formats.ts'
import { startHereTool } from './tools/startHere.ts'
import { NO_CLIENT } from './tools/tool.ts'
import { tempDir } from '../testing/tempDir'

/**
 * **A link to a row in another document** — M47 U4, D-461. Two projects side
 * by side, as the done-test has them: one document's inbox row is about a unit
 * in the other's, and reads what that unit holds now.
 */

const NOW = Date.UTC(2026, 9, 13)

async function documentAt(path: string, encoding: DocumentEncoding): Promise<string> {
  const db = await createDatabase()
  const installed = installDevelopmentPack(db, NOW)
  if (!installed.ok) throw new Error(installed.error)
  const bytes = await exportEncoded(db, encoding)
  db.close()
  if (!bytes.ok) throw new Error(bytes.error)
  await writeFile(path, bytes.value)
  return path
}

async function record(path: string, format: string, rows: readonly Record<string, unknown>[]): Promise<string> {
  return recordFormatRowsTool.run({ path, format, rows, commit: true }, NO_CLIENT)
}

/** `projects/site/site.emd` holding S1 U5, built, and `projects/planner/planner.emd` beside it. */
async function twoProjects(encoding: DocumentEncoding): Promise<{ planner: string; site: string; root: string }> {
  const root = (await tempDir('emerald-elsewhere-')).replace(/\\/g, '/')
  await mkdir(join(root, 'site'))
  await mkdir(join(root, 'planner'))
  const site = await documentAt(`${root}/site/site.emd`, encoding)
  const planner = await documentAt(`${root}/planner/planner.emd`, encoding)
  await record(site, 'milestone', [{ ref: 'S1', title: 'The site', goal: 'Up', state: 'open', position: 1 }])
  await record(site, 'unit', [
    { ref: 'S1 U5', milestone: 'S1', scope: 'site', title: 'The privacy policy', state: 'built' },
    { ref: 'S1 U6', milestone: 'S1', scope: 'site', title: 'Next', state: 'planned' },
  ])
  return { planner, site, root }
}

describe('a link to a row in another document (M47 U4, D-461)', () => {
  for (const encoding of ['text', 'sqlite'] as const) {
    it(`reads the row there, in format_rows and start_here — a ${encoding} document`, async () => {
      const { planner, site, root } = await twoProjects(encoding)
      const written = await record(planner, 'inbox', [
        {
          subject: 'The privacy policy is up',
          from: site,
          sent_on: '2026-10-13',
          state: 'new',
          about: `${site} S1 U5`,
        },
        // Relative to planner.emd's folder, as a project beside it would write it.
        { subject: 'And the next one', from: site, sent_on: '2026-10-13', state: 'new', about: '../site/site.emd S1 U6' },
        // A document that is not there is written all the same.
        { subject: 'Gone', from: site, sent_on: '2026-10-13', state: 'new', about: `${root}/gone/gone.emd S1 U5` },
        { subject: 'Misnamed', from: site, sent_on: '2026-10-13', state: 'new', about: `${site} S1 U9` },
      ])
      expect(written).not.toMatch(/refused/i)

      const rows = await formatRowsTool.run({ path: planner, format: 'inbox', order: 'subject' }, NO_CLIENT)
      expect(rows).toContain(`- about: ${site} S1 U5 → unit S1 U5 · built`)
      expect(rows).toContain('- about: ../site/site.emd S1 U6 → unit S1 U6 · planned')
      expect(rows).toContain(`- about: ${root}/gone/gone.emd S1 U5 → unresolved — no file at ${root}/gone/gone.emd`)
      expect(rows).toContain(`→ unresolved — site.emd has no row called S1 U9`)

      // **What the row it is about holds now**, at the top of a session.
      const start = await startHereTool.run({ path: planner }, NO_CLIENT)
      expect(start).toContain('### inbox')
      expect(start).toContain('The privacy policy is up')
      expect(start).toContain('The privacy policy is up')
      expect(start).toContain('site.emd: unit S1 U5 · built')
      expect(start).toContain('gone.emd S1 U5: unresolved — no file at')
      // What a row looks like says how to write one.
      expect(start).toContain('about: → "<path>.emd <row name>"')
    })
  }

  it('reads a file that is not a document as unresolved, with the first sentence of why', async () => {
    const { planner, root } = await twoProjects('text')
    await writeFile(`${root}/notes.emd`, 'not a document')
    await record(planner, 'inbox', [
      { subject: 'Odd', from: 'me', sent_on: '2026-10-13', state: 'new', about: '../notes.emd S1 U5' },
    ])
    const rows = await formatRowsTool.run({ path: planner, format: 'inbox', columns: ['about'] }, NO_CLIENT)
    expect(rows).toMatch(/→ unresolved — notes\.emd could not be read: [^|]+\./)
  })

  it('refuses a value that names no row, by its column, and nothing else', async () => {
    const { planner } = await twoProjects('text')
    const refused = await record(planner, 'inbox', [
      { subject: 'Prose', from: 'me', sent_on: '2026-10-13', state: 'new', about: 'site.emd' },
    ])
    expect(refused).toContain('about:')
    expect(refused).toContain('no row in it')
  })
})
