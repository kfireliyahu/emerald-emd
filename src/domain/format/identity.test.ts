import { describe, expect, it } from 'vitest'

import { column, type ColumnDeclaration } from './declaration.ts'
import {
  allowanceOf,
  columnsNamedBy,
  evaluateIdentity,
  figureIn,
  identity,
  renameInExpression,
  parseIdentity,
  readTolerance,
  toleranceText,
  identityUnitProblem,
  verdictSentence,
  type Equation,
  type IdentityInputs,
} from './identity.ts'
import { SEEDED_UNITS } from './unit.ts'

function equation(text: string): Equation {
  const parsed = parseIdentity(text)
  if ('problem' in parsed) throw new Error(parsed.problem)
  return parsed
}

function problem(text: string): string {
  const parsed = parseIdentity(text)
  if (!('problem' in parsed)) throw new Error(`${text} parsed, and it should not have`)
  return parsed.problem
}

function inputs(
  numbers: Record<string, number>,
  currencies: Record<string, string> = {},
  units: Record<string, string> = {},
  per: Record<string, string> = {},
): IdentityInputs {
  return {
    numbers: new Map(Object.entries(numbers)),
    currencies: new Map(Object.entries(currencies)),
    units: new Map(Object.entries(units)),
    per: new Map(Object.entries(per)),
  }
}

function columns(units: Record<string, string | undefined>): readonly ColumnDeclaration[] {
  return Object.entries(units).map(([name, unit]) => column(name, 'real', { unit }))
}

/** The vault's own line, and the specification for this whole file (D-210). */
const ATWATER = '4*protein_g + 4*(carbs_g - fiber_g) + 9*fat_g + 2*fiber_g = kcal'

describe('parsing', () => {
  it('reads the identity the vault wrote by hand', () => {
    expect(columnsNamedBy(equation(ATWATER))).toEqual([
      'protein_g',
      'carbs_g',
      'fiber_g',
      'fat_g',
      'kcal',
    ])
  })

  it('keeps the precedence a person expects, so a sum is not a product', () => {
    const answer = (text: string): number => {
      const verdict = evaluateIdentity(identity('x', `${text} = result`), inputs({ result: 0 }))
      return verdict.kind === 'UNCHECKED' ? Number.NaN : verdict.left
    }
    expect(answer('2 + 3 * 4')).toBe(14)
    expect(answer('(2 + 3) * 4')).toBe(20)
    expect(answer('10 - 2 - 3')).toBe(5)
    expect(answer('12 / 3 / 2')).toBe(2)
    expect(answer('-2 * 3')).toBe(-6)
  })

  it('takes the operators somebody’s keyboard produced', () => {
    // `4×6.6` is how the vault note writes it, and refusing the character would
    // be the app being pedantic about the one thing it asked for.
    const verdict = evaluateIdentity(
      identity('x', '4×2 ÷ 2 = kcal'),
      inputs({ kcal: 4 }),
    )
    expect(verdict.kind).toBe('PROVED')
  })

  it('refuses what is not an equation, in a sentence', () => {
    expect(problem('4*protein_g + kcal')).toContain('needs an `=`')
    expect(problem('a = b = c')).toContain('one `=`')
    expect(problem('= kcal')).toContain('Both sides')
    expect(problem('4 protein_g = kcal')).toContain('`*`')
    expect(problem('4 * = kcal')).toContain('not an expression')
    expect(problem('(4 * protein_g = kcal')).toContain('not an expression')
    expect(problem('4 ^ protein_g = kcal')).toContain('has no meaning')
    expect(problem('SUM(protein_g) = kcal')).toContain('has no meaning')
  })

  it('has no functions and no conditionals, which is what keeps it an expression', () => {
    // The engine's line: stateless and relational is declarable, temporal,
    // iterative or semantic is code. There is nothing in this grammar that
    // could reach the second half.
    for (const text of ['if(a, b, c) = d', 'sum(a) = b', 'a > b = c', 'a = b; c = d']) {
      expect(() => equation(text)).toThrow()
    }
  })
})

