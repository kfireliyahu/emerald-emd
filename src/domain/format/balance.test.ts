import { describe, expect, it } from 'vitest'

import { balanceOfText, termOf, termText, textOf, weighIdentity, type Balance } from './balance.ts'
import { identity, parseIdentity, type IdentityInputs } from './identity.ts'

function row(
  numbers: Record<string, number>,
  extra: {
    units?: Record<string, string>
    per?: Record<string, string>
    currencies?: Record<string, string>
  } = {},
): IdentityInputs {
  return {
    numbers: new Map(Object.entries(numbers)),
    currencies: new Map(Object.entries(extra.currencies ?? {})),
    units: new Map(Object.entries(extra.units ?? {})),
    per: new Map(Object.entries(extra.per ?? {})),
  }
}

/** The balance, or a failure that says which expression would not draw. */
function drawn(text: string): Balance {
  const balance = balanceOfText(text)
  if (balance === undefined) throw new Error(`\`${text}\` did not flatten`)
  return balance
}

/** Every chip of a side, as it reads, with its sign. */
function chips(terms: Balance['left']): readonly string[] {
  return terms.map((term) => `${term.coefficient < 0 ? '-' : '+'}${termText(term)}`)
}

describe('balanceOf — the shapes that draw', () => {
  it('draws a plain two-column equation', () => {
    const balance = drawn('unit_price * quantity = line_total')
    expect(chips(balance.left)).toEqual(['+unit_price * quantity'])
    expect(chips(balance.right)).toEqual(['+line_total'])
  })

  it('draws Atwater as five chips, distributing the bracket', () => {
    // The flagship case, and the reason a flat signed sum is honest:
    // `4 * (carbs - fiber)` is `4 * carbs - 4 * fiber`.
    const balance = drawn('4 * protein_g + 4 * (carbs_g - fiber_g) + 9 * fat_g + 2 * fiber_g = kcal')
    expect(chips(balance.left)).toEqual([
      '+4 * protein_g',
      '+4 * carbs_g',
      '-4 * fiber_g',
      '+9 * fat_g',
      '+2 * fiber_g',
    ])
    expect(chips(balance.right)).toEqual(['+kcal'])
  })

  it('keeps a column divisor as a divisor', () => {
    expect(chips(drawn('total_kcal / servings = kcal_per_serving').left)).toEqual([
      '+total_kcal / servings',
    ])
  })

  it('keeps a number divisor as the number somebody wrote', () => {
    // `per 100 g` is the meaning; a coefficient of 0.01 is not.
    expect(chips(drawn('amount_g / 100 * ingredient.kcal = kcal').left)).toEqual([
      '+amount_g * ingredient.kcal / 100',
    ])
  })

  it('carries a conversion and its bridge onto the chip', () => {
    expect(chips(drawn('amount in g via ingredient.density = weight_g').left)).toEqual([
      '+amount in g via ingredient.density',
    ])
  })

  it('reads a leading minus and a bare number', () => {
    const balance = drawn('-discount + 5 = net')
    expect(chips(balance.left)).toEqual(['-discount', '+5'])
  })

  it('turns a divisor inside out', () => {
    // `x / (y / 100)` is `100 * x / y`, and the picture says so.
    expect(chips(drawn('x / (y / 100) = z').left)).toEqual(['+100 * x / y'])
  })
})

describe('balanceOf — what it refuses rather than draws wrongly', () => {
  it.each([
    ['a sum inside a divisor', 'total / (a + b) = share'],
    ['a conversion over a bracket', '(a + b) in g = total_g'],
    ['a product of two sums', '(a + b) * (c + d) = total'],
    ['a division by zero written out', 'total / 0 = share'],
    ['an expression that is not an equation at all', 'a + b'],
  ])('refuses %s', (_what, text) => {
    expect(balanceOfText(text)).toBeUndefined()
  })
})

