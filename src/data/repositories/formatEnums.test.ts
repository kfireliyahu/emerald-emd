/**
 * **Several choices in one column** (M34 U5, D-398): an `enums` column, its
 * members kept in `fmt_<format>__<column>` under a `CHECK` naming the list,
 * proved against real SQLite, through the text a document is stored as, and
 * through a reading that splits a spreadsheet cell by a separator it states.
 *
 * The brief's done-test is the first three: a value outside the list is
 * refused naming it, a match on one member finds the rows holding it, and the
 * per-line tally of a reading still sums when a line is refused for one.
 */

import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'

import { read } from '@/domain/format/artefact.ts'
import { lineTally, tallyAccounts } from '@/domain/format/audit.ts'
import { declarationProblems, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { readingProblems, readRows, type Reading, type ReadCell, type ReadTable } from '@/domain/format/reading.ts'
import { coerceEdit, coerceMatch, coerceRow, type StoredValue } from '@/domain/format/row.ts'
import { createDatabase, query } from '../db/database.ts'
import { applyParts, serializeDocument } from './formatDocumentRepository.ts'
import { auditFormat } from './formatAuditRepository.ts'
import { indexOf } from './formatJoinRepository.ts'
import { listIntakes, recordIntake } from './formatIntakeRepository.ts'
import { adoptFormat, listFormats } from './formatRepository.ts'
import { deleteRows, insertRows, listRows, readRow, updateRow } from './formatRowRepository.ts'

const NOW = Date.UTC(2026, 9, 6)

function declared(text: string): FormatDeclaration {
  const result = read(text)
  if (!result.ok) throw new Error(result.error)
  return result.value
}

function recipeWith(values: string): FormatDeclaration {
  return declared(`---
format: recipe
title: Recipe
language: 22
checks: none
---

A dish, and what it is.

| column | type | points at | unit | per | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| name | text |  |  |  | yes | yes |  |  |  | Its name. |
| tags | enums |  |  |  | no | no | ${values} |  |  | What kind of dish. |
`)
}

const RECIPE = recipeWith('vegan, quick, freezes, one pot')

async function withRecipes(): Promise<Database> {
  const db = await createDatabase()
  expect(adoptFormat(db, RECIPE, NOW).refusals).toEqual([])
  return db
}

function cells(offered: Record<string, unknown>): Record<string, StoredValue> {
  const coerced = coerceRow(RECIPE, offered)
  if (!coerced.ok) throw new Error(coerced.error)
  return coerced.value
}

function write(db: Database, rows: readonly Record<string, unknown>[]): readonly string[] {
  return insertRows(db, RECIPE, rows.map(cells))
}

function tagsOf(db: Database, id: string): StoredValue | undefined {
  return readRow(db, RECIPE, id)?.cells['tags']
}

describe('an enums column (M34 U5, D-398)', () => {
  it('is a table of its own whose CHECK names the list, and no column of the format’s', async () => {
    const db = await withRecipes()
    const columns = query(db, `PRAGMA table_info("fmt_recipe")`).map((row) => String(row['name']))
    expect(columns).toEqual(['id', 'name'])
    const sql = String(query(db, `SELECT sql FROM sqlite_master WHERE name = 'fmt_recipe__tags'`)[0]?.['sql'])
    expect(sql).toContain(`CHECK ("member" IN ('vegan', 'quick', 'freezes', 'one pot'))`)
    // SQLite itself refuses a member off the list, whatever wrote it.
    expect(() =>
      db.run(`INSERT INTO "fmt_recipe__tags" ("row_id", "member", "position") VALUES ('x', 'spicy', 0)`),
    ).toThrow(/CHECK/)
  })

  it('writes several members, any case, stored as the list spells them and read back in order', async () => {
    const db = await withRecipes()
    const [id = ''] = write(db, [{ name: 'Lentil soup', tags: ['ONE POT', 'vegan', 'Freezes'] }])
    expect(tagsOf(db, id)).toEqual(['one pot', 'vegan', 'freezes'])
    // One member on its own is a list of one; nothing is an empty list.
    expect(cells({ name: 'Toast', tags: 'quick' })['tags']).toEqual(['quick'])
    expect(cells({ name: 'Water' })['tags']).toEqual([])
  })

  it('refuses a value outside the list, naming it and the list', () => {
    const refused = coerceRow(RECIPE, { name: 'Curry', tags: ['vegan', 'spicy'] })
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.error).toContain('"spicy"')
    expect(refused.error).toContain('vegan, quick, freezes, one pot')
    expect(coerceRow(RECIPE, { name: 'Curry', tags: ['vegan', 'Vegan'] }).ok).toBe(false)
    expect(coerceRow(RECIPE, { name: 'Curry', tags: [3] }).ok).toBe(false)
  })

  it('matches a row holding the one member named, and searches by its members', async () => {
    const db = await withRecipes()
    write(db, [
      { name: 'Lentil soup', tags: ['vegan', 'one pot'] },
      { name: 'Toast', tags: ['quick', 'vegan'] },
      { name: 'Steak', tags: ['quick'] },
      { name: 'Water' },
    ])
    const by = (value: string | null): readonly string[] => {
      const column = RECIPE.columns.find((each) => each.name === 'tags')
      if (column === undefined) throw new Error('no tags')
      const member = value === null ? { ok: true as const, value: null } : coerceMatch(column, value)
      if (!member.ok) throw new Error(member.error)
      return listRows(db, RECIPE, { match: new Map([['tags', member.value]]), order: 'name' }).map((row) => String(row.cells['name']))
    }
    expect(by('Vegan')).toEqual(['Lentil soup', 'Toast'])
    expect(by('quick')).toEqual(['Steak', 'Toast'])
    expect(by(null)).toEqual(['Water'])
    expect(listRows(db, RECIPE, { search: 'one p' }).map((row) => row.cells['name'])).toEqual(['Lentil soup'])

    const column = RECIPE.columns.find((each) => each.name === 'tags')
    if (column === undefined) throw new Error('no tags')
    const off = coerceMatch(column, 'spicy')
    expect(off.ok ? '' : off.error).toContain('"spicy"')
  })

  it('replaces the whole list on an edit, and takes a deleted row’s members with it', async () => {
    const db = await withRecipes()
    const [id = ''] = write(db, [{ name: 'Toast', tags: ['quick', 'vegan'] }])
    const edit = coerceEdit(RECIPE, { tags: ['freezes'] })
    if (!edit.ok) throw new Error(edit.error)
    updateRow(db, RECIPE, id, edit.value)
    expect(tagsOf(db, id)).toEqual(['freezes'])
    const rename = coerceEdit(RECIPE, { name: 'Frozen toast' })
    if (!rename.ok) throw new Error(rename.error)
    updateRow(db, RECIPE, id, rename.value)
    expect(tagsOf(db, id)).toEqual(['freezes'])

    deleteRows(db, RECIPE, [id], listFormats(db))
    expect(query(db, `SELECT COUNT(*) AS n FROM "fmt_recipe__tags"`)[0]?.['n']).toBe(0)
  })

  it('round-trips through text as a JSON list, a member holding a comma included', async () => {
    const commas = recipeWith('vegan, quick')
    const db = await createDatabase()
    expect(adoptFormat(db, commas, NOW).refusals).toEqual([])
    write(db, [{ name: 'Toast', tags: ['quick', 'vegan'] }, { name: 'Water' }])
    const parts = serializeDocument(db)
    if (!parts.ok) throw new Error(parts.error)
    const text = parts.value.map((part) => part.text).join('\n')
    expect(text).toContain('tags: ["quick","vegan"]')

    const again = await createDatabase()
    const applied = applyParts(again, parts.value, NOW)
    if (!applied.ok) throw new Error(applied.error)
    const toast = listRows(again, RECIPE).find((row) => row.cells['name'] === 'Toast')
    expect(toast?.cells['tags']).toEqual(['quick', 'vegan'])
    const twice = serializeDocument(again)
    expect(twice.ok && twice.value.map((part) => part.text).join('\n')).toBe(text)
  })

  it('refuses a text document whose list holds a member off it, by line and name', async () => {
    const db = await withRecipes()
    write(db, [{ name: 'Toast', tags: ['quick'] }])
    const parts = serializeDocument(db)
    if (!parts.ok) throw new Error(parts.error)
    const edited = parts.value.map((part) => ({ ...part, text: part.text.replace('["quick"]', '["quick","spicy"]') }))
    const applied = applyParts(await createDatabase(), edited, NOW)
    expect(applied.ok ? '' : applied.error).toMatch(/Line \d+: tags has no "spicy"/)
  })

  it('is refused before language 22, cannot be required, and takes no unit', () => {
    expect(declarationProblems({ ...RECIPE, language: 21 }, []).map((each) => each.message).join(' ')).toContain(
      'format language 22',
    )
    const required = RECIPE.columns.map((each) => (each.name === 'tags' ? { ...each, required: true } : each))
    expect(declarationProblems({ ...RECIPE, columns: required }, []).length).toBeGreaterThan(0)
    const unit = RECIPE.columns.map((each) => (each.name === 'tags' ? { ...each, unit: 'g' } : each))
    expect(declarationProblems({ ...RECIPE, columns: unit }, []).length).toBeGreaterThan(0)
    const none = RECIPE.columns.map((each) => (each.name === 'tags' ? { ...each, values: [] } : each))
    expect(declarationProblems({ ...RECIPE, columns: none }, []).map((each) => each.message).join(' ')).toContain(
      'names no values',
    )
  })

  it('rebuilds an empty list under a new CHECK, and refuses to change one that holds members', async () => {
    const db = await withRecipes()
    const grown = recipeWith('vegan, quick, freezes, one pot, spicy')
    expect(adoptFormat(db, grown, NOW).refusals).toEqual([])
    const sql = String(query(db, `SELECT sql FROM sqlite_master WHERE name = 'fmt_recipe__tags'`)[0]?.['sql'])
    expect(sql).toContain(`'spicy'`)

    insertRows(db, grown, [{ name: 'Curry', tags: ['spicy'] }])
    // A list re-declared over members it holds is refused as an enum's is.
    const back = adoptFormat(db, RECIPE, NOW).refusals
    expect(back.map((each) => [each.column, each.reason])).toEqual([['tags', 'CONSTRAINT_CHANGED']])
    expect(listRows(db, grown).map((row) => row.cells['tags'])).toEqual([['spicy']])
  })

  it('refuses to drop a column holding members, and drops an empty one’s table', async () => {
    const db = await withRecipes()
    const without: FormatDeclaration = { ...RECIPE, columns: RECIPE.columns.filter((each) => each.name !== 'tags') }
    write(db, [{ name: 'Toast', tags: ['quick'] }])
    expect(adoptFormat(db, without, NOW).refusals.map((each) => each.reason)).toEqual(['DROP_WITH_DATA'])
    const empty = await withRecipes()
    expect(adoptFormat(empty, without, NOW).refusals).toEqual([])
    expect(query(empty, `SELECT name FROM sqlite_master WHERE name = 'fmt_recipe__tags'`)).toEqual([])
  })

  it('is looked over by the audit like any other column', async () => {
    const db = await withRecipes()
    write(db, [
      { name: 'Toast', tags: ['quick'] },
      { name: 'Steak', tags: ['quick'] },
    ])
    const audit = auditFormat(db, RECIPE, indexOf(listFormats(db)))
    expect(audit.rows).toBe(2)
    expect(audit.findings).toEqual([])
  })
})