describe('a verdict', () => {
  const atwater = identity('atwater', ATWATER, { tolerance: { kind: 'RELATIVE', percent: 2 } })

  it('proves a label that adds up within its tolerance', () => {
    // 4×6.6 + 4×(2 − 1) + 9×2.8 + 2×1 = 58.4 against a printed 58.
    const verdict = evaluateIdentity(
      atwater,
      inputs({ protein_g: 6.6, carbs_g: 2, fiber_g: 1, fat_g: 2.8, kcal: 58 }),
    )
    expect(verdict.kind).toBe('PROVED')
  })

  it('fails one that does not, and says by how much', () => {
    const verdict = evaluateIdentity(
      atwater,
      inputs({ protein_g: 6.6, carbs_g: 2, fiber_g: 1, fat_g: 2.8, kcal: 200 }),
    )
    expect(verdict.kind).toBe('FAILED')
    if (verdict.kind !== 'FAILED') return
    expect(Math.round(verdict.left)).toBe(58)
    expect(verdict.right).toBe(200)
    expect(verdict.allowed).toBe(4)
  })

  it('is unchecked when the row has nothing in a column it names', () => {
    // **The common case, and not a failure** (D-149's third state): a
    // half-filled row is ordinary, and reporting it as failed would be the app
    // calling a person wrong for not having typed something yet.
    const verdict = evaluateIdentity(atwater, inputs({ protein_g: 6.6, kcal: 58 }))
    expect(verdict.kind).toBe('UNCHECKED')
    if (verdict.kind !== 'UNCHECKED') return
    expect(verdict.reason).toContain('carbs_g')
  })

  it('is unchecked when the row divides by zero', () => {
    const perUnit = identity('per_unit', 'total / units = each')
    const verdict = evaluateIdentity(perUnit, inputs({ total: 10, units: 0, each: 1 }))
    expect(verdict.kind).toBe('UNCHECKED')
    if (verdict.kind !== 'UNCHECKED') return
    expect(verdict.reason).toContain('divides by zero')
  })

  it('is unchecked when two currencies meet, because nothing here knows a rate', () => {
    // A verifier proves what it checks and nothing else (D-138). Inventing a
    // rate inside a proof is the exact shape that keeps costing this project.
    const verdict = evaluateIdentity(
      identity('paid', 'price + shipping = total'),
      inputs(
        { price: 1000, shipping: 500, total: 1500 },
        { price: 'ILS', shipping: 'USD', total: 'ILS' },
      ),
    )
    expect(verdict.kind).toBe('UNCHECKED')
    if (verdict.kind !== 'UNCHECKED') return
    expect(verdict.reason).toContain('ILS')
    expect(verdict.reason).toContain('USD')
  })

  it('lets money meet a plain number, which is what a price times a quantity is', () => {
    const verdict = evaluateIdentity(
      identity('line', 'units * unit_price = line_total'),
      inputs({ units: 3, unit_price: 1290, line_total: 3870 }, { unit_price: 'ILS', line_total: 'ILS' }),
    )
    expect(verdict.kind).toBe('PROVED')
  })

  it('is exact when the tolerance is zero, which is what minor units want', () => {
    const exact = identity('paid', 'price + fee = total')
    expect(evaluateIdentity(exact, inputs({ price: 1000, fee: 90, total: 1090 })).kind).toBe(
      'PROVED',
    )
    expect(evaluateIdentity(exact, inputs({ price: 1000, fee: 90, total: 1091 })).kind).toBe(
      'FAILED',
    )
  })

  it('never throws, whatever the row holds', () => {
    // Total on purpose: every way out of an identity is a verdict a surface can
    // print, because every one of them is a real state of a real row.
    const wild = identity('wild', 'a / b + c * d = e')
    for (const row of [{}, { a: 1 }, { a: 1, b: 0, c: 1, d: 1, e: 1 }, { a: 1e308, b: 1e-308, c: 1, d: 1, e: 1 }]) {
      expect(() => evaluateIdentity(wild, inputs(row))).not.toThrow()
    }
  })

  it('is unchecked rather than thrown when the expression no longer parses', () => {
    // The declaration was refused if it does not parse, so this is a guard and
    // not a path — but a stored document is a file somebody can edit.
    const verdict = evaluateIdentity(identity('broken', 'kcal'), inputs({ kcal: 1 }))
    expect(verdict.kind).toBe('UNCHECKED')
  })
})

