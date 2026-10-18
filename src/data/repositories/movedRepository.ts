/**
 * **Money moved to something you own is not spent** (M28 U2, D-309).
 *
 * A transfer to a broker, categorised under the savings group, used to count as
 * "went out" on the month: "saved" counted only deposits against a goal or a
 * fund, and the transfer was neither. Making the savings group a rule would
 * have fixed one document and taught the engine nothing. The rule is D-279's
 * pattern instead, made general: **a transaction that a row of a declared
 * format links is moved, not spent, whatever its category.** The person who
 * declares `investment` with a `transaction` link has said, by linking a row,
 * that the money went to something they own.
 *
 * **Since M28 F4 (D-316) a category on the Money moved tab is moved too** (see
 * `MOVED_KINDS`), which amends the line above about the savings group: that was
 * the answer to an unwanted rule, and this one was asked for after it.
 *
 * **Only a link the person declared counts.** The ledger's own formats link
 * transactions for bookkeeping — an override, a reapplied rule, a card
 * settlement, a debt payment — and none of those says the money is still
 * theirs. So a column the ledger pack declared is not a reason; a column
 * somebody added, to their own format or to one of the pack's, is. A `links`
 * column counts the same as a `link`: each member is a linked row.
 *
 * This file only says **which rows**; what a total does with them is its own
 * business — statistics leaves them out of "went out" and adds them to "saved",
 * and the ledger's filter total counts them without summing them, the way it
 * treats a row excluded from statistics.
 */

import type { Database } from 'sql.js'

import {
  isLinkType,
  MEMBER_COLUMNS,
  memberTableNameFor,
  tableNameFor,
  type ColumnDeclaration,
  type FormatDeclaration,
} from '@/domain/format/declaration.ts'
import { quoteIdentifier, rollupFilterSql } from '@/domain/format/ddl.ts'
import { query } from '../db/database.ts'
import { declared } from '../packs/ledger/tables.ts'
import type { CategoryKind } from './categoryRepository.ts'
import { listFormats } from './formatRepository.ts'

/**
 * **A category on the Money moved tab is moved, not spent** (M28 F4, D-316).
 *
 * The Categories screen's *Money moved* tab is every category whose kind is
 * is TRANSFER or SAVING. **DEBT_PAYMENT is not on it** (F6, amends D-316): part
 * of a loan payment is interest, which really is spent, so it stays in
 * Spending and in went out. The tab and the totals read this one list, so what the screen shows as moved is what
 * Home counts as moved. A row in such a category is moved exactly as a row a
 * declared format links is (D-309), and one that is both is moved once: it is
 * one row in one `OR` test, not two sums. A row excluded from statistics (a
 * card bill the ledger already leaves out) is never moved.
 */
export const MOVED_KINDS: readonly CategoryKind[] = ['TRANSFER', 'SAVING']

export const isMovedKind = (kind: CategoryKind): boolean => MOVED_KINDS.includes(kind)

/** The format whose rows are moved when linked — the ledger's own. */
const MOVED_TARGET = 'transaction'

/** A column that says "this transaction went to something I own". */
function movesMoney(declaration: FormatDeclaration, column: ColumnDeclaration): boolean {
  if (!isLinkType(column.type) || column.target !== MOVED_TARGET) return false
  return declaration.owner === undefined || !declaration.owner.columns.includes(column.name)
}

/**
 * SQL selecting the id of every moved transaction, or `undefined` when no
 * declared format can name one — which is every document that has not declared
 * one, so the queries that read this stay exactly what they were.
 */
export function movedTransactionsSql(db: Database): string | undefined {
  const selects: string[] = []
  for (const declaration of listFormats(db)) {
    for (const column of declaration.columns) {
      if (!movesMoney(declaration, column)) continue
      if (column.type === 'links') {
        selects.push(
          `SELECT ${quoteIdentifier(MEMBER_COLUMNS.member)} FROM ${quoteIdentifier(memberTableNameFor(declaration, column))}`,
        )
      } else {
        const name = quoteIdentifier(column.name)
        selects.push(
          `SELECT ${name} FROM ${quoteIdentifier(tableNameFor(declaration))} WHERE ${name} IS NOT NULL`,
        )
      }
    }
  }
  return selects.length === 0 ? undefined : selects.join(' UNION ')
}

/**
 * **A row that names a holding stayed in its account** (M30 U2): it is cash
 * turning into that holding — a buy, or a sale back into cash — so it counts
 * in neither came in, went out nor moved, whatever its category or a declared
 * link says. The money left the person's spending when it reached the account
 * (a transfer, M30 U3), and counting the buy again would count it twice.
 *
 * **And so is every row of an account with holdings** (M30 U5, D-358;
 * U3's paired end, D-356, was the first of them). Its cash and what it buys
 * are the account's own: a transfer's end arriving there is the same money the
 * ordinary end already counts as moved, and interest, a bonus or a fee rebate
 * is growth of its cash — as a fee charged there is a loss of it — never income
 * or spending. Money reaches a month only at an ordinary account's end.
 *
 * True against the table alias given; the pack's own columns, so they are read
 * whether or not anybody declared anything.
 */
export function heldCondition(alias = ''): string {
  const prefix = alias === '' ? '' : `${alias}.`
  return `(${prefix}holding IS NOT NULL OR ${prefix}account IN (${HOLDING_ACCOUNTS}))`
}

const HOLDING_ACCOUNTS = "SELECT id FROM fmt_account WHERE kind = 'HOLDINGS'"

