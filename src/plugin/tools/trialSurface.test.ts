import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDatabase, exportDatabase } from '@/data/db/database.ts'
import { isNamedCopyOf } from '../../../electron/bridge.ts'

import { documentInfoTool } from './documentInfo.ts'
import {
  declareFormatTool,
  extendFormatTool,
  formatRowsTool,
  recordFormatRowsTool,
  updateFormatRowsTool,
} from './formats.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'
import { backupFolderFor } from '../backup.ts'
import { SERVER_INSTRUCTIONS } from '../instructions.ts'

/**
 * **The tool surface the trials tripped on** (M38 U5). M34 T1 was a stranger
 * driving the plugin over a recipe book; each test here is one place it
 * stumbled, asserted as what the surface does now.
 */

async function emptyDocument(): Promise<{ path: string; folder: string }> {
  const db = await createDatabase()
  const folder = await tempDir('emerald-trial-')
  const path = join(folder, 'kitchen.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  return { path, folder }
}

async function commit(tool: typeof declareFormatTool, args: Record<string, unknown>): Promise<string> {
  return tool.run({ ...args, commit: true }, NO_CLIENT)
}

/** A recipe book: a recipe, and its lines naming an ingredient by text — no identity anywhere. */
async function kitchen(): Promise<{ path: string; folder: string }> {
  const document = await emptyDocument()
  const { path } = document
  expect(
    await commit(declareFormatTool, {
      path,
      format: 'ingredient',
      title: 'Ingredient',
      columns: [
        { name: 'name', type: 'text', required: true },
        { name: 'brand', type: 'text' },
        { name: 'kcal', type: 'real' },
      ],
    }),
  ).toContain('declared')
  await commit(declareFormatTool, {
    path,
    format: 'recipe',
    title: 'Recipe',
    columns: [{ name: 'name', type: 'text', required: true, unique: true }],
  })
  await commit(declareFormatTool, {
    path,
    format: 'line',
    title: 'Line',
    columns: [
      { name: 'what', type: 'text', required: true },
      { name: 'recipe', type: 'link', target: 'recipe', required: true },
      { name: 'ingredient', type: 'link', target: 'ingredient' },
      { name: 'kcal', type: 'real' },
    ],
  })
  await commit(extendFormatTool, {
    path,
    format: 'recipe',
    aggregates: [{ name: 'total_kcal', of: 'sum', over_format: 'line', over_column: 'recipe', works_out: 'kcal' }],
  })
  return document
}

describe('M38 U5 — the tool surface the trials tripped on', () => {
  it('(4) declares a format with nothing that adds up without being told so', async () => {
    const { path } = await emptyDocument()
    const answer = await commit(declareFormatTool, {
      path,
      format: 'book',
      title: 'Book',
      columns: [{ name: 'title', type: 'text', required: true }],
    })
    expect(answer).not.toContain('declares no identity')
    expect(answer).not.toContain('Nothing was written')
    expect(await documentInfoTool.run({ path }, NO_CLIENT)).toContain('Declared formats: book (0 rows)')
  })

  it('(1) hands back where the rest begins, so 250 rows come back whole in two calls', async () => {
    const { path } = await kitchen()
    const rows = Array.from({ length: 250 }, (_, at) => ({ name: `Recipe ${String(at + 1).padStart(3, '0')}` }))
    await commit(recordFormatRowsTool, { path, format: 'recipe', rows: rows.slice(0, 200) })
    await commit(recordFormatRowsTool, { path, format: 'recipe', rows: rows.slice(200) })

    const first = await formatRowsTool.run({ path, format: 'recipe', columns: ['name'], limit: 200 }, NO_CLIENT)
    expect(first).toContain('250 rows of Recipe, showing 1–200.')
    expect(first).toContain('`offset: 200`')
    const second = await formatRowsTool.run(
      { path, format: 'recipe', columns: ['name'], limit: 200, offset: 200 },
      NO_CLIENT,
    )
    expect(second).toContain('showing 201–250')
    expect(second).not.toContain('`offset:')

    const names = [first, second].flatMap((text) => [...text.matchAll(/Recipe (\d{3})/g)].map((match) => match[1]))
    expect(new Set(names).size).toBe(250)
  })

  it('(1) takes a worked-out total in `columns`', async () => {
    const { path } = await kitchen()
    await commit(recordFormatRowsTool, { path, format: 'recipe', rows: [{ name: 'Soup' }] })
    await commit(recordFormatRowsTool, {
      path,
      format: 'line',
      rows: [
        { what: 'stock', recipe: 'Soup', kcal: 40 },
        { what: 'leek', recipe: 'Soup', kcal: 60 },
      ],
    })
    const answer = await formatRowsTool.run({ path, format: 'recipe', columns: ['name', 'total_kcal'] }, NO_CLIENT)
    expect(answer).not.toContain('has no column total_kcal')
    expect(answer).toMatch(/\| Soup \| 100 \|/)
    // And a name it has not got lists what it works out, too.
    await expect(formatRowsTool.run({ path, format: 'recipe', columns: ['total'] }, NO_CLIENT)).rejects.toThrow(
      'and works out total_kcal',
    )
  })

  it('(2) names a row whose name repeats by its name plus one more column', async () => {
    const { path } = await kitchen()
    await commit(recordFormatRowsTool, {
      path,
      format: 'ingredient',
      rows: [
        { name: 'Salt', brand: 'Coarse', kcal: 0 },
        { name: 'Salt', brand: 'Fine', kcal: 0 },
        { name: 'Leek', kcal: 61 },
      ],
    })
    await commit(recordFormatRowsTool, { path, format: 'recipe', rows: [{ name: 'Soup' }] })

    // A repeated name alone is nobody, and the refusal says how to tell them apart.
    const alone = await commit(recordFormatRowsTool, {
      path,
      format: 'line',
      rows: [{ what: 'salt', recipe: 'Soup', ingredient: 'Salt' }],
    })
    expect(alone).toContain('Nothing was written')
    expect(alone).toContain('told apart by one more column')

    // A name exactly one row holds names it, though the column is not unique.
    // And a name plus a column names the one row that has both.
    const answer = await commit(recordFormatRowsTool, {
      path,
      format: 'line',
      rows: [
        { what: 'leek', recipe: 'Soup', ingredient: 'Leek' },
        { what: 'salt', recipe: 'Soup', ingredient: { name: 'Salt', brand: 'fine' } },
      ],
    })
    expect(answer).toContain('2 rows added')
    const lines = await formatRowsTool.run({ path, format: 'line', columns: ['what', 'ingredient'] }, NO_CLIENT)
    expect(lines).toMatch(/\| salt \| Salt \|/)

    // Two rows still holding both is refused rather than guessed.
    const vague = await commit(recordFormatRowsTool, {
      path,
      format: 'line',
      rows: [{ what: 'salt', recipe: 'Soup', ingredient: { name: 'Salt', kcal: 0 } }],
    })
    expect(vague).toContain('more than one ingredient row has name "Salt", kcal 0')

    // And an edit takes the same spelling.
    const edit = await commit(updateFormatRowsTool, {
      path,
      format: 'line',
      edits: [{ where: { what: 'salt' }, values: { ingredient: { name: 'Salt', brand: 'Coarse' } } }],
    })
    expect(edit).not.toContain('Nothing was written')
  })

  it('(3) introduces itself as Emerald, formats first, and document_info leads with them', async () => {
    const formats = SERVER_INSTRUCTIONS.indexOf('## Formats')
    const ledger = SERVER_INSTRUCTIONS.indexOf('## The ledger')
    expect(SERVER_INSTRUCTIONS.startsWith('# Emerald')).toBe(true)
    expect(SERVER_INSTRUCTIONS).toContain('Each kind is a **format**')
    expect(formats).toBeGreaterThan(0)
    expect(ledger).toBeGreaterThan(formats)
    // The statements come after the formats, not before them.
    expect(SERVER_INSTRUCTIONS.indexOf('Card and bank statements')).toBeGreaterThan(formats)

    const { path } = await kitchen()
    const info = await documentInfoTool.run({ path }, NO_CLIENT)
    expect(info.indexOf('Declared formats: ')).toBeGreaterThan(0)
    expect(info).toContain('It does not keep the ledger')
    expect(info).not.toContain('Accounts: 0')
    const empty = await documentInfoTool.run({ path: (await emptyDocument()).path }, NO_CLIENT)
    expect(empty).toContain('No formats declared yet')
  })

  it('(5) keeps a named copy before the first rows go into a document that has none', async () => {
    const { path, folder } = await kitchen()
    // In the document's folder of earlier copies, never beside it (M48 U4, D-470).
    const copies = async (): Promise<string[]> =>
      (await readdir(backupFolderFor(path)).catch(() => [])).filter((name) => isNamedCopyOf('kitchen.emd', name))
    // Declaring formats writes no rows, so no named copy yet.
    expect(await copies()).toEqual([])

    const answer = await commit(recordFormatRowsTool, { path, format: 'recipe', rows: [{ name: 'Soup' }] })
    expect(answer).toContain('A copy from before adding 1 rows to recipe')
    expect(await copies()).toHaveLength(1)

    // The second write finds rows there, and a small batch keeps only the rolling copy.
    await commit(recordFormatRowsTool, { path, format: 'recipe', rows: [{ name: 'Stew' }] })
    expect(await copies()).toHaveLength(1)
    expect((await readdir(folder)).filter((name) => name.startsWith('kitchen.'))).toEqual(['kitchen.emd'])
  })
})
