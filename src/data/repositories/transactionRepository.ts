/**
 * Transactions in and out of SQLite. The only place a SQL row becomes a domain
 * object or the other way round.
 *
 * **Rows of the pack's `transaction`** since M25 U3 (D-275). A row is there or
 * it is not — nothing is soft-deleted any more — and every one links to the
 * `statement` it was read from, which is where its provenance is.
 */

import type { Database } from 'sql.js'

import { money, type Money } from '@/core/money.ts'
import { cleanText, normalizeMerchant } from '@/core/text.ts'
import {
  parseISODate,
  toISODate,
  toYearMonthString,
  type LocalDate,
  type YearMonth,
} from '@/core/time.ts'
import type { Result } from '@/core/result.ts'
import { formatDecimal, parseDecimal } from '@/domain/format/decimal.ts'
import type { StoredValue } from '@/domain/format/row.ts'
import type { Direction } from '@/domain/model/importing.ts'
import { query } from '../db/database.ts'
import { declared, millisOf } from '../packs/ledger/tables.ts'
import { UNCATEGORIZED_ID, type CategorySource } from './categoryRepository.ts'
import { insertRows } from './formatRowRepository.ts'
import {
  countsCondition,
  heldCondition,
  leftOutCondition,
  movedCondition,
  pointedAtCondition,
  spendingRuleSql,
} from './movedRepository.ts'

export interface StoredTransaction {
  readonly id: string
  readonly accountId: string
  readonly transactionDate: LocalDate
  readonly chargeDate: LocalDate | undefined
  readonly billingPeriod: YearMonth | undefined
  readonly amount: Money
  readonly direction: Direction
  readonly merchantRaw: string
  readonly merchantNormalized: string
  readonly providerCategory: string | undefined
  readonly cardLast4: string | undefined
  readonly reference: string | undefined
  readonly note: string | undefined
  /**
   * "3 of 12", plus what ties the slice to its purchase: the derived group key
   * shared by every slice, and the full purchase price when the file stated one
   * (D-007, D-035).
   */
  readonly installment:
    | {
        readonly sequence: number
        readonly total: number
        readonly groupKey: string
        readonly originalTotal: Money | undefined
      }
    | undefined
  /** The original currency amount, when the charge was converted into one. */
  readonly foreign: { readonly amount: Money; readonly exchangeRate: number | undefined } | undefined
  /** The person left this row out of every total — their answer and nothing else's (M36 U04). */
  readonly isExcludedFromStats: boolean
  /**
   * A bank line paying a card's bill, answered as already counted in the
   * card's own rows (M36 U04): the settlement's answer, which leaves it out of
   * every total as the person's does, and is taken back with the settlement.
   */
  readonly countedOnCard: boolean
  readonly naturalKey: string
  readonly importSessionId: string | undefined
  readonly sourceRowRef: string | undefined
  readonly categoryId: string | undefined
  /** `Utilities → Electricity`, or undefined when uncategorized. */
  readonly categoryPath: string | undefined
  readonly categorySource: CategorySource
  /**
   * Which rule assigned the category, when one did.
   *
   * The column has existed since migration 002 and the commit path has written
   * it since D-038, but nothing read it back — so a category a rule assigned
   * was indistinguishable on screen from one that fell out of the sky.
   * "Categorization is always explainable" (docs/conventions.md) needs this to
   * come out of the database, not only go into it.
   */
  readonly matchedRuleId: string | undefined
  /**
   * The holding this row's cash turned into, inside its own account — a buy,
   * or a sale back into cash (M30 U2). Such a row counts in no flow.
   */
  readonly holdingId: string | undefined
  /**
   * How much of the holding, in millionths: the declared `decimal` of six
   * places stores the figure times a million (D-257). Bought is positive, sold
   * negative. Never money — a quantity is a count of the thing held.
   */
  readonly quantityMicro: number | undefined
}

/** A quantity's six places (M30 U2): the declared `decimal` stores the figure times ten to this. */
export const QUANTITY_SCALE = 6

