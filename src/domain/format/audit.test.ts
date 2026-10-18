import { describe, expect, it } from 'vitest'

import { auditRows, lineTally, tallyAccounts, tallySentence } from './audit.ts'
import { column, type FormatDeclaration } from './declaration.ts'
import type { ReadCell, ReadTable } from './reading.ts'
import type { StoredRow } from './row.ts'

const TASK: FormatDeclaration = {
  language: 5,
  name: 'task',
  title: 'Task',
  notes: '',
  columns: [
    column('name', 'text', { required: true }),
    column('project', 'link', { target: 'project' }),
    column('parent', 'link', { target: 'task' }),
  ],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

const row = (id: string, name: string, project: string | null, parent: string | null = null): StoredRow => ({
  id,
  cells: { name, project, parent },
})

describe('auditRows (M34 U3)', () => {
  it('names a link empty where most rows fill it, and only then', () => {
    const most = auditRows(TASK, [row('a', 'A', 'p'), row('b', 'B', 'p'), row('c', 'C', null)], () => [])
    expect(most.findings).toEqual([
      { kind: 'LINK_GAP', column: 'project', target: 'project', filled: 2, empty: [{ id: 'c', name: 'C' }] },
    ])
    // Half is not most: a link usually empty says nothing.
    const half = auditRows(TASK, [row('a', 'A', 'p'), row('b', 'B', null)], () => [])
    expect(half.findings).toEqual([])
  })

  it('leaves a link into its own rows alone — a tree has top rows on purpose', () => {
    const tree = auditRows(
      TASK,
      [row('a', 'A', 'p', null), row('b', 'B', 'p', 'a'), row('c', 'C', 'p', 'a')],
      () => [],
    )
    expect(tree.findings).toEqual([])
  })

  it('names rows the same in every column, once per set', () => {
    const audit = auditRows(TASK, [row('a', 'A', 'p'), row('b', 'A', 'p'), row('c', 'C', 'p')], () => [])
    expect(audit.findings).toEqual([{ kind: 'DUPLICATE', rows: [{ id: 'a', name: 'A' }, { id: 'b', name: 'A' }] }])
  })
})

describe('lineTally (M34 U3)', () => {
  const text = (value: string): ReadCell => (value === '' ? { kind: 'empty', text: '' } : { kind: 'text', text: value })
  const table: ReadTable = {
    rows: [['Report'], ['name', 'n'], ['a', '1'], [''], ['b', 'x'], ['Total', '1']].map((cells) => cells.map(text)),
    columnCount: 2,
  }

  it('accounts for every line: heading, read, refused, empty, and a header row read from a line', () => {
    const tally = lineTally(
      table,
      {
        format: 'f',
        headerRow: 1,
        dateOrder: 'dmy',
        columns: [],
        fixed: [],
        header: { format: 'h', link: 'h', cells: [{ key: 'total', row: -1, index: 1 }], fixed: [] },
      },
      {
        rows: [
          { line: 2, offered: {}, cells: { name: 'a' }, problem: undefined },
          { line: 4, offered: {}, cells: undefined, problem: 'not a number' },
        ],
        blank: 1,
      },
    )
    expect(tally).toEqual({ lines: 6, heading: 2, header: 1, read: 1, refused: 1, empty: 1 })
    expect(tallyAccounts(tally)).toBe(true)
    expect(tallySentence(tally)).toBe('6 lines: 2 heading, 1 header row, 1 read, 1 refused, 1 empty.')
  })

  it('says so when the parts do not sum to the file', () => {
    expect(tallySentence({ lines: 5, heading: 1, header: 0, read: 2, refused: 0, empty: 0 })).toContain(
      '2 lines not accounted for.',
    )
  })
})