describe('the tolerance', () => {
  it('is an amount or a percentage of the right-hand side', () => {
    expect(allowanceOf({ kind: 'ABSOLUTE', amount: 2 }, 100)).toBe(2)
    expect(allowanceOf({ kind: 'RELATIVE', percent: 2 }, 100)).toBe(2)
    expect(allowanceOf({ kind: 'RELATIVE', percent: 2 }, 50)).toBe(1)
    // A percentage of nothing is nothing, which is exact and is honest.
    expect(allowanceOf({ kind: 'RELATIVE', percent: 2 }, 0)).toBe(0)
  })

  it('writes and reads back the three shapes the artefact carries', () => {
    expect(toleranceText({ kind: 'ABSOLUTE', amount: 0 })).toBe('exactly')
    expect(toleranceText({ kind: 'ABSOLUTE', amount: 2 })).toBe('± 2')
    expect(toleranceText({ kind: 'RELATIVE', percent: 2.5 })).toBe('± 2.5%')

    for (const tolerance of [
      { kind: 'ABSOLUTE' as const, amount: 0 },
      { kind: 'ABSOLUTE' as const, amount: 2 },
      { kind: 'RELATIVE' as const, percent: 2.5 },
    ]) {
      expect(readTolerance(toleranceText(tolerance))).toEqual(tolerance)
    }
  })

  it('reads what a person or a model would plausibly write', () => {
    expect(readTolerance('')).toEqual({ kind: 'ABSOLUTE', amount: 0 })
    expect(readTolerance('exact')).toEqual({ kind: 'ABSOLUTE', amount: 0 })
    expect(readTolerance('2')).toEqual({ kind: 'ABSOLUTE', amount: 2 })
    expect(readTolerance('2%')).toEqual({ kind: 'RELATIVE', percent: 2 })
    expect(readTolerance('±2 %')).toEqual({ kind: 'RELATIVE', percent: 2 })
    expect(readTolerance('a bit')).toBeUndefined()
    expect(readTolerance('-2')).toBeUndefined()
  })
})

describe('what a surface says', () => {
  it('rounds, because a real identity lands on 61.599999999999994', () => {
    const verdict = evaluateIdentity(
      identity('atwater', ATWATER, { tolerance: { kind: 'ABSOLUTE', amount: 1 } }),
      inputs({ protein_g: 6.6, carbs_g: 2, fiber_g: 1, fat_g: 2.8, kcal: 58.4 }),
    )
    const sentence = verdictSentence(identity('atwater', ATWATER), verdict)
    expect(sentence).toContain('58.4')
    expect(sentence).not.toContain('999')
  })

  it('names the identity and the state in the first three words', () => {
    const failed = evaluateIdentity(
      identity('paid', 'price = total'),
      inputs({ price: 1, total: 2 }),
    )
    expect(verdictSentence(identity('paid', 'price = total'), failed)).toContain('paid: failed')
    const unchecked = evaluateIdentity(identity('paid', 'price = total'), inputs({ price: 1 }))
    expect(verdictSentence(identity('paid', 'price = total'), unchecked)).toContain(
      'paid: unchecked',
    )
  })
})


/* ---------------------------------------------------- converting, U4a, D-223 */