/** A stored quantity as a person writes it: `8.5`, `-4`, never `8.500000`. */
export function quantityText(micro: number): string {
  return formatDecimal(micro, QUANTITY_SCALE).replace(/\.?0+$/, '')
}

/** A quantity a person or a conversation wrote, as the integer stored — or why it is not one. */
export function parseQuantity(offered: string | number): Result<number, string> {
  return parseDecimal(offered, QUANTITY_SCALE)
}

/** A rate's six places (D-257): the declared `decimal` stores the figure times this. */
const RATE_SCALE = 1_000_000

/**
 * What an import writes.
 *
 * The category fields are excluded on purpose: an import never assigns a
 * category, and manual assignment goes through `setCategoryManually` so it is
 * always recorded as MANUAL (D-009). `isExcludedFromStats` is excluded for the
 * same reason in the other direction — it is a judgement the user makes about a
 * row, never a fact a file states about itself, so an insert always writes 0.
 */
export type InsertableTransaction = Omit<
  StoredTransaction,
  | 'categoryId'
  | 'categoryPath'
  | 'categorySource'
  | 'matchedRuleId'
  | 'isExcludedFromStats'
  | 'countedOnCard'
  | 'holdingId'
  | 'quantityMicro'
> &
  Partial<Pick<StoredTransaction, 'holdingId' | 'quantityMicro'>>

/**
 * What an import commits, all at once. One write of the pack's table for
 * the lot: resolving the declaration reads the format's tables, and a
 * statement's thousand rows should do that once (M25 U3).
 */
export function insertTransactions(db: Database, rows: readonly InsertableTransaction[], _now: number): void {
  if (rows.length === 0) return
  insertRows(db, declared(db, 'transaction'), rows.map(cellsOf), rows.map((row) => row.id))
}

function cellsOf(row: InsertableTransaction): Readonly<Record<string, StoredValue>> {
  const original = row.installment?.originalTotal
  const rate = row.foreign?.exchangeRate
  return {
        merchant_raw: row.merchantRaw,
        account: row.accountId,
        transaction_date: toISODate(row.transactionDate),
        charge_date: row.chargeDate === undefined ? null : toISODate(row.chargeDate),
        billing_period: row.billingPeriod === undefined ? null : toYearMonthString(row.billingPeriod),
        amount_minor: row.amount.minor,
        amount_currency: row.amount.currency,
        direction: row.direction,
        merchant_normalized: row.merchantNormalized,
        provider_category: row.providerCategory ?? null,
        card_last4: row.cardLast4 ?? null,
        reference: row.reference ?? null,
        note: row.note ?? null,
        installment_sequence: row.installment?.sequence ?? null,
        installment_total: row.installment?.total ?? null,
        installment_group_key: row.installment?.groupKey ?? null,
        // The currency is the transaction's own — see 007. A total in another
        // currency would be a conversion.
        original_total_minor: original?.minor ?? null,
        original_total_currency: original === undefined ? null : row.amount.currency,
        foreign_amount_minor: row.foreign?.amount.minor ?? null,
        foreign_amount_currency: row.foreign?.amount.currency ?? null,
        exchange_rate: rate === undefined ? null : Math.round(rate * RATE_SCALE),
        is_excluded_from_stats: 0,
        natural_key: row.naturalKey,
        statement: row.importSessionId ?? null,
        source_row_ref: row.sourceRowRef ?? null,
        category_source: 'NONE',
        holding: row.holdingId ?? null,
        quantity: row.quantityMicro ?? null,
  }
}

/** The natural keys this account already holds, for classifying an incoming file. */
export function existingNaturalKeys(db: Database, accountId: string): ReadonlySet<string> {
  const rows = query(
    db,
    'SELECT natural_key FROM fmt_transaction WHERE account = ?',
    [accountId],
  )
  return new Set(rows.map((row) => String(row['natural_key'])))
}

/** An account that already holds rows a file is about to write, and how many. */
export interface RowsHeld {
  readonly accountId: string
  readonly accountName: string
  readonly last4: string | undefined
  readonly rows: number
}

