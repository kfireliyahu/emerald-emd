import { describe, expect, it } from 'vitest'

import { convert, SEEDED_UNITS } from '@/domain/format/unit.ts'
import { createDatabase } from '../db/database.ts'
import { column, DECLARATION_LANGUAGE } from '@/domain/format/declaration.ts'
import { applyParts, serializeDocument } from './formatDocumentRepository.ts'
import { adoptFormat } from './formatRepository.ts'
import {
  addUnit,
  chosenWeekStart,
  correctUnit,
  documentCurrency,
  documentWeekStart,
  listUnits,
  setDocumentCurrency,
  setDocumentWeekStart,
} from './unitRepository.ts'

describe('the seeded units', () => {
  /**
   * **The assertion migration 034 exists to make true.** The build ships an
   * array and the document holds rows; if the two ever disagree, a conversion
   * resolved against the document answers something the build's own tests never
   * saw. Same symbols, same dimensions, same factors — and the order is not
   * asserted, because the repository sorts for a reader and the array is
   * written for one.
   */
  it('are in the document, and are exactly what the build shipped', async () => {
    const db = await createDatabase()
    const held = listUnits(db)
    expect(held).toHaveLength(SEEDED_UNITS.length)
    for (const shipped of SEEDED_UNITS) {
      const row = held.find((each) => each.symbol === shipped.symbol)
      expect(row, shipped.symbol).toEqual(shipped)
    }
  })

  it('come back smallest first within a dimension, which is how a table of units reads', async () => {
    const db = await createDatabase()
    const volume = listUnits(db).filter((each) => each.dimension === 'VOLUME')
    expect(volume.map((each) => each.symbol)).toEqual([
      'ml',
      'tsp',
      'cl',
      'tbsp',
      'floz',
      'dl',
      'cup',
      'l',
    ])
  })
})

describe('adding one this build never heard of', () => {
  it('takes it, and a conversion then finds it', async () => {
    const db = await createDatabase()
    const added = addUnit(
      db,
      { symbol: 'slice', dimension: 'COUNT', perBase: 1, note: 'of the loaf I buy' },
      100,
    )
    expect('added' in added).toBe(true)
    const units = listUnits(db)
    expect(convert(units, 3, 'slice', 'each')).toEqual({ value: 3 })
  })

  it('marks it as the user’s, so a later build can tell it from a seeded row', async () => {
    const db = await createDatabase()
    addUnit(db, { symbol: 'iu', dimension: 'COUNT', perBase: 1, note: '' }, 100)
    expect(listUnits(db).find((each) => each.symbol === 'iu')?.origin).toBe('USER')
  })

  it('refuses one that is already there rather than overwriting its factor', async () => {
    const db = await createDatabase()
    const again = addUnit(db, { symbol: 'g', dimension: 'MASS', perBase: 5, note: '' }, 100)
    expect('problem' in again && again.problem).toContain('already has a unit called g')
    expect(listUnits(db).find((each) => each.symbol === 'g')?.perBase).toBe(1)
  })

  it('refuses a symbol nothing could read back out of an identity', async () => {
    const db = await createDatabase()
    const bad = addUnit(db, { symbol: 'fl oz', dimension: 'VOLUME', perBase: 29.6, note: '' }, 100)
    expect('problem' in bad).toBe(true)
    expect(listUnits(db).some((each) => each.symbol === 'fl oz')).toBe(false)
  })
})

describe('correcting one', () => {
  /** The whole reason the table is in the file rather than in the build. */
  it('takes a tablespoon that is 20 ml in this kitchen', async () => {
    const db = await createDatabase()
    expect('corrected' in correctUnit(db, 'tbsp', 20, 'the Australian one')).toBe(true)
    expect(convert(listUnits(db), 1, 'tbsp', 'ml')).toEqual({ value: 20 })
  })

  it('refuses a factor that is not a ratio', async () => {
    const db = await createDatabase()
    expect('problem' in correctUnit(db, 'tbsp', 0, '')).toBe(true)
    expect(convert(listUnits(db), 1, 'tbsp', 'ml')).toEqual({ value: 15 })
  })

  it('refuses a unit the document has not got', async () => {
    const db = await createDatabase()
    expect('problem' in correctUnit(db, 'slice', 1, '')).toBe(true)
  })
})

