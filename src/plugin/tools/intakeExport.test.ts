/**
 * **An export read twice updates its rows by their unique key** — M50 U3.
 *
 * The done-test: the same csv read twice yields the same row count, under its
 * own name or another (next month's export); one changed cell in the second
 * file updates that cell and nothing else; the dry run names new and changed;
 * a format without a unique column reads as today and says why it cannot
 * repeat. Synthetic files only.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDatabase, exportDatabase } from '@/data/db/database.ts'
import { listIntakes } from '@/data/repositories/formatIntakeRepository.ts'
import { adoptFormat, listFormats } from '@/data/repositories/formatRepository.ts'
import { insertRows, listRows } from '@/data/repositories/formatRowRepository.ts'
import { openEncoded } from '@/data/storage/encoding.ts'
import { column, type FormatDeclaration } from '@/domain/format/declaration.ts'
import type { StoredRow } from '@/domain/format/row.ts'

import { readOntoFormatTool, supersedeReadingTool } from './intake.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

const NOW = Date.UTC(2026, 9, 22)

const task = (unique: boolean): FormatDeclaration => ({
  language: 5,
  name: 'task',
  title: 'Task',
  notes: '',
  columns: [
    column('ref', 'text', { unique }),
    column('title', 'text'),
    column('state', 'text'),
    column('note', 'text'),
  ],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
})

async function document(
  unique: boolean,
  typed: readonly Record<string, string>[] = [],
): Promise<{ path: string; dir: string }> {
  const db = await createDatabase()
  const declaration = task(unique)
  expect(adoptFormat(db, declaration, NOW).refusals).toEqual([])
  if (typed.length > 0) insertRows(db, declaration, typed)
  const dir = await tempDir('emerald-export-')
  const path = join(dir, 'board.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  return { path, dir }
}

async function rowsOf(path: string): Promise<readonly StoredRow[]> {
  const { db } = await openEncoded(new Uint8Array(await readFile(path)))
  const declaration = listFormats(db).find((each) => each.name === 'task')
  if (declaration === undefined) throw new Error('no format')
  const rows = listRows(db, declaration)
  db.close()
  return rows
}

const byRef = (rows: readonly StoredRow[]): Record<string, StoredRow['cells']> =>
  Object.fromEntries(rows.map((row) => [String(row.cells['ref']), row.cells]))

const read = (path: string, file: string, commit = false): Promise<string> =>
  readOntoFormatTool.run({ path, format: 'task', file, commit }, NO_CLIENT)

const OCTOBER = 'ref,title,state\nT-1,Paint the fence,open\nT-2,Fix the gate,open\nT-3,Buy seeds,done\n'

describe('an export read twice (M50 U3)', () => {
  it('keeps the row count when the same csv is read twice, under its own name or another', async () => {
    const { path, dir } = await document(true)
    const october = join(dir, 'october.csv')
    await writeFile(october, OCTOBER)
    await read(path, october, true)
    await read(path, october, true)
    expect(await rowsOf(path)).toHaveLength(3)

    // The same bytes, renamed — next month's download of an unchanged board.
    const copy = join(dir, 'board-export (1).csv')
    await writeFile(copy, OCTOBER)
    const dry = await read(path, copy)
    expect(dry).toContain('was not read onto Task before, but 3 lines name rows Task already holds by ref, which is unique')
    expect(dry).toContain('**Every line is already there as the file says it**, so there is nothing to write.')
    await read(path, copy, true)
    expect(await rowsOf(path)).toHaveLength(3)
  })

  it('changes the one cell that changed in next month’s export, adds what is new, and nothing else', async () => {
    const { path, dir } = await document(true)
    const october = join(dir, 'october.csv')
    await writeFile(october, OCTOBER)
    await read(path, october, true)
    const before = byRef(await rowsOf(path))

    const november = join(dir, 'november.csv')
    await writeFile(november, 'ref,title,state\nT-1,Paint the fence,done\nT-2,Fix the gate,open\nT-4,Prune the roses,open\n')
    const dry = await read(path, november)
    expect(dry).toContain('Already in Task — what this read changes')
    expect(dry).toContain('This read changes 1 row, adds 1, and finds 1 as it was.')
    expect(dry).toContain('- “T-1”: state')
    expect(dry).toContain('- “T-4”')
    // T-3 is not in November's file, and it was never November's line: not gone.
    expect(dry).not.toContain('no line any more')
    expect(dry).not.toContain('already holds. It is unique')

    const written = await read(path, november, true)
    expect(written).toContain('**november.csv read** onto Task, its lines found by ref, which is unique: 1 row changed, 1 added, 1 as it was.')
    const after = byRef(await rowsOf(path))
    expect(Object.keys(after).sort()).toEqual(['T-1', 'T-2', 'T-3', 'T-4'])
    expect(after['T-1']).toEqual({ ...before['T-1'], state: 'done' })
    expect(after['T-2']).toEqual(before['T-2'])
    expect(after['T-3']).toEqual(before['T-3'])
  })

  it('moves a row to the reading that last wrote it, so superseding the older one keeps it', async () => {
    const { path, dir } = await document(true)
    const october = join(dir, 'october.csv')
    await writeFile(october, OCTOBER)
    await read(path, october, true)
    const november = join(dir, 'november.csv')
    await writeFile(november, 'ref,title,state\nT-1,Paint the fence,done\n')
    await read(path, november, true)

    const { db } = await openEncoded(new Uint8Array(await readFile(path)))
    const first = listIntakes(db, 'task').find((each) => each.fileName === 'october.csv')
    db.close()
    if (first === undefined) throw new Error('no reading')
    expect(first.rowCount).toBe(2)
    await supersedeReadingTool.run({ path, format: 'task', reading: first.id, commit: true }, NO_CLIENT)
    expect(Object.keys(byRef(await rowsOf(path)))).toEqual(['T-1'])
  })

  it('reads a third time as a change, not as an edit somebody made', async () => {
    const { path, dir } = await document(true)
    const board = join(dir, 'board.csv')
    await writeFile(board, 'ref,title,state\nT-1,Paint the fence,open\n')
    await read(path, board, true)
    await writeFile(board, 'ref,title,state\nT-1,Paint the fence,doing\n')
    await read(path, board, true)
    await writeFile(board, 'ref,title,state\nT-1,Paint the fence,done\n')
    const dry = await read(path, board)
    expect(dry).toContain('This read changes 1 row, adds 0, and finds 0 as they were.')
    expect(dry).not.toContain('Changed in the document since the last read')
    await read(path, board, true)
    expect(byRef(await rowsOf(path))['T-1']?.['state']).toBe('done')
  })

  it('updates a row a person typed, by its unique key', async () => {
    const { path, dir } = await document(true, [{ ref: 'T-1', title: 'Paint the fence', state: 'open', note: 'two coats' }])
    const board = join(dir, 'board.csv')
    await writeFile(board, 'ref,title,state\nT-1,Paint the fence,done\n')
    const dry = await read(path, board)
    expect(dry).toContain('1 line names a row Task already holds by ref, which is unique')
    await read(path, board, true)
    const rows = await rowsOf(path)
    expect(rows).toHaveLength(1)
    expect(byRef(rows)['T-1']).toMatchObject({ state: 'done', note: 'two coats' })
  })

  it('reads a format without a unique column as before, and says why it cannot repeat', async () => {
    const { path, dir } = await document(false)
    const october = join(dir, 'october.csv')
    await writeFile(october, OCTOBER)
    const dry = await read(path, october)
    expect(dry).toContain(
      'Task has no unique column to find a row by, so reading this file again, or a later export of it, adds every line again rather than updating rows.',
    )
    await read(path, october, true)
    const november = join(dir, 'november.csv')
    await writeFile(november, OCTOBER)
    await read(path, november, true)
    expect(await rowsOf(path)).toHaveLength(6)
  })

  it('names the unique column a reading leaves unfilled', async () => {
    const { path, dir } = await document(true)
    const titles = join(dir, 'titles.csv')
    await writeFile(titles, 'title,state\nPaint the fence,open\n')
    const dry = await read(path, titles)
    expect(dry).toContain('ref is unique but this reading does not fill it, so reading this file again')
  })
})
