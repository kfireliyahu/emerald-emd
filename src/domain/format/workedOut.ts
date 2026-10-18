/**
 * **A column worked out from the others** — M20 T4,
 * [D-236](../../../docs/09-decision-log.md).
 *
 * ## Why an identity stopped being an equation
 *
 * M19 asked a person to type `4 * protein_g + 4 * carbs_g - 4 * fiber_g + 9 *
 * fat_g = kcal` into a box. M20 drew the same line as a balance — two pans, a
 * chip per weighed column — and a review of it called the section
 * counterintuitive. Twice rebuilt, twice not obvious, and the split the second
 * review found is the one that explains it: **the balance is a good way to read
 * a verdict and a bad way to write one.** Reading, you are handed the picture
 * and asked what it says. Writing, you are handed two empty pans and asked to
 * assemble algebra, which is a harder question than the one you actually have.
 *
 * The question you actually have is about **one column**:
 *
 * > **Is `kcal` worked out from your other columns?**
 *
 * In every real identity this project has, one side is a single column —
 * `4*protein_g + … = kcal`, `unit_price * quantity = line_total`. So the
 * surface stops offering two sides and asks from the answering column's side:
 * is it worked out, what are the parts, how close does it have to be. Nothing
 * to assemble, and the question arrives while somebody is already thinking
 * about that column.
 *
 * ## It is a view over the text, and it is the *second* such view
 *
 * `IdentityDeclaration.expression` is still the one storage and still a string
 * (D-232 argues it, and T4 changes nothing about that). This file reads one out
 * and writes one back through `balance.ts`, so there is still exactly one piece
 * of code that turns a picture into characters, and a conversation and a screen
 * still write the same line.
 *
 * **Nothing here is stored, so nothing here is a second vocabulary** — which is
 * what lets the balance keep drawing the verdict unchanged while this replaces
 * how one is written.
 *
 * ## What it refuses, and why refusing is the whole design
 *
 * A part is **a multiplier and one or more columns**, and it may take one
 * column off (`4 * (carbs_g - fiber_g)`, `carbs_g` being USDA-style and
 * including the fibre). Everything past that — a divisor of any kind, a
 * conversion, a bare number, a sum inside a divisor — comes back `undefined`
 * and **`undefined` is not a failure**: the text box is still there, still
 * checked identically, and it is where the algebra that deserves algebra lives.
 *
 * Refusing generously is what keeps this three questions rather than a formula
 * bar.
 *
 * ## The one thing a round trip cannot preserve
 *
 * `a - b` and `1 * a + (-1) * b` are the same characters once flattened, so the
 * text cannot say which was meant. It is read as **one part that takes a column
 * off**, because `4 × (carbs − fibre)` is *net carbs* while `+4 carbs, −4
 * fibre` is two unrelated facts. Typing `-1` into a multiplier therefore
 * collapses two parts into one on the next read. Nothing the surface offers can
 * reach that state, and the arithmetic is identical either way.
 */

import { balanceOfText, termOf, textOf, type Balance, type Term } from './balance.ts'

/**
 * One part of the answer: `4 * protein_g`, `unit_price * quantity`,
 * `4 * (carbs_g - fiber_g)`.
 */
export interface Part {
  /** `4` in `4 * protein_g`. `1` is the resting state; negative subtracts the part. */
  readonly multiplier: number
  /** The columns multiplied together. One, usually; never none. */
  readonly columns: readonly string[]
  /**
   * One column taken off before the multiplier — the `fiber_g` in
   * `4 * (carbs_g - fiber_g)`.
   *
   * **Only ever on a part naming a single column.** `m * (a * b - c)` is not
   * `m * a * b - m * c`, so a product that also subtracts is arithmetic this
   * shape cannot say, and `textOfWorkedOut` will not pretend otherwise.
   */
  readonly less: string | undefined
}

/** A column, and the parts that work it out. `parts` is never empty. */
export interface WorkedOut {
  readonly column: string
  readonly parts: readonly Part[]
}

/** A part at rest: one column, weighed by one. */
export function partOf(column: string, multiplier = 1): Part {
  return { multiplier, columns: [column], less: undefined }
}

/* --------------------------------------------------------------- the read */

/** The column an identity works out, or `undefined` for one that works out none. */
export function workedOutColumn(text: string): string | undefined {
  return workedOutOfText(text)?.column
}