describe('a row that stopped making sense', () => {
  /**
   * A `.emd` is a real SQLite database the user can open in any tool, so a row
   * can arrive here that no code in this build would have written. It is
   * skipped rather than thrown, and a skipped unit is one a conversion cannot
   * find — which comes back as a sentence naming it, and that is the failure a
   * person can act on.
   */
  it('is skipped rather than thrown, and the rest still read', async () => {
    const db = await createDatabase()
    db.run(
      `INSERT INTO measurement_unit (symbol, dimension, per_base, origin, note, created_at)
       VALUES ('two words', 'MASS', 1, 'USER', '', 0)`,
    )
    const units = listUnits(db)
    expect(units.some((each) => each.symbol === 'two words')).toBe(false)
    expect(units.some((each) => each.symbol === 'g')).toBe(true)
  })
})

describe("the document's currency (M29 F3, D-344)", () => {
  it('is nothing until it is chosen, then the code, and a change replaces it', async () => {
    const db = await createDatabase()
    expect(documentCurrency(db)).toBeUndefined()
    expect(setDocumentCurrency(db, 'ils')).toEqual({ currency: 'ILS' })
    expect(documentCurrency(db)).toBe('ILS')
    expect(setDocumentCurrency(db, 'EUR')).toEqual({ currency: 'EUR' })
    expect(documentCurrency(db)).toBe('EUR')
  })

  it('refuses what is not a code, and the table refuses it too', async () => {
    const db = await createDatabase()
    expect('problem' in setDocumentCurrency(db, '$')).toBe(true)
    expect(documentCurrency(db)).toBeUndefined()
    expect(() => db.run("INSERT INTO document_setting (key, value) VALUES ('currency', 'shekel')")).toThrow()
  })

  it('goes into a text document and comes back out of one', async () => {
    const source = await createDatabase()
    adoptFormat(
      source,
      {
        language: DECLARATION_LANGUAGE,
        name: 'item',
        title: 'Item',
        notes: '',
        columns: [column('name', 'text'), column('price', 'money')],
        identities: [],
        aggregates: [],
        nothingMustHold: true,
      },
      100,
    )
    setDocumentCurrency(source, 'GBP')
    const parts = serializeDocument(source)
    if (!parts.ok) throw new Error(parts.error)
    expect(parts.value.find((part) => part.name === 'settings.md')?.text).toContain('currency: GBP')

    const rebuilt = await createDatabase()
    const applied = applyParts(rebuilt, parts.value, 100)
    if (!applied.ok) throw new Error(applied.error)
    expect(documentCurrency(rebuilt)).toBe('GBP')
  })
})

describe("the day the document's weeks start on (M53 F6, D-528)", () => {
  it('is Monday until one is chosen, then the day named, and refuses what is not a day', async () => {
    const db = await createDatabase()
    expect(chosenWeekStart(db)).toBeUndefined()
    expect(documentWeekStart(db)).toBe(1)
    expect(setDocumentWeekStart(db, ' Sunday ')).toEqual({ weekStart: 'sunday' })
    expect(chosenWeekStart(db)).toBe('sunday')
    expect(documentWeekStart(db)).toBe(7)
    expect('problem' in setDocumentWeekStart(db, 'someday')).toBe(true)
    expect(chosenWeekStart(db)).toBe('sunday')
  })

  it('goes into a text document beside the currency, and comes back out of one', async () => {
    const source = await createDatabase()
    adoptFormat(
      source,
      {
        language: DECLARATION_LANGUAGE,
        name: 'task',
        title: 'Task',
        notes: '',
        columns: [column('name', 'text'), column('due', 'date')],
        identities: [],
        aggregates: [],
        nothingMustHold: true,
      },
      100,
    )
    setDocumentWeekStart(source, 'sunday')
    const alone = serializeDocument(source)
    if (!alone.ok) throw new Error(alone.error)
    expect(alone.value.find((part) => part.name === 'settings.md')?.text).toContain('week_starts_on: sunday')
    setDocumentCurrency(source, 'ILS')
    const parts = serializeDocument(source)
    if (!parts.ok) throw new Error(parts.error)

    const rebuilt = await createDatabase()
    const applied = applyParts(rebuilt, parts.value, 100)
    if (!applied.ok) throw new Error(applied.error)
    expect(chosenWeekStart(rebuilt)).toBe('sunday')
    expect(documentCurrency(rebuilt)).toBe('ILS')
  })
})