describe('`in`', () => {
  it('parses as a postfix that binds tighter than a product', () => {
    // `weight in kg * price` is `(weight in kg) * price`, and the test is here
    // rather than in a comment because the alternative reading is the one a
    // person would be silently wrong about.
    const parsed = equation('weight in kg * price = total')
    expect(parsed.left.kind).toBe('MULTIPLY')
    expect(parsed.left.kind === 'MULTIPLY' ? parsed.left.left.kind : undefined).toBe('IN')
  })

  it('needs a unit after it', () => {
    expect(problem('weight in = 3')).toContain('needs a unit')
    expect(problem('weight in ( = 3')).toContain('needs a unit')
  })

  it('converts a whole expression when it is bracketed', () => {
    const parsed = equation('(sample_g + rest_g) in kg = total_kg')
    expect(parsed.left.kind).toBe('IN')
  })

  it('is still found by columnsNamedBy underneath', () => {
    expect(columnsNamedBy(equation('weight in kg = total'))).toEqual(['weight', 'total'])
  })

  it('converts a row, so a kilogram proves against grams', () => {
    const declaration = identity('portions', 'pack in g = serving * servings')
    const verdict = evaluateIdentity(
      declaration,
      inputs(
        { pack: 1.5, serving: 250, servings: 6 },
        {},
        { pack: 'kg', serving: 'g' },
      ),
      SEEDED_UNITS,
    )
    expect(verdict.kind).toBe('PROVED')
  })

  it('fails where the arithmetic is wrong rather than where the unit is', () => {
    const declaration = identity('portions', 'pack in g = serving * servings')
    const verdict = evaluateIdentity(
      declaration,
      inputs({ pack: 1.5, serving: 250, servings: 5 }, {}, { pack: 'kg', serving: 'g' }),
      SEEDED_UNITS,
    )
    expect(verdict.kind).toBe('FAILED')
  })

  it('is unchecked, not failed, when the row says nothing about the unit', () => {
    const declaration = identity('portions', 'pack in g = serving')
    const verdict = evaluateIdentity(declaration, inputs({ pack: 1.5, serving: 250 }), SEEDED_UNITS)
    expect(verdict.kind).toBe('UNCHECKED')
    expect(verdict.kind === 'UNCHECKED' ? verdict.reason : '').toContain('carries no unit')
  })

  it('is unchecked across a dimension, and says what is missing', () => {
    const declaration = identity('weighs', 'volume in g = weight')
    const verdict = evaluateIdentity(
      declaration,
      inputs({ volume: 200, weight: 210 }, {}, { volume: 'ml', weight: 'g' }),
      SEEDED_UNITS,
    )
    expect(verdict.kind).toBe('UNCHECKED')
    expect(verdict.kind === 'UNCHECKED' ? verdict.reason : '').toContain('density')
  })
})

describe('what a declaration can say about a conversion before there is a row', () => {
  it('passes a conversion inside a dimension', () => {
    expect(
      identityUnitProblem(equation('pack in g = serving'), columns({ pack: 'kg', serving: 'g' })),
    ).toBeUndefined()
  })

  it('refuses a unit the document does not know', () => {
    expect(
      identityUnitProblem(equation('pack in slice = serving'), columns({ pack: 'kg' })),
    ).toContain('not a unit this document knows')
  })

  it('refuses a conversion across a dimension, which is where H7 draws the line', () => {
    const rejection = identityUnitProblem(
      equation('volume in g = weight'),
      columns({ volume: 'ml', weight: 'g' }),
    )
    expect(rejection).toContain('density')
    expect(rejection).toContain('column of this format')
  })

  it('refuses converting a figure that has no unit at all', () => {
    expect(identityUnitProblem(equation('servings in g = weight'), columns({ weight: 'g' }))).toContain(
      'nothing to convert',
    )
  })

  it('refuses converting a figure whose own unit this document has never heard of', () => {
    expect(
      identityUnitProblem(equation('pack in g = serving'), columns({ pack: 'per 100g' })),
    ).toContain('no unit called per')
  })

  it('says nothing about an expression whose unit it cannot work out', () => {
    // Two units meeting in a product name no unit this file will state, and the
    // honest answer is `unchecked` on the row rather than a refusal on the
    // declaration.
    expect(
      identityUnitProblem(
        equation('(weight * volume) in g = total'),
        columns({ weight: 'g', volume: 'ml' }),
      ),
    ).toBeUndefined()
  })

  /**
   * **The flagship identity of this milestone adds grams and compares them to
   * an energy, and it is correct.** Atwater's 4 is `kcal/g`, the coefficient
   * carries the dimension, and no declaration says so — so an engine that
   * checked dimensions on every sum would report it as a problem. It does not
   * check them; it converts where somebody asked.
   */
  it('leaves an identity with no `in` in it entirely alone', () => {
    expect(
      identityUnitProblem(
        equation(ATWATER),
        columns({ protein_g: 'g', carbs_g: 'g', fiber_g: 'g', fat_g: 'g', kcal: 'kcal' }),
      ),
    ).toBeUndefined()
  })
})

