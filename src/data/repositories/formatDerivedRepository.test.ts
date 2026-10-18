/**
 * Derived columns against a real table (M29 U3b, D-334) — and the proof the
 * unit owes: **the SQL the view is compiled to and the TypeScript evaluator
 * give one answer**, over a table of cases covering same-row arithmetic, a hop,
 * an aggregate with and without a filter, a unit conversion, a quantity, a
 * derived column naming another, an empty input, a zero divisor and money's
 * rounding.
 */

import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { aggregate, aggregateSentence } from '@/domain/format/aggregate.ts'
import { parseRollup } from '@/domain/format/rollup.ts'
import { column, DECLARATION_LANGUAGE, ROW_ID_COLUMN, type FormatDeclaration } from '@/domain/format/declaration.ts'
import {
  compileDerived,
  derived,
  derivedSelectSql,
  derivedViewNameFor,
  evaluateDerived,
} from '@/domain/format/derived.ts'
import { evaluateIdentity, identity } from '@/domain/format/identity.ts'
import { createDatabase } from '../db/database.ts'
import { exportEncoded, openEncoded } from '../storage/encoding.ts'
import { derivedOf } from './formatDerivedRepository.ts'
import { aggregatesOf, indexOf, inputsWithAggregates, type RowAggregate } from './formatJoinRepository.ts'
import { adoptFormat, deleteFormat, listFormats, readFormat, reconcileFormats } from './formatRepository.ts'
import { insertRows, listRows } from './formatRowRepository.ts'
import { runRollup } from './formatRollupRepository.ts'
import { listUnits } from './unitRepository.ts'

const NOW = 1_755_000_000_000

const CATEGORY: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'category',
  title: 'Category',
  notes: '',
  columns: [column('name', 'text', { required: true }), column('markup', 'percent')],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

const PRODUCT: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'product',
  title: 'Product',
  notes: '',
  columns: [
    column('name', 'text', { required: true }),
    column('price', 'money'),
    column('vat', 'percent'),
    column('weight', 'decimal', { scale: 3, unit: 'kg' }),
    column('qty', 'integer'),
    column('size', 'real', { unit: 'ml' }),
    column('amount', 'quantity'),
    column('category', 'link', { target: 'category' }),
  ],
  identities: [],
  aggregates: [
    aggregate('units_total', 'SUM', { format: 'line', column: 'product' }, { expression: 'units' }),
    aggregate('lines', 'COUNT', { format: 'line', column: 'product' }),
    aggregate('cost_total', 'SUM', { format: 'line', column: 'product' }, { expression: 'cost' }),
    aggregate('units_average', 'AVERAGE', { format: 'line', column: 'product' }, { expression: 'units' }),
    aggregate('units_most', 'MAXIMUM', { format: 'line', column: 'product' }, { expression: 'units' }),
    aggregate('a_units', 'SUM', { format: 'line', column: 'product' }, {
      expression: 'units',
      where: { column: 'kind', is: 'A' },
    }),
  ],
  derived: [
    derived('with_vat', 'price * (1 + vat)'),
    derived('weight_g', 'weight in g'),
    derived('per_unit', 'price / qty'),
    derived('double_qty', 'qty * 2'),
    derived('third', 'qty / 3'),
    derived('with_vat_twice', 'with_vat * 2'),
    derived('marked_up', 'price * category.markup'),
    derived('amount_g', 'amount in g'),
    derived('size_l', 'size in l'),
    derived('half', 'price / 2'),
    derived('units_left', 'units_total - qty'),
    derived('line_count', 'lines'),
    derived('over_cost', 'cost_total - price'),
    derived('average', 'units_average'),
    derived('most', 'units_most * 1.5'),
    derived('only_a', 'a_units'),
  ],
  nothingMustHold: true,
}

const LINE: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'line',
  title: 'Line',
  notes: '',
  columns: [
    column('product', 'link', { target: 'product' }),
    column('units', 'integer'),
    column('cost', 'money'),
    column('kind', 'enum', { values: ['A', 'B'] }),
  ],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

async function shop(): Promise<Database> {
  const db = await createDatabase()
  // The product's aggregates and links name the other two, so they come first
  // and the product's own declaration last.
  for (const each of [CATEGORY, { ...PRODUCT, aggregates: [], derived: [] }, LINE, PRODUCT]) {
    const plan = adoptFormat(db, each, NOW)
    expect(plan.refusals).toEqual([])
  }
  insertRows(db, CATEGORY, [{ name: 'Food', markup: 125_000 }, { name: 'Odd', markup: null }], ['food', 'odd'])
  insertRows(
    db,
    PRODUCT,
    [
      // 19.99 at 17% is 23.3883, to the agora 23.39.
      { name: 'Bread', price_minor: 1999, price_currency: 'ILS', vat: 170_000, weight: 1250, qty: 3, size: 330, amount: 150, amount_unit: 'g', category: 'food' },
      // A half to be rounded away from zero, both signs.
      { name: 'Refund', price_minor: -1999, price_currency: 'ILS', vat: 0, weight: null, qty: 0, size: null, amount: 2, amount_unit: 'kg', category: 'odd' },
      // Nothing in most things, and a quantity in a unit that is not a mass.
      { name: 'Empty', price_minor: null, price_currency: null, vat: null, weight: null, qty: null, size: null, amount: 200, amount_unit: 'ml', category: null },
      { name: 'Milk', price_minor: 1000, price_currency: 'ILS', vat: 125_000, weight: 1, qty: 7, size: 1000.5, amount: null, amount_unit: null, category: 'food' },
    ],
    ['bread', 'refund', 'empty', 'milk'],
  )
  insertRows(
    db,
    LINE,
    [
      { product: 'bread', units: 2, cost_minor: 500, cost_currency: 'ILS', kind: 'A' },
      { product: 'bread', units: 5, cost_minor: 250, cost_currency: 'ILS', kind: 'B' },
      // A line with no units: every fold of units over refund is empty.
      { product: 'refund', units: null, cost_minor: 100, cost_currency: 'ILS', kind: 'A' },
      // Two currencies: the cost total over milk is empty.
      { product: 'milk', units: 1, cost_minor: 100, cost_currency: 'ILS', kind: null },
      { product: 'milk', units: 4, cost_minor: 100, cost_currency: 'USD', kind: 'B' },
    ],
    ['l1', 'l2', 'l3', 'l4', 'l5'],
  )
  return db
}

