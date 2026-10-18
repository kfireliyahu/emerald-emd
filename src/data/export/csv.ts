/**
 * The two CSVs docs/f10 asks for: the ledger as filtered, and the monthly
 * summary table.
 *
 * **Why only these two.** D-116 cut rule-set and mapping export because neither
 * had a named reader — a `.emd` is a plain SQLite file and `sqlite3`
 * opens it, so portability was never the thing missing. What was missing is the
 * one thing a database file cannot do: be opened in a spreadsheet by somebody
 * who wants to sort a year by amount. These two are that, and nothing else is.
 *
 * The rows are built here and turned into text by `domain/csv.ts`, which is
 * also where the formula-injection guard lives.
 */

import { toDecimalString } from '@/core/money.ts'
import { basisPointsText } from '@/core/percent.ts'
import { toISODate, toYearMonthString } from '@/core/time.ts'
import { toCsv } from '@/domain/csv.ts'
import type { MonthSummary } from '@/domain/model/statistics.ts'
import { listAccounts } from '../repositories/accountRepository.ts'
import {
  listTransactions,
  DEFAULT_SORT,
  type TransactionFilter,
  type TransactionSort,
} from '../repositories/transactionRepository.ts'
import type { Database } from 'sql.js'

/**
 * SQLite reads a negative `LIMIT` as no limit at all.
 *
 * The ledger caps at 500 because a screen has to. An export must not: the same
 * argument `summarizeTransactions` makes about totals — the honest total of
 * "everything at Shufersal this year" is not the total of the first 500 rows of
 * it — applies twice over to a file the user is about to do their own sums in.
 */
const NO_LIMIT = -1

const TRANSACTION_HEADER = [
  'Transaction date',
  'Charge date',
  'Billing period',
  'Account',
  'Merchant',
  'Category',
  'Amount',
  'Currency',
  'Direction',
  'Provider category',
  'Card',
  'Installment',
  'Left out of totals',
  'Note',
] as const

/**
 * The ledger, exactly as the filters leave it, with categories resolved.
 *
 * Both dates, because docs/05 is emphatic that they are not interchangeable and
 * a card statement proves it — every row of a Max file is charged on the same
 * day. A spreadsheet that had only one of them could not reproduce a figure the
 * app shows.
 */
export function transactionsCsv(
  db: Database,
  filter: TransactionFilter = {},
  sort: TransactionSort = DEFAULT_SORT,
): string {
  const names = new Map(listAccounts(db).map((account) => [account.id, account.name]))

  const rows = listTransactions(db, filter, NO_LIMIT, sort).map((row) => [
    toISODate(row.transactionDate),
    row.chargeDate === undefined ? '' : toISODate(row.chargeDate),
    row.billingPeriod === undefined ? '' : toYearMonthString(row.billingPeriod),
    names.get(row.accountId) ?? '',
    row.merchantRaw,
    row.categoryPath ?? '',
    toDecimalString(row.amount),
    row.amount.currency,
    row.direction,
    row.providerCategory ?? '',
    row.cardLast4 ?? '',
    row.installment === undefined ? '' : `${row.installment.sequence}/${row.installment.total}`,
    row.isExcludedFromStats || row.countedOnCard ? 'yes' : 'no',
    row.note ?? '',
  ])

  return toCsv([[...TRANSACTION_HEADER], ...rows])
}

const MONTH_HEADER = [
  'Month',
  'Income',
  'Expenses',
  'Balance',
  'Saved',
  'Savings rate %',
  'Transactions',
  'Complete',
] as const

/**
 * The monthly summary table, oldest first.
 *
 * `saved` sits beside the balance rather than inside it, which is docs/05's
 * rule that saving is not spending — and the column order here is the table's
 * own, so the file and the screen say the same thing in the same order.
 *
 * An unknown savings rate is an **empty cell, not a zero**: a month with no
 * income has no rate, and a spreadsheet averaging a column of zeroes would
 * invent an answer the app deliberately refuses to give.
 */
export function monthlySummaryCsv(months: readonly MonthSummary[]): string {
  const rows = months.map((month) => [
    toYearMonthString(month.period),
    toDecimalString(month.income),
    toDecimalString(month.expenses),
    toDecimalString(month.balance),
    toDecimalString(month.saved),
    percent(month.savingsRateBasisPoints),
    String(month.transactionCount),
    month.isComplete ? 'yes' : 'no',
  ])

  return toCsv([[...MONTH_HEADER], ...rows])
}

/**
 * Basis points as a plain percentage — `1250` → `12.5` — the way every screen
 * prints one (`basisPointsText`, M45 F1). A basis point has two decimals and
 * `toFixed(2)` of a whole number of them over a hundred lands on them exactly,
 * which matters because this column is one a user averages.
 */
function percent(basisPoints: number | undefined): string {
  return basisPoints === undefined ? '' : basisPointsText(basisPoints)
}
