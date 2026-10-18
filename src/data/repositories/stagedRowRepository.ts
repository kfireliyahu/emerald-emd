/**
 * Staged rows in and out of SQLite — the pre-commit staging area of
 * docs/04-data-model.md, persisted so an interrupted import survives the tab
 * being closed. Rows of the ledger pack's `staged_row` since M25 U3b: the
 * resume was kept rather than hold a review in memory (D-277).
 *
 * The parsed draft is stored as columns rather than a blob, so the counts and
 * the filter the review screen runs are SQL rather than a pass over every row
 * in JavaScript.
 */

import type { Database } from 'sql.js'

import { money } from '@/core/money.ts'
import { parseISODate, parseYearMonth, toISODate, toYearMonthString, type YearMonth } from '@/core/time.ts'
import type {
  Direction,
  DraftTransaction,
  StagedRow,
  StagedRowStatus,
  UserDecision,
} from '@/domain/model/importing.ts'
import { stringListOf } from '@/domain/format/stringList.ts'
import { query } from '../db/database.ts'
import { declared } from '../packs/ledger/tables.ts'
import { insertRows } from './formatRowRepository.ts'

export interface InsertableStagedRow {
  readonly id: string
  readonly sessionId: string
  readonly rowIndex: number
  readonly rawCells: readonly string[]
  readonly status: StagedRowStatus
  readonly decision: UserDecision
  readonly errorMessage: string | undefined
  readonly suggestedCategoryId: string | undefined
  readonly suggestedRuleId: string | undefined
  readonly chosenCategoryId: string | undefined
  readonly transaction: DraftTransaction | undefined
  readonly naturalKey: string | undefined
  readonly billingPeriod: YearMonth | undefined
}

/** A rate's fixed-point scale — `exchange_rate` is a decimal of six places (D-257). */
const RATE_SCALE = 1_000_000

/** A whole staging in one write of the pack's table, as a statement's lines commit (M25 U3). */
export function insertStagedRows(db: Database, rows: readonly InsertableStagedRow[], _now: number): void {
  if (rows.length === 0) return
  insertRows(db, declared(db, 'staged_row'), rows.map(cellsOf), rows.map((row) => row.id))
}

function cellsOf(row: InsertableStagedRow): Record<string, string | number | null> {
  const parsed = row.transaction
  const original = parsed?.installment?.originalTotal
  const rate = parsed?.foreign?.exchangeRate
  return {
    merchant_raw: parsed?.merchantRaw ?? null,
    statement: row.sessionId,
    row_index: row.rowIndex,
    raw_cells: JSON.stringify(row.rawCells),
    status: row.status,
    user_decision: row.decision,
    error_message: row.errorMessage ?? null,
    suggested_category: row.suggestedCategoryId ?? null,
    suggested_rule: row.suggestedRuleId ?? null,
    chosen_category: row.chosenCategoryId ?? null,
    transaction_date: parsed === undefined ? null : toISODate(parsed.transactionDate),
    charge_date: parsed?.chargeDate === undefined ? null : toISODate(parsed.chargeDate),
    billing_period: row.billingPeriod === undefined ? null : toYearMonthString(row.billingPeriod),
    amount_minor: parsed?.amount.minor ?? null,
    amount_currency: parsed?.amount.currency ?? null,
    direction: parsed?.direction ?? null,
    merchant_normalized: parsed?.merchantNormalized ?? null,
    provider_category: parsed?.providerCategory ?? null,
    card_last4: parsed?.cardLast4 ?? null,
    reference: parsed?.reference ?? null,
    note: parsed?.note ?? null,
    installment_sequence: parsed?.installment?.sequence ?? null,
    installment_total: parsed?.installment?.total ?? null,
    installment_group_key: parsed?.installment?.groupKey ?? null,
    // The currency is the row's own — see 007: a total in another would be a conversion.
    original_total_minor: original?.minor ?? null,
    original_total_currency: original === undefined ? null : original.currency,
    foreign_amount_minor: parsed?.foreign?.originalAmount.minor ?? null,
    foreign_amount_currency: parsed?.foreign?.originalAmount.currency ?? null,
    exchange_rate: rate === undefined ? null : Math.round(rate * RATE_SCALE),
    natural_key: row.naturalKey ?? null,
    source_row_ref: parsed?.sourceRowRef ?? null,
    holding: parsed?.holdingId ?? null,
    quantity: parsed?.quantityMicro ?? null,
  }
}

export interface StagedRowFilter {
  readonly status?: StagedRowStatus | undefined
  readonly decision?: UserDecision | undefined
}

/**
 * A page of the review table, in sheet order.
 *
 * Sheet order, not date order: the review screen sits next to the file the rows
 * came from, and "row 41 failed" has to be findable by scrolling to row 41.
 */
