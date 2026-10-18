/**
 * **A column's values, counted — on screen and in a conversation alike** (M37
 * U4). A synthetic format of 500 rows: the header menu's counts
 * (`columnValues`) equal `format_rows`' `values` answer and the rows a filter
 * on each value finds; ticking two narrows exactly as U3's filter does; and the
 * other columns held narrow the counts.
 */

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Database } from 'sql.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDatabase, exportDatabase } from '@/data/db/database.ts'
import { filterQuery, type RowFilter } from '@/data/repositories/formatFilterRepository.ts'
import { adoptFormat } from '@/data/repositories/formatRepository.ts'
import { countRows, insertRows, listRows } from '@/data/repositories/formatRowRepository.ts'
import { columnValues, type ColumnValues } from '@/data/repositories/formatValuesRepository.ts'
import { read } from '@/domain/format/artefact.ts'
import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import { coerceRow } from '@/domain/format/row.ts'
import { addressFilter, filterAddress } from '@/ui/formats/addressFilter.ts'

import { formatRowsTool } from './formats.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

const NOW = Date.UTC(2026, 9, 14)

function declared(text: string, neighbours: readonly FormatDeclaration[] = []): FormatDeclaration {
  const result = read(text, undefined, neighbours)
  if (!result.ok) throw new Error(result.error)
  return result.value
}

const TEAM = declared(`---
format: team
title: Team
language: 22
checks: none
---

| column | type | points at | unit | per | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| name | text |  |  |  | yes | yes |  |  |  | Its name. |
`)

const TASK = declared(`---
format: task
title: Task
language: 22
checks: none
---

| column | type | points at | unit | per | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| name | text |  |  |  | yes | yes |  |  |  | Its name. |
| state | enum |  |  |  | no | no | planned, in_progress, built, dropped |  |  | Where it is. |
| owner | text |  |  |  | no | no |  |  |  | Who has it. |
| team | link | team |  |  | no | no |  |  |  | Whose it is. |
| tags | enums |  |  |  | no | no | urgent, small, risky |  |  | What kind. |
| cost | money |  |  |  | no | no |  |  |  | What it cost. |
| weight | quantity |  |  |  | no | no |  |  |  | What it weighs. |
| body | text |  |  |  | no | no |  |  |  | What it says. |
`, [TEAM])

const OWNERS = ['Ann', 'ann', 'Ben', 'אורי', null] as const
const STATES = ['planned', 'in_progress', 'built', null] as const
const TEAMS = ['Red', 'Blue', 'Green'] as const

let db: Database
let path: string

beforeAll(async () => {
  db = await createDatabase()
  for (const declaration of [TEAM, TASK]) expect(adoptFormat(db, declaration, NOW).refusals).toEqual([])
  insertRows(
    db,
    TEAM,
    TEAMS.map((name) => {
      const coerced = coerceRow(TEAM, { name })
      if (!coerced.ok) throw new Error(coerced.error)
      return coerced.value
    }),
  )
  const teamIds = new Map(listRows(db, TEAM).map((row) => [String(row.cells['name']), row.id]))
  const rows = Array.from({ length: 500 }, (_, at) => {
    const offered = {
      name: `task ${String(at)}`,
      state: STATES[at % STATES.length],
      owner: OWNERS[at % OWNERS.length],
      team: at % 7 === 0 ? null : teamIds.get(TEAMS[at % TEAMS.length] ?? 'Red'),
      tags: at % 3 === 0 ? [] : at % 3 === 1 ? ['urgent'] : ['urgent', 'small'],
      ...(at % 10 === 0 ? {} : { cost: (at % 50) + 0.5, cost_currency: at % 4 === 0 ? 'USD' : 'ILS' }),
      ...(at % 5 === 0 ? {} : { weight: at % 20, weight_unit: at % 2 === 0 ? 'g' : 'kg' }),
      body: at === 3 ? 'a line\nand another' : `short ${String(at % 2)}`,
    }
    const coerced = coerceRow(TASK, offered)
    if (!coerced.ok) throw new Error(coerced.error)
    return coerced.value
  })
  insertRows(db, TASK, rows)
  const directory = await tempDir('emerald-values-')
  path = join(directory, 'values.emd')
  await writeFile(path, exportDatabase(db))
})
afterAll(() => db.close())

const declarations = (): readonly FormatDeclaration[] => [TEAM, TASK]

function values(name: string, filter: RowFilter = {}): Extract<ColumnValues, { kind: 'VALUES' }> {
  const found = columnValues(db, TASK, name, filter, declarations())
  if (!found.ok || found.value.kind !== 'VALUES') throw new Error(`${name} lists values`)
  return found.value
}

function rowsFound(filter: RowFilter): number {
  const asked = filterQuery(db, TASK, filter, declarations())
  if (!asked.ok) throw new Error(JSON.stringify(asked.error))
  return countRows(db, TASK, asked.value)
}