/* --------------------------------------------------------------- a reading */

function text(value: string): ReadCell {
  return value === '' ? { kind: 'empty', text: '' } : { kind: 'text', text: value }
}

const SHEET: ReadTable = {
  columnCount: 2,
  rows: [
    [text('Name'), text('Tags')],
    [text('Lentil soup'), text('Vegan; one pot')],
    [text('Toast'), text('quick;;vegan ;')],
    [text('Curry'), text('vegan; spicy')],
    [text(''), text('')],
    [text('Water'), text('')],
  ],
}

const READING: Reading = {
  format: 'recipe',
  headerRow: 0,
  dateOrder: 'dmy',
  columns: [
    { index: 0, key: 'name' },
    { index: 1, key: 'tags', separator: ';' },
  ],
  fixed: [],
}

describe('reading a cell of several members (M34 U5, D-398)', () => {
  it('splits a cell by the separator the mapping states, and refuses a line naming a member off the list', () => {
    expect(readingProblems(RECIPE, READING, SHEET)).toEqual([])
    const result = readRows(RECIPE, READING, SHEET)
    expect(result.rows.map((row) => row.cells?.['tags'] ?? row.problem)).toEqual([
      ['vegan', 'one pot'],
      ['quick', 'vegan'],
      'tags has no "spicy" on its list; it is any of vegan, quick, freezes, one pot.',
      [],
    ])
    // Every line accounted for: the heading, three read, one refused, one empty.
    const tally = lineTally(SHEET, READING, result)
    expect(tally).toMatchObject({ lines: 6, heading: 1, read: 3, refused: 1, empty: 1 })
    expect(tallyAccounts(tally)).toBe(true)
  })

  it('reads a cell as one member when no separator is stated, rather than guessing one', () => {
    const plain: Reading = { ...READING, columns: [{ index: 0, key: 'name' }, { index: 1, key: 'tags' }] }
    const [first] = readRows(RECIPE, plain, SHEET).rows
    expect(first?.problem).toContain('"Vegan; one pot"')
  })

  it('refuses a separator on a column that is not several of a list', () => {
    const wrong: Reading = { ...READING, columns: [{ index: 0, key: 'name', separator: ',' }, { index: 1, key: 'tags' }] }
    expect(readingProblems(RECIPE, wrong, SHEET).map((each) => each.key)).toEqual(['name'])
  })

  it('keeps the separator with the reader, so a file read again splits the same way', async () => {
    const db = await withRecipes()
    const rows = readRows(RECIPE, READING, SHEET).rows.flatMap((row) => (row.cells === undefined ? [] : [row.cells]))
    recordIntake(db, {
      declaration: RECIPE,
      reading: READING,
      fileName: 'recipes.csv',
      fileHash: 'hash',
      signature: 'name|tags',
      rows,
      now: NOW,
    })
    expect(listIntakes(db, 'recipe')[0]?.reading.columns).toEqual(READING.columns)
    expect(listRows(db, RECIPE, { order: 'name' }).map((row) => row.cells['tags'])).toEqual([
      ['vegan', 'one pot'],
      ['quick', 'vegan'],
      [],
    ])
  })
})