export function listStagedRows(
  db: Database,
  sessionId: string,
  filter: StagedRowFilter = {},
  limit = 5000,
): readonly StagedRow[] {
  const conditions = ['statement = ?']
  const params: (string | number)[] = [sessionId]

  if (filter.status !== undefined) {
    conditions.push('status = ?')
    params.push(filter.status)
  }
  if (filter.decision !== undefined) {
    conditions.push('user_decision = ?')
    params.push(filter.decision)
  }
  params.push(limit)

  return query(
    db,
    `SELECT * FROM fmt_staged_row WHERE ${conditions.join(' AND ')} ORDER BY row_index LIMIT ?`,
    params,
  ).map(toDomain)
}

/**
 * The bulk action the review screen is built around: accept everything that is
 * genuinely new, leaving duplicates, failures and skipped rows alone.
 *
 * Scoped to `NEW` on purpose. Accepting a duplicate cannot produce a
 * transaction — the ledger's unique index refuses it — so offering it would be
 * a button that silently does nothing.
 */
export function acceptAllNew(db: Database, sessionId: string, _now: number): void {
  db.run(`UPDATE fmt_staged_row SET user_decision = 'ACCEPT' WHERE statement = ? AND status = 'NEW'`, [
    sessionId,
  ])
}

function toDomain(row: Record<string, unknown>): StagedRow {
  const text = (key: string): string | undefined => {
    const value = row[key]
    return value === null || value === undefined ? undefined : String(value)
  }

  return {
    id: String(row['id']),
    sessionId: String(row['statement']),
    rowIndex: Number(row['row_index']),
    rawCells: parseCells(row['raw_cells']),
    status: String(row['status']) as StagedRowStatus,
    decision: String(row['user_decision']) as UserDecision,
    errorMessage: text('error_message'),
    suggestedCategoryId: text('suggested_category'),
    suggestedRuleId: text('suggested_rule'),
    chosenCategoryId: text('chosen_category'),
    naturalKey: text('natural_key'),
    billingPeriod: yearMonthIn(text('billing_period')),
    transaction: toDraft(row, text),
  }
}

function yearMonthIn(value: string | undefined): YearMonth | undefined {
  return value === undefined ? undefined : parseYearMonth(value)
}

/**
 * The parsed draft, or undefined when the row never became one.
 *
 * A missing date or amount is the signal, not the status: a `PARSE_ERROR` row
 * has neither, and reconstructing half a transaction from the columns that did
 * survive would produce something the review screen would render as real.
 */
function toDraft(
  row: Record<string, unknown>,
  text: (key: string) => string | undefined,
): DraftTransaction | undefined {
  const dateText = text('transaction_date')
  const amountMinor = row['amount_minor']
  if (dateText === undefined || typeof amountMinor !== 'number') return undefined

  const transactionDate = parseISODate(dateText)
  if (transactionDate === undefined) return undefined

  const chargeDateText = text('charge_date')
  const sequence = row['installment_sequence']
  const total = row['installment_total']
  const originalTotalMinor = row['original_total_minor']
  const foreignMinor = row['foreign_amount_minor']
  const foreignCurrency = text('foreign_amount_currency')
  const exchangeRate = row['exchange_rate']

  return {
    transactionDate,
    chargeDate: chargeDateText === undefined ? undefined : parseISODate(chargeDateText),
    amount: money(amountMinor, String(row['amount_currency'])),
    direction: String(row['direction']) as Direction,
    merchantRaw: String(row['merchant_raw'] ?? ''),
    merchantNormalized: String(row['merchant_normalized'] ?? ''),
    providerCategory: text('provider_category'),
    cardLast4: text('card_last4'),
    reference: text('reference'),
    note: text('note'),
    installment:
      typeof sequence === 'number' && typeof total === 'number'
        ? {
            sequence,
            total,
            groupKey: text('installment_group_key') ?? '',
            originalTotal:
              typeof originalTotalMinor === 'number'
                ? money(originalTotalMinor, String(row['original_total_currency'] ?? row['amount_currency']))
                : undefined,
          }
        : undefined,
    foreign:
      typeof foreignMinor === 'number' && foreignCurrency !== undefined
        ? {
            originalAmount: money(foreignMinor, foreignCurrency),
            exchangeRate: typeof exchangeRate === 'number' ? exchangeRate / RATE_SCALE : undefined,
          }
        : undefined,
    sourceRowRef: String(row['source_row_ref'] ?? ''),
    holdingId: text('holding'),
    quantityMicro: typeof row['quantity'] === 'number' ? row['quantity'] : undefined,
  }
}

/**
 * Raw cells survive a mangled document the same way a mapping does: by
 * degrading, not throwing — to no cells, never to cells coerced out of
 * whatever was there (M45 F1).
 */
function parseCells(value: unknown): readonly string[] {
  return stringListOf(value) ?? []
}
