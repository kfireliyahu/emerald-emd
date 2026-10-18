import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'

import {
  column,
  DECLARATION_LANGUAGE,
  type FormatDeclaration,
} from '@/domain/format/declaration.ts'
import { createDatabase, setQueryOnly } from '../db/database.ts'
import { stageRows } from './formatBatchRepository.ts'
import { adoptFormat, planFor, readFormat, reconcileFormats, saveFormat } from './formatRepository.ts'
import { countRows, insertRows, listRows, tableRefusals } from './formatRowRepository.ts'

/**
 * The batch both halves write through (M26 U2) — a paste on the sheet and
 * `record_format_rows` — and the search that now reads every column.
 */

const NOW = Date.UTC(2026, 9, 1)

function format(
  name: string,
  columns: FormatDeclaration['columns'],
  extra: Partial<FormatDeclaration> = {},
): FormatDeclaration {
  return {
    language: DECLARATION_LANGUAGE,
    name,
    title: name,
    notes: '',
    columns,
    identities: [],
    aggregates: [],
    nothingMustHold: true,
    ...extra,
  }
}

const SHOP = format('shop', [column('name', 'text', { required: true, unique: true })])

const BUY = format('buy', [
  column('item', 'text', { required: true }),
  column('price', 'money'),
  column('weight', 'quantity'),
  column('rate', 'decimal', { scale: 4 }),
  column('count', 'integer'),
  column('on', 'date'),
  column('organic', 'boolean'),
  column('shop', 'link', { target: 'shop' }),
])

async function document(): Promise<Database> {
  const db = await createDatabase()
  for (const each of [SHOP, BUY]) expect(adoptFormat(db, each, NOW).refusals).toEqual([])
  insertRows(db, SHOP, [{ name: 'Corner' }])
  return db
}

describe('a batch of rows, judged whole', () => {
  it('accepts a batch that is right, with links written by name', async () => {
    const db = await document()
    const batch = stageRows(db, BUY, [
      { item: 'Bread', price: '12.90', price_currency: 'ILS', shop: 'Corner' },
      { item: 'Milk', count: '2' },
    ])
    expect(batch.refusals).toEqual([])
    expect(batch.accepted).toHaveLength(2)
    expect(batch.accepted[0]?.cells['price_minor']).toBe(1290)
    // The name became the id of the row it names.
    expect(batch.accepted[0]?.cells['shop']).not.toBe('Corner')
    expect(countRows(db, BUY)).toBe(0)
  })

  it('names the row and the cell it refuses', async () => {
    const db = await document()
    const batch = stageRows(db, BUY, [
      { item: 'Bread' },
      { item: 'Milk', count: 'two' },
      { item: 'Eggs', shop: 'Nowhere' },
    ])
    expect(batch.refusals.map(({ index, column: named }) => [index, named])).toEqual([
      [1, 'count'],
      [2, 'shop'],
    ])
  })

  it('names the column a repeat is in, across the batch', async () => {
    const db = await document()
    const batch = stageRows(db, SHOP, [{ name: 'Market' }, { name: 'Market' }])
    expect(batch.refusals).toHaveLength(1)
    expect(batch.refusals[0]?.column).toBe('name')
    expect(batch.refusals[0]?.index).toBe(1)
  })
})

describe('a search reads every column as it is shown', () => {
  async function stocked(): Promise<Database> {
    const db = await document()
    const batch = stageRows(db, BUY, [
      {
        item: 'Bread',
        price: '12.90',
        price_currency: 'ILS',
        weight: '750',
        weight_unit: 'g',
        rate: '-0.0012',
        count: '3',
        on: '2026-09-30',
        organic: 'true',
        shop: 'Corner',
      },
      { item: 'Milk', price: '1500', price_currency: 'JPY' },
    ])
    expect(batch.refusals).toEqual([])
    insertRows(db, BUY, batch.accepted.map((each) => each.cells))
    return db
  }

  const found = (db: Database, search: string, formats?: readonly FormatDeclaration[]) =>
    listRows(db, BUY, { search, ...(formats === undefined ? {} : { formats }) }).length

  it('finds money as major units and by its code, in the currency’s own digits', async () => {
    const db = await stocked()
    expect(found(db, '12.90')).toBe(1)
    expect(found(db, 'ils')).toBe(1)
    // A yen has no minor unit, so 1500 is not 15.00.
    expect(found(db, '1500')).toBe(1)
    expect(found(db, '15.00')).toBe(0)
  })

  it('finds a figure, a quantity with its unit, a decimal and a date', async () => {
    const db = await stocked()
    expect(found(db, '750 g')).toBe(1)
    expect(found(db, '-0.0012')).toBe(1)
    expect(found(db, '2026-09')).toBe(1)
  })

  it('finds a link by what the row it names is called, given the formats', async () => {
    const db = await stocked()
    expect(found(db, 'corner', [SHOP, BUY])).toBe(1)
    // Without the formats a link is not searched, rather than searched as an id.
    expect(found(db, 'corner')).toBe(0)
  })

  it('does not search a yes/no column, which a substring cannot mean', async () => {
    const db = await stocked()
    expect(found(db, 'yes')).toBe(0)
    expect(found(db, 'true')).toBe(0)
  })
})

