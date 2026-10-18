/**
 * **The half of U1 no pure test can prove**: that a declaration becomes a table
 * SQLite actually accepts, with types and `CHECK`s that actually bite.
 *
 * The domain tests say what the plan is. These say the plan runs — which is the
 * difference between a declaration language and a table you can put a row in.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { read } from '@/domain/format/artefact.ts'
import { rowConstraint, type RowConstraint } from '@/domain/format/constraint.ts'
import { column, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { exportEncoded, openEncoded } from '../storage/encoding.ts'
import { createDatabase, query } from '../db/database.ts'
import {
  adoptFormat,
  deleteFormat,
  listFormats,
  observe,
  orphanedTables,
  pendingPlans,
  planFor,
  reconcileFormats,
  rowsBreaking,
  saveFormat,
  unreadableFormats,
} from './formatRepository.ts'
import { repeatedValues } from './formatRowRepository.ts'
import { columnWidths, setColumnWidth } from './formatViewRepository.ts'

const PASTA = (() => {
  const result = read(
    readFileSync(
      fileURLToPath(new URL('../../../fixtures/synthetic/ingredient.format.md', import.meta.url)),
      'utf8',
    ),
  )
  if (!result.ok) throw new Error(result.error)
  return result.value
})()

const NOW = Date.UTC(2026, 8, 15)

function declaration(columns: FormatDeclaration['columns']): FormatDeclaration {
  return {
    language: 1,
    name: 'thing',
    title: 'Thing',
    notes: '',
    columns,
    identities: [],
    aggregates: [],
    nothingMustHold: true,
  }
}

function columnsOf(db: Database, table: string): readonly string[] {
  return query(db, `PRAGMA table_info(${table})`).map((row) => String(row['name']))
}

describe('the ingredient format', () => {
  it('compiles to a real table', async () => {
    // engine.md's own acceptance test, run against SQLite rather than against a
    // string: "if a declaration can hold that note, the engine exists".
    const db = await createDatabase()
    const plan = adoptFormat(db, PASTA, NOW)

    expect(plan.refusals).toEqual([])
    const columns = columnsOf(db, 'fmt_ingredient')
    expect(columns[0]).toBe('id')
    expect(columns).toContain('cooked_yield_factor')
    expect(columns).toContain('micros_basis')
    // Money is two columns, in a table the user declared, because the app's
    // oldest rule has no exception for one.
    expect(columns).toContain('price_minor')
    expect(columns).toContain('price_currency')
  })

  it('takes the pasta row, and the types are the types', async () => {
    const db = await createDatabase()
    adoptFormat(db, PASTA, NOW)

    db.run(
      `INSERT INTO fmt_ingredient
         (id, name, brand, basis, per_quantity, cooked_yield_factor, kcal, protein_g,
          carbs_g, fat_g, micros_basis, verified, price_minor, price_currency)
       VALUES ('1', 'Pasta', 'Barilla Conchiglie Rigate n.93', 'dry', 100, 2.0, 359, 13,
               74, 2, 'analogue', '2026-09-13', 990, 'ILS')`,
    )

    const row = query(db, 'SELECT kcal, cooked_yield_factor, price_minor FROM fmt_ingredient')[0]
    expect(row?.['kcal']).toBe(359)
    expect(row?.['cooked_yield_factor']).toBe(2)
    expect(row?.['price_minor']).toBe(990)
  })

  it('refuses a row the declaration says is impossible', async () => {
    const db = await createDatabase()
    adoptFormat(db, PASTA, NOW)

    // The enum: `micros_basis` is label, analogue or mixed and nothing else.
    expect(() =>
      db.run(
        "INSERT INTO fmt_ingredient (id, name, basis, per_quantity, kcal, protein_g, carbs_g, fat_g, micros_basis) VALUES ('1', 'x', 'dry', 100, 1, 1, 1, 1, 'guessed')",
      ),
    ).toThrow()

    // The bound: energy is not negative.
    expect(() =>
      db.run(
        "INSERT INTO fmt_ingredient (id, name, basis, per_quantity, kcal, protein_g, carbs_g, fat_g, micros_basis) VALUES ('2', 'x', 'dry', 100, -1, 1, 1, 1, 'label')",
      ),
    ).toThrow()

    // Required is NOT NULL.
    expect(() =>
      db.run("INSERT INTO fmt_ingredient (id, basis, per_quantity) VALUES ('3', 'dry', 100)"),
    ).toThrow()

    // A date is date-only, `YYYY-MM-DD`, never an epoch (D-023).
    expect(() =>
      db.run(
        "INSERT INTO fmt_ingredient (id, name, basis, per_quantity, kcal, protein_g, carbs_g, fat_g, micros_basis, verified) VALUES ('4', 'x', 'dry', 100, 1, 1, 1, 1, 'label', '13/09/2026')",
      ),
    ).toThrow()
  })

  it('leaves an optional column free to be empty', async () => {
    // Every check is written `column IS NULL OR …`. Writing it the other way
    // would make every optional column secretly mandatory.
    const db = await createDatabase()
    adoptFormat(db, PASTA, NOW)

    expect(() =>
      db.run(
        "INSERT INTO fmt_ingredient (id, name, basis, per_quantity, kcal, protein_g, carbs_g, fat_g, micros_basis) VALUES ('1', 'x', 'dry', 100, 1, 1, 1, 1, 'label')",
      ),
    ).not.toThrow()
  })

  it('reads back as the declaration that was written', async () => {
    const db = await createDatabase()
    adoptFormat(db, PASTA, NOW)

    expect(listFormats(db)[0]).toEqual(PASTA)
  })
})

describe('reconciling on open', () => {
  it('creates a table for a declaration that has none, and is idempotent', async () => {
    // The unlock: the declarations are the source of truth and live in the
    // document, so a build that never shipped `fmt_thing` still ends up with
    // it. No migration chain, and running it twice is running it once (D-214).
    const db = await createDatabase()
    saveFormat(db, declaration([column('label', 'text', { required: true })]), NOW)

    expect(observe(db, declaration([]))).toBeUndefined()
    expect(reconcileFormats(db)).toEqual([])
    expect(columnsOf(db, 'fmt_thing')).toEqual(['id', 'label'])

    expect(reconcileFormats(db)).toEqual([])
    expect(pendingPlans(db)).toEqual([])
  })

  it('adds a column the stored declaration gained', async () => {
    const db = await createDatabase()
    saveFormat(db, declaration([column('label', 'text')]), NOW)
    reconcileFormats(db)

    saveFormat(db, declaration([column('label', 'text'), column('grams', 'real', { unit: 'g' })]), NOW)
    expect(reconcileFormats(db)).toEqual([])
    expect(columnsOf(db, 'fmt_thing')).toEqual(['id', 'label', 'grams'])
  })

  it('never stops a document opening, however badly the two disagree', async () => {
    const db = await createDatabase()
    adoptFormat(db, declaration([column('label', 'text'), column('note', 'text')]), NOW)
    db.run("INSERT INTO fmt_thing (id, label, note) VALUES ('1', 'a', 'kept')")

    // The declaration loses a column the table has data in — straight into the
    // first refusal, at the moment of open.
    saveFormat(db, declaration([column('label', 'text')]), NOW)

    const refused = reconcileFormats(db)
    expect(refused).toHaveLength(1)
    expect(refused[0]?.refusals[0]?.reason).toBe('DROP_WITH_DATA')
    // Nothing was written: the figures are still there and a person is asked.
    expect(columnsOf(db, 'fmt_thing')).toContain('note')
    expect(query(db, 'SELECT note FROM fmt_thing')[0]?.['note']).toBe('kept')
  })

  it('leaves a format from a newer declaration language alone, and says so', async () => {
    const db = await createDatabase()
    saveFormat(db, { ...declaration([column('label', 'text')]), language: 99 }, NOW)

    expect(listFormats(db)).toEqual([])
    expect(unreadableFormats(db)[0]?.reason).toContain('format language 99')
    // Not reconciled, so no table was made from a declaration nobody here
    // understands.
    expect(reconcileFormats(db)).toEqual([])
    expect(orphanedTables(db)).toEqual([])
  })
})

describe('adopting an edited declaration', () => {
  it('writes nothing at all when the plan carries a refusal', async () => {
    // Refuses as a unit. Half a format is worse than none: the declaration
    // would describe a table the document has not got, and the next open would
    // reconcile toward it without anybody having agreed.
    const db = await createDatabase()
    adoptFormat(db, declaration([column('grams', 'real', { unit: 'g' })]), NOW)
    db.run("INSERT INTO fmt_thing (id, grams) VALUES ('1', 100)")

    const plan = adoptFormat(
      db,
      declaration([column('grams', 'real', { unit: 'mg' }), column('extra', 'text')]),
      NOW,
    )

    expect(plan.refusals[0]?.reason).toBe('UNIT_CHANGED')
    expect(columnsOf(db, 'fmt_thing')).not.toContain('extra')
    expect(listFormats(db)[0]?.columns[0]?.unit).toBe('g')
  })

  it('rebuilds a column whose type changed while it was still empty', async () => {
    const db = await createDatabase()
    adoptFormat(db, declaration([column('count', 'text')]), NOW)

    const plan = adoptFormat(db, declaration([column('count', 'integer')]), NOW)

    expect(plan.refusals).toEqual([])
    expect(
      query(db, 'PRAGMA table_info(fmt_thing)').find((row) => row['name'] === 'count')?.['type'],
    ).toBe('INTEGER')
  })

  it('shows the plan before it is run', async () => {
    const db = await createDatabase()
    adoptFormat(db, declaration([column('label', 'text')]), NOW)

    const plan = planFor(db, declaration([column('label', 'text'), column('grams', 'real')]))

    expect(plan.steps.map((step) => [step.kind, step.column])).toEqual([['ADD_COLUMN', 'grams']])
    // Asked, not done.
    expect(columnsOf(db, 'fmt_thing')).toEqual(['id', 'label'])
  })
})

describe('making a required column optional (M36 U08)', () => {
  it('keeps every value, a link, money’s two columns and a unique index alike', async () => {
    const db = await createDatabase()
    adoptFormat(db, { ...declaration([column('label', 'text')]), name: 'shelf', title: 'Shelf' }, NOW)
    db.run("INSERT INTO fmt_shelf (id, label) VALUES ('s1', 'Top')")
    const required = declaration([
      column('code', 'text', { required: true, unique: true }),
      column('price', 'money', { required: true }),
      column('shelf', 'link', { target: 'shelf', required: true }),
    ])
    adoptFormat(db, required, NOW)
    db.run("INSERT INTO fmt_thing (id, code, price_minor, price_currency, shelf) VALUES ('1', 'A1', 1290, 'ILS', 's1')")

    const loose = declaration([
      column('code', 'text', { unique: true }),
      column('price', 'money'),
      column('shelf', 'link', { target: 'shelf' }),
    ])
    const plan = adoptFormat(db, loose, NOW)

    expect(plan.refusals).toEqual([])
    expect(plan.steps.map((step) => [step.kind, step.column])).toEqual([
      ['LOOSEN_COLUMN', 'code'],
      ['LOOSEN_COLUMN', 'price'],
      ['LOOSEN_COLUMN', 'shelf'],
    ])
    expect(query(db, 'SELECT code, price_minor, price_currency, shelf FROM fmt_thing')).toEqual([
      { code: 'A1', price_minor: 1290, price_currency: 'ILS', shelf: 's1' },
    ])
    db.run("INSERT INTO fmt_thing (id) VALUES ('2')")
    expect(() => db.run("INSERT INTO fmt_thing (id, code) VALUES ('3', 'A1')")).toThrow()
    // Settled: the table is what the declaration compiles to, and a second open changes nothing.
    expect(planFor(db, loose).steps).toEqual([])
  })

  it('still refuses the other way, making one with values required', async () => {
    const db = await createDatabase()
    adoptFormat(db, declaration([column('label', 'text')]), NOW)
    db.run("INSERT INTO fmt_thing (id, label) VALUES ('1', 'A'), ('2', NULL)")

    const plan = planFor(db, declaration([column('label', 'text', { required: true })]))

    expect(plan.refusals.map((each) => each.reason)).toEqual(['CONSTRAINT_CHANGED'])
  })
})

describe('a pack rebuilding its own table (M36 U09)', () => {
  /** A format a pack owns, at the language that can say so. */
  function owned(columns: FormatDeclaration['columns']): FormatDeclaration {
    return {
      ...declaration(columns),
      language: 13,
      owner: { pack: 'shop', written: 'by the shop', columns: columns.map((each) => each.name) },
    }
  }
  const before = (): FormatDeclaration =>
    owned([
      column('label', 'text', { required: true }),
      column('kind', 'enum', { required: true, values: ['A', 'B', 'OLD'] }),
      column('price', 'money'),
      column('stale', 'boolean', { required: true }),
    ])
  const after = (): FormatDeclaration =>
    owned([
      column('label', 'text', { required: true }),
      column('kind', 'enum', { required: true, values: ['A', 'B', 'C'] }),
      column('price', 'money'),
    ])
  async function filled(): Promise<Database> {
    const db = await createDatabase()
    adoptFormat(db, before(), NOW)
    db.run(`INSERT INTO fmt_thing (id, label, kind, price_minor, price_currency, stale) VALUES
      ('1', 'Tea', 'A', 1290, 'ILS', 1), ('2', 'שמן זית', 'B', NULL, NULL, 0), ('3', 'Rice', 'A', 500, 'ILS', 1)`)
    return db
  }
  // Not by id: a document stored as text renews its ids on every write (D-246).
  const rowsOf = (db: Database) => query(db, 'SELECT label, kind, price_minor, price_currency FROM fmt_thing ORDER BY label')

  it('drops a column holding data and re-lists an enum, keeping every row, only where the pack vouches', async () => {
    const db = await filled()
    const kept = rowsOf(db)
    // Unvouched, the drop is D-216's refusal; a list every row fits needs no
    // vouch since M38 U6 (D-412).
    expect(planFor(db, after()).refusals.map((each) => [each.reason, each.column])).toEqual([
      ['DROP_WITH_DATA', 'stale'],
    ])

    const plan = adoptFormat(db, after(), NOW, new Map(), new Set(['kind', 'stale']))

    expect(plan.refusals).toEqual([])
    expect(plan.steps.map((step) => [step.kind, step.column])).toEqual([
      ['DROP_COLUMN', 'stale'],
      ['REBUILD_TABLE', 'kind'],
    ])
    expect(rowsOf(db)).toEqual(kept)
    expect(columnsOf(db, 'fmt_thing')).not.toContain('stale')
    // The new list is the rule now: a new member goes in, a retired one does not.
    db.run("INSERT INTO fmt_thing (id, label, kind) VALUES ('4', 'Salt', 'C')")
    expect(() => db.run("INSERT INTO fmt_thing (id, label, kind) VALUES ('5', 'Sugar', 'OLD')")).toThrow()
    expect(() => db.run("INSERT INTO fmt_thing (id, kind) VALUES ('6', 'A')")).toThrow()
    // Settled: a second open plans nothing.
    expect(planFor(db, after()).steps).toEqual([])
  })

  it('still refuses a list that would refuse a value the rows hold, by name', async () => {
    const db = await filled()
    db.run("UPDATE fmt_thing SET kind = 'OLD' WHERE id = '3'")

    const plan = adoptFormat(db, after(), NOW, new Map(), new Set(['kind', 'stale']))

    expect(plan.refusals.map((each) => [each.reason, each.column])).toEqual([['CONSTRAINT_CHANGED', 'kind']])
    expect(plan.refusals[0]?.detail).toContain('OLD')
    expect(columnsOf(db, 'fmt_thing')).toContain('stale')
  })

  it('never vouches for a person’s format — though their list every row fits is rebuilt (D-412)', async () => {
    const db = await createDatabase()
    const { owner: _none, ...theirs } = before()
    adoptFormat(db, theirs, NOW)
    db.run("INSERT INTO fmt_thing (id, label, kind, stale) VALUES ('1', 'Tea', 'A', 1)")
    const { owner: _also, ...next } = after()

    const plan = adoptFormat(db, next, NOW, new Map(), new Set(['kind', 'stale']))

    expect(plan.refusals.map((each) => each.reason)).toEqual(['DROP_WITH_DATA'])
    expect(columnsOf(db, 'fmt_thing')).toContain('stale')
  })

  it('keeps a document stored as text whole across the rebuild', async () => {
    const db = await filled()
    const kept = rowsOf(db)
    const first = await exportEncoded(db, 'text')
    if (!first.ok) throw new Error(first.error)
    const { db: opened } = await openEncoded(first.value)

    expect(adoptFormat(opened, after(), NOW, new Map(), new Set(['kind', 'stale'])).refusals).toEqual([])
    const second = await exportEncoded(opened, 'text')
    if (!second.ok) throw new Error(second.error)
    const { db: back } = await openEncoded(second.value)

    expect(rowsOf(back)).toEqual(kept)
    expect(listFormats(back).find((each) => each.name === 'thing')?.columns.find((each) => each.name === 'kind')?.values).toEqual(['A', 'B', 'C'])
    expect(columnsOf(back, 'fmt_thing')).not.toContain('stale')
    expect(planFor(back, after()).steps).toEqual([])
    // And text that says the same thing twice is the same text.
    const third = await exportEncoded(back, 'text')
    if (!third.ok) throw new Error(third.error)
    expect(new TextDecoder().decode(third.value)).toBe(new TextDecoder().decode(second.value))
  })
})

