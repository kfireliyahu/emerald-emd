/**
 * **Identities — what has to add up** — M19 U3,
 * [D-222](../../../docs/09-decision-log.md).
 *
 * `4·protein + 4·carbs + 9·fat + 2·fibre = kcal`, within a tolerance. `units ×
 * price = value`. `cooked_kcal × yield = dry_kcal`. These are the only thing
 * this app has that a spreadsheet, a notes-and-database workspace, a notes app
 * and a spreadsheet-database do not, and until
 * now the engine could hold every figure a label prints and prove nothing about
 * them. The vault (D-210) had written them out **in prose** —
 * `4×6.6 + 4×2 + 9×2.8 + 2×1 = 61.6 against 62 declared` — which is this file
 * with a person as the evaluator (D-210).
 *
 * ## An identity is not a `CHECK`, and the difference is the unit
 *
 * D-216 refused a free-text `CHECK` and that refusal stands. This is its
 * complement rather than its loophole:
 *
 * > **A `CHECK` says what cannot be stored. An identity says what should add
 * > up.** The first refuses the row; the second reports on it.
 *
 * A label whose macros come to 61.6 against a printed 62 is a **real label**,
 * and the last thing the app should do with it is refuse the row and lose the
 * reading. So no identity ever becomes SQL, no identity is ever compiled into a
 * table, and **changing one alters no storage** — which is why the reconciler
 * has nothing to say about identities and there is no refusal to make. A unit
 * change is dangerous because it silently re-means stored data (D-214); an
 * identity change re-judges it, in public, on the next read.
 *
 * ## The verdict has three states, because the third one is the common one
 *
 * `proved` · `failed` · **`unchecked`** (D-149), and `unchecked` is not a
 * failure to implement — it is the honest answer whenever the row cannot answer
 * the question: a column the identity names is empty here, a divisor is zero,
 * or two sides are in two currencies. Arrived at independently for the fourth
 * time in this project, in a domain with no money in it.
 *
 * ## What the expression may be, which is the whole of "declarable"
 *
 * `+ - × ÷`, parentheses, numbers, `in <unit>` (U4a, D-223), **`via <column>`
 * after one of those** (U4c, D-225), the names of this format's own numeric
 * columns, and **one hop through a `link`** — `analogue.kcal` (U4b, D-224).
 * **No functions, no conditionals, no loops, no second hop** — an *expression*,
 * never a program (D-132, D-137).
 *
 * `via` is the smallest thing that could have crossed a dimension without the
 * engine learning a density: `amount in g via ingredient.density` names the
 * fact, the fact is a column somebody declared, and the arithmetic is the
 * engine's. It is one word and it is read only where it is written.
 *
 * The hop is what made the engine's line move rather than bend. *Stateless and
 * relational is declarable; temporal, iterative or semantic is code* — reading
 * a column of the row this row names is relational, and it is the case the
 * roadmap has carried since U3: a cooked label proved against the dry one it
 * was made from. **One hop and no more**, because the syntax has no way to
 * write a second and a traversal is the thing the line forbids.
 *
 * It is text because that is how the vault already wrote it and how a person
 * reads it back. **It is parsed here and evaluated here**, in TypeScript, over
 * numbers: it never reaches `db.run`, never becomes DDL, and a declaration that
 * does not parse is refused at the moment it is declared rather than at the
 * moment somebody relies on it.
 */

import { formatMoney, minorUnitDigits, money } from '@/core/money.ts'

import type { ColumnDeclaration } from './declaration.ts'
import { roundHalfAway } from './percent.ts'
import {
  DAY_WORDS,
  dateOfOrdinal,
  isPointType,
  lonePointProblem,
  mixedSpanProblem,
  movedPointProblem,
  shiftedPoint,
  spanBetween,
  spanPair,
  SPAN_UNITS,
  type Point,
} from './span.ts'
import {
  conversionBetween,
  convert,
  convertAcross,
  dimensionOf,
  SEEDED_UNITS,
  unitNamed,
  word as dimensionWord,
  type UnitTable,
} from './unit.ts'

/** How close is close enough. */
export type Tolerance =
  /** `|left − right| ≤ amount`. Zero is exact, which is what money wants. */
  | { readonly kind: 'ABSOLUTE'; readonly amount: number }
  /** `|left − right| ≤ |right| × percent ÷ 100`. What a rounded label wants. */
  | { readonly kind: 'RELATIVE'; readonly percent: number }

/** One thing that has to hold, in the person's own words and arithmetic. */
export interface IdentityDeclaration {
  /** `snake_case`, unique within the format. A verdict is reported by it. */
  readonly name: string
  /** `4*protein_g + 4*carbs_g + 9*fat_g + 2*fiber_g = kcal`, exactly as typed. */
  readonly expression: string
  readonly tolerance: Tolerance
  /** Why this has to hold, in the person's words. Prose, stored, never parsed. */
  readonly note: string
}

/** An identity with nothing in it yet. */
export function identity(
  name: string,
  expression: string,
  extra: Partial<Omit<IdentityDeclaration, 'name' | 'expression'>> = {},
): IdentityDeclaration {
  return {
    name,
    expression,
    tolerance: extra.tolerance ?? { kind: 'ABSOLUTE', amount: 0 },
    note: extra.note ?? '',
  }
}

/* ------------------------------------------------------------- the grammar */

export type Expression =
  | { readonly kind: 'NUMBER'; readonly value: number }
  /**
   * `7 days`, `2 weeks` — a whole number of days, said after a number (M49 U1,
   * D-471). Beside a date it moves the date (`span.ts`); anywhere else it is a
   * figure in days, so `next_review - last_reviewed = 1 week` reads.
   */
  | { readonly kind: 'DAYS'; readonly days: number; readonly text: string }
  | { readonly kind: 'COLUMN'; readonly name: string }
  | { readonly kind: 'NEGATE'; readonly of: Expression }
  /**
   * `serving_weight in g` — the one place a conversion happens (U4a, D-223).
   *
   * **Postfix and tight**, binding closer than `*`: `weight in kg * price` is
   * `(weight in kg) * price`, which is what somebody writing it means, and a
   * whole expression is converted by bracketing it. The alternative — `in`
   * binding loosest — would make `4 * protein_g in kcal` mean two different
   * things to two readers, and an identity nobody can read twice the same way
   * is worse than no identity.
   */
  | {
      readonly kind: 'IN'
      readonly of: Expression
      readonly unit: string
      /**
       * The column holding the fact that crosses a dimension — `amount in g via
       * ingredient.density` (U4c, D-225).
       *
       * A name, and one hop is allowed in it exactly as anywhere else, because
       * the fact is usually about the thing on the far side of the link: a
       * density is a fact about *pasta*, and the recipe line only points at it.
       *
       * **Used only when it is needed.** A row whose amount is already in grams
       * converts without touching it, which is what lets one identity cover a
       * recipe whose lines are in grams, millilitres and eggs.
       */
      readonly via: string | undefined
    }
  | {
      readonly kind: 'ADD' | 'SUBTRACT' | 'MULTIPLY' | 'DIVIDE'
      readonly left: Expression
      readonly right: Expression
    }

/** The two sides of the one `=` an identity carries. */
export interface Equation {
  readonly left: Expression
  readonly right: Expression
}

/**
 * The equation, or why it is not one.
 *
 * A sentence rather than a position, because every caller of this puts it beside
 * the field that holds the text — the editor, the artefact reader and the
 * plugin's refusal all draw it in one line (D-219).
 *
 * `×` and `·` are accepted for `*`, `÷` for `/`, and `−` for `-`: the vault
 * writes `4×6.6`, and refusing the character somebody's keyboard produced would
 * be the app being pedantic about the one thing it asked them to write.
 * **Implicit multiplication is not accepted** — `4 protein_g` is a parse error,
 * because `4 protein_g` and `4 * protein_g` differing by a space is the kind of
 * silence this whole file exists to remove.
 */
