/**
 * **A column held to several values, or turned round** (M37 U3, D-476): one
 * reading, `filterQuery`, compiled to one `IN` — any of a list, none of it with
 * an empty cell let through (D-380), the empty cell as `null` alone or among
 * several — over a text column, an enum, a list column and a link by its name.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { Database } from 'sql.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { read } from '@/domain/format/artefact.ts'
import { coerceRow } from '@/domain/format/row.ts'
import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import { openEncoded } from '@/data/storage/encoding.ts'
import { createDatabase } from '../db/database.ts'
import { filterQuery, filterText, type RowFilter } from './formatFilterRepository.ts'
import { adoptFormat, listFormats } from './formatRepository.ts'
import { countRows, insertRows, listRows } from './formatRowRepository.ts'

const NOW = Date.UTC(2026, 9, 14)

function declared(text: string): FormatDeclaration {
  const result = read(text)
  if (!result.ok) throw new Error(result.error)
  return result.value
}

const RECIPE = declared(`---
format: recipe
title: Recipe
language: 22
checks: none
---

A dish, and what it is.

| column | type | points at | unit | per | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| name | text |  |  |  | yes | yes |  |  |  | Its name. |
| course | enum |  |  |  | no | no | starter, main, dessert |  |  | Where it comes. |
| cook | text |  |  |  | no | no |  |  |  | Who makes it. |
| tags | enums |  |  |  | no | no | vegan, quick, one pot |  |  | What kind of dish. |
`)

async function recipes(): Promise<Database> {
  const db = await createDatabase()
  expect(adoptFormat(db, RECIPE, NOW).refusals).toEqual([])
  const rows = [
    { name: 'Lentil soup', course: 'starter', cook: 'Ann', tags: ['vegan', 'one pot'] },
    { name: 'Toast', course: 'starter', cook: 'ann', tags: ['quick'] },
    { name: 'Steak', course: 'main', cook: 'Ben', tags: ['quick'] },
    { name: 'Water' },
    { name: 'Cake', course: 'dessert', cook: 'Cy' },
  ].map((offered) => {
    const coerced = coerceRow(RECIPE, offered)
    if (!coerced.ok) throw new Error(coerced.error)
    return coerced.value
  })
  insertRows(db, RECIPE, rows)
  return db
}

function names(db: Database, filter: RowFilter): readonly string[] {
  const asked = filterQuery(db, RECIPE, filter, [RECIPE])
  if (!asked.ok) throw new Error(JSON.stringify(asked.error))
  return listRows(db, RECIPE, { ...asked.value, order: 'name' }).map((row) => String(row.cells['name']))
}

describe('a column held to several values, or none of them (M37 U3, D-476)', () => {
  it('holds an enum to any of a list, and one value as it always did', async () => {
    const db = await recipes()
    expect(names(db, { match: { course: ['starter', 'Main'] } })).toEqual(['Lentil soup', 'Steak', 'Toast'])
    expect(names(db, { match: { course: ['starter'] } })).toEqual(names(db, { match: { course: 'starter' } }))
  })

  it('turns round with not, and an empty cell passes it as D-380 says', async () => {
    const db = await recipes()
    expect(names(db, { match: { course: { not: 'starter' } } })).toEqual(['Cake', 'Steak', 'Water'])
    expect(names(db, { match: { course: { not: ['starter', 'main'] } } })).toEqual(['Cake', 'Water'])
    // Text is folded, as `match` compares it.
    expect(names(db, { match: { cook: { not: 'ANN' } } })).toEqual(['Cake', 'Steak', 'Water'])
  })

  it('says is empty with null, alone or among several, and is not empty turned round', async () => {
    const db = await recipes()
    expect(names(db, { match: { course: null } })).toEqual(['Water'])
    expect(names(db, { match: { course: ['dessert', null] } })).toEqual(['Cake', 'Water'])
    expect(names(db, { match: { course: { not: null } } })).toEqual(['Cake', 'Lentil soup', 'Steak', 'Toast'])
    expect(names(db, { match: { course: { not: ['starter', ''] } } })).toEqual(['Cake', 'Steak'])
  })

  it('holds a list column to any member ticked, and not to none of them', async () => {
    const db = await recipes()
    expect(names(db, { match: { tags: ['vegan', 'quick'] } })).toEqual(['Lentil soup', 'Steak', 'Toast'])
    expect(names(db, { match: { tags: { not: ['quick'] } } })).toEqual(['Cake', 'Lentil soup', 'Water'])
    expect(names(db, { match: { tags: ['one pot', null] } })).toEqual(['Cake', 'Lentil soup', 'Water'])
    expect(names(db, { match: { tags: { not: null } } })).toEqual(['Lentil soup', 'Steak', 'Toast'])
  })

  it('refuses a list with nothing in it, and a value the column has not got among several', async () => {
    const db = await recipes()
    const empty = filterQuery(db, RECIPE, { match: { course: [] } }, [RECIPE])
    expect(empty.ok).toBe(false)
    const off = filterQuery(db, RECIPE, { match: { course: ['starter', 'brunch'] } }, [RECIPE])
    expect(!off.ok && off.error.kind === 'REFUSED' && off.error.reason).toContain('brunch')
  })

  it('says it in a declared filter’s words', () => {
    expect(filterText({ match: { state: ['planned', 'in_progress'] } })).toBe('state is one of planned, in_progress')
    expect(filterText({ match: { state: { not: 'built' } } })).toBe('state is not built')
    expect(filterText({ match: { owner: { not: null } } })).toBe('owner is not empty')
    expect(filterText({ match: { state: 'open' } })).toBe('state = open')
  })
})

describe('on the project’s own memory', () => {
  let db: Database
  beforeAll(async () => {
    db = (await openEncoded(readFileSync(fileURLToPath(new URL('../../../docs/memory.emd', import.meta.url))))).db
  })
  afterAll(() => db.close())

  it('finds planned or in progress as the two asked apart, and not built as the rest', () => {
    const declarations = listFormats(db)
    const unit = declarations.find((each) => each.name === 'unit')
    if (unit === undefined) throw new Error('docs/memory.emd declares unit')
    const count = (filter: RowFilter): number => {
      const asked = filterQuery(db, unit, filter, declarations)
      if (!asked.ok) throw new Error(JSON.stringify(asked.error))
      return countRows(db, unit, asked.value)
    }
    const planned = count({ match: { state: 'planned' } })
    const going = count({ match: { state: 'in_progress' } })
    expect(count({ match: { state: ['planned', 'in_progress'] } })).toBe(planned + going)
    expect(count({ match: { state: { not: 'built' } } })).toBe(countRows(db, unit) - count({ match: { state: 'built' } }))
    // A link by its rows' names, several of them.
    const m44 = count({ match: { milestone: 'M44' } })
    const m37 = count({ match: { milestone: 'M37' } })
    expect(m44).toBeGreaterThan(0)
    expect(count({ match: { milestone: ['M44', 'M37'] } })).toBe(m44 + m37)
  })
})
