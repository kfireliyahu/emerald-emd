/**
 * **A pack's seeded rows** (M24 U12, D-264), against real SQLite.
 *
 * The ledger's category tree in miniature: a format named by a unique column,
 * linking to itself for a parent, seeded from the same `.format.md` text a
 * document is stored as. What has to hold is the units' rule one level up — a
 * later build corrects its own rows and never a person's — and the two ways a
 * row becomes a person's: an edit, and a removal that stays removed.
 */

import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'

import {
  column,
  DECLARATION_LANGUAGE,
  type FormatDeclaration,
} from '@/domain/format/declaration.ts'
import { readFormat, writeFormat, type ParsedFormat } from '@/domain/format/document.ts'
import { createDatabase } from '../db/database.ts'
import { applyParts, serializeDocument } from './formatDocumentRepository.ts'
import { indexOf } from './formatJoinRepository.ts'
import { adoptFormat, listFormats } from './formatRepository.ts'
import { deleteRows, insertRows, listRows, updateRow } from './formatRowRepository.ts'
import { listSeeds, seedRows } from './formatSeedRepository.ts'

const CATEGORY: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'category',
  title: 'Category',
  notes: '',
  columns: [
    column('name', 'text', { required: true, unique: true }),
    column('parent', 'link', { target: 'category' }),
    column('essential', 'boolean'),
  ],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

/** The pack's file: the declaration, and its rows under `## rows`, links by name. */
function pack(rows: readonly string[]): ParsedFormat {
  const declaration = writeFormat(CATEGORY, [], new Map())
  if (!declaration.ok) throw new Error(declaration.error)
  const parsed = readFormat(`${declaration.value}\n${rows.join('\n\n')}\n`)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.value
}

const V1 = pack([
  '### Food\nessential: true',
  '### Groceries\nparent: Food\nessential: true',
  '### Eating out\nparent: Food\nessential: false',
])

async function withCategories(): Promise<Database> {
  const db = await createDatabase()
  expect(adoptFormat(db, CATEGORY, 0).refusals).toEqual([])
  return db
}

function seed(db: Database, format: ParsedFormat) {
  const seeded = seedRows(db, format, indexOf(listFormats(db)))
  if (!seeded.ok) throw new Error(seeded.error)
  return seeded.value
}

function byName(db: Database): Map<string, { id: string; cells: Record<string, unknown> }> {
  return new Map(
    listRows(db, CATEGORY).map((row) => [
      String(row.cells['name']),
      { id: row.id, cells: { ...row.cells } },
    ]),
  )
}

