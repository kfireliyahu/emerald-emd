/**
 * **An aggregate across a link** — M19 U4b,
 * [D-224](../../../docs/09-decision-log.md).
 *
 * A recipe's kilocalories are the sum of its lines; a line's kilocalories are
 * an amount times an ingredient's figure. Nothing in this app could say that
 * until now: an identity is arithmetic over *one row*, and the whole of what
 * D-209 permitted was stateless and within-row. **D-210 moved the line after a
 * real domain needed a sum across a join** — a vault of notes computes
 * per-serving nutrition by hand, in prose, from figures on twelve other notes —
 * and this file is that clause.
 *
 * > **Declarable:** identities, links between entities, derived columns,
 * > **aggregates across a link with unit conversion**, threshold banding.
 *
 * ## What an aggregate is, and the one sentence that bounds it
 *
 * A name, a **kind**, the rows it runs over, and an expression evaluated on
 * each of them. The rows are *the rows of another format whose link column
 * names this row* — `recipe_line.recipe = this.id` — which is the only shape of
 * traversal that exists here and is deliberately the only one. **One hop out,
 * one hop back, and no recursion**: a recipe cannot aggregate a recipe that
 * aggregates it, because the rows it reaches are named by a column rather than
 * found by a search, and nothing here follows a second edge.
 *
 * That is the engine's line held rather than bent. *Stateless and relational is
 * declarable; iterative or semantic is code* — and **temporal was code until M25
 * E2** (D-267, D-271): a figure per month is `rollup.ts`, compiled to one
 * `GROUP BY`, not an aggregate. A sum over the rows that point here is
 * relational. A traversal is not, and there is no syntax for one.
 *
 * ## A sum that skipped a row is not a smaller sum
 *
 * **The whole aggregate is `unchecked` the moment any row it covers cannot
 * answer**, and it names which row. That is not fastidiousness; it is D-138 in
 * the one place where the alternative looks most reasonable. A payslip
 * reconciled to ₪0.00 twice over with every employer amount dropped, because
 * both proofs ran over the employee column — and a recipe total that quietly
 * omitted the line with no figure on it would be exactly that, arriving as a
 * number a person would then believe.
 *
 * So there are three states again (D-149), for the tenth time: a value, or
 * `unchecked` with a reason naming the row. `proved` and `failed` are an
 * identity's; an aggregate is a *figure*, and what it has instead of a verdict
 * is the honest refusal to be one.
 *
 * **Zero rows is not the same question.** A sum of nothing is zero and a count
 * of nothing is zero, and the figure says so. But **a claim over a sum that no
 * row points at is `unchecked`, not failed** (M33 F7, D-465): every paycheck
 * month before a timesheet was kept would otherwise read *failed* against hours
 * nobody wrote down, and a verdict about rows that do not exist yet is not
 * one. Rows that point here and that a filter takes none of are a different
 * thing — a month with no refunds really has zero refunds, and its claim is
 * judged. There is no smallest of nothing, so `MIN`, `MAX` and `AVERAGE` over
 * an empty set are `unchecked` rather than zero.
 *
 * ## It is computed on read and never stored
 *
 * The same rule as a verdict (D-222), and the same evidence: the vault's own
 * failure mode was a table of totals computed once by a model and frozen into
 * prose while its inputs moved underneath it (D-210). An aggregate whose rows
 * changed an hour ago is a lie in a file, and the only defence that has ever
 * worked here is not writing it down.
 *
 * ## Only the rows that match (M24 U8, D-260)
 *
 * A payslip's net is its gross less *the lines whose deduction type reduces
 * net* — not less every line, because an employer's pension contribution is on
 * the slip and never left the gross. So an aggregate may say **where**: one enum
 * or boolean column of the source row, or one hop through its link, equal to
 * one member. `deduction_type.reduces_net is true`.
 *
 * It is the smallest thing that answers the paycheck, on purpose. No `or`
 * between columns, no range beyond what a member already says: a filter that
 * could combine would be a `WHERE` clause, and a `WHERE` clause is the query
 * language this file has refused since D-095.
 *
 * **A row whose filter column is empty makes the whole fold `unchecked`**, for
 * the reason a row with no figure does. Nobody can say whether it belongs, and
 * a total that quietly left out the line with no type on it is the ₪0.00 payslip
 * again (D-138).
 *
 * ## Not, empty and one of (M36 U04, D-380)
 *
 * Still one column per filter, and five ways to ask about it:
 *
 * - `kind is OUTFLOW` — D-260's, one member;
 * - `kind is one of TAX, HEALTH` — any of several members of the one column,
 *   which is a set and not an `or`: it cannot reach a second column;
 * - `kind is not TRANSFER`, `kind is not one of TRANSFER, SAVING` — **and an
 *   empty cell passes it**, through a link that is empty too. An uncategorised
 *   line is not a transfer: this is the one place empty is an answer rather
 *   than a doubt, so `is not` never makes a fold `unchecked`;
 * - `holding is empty`, `employer is not empty` — whether the cell holds
 *   anything, of any column but a list. These decide every row.
 *
 * ## The latest by an order (M25 E3, D-267, D-272)
 *
 * A security's price is not a fold of its prices; it is *the* price — the one
 * with the greatest `as_of`. `LATEST` and `EARLIEST` pick a row rather than a
 * figure: over the rows that point here, the one whose **order column** is
 * greatest (least), and the expression read on it alone. The order is a column
 * of the source's own row — a date, a month, an instant or an integer — and
 * never a hop, so this is still one hop out and one back (D-224).
 *
 * **A tie is a refusal to guess.** Two prices on the same day from two sources
 * are two answers to *the latest price*, and picking one would be the engine
 * holding an opinion nobody declared; the figure is `unchecked` and names the
 * rows that tie. So is a row with nothing in the order column — it might be the
 * latest, and nobody can say.
 */