/**
 * **Which other accounts already hold these rows** — M28 F11.
 *
 * The natural key is the file's row, not its layout's: a bank's app export and
 * its website report write one date, one amount and one description the same
 * way however their columns are ordered, so two readers of one account produce
 * the same keys. What the unique index cannot catch is the same rows going to a
 * *second* account, because it is `(account, natural_key)` — and that is how one
 * bank became two. Same key **and** same direction, so a transfer between two of
 * one's own accounts, the row that legitimately appears in both, is never read
 * as an overlap. Most rows first.
 */
export function accountsHoldingRows(
  db: Database,
  rows: readonly { readonly key: string; readonly direction: Direction }[],
  except: string | undefined,
): readonly RowsHeld[] {
  const wanted = new Map(rows.map((row) => [row.key, row.direction]))
  const keys = [...wanted.keys()]
  const counts = new Map<string, RowsHeld>()
  for (let start = 0; start < keys.length; start += 500) {
    const chunk = keys.slice(start, start + 500)
    const found = query(
      db,
      `SELECT t.account, t.natural_key, t.direction, a.name, a.last4
         FROM fmt_transaction t JOIN fmt_account a ON a.id = t.account
        WHERE t.natural_key IN (${chunk.map(() => '?').join(', ')})`,
      chunk,
    )
    for (const row of found) {
      const accountId = String(row['account'])
      if (accountId === except || wanted.get(String(row['natural_key'])) !== row['direction']) continue
      counts.set(accountId, {
        accountId,
        accountName: String(row['name']),
        last4: row['last4'] === null || row['last4'] === undefined ? undefined : String(row['last4']),
        rows: (counts.get(accountId)?.rows ?? 0) + 1,
      })
    }
  }
  return [...counts.values()].sort((a, b) => b.rows - a.rows)
}

/**
 * What the user has narrowed the ledger down to.
 *
 * Every field is optional and an absent one means "no opinion", so `{}` is the
 * whole ledger. The filtering happens in SQL rather than over a loaded array:
 * the footer has to total *the filter*, not the page, and a 60k-row document
 * (M6.5's performance target) must not be handed to the browser to sift.
 */
export interface TransactionFilter {
  /**
   * Inclusive bounds on the charge date, falling back to the transaction date —
   * the same basis the monthly totals use (D-006), so a month's rows and a
   * month's total cannot disagree about which month a row is in.
   */
  readonly from?: LocalDate | undefined
  readonly to?: LocalDate | undefined
  readonly accountId?: string | undefined
  readonly categoryId?: string | undefined
  /** Overrides `categoryId`: the rows with no category, and the ones parked on the system one. */
  readonly uncategorized?: boolean | undefined
  /**
   * Read `categoryId` as a parent: its own rows **and** its subcategories'.
   *
   * Off by default, because the ledger's own picker lists a parent and each
   * child as separate options and someone choosing "Utilities" there has chosen
   * Utilities. On when the monthly summary drills into a rolled-up row, where
   * the figure being tapped is the rollup — without it the ledger would show a
   * third of the number the user just clicked, which is F10's third acceptance
   * criterion failing on the first click (D-088).
   */
  readonly includeSubcategories?: boolean | undefined
  /** Matched against the merchant as written, the normalized merchant, and the provider's label. */
  readonly search?: string | undefined
  /**
   * By magnitude, so "at least ₪200" catches a ₪200 refund as well as a ₪200
   * charge. Scoped to the bound's own currency: without an exchange rate there
   * is no honest way to compare 200 agorot with 200 cents, and silently
   * pretending they are the same number is exactly the floating-point-money
   * class of bug D-003 exists to prevent.
   */
  readonly min?: Money | undefined
  readonly max?: Money | undefined
  /**
   * Only these rows. For a read that decides *which* rows elsewhere — Home's
   * biggest charges are the ones a total counts, which statistics knows and this
   * file does not (M30 F1) — and still wants them as the ledger shows them.
   */
  readonly ids?: readonly string[] | undefined
}

