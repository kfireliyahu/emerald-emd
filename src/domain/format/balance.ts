/**
 * **A balance — what has to add up, as a picture** — M20 U4,
 * [D-232](../../../docs/09-decision-log.md).
 *
 * An identity is a line of algebra, and this is the shape that lets a screen
 * draw one instead of printing it:
 *
 * > **these things, weighted, equal that thing** — two pans, a chip on each for
 * > every weighed column, and how far apart they may be under the fulcrum.
 *
 * **It draws a verdict and no longer writes one.** U4 used the same picture for
 * both, and the first was accepted and the second rejected; T4 (D-236)
 * took the builder away and asks *is this column worked out from the others?*
 * instead. `workedOut.ts` is that reading, and it writes through `textOf` here,
 * so this file is still the one place a picture becomes characters.
 *
 * ## It is a view over the text, not a second place to keep one
 *
 * `IdentityDeclaration.expression` is still the one storage and still a string.
 * A balance is read out of it and written back into it, so the artefact, the
 * markdown, `declare_format` and the plugin's refusals are untouched, and a
 * conversation and a screen still write the same characters. **A second
 * representation would be a second vocabulary**, which is the drift D-227
 * caught between the editor and the tool and the thing M20 exists to stop.
 *
 * So there is no `BalanceDeclaration`, no migration, and nothing here is
 * stored. `balanceOf` reads; `textOf` writes; and a round trip through both is
 * the same balance, which `balance.test.ts` is mostly about.
 *
 * ## What flattens, and the one that deliberately does not
 *
 * The flagship case flattens, which is what makes the picture honest rather
 * than a diagram of a different equation: `4 * (carbs_g - fiber_g)` is
 * `4 * carbs_g - 4 * fiber_g`, so Atwater is a flat signed sum of five chips.
 * A term is a **signed product over a product** —
 * `coefficient × factor × factor ÷ divisor` — which also covers
 * `unit_price * quantity = line_total` and `total_kcal / servings`, the two
 * real shapes a flat sum of single columns would have missed.
 *
 * **A number in a divisor is kept as a number** rather than folded into the
 * coefficient: `amount_g / 100 * ingredient.kcal` is the shape every per-100g
 * label in this project is written in, and a chip reading `0.01 * amount_g *
 * ingredient.kcal` would have thrown away the *per 100* that is the whole
 * meaning. So a term divides by a figure as well as by columns, and the round
 * trip gives `/ 100` back.
 *
 * What does not flatten: a sum inside a divisor, a conversion applied to a
 * bracket, and a product of two sums. Each comes back `undefined`, and
 * **`undefined` is not a failure**: the editor keeps the text box for it, which
 * is the escape hatch the algebra deserves and the reason this file may refuse
 * anything it is not sure of.
 *
 * ## The second half is the verdict, and it proves nothing of its own
 *
 * The same picture draws what a row did: each chip its own contribution, each
 * pan its total, `unchecked` a greyed chip that greys the whole balance. That
 * is D-138 drawn rather than asserted — you can see which chip could not answer
 * and why the fold went grey.
 *
 * **The verdict is `evaluateIdentity`'s and the pan totals are the equation's
 * own two sides**, evaluated by `evaluateExpression` on the parsed expression
 * rather than by adding the chips up here. The chips are a decomposition for a
 * person to read, never the arithmetic the verdict came from, because a second
 * evaluator agreeing today is a second evaluator disagreeing in a month about a
 * currency, a unit or a rounding — in a figure nobody was checking.
 */

import {
  columnsNamedBy,
  evaluateExpression,
  evaluateIdentity,
  parseIdentity,
  type Equation,
  type Expression,
  type IdentityDeclaration,
  type IdentityInputs,
  type Value,
  type Verdict,
} from './identity.ts'
import { SEEDED_UNITS, type UnitTable } from './unit.ts'

/* ------------------------------------------------------------- the picture */

/**
 * One column on a chip, with whatever the conversion on it says.
 *
 * `column` may be a dotted one-hop name (`ingredient.kcal`, D-224) exactly as
 * it may in the text, because a hop is a name to everything but the repository
 * that resolves it.
 */
export interface Factor {
  readonly column: string
  /** `in g` — what this figure is to be read as before the arithmetic. */
  readonly unit: string | undefined
  /** `via ingredient.density` — the declared fact a conversion crosses a dimension through. */
  readonly via: string | undefined
}

/**
 * One chip: a signed product over a product.
 *
 * `4 * carbs_g` is a coefficient and one factor; `unit_price * quantity` is
 * two factors; `total_kcal / servings` is a factor and a divisor. **No
 * factors at all is a plain number** — the coefficient is the whole chip, which
 * is how `printed_total + 5` draws.
 */
