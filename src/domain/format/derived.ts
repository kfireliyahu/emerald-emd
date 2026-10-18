/**
 * **A derived column — worked out from other columns rather than typed** —
 * M29 U3b, [D-334](../../../docs/09-decision-log.md).
 *
 * `price * (1 + vat)`. `amount_g / 100 * ingredient.kcal`. `total_kcal /
 * servings`. A spreadsheet's formula, and the question it raised: why is a
 * figure the engine can already *check* not one it can *produce*?
 *
 * ## The same language, used the other way round
 *
 * A derived column is an identity's expression — the grammar of D-222, one hop
 * through a link and an aggregate's name (D-224), `in` for a unit (D-223) —
 * **used to produce a value instead of to check one**. `parseExpression` reads
 * it; there is no second parser and no new word.
 *
 * ## It is SQL, and SQL is the engine's
 *
 * Every format with a derived column has a **view**, `fmt_<name>__derived`:
 * the stored columns and every derived one beside them. Anything that opens
 * the file — the app, the plugin, `sqlite3` — reads the same figures, and they
 * are computed on read, so they cannot go stale and nothing is stored twice
 * (D-087, D-222).
 *
 * **The SQL is compiled here from the parsed tree, never from the text**:
 * identifiers go through `quoteIdentifier`, enum members and unit symbols
 * through `quoteLiteral`, and a number through its own digits. Nothing a person
 * or a model wrote reaches `db.run` — which is D-222's *no identity becomes
 * SQL* said precisely: no *text* becomes SQL; an expression the engine parsed
 * and typed may be compiled by the engine. Identities themselves are unchanged
 * and still judged in TypeScript.
 *
 * ## The rules a derived figure keeps
 *
 * - **Never editable.** It has no stored cell to write.
 * - **An empty input gives an empty cell, never 0** — `NULL` propagates, and
 *   `x / 0` is `NULL`. The screen names the input that is empty.
 * - **An aggregate is empty in whole if any row it covers cannot answer** —
 *   `COUNT(*) = COUNT(x)`, the same refusal `aggregate.ts` makes (D-138).
 * - **Money stays whole minor units.** The arithmetic is exact — a fraction
 *   `n / d` of integers carried through the tree — and rounded once, at the
 *   end, to the agora, halves away from zero (D-333).
 * - **Its type is inferred and checked when it is declared**: money, a figure
 *   in a unit, or a bare number. Money times money, a bare number added to
 *   money and a unit on money are refused; two currencies meeting on a row is
 *   an empty cell.
 * - **One derived column may name another**, and a cycle is refused.
 *
 * A `latest` or `earliest` total is read too (M36 U05): the one row picked by
 * its order, empty on a tie, as `aggregate.ts` picks it.
 *
 * **A date moved by whole days is a computed date** (M49 U1, D-471):
 * `next_review = last_reviewed + 7 days` is `date(last_reviewed, '+7 days')`,
 * stored nowhere, `YYYY-MM-DD` like a typed date — so it sorts, filters and
 * prints as one, and an empty date gives an empty cell.
 *
 * What it does not do yet, each refused in a sentence: a `via` (a conversion
 * across a dimension), and an identity naming a derived column.
 */

import {
  isLinkType,
  isListType,
  memberTableNameFor,
  MEMBER_COLUMNS,
  moneyColumnNames,
  nameRejection,
  quantityColumnNames,
  resolveName,
  ROW_ID_COLUMN,
  storedColumnsOf,
  tableNameFor,
  TABLE_PREFIX,
  type ColumnDeclaration,
  type FormatDeclaration,
} from './declaration.ts'
import { filterMembers, isEmptyTest, type AggregateDeclaration, type AggregateFilter } from './aggregate.ts'
import { filterConditionSql, quoteIdentifier as quote, quoteLiteral as literalText } from './ddl.ts'
import {
  evaluateExpression,
  isIdentityType,
  parseExpression,
  toWhole,
  type Expression,
  type IdentityInputs,
} from './identity.ts'
import { PERCENT_DENOMINATOR } from './percent.ts'
import {
  dateOfOrdinal,
  isPointType,
  lonePointProblem,
  mixedSpanProblem,
  movedPointProblem,
  pointOrdinal,
  shiftedPoint,
  spanPair,
  SPAN_UNITS,
  type PointType,
} from './span.ts'
import { dimensionOf, SEEDED_UNITS, unitNamed, type UnitTable } from './unit.ts'
import { namesToday, TODAY } from './clock.ts'

/** One derived column, as declared. */
export interface DerivedDeclaration {
  /** `snake_case`, and the name the view's column takes. */
  readonly name: string
  /** `price * (1 + vat)` — an expression with no `=`, exactly as typed. */
  readonly expression: string
  /** What it means, in the person's words. Prose, never parsed. */
  readonly note: string
}

/** A derived column with nothing else said about it. */
export function derived(name: string, expression: string, note = ''): DerivedDeclaration {
  return { name, expression, note }
}

/** What a derived figure turns out to be, worked out from what it names. */
export type DerivedType =
  | { readonly kind: 'MONEY' }
  /** A figure, in a unit when everything it is made of agrees on one. */
  | { readonly kind: 'NUMBER'; readonly unit: string | undefined }
  /** A date moved by whole days (D-471), `YYYY-MM-DD` like a stored one. */
  | { readonly kind: 'DATE' }

/**
 * The view a format's derived columns live in.
 *
 * Spelled like the reconciler's other names, `<table>__<what>`. A `links`
 * column called `derived` would collide with it, and `derivedProblems` says so.
 */
export function derivedViewNameFor(format: Pick<FormatDeclaration, 'name'>): string {
  return `${TABLE_PREFIX}${format.name}__derived`
}

/** The view's columns for one derived column — two for money, like a stored one. */
export function derivedColumnsOf(name: string, type: DerivedType): readonly string[] {
  if (type.kind === 'MONEY') {
    const names = moneyColumnNames({ name })
    return [names.minor, names.currency]
  }
  return [name]
}