/**
 * **Add never does nothing** (M29 F2, D-343). A real timesheet declared
 * `start_hour` and `end_hour` as times over a table still checking them as
 * dates: every check the engine runs passed, SQLite refused the write, and the
 * exception went nowhere — *"i populated a full page and pressed add and
 * nothing happened. not even an error."*
 */
describe('a table that disagrees with its declaration (M29 F2)', () => {
  const asDates = format('timesheet', [
    column('date', 'date'),
    column('start_hour', 'date'),
    column('per_hours', 'money'),
    column('end_hour', 'date'),
  ])
  const asTimes = format('timesheet', [
    column('date', 'date'),
    column('start_hour', 'time', { required: true }),
    column('end_hour', 'time', { required: true }),
    column('per_hours', 'money'),
  ])
  const shift = { date: '2026-10-04', start_hour: '09:00', end_hour: '17:30', per_hours: '50', per_hours_currency: 'ILS' }

  /** That document, made the only way it can be from here: the declaration stored over a table it never reached. */
  async function drifted(): Promise<Database> {
    const db = await createDatabase()
    expect(adoptFormat(db, asDates, NOW).refusals).toEqual([])
    saveFormat(db, asTimes, NOW)
    return db
  }

  it('is refused at the row and the cell, before the write, rather than thrown after it', async () => {
    const db = await drifted()
    const batch = stageRows(db, asTimes, [shift, { ...shift, date: '2026-10-05' }])
    expect(batch.refusals[0]).toMatchObject({ index: 0, column: 'start_hour' })
    expect(batch.refusals[0]?.reason).toMatch(/would not take start_hour/)
    expect(batch.refusals).toHaveLength(2)
    // Asking wrote nothing.
    expect(countRows(db, asTimes)).toBe(0)
  })

  it('says which row when only one of them is refused', async () => {
    const db = await createDatabase()
    expect(adoptFormat(db, asTimes, NOW).refusals).toEqual([])
    // A CHECK the engine knows nothing of — a table somebody else altered.
    db.run(`CREATE TRIGGER no_sundays BEFORE INSERT ON fmt_timesheet WHEN NEW.date = '2026-10-04' BEGIN SELECT RAISE(ABORT, 'no work on 2026-10-04'); END`)
    const batch = stageRows(db, asTimes, [{ ...shift, date: '2026-10-03' }, shift])
    expect(batch.refusals.map((each) => each.index)).toEqual([1])
    expect(tableRefusals(db, asTimes, [{ date: '2026-10-03', start_hour: '09:00', end_hour: '10:00' }])).toEqual([])
  })

  it('is mended when the document opens, since the columns hold nothing', async () => {
    const db = await drifted()
    expect(reconcileFormats(db)).toEqual([])
    const batch = stageRows(db, asTimes, [shift])
    expect(batch.refusals).toEqual([])
    insertRows(db, asTimes, batch.accepted.map((each) => each.cells))
    expect(listRows(db, asTimes)[0]?.cells['start_hour']).toBe('09:00')
    // And once mended there is nothing left to do.
    expect(planFor(db, asTimes).steps).toEqual([])
  })

  it('is left alone while the column holds something, and the write says why', async () => {
    const db = await createDatabase()
    expect(adoptFormat(db, asDates, NOW).refusals).toEqual([])
    insertRows(db, asDates, [{ start_hour: '2026-10-04' }])
    saveFormat(db, { ...asTimes, columns: asTimes.columns.map((each) => ({ ...each, required: false })) }, NOW)
    const plan = planFor(db, readFormat(db, 'timesheet') ?? asTimes)
    expect(plan.steps.filter((step) => step.column === 'start_hour')).toEqual([])
    expect(plan.refusals).toEqual([])
  })

  it('cannot be asked of a document open read-only, and does not pretend to', async () => {
    const db = await drifted()
    setQueryOnly(db, true)
    expect(tableRefusals(db, asTimes, [{ start_hour: '09:00', end_hour: '17:30' }])).toEqual([])
  })
})