async function encoded(db: Database, as: 'sqlite' | 'text'): Promise<Uint8Array> {
  const bytes = await exportEncoded(db, as)
  if (!bytes.ok) throw new Error(bytes.error)
  return bytes.value
}

describe('a derived column', () => {
  it('is refused when its type makes no sense, it names itself, or it names nothing', () => {
    const problems = (list: readonly ReturnType<typeof derived>[]): readonly string[] =>
      compileDerived({ ...PRODUCT, derived: list }, [CATEGORY, LINE]).problems.map((each) => each.message)

    expect(problems([derived('a', 'price * price')])[0]).toMatch(/money by money/)
    expect(problems([derived('a', 'price + 1')])[0]).toMatch(/bare number to money/)
    expect(problems([derived('a', 'qty / price')])[0]).toMatch(/by money/)
    expect(problems([derived('a', 'price in g')])[0]).toMatch(/currency, not a unit/)
    expect(problems([derived('a', 'amount * 2')])[0]).toMatch(/converted before/)
    expect(problems([derived('a', 'size in g')])[0]).toMatch(/two different things/)
    expect(problems([derived('a', 'qty in g')])[0]).toMatch(/nothing on the left/)
    expect(problems([derived('a', 'b + 1'), derived('b', 'a * 2')])[0]).toMatch(/a → b → a/)
    expect(problems([derived('a', '2 * 3')])[0]).toMatch(/names no column/)
    expect(problems([derived('price', 'qty')])[0]).toMatch(/same thing as a column/)
    expect(problems([derived('price_minor', 'qty')])[0]).toMatch(/same thing as a column/)
    expect(problems([derived('a', 'name * 2')])[0]).toMatch(/which is a text/)
    expect(problems([derived('a', 'category.name * 2')])[0]).toMatch(/which is a text/)
    expect(problems([derived('a', 'amount in g via size')])[0]).toMatch(/via/)
    expect(problems([derived('a', 'missing + 1')])[0]).toMatch(/no such column/)
  })

  it('infers money, a figure in a unit, or a bare number', () => {
    const { compiled, problems } = compileDerived(PRODUCT, [CATEGORY, LINE])
    expect(problems).toEqual([])
    const type = (name: string): unknown => compiled.find((each) => each.declaration.name === name)?.type
    expect(type('with_vat')).toEqual({ kind: 'MONEY' })
    expect(type('over_cost')).toEqual({ kind: 'MONEY' })
    expect(type('weight_g')).toEqual({ kind: 'NUMBER', unit: 'g' })
    expect(type('amount_g')).toEqual({ kind: 'NUMBER', unit: 'g' })
    expect(type('double_qty')).toEqual({ kind: 'NUMBER', unit: undefined })
  })

  it('gives the same answer in SQL and in TypeScript, on every case', async () => {
    const db = await shop()
    const declaration = readFormat(db, 'product')
    if (declaration === undefined) throw new Error('no product')
    const formats = indexOf(listFormats(db))
    const units = listUnits(db)
    const neighbours = [...formats.values()].filter((each) => each.name !== 'product')
    const { compiled } = compileDerived(declaration, neighbours, units)
    const select = derivedSelectSql(declaration, neighbours, false) ?? ''
    const sql = new Map(
      db.exec(select)[0]?.values.map((values) => {
        const names = db.exec(select)[0]?.columns ?? []
        return [String(values[0]), Object.fromEntries(names.map((name, index) => [name, values[index]]))]
      }) ?? [],
    )

    let compared = 0
    for (const row of listRows(db, declaration)) {
      const inputs = inputsWithAggregates(db, declaration, row, formats, units)
      for (const each of compiled) {
        const fromTs = evaluateDerived(each, inputs, units)
        const cells = sql.get(row.id) ?? {}
        const name = each.declaration.name
        const fromSql = each.type.kind === 'MONEY' ? cells[`${name}_minor`] : cells[name]
        const label = `${row.id}.${name}`
        if (name === 'over_cost' && row.id === 'milk') {
          // Two currencies across the folded lines: SQL refuses the total, and
          // the TypeScript fold — which never compared currencies across rows —
          // still adds them. The view is the stricter, and the screen says why.
          expect(fromSql, label).toBeNull()
          continue
        }
        if (fromTs.kind === 'EMPTY') {
          expect(fromSql, `${label}: ${fromTs.reason}`).toBeNull()
        } else if (fromTs.kind === 'MONEY') {
          expect(fromSql, label).toBe(fromTs.minor)
        } else if (fromTs.kind === 'DATE') {
          expect(fromSql, label).toBe(fromTs.date)
        } else {
          expect(typeof fromSql, label).toBe('number')
          expect(Number(fromSql), label).toBeCloseTo(fromTs.value, 9)
        }
        compared += 1
      }
    }
    expect(compared).toBeGreaterThan(50)
  })

  it('works out the figures a person would by hand', async () => {
    const db = await shop()
    const declaration = readFormat(db, 'product')
    if (declaration === undefined) throw new Error('no product')
    const formats = indexOf(listFormats(db))
    const values = derivedOf(db, declaration, listRows(db, declaration), formats, listUnits(db))
    const at = (row: string, name: string): unknown =>
      values.get(row)?.find((each) => each.compiled.declaration.name === name)?.value

    expect(at('bread', 'with_vat')).toEqual({ kind: 'MONEY', minor: 2339, currency: 'ILS' })
    expect(at('bread', 'with_vat_twice')).toEqual({ kind: 'MONEY', minor: 4678, currency: 'ILS' })
    expect(at('bread', 'weight_g')).toEqual({ kind: 'NUMBER', value: 1250, unit: 'g' })
    expect(at('bread', 'amount_g')).toEqual({ kind: 'NUMBER', value: 150, unit: 'g' })
    expect(at('refund', 'amount_g')).toEqual({ kind: 'NUMBER', value: 2000, unit: 'g' })
    expect(at('bread', 'per_unit')).toEqual({ kind: 'MONEY', minor: 666, currency: 'ILS' })
    expect(at('bread', 'marked_up')).toEqual({ kind: 'MONEY', minor: 250, currency: 'ILS' })
    expect(at('bread', 'half')).toEqual({ kind: 'MONEY', minor: 1000, currency: 'ILS' })
    expect(at('refund', 'half')).toEqual({ kind: 'MONEY', minor: -1000, currency: 'ILS' })
    expect(at('bread', 'units_left')).toEqual({ kind: 'NUMBER', value: 4, unit: undefined })
    expect(at('bread', 'line_count')).toEqual({ kind: 'NUMBER', value: 2, unit: undefined })
    expect(at('bread', 'over_cost')).toEqual({ kind: 'MONEY', minor: -1249, currency: 'ILS' })
    expect(at('bread', 'only_a')).toEqual({ kind: 'NUMBER', value: 2, unit: undefined })
    expect(at('empty', 'line_count')).toEqual({ kind: 'NUMBER', value: 0, unit: undefined })
    // A sum of no lines is 0; an average of none is empty.
    expect(at('empty', 'units_left')).toMatchObject({ kind: 'EMPTY', reason: 'qty is empty here.' })
    expect(at('empty', 'average')).toMatchObject({ kind: 'EMPTY' })

    // Empty, never 0, and the reason names the input.
    expect(at('empty', 'with_vat')).toEqual({ kind: 'EMPTY', reason: 'price is empty here.' })
    expect(at('refund', 'per_unit')).toMatchObject({ kind: 'EMPTY', reason: expect.stringMatching(/divides by zero/) })
    expect(at('refund', 'marked_up')).toEqual({ kind: 'EMPTY', reason: 'category.markup is empty here.' })
    expect(at('empty', 'amount_g')).toMatchObject({ kind: 'EMPTY', reason: expect.stringMatching(/ml/) })
    // A filter column empty on one line empties the filtered fold in whole.
    expect(at('milk', 'only_a')).toMatchObject({ kind: 'EMPTY' })
    expect(at('refund', 'units_left')).toMatchObject({ kind: 'EMPTY' })
    // A total over two currencies is no total (M29 F7), so the cell names it —
    // and the total's own column says which rows disagree.
    expect(at('milk', 'over_cost')).toEqual({ kind: 'EMPTY', reason: 'cost_total is empty here.' })
  })

  it('is a view that plain SQL reads, in a saved file, and follows the units table', async () => {
    const db = await shop()
    const reopened = (await openEncoded(await encoded(db, 'sqlite'))).db
    const view = derivedViewNameFor({ name: 'product' })
    const rows = reopened.exec(
      `SELECT name, with_vat_minor, with_vat_currency, weight_g, price_minor FROM "${view}" ORDER BY name`,
    )[0]?.values
    expect(rows).toEqual([
      ['Bread', 2339, 'ILS', 1250, 1999],
      ['Empty', null, null, null, null],
      ['Milk', 1125, 'ILS', 1, 1000],
      ['Refund', -1999, 'ILS', null, -1999],
    ])
    // A unit is a row: changing it moves the figure on the next read.
    reopened.run("UPDATE measurement_unit SET per_base = per_base * 2 WHERE symbol = 'kg'")
    expect(reopened.exec(`SELECT weight_g FROM "${view}" WHERE ${ROW_ID_COLUMN} = 'bread'`)[0]?.values).toEqual([[2500]])
  })

  it('survives a declaration changing, a format being deleted, and a text round trip', async () => {
    const db = await shop()
    const view = derivedViewNameFor({ name: 'product' })
    const has = (on: Database): boolean =>
      on.exec(`SELECT 1 FROM sqlite_master WHERE type = 'view' AND name = '${view}'`).length > 0
    expect(has(db)).toBe(true)

    // Dropping a column no derived figure reads leaves the view standing.
    const before = readFormat(db, 'product')
    if (before === undefined) throw new Error('no product')
    const plan = adoptFormat(db, { ...before, derived: [derived('double_qty', 'qty * 2')] }, NOW)
    expect(plan.refusals).toEqual([])
    expect(db.exec(`SELECT double_qty FROM "${view}" WHERE ${ROW_ID_COLUMN} = 'milk'`)[0]?.values).toEqual([[14]])

    // A text document carries the declaration — its aggregates over a format
    // that links back to it included (M29 F1, D-336) — and the open rebuilds
    // the view.
    const text = (await openEncoded(await encoded(db, 'text'))).db
    expect(readFormat(text, 'product')?.derived).toEqual([derived('double_qty', 'qty * 2')])
    expect(readFormat(text, 'product')?.aggregates).toEqual(before.aggregates)
    reconcileFormats(text)
    expect(text.exec(`SELECT double_qty FROM "${view}" WHERE name = 'Milk'`)[0]?.values).toEqual([[14]])

    // Deleting a format the view does not read leaves it standing.
    deleteFormat(db, 'line')
    expect(has(db)).toBe(true)
  })
})