/** One derived column, parsed, typed and compiled. */
export interface CompiledDerived {
  readonly declaration: DerivedDeclaration
  readonly type: DerivedType
  /** The expression with every derived column it names written in, to the leaves. */
  readonly expanded: Expression
  /** Each view column and the SQL that computes it, over the row aliased `t`. */
  readonly select: readonly { readonly column: string; readonly sql: string }[]
  /**
   * Whether it reads `today` (M49 U2, D-472): a question's column, worked out
   * by whoever asks with their own day, and so **never in the stored view**,
   * never folded by a total and never named by a claim.
   */
  readonly clock: boolean
}

/** A problem with one derived column, by its position in the declaration. */
export interface DerivedProblem {
  readonly index: number
  readonly message: string
}

type Shape = Pick<FormatDeclaration, 'name' | 'columns' | 'aggregates' | 'derived'>

/**
 * Every derived column of a format compiled, or the problems with them.
 *
 * `neighbours` are the document's other formats: a hop and an aggregate are
 * resolved against them, as an identity's are.
 */
export function compileDerived(
  declaration: Shape,
  neighbours: readonly FormatDeclaration[] = [],
  units: UnitTable = SEEDED_UNITS,
  /** `YYYY-MM-DD`, the asking runtime's — what `today` is in the SQL; without it a column reading it is `NULL`. */
  today?: string,
): { readonly compiled: readonly CompiledDerived[]; readonly problems: readonly DerivedProblem[] } {
  const list = declaration.derived ?? []
  const compiled: CompiledDerived[] = []
  const problems: DerivedProblem[] = []
  const taken = new Set<string>([ROW_ID_COLUMN])
  for (const column of declaration.columns) for (const stored of storedColumnsOf(column)) taken.add(stored)
  for (const column of declaration.columns) taken.add(column.name)
  for (const each of declaration.aggregates) taken.add(each.name)

  list.forEach((each, index) => {
    const wrong = (message: string): void => {
      problems.push({ index, message })
    }
    const nameProblem = nameRejection(each.name, 'derived column')
    if (nameProblem !== undefined) return wrong(nameProblem)
    if (taken.has(each.name)) {
      return wrong(
        `The computed column ${each.name} is called the same thing as a column or an aggregate of this format.`,
      )
    }
    if (list.findIndex((other) => other.name === each.name) !== index) {
      return wrong(`Two computed columns are called ${each.name}.`)
    }
    if (declaration.columns.some((column) => isListType(column.type) && column.name === 'derived')) {
      return wrong(
        `A list column called derived would share its table's name with this format's derived view. Rename the list column.`,
      )
    }

    const expanded = expand(each.name, declaration, [])
    if ('problem' in expanded) return wrong(`The computed column ${each.name}: ${expanded.problem}`)

    const scope: Scope = { self: declaration, neighbours, units, alias: 't', aggregates: true, today }
    const clock = namesToday(expanded.expression)
    const dated = dateSql(expanded.expression, scope)
    if (dated !== undefined) {
      if ('problem' in dated) return wrong(`The computed column ${each.name}: ${dated.problem}`)
      taken.add(each.name)
      compiled.push({
        declaration: each,
        type: { kind: 'DATE' },
        expanded: expanded.expression,
        select: [{ column: each.name, sql: dated.sql }],
        clock,
      })
      return
    }
    const figure = compile(expanded.expression, scope)
    if ('problem' in figure) return wrong(`The computed column ${each.name}: ${figure.problem}`)
    if (!figure.names) {
      return wrong(`The computed column ${each.name} names no column, so it would be the same figure on every row.`)
    }
    if (figure.unit.kind === 'ROW') {
      return wrong(
        `The computed column ${each.name} comes out in whatever unit each row's quantity is in. Say what it comes out in — \`amount in g\`.`,
      )
    }

    const type: DerivedType =
      figure.currency !== undefined
        ? { kind: 'MONEY' }
        : { kind: 'NUMBER', unit: figure.unit.kind === 'UNIT' ? figure.unit.unit : undefined }
    for (const column of derivedColumnsOf(each.name, type)) {
      if (taken.has(column)) {
        return wrong(
          `The computed column ${each.name} is money, so it is read as ${column}, and something else is already called that.`,
        )
      }
    }
    for (const column of derivedColumnsOf(each.name, type)) taken.add(column)
    taken.add(each.name)

    compiled.push({ declaration: each, type, expanded: expanded.expression, select: finish(each.name, type, figure), clock })
  })

  return { compiled, problems }
}

/** The problems alone, for `declarationProblems`. */
export function derivedProblems(
  declaration: Shape,
  neighbours: readonly FormatDeclaration[] = [],
  units: UnitTable = SEEDED_UNITS,
): readonly DerivedProblem[] {
  return compileDerived(declaration, neighbours, units).problems
}

/**
 * The `SELECT` behind the view: the row's id and every derived column, over
 * the format's table aliased `t`. `withStored` adds `t.*`, which is what the
 * view is; a reader asking only for the figures leaves it out.
 *
 * `undefined` when the format has no derived column, or one does not compile —
 * a declaration that was refused never reaches here, but a neighbour deleted
 * since can.
 */
export function derivedSelectSql(
  declaration: Shape,
  neighbours: readonly FormatDeclaration[],
  withStored: boolean,
  /** The asking runtime's day; without it a column reading `today` is left out, as the stored view leaves it (D-472). */
  today?: string,
): string | undefined {
  const { compiled: all, problems } = compileDerived(declaration, neighbours, SEEDED_UNITS, today)
  const compiled = today === undefined ? all.filter((each) => !each.clock) : all
  if (compiled.length === 0 || problems.length > 0) return undefined
  const columns = compiled.flatMap((each) =>
    each.select.map((one) => `${one.sql} AS ${quote(one.column)}`),
  )
  const head = withStored ? 't.*' : `t.${quote(ROW_ID_COLUMN)}`
  return `SELECT ${head}, ${columns.join(', ')} FROM ${quote(tableNameFor(declaration))} AS t`
}

/**
 * **One computed column of a row as a value SQL can sort and filter by** (M49
 * U1, D-471): the view's own SQL for it, read for the row of `outer` — the
 * table's name as the enclosing query has it. Money is its minor units, as a
 * stored money column sorts. Nothing when the name is not a computed column
 * that compiles.
 */