describe('a list every row fits, on anybody’s format (M38 U6, D-412)', () => {
  const plain = (): FormatDeclaration =>
    declaration([column('label', 'text', { required: true }), column('kind', 'text')])
  async function filled(): Promise<Database> {
    const db = await createDatabase()
    adoptFormat(db, plain(), NOW)
    db.run("INSERT INTO fmt_thing (id, label, kind) VALUES ('1', 'Tea', 'A'), ('2', 'Rice', 'B'), ('3', 'Salt', NULL)")
    return db
  }
  const listed = (name: string, values: readonly string[]): FormatDeclaration =>
    declaration([column('label', 'text', { required: true }), column(name, 'enum', { values })])

  it('makes a text an enum, renamed in the same change, keeping every row', async () => {
    const db = await filled()
    const plan = adoptFormat(db, listed('sort', ['A', 'B', 'C']), NOW, new Map([['sort', 'kind']]))

    expect(plan.refusals).toEqual([])
    expect(plan.steps.map((step) => step.kind)).toEqual(['RENAME_COLUMN', 'REBUILD_TABLE'])
    expect(query(db, 'SELECT label, sort FROM fmt_thing ORDER BY id')).toEqual([
      { label: 'Tea', sort: 'A' },
      { label: 'Rice', sort: 'B' },
      { label: 'Salt', sort: null },
    ])
    expect(() => db.run("INSERT INTO fmt_thing (id, label, sort) VALUES ('4', 'Oil', 'D')")).toThrow()
  })

  it('refuses a list a held value is not on, naming the value, and an enum made a text is always kept', async () => {
    const db = await filled()
    const refused = adoptFormat(db, listed('kind', ['A', 'C']), NOW)
    expect(refused.refusals.map((each) => [each.reason, each.column])).toEqual([['TYPE_CHANGED', 'kind']])
    expect(refused.refusals[0]?.detail).toContain('hold B')

    expect(adoptFormat(db, listed('kind', ['A', 'B']), NOW).refusals).toEqual([])
    expect(adoptFormat(db, plain(), NOW).refusals).toEqual([])
    db.run("INSERT INTO fmt_thing (id, label, kind) VALUES ('4', 'Oil', 'anything')")
  })
})

