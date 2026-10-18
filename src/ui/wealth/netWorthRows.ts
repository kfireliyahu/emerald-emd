import type { Database } from 'sql.js'

import { money, type CurrencyCode, type Money } from '@/core/money.ts'
import type { LocalDate } from '@/core/time.ts'
import { accountBalances, type AccountBalance } from '@/data/repositories/accountBalanceRepository.ts'
import { listAccounts, type Account } from '@/data/repositories/accountRepository.ts'
import { debtBalances, listDebts } from '@/data/repositories/debtRepository.ts'
import { listFunds } from '@/data/repositories/fundRepository.ts'
import { netWorth } from '@/data/repositories/netWorthRepository.ts'
import { documentMoneyMap, type DocumentMoneyMap } from '@/data/repositories/savingsRepository.ts'
import type { DebtBalance } from '@/domain/debt.ts'
import type { Debt } from '@/domain/model/debt.ts'
import type { FundType } from '@/domain/model/funds.ts'
import type { NetWorth } from '@/domain/netWorth.ts'
import type { MoneyMapFund, PlaceBalance } from '@/domain/savings.ts'

/** The table's groups, in its order (`docs/mockups/m36-u08/net-worth.html`). */
export const NET_WORTH_GROUPS = ['BANK', 'HOLDINGS', 'BY_HAND', 'FUNDS', 'OWED'] as const
export type NetWorthGroup = (typeof NET_WORTH_GROUPS)[number]

export const GROUP_LABEL: Readonly<Record<NetWorthGroup, string>> = {
  BANK: 'Bank accounts and cash',
  HOLDINGS: 'Accounts with holdings',
  BY_HAND: 'Places kept by hand',
  FUNDS: 'Funds',
  OWED: 'Owed',
}

export type Reach = 'Reachable' | 'Locked' | 'Part reachable'

/** One row of Net worth: an account or a place, a fund, or a debt — each once. */
export type NetWorthRow =
  | {
      readonly kind: 'ACCOUNT'
      readonly key: string
      readonly group: 'BANK' | 'HOLDINGS'
      readonly account: Account
      /** A bank or cash account's statement, opening balance and check; undefined for one with holdings. */
      readonly balance: AccountBalance | undefined
      /** Its row on the money map: its own cash, goal parts and anything else held there. */
      readonly place: PlaceBalance | undefined
      readonly figure: Money
      readonly reach: Reach
    }
  | {
      readonly kind: 'PLACE'
      readonly key: string
      readonly group: 'BY_HAND'
      readonly place: PlaceBalance
      readonly figure: Money
      readonly reach: Reach
    }
  | {
      readonly kind: 'FUND'
      readonly key: string
      readonly group: 'FUNDS'
      readonly fund: MoneyMapFund
      readonly fundType: FundType | undefined
      readonly figure: Money
    }
  | {
      readonly kind: 'DEBT'
      readonly key: string
      readonly group: 'OWED'
      readonly debt: Debt
      readonly owed: DebtBalance | undefined
      /** Less than nothing: what is owed. Undefined when it is not one figure in this currency. */
      readonly figure: Money | undefined
    }

export interface NetWorthTable {
  readonly rows: readonly NetWorthRow[]
  /** The one net worth (D-383): the table's last line and the hero. */
  readonly worth: NetWorth
  readonly map: DocumentMoneyMap
  readonly accounts: readonly Account[]
}

/**
 * Reachable, locked, or both: what the holdings in it are (D-175) — by what they
 * hold, or, while they hold nothing yet, by what they are.
 */
export function reachOf(place: PlaceBalance | undefined): Reach {
  if (place === undefined) return 'Reachable'
  const empty = place.liquid.minor === 0 && place.locked.minor === 0
  const liquid = empty ? place.holdings.some((held) => held.isLiquid) : place.liquid.minor !== 0
  const locked = empty ? place.holdings.some((held) => !held.isLiquid) : place.locked.minor !== 0
  if (!locked) return 'Reachable'
  return liquid ? 'Part reachable' : 'Locked'
}

/**
 * **Net worth as one table** (M36 U08): one row per account or place, then the
 * funds and the debts, so the rows add up to `netWorth` with nothing outside them.
 *
 * - **An account is one row.** A bank or cash account's row is its place on the
 *   money map — since D-384 its own row, `account:<id>`, or a place an older build
 *   made that holds its cash — whose figure is the statement plus anything else
 *   held there (D-376). An account with no holding at all is its statement.
 * - **An account with holdings** is its place: what its statement lists.
 * - **A place kept by hand** is every other place — cash at home, a deposit
 *   elsewhere — and the holdings the document no longer has, which still count.
 * - **Funds and debts** are rows too; they open on their own pages.
 *
 * Archived ones are rows like the rest: the screen hides them while they hold
 * nothing, since net worth still counts what they do hold.
 */
export function netWorthTable(db: Database, asOf: LocalDate, currency: CurrencyCode): NetWorthTable {
  const map = documentMoneyMap(db, currency)
  const accounts = listAccounts(db, { includeArchived: true })
  const balances = new Map(accountBalances(db, currency).map((one) => [one.accountId, one]))
  const placeOf = new Map(
    map.places.flatMap((row) => (row.place?.accountId === undefined ? [] : [[row.place.accountId, row] as const])),
  )
  const known = new Set(accounts.map((one) => one.id))
  const rows: NetWorthRow[] = []

  for (const account of accounts) {
    if (account.kind === 'CREDIT_CARD') continue
    const place = placeOf.get(account.id)
    const balance = balances.get(account.id)
    const figure = place?.balance ?? (account.isArchived ? undefined : balance?.statementBalance) ?? money(0, currency)
    rows.push({
      kind: 'ACCOUNT',
      key: `account:${account.id}`,
      group: account.kind === 'HOLDINGS' ? 'HOLDINGS' : 'BANK',
      account,
      balance: account.kind === 'HOLDINGS' ? undefined : balance,
      place,
      figure,
      reach: reachOf(place),
    })
  }

  for (const place of map.places) {
    const accountId = place.place?.accountId
    if (accountId !== undefined && known.has(accountId)) continue
    rows.push({
      kind: 'PLACE',
      key: place.holdingPlaceId === '' ? 'place:unknown' : `place:${place.holdingPlaceId}`,
      group: 'BY_HAND',
      place,
      figure: place.balance,
      reach: reachOf(place),
    })
  }

  const types = new Map(listFunds(db, { includeArchived: true }).map((fund) => [fund.id, fund.fundType]))
  for (const fund of map.funds) {
    rows.push({ kind: 'FUND', key: `fund:${fund.fundId}`, group: 'FUNDS', fund, fundType: types.get(fund.fundId), figure: fund.balance })
  }

  const debts = listDebts(db, { includeClosed: true })
  const owed = debtBalances(db, debts)
  for (const debt of debts) {
    const balance = owed.get(debt.id)
    const figure =
      balance?.kind === 'KNOWN' && balance.outstanding.currency === currency
        ? money(-Math.max(0, balance.outstanding.minor), currency)
        : undefined
    // A closed debt that owes nothing is history, not a row (Debts keeps it).
    if (debt.isClosed && (figure === undefined || figure.minor === 0)) continue
    rows.push({ kind: 'DEBT', key: `debt:${debt.id}`, group: 'OWED', debt, owed: balance, figure })
  }

  const order = (row: NetWorthRow): number => NET_WORTH_GROUPS.indexOf(row.group)
  return { rows: rows.sort((a, b) => order(a) - order(b)), worth: netWorth(db, asOf, currency), map, accounts }
}
