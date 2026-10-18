/**
 * **U1's missing half, proved against real SQLite**: a declared table you can
 * put a row in, read back, correct and empty.
 *
 * `formatRepository.test.ts` proves a declaration becomes a table with `CHECK`s
 * that bite. These prove the `CHECK`s never get the chance, because the
 * coercion refuses first and names the column — and that when something does
 * reach `db.run`, it is the shape the declaration said it would be.
 *
 * The specification is the same one U1 used: `Ingredients/Pasta.md`, thirty-one
 * columns, a format that is not money on purpose (D-211).
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'

import { read } from '@/domain/format/artefact.ts'
import { column, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { coerceEdit, coerceRow, readValue, type StoredValue } from '@/domain/format/row.ts'
import { createDatabase } from '../db/database.ts'
import { adoptFormat } from './formatRepository.ts'
import {
  countRows,
  deleteRows,
  LinkedRowsError,
  linkingSentences,
  rowsLinkingTo,
  insertRows,
  listRows,
  readRow,
  updateRow,
} from './formatRowRepository.ts'

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

async function withIngredients(): Promise<Database> {
  const db = await createDatabase()
  const plan = adoptFormat(db, PASTA, NOW)
  expect(plan.refusals).toEqual([])
  return db
}

/** A row through the coercion, which is the only way one is ever built. */
function cells(
  declaration: FormatDeclaration,
  offered: Record<string, unknown>,
): Record<string, StoredValue> {
  const coerced = coerceRow(declaration, offered)
  if (!coerced.ok) throw new Error(coerced.error)
  return coerced.value
}

const PASTA_ROW = {
  name: 'Pasta',
  brand: 'אסם',
  basis: 'dry',
  per_quantity: 100,
  kcal: 352,
  protein_g: 12,
  carbs_g: 71,
  fat_g: 1.5,
  micros_basis: 'label',
  cooked_yield_factor: 2,
}

const YOGURT_ROW = {
  name: 'Yogurt',
  basis: 'as sold',
  per_quantity: 100,
  kcal: 62,
  protein_g: 10,
  carbs_g: 4,
  fat_g: 0.5,
  micros_basis: 'analogue',
  price: 5.9,
  price_currency: 'ILS',
}

describe('rows of a declared table', () => {
  it('goes in and comes back out as the declaration said it would', async () => {
    const db = await withIngredients()
    const ids = insertRows(db, PASTA, [cells(PASTA, PASTA_ROW)])
    expect(ids).toHaveLength(1)

    const row = readRow(db, PASTA, ids[0]!)
    expect(row).toBeDefined()
    const byName = new Map(PASTA.columns.map((one) => [one.name, one]))
    expect(readValue(byName.get('name')!, row!)).toBe('Pasta')
    // Hebrew survives the round trip untouched — no trimming, no marks (D-094).
    expect(readValue(byName.get('brand')!, row!)).toBe('אסם')
    expect(readValue(byName.get('cooked_yield_factor')!, row!)).toBe(2)
    expect(readValue(byName.get('sodium_mg')!, row!)).toBeUndefined()
  })

  it('stores money as minor units and a code, and reads it back as Money', async () => {
    const db = await withIngredients()
    const [id] = insertRows(db, PASTA, [cells(PASTA, YOGURT_ROW)])
    const row = readRow(db, PASTA, id!)!
    const price = PASTA.columns.find((one) => one.name === 'price')!

    expect(row.cells['price_minor']).toBe(590)
    expect(row.cells['price_currency']).toBe('ILS')
    expect(readValue(price, row)).toEqual({ minor: 590, currency: 'ILS' })
  })

  it('gives every row an identity the row itself does not choose', async () => {
    const db = await withIngredients()
    const ids = insertRows(db, PASTA, [cells(PASTA, PASTA_ROW), cells(PASTA, YOGURT_ROW)])
    expect(new Set(ids).size).toBe(2)
    expect(ids.every((id) => id.length > 0)).toBe(true)
  })

  it('still has the CHECKs underneath, for whatever the coercion did not catch', async () => {
    // The coercion refuses a bad enum first and names the column, which is why
    // this has to go round it to prove the constraint is real. It is the belt
    // the coercion is the braces for.
    const db = await withIngredients()
    const bad = { ...cells(PASTA, PASTA_ROW), micros_basis: 'guessed' }
    expect(() => insertRows(db, PASTA, [bad])).toThrow()
    expect(countRows(db, PASTA)).toBe(0)
  })
})

