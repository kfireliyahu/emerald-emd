import { describe, expect, it } from 'vitest'

import { column, type FormatDeclaration } from './declaration.ts'
import { identity } from './identity.ts'
import {
  coerceEdit,
  coerceMatch,
  coerceRow,
  currencyKeyOf,
  identityInputsOf,
  offeredKeysOf,
  missingTargets,
  readValue,
  screenWords,
  unitKeyOf,
  tally,
  verdictsOf,
} from './row.ts'

/**
 * The coercion is where a conversation meets a declared table, and everything
 * it refuses it has to refuse **by naming the column** — the reader of the
 * sentence is a model about to try again, and "CHECK constraint failed" tells
 * it nothing it can act on. Half of what is asserted below is therefore the
 * text of a refusal rather than the fact of one.
 */

function declaring(...columns: FormatDeclaration['columns']): FormatDeclaration {
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

describe('a value offered for a declared column', () => {
  it('takes the types it declares and stores them as SQLite holds them', () => {
    const declaration = declaring(
      column('name', 'text', { required: true }),
      column('grams', 'real', { unit: 'g', minimum: 0 }),
      column('pieces', 'integer'),
      column('checked', 'date'),
      column('organic', 'boolean'),
      column('basis', 'enum', { values: ['dry', 'cooked'] }),
    )

    const coerced = coerceRow(declaration, {
      name: 'Pasta',
      grams: 100,
      pieces: 4,
      checked: '2026-09-13',
      organic: true,
      basis: 'dry',
    })

    expect(coerced.ok && coerced.value).toEqual({
      name: 'Pasta',
      grams: 100,
      pieces: 4,
      checked: '2026-09-13',
      // A boolean is an integer in SQLite, and the `CHECK` in `ddl.ts` says so.
      organic: 1,
      basis: 'dry',
    })
  })

  it('leaves an optional column null and refuses a required one by name', () => {
    const declaration = declaring(
      column('name', 'text', { required: true }),
      column('brand', 'text'),
    )

    expect(coerceRow(declaration, { name: 'Pasta' })).toEqual({
      ok: true,
      value: { name: 'Pasta', brand: null },
    })

    const missing = coerceRow(declaration, { brand: 'Osem' })
    expect(missing.ok).toBe(false)
    expect(!missing.ok && missing.error).toContain('name is required')
  })

  it('forgives the two slips that are unambiguous, and nothing else', () => {
    // A number as a string and an enum member in the wrong case are what a
    // model sends; refusing them costs a round trip to teach nothing. "about
    // four" is a question only the user can answer, so it is refused.
    const declaration = declaring(
      column('grams', 'real'),
      column('basis', 'enum', { values: ['dry', 'cooked'] }),
      column('organic', 'boolean'),
    )

    expect(coerceRow(declaration, { grams: '12.5', basis: 'Dry', organic: 'yes' })).toEqual({
      ok: true,
      // Stored as the declaration spells it, not as the caller sent it.
      value: { grams: 12.5, basis: 'dry', organic: 1 },
    })

    const vague = coerceRow(declaration, { grams: 'about four' })
    expect(vague.ok).toBe(false)
    expect(!vague.ok && vague.error).toContain('grams is a real')
  })

  it('checks a bound here rather than leaving it to the CHECK', () => {
    const declaration = declaring(column('grams', 'real', { minimum: 0, maximum: 1000 }))

    const low = coerceRow(declaration, { grams: -1 })
    expect(!low.ok && low.error).toBe('grams is -1, below its minimum of 0.')
    const high = coerceRow(declaration, { grams: 1001 })
    expect(!high.ok && high.error).toBe('grams is 1001, above its maximum of 1000.')
  })

  it('refuses a fractional value for a whole number', () => {
    const declaration = declaring(column('pieces', 'integer'))
    const fraction = coerceRow(declaration, { pieces: 4.5 })
    expect(!fraction.ok && fraction.error).toContain('whole number')
  })

  it('refuses a date that is not date-only', () => {
    const declaration = declaring(column('checked', 'date'))
    const stamped = coerceRow(declaration, { checked: '2026-09-13T10:00:00Z' })
    expect(!stamped.ok && stamped.error).toContain('YYYY-MM-DD')
  })

  it('refuses an enum member that is not one, and lists the ones that are', () => {
    const declaration = declaring(column('basis', 'enum', { values: ['dry', 'cooked'] }))
    const wrong = coerceRow(declaration, { basis: 'raw' })
    expect(!wrong.ok && wrong.error).toBe('basis must be one of dry, cooked; got "raw".')
  })
})

describe('money in a declared table', () => {
  const declaration = declaring(column('price', 'money'))

  it('stores minor units beside a currency, and never a float', () => {
    const coerced = coerceRow(declaration, { price: 12.9, price_currency: 'ils' })
    expect(coerced.ok && coerced.value).toEqual({ price_minor: 1290, price_currency: 'ILS' })
  })

  it('names both keys when the currency is missing', () => {
    const coerced = coerceRow(declaration, { price: 12.9 })
    expect(coerced.ok).toBe(false)
    expect(!coerced.ok && coerced.error).toContain('price_currency')
  })

  it('is two nulls when nothing was given and the column is optional', () => {
    expect(coerceRow(declaration, {})).toEqual({
      ok: true,
      value: { price_minor: null, price_currency: null },
    })
  })

  it('comes back out as Money rather than as two cells', () => {
    const [money_] = [readValue(declaration.columns[0]!, {
      id: 'r',
      cells: { price_minor: 1290, price_currency: 'ILS' },
    })]
    expect(money_).toEqual({ minor: 1290, currency: 'ILS' })
  })

  it('names its currency key after the column SQLite actually has', () => {
    expect(currencyKeyOf({ name: 'price' })).toBe('price_currency')
    expect(offeredKeysOf(declaration)).toEqual(['price', 'price_currency'])
  })

  it('is not something a row can be matched on', () => {
    const refused = coerceMatch(declaration.columns[0]!, 12.9)
    expect(refused.ok).toBe(false)
    expect(!refused.ok && refused.error).toContain('not something to match a row by')
  })
})

/**
 * **A quantity in a declared table** (U4c, D-225).
 *
 * The same shape as money one block up, and the same argument: a figure whose
 * unit lives somewhere other than beside it is a figure that will eventually be
 * read in the wrong one.
 */
describe('a quantity in a declared table', () => {
  const declaration = declaring(column('amount', 'quantity'))
  const first = declaration.columns[0]!

  it('stores the figure beside the unit that row is in', () => {
    const coerced = coerceRow(declaration, { amount: 200, amount_unit: 'ml' })
    expect(coerced.ok && coerced.value).toEqual({ amount: 200, amount_unit: 'ml' })
  })

  it('takes a different unit on the very next row, which is the whole point', () => {
    const coerced = coerceRow(declaration, { amount: 150, amount_unit: 'g' })
    expect(coerced.ok && coerced.value).toEqual({ amount: 150, amount_unit: 'g' })
  })

  it('names both keys when the unit is missing', () => {
    const coerced = coerceRow(declaration, { amount: 200 })
    expect(coerced.ok).toBe(false)
    expect(!coerced.ok && coerced.error).toContain('amount_unit')
  })

  it('refuses a symbol this document does not know, naming what it does have', () => {
    const coerced = coerceRow(declaration, { amount: 1, amount_unit: 'dollop' })
    expect(coerced.ok).toBe(false)
    expect(!coerced.ok && coerced.error).toContain('dollop')
    expect(!coerced.ok && coerced.error).toContain('not a unit this document knows')
  })

  it('forgives no case, because mg and Mg are a thousand apart', () => {
    expect(coerceRow(declaration, { amount: 1, amount_unit: 'G' }).ok).toBe(false)
  })

  it('is two nulls when nothing was given and the column is optional', () => {
    expect(coerceRow(declaration, {})).toEqual({
      ok: true,
      value: { amount: null, amount_unit: null },
    })
  })

  it('comes back out as a figure and a unit together, or not at all', () => {
    expect(readValue(first, { id: 'r', cells: { amount: 200, amount_unit: 'ml' } })).toEqual({
      amount: 200,
      unit: 'ml',
    })
    // Half a quantity is not a quantity: a figure printed beside an assumed
    // unit is the factor-of-a-thousand this type exists to prevent.
    expect(readValue(first, { id: 'r', cells: { amount: 200, amount_unit: null } })).toBeUndefined()
  })

  it('names its unit key after the column SQLite actually has', () => {
    expect(unitKeyOf({ name: 'amount' })).toBe('amount_unit')
    expect(offeredKeysOf(declaration)).toEqual(['amount', 'amount_unit'])
  })

  it('is not something a row can be matched on', () => {
    const refused = coerceMatch(first, 150)
    expect(refused.ok).toBe(false)
    expect(!refused.ok && refused.error).toContain('not something to match a row by')
  })

  it('puts the row’s own unit into what an identity is judged against', () => {
    const inputs = identityInputsOf(declaration, {
      id: 'r',
      cells: { amount: 200, amount_unit: 'ml' },
    })
    expect(inputs.numbers.get('amount')).toBe(200)
    expect(inputs.units?.get('amount')).toBe('ml')
  })

  it('puts a ratio column’s other half in beside it', () => {
    const ratio = declaring(column('density', 'real', { unit: 'g', per: 'ml' }))
    const inputs = identityInputsOf(ratio, { id: 'r', cells: { density: 0.94 } })
    expect(inputs.units?.get('density')).toBe('g')
    expect(inputs.per?.get('density')).toBe('ml')
  })
})

describe('a key the format has not got', () => {
  // The one that matters most, and the reason it is a refusal rather than a
  // dropped field: a conversation that sent `protein` to a format declaring
  // `protein_g` believes it stored the figure. D-138's law in miniature.
  it('refuses the row and says which keys exist', () => {
    const declaration = declaring(column('protein_g', 'real'))
    const typo = coerceRow(declaration, { protein: 6.6 })
    expect(typo.ok).toBe(false)
    expect(!typo.ok && typo.error).toBe('thing has no protein. It has protein_g.')
  })

  it('refuses an attempt to set the row identity', () => {
    const declaration = declaring(column('name', 'text'))
    const forced = coerceRow(declaration, { id: 'mine', name: 'Pasta' })
    expect(forced.ok).toBe(false)
    expect(!forced.ok && forced.error).toContain('identity this document gives a row')
  })
})

describe('an edit names the columns it changes', () => {
  const declaration = declaring(
    column('name', 'text', { required: true }),
    column('grams', 'real'),
    column('price', 'money'),
  )

  it('touches only what it names', () => {
    expect(coerceEdit(declaration, { grams: 90 })).toEqual({ ok: true, value: { grams: 90 } })
  })

  it('carries both money cells when either is named', () => {
    const coerced = coerceEdit(declaration, { price: 3.5, price_currency: 'ILS' })
    expect(coerced.ok && coerced.value).toEqual({ price_minor: 350, price_currency: 'ILS' })
  })

  it('still refuses to empty a required column', () => {
    const emptied = coerceEdit(declaration, { name: '' })
    expect(emptied.ok).toBe(false)
    expect(!emptied.ok && emptied.error).toContain('name is required')
  })

  it('refuses an edit that names nothing', () => {
    const nothing = coerceEdit(declaration, {})
    expect(nothing.ok).toBe(false)
    expect(!nothing.ok && nothing.error).toContain('nothing to change')
  })
})

describe('what a row proves', () => {
  const label: FormatDeclaration = {
    ...declaring(
      column('kcal', 'real', { unit: 'kcal' }),
      column('protein_g', 'real', { unit: 'g' }),
      column('name', 'text'),
      column('price', 'money'),
    ),
    identities: [
      identity('atwater', '4*protein_g = kcal', { tolerance: { kind: 'RELATIVE', percent: 2 } }),
    ],
    aggregates: [],
    nothingMustHold: false,
  }

  const row = (cells: Record<string, string | number | null>) => ({ id: 'r1', cells })

  it('puts the row through every identity the format declares', () => {
    const verdicts = verdictsOf(label, row({ protein_g: 10, kcal: 40 }))
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]?.verdict.kind).toBe('PROVED')
  })

  it('hands money to the arithmetic as minor units, with its currency beside it', () => {
    // The oldest rule has no exception for arithmetic somebody declared: what
    // the column stores is an integer, and that is what an identity sees.
    const inputs = identityInputsOf(label, row({ price_minor: 1290, price_currency: 'ILS' }))
    expect(inputs.numbers.get('price')).toBe(1290)
    expect(inputs.currencies.get('price')).toBe('ILS')
  })

  it('leaves out what is not a number, so an identity naming it is unchecked', () => {
    const inputs = identityInputsOf(label, row({ name: 'tahini', kcal: 40 }))
    expect(inputs.numbers.has('name')).toBe(false)
    expect(inputs.numbers.get('kcal')).toBe(40)
  })

  it('counts a row once, at its worst', () => {
    // **A row with a failed identity is a failed row whatever else holds.**
    // Summing the identities instead would report nine proofs over three rows
    // and hide that one of the three is wrong, which is D-138 in a counter.
    const both: FormatDeclaration = {
      ...label,
      identities: [
        identity('atwater', '4*protein_g = kcal'),
        identity('positive', 'kcal = kcal'),
      ],
      aggregates: [],
    }
    expect(
      tally(both, [
        row({ protein_g: 10, kcal: 40 }),
        row({ protein_g: 10, kcal: 400 }),
        row({ kcal: 40 }),
      ]),
    ).toEqual({ proved: 1, failed: 1, unchecked: 1 })
  })

  it('counts nothing at all for a format with nothing that has to add up', () => {
    const nothing = { ...label, identities: [], nothingMustHold: true }
    expect(tally(nothing, [row({ kcal: 40 })])).toEqual({
      proved: 0,
      failed: 0,
      unchecked: 0,
    })
  })
})

