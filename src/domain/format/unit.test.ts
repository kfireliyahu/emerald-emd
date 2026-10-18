import { describe, expect, it } from 'vitest'

import {
  BASE_UNITS,
  conversionBetween,
  convert,
  convertAcross,
  DIMENSIONS,
  SEEDED_UNITS,
  unitNamed,
  unitRejection,
  unitsOf,
  type UnitRow,
} from './unit.ts'

function row(extra: Partial<UnitRow> = {}): UnitRow {
  return {
    symbol: 'slice',
    dimension: 'COUNT',
    perBase: 1,
    origin: 'USER',
    note: '',
    ...extra,
  }
}

describe('the seeded table', () => {
  it('gives every dimension a base unit that is in it, at a factor of one', () => {
    for (const dimension of DIMENSIONS) {
      const base = unitNamed(SEEDED_UNITS, BASE_UNITS[dimension])
      expect(base, dimension).toBeDefined()
      expect(base?.dimension).toBe(dimension)
      expect(base?.perBase).toBe(1)
    }
  })

  it('is made only of rows that would be accepted if somebody added them', () => {
    for (const unit of SEEDED_UNITS) {
      expect(unitRejection(unit), unit.symbol).toBeUndefined()
    }
  })

  it('has no duplicate symbols, because a lookup takes the first', () => {
    const symbols = SEEDED_UNITS.map((each) => each.symbol)
    expect(new Set(symbols).size).toBe(symbols.length)
  })

  it('never seeds `in`, which is the word that asks for a conversion', () => {
    expect(unitNamed(SEEDED_UNITS, 'in')).toBeUndefined()
  })

  it('keeps the defined masses exact rather than rounded', () => {
    expect(unitNamed(SEEDED_UNITS, 'lb')?.perBase).toBe(453.59237)
    expect(unitNamed(SEEDED_UNITS, 'oz')?.perBase).toBe(28.349523125)
  })

  it('says which volumes are a convention rather than a definition', () => {
    // The sentence is what tells a person the row is theirs to change. A cup
    // that is 240 here and 250 in their kitchen is not the engine being wrong;
    // it is the document recording an assumption.
    for (const symbol of ['tsp', 'tbsp', 'cup']) {
      expect(unitNamed(SEEDED_UNITS, symbol)?.note, symbol).toContain('convention')
    }
  })
})

describe('what a unit may be', () => {
  it('takes a symbol with a letter outside ASCII', () => {
    expect(unitRejection(row({ symbol: 'µg', dimension: 'MASS', perBase: 0.000001 }))).toBeUndefined()
  })

  it('refuses a symbol with a space or arithmetic in it', () => {
    for (const symbol of ['fl oz', 'g/ml', 'fl-oz', '', '2cups']) {
      expect(unitRejection(row({ symbol })), symbol).toBeDefined()
    }
  })

  it('refuses a factor of zero or below, which no ratio of measurements is', () => {
    expect(unitRejection(row({ perBase: 0 }))).toContain('above zero')
    expect(unitRejection(row({ perBase: -1 }))).toContain('above zero')
  })

  it('refuses a dimension it has no base unit for', () => {
    expect(unitRejection(row({ dimension: 'LUMINOUS' as never }))).toContain('not one of')
  })
})

describe('converting', () => {
  it('converts inside a dimension', () => {
    expect(convert(SEEDED_UNITS, 1.5, 'kg', 'g')).toEqual({ value: 1500 })
    expect(convert(SEEDED_UNITS, 250, 'ml', 'l')).toEqual({ value: 0.25 })
    expect(convert(SEEDED_UNITS, 2, 'tbsp', 'ml')).toEqual({ value: 30 })
  })

  it('is exact where the definition is exact', () => {
    expect(convert(SEEDED_UNITS, 1, 'kcal', 'kJ')).toEqual({ value: 4.184 })
  })

  it('costs nothing and asks nothing when the two units are the same word', () => {
    // Before the table is consulted, so a unit the document has forgotten still
    // compares to itself rather than becoming `unchecked` on every row.
    expect(convert([], 7, 'furlong', 'furlong')).toEqual({ value: 7 })
  })

  it('round-trips', () => {
    const there = convert(SEEDED_UNITS, 3, 'lb', 'g')
    expect('value' in there).toBe(true)
    const back = 'value' in there ? convert(SEEDED_UNITS, there.value, 'g', 'lb') : undefined
    expect(back && 'value' in back ? Math.round(back.value * 1e9) / 1e9 : undefined).toBe(3)
  })

  /**
   * **This is H7's answer and it is one sentence.** The engine knows `ml` is a
   * volume and `g` is a mass; what it refuses to know is the density between
   * them, because a density is a fact about pasta rather than about units. The
   * refusal has to name the missing fact and say where such a fact belongs, or
   * it is a dead end rather than a decision.
   */
  it('refuses to cross a dimension, and names what would be needed', () => {
    const across = conversionBetween(SEEDED_UNITS, 'ml', 'g')
    expect('problem' in across).toBe(true)
    if (!('problem' in across)) return
    expect(across.problem).toContain('volume')
    expect(across.problem).toContain('mass')
    expect(across.problem).toContain('density')
    expect(across.problem).toContain('column')
  })

  it('names the count bridge as what one of them weighs', () => {
    const across = conversionBetween(SEEDED_UNITS, 'each', 'g')
    expect('problem' in across && across.problem).toContain('weighs')
  })

  it('refuses a unit the document has never heard of, and says so as a gap', () => {
    const missing = conversionBetween(SEEDED_UNITS, 'slice', 'g')
    expect('problem' in missing && missing.problem).toContain('no unit called slice')
  })

  it('does not fall back to a different case, and says why', () => {
    // `mg` and `Mg` are a thousandfold apart in every table that prints both,
    // so a lookup that ignored case would pick one of them silently.
    const wrong = conversionBetween(SEEDED_UNITS, 'MG', 'g')
    expect('problem' in wrong && wrong.problem).toContain('exactly as written')
  })

  it('uses the rows the document holds rather than the ones the build shipped', () => {
    // A 20 ml tablespoon, which is the whole reason the table is in the file.
    const kitchen: readonly UnitRow[] = [
      { symbol: 'ml', dimension: 'VOLUME', perBase: 1, origin: 'SEEDED', note: '' },
      { symbol: 'tbsp', dimension: 'VOLUME', perBase: 20, origin: 'USER', note: '' },
    ]
    expect(convert(kitchen, 1, 'tbsp', 'ml')).toEqual({ value: 20 })
    expect(convert(SEEDED_UNITS, 1, 'tbsp', 'ml')).toEqual({ value: 15 })
  })
})