export interface Term {
  readonly coefficient: number
  readonly factors: readonly Factor[]
  /** Columns the product is divided by — `servings` in `total_kcal / servings`. */
  readonly divisors: readonly Factor[]
  /**
   * The figure the product is divided by — `100` in `amount_g * kcal / 100`.
   *
   * `1` when nothing is written, and a number rather than a smaller
   * coefficient because `per 100 g` is what a label means and `0.01` is not.
   */
  readonly divideBy: number
}

/** Two pans. Each is a signed sum of chips, and neither is ever empty. */
export interface Balance {
  readonly left: readonly Term[]
  readonly right: readonly Term[]
}

/** A chip for one column, weighed by one number. The resting state of a new one. */
export function termOf(column: string, coefficient = 1): Term {
  return {
    coefficient,
    factors: column === '' ? [] : [{ column, unit: undefined, via: undefined }],
    divisors: [],
    divideBy: 1,
  }
}

/* --------------------------------------------------------------- the read */

/**
 * The balance an equation draws as, or `undefined` for one that does not.
 *
 * Total and never throws. See the note above for what does not flatten and why
 * refusing is the right answer rather than a gap.
 */
export function balanceOf(equation: Equation): Balance | undefined {
  const left = flatten(equation.left, 1)
  if (left === undefined) return undefined
  const right = flatten(equation.right, 1)
  if (right === undefined) return undefined
  return { left, right }
}

/** The same, from the text an identity actually stores. */
export function balanceOfText(text: string): Balance | undefined {
  const equation = parseIdentity(text)
  return 'problem' in equation ? undefined : balanceOf(equation)
}

function flatten(expression: Expression, sign: number): readonly Term[] | undefined {
  switch (expression.kind) {
    case 'NUMBER':
      return [{ coefficient: sign * expression.value, factors: [], divisors: [], divideBy: 1 }]
    case 'COLUMN':
      return [
        {
          coefficient: sign,
          factors: [{ column: expression.name, unit: undefined, via: undefined }],
          divisors: [],
          divideBy: 1,
        },
      ]
    case 'IN':
      // Only a bare column converts into a chip. `(a + b) in g` is a real
      // expression and a chip cannot say it, so the text box keeps it.
      if (expression.of.kind !== 'COLUMN') return undefined
      return [
        {
          coefficient: sign,
          factors: [
            { column: expression.of.name, unit: expression.unit, via: expression.via },
          ],
          divisors: [],
          divideBy: 1,
        },
      ]
    case 'NEGATE':
      return flatten(expression.of, -sign)
    case 'ADD':
    case 'SUBTRACT': {
      const left = flatten(expression.left, sign)
      if (left === undefined) return undefined
      const right = flatten(expression.right, expression.kind === 'ADD' ? sign : -sign)
      if (right === undefined) return undefined
      return [...left, ...right]
    }
    case 'MULTIPLY': {
      const left = flatten(expression.left, sign)
      if (left === undefined) return undefined
      const right = flatten(expression.right, 1)
      if (right === undefined) return undefined
      // `4 * (carbs - fiber)` distributes and is the case that matters. Two
      // sums multiplied would too, and it is refused rather than drawn: the
      // chips would no longer be the terms somebody wrote.
      if (left.length > 1 && right.length > 1) return undefined
      return left.flatMap((one) => right.map((other) => times(one, other)))
    }
    case 'DIVIDE': {
      const left = flatten(expression.left, sign)
      if (left === undefined) return undefined
      const right = flatten(expression.right, 1)
      if (right === undefined) return undefined
      // A sum in a divisor is the thing a chip cannot say; one term of any
      // shape is fine, and it turns inside out — its factors become divisors
      // and its divisors factors.
      const only = right[0]
      if (right.length !== 1 || only === undefined || only.coefficient === 0) return undefined
      return left.map((one) => ({
        coefficient: one.coefficient * Math.sign(only.coefficient) * only.divideBy,
        factors: [...one.factors, ...only.divisors],
        divisors: [...one.divisors, ...only.factors],
        divideBy: one.divideBy * Math.abs(only.coefficient),
      }))
    }
  }
}

function times(one: Term, other: Term): Term {
  return {
    coefficient: one.coefficient * other.coefficient,
    factors: [...one.factors, ...other.factors],
    divisors: [...one.divisors, ...other.divisors],
    divideBy: one.divideBy * other.divideBy,
  }
}

/* -------------------------------------------------------------- the write */

/** The equation a balance is, as the text an identity stores. */
export function textOf(balance: Balance): string {
  return `${panText(balance.left)} = ${panText(balance.right)}`
}

function panText(terms: readonly Term[]): string {
  return terms
    .map((term, index) => {
      const body = termText(term)
      if (index === 0) return term.coefficient < 0 ? `-${body}` : body
      return term.coefficient < 0 ? ` - ${body}` : ` + ${body}`
    })
    .join('')
}