export function derivedValueSql(
  declaration: Shape,
  neighbours: readonly FormatDeclaration[],
  name: string,
  outer: string = tableNameFor(declaration),
  /** The asking runtime's day, for a column that reads `today` (D-472) — nothing without it. */
  today?: string,
): { readonly sql: string; readonly type: DerivedType } | undefined {
  const { compiled, problems } = compileDerived(declaration, neighbours, SEEDED_UNITS, today)
  if (problems.length > 0) return undefined
  const found = compiled.find((each) => each.declaration.name === name)
  const first = found?.select[0]
  if (found === undefined || first === undefined || (found.clock && today === undefined)) return undefined
  return {
    sql: `(SELECT ${first.sql} FROM ${quote(tableNameFor(declaration))} AS t WHERE t.${quote(ROW_ID_COLUMN)} = ${quote(outer)}.${quote(ROW_ID_COLUMN)})`,
    type: found.type,
  }
}

/**
 * The view's `CREATE`, or nothing when there is no view to have. **A column
 * that reads `today` is not in it** (D-472): the file holds no figure that
 * changes overnight, and whoever reads the view reads what can be proved.
 */
export function createDerivedViewSql(
  declaration: Shape,
  neighbours: readonly FormatDeclaration[],
): string | undefined {
  const select = derivedSelectSql(declaration, neighbours, true)
  return select === undefined ? undefined : `CREATE VIEW ${quote(derivedViewNameFor(declaration))} AS ${select}`
}

/* --------------------------------------------------------------- expansion */

/**
 * The expression of one derived column with every other derived column it
 * names written in place — so the compiler, the type and the TypeScript
 * evaluator all see one tree of columns and literals.
 */
function expand(
  name: string,
  declaration: Shape,
  stack: readonly string[],
): { readonly expression: Expression } | { readonly problem: string } {
  if (stack.includes(name)) {
    return { problem: `it is computed from itself — ${[...stack, name].join(' → ')}. A cycle has no first figure.` }
  }
  const own = (declaration.derived ?? []).find((each) => each.name === name)
  if (own === undefined) return { problem: `names ${name}, and this format has no such column.` }
  const parsed = parseExpression(own.expression)
  if ('problem' in parsed) {
    return stack.length === 0 ? { problem: parsed.problem } : { problem: `${name} does not read: ${parsed.problem}` }
  }

  let problem: string | undefined
  const walk = (expression: Expression): Expression => {
    if (problem !== undefined) return expression
    switch (expression.kind) {
      case 'NUMBER':
      case 'DAYS':
        return expression
      case 'COLUMN': {
        const isDerived = (declaration.derived ?? []).some((each) => each.name === expression.name)
        if (!isDerived) return expression
        const inner = expand(expression.name, declaration, [...stack, name])
        if ('problem' in inner) {
          problem = inner.problem
          return expression
        }
        return inner.expression
      }
      case 'NEGATE':
        return { kind: 'NEGATE', of: walk(expression.of) }
      case 'IN':
        return { ...expression, of: walk(expression.of) }
      default:
        return { kind: expression.kind, left: walk(expression.left), right: walk(expression.right) }
    }
  }
  const expression = walk(parsed)
  return problem === undefined ? { expression } : { problem }
}

/* ------------------------------------------------------------ compilation */

/**
 * A figure as SQL: **`n / d`**, carried apart so that the one division happens
 * at the end and money is rounded once. `d` is a whole number the compiler
 * knows, or SQL once something divides by a column.
 */
interface Figure {
  readonly n: string
  readonly d: bigint | string
  /** Every leaf a whole number and no conversion — the rounding can be integer arithmetic. */
  readonly exact: boolean
  /** The SQL of the currency, when this is money. */
  readonly currency: string | undefined
  readonly unit: Unit
  /** Whether any column or aggregate is named at all. */
  readonly names: boolean
}

type Unit =
  | { readonly kind: 'UNIT'; readonly unit: string }
  | { readonly kind: 'NONE' }
  | { readonly kind: 'MIXED' }
  /** A quantity: the row says, in this SQL. */
  | { readonly kind: 'ROW'; readonly sql: string }

const NONE: Unit = { kind: 'NONE' }
const MIXED: Unit = { kind: 'MIXED' }

interface Scope {
  readonly self: Shape
  readonly neighbours: readonly FormatDeclaration[]
  readonly units: UnitTable
  /** The alias of the row being read — `t`, or `s` inside an aggregate. */
  readonly alias: string
  /** Whether a name may be an aggregate — not inside one. */
  readonly aggregates: boolean
  /** `YYYY-MM-DD`: what `today` is (D-472). Absent, it is `NULL`, and only a check reads the SQL. */
  readonly today?: string | undefined
}

/** Past this a denominator is written as a float, before SQLite's integers overflow. */
const LARGEST_EXACT = 10n ** 15n

/**
 * A computed column that is **a date moved by whole days** (D-471), as SQL —
 * `date(d, '+7 days')`, whose empty or malformed date is `NULL` — or nothing
 * when the expression is not a point, so the figures go on. A point that is
 * not a date, moved, is refused; unmoved it is the lone point it always was.
 */
function dateSql(
  expression: Expression,
  scope: Scope,
): { readonly sql: string } | { readonly problem: string } | undefined {
  const point = shiftedPoint(expression)
  if (point === undefined) return undefined
  if (point.name === TODAY) {
    return { problem: `is ${TODAY}${point.moved ? ' moved' : ''}, the same date on every row. Move a date of the row — \`due - 3 days\` — or count the days to one: \`due - today\`.` }
  }
  const resolved = resolveName(point.name, scope.self, scope.neighbours)
  if ('problem' in resolved || !isPointType(resolved.column.type)) return undefined
  const type = resolved.column.type
  if (type !== 'date') {
    return { problem: point.moved ? movedPointProblem(point.name, type) : lonePointProblem(point.name, type) }
  }
  const cell = reader(point.name, scope)(resolved.column.name)
  // The modifier is the engine's own digits, never a person's text.
  const modifier = `${point.days < 0 ? '' : '+'}${String(point.days)} days`
  return { sql: `date(${cell}, ${literalText(modifier)})` }
}

