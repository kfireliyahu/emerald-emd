import type { Database } from 'sql.js'

import { money, type CurrencyCode } from '@/core/money.ts'
import { compareDates, type LocalDate } from '@/core/time.ts'
import { originOf } from '@/domain/goalDeposits.ts'
import { netWorthOf, type DebtOwed, type NetWorth } from '@/domain/netWorth.ts'
import { holdingBalances } from '@/domain/savings.ts'

import { accountBalances } from './accountBalanceRepository.ts'
import { listAccounts } from './accountRepository.ts'
import { debtBalances, listDebts } from './debtRepository.ts'
import { holdingValuations } from './holdingReadingRepository.ts'
import { listDeposits, listHoldingPlaces, listHoldings } from './savingsRepository.ts'

/**
 * **The one net worth** (M36 U07) — what Overview, Home and the tools read, so no
 * two of them can print different figures under the name. The arithmetic is the
 * domain's `netWorthOf`; this loads its parts, the declared ones as the document
 * declares them:
 *
 * - each holding's worth — its latest `reading` where it has one (M36 U05), its
 *   deposits up to `asOf` otherwise;
 * - the funds among them — a fund is a holding (D-389), worth its latest reading;
 * - each debt's `outstanding` (M36 U03), unchecked when its payments are in two
 *   currencies, and named rather than summed;
 * - and the bank accounts' last statements, which no declared total holds.
 *
 * **`asOf` cuts the deposits and nothing else.** A reading and a debt's
 * outstanding are the document's latest, as U05 ruled for a reading:
 * none of them has a past here, and a net worth of an earlier day is not a figure
 * any screen draws (the 24-month line went in U07).
 *
 * **Closed goals and debts, archived funds, places and holdings are all in.** A
 * goal you finished still holds its money, a fund you stopped paying into still
 * has a balance, and a closed debt owes what its payments leave — nothing, once
 * they cover it.
 */
export function netWorth(db: Database, asOf: LocalDate, currency: CurrencyCode): NetWorth {
  const holdsThings = new Set(listAccounts(db).filter((one) => one.kind === 'HOLDINGS').map((one) => one.id))
  const placesThere = new Set(
    listHoldingPlaces(db, { includeArchived: true })
      .filter((place) => place.accountId !== undefined && holdsThings.has(place.accountId))
      .map((place) => place.id),
  )
  // **A bank account's own cash is inside its statement** (M30 F2, D-362), as the
  // cushion's split reads it (D-360) — only while the account has a balance to be
  // inside. Without one it is counted nowhere else, and stays outside.
  const statements = accountBalances(db, currency).filter((one) => one.statementBalance !== undefined)
  const withBalance = new Set(statements.map((one) => one.accountId))
  const holdings = listHoldings(db, { includeArchived: true, includeFunds: true })
  const inStatement = new Set(
    holdings
      .filter((one) => one.accountId !== undefined && withBalance.has(one.accountId) && !holdsThings.has(one.accountId))
      .map((one) => one.id),
  )
  const held = new Set(
    holdings
      .filter((one) => (one.accountId !== undefined && holdsThings.has(one.accountId)) || placesThere.has(one.holdingPlaceId))
      .map((one) => one.id),
  )
  const deposits = listDeposits(db).filter((one) => compareDates(one.date, asOf) <= 0)
  const setAside = deposits
    .filter(
      (one) =>
        !held.has(one.holdingId) &&
        !inStatement.has(one.holdingId) &&
        one.amount.currency === currency &&
        originOf(one.sourceKind) === 'SET_ASIDE',
    )
    .reduce((sum, one) => sum + one.amount.minor, 0)

  return netWorthOf({
    asOf,
    currency,
    statements: money(
      statements.reduce((sum, one) => sum + (one.statementBalance?.currency === currency ? one.statementBalance.minor : 0), 0),
      currency,
    ),
    hasStatements: statements.length > 0,
    holdings: holdingBalances(deposits, holdings, currency, holdingValuations(db, currency)),
    inStatement,
    held,
    setAside: money(setAside, currency),
    debts: debtsOwed(db, currency),
    otherCurrencyDeposits: deposits.filter((one) => one.amount.currency !== currency).length,
  })
}

/** Each debt's declared outstanding, or why it is not one figure in this currency. */
function debtsOwed(db: Database, currency: CurrencyCode): readonly DebtOwed[] {
  const debts = listDebts(db, { includeClosed: true })
  const balances = debtBalances(db, debts)
  return debts.map((debt): DebtOwed => {
    if (debt.principalAmount.currency !== currency) return { kind: 'OTHER_CURRENCY' }
    const balance = balances.get(debt.id)
    return balance?.kind === 'KNOWN' ? { kind: 'OWED', outstanding: balance.outstanding } : { kind: 'UNCHECKED' }
  })
}