/**
 * One chip, without its sign — the sign belongs to the pan that lays it out.
 *
 * **Every factor is written before every divisor**, which needs no brackets:
 * `*` and `/` are left-associative at one precedence, so `4 * a * b / c` is
 * `((4 * a) * b) / c`, which is the term. `in` binds tighter than either, so a
 * conversion needs none either.
 */
export function termText(term: Term): string {
  const size = Math.abs(term.coefficient)
  const pieces = term.factors.map(factorText)
  if (pieces.length === 0 || size !== 1) pieces.unshift(figure(size))
  const product = pieces.join(' * ')
  const over = term.divideBy === 1 ? product : `${product} / ${figure(term.divideBy)}`
  return term.divisors.reduce((text, each) => `${text} / ${factorText(each)}`, over)
}

function factorText(factor: Factor): string {
  const conversion = factor.unit === undefined ? '' : ` in ${factor.unit}`
  const bridge = factor.via === undefined ? '' : ` via ${factor.via}`
  return `${factor.column}${conversion}${bridge}`
}

function figure(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toPrecision(12))) : String(value)
}

/* ------------------------------------------------------------ the weighing */

/** One chip, and what it came to in this row. */
export interface WeighedTerm {
  readonly term: Term
  /** What the chip reads, unsigned — `4 * carbs_g`. */
  readonly text: string
  /** `-1` for a chip the pan subtracts, `1` otherwise. */
  readonly sign: number
  readonly value: Value
}

/** One pan, and what the side of the equation it draws came to. */
export interface WeighedPan {
  readonly terms: readonly WeighedTerm[]
  readonly total: Value
}

/**
 * A row, drawn on the balance.
 *
 * The verdict is `evaluateIdentity`'s, unaltered. Nothing in here recomputes
 * it, and a chip that disagreed with a pan would be a bug in the picture rather
 * than a different answer about the row.
 */
export interface WeighedBalance {
  readonly balance: Balance
  readonly left: WeighedPan
  readonly right: WeighedPan
  readonly verdict: Verdict
}

/**
 * One identity, one row, as the picture — or `undefined` when the equation does
 * not draw as one, which leaves the caller its sentence.
 */
export function weighIdentity(
  declaration: IdentityDeclaration,
  inputs: IdentityInputs,
  units: UnitTable = SEEDED_UNITS,
): WeighedBalance | undefined {
  const equation = parseIdentity(declaration.expression)
  if ('problem' in equation) return undefined
  const balance = balanceOf(equation)
  if (balance === undefined) return undefined
  // `end - start` is one span, not two chips: a time on a pan would be weighed
  // as a figure it is not (M29 U4, D-335). The sentence says it instead.
  if (columnsNamedBy(equation).some((name) => inputs.points?.has(name) === true)) return undefined

  return {
    balance,
    left: weighPan(balance.left, equation.left, inputs, units),
    right: weighPan(balance.right, equation.right, inputs, units),
    verdict: evaluateIdentity(declaration, inputs, units),
  }
}

function weighPan(
  terms: readonly Term[],
  side: Expression,
  inputs: IdentityInputs,
  units: UnitTable,
): WeighedPan {
  return {
    terms: terms.map((term) => ({
      term,
      text: termText(term),
      sign: term.coefficient < 0 ? -1 : 1,
      value: evaluateExpression(expressionOf(unsigned(term)), inputs, units),
    })),
    // The side as written, so the figure under the pan is the one the verdict
    // was reached from rather than a sum of the chips above it.
    total: evaluateExpression(side, inputs, units),
  }
}

function unsigned(term: Term): Term {
  return { ...term, coefficient: Math.abs(term.coefficient) }
}

/** One chip as something the evaluator can be given. Built, never re-parsed. */
export function expressionOf(term: Term): Expression {
  const factors = term.factors.map(factorExpression)
  let product: Expression
  const [first, ...rest] = factors
  if (first === undefined) {
    product = { kind: 'NUMBER', value: term.coefficient }
  } else {
    product = rest.reduce<Expression>(
      (left, right) => ({ kind: 'MULTIPLY', left, right }),
      first,
    )
    if (term.coefficient !== 1) {
      product = {
        kind: 'MULTIPLY',
        left: { kind: 'NUMBER', value: term.coefficient },
        right: product,
      }
    }
  }
  const over: Expression =
    term.divideBy === 1
      ? product
      : { kind: 'DIVIDE', left: product, right: { kind: 'NUMBER', value: term.divideBy } }
  return term.divisors.reduce<Expression>(
    (left, each) => ({ kind: 'DIVIDE', left, right: factorExpression(each) }),
    over,
  )
}

function factorExpression(factor: Factor): Expression {
  const column: Expression = { kind: 'COLUMN', name: factor.column }
  if (factor.unit === undefined) return column
  return { kind: 'IN', of: column, unit: factor.unit, via: factor.via }
}
