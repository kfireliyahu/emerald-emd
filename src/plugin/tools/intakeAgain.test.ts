/**
 * **Reading the same source again** — M38 U3, D-408.
 *
 * The done-test: a synthetic folder of notes read, then one note edited, one
 * added and one removed, and read again — which changes exactly one row, adds
 * one and names one, and writes nothing else. Then the same in a document
 * stored as text, which until this unit could not keep a read at all; a row a
 * person edited since, left as it is; the gone row taken away only when asked;
 * and a spreadsheet keyed by its unique column.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDatabase, exportDatabase } from '@/data/db/database.ts'
import { listIntakes } from '@/data/repositories/formatIntakeRepository.ts'
import { adoptFormat, listFormats } from '@/data/repositories/formatRepository.ts'
import { listRows, updateRow } from '@/data/repositories/formatRowRepository.ts'
import { exportEncoded, openEncoded } from '@/data/storage/encoding.ts'
import { column, type FormatDeclaration } from '@/domain/format/declaration.ts'
import type { StoredRow } from '@/domain/format/row.ts'

import { readOntoFormatTool } from './intake.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

const NOW = Date.UTC(2026, 9, 6)

const NOTE: FormatDeclaration = {
  language: 5,
  name: 'ingredient',
  title: 'Ingredient',
  notes: '',
  columns: [
    column('name', 'text', { required: true, unique: true }),
    column('kcal', 'real'),
    column('body', 'text'),
  ],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

const note = (title: string, kcal: number, body: string): string =>
  `---\ntitle: ${title}\nkcal: ${String(kcal)}\n---\n${body}\n`

async function document(encoding: 'sqlite' | 'text'): Promise<{ path: string; folder: string }> {
  const db = await createDatabase()
  expect(adoptFormat(db, NOTE, NOW).refusals).toEqual([])
  const dir = await tempDir('emerald-again-')
  const path = join(dir, 'kitchen.emd')
  const bytes = encoding === 'sqlite' ? exportDatabase(db) : await exportEncoded(db, 'text')
  if (bytes instanceof Uint8Array) await writeFile(path, bytes)
  else if (bytes.ok) await writeFile(path, bytes.value)
  else throw new Error(bytes.error)
  db.close()
  const folder = join(dir, 'ingredients')
  await mkdir(folder)
  await writeFile(join(folder, 'flour.md'), note('Flour', 364, 'Plain.'))
  await writeFile(join(folder, 'sugar.md'), note('Sugar', 387, 'White.'))
  await writeFile(join(folder, 'salt.md'), note('Salt', 0, 'Fine.'))
  return { path, folder }
}

async function rowsOf(path: string): Promise<readonly StoredRow[]> {
  const { db } = await openEncoded(new Uint8Array(await readFile(path)))
  const declaration = listFormats(db).find((each) => each.name === 'ingredient')
  if (declaration === undefined) throw new Error('no format')
  const rows = listRows(db, declaration)
  db.close()
  return rows
}

const byName = (rows: readonly StoredRow[]): Record<string, StoredRow['cells']> =>
  Object.fromEntries(rows.map((row) => [String(row.cells['name']), row.cells]))

/** One note edited, one added, one removed. */
async function drift(folder: string): Promise<void> {
  await writeFile(join(folder, 'sugar.md'), note('Sugar', 400, 'White.'))
  await writeFile(join(folder, 'butter.md'), note('Butter', 717, 'Salted.'))
  await rm(join(folder, 'salt.md'))
}