/** `format_rows`' `values` table, read back: value to rows. */
async function toldValues(name: string, filter: RowFilter = {}): Promise<ReadonlyMap<string, number>> {
  const answer = await formatRowsTool.run({ path, format: 'task', values: name, ...filter }, NO_CLIENT)
  const told = new Map<string, number>()
  for (const line of answer.split('\n')) {
    const cells = line.split('|').map((each) => each.trim())
    if (cells.length < 4 || cells[1] === 'Value' || /^-+$/.test(cells[1] ?? '')) continue
    const value = (cells[1] ?? '').replace(/^.* \((.*)\)$/, '$1')
    told.set(value, Number((cells[2] ?? '').replace(/,/g, '')))
  }
  return told
}

describe("a column's values, counted (M37 U4)", () => {
  it('counts each value as the rows a filter on it finds, and the conversation is told the same', async () => {
    for (const name of ['state', 'owner', 'team', 'tags']) {
      const listed = values(name)
      const told = await toldValues(name)
      for (const each of listed.values) {
        expect(each.count, `${name}: ${each.value}`).toBe(rowsFound({ match: { [name]: each.value } }))
        expect(told.get(each.value), `${name}: ${each.value} told`).toBe(each.count)
      }
      expect(listed.empty, `${name}: empty`).toBe(rowsFound({ match: { [name]: null } }))
      expect(told.get('(empty)')).toBe(listed.empty)
    }
  })

  it('lists an enum in declared order, a member no row holds at zero; text folded as a match folds it', () => {
    expect(values('state').values.map((each) => [each.value, each.count])).toEqual([
      ['planned', 125],
      ['in_progress', 125],
      ['built', 125],
      ['dropped', 0],
    ])
    const owners = values('owner').values
    // `Ann` and `ann` are one value to a match, so one line with both counted.
    expect(owners.filter((each) => each.value.toLowerCase() === 'ann')).toHaveLength(1)
    expect(owners.find((each) => each.value.toLowerCase() === 'ann')?.count).toBe(200)
    expect(owners.map((each) => each.value)).toContain('אורי')
    // A link's rows by name — what the filter resolves, since team names are unique.
    expect(values('team').values.map((each) => each.value)).toEqual(['Blue', 'Green', 'Red'])
  })

  it('ticking two narrows exactly as the filter does, by the address the menu writes', () => {
    const state = values('state').values
    const ticked = { match: { state: ['planned', 'built'] } }
    const address = filterAddress(ticked)
    expect(address).toBe('?state=planned,built')
    expect(rowsFound(addressFilter(address))).toBe((state[0]?.count ?? 0) + (state[2]?.count ?? 0))
    expect(rowsFound({ match: { state: { not: ['planned', 'built'] } } })).toBe(500 - 250)
  })

  it('counts under the other columns held and the search, and sets its own hold aside', () => {
    const held: RowFilter = { match: { owner: 'Ben', state: 'planned' }, search: 'short' }
    const states = values('state', held)
    for (const each of states.values) {
      expect(each.count).toBe(rowsFound({ match: { owner: 'Ben', state: each.value }, search: 'short' }))
    }
    // Its own hold set aside: every state still has its count, not only planned.
    expect(states.values.filter((each) => each.count > 0).length).toBeGreaterThan(1)
    expect(states.rows).toBe(rowsFound({ match: { owner: 'Ben' }, search: 'short' }))
  })

  it('offers money and a quantity a range in what they are in, which the filter holds', async () => {
    const cost = columnValues(db, TASK, 'cost', {}, declarations())
    if (!cost.ok || cost.value.kind !== 'RANGE') throw new Error('cost is a range')
    expect(cost.value.units.map((each) => each.unit)).toEqual(['ILS', 'USD'])
    expect(cost.value.empty).toBe(50)
    const ils = cost.value.units[0]
    expect(ils?.least).toBe('1.50')
    expect(rowsFound({ match: { cost: '..1000 ILS' } })).toBe(ils?.count)
    // Counted again by reading every row: both ends taken, one currency or unit.
    const every = listRows(db, TASK)
    expect(rowsFound({ match: { cost: '10..20.5 ILS' } })).toBe(
      every.filter((row) => {
        const minor = Number(row.cells['cost_minor'])
        return row.cells['cost_currency'] === 'ILS' && minor >= 1000 && minor <= 2050
      }).length,
    )
    expect(rowsFound({ match: { weight: '5.. kg' } })).toBe(
      every.filter((row) => row.cells['weight_unit'] === 'kg' && Number(row.cells['weight']) >= 5).length,
    )
    // A figure without what it is in is refused, saying how to ask.
    const bare = filterQuery(db, TASK, { match: { cost: '10..20' } }, declarations())
    expect(!bare.ok && bare.error.kind === 'REFUSED' && bare.error.reason).toContain('10..50 ILS')
    const told = await formatRowsTool.run({ path, format: 'task', values: 'cost' }, NO_CLIENT)
    expect(told).toContain('| ILS |')
  })

  it('offers a column of passages search alone', async () => {
    const body = columnValues(db, TASK, 'body', {}, declarations())
    expect(body.ok && body.value.kind).toBe('PASSAGES')
    expect(await formatRowsTool.run({ path, format: 'task', values: 'body' }, NO_CLIENT)).toContain('passages')
  })
})