describe('finding rows', () => {
  async function seeded(): Promise<Database> {
    const db = await withIngredients()
    insertRows(db, PASTA, [
      cells(PASTA, PASTA_ROW),
      cells(PASTA, YOGURT_ROW),
      cells(PASTA, { ...PASTA_ROW, name: 'Red lentils', protein_g: 24, basis: 'dry' }),
    ])
    return db
  }

  it('matches a text column without regard to case', async () => {
    const db = await seeded()
    const found = listRows(db, PASTA, { match: new Map([['name', 'pasta']]) })
    expect(found).toHaveLength(1)
    expect(found[0]?.cells['name']).toBe('Pasta')
  })

  it('matches an enum, and counts before the limit applies', async () => {
    const db = await seeded()
    const request = { match: new Map<string, StoredValue>([['basis', 'dry']]), limit: 1 }
    expect(countRows(db, PASTA, request)).toBe(2)
    expect(listRows(db, PASTA, request)).toHaveLength(1)
  })

  it('searches the text columns, among every other', async () => {
    const db = await seeded()
    expect(listRows(db, PASTA, { search: 'lentil' })).toHaveLength(1)
    // The Hebrew brand is in a text column and is found the same way.
    expect(listRows(db, PASTA, { search: 'אסם' })).toHaveLength(2)
    expect(listRows(db, PASTA, { search: 'nothing here' })).toHaveLength(0)
  })

  it('treats the wildcards in a search as text, not as a pattern', async () => {
    const db = await seeded()
    // Without the escape, `%` matches everything and the answer is three rows —
    // which reads as a search that worked.
    expect(listRows(db, PASTA, { search: '%' })).toHaveLength(0)
  })

  it('orders by a declared column, either way', async () => {
    const db = await seeded()
    const most = listRows(db, PASTA, { order: 'protein_g', descending: true })
    expect(most.map((row) => row.cells['name'])).toEqual(['Red lentils', 'Pasta', 'Yogurt'])
    const least = listRows(db, PASTA, { order: 'protein_g' })
    expect(least[0]?.cells['name']).toBe('Yogurt')
  })

  it('orders a money column by its minor units rather than by its code', async () => {
    const db = await seeded()
    const ordered = listRows(db, PASTA, { order: 'price', descending: true })
    expect(ordered[0]?.cells['name']).toBe('Yogurt')
  })

  it('falls back to the row identity when asked to order by nothing it has', async () => {
    const db = await seeded()
    expect(listRows(db, PASTA, { order: 'protein' })).toHaveLength(3)
  })
})

describe('correcting and removing rows', () => {
  it('changes the columns named and leaves the rest alone', async () => {
    const db = await withIngredients()
    const [id] = insertRows(db, PASTA, [cells(PASTA, PASTA_ROW)])

    const edit = coerceEdit(PASTA, { protein_g: 13, label_source: 'the packet' })
    expect(edit.ok).toBe(true)
    expect(updateRow(db, PASTA, id!, edit.ok ? edit.value : {})).toBe(true)

    const row = readRow(db, PASTA, id!)!
    expect(row.cells['protein_g']).toBe(13)
    expect(row.cells['label_source']).toBe('the packet')
    expect(row.cells['kcal']).toBe(352)
    expect(row.cells['brand']).toBe('אסם')
  })

  it('says so when the id is not there, rather than reporting a change', async () => {
    const db = await withIngredients()
    expect(updateRow(db, PASTA, 'not-an-id', { protein_g: 13 })).toBe(false)
  })

  it('removes only the ids that were there, and says which', async () => {
    const db = await withIngredients()
    const ids = insertRows(db, PASTA, [cells(PASTA, PASTA_ROW), cells(PASTA, YOGURT_ROW)])

    const gone = deleteRows(db, PASTA, [ids[0]!, 'not-an-id'], [PASTA])
    expect(gone).toEqual([ids[0]])
    expect(countRows(db, PASTA)).toBe(1)
    expect(readRow(db, PASTA, ids[1]!)).toBeDefined()
  })
})

