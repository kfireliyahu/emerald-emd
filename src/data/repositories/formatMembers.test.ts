/**
 * **A link can name several rows** (M27 U2, D-300): a `links` column, its
 * members kept in `fmt_<format>__<column>`, proved against real SQLite and
 * through the text a document is stored as.
 *
 * The two places the brief said it would break are the two tests that matter
 * most here: a name holding the separator survives the text, and a row a list
 * still names cannot be deleted out from under it.
 */

import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'

import { aggregate } from '@/domain/format/aggregate.ts'
import { read } from '@/domain/format/artefact.ts'
import { declarationProblems, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { coerceEdit, coerceRow, type StoredValue } from '@/domain/format/row.ts'
import { createDatabase, query } from '../db/database.ts'
import { applyParts, serializeDocument } from './formatDocumentRepository.ts'
import { aggregatesOf, danglingLinks, indexOf, linksByName } from './formatJoinRepository.ts'
import { adoptFormat, listFormats, orphanedTables, readFormat } from './formatRepository.ts'
import { countRows, deleteRows, LinkedRowsError, insertRows, listRows, readRow, updateRow } from './formatRowRepository.ts'

const NOW = Date.UTC(2026, 9, 1)

function declared(text: string): FormatDeclaration {
  const result = read(text)
  if (!result.ok) throw new Error(result.error)
  return result.value
}

const UNIT = declared(`---
format: unit
title: Unit
language: 14
checks: none
---

A unit of work, and the units it waits on.

| column | type | points at | unit | per | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ref | text |  |  |  | yes | yes |  |  |  | Its name. |
| blocks | links | unit |  |  | no | no |  |  |  | The units it waits on, in order. |
`)

async function withUnits(): Promise<Database> {
  const db = await createDatabase()
  const plan = adoptFormat(db, UNIT, NOW)
  expect(plan.refusals).toEqual([])
  return db
}

function cells(offered: Record<string, unknown>): Record<string, StoredValue> {
  const coerced = coerceRow(UNIT, offered)
  if (!coerced.ok) throw new Error(coerced.error)
  return coerced.value
}

/** Rows written by name, the way a conversation writes them. */
function write(db: Database, rows: readonly Record<string, unknown>[]): readonly string[] {
  const formats = indexOf(listFormats(db))
  const ids: string[] = []
  for (const row of rows) {
    const [named = {}] = linksByName(db, UNIT, [cells(row)], formats)
    expect(danglingLinks(db, UNIT, named, formats)).toEqual([])
    ids.push(...insertRows(db, UNIT, [named]))
  }
  return ids
}

function refs(db: Database, ids: StoredValue | undefined): readonly string[] {
  return (Array.isArray(ids) ? (ids as readonly string[]) : []).map((id) =>
    String(readRow(db, UNIT, id)?.cells['ref']),
  )
}

describe('a links column (M27 U2, D-300)', () => {
  it('is a table of its own, made by the reconciler, and no column of the format’s', async () => {
    const db = await withUnits()
    const tables = query(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'fmt_unit%' ORDER BY name")
    expect(tables.map((row) => row['name'])).toEqual(['fmt_unit', 'fmt_unit__blocks'])
    const columns = query(db, 'PRAGMA table_info("fmt_unit")').map((row) => row['name'])
    expect(columns).toEqual(['id', 'ref'])
    expect(orphanedTables(db)).toEqual([])
    expect(readFormat(db, 'unit')?.columns[1]?.type).toBe('links')
  })

  it('writes several members by name and reads them back in the order given', async () => {
    const db = await withUnits()
    const [, , three = ''] = write(db, [{ ref: 'U1' }, { ref: 'U2' }, { ref: 'U3', blocks: ['U2', 'U1'] }])
    expect(refs(db, readRow(db, UNIT, three)?.cells['blocks'])).toEqual(['U2', 'U1'])
    const first = listRows(db, UNIT).find((row) => row.cells['ref'] === 'U1')
    expect(first?.cells['blocks']).toEqual([])
  })

  it('refuses a member named twice, and a list that is not of names', () => {
    expect(coerceRow(UNIT, { ref: 'U1', blocks: ['U2', 'U2'] })).toMatchObject({ ok: false })
    expect(coerceRow(UNIT, { ref: 'U1', blocks: [2] })).toMatchObject({ ok: false })
  })

  it('refuses a member that names no row, by its name', async () => {
    const db = await withUnits()
    const formats = indexOf(listFormats(db))
    const [named = {}] = linksByName(db, UNIT, [cells({ ref: 'U1', blocks: ['U9'] })], formats)
    expect(danglingLinks(db, UNIT, named, formats).join(' ')).toContain('"U9"')
  })

  it('replaces the whole list on an edit, and leaves it alone on an edit that does not name it', async () => {
    const db = await withUnits()
    const [one = '', two = '', three = ''] = write(db, [{ ref: 'U1' }, { ref: 'U2' }, { ref: 'U3', blocks: ['U1'] }])
    expect(updateRow(db, UNIT, three, { blocks: [two, one] })).toBe(true)
    expect(refs(db, readRow(db, UNIT, three)?.cells['blocks'])).toEqual(['U2', 'U1'])
    const rename = coerceEdit(UNIT, { ref: 'U3b' })
    if (!rename.ok) throw new Error(rename.error)
    updateRow(db, UNIT, three, rename.value)
    expect(refs(db, readRow(db, UNIT, three)?.cells['blocks'])).toEqual(['U2', 'U1'])
    expect(updateRow(db, UNIT, three, { blocks: [] })).toBe(true)
    expect(readRow(db, UNIT, three)?.cells['blocks']).toEqual([])
  })

  it('matches a row that holds the one named, and searches by the members’ names', async () => {
    const db = await withUnits()
    const [one = ''] = write(db, [{ ref: 'U1' }, { ref: 'U2', blocks: ['U1'] }, { ref: 'U3' }])
    const holding = listRows(db, UNIT, { match: new Map([['blocks', one]]) })
    expect(holding.map((row) => row.cells['ref'])).toEqual(['U2'])
    expect(countRows(db, UNIT, { match: new Map([['blocks', null]]) })).toBe(2)
    const found = listRows(db, UNIT, { search: 'u1', formats: listFormats(db) })
    expect(found.map((row) => row.cells['ref']).sort()).toEqual(['U1', 'U2'])
  })

  it('refuses to delete a row a list still names, and takes a deleted row’s own list with it', async () => {
    const db = await withUnits()
    const [one = '', two = ''] = write(db, [{ ref: 'U1' }, { ref: 'U2', blocks: ['U1'] }])
    expect(() => deleteRows(db, UNIT, [one], listFormats(db))).toThrow(LinkedRowsError)
    expect(deleteRows(db, UNIT, [two], listFormats(db))).toEqual([two])
    expect(query(db, 'SELECT COUNT(*) AS n FROM "fmt_unit__blocks"')[0]?.['n']).toBe(0)
    expect(deleteRows(db, UNIT, [one], listFormats(db))).toEqual([one])
  })

  it('round-trips through text, a name holding the separator and a quote included', async () => {
    const db = await withUnits()
    write(db, [{ ref: 'U1, the first' }, { ref: 'say "two"' }, { ref: 'U3', blocks: ['say "two"', 'U1, the first'] }])
    const parts = serializeDocument(db)
    if (!parts.ok) throw new Error(parts.error)
    const text = parts.value.map((part) => part.text).join('\n')
    expect(text).toContain('blocks: ["say \\"two\\"","U1, the first"]')

    const again = await createDatabase()
    const applied = applyParts(again, parts.value, NOW)
    if (!applied.ok) throw new Error(applied.error)
    const three = listRows(again, UNIT).find((row) => row.cells['ref'] === 'U3')
    expect(refs(again, three?.cells['blocks'])).toEqual(['say "two"', 'U1, the first'])
    const twice = serializeDocument(again)
    expect(twice.ok && twice.value.map((part) => part.text).join('\n')).toBe(text)
  })

  it('may be folded over by an aggregate, and may not be read through by an expression', async () => {
    const counting: FormatDeclaration = {
      ...UNIT,
      aggregates: [aggregate('blocking', 'COUNT', { format: 'unit', column: 'blocks' })],
    }
    expect(declarationProblems(counting, [])).toEqual([])
    const db = await withUnits()
    expect(adoptFormat(db, counting, NOW).refusals).toEqual([])
    const [one = ''] = write(db, [{ ref: 'U1' }, { ref: 'U2', blocks: ['U1'] }, { ref: 'U3', blocks: ['U1'] }])
    const row = readRow(db, counting, one)
    if (row === undefined) throw new Error('U1 is missing')
    const [figure] = aggregatesOf(db, counting, row, indexOf(listFormats(db)))
    expect(figure?.value).toMatchObject({ kind: 'VALUE', value: 2 })

    const reading = read(`---
format: unit
title: Unit
language: 14
---

| column | type | points at | unit | per | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ref | text |  |  |  | yes | yes |  |  |  |  |
| size | integer |  |  |  | no | no |  |  |  |  |
| blocks | links | unit |  |  | no | no |  |  |  |  |

## identities

| identity | holds | tolerance | note |
| --- | --- | --- | --- |
| through | size = blocks.size | 0 |  |
`)
    expect(reading.ok ? '' : reading.error).toContain('links several rows')
  })

  it('is refused in a declaration written in a language before 14, and cannot be required', () => {
    expect(declarationProblems({ ...UNIT, language: 13 }, []).map((each) => each.message).join(' ')).toContain(
      'format language 14',
    )
    const required = { ...UNIT, columns: UNIT.columns.map((each) => (each.type === 'links' ? { ...each, required: true } : each)) }
    expect(declarationProblems(required, []).map((each) => each.message).join(' ')).toContain('cannot be required')
  })

  it('drops an empty list’s table when the column goes, and refuses while it holds members', async () => {
    const db = await withUnits()
    const without = { ...UNIT, columns: UNIT.columns.filter((each) => each.type !== 'links') }
    write(db, [{ ref: 'U1' }, { ref: 'U2', blocks: ['U1'] }])
    expect(adoptFormat(db, without, NOW).refusals.map((each) => each.reason)).toEqual(['DROP_WITH_DATA'])

    const empty = await withUnits()
    write(empty, [{ ref: 'U1' }])
    expect(adoptFormat(empty, without, NOW).refusals).toEqual([])
    expect(query(empty, "SELECT name FROM sqlite_master WHERE name = 'fmt_unit__blocks'")).toEqual([])
  })
})