function compile(expression: Expression, scope: Scope): Figure | { readonly problem: string } {
  switch (expression.kind) {
    case 'NUMBER':
      return literal(expression.value)
    case 'DAYS':
      // A count of days on its own is a figure in days (D-471).
      return { n: String(expression.days), d: 1n, exact: true, currency: undefined, unit: { kind: 'UNIT', unit: 'day' }, names: false }
    case 'COLUMN':
      return leaf(expression.name, scope)
    case 'NEGATE': {
      const of = compile(expression.of, scope)
      if ('problem' in of) return of
      if (of.unit.kind === 'ROW') return rowProblem()
      return { ...of, n: `(-${of.n})` }
    }
    case 'IN': {
      if (expression.via !== undefined) {
        return {
          problem: `\`via\` converts across a dimension, which a computed column does not do yet. Convert inside one dimension, or write it as a claim.`,
        }
      }
      const of = compile(expression.of, scope)
      if ('problem' in of) return of
      return convertInto(of, expression.unit, scope.units)
    }
    default: {
      const span = spanFigure(expression, scope)
      if (span !== undefined) return span
      const left = compile(expression.left, scope)
      if ('problem' in left) return left
      const right = compile(expression.right, scope)
      if ('problem' in right) return right
      return combine(expression.kind, left, right)
    }
  }
}

function literal(value: number): Figure {
  const matched = /^(\d+)(?:\.(\d+))?$/.exec(String(value))
  if (matched === null) {
    return { n: String(value), d: 1n, exact: false, currency: undefined, unit: NONE, names: false }
  }
  const places = matched[2] ?? ''
  const digits = `${matched[1] ?? '0'}${places}`.replace(/^0+(?=\d)/, '')
  return { n: digits, d: 10n ** BigInt(places.length), exact: true, currency: undefined, unit: NONE, names: false }
}

function rowProblem(): { readonly problem: string } {
  return {
    problem: `a quantity's unit is different on every row, so it has to be converted before anything is done with it — \`amount in g\`.`,
  }
}

/** A name: an aggregate of this format, a column of it, or one hop through a link. */
function leaf(name: string, scope: Scope): Figure | { readonly problem: string } {
  if (name === TODAY) return { problem: lonePointProblem(TODAY, 'date') }
  if (scope.aggregates && !name.includes('.')) {
    const folded = scope.self.aggregates.find((each) => each.name === name)
    if (folded !== undefined) return aggregateFigure(folded, scope)
  }
  if (!scope.aggregates && !name.includes('.')) {
    // Inside a total, over the rows it gathers (M29 F7).
    if (scope.self.aggregates.some((each) => each.name === name)) {
      return { problem: `folds ${name}, which is a total of ${scope.self.name} itself, and a total here does not fold another one.` }
    }
    if ((scope.self.derived ?? []).some((each) => each.name === name)) return workedFigure(name, scope)
  }
  const resolved = resolveName(name, scope.self, scope.neighbours)
  if ('problem' in resolved) return { problem: resolved.problem }
  const column = resolved.column
  if (isPointType(column.type)) return { problem: lonePointProblem(name, column.type) }
  if (!isIdentityType(column)) {
    return {
      problem: `does arithmetic on ${name}, which is a ${column.type}. Only integer, real, decimal, percent, money and quantity columns hold numbers.`,
    }
  }
  return columnFigure(column, reader(name, scope))
}

/**
 * A derived column of the rows a total gathers, **as each row shows it** (M29
 * F7): money rounded to whole minor units per row, as the view rounds it
 * (D-333), so the total is the sum of what the rows display and not a
 * figure a fraction of an agora away from it.
 */
function workedFigure(name: string, scope: Scope): Figure | { readonly problem: string } {
  const expanded = expand(name, scope.self, [])
  if ('problem' in expanded) return { problem: expanded.problem }
  const figure = compile(expanded.expression, scope)
  if ('problem' in figure) return figure
  if (figure.unit.kind === 'ROW') return rowProblem()
  if (figure.currency !== undefined) {
    const minor = rounded(figure.n, String(figure.d), figure.exact)
    return {
      n: minor,
      d: 1n,
      exact: true,
      currency: `(CASE WHEN ${minor} IS NULL THEN NULL ELSE ${figure.currency} END)`,
      unit: NONE,
      names: true,
    }
  }
  return {
    n: figure.d === 1n ? figure.n : `(${figure.n} * 1.0 / ${String(figure.d)})`,
    d: 1n,
    exact: figure.exact && figure.d === 1n,
    currency: undefined,
    unit: figure.unit.kind === 'UNIT' ? figure.unit : NONE,
    names: true,
  }
}

/** How a name's stored cell is read: off the row, or one hop through its link. */
function reader(name: string, scope: Scope): (stored: string) => string {
  const parts = name.split('.')
  return (stored) => {
    if (parts.length === 1) return `${scope.alias}.${quote(stored)}`
    const link = scope.self.columns.find((each) => each.name === parts[0])
    const target =
      link?.target === scope.self.name
        ? scope.self
        : scope.neighbours.find((each) => each.name === link?.target)
    return `(SELECT h.${quote(stored)} FROM ${quote(tableNameFor(target ?? { name: link?.target ?? '' }))} AS h WHERE h.${quote(ROW_ID_COLUMN)} = ${scope.alias}.${quote(link?.name ?? '')})`
  }
}

/**
 * `end - start` over two points, as SQL (M29 U4, D-335) — or nothing when the
 * expression is not two columns of which one is a point. A whole number over
 * the denominator that makes it hours or days, so the division is the last
 * step, as for every other figure here.
 *
 * - two **times**: minutes past midnight from the `HH:MM` text, the difference
 *   wrapped into one day — `((e - s) % 1440 + 1440) % 1440`, since SQLite's
 *   `%` keeps the sign of what it divides — over 60;
 * - two **dates**: whole days by `julianday`, over 1;
 * - two **instants**: whole milliseconds by `julianday`, over 3 600 000.
 */
