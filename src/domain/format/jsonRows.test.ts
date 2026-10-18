import { describe, expect, it } from 'vitest'

import { isJsonFileName, jsonRowsTables } from './jsonRows.ts'

describe('a .json file of rows (M48 U2)', () => {
  it('reads an array of objects as one table, its keys in the order the rows first use them', () => {
    const read = jsonRowsTables('﻿[{"name":"Algebra","credits":5},{"name":"Physics","online":true,"credits":null}]')
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.tables).toHaveLength(1)
    const table = read.tables[0]?.table
    expect(read.tables[0]?.name).toBe('')
    expect(table?.rows.map((row) => row.map((cell) => cell.kind))).toEqual([
      ['text', 'text', 'text'],
      ['text', 'number', 'empty'],
      ['text', 'empty', 'boolean'],
    ])
    expect(table?.rows[0]?.map((cell) => cell.text)).toEqual(['name', 'credits', 'online'])
    expect(table?.separators).toBeUndefined()
  })

  it('keeps a list a list, split by what joined it, and an object its JSON text', () => {
    const read = jsonRowsTables(JSON.stringify([{ tags: ['lab', 'evening'], meta: { room: 4 } }, { tags: [], meta: null }]))
    if (!read.ok) throw new Error(read.reason)
    const table = read.tables[0]?.table
    expect(table?.rows[1]?.map((cell) => cell.text)).toEqual(['lab; evening', '{"room":4}'])
    expect(table?.rows[2]?.map((cell) => cell.kind)).toEqual(['empty', 'empty'])
    expect(table?.separators).toEqual([';', undefined])
  })

  it('reads each array of objects an object holds as a table named by its key', () => {
    const read = jsonRowsTables(JSON.stringify({ exported: 'today', terms: [{ name: 'Autumn' }], empty: [], ids: [1, 2], rows: [{ a: 1 }] }))
    if (!read.ok) throw new Error(read.reason)
    expect(read.tables.map((each) => each.name)).toEqual(['terms', 'rows'])
  })

  it('refuses what is not rows, saying why', () => {
    const reasons = ['not json', '[]', '[{"a":1}, 2]', '{"a": 1}', '"text"'].map((text) => {
      const read = jsonRowsTables(text)
      return read.ok ? 'read' : read.reason
    })
    expect(reasons[0]).toMatch(/^it is not JSON/)
    expect(reasons[1]).toMatch(/its array is empty/)
    expect(reasons[2]).toMatch(/item 1 of its array is not an object/)
    expect(reasons[3]).toMatch(/no key of its object holds an array of objects/)
    expect(reasons[4]).toMatch(/it holds a single value/)
  })

  it('knows a .json file by its name', () => {
    expect([isJsonFileName('rows.json'), isJsonFileName('ROWS.JSON'), isJsonFileName('rows.jsonl'), isJsonFileName('rows.csv')]).toEqual([
      true,
      true,
      false,
      false,
    ])
  })
})
