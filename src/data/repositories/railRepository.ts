/**
 * **What a ledger document holds, as the rail asks it** — M59 U6 (D-582, the
 * picks D-577 settled).
 *
 * A new ledger document shows the three workflows' places and holds the rest
 * back until the document has something for them. Each answer here is one place
 * coming back; they are asked every time the rail is drawn and never stored, so
 * a place returns the moment its first row exists and goes again if the last
 * one is deleted. Presentation only: nothing reads these to decide what a
 * person or a conversation may do.
 */

import type { Database } from 'sql.js'

import { query } from '@/data/db/database.ts'

import { UNCATEGORIZED_ID } from './categoryRepository.ts'
import { dashboardBlocks } from './formatViewRepository.ts'
import { countsCondition } from './movedRepository.ts'

export interface LedgerHolds {
  /** Transactions in two or more calendar months: Home's Year. */
  readonly severalMonths: boolean
  /** A paycheck: Paychecks, and Home's Taxes figure. */
  readonly paycheck: boolean
  /** A plan, a bill, or a month with rows and none of them uncategorized: Plan. */
  readonly plan: boolean
  /**
   * A goal, a debt, a fund or a fund report, an account with holdings, a place
   * kept by hand, or an account's opening balance: Wealth.
   */
  readonly wealth: boolean
  /** A block on the document's own dashboard: Dashboard. */
  readonly dashboard: boolean
}

/** The month a row is in, on the basis the monthly totals use (D-006). */
const MONTH = 'substr(COALESCE(t.charge_date, t.transaction_date), 1, 7)'

export function ledgerHolds(db: Database): LedgerHolds {
  const [row] = query(
    db,
    `SELECT
       (SELECT COUNT(DISTINCT ${MONTH}) FROM fmt_transaction t) AS months,
       EXISTS (SELECT 1 FROM fmt_paycheck) AS paycheck,
       EXISTS (SELECT 1 FROM fmt_split_plan) OR EXISTS (SELECT 1 FROM fmt_fixed_expense) OR EXISTS (
         SELECT 1 FROM fmt_transaction t
          WHERE ${countsCondition('t')}
          GROUP BY ${MONTH}
         HAVING SUM(CASE WHEN t.category IS NULL OR t.category = ? THEN 1 ELSE 0 END) = 0
       ) AS plan,
       EXISTS (SELECT 1 FROM fmt_saving_goal)
         OR EXISTS (SELECT 1 FROM fmt_debt)
         OR EXISTS (SELECT 1 FROM fmt_holding WHERE fund_type IS NOT NULL)
         OR EXISTS (SELECT 1 FROM fmt_holding_reading)
         OR EXISTS (SELECT 1 FROM fmt_account WHERE kind = 'HOLDINGS')
         OR EXISTS (SELECT 1 FROM fmt_holding_place)
         OR EXISTS (SELECT 1 FROM fmt_account WHERE opening_balance_minor IS NOT NULL) AS wealth`,
    [UNCATEGORIZED_ID],
  )
  const yes = (key: string): boolean => Number(row?.[key] ?? 0) > 0
  return {
    severalMonths: Number(row?.['months'] ?? 0) >= 2,
    paycheck: yes('paycheck'),
    plan: yes('plan'),
    wealth: yes('wealth'),
    // The engine's own table, asked through the engine (the ledger's SQL names only its own).
    dashboard: dashboardBlocks(db, undefined).length > 0,
  }
}

/** Whether the document holds a paycheck — Home's Taxes figure asks only this. */
export function holdsPaycheck(db: Database): boolean {
  return query(db, 'SELECT EXISTS (SELECT 1 FROM fmt_paycheck) AS any')[0]?.['any'] === 1
}
