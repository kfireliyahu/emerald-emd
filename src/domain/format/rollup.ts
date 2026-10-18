/**
 * **A rollup by a period** (M25 E2, D-267, D-271).
 *
 * *The sum of `amount` of `transaction`, by month and `category`, where
 * `direction` is `OUTFLOW`.* A pivot: a figure keyed by a month and, if the
 * sentence says so, by one link. The month views, the statistics, a year's
 * summary and M27's units per milestone are all this one shape, and every pack
 * after the ledger would otherwise write it again in TypeScript.
 *
 * ## One sentence, and nothing it could grow into
 *
 * `sum of amount by month of charge_date or transaction_date and category
 * where direction is OUTFLOW and is_excluded_from_stats is false`
 *
 * - **a kind** — the five an aggregate already has (`aggregate.ts`), and
 *   `count` takes no column;
 * - **one column** to fold — an integer, real, decimal or money column of this
 *   format, by name. Not an expression: a rollup is compiled to one `GROUP BY`,
 *   and an expression language compiled to SQL is the query language D-095 and
 *   D-209 refuse;
 * - **one period** — a `month` column, or `month of` a `date` column, and at
 *   most one fallback after `or` for a row that has none (the ledger's D-006
 *   basis: the charge date, else the transaction date). An `instant` is not a
 *   period here: which month a moment falls in depends on a time zone, and the
 *   document does not hold one;
 * - **at most one link** to group by, after `and`;
 * - **filters**, each D-260's — one column of the row, or one hop through its
 *   link: `is` a member, and since M36 U04 `is not`, `is one of`, `is empty`
 *   (D-380) — joined by `and` and never by `or`.
 *
 * ## Compiled to SQL, never folded here
 *
 * Sixty thousand transactions are not folded in TypeScript (D-267). `ddl.ts`
 * compiles the sentence to one `GROUP BY` over the period, the link and — for
 * money — the currency; this file only reads the few hundred groups back. A
 * money figure is summed per currency and never across two, and it stays minor
 * units: *money is never a number*, so `average` of money is refused rather
 * than rounded.
 *
 * ## A group that cannot answer says so, and only that group
 *
 * The aggregate's rule (D-224, D-138), one level down: a row with nothing in
 * the folded column, or nothing in a column a filter reads, makes **its own
 * group** `unchecked`, naming the row — a month's total that skipped a line is
 * a smaller number and not a truer one. The other months are still true, and
 * saying so is the reason this is per group rather than per rollup.
 *
 * Computed on read and never stored, as every figure here is (D-222).
 *
 * This file imports nothing from `declaration.ts` at run time, so that file can
 * judge a rollup without a cycle; the checks against the columns are
 * `rollupRejection` there, and the SQL is `rollupQuerySql` in `ddl.ts`.
 */

import { err, ok, type Result } from '@/core/result.ts'

import {
  FOLD_KINDS,
  filterText,
  parseFilter,
  splitFilters,
  word,
  type AggregateFilter,
  type FoldKind,
} from './aggregate.ts'

/** The month a row belongs to, and where it comes from. */
export interface RollupPeriod {
  /** `billing_period`, or with `truncate` a date column — `charge_date`. */
  readonly column: string
  /** The column read when the first is empty — `transaction_date`. */
  readonly fallback?: string | undefined
  /** `month of`: the columns are dates and the month is their first seven characters. */
  readonly truncate: boolean
}

/** One declared rollup. */
export interface RollupDeclaration {
  /** `snake_case`, unique among this format's columns, aggregates and rollups. */
  readonly name: string
  readonly kind: FoldKind
  /** The column folded. Empty for `COUNT`, which asks about rows. */
  readonly of: string
  readonly period: RollupPeriod
  /** A link column of this format to group by as well — `category`. */
  readonly by?: string | undefined
  /** Only the rows every one of these takes (D-260's filter, `and`-ed). */
  readonly where: readonly AggregateFilter[]
  /** Why it is worth declaring, in the person's words. Prose, never parsed. */
  readonly note: string
}

/* ------------------------------------------------------------ the sentence */

const SENTENCE = /^(\w+)(?: of (\w+))? by (.+?)(?: where (.+))?$/
const BY = /^(month of )?(\w+)(?: or (\w+))?(?: and (\w+))?$/

const EXAMPLE = '`sum of amount by month of transaction_date and category where direction is OUTFLOW`'

/**
 * `sum of amount by billing_period and category where direction is OUTFLOW` —
 * the one spelling a rollup has, in the artefact's cell, the stored row and a
 * tool's `works_out` alike.
 *
 * Only the shape is read here; whether the columns exist and are the right
 * types is `rollupRejection`'s, which has the declaration.
 */
export function parseRollup(name: string, text: string, note = ''): Result<RollupDeclaration, string> {
  const sentence = text.trim().replace(/\s+/g, ' ')
  const matched = SENTENCE.exec(sentence)
  if (matched === null) {
    return err(
      `"${sentence}" is not a rollup. Write a kind, the column it folds, the month and at most one link — ${EXAMPLE}.`,
    )
  }
  const [, rawKind = '', of = '', by = '', where] = matched
  const kind = rawKind.toUpperCase()
  if (!(FOLD_KINDS as readonly string[]).includes(kind)) {
    return err(
      `"${rawKind}" is not a kind a rollup has; it is one of ${FOLD_KINDS.map((each) => each.toLowerCase()).join(', ')}.`,
    )
  }
  const grouped = BY.exec(by)
  if (grouped === null || grouped[2] === undefined) {
    return err(
      `"by ${by}" is not a period. Name a month column, or \`month of\` a date column — with at most one \`or\` for a row that has none, and at most one link after \`and\`: ${EXAMPLE}.`,
    )
  }
  const filters: AggregateFilter[] = []
  for (const part of where === undefined ? [] : splitFilters(where)) {
    const filter = parseFilter(part)
    if ('problem' in filter) return err(filter.problem)
    filters.push(filter)
  }
  return ok({
    name,
    kind: kind as FoldKind,
    of,
    period: { column: grouped[2], fallback: grouped[3], truncate: grouped[1] !== undefined },
    by: grouped[4],
    where: filters,
    note,
  })
}