import {
  columnsNamedBy,
  evaluateExpression,
  parseExpression,
  type Expression,
  type IdentityInputs,
} from './identity.ts'
import { SEEDED_UNITS, type UnitTable } from './unit.ts'
import { looksLikeClock, parseClockWords, type ClockWindow } from './clock.ts'
import { formatMoney, money } from '@/core/money.ts'

/**
 * What to do with the figures.
 *
 * Seven, closed, and each one a fold a person can check by hand. There is no
 * `MEDIAN` and no `DISTINCT`. The first five fold every figure; **the last two
 * pick one row by an order** (M25 E3, D-272). This file once refused that as a
 * traversal, and it is not one: the order is a column of the rows already
 * gathered, and nothing sorts beyond finding the greatest.
 *
 * `AVERAGE` is here rather than left to `SUM ÷ COUNT` because the version
 * somebody writes by hand divides by the wrong count: `sum / count` over rows
 * where one row is empty is a sum that is `unchecked` divided by a count that is
 * not, and the two folds disagree about what they covered.
 */
export const AGGREGATE_KINDS = [
  'SUM',
  'COUNT',
  'AVERAGE',
  'MINIMUM',
  'MAXIMUM',
  'LATEST',
  'EARLIEST',
] as const

export type AggregateKind = (typeof AGGREGATE_KINDS)[number]

/** The kinds that fold every figure — the ones a rollup's `GROUP BY` says. */
export const FOLD_KINDS = ['SUM', 'COUNT', 'AVERAGE', 'MINIMUM', 'MAXIMUM'] as const

export type FoldKind = (typeof FOLD_KINDS)[number]

/** The kinds that pick one row by an order column (M25 E3, D-272). */
export type OrderedKind = 'LATEST' | 'EARLIEST'

export function isOrdered(kind: AggregateKind): kind is OrderedKind {
  return kind === 'LATEST' || kind === 'EARLIEST'
}

/** Where the rows come from: another format, and its column that names this one. */
export interface AggregateSource {
  /** The format whose rows are folded — `recipe_line`. */
  readonly format: string
  /**
   * Its `link` column pointing back here — `recipe`. **Absent: every row of
   * `format`** (M34 U4, D-397) — a degree's average over every course, which
   * no column of a course names because nobody keeps a degree row to name.
   */
  readonly column?: string | undefined
}

/**
 * Whether a total folds every row of its source rather than the rows that name
 * this one (M34 U4, D-397). Written `every course` — a word, never a missing
 * column, so `course` with the column forgotten is still a refusal.
 */
export function foldsEvery(over: AggregateSource): boolean {
  return over.column === undefined
}

/** `every course` or `recipe_line.recipe` — how the source is written. */
export function sourceText(over: AggregateSource): string {
  return over.column === undefined ? `${EVERY} ${over.format}` : `${over.format}.${over.column}`
}

/** The word a total over every row of a format is written with (D-397). */
export const EVERY = 'every'

/**
 * Which of those rows are folded (U8): a column of the source, or one hop
 * through its link, and what it has to be (M36 U04).
 */
