/**
 * **Provenance, against real SQLite** — the half of U5 that is not arithmetic.
 *
 * `reading.test.ts` proves which cell goes to which key. These prove the three
 * things only a document can answer: that a reading a person accepted comes back
 * when the same kind of file turns up again, that re-reading the *same* file can
 * be undone to the row, and that deleting a format takes its provenance with it
 * rather than leaving a record pointing at a table that is gone.
 */

import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'

import { aggregate } from '@/domain/format/aggregate.ts'
import { column, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { identity } from '@/domain/format/identity.ts'
import {
  readHeader,
  readingSignature,
  readRows,
  stagedRows,
  type ReadCell,
  type ReadTable,
  type Reading,
} from '@/domain/format/reading.ts'
import { createDatabase } from '../db/database.ts'
import { adoptFormat, deleteFormat } from './formatRepository.ts'
import { indexOf, stagedHeaderVerdicts } from './formatJoinRepository.ts'
import { countRows, listRows } from './formatRowRepository.ts'
import {
  forgetIntakes,
  listIntakes,
  priorIntake,
  recordIntake,
  supersedeIntake,
} from './formatIntakeRepository.ts'

const NOW = Date.UTC(2026, 8, 18)

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

const SHEET: ReadTable = {
  rows: [
    [text('name'), text('grams')],
    [text('Pasta'), text('1,200')],
    [text('Salt'), text('40')],
  ],
  columnCount: 2,
}

const READING: Reading = {
  format: 'pantry_line',
  headerRow: 0,
  dateOrder: 'dmy',
  columns: [
    { index: 0, key: 'name' },
    { index: 1, key: 'grams' },
  ],
  fixed: [],
}

async function document(): Promise<Database> {
  const db = await createDatabase()
  adoptFormat(db, LINE, NOW)
  return db
}

function commit(db: Database, fileName = 'pantry.xlsx', fileHash = 'hash-1', now = NOW) {
  const read = readRows(LINE, READING, SHEET)
  return recordIntake(db, {
    declaration: LINE,
    reading: READING,
    fileName,
    fileHash,
    signature: readingSignature(SHEET, 0),
    rows: stagedRows(read).map((row) => row.cells),
    now,
  })
}

describe('committing a reading', () => {
  it('writes the rows and the record of them together', async () => {
    const db = await document()
    const intake = commit(db)

    expect(intake.rowCount).toBe(2)
    expect(countRows(db, LINE)).toBe(2)
    expect(listRows(db, LINE).map((row) => row.cells['grams']).sort()).toEqual([1200, 40])
  })

  it('remembers the reading as the person left it, fixed values included', async () => {
    const db = await document()
    const withFixed: Reading = { ...READING, fixed: [{ key: 'shelf', value: 'pantry' }] }
    recordIntake(db, {
      declaration: LINE,
      reading: withFixed,
      fileName: 'pantry.xlsx',
      fileHash: 'hash-2',
      signature: readingSignature(SHEET, 0),
      rows: [],
      now: NOW,
    })

    const [stored] = listIntakes(db, 'pantry_line')
    expect(stored?.reading.columns).toEqual(READING.columns)
    expect(stored?.reading.fixed).toEqual([{ key: 'shelf', value: 'pantry' }])
    expect(stored?.reading.dateOrder).toBe('dmy')
  })
})

describe('reading the same file twice', () => {
  it('finds what that exact file wrote before', async () => {
    const db = await document()
    const first = commit(db)

    expect(priorIntake(db, 'pantry_line', 'hash-1')?.id).toBe(first.id)
    expect(priorIntake(db, 'pantry_line', 'hash-other')).toBeUndefined()
  })

  it('supersedes it to the row, and takes the record with it', async () => {
    const db = await document()
    const first = commit(db)
    commit(db, 'pantry.xlsx', 'hash-1', NOW + 1)
    expect(countRows(db, LINE)).toBe(4)

    // Nothing is auto-deleted: this is the call a person makes, and what it
    // removes is exactly what that one file wrote.
    expect(supersedeIntake(db, first.id, LINE)).toBe(2)
    expect(countRows(db, LINE)).toBe(2)
  })

  it('keeps the reading, because removing rows is not forgetting how to read a file', async () => {
    const db = await document()
    const intake = commit(db)
    supersedeIntake(db, intake.id, LINE)

    // Nothing left to supersede, so the offer is not made again…
    expect(priorIntake(db, 'pantry_line', 'hash-1')).toBeUndefined()
    // …and the mapping is still there, which is what the person needs one click
    // later when they read the corrected file.
    expect(listIntakes(db, 'pantry_line')[0]?.reading.columns).toEqual(
      READING.columns,
    )
  })

  it('reports what actually went, not what the record once claimed', async () => {
    const db = await document()
    const intake = commit(db)
    const [row] = listRows(db, LINE)
    db.run(`DELETE FROM fmt_pantry_line WHERE id = ?`, [String(row?.id)])

    expect(supersedeIntake(db, intake.id, LINE)).toBe(1)
  })
})

describe('a format that goes', () => {
  it('takes its provenance with it', async () => {
    const db = await document()
    commit(db)

    deleteFormat(db, 'pantry_line')
    expect(listIntakes(db, 'pantry_line')).toEqual([])
    expect(
      db.exec('SELECT COUNT(*) AS n FROM format_intake_row')[0]?.values[0]?.[0],
    ).toBe(0)
  })

  it('forgets on demand without needing the table', async () => {
    const db = await document()
    commit(db)

    forgetIntakes(db, 'pantry_line')
    expect(listIntakes(db, 'pantry_line')).toEqual([])
    // The rows themselves stay: forgetting where they came from is not
    // deleting them, and nothing here is auto-deleted.
    expect(countRows(db, LINE)).toBe(2)
  })
})

describe('a reading that writes its own header row (M24 U10, D-262)', () => {
  const STATEMENT: FormatDeclaration = {
    language: 5,
    name: 'statement',
    title: 'Statement',
    notes: '',
    columns: [column('period', 'text'), column('printed_total', 'money', { required: true })],
    aggregates: [
      aggregate('lines_total', 'SUM', { format: 'charge', column: 'statement' }, { expression: 'amount' }),
    ],
    identities: [identity('adds_up', 'lines_total = printed_total')],
    nothingMustHold: false,
  }
  const CHARGE: FormatDeclaration = {
    language: 5,
    name: 'charge',
    title: 'Charge',
    notes: '',
    columns: [
      column('merchant', 'text', { required: true }),
      column('amount', 'money', { required: true }),
      column('statement', 'link', { target: 'statement', required: true }),
    ],
    identities: [],
    aggregates: [],
    nothingMustHold: true,
  }
  const formats = indexOf([STATEMENT, CHARGE])

  const sheet = (total: string): ReadTable => ({
    rows: [
      [text('Period'), text('2026-07')],
      [text('merchant'), text('amount')],
      [text('Shufersal'), text('120.50')],
      [text('Aroma'), text('32')],
      [text('Total'), text(total)],
    ],
    columnCount: 2,
  })
  const reading: Reading = {
    format: 'charge',
    headerRow: 1,
    dateOrder: 'dmy',
    columns: [
      { index: 0, key: 'merchant' },
      { index: 1, key: 'amount' },
    ],
    fixed: [{ key: 'amount_currency', value: 'ILS' }],
    header: {
      format: 'statement',
      link: 'statement',
      cells: [
        { key: 'period', row: 0, index: 1 },
        { key: 'printed_total', row: -1, index: 1 },
      ],
      fixed: [{ key: 'printed_total_currency', value: 'ILS' }],
    },
  }

  async function statementDocument(): Promise<Database> {
    const db = await createDatabase()
    expect(adoptFormat(db, STATEMENT, NOW).refusals).toEqual([])
    expect(adoptFormat(db, CHARGE, NOW).refusals).toEqual([])
    return db
  }

  function staged(total: string) {
    const table = sheet(total)
    const header = readHeader(STATEMENT, reading.header ?? { format: '', link: '', cells: [], fixed: [] }, table, 'dmy')
    const lines = stagedRows(readRows(CHARGE, reading, table))
    return { table, header, lines }
  }

  it('checks the printed total against the lines before either exists', async () => {
    const db = await statementDocument()
    for (const [total, kind] of [['152.50', 'PROVED'], ['152.60', 'FAILED']] as const) {
      const { header, lines } = staged(total)
      const verdicts = stagedHeaderVerdicts(
        db,
        { declaration: STATEMENT, row: { id: 'header', cells: header.cells ?? {} } },
        { declaration: CHARGE, link: 'statement', rows: lines },
        formats,
      )
      // Exact on money: ten agorot is a statement that does not add up.
      expect(verdicts.map((each) => each.verdict.kind)).toEqual([kind])
    }
  })

  it('writes the header first, links every line to it, and remembers where it was read from', async () => {
    const db = await statementDocument()
    const { table, header, lines } = staged('152.50')
    const intake = recordIntake(db, {
      declaration: CHARGE,
      reading,
      fileName: 'statement.csv',
      fileHash: 'hash-s',
      signature: readingSignature(table, 1),
      rows: lines.map((row) => row.cells),
      header: { declaration: STATEMENT, cells: header.cells ?? {} },
      now: NOW,
    })

    expect(intake.rowCount).toBe(2)
    const [statement] = listRows(db, STATEMENT)
    expect(statement?.id).toBe(intake.headerRowId)
    expect(statement?.cells['printed_total_minor']).toBe(15250)
    expect(listRows(db, CHARGE).map((row) => row.cells['statement'])).toEqual([
      intake.headerRowId,
      intake.headerRowId,
    ])

    // The ladder brings the header back with the rest of the reading.
    const [stored] = listIntakes(db, 'charge')
    expect(stored?.reading.header).toEqual(reading.header)
    expect(stored?.headerRowId).toBe(intake.headerRowId)
  })

  it('refuses a header reading written without its row, and a row without a header reading', async () => {
    const db = await statementDocument()
    const { lines } = staged('152.50')
    const request = {
      declaration: CHARGE,
      fileName: 'statement.csv',
      fileHash: 'hash-s',
      signature: '',
      rows: lines.map((row) => row.cells),
      now: NOW,
    }
    expect(() => recordIntake(db, { ...request, reading })).toThrow(/header row/)
    expect(countRows(db, CHARGE)).toBe(0)
  })

  it('supersedes the header row with the lines, and refuses to take back half of it', async () => {
    const db = await statementDocument()
    const { table, header, lines } = staged('152.50')
    const intake = recordIntake(db, {
      declaration: CHARGE,
      reading,
      fileName: 'statement.csv',
      fileHash: 'hash-s',
      signature: readingSignature(table, 1),
      rows: lines.map((row) => row.cells),
      header: { declaration: STATEMENT, cells: header.cells ?? {} },
      now: NOW,
    })

    // Without the formats the header row is in, nothing is taken — not the lines alone.
    expect(() => supersedeIntake(db, intake.id, CHARGE)).toThrow(/header row into statement/)
    expect(countRows(db, CHARGE)).toBe(2)

    expect(supersedeIntake(db, intake.id, CHARGE, formats)).toBe(2)
    expect(countRows(db, CHARGE)).toBe(0)
    expect(countRows(db, STATEMENT)).toBe(0)
    // And the reading, header and all, is kept.
    expect(listIntakes(db, 'charge')[0]?.reading.header?.format).toBe('statement')
  })
})
