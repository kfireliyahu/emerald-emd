import type { Database } from 'sql.js'

import type { CurrencyCode } from '@/core/money.ts'
import {
  addMonths,
  compareYearMonths,
  parseYearMonth,
  toYearMonthString,
  yearMonthOf,
  type LocalDate,
  type YearMonth,
} from '@/core/time.ts'
import { attention, type AttentionItem } from '@/domain/home.ts'
import { statementGaps, type AccountMonths, type StatementGap } from '@/domain/statementGaps.ts'
import { unmatchedSettlements } from '../importer/settlementScan.ts'
import { query } from '../db/database.ts'
import type { NetWorth } from '@/domain/netWorth.ts'
import { listAccounts } from './accountRepository.ts'
import { merchantQueue } from './labelingQueueRepository.ts'

import { billCandidates } from './fixedExpenseRepository.ts'
import { startCount } from './formatLinkViewRepository.ts'
import { readFormat } from './formatRepository.ts'
import { netWorth } from './netWorthRepository.ts'
import { listPaychecks, readNoPayMonths } from './paycheckRepository.ts'
import { staleHoldings } from './savingsRepository.ts'
import { countTransactions } from './transactionRepository.ts'

/**
 * Everything the home screen shows, from one load of the document.
 *
 * D-071's rule, applied to the screen that has the most ways to contradict
 * itself: the net worth and the list of things to do are views of one load, so
 * a figure here and the same figure on the screen it links to cannot disagree.
 *
 * **Nothing is recomputed.** The net worth is `netWorth`, the one figure (M36 U07), and the rest are
 * counts. A dashboard is the one screen where writing "just the headline
 * number" by hand is most tempting and worst: it is the screen people trust
 * without opening the other ones.
 *
 * **The month left this call in D-157** and did not move — it was always
 * `monthlyReport`, the same call the month screen made, and the two screens are
 * one screen now. So Home makes that read once instead of twice, and this
 * function no longer makes the most expensive read in the app (D-118) for a
 * headline that is drawn beneath it anyway.
 */
export interface HomeSummary {
  readonly period: YearMonth
  readonly netWorth: NetWorth
  readonly attention: readonly AttentionItem[]
  /** True when the document has no transactions, no paychecks and no wealth at all. */
  readonly isEmpty: boolean
}

export function homeSummary(
  db: Database,
  asOf: LocalDate,
  currency: CurrencyCode,
): HomeSummary {
  const period = yearMonthOf(asOf)
  const worth = netWorth(db, asOf, currency)
  const paychecks = listPaychecks(db)

  return {
    period,
    netWorth: worth,
    attention: waitingItems(db, asOf, currency),
    // A count rather than `monthlyReport().months.length`, which is the same
    // answer for four hundred times the work.
    isEmpty: countTransactions(db) === 0 && paychecks.length === 0 && worth.isEmpty,
  }
}

/**
 * Everything waiting for an answer, most consequential first (M31 U1) — Home's
 * list and the notice bar on every other screen read this one call, so the
 * count in the bar and the rows on Home cannot disagree. Derived on read; the
 * only thing stored is each answer, where its own screen stores it.
 */