describe('read_onto_format, reading the same folder again (M38 U3)', () => {
  for (const encoding of ['sqlite', 'text'] as const) {
    it(`changes one row, adds one and names one — stored as ${encoding}`, async () => {
      const { path, folder } = await document(encoding)
      const first = await readOntoFormatTool.run({ path, format: 'ingredient', file: folder, commit: true }, NO_CLIENT)
      expect(first).toContain('3 rows written from ingredients/')
      const before = await rowsOf(path)

      await drift(folder)
      const dry = await readOntoFormatTool.run({ path, format: 'ingredient', file: folder }, NO_CLIENT)
      expect(dry).toContain('Read before — what this read changes')
      expect(dry).toContain('each line found again by its file name')
      expect(dry).toContain('This read changes 1 row, adds 1, and finds 1 as it was; 1 row has no line any more.')
      expect(dry).toMatch(/\*\*Changed\*\*, written over with what the file says now:\n- “Sugar” \(sugar\.md\): kcal/)
      expect(dry).toContain('**Added**:\n- “butter.md”')
      expect(dry).toMatch(/\*\*Gone from the file\*\*, kept:\n- “Salt” \(salt\.md\)/)
      expect(dry).toContain('Send `remove_gone: true` to take it away.')
      // A dry run writes nothing.
      expect(await rowsOf(path)).toEqual(before)

      const done = await readOntoFormatTool.run({ path, format: 'ingredient', file: folder, commit: true }, NO_CLIENT)
      expect(done).toContain(
        '**ingredients/ read again** onto Ingredient: 1 row changed, 1 added, 1 as it was, 1 gone from the file and kept.',
      )
      const after = byName(await rowsOf(path))
      expect(Object.keys(after).sort()).toEqual(['Butter', 'Flour', 'Salt', 'Sugar'])
      expect(after['Sugar']?.['kcal']).toBe(400)
      expect(after['Butter']?.['kcal']).toBe(717)
      // Nothing else: the unchanged and the gone rows hold what they held.
      expect(after['Flour']).toEqual(byName(before)['Flour'])
      expect(after['Salt']).toEqual(byName(before)['Salt'])

      // Read a third time, nothing has changed — and nothing is written.
      const third = await readOntoFormatTool.run({ path, format: 'ingredient', file: folder, commit: true }, NO_CLIENT)
      expect(third).toContain('**Nothing has changed since the last read**, so there is nothing to write.')
      expect(Object.keys(byName(await rowsOf(path))).sort()).toEqual(['Butter', 'Flour', 'Salt', 'Sugar'])

      // Asked, the gone row goes — and only it.
      const removed = await readOntoFormatTool.run(
        { path, format: 'ingredient', file: folder, remove_gone: true, commit: true },
        NO_CLIENT,
      )
      expect(removed).toContain('1 taken away as gone')
      expect(Object.keys(byName(await rowsOf(path))).sort()).toEqual(['Butter', 'Flour', 'Sugar'])
    })
  }

  it('keeps a read in a text document exactly, with the same reading id on every open', async () => {
    const { path, folder } = await document('text')
    await readOntoFormatTool.run({ path, format: 'ingredient', file: folder, commit: true }, NO_CLIENT)
    const text = new TextDecoder().decode(await readFile(path))
    expect(text).toContain('<!-- emerald: readings.md -->')
    expect(text).toContain('### ingredients/')
    expect(text).toMatch(/"row":"Flour","key":"flour\.md"/)

    const ids: string[] = []
    for (const _ of [1, 2]) {
      const { db } = await openEncoded(new Uint8Array(await readFile(path)))
      ids.push(listIntakes(db, 'ingredient')[0]?.id ?? '')
      // Written back, the text is the text it was read from.
      const again = await exportEncoded(db, 'text')
      expect(again.ok && new TextDecoder().decode(again.value)).toBe(text)
      db.close()
    }
    expect(ids[0]).not.toBe('')
    expect(ids[1]).toBe(ids[0])
  })

  it('leaves a row a person changed since the last read, and says so', async () => {
    const { path, folder } = await document('text')
    await readOntoFormatTool.run({ path, format: 'ingredient', file: folder, commit: true }, NO_CLIENT)

    // The person corrects Sugar's body in the document.
    const { db } = await openEncoded(new Uint8Array(await readFile(path)))
    const declaration = listFormats(db).find((each) => each.name === 'ingredient')
    const sugar = declaration === undefined ? undefined : listRows(db, declaration).find((row) => row.cells['name'] === 'Sugar')
    if (declaration === undefined || sugar === undefined) throw new Error('no sugar')
    updateRow(db, declaration, sugar.id, { body: 'Caster, not granulated.' })
    const saved = await exportEncoded(db, 'text')
    if (!saved.ok) throw new Error(saved.error)
    await writeFile(path, saved.value)
    db.close()

    await writeFile(join(folder, 'sugar.md'), note('Sugar', 400, 'White.'))
    const dry = await readOntoFormatTool.run({ path, format: 'ingredient', file: folder }, NO_CLIENT)
    expect(dry).toContain('**Changed in the document since the last read**')
    expect(dry).toContain('- “Sugar” (sugar.md)')
    // Nothing else changed, so the read again has nothing to write.
    expect(dry).toContain('**Nothing has changed since the last read**')
    await readOntoFormatTool.run({ path, format: 'ingredient', file: folder, commit: true }, NO_CLIENT)
    const after = byName(await rowsOf(path))
    expect(after['Sugar']?.['body']).toBe('Caster, not granulated.')
    expect(after['Sugar']?.['kcal']).toBe(387)
  })

  it('reads a spreadsheet again by its unique column', async () => {
    const { path } = await document('sqlite')
    const dir = await tempDir('emerald-again-csv-')
    const csv = join(dir, 'pantry.csv')
    await writeFile(csv, 'name,kcal\nFlour,364\nSugar,387\n')
    await readOntoFormatTool.run({ path, format: 'ingredient', file: csv, commit: true }, NO_CLIENT)

    await writeFile(csv, 'name,kcal\nFlour,364\nSugar,400\nButter,717\n')
    const dry = await readOntoFormatTool.run({ path, format: 'ingredient', file: csv }, NO_CLIENT)
    expect(dry).toContain('each line found again by name, which is unique')
    expect(dry).toContain('This read changes 1 row, adds 1, and finds 1 as it was.')
    await readOntoFormatTool.run({ path, format: 'ingredient', file: csv, commit: true }, NO_CLIENT)
    const after = byName(await rowsOf(path))
    expect(Object.keys(after).sort()).toEqual(['Butter', 'Flour', 'Sugar'])
    expect(after['Sugar']?.['kcal']).toBe(400)
  })
})