/** What an identity's text says, read from the answering column's side. */
export function workedOutOfText(text: string): WorkedOut | undefined {
  const balance = balanceOfText(text)
  return balance === undefined ? undefined : workedOutOf(balance)
}

/**
 * The same, from a balance.
 *
 * **The right pan is tried first**, because it is the side this file writes and
 * the side both of the project's real identities put the answer on. A person
 * who typed `kcal = 4 * protein_g` into the box is still read, and is rewritten
 * the canonical way round the moment the surface edits it.
 */
export function workedOutOf(balance: Balance): WorkedOut | undefined {
  return read(balance.right, balance.left) ?? read(balance.left, balance.right)
}

function read(answer: readonly Term[], rest: readonly Term[]): WorkedOut | undefined {
  const column = answeringColumn(answer)
  if (column === undefined) return undefined
  const parts = partsOf(rest)
  if (parts === undefined || parts.length === 0) return undefined
  return { column, parts }
}

/**
 * The column a pan holds, if it holds exactly one and nothing else.
 *
 * Unweighed, undivided and unconverted: `4 * kcal` is not *what kcal comes to*,
 * and a hop (`ingredient.kcal`) is a column of another row, which is not
 * something this row works out.
 */
function answeringColumn(terms: readonly Term[]): string | undefined {
  const only = terms.length === 1 ? terms[0] : undefined
  if (only === undefined) return undefined
  if (only.coefficient !== 1 || only.divisors.length > 0 || only.divideBy !== 1) return undefined
  const factor = only.factors.length === 1 ? only.factors[0] : undefined
  if (factor === undefined || factor.unit !== undefined || factor.via !== undefined) return undefined
  return factor.column.includes('.') ? undefined : factor.column
}

function partsOf(terms: readonly Term[]): readonly Part[] | undefined {
  const flat: { readonly multiplier: number; readonly columns: readonly string[] }[] = []
  for (const term of terms) {
    // A divisor is the thing a part cannot say and the text box can. A bare
    // number (`+ 5`) names no column, which is not a part either.
    if (term.divisors.length > 0 || term.divideBy !== 1 || term.factors.length === 0) {
      return undefined
    }
    if (term.factors.some((each) => each.unit !== undefined || each.via !== undefined)) {
      return undefined
    }
    flat.push({ multiplier: term.coefficient, columns: term.factors.map((each) => each.column) })
  }

  // Two single-column terms that cancel are the bracket somebody wrote. See the
  // note above for why this reading is preferred and what it costs.
  const parts: Part[] = []
  for (let at = 0; at < flat.length; at += 1) {
    const one = flat[at]
    if (one === undefined) continue
    const next = flat[at + 1]
    const column = one.columns.length === 1 ? one.columns[0] : undefined
    const less = next !== undefined && next.columns.length === 1 ? next.columns[0] : undefined
    if (
      column !== undefined &&
      next !== undefined &&
      less !== undefined &&
      next.multiplier === -one.multiplier &&
      less !== column
    ) {
      parts.push({ multiplier: one.multiplier, columns: [column], less })
      at += 1
      continue
    }
    parts.push({ multiplier: one.multiplier, columns: one.columns, less: undefined })
  }
  return parts
}

/* -------------------------------------------------------------- the write */

/**
 * The text an identity stores, for what this says.
 *
 * Through `balance.ts` rather than by joining strings: one piece of code writes
 * the characters an identity is kept as, and the signs, the omitted `1 *` and
 * the figure rounding are already settled there.
 *
 * Empty for no parts, which is nothing an identity may hold — the surface turns
 * the last part being removed back into *no, it is not worked out* rather than
 * writing half of an equation.
 */
export function textOfWorkedOut(worked: WorkedOut): string {
  if (worked.parts.length === 0) return ''
  return textOf(balanceOfWorkedOut(worked))
}

function balanceOfWorkedOut(worked: WorkedOut): Balance {
  return {
    left: worked.parts.flatMap(termsOfPart),
    right: [termOf(worked.column)],
  }
}

function termsOfPart(part: Part): readonly Term[] {
  const product: Term = {
    coefficient: part.multiplier,
    factors: part.columns.map((column) => ({ column, unit: undefined, via: undefined })),
    divisors: [],
    divideBy: 1,
  }
  // `less` is only arithmetic on a single column, and the shape says so; a
  // product that carries one is a state nothing can reach, and is written as
  // the product alone rather than as something else's arithmetic.
  if (part.less === undefined || part.columns.length !== 1) return [product]
  return [product, termOf(part.less, -part.multiplier)]
}
