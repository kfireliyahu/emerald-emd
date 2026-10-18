/**
 * **Readers, and picking one by fit** — M26 U5.
 *
 * What these hold: a reader is a format's readings grouped by header, the
 * newest standing for each; a file is read by the reader whose header it has,
 * wherever its preamble puts that header; a reader whose header is mostly there
 * is named and never used; and a reader the format has outgrown does not fit.
 */

import { describe, expect, it } from 'vitest'

import { column, type FormatDeclaration } from './declaration.ts'
import { fitReader, readerId, readerName, readersOf, type AcceptedReading } from './reader.ts'
import {
  readingHeaderCells,
  readingSignature,
  type ReadCell,
  type ReadTable,
  type Reading,
} from './reading.ts'

const LINE: FormatDeclaration = {
  language: 4,
  name: 'pantry_line',
  title: 'Pantry line',
  notes: '',
  columns: [
    column('name', 'text', { required: true }),
    column('grams', 'real', { unit: 'g' }),
    column('shelf', 'text'),
  ],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

function text(value: string): ReadCell {
  return value === '' ? { kind: 'empty', text: '' } : { kind: 'text', text: value }
}

function sheet(header: readonly string[], preamble = 0): ReadTable {
  const values: Readonly<Record<string, string>> = { name: 'Pasta', grams: '1200', shelf: 'top' }
  const rows: ReadCell[][] = [
    ...Array.from({ length: preamble }, () => [text('Exported 2026-09-01'), text('')]),
    header.map(text),
    header.map((each) => text(values[each] ?? 'x')),
  ]
  return { rows, columnCount: header.length }
}

function reading(columns: Reading['columns'], headerRow = 0): Reading {
  return { format: 'pantry_line', headerRow, dateOrder: 'dmy', columns, fixed: [] }
}

const CARD = reading([
  { index: 0, key: 'name' },
  { index: 1, key: 'grams' },
])

function accepted(table: ReadTable, read: Reading, fileName: string, readAt: number): AcceptedReading {
  return {
    signature: readingSignature(table, read.headerRow),
    reading: read,
    headerCells: readingHeaderCells(table, read.headerRow),
    fileName,
    readAt,
  }
}

describe('the readers a format has', () => {
  it('groups readings by header, the newest standing for each', () => {
    const one = sheet(['name', 'grams'])
    const other = sheet(['item', 'weight', 'shelf'])
    const readers = readersOf([
      accepted(one, CARD, 'card-07.xlsx', 1),
      accepted(other, CARD, 'bank.csv', 2),
      accepted(one, CARD, 'card-08.xlsx', 3),
    ])

    expect(readers.map(readerName)).toEqual(['card-08.xlsx', 'bank.csv'])
    expect(readers[0]?.files).toEqual(['card-08.xlsx', 'card-07.xlsx'])
  })

  it('is named by the name a person gave it, and by its last file until then (M26 F1)', () => {
    const one = sheet(['name', 'grams'])
    const signature = readingSignature(one, 0)
    const readers = readersOf([accepted(one, CARD, 'card-08.xlsx', 1)], new Map([[signature, 'The card']]))
    expect(readers.map(readerName)).toEqual(['The card'])
    expect(readerId(readers[0] ?? { signature: '' })).toMatch(/^[0-9a-f]{8}$/)
    expect(readerId({ signature })).toBe(readerId({ signature }))
  })
})

describe('picking a reader by fit', () => {
  const card = sheet(['name', 'grams'])
  const readers = readersOf([accepted(card, CARD, 'card-08.xlsx', 1)])

  it('reads a file with the same header with the reader made for it', () => {
    const fit = fitReader(LINE, readers, sheet(['name', 'grams']))
    expect(fit.kind).toBe('FITS')
  })

  it('finds the header where this file put it, when its preamble is longer', () => {
    const fit = fitReader(LINE, readers, sheet(['name', 'grams'], 2))
    expect(fit.kind === 'FITS' && fit.reading.headerRow).toBe(2)
  })

  it('names a reader that nearly fits, and does not use it', () => {
    const fit = fitReader(LINE, readers, sheet(['name', 'grams', 'shelf']))
    expect(fit.kind).toBe('CLOSE')
    expect(fit.kind === 'CLOSE' && readerName(fit.reader)).toBe('card-08.xlsx')
  })

  it('says nothing fits when nothing is close', () => {
    expect(fitReader(LINE, readers, sheet(['when', 'amount'])).kind).toBe('NONE')
    expect(fitReader(LINE, [], card).kind).toBe('NONE')
  })

  it('does not fit a reader the format has outgrown', () => {
    const shrunk: FormatDeclaration = { ...LINE, columns: [column('name', 'text', { required: true })] }
    expect(fitReader(shrunk, readers, sheet(['name', 'grams'])).kind).toBe('CLOSE')
  })

  it('takes the newest of two readers for one header', () => {
    const swapped = reading([
      { index: 1, key: 'name' },
      { index: 0, key: 'grams' },
    ])
    const both = readersOf([
      accepted(card, CARD, 'old.xlsx', 1),
      accepted(card, swapped, 'new.xlsx', 2),
    ])
    const fit = fitReader(LINE, both, card)
    expect(fit.kind === 'FITS' && fit.reading.columns).toEqual(swapped.columns)
  })

  it('follows a column that moved by its header, rather than reading the old position (M26 F1)', () => {
    const fit = fitReader(LINE, readers, sheet(['grams', 'name']))
    expect(fit.kind).toBe('FITS')
    expect(fit.kind === 'FITS' && fit.moved).toBe(true)
    expect(fit.kind === 'FITS' && fit.reading.columns).toEqual([
      { index: 1, key: 'name' },
      { index: 0, key: 'grams' },
    ])
  })

  it('says nothing moved when nothing did', () => {
    const fit = fitReader(LINE, readers, sheet(['name', 'grams']))
    expect(fit.kind === 'FITS' && fit.moved).toBe(false)
  })

  it('refuses a reordered file whose moved column has no name of its own to follow', () => {
    // Two columns called `name`: which one went where cannot be told.
    const twice = sheet(['name', 'grams', 'name'])
    const own = readersOf([accepted(twice, CARD, 'twice.csv', 1)])
    const fit = fitReader(LINE, own, sheet(['grams', 'name', 'name']))
    expect(fit.kind).toBe('CLOSE')
    expect(fit.kind === 'CLOSE' && fit.why).toBe('MOVED')
  })

  it('will not vouch for a reader made before the order was kept', () => {
    const old = readersOf([{ ...accepted(card, CARD, 'old.xlsx', 1), headerCells: undefined }])
    const fit = fitReader(LINE, old, sheet(['name', 'grams']))
    expect(fit.kind).toBe('CLOSE')
    expect(fit.kind === 'CLOSE' && fit.why).toBe('UNORDERED')
  })
})