export function waitingItems(db: Database, asOf: LocalDate, currency: CurrencyCode): readonly AttentionItem[] {
  const period = yearMonthOf(asOf)
  const noPay = readNoPayMonths(db)
  const missing = missingPayslip(listPaychecks(db).map((one) => one.period), period)
  // What By merchant still asks about — a skipped merchant is answered, for
  // now, so its rows are not counted as waiting (the guide reads the same queue).
  const { waiting } = merchantQueue(db)
  return attention({
    // The questions the ledger's start views ask (M36 U06), counted here as
    // `start_here` lists them — one declaration, so the two cannot disagree.
    pendingSettlements: waitingIn(db, 'card_settlement_link'),
    pendingTransfers: waitingIn(db, 'transfer_pair'),
    unmatchedCharges: unmatchedSettlements(db).length,
    missingStatements: waitingStatements(db).length,
    uncategorized: waiting.reduce((sum, group) => sum + group.count, 0),
    uncategorizedMerchants: waiting.length,
    unconfirmedPayments: waitingIn(db, 'debt_payment'),
    // The detector Plan shows, over the months before this one (M31 U1): a bill
    // is tracked without a plan, so it waits here whether or not one exists.
    fixedExpenseCandidates: billCandidates(db, addMonths(period, -1)).length,
    // A fund is a holding (D-389): one with no reading yet is worth nothing anyone has read.
    fundsWithoutBalance: Number(
      query(
        db,
        'SELECT COUNT(*) AS n FROM fmt_holding WHERE fund_type IS NOT NULL AND id NOT IN (SELECT holding FROM fmt_holding_reading)',
      )[0]?.['n'] ?? 0,
    ),
    unconfirmedHoldings: staleHoldings(db, asOf, currency).length,
    missingPayslipFor: missing !== undefined && noPay.has(toYearMonthString(missing)) ? undefined : missing,
  })
}

/**
 * How many rows one of the ledger's start views finds — none when the document
 * has put the view away, because the view is the question and nobody is asking.
 */
export function waitingIn(db: Database, format: string): number {
  const declaration = readFormat(db, format)
  return declaration === undefined ? 0 : (startCount(db, declaration) ?? 0)
}

/**
 * The statements missing for the newest month the document holds — the month
 * an import just landed in. Older gaps stay rows of Home's *All months*.
 */
export function waitingStatements(db: Database): readonly StatementGap[] {
  const accounts = accountMonths(db)
  const newest = accounts
    .flatMap((one) => one.months)
    .reduce<YearMonth | undefined>((best, one) => (best === undefined || compareYearMonths(one, best) > 0 ? one : best), undefined)
  if (newest === undefined) return []
  return statementGaps(accounts, newest).filter((gap) => compareYearMonths(gap.period, newest) === 0)
}


/**
 * The last complete month, when there are payslips before it and none in it.
 *
 * **Not the current month**, which is usually not paid yet, and **not a
 * document with no payslips at all** — that is somebody who does not track
 * paychecks here, and telling them one is missing would be the app inventing a
 * chore out of a feature they declined.
 */
function missingPayslip(
  periods: readonly YearMonth[],
  current: YearMonth,
): YearMonth | undefined {
  if (periods.length === 0) return undefined

  const last = addMonths(current, -1)
  const hasLast = periods.some((one) => compareYearMonths(one, last) === 0)
  if (hasLast) return undefined

  // Only if a payslip exists for some month before it. A first payslip entered
  // this month is not evidence that last month's is late.
  const hasEarlier = periods.some((one) => compareYearMonths(one, last) < 0)
  return hasEarlier ? last : undefined
}

/**
 * Every statement account and the months it has rows in — what
 * `statementGaps` reads a missing statement off (M28 U5).
 *
 * Cards and banks only, and not an archived one: cash has no statement, and an
 * account put away is not one anybody is expected to read again. Dated the way
 * every total on Home is, on the day money left the account.
 */
export function accountMonths(db: Database): readonly AccountMonths[] {
  const accounts = listAccounts(db).filter((one) => one.kind !== 'CASH')
  if (accounts.length === 0) return []
  const rows = query(
    db,
    `SELECT DISTINCT account, substr(COALESCE(charge_date, transaction_date), 1, 7) AS period
       FROM fmt_transaction`,
  )
  const byAccount = new Map<string, YearMonth[]>()
  for (const row of rows) {
    const period = parseYearMonth(String(row['period']))
    if (period === undefined) continue
    const id = String(row['account'])
    byAccount.set(id, [...(byAccount.get(id) ?? []), period])
  }
  return accounts.map((account) => ({
    accountId: account.id,
    name: account.name,
    last4: account.last4,
    months: byAccount.get(account.id) ?? [],
  }))
}