export function parseIdentity(text: string): Equation | { readonly problem: string } {
  const sides = splitEquation(text)
  if ('problem' in sides) return sides

  const left = parseSide(sides.left, 'left')
  if ('problem' in left) return left
  const right = parseSide(sides.right, 'right')
  if ('problem' in right) return right

  return { left: left.expression, right: right.expression }
}

function splitEquation(
  text: string,
): { readonly left: string; readonly right: string } | { readonly problem: string } {
  const parts = text.split('=')
  if (parts.length === 1) {
    return { problem: 'A claim needs an `=` — it is two sides that have to agree.' }
  }
  if (parts.length > 2) {
    return { problem: 'A claim has one `=`. Two things at a time, or two claims.' }
  }
  const [left, right] = parts
  if (left === undefined || right === undefined) return { problem: 'A claim needs an `=`.' }
  if (left.trim() === '' || right.trim() === '') {
    return { problem: 'Both sides of the `=` need something on them.' }
  }
  return { left, right }
}

/**
 * One expression on its own, with no `=` — what an aggregate folds (U4b).
 *
 * The same grammar as a side of an identity, exported rather than duplicated,
 * because the moment there are two parsers for one language they disagree about
 * something nobody notices for a month. `aggregate.ts` calls this; everything
 * else here goes through `parseIdentity`.
 */
export function parseExpression(text: string): Expression | { readonly problem: string } {
  if (text.trim() === '') {
    return { problem: 'There is nothing here to work out.' }
  }
  if (text.includes('=')) {
    return {
      problem: 'This is one expression rather than two sides, so it takes no `=`. What it should come to goes in a claim.',
    }
  }
  const parsed = parseSide(text, 'left')
  return 'problem' in parsed ? parsed : parsed.expression
}

function parseSide(
  text: string,
  side: 'left' | 'right',
): { readonly expression: Expression } | { readonly problem: string } {
  const tokens = tokenize(text)
  if ('problem' in tokens) return tokens

  const reader = { tokens: tokens.tokens, at: 0 }
  const expression = readSum(reader)
  if (expression === undefined) {
    return { problem: `The ${side} of the \`=\` is not an expression this build can read.` }
  }
  if (reader.at < reader.tokens.length) {
    const rest = reader.tokens[reader.at]
    if (rest?.kind === 'VIA') {
      // Said specifically, because somebody who wrote `via` was reaching for one
      // thing and a *nothing more was expected* would send them looking at the
      // wrong half of the line.
      return {
        problem: `The ${side} of the \`=\` has a \`${BRIDGE_WORD}\` that follows no conversion. A \`${BRIDGE_WORD}\` names the fact an \`in\` crosses a dimension through — \`amount in g via ingredient.density\`.`,
      }
    }
    return {
      problem: `The ${side} of the \`=\` has \`${rest?.text ?? ''}\` where nothing more was expected. Two names or numbers side by side need a \`*\` between them.`,
    }
  }
  return { expression }
}

interface Token {
  readonly kind: 'NUMBER' | 'NAME' | 'OPERATOR' | 'OPEN' | 'CLOSE' | 'IN' | 'UNIT' | 'VIA' | 'DAYS'
  readonly text: string
  /** A `DAYS` token's count, in days. */
  readonly days?: number
}

const NAME_START = /[a-z]/
const DIGIT = /[0-9]/

/**
 * The word that asks for a conversion (U4a, D-223).
 *
 * A word rather than a symbol because an identity is read aloud by the person
 * who wrote it — `serving_weight in g = 250` is a sentence — and because every
 * symbol worth stealing is already arithmetic. It costs the language one
 * column name, which `declaration.ts` refuses on this file's behalf, and one
 * unit: the inch can never be seeded.
 */
const CONVERSION_WORD = 'in'

/**
 * The word that names the fact a conversion crosses a dimension through (U4c,
 * D-225).
 *
 * `amount in g via ingredient.density` is the sentence, and it is a sentence on
 * purpose — the same argument `in` made one unit ago. What follows it is an
 * ordinary name, read by the ordinary name rule, so a hop through a link is
 * allowed in it and a second hop is the same parse error it is everywhere else.
 *
 * It costs the language its second reserved column name, which `declaration.ts`
 * refuses on this file's behalf.
 */
const BRIDGE_WORD = 'via'

/**
 * What a unit symbol may be made of, read straight after an `in`.
 *
 * Deliberately wider than a column name and matched against `unit.ts`'s own
 * pattern: `µg` and `°c` are units somebody will write, and a tokenizer that
 * only accepted ASCII would refuse them here and accept them in a declaration,
 * which is the two halves of one language disagreeing.
 */
const UNIT_CHARACTER = /[\p{L}\p{N}%°_]/u

/** `×`, `·` and `÷` are the same operators somebody's keyboard produced. */
const OPERATORS: Readonly<Record<string, string>> = {
  '+': '+',
  '-': '-',
  '−': '-',
  '*': '*',
  '×': '*',
  '·': '*',
  '/': '/',
  '÷': '/',
}

function tokenize(text: string): { readonly tokens: readonly Token[] } | { readonly problem: string } {
  const tokens: Token[] = []
  let at = 0
  while (at < text.length) {
    const character = text[at] ?? ''
    if (character.trim() === '') {
      at += 1
      continue
    }
    if (OPERATORS[character] !== undefined) {
      tokens.push({ kind: 'OPERATOR', text: OPERATORS[character] ?? character })
      at += 1
      continue
    }
    if (character === '(') {
      tokens.push({ kind: 'OPEN', text: '(' })
      at += 1
      continue
    }
    if (character === ')') {
      tokens.push({ kind: 'CLOSE', text: ')' })
      at += 1
      continue
    }
    if (DIGIT.test(character) || (character === '.' && DIGIT.test(text[at + 1] ?? ''))) {
      let end = at
      while (end < text.length && (DIGIT.test(text[end] ?? '') || text[end] === '.')) end += 1
      const literal = text.slice(at, end)
      if (!Number.isFinite(Number(literal))) {
        return { problem: `\`${literal}\` is not a number.` }
      }
      // **`7 days`, `2 weeks`** (M49 U1, D-471): the one place a word follows a
      // number, and only these four words — anything else after a number is
      // still the missing `*` it always was.
      let wordAt = end
      while (wordAt < text.length && (text[wordAt] ?? '').trim() === '') wordAt += 1
      let wordEnd = wordAt
      while (wordEnd < text.length && /[a-z0-9_]/.test(text[wordEnd] ?? '')) wordEnd += 1
      const word = text.slice(wordAt, wordEnd)
      const per = DAY_WORDS[word]
      if (per !== undefined && text[wordEnd] !== '.') {
        if (!Number.isInteger(Number(literal))) {
          return {
            problem: `\`${literal} ${word}\` is part of a day. A date moves by whole days and weeks — write it in days.`,
          }
        }
        tokens.push({ kind: 'DAYS', text: `${literal} ${word}`, days: Number(literal) * per })
        at = wordEnd
        continue
      }
      if (/^(month|months|year|years)$/.test(word)) {
        // Said, because it is the next thing anybody reaches for (D-471).
        return {
          problem: `\`${literal} ${word}\` is not a number of days — a ${word.replace(/s$/, '')} is not always as long — so a date moves by days and weeks only. Write the days: \`+ 30 days\`.`,
        }
      }
      tokens.push({ kind: 'NUMBER', text: literal })
      at = end
      continue
    }
    if (NAME_START.test(character)) {
      let end = at
      while (end < text.length && /[a-z0-9_]/.test(text[end] ?? '')) end += 1
      // One hop through a link, and exactly one: `ingredient.kcal` is a name,
      // `ingredient.supplier.kcal` is not, and refusing the second here is what
      // keeps a traversal from having a syntax (U4b, D-224).
      if (text[end] === '.' && NAME_START.test(text[end + 1] ?? '')) {
        end += 1
        while (end < text.length && /[a-z0-9_]/.test(text[end] ?? '')) end += 1
        if (text[end] === '.') {
          // Reported here rather than left to the `.` falling through to *that
          // character has no meaning*, because the person who wrote it was
          // trying to do something specific and deserves to be told it is the
          // one thing this language will not do.
          return {
            problem: `\`${text.slice(at, end + 1)}…\` reaches through two links. An expression may follow one — \`ingredient.kcal\` — and no more: a second hop is a traversal, and a declaration that could traverse would be a program.`,
          }
        }
      }
      const word = text.slice(at, end)
      at = end
      if (word === BRIDGE_WORD) {
        // Just the word. What follows it is a name like any other, so it is
        // read by the loop's own name rule on the next pass — which is what
        // makes `via ingredient.density.supplier` the same refusal a second hop
        // gets anywhere else, written once.
        tokens.push({ kind: 'VIA', text: BRIDGE_WORD })
        continue
      }
      if (word !== CONVERSION_WORD) {
        tokens.push({ kind: 'NAME', text: word })
        continue
      }
      // `in` and the symbol after it are read together, here, because the
      // symbol is the one token in this language that is not made of the
      // characters everything else is made of. Reading it anywhere but
      // immediately after the word would mean `µg` had to be legal on its own,
      // and it is not — it is an answer to `in`.
      tokens.push({ kind: 'IN', text: CONVERSION_WORD })
      while (at < text.length && (text[at] ?? '').trim() === '') at += 1
      let unitEnd = at
      while (unitEnd < text.length && UNIT_CHARACTER.test(text[unitEnd] ?? '')) unitEnd += 1
      if (unitEnd === at) {
        return {
          problem: '`in` needs a unit after it — `serving_weight in g`.',
        }
      }
      tokens.push({ kind: 'UNIT', text: text.slice(at, unitEnd) })
      at = unitEnd
      continue
    }
    return {
      problem: `\`${character}\` has no meaning here. Only column names, numbers, \`+ - * /\` and brackets.`,
    }
  }
  return { tokens }
}

