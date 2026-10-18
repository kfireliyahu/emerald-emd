import { describe, expect, it } from 'vitest'

import type { SheetWorkbook } from '@/data/importer/sheetTable.ts'
import { batchLine, withoutFiles, type StatementBatchState } from '@/state/statementBatch.ts'

const workbook = { sheets: [] } as unknown as SheetWorkbook

describe('removing a file before Write (M28 F12)', () => {
  const layout = { kind: 'new-layout' as const, id: 'b', fileName: 'b.xlsx', workbook, fileHash: 'h' }
  const state: StatementBatchState = {
    owner: 'doc',
    files: [
      { kind: 'reading', id: 'a', fileName: 'a.csv' },
      layout,
      { kind: 'failed', id: 'c', fileName: 'c.doc', message: 'no' },
    ],
    ticks: new Map([
      ['a', false],
      ['c', true],
    ]),
    forced: new Set(['a', 'c']),
    mapping: layout,
  }

  it('takes the file out with its tick, its Write anyway and its trip to the mapper', () => {
    const next = withoutFiles(state, new Set(['a', 'b']))
    expect(next.files.map((file) => file.id)).toEqual(['c'])
    expect([...next.ticks.keys()]).toEqual(['c'])
    expect([...next.forced]).toEqual(['c'])
    expect(next.mapping).toBeUndefined()
  })

  it('leaves the rest of the batch, and the mapper, alone', () => {
    const next = withoutFiles(state, new Set(['c']))
    expect(next.files.map((file) => file.id)).toEqual(['a', 'b'])
    expect(next.mapping).toBe(layout)
    expect(state.files).toHaveLength(3)
  })
})

describe('the batch left behind, in the bottom bar (M28 F14)', () => {
  const sheet = { kind: 'failed' as const, id: 'a', fileName: 'a.xlsx', message: 'no' }
  const base: StatementBatchState = { owner: 'doc', files: [], ticks: new Map(), forced: new Set(), mapping: undefined }

  it('says nothing about an empty batch, or another document’s', () => {
    expect(batchLine(base, 'doc')).toBeUndefined()
    expect(batchLine({ ...base, files: [sheet] }, 'other')).toBeUndefined()
  })

  it('reads while a file is still reading, and counts what is done', () => {
    const line = batchLine({ ...base, files: [sheet, { kind: 'reading', id: 'b', fileName: 'b.csv' }] }, 'doc')
    expect(line).toEqual({ reading: true, title: 'Reading files', detail: '1 of 2 read' })
  })

  it('stays once the reading is over, because nothing is written until Write', () => {
    expect(batchLine({ ...base, files: [sheet] }, 'doc')).toEqual({ reading: false, title: '1 file read', detail: 'Not written yet.' })
  })

  it('steps aside while the mapper has the window', () => {
    const layout = { kind: 'new-layout' as const, id: 'b', fileName: 'b.xlsx', workbook, fileHash: 'h' }
    expect(batchLine({ ...base, files: [layout], mapping: layout }, 'doc')).toBeUndefined()
  })
})
