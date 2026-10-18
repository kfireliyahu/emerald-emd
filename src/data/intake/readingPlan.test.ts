/**
 * **Reconciled, and only that** — M26 U5.
 *
 * The question was whether a reading can really be known to be fully reconciled
 * with nothing missing. These hold the narrow answer `reconciles` gives: a
 * statement whose printed total matches its lines reconciles; one ten agorot
 * out does not; a format that declares nothing to add up never does, because no
 * proof ran; and a file read before is planned with its prior intake named.
 */

import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'

import { createDatabase } from '@/data/db/database.ts'
import { listIntakes, recordIntake } from '@/data/repositories/formatIntakeRepository.ts'
import { indexOf } from '@/data/repositories/formatJoinRepository.ts'
import { adoptFormat } from '@/data/repositories/formatRepository.ts'
import { aggregate } from '@/domain/format/aggregate.ts'
import { column, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { identity } from '@/domain/format/identity.ts'
import type { ReadCell, ReadTable, Reading } from '@/domain/format/reading.ts'
import { intakeRequestOf, lineCounts, planReading, planWrites, reconciles } from './readingPlan.ts'

const NOW = Date.UTC(2026, 9, 1)

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

function text(value: string): ReadCell {
  return value === '' ? { kind: 'empty', text: '' } : { kind: 'text', text: value }
}

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

const LINES: Reading = {
  format: 'charge',
  headerRow: 1,
  dateOrder: 'dmy',
  columns: [
    { index: 0, key: 'merchant' },
    { index: 1, key: 'amount' },
  ],
  fixed: [{ key: 'amount_currency', value: 'ILS' }],
}

const WITH_TOTAL: Reading = {
  ...LINES,
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

async function document(): Promise<Database> {
  const db = await createDatabase()
  expect(adoptFormat(db, STATEMENT, NOW).refusals).toEqual([])
  expect(adoptFormat(db, CHARGE, NOW).refusals).toEqual([])
  return db
}

describe('whether a file reconciles', () => {
  it('does when the printed total matches the lines, and not when it is ten agorot out', async () => {
    const db = await document()
    const good = planReading(db, CHARGE, sheet('152.50'), { name: 'a', hash: 'a' }, WITH_TOTAL, formats)
    const off = planReading(db, CHARGE, sheet('152.60'), { name: 'b', hash: 'b' }, WITH_TOTAL, formats)

    expect(planWrites(good)).toBe(true)
    expect(reconciles(good)).toBe(true)
    // Still writable — a statement that misses its total is a real statement —
    // but never ticked for the person.
    expect(planWrites(off)).toBe(true)
    expect(reconciles(off)).toBe(false)
  })

  it('never does when nothing was checked', async () => {
    const db = await document()
    // The same lines, with no header row to add up to and a fixed link instead.
    const plain = planReading(
      db,
      { ...CHARGE, columns: CHARGE.columns.filter((each) => each.name !== 'statement') },
      sheet('152.50'),
      { name: 'c', hash: 'c' },
      LINES,
      formats,
    )
    expect(lineCounts(plain).typed).toBeGreaterThan(0)
    expect(reconciles(plain)).toBe(false)
  })

  it('names the earlier reading of this exact file', async () => {
    const db = await document()
    const table = sheet('152.50')
    const plan = planReading(db, CHARGE, table, { name: 'jul.xlsx', hash: 'same' }, WITH_TOTAL, formats)
    recordIntake(db, intakeRequestOf(plan, CHARGE, WITH_TOTAL, table, { name: 'jul.xlsx', hash: 'same' }, NOW))

    const again = planReading(db, CHARGE, table, { name: 'jul.xlsx', hash: 'same' }, WITH_TOTAL, formats)
    expect(again.prior?.fileName).toBe('jul.xlsx')
    // And the header is kept in the file's own order, so a reader can follow
    // a column that moves (M26 F1).
    expect(listIntakes(db, 'charge')[0]?.headerCells).toEqual(['merchant', 'amount'])
  })
})

describe('which lines do not add up (M26 F1)', () => {
  const PACKED: FormatDeclaration = {
    language: 5,
    name: 'packed',
    title: 'Packed',
    notes: '',
    columns: [column('name', 'text', { required: true }), column('each', 'real'), column('packs', 'integer'), column('total', 'real')],
    identities: [identity('adds_up', 'total = each * packs')],
    aggregates: [],
    nothingMustHold: false,
  }

  it('names each failing line with what failed, and only those', async () => {
    const db = await createDatabase()
    expect(adoptFormat(db, PACKED, NOW).refusals).toEqual([])
    const table: ReadTable = {
      rows: [
        [text('name'), text('each'), text('packs'), text('total')],
        [text('Pasta'), text('500'), text('2'), text('1000')],
        [text('Rice'), text('400'), text('3'), text('1100')],
        [text('Salt'), text('100'), text('1'), text('100')],
      ],
      columnCount: 4,
    }
    const reading: Reading = {
      format: 'packed',
      headerRow: 0,
      dateOrder: 'dmy',
      columns: [
        { index: 0, key: 'name' },
        { index: 1, key: 'each' },
        { index: 2, key: 'packs' },
        { index: 3, key: 'total' },
      ],
      fixed: [],
    }
    const plan = planReading(db, PACKED, table, { name: 'p', hash: 'p' }, reading, indexOf([PACKED]))
    expect(plan.proof?.failed).toBe(1)
    expect(plan.failing.map((each) => each.id)).toEqual(['line 3'])
    expect(plan.failing[0]?.sentences.join(' ')).toContain('adds_up')
  })
})
