import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { exportDatabase, openDatabase } from '@/data/db/database.ts'
import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { createCategory } from '@/data/repositories/categoryRepository.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import { listRows } from '@/data/repositories/formatRowRepository.ts'
import { serializeDocument } from '@/data/repositories/formatDocumentRepository.ts'

import {
  applyRulesTool,
  connectFormatsTool,
  deleteFormatRowsTool,
  deleteFormatTool,
  extendFormatTool,
  recordFormatRowsTool,
  updateFormatRowsTool,
} from './formats.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

/**
 * **A pack's formats: read anywhere, written only through the pack** — M25 E5,
 * D-269, proved on the ledger's own document through the generic tools.
 */

const LOCKED = /Category belongs to the ledger pack, so its rows are written only through it — on the Categories screen, or with `create_category`/

async function ledgerOnDisk(): Promise<string> {
  const db = await createLedgerDatabase()
  const path = join(await tempDir('emerald-lock-'), 'ledger.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  return path
}

function reopen(path: string) {
  return openDatabase(readFileSync(path))
}

async function categories(path: string) {
  const db = await reopen(path)
  const category = listFormats(db).find((each) => each.name === 'category')
  if (category === undefined) throw new Error('no category')
  const rows = listRows(db, category)
  db.close()
  return rows
}

describe('a pack’s formats, through the generic tools (M25 E5, D-269)', () => {
  it('says every one of the ledger’s formats is the ledger’s', async () => {
    const db = await createLedgerDatabase()
    const formats = listFormats(db)
    expect(formats).toHaveLength(34)
    expect(formats.every((each) => each.owner?.pack === 'ledger')).toBe(true)
    db.close()
  })

  it('refuses a third level of categories from update_format_rows, and writes nothing', async () => {
    const path = await ledgerOnDisk()
    const rows = await categories(path)
    const child = rows.find((each) => each.cells['parent'] !== null)
    const top = rows.find((each) => each.cells['parent'] === null && each.id !== child?.cells['parent'])
    if (child === undefined || top === undefined) throw new Error('no tree')

    const edit = { path, format: 'category', edits: [{ id: top.id, values: { parent: child.id } }] }
    expect(await updateFormatRowsTool.run(edit, NO_CLIENT)).toMatch(LOCKED)
    expect(await updateFormatRowsTool.run({ ...edit, commit: true }, NO_CLIENT)).toMatch(LOCKED)
    expect((await categories(path)).find((each) => each.id === top.id)?.cells['parent']).toBeNull()
  })

  it('refuses recording and deleting rows, and a rule set sorting the pack’s rows', async () => {
    const path = await ledgerOnDisk()
    const [first] = await categories(path)
    const record = { path, format: 'category', rows: [{ name: 'Mine' }], commit: true }
    expect(await recordFormatRowsTool.run(record, NO_CLIENT)).toMatch(LOCKED)
    const remove = { path, format: 'category', ids: [first?.id], commit: true }
    expect(await deleteFormatRowsTool.run(remove, NO_CLIENT)).toMatch(LOCKED)
    expect(await applyRulesTool.run({ path, format: 'category_rule', commit: true }, NO_CLIENT)).toMatch(
      /Transaction belongs to the ledger pack/,
    )
  })

  it('takes a person’s own column, and refuses changing one of the pack’s', async () => {
    const path = await ledgerOnDisk()
    const unique = { path, format: 'category', unique: ['color'], commit: true }
    expect(await extendFormatTool.run(unique, NO_CLIENT)).toMatch(/color is one of its columns/)

    const add = { path, format: 'category', columns: [{ name: 'budget_note', type: 'text' }], commit: true }
    await extendFormatTool.run(add, NO_CLIENT)
    const db = await reopen(path)
    const category = listFormats(db).find((each) => each.name === 'category')
    expect(category?.columns.some((each) => each.name === 'budget_note')).toBe(true)
    expect(category?.owner?.columns).not.toContain('budget_note')
    db.close()
  })

  it('takes a person’s link onto a pack’s format', async () => {
    const path = await ledgerOnDisk()
    const add = {
      path,
      format: 'category',
      columns: [{ name: 'label', type: 'text' }],
      commit: true,
    }
    await extendFormatTool.run(add, NO_CLIENT)
    const connect = { path, format: 'category', column: 'goal', target: 'saving_goal', commit: true }
    await connectFormatsTool.run(connect, NO_CLIENT)
    const db = await reopen(path)
    const category = listFormats(db).find((each) => each.name === 'category')
    expect(category?.columns.find((each) => each.name === 'goal')?.target).toBe('saving_goal')
    db.close()
  })

  it('refuses deleting a pack’s format', async () => {
    const path = await ledgerOnDisk()
    const refused = await deleteFormatTool.run({ path, format: 'setting', commit: true }, NO_CLIENT)
    expect(refused).toMatch(/belongs to the ledger pack, and only the pack can take it away/)
    const db = await reopen(path)
    expect(listFormats(db).some((each) => each.name === 'setting')).toBe(true)
    db.close()
  })

  it('leaves the pack’s own code writing: the Categories screen still makes a second level', async () => {
    const db = await createLedgerDatabase()
    const category = listFormats(db).find((each) => each.name === 'category')
    if (category === undefined) throw new Error('no category')
    const top = listRows(db, category).find((each) => each.cells['parent'] === null)
    if (top === undefined) throw new Error('no top level')
    const id = createCategory(db, { name: 'Coffee beans', kind: 'EXPENSE', parentId: top.id }, 0)
    expect(listRows(db, category).find((each) => each.id === id)?.cells['parent']).toBe(top.id)
    db.close()
  })

  it('writes the lock into the document’s text, a person’s column still theirs', async () => {
    const db = await createLedgerDatabase()
    const parts = serializeDocument(db)
    if (!parts.ok) throw new Error(parts.error)
    const text = parts.value.find((each) => each.name === 'category.format.md')?.text ?? ''
    expect(text).toContain('pack: ledger')
    expect(text).toContain('written: on the Categories screen, or with `create_category`')
    expect(text).toMatch(/pack columns: name, parent, kind/)
    db.close()
  })
})
