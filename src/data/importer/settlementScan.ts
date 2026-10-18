/**
 * Re-deriving card settlements over the ledger, after any commit.
 *
 * docs/f06's "card statement imported *after* the bank statement" edge case, and
 * its rule that **order of import must not matter**. This is the seam where
 * D-060's pure reading meets D-061's stored links: everything derivable is
 * computed fresh from what the ledger holds right now, and the one thing that
 * is not — the user's answer — is left exactly where it was.
 *
 * It runs after **every** commit rather than only after a bank one, which is
 * what makes the rule structural instead of a trigger someone has to remember.
 * A card statement landing is the event that turns an unattributable ₪4,210.55
 * bank row into a settlement with a billing period; the bank row has not
 * changed, and nothing about it needed to.
 */

import type { Database } from 'sql.js'

import { money } from '@/core/money.ts'
import { addMonths, parseISODate, parseYearMonth, toISODate, yearMonthOf } from '@/core/time.ts'
import { planBankImport, type BankImportPlan } from '@/domain/bankImport.ts'
import type {
  BankRow,
  CardAccountRef,
  CardPeriodTotal,
  UnmatchedSettlement,
} from '@/domain/model/banking.ts'
import { query } from '../db/database.ts'
import { listAccounts } from '../repositories/accountRepository.ts'
import {
  countedCardCharges,
  linkInputsFor,
  syncSettlementLinks,
  type SyncResult,
} from '../repositories/cardSettlementRepository.ts'
import { settlementAliasMap } from '../repositories/settlementAliasRepository.ts'

/**
 * How far back a rescan looks, in months, counted from the newest bank row in
 * the ledger rather than from a clock.
 *
 * Thirteen: a year of statements plus the month a settlement may lag its
 * period by. Counted from the data because there is no clock in this path and
 * introducing one would make the same document rescan differently on a
 * different day — the same reason `detectFixedExpenses` takes its `endingAt`
 * from the caller instead of reading `Date.now()`.
 */
export const RESCAN_MONTHS = 13

export interface ScanResult extends SyncResult {
  readonly bankRowsScanned: number
  readonly settlements: number
  /** Card charges whose card this document does not have. docs/f06's loud case. */
  readonly unmatched: number
}

/**
 * Bring the stored settlement links up to date with what the ledger now says.
 *
 * Returns what changed, so a commit can report "2 card charges matched" without
 * a second pass — and so a screen can tell the difference between "nothing to
 * do" and "nothing ran".
 */
export function rescanSettlements(db: Database, now: number): ScanResult {
  const { plan, rows } = readSettlementPlan(db)

  // The row `ref` is the transaction id: these rows came out of the ledger, not
  // out of a sheet, so the identity is already the one the link points at.
  //
  // The scanned ids go with them so a link whose row is no longer a settlement
  // is dropped rather than left behind — reachable since the user gained a way
  // to take back an answer about which merchant pays a card (D-069).
  const sync = syncSettlementLinks(db, linkInputsFor(plan.settlements, (ref) => ref), now, {
    scannedBankTransactionIds: rows.map((row) => row.ref),
  })

  return {
    ...sync,
    bankRowsScanned: rows.length,
    settlements: plan.settlements.length,
    unmatched: plan.unmatched.length,
  }
}

/**
 * The same reading, without writing anything.
 *
 * The screens need it for the half that has no row to read: an
 * `UnmatchedSettlement` is a card charge with no card to link it to, so it
 * cannot be stored and has to be re-derived every time it is shown. That is not
 * a compromise — it is the same fact as D-060's, which is that this reading
 * *is* the derived thing and only the user's answer survives it.
 */
export function readSettlementPlan(db: Database): {
  readonly plan: BankImportPlan
  readonly rows: readonly BankRow[]
} {
  const cards = cardAccounts(db)
  const rows = listBankRowsForScan(db)
  return {
    plan: planBankImport({
      rows,
      cards,
      cardPeriodTotals: listCardPeriodTotals(db, cards),
      // The user's own answers about which merchant pays which card (D-069).
      // Read here rather than passed in, because this is the one place the plan
      // is built — so an alias set today reaches the ledger, the pending queue
      // and every future import through the same re-derivation.
      settlementAliases: settlementAliasMap(db),
    }),
    rows,
  }
}

