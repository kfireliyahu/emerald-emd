import type { Database } from 'sql.js'

import { money, type CurrencyCode, type Money } from '@/core/money.ts'
import { applyBasisPoints } from '@/core/percent.ts'
import type { LocalDate } from '@/core/time.ts'
import { cushionSplit, type CushionSplit } from '@/domain/cushion.ts'
import { MAX_CUSHION_MONTHS, MONTH_BASIS_POINTS, isCushionMonths, monthsToBasisPoints } from '@/domain/goalDeposits.ts'
import { inTransaction, query } from '../db/database.ts'
import { declared } from '../packs/ledger/tables.ts'
import { accountBalances } from './accountBalanceRepository.ts'
import { cushionBuckets, type CushionBucket } from './cushionBucketRepository.ts'
import { updateRow } from './formatRowRepository.ts'
import { goalParts, monthlyExpenses } from './savingsRepository.ts'
import { readJsonSetting, writeSetting } from './settingsRepository.ts'
import { setBucketInCushion } from './splitPlanRepository.ts'

/**
 * **The cushion is what is left in the bank** (M30 U7, D-360).
 *
 * It was the Emergency goal (D-324): a goal whose target was n months of fixed
 * expenses and whose deposits were the cushion. The point (2026-10-04): someone
 * saving for something specific outside the cushion saves it in the same bank,
 * so what is in the bank has to be split across those. Now:
 *
 * - **Every bank account and cash counts until the person unticks it** — `in_cushion`
 *   on the account, where only a `0` leaves one out (M31 U5, D-371).
 * - **Their latest statements are what is in the bank** (D-325, M28 F24).
 * - **Each goal saved in one of them holds its part**: its deposits into that
 *   account's own cash holding (D-354).
 * - **The cushion is what is left**, against a target of n months of fixed
 *   expenses and the Plan buckets ticked beside them (D-328, M28 F10).
 *
 * The months are the document's, a ledger setting, and no goal holds them.
 * Setting them makes no goal: an Emergency goal a document already has is an
 * ordinary goal now, and if its money is in a ticked account it is a part like
 * any other.
 */

const SETTING = 'cushion'

export class BadCushionMonthsError extends Error {
  constructor() {
    super(`The cushion is a number of months above 0 and at most ${String(MAX_CUSHION_MONTHS)}.`)
    this.name = 'BadCushionMonthsError'
  }
}

export class NotACushionAccountError extends Error {
  constructor(readonly accountId: string) {
    super('Only a bank account or cash can count toward the cushion: a card holds no money, and an account with holdings is not the bank.')
    this.name = 'NotACushionAccountError'
  }
}

/** The cushion's months as basis points, or undefined while none is set. */
function cushionMonthsBasisPoints(db: Database): number | undefined {
  const value = readJsonSetting(db, SETTING)?.['monthsBasisPoints']
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/** Set the cushion to n months of fixed expenses. It makes nothing: the months are the document's. */
export function setCushionMonths(db: Database, months: number, now: number): void {
  if (!isCushionMonths(months)) throw new BadCushionMonthsError()
  const current = readJsonSetting(db, SETTING) ?? {}
  writeSetting(db, SETTING, JSON.stringify({ ...current, monthsBasisPoints: monthsToBasisPoints(months) }), now)
}

/**
 * Tick or untick Plan's buckets as counted in the cushion (M28 F10). Every id must be a bucket the
 * document holds; nothing is written unless all of them are.
 */
export function setCushionBuckets(
  db: Database,
  changes: readonly { readonly bucketId: string; readonly included: boolean }[],
  now: number,
): void {
  inTransaction(db, () => {
    for (const change of changes) setBucketInCushion(db, change.bucketId, change.included, now)
  })
}

/**
 * Tick or untick bank accounts as counting toward the cushion. Every id must be an account that
 * carries a balance — a bank account or cash — or nothing is written.
 */
export function setCushionAccounts(
  db: Database,
  changes: readonly { readonly accountId: string; readonly counts: boolean }[],
  _now: number,
): void {
  const eligible = new Set(cushionAccountIds(db))
  const wrong = changes.find((change) => !eligible.has(change.accountId))
  if (wrong !== undefined) throw new NotACushionAccountError(wrong.accountId)
  const accounts = declared(db, 'account')
  inTransaction(db, () => {
    for (const change of changes) updateRow(db, accounts, change.accountId, { in_cushion: change.counts ? 1 : 0 })
  })
}

/** The accounts the cushion can count: the ones that carry a balance (D-354 leaves out holds-things). */
function cushionAccountIds(db: Database): readonly string[] {
  return accountBalances(db, 'ILS').map((account) => account.accountId)
}

/** One account as the card lists it: its balance, the statement's day, and whether it counts. */
export interface CushionAccount {
  readonly accountId: string
  readonly name: string
  readonly last4: string | undefined
  readonly balance: Money | undefined
  readonly balanceTo: LocalDate | undefined
  readonly counts: boolean
}

export interface CushionReading {
  /** Months, as a plain number: 3, 4.5. Undefined while none is set. */
  readonly months: number | undefined
  /** The target in money; undefined until there are months and fixed expenses to multiply. */
  readonly target: Money | undefined
  /** Plan's buckets this month, and which of them the months count beside the fixed expenses (M28 F10). */
  readonly buckets: readonly CushionBucket[]
  /** Every account that could count, ticked or not. */
  readonly accounts: readonly CushionAccount[]
  /** What is in the ticked accounts, each goal's part, the cushion and the checks. */
  readonly split: CushionSplit
  /** The cushion less its target: positive is above it. Undefined without both. */
  readonly above: Money | undefined
}

/** The cushion as Overview, Plan and `set_cushion` show it. */
export function cushionReading(db: Database, asOf: LocalDate, currency: CurrencyCode): CushionReading {
  const basisPoints = cushionMonthsBasisPoints(db)
  const buckets = cushionBuckets(db, asOf, currency)
  const monthly = basisPoints === undefined ? undefined : monthlyExpenses(db, asOf, currency).fixedExpenses
  const target =
    basisPoints === undefined || monthly === undefined ? undefined : money(applyBasisPoints(monthly.minor, basisPoints), currency)

  // Counted unless unticked (M31 U5, D-371): only a written 0 leaves an account out.
  const unticked = new Set(
    query(db, 'SELECT id FROM fmt_account WHERE in_cushion = 0').map((row) => String(row['id'])),
  )
  const accounts: CushionAccount[] = accountBalances(db, currency).map((account) => ({
    accountId: account.accountId,
    name: account.name,
    last4: account.last4,
    balance: account.statementBalance,
    balanceTo: account.balanceTo,
    counts: !unticked.has(account.accountId),
  }))

  const split = cushionSplit({ accounts, parts: goalParts(db, currency), target, currency })
  return {
    months: basisPoints === undefined ? undefined : basisPoints / MONTH_BASIS_POINTS,
    target,
    buckets,
    accounts,
    split,
    above: split.above,
  }
}