function spanFigure(expression: Expression, scope: Scope): Figure | { readonly problem: string } | undefined {
  const pair = spanPair(expression)
  if (pair === undefined) return undefined
  const end = pointNamed(pair.end, scope)
  const start = pointNamed(pair.start, scope)
  if (end === undefined || start === undefined) return undefined
  const type = end.type
  if (!isPointType(type) && !isPointType(start.type)) return undefined
  if (!isPointType(type) || type !== start.type) {
    return { problem: mixedSpanProblem(pair.end, pair.start, type, start.type) }
  }
  if (pair.moved && type !== 'date') return { problem: movedPointProblem(pair.end, type) }
  const e = end.sql
  const s = start.sql
  const span = (n: string, d: bigint): Figure => ({
    n,
    d,
    exact: true,
    currency: undefined,
    unit: { kind: 'UNIT', unit: SPAN_UNITS[type satisfies PointType] },
    names: true,
  })
  switch (type) {
    case 'time': {
      const minutes = (at: string): string =>
        `(CAST(substr(${at}, 1, 2) AS INTEGER) * 60 + CAST(substr(${at}, 4, 2) AS INTEGER))`
      return span(`((((${minutes(e)} - ${minutes(s)}) % 1440) + 1440) % 1440)`, 60n)
    }
    case 'date':
      // Either end moved by whole days (D-471) adds the days between the moves.
      return span(
        `(CAST(round(julianday(${e}) - julianday(${s})) AS INTEGER)${pair.days === 0 ? '' : ` + ${String(pair.days)}`})`,
        1n,
      )
    case 'instant':
      return span(`CAST(round((julianday(${e}) - julianday(${s})) * 86400000) AS INTEGER)`, 3_600_000n)
  }
}

/**
 * One end of a span: a column of the row or one hop away, as its type and the
 * SQL reading it — or `today`, a date, as the asking runtime's day (D-472).
 */
function pointNamed(name: string, scope: Scope): { readonly type: string; readonly sql: string } | undefined {
  if (name === TODAY) return { type: 'date', sql: scope.today === undefined ? 'NULL' : literalText(scope.today) }
  const resolved = resolveName(name, scope.self, scope.neighbours)
  if ('problem' in resolved) return undefined
  return { type: resolved.column.type, sql: reader(name, scope)(resolved.column.name) }
}

function columnFigure(column: ColumnDeclaration, read: (stored: string) => string): Figure {
  const declared: Unit = column.unit === undefined ? NONE : { kind: 'UNIT', unit: column.unit }
  switch (column.type) {
    case 'money': {
      const names = moneyColumnNames(column)
      return { n: read(names.minor), d: 1n, exact: true, currency: read(names.currency), unit: NONE, names: true }
    }
    case 'quantity': {
      const names = quantityColumnNames(column)
      return {
        n: read(names.amount),
        d: 1n,
        exact: false,
        currency: undefined,
        unit: { kind: 'ROW', sql: read(names.unit) },
        names: true,
      }
    }
    case 'decimal':
      return { n: read(column.name), d: 10n ** BigInt(column.scale ?? 0), exact: true, currency: undefined, unit: declared, names: true }
    case 'percent':
      return { n: read(column.name), d: BigInt(PERCENT_DENOMINATOR), exact: true, currency: undefined, unit: NONE, names: true }
    case 'real':
      return { n: read(column.name), d: 1n, exact: false, currency: undefined, unit: declared, names: true }
    default:
      return { n: read(column.name), d: 1n, exact: true, currency: undefined, unit: declared, names: true }
  }
}

function combine(
  kind: 'ADD' | 'SUBTRACT' | 'MULTIPLY' | 'DIVIDE',
  left: Figure,
  right: Figure,
): Figure | { readonly problem: string } {
  if (left.unit.kind === 'ROW' || right.unit.kind === 'ROW') return rowProblem()
  const exact = left.exact && right.exact
  const names = left.names || right.names
  const lm = left.currency !== undefined
  const rm = right.currency !== undefined

  // Two currencies meeting is a row's question, and on a row that has two the
  // figure is empty rather than a sum of shekels and dollars.
  const agree =
    lm && rm
      ? `(${left.currency} IS NULL OR ${right.currency} IS NULL OR ${left.currency} = ${right.currency})`
      : undefined
  const guarded = (n: string): string => (agree === undefined ? n : `(CASE WHEN ${agree} THEN ${n} END)`)
  const either = lm && rm ? `COALESCE(${left.currency}, ${right.currency})` : (left.currency ?? right.currency)

  if (kind === 'ADD' || kind === 'SUBTRACT') {
    if (lm !== rm) {
      return {
        problem: `${kind === 'ADD' ? 'adds' : 'subtracts'} a bare number ${kind === 'ADD' ? 'to' : 'from'} money. Money only meets money in a sum — multiply a figure by a price instead.`,
      }
    }
    const sign = kind === 'ADD' ? '+' : '-'
    const n =
      typeof left.d === 'bigint' && typeof right.d === 'bigint' && left.d === right.d
        ? `(${left.n} ${sign} ${right.n})`
        : `(${times(left.n, right.d)} ${sign} ${times(right.n, left.d)})`
    const d = left.d === right.d ? left.d : product(left.d, right.d)
    return settle({ n: guarded(n), d, exact, currency: either, unit: sumUnit(left.unit, right.unit), names })
  }

  if (kind === 'MULTIPLY') {
    if (lm && rm) return { problem: 'multiplies money by money, which is not an amount of anything.' }
    return settle({
      n: `(${left.n} * ${right.n})`,
      d: product(left.d, right.d),
      exact,
      currency: either,
      unit: productUnit(left.unit, right.unit),
      names,
    })
  }

  // DIVIDE
  if (rm && !lm) return { problem: 'divides a bare number by money, which is not an amount of anything.' }
  return settle({
    n: guarded(times(left.n, right.d)),
    d: product(left.d, right.n),
    exact,
    // Money over a figure is money; money over money is a ratio.
    currency: lm && !rm ? left.currency : undefined,
    unit: right.unit.kind === 'NONE' ? left.unit : MIXED,
    names,
  })
}