export interface AggregateFilter {
  /** `kind`, or `deduction_type.reduces_net` — the same names an expression may use. */
  readonly column: string
  /**
   * An enum's member exactly as declared, or `true` / `false` for a boolean —
   * or `empty` (`EMPTY`), the word for a cell that holds nothing. With
   * `oneOf`, the first of its members.
   */
  readonly is: string
  /** `is not …`: the filter turned round, and an empty cell passes it. */
  readonly not?: boolean | undefined
  /** `is one of A, B`: every member it may be, in the order written. */
  readonly oneOf?: readonly string[] | undefined
  /**
   * `due is within 14 days`, `due is before today` — a date's window around
   * today (M49 U2, D-472), with `is` its words. A question's, never a claim's.
   */
  readonly clock?: ClockWindow | undefined
}

/**
 * `is empty` — the word a filter uses for a cell that holds nothing: a rule's
 * condition it leaves to whoever can (D-273), and a total's or a rollup's
 * `holding is empty` (M36 U04).
 */
export const EMPTY = 'empty'

/** Whether a filter asks if the cell holds anything, rather than what. */
export function isEmptyTest(filter: AggregateFilter): boolean {
  return filter.oneOf === undefined && filter.clock === undefined && filter.is === EMPTY
}

/** The members a filter names — one, several for `one of`, none for `empty`. */
export function filterMembers(filter: AggregateFilter): readonly string[] {
  if (isEmptyTest(filter) || filter.clock !== undefined) return []
  return filter.oneOf ?? [filter.is]
}

/** Whether a filter says more than D-260's one member — what language 19 adds. */
export function isWiderFilter(filter: AggregateFilter): boolean {
  return filter.not === true || filter.oneOf !== undefined || isEmptyTest(filter) || filter.clock !== undefined
}

/**
 * What a filter makes of one cell: `value` is the member it holds (`true` /
 * `false` for a boolean, anything at all for an empty test), or undefined when
 * the cell — or the link on the way to it — is empty.
 *
 * **`UNDECIDED` only for an empty cell asked `is` or `is one of`** — it might
 * be the member, and nobody can say (D-138). `is not` takes an empty cell, and
 * `is empty` / `is not empty` decide every one.
 */
export function filterDecides(
  filter: AggregateFilter,
  value: string | undefined,
): 'TAKES' | 'LEAVES' | 'UNDECIDED' {
  const not = filter.not === true
  // A window needs today, which nothing that folds a claim's figure is given (D-472).
  if (filter.clock !== undefined) return 'UNDECIDED'
  if (isEmptyTest(filter)) return (value === undefined) !== not ? 'TAKES' : 'LEAVES'
  if (value === undefined) return not ? 'TAKES' : 'UNDECIDED'
  return filterMembers(filter).includes(value) !== not ? 'TAKES' : 'LEAVES'
}

/** One declared aggregate. */
export interface AggregateDeclaration {
  /** `snake_case`, unique within the format, and what the figure is reported by. */
  readonly name: string
  readonly kind: AggregateKind
  readonly over: AggregateSource
  /**
   * Evaluated on each row that points here, in the **source** format's
   * vocabulary — its own columns, and one hop through its own links:
   * `amount_g / 100 * ingredient.kcal`.
   *
   * Empty for `COUNT`, which asks about the rows rather than about a figure on
   * them, and **required for every other kind**: a `SUM` with nothing to sum is
   * a `COUNT` written by somebody who did not mean one.
   */
  readonly expression: string
  /**
   * What the result is in — `kcal`, `g`. Declared rather than derived, because
   * the expression's own unit is a thing this engine deliberately will not
   * always name (D-223), and a figure reported with no unit beside a figure
   * reported with one is how a factor of a thousand gets through.
   *
   * It is what lets an identity convert the aggregate: `total_kcal in kJ`.
   */
  readonly unit: string | undefined
  /** Why this is worth computing, in the person's words. Prose, never parsed. */
  readonly note: string
  /** Only the rows that match (U8). Absent folds every row that points here. */
  readonly where?: AggregateFilter | undefined
  /**
   * The source's own column a `LATEST` or `EARLIEST` picks by — `as_of` (M25
   * E3, D-272). Required for those two and refused for every other kind.
   */
  readonly by?: string | undefined
}

