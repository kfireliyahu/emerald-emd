import type { Database } from 'sql.js'

import { money, type CurrencyCode, type Money } from '@/core/money.ts'
import { parseISODate, toISODate, type LocalDate } from '@/core/time.ts'
import { openingCheck, type OpeningCheck } from '@/domain/accountBalances.ts'
import type { BalanceCheck } from '@/domain/bankImport.ts'
import { query } from '../db/database.ts'
import { type AccountKind, listAccounts } from './accountRepository.ts'

/**
 * One account's balance sheet: what it held before the statements, what they
 * moved, what the last one ended on, and whether those agree (M28 U8, D-325).
 *
 * **The balance is the last statement's, not a running guess.** Only a bank
 * statement that printed a running balance and passed the arithmetic over it
 * (`VERIFIED`, D-138) offers one; a card statement offers none, and an account
 * with no such statement reports `undefined` rather than a computed figure
 * pretending to be one.
 */
export interface AccountBalance {
  readonly accountId: string
  readonly name: string
  readonly kind: AccountKind
  readonly last4: string | undefined
  readonly opening: Money | undefined
  /** The day the opening balance stands for everything before. */
  readonly openingDate: LocalDate | undefined
  /** What the account's transactions moved on or after the opening date. */
  readonly moved: Money
  /** The balance the latest verified statement ended on. */
  readonly statementBalance: Money | undefined
  /**
   * The last day the statement that balance came from covers (M28 F24, F26) —
   * the period it printed, or its own last row, so it is the balance's date and
   * not the account's.
   */
  readonly balanceTo: LocalDate | undefined
  /**
   * A statement read that covers later than the balance and offered none that
   * adds up — a running balance that diverged, or no balance column at all. Set,
   * the balance is **older than the newest statement read**, and says so.
   */
  readonly newerWithoutBalance: { readonly fileName: string; readonly to: LocalDate } | undefined
  /** The last day the account's statements cover: its newest transaction (M28 F10). */
  readonly statementTo: LocalDate | undefined
  readonly check: OpeningCheck
}

/** Set — or with `undefined`, forget — an account's opening balance and its date. */
export function setOpeningBalance(
  db: Database,
  accountId: string,
  opening: { readonly amount: Money; readonly date: LocalDate } | undefined,
  _now: number,
): void {
  db.run(
    `UPDATE fmt_account
        SET opening_balance_minor = ?, opening_balance_currency = ?, opening_date = ?
      WHERE id = ?`,
    [
      opening?.amount.minor ?? null,
      opening?.amount.currency ?? null,
      opening === undefined ? null : toISODate(opening.date),
      accountId,
    ],
  )
}

/**
 * The accounts that carry a balance — banks and cash — each with its check.
 *
 * An account with holdings is not one of them (M30 U1, D-354): what sits
 * there is a place's holdings, cash among them, and not money in the bank.
 */
export function accountBalances(db: Database, currency: CurrencyCode): readonly AccountBalance[] {
  const accounts = listAccounts(db).filter((account) => account.kind === 'BANK' || account.kind === 'CASH')
  if (accounts.length === 0) return []

  const stored = new Map(
    query(
      db,
      `SELECT id, opening_balance_minor, opening_balance_currency, opening_date FROM fmt_account`,
    ).map((row) => [String(row['id']), row] as const),
  )

  return accounts.map((account): AccountBalance => {
    const row = stored.get(account.id)
    const minor = row?.['opening_balance_minor']
    const openingCurrency = row?.['opening_balance_currency']
    const openingAmount =
      typeof minor === 'number' && typeof openingCurrency === 'string'
        ? money(minor, openingCurrency as CurrencyCode)
        : undefined
    const dateText = row?.['opening_date']
    const openingDate = typeof dateText === 'string' ? parseISODate(dateText) : undefined

    const openingText = openingDate === undefined ? null : toISODate(openingDate)
    const latest = latestStatementBalance(db, account.id)
    // What moved is counted up to the balance's own day, so an older balance is
    // checked against the movement it actually ends — not against rows after it.
    const untilText = latest.balance?.to === undefined ? null : toISODate(latest.balance.to)
    const movedRow = query(
      db,
      `SELECT COALESCE(SUM(amount_minor), 0) AS total
         FROM fmt_transaction
        WHERE account = ? AND amount_currency = ?
          AND (? IS NULL OR transaction_date >= ?)
          AND (? IS NULL OR transaction_date <= ?)`,
      [account.id, currency, openingText, openingText, untilText, untilText],
    )[0]
    const moved = money(Number(movedRow?.['total'] ?? 0), currency)
    const statementBalance = latest.balance?.amount
    const lastText = query(db, 'SELECT MAX(transaction_date) AS last FROM fmt_transaction WHERE account = ?', [account.id])[0]?.['last']

    return {
      accountId: account.id,
      name: account.name,
      kind: account.kind,
      last4: account.last4,
      opening: openingAmount,
      openingDate,
      moved,
      statementBalance,
      balanceTo: latest.balance?.to,
      newerWithoutBalance: latest.newerWithoutBalance,
      statementTo: typeof lastText === 'string' ? parseISODate(lastText) : undefined,
      check: openingCheck(openingAmount, moved, statementBalance),
    }
  })
}