function sumUnit(left: Unit, right: Unit): Unit {
  if (left.kind === 'NONE') return right
  if (right.kind === 'NONE') return left
  if (left.kind === 'UNIT' && right.kind === 'UNIT' && left.unit === right.unit) return left
  return MIXED
}

function productUnit(left: Unit, right: Unit): Unit {
  if (left.kind === 'NONE') return right
  return right.kind === 'NONE' ? left : MIXED
}

/** `n × d` with the multiplication by one left out. */
function times(n: string, d: bigint | string): string {
  return d === 1n ? n : `(${n} * ${String(d)})`
}

function product(a: bigint | string, b: bigint | string): bigint | string {
  if (typeof a === 'bigint' && typeof b === 'bigint') return a * b
  if (a === 1n) return b
  if (b === 1n) return a
  return `(${String(a)} * ${String(b)})`
}

/** A denominator too large to stay an integer is divided out, and the figure stops being exact. */
function settle(figure: Figure): Figure {
  if (typeof figure.d === 'bigint' && figure.d > LARGEST_EXACT) {
    return { ...figure, n: `(${figure.n} * 1.0 / ${String(figure.d)})`, d: 1n, exact: false }
  }
  return figure
}

/** `x in g`: the factor read from the document's units table, so editing a unit moves every figure. */
function convertInto(of: Figure, into: string, units: UnitTable): Figure | { readonly problem: string } {
  if (of.currency !== undefined) return { problem: `converts money into ${into}. Money has a currency, not a unit.` }
  if (unitNamed(units, into) === undefined) {
    return { problem: `${into} is not a unit this document knows. Add it, or convert into one it has.` }
  }
  const base = (symbol: string): string =>
    `(SELECT u.per_base FROM measurement_unit AS u WHERE u.symbol = ${symbol})`
  const dimension = (symbol: string): string =>
    `(SELECT u.dimension FROM measurement_unit AS u WHERE u.symbol = ${symbol})`
  const target = literalText(into)

  if (of.unit.kind === 'ROW') {
    const from = of.unit.sql
    const factor = `(CASE WHEN ${dimension(from)} = ${dimension(target)} THEN ${base(from)} / ${base(target)} END)`
    return { ...of, n: `(${of.n} * ${factor})`, exact: false, unit: { kind: 'UNIT', unit: into } }
  }
  if (of.unit.kind !== 'UNIT') {
    return {
      problem:
        of.unit.kind === 'NONE'
          ? `nothing on the left of \`in ${into}\` has a unit, so there is nothing to convert.`
          : `what is on the left of \`in ${into}\` mixes units, so nothing says what to convert from. Convert each part first.`,
    }
  }
  const from = of.unit.unit
  const source = dimensionOf(units, from)
  const destination = dimensionOf(units, into)
  if (source === undefined) {
    return { problem: `the figure on the left of \`in ${into}\` is in ${from}, which is not a unit this document knows.` }
  }
  if (source !== destination) {
    return {
      problem: `${from} and ${into} measure two different things, and a computed column converts inside one. A factor between them is a column of this format.`,
    }
  }
  const factor = `(${base(literalText(from))} / ${base(target)})`
  return { ...of, n: `(${of.n} * ${factor})`, exact: false, unit: { kind: 'UNIT', unit: into } }
}

/* ------------------------------------------------------------- aggregates */

/**
 * An aggregate of this format, as a correlated subquery over the rows that
 * point here — the same fold `aggregate.ts` makes, in SQL. Empty in whole if a
 * covered row cannot answer, or its filter column is empty; a sum of no rows
 * is 0, and the other folds of no rows are empty.
 */