/**
 * **`via` — a conversion that crosses a dimension** (U4c, D-225).
 *
 * The recipe case, which is what this whole unit was for: a line that is `150
 * g` on one row and `200 ml` on the next, totalled in grams through a density
 * that lives on the ingredient.
 */
describe('crossing a dimension in an identity', () => {
  /** A recipe line: an amount whose unit is the row's, and the density one hop away. */
  function line(amount: number, unit: string, density?: number): IdentityInputs {
    return inputs(
      density === undefined ? { amount } : { amount, 'ingredient.density': density },
      {},
      density === undefined
        ? { amount: unit }
        : { amount: unit, 'ingredient.density': 'g' },
      density === undefined ? {} : { 'ingredient.density': 'ml' },
    )
  }

  it('parses the clause and hangs it off the conversion it follows', () => {
    const parsed = equation('amount in g via ingredient.density = weight_g')
    expect(parsed.left).toEqual({
      kind: 'IN',
      of: { kind: 'COLUMN', name: 'amount' },
      unit: 'g',
      via: 'ingredient.density',
    })
  })

  it('names the bridge among the columns it reads, so every check already written covers it', () => {
    expect(columnsNamedBy(equation('amount in g via ingredient.density = weight_g'))).toEqual([
      'amount',
      'ingredient.density',
      'weight_g',
    ])
  })

  it('refuses a second hop inside the bridge, like anywhere else', () => {
    expect(problem('amount in g via ingredient.supplier.density = x')).toContain('two links')
  })

  it('refuses a `via` that follows no conversion', () => {
    expect(problem('amount via density = x')).toContain('follows no conversion')
  })

  it('converts a millilitre line into grams through the density', () => {
    const verdict = evaluateIdentity(
      identity('weighs', 'amount in g via ingredient.density = 188'),
      line(200, 'ml', 0.94),
    )
    expect(verdict.kind).toBe('PROVED')
  })

  /**
   * **The property the type exists for.** The same identity, a row in grams,
   * and the bridge never read — so one line covers a recipe whose lines are in
   * grams, millilitres and eggs.
   */
  it('converts a gram line without touching the density at all', () => {
    const verdict = evaluateIdentity(
      identity('weighs', 'amount in g via ingredient.density = 150'),
      line(150, 'g'),
    )
    expect(verdict.kind).toBe('PROVED')
  })

  it('is unchecked, naming the column, when the row has no fact to cross through', () => {
    const verdict = evaluateIdentity(
      identity('weighs', 'amount in g via ingredient.density = 188'),
      line(200, 'ml'),
    )
    expect(verdict.kind).toBe('UNCHECKED')
    expect(verdict.kind === 'UNCHECKED' && verdict.reason).toContain('ingredient.density')
  })

  it('is unchecked when the bridge column was never declared as a ratio', () => {
    const verdict = evaluateIdentity(
      identity('weighs', 'amount in g via ingredient.density = 188'),
      inputs({ amount: 200, 'ingredient.density': 0.94 }, {}, { amount: 'ml' }),
    )
    expect(verdict.kind).toBe('UNCHECKED')
    expect(verdict.kind === 'UNCHECKED' && verdict.reason).toContain('one unit per another')
  })
})