interface Reader {
  readonly tokens: readonly Token[]
  at: number
}

function peek(reader: Reader): Token | undefined {
  return reader.tokens[reader.at]
}

function readSum(reader: Reader): Expression | undefined {
  let left = readProduct(reader)
  if (left === undefined) return undefined
  for (;;) {
    const token = peek(reader)
    if (token?.kind !== 'OPERATOR' || (token.text !== '+' && token.text !== '-')) return left
    reader.at += 1
    const right = readProduct(reader)
    if (right === undefined) return undefined
    left = { kind: token.text === '+' ? 'ADD' : 'SUBTRACT', left, right }
  }
}

function readProduct(reader: Reader): Expression | undefined {
  let left = readUnary(reader)
  if (left === undefined) return undefined
  for (;;) {
    const token = peek(reader)
    if (token?.kind !== 'OPERATOR' || (token.text !== '*' && token.text !== '/')) return left
    reader.at += 1
    const right = readUnary(reader)
    if (right === undefined) return undefined
    left = { kind: token.text === '*' ? 'MULTIPLY' : 'DIVIDE', left, right }
  }
}

function readUnary(reader: Reader): Expression | undefined {
  const token = peek(reader)
  if (token?.kind === 'OPERATOR' && (token.text === '-' || token.text === '+')) {
    reader.at += 1
    const of = readUnary(reader)
    if (of === undefined) return undefined
    return token.text === '-' ? { kind: 'NEGATE', of } : of
  }
  return readPostfix(reader)
}

/**
 * An atom and whatever `in`s follow it, each with its optional `via`.
 *
 * A loop rather than a single optional suffix, so `x in kg in g` is a legal —
 * and pointless — way to write `x in g` rather than a parse error nobody could
 * explain. The evaluator does both conversions and the second undoes the first.
 *
 * **A `via` belongs to the `in` it follows** and to nothing else, which is why
 * it is read here rather than anywhere a name is read: it is not a term in the
 * arithmetic, and an expression that could multiply by one would be a second
 * way to write the conversion that is already written.
 */
function readPostfix(reader: Reader): Expression | undefined {
  let of = readAtom(reader)
  if (of === undefined) return undefined
  for (;;) {
    if (peek(reader)?.kind !== 'IN') return of
    reader.at += 1
    const unit = peek(reader)
    if (unit?.kind !== 'UNIT') return undefined
    reader.at += 1
    let via: string | undefined
    if (peek(reader)?.kind === 'VIA') {
      reader.at += 1
      const name = peek(reader)
      if (name?.kind !== 'NAME') return undefined
      reader.at += 1
      via = name.text
    }
    of = { kind: 'IN', of, unit: unit.text, via }
  }
}

function readAtom(reader: Reader): Expression | undefined {
  const token = peek(reader)
  if (token === undefined) return undefined
  if (token.kind === 'NUMBER') {
    reader.at += 1
    return { kind: 'NUMBER', value: Number(token.text) }
  }
  if (token.kind === 'DAYS') {
    reader.at += 1
    return { kind: 'DAYS', days: token.days ?? 0, text: token.text }
  }
  if (token.kind === 'NAME') {
    reader.at += 1
    return { kind: 'COLUMN', name: token.text }
  }
  if (token.kind === 'OPEN') {
    reader.at += 1
    const inside = readSum(reader)
    if (inside === undefined) return undefined
    if (peek(reader)?.kind !== 'CLOSE') return undefined
    reader.at += 1
    return inside
  }
  return undefined
}

/** Every column the equation names, in the order it names them, without repeats. */
export function columnsNamedBy(equation: Equation): readonly string[] {
  const names: string[] = []
  walkEquation(equation, (expression) => {
    if (expression.kind === 'COLUMN' && !names.includes(expression.name)) {
      names.push(expression.name)
    }
    // **A `via` names a column and it is read off the row like any other**
    // (U4c, D-225). It is in this list rather than in one of its own so that
    // every check already written about a named column — that it exists, that
    // it is reachable through at most one link, that it holds numbers — covers
    // a bridge without being written twice.
    if (expression.kind === 'IN' && expression.via !== undefined && !names.includes(expression.via)) {
      names.push(expression.via)
    }
  })
  return names
}

/**
 * Every node of both sides, in reading order.
 *
 * **An `in` is visited after what it converts**, which is the order the two are
 * written in and therefore the order their names come out in and the order a
 * problem is reported in. `x in kg in slice` says the inner one first, which is
 * where the reader has to look anyway.
 */
function walkEquation(equation: Equation, visit: (expression: Expression) => void): void {
  const walk = (expression: Expression): void => {
    if (expression.kind === 'IN') {
      walk(expression.of)
      visit(expression)
      return
    }
    visit(expression)
    switch (expression.kind) {
      case 'NUMBER':
      case 'DAYS':
      case 'COLUMN':
        return
      case 'NEGATE':
        walk(expression.of)
        return
      default:
        walk(expression.left)
        walk(expression.right)
    }
  }
  walk(equation.left)
  walk(equation.right)
}

/* --------------------------------------------------- what converts, before a row */

/**
 * Whether every `in` in this equation could ever convert, judged against the
 * declaration alone (U4a, D-223).
 *
 * **This is the check that keeps a conversion from becoming a silent
 * `unchecked`.** It is the same argument `identityRejection` already makes
 * about a column that does not exist: an identity is evaluated later, somewhere
 * else, against rows nobody is looking at, so a mistake in one is not reported
 * by anything unless it is caught at the moment it is declared. `weight in g`
 * where `weight` is in millilitres is wrong on every row a person will ever
 * type, and the only useful moment to say so is now.
 *
 * It refuses three things and allows everything it cannot be sure about:
 *
 * 1. A unit this document does not know.
 * 2. Converting a figure whose own unit this document does not know.
 * 3. Converting across a dimension — the H7 line, said to the person writing it.
 *
 * What it does **not** refuse is an expression whose unit it cannot work out,
 * which the ordinary arithmetic of a real identity produces constantly. That
 * comes back `unchecked` on the row, with the reason, which is the honest place
 * for an answer that depends on what the figures turn out to be.
 */
