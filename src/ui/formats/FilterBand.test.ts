import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { Database } from 'sql.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { filterQuery } from '@/data/repositories/formatFilterRepository.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import { countRows } from '@/data/repositories/formatRowRepository.ts'
import { openEncoded } from '@/data/storage/encoding.ts'

import { addressFilter } from './addressFilter.ts'
import { columnValues } from '@/data/repositories/formatValuesRepository.ts'
import { column, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { figureRangeSaid, parseFigureRange } from '@/domain/format/figureRange.ts'
import type { StoredRow } from '@/domain/format/row.ts'

import { valueText } from './entryList.ts'
import { amountAsWritten } from './FilterBand.tsx'

describe('a date and an amount read one way on every surface (M55 U7)', () => {
  it('says a money range in the band as the table writes money, and a quantity as before', () => {
    const range = parseFigureRange('..50 ILS')!
    expect(figureRangeSaid(range, amountAsWritten)).toBe('at most ₪50.00')
    expect(figureRangeSaid(parseFigureRange('10..60 ILS')!, amountAsWritten)).toBe('₪10.00 to ₪60.00')
    expect(figureRangeSaid(parseFigureRange('10..50 g')!)).toBe('10 to 50 g')
    // A figure that is no amount of the currency is said as typed, never dropped.
    expect(amountAsWritten('lots', 'ILS')).toBe('lots ILS')
  })

  it('writes a date and a month on a block and in a list as the table does', () => {
    const row = { id: 'r', cells: { landed: '2026-07-27', month: '2026-09' } } as unknown as StoredRow
    const format: Pick<FormatDeclaration, 'columns'> = { columns: [column('landed', 'date'), column('month', 'month')] }
    expect(valueText(format.columns[0]!, row, new Map())).toBe('2026-07-27')
    expect(valueText(format.columns[1]!, row, new Map())).toBe('2026-09')
  })
})

const MEMORY = fileURLToPath(new URL('../../../docs/memory.emd', import.meta.url))

describe('holding a column to a value on the format screen (M44 U7)', () => {
  let db: Database
  beforeAll(async () => {
    db = (await openEncoded(readFileSync(MEMORY))).db
  })
  afterAll(() => db.close())

  const format = (name: string) => {
    const found = listFormats(db).find((each) => each.name === name)
    if (found === undefined) throw new Error(`docs/memory.emd declares ${name}`)
    return found
  }

  it('offers an enum its members, and a link the names of the rows it holds — names the filter resolves', () => {
    const declarations = listFormats(db)
    const unit = format('unit')
    const state = unit.columns.find((each) => each.name === 'state')
    const milestone = unit.columns.find((each) => each.name === 'milestone')
    if (state === undefined || milestone === undefined) throw new Error('unit has state and milestone')
    const listed = (name: string): readonly string[] => {
      const found = columnValues(db, unit, name, {}, declarations)
      return found.ok && found.value.kind === 'VALUES' ? found.value.values.map((each) => each.value) : []
    }
    // Every member, in declared order, counted in SQL since M37 U4.
    expect(listed(state.name)).toEqual(state.values)
    const named = listed(milestone.name)
    expect(named).toContain('M44')
    // A picked name finds the same rows its id would.
    const read = filterQuery(db, unit, { match: { milestone: 'M44' } }, declarations)
    expect(read.ok && countRows(db, unit, read.value)).toBeGreaterThan(0)
  })

  it('reads the address the screen writes into the rows format_rows returns', () => {
    const declarations = listFormats(db)
    const finding = format('finding')
    const filter = addressFilter('?action=maintainer&state=open')
    const read = filterQuery(db, finding, filter, declarations)
    if (!read.ok) throw new Error('the filter reads')
    const direct = filterQuery(db, finding, { match: { action: 'maintainer', state: 'open' } }, declarations)
    if (!direct.ok) throw new Error('the filter reads')
    expect(countRows(db, finding, read.value)).toBe(countRows(db, finding, direct.value))
  })
})