describe('renaming a column (M26 U3)', () => {
  it('keeps every value under the new name, money’s two columns and a unique index both', async () => {
    const db = await createDatabase()
    adoptFormat(
      db,
      declaration([column('code', 'text', { unique: true }), column('price', 'money')]),
      NOW,
    )
    db.run("INSERT INTO fmt_thing (id, code, price_minor, price_currency) VALUES ('1', 'A1', 1290, 'ILS')")
    setColumnWidth(db, 'thing', 'price', 220)

    const next = declaration([column('sku', 'text', { unique: true }), column('cost', 'money')])
    // Without the rename it is a drop with data, and refused.
    expect(planFor(db, next).refusals.map((each) => each.reason)).toContain('DROP_WITH_DATA')

    const renames = new Map([['sku', 'code'], ['cost', 'price']])
    const plan = adoptFormat(db, next, NOW, renames)

    expect(plan.refusals).toEqual([])
    expect(plan.steps.map((step) => step.kind)).toEqual(['RENAME_COLUMN', 'RENAME_COLUMN'])
    expect(columnsOf(db, 'fmt_thing')).toEqual(['id', 'sku', 'cost_minor', 'cost_currency'])
    expect(query(db, 'SELECT sku, cost_minor, cost_currency FROM fmt_thing')).toEqual([
      { sku: 'A1', cost_minor: 1290, cost_currency: 'ILS' },
    ])
    // The index is the reconciler's again, under the name it would give it.
    expect(observe(db, next)?.columns.find((each) => each.name === 'sku')?.unique).toBe(true)
    expect(planFor(db, next).steps).toEqual([])
    expect(columnWidths(db, 'thing')).toEqual(new Map([['cost', 220]]))
  })

  it('judges a type change made in the same edit as it would without the rename', async () => {
    const db = await createDatabase()
    adoptFormat(db, declaration([column('grams', 'real', { unit: 'g' })]), NOW)
    db.run("INSERT INTO fmt_thing (id, grams) VALUES ('1', 100)")

    const plan = adoptFormat(
      db,
      declaration([column('weight', 'real', { unit: 'kg' })]),
      NOW,
      new Map([['weight', 'grams']]),
    )

    expect(plan.refusals.map((each) => each.reason)).toEqual(['UNIT_CHANGED'])
    expect(columnsOf(db, 'fmt_thing')).toEqual(['id', 'grams'])
  })

  it('refuses a name the table already has a column under', async () => {
    const db = await createDatabase()
    adoptFormat(db, declaration([column('a', 'text'), column('b', 'text')]), NOW)
    db.run("INSERT INTO fmt_thing (id, a, b) VALUES ('1', 'x', 'y')")

    const plan = planFor(
      db,
      declaration([column('b', 'text')]),
      new Map([['b', 'a']]),
    )

    expect(plan.refusals.map((each) => each.reason)).toContain('NAME_TAKEN')
  })
})