export function identityUnitProblem(
  equation: Equation,
  columns: readonly ColumnDeclaration[],
  units: UnitTable = SEEDED_UNITS,
): string | undefined {
  const declared = new Map(columns.map((each) => [each.name, each]))
  let problem: string | undefined
  walkEquation(equation, (expression) => {
    if (problem !== undefined || expression.kind !== 'IN') return
    if (unitNamed(units, expression.unit) === undefined) {
      problem = `${expression.unit} is not a unit this document knows. Add it, or convert into one it has.`
      return
    }
    const source = staticUnitOf(expression.of, declared)
    if (source.kind === 'NONE') {
      problem = `Nothing on the left of \`in ${expression.unit}\` has a unit, so there is nothing to convert. Declare a unit on the column, or take the conversion out.`
      return
    }

    if (expression.via !== undefined) {
      problem = bridgeProblem(expression.via, expression.unit, source, declared, units)
      return
    }

    // The row decides, so this build cannot: a quantity is `150 g` on one line
    // and `200 ml` on the next, and the honest place for *that* one to be
    // reported is the row it fails on.
    if (source.kind === 'ROW' || source.kind === 'MIXED') return

    const conversion = conversionBetween(units, source.unit, expression.unit)
    if ('problem' in conversion) {
      // **The way out, named where the refusal is read.** The sentence
      // `unit.ts` writes ends by saying the missing factor belongs in a column
      // of this format; U4c is what lets an identity then use it, and somebody
      // holding the refusal is one `via` away from the thing they wanted.
      problem = `${conversion.problem} Once it is a column, a claim crosses through it by naming it — \`${describe(expression.of)} in ${expression.unit} via density\`.`
    }
  })
  return problem
}

/**
 * Whether the column named after a `via` could ever bridge this conversion,
 * judged against the declaration alone (U4c, D-225).
 *
 * The same argument that put `identityUnitProblem` here in the first place: a
 * bridge is consulted on rows nobody is looking at, so a `via` naming a column
 * that relates the wrong two dimensions is wrong on every row and is worth one
 * sentence now rather than an `unchecked` forever.
 *
 * **A column it cannot see is not refused here.** `identityRejection` resolves
 * every name the equation uses — a `via` among them — and says so in better
 * words than this function has; a second refusal would be the same mistake
 * reported twice in two voices.
 */
function bridgeProblem(
  via: string,
  into: string,
  source: StaticUnit,
  declared: ReadonlyMap<string, ColumnDeclaration>,
  units: UnitTable,
): string | undefined {
  const column = declared.get(via)
  if (column === undefined) return undefined

  if (column.unit === undefined || column.per === undefined) {
    return `${via} is not a ratio, so nothing can be converted through it. A bridge between two dimensions is a column declared as one unit per another — a density is \`g\` per \`ml\`.`
  }
  const held = dimensionOf(units, column.unit)
  const per = dimensionOf(units, column.per)
  if (held === undefined) {
    return `${via} is in ${column.unit}, which is not a unit this document knows, so nothing can be converted through it.`
  }
  if (per === undefined) {
    return `${via} is per ${column.per}, which is not a unit this document knows, so nothing can be converted through it.`
  }
  if (held === per) {
    return `${via} is ${column.unit} per ${column.per}, and both measure ${dimensionWord(held)}. A bridge relates two dimensions; a factor inside one is arithmetic this app already does.`
  }

  const target = dimensionOf(units, into)
  if (target !== held && target !== per) {
    return `${via} relates ${dimensionWord(held)} and ${dimensionWord(per)}, and this converts into ${into}, which measures ${dimensionWord(target ?? held)}. Nothing bridged through it could land there.`
  }

  if (source.kind !== 'UNIT') return undefined

  const from = dimensionOf(units, source.unit)
  if (from === undefined) {
    return `The figure on the left of \`in ${into}\` is in ${source.unit}, which is not a unit this document knows.`
  }
  if (from === target) {
    // Dead weight rather than danger — the conversion works and the bridge
    // never fires — and it is worth refusing because a `via` that can never be
    // read is a person believing a fact is being checked.
    return `${source.unit} and ${into} both measure ${dimensionWord(from)}, so this converts without ${via} and the ratio is never read. Take the \`via\` out.`
  }
  if (from !== held && from !== per) {
    return `The figure on the left is in ${source.unit}, which measures ${dimensionWord(from)}, and ${via} relates ${dimensionWord(held)} and ${dimensionWord(per)}. It is the wrong fact for this crossing.`
  }
  return undefined
}

/** An expression as the shortest thing that stands for it in a sentence. */
function describe(expression: Expression): string {
  return expression.kind === 'COLUMN' ? expression.name : 'the figure'
}

/** What an expression is in, as far as the declaration can say without a row. */
type StaticUnit =
  | { readonly kind: 'UNIT'; readonly unit: string }
  /** Determinately a bare number — every leaf is a literal or a unitless column. */
  | { readonly kind: 'NONE' }
  /** Two units met, and `unitAfter` names no unit for what came out. */
  | { readonly kind: 'MIXED' }
  /**
   * A `quantity` is involved, so **the row says and the declaration cannot**
   * (U4c, D-225).
   *
   * It is not `MIXED`: there is a unit, and it is determinate on every row —
   * just not here. The difference is what keeps *nothing has a unit* from being
   * said about a column whose whole purpose is carrying one.
   */
  | { readonly kind: 'ROW' }

const NONE: StaticUnit = { kind: 'NONE' }
const MIXED: StaticUnit = { kind: 'MIXED' }
const ROW: StaticUnit = { kind: 'ROW' }

/**
 * The compile-time twin of `unitAfter`, and it has to agree with it.
 *
 * Two functions rather than one because they answer about different things —
 * this one about a declaration and that one about a row — and the one case they
 * must not disagree on is what an `in` sees. Every rule below is `unitAfter`'s
 * rule with `undefined` split into the two things it means.
 */
function staticUnitOf(
  expression: Expression,
  declared: ReadonlyMap<string, ColumnDeclaration>,
): StaticUnit {
  switch (expression.kind) {
    case 'NUMBER':
      return NONE
    case 'DAYS':
      return { kind: 'UNIT', unit: 'day' }
    case 'COLUMN': {
      const column = declared.get(expression.name)
      if (column === undefined) return NONE
      if (column.type === 'quantity') return ROW
      return column.unit === undefined ? NONE : { kind: 'UNIT', unit: column.unit }
    }
    case 'NEGATE':
      return staticUnitOf(expression.of, declared)
    case 'IN':
      return { kind: 'UNIT', unit: expression.unit }
    default: {
      // `end - start` over two points is a span, in hours or days (M29 U4, D-335).
      const pair = spanPair(expression)
      const pointType = pair === undefined ? undefined : declared.get(pair.end)?.type
      if (pair !== undefined && isPointType(pointType) && declared.get(pair.start)?.type === pointType) {
        return { kind: 'UNIT', unit: SPAN_UNITS[pointType] }
      }
      const left = staticUnitOf(expression.left, declared)
      const right = staticUnitOf(expression.right, declared)
      if (left.kind === 'MIXED' || right.kind === 'MIXED') return MIXED
      if (expression.kind === 'ADD' || expression.kind === 'SUBTRACT') {
        if (left.kind === 'NONE') return right
        if (right.kind === 'NONE') return left
        // Two units met and one of them is only knowable on the row, so what
        // came out is not something this side of the build will name.
        if (left.kind === 'ROW' || right.kind === 'ROW') return MIXED
        return left.unit === right.unit ? left : MIXED
      }
      if (expression.kind === 'DIVIDE') return right.kind === 'NONE' ? left : MIXED
      if (left.kind === 'NONE') return right
      return right.kind === 'NONE' ? left : MIXED
    }
  }
}