/* ------------------------------------------------- a span between two points */

// M29 U4, D-335 — a real case: a shift with a start and an end hour, and
// the hours between them worked out, past midnight too, then added up.

const PERSON: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'person',
  title: 'Person',
  notes: '',
  columns: [column('name', 'text', { required: true })],
  identities: [],
  aggregates: [
    aggregate('total_hours', 'SUM', { format: 'shift', column: 'person' }, { expression: 'end - start', unit: 'h' }),
    aggregate('longest', 'MAXIMUM', { format: 'shift', column: 'person' }, { expression: '(end - start) in min', unit: 'min' }),
  ],
  derived: [derived('total_days', 'total_hours / 24')],
  nothingMustHold: true,
}

const SHIFT: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'shift',
  title: 'Shift',
  notes: '',
  columns: [
    column('person', 'link', { target: 'person' }),
    column('date', 'date'),
    column('start', 'time'),
    column('end', 'time'),
    column('until', 'date'),
    column('clock_in', 'instant'),
    column('clock_out', 'instant'),
  ],
  identities: [],
  aggregates: [],
  derived: [
    derived('hours', 'end - start'),
    derived('minutes', '(end - start) in min'),
    derived('paid', 'hours - 0.5'),
    derived('days', 'until - date'),
    derived('clocked', 'clock_out - clock_in'),
    derived('clocked_days', '(clock_out - clock_in) in day'),
    derived('pay', 'hours * 50'),
  ],
  rollups: [],
  nothingMustHold: true,
}

