/**
 * **A copy from before the import** — M34 U6, D-399.
 *
 * The done-test: a read of 300 rows leaves a named copy that survives the next
 * six writes, and the answer names its path. The rolling five could not do it
 * — six writes later the copy from before the read is the one they pruned.
 *
 * **In the document's folder of earlier copies, never beside it** (M48 U4,
 * D-470): every test here also says the document's own folder holds nothing
 * Emerald put there.
 */

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDatabase, exportDatabase, openDatabase } from '@/data/db/database.ts'
import { adoptFormat } from '@/data/repositories/formatRepository.ts'
import { countRows } from '@/data/repositories/formatRowRepository.ts'
import { column, type FormatDeclaration } from '@/domain/format/declaration.ts'

import { recordFormatRowsTool } from './formats.ts'
import { readOntoFormatTool } from './intake.ts'
import { keepCopyTool } from './keepCopy.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'
import { backupFolderFor } from '../backup.ts'

const NOW = Date.UTC(2026, 9, 6)

const TASK: FormatDeclaration = {
  language: 5,
  name: 'task',
  title: 'Task',
  notes: '',
  columns: [column('name', 'text', { required: true }), column('hours', 'real')],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

async function tasks(): Promise<{ path: string; directory: string }> {
  const db = await createDatabase()
  expect(adoptFormat(db, TASK, NOW).refusals).toEqual([])
  const directory = await tempDir('emerald-copy-')
  const path = join(directory, 'work.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  return { path, directory }
}

async function csv(directory: string, lines: number): Promise<string> {
  const file = join(directory, 'tasks.csv')
  const body = Array.from({ length: lines }, (_, k) => `Task ${String(k + 1)},${String((k % 8) + 1)}`)
  await writeFile(file, ['name,hours', ...body].join('\n'))
  return file
}

const named = (names: readonly string[]): readonly string[] =>
  names.filter((name) => /^work\.before-\d{8}T\d{6}/.test(name) && name.endsWith('.emd'))

/** The document's named copies, from its folder of earlier copies (D-470). */
const namedCopies = async (path: string): Promise<readonly string[]> =>
  named(await readdir(backupFolderFor(path)).catch(() => []))

/** What is beside the document: only what the test put there. */
const beside = async (directory: string): Promise<readonly string[]> => (await readdir(directory)).sort()

describe('a named copy before a large write (M34 U6)', () => {
  it('keeps the copy from before a read of 300 rows through the next six writes, and names it', async () => {
    const { path, directory } = await tasks()
    const file = await csv(directory, 300)

    const answer = await readOntoFormatTool.run({ path, format: 'task', file, commit: true }, NO_CLIENT)
    expect(answer).toContain('300 rows written')
    const kept = await namedCopies(path)
    expect(kept).toHaveLength(1)
    expect(await beside(directory)).toEqual(['tasks.csv', 'work.emd'])
    const copy = join(backupFolderFor(path), kept[0] ?? '')
    expect(answer).toContain(`**A copy from before reading tasks.csv is at \`${copy}\`.**`)
    expect(kept[0]).toMatch(/-reading-tasks-csv\.emd$/)

    // It is the document before the read: the format, and none of its rows.
    const before = await openDatabase(readFileSync(copy))
    expect(countRows(before, TASK)).toBe(0)
    before.close()

    for (let k = 0; k < 6; k += 1) {
      const small = await recordFormatRowsTool.run(
        { path, format: 'task', rows: [{ name: `Later ${String(k)}` }], commit: true },
        NO_CLIENT,
      )
      expect(small).not.toContain('A copy from before')
    }

    expect(existsSync(copy)).toBe(true)
    expect(await namedCopies(path)).toEqual(kept)
    expect(await beside(directory)).toEqual(['tasks.csv', 'work.emd'])
  })

  it('a batch of 100 rows and the first write into an empty document each leave one there, and nothing beside it', async () => {
    const { path, directory } = await tasks()
    const first = await recordFormatRowsTool.run({ path, format: 'task', rows: [{ name: 'First' }], commit: true }, NO_CLIENT)
    expect(first).toContain('A copy from before')
    expect(await namedCopies(path)).toHaveLength(1)
    expect(first).toContain(backupFolderFor(path))

    // A second apart, so the batch's copy is its own moment.
    await new Promise((resolve) => setTimeout(resolve, 1050))
    const rows = Array.from({ length: 100 }, (_, k) => ({ name: `Batch ${String(k)}` }))
    const batch = await recordFormatRowsTool.run({ path, format: 'task', rows, commit: true }, NO_CLIENT)
    expect(batch).toContain('A copy from before')
    expect(await namedCopies(path)).toHaveLength(2)
    expect(await beside(directory)).toEqual(['work.emd'])
  }, 10_000)

  it('takes none for a read under the threshold, and none on a dry run', async () => {
    const { path, directory } = await tasks()
    // A document with rows already: into an empty one, the first rows take a
    // copy whatever their number (M38 U5).
    await recordFormatRowsTool.run({ path, format: 'task', rows: [{ name: 'First' }], commit: true }, NO_CLIENT)
    const already = await namedCopies(path)
    expect(already).toHaveLength(1)
    const file = await csv(directory, 99)
    await readOntoFormatTool.run({ path, format: 'task', file }, NO_CLIENT)
    const answer = await readOntoFormatTool.run({ path, format: 'task', file, commit: true }, NO_CLIENT)
    expect(answer).toContain('99 rows written')
    expect(answer).not.toContain('A copy from before')
    expect(await namedCopies(path)).toEqual(already)
  })

  it('keeps one whenever asked, the last three of them, and says where', async () => {
    const { path, directory } = await tasks()
    // A copy somebody named by hand looks like one and is never pruned.
    await mkdir(backupFolderFor(path), { recursive: true })
    await writeFile(join(backupFolderFor(path), 'work.before-the-move.emd'), 'by hand')
    const answers: string[] = []
    for (const what of ['the cleanup', 'renaming', 'the merge', 'the split']) {
      answers.push(await keepCopyTool.run({ path, before: what }, NO_CLIENT))
      // A second apart, so each is its own moment.
      await new Promise((resolve) => setTimeout(resolve, 1050))
    }
    expect(answers[0]).toMatch(/\*\*A copy from before the cleanup is at `.*work\.before-\d{8}T\d{6}-the-cleanup\.emd`\.\*\*/)
    expect(answers[3]).toContain('1 older one(s) were removed.')

    const left = await readdir(backupFolderFor(path))
    expect(named(left).map((name) => name.replace(/^work\.before-\d{8}T\d{6}-/, ''))).toEqual([
      'renaming.emd',
      'the-merge.emd',
      'the-split.emd',
    ])
    expect(left).toContain('work.before-the-move.emd')
    expect(left.filter((name) => name.endsWith('.bak'))).toEqual([])
    expect(await beside(directory)).toEqual(['work.emd'])
  }, 10_000)

  it('refuses a file that is not a document, and copies nothing', async () => {
    const { directory } = await tasks()
    const path = join(directory, 'notes.emd')
    await writeFile(path, 'not a database')
    const answer = await keepCopyTool.run({ path }, NO_CLIENT)
    expect(answer).not.toContain('A copy from before')
    expect(await readdir(backupFolderFor(path)).catch(() => [])).toEqual([])
    expect(await beside(directory)).toEqual(['notes.emd', 'work.emd'])
  })
})