/* ---------------------------------------------------------- the evaluation */

/**
 * The types an identity may name.
 *
 * Arithmetic over an enum is a category error rather than a limitation. A
 * date, a time or an instant is not here either: it is a point, and the one
 * thing an expression does with one is `end - start`, or a date moved by days (D-335, D-471,
 * `span.ts`). `boolean` is left out on purpose: `is_organic * 5` is a
 * number somebody would have to think about, and refusing it costs nothing
 * anybody has asked for yet.
 */
export const IDENTITY_TYPES = ['integer', 'real', 'money', 'quantity', 'decimal', 'percent'] as const

/**
 * A figure held exactly — `n ÷ d`, both whole — beside the double that is
 * printed (M29 U3, D-333).
 *
 * A decimal or a percent column is a whole number over a power of ten, money
 * is minor units, and a literal is the digits somebody typed, so an identity
 * over nothing else is judged **without a float anywhere**: `1999 × (1 + 17%)`
 * is `233883/100` exactly, not `2338.8300000000004`. A `real`, a `quantity`
 * or a unit conversion has no exact form, and the figure falls back to the
 * double, which is what every identity did before.
 */
export interface Fraction {
  readonly n: bigint
  readonly d: bigint
}

/**
 * What one row says, ready to be put through an equation.
 *
 * **A money column enters as its minor units** — 19.90 is `1990` — because that
 * is what the column stores and the rule against floating money has no exception
 * for arithmetic somebody declared. A tolerance on an identity naming money is
 * therefore in minor units too, which the editor says out loud. The currency
 * travels beside the number so that two of them meeting can be refused rather
 * than added: the engine owns no exchange rate, and inventing one inside a proof
 * is the exact shape of the bug D-138 keeps finding.
 */
export interface IdentityInputs {
  /**
   * Which row this is, when the caller knows — for a sentence that has to name
   * it (U4b). An aggregate that will not fold says *which* row could not answer,
   * because the id is what the caller passes to `update_format_rows` to fix it.
   */
  readonly id?: string
  /**
   * **Dotted keys are one hop through a link** (U4b, D-224):
   * `ingredient.kcal` is the `kcal` of the row this row's `ingredient` column
   * names. **Resolving that is the repository's job**, because the hop is a
   * query and `src/domain/` imports no sql.js — what arrives here is already
   * flat, and a hop that found nothing is simply a key that is not here, which
   * comes back `unchecked` like any other.
   */
  readonly numbers: ReadonlyMap<string, number>
  readonly currencies: ReadonlyMap<string, string>
  /**
   * What each named column's figure is *in*.
   *
   * **From the declaration, or from the row when the column is a `quantity`**
   * (U4a, D-223; U4c, D-225). A column declared in `g` holds grams in every row
   * of the table and this map says so once; a quantity holds `150 g` on one
   * recipe line and `200 ml` on the next, and this map says what *this* row
   * holds. The two arrive here as one map on purpose: everything downstream
   * asks the same question — what is this figure in — and a second map would be
   * two answers to it.
   *
   * Absent for a column with no declared unit, which is not a gap: most
   * columns are counts of themselves and `servings in g` should be refused
   * rather than guessed at.
   */
  readonly units?: ReadonlyMap<string, string>
  /**
   * The other half of a ratio column — **this column is `units` per `per`**
   * (U4c, D-225).
   *
   * Only ever read for a column an expression names after a `via`, and it is
   * the fact that crosses a dimension: `density` is `g` per `ml`. It is two
   * maps rather than one entry because that is what the declaration is — a
   * `unit` field and a `per` field — and a shape invented here would be a third
   * place for the pair to disagree.
   */
  readonly per?: ReadonlyMap<string, string>
  /**
   * What each `enum` and `boolean` column *is* — a member as declared, or
   * `true` / `false` — under the same names and dotted keys as `numbers` (M24
   * U8, D-260).
   *
   * Never arithmetic: nothing in an expression reads this map. It is what an
   * aggregate's filter asks of a row, and an empty cell is a key that is not
   * here, which the filter refuses rather than reads as *not a member*.
   */
  readonly members?: ReadonlyMap<string, string>
  /**
   * Every column that holds something, under the same names and dotted keys
   * (M36 U04) — what `is empty` and `is not empty` ask, of a column of any
   * type. Never arithmetic.
   */
  readonly filled?: ReadonlySet<string>
  /**
   * The exact figure of a `decimal` or `percent` column, under the same names
   * and dotted keys as `numbers` (M29 U3, D-333). A whole number in `numbers`
   * is exact already and needs no entry; a figure with neither is a double.
   */
  readonly exact?: ReadonlyMap<string, Fraction>
  /**
   * Each `date`, `time` and `instant` the row has, as where it falls (M29 U4,
   * D-335) — under the same names and dotted keys as `numbers`, and never in
   * `numbers`: a point is not a figure, and the only thing an expression does
   * with one is take another of its kind from it, or move a date by days (D-471).
   */
  readonly points?: ReadonlyMap<string, Point>
  /**
   * **The totals no row points at, and the sentence each says** (M33 F7,
   * D-465). The figure is in `numbers` all the same — zero, which a computed
   * column reads like any other — but an identity naming one that would fail
   * is `unchecked` with this sentence instead: rows that do not exist yet are
   * nothing to fail against. One that holds over zero is proved.
   */
  readonly unfolded?: ReadonlyMap<string, string>
}

export type Verdict =
  | {
      readonly kind: 'PROVED' | 'FAILED'
      readonly left: number
      readonly right: number
      readonly difference: number
      readonly allowed: number
      /**
       * The currency both sides are in, when they are money — and then every
       * figure here is in its minor units (M33 U2), which is how a surface
       * prints `₪84.00` rather than `8400`.
       */
      readonly currency?: string | undefined
      /**
       * The two sides as the points they are, when the claim holds two dates,
       * times or instants (D-471) — `left` and `right` are then where each
       * falls, and `difference` is in days, minutes or milliseconds.
       */
      readonly points?: { readonly type: Point['type']; readonly left: string; readonly right: string } | undefined
    }
  /** The row cannot answer the question, and saying so is the third state. */
  | { readonly kind: 'UNCHECKED'; readonly reason: string }

/** A figure the evaluator arrived at, or the reason there is not one. */
export type Value =
  | {
      readonly kind: 'NUMBER'
      readonly value: number
      readonly currency: string | undefined
      /**
       * What this figure is in, as far as the arithmetic so far can say.
       *
       * `undefined` means *nothing here says* — a bare number, or two units
       * that met in a way this file will not name a unit for. It is not an
       * error on its own: it only becomes one when somebody asks for an `in`,
       * which is the single place a unit has to be determinate.
       */
      readonly unit: string | undefined
      /** The same figure exactly, when everything it was made of was exact (D-333). */
      readonly exact?: Fraction | undefined
    }
  | { readonly kind: 'UNKNOWN'; readonly reason: string }

/**
 * Put one row through one identity.
 *
 * **Total, and every way out is a verdict rather than a throw.** A column with
 * no value in this row, a divisor of zero, two currencies, an overflow — each is
 * `unchecked` with the reason in the words a surface can print, because each is
 * a real state of a real row and none of them is the row being wrong.
 *
 * The parse is done here rather than taken from the caller so that this function
 * is the whole of "what does this identity say about this row"; the declaration
 * was already refused if it does not parse, so the branch is a guard rather than
 * a path.
 */