/** The ids of both ends of every answered transfer (D-356). */
const PAIRED_SQL = `SELECT out_transaction FROM fmt_transfer_pair WHERE user_decision = 'PAIRED'
          UNION SELECT in_transaction FROM fmt_transfer_pair WHERE user_decision = 'PAIRED'`

/**
 * A SQL condition true for a transaction that was moved, against the table
 * alias given. Never true for a held row (`heldCondition`),
 * so it drops into any `CASE` or `WHERE` beside it.
 */
export function movedCondition(db: Database, alias = ''): string {
  const prefix = alias === '' ? '' : `${alias}.`
  const kinds = MOVED_KINDS.map((kind) => `'${kind}'`).join(', ')
  // COALESCE: an uncategorised row is NULL here, and NOT NULL would drop it from every total.
  const byCategory = `COALESCE(${prefix}category IN (SELECT id FROM fmt_category WHERE kind IN (${kinds})), 0)`
  // The end of a transfer on an ordinary account (D-356); the end where things
  // are held is held, and `heldCondition` keeps it out of here.
  return `(NOT ${heldCondition(alias)} AND (${byCategory} OR ${pointedAtCondition(db, alias)}))`
}

/**
 * **What only code can say is moved** (M36 U04): a row a person's own format
 * links (D-309), and both ends of an answered transfer (D-356). Each is a row
 * pointing *at* the transaction, which a filter does not read — so these stay
 * code beside the declared `spending` rule, and nothing else does.
 */
export function pointedAtCondition(db: Database, alias = ''): string {
  const moved = movedTransactionsSql(db)
  const prefix = alias === '' ? '' : `${alias}.`
  const paired = `${prefix}id IN (${PAIRED_SQL})`
  return moved === undefined ? `(${paired})` : `(${prefix}id IN (${moved}) OR ${paired})`
}

/**
 * **A row left out of every total** (M36 U04): by the person
 * (`is_excluded_from_stats`, theirs alone now) or by a card settlement's answer
 * (`counted_on_card`). What a total that is not *spending* — a category's own,
 * what moved, a filter's sum — reads, since those count moved and held rows on
 * purpose. The two columns are the declared rule's first two filters.
 */
export function leftOutCondition(alias = ''): string {
  const prefix = alias === '' ? '' : `${alias}.`
  return `(${prefix}is_excluded_from_stats = 1 OR ${prefix}counted_on_card IS 1)`
}

/** A row not left out — `leftOutCondition` turned round, for a `WHERE`. */
export function countsCondition(alias = ''): string {
  return `NOT ${leftOutCondition(alias)}`
}

/**
 * **The ledger's one rule for what counts as spent, read from where it is
 * declared** (M36 U04): `transaction.spending`'s filters as a condition on the
 * alias given — not left out by the person or a settlement, not held, not
 * Money moved by its category. Its `direction` is left to the query, which
 * reads both ways when it asks about income too.
 *
 * What a filter cannot say — `pointedAtCondition` — and the salary a slip
 * already counts (D-317) are the caller's to add beside it.
 */
export function spendingRuleSql(db: Database, alias = ''): string {
  const transaction = declared(db, 'transaction')
  const spending = (transaction.rollups ?? []).find((each) => each.name === SPENDING)
  if (spending === undefined) throw new Error(`The ledger’s transaction declares no ${SPENDING} rollup.`)
  // Only the formats a filter hops to are read, rather than every declaration.
  const targets = new Set(
    spending.where.flatMap((filter) => {
      const [link, hop] = filter.column.split('.')
      const column = transaction.columns.find((each) => each.name === link)
      return hop === undefined || column?.target === undefined ? [] : [column.target]
    }),
  )
  const neighbours = [...targets].map((name) => declared(db, name))
  return rollupFilterSql(transaction, spending, neighbours, alias === '' ? 'fmt_transaction' : alias, ['direction'])
}

/** The rollup the ledger declares its rule for spending as. */
export const SPENDING = 'spending'

/** One category's share of what moved in a span: so a wrong filing is seen. */
export interface MovedLine {
  /** Undefined for a row a declared format links that has no category. */
  readonly categoryId: string | undefined
  readonly name: string
  /** Net, in minor units: out minus back, so a withdrawal nets against it. */
  readonly netMinor: number
  readonly transactionCount: number
}

/**
 * What moved in the span the prefix names (`2026-06` or `2026`), net per
 * category, largest first. Rows excluded from statistics are not moved.
 */
export function movedLines(db: Database, prefix: string, currency: string): readonly MovedLine[] {
  const rows = query(
    db,
    `SELECT t.category AS category_id, c.name AS name, COUNT(*) AS n, SUM(-t.amount_minor) AS net
       FROM fmt_transaction t
       LEFT JOIN fmt_category c ON c.id = t.category
      WHERE ${countsCondition('t')} AND t.amount_currency = ?
        AND substr(COALESCE(t.charge_date, t.transaction_date), 1, ?) = ? AND ${movedCondition(db, 't')}
      GROUP BY t.category
      ORDER BY ABS(net) DESC`,
    [currency, prefix.length, prefix],
  )
  return rows.map((row) => ({
    categoryId: row['category_id'] == null ? undefined : String(row['category_id']),
    name: String(row['name'] ?? 'Uncategorized'),
    netMinor: Number(row['net'] ?? 0),
    transactionCount: Number(row['n'] ?? 0),
  }))
}