/** The sentence a rollup is written as — what `parseRollup` reads back. */
export function rollupText(each: RollupDeclaration): string {
  const period =
    (each.period.truncate ? 'month of ' : '') +
    each.period.column +
    (each.period.fallback === undefined ? '' : ` or ${each.period.fallback}`)
  return [
    each.kind.toLowerCase(),
    ...(each.of === '' ? [] : ['of', each.of]),
    'by',
    period,
    ...(each.by === undefined ? [] : ['and', each.by]),
    ...(each.where.length === 0 ? [] : ['where', each.where.map(filterText).join(' and ')]),
  ].join(' ')
}

/* ------------------------------------------------------------- the answer */

/**
 * One row of what the compiled query returns: a group, split by currency when
 * the figure is money. Named here so `ddl.ts` writes the aliases this reads.
 */
export interface RollupQueryRow {
  readonly period: string | null
  readonly by: string | null
  readonly currency: string | null
  /** The fold over the rows that answered. */
  readonly figure: number | null
  /** Every row in the group the filters did not refuse. */
  readonly rows: number
  /** Rows with nothing in the folded column, or nothing where a filter reads. */
  readonly silent: number
  /** One of them, by id, so the fix is one edit away. */
  readonly silent_row: string | null
}

/** A figure of a group — money in minor units beside its currency, or a plain figure. */
export interface RollupFigure {
  readonly value: number
  readonly currency?: string | undefined
}

/** One group: a month, perhaps a link, and what it came to — or why it will not say. */
export interface RollupGroup {
  /** `2026-03`, or undefined for the rows with no month at all. */
  readonly period: string | undefined
  /** The linked row's id, or undefined for the rows whose link is empty. */
  readonly by: string | undefined
  readonly rows: number
  readonly value:
    | { readonly kind: 'VALUE'; readonly figures: readonly RollupFigure[] }
    | { readonly kind: 'UNCHECKED'; readonly reason: string }
}

/**
 * The query's rows back into groups.
 *
 * **Assembly, not a fold**: at most one row per group per currency arrives, and
 * the arithmetic is already done. What happens here is the part SQL cannot say
 * in words — which group is unchecked and why.
 *
 * `scale` is a decimal column's, whose stored integer is the figure times ten
 * to it (D-257); a money figure stays minor units and says its currency.
 */
export function assembleRollup(
  each: RollupDeclaration,
  format: string,
  queried: readonly RollupQueryRow[],
  options: { readonly money: boolean; readonly scale?: number | undefined },
): readonly RollupGroup[] {
  const groups = new Map<string, { period: string | null; by: string | null; parts: RollupQueryRow[] }>()
  for (const row of queried) {
    const key = JSON.stringify([row.period, row.by])
    const group = groups.get(key) ?? { period: row.period, by: row.by, parts: [] }
    group.parts.push(row)
    groups.set(key, group)
  }

  const divisor = options.scale === undefined ? 1 : 10 ** options.scale
  return [...groups.values()].map(({ period, by, parts }) => {
    const rows = parts.reduce((total, part) => total + part.rows, 0)
    const silent = parts.find((part) => part.silent > 0)
    const base = { period: period ?? undefined, by: by ?? undefined, rows }
    if (silent !== undefined) {
      const count = parts.reduce((total, part) => total + part.silent, 0)
      const one = silent.silent_row === null ? 'One' : `Row ${silent.silent_row}`
      const what =
        each.where.length === 0
          ? `nothing in ${each.of}`
          : `nothing in ${[...(each.of === '' ? [] : [each.of]), ...each.where.map((filter) => filter.column)].join(' or ')}`
      return {
        ...base,
        value: {
          kind: 'UNCHECKED' as const,
          reason: `${one} of ${format}${count > 1 ? ` and ${String(count - 1)} more` : ''} in this group ${count > 1 ? 'have' : 'has'} ${what}. A ${word(each.kind)} that left ${count > 1 ? 'them' : 'it'} out would be a smaller number and not a truer one.`,
        },
      }
    }
    if (each.kind !== 'COUNT' && each.kind !== 'SUM' && parts.every((part) => part.figure === null)) {
      return {
        ...base,
        value: { kind: 'UNCHECKED' as const, reason: `No row here has a figure, and there is no ${word(each.kind)} of nothing.` },
      }
    }
    const figures = parts
      .filter((part) => part.figure !== null || each.kind === 'SUM')
      .map((part) => ({
        value: each.kind === 'COUNT' ? part.rows : (part.figure ?? 0) / (options.money ? 1 : divisor),
        ...(options.money && part.currency !== null ? { currency: part.currency } : {}),
      }))
    // A count is one figure however many currencies its rows were in.
    const merged =
      each.kind === 'COUNT' ? [{ value: rows }] : figures.sort((a, b) => (a.currency ?? '').localeCompare(b.currency ?? ''))
    return { ...base, value: { kind: 'VALUE' as const, figures: merged } }
  })
}

/** A group's figure as a line says it — `₪1,234.50`, `3 rows`, `12.5`. */
export function figureText(
  figure: RollupFigure,
  formatMoney: (minor: number, currency: string) => string,
): string {
  if (figure.currency !== undefined) return formatMoney(figure.value, figure.currency)
  return String(Number(figure.value.toPrecision(12)))
}