describe('a refusal in a screen’s words (M33 U2)', () => {
  const declaration = declaring(column('price', 'money'), column('receipt', 'link', { target: 'receipt' }))

  it('says the currency beside the cell, not the key a conversation sends', () => {
    const amount = coerceRow(declaration, { price: 'about 80', price_currency: 'ILS' })
    const currency = coerceRow(declaration, { price: 5 })
    if (amount.ok || currency.ok) throw new Error('both were meant to be refused')
    expect(amount.error).toContain('price_currency')
    expect(screenWords(amount.error, declaration)).toBe('price is money: an amount such as 12.90, in the currency beside it.')
    expect(screenWords(currency.error, declaration)).toMatch(/^price needs its currency, a three-letter code such as ILS\./)
    expect(screenWords(currency.error, declaration)).not.toContain('price_currency')
  })

  it('says a link that found nothing as the name typed, with no tool and no JSON', () => {
    const [problem] = missingTargets(declaration, { receipt: 'Nowhere' }, () => false, () => ({ name: 'shop', unique: false }))
    expect(problem).toContain('format_rows')
    expect(screenWords(problem ?? '', declaration)).toBe('receipt: no receipt is called "Nowhere". Pick one from the list.')
  })

  it('leaves a sentence that was already the screen’s alone', () => {
    expect(screenWords('price is required and was not given.', declaration)).toBe('price is required and was not given.')
  })
})