describe('textOf — the round trip', () => {
  it.each([
    'unit_price * quantity = line_total',
    '4 * protein_g + 4 * carbs_g + 9 * fat_g + 2 * fiber_g = kcal',
    'total_kcal / servings = kcal_per_serving',
    'amount in g via ingredient.density = weight_g',
    '-discount + 5 = net',
    'amount_g * ingredient.kcal / 100 = kcal',
  ])('writes `%s` back as itself', (text) => {
    expect(textOf(drawn(text))).toBe(text)
  })

  it('normalises without changing what the equation says', () => {
    // A chip writes every factor before every divisor. `*` and `/` share one
    // precedence and associate left, so the arithmetic is untouched.
    expect(textOf(drawn('amount_g / 100 * ingredient.kcal = kcal'))).toBe(
      'amount_g * ingredient.kcal / 100 = kcal',
    )
  })

  it('a second read of what it wrote is the same balance', () => {
    const once = drawn('4 * (carbs_g - fiber_g) = net_carb_kcal')
    expect(drawn(textOf(once))).toEqual(once)
  })

  it('writes a balance somebody built out of chips', () => {
    const balance: Balance = {
      left: [termOf('protein_g', 4), termOf('fat_g', 9), termOf('alcohol_g', -7)],
      right: [termOf('kcal')],
    }
    expect(textOf(balance)).toBe('4 * protein_g + 9 * fat_g - 7 * alcohol_g = kcal')
    expect(parseIdentity(textOf(balance))).not.toHaveProperty('problem')
  })
})

describe('weighIdentity — the verdict, drawn', () => {
  const atwater = identity(
    'macros_add_up',
    '4 * protein_g + 4 * carbs_g + 9 * fat_g = kcal',
    { tolerance: { kind: 'ABSOLUTE', amount: 2 } },
  )

  it('gives every chip its own contribution and every pan its total', () => {
    const weighed = weighIdentity(atwater, row({ protein_g: 6.6, carbs_g: 2, fat_g: 2.8, kcal: 62 }))
    expect(weighed).toBeDefined()
    expect(weighed?.left.terms.map((each) => each.value)).toMatchObject([
      { kind: 'NUMBER', value: 26.4, currency: undefined, unit: undefined },
      { kind: 'NUMBER', value: 8, currency: undefined, unit: undefined },
      { kind: 'NUMBER', value: 25.2, currency: undefined, unit: undefined },
    ])
    // `59.599999999999994` — which is why every surface prints a figure
    // through `figureText` rather than raw.
    expect(weighed?.left.total.kind).toBe('NUMBER')
    expect(weighed?.left.total).toHaveProperty('value', expect.closeTo(59.6, 8))
    expect(weighed?.right.total).toMatchObject({ kind: 'NUMBER', value: 62 })
  })

  it('reports the verdict `evaluateIdentity` gives and does not reach its own', () => {
    const inside = weighIdentity(atwater, row({ protein_g: 6.6, carbs_g: 2, fat_g: 2.8, kcal: 61 }))
    expect(inside?.verdict.kind).toBe('PROVED')
    const outside = weighIdentity(atwater, row({ protein_g: 6.6, carbs_g: 2, fat_g: 2.8, kcal: 80 }))
    expect(outside?.verdict.kind).toBe('FAILED')
  })

  it('a chip that cannot answer is the chip that greys, and the verdict is unchecked', () => {
    const weighed = weighIdentity(atwater, row({ protein_g: 6.6, fat_g: 2.8, kcal: 62 }))
    expect(weighed?.left.terms.map((each) => each.value.kind)).toEqual([
      'NUMBER',
      'UNKNOWN',
      'NUMBER',
    ])
    expect(weighed?.left.total.kind).toBe('UNKNOWN')
    expect(weighed?.verdict.kind).toBe('UNCHECKED')
  })

  it('weighs a chip unsigned, so the sign is the pan’s to draw', () => {
    const takeaway = identity('net', 'gross - discount = net', {})
    const weighed = weighIdentity(takeaway, row({ gross: 100, discount: 30, net: 70 }))
    expect(weighed?.left.terms.map((each) => each.sign)).toEqual([1, -1])
    expect(weighed?.left.terms.map((each) => each.value)).toMatchObject([
      { kind: 'NUMBER', value: 100, currency: undefined, unit: undefined },
      { kind: 'NUMBER', value: 30, currency: undefined, unit: undefined },
    ])
    expect(weighed?.verdict.kind).toBe('PROVED')
  })

  it('weighs a conversion on a chip the way the evaluator does', () => {
    const holds = identity('grams', 'amount in g = printed_g', {})
    const weighed = weighIdentity(
      holds,
      row({ amount: 1.5, printed_g: 1500 }, { units: { amount: 'kg', printed_g: 'g' } }),
    )
    expect(weighed?.left.terms[0]?.value).toMatchObject({ kind: 'NUMBER', value: 1500 })
    expect(weighed?.verdict.kind).toBe('PROVED')
  })

  it('leaves an equation that does not draw to its sentence', () => {
    expect(weighIdentity(identity('share', 'total / (a + b) = share'), row({}))).toBeUndefined()
    expect(weighIdentity(identity('broken', 'this is not algebra'), row({}))).toBeUndefined()
  })
})