async function shifts(): Promise<Database> {
  const db = await createDatabase()
  const monthly = parseRollup('monthly_hours', 'sum of hours by month of date and person')
  if (!monthly.ok) throw new Error(monthly.error)
  for (const each of [{ ...PERSON, aggregates: [], derived: [] }, { ...SHIFT, rollups: [monthly.value] }, PERSON]) {
    expect(adoptFormat(db, each, NOW).refusals).toEqual([])
  }
  insertRows(db, PERSON, [{ name: 'Dana' }, { name: 'Avi' }], ['dana', 'avi'])
  const at = (text: string): string => `${text}:00.000Z`
  insertRows(
    db,
    SHIFT,
    [
      { person: 'dana', date: '2026-10-01', start: '09:00', end: '17:30', until: '2026-10-03', clock_in: at('2026-10-01T09:00'), clock_out: at('2026-10-01T17:30') },
      // Past midnight: 22:00 to 06:00 is eight hours, not minus sixteen.
      { person: 'dana', date: '2026-10-02', start: '22:00', end: '06:00', until: '2026-10-02', clock_in: at('2026-10-02T22:00'), clock_out: at('2026-10-03T06:00') },
      // The same hour twice is no time at all, never a whole day.
      { person: 'dana', date: '2026-10-03', start: '08:20', end: '08:20', until: '2026-09-30', clock_in: null, clock_out: null },
      // No end yet: the hours are empty, never 0, and so is anything folding them.
      { person: 'avi', date: '2026-11-01', start: '10:00', end: null, until: null, clock_in: null, clock_out: null },
      { person: 'avi', date: '2026-11-02', start: '07:45', end: '16:00', until: null, clock_in: null, clock_out: null },
    ],
    ['s1', 's2', 's3', 's4', 's5'],
  )
  return db
}