describe('a pack seeds its rows (M24 U12, D-264)', () => {
  it('adds them once, links by name, and a second run changes nothing', async () => {
    const db = await withCategories()

    expect(seed(db, V1).added).toEqual(['Food', 'Groceries', 'Eating out'])
    const rows = byName(db)
    expect(rows.get('Groceries')?.cells['parent']).toBe(rows.get('Food')?.id)
    expect(listSeeds(db).map((each) => each.state)).toEqual(['SEEDED', 'SEEDED', 'SEEDED'])

    const again = seed(db, V1)
    expect(again).toEqual({ added: [], corrected: [], theirs: [], removed: [], released: [] })
    expect(listRows(db, CATEGORY)).toHaveLength(3)
    db.close()
  })

  it('corrects its own row in a later build, and never one a person edited', async () => {
    const db = await withCategories()
    seed(db, V1)
    const groceries = byName(db).get('Groceries')?.id ?? ''
    // A person decides eating out is essential in this house.
    updateRow(db, CATEGORY, byName(db).get('Eating out')?.id ?? '', { essential: 1 })

    const v2 = pack([
      '### Food\nessential: true',
      '### Groceries\nparent: Food\nessential: false',
      '### Eating out\nparent: Food\nessential: false',
    ])
    const seeded = seed(db, v2)

    expect(seeded.corrected).toEqual(['Groceries'])
    expect(seeded.theirs).toEqual(['Eating out'])
    const rows = byName(db)
    expect(rows.get('Groceries')?.cells['essential']).toBe(0)
    expect(rows.get('Groceries')?.id).toBe(groceries)
    expect(rows.get('Eating out')?.cells['essential']).toBe(1)
    db.close()
  })

  it('an edit that changes nothing leaves the row the pack’s', async () => {
    const db = await withCategories()
    seed(db, V1)
    updateRow(db, CATEGORY, byName(db).get('Food')?.id ?? '', { essential: 1 })
    expect(listSeeds(db).find((each) => each.key === 'Food')?.state).toBe('SEEDED')
    db.close()
  })

  it('does not bring back a row a person removed', async () => {
    const db = await withCategories()
    seed(db, V1)
    deleteRows(db, CATEGORY, [byName(db).get('Eating out')?.id ?? ''], listFormats(db))

    const seeded = seed(db, V1)
    expect(seeded.removed).toEqual(['Eating out'])
    expect(byName(db).has('Eating out')).toBe(false)
    db.close()
  })

  it('does not bring back a row a person renamed, beside the one they renamed (M25 U2)', async () => {
    const db = await withCategories()
    seed(db, V1)
    updateRow(db, CATEGORY, byName(db).get('Eating out')?.id ?? '', { name: 'Restaurants' })

    const seeded = seed(db, V1)
    expect(seeded.added).toEqual([])
    expect(seeded.removed).toEqual(['Eating out'])
    expect([...byName(db).keys()].sort()).toEqual(['Food', 'Groceries', 'Restaurants'])
    db.close()
  })

  it('leaves a person’s own row of the same name alone', async () => {
    const db = await withCategories()
    insertRows(db, CATEGORY, [{ name: 'Food', essential: 0 }])

    const seeded = seed(db, V1)
    expect(seeded.theirs).toEqual(['Food'])
    expect(byName(db).get('Food')?.cells['essential']).toBe(0)
    // Its children still link to it: the name is the row, whoever made it.
    expect(byName(db).get('Groceries')?.cells['parent']).toBe(byName(db).get('Food')?.id)
    db.close()
  })

  it('releases a seed a later build dropped: the row stays, the person’s now', async () => {
    const db = await withCategories()
    seed(db, V1)
    const v2 = pack(['### Food\nessential: true', '### Groceries\nparent: Food\nessential: true'])

    expect(seed(db, v2).released).toEqual(['Eating out'])
    expect(byName(db).has('Eating out')).toBe(true)
    expect(listSeeds(db).map((each) => each.key)).toEqual(['Food', 'Groceries'])
    db.close()
  })

  it('refuses a format not named by a unique column, and a link to nothing', async () => {
    const db = await createDatabase()
    const loose = { ...CATEGORY, columns: [column('name', 'text', { required: true })] }
    expect(adoptFormat(db, loose, 0).refusals).toEqual([])
    const refused = seedRows(db, { declaration: loose, rows: [] }, indexOf(listFormats(db)))
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error).toContain('not unique')
    db.close()

    const other = await withCategories()
    const dangling = seedRows(
      other,
      pack(['### Groceries\nparent: Fod']),
      indexOf(listFormats(other)),
    )
    expect(dangling.ok).toBe(false)
    expect(listRows(other, CATEGORY)).toEqual([])
    other.close()
  })

  it('keeps what it knows through a text document, so a removal survives the round trip', async () => {
    const db = await withCategories()
    seed(db, V1)
    deleteRows(db, CATEGORY, [byName(db).get('Eating out')?.id ?? ''], listFormats(db))

    const parts = serializeDocument(db)
    if (!parts.ok) throw new Error(parts.error)
    expect(parts.value.map((part) => part.name)).toContain('seeds.md')
    const records = listSeeds(db)
    db.close()

    const fresh = await createDatabase()
    const applied = applyParts(fresh, parts.value, 0)
    expect(applied.ok).toBe(true)
    expect(listSeeds(fresh)).toEqual(records)
    expect(seed(fresh, V1).removed).toEqual(['Eating out'])
    expect(byName(fresh).has('Eating out')).toBe(false)
    fresh.close()
  })

  it('writes no seeds part for a document no pack has seeded', async () => {
    const db = await withCategories()
    insertRows(db, CATEGORY, [{ name: 'Mine' }])
    const parts = serializeDocument(db)
    if (!parts.ok) throw new Error(parts.error)
    // The day it last changed (M47 U5, D-462), and no seeds.
    expect(parts.value.map((part) => part.name)).toEqual(['category.format.md', 'changed.md'])
    db.close()
  })
})
