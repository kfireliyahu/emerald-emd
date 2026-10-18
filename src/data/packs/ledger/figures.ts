/**
 * **The figures the ledger declares, read rather than re-added** — M36 U03.
 *
 * The ledger's formats say what adds up — a debt's principal paid, a goal's
 * balance, a payslip's saving — as totals and worked-out columns, and the
 * engine folds them (D-224, D-334). Code that sums the same rows again in
 * TypeScript is a second answer to a question the document already answers,
 * and the two drift: a payment in another currency the code left out was a
 * total the engine calls `unchecked` (D-349). So the ledger reads them.
 *
 * Two shapes, and both are the engine's:
 *
 * - **`declaredFigures`** — a format's worked-out columns *and* its totals, for
 *   every row a `WHERE` takes, in **one query**: the `SELECT` the format's view
 *   is made of (D-334), with each total asked for read as a worked-out column
 *   that names it. The SQL is compiled from the parsed declaration, as the view
 *   is, so nothing here writes a fold by hand. A total of no rows is zero in no
 *   currency, which a reader gives the currency of the row it belongs to.
 * - **`latestOf`** — one row's total, folded by `foldAggregate` as
 *   `holdingQuantity` folds its sum (D-272). A worked-out column reads a
 *   `latest` since M36 U05, so `declaredFigures` takes one too.
 */

import type { Database } from 'sql.js'

import { money, type CurrencyCode, type Money } from '@/core/money.ts'
import type { AggregateValue } from '@/domain/format/aggregate.ts'
import { moneyColumnNames, ROW_ID_COLUMN, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { compileDerived, derivedSelectSql, type DerivedDeclaration } from '@/domain/format/derived.ts'
import { query } from '../../db/database.ts'
import { foldAggregate, indexOf } from '../../repositories/formatJoinRepository.ts'
import { allDeclared, declared } from './tables.ts'

/** What one row's declared figures came to. `undefined` is a figure the engine would not give. */
export interface RowFigures {
  /** Money, in the currency it came out in — or in `none` when it is a total of no rows. */
  money(name: string, none: CurrencyCode): Money | undefined
  /** A bare number — a share, a count. */
  number(name: string): number | undefined
}

/** The prefix a total is read under, as a worked-out column naming it. */
const READ = 'read_'

/**
 * A ledger format's declared figures for the rows `where` takes — `t` is the
 * format's table — by row id. `names` are its worked-out columns and its totals
 * (sums, counts, averages, minimums, maximums, and a `latest` or `earliest`).
 */
export function declaredFigures(
  db: Database,
  format: string,
  names: readonly string[],
  where = '1 = 1',
  params: readonly (string | number | null)[] = [],
): ReadonlyMap<string, RowFigures> {
  const declaration = declared(db, format)
  const neighbours = allDeclared(db).filter((each) => each.name !== format)
  const worked = new Set((declaration.derived ?? []).map((each) => each.name))
  const asked: DerivedDeclaration[] = []
  const column = new Map<string, string>()
  for (const name of names) {
    if (worked.has(name)) {
      column.set(name, name)
      continue
    }
    if (!declaration.aggregates.some((each) => each.name === name)) {
      throw new Error(`The ledger’s ${format} declares no figure called ${name}.`)
    }
    asked.push({ name: `${READ}${name}`, expression: name, note: '' })
    column.set(name, `${READ}${name}`)
  }
  const shape: FormatDeclaration = { ...declaration, derived: [...(declaration.derived ?? []), ...asked] }
  const { compiled, problems } = compileDerived(shape, neighbours)
  const select = derivedSelectSql(shape, neighbours, false)
  if (select === undefined || problems.length > 0) {
    throw new Error(`The ledger’s ${format} figures do not work out: ${problems[0]?.message ?? 'nothing to read.'}`)
  }
  const isMoney = new Map(compiled.map((each) => [each.declaration.name, each.type.kind === 'MONEY']))

  const out = new Map<string, RowFigures>()
  for (const found of query(db, `${select} WHERE ${where}`, params)) {
    out.set(String(found[ROW_ID_COLUMN]), {
      money: (name, none) => {
        const read = column.get(name)
        if (read === undefined || isMoney.get(read) !== true) return undefined
        const names = moneyColumnNames({ name: read })
        const minor = found[names.minor]
        if (typeof minor !== 'number') return undefined
        const currency = found[names.currency]
        return money(minor, typeof currency === 'string' ? (currency as CurrencyCode) : none)
      },
      number: (name) => {
        const read = column.get(name)
        if (read === undefined) return undefined
        const value = found[read]
        return typeof value === 'number' && Number.isFinite(value) ? value : undefined
      },
    })
  }
  return out
}

/** A `latest` (or any) total of one row, folded by the engine (D-272). */
export function latestOf(db: Database, format: string, name: string, rowId: string): AggregateValue {
  const aggregate = declared(db, format).aggregates.find((each) => each.name === name)
  if (aggregate === undefined) throw new Error(`The ledger’s ${format} declares no total called ${name}.`)
  return foldAggregate(db, aggregate, rowId, indexOf(allDeclared(db)))
}

/**
 * A format's worked-out columns as a `SELECT` to join on — its row `id` and
 * each derived column, money as its two — so a read of the stored row carries
 * what the document works out beside it (D-334).
 */
export function workedOutSql(db: Database, format: string): string {
  const declaration = declared(db, format)
  const select = derivedSelectSql(declaration, allDeclared(db).filter((each) => each.name !== format), false)
  if (select === undefined) throw new Error(`The ledger’s ${format} works nothing out.`)
  return select
}