describe('a span between two points', () => {
  it('is refused anywhere but end - start of two of one kind', () => {
    const problems = (list: readonly ReturnType<typeof derived>[]): readonly string[] =>
      compileDerived({ ...SHIFT, derived: list }, [PERSON]).problems.map((each) => each.message)
    expect(problems([derived('a', 'start + end')])[0]).toMatch(/start is a time — a point/)
    expect(problems([derived('a', 'end - date')])[0]).toMatch(/takes a date from a time/)
    expect(problems([derived('a', 'start * 2')])[0]).toMatch(/only arithmetic a time takes part in/)
    expect(problems([derived('a', 'end - start + 1')])).toEqual([])
    expect(problems([derived('a', '(end - start) in kg')])[0]).toMatch(/two different things/)
  })

  it('comes out in hours for times and instants and in days for dates', () => {
    const { compiled, problems } = compileDerived(SHIFT, [PERSON])
    expect(problems).toEqual([])
    const type = (name: string): unknown => compiled.find((each) => each.declaration.name === name)?.type
    expect(type('hours')).toEqual({ kind: 'NUMBER', unit: 'h' })
    expect(type('minutes')).toEqual({ kind: 'NUMBER', unit: 'min' })
    expect(type('paid')).toEqual({ kind: 'NUMBER', unit: 'h' })
    expect(type('days')).toEqual({ kind: 'NUMBER', unit: 'day' })
    expect(type('clocked')).toEqual({ kind: 'NUMBER', unit: 'h' })
  })

  it('gives the same answer in SQL and in TypeScript, overnight included', async () => {
    const db = await shifts()
    const formats = indexOf(listFormats(db))
    const units = listUnits(db)
    let compared = 0
    for (const name of ['shift', 'person']) {
      const declaration = readFormat(db, name)
      if (declaration === undefined) throw new Error(`no ${name}`)
      const neighbours = [...formats.values()].filter((each) => each.name !== name)
      const { compiled } = compileDerived(declaration, neighbours, units)
      const select = derivedSelectSql(declaration, neighbours, false) ?? ''
      const result = db.exec(select)[0]
      const columns = result?.columns ?? []
      const sql = new Map(
        (result?.values ?? []).map((values) => [
          String(values[0]),
          Object.fromEntries(columns.map((column, index) => [column, values[index]])),
        ]),
      )
      for (const row of listRows(db, declaration)) {
        const inputs = inputsWithAggregates(db, declaration, row, formats, units)
        for (const each of compiled) {
          const fromTs = evaluateDerived(each, inputs, units)
          const fromSql = sql.get(row.id)?.[each.declaration.name]
          const label = `${row.id}.${each.declaration.name}`
          if (fromTs.kind === 'EMPTY') {
            expect(fromSql, `${label}: ${fromTs.reason}`).toBeNull()
          } else {
            expect(fromTs.kind, label).toBe('NUMBER')
            expect(Number(fromSql), label).toBeCloseTo(fromTs.kind === 'NUMBER' ? fromTs.value : NaN, 9)
          }
          compared += 1
        }
      }
    }
    expect(compared).toBe(5 * 7 + 2)
  })

  it('works out the hours a person would by hand, and adds them up', async () => {
    const db = await shifts()
    const formats = indexOf(listFormats(db))
    const shift = readFormat(db, 'shift')
    const person = readFormat(db, 'person')
    if (shift === undefined || person === undefined) throw new Error('no formats')
    const values = derivedOf(db, shift, listRows(db, shift), formats, listUnits(db))
    const at = (row: string, name: string): unknown =>
      values.get(row)?.find((each) => each.compiled.declaration.name === name)?.value

    expect(at('s1', 'hours')).toEqual({ kind: 'NUMBER', value: 8.5, unit: 'h' })
    expect(at('s2', 'hours')).toEqual({ kind: 'NUMBER', value: 8, unit: 'h' })
    expect(at('s3', 'hours')).toEqual({ kind: 'NUMBER', value: 0, unit: 'h' })
    expect(at('s5', 'hours')).toEqual({ kind: 'NUMBER', value: 8.25, unit: 'h' })
    expect(at('s2', 'minutes')).toEqual({ kind: 'NUMBER', value: 480, unit: 'min' })
    expect(at('s1', 'paid')).toEqual({ kind: 'NUMBER', value: 8, unit: 'h' })
    expect(at('s1', 'pay')).toEqual({ kind: 'NUMBER', value: 425, unit: 'h' })
    expect(at('s1', 'days')).toEqual({ kind: 'NUMBER', value: 2, unit: 'day' })
    // Dates do not wrap: an end before the start is a negative span.
    expect(at('s3', 'days')).toEqual({ kind: 'NUMBER', value: -3, unit: 'day' })
    // Two instants know their dates, so they cross midnight by themselves.
    expect(at('s2', 'clocked')).toEqual({ kind: 'NUMBER', value: 8, unit: 'h' })
    expect(at('s2', 'clocked_days')).toMatchObject({ kind: 'NUMBER', unit: 'day' })
    expect(at('s4', 'hours')).toEqual({ kind: 'EMPTY', reason: 'end is empty here.' })

    // An aggregate folds the span on every line that names the person…
    const people = derivedOf(db, person, listRows(db, person), formats, listUnits(db))
    const total = people.get('dana')?.[0]?.value
    expect(total).toMatchObject({ kind: 'NUMBER' })
    expect(total?.kind === 'NUMBER' ? total.value : NaN).toBeCloseTo(16.5 / 24, 12)
    // …and is empty in whole when one line cannot answer.
    expect(people.get('avi')?.[0]?.value).toMatchObject({ kind: 'EMPTY' })

    // A rollup sums the worked-out hours by month and person.
    const groups = runRollup(db, shift, 'monthly_hours', listFormats(db))?.groups ?? []
    expect(groups[0]).toEqual({ period: '2026-10', by: 'dana', rows: 3, value: { kind: 'VALUE', figures: [{ value: 16.5 }] } })
    expect(groups[1]).toMatchObject({ period: '2026-11', by: 'avi', rows: 2, value: { kind: 'UNCHECKED' } })
  })

  it('keeps a time as HH:MM through SQL and a text round trip', async () => {
    const db = await shifts()
    expect(() => db.run(`UPDATE fmt_shift SET start = '24:00' WHERE ${ROW_ID_COLUMN} = 's1'`)).toThrow(/CHECK/)
    expect(() => db.run(`UPDATE fmt_shift SET start = '9:00' WHERE ${ROW_ID_COLUMN} = 's1'`)).toThrow(/CHECK/)
    const text = (await openEncoded(await encoded(db, 'text'))).db
    reconcileFormats(text)
    expect(
      text.exec(`SELECT start, "end", hours FROM "${derivedViewNameFor({ name: 'shift' })}" ORDER BY date`)[0]?.values,
    ).toEqual([
      ['09:00', '17:30', 8.5],
      ['22:00', '06:00', 8],
      ['08:20', '08:20', 0],
      ['10:00', null, null],
      ['07:45', '16:00', 8.25],
    ])
  })
})

/* ------------------------------------- a document whose formats point both ways */

// M29 F1, D-336. A person's shifts link to the person and the person folds the
// shifts; a recipe's lines link to the recipe and the recipe sums its lines. A
// text document holding either once saved and would not open. Both are proved
// here in both encodings, by everything worked out coming back the same.

const INGREDIENT: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'ingredient',
  title: 'Ingredient',
  notes: '',
  columns: [column('name', 'text', { required: true }), column('kcal_per_g', 'real')],
  identities: [],
  aggregates: [],
  nothingMustHold: true,
}

const RECIPE: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'recipe',
  title: 'Recipe',
  notes: '',
  columns: [column('name', 'text', { required: true }), column('servings', 'integer')],
  identities: [],
  aggregates: [
    aggregate('total_g', 'SUM', { format: 'recipe_line', column: 'recipe' }, { expression: 'grams', unit: 'g' }),
    aggregate('total_kcal', 'SUM', { format: 'recipe_line', column: 'recipe' }, { expression: 'grams * ingredient.kcal_per_g' }),
  ],
  derived: [derived('kcal_per_serving', 'total_kcal / servings')],
  nothingMustHold: true,
}