/**
 * Card charges this document cannot attribute — docs/f06's loud case.
 *
 * "₪890.20 charged to a card ending 9012, but no statement imported" means a
 * month of card spending is missing from the ledger and every statistic is
 * quietly wrong. It has no link and no card, so there is nothing to store and
 * nothing to answer; the only thing to do about it is import the statement.
 */
export function unmatchedSettlements(db: Database): readonly UnmatchedSettlement[] {
  // Less the rows somebody said to count as spending without a statement (M31 U1).
  const counted = countedCardCharges(db)
  return readSettlementPlan(db).plan.unmatched.flatMap((entry) => {
    const rows = entry.rows.filter((row) => !counted.has(row.ref))
    if (rows.length === entry.rows.length) return [entry]
    const first = rows[0]
    if (first === undefined) return []
    const total = rows.reduce((sum, row) => sum + Math.abs(row.amount.minor), 0)
    return [{ ...entry, rows, chargedTotal: money(total, first.amount.currency) }]
  })
}

/** Every credit card, archived ones included — a settlement does not stop being one. */
export function cardAccounts(db: Database): readonly CardAccountRef[] {
  return listAccounts(db, { includeArchived: true })
    .filter((account) => account.kind === 'CREDIT_CARD')
    .map((account) => ({
      id: account.id,
      name: account.name,
      last4: account.last4,
      excludeSettlementsFromStats: account.excludeSettlementsFromStats,
    }))
}

/**
 * The recent bank rows, oldest first, as the classifier takes them.
 *
 * `merchant_raw` and `merchant_normalized` both come across, and which one is
 * used for what is not the caller's choice to make: keywords match the
 * normalized text and the card's last-4 is read out of the raw one, because
 * normalization strips a trailing four-digit run as a branch number (D-060).
 *
 * No balance column: a running balance is verified at import time and never
 * stored (docs/f06), so a row read back out of the ledger has none. That is
 * why `verifyRunningBalance` belongs to the parse and not here.
 */
export function listBankRowsForScan(db: Database): readonly BankRow[] {
  const newest = query(
    db,
    `SELECT MAX(t.transaction_date) AS newest
       FROM fmt_transaction t JOIN fmt_account a ON a.id = t.account
      WHERE a.kind = 'BANK'`,
  )[0]?.['newest']
  if (newest == null) return []

  const latest = parseISODate(String(newest))
  if (latest === undefined) return []
  const from = addMonths(yearMonthOf(latest), -RESCAN_MONTHS)

  return query(
    db,
    `SELECT t.id, t.transaction_date, t.amount_minor, t.amount_currency AS currency,
            t.merchant_raw, t.merchant_normalized
       FROM fmt_transaction t JOIN fmt_account a ON a.id = t.account
      WHERE a.kind = 'BANK' AND t.transaction_date >= ?
      ORDER BY t.transaction_date, t.id`,
    [toISODate({ ...from, day: 1 })],
  ).flatMap((row) => {
    const date = parseISODate(String(row['transaction_date']))
    if (date === undefined) return []
    return [
      {
        ref: String(row['id']),
        date,
        amount: money(Number(row['amount_minor']), String(row['currency'])),
        descriptionRaw: String(row['merchant_raw']),
        descriptionNormalized: String(row['merchant_normalized']),
      },
    ]
  })
}

/**
 * What each card statement in the ledger came to, per billing period.
 *
 * Grouped by currency as well as period, because a card that billed in two is
 * two totals and adding them would need a rate this document does not have
 * (D-003). A period with no `billing_period` recorded contributes nothing —
 * there is no statement to be the total of.
 */
export function listCardPeriodTotals(
  db: Database,
  cards: readonly CardAccountRef[],
): readonly CardPeriodTotal[] {
  if (cards.length === 0) return []

  const placeholders = cards.map(() => '?').join(', ')
  return query(
    db,
    `SELECT account AS account_id, billing_period, amount_currency AS currency, SUM(amount_minor) AS total
       FROM fmt_transaction
      WHERE billing_period IS NOT NULL
        AND account IN (${placeholders})
      GROUP BY account, billing_period, amount_currency`,
    cards.map((card) => card.id),
  ).flatMap((row) => {
    const period = parseYearMonth(String(row['billing_period']))
    if (period === undefined) return []
    return [
      {
        accountId: String(row['account_id']),
        period,
        total: money(Number(row['total']), String(row['currency'])),
      },
    ]
  })
}