describe('what a declaration can say about a bridge before there is a row', () => {
  function withRatio(): readonly ColumnDeclaration[] {
    return [
      column('amount', 'quantity'),
      column('weight_g', 'real', { unit: 'g' }),
      column('volume_ml', 'real', { unit: 'ml' }),
      column('density', 'real', { unit: 'g', per: 'ml' }),
      column('plain', 'real', { unit: 'g' }),
    ]
  }

  it('allows a quantity to be converted, because only the row can say what it is in', () => {
    expect(
      identityUnitProblem(equation('amount in g via density = weight_g'), withRatio()),
    ).toBeUndefined()
  })

  it('does not say a quantity has no unit, which is the whole of what it has', () => {
    // The `NONE` refusal would be exactly wrong here: there is a unit, and it
    // is in the row.
    expect(identityUnitProblem(equation('amount in g = weight_g'), withRatio())).toBeUndefined()
  })

  it('refuses a bridge that is not a ratio', () => {
    expect(
      identityUnitProblem(equation('volume_ml in g via plain = weight_g'), withRatio()),
    ).toContain('not a ratio')
  })

  it('refuses a bridge that could not land in the unit asked for', () => {
    expect(
      identityUnitProblem(equation('volume_ml in kcal via density = weight_g'), withRatio()),
    ).toContain('Nothing bridged through it could land there')
  })

  it('refuses a `via` on a conversion that never needed one', () => {
    expect(
      identityUnitProblem(equation('weight_g in kg via density = plain'), withRatio()),
    ).toContain('Take the `via` out')
  })

  it('names the way through when a crossing is written without one', () => {
    const rejection = identityUnitProblem(equation('volume_ml in g = weight_g'), withRatio())
    expect(rejection).toContain('a density')
    expect(rejection).toContain('via')
  })
})

describe('a column renamed inside an expression (M26 U3)', () => {
  it('follows its own names and its link’s hop, and leaves another’s column and a unit alone', () => {
    expect(renameInExpression('kcal = ingredient.kcal * grams / 100', 'grams', 'weight')).toBe(
      'kcal = ingredient.kcal * weight / 100',
    )
    expect(renameInExpression('kcal = ingredient.kcal * grams / 100', 'ingredient', 'item')).toBe(
      'kcal = item.kcal * grams / 100',
    )
    expect(renameInExpression('kcal = ingredient.kcal * grams / 100', 'kcal', 'energy')).toBe(
      'energy = ingredient.kcal * grams / 100',
    )
    expect(renameInExpression('total = g in g + grams', 'g', 'mass')).toBe('total = mass in g + grams')
  })
})

describe('a check over money is said in money (M33 U2)', () => {
  // A receipt's printed total against the card charge that paid it: one hop,
  // negated, because a charge is stored as money going out.
  const charged = identity('charged', 'total = -paid_with.amount')
  const receipt = inputs({ total: 8400, 'paid_with.amount': -9600 }, { total: 'ILS', 'paid_with.amount': 'ILS' })

  it('carries the currency its sides were in, and its figures stay minor units', () => {
    const verdict = evaluateIdentity(charged, receipt)
    expect(verdict).toEqual({ kind: 'FAILED', left: 8400, right: 9600, difference: 1200, allowed: 0, currency: 'ILS' })
  })

  it('prints the sentence in that currency rather than in agorot', () => {
    expect(verdictSentence(charged, evaluateIdentity(charged, receipt))).toBe(
      'charged: failed — ₪84.00 against ₪96.00, off by ₪12.00 where ₪0.00 is allowed.',
    )
  })

  it('stays unchecked across two currencies, naming both', () => {
    const abroad = inputs({ total: 8400, 'paid_with.amount': -9600 }, { total: 'USD', 'paid_with.amount': 'ILS' })
    expect(evaluateIdentity(charged, abroad)).toMatchObject({ kind: 'UNCHECKED', reason: expect.stringMatching(/USD.*ILS/) })
  })

  it('keeps a figure that is not whole minor units, over the major unit', () => {
    expect(figureIn('ILS')(8400)).toBe('₪84.00')
    expect(figureIn('ILS')(12.5)).toBe('ILS 0.125')
    expect(figureIn(undefined)(8400)).toBe('8400')
  })
})