const RECIPE_LINE: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'recipe_line',
  title: 'Recipe line',
  notes: '',
  columns: [
    column('what', 'text', { required: true }),
    column('recipe', 'link', { target: 'recipe' }),
    column('ingredient', 'link', { target: 'ingredient' }),
    column('grams', 'real', { unit: 'g' }),
  ],
  identities: [],
  aggregates: [],
  derived: [derived('kcal', 'grams * ingredient.kcal_per_g')],
  nothingMustHold: true,
}

async function kitchen(): Promise<Database> {
  const db = await createDatabase()
  for (const each of [INGREDIENT, { ...RECIPE, aggregates: [], derived: [] }, RECIPE_LINE, RECIPE]) {
    expect(adoptFormat(db, each, NOW).refusals).toEqual([])
  }
  insertRows(db, INGREDIENT, [{ name: 'Pasta', kcal_per_g: 3.5 }, { name: 'Oil', kcal_per_g: 9 }], ['pasta', 'oil'])
  insertRows(db, RECIPE, [{ name: 'Aglio e olio', servings: 2 }, { name: 'Nothing yet', servings: 1 }], ['aglio', 'empty'])
  insertRows(
    db,
    RECIPE_LINE,
    [
      { what: 'the pasta', recipe: 'aglio', ingredient: 'pasta', grams: 200 },
      { what: 'the oil', recipe: 'aglio', ingredient: 'oil', grams: 30 },
    ],
    ['l1', 'l2'],
  )
  return db
}

/** Everything worked out on every row of a format, keyed by a column the text keeps. */
function workedOut(db: Database, name: string, key: string): Record<string, unknown> {
  const declaration = readFormat(db, name)
  if (declaration === undefined) throw new Error(`no ${name}`)
  const rows = listRows(db, declaration)
  const values = derivedOf(db, declaration, rows, indexOf(listFormats(db)), listUnits(db))
  const units = listUnits(db)
  const formats = indexOf(listFormats(db))
  const view = (declaration.derived ?? []).length === 0
    ? undefined
    : db.exec(`SELECT * FROM "${derivedViewNameFor(declaration)}"`)[0]
  const columns = view?.columns ?? []
  return Object.fromEntries(
    rows.map((row) => {
      const inputs = inputsWithAggregates(db, declaration, row, formats, units)
      const sql = view?.values.find((values) => values[0] === row.id) ?? []
      return [
        String(row.cells[key]),
        {
          derived: (values.get(row.id) ?? []).map((each) => [each.compiled.declaration.name, each.value]),
          aggregates: declaration.aggregates.map((each) => [each.name, inputs.numbers.get(each.name) ?? null]),
          sql: (declaration.derived ?? []).map((each) => [each.name, sql[columns.indexOf(each.name)] ?? null]),
        },
      ]
    }),
  )
}

describe('a document whose formats point at each other', () => {
  const cases = [
    { title: 'the shift sheet', build: shifts, formats: [['person', 'name'], ['shift', 'date']] },
    { title: 'a recipe with lines', build: kitchen, formats: [['recipe', 'name'], ['recipe_line', 'what'], ['ingredient', 'name']] },
  ] as const

  for (const { title, build, formats } of cases) {
    for (const as of ['text', 'sqlite'] as const) {
      it(`reopens ${title} saved as ${as}, with everything worked out the same`, async () => {
        const db = await build()
        const reopened = (await openEncoded(await encoded(db, as))).db
        expect(reconcileFormats(reopened)).toEqual([])
        expect(listFormats(reopened)).toEqual(listFormats(db))
        for (const [name, key] of formats) {
          expect(workedOut(reopened, name, key), name).toEqual(workedOut(db, name, key))
        }
      })
    }
  }

  it('reopens two formats whose links name each other, which have no order at all', async () => {
    const team: FormatDeclaration = {
      language: DECLARATION_LANGUAGE,
      name: 'team',
      title: 'Team',
      notes: '',
      columns: [column('name', 'text', { required: true }), column('captain', 'link', { target: 'player' })],
      identities: [],
      aggregates: [aggregate('players', 'COUNT', { format: 'player', column: 'team' })],
      nothingMustHold: true,
    }
    const player: FormatDeclaration = {
      language: DECLARATION_LANGUAGE,
      name: 'player',
      title: 'Player',
      notes: '',
      columns: [column('name', 'text', { required: true }), column('team', 'link', { target: 'team' })],
      identities: [],
      aggregates: [],
      nothingMustHold: true,
    }
    const db = await createDatabase()
    for (const each of [{ ...team, columns: team.columns.slice(0, 1), aggregates: [] }, player, team]) {
      expect(adoptFormat(db, each, NOW).refusals).toEqual([])
    }
    insertRows(db, team, [{ name: 'Reds', captain: null }], ['reds'])
    insertRows(db, player, [{ name: 'Noa', team: 'reds' }, { name: 'Tal', team: 'reds' }], ['noa', 'tal'])
    db.run(`UPDATE fmt_team SET captain = 'tal'`)

    for (const as of ['text', 'sqlite'] as const) {
      const reopened = (await openEncoded(await encoded(db, as))).db
      expect(
        reopened.exec('SELECT t.name, p.name FROM fmt_team t JOIN fmt_player p ON p.' + ROW_ID_COLUMN + ' = t.captain')[0]
          ?.values,
      ).toEqual([['Reds', 'Tal']])
      expect(workedOut(reopened, 'team', 'name')).toEqual(workedOut(db, 'team', 'name'))
    }
  })

  it('works the recipe out, so the comparison above is over figures and not over nothing', async () => {
    const reopened = (await openEncoded(await encoded(await kitchen(), 'text'))).db
    const recipe = workedOut(reopened, 'recipe', 'name')
    expect(recipe['Aglio e olio']).toMatchObject({
      aggregates: [['total_g', 230], ['total_kcal', 970]],
      sql: [['kcal_per_serving', 485]],
    })
    const people = workedOut((await openEncoded(await encoded(await shifts(), 'text'))).db, 'person', 'name')
    expect(people['Dana']).toMatchObject({ aggregates: [['total_hours', 16.5], ['longest', 510]] })
  })
})