interface LatestBalance {
  readonly balance: { readonly amount: Money; readonly to: LocalDate | undefined } | undefined
  readonly newerWithoutBalance: { readonly fileName: string; readonly to: LocalDate } | undefined
}

/**
 * The closing balance of the statement that **covers the latest days**, not
 * the one imported last (M28 F24).
 *
 * The order used to be `committed DESC`, which is the order the files were
 * read in. Read an August-to-October statement, then January's, and January's
 * closing balance was the account's — two months stale, under the newest
 * statement's date. A batch commits every file at one instant, too, so inside a
 * batch that order was no order at all.
 *
 * **A statement's last day is the file's, recorded when it was read** (M28
 * F26): the period it printed for itself when that holds, else its last row —
 * every row, the ones another statement already held among them. Its own
 * committed rows (`fmt_transaction.statement`) are only the fallback, for a
 * statement read before the days were kept: January to August read after
 * August to October loses 1-6 August as duplicates, and by its rows ends on
 * 30 July while its closing balance is 6 August's — so the balance was dated
 * a week early and what moved stopped short of it.
 *
 * A statement that owns no rows has no period, and sorts after every one that
 * does — its balance is used only when no dated statement offers one, and then
 * without a date. The import time breaks what is left.
 */
function latestStatementBalance(db: Database, accountId: string): LatestBalance {
  const rows = query(
    db,
    `SELECT s.file_name, s.balance_check,
            COALESCE(
              s.printed_to,
              s.covers_to,
              (SELECT MAX(t.transaction_date) FROM fmt_transaction t WHERE t.statement = s.id)
            ) AS last_day
       FROM fmt_statement s
      WHERE s.account = ? AND s.status = 'COMMITTED'
      ORDER BY last_day IS NULL, last_day DESC, s.committed DESC, s.started DESC`,
    [accountId],
  )
  let newest: { readonly fileName: string; readonly to: LocalDate } | undefined
  for (const row of rows) {
    const lastDay = row['last_day']
    const to = typeof lastDay === 'string' ? parseISODate(lastDay) : undefined
    if (newest === undefined && to !== undefined) newest = { fileName: String(row['file_name'] ?? ''), to }
    const closing = verifiedClosing(row['balance_check'])
    if (closing === undefined) continue
    return {
      balance: { amount: closing, to },
      newerWithoutBalance:
        newest !== undefined && (to === undefined || toISODate(newest.to) > toISODate(to)) ? newest : undefined,
    }
  }
  return { balance: undefined, newerWithoutBalance: undefined }
}

function verifiedClosing(raw: unknown): Money | undefined {
  if (typeof raw !== 'string') return undefined
  try {
    const parsed = JSON.parse(raw) as BalanceCheck
    return parsed.kind === 'VERIFIED' ? parsed.closingBalance : undefined
  } catch {
    // A mangled value reads as no check recorded (D-031).
    return undefined
  }
}