function aggregateFigure(folded: AggregateDeclaration, scope: Scope): Figure | { readonly problem: string } {
  const source: FormatDeclaration | Shape | undefined =
    folded.over.format === scope.self.name
      ? scope.self
      : scope.neighbours.find((each) => each.name === folded.over.format)
  if (source === undefined) return { problem: `names ${folded.name}, which gathers rows of ${folded.over.format}, and this document has no such format.` }
  const over = folded.over.column
  const link = over === undefined ? undefined : source.columns.find((each) => each.name === over)
  if (over !== undefined && (link === undefined || !isLinkType(link.type))) {
    return { problem: `names ${folded.name}, and ${folded.over.format} has no link called ${over}.` }
  }

  const table = quote(tableNameFor(source))
  const outer = `${scope.alias}.${quote(ROW_ID_COLUMN)}`
  // Every row of the source names no link (M34 U4, D-397): the same fold
  // over the whole table, still a subquery the pick can add to.
  const from =
    over === undefined || link === undefined
      ? `FROM ${table} AS s WHERE 1`
      : link.type === 'links'
        ? `FROM ${table} AS s WHERE s.${quote(ROW_ID_COLUMN)} IN (SELECT m.${quote(MEMBER_COLUMNS.row)} FROM ${quote(memberTableNameFor(source, link))} AS m WHERE m.${quote(MEMBER_COLUMNS.member)} = ${outer})`
        : `FROM ${table} AS s WHERE s.${quote(over)} = ${outer}`

  // Which rows are taken, and whether any of them cannot say.
  let take = '1'
  let unknownFilter: string | undefined
  if (folded.where !== undefined) {
    const inner: Scope = { self: source, neighbours: scope.neighbours, units: scope.units, alias: 's', aggregates: false }
    const filter = filterSql(folded.where, inner)
    if ('problem' in filter) return { problem: `names ${folded.name}, whose filter ${filter.problem}` }
    // `is not` takes an empty cell and an empty test decides one; only D-260's
    // `is` and `is one of` leave it undecided, and the fold with it (M36 U04).
    take = filterConditionSql(filter.sql, folded.where, filter.members, false)
    if (folded.where.not !== true && !isEmptyTest(folded.where)) unknownFilter = `COUNT(*) <> COUNT(${filter.sql})`
  }
  const matching =
    folded.where === undefined ? 'COUNT(*)' : `COALESCE(SUM(CASE WHEN ${take} THEN 1 ELSE 0 END), 0)`
  const only = (sql: string): string => (folded.where === undefined ? sql : `CASE WHEN ${take} THEN ${sql} END`)
  const unit: Unit = folded.unit === undefined ? NONE : { kind: 'UNIT', unit: folded.unit }

  if (folded.kind === 'COUNT') {
    const n = unknownFilter === undefined ? matching : `CASE WHEN ${unknownFilter} THEN NULL ELSE ${matching} END`
    return { n: `(SELECT ${n} ${from})`, d: 1n, exact: true, currency: undefined, unit: NONE, names: true }
  }

  const parsed = parseExpression(folded.expression)
  if ('problem' in parsed) return { problem: `names ${folded.name}, which does not read: ${parsed.problem}` }
  const inner: Scope = { self: source, neighbours: scope.neighbours, units: scope.units, alias: 's', aggregates: false }
  const each = compile(parsed, inner)
  if ('problem' in each) return { problem: `names ${folded.name}, which ${each.problem}` }
  if (each.unit.kind === 'ROW') return { problem: `names ${folded.name}, which ${rowProblem().problem}` }

  // A row's figure as one value, over a denominator every row shares.
  const constant = typeof each.d === 'bigint'
  const value = constant ? each.n : `(${each.n} * 1.0 / ${String(each.d)})`
  const d = constant ? each.d : 1n

  if (folded.kind === 'LATEST' || folded.kind === 'EARLIEST') {
    return pickFigure(folded, source, { from, take, unknownFilter, value, d, exact: each.exact && constant, currency: each.currency, unit })
  }
  const exact = each.exact && constant && folded.kind !== 'AVERAGE'

  const guards = [
    ...(unknownFilter === undefined ? [] : [unknownFilter]),
    `${matching} <> COUNT(${only(value)})`,
    ...(each.currency === undefined ? [] : [`COUNT(DISTINCT ${only(each.currency)}) > 1`]),
  ]
  const fold =
    folded.kind === 'SUM'
      ? `SUM(${only(value)})`
      : folded.kind === 'AVERAGE'
        ? `AVG(${only(value)})`
        : folded.kind === 'MINIMUM'
          ? `MIN(${only(value)})`
          : `MAX(${only(value)})`
  const none = folded.kind === 'SUM' ? '0' : 'NULL'
  const n = `(SELECT CASE WHEN ${guards.join(' OR ')} THEN NULL WHEN ${matching} = 0 THEN ${none} ELSE ${fold} END ${from})`
  const currency =
    each.currency === undefined
      ? undefined
      : `(SELECT CASE WHEN COUNT(DISTINCT ${only(each.currency)}) = 1 THEN MIN(${only(each.currency)}) END ${from})`
  return { n, d, exact, currency, unit, names: true }
}

/**
 * **`latest` and `earliest`: the one row with the greatest (least) order, and
 * its figure** (M36 U05) — `aggregate.ts`'s `pick` in SQL, a correlated
 * `ORDER BY … LIMIT 1`. Empty, as the pick is `unchecked`, when no row points
 * here, when a row the filter takes has nothing in the order column (it might
 * be the one), when two rows tie at the top (picking one would be a guess), or
 * when the filter cannot decide a row. Only the picked row has to answer.
 */
function pickFigure(
  folded: AggregateDeclaration,
  source: Shape,
  parts: {
    readonly from: string
    readonly take: string
    readonly unknownFilter: string | undefined
    readonly value: string
    readonly d: bigint | string
    readonly exact: boolean
    readonly currency: string | undefined
    readonly unit: Unit
  },
): Figure | { readonly problem: string } {
  const by = source.columns.find((each) => each.name === folded.by)
  if (by === undefined) {
    return { problem: `names ${folded.name}, which picks by ${folded.by ?? 'nothing'}, and ${source.name} has no such column.` }
  }
  const order = `s.${quote(storedColumnsOf(by)[0] ?? by.name)}`
  const direction = folded.kind === 'LATEST' ? 'DESC' : 'ASC'
  const taken = `${parts.from} AND (${parts.take})`
  const first = (sql: string): string => `(SELECT ${sql} ${taken} ORDER BY ${order} ${direction} LIMIT 1)`
  const guards = [
    ...(parts.unknownFilter === undefined ? [] : [`(SELECT ${parts.unknownFilter} ${parts.from})`]),
    `(SELECT COUNT(*) ${taken} AND ${order} IS NULL) > 0`,
    `(SELECT ${order} ${taken} ORDER BY ${order} ${direction} LIMIT 1 OFFSET 1) = ${first(order)}`,
  ]
  const guarded = (sql: string): string => `(CASE WHEN ${guards.join(' OR ')} THEN NULL ELSE ${first(sql)} END)`
  return {
    n: guarded(parts.value),
    d: parts.d,
    exact: parts.exact,
    currency: parts.currency === undefined ? undefined : guarded(parts.currency),
    unit: parts.unit,
    names: true,
  }
}

function filterSql(
  filter: AggregateFilter,
  scope: Scope,
): { readonly sql: string; readonly members: readonly string[] } | { readonly problem: string } {
  const name = filter.column
  const resolved = resolveName(name, scope.self, scope.neighbours)
  if ('problem' in resolved) return { problem: resolved.problem }
  const column = resolved.column
  if (isEmptyTest(filter) ? isListType(column.type) : column.type !== 'enum' && column.type !== 'boolean') {
    return { problem: `reads ${name}, which is not an enum or a boolean.` }
  }
  // What is empty of a money column is its figure (M36 U04).
  const stored = quote(storedColumnsOf(column)[0] ?? column.name)
  const parts = name.split('.')
  let sql = `${scope.alias}.${stored}`
  if (parts.length === 2) {
    const link = scope.self.columns.find((each) => each.name === parts[0])
    const target = link?.target ?? ''
    sql = `(SELECT h.${stored} FROM ${quote(tableNameFor({ name: target }))} AS h WHERE h.${quote(ROW_ID_COLUMN)} = ${scope.alias}.${quote(parts[0] ?? '')})`
  }
  const members = filterMembers(filter).map((member) =>
    column.type === 'boolean' ? (member === 'true' ? '1' : '0') : literalText(member),
  )
  return { sql, members }
}