/* ---------------------------------- a total of a worked-out column (M29 F7) */

const PAYCHECK: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'paycheck',
  title: 'Paycheck',
  notes: '',
  columns: [column('month', 'text', { required: true }), column('gross', 'money')],
  identities: [identity('gross_is_the_days', 'gross = earned_total')],
  aggregates: [aggregate('earned_total', 'SUM', { format: 'work_day', column: 'paycheck' }, { expression: 'earned' })],
  derived: [derived('unaccounted', 'gross - earned_total')],
  nothingMustHold: false,
}

const WORK_DAY: FormatDeclaration = {
  language: DECLARATION_LANGUAGE,
  name: 'work_day',
  title: 'Work day',
  notes: '',
  columns: [
    column('paycheck', 'link', { target: 'paycheck' }),
    column('start', 'time'),
    column('end', 'time'),
    column('rate', 'money'),
  ],
  identities: [],
  aggregates: [],
  derived: [derived('hours', 'end - start'), derived('earned', 'hours * rate')],
  nothingMustHold: true,
}

async function payroll(): Promise<Database> {
  const db = await createDatabase()
  for (const each of [{ ...PAYCHECK, identities: [], aggregates: [], derived: [], nothingMustHold: true }, WORK_DAY, PAYCHECK]) {
    expect(adoptFormat(db, each, NOW).refusals).toEqual([])
  }
  insertRows(
    db,
    PAYCHECK,
    [
      // 8.5 h at 33.33 is 283.305 a day: 283.31 on each row, 566.62 for two —
      // and 566.61 if the total were rounded once rather than row by row.
      { month: '2026-10', gross_minor: 56_662, gross_currency: 'ILS' },
      { month: '2026-11', gross_minor: 56_661, gross_currency: 'ILS' },
      { month: '2026-12', gross_minor: 56_662, gross_currency: 'USD' },
      { month: '2027-01', gross_minor: 10_000, gross_currency: 'ILS' },
    ],
    ['oct', 'nov', 'dec', 'jan'],
  )
  const day = (paycheck: string, currency = 'ILS'): Record<string, string | number> => ({
    paycheck,
    start: '09:00',
    end: '17:30',
    rate_minor: 3333,
    rate_currency: currency,
  })
  insertRows(
    db,
    WORK_DAY,
    [day('oct'), day('oct'), day('nov'), day('nov'), day('dec'), day('dec'), day('jan'), day('jan', 'USD')],
    ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8'],
  )
  return db
}

describe('a total of a worked-out column (M29 F7)', () => {
  it('is declared, where it used to be refused as a column the source does not have', () => {
    expect(compileDerived(WORK_DAY, [PAYCHECK]).problems).toEqual([])
    expect(compileDerived(PAYCHECK, [WORK_DAY]).problems).toEqual([])
  })

  it('adds up what each row shows, and an identity proves and fails against it', async () => {
    const db = await payroll()
    const formats = indexOf(listFormats(db))
    const units = listUnits(db)
    const paycheck = readFormat(db, 'paycheck')
    if (paycheck === undefined) throw new Error('no paycheck')
    const rows = new Map(listRows(db, paycheck).map((row) => [row.id, row]))
    const of = (id: string): ReturnType<typeof inputsWithAggregates> => {
      const row = rows.get(id)
      if (row === undefined) throw new Error(`no ${id}`)
      return inputsWithAggregates(db, paycheck, row, formats, units)
    }
    const total = (id: string): RowAggregate['value'] => {
      const row = rows.get(id)
      if (row === undefined) throw new Error(`no ${id}`)
      return aggregatesOf(db, paycheck, row, formats, units)[0]?.value ?? { kind: 'UNCHECKED', reason: '' }
    }
    const proof = paycheck.identities[0]
    const sum = paycheck.aggregates[0]
    if (proof === undefined || sum === undefined) throw new Error('no identity or total')

    // Rounded per row, as the rows display it — 2 × 283.31, not 566.61.
    expect(total('oct')).toEqual({ kind: 'VALUE', value: 56_662, unit: undefined, rows: 2, currency: 'ILS' })
    expect(aggregateSentence(sum, total('oct'))).toContain('₪566.62')
    expect(evaluateIdentity(proof, of('oct'), units).kind).toBe('PROVED')
    expect(evaluateIdentity(proof, of('nov'), units)).toMatchObject({ kind: 'FAILED', difference: 1 })

    // A sum in shekels does not prove against a figure in dollars.
    expect(evaluateIdentity(proof, of('dec'), units)).toEqual({
      kind: 'UNCHECKED',
      reason: 'One side is in USD and the other in ILS. Nothing here knows a rate between them.',
    })

    // Shekels and dollars in one fold are no total at all, and the row is named.
    const mixed = total('jan')
    expect(mixed.kind).toBe('UNCHECKED')
    expect(mixed.kind === 'UNCHECKED' ? mixed.reason : '').toMatch(/Row d8 of work_day is in USD and Row d7 in ILS/)
    expect(evaluateIdentity(proof, of('jan'), units).kind).toBe('UNCHECKED')
  })

  it('gives the worked-out column naming the total the same figure in SQL', async () => {
    const db = await payroll()
    const paycheck = readFormat(db, 'paycheck')
    if (paycheck === undefined) throw new Error('no paycheck')
    const values = derivedOf(db, paycheck, listRows(db, paycheck), indexOf(listFormats(db)), listUnits(db))
    const at = (id: string): unknown => values.get(id)?.[0]?.value
    expect(at('oct')).toEqual({ kind: 'MONEY', minor: 0, currency: 'ILS' })
    expect(at('nov')).toEqual({ kind: 'MONEY', minor: -1, currency: 'ILS' })
    expect(at('dec')).toMatchObject({ kind: 'EMPTY' })
    expect(at('jan')).toMatchObject({ kind: 'EMPTY' })
  })
})