export function evaluateIdentity(
  declaration: IdentityDeclaration,
  inputs: IdentityInputs,
  units: UnitTable = SEEDED_UNITS,
): Verdict {
  const equation = parseIdentity(declaration.expression)
  if ('problem' in equation) return { kind: 'UNCHECKED', reason: equation.problem }

  const dated = pointVerdict(equation, declaration.tolerance, inputs)
  if (dated !== undefined) return dated

  const left = evaluate(equation.left, inputs, units)
  if (left.kind === 'UNKNOWN') return { kind: 'UNCHECKED', reason: left.reason }
  const right = evaluate(equation.right, inputs, units)
  if (right.kind === 'UNKNOWN') return { kind: 'UNCHECKED', reason: right.reason }

  if (
    left.currency !== undefined &&
    right.currency !== undefined &&
    left.currency !== right.currency
  ) {
    return {
      kind: 'UNCHECKED',
      reason: `One side is in ${left.currency} and the other in ${right.currency}. Nothing here knows a rate between them.`,
    }
  }

  // **A side in money is a figure a money column could hold** (D-333): whole
  // minor units, halves away from zero. `1999 × (1 + 17%)` is 2338.83 agorot,
  // which no amount on an invoice is; it is 2339, and it is compared as 2339.
  // So `exactly` on a money identity means *to the agora*, and a tolerance is
  // in agorot measured from there.
  const money = left.currency !== undefined || right.currency !== undefined
  const l = money ? toWhole(left) : left
  const r = money ? toWhole(right) : right

  const difference =
    l.exact !== undefined && r.exact !== undefined
      ? fractionNumber(fractionAbs(fractionSub(l.exact, r.exact)))
      : Math.abs(l.value - r.value)
  const allowed = allowanceOf(declaration.tolerance, r.value)
  if (!Number.isFinite(difference) || !Number.isFinite(allowed)) {
    return { kind: 'UNCHECKED', reason: 'The arithmetic did not come out as a number.' }
  }

  const kind = difference <= allowed ? 'PROVED' : 'FAILED'
  if (kind === 'FAILED' && inputs.unfolded !== undefined) {
    const empty = columnsNamedBy(equation).find((name) => inputs.unfolded?.has(name))
    const reason = empty === undefined ? undefined : inputs.unfolded.get(empty)
    if (reason !== undefined) return { kind: 'UNCHECKED', reason }
  }
  const currency = left.currency ?? right.currency
  return { kind, left: l.value, right: r.value, difference, allowed, ...(currency === undefined ? {} : { currency }) }
}

/**
 * **A claim between two points** (M49 U1, D-471) — `next_review = last_reviewed
 * + 7 days` — or nothing when neither side is one, so the figures go on. Each
 * side is where its point falls, moved by its days; the tolerance is a number
 * of days (a percent of a date is nothing), and an empty point is `unchecked`.
 */
function pointVerdict(equation: Equation, tolerance: Tolerance, inputs: IdentityInputs): Verdict | undefined {
  const sides = [equation.left, equation.right].map((side) => {
    const shifted = shiftedPoint(side)
    const point = shifted === undefined ? undefined : inputs.points?.get(shifted.name)
    return { shifted, point }
  })
  const [l, r] = sides
  if (l === undefined || r === undefined) return undefined
  const present = l.point ?? r.point
  if (present === undefined) return undefined
  for (const [side, other] of [
    [l, r],
    [r, l],
  ] as const) {
    if (side.shifted === undefined) {
      const named = other.shifted?.name ?? ''
      return { kind: 'UNCHECKED', reason: lonePointProblem(named, present.type) }
    }
    if (side.point === undefined) {
      return {
        kind: 'UNCHECKED',
        reason: inputs.numbers.has(side.shifted.name)
          ? lonePointProblem(other.shifted?.name ?? side.shifted.name, present.type)
          : `This row has nothing in ${side.shifted.name}, so there is nothing to check.`,
      }
    }
    if (side.shifted.moved && side.point.type !== 'date') {
      return { kind: 'UNCHECKED', reason: movedPointProblem(side.shifted.name, side.point.type) }
    }
  }
  if (l.point === undefined || r.point === undefined || l.shifted === undefined || r.shifted === undefined) return undefined
  if (l.point.type !== r.point.type) {
    return { kind: 'UNCHECKED', reason: mixedSpanProblem(l.shifted.name, r.shifted.name, l.point.type, r.point.type) }
  }
  const type = l.point.type
  const left = l.point.ordinal + l.shifted.days
  const right = r.point.ordinal + r.shifted.days
  const difference = Math.abs(left - right)
  const allowed = tolerance.kind === 'ABSOLUTE' ? Math.abs(tolerance.amount) : 0
  return {
    kind: difference <= allowed ? 'PROVED' : 'FAILED',
    left,
    right,
    difference,
    allowed,
    points: { type, left: pointText(type, left), right: pointText(type, right) },
  }
}

/** Where a point falls, as it is stored and shown. */
function pointText(type: Point['type'], ordinal: number): string {
  switch (type) {
    case 'date':
      return dateOfOrdinal(ordinal)
    case 'time':
      return `${String(Math.floor(ordinal / 60)).padStart(2, '0')}:${String(ordinal % 60).padStart(2, '0')}`
    case 'instant':
      return new Date(ordinal).toISOString()
  }
}

/** A distance between two points of a claim, in what they are counted in. */
function pointDistance(type: Point['type'], amount: number): string {
  const unit = type === 'date' ? 'day' : type === 'time' ? 'minute' : 'millisecond'
  return `${figureText(amount)} ${unit}${amount === 1 ? '' : 's'}`
}

/** A money side, rounded to whole minor units with halves away from zero (D-333). */
export function toWhole(side: { readonly value: number; readonly exact?: Fraction | undefined }): {
  readonly value: number
  readonly exact?: Fraction | undefined
} {
  if (side.exact !== undefined) {
    const whole = roundHalfAway(side.exact.n, side.exact.d)
    return { value: Number(whole), exact: { n: whole, d: 1n } }
  }
  const whole = Math.sign(side.value) * Math.round(Math.abs(side.value))
  return { value: whole === 0 ? 0 : whole }
}

/** How far apart the two sides may be, in the units the row is stated in. */
export function allowanceOf(tolerance: Tolerance, right: number): number {
  return tolerance.kind === 'ABSOLUTE'
    ? Math.abs(tolerance.amount)
    : (Math.abs(right) * Math.abs(tolerance.percent)) / 100
}

/**
 * One expression against one row — a number with what it is in, or why not.
 *
 * Public because an aggregate folds expressions rather than equations (U4b),
 * and it is the same evaluator for the same reason `parseExpression` is the
 * same parser: two of either would eventually disagree about a currency or a
 * unit, in a figure nobody was checking.
 */
export function evaluateExpression(
  expression: Expression,
  inputs: IdentityInputs,
  units: UnitTable = SEEDED_UNITS,
): Value {
  return evaluate(expression, inputs, units)
}

