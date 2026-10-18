import type { Database } from 'sql.js'

import { syncDiscoveredPayments } from './debtRepository.ts'

/**
 * **What a written payslip sets off** (M36 U01): the payments its lines make
 * on the debts they repay — an idempotent upsert, so a slip with nothing linked
 * costs a query and changes nothing, and a corrected or deleted slip moves its
 * payment rather than adding a second one.
 *
 * It had two halves (D-227) until M36 U05: the deposits a slip's saving lines owe
 * the goals they feed (D-075) are worked out on read now (`fedDeposits`, D-381),
 * so there is nothing of them to keep in step. Whatever writes a slip, or what a
 * slip's line points at, still calls this, for the debts.
 */
export function syncPayroll(db: Database, now: number): void {
  syncDiscoveredPayments(db, now)
}