describe('a latest or earliest total, worked out (M36 U05)', () => {
  const THING: FormatDeclaration = {
    language: DECLARATION_LANGUAGE,
    name: 'thing',
    title: 'Thing',
    notes: '',
    columns: [column('name', 'text', { required: true }), column('paid', 'money')],
    identities: [],
    aggregates: [
      aggregate('worth', 'LATEST', { format: 'reading', column: 'thing' }, { expression: 'value', by: 'as_of' }),
      aggregate('first', 'EARLIEST', { format: 'reading', column: 'thing' }, { expression: 'value', by: 'as_of' }),
      aggregate('last_printed', 'LATEST', { format: 'reading', column: 'thing' }, {
        expression: 'value',
        by: 'as_of',
        where: { column: 'kind', is: 'PRINTED' },
      }),
    ],
    derived: [
      derived('now', 'worth'),
      derived('then', 'first'),
      derived('growth', 'worth - paid'),
      derived('since_first', 'worth - first'),
      derived('printed', 'last_printed'),
    ],
    nothingMustHold: true,
  }
  const READING: FormatDeclaration = {
    language: DECLARATION_LANGUAGE,
    name: 'reading',
    title: 'Reading',
    notes: '',
    columns: [
      column('thing', 'link', { target: 'thing' }),
      column('as_of', 'date'),
      column('value', 'money'),
      column('kind', 'enum', { values: ['PRINTED', 'GUESSED'] }),
    ],
    identities: [],
    aggregates: [],
    nothingMustHold: true,
  }

  async function readings(): Promise<Database> {
    const db = await createDatabase()
    for (const each of [{ ...THING, aggregates: [], derived: [] }, READING, THING]) {
      expect(adoptFormat(db, each, NOW).refusals).toEqual([])
    }
    const paid = (minor: number) => ({ paid_minor: minor, paid_currency: 'ILS' })
    insertRows(
      db,
      THING,
      [
        { name: 'Plain', ...paid(1000) },
        { name: 'Tied', ...paid(1000) },
        { name: 'Undated', ...paid(1000) },
        { name: 'Unread', ...paid(1000) },
        { name: 'Blank', ...paid(1000) },
      ],
      ['plain', 'tied', 'undated', 'unread', 'blank'],
    )
    const read = (thing: string, asOf: string | null, minor: number | null, kind: string | null = 'PRINTED') => ({
      thing,
      as_of: asOf,
      value_minor: minor,
      value_currency: minor === null ? null : 'ILS',
      kind,
    })
    insertRows(db, READING, [
      read('plain', '2026-05-31', 900),
      read('plain', '2026-07-31', 1300, 'GUESSED'),
      read('plain', '2026-06-30', 1250),
      read('tied', '2026-06-30', 1100),
      read('tied', '2026-06-30', 1200),
      read('tied', '2026-01-01', 1000),
      read('undated', '2026-06-30', 1100),
      read('undated', null, 1200),
      // The latest has nothing in it, and only the latest has to answer.
      read('blank', '2026-05-31', 800),
      read('blank', '2026-06-30', null),
    ])
    return db
  }

  it('picks the one row by its order, and is empty on a tie, an undated row, no row, or a latest that cannot answer', async () => {
    const db = await readings()
    const view = db.exec(`SELECT id, now_minor, then_minor, growth_minor, since_first_minor, printed_minor
                            FROM ${derivedViewNameFor(THING)} ORDER BY id`)[0]
    const rows = Object.fromEntries(view?.values.map(([id, ...rest]) => [String(id), rest]) ?? [])
    expect(rows).toEqual({
      plain: [1300, 900, 300, 400, 1250],
      tied: [null, 1000, null, null, null],
      undated: [null, null, null, null, null],
      unread: [null, null, null, null, null],
      blank: [null, 800, null, null, null],
    })
  })

  it('gives the same answer in SQL and in TypeScript', async () => {
    const db = await readings()
    const formats = indexOf(listFormats(db))
    const units = listUnits(db)
    const declaration = readFormat(db, 'thing')
    if (declaration === undefined) throw new Error('no thing')
    const neighbours = [...formats.values()].filter((each) => each.name !== 'thing')
    const { compiled, problems } = compileDerived(declaration, neighbours, units)
    expect(problems).toEqual([])
    const select = derivedSelectSql(declaration, neighbours, false) ?? ''
    const result = db.exec(select)[0]
    const names = result?.columns ?? []
    const sql = new Map(
      result?.values.map((values) => [String(values[0]), Object.fromEntries(names.map((name, index) => [name, values[index]]))]) ?? [],
    )
    let compared = 0
    for (const row of listRows(db, declaration)) {
      const inputs = inputsWithAggregates(db, declaration, row, formats, units)
      for (const each of compiled) {
        const fromTs = evaluateDerived(each, inputs, units)
        const fromSql = (sql.get(row.id) ?? {})[`${each.declaration.name}_minor`]
        const label = `${row.id}.${each.declaration.name}`
        if (fromTs.kind === 'MONEY') expect(fromSql, label).toBe(fromTs.minor)
        else expect(fromSql, label).toBeNull()
        compared += 1
      }
    }
    expect(compared).toBe(25)
  })
})