function evaluate(expression: Expression, inputs: IdentityInputs, units: UnitTable): Value {
  switch (expression.kind) {
    case 'NUMBER':
      return {
        kind: 'NUMBER',
        value: expression.value,
        currency: undefined,
        unit: undefined,
        exact: literalFraction(expression.value),
      }
    case 'DAYS':
      return {
        kind: 'NUMBER',
        value: expression.days,
        currency: undefined,
        unit: 'day',
        exact: { n: BigInt(expression.days), d: 1n },
      }
    case 'COLUMN': {
      const value = inputs.numbers.get(expression.name)
      const point = inputs.points?.get(expression.name)
      if (value === undefined && point !== undefined) {
        return { kind: 'UNKNOWN', reason: lonePointProblem(expression.name, point.type) }
      }
      if (value === undefined) {
        return {
          kind: 'UNKNOWN',
          reason: `This row has nothing in ${expression.name}, so there is nothing to check.`,
        }
      }
      return {
        kind: 'NUMBER',
        value,
        currency: inputs.currencies.get(expression.name),
        unit: inputs.units?.get(expression.name),
        exact:
          inputs.exact?.get(expression.name) ??
          (Number.isSafeInteger(value) ? { n: BigInt(value), d: 1n } : undefined),
      }
    }
    case 'NEGATE': {
      const of = evaluate(expression.of, inputs, units)
      if (of.kind === 'UNKNOWN') return of
      return {
        ...of,
        value: -of.value,
        exact: of.exact === undefined ? undefined : { n: -of.exact.n, d: of.exact.d },
      }
    }
    case 'IN': {
      const of = evaluate(expression.of, inputs, units)
      if (of.kind === 'UNKNOWN') return of
      if (of.unit === undefined) {
        return {
          kind: 'UNKNOWN',
          reason: `Nothing here says what to convert into ${expression.unit} — the figure on the left of the \`in\` carries no unit.`,
        }
      }
      const converted =
        expression.via === undefined
          ? convert(units, of.value, of.unit, expression.unit)
          : across(expression.via, of.value, of.unit, expression.unit, inputs, units)
      if ('problem' in converted) return { kind: 'UNKNOWN', reason: converted.problem }
      // A conversion's factor is a double, so the exact figure stops here.
      return { kind: 'NUMBER', value: converted.value, currency: of.currency, unit: expression.unit }
    }
    default: {
      const span = spanValue(expression, inputs)
      if (span !== undefined) return span
      const left = evaluate(expression.left, inputs, units)
      if (left.kind === 'UNKNOWN') return left
      const right = evaluate(expression.right, inputs, units)
      if (right.kind === 'UNKNOWN') return right
      return combine(expression.kind, left, right)
    }
  }
}

/**
 * `end - start` over two points of this row, as a span — hours for two times
 * or two instants, days for two dates, two times wrapping at midnight (M29 U4,
 * D-335). Nothing when the expression is not that, so the arithmetic goes on.
 */
function spanValue(expression: Expression, inputs: IdentityInputs): Value | undefined {
  const pair = spanPair(expression)
  if (pair === undefined) return undefined
  const end = inputs.points?.get(pair.end)
  const start = inputs.points?.get(pair.start)
  if (end === undefined && start === undefined) return undefined
  if (end === undefined || start === undefined) {
    const [other, present, name] =
      end === undefined ? [pair.end, start, pair.start] : [pair.start, end, pair.end]
    // A figure on the other side is a point used as one; nothing there is a row
    // that has not said yet.
    if (inputs.numbers.has(other) && present !== undefined) {
      return { kind: 'UNKNOWN', reason: lonePointProblem(name, present.type) }
    }
    return { kind: 'UNKNOWN', reason: `This row has nothing in ${other}, so there is nothing to check.` }
  }
  if (end.type !== start.type) {
    return { kind: 'UNKNOWN', reason: mixedSpanProblem(pair.end, pair.start, end.type, start.type) }
  }
  if (pair.moved && end.type !== 'date') {
    return { kind: 'UNKNOWN', reason: movedPointProblem(pair.end, end.type) }
  }
  // Either end moved by whole days (D-471) is the span plus the days between.
  const exact = spanBetween(end.type, end.ordinal + pair.days, start.ordinal)
  return {
    kind: 'NUMBER',
    value: fractionNumber(exact),
    currency: undefined,
    unit: SPAN_UNITS[end.type],
    exact: reduce(exact),
  }
}

/**
 * One conversion through a declared fact, for one row (U4c, D-225).
 *
 * The three ways there is no answer are three real states of a real row and
 * none of them is the row being wrong: the bridge column is empty here, the
 * declaration says nothing about what it relates, or the two units it relates
 * are not the two being crossed. Each comes back as a sentence and becomes
 * `unchecked` — and in an aggregate, `unchecked` for the whole fold with this
 * row named (D-224, D-138).
 *
 * **The row's own bridge, not the format's.** A recipe of fourteen lines
 * reaches fourteen densities, one per ingredient, because the `via` is resolved
 * against the row's inputs like every other name.
 */
function across(
  via: string,
  value: number,
  from: string,
  to: string,
  inputs: IdentityInputs,
  units: UnitTable,
): { readonly value: number } | { readonly problem: string } {
  // **The bridge is only needed when the dimension is crossed, so it is only
  // demanded then.** A recipe line already in grams must not be `unchecked`
  // because the ingredient it points at has no density — and in an aggregate it
  // would take the whole recipe's total down with it (D-224). This is the same
  // early return `convertAcross` makes, made one step sooner so that a row
  // which needs no fact is never asked for one.
  const direct = conversionBetween(units, from, to)
  if ('factor' in direct) return { value: value * direct.factor }

  const amount = inputs.numbers.get(via)
  if (amount === undefined) {
    return {
      problem: `This row has nothing in ${via}, so there is no fact here to convert ${from} into ${to} through.`,
    }
  }
  const held = inputs.units?.get(via)
  const per = inputs.per?.get(via)
  if (held === undefined || per === undefined) {
    return {
      problem: `${via} is not declared as one unit per another, so nothing here says what it converts between.`,
    }
  }
  return convertAcross(units, value, from, to, { amount, unit: held, per })
}

function combine(
  kind: 'ADD' | 'SUBTRACT' | 'MULTIPLY' | 'DIVIDE',
  left: { value: number; currency: string | undefined; unit: string | undefined; exact?: Fraction | undefined },
  right: { value: number; currency: string | undefined; unit: string | undefined; exact?: Fraction | undefined },
): Value {
  if (
    left.currency !== undefined &&
    right.currency !== undefined &&
    left.currency !== right.currency
  ) {
    return {
      kind: 'UNKNOWN',
      reason: `${left.currency} and ${right.currency} meet in one sum, and nothing here knows a rate between them.`,
    }
  }
  const currency = left.currency ?? right.currency
  const unit = unitAfter(kind, left.unit, right.unit)

  const exactly = (operate: (a: Fraction, b: Fraction) => Fraction, fallback: number): Value => {
    const owned = kind === 'DIVIDE' ? left.currency : currency
    if (left.exact === undefined || right.exact === undefined) {
      return { kind: 'NUMBER', value: fallback, currency: owned, unit }
    }
    const exact = operate(left.exact, right.exact)
    return { kind: 'NUMBER', value: fractionNumber(exact), currency: owned, unit, exact }
  }

  switch (kind) {
    case 'ADD':
      return exactly(fractionAdd, left.value + right.value)
    case 'SUBTRACT':
      return exactly(fractionSub, left.value - right.value)
    case 'MULTIPLY':
      return exactly(fractionMul, left.value * right.value)
    case 'DIVIDE':
      if (right.value === 0 || right.exact?.n === 0n) {
        return { kind: 'UNKNOWN', reason: 'Something in this row divides by zero.' }
      }
      return exactly(fractionDiv, left.value / right.value)
  }
}

/* ------------------------------------------------ exact, beside the double */

/**
 * A literal's exact figure, read through its shortest printed form — the digits
 * somebody typed, as `decimal.ts` argues. One that prints with an exponent has
 * none, and the double stands alone.
 */
function literalFraction(value: number): Fraction | undefined {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(String(value))
  if (match === null) return undefined
  const fraction = match[3] ?? ''
  const n = BigInt(`${match[2] ?? '0'}${fraction}`)
  return reduce({ n: match[1] === '-' ? -n : n, d: 10n ** BigInt(fraction.length) })
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a
  let y = b < 0n ? -b : b
  while (y !== 0n) [x, y] = [y, x % y]
  return x
}

function reduce(f: Fraction): Fraction {
  if (f.n === 0n) return { n: 0n, d: 1n }
  const sign = f.d < 0n ? -1n : 1n
  const g = gcd(f.n, f.d)
  return { n: (sign * f.n) / g, d: (sign * f.d) / g }
}

