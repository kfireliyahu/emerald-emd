import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import type { DraftMapping } from '@/domain/model/importing.ts'
import { allParsed, applyMapping } from './apply.ts'
import { guessMapping } from './guess.ts'
import {
  compareSignatures,
  computeHeaderSignature,
  diffHeaders,
  fitMapping,
  headerCellsFromSignature,
  headerCellsOf,
  matchSavedMapping,
} from './signature.ts'
import { readWorkbook, type SheetCell, type SheetTable } from './sheetTable.ts'

const FIXTURE = fileURLToPath(new URL('../../../fixtures/synthetic/typed-cells.xlsx', import.meta.url))

function sheet(): SheetTable {
  const found = readWorkbook('typed-cells.xlsx', new Uint8Array(readFileSync(FIXTURE))).sheets[0]
  if (found === undefined) throw new Error('fixture has no sheets')
  return found
}

/** A grid of strings. `''` becomes an empty cell, the way a blank column reads. */
function tableOf(name: string, rows: readonly (readonly string[])[]): SheetTable {
  const columnCount = Math.max(0, ...rows.map((row) => row.length))
  return {
    name,
    columnCount,
    rows: rows.map((row) =>
      Array.from({ length: columnCount }, (_, index): SheetCell => {
        const value = row[index] ?? ''
        return value === '' ? { kind: 'empty', text: '' } : { kind: 'string', text: value, value }
      }),
    ),
  }
}

function signatureOf(headers: readonly string[]): string {
  return computeHeaderSignature(tableOf('s', [headers]), 0)
}

const MAX_HEADERS = [
  'תאריך עסקה',
  'שם בית העסק',
  'קטגוריה',
  '4 ספרות אחרונות של כרטיס האשראי',
  'סוג עסקה',
  'סכום חיוב',
  'מטבע חיוב',
]

describe('computeHeaderSignature', () => {
  it('normalizes away the line break Cal puts inside its header cells', () => {
    // `תאריך\r\nעסקה` and `תאריך עסקה` are the same column. A signature that
    // disagreed would fail to recognise a Cal file on its second import.
    expect(signatureOf(['תאריך\r\nעסקה', 'סכום\r\nחיוב'])).toBe(signatureOf(['תאריך עסקה', 'סכום חיוב']))
  })

  it('ignores trailing blank columns, which belong to the sheet not the format', () => {
    expect(signatureOf([...MAX_HEADERS, '', ''])).toBe(signatureOf(MAX_HEADERS))
  })

  it('does not ignore a blank column between two real ones', () => {
    expect(signatureOf(['date', '', 'amount'])).not.toBe(signatureOf(['date', 'amount']))
  })

  it('is stable across two reads of the same file', () => {
    expect(computeHeaderSignature(sheet(), 8)).toBe(computeHeaderSignature(sheet(), 8))
  })

  it('round-trips its cells, which is what a close comparison needs', () => {
    expect(headerCellsFromSignature(signatureOf(MAX_HEADERS))).toEqual(
      headerCellsOf(tableOf('s', [MAX_HEADERS]), 0),
    )
  })

  it('refuses a signature it did not write', () => {
    expect(headerCellsFromSignature('date,amount,merchant')).toBeUndefined()
  })
})

describe('compareSignatures', () => {
  it('calls an identical header exact', () => {
    expect(compareSignatures(signatureOf(MAX_HEADERS), signatureOf(MAX_HEADERS)).kind).toBe('exact')
  })

  it('calls one renamed column a close match, and names the column', () => {
    const renamed = [...MAX_HEADERS]
    renamed[2] = 'ענף'

    const comparison = compareSignatures(signatureOf(MAX_HEADERS), signatureOf(renamed))
    expect(comparison.kind).toBe('close')
    if (comparison.kind !== 'close') return
    expect([...comparison.changedColumns]).toEqual([2])
    expect([...comparison.droppedColumns]).toEqual([2])
  })

  it('reports an inserted column as one change, not as everything after it', () => {
    // The reason the comparison aligns rather than diffing position by position.
    // A column-by-column diff calls this five changes and highlights the whole
    // right-hand side of the grid.
    const withExtra = [...MAX_HEADERS]
    withExtra.splice(2, 0, 'עמלה')

    const comparison = compareSignatures(signatureOf(MAX_HEADERS), signatureOf(withExtra))
    expect(comparison.kind).toBe('close')
    if (comparison.kind !== 'close') return
    expect([...comparison.changedColumns]).toEqual([2])
    expect(comparison.droppedColumns.size).toBe(0)
    // And every column after the insert is known to have moved one to the right.
    expect(comparison.currentForSaved.get(2)).toBe(3)
    expect(comparison.currentForSaved.get(6)).toBe(7)
  })

  it('calls an unrelated format no match at all', () => {
    expect(compareSignatures(signatureOf(MAX_HEADERS), signatureOf(['a', 'b', 'c', 'd'])).kind).toBe(
      'none',
    )
  })

  it('does not call two narrow CSVs that share a column or two the same format', () => {
    // Two out of three is 67%, which is high enough to look convincing and low
    // enough to be a coincidence. Handing over someone else's mapping here
    // would silently re-role the columns of an unrelated file.
    const comparison = compareSignatures(
      signatureOf(['date', 'amount', 'merchant']),
      signatureOf(['date', 'amount', 'description']),
    )
    expect(comparison.kind).toBe('none')
  })

  it('treats blank columns as nothing in common', () => {
    expect(diffHeaders(['', '', ''], ['', '', '']).currentForSaved.size).toBe(0)
  })
})