describe('offering them', () => {
  it('lists one dimension, smallest first', () => {
    expect(unitsOf(SEEDED_UNITS, 'MASS').map((each) => each.symbol)).toEqual([
      'mcg',
      'µg',
      'mg',
      'g',
      'oz',
      'lb',
      'kg',
    ])
  })

  it('leaves COUNT with one member, because one clove is not one can', () => {
    expect(unitsOf(SEEDED_UNITS, 'COUNT').map((each) => each.symbol)).toEqual(['each'])
  })
})

/**
 * The bridge (U4c, D-225).
 *
 * Every case here is the same one sentence read from a different side: **the
 * engine does the arithmetic and the document supplies the fact.**
 */
describe('crossing a dimension through a declared fact', () => {
  /** One millilitre of this weighs 0.94 grams. A column somebody declared. */
  const density = { amount: 0.94, unit: 'g', per: 'ml' } as const
  /** One of them weighs 60 g. The other bridge the vault already keeps. */
  const eachWeighs = { amount: 60, unit: 'g', per: 'each' } as const

  it('multiplies through the fact in the direction it was written', () => {
    expect(convertAcross(SEEDED_UNITS, 200, 'ml', 'g', density)).toEqual({ value: 188 })
  })

  it('divides through the same fact the other way, because a ratio is not an arrow', () => {
    expect(convertAcross(SEEDED_UNITS, 188, 'g', 'ml', density)).toEqual({ value: 200 })
  })

  it('converts into the ratio units first, so any unit of either dimension works', () => {
    // 2 l is 2000 ml; times 0.94 is 1880 g; which is 1.88 kg. Nothing in the
    // ratio said anything about litres or kilograms.
    const answer = convertAcross(SEEDED_UNITS, 2, 'l', 'kg', density)
    // A ratio of measurements rather than money, so an ordinary float and an
    // ordinary float comparison — D-003's rule does not reach here, and
    // `columnRejection` is what keeps money off this path entirely.
    expect('value' in answer && answer.value).toBeCloseTo(1.88, 10)
  })

  it('counts, which is the bridge a recipe needs as often as a density', () => {
    expect(convertAcross(SEEDED_UNITS, 3, 'each', 'g', eachWeighs)).toEqual({ value: 180 })
  })

  it('leaves the fact untouched when the two units are already one dimension', () => {
    // **The property the whole quantity type hangs off.** A recipe line that is
    // already in grams converts by arithmetic, so one identity covers a recipe
    // whose lines are in grams, millilitres and eggs.
    expect(convertAcross(SEEDED_UNITS, 2, 'kg', 'g', density)).toEqual({ value: 2000 })
  })

  it('refuses a fact that relates the wrong two dimensions', () => {
    const answer = convertAcross(SEEDED_UNITS, 5, 'min', 'g', density)
    expect(answer).toHaveProperty('problem')
    expect('problem' in answer && answer.problem).toContain('wrong fact')
  })

  it('refuses a fact of zero rather than dividing by it', () => {
    const answer = convertAcross(SEEDED_UNITS, 200, 'ml', 'g', { ...density, amount: 0 })
    expect(answer).toHaveProperty('problem')
  })

  it('refuses a fact stated in a unit this document does not know', () => {
    const answer = convertAcross(SEEDED_UNITS, 200, 'ml', 'g', { ...density, per: 'dollop' })
    expect('problem' in answer && answer.problem).toContain('dollop')
  })

  it('still knows no density of its own', () => {
    // The refusal U4a was built to make, unchanged by U4c: without the fact,
    // the engine has nothing and says what it would need.
    const answer = convert(SEEDED_UNITS, 200, 'ml', 'g')
    expect('problem' in answer && answer.problem).toContain('a density')
  })
})