function fractionAdd(a: Fraction, b: Fraction): Fraction {
  return reduce({ n: a.n * b.d + b.n * a.d, d: a.d * b.d })
}

function fractionSub(a: Fraction, b: Fraction): Fraction {
  return reduce({ n: a.n * b.d - b.n * a.d, d: a.d * b.d })
}

function fractionMul(a: Fraction, b: Fraction): Fraction {
  return reduce({ n: a.n * b.n, d: a.d * b.d })
}

function fractionDiv(a: Fraction, b: Fraction): Fraction {
  return reduce({ n: a.n * b.d, d: a.d * b.n })
}

function fractionAbs(a: Fraction): Fraction {
  return a.n < 0n ? { n: -a.n, d: a.d } : a
}

/** The nearest double — whole part and remainder apart, so a large figure keeps its digits. */
function fractionNumber(a: Fraction): number {
  const whole = a.n / a.d
  return Number(whole) + Number(a.n - whole * a.d) / Number(a.d)
}

/**
 * What the result of one operation is in — and **`undefined` wherever the
 * honest answer is "this file will not say"** (U4a, D-223).
 *
 * The rules are deliberately shorter than a dimensional-analysis engine, and
 * that shortness is the decision rather than an unfinished corner. There is
 * exactly one thing the answer is used for: deciding whether an `in` written
 * beside it has something determinate to convert. Everywhere else a unit is
 * carried and ignored, because **the flagship identity of this milestone adds
 * grams and compares them to an energy and is correct** — Atwater's 4 is
 * `kcal/g`, the coefficient carries the dimension, and nothing in a declaration
 * says so. An engine that inferred a unit for `4 * protein_g` would have to
 * either be wrong about it or refuse the identity.
 *
 * So: a sum keeps the unit both sides agree on, a product keeps the unit of its
 * one side that has one, and anything else is `undefined` and an `in` over it
 * says so in a sentence.
 */
function unitAfter(
  kind: 'ADD' | 'SUBTRACT' | 'MULTIPLY' | 'DIVIDE',
  left: string | undefined,
  right: string | undefined,
): string | undefined {
  if (kind === 'ADD' || kind === 'SUBTRACT') {
    if (left === undefined) return right
    if (right === undefined) return left
    return left === right ? left : undefined
  }
  if (kind === 'DIVIDE') return right === undefined ? left : undefined
  if (left === undefined) return right
  return right === undefined ? left : undefined
}

/* --------------------------------------------------------- saying it aloud */

/** `± 2`, `± 2%`, or `exactly`. The artefact writes this and reads it back. */
export function toleranceText(tolerance: Tolerance, figure: (value: number) => string = figureText): string {
  if (tolerance.kind === 'RELATIVE') return `± ${figureText(tolerance.percent)}%`
  return tolerance.amount === 0 ? 'exactly' : `± ${figure(tolerance.amount)}`
}

/** The other direction. `undefined` when the cell is not one of the three. */
export function readTolerance(text: string): Tolerance | undefined {
  const cleaned = text.replace(/±/g, '').replace(/\s+/g, '').toLowerCase()
  if (cleaned === '' || cleaned === 'exactly' || cleaned === 'exact' || cleaned === '0') {
    return { kind: 'ABSOLUTE', amount: 0 }
  }
  const relative = cleaned.endsWith('%')
  const amount = Number(relative ? cleaned.slice(0, -1) : cleaned)
  if (!Number.isFinite(amount) || amount < 0) return undefined
  return relative ? { kind: 'RELATIVE', percent: amount } : { kind: 'ABSOLUTE', amount }
}

/**
 * One line about what a row did, for a plugin answer or a screen.
 *
 * Every figure goes through `figureText`, which is also what the balance prints
 * (D-232) — the sentence and the picture say the same number or one of them is
 * lying.
 */
export function verdictSentence(
  declaration: IdentityDeclaration,
  verdict: Verdict,
  figure: (value: number) => string = figureIn(verdict.kind === 'UNCHECKED' ? undefined : verdict.currency),
): string {
  if (verdict.kind === 'UNCHECKED') return `${declaration.name}: unchecked — ${verdict.reason}`
  if (verdict.points !== undefined) {
    // Two points are said as the points they are (D-471), never as ordinals.
    const type = verdict.points.type
    const sides = `${verdict.points.left} against ${verdict.points.right}`
    const off = pointDistance(type, verdict.difference)
    if (verdict.kind === 'PROVED') {
      return verdict.difference === 0
        ? `${declaration.name}: proved — ${sides}.`
        : `${declaration.name}: proved — ${sides}, off by ${off} of an allowed ${pointDistance(type, verdict.allowed)}.`
    }
    return `${declaration.name}: failed — ${sides}, off by ${off} where ${pointDistance(type, verdict.allowed)} ${verdict.allowed === 1 ? 'is' : 'are'} allowed.`
  }
  const sides = `${figure(verdict.left)} against ${figure(verdict.right)}`
  if (verdict.kind === 'PROVED') {
    return verdict.allowed === 0
      ? `${declaration.name}: proved — ${sides}.`
      : `${declaration.name}: proved — ${sides}, off by ${figure(verdict.difference)} of an allowed ${figure(verdict.allowed)}.`
  }
  return `${declaration.name}: failed — ${sides}, off by ${figure(verdict.difference)} where ${figure(verdict.allowed)} is allowed.`
}

/**
 * A figure kept as its fraction, printed as the percent it is — `0.55` is
 * `55%` — for a check over percents alone (D-402): the person wrote 55%.
 */
export function percentText(value: number): string {
  return `${figureText(value * 100)}%`
}

/**
 * How a verdict's figures print: as money in `currency` when its sides were
 * money (M33 U2) — they are minor units then, and `8400 against 9600` on a
 * receipt is a sum nobody reads as ₪84.00 — and otherwise as `figureText`.
 * A figure that is not a whole number of minor units (a percent tolerance's
 * allowance) keeps `figureText`, over the major unit, rather than being rounded.
 */
export function figureIn(currency: string | undefined): (value: number) => string {
  if (currency === undefined) return figureText
  const scale = 10 ** minorUnitDigits(currency)
  return (value) =>
    Number.isSafeInteger(value) ? formatMoney(money(value, currency)) : `${currency} ${figureText(value / scale)}`
}

/**
 * One figure, as a surface should print it.
 *
 * **Six significant digits at most.** An identity over reals lands on
 * `61.599999999999994` often enough that showing it raw would make every
 * verdict look like a bug in the arithmetic rather than a fact about the label.
 * Exported since U4 (D-232) because the balance prints the same figures the
 * sentence does, and two roundings would be two answers.
 */
export function figureText(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  const rounded = Number(value.toPrecision(6))
  return String(rounded)
}


/**
 * The columns an identity may name, as a set, for a caller that has to judge
 * one before the declaration exists.
 */
export function isIdentityType(column: Pick<ColumnDeclaration, 'type'>): boolean {
  return (IDENTITY_TYPES as readonly string[]).includes(column.type)
}

/**
 * An expression with one of its own columns renamed (M26 U3).
 *
 * `from` as a name of this format, and as the link half of a hop —
 * `from.kcal` reads through the renamed link — but never as the column half of
 * somebody else's hop (`ingredient.from` is the other format's), and never as
 * the unit after `in`, which only looks like a name.
 */
export function renameInExpression(text: string, from: string, to: string): string {
  // A column name is `[a-z][a-z0-9_]*`, so it carries nothing a pattern reads.
  const name = /^[a-z][a-z0-9_]*$/.test(from) ? from : undefined
  if (name === undefined) return text
  return text.replace(new RegExp(`(?<![a-z0-9_.])(?<!\\bin\\s+)${name}(?![a-z0-9_])`, 'g'), to)
}