describe('the fmt_ prefix', () => {
  it('is what keeps the reconciler away from the app’s own tables', async () => {
    const db = await createDatabase()
    adoptFormat(db, PASTA, NOW)

    const touched = query(
      db,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'fmt_%'",
    ).map((row) => String(row['name']))

    // Every table the engine keeps for itself, untouched and unnamed by any
    // plan the reconciler can produce. The same guard let the engine be built
    // beside the ledger rather than on top of it (D-214), until U8 left the
    // ledger no table that is not one of these.
    expect(touched).toContain('format')
    expect(touched).not.toContain('fmt_ingredient')
  })

  it('leaves an orphaned declared table strictly alone', async () => {
    const db = await createDatabase()
    adoptFormat(db, declaration([column('label', 'text')]), NOW)
    db.run("INSERT INTO fmt_thing (id, label) VALUES ('1', 'kept')")

    db.run("DELETE FROM format WHERE name = 'thing'")

    expect(orphanedTables(db)).toEqual(['fmt_thing'])
    expect(reconcileFormats(db)).toEqual([])
    expect(query(db, 'SELECT label FROM fmt_thing')[0]?.['label']).toBe('kept')
  })
})

describe('deleting a format', () => {
  it('takes the declaration and its table together, because the caller has asked', async () => {
    const db = await createDatabase()
    adoptFormat(db, declaration([column('label', 'text')]), NOW)

    deleteFormat(db, 'thing')

    expect(listFormats(db)).toEqual([])
    expect(orphanedTables(db)).toEqual([])
    expect(
      query(db, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'fmt_thing'"),
    ).toEqual([])
  })
})

describe('identities in the document', () => {
  it('stores what has to add up, and reads it back exactly', async () => {
    // Including the spaces: the expression is the person's arithmetic and the
    // artefact exists to be diffed, so nothing normalizes it (D-222).
    const db = await createDatabase()
    adoptFormat(db, PASTA, NOW)

    const [back] = listFormats(db)
    expect(back?.identities).toEqual(PASTA.identities)
    expect(back?.identities[0]?.expression).toBe(
      '4*protein_g + 4*(carbs_g - fiber_g) + 9*fat_g + 2*fiber_g = kcal',
    )
    expect(back?.nothingMustHold).toBe(false)
  })

  it('changes an identity without touching the table, because it compiles to no SQL', async () => {
    // **The whole difference between a CHECK and an identity.** A unit change is
    // refused because it re-means stored data; an identity change re-judges it,
    // so the plan has nothing in it at all.
    const db = await createDatabase()
    adoptFormat(db, PASTA, NOW)
    const before = columnsOf(db, 'fmt_ingredient')

    const changed = {
      ...PASTA,
      identities: [{ ...PASTA.identities[0]!, tolerance: { kind: 'ABSOLUTE' as const, amount: 5 } }],
      aggregates: [],
    }
    const plan = planFor(db, changed)
    expect(plan.steps).toEqual([])
    expect(plan.refusals).toEqual([])

    adoptFormat(db, changed, NOW)
    expect(columnsOf(db, 'fmt_ingredient')).toEqual(before)
    expect(listFormats(db)[0]?.identities[0]?.tolerance).toEqual({ kind: 'ABSOLUTE', amount: 5 })
  })

  it('takes an identity away with the format it belonged to', async () => {
    const db = await createDatabase()
    adoptFormat(db, PASTA, NOW)
    deleteFormat(db, PASTA.name)
    expect(query(db, 'SELECT COUNT(*) AS n FROM format_identity')[0]?.['n']).toBe(0)
  })
})

describe('row constraints in the document (M24 U7, D-259)', () => {
  const debt = (constraints: readonly RowConstraint[]): FormatDeclaration => ({
    ...declaration([
      column('track', 'enum', { values: ['NONE', 'MANUAL'], required: true }),
      column('track_ref', 'text'),
      column('amount', 'money'),
    ]),
    language: 7,
    constraints,
  })
  const TRACKED = rowConstraint('REQUIRED_WHEN', ['track_ref'], {
    when: 'track',
    is: ['MANUAL'],
    only: true,
  })

  it('compiles to triggers that refuse a row in the rule’s own words', async () => {
    const db = await createDatabase()
    expect(adoptFormat(db, debt([TRACKED]), NOW).refusals).toEqual([])

    db.run("INSERT INTO fmt_thing (id, track, track_ref) VALUES ('a', 'MANUAL', 'card')")
    expect(() => db.run("INSERT INTO fmt_thing (id, track) VALUES ('b', 'MANUAL')")).toThrow(
      'thing: track_ref is required only when track is MANUAL',
    )
    expect(() => db.run("UPDATE fmt_thing SET track = 'NONE' WHERE id = 'a'")).toThrow(
      'track_ref is required only when',
    )
    expect(listFormats(db)[0]?.constraints).toEqual([TRACKED])
  })

  it('counts the rows a new one would break, and takes one away with its triggers', async () => {
    const db = await createDatabase()
    adoptFormat(db, debt([]), NOW)
    db.run("INSERT INTO fmt_thing (id, track) VALUES ('a', 'MANUAL'), ('b', 'NONE')")

    const plan = planFor(db, debt([TRACKED]))
    expect(plan.refusals).toMatchObject([{ reason: 'NOT_HELD' }])
    expect(rowsBreaking(db, debt([TRACKED]), TRACKED)).toEqual(['a'])

    db.run("UPDATE fmt_thing SET track_ref = 'card' WHERE id = 'a'")
    expect(adoptFormat(db, debt([TRACKED]), NOW).refusals).toEqual([])
    expect(observe(db, debt([TRACKED]))?.checks).toHaveLength(1)

    adoptFormat(db, debt([]), NOW)
    expect(
      // The constraint's triggers, not the ones that mark a change (M47 U5).
      query(db, "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'fmt_thing' AND name LIKE '%check%'"),
    ).toEqual([])
    expect(listFormats(db)[0]?.constraints).toBeUndefined()
  })

  it('keeps its triggers through a column rebuilt beside it', async () => {
    // SQLite will not drop a column a trigger reads, so the plan takes every
    // trigger down first and puts it back last.
    const db = await createDatabase()
    adoptFormat(db, { ...debt([TRACKED]), columns: [...debt([]).columns, column('spare', 'text')] }, NOW)
    const retyped = { ...debt([TRACKED]), columns: [...debt([]).columns, column('spare', 'integer')] }
    expect(adoptFormat(db, retyped, NOW).refusals).toEqual([])
    expect(() => db.run("INSERT INTO fmt_thing (id, track) VALUES ('b', 'MANUAL')")).toThrow()
  })

  it('survives a text save and open, rule and triggers both', async () => {
    const db = await createDatabase()
    adoptFormat(db, debt([{ ...TRACKED, note: 'a reference nothing reads is a lie' }]), NOW)
    const encoded = await exportEncoded(db, 'text')
    if (!encoded.ok) throw new Error(encoded.error)
    expect(new TextDecoder().decode(encoded.value)).toContain(
      '| track_ref is required only when track is MANUAL | a reference nothing reads is a lie |',
    )

    const { db: back } = await openEncoded(encoded.value)
    expect(listFormats(back)[0]?.constraints?.[0]?.note).toBe('a reference nothing reads is a lie')
    expect(() => back.run("INSERT INTO fmt_thing (id, track) VALUES ('b', 'MANUAL')")).toThrow()
  })
})

describe('one row per in the document (M25 E1, D-270)', () => {
  const allocation = (constraints: readonly RowConstraint[]): FormatDeclaration => ({
    ...declaration([
      column('plan', 'text', { required: true }),
      column('bucket', 'text'),
      column('mode', 'enum', { values: ['PERCENTAGE', 'REMAINDER'], required: true }),
    ]),
    language: 9,
    constraints,
  })
  const PER_BUCKET = rowConstraint('ONE_PER', ['plan', 'bucket'])
  const ONE_REMAINDER = rowConstraint('ONE_PER', ['plan'], { when: 'mode', is: ['REMAINDER'] })

  it('is a unique index, partial under a when, and empty cells collide with nothing', async () => {
    const db = await createDatabase()
    expect(adoptFormat(db, allocation([PER_BUCKET, ONE_REMAINDER]), NOW).refusals).toEqual([])
    db.run(
      "INSERT INTO fmt_thing (id, plan, bucket, mode) VALUES ('a', 'p', 'b1', 'PERCENTAGE'), " +
        "('b', 'p', 'b2', 'PERCENTAGE'), ('c', 'p', NULL, 'REMAINDER'), ('d', 'p', NULL, 'PERCENTAGE')",
    )
    expect(() =>
      db.run("INSERT INTO fmt_thing (id, plan, bucket, mode) VALUES ('e', 'p', 'b1', 'PERCENTAGE')"),
    ).toThrow('UNIQUE')
    expect(() =>
      db.run("INSERT INTO fmt_thing (id, plan, bucket, mode) VALUES ('f', 'p', 'b3', 'REMAINDER')"),
    ).toThrow('UNIQUE')
    expect(observe(db, allocation([PER_BUCKET, ONE_REMAINDER]))?.checks).toHaveLength(2)
    expect(listFormats(db)[0]?.constraints).toEqual([PER_BUCKET, ONE_REMAINDER])
  })

  it('refuses a repeat at the write, against the table and the batch, naming the row', async () => {
    const db = await createDatabase()
    adoptFormat(db, allocation([PER_BUCKET, ONE_REMAINDER]), NOW)
    db.run("INSERT INTO fmt_thing (id, plan, bucket, mode) VALUES ('a', 'p', 'b1', 'REMAINDER')")

    const repeats = repeatedValues(db, allocation([PER_BUCKET, ONE_REMAINDER]), [
      { plan: 'p', bucket: 'b1', mode: 'PERCENTAGE' },
      { plan: 'q', bucket: 'b1', mode: 'REMAINDER' },
      { plan: 'q', bucket: 'b2', mode: 'REMAINDER' },
      { plan: 'p', bucket: 'b9', mode: 'PERCENTAGE' },
    ])
    expect(repeats.map((each) => each.row)).toEqual([0, 2])
    expect(repeats[0]?.message).toContain('plan, bucket are "p", "b1", which the row a already holds')
    expect(repeats[1]?.message).toContain('row 2 of the same batch')
    expect(repeats[1]?.message).toContain('one row per plan when mode is REMAINDER')

    // An update keeping its own values is not a repeat of itself.
    expect(repeatedValues(db, allocation([PER_BUCKET]), [{ plan: 'p', bucket: 'b1', mode: 'REMAINDER' }], ['a'])).toEqual([])
  })

  it('is refused over rows that already share the values, and lists them', async () => {
    const db = await createDatabase()
    adoptFormat(db, allocation([]), NOW)
    db.run(
      "INSERT INTO fmt_thing (id, plan, bucket, mode) VALUES ('a', 'p', 'b', 'PERCENTAGE'), " +
        "('b', 'p', 'b', 'PERCENTAGE'), ('c', 'p', 'c', 'PERCENTAGE')",
    )
    const plan = planFor(db, allocation([PER_BUCKET]))
    expect(plan.refusals).toMatchObject([{ reason: 'NOT_HELD' }])
    expect(plan.refusals[0]?.detail).toContain('2 rows')
    expect(rowsBreaking(db, allocation([PER_BUCKET]), PER_BUCKET)).toEqual(['a', 'b'])
    // The filtered one is not broken: none of them is a remainder.
    expect(adoptFormat(db, allocation([ONE_REMAINDER]), NOW).refusals).toEqual([])

    adoptFormat(db, allocation([]), NOW)
    expect(
      query(db, "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'fmt_thing__check_%'"),
    ).toEqual([])
  })

  it('survives a text save and open, sentence and index both', async () => {
    const db = await createDatabase()
    adoptFormat(db, allocation([PER_BUCKET]), NOW)
    db.run("INSERT INTO fmt_thing (id, plan, bucket, mode) VALUES ('a', 'p', 'b', 'PERCENTAGE')")
    const encoded = await exportEncoded(db, 'text')
    if (!encoded.ok) throw new Error(encoded.error)
    expect(new TextDecoder().decode(encoded.value)).toContain('| one row per plan, bucket |')

    const { db: back } = await openEncoded(encoded.value)
    expect(() =>
      back.run("INSERT INTO fmt_thing (id, plan, bucket, mode) VALUES ('z', 'p', 'b', 'PERCENTAGE')"),
    ).toThrow('UNIQUE')
  })
})