/** An aggregate with the defaults the others fill in. */
export function aggregate(
  name: string,
  kind: AggregateKind,
  over: AggregateSource,
  extra: Partial<Omit<AggregateDeclaration, 'name' | 'kind' | 'over'>> = {},
): AggregateDeclaration {
  return {
    name,
    kind,
    over,
    expression: extra.expression ?? '',
    unit: extra.unit,
    note: extra.note ?? '',
    ...(extra.where === undefined ? {} : { where: extra.where }),
    ...(extra.by === undefined ? {} : { by: extra.by }),
  }
}

/**
 * The artefact's `over` cell — `security_price.security by as_of where source
 * is FETCHED` — written out. The order and the filter are both optional, and
 * the order comes first.
 */
export function overText(declaration: AggregateDeclaration): string {
  const by = declaration.by === undefined ? '' : ` by ${declaration.by}`
  const where = declaration.where === undefined ? '' : ` where ${filterText(declaration.where)}`
  return `${sourceText(declaration.over)}${by}${where}`
}

/* -------------------------------------------------------------- the filter */

const FILTER_EXAMPLES =
  '`kind is OUTFLOW`, `kind is not TRANSFER`, `status is one of Planned, In progress`, `status is "In progress"`, `holding is empty`, `due is within 14 days`'

/**
 * `deduction_type.reduces_net is true` — D-260's spelling, and since M36 U04
 * `is not X`, `is one of A, B`, `is not one of A, B`, `is empty` and `is not
 * empty` (D-380), and since M49 U2 a date's window around today — `is within
 * 14 days`, `is before today`, `is after today`, `is today` (D-472), which a
 * question may ask and a declared total or a rule set may not. The one spelling a filter has, in the artefact's `over`
 * cell, a rollup's and a rule set's sentence, and a tool's `where` alike.
 *
 * **A member may have spaces** (M48 U1): `one of` is split on its commas, so
 * `status is one of Planned, In progress` is two members, and a lone member
 * with a space is quoted — `status is "In progress"` — because unquoted, `kind
 * is TAX or HEALTH` would be read as one member nobody meant. A quoted member
 * may stand in a list too, for one holding a comma.
 *
 * Only the shape is read here. Whether the column exists, is an enum or a
 * boolean, and has that member is `aggregateRejection`'s, because that needs
 * the source's declaration and this needs nothing. A filter it cannot read is
 * refused saying which part.
 */
export function parseFilter(text: string): AggregateFilter | { readonly problem: string } {
  const said = text.trim().replace(/\s+/g, ' ')
  const refuse = (part: string): { readonly problem: string } => ({
    problem: `"${said}" is not a filter: ${part} Write one column and what it has to be — ${FILTER_EXAMPLES} — or through a link, \`deduction_type.reduces_net is true\`.`,
  })
  const at = ` ${said} `.indexOf(' is ')
  if (at < 0) return refuse('it has no `is`.')
  const column = said.slice(0, Math.max(0, at - 1))
  if (!/^[\w.]+$/.test(column)) {
    return refuse(column === '' ? 'it names no column before `is`.' : `"${column}" is not a column's name.`)
  }
  let rest = said.slice(at + 3).trim()
  const not = rest === 'not' || rest.startsWith('not ') ? { not: true } : {}
  if ('not' in not) rest = rest.slice(3).trim()
  if (rest === '') return refuse('nothing follows `is`.')

  // A date's window around today (M49 U2, D-472).
  const clock = parseClockWords(rest)
  if (clock !== undefined) {
    if ('not' in not) return refuse('a window of days is not turned round with `not` — ask the other one: `before today`, `after today`.')
    return { column, is: rest.toLowerCase(), clock }
  }
  if (!rest.startsWith('"') && looksLikeClock(rest)) {
    return refuse(
      `"${rest}" is not a window of days: say \`today\`, \`yesterday\`, \`tomorrow\`, \`before today\`, \`after today\`, \`within 14 days\`, \`last 7 days\`, or \`this\`, \`last\` or \`next\` \`week\`, \`month\` or \`year\`.`,
    )
  }

  if (rest === 'one of' || rest.startsWith('one of ')) {
    const members = listMembers(rest.slice(6).trim())
    if ('problem' in members) return refuse(members.problem)
    if (new Set(members).size !== members.length) return { problem: `"${said}" names one member twice.` }
    return { column, is: members[0] ?? '', ...not, oneOf: members }
  }
  const quoted = /^"([^"]+)"$/.exec(rest)
  if (quoted !== null) return { column, is: quoted[1] ?? '', ...not }
  if (rest.includes('"')) return refuse(`${rest} opens a quote it does not close, or says more after it.`)
  if (rest.includes(' ')) {
    return refuse(
      `"${rest}" is more than one word. Quote a member with a space in it — \`is "${rest}"\` — or name several with \`is one of A, B\`.`,
    )
  }
  return { column, is: rest, ...not }
}