describe('matchSavedMapping', () => {
  const table = sheet()

  function saved(): { headerSignature: string; mapping: DraftMapping; id: string; name: string } {
    const mapping = guessMapping(table)
    if (mapping === undefined) throw new Error('fixture did not guess')
    return {
      id: 'mapping-1',
      name: 'Synthetic – Visa 1234',
      headerSignature: computeHeaderSignature(table, mapping.headerRowIndex),
      mapping,
    }
  }

  it('recognises the same file and produces a mapping that parses it identically', () => {
    const candidate = saved()
    const match = matchSavedMapping(table, [candidate])

    expect(match?.comparison.kind).toBe('exact')
    expect(match?.headerRowIndex).toBe(8)
    expect(allParsed(applyMapping(table, match?.mapping ?? candidate.mapping))).toEqual(
      allParsed(applyMapping(table, candidate.mapping)),
    )
  })

  it('finds the header where it actually is, not where it was last time', () => {
    // A provider that adds a line to its preamble has not changed its format.
    // Signing every candidate row rather than trusting the stored index is what
    // keeps that from looking like a brand-new file.
    const shifted: SheetTable = {
      ...table,
      rows: [table.rows[0] ?? [], ...table.rows],
    }

    const match = matchSavedMapping(shifted, [saved()])
    expect(match?.comparison.kind).toBe('exact')
    expect(match?.headerRowIndex).toBe(9)
    expect(match?.mapping.dataStartRowIndex).toBe(10)
  })

  it('returns nothing when no saved mapping resembles the file', () => {
    const stranger = tableOf('csv', [
      ['when', 'how much', 'who'],
      ['2026-07-01', '12.00', 'Someone'],
    ])
    expect(matchSavedMapping(stranger, [saved()])).toBeUndefined()
  })

  it('returns nothing when there is nothing saved', () => {
    expect(matchSavedMapping(table, [])).toBeUndefined()
  })

  it('prefers an exact match over a close one', () => {
    const exact = saved()
    const close = { ...saved(), id: 'mapping-2', name: 'Nearly' }
    const cells = headerCellsFromSignature(close.headerSignature) ?? []
    close.headerSignature = signatureOf([...cells.slice(0, -1), 'something else'])

    expect(matchSavedMapping(table, [close, exact])?.candidate.id).toBe('mapping-1')
  })
})

describe('fitMapping', () => {
  const table = sheet()

  it('takes the sheet name from the file, so one mapping can cover two sheets', () => {
    // Max's two sheets share a header and therefore a mapping. Keeping the
    // saved sheet name would label every row of the second sheet with the
    // first sheet's name.
    const mapping = guessMapping(table)
    if (mapping === undefined) throw new Error('fixture did not guess')

    const other: SheetTable = { ...table, name: 'עסקאות חו"ל' }
    expect(fitMapping(mapping, other, 8).sheetName).toBe('עסקאות חו"ל')
  })

  it('moves the roles with their columns when a column is inserted', () => {
    const mapping = guessMapping(table)
    if (mapping === undefined) throw new Error('fixture did not guess')

    const shift = new Map([...mapping.columnRoles.keys()].map((column) => [column, column + 1]))
    const fitted = fitMapping(mapping, table, 8, shift)

    for (const [column, role] of mapping.columnRoles) {
      expect(fitted.columnRoles.get(column + 1)).toBe(role)
    }
    expect(fitted.columnRoles.size).toBe(mapping.columnRoles.size)
  })

  it('drops a role whose column is gone rather than pointing it at a stranger', () => {
    const mapping = guessMapping(table)
    if (mapping === undefined) throw new Error('fixture did not guess')

    const fitted = fitMapping(mapping, table, 8, new Map())
    expect(fitted.columnRoles.size).toBe(0)
  })

  it('keeps the gap the user set between the header and the first data row', () => {
    const mapping: DraftMapping = {
      sheetName: 'x',
      headerRowIndex: 3,
      // A units row under the header: data starts two rows down, not one.
      dataStartRowIndex: 5,
      columnRoles: new Map(),
      amountConvention: 'POSITIVE_IS_CHARGE',
      dateOrders: new Map(),
      defaultCurrency: 'ILS',
    }
    expect(fitMapping(mapping, table, 8).dataStartRowIndex).toBe(10)
  })
})