/* ----------------------------------------------------------------- output */

/** The view columns of one derived figure: a number, or money's two. */
function finish(
  name: string,
  type: DerivedType,
  figure: Figure,
): readonly { readonly column: string; readonly sql: string }[] {
  const d = String(figure.d)
  if (type.kind !== 'MONEY') {
    const sql = figure.d === 1n ? figure.n : `(${figure.n} * 1.0 / ${d})`
    return [{ column: name, sql }]
  }
  const names = moneyColumnNames({ name })
  const minor = rounded(figure.n, d, figure.exact)
  return [
    { column: names.minor, sql: minor },
    { column: names.currency, sql: `(CASE WHEN ${minor} IS NULL THEN NULL ELSE ${figure.currency ?? 'NULL'} END)` },
  ]
}

/**
 * `n / d` to whole minor units, halves away from zero (D-333).
 *
 * Exact: integer arithmetic, `(2|n| + |d|) / 2|d|` with SQLite's truncating
 * division and the sign put back. Otherwise the float, rounded by `round()`,
 * which SQLite rounds half away from zero too. Division by zero is `NULL`.
 */
function rounded(n: string, d: string, exact: boolean): string {
  if (exact) {
    const whole = `((2 * abs(${n}) + abs(${d})) / (2 * abs(${d})))`
    return `(CASE WHEN ${n} IS NULL OR ${d} IS NULL OR ${d} = 0 THEN NULL WHEN (${n} < 0) = (${d} < 0) THEN ${whole} ELSE -${whole} END)`
  }
  const x = `(${n} * 1.0 / ${d})`
  return `(CASE WHEN ${x} IS NULL THEN NULL WHEN ${x} < 0 THEN -CAST(round(-${x}) AS INTEGER) ELSE CAST(round(${x}) AS INTEGER) END)`
}

/* --------------------------------------------------------- in TypeScript */

/** A derived figure worked out in TypeScript, or why the cell is empty. */
export type DerivedValue =
  | { readonly kind: 'NUMBER'; readonly value: number; readonly unit: string | undefined }
  | { readonly kind: 'MONEY'; readonly minor: number; readonly currency: string | undefined }
  /** A computed date (D-471), `YYYY-MM-DD`. */
  | { readonly kind: 'DATE'; readonly date: string }
  | { readonly kind: 'EMPTY'; readonly reason: string }

/**
 * The same figure the view computes, by the identity evaluator — for the
 * sentence an empty cell shows, and for the test that holds the two to one
 * answer. `inputs` are a row's, with its hops and aggregates folded in.
 */
export function evaluateDerived(
  compiled: Pick<CompiledDerived, 'type' | 'expanded'>,
  given: IdentityInputs,
  units: UnitTable = SEEDED_UNITS,
  /** The asking runtime's day, for `today` (D-472). */
  today?: string,
): DerivedValue {
  const day = today === undefined ? undefined : pointOrdinal('date', today)
  const inputs: IdentityInputs =
    day === undefined ? given : { ...given, points: new Map([...(given.points ?? []), [TODAY, { type: 'date', ordinal: day }]]) }
  const missing = firstMissing(compiled.expanded, inputs)
  if (missing !== undefined) return { kind: 'EMPTY', reason: `${missing} is empty here.` }
  if (compiled.type.kind === 'DATE') {
    const point = shiftedPoint(compiled.expanded)
    const at = point === undefined ? undefined : inputs.points?.get(point.name)
    if (point === undefined || at === undefined || at.type !== 'date') {
      return { kind: 'EMPTY', reason: 'There is no date here to move.' }
    }
    return { kind: 'DATE', date: dateOfOrdinal(at.ordinal + point.days) }
  }
  const value = evaluateExpression(compiled.expanded, inputs, units)
  if (value.kind === 'UNKNOWN') return { kind: 'EMPTY', reason: value.reason }
  if (compiled.type.kind === 'MONEY') {
    const whole = toWhole(value)
    return { kind: 'MONEY', minor: whole.value, currency: value.currency }
  }
  return { kind: 'NUMBER', value: value.value, unit: compiled.type.unit }
}

/**
 * A row's inputs with its worked-out figures beside its stored ones (M29 F7):
 * what a total over this format folds when it names a derived column.
 *
 * **The figure as the row shows it** — money already whole minor units with
 * its currency, a figure with its unit — so a total of `earned` is the sum of
 * what the rows display, to the agora (D-333). An empty cell puts no key, and
 * the fold names the row that could not answer.
 */
export function inputsWithDerived(
  inputs: IdentityInputs,
  values: readonly { readonly name: string; readonly value: DerivedValue }[],
): IdentityInputs {
  if (values.length === 0) return inputs
  const numbers = new Map(inputs.numbers)
  const currencies = new Map(inputs.currencies)
  const units = new Map(inputs.units ?? [])
  const points = new Map(inputs.points ?? [])
  for (const { name, value } of values) {
    if (value.kind === 'DATE') {
      const ordinal = pointOrdinal('date', value.date)
      if (ordinal !== undefined) points.set(name, { type: 'date', ordinal })
    } else if (value.kind === 'MONEY') {
      numbers.set(name, value.minor)
      if (value.currency !== undefined) currencies.set(name, value.currency)
    } else if (value.kind === 'NUMBER') {
      numbers.set(name, value.value)
      if (value.unit !== undefined) units.set(name, value.unit)
    }
  }
  return { ...inputs, numbers, currencies, units, points }
}

/** The first name the expression reads that this row has nothing in. */
export function firstMissing(expression: Expression, inputs: IdentityInputs): string | undefined {
  switch (expression.kind) {
    case 'NUMBER':
    case 'DAYS':
      return undefined
    case 'COLUMN':
      return inputs.numbers.has(expression.name) || inputs.points?.has(expression.name) === true
        ? undefined
        : expression.name
    case 'NEGATE':
    case 'IN':
      return firstMissing(expression.of, inputs)
    default:
      return firstMissing(expression.left, inputs) ?? firstMissing(expression.right, inputs)
  }
}

