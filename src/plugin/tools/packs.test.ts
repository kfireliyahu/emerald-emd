import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { exportDatabase, openDatabase } from '@/data/db/database.ts'
import { ledgerFormatNames } from '@/data/packs/ledger/pack.ts'
import { packsKeptBy } from '@/data/packs/packs.ts'
import { adoptFormat, listFormats, readFormat } from '@/data/repositories/formatRepository.ts'
import { boardSettings, setBoardLanes, writeViewSettings } from '@/data/repositories/formatViewRepository.ts'

import { formatsTool } from './formats.ts'
import { keepPacksTool } from './packs.ts'
import { createDocumentTool } from './setup.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

/**
 * **A document without the ledger, with a pack** — M38 U7 (D-405). The
 * report: every document the MCP made was a ledger document and no
 * tool could keep a pack, so the development pack's formats were unreachable.
 */

const DEVELOPMENT = ['decision', 'inbox', 'milestone', 'open_question', 'review_entry', 'unit']

async function scratch(name: string): Promise<string> {
  return join(await tempDir('emerald-packs-'), name)
}

async function declared(path: string): Promise<{ names: readonly string[]; kept: readonly string[] }> {
  const db = await openDatabase(await readFile(path))
  const names = listFormats(db).map((each) => each.name).sort()
  const kept = [...packsKeptBy(db)].sort()
  db.close()
  return { names, kept }
}

describe('create_document with packs', () => {
  it('makes a document with the development pack and no ledger', async () => {
    const path = await scratch('project.emd')
    const text = await createDocumentTool.run({ path, packs: ['development'] }, NO_CLIENT)
    expect(text).toContain('keeping development')

    const listed = await formatsTool.run({ path }, NO_CLIENT)
    for (const name of DEVELOPMENT) expect(listed).toContain(name)
    const { names, kept } = await declared(path)
    expect(names).toEqual(DEVELOPMENT)
    expect(names.some((name) => ledgerFormatNames().has(name))).toBe(false)
    expect(kept).toEqual(['development'])
  })

  it('makes a document that keeps nothing when told `[]`', async () => {
    const path = await scratch('bare.emd')
    const text = await createDocumentTool.run({ path, packs: [] }, NO_CLIENT)
    expect(text).toContain('keeping no pack')
    expect(await declared(path)).toEqual({ names: [], kept: [] })
  })

  it('keeps the ledger when packs is omitted on the full server, and nothing engine-only', async () => {
    const full = await scratch('full.emd')
    await createDocumentTool.run({ path: full }, NO_CLIENT)
    expect((await declared(full)).kept).toEqual(['ledger'])

    const engine = await scratch('engine.emd')
    await createDocumentTool.run({ path: engine }, { engineOnly: true })
    expect(await declared(engine)).toEqual({ names: [], kept: [] })
  })

  it('refuses a pack this build has not got, naming the ones it has, and creates nothing', async () => {
    const path = await scratch('nope.emd')
    await expect(createDocumentTool.run({ path, packs: ['recipes'] }, NO_CLIENT)).rejects.toThrow(
      /No pack called "recipes".*"ledger", "development"/,
    )
    await expect(readFile(path)).rejects.toThrow()
  })
})

describe('keep_packs', () => {
  it('keeps the development pack in an empty document: dry run, commit, then a no-op that says so', async () => {
    const path = await scratch('empty.emd')
    await createDocumentTool.run({ path, packs: [] }, NO_CLIENT)

    const dry = await keepPacksTool.run({ path, packs: ['development'] }, NO_CLIENT)
    expect(dry).toContain('Nothing has been written')
    expect(dry).toContain('declares decision, milestone, unit, inbox, open_question, review_entry')
    expect((await declared(path)).names).toEqual([])

    const done = await keepPacksTool.run({ path, packs: ['development'], commit: true }, NO_CLIENT)
    expect(done).toContain('kept: declared')
    expect(await declared(path)).toEqual({ names: DEVELOPMENT, kept: ['development'] })

    const again = await keepPacksTool.run({ path, packs: ['development'] }, NO_CLIENT)
    expect(again).toContain('keeps it already. Nothing to do.')
    expect(again).not.toContain('commit: true')
    const twice = await keepPacksTool.run({ path, packs: ['development'], commit: true }, NO_CLIENT)
    expect(twice).toContain('Nothing was written')
    expect(await declared(path)).toEqual({ names: DEVELOPMENT, kept: ['development'] })
  })

  it('keeps the ledger beside the development pack, the two side by side', async () => {
    const path = await scratch('both.emd')
    await createDocumentTool.run({ path, packs: ['development'] }, NO_CLIENT)
    const both = await keepPacksTool.run({ path, packs: ['ledger'], commit: true }, NO_CLIENT)
    expect(both).toContain('Done.')
    expect((await declared(path)).kept).toEqual(['development', 'ledger'])
  })

  it('brings a kept pack’s view settings along, and names what the person chose and keeps it (D-491)', async () => {
    const path = await scratch('older.emd')
    await createDocumentTool.run({ path, packs: ['development'] }, NO_CLIENT)
    // As a build before M51 U2 left it, and as the person arranged it since.
    const db = await openDatabase(await readFile(path))
    writeViewSettings(db, [{ format: 'unit', view: 'board', column: 'taken_by', setting: undefined }])
    setBoardLanes(db, 'unit', undefined)
    const decision = readFormat(db, 'decision')
    if (decision === undefined) throw new Error('no decision')
    adoptFormat(db, { ...decision, notes: 'My own notes.' }, Date.now())
    await writeFile(path, exportDatabase(db))
    db.close()

    const dry = await keepPacksTool.run({ path, packs: ['development'] }, NO_CLIENT)
    expect(dry).toContain('Nothing has been written')
    expect(dry).toContain('bringing it up to date: sets unit board taken_by to card.')
    expect(dry).toContain(
      'Kept as this document has it: the notes of decision, which this document rewrote; unit board state is none (the pack’s is lanes).',
    )

    const done = await keepPacksTool.run({ path, packs: ['development'], commit: true }, NO_CLIENT)
    expect(done).toContain('brought up to date: set unit board taken_by to card.')
    const after = await openDatabase(await readFile(path))
    expect(boardSettings(after, 'unit').get('taken_by')).toBe('card')
    expect(boardSettings(after, 'unit').get('state')).toBeUndefined()
    expect(readFormat(after, 'decision')?.notes).toBe('My own notes.')
    after.close()

    const again = await keepPacksTool.run({ path, packs: ['development'] }, NO_CLIENT)
    expect(again).toContain('keeps it already. Nothing to do. Kept as this document has it:')
  })
})