/** The month/date basis, repeated in every query so they cannot drift apart. */
const DATE_BASIS = 'COALESCE(t.charge_date, t.transaction_date)'

interface Where {
  readonly sql: string
  readonly params: (string | number | null)[]
}

/**
 * The filter as a `WHERE` fragment over `fmt_transaction t`.
 *
 * Exported because re-apply scopes itself with the same vocabulary the ledger
 * filters with — an account, a date range, uncategorized-only (F03) — and a
 * second implementation of "which rows does the user mean" would be a second
 * thing to keep agreeing with the screen the user learned it on.
 */
export function buildTransactionWhere(filter: TransactionFilter): Where {
  const clauses = ['1 = 1']
  const params: (string | number | null)[] = []

  if (filter.from !== undefined) {
    clauses.push(`${DATE_BASIS} >= ?`)
    params.push(toISODate(filter.from))
  }
  if (filter.to !== undefined) {
    clauses.push(`${DATE_BASIS} <= ?`)
    params.push(toISODate(filter.to))
  }
  if (filter.accountId !== undefined) {
    clauses.push('t.account = ?')
    params.push(filter.accountId)
  }

  if (filter.uncategorized === true) {
    clauses.push('(t.category IS NULL OR t.category = ?)')
    params.push(UNCATEGORIZED_ID)
  } else if (filter.categoryId !== undefined && filter.includeSubcategories === true) {
    // The rolled-up reading: a parent means the parent and everything under it.
    // Two levels of descent are the whole tree — it is three deep since M28 F29
    // (D-348), and the picker shows a path rather than a hierarchy.
    clauses.push(
      '(t.category = ? OR t.category IN' +
        ' (SELECT id FROM fmt_category WHERE parent = ?' +
        ' OR parent IN (SELECT id FROM fmt_category WHERE parent = ?)))',
    )
    params.push(filter.categoryId, filter.categoryId, filter.categoryId)
  } else if (filter.categoryId !== undefined) {
    clauses.push('t.category = ?')
    params.push(filter.categoryId)
  }

  const needle = filter.search === undefined ? '' : cleanText(filter.search)
  if (needle !== '') {
    // Three columns because the user is searching for a shop, and which string
    // holds the name they remember depends on the file: `merchant_normalized`
    // has had its branch number stripped, `merchant_raw` has not, and a search
    // for "מזון" is really a search of what the provider called it.
    clauses.push(
      `(t.merchant_raw LIKE ? ESCAPE '\\'` +
        ` OR t.merchant_normalized LIKE ? ESCAPE '\\'` +
        ` OR t.provider_category LIKE ? ESCAPE '\\')`,
    )
    params.push(contains(needle), contains(normalizeMerchant(needle)), contains(needle))
  }

  if (filter.min !== undefined) {
    clauses.push('t.amount_currency = ? AND ABS(t.amount_minor) >= ?')
    params.push(filter.min.currency, Math.abs(filter.min.minor))
  }
  if (filter.max !== undefined) {
    clauses.push('t.amount_currency = ? AND ABS(t.amount_minor) <= ?')
    params.push(filter.max.currency, Math.abs(filter.max.minor))
  }
  if (filter.ids !== undefined) {
    clauses.push(filter.ids.length === 0 ? '0 = 1' : `t.id IN (${filter.ids.map(() => '?').join(', ')})`)
    params.push(...filter.ids)
  }

  return { sql: clauses.join(' AND '), params }
}