/** `Planned, In progress, "A, B"` — split on the commas outside quotes. */
function listMembers(list: string): readonly string[] | { readonly problem: string } {
  if (list === '') return { problem: '`one of` names no members.' }
  const members: string[] = []
  let current = ''
  let quoted = false
  for (const char of list) {
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (char === ',' && !quoted) {
      members.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (quoted) return { problem: `${list} opens a quote it does not close.` }
  members.push(current.trim())
  if (members.some((each) => each === '')) return { problem: `\`one of ${list}\` has an empty member between its commas.` }
  return members
}

/** A member as a filter writes it: quoted when it would not read back bare. */
function memberText(member: string, inList: boolean): string {
  const bare = inList ? !/[,"]/.test(member) && !/ (and|where) /.test(member) : /^[^\s"]+$/.test(member)
  return bare ? member : `"${member}"`
}

/** What follows `column is` — `not TRANSFER`, `one of TAX, HEALTH`, `empty`. */
export function filterPredicate(filter: AggregateFilter): string {
  if (filter.clock !== undefined) return filter.is
  const not = filter.not === true ? 'not ' : ''
  return filter.oneOf === undefined
    ? `${not}${memberText(filter.is, false)}`
    : `${not}one of ${filter.oneOf.map((each) => memberText(each, true)).join(', ')}`
}

/** The sentence a filter is written as. */
export function filterText(filter: AggregateFilter): string {
  return `${filter.column} is ${filterPredicate(filter)}`
}

/**
 * A rollup's or a rule set's `where`, cut into its filters at each ` and ` —
 * except one inside a quoted member (M48 U1), `kind is "Research and
 * development"`.
 */
export function splitFilters(where: string): readonly string[] {
  const parts: string[] = []
  let start = 0
  let quoted = false
  for (let at = 0; at < where.length; at += 1) {
    if (where[at] === '"') quoted = !quoted
    else if (!quoted && where.startsWith(' and ', at)) {
      parts.push(where.slice(start, at))
      start = at + 5
      at += 4
    }
  }
  parts.push(where.slice(start))
  return parts
}

/* ---------------------------------------------------------- the evaluation */

/**
 * What an aggregate came to, or why it will not say.
 *
 * `rows` travels with the figure because it is the thing a reader checks it
 * against: *14 lines* beside *2,140 kcal* is a figure somebody can disbelieve,
 * and 2,140 on its own is not.
 */
export type AggregateValue =
  | {
      readonly kind: 'VALUE'
      readonly value: number
      readonly unit: string | undefined
      readonly rows: number
      /**
       * **The currency, when what was folded is money** (M29 F7). A sum of
       * money is minor units *in something*, and the figure travels with what
       * it is in so an identity comparing it to a figure in another currency
       * refuses rather than proves (D-138). Absent for a figure that is not
       * money, and for a sum of no rows.
       */
      readonly currency?: string
      /**
       * The order value of the row a `LATEST` or `EARLIEST` picked — the day
       * the price is from, which is what a reader checks *the latest* against.
       */
      readonly at?: string | number
      /**
       * **Set on a sum that no row points at at all** (M33 F7, D-465). The
       * figure is still zero; this is the sentence a claim naming it says
       * instead of a verdict, because there is nothing to prove yet.
       */
      readonly nothingToProve?: string
    }
  | { readonly kind: 'UNCHECKED'; readonly reason: string }

/**
 * A source row as a picking aggregate needs it: its inputs, and what is in its
 * order column — a date, month or instant as stored text, an integer as a
 * number, absent when the cell is empty.
 */
export type OrderedInputs = IdentityInputs & { readonly order?: string | number }

/**
 * Fold one aggregate over the rows that point at this one.
 *
 * `rows` are the source rows, already resolved — their own numbers, and the
 * numbers one hop through their own links, under dotted keys. **Resolving the
 * hop is the repository's job and not this file's**: `src/domain/` imports no
 * sql.js, and the join is a query. What arrives here is arithmetic.
 *
 * **Total, and every way out is a value or a sentence.** An expression that
 * does not parse, a row that cannot answer, an empty set with no least member,
 * an overflow — each says so in words a surface can print, because every caller
 * of this puts the answer beside a row.
 */
export function evaluateAggregate(
  declaration: AggregateDeclaration,
  rows: readonly OrderedInputs[],
  units: UnitTable = SEEDED_UNITS,
  among?: number,
): AggregateValue {
  const filter = declaration.where
  const matching: OrderedInputs[] = []
  for (const [index, row] of rows.entries()) {
    if (filter === undefined) {
      matching.push(row)
      continue
    }
    // `is empty` asks whether the cell holds anything, of any type; every
    // other spelling asks which member it is (M36 U04).
    const value = isEmptyTest(filter)
      ? row.filled?.has(filter.column) === true
        ? EMPTY
        : undefined
      : row.members?.get(filter.column)
    const decided = filterDecides(filter, value)
    if (decided === 'UNDECIDED') {
      // **Not "does not match".** A line with no type on it may be the one
      // that reduces net, and a total that left it out is a smaller number
      // rather than a truer one (D-138) — the same refusal as a missing figure.
      return {
        kind: 'UNCHECKED',
        reason: `${rowNamed(rows, index)} of ${declaration.over.format} has nothing in ${filter.column}, so nobody can say whether it is one the filter ${filterText(filter)} takes. A total that left it out would be a smaller number and not a truer one.`,
      }
    }
    if (decided === 'TAKES') matching.push(row)
  }

  if (declaration.kind === 'COUNT') {
    return { kind: 'VALUE', value: matching.length, unit: undefined, rows: matching.length }
  }

  const expression = parseExpression(declaration.expression)
  if ('problem' in expression) return { kind: 'UNCHECKED', reason: expression.problem }

  if (isOrdered(declaration.kind)) {
    return pick(declaration, declaration.kind, matching, expression, units, among)
  }
  const kind = declaration.kind

  const figures: number[] = []
  // **One currency, or no total** (M29 F7). Minor units of shekels and of
  // dollars add up to a number, and it is the number of nothing — the sum that
  // would then prove against a figure in either (D-138).
  let currency: { readonly code: string; readonly index: number } | undefined
  for (const [index, row] of matching.entries()) {
    const value = evaluateExpression(expression, row, units)
    if (value.kind === 'NUMBER' && value.currency !== undefined) {
      if (currency === undefined) currency = { code: value.currency, index }
      else if (currency.code !== value.currency) {
        return {
          kind: 'UNCHECKED',
          reason: `${rowNamed(matching, index)} of ${declaration.over.format} is in ${value.currency} and ${rowNamed(matching, currency.index)} in ${currency.code} — two currencies, and nothing here knows a rate between them, so there is no one ${word(kind)}.`,
        }
      }
    }
    if (value.kind === 'UNKNOWN') {
      // **The whole fold, not this row.** A total that dropped the line it
      // could not read is the payslip that reconciled to ₪0.00 with every
      // employer amount missing (D-138), arriving as a number somebody will
      // believe. The row is named so the fix is one edit away.
      return {
        kind: 'UNCHECKED',
        reason: `${rowNamed(matching, index)} of ${declaration.over.format} cannot answer: ${value.reason} A total that left it out would be a smaller number and not a truer one.`,
      }
    }
    figures.push(value.value)
  }

  if (figures.length === 0) {
    // A sum of nothing is zero. When nothing points here at all, a claim over
    // it has nothing to prove (D-465); when rows do and the filter took none,
    // the zero is the answer. There is no least member of nothing, so the
    // other three say so.
    if (kind === 'SUM') {
      return {
        kind: 'VALUE',
        value: 0,
        unit: declaration.unit,
        rows: 0,
        ...(rows.length === 0
          ? { nothingToProve: `${nothingPoints(declaration, false)}, so ${declaration.name} adds up nothing yet and there is nothing to prove.` }
          : {}),
      }
    }
    return {
      kind: 'UNCHECKED',
      reason: `${nothingPoints(declaration)}, and there is no ${word(kind)} of nothing.`,
    }
  }

  const value = fold(kind, figures)
  if (!Number.isFinite(value)) {
    return { kind: 'UNCHECKED', reason: 'The arithmetic did not come out as a number.' }
  }
  return {
    kind: 'VALUE',
    value,
    unit: declaration.unit,
    rows: figures.length,
    ...(currency === undefined ? {} : { currency: currency.code }),
  }
}

/**
 * A row's inputs with its totals beside them, under their own names — the
 * figure, the currency a sum of money is in, the unit it was declared in. A
 * total that would not fold puts no key, so an identity naming it says
 * `unchecked` (U4b), and so does a sum nothing points at, with its own
 * sentence (D-465). One place, so the sheet, the entry page and a reading's
 * header all hand an identity the same total (M29 F7).
 */
export function inputsWithTotals(
  inputs: IdentityInputs,
  totals: readonly { readonly aggregate: AggregateDeclaration; readonly value: AggregateValue }[],
): IdentityInputs {
  const numbers = new Map(inputs.numbers)
  const currencies = new Map(inputs.currencies)
  const units = new Map(inputs.units ?? [])
  const unfolded = new Map(inputs.unfolded ?? [])
  for (const { aggregate: each, value } of totals) {
    if (value.kind !== 'VALUE') continue
    if (value.nothingToProve !== undefined) unfolded.set(each.name, value.nothingToProve)
    numbers.set(each.name, value.value)
    if (value.currency !== undefined) currencies.set(each.name, value.currency)
    if (value.unit !== undefined) units.set(each.name, value.unit)
  }
  return { ...inputs, numbers, currencies, units, ...(unfolded.size === 0 ? {} : { unfolded }) }
}

function nothingPoints(declaration: AggregateDeclaration, withFilter = true): string {
  const which = declaration.where === undefined || !withFilter ? '' : ` where ${filterText(declaration.where)}`
  if (foldsEvery(declaration.over)) return `${declaration.over.format} has no row${which}`
  return `No row of ${declaration.over.format}${which} points at this one`
}

/**
 * `LATEST` and `EARLIEST`: the one row with the greatest (least) order, and the
 * expression read on it alone (M25 E3, D-272).
 *
 * `rows` may be every row that points here or — when the repository narrowed
 * in SQL — only those that could be the answer: the ones at the extreme order
 * and the ones with none. `among` is then how many there were in all, so the
 * sentence still says *the latest of 340*.
 *
 * **Only the picked row has to answer.** A price from three years ago with
 * nothing in it says nothing about today's, which is where this parts from a
 * fold: a sum needs every row, a pick needs one.
 */
function pick(
  declaration: AggregateDeclaration,
  kind: OrderedKind,
  rows: readonly OrderedInputs[],
  expression: Expression,
  units: UnitTable,
  among: number | undefined,
): AggregateValue {
  const by = declaration.by ?? ''
  if (rows.length === 0) {
    return {
      kind: 'UNCHECKED',
      reason: `${nothingPoints(declaration)}, and there is no ${word(kind)} of nothing.`,
    }
  }

  // It might be the one, and nobody can say — the refusal a row with no
  // figure gets from a fold (D-138), for the same reason.
  const unordered = rows.findIndex((row) => row.order === undefined)
  if (unordered !== -1) {
    return {
      kind: 'UNCHECKED',
      reason: `${rowNamed(rows, unordered)} of ${declaration.over.format} has nothing in ${by}, so nobody can say which row is the ${word(kind)}.`,
    }
  }

  let best: string | number | undefined
  for (const row of rows) {
    const order = row.order
    if (order === undefined) continue
    if (best === undefined || (kind === 'LATEST' ? order > best : order < best)) best = order
  }
  const winners = rows.flatMap((row, index) => (row.order === best ? [index] : []))
  if (winners.length > 1) {
    const named = winners.map((index) => rows[index]?.id ?? String(index + 1))
    return {
      kind: 'UNCHECKED',
      reason: `Rows ${named.join(' and ')} of ${declaration.over.format} tie at ${String(best)} in ${by}, so there is no one ${word(kind)} — and picking one would be a guess.`,
    }
  }

  const index = winners[0] ?? 0
  const picked = rows[index]
  if (picked === undefined) {
    return { kind: 'UNCHECKED', reason: `${nothingPoints(declaration)}.` }
  }
  const value = evaluateExpression(expression, picked, units)
  if (value.kind === 'UNKNOWN') {
    return {
      kind: 'UNCHECKED',
      reason: `${rowNamed(rows, index)} of ${declaration.over.format} is the ${word(kind)} by ${by}, and it cannot answer: ${value.reason}`,
    }
  }
  if (!Number.isFinite(value.value)) {
    return { kind: 'UNCHECKED', reason: 'The arithmetic did not come out as a number.' }
  }
  return {
    kind: 'VALUE',
    value: value.value,
    unit: declaration.unit,
    rows: among ?? rows.length,
    ...(value.currency === undefined ? {} : { currency: value.currency }),
    ...(best === undefined ? {} : { at: best }),
  }
}

function fold(kind: Exclude<FoldKind, 'COUNT'>, figures: readonly number[]): number {
  switch (kind) {
    case 'SUM':
      return figures.reduce((total, each) => total + each, 0)
    case 'AVERAGE':
      return figures.reduce((total, each) => total + each, 0) / figures.length
    case 'MINIMUM':
      return figures.reduce((least, each) => (each < least ? each : least))
    case 'MAXIMUM':
      return figures.reduce((most, each) => (each > most ? each : most))
  }
}

/** `the sum`, `the average` — the kind as a sentence uses it. */
export function word(kind: AggregateKind): string {
  switch (kind) {
    case 'SUM':
      return 'sum'
    case 'COUNT':
      return 'count'
    case 'AVERAGE':
      return 'average'
    case 'MINIMUM':
      return 'minimum'
    case 'MAXIMUM':
      return 'maximum'
    case 'LATEST':
      return 'latest'
    case 'EARLIEST':
      return 'earliest'
  }
}

/**
 * How a row is named in a refusal — by its id when it has one, by its position
 * when it does not.
 *
 * The id, because that is what the caller passes to `update_format_rows` to fix
 * it. A position is what is left when the inputs were built by a test.
 */
function rowNamed(rows: readonly IdentityInputs[], index: number): string {
  const id = rows[index]?.id
  return id === undefined ? `Row ${String(index + 1)}` : `Row ${id}`
}

/* -------------------------------------------------------- saying it aloud */

/** One line about what an aggregate came to, for a plugin answer or a screen. */
export function aggregateSentence(
  declaration: AggregateDeclaration,
  value: AggregateValue,
): string {
  if (value.kind === 'UNCHECKED') {
    return `${declaration.name}: unchecked — ${value.reason}`
  }
  const figure = aggregateFigure(value)
  const which = declaration.where === undefined ? '' : ` where ${filterText(declaration.where)}`
  if (isOrdered(declaration.kind)) {
    const at = value.at === undefined ? '' : `, from ${String(value.at)}`
    return `${declaration.name}: ${figure} — the ${word(declaration.kind)} of ${rowCount(value.rows)} of ${declaration.over.format}${which} by ${declaration.by ?? ''}${at}.`
  }
  const over = foldsEvery(declaration.over)
    ? `${word(declaration.kind)} over every row of ${declaration.over.format}${which}, ${rowCount(value.rows)}`
    : `${word(declaration.kind)} over ${rowCount(value.rows)} of ${declaration.over.format}${which}`
  return `${declaration.name}: ${figure} — the ${over}.`
}

/** A fold's figure alone — `21 h`, `₪1,234.56` — as the entry's grid prints it (M35 U2). */
export function aggregateFigure(value: Extract<AggregateValue, { kind: 'VALUE' }>): string {
  const unit = value.unit === undefined ? '' : ` ${value.unit}`
  return value.currency === undefined ? `${trim(value.value)}${unit}` : moneyText(value.value, value.currency)
}

function rowCount(rows: number): string {
  return rows === 1 ? '1 row' : `${String(rows)} rows`
}

/**
 * A folded sum of money as an amount — `₪1,234.56`, never `123456` (M29 F7).
 * Whole minor units first, halves away from zero, as every money figure is
 * (D-333): an average of agorot can land between two of them.
 */
export function moneyText(minor: number, currency: string): string {
  const whole = Math.sign(minor) * Math.round(Math.abs(minor))
  return formatMoney(money(whole === 0 ? 0 : whole, currency))
}

/**
 * Six significant digits at most, the same as a verdict prints.
 *
 * A sum over reals lands on `2139.9999999999995` often enough that showing it
 * would make every total look like a bug in the arithmetic rather than a fact
 * about the recipe.
 */
function trim(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  return String(Number(value.toPrecision(6)))
}

/** Every name the aggregate's expression reaches for, dotted ones included. */
export function namesUsedBy(declaration: AggregateDeclaration): readonly string[] {
  const filtered = [
    ...(declaration.where === undefined ? [] : [declaration.where.column]),
    ...(declaration.by === undefined ? [] : [declaration.by]),
  ]
  if (declaration.kind === 'COUNT') return filtered
  const expression = parseExpression(declaration.expression)
  if ('problem' in expression) return filtered
  const named = columnsNamedBy({ left: expression, right: expression })
  return [...named, ...filtered.filter((each) => !named.includes(each))]
}

/** Re-exported so a caller naming an aggregate's expression needs one import. */
export type { Expression }