describe('removing a row another format links to (M24 U11, D-263)', () => {
  const LINE: FormatDeclaration = {
    language: 5,
    name: 'recipe_line',
    title: 'Recipe line',
    notes: '',
    identities: [],
    aggregates: [],
    nothingMustHold: true,
    columns: [
      column('note', 'text'),
      column('ingredient', 'link', { target: 'ingredient' }),
    ],
  }

  async function linked(): Promise<{ db: Database; pasta: string; yogurt: string }> {
    const db = await withIngredients()
    expect(adoptFormat(db, LINE, NOW).refusals).toEqual([])
    const [pasta, yogurt] = insertRows(db, PASTA, [cells(PASTA, PASTA_ROW), cells(PASTA, YOGURT_ROW)])
    insertRows(db, LINE, [
      { note: 'boil', ingredient: pasta! },
      { note: 'drain', ingredient: pasta! },
      { note: 'serve', ingredient: yogurt! },
    ])
    return { db, pasta: pasta!, yogurt: yogurt! }
  }

  it('counts, per linking column, the rows naming each row that would go', async () => {
    const { db, pasta, yogurt } = await linked()
    const linking = rowsLinkingTo(db, PASTA, [pasta, yogurt], [PASTA, LINE])
    expect(linking).toHaveLength(1)
    expect(linking[0]!.column).toBe('ingredient')
    expect([...linking[0]!.counts]).toEqual([
      [pasta, 2],
      [yogurt, 1],
    ])
    expect(linkingSentences(db, PASTA, linking)).toEqual([
      '3 rows of Recipe line name “Pasta” (2), “Yogurt” (1) through ingredient.',
    ])
  })

  it('refuses the whole delete, and removes nothing', async () => {
    const { db, pasta, yogurt } = await linked()
    expect(() => deleteRows(db, PASTA, [yogurt, pasta], [PASTA, LINE])).toThrow(LinkedRowsError)
    expect(countRows(db, PASTA)).toBe(2)
  })

  it('removes the row once nothing links to it', async () => {
    const { db, pasta, yogurt } = await linked()
    const lines = listRows(db, LINE).filter((row) => row.cells['ingredient'] === yogurt)
    deleteRows(db, LINE, lines.map((row) => row.id), [PASTA, LINE])
    expect(deleteRows(db, PASTA, [yogurt], [PASTA, LINE])).toEqual([yogurt])
    expect(rowsLinkingTo(db, PASTA, [pasta], [PASTA, LINE])).toHaveLength(1)
  })
})

describe('a format with no text in it at all', () => {
  it('answers a search with nothing rather than with everything', async () => {
    // "Nothing to look in" and "nothing matched" are different answers, and
    // returning every row for a search that could not run is the one that reads
    // as the search having worked.
    const db = await createDatabase()
    const numbers: FormatDeclaration = {
      language: 1,
      name: 'reading',
      title: 'Reading',
      notes: '',
      identities: [],
      aggregates: [],
      nothingMustHold: true,
      columns: [column('value', 'real', { required: true })],
    }
    expect(adoptFormat(db, numbers, NOW).refusals).toEqual([])
    insertRows(db, numbers, [cells(numbers, { value: 1 })])

    expect(listRows(db, numbers, {})).toHaveLength(1)
    expect(listRows(db, numbers, { search: 'anything' })).toHaveLength(0)
  })
})