/** A LIKE needle with the wildcards the user typed treated as literal text. */
function contains(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

/** A sortable column of the ledger, named as the screen names it. */
export type SortColumn = 'DATE' | 'CHARGED' | 'MERCHANT' | 'CATEGORY' | 'AMOUNT'

export interface TransactionSort {
  readonly column: SortColumn
  readonly direction: 'ASC' | 'DESC'
}

export const DEFAULT_SORT: TransactionSort = { column: 'DATE', direction: 'DESC' }

/**
 * What each column sorts by, in SQL.
 *
 * Sorting happens here rather than over the loaded array for the same reason
 * filtering does (D-032): the list is capped at 500 rows, so a sort applied
 * afterwards would order the page instead of the ledger — "the largest charge"
 * would mean "the largest of the 500 most recent", which is a different and
 * quietly wrong answer.
 *
 * `MERCHANT` sorts on the normalized name, which has the branch number off it,
 * so `שופרסל דיל 344` and `שופרסל דיל 812` land next to each other rather than
 * being separated by whatever sorts between them.
 */
const SORT_EXPRESSION: Readonly<Record<SortColumn, string>> = {
  DATE: DATE_BASIS,
  CHARGED: 't.charge_date',
  MERCHANT: 't.merchant_normalized',
  CATEGORY: 'category_path',
  AMOUNT: 't.amount_minor',
}

export function listTransactions(
  db: Database,
  filter: TransactionFilter = {},
  limit = 500,
  sort: TransactionSort = DEFAULT_SORT,
): readonly StoredTransaction[] {
  const where = buildTransactionWhere(filter)
  const by = SORT_EXPRESSION[sort.column]
  const direction = sort.direction === 'ASC' ? 'ASC' : 'DESC'

  const rows = query(
    db,
    `SELECT t.*, COALESCE(g.name || ' → ' || p.name || ' → ' || c.name, p.name || ' → ' || c.name, c.name) AS category_path
       FROM fmt_transaction t
       LEFT JOIN fmt_category c ON c.id = t.category
       LEFT JOIN fmt_category p ON p.id = c.parent
       LEFT JOIN fmt_category g ON g.id = p.parent
      WHERE ${where.sql}
      ORDER BY ${by} ${direction}, ${DATE_BASIS} DESC, t.transaction_date DESC, t.rowid DESC
      LIMIT ?`,
    [...where.params, limit],
  )
  return rows.map(toDomain)
}

/**
 * Every id the filter matches, uncapped — what "select all" selects.
 *
 * Separate from `listTransactions` for the same reason `summarizeTransactions`
 * is: the list stops at 500 and a selection must not quietly mean "the first 500
 * of them". Ids only, because that is all a bulk action needs and 60k strings is
 * a great deal less than 60k rows.
 */
export function listTransactionIds(
  db: Database,
  filter: TransactionFilter = {},
): readonly string[] {
  const where = buildTransactionWhere(filter)
  return query(db, `SELECT t.id FROM fmt_transaction t WHERE ${where.sql}`, where.params).map((row) =>
    String(row['id']),
  )
}

export interface CurrencyTotal {
  readonly currency: string
  readonly outflowMinor: number
  readonly inflowMinor: number
}

export interface TransactionSummary {
  /** Every row the filter matches, including the ones beyond the list's limit. */
  readonly count: number
  /** How many of those are excluded from statistics, and so absent from the totals. */
  readonly excluded: number
  /**
   * How many a declared format links — money moved to something the person
   * owns (M28 U2, D-309) — and so, like an excluded row, counted and not summed:
   * the statistics leave them out of what went out, and a total here that kept
   * them would not be the figure the report drilled from.
   */
  readonly moved: number
  /**
   * Rows that name a holding (M30 U2): cash turning into a holding inside one
   * account, counted here and summed in neither total, like a moved row.
   */
  readonly held: number
  readonly totals: readonly CurrencyTotal[]
  /**
   * What went out in the rows left out of the totals, per currency — shown
   * beside them and summed in none (M28 U6).
   */
  readonly leftOut: readonly { readonly currency: string; readonly outflowMinor: number }[]
}

/**
 * What the filter adds up to.
 *
 * Separate from `listTransactions` because it must not be capped: the honest
 * total of "everything at Shufersal this year" is not the total of the first
 * 500 rows of it. Excluded rows are counted but not summed, which is how every
 * other total in the app treats them (`monthlyTotals`, `categoryTotals`).
 */
export function summarizeTransactions(
  db: Database,
  filter: TransactionFilter = {},
): TransactionSummary {
  const where = buildTransactionWhere(filter)
  const moved = movedCondition(db, 't')
  const held = heldCondition('t')
  const counts = countsCondition('t')
  const left = leftOutCondition('t')
  // What went out is the ledger's declared rule for spending (M36 U04).
  const spent = `${spendingRuleSql(db, 't')} AND NOT ${pointedAtCondition(db, 't')}`
  const rows = query(
    db,
    `SELECT t.amount_currency AS currency,
            COUNT(*) AS n,
            SUM(CASE WHEN ${left} THEN 1 ELSE 0 END) AS excluded,
            SUM(CASE WHEN ${counts} AND ${moved} THEN 1 ELSE 0 END) AS moved,
            SUM(CASE WHEN ${counts} AND ${held} THEN 1 ELSE 0 END) AS held,
            SUM(CASE WHEN ${spent} AND t.amount_minor < 0
                     THEN -t.amount_minor ELSE 0 END) AS outflow,
            SUM(CASE WHEN ${counts} AND NOT ${moved} AND NOT ${held} AND t.amount_minor > 0
                     THEN t.amount_minor ELSE 0 END) AS inflow,
            SUM(CASE WHEN ${left} AND t.amount_minor < 0
                     THEN -t.amount_minor ELSE 0 END) AS left_out
       FROM fmt_transaction t
      WHERE ${where.sql}
      GROUP BY t.amount_currency
      ORDER BY n DESC`,
    where.params,
  )

  return {
    count: rows.reduce((total, row) => total + Number(row['n'] ?? 0), 0),
    excluded: rows.reduce((total, row) => total + Number(row['excluded'] ?? 0), 0),
    moved: rows.reduce((total, row) => total + Number(row['moved'] ?? 0), 0),
    held: rows.reduce((total, row) => total + Number(row['held'] ?? 0), 0),
    totals: rows.map((row) => ({
      currency: String(row['currency']),
      outflowMinor: Number(row['outflow'] ?? 0),
      inflowMinor: Number(row['inflow'] ?? 0),
    })),
    leftOut: rows.map((row) => ({
      currency: String(row['currency']),
      outflowMinor: Number(row['left_out'] ?? 0),
    })),
  }
}

export function countTransactions(db: Database): number {
  const rows = query(db, 'SELECT COUNT(*) AS n FROM fmt_transaction')
  return Number(rows[0]?.['n'] ?? 0)
}

export interface MonthlyTotal {
  readonly period: string
  readonly outflowMinor: number
  readonly inflowMinor: number
  readonly currency: string
  readonly count: number
}

/**
 * Totals per month on the charge date, falling back to the transaction date —
 * the default statistics basis in D-006, because the monthly summary should
 * match what actually left the bank account.
 */
export function monthlyTotals(db: Database): readonly MonthlyTotal[] {
  // Money moved to something owned is not spent (D-309): the month keeps its
  // rows, and the totals leave them out the way the statistics do.
  // A row that names a holding stayed in its account (M30 U2), and is neither.
  const moved = movedCondition(db)
  const held = heldCondition()
  // What went out is the ledger's declared rule for spending (M36 U04).
  const spent = `${spendingRuleSql(db)} AND NOT ${pointedAtCondition(db)}`
  const rows = query(
    db,
    `SELECT substr(COALESCE(charge_date, transaction_date), 1, 7) AS period,
            amount_currency AS currency,
            COUNT(*) AS n,
            SUM(CASE WHEN amount_minor < 0 AND ${spent} THEN -amount_minor ELSE 0 END) AS outflow,
            SUM(CASE WHEN amount_minor > 0 AND NOT ${moved} AND NOT ${held} THEN amount_minor ELSE 0 END) AS inflow
       FROM fmt_transaction
      WHERE ${countsCondition()}
      GROUP BY period, amount_currency
      ORDER BY period DESC`,
  )

  return rows.map((row) => ({
    period: String(row['period']),
    currency: String(row['currency']),
    count: Number(row['n']),
    outflowMinor: Number(row['outflow'] ?? 0),
    inflowMinor: Number(row['inflow'] ?? 0),
  }))
}

/**
 * Where a row came from — the file, the sheet, and the mapping that read it.
 *
 * The detail panel's job is to make a number answerable ("row 47 of
 * cal-2026-07.xlsx", docs/06), and this is the answer. Undefined for a row with
 * no session behind it, which today means one a test wrote directly.
 */
export interface TransactionProvenance {
  readonly fileName: string
  readonly sheetName: string | undefined
  readonly mappingName: string | undefined
  /** When the import was committed, as an instant. */
  readonly importedAt: number | undefined
}

export interface TransactionDetail extends StoredTransaction {
  readonly accountName: string
  readonly provenance: TransactionProvenance | undefined
  /**
   * The name of the rule that assigned the category, joined here rather than
   * looked up in the component — the same treatment `mappingName` gets, and for
   * the same reason. Undefined when no rule assigned it, or when the rule has
   * since been deleted: a deleted rule keeps its id on the transaction, because
   * the record of what happened is not undone by the rule going away.
   */
  readonly matchedRuleName: string | undefined
}

/**
 * One transaction with everything the detail panel shows.
 *
 * Every joined column is aliased: `getAsObject` keys rows by column name, so an
 * unaliased `a.name` beside `c.name` would silently keep whichever SQLite
 * emitted last.
 */
export function findTransactionById(db: Database, id: string): TransactionDetail | undefined {
  const rows = query(
    db,
    `SELECT t.*,
            COALESCE(g.name || ' → ' || p.name || ' → ' || c.name, p.name || ' → ' || c.name, c.name) AS category_path,
            a.name AS account_name,
            s.file_name AS session_file_name,
            s.sheet_name AS session_sheet_name,
            s.committed AS session_committed,
            m.name AS mapping_name,
            CASE WHEN r.origin = 'BUILT_IN' THEN NULL ELSE r.name END AS matched_rule_name
       FROM fmt_transaction t
       JOIN fmt_account a ON a.id = t.account
       LEFT JOIN fmt_category c ON c.id = t.category
       LEFT JOIN fmt_category p ON p.id = c.parent
       LEFT JOIN fmt_category g ON g.id = p.parent
       LEFT JOIN fmt_statement s ON s.id = t.statement
       LEFT JOIN fmt_import_mapping m ON m.id = s.mapping
       -- A built-in's row is named by its rule-pack id (M25 U2), so its name
       -- is left to the rule set, which reads the pack's own; a rule deleted
       -- since is removed, and the panel says so.
       LEFT JOIN fmt_category_rule r ON r.id = t.matched_rule
      WHERE t.id = ?`,
    [id],
  )

  const row = rows[0]
  if (row === undefined) return undefined

  const fileName = row['session_file_name']
  return {
    ...toDomain(row),
    accountName: String(row['account_name']),
    provenance:
      fileName == null
        ? undefined
        : {
            fileName: String(fileName),
            sheetName: row['session_sheet_name'] == null ? undefined : String(row['session_sheet_name']),
            mappingName: row['mapping_name'] == null ? undefined : String(row['mapping_name']),
            importedAt: millisOf(row['session_committed']),
          },
    matchedRuleName:
      row['matched_rule_name'] == null ? undefined : String(row['matched_rule_name']),
  }
}

/**
 * The user's own words on a row. Empty clears it rather than storing `''`, so
 * "has a note" stays a single question with a single answer.
 */
export function setTransactionNote(
  db: Database,
  id: string,
  note: string | undefined,
  _now: number,
): void {
  const trimmed = note?.trim() ?? ''
  db.run('UPDATE fmt_transaction SET note = ? WHERE id = ?', [trimmed === '' ? null : trimmed, id])
}

/**
 * Keep a row in the ledger but out of the statistics — **the person's answer,
 * and only theirs** (M36 U04). A card settlement writes `counted_on_card`
 * instead (`setCountedOnCard`), so taking a settlement back never undoes this.
 * Excluding is not deleting — the row stays visible and marked, because a
 * number that vanished is a number nobody can check.
 */
export function setExcludedFromStats(
  db: Database,
  id: string,
  excluded: boolean,
  _now: number,
): void {
  db.run('UPDATE fmt_transaction SET is_excluded_from_stats = ? WHERE id = ?', [excluded ? 1 : 0, id])
}

/**
 * A settlement's answer about its bank line (M36 U04): the card's own rows are
 * its spending, so it is left out of every total — or it is not, and the
 * column is empty. Written only by `cardSettlementRepository`, beside the link.
 */
export function setCountedOnCard(db: Database, id: string, counted: boolean): void {
  db.run('UPDATE fmt_transaction SET counted_on_card = ? WHERE id = ?', [counted ? 1 : null, id])
}

function toDomain(row: Record<string, unknown>): StoredTransaction {
  const text = (key: string): string | undefined => {
    const value = row[key]
    return value === null || value === undefined ? undefined : String(value)
  }

  const transactionDate = parseISODate(String(row['transaction_date']))
  if (transactionDate === undefined) {
    throw new Error(`Stored transaction ${String(row['id'])} has an unreadable date`)
  }

  const chargeDateText = text('charge_date')
  const sequence = row['installment_sequence']
  const total = row['installment_total']
  const originalTotalMinor = row['original_total_minor']
  const foreignMinor = row['foreign_amount_minor']
  const foreignCurrency = row['foreign_amount_currency']
  const rate = row['exchange_rate']

  const currency = String(row['amount_currency'])

  return {
    id: String(row['id']),
    accountId: String(row['account']),
    transactionDate,
    chargeDate: chargeDateText === undefined ? undefined : parseISODate(chargeDateText),
    billingPeriod: toYearMonth(text('billing_period')),
    amount: money(Number(row['amount_minor']), currency),
    direction: String(row['direction']) as Direction,
    merchantRaw: String(row['merchant_raw']),
    merchantNormalized: String(row['merchant_normalized']),
    providerCategory: text('provider_category'),
    cardLast4: text('card_last4'),
    reference: text('reference'),
    note: text('note'),
    installment:
      typeof sequence === 'number' && typeof total === 'number'
        ? {
            sequence,
            total,
            // Empty rather than undefined for a row imported before 007: the
            // slice is still a slice, it just has no group to belong to.
            groupKey: text('installment_group_key') ?? '',
            originalTotal:
              typeof originalTotalMinor === 'number'
                ? money(originalTotalMinor, currency)
                : undefined,
          }
        : undefined,
    // Both or neither, as with the printed total: an amount with no currency is
    // not a smaller fact, it is an unreadable one.
    foreign:
      typeof foreignMinor === 'number' && foreignCurrency != null
        ? {
            amount: money(foreignMinor, String(foreignCurrency)),
            exchangeRate: typeof rate === 'number' ? rate / RATE_SCALE : undefined,
          }
        : undefined,
    isExcludedFromStats: Number(row['is_excluded_from_stats'] ?? 0) === 1,
    countedOnCard: Number(row['counted_on_card'] ?? 0) === 1,
    naturalKey: String(row['natural_key']),
    importSessionId: text('statement'),
    sourceRowRef: text('source_row_ref'),
    categoryId: text('category'),
    categoryPath: text('category_path'),
    categorySource: (text('category_source') ?? 'NONE') as CategorySource,
    matchedRuleId: text('matched_rule'),
    holdingId: text('holding'),
    quantityMicro: typeof row['quantity'] === 'number' ? row['quantity'] : undefined,
  }
}

/** `2026-08` back into calendar parts. */
function toYearMonth(value: string | undefined): YearMonth | undefined {
  if (value === undefined) return undefined
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (match?.[1] === undefined || match[2] === undefined) return undefined
  return { year: Number(match[1]), month: Number(match[2]) }
}
