/**
 * Saving goals, their deposits, the places money sits and what it sits **in** —
 * `SavingGoal`, `SavingDeposit`, `HoldingPlace` and `Holding` in
 * docs/04-data-model.md, migrations 018 and 024.
 *
 * Owns its SQL and its row decoding, like every repository here. What it does
 * **not** own is any arithmetic: every balance, every progress figure and the
 * projection come from `@/domain/savings.ts`, and
 * this file's job is to hand that domain the rows it needs.
 *
 * Three things are worth knowing before reading further:
 *
 * - **No query here sums a balance.** There is no `SELECT SUM(amount_minor)`
 *   anywhere in this file, and that is deliberate rather than incidental: a
 *   total computed in SQL would be a second answer to the one question docs/f07
 *   says the feature cannot afford to be wrong about, and the two would disagree
 *   the first time either changed. The rows go to the domain and the domain adds
 *   them up (D-074).
 * - **A payroll deposit is never stored** (M36 U05, D-381). What the payslips
 *   say is worked out on read by `fedDeposits`, from the one domain function that
 *   knows the rule — so editing a paycheck moves the figure because there is no
 *   second row to leave behind. F07's second acceptance criterion, held by there
 *   being nothing to keep in step.
 * - **Deleting refuses rather than cascading**, the way `deleteCategory` does. A
 *   goal with deposits and a place holding money both have history to lose, and
 *   "you cannot delete this, here is why" is something a user can act on.
 */

import type { Database } from 'sql.js'

import { newId } from '@/core/id.ts'
import { money, type CurrencyCode, type Money } from '@/core/money.ts'
import {
  addMonths,
  compareDates,
  localDate,
  parseISODate,
  toISODate,
  toYearMonthString,
  yearMonthOf,
  type LocalDate,
  type YearMonth,
} from '@/core/time.ts'
import type { HoldingWorth } from '@/domain/holdingReadings.ts'
import { fixedExpenseBasis } from '@/domain/fixedExpenses.ts'
import { FUND_TYPES, type FundType } from '@/domain/model/funds.ts'
import {
  DEPOSIT_SOURCE_KINDS,
  HOLDING_KINDS,
  HOLDING_PLACE_KINDS,
  HOLDING_PROVENANCES,
  RETURN_BASES,
  SAVING_GOAL_KINDS,
  type DepositSourceKind,
  type Holding,
  type HoldingKind,
  type HoldingPlace,
  type HoldingPlaceKind,
  type HoldingProvenance,
  type ReturnBasis,
  type SavingDeposit,
  type SavingGoal,
  type SavingGoalKind,
} from '@/domain/model/savings.ts'
import {
  goalProgress,
  holdingBalances,
  moneyMap,
  savingsOverview,
  unconfirmedHoldings,
  type FundRow,
  type GoalFigures,
  type GoalProgress,
  type HoldingBalance,
  type PlaceBalance,
  type MoneyMap,
  type MonthlyExpenses,
  type SavingsOverview,
  type UnconfirmedHolding,
} from '@/domain/savings.ts'
import { cushionSplit, type GoalPartInput } from '@/domain/cushion.ts'
import { inTransaction, query } from '../db/database.ts'
import {
  ensureOwnCash,
  findAccountById,
  isBarePlace,
  isUnusedHolding,
  ownCash,
  ownCashRow,
  placeKindOf,
  type AccountKind,
} from './accountRepository.ts'
import { accountBalances } from './accountBalanceRepository.ts'
import { holdingValuations, holdingWorths } from './holdingReadingRepository.ts'
import { fedDeposits } from './goalDepositRepository.ts'
import { declaredFigures } from '../packs/ledger/figures.ts'
import { allDeclared, declared } from '../packs/ledger/tables.ts'
import { deleteRows, insertRows, updateRow } from './formatRowRepository.ts'
import { unlinkDeductionTypes } from './deductionTypeRepository.ts'
import { listFixedExpenses } from './fixedExpenseRepository.ts'
import { unaimBuckets } from './splitPlanRepository.ts'
import { cushionBuckets } from './cushionBucketRepository.ts'
import { listFundsWithLatest } from './fundRepository.ts'
import { findInstitutionById } from './institutionRepository.ts'
import { foldAggregate, indexOf } from './formatJoinRepository.ts'
import { findTransactionById, monthlyTotals, QUANTITY_SCALE } from './transactionRepository.ts'

// --- Holding places ---------------------------------------------------------

export interface NewHoldingPlace {
  readonly name: string
  readonly kind: HoldingPlaceKind
  readonly institution?: string | undefined
  readonly note?: string | undefined
}

export type HoldingPlaceEdit = Partial<NewHoldingPlace>

/**
 * **A place is an account's because the account's own cash is in it** (M36
 * U08): the holding names the account, so the place needs no link of its own.
 */
const PLACE_SELECT = `SELECT id, name, kind, institution, note, is_archived,
                             (SELECT h.account FROM fmt_holding h
                               WHERE h.holding_place = fmt_holding_place.id AND h.account IS NOT NULL
                               ORDER BY h.id LIMIT 1) AS account
                        FROM fmt_holding_place
                       WHERE 1 = 1`

// --- An account's own row (M36 U08) -------------------------------------------

const ACCOUNT_WHERE = 'account:'

/**
 * **Where an account's own cash is, when it is in no place** (M36 U08). A bank
 * account's own cash names its account and sits in no place, so the money map,
 * a goal's *Where is the money?* and every list that groups by place group it
 * under the account instead: a row that reads as a place — the account's name,
 * `CHECKING` or `CASH`, `accountId` set — under this id. It is not a row of
 * `holding_place`, and the writes that change a place refuse it.
 */
export function accountWhereId(accountId: string): string {
  return `${ACCOUNT_WHERE}${accountId}`
}

/** The account an account's own row stands for, or `undefined` for a place. */
export function accountOfWhere(placeId: string): string | undefined {
  return placeId.startsWith(ACCOUNT_WHERE) ? placeId.slice(ACCOUNT_WHERE.length) : undefined
}

/** Each account whose own cash is in no place, as the row that stands for it. */
function accountRows(db: Database, options: { readonly includeArchived?: boolean; readonly accountId?: string }): readonly HoldingPlace[] {
  const clauses = ['h.holding_place IS NULL']
  const params: string[] = []
  if (options.includeArchived !== true) clauses.push('a.is_archived = 0')
  if (options.accountId !== undefined) {
    clauses.push('a.id = ?')
    params.push(options.accountId)
  }
  return query(
    db,
    `SELECT a.id, a.name, a.kind, a.is_archived
       FROM fmt_holding h JOIN fmt_account a ON a.id = h.account
      WHERE ${clauses.join(' AND ')}`,
    params,
  ).map((row) => ({
    id: accountWhereId(String(row['id'])),
    name: String(row['name']),
    kind: placeKindOf(String(row['kind']) as AccountKind),
    institution: undefined,
    note: undefined,
    isArchived: Number(row['is_archived'] ?? 0) === 1,
    accountId: String(row['id']),
  }))
}

/** The sentence a write that changes a place says to an account's own row. */
function notAPlace(db: Database, placeId: string): string | undefined {
  const accountId = accountOfWhere(placeId)
  if (accountId === undefined) return undefined
  const name = findAccountById(db, accountId)?.name ?? 'That account'
  return `${name} is an account, not a place: its own cash is in no place. Change the account itself on the Accounts screen.`
}

/**
 * **A real place for an account's own row** — made when something other than
 * its cash is put there, a deposit at the bank say: a place named as the
 * account, with the account's cash moved into it, so the account is still one
 * row and its holdings are in it (M36 U08). An account with holdings no
 * statement has been read for yet has no row of its own; the same id names
 * it, and its place is made the same way (M36 U11). A place id is itself.
 */
function placeIdFor(db: Database, placeId: string): string {
  const accountId = accountOfWhere(placeId)
  if (accountId === undefined) return placeId
  const account = findAccountById(db, accountId)
  if (account === undefined) throw new PlaceAccountError('That account no longer exists.')
  return inTransaction(db, () => {
    const [id = ''] = insertRows(db, declared(db, 'holding_place'), [
      {
        name: account.name,
        kind: placeKindOf(account.kind),
        institution: null,
        note: null,
        is_archived: 0,
      },
    ])
    db.run('UPDATE fmt_holding SET holding_place = ? WHERE account = ? AND holding_place IS NULL', [id, accountId])
    // An account with holdings keeps no cash in no place (`ensureOwnCash`), so
    // its first holding by hand gives it its cash here, as a statement would:
    // that is what makes this place the account's row and not one by hand (M36 U11).
    if (db.getRowsModified() === 0) insertRows(db, declared(db, 'holding'), [ownCashRow(id, accountId)])
    return id
  })
}

/**
 * The places, by name.
 *
 * It used to be liquid first and then locked, because that was the "where is my
 * money" view's two sections. Liquidity belongs to a holding now (D-175), so a
 * place cannot be sorted by it — the sections are assembled from the holdings
 * underneath, by `placeBalances`.
 */
export function listHoldingPlaces(
  db: Database,
  options?: { readonly includeArchived?: boolean },
): readonly HoldingPlace[] {
  const where = options?.includeArchived === true ? '' : ' AND is_archived = 0'
  const places = decodePlaces(query(db, `${PLACE_SELECT}${where} ORDER BY name`))
  const accounts = accountRows(db, { includeArchived: options?.includeArchived === true })
  if (accounts.length === 0) return places
  // By name, as SQL ordered the places: an account's own row among them.
  return [...places, ...accounts].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

export function findHoldingPlace(db: Database, id: string): HoldingPlace | undefined {
  const accountId = accountOfWhere(id)
  if (accountId !== undefined) return accountRows(db, { includeArchived: true, accountId })[0]
  return decodePlaces(query(db, `${PLACE_SELECT} AND id = ?`, [id]))[0]
}

export function createHoldingPlace(
  db: Database,
  input: NewHoldingPlace,
  _now: number,
): HoldingPlace {
  const [id = ''] = insertRows(db, declared(db, 'holding_place'), [
    {
      name: input.name,
      kind: input.kind,
      institution: input.institution ?? null,
      note: input.note ?? null,
      is_archived: 0,
    },
  ])

  const created = findHoldingPlace(db, id)
  if (created === undefined) throw new Error('holding place did not survive insert')
  return created
}

/**
 * Change a place. Fields left out are left alone; fields named and set to
 * `undefined` are cleared.
 */
export function updateHoldingPlace(
  db: Database,
  id: string,
  edit: HoldingPlaceEdit,
  _now: number,
): void {
  const refused = notAPlace(db, id)
  if (refused !== undefined) throw new PlaceAccountError(refused)
  const existing = findHoldingPlace(db, id)
  if (existing === undefined) return

  const pick = <K extends keyof HoldingPlaceEdit>(
    key: K,
    current: HoldingPlaceEdit[K],
  ): HoldingPlaceEdit[K] => (key in edit ? edit[key] : current)

  updateRow(db, declared(db, 'holding_place'), id, {
    name: edit.name ?? existing.name,
    kind: edit.kind ?? existing.kind,
    institution: pick('institution', existing.institution) ?? null,
    note: pick('note', existing.note) ?? null,
  })
}

export function setHoldingPlaceArchived(
  db: Database,
  id: string,
  isArchived: boolean,
  _now: number,
): void {
  const refused = notAPlace(db, id)
  if (refused !== undefined) throw new PlaceAccountError(refused)
  updateRow(db, declared(db, 'holding_place'), id, { is_archived: isArchived ? 1 : 0 })
}

export class HoldingPlaceInUseError extends Error {
  constructor(
    readonly placeName: string,
    readonly depositCount: number,
  ) {
    super(
      `${placeName} still holds ${depositCount} deposit${depositCount === 1 ? '' : 's'}. Archive it instead, or move those deposits somewhere else first.`,
    )
    this.name = 'HoldingPlaceInUseError'
  }
}

export class HoldingInUseError extends Error {
  constructor(
    readonly holdingName: string,
    readonly depositCount: number,
  ) {
    super(
      `${holdingName} still holds ${depositCount} deposit${depositCount === 1 ? '' : 's'}. Archive it instead, or move those deposits somewhere else first.`,
    )
    this.name = 'HoldingInUseError'
  }
}

/**
 * How many live deposits sit in these holdings. The one query both refusals ask.
 */
function depositsIn(db: Database, holdingIds: readonly string[]): number {
  if (holdingIds.length === 0) return 0
  const marks = holdingIds.map(() => '?').join(', ')
  const rows = query(
    db,
    `SELECT COUNT(*) AS n FROM fmt_saving_deposit WHERE holding IN (${marks})`,
    [...holdingIds],
  )
  return Number(rows[0]?.['n'] ?? 0)
}

/**
 * Remove a place, refusing while anything sits in any of its holdings.
 *
 * `deleteCategory`'s shape, and for a sharper reason: a deposit whose holding
 * has gone is counted as **locked** by the domain, so a silent cascade would
 * move money out of the liquid total without saying anything — which is the one
 * number this feature exists to keep honest.
 *
 * An empty place takes its empty holdings with it. That is a cascade, and it is
 * allowed precisely because there is nothing in them: leaving a holding behind
 * whose place no longer exists would be leaving the state the money map has to
 * render as "somewhere this document does not have".
 */
export function deleteHoldingPlace(db: Database, id: string, now: number): void {
  const refused = notAPlace(db, id)
  if (refused !== undefined) throw new PlaceAccountError(refused)
  const place = findHoldingPlace(db, id)
  if (place === undefined) return

  const holdings = listHoldings(db, { placeId: id, includeArchived: true })
  const depositCount = depositsIn(db, holdings.map((holding) => holding.id))
  if (depositCount > 0) throw new HoldingPlaceInUseError(place.name, depositCount)

  inTransaction(db, () => {
    for (const holding of holdings) removeHolding(db, holding.id, now)
    deleteRows(db, declared(db, 'holding_place'), [id], allDeclared(db))
  })
}

// --- A place's account (M30 U1, D-354) ---------------------------------------

export class PlaceAccountError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlaceAccountError'
  }
}

/** What linking a place did: the account it names now, and that account's own cash. */
export interface PlaceAccountLink {
  readonly placeId: string
  readonly accountId: string | undefined
  /** The holding that is the account's own cash; `undefined` once unlinked. */
  readonly cashHolding: Holding | undefined
  /** True when this call made the cash holding rather than reusing one. */
  readonly createdCash: boolean
}

/**
 * **A place names the account whose statements show its money** — or, with
 * `accountId` undefined, stops naming one (M30 U1, D-354).
 *
 * A place *links* to an account and is never merged with one
 * (2026-10-04): a deposit or the cash at home has no statements and stays a
 * place that names nothing. A card holds no money, so it cannot be named, and
 * an account is named by one place at most — the link is unique, and two
 * places over one account would be the same cash counted twice.
 *
 * **The account's own cash is a holding, made with the link.** `cashHoldingId`
 * picks a holding already in the place instead — the "Current account" a
 * goal's deposits already land in, which a second, empty `Cash` beside it would
 * only split. Re-linking the same account keeps the cash holding it has.
 * Unlinking clears the mark and keeps the holding: what was deposited there is
 * still there, and nothing is auto-deleted.
 *
 * Nothing here moves a figure: a new cash holding holds no deposit, and a
 * document that links nothing is a document this never ran on.
 */
export function setPlaceAccount(
  db: Database,
  placeId: string,
  accountId: string | undefined,
  now: number,
  options: { readonly cashHoldingId?: string | undefined } = {},
): PlaceAccountLink {
  const place = findHoldingPlace(db, placeId)
  if (place === undefined) throw new PlaceAccountError('That place no longer exists.')
  // An account's own row is its account's already, and is no place to re-point.
  if (accountOfWhere(placeId) !== undefined) {
    if (accountId === place.accountId) {
      return { placeId, accountId, cashHolding: accountId === undefined ? undefined : cashHoldingOf(db, accountId), createdCash: false }
    }
    throw new PlaceAccountError(notAPlace(db, placeId) ?? 'That is an account, not a place.')
  }
  const holdings = declared(db, 'holding')
  const inPlace = listHoldings(db, { placeId, includeArchived: true })

  // Unlinking clears the mark and keeps the holding where it is, with what is
  // in it (D-354): the place then holds money that is nobody's own cash. A bank
  // account or cash is given its own again, in no place (M36 U08).
  if (accountId === undefined) {
    inTransaction(db, () => {
      for (const held of inPlace) {
        if (held.accountId === undefined) continue
        updateRow(db, holdings, held.id, { account: null })
        ensureOwnCash(db, held.accountId)
      }
    })
    return { placeId, accountId: undefined, cashHolding: undefined, createdCash: false }
  }

  const problem = placeAccountProblem(db, placeId, accountId, options.cashHoldingId)
  if (problem !== undefined) throw new PlaceAccountError(problem)
  const picked =
    options.cashHoldingId === undefined
      ? undefined
      : inPlace.find((held) => held.id === options.cashHoldingId)
  const own = ownCash(db, accountId)

  let created = false
  const cashId = inTransaction(db, () => {
    // A holding picked to be the cash makes the account's own cash, if it had
    // one somewhere else, give way — the problem has already said it is bare.
    if (picked !== undefined) {
      if (own !== undefined && own.id !== picked.id) dropBareCash(db, own, now)
      if (picked.accountId !== accountId) updateRow(db, holdings, picked.id, { account: accountId })
      return picked.id
    }
    if (own !== undefined) {
      if (own.placeId === placeId) return own.id
      // The account's cash moves here, and the bare place an older build made
      // for it, if that is where it was, goes (M30 F2).
      const bare = own.placeId !== undefined && isBarePlace(db, own.placeId) ? own.placeId : undefined
      updateRow(db, holdings, own.id, { holding_place: placeId })
      if (bare !== undefined) deleteRows(db, declared(db, 'holding_place'), [bare], allDeclared(db))
      return own.id
    }
    created = true
    const [id = ''] = insertRows(db, holdings, [ownCashRow(placeId, accountId)])
    return id
  })
  return { placeId, accountId, cashHolding: findHolding(db, cashId), createdCash: created }
}

/** An account's own cash that gives way to a holding picked instead: with the bare place it was in, if any. */
function dropBareCash(db: Database, cash: { readonly id: string; readonly placeId: string | undefined }, now: number): void {
  if (cash.placeId !== undefined && isBarePlace(db, cash.placeId)) {
    deleteHoldingPlace(db, cash.placeId, now)
    return
  }
  removeHolding(db, cash.id, now)
}

/**
 * Why this place cannot name this account, in a sentence — or `undefined` when
 * it can. The one judgement the screen, the tool's preview and the write share.
 */
export function placeAccountProblem(
  db: Database,
  placeId: string,
  accountId: string,
  cashHoldingId?: string | undefined,
): string | undefined {
  const place = findHoldingPlace(db, placeId)
  if (place === undefined) return 'That place no longer exists.'
  const account = findAccountById(db, accountId)
  if (account === undefined) return 'That account no longer exists.'
  if (account.kind === 'CREDIT_CARD') {
    return `${account.name} is a card, and a card holds no money of its own. A place names a bank account, cash, or an account with holdings.`
  }
  if (accountOfWhere(placeId) !== undefined && place.accountId !== accountId) return notAPlace(db, placeId)
  // **A place is not re-pointed from one account to another in one step** (M30 F2):
  // the account it names would silently lose its place and its cash, and its
  // holdings would be read as the new one's.
  if (place.accountId !== undefined && place.accountId !== accountId) {
    const was = findAccountById(db, place.accountId)
    return `${place.name} names ${was?.name ?? 'another account'}. Set it to name no account first, then name ${account.name}: naming ${account.name} here would take ${place.name} and its cash away from ${was?.name ?? 'that account'} without a word.`
  }
  // The account's own cash is somewhere already. In no place, or in the bare
  // place an older build made for it, it simply moves here; in a place with
  // anything else in it, that place is the account's.
  const own = ownCash(db, accountId)
  if (own?.placeId !== undefined && own.placeId !== placeId && !isBarePlace(db, own.placeId)) {
    const other = findHoldingPlace(db, own.placeId)
    return `${account.name} is already named by ${other?.name ?? 'another place'}. An account is named by one place, or its money would be counted twice.`
  }
  if (cashHoldingId !== undefined) {
    const held = findHolding(db, cashHoldingId)
    if (held === undefined || held.holdingPlaceId !== placeId) {
      return `The holding picked for ${account.name}'s cash is not in ${place.name}.`
    }
    if (held.accountId !== undefined && held.accountId !== accountId) {
      return `${held.name} is already another account's cash.`
    }
    // The account's own cash, wherever it is, would give way to the one picked
    // — only while nothing was ever put in it.
    if (own !== undefined && own.id !== held.id && own.placeId === undefined && !isUnusedHolding(db, own.id)) {
      return `${account.name}'s own cash already holds money. Leave the cash as it is, or move what is in it first.`
    }
  }
  return undefined
}

/** Whether a place is the bare one made with its account (M30 F2) — `accountRepository`'s, since deleting the account removes it. */
export { isBarePlace }

/** The holding that is this account's own cash — in no place for a bank account, in its place for one that holds things. */
export function cashHoldingOf(db: Database, accountId: string): Holding | undefined {
  return decodeHoldings(query(db, `${HOLDING_SELECT} AND account = ?`, [accountId]))[0]
}

// --- What a row's cash turned into (M30 U2) ----------------------------------

export class TransactionHoldingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransactionHoldingError'
  }
}

/** A holding a row's cash turned into, and how much of it, in millionths. */
export interface TransactionHolding {
  readonly holdingId: string
  /** Bought is positive, sold negative; never zero. */
  readonly quantityMicro: number
}

/**
 * Why this row cannot name this holding, in a sentence — or `undefined` when it
 * can, or when `choice` is undefined (clearing is always allowed). The one
 * judgement the screen, the tool's preview and the write share.
 *
 * **A row turns cash into a holding inside its own account**, so a holding at
 * a place that names another account is refused (M30 U1's link says where the
 * place's money shows), and so is an account's own cash holding — cash turning
 * into cash is no buy. A place that names no account refuses nothing: a
 * deposit with no statements is still somewhere money can go.
 */
export function transactionHoldingProblem(
  db: Database,
  transactionId: string,
  choice: TransactionHolding | undefined,
): string | undefined {
  const row = findTransactionById(db, transactionId)
  if (row === undefined) return 'That transaction no longer exists.'
  if (choice === undefined) return undefined
  return holdingChoiceProblem(db, row.accountId, choice)
}

/**
 * The same judgement for a row not written yet — a statement a conversation
 * read (M30 U6), whose rows name holdings before they exist as transactions.
 */
export function holdingChoiceProblem(
  db: Database,
  accountId: string,
  choice: TransactionHolding,
): string | undefined {
  const holding = findHolding(db, choice.holdingId)
  if (holding === undefined) return 'That holding no longer exists.'
  if (holding.accountId !== undefined) {
    const account = findAccountById(db, holding.accountId)
    return `${holding.name} is ${account?.name ?? 'an account'}'s own cash, and a row cannot turn cash into cash.`
  }
  const place = findHoldingPlace(db, holding.holdingPlaceId)
  if (place?.accountId !== undefined && place.accountId !== accountId) {
    return `${holding.name} is held at ${place.name}, which is another account's. A row turns cash into a holding inside its own account.`
  }
  if (!Number.isSafeInteger(choice.quantityMicro)) return 'That quantity is not a figure this document can keep.'
  if (choice.quantityMicro === 0) return 'A quantity of zero bought or sold nothing. Say how much, or clear the holding.'
  return undefined
}

/**
 * **A row names what its cash turned into** — a holding and how much of it —
 * or, with `choice` undefined, stops naming one (M30 U2).
 *
 * Such a row is cash turning into a holding inside one account: a buy, or a
 * sale back into cash. It counts in neither came in, went out nor moved
 * (`heldCondition`), and the holding's quantity is the sum of its rows'
 * (`holdingQuantity`). Both or neither: a holding with no quantity would make
 * that sum `unchecked`, and a quantity with no holding is a count of nothing.
 */
export function setTransactionHolding(
  db: Database,
  transactionId: string,
  choice: TransactionHolding | undefined,
  _now: number,
): void {
  const problem = transactionHoldingProblem(db, transactionId, choice)
  if (problem !== undefined) throw new TransactionHoldingError(problem)
  updateRow(db, declared(db, 'transaction'), transactionId, {
    holding: choice?.holdingId ?? null,
    quantity: choice?.quantityMicro ?? null,
  })
}

/**
 * The holdings a row could name on the screen: those at the place that names
 * the row's account, never the account's own cash — and the one it names
 * already, wherever that is. Empty for a row whose account no place names,
 * which is how the panel knows to say nothing.
 */
export function holdingsForRow(db: Database, transactionId: string): readonly Holding[] {
  const row = findTransactionById(db, transactionId)
  if (row === undefined) return []
  const place = listHoldingPlaces(db, { includeArchived: true }).find((one) => one.accountId === row.accountId)
  const there = place === undefined ? [] : listHoldings(db, { placeId: place.id }).filter((one) => one.accountId === undefined)
  const named = row.holdingId === undefined ? undefined : findHolding(db, row.holdingId)
  return named === undefined || there.some((one) => one.id === named.id) ? there : [named, ...there]
}

/** What a holding's rows add up to, or why they cannot be added up. */
export type HoldingQuantity =
  | { readonly kind: 'VALUE'; readonly quantityMicro: number; readonly rows: number }
  | { readonly kind: 'UNCHECKED'; readonly reason: string }

/**
 * **A holding's quantity is the sum of its rows' quantities** (M30 U2) — the
 * `quantity` the holding format declares as a sum over `transaction.holding`,
 * folded by the engine rather than re-summed here, so a row that names the
 * holding and has no quantity makes it `unchecked` rather than smaller (D-224).
 * A holding no row names holds zero.
 */
export function holdingQuantity(db: Database, holdingId: string): HoldingQuantity {
  const declaration = declared(db, 'holding')
  const aggregate = declaration.aggregates.find((each) => each.name === 'quantity')
  if (aggregate === undefined) {
    throw new Error('The ledger’s holding declares no quantity to add up.')
  }
  const folded = foldAggregate(db, aggregate, holdingId, indexOf(allDeclared(db)))
  if (folded.kind === 'UNCHECKED') return folded
  // The engine folds a decimal as a double; six places back is the integer stored.
  return { kind: 'VALUE', quantityMicro: Math.round(folded.value * 10 ** QUANTITY_SCALE), rows: folded.rows }
}

// --- Holdings ---------------------------------------------------------------

/**
 * What form the money takes — a `Holding` (D-175).
 *
 * The rate, the liquidity and the term used to be columns on the place, because
 * the place was the only record there was to put them on. They are here now, on
 * the thing that actually earns the return and the thing that actually is or is
 * not reachable, and `provenance` (D-176) joins them: how the balance is known.
 */
export interface NewHolding {
  readonly holdingPlaceId: string
  readonly name: string
  readonly kind: HoldingKind
  readonly provenance: HoldingProvenance
  readonly isLiquid: boolean
  readonly lastConfirmedAt?: LocalDate | undefined
  readonly expectedReturnBasisPoints?: number | undefined
  readonly expectedReturnBasis?: ReturnBasis | undefined
  readonly termEndDate?: LocalDate | undefined
  readonly feeBasisPoints?: number | undefined
  readonly note?: string | undefined
}

export type HoldingEdit = Partial<NewHolding>

const HOLDING_SELECT = `SELECT id, holding_place AS holding_place_id, name, kind, provenance,
                               last_confirmed AS last_confirmed_at, is_liquid,
                               expected_return AS expected_return_bp, expected_return_basis,
                               term_end AS term_end_date, fee AS fee_bp, note, is_archived, account,
                               fund_type
                          FROM fmt_holding
                         WHERE 1 = 1`

/**
 * Reachable first, then locked, then by name — the map's two sections.
 *
 * **The funds are left out unless asked for** (M36 U12, D-389): a fund is a
 * holding, but its page, its fees and its deposit check are the Funds screen's,
 * so a list of the places' holdings never offers one. A total asks for them —
 * `includeFunds` — and counts each once, as its row.
 */
export function listHoldings(
  db: Database,
  options?: {
    readonly includeArchived?: boolean
    readonly placeId?: string | undefined
    readonly includeFunds?: boolean
  },
): readonly Holding[] {
  const clauses: string[] = []
  const params: (string | number)[] = []
  if (options?.includeArchived !== true) clauses.push('is_archived = 0')
  if (options?.includeFunds !== true) clauses.push('fund_type IS NULL')
  if (options?.placeId !== undefined) {
    // An account's own row holds its own cash, which is in no place (M36 U08).
    const accountId = accountOfWhere(options.placeId)
    clauses.push(accountId === undefined ? 'holding_place = ?' : 'holding_place IS NULL AND account = ?')
    params.push(accountId ?? options.placeId)
  }
  const where = clauses.length === 0 ? '' : ` AND ${clauses.join(' AND ')}`
  return decodeHoldings(
    query(db, `${HOLDING_SELECT}${where} ORDER BY is_liquid DESC, name`, params),
  )
}

export function findHolding(db: Database, id: string): Holding | undefined {
  return decodeHoldings(query(db, `${HOLDING_SELECT} AND id = ?`, [id]))[0]
}

export function createHolding(db: Database, input: NewHolding, _now: number): Holding {
  const [expectedReturn, expectedReturnBasis] = returnColumns(
    input.expectedReturnBasisPoints,
    input.expectedReturnBasis,
  )
  const [id = ''] = insertRows(db, declared(db, 'holding'), [
    {
      holding_place: placeIdFor(db, input.holdingPlaceId),
      name: input.name,
      kind: input.kind,
      provenance: input.provenance,
      last_confirmed: dateOrNull(input.lastConfirmedAt),
      is_liquid: input.isLiquid ? 1 : 0,
      expected_return: expectedReturn,
      expected_return_basis: expectedReturnBasis,
      term_end: dateOrNull(input.termEndDate),
      fee: input.feeBasisPoints ?? null,
      note: input.note ?? null,
      is_archived: 0,
    },
  ])

  const created = findHolding(db, id)
  if (created === undefined) throw new Error('holding did not survive insert')
  return created
}

/**
 * Change a holding. Fields left out are left alone; fields named and set to
 * `undefined` are cleared.
 *
 * The rate and its basis move **together**, always: a rate with no basis would
 * be a number with no provenance, and a basis with no rate would be a claim
 * about nothing. `returnColumns` is the one place that pairing is enforced.
 */
export function updateHolding(db: Database, id: string, edit: HoldingEdit, _now: number): void {
  const existing = findHolding(db, id)
  if (existing === undefined) return

  const pick = <K extends keyof HoldingEdit>(key: K, current: HoldingEdit[K]): HoldingEdit[K] =>
    key in edit ? edit[key] : current

  const [expectedReturn, expectedReturnBasis] = returnColumns(
    pick('expectedReturnBasisPoints', existing.expectedReturn?.basisPoints),
    pick('expectedReturnBasis', existing.expectedReturn?.basis),
  )
  // An account's own cash stays in no place while it is put back in its own row.
  const placeColumn =
    edit.holdingPlaceId === undefined || edit.holdingPlaceId === existing.holdingPlaceId
      ? {}
      : { holding_place: placeIdFor(db, edit.holdingPlaceId) }
  updateRow(db, declared(db, 'holding'), id, {
    ...placeColumn,
    name: edit.name ?? existing.name,
    kind: edit.kind ?? existing.kind,
    provenance: edit.provenance ?? existing.provenance,
    last_confirmed: dateOrNull(pick('lastConfirmedAt', existing.lastConfirmedAt)),
    is_liquid: (edit.isLiquid ?? existing.isLiquid) ? 1 : 0,
    expected_return: expectedReturn,
    expected_return_basis: expectedReturnBasis,
    term_end: dateOrNull(pick('termEndDate', existing.termEndDate)),
    fee: pick('feeBasisPoints', existing.feeBasisPoints) ?? null,
    note: pick('note', existing.note) ?? null,
  })
}

/**
 * Say the balance was checked today, and nothing else.
 *
 * Its own function rather than a field on the editor, because confirming a
 * figure is a thing the user *does* — on the money map, in one click — and
 * routing it through the form would make "I counted the envelope" cost a save
 * of every other field beside it (D-176).
 */
export function confirmHolding(db: Database, id: string, asOf: LocalDate, _now: number): void {
  updateRow(db, declared(db, 'holding'), id, { last_confirmed: toISODate(asOf) })
}

export function setHoldingArchived(
  db: Database,
  id: string,
  isArchived: boolean,
  _now: number,
): void {
  updateRow(db, declared(db, 'holding'), id, { is_archived: isArchived ? 1 : 0 })
}

/**
 * Remove one holding and unpick every goal default naming it: a goal's default
 * is only ever optional, and a link names a row that is there (D-275). A row of
 * any other format still naming the holding refuses the whole removal (D-263).
 */
function removeHolding(db: Database, id: string, _now: number): void {
  inTransaction(db, () => {
    const goals = declared(db, 'saving_goal')
    for (const row of query(db, 'SELECT id FROM fmt_saving_goal WHERE default_holding = ?', [id])) {
      updateRow(db, goals, String(row['id']), { default_holding: null })
    }
    deleteRows(db, declared(db, 'holding'), [id], allDeclared(db))
  })
}

/** Remove a holding, refusing while anything sits in it. `deleteHoldingPlace`'s rule. */
export function deleteHolding(db: Database, id: string, now: number): void {
  const holding = findHolding(db, id)
  if (holding === undefined) return

  const depositCount = depositsIn(db, [id])
  if (depositCount > 0) throw new HoldingInUseError(holding.name, depositCount)

  removeHolding(db, id, now)
}

// --- Goals ------------------------------------------------------------------

export interface NewSavingGoal {
  readonly name: string
  readonly kind: SavingGoalKind
  readonly targetAmount?: Money | undefined
  readonly targetDate?: LocalDate | undefined
  readonly defaultHoldingId?: string | undefined
  readonly priority?: number | undefined
  readonly note?: string | undefined
}

export type SavingGoalEdit = Partial<NewSavingGoal>

const GOAL_SELECT = `SELECT id, name, kind, target_currency, target_minor AS target_amount_minor,
                            target_date, default_holding AS default_holding_id,
                            is_closed, priority, note
                       FROM fmt_saving_goal
                      WHERE 1 = 1`

/** Open goals first, then by priority — the splitter's order and the screen's. */
export function listGoals(
  db: Database,
  options?: { readonly includeClosed?: boolean },
): readonly SavingGoal[] {
  const where = options?.includeClosed === true ? '' : ' AND is_closed = 0'
  return decodeGoals(query(db, `${GOAL_SELECT}${where} ORDER BY is_closed, priority, name`))
}

export function findGoal(db: Database, id: string): SavingGoal | undefined {
  return decodeGoals(query(db, `${GOAL_SELECT} AND id = ?`, [id]))[0]
}

/**
 * Create a goal. A new one lands **after** the existing ones in the splitter's
 * order unless a priority is given, because a goal added today has not earned a
 * place above the rent.
 */
export function createGoal(db: Database, input: NewSavingGoal, _now: number): SavingGoal {
  const rows = query(db, 'SELECT MAX(priority) AS top FROM fmt_saving_goal')
  const priority = input.priority ?? Number(rows[0]?.['top'] ?? 0) + 10

  const [id = ''] = insertRows(db, declared(db, 'saving_goal'), [
    {
      name: input.name,
      kind: input.kind,
      ...goalColumns(input),
      is_closed: 0,
      priority,
    },
  ])

  const created = findGoal(db, id)
  if (created === undefined) throw new Error('saving goal did not survive insert')
  return created
}

export function updateGoal(db: Database, id: string, edit: SavingGoalEdit, _now: number): void {
  const existing = findGoal(db, id)
  if (existing === undefined) return

  const pick = <K extends keyof SavingGoalEdit>(
    key: K,
    current: SavingGoalEdit[K],
  ): SavingGoalEdit[K] => (key in edit ? edit[key] : current)

  updateRow(db, declared(db, 'saving_goal'), id, {
    name: edit.name ?? existing.name,
    kind: edit.kind ?? existing.kind,
    ...goalColumns({
      targetAmount: pick('targetAmount', existing.targetAmount),
      targetDate: pick('targetDate', existing.targetDate),
      defaultHoldingId: pick('defaultHoldingId', existing.defaultHoldingId),
      note: pick('note', existing.note),
    }),
    priority: edit.priority ?? existing.priority,
  })
}

export function setGoalClosed(db: Database, id: string, isClosed: boolean, _now: number): void {
  updateRow(db, declared(db, 'saving_goal'), id, { is_closed: isClosed ? 1 : 0 })
}

export class GoalHasDepositsError extends Error {
  constructor(
    readonly goalName: string,
    readonly depositCount: number,
  ) {
    super(
      `${goalName} has ${depositCount} deposit${depositCount === 1 ? '' : 's'} recorded against it. Close it to keep the history, or move the deposits to another goal first.`,
    )
    this.name = 'GoalHasDepositsError'
  }
}

/**
 * Remove a goal, refusing while it has deposits — docs/f07's edge case, whose
 * two alternatives the message names.
 *
 * A goal with no deposits takes its deduction-type links with it, for the reason
 * `deleteFund` clears its own (D-067): a link to a goal that is gone would go on
 * generating payroll deposits for something nobody can see.
 */
export function deleteGoal(db: Database, id: string, _now: number): void {
  const goal = findGoal(db, id)
  if (goal === undefined) return

  const rows = query(db, 'SELECT COUNT(*) AS n FROM fmt_saving_deposit WHERE goal = ?', [id])
  const depositCount = Number(rows[0]?.['n'] ?? 0)
  if (depositCount > 0) throw new GoalHasDepositsError(goal.name, depositCount)

  inTransaction(db, () => {
    unlinkDeductionTypes(db, 'linked_saving_goal', id)
    unaimBuckets(db, 'target_saving_goal', id)
    deleteRows(db, declared(db, 'saving_goal'), [id], allDeclared(db))
  })
}

// --- Deposits ---------------------------------------------------------------

export interface NewDeposit {
  readonly goalId: string
  readonly date: LocalDate
  readonly amount: Money
  readonly holdingId: string
  readonly sourceKind?: DepositSourceKind | undefined
  readonly sourceRefId?: string | undefined
  readonly transferGroupKey?: string | undefined
  readonly note?: string | undefined
}

export type DepositEdit = Partial<Omit<NewDeposit, 'goalId'>> & { readonly goalId?: string }

const DEPOSIT_SELECT = `SELECT id, goal AS goal_id, date, amount_currency AS currency, amount_minor,
                               holding AS holding_id, source_kind, source_key AS source_ref_id,
                               transfer_group_key, note
                          FROM fmt_saving_deposit
                         WHERE 1 = 1`

export interface DepositFilter {
  readonly goalId?: string | undefined
  readonly holdingId?: string | undefined
  readonly from?: LocalDate | undefined
  readonly to?: LocalDate | undefined
}

/**
 * Deposits, newest first — the flat chronological list docs/f07 asks for, and
 * the rows every balance is summed from: what a person typed, and what the
 * goals' feeds bring, worked out on read (`fedDeposits`, M36 U05).
 *
 * **Uncapped on purpose**, unlike the ledger. A savings history is a few hundred
 * rows over years where the ledger is tens of thousands a year, and every caller
 * here needs the whole set: a balance over the most recent 500 deposits would be
 * a wrong balance, which is exactly what this feature cannot have.
 */
export function listDeposits(db: Database, filter: DepositFilter = {}): readonly SavingDeposit[] {
  const clauses: string[] = []
  const params: (string | number)[] = []

  if (filter.goalId !== undefined) {
    clauses.push('goal = ?')
    params.push(filter.goalId)
  }
  if (filter.holdingId !== undefined) {
    clauses.push('holding = ?')
    params.push(filter.holdingId)
  }
  if (filter.from !== undefined) {
    clauses.push('date >= ?')
    params.push(toISODate(filter.from))
  }
  if (filter.to !== undefined) {
    clauses.push('date <= ?')
    params.push(toISODate(filter.to))
  }

  const where = clauses.length === 0 ? '' : ` AND ${clauses.join(' AND ')}`
  const typed = decodeDeposits(query(db, `${DEPOSIT_SELECT}${where} ORDER BY date DESC, id`, params))
  // What the feeds bring, worked out on read beside what a person typed (M36 U05, D-381).
  const from = filter.from === undefined ? undefined : toISODate(filter.from)
  const to = filter.to === undefined ? undefined : toISODate(filter.to)
  const fed = fedDeposits(db).filter((one) => {
    const day = toISODate(one.date)
    return (
      (filter.goalId === undefined || one.goalId === filter.goalId) &&
      (filter.holdingId === undefined || one.holdingId === filter.holdingId) &&
      (from === undefined || day >= from) &&
      (to === undefined || day <= to)
    )
  })
  if (fed.length === 0) return typed
  return [...typed, ...fed].sort((a, b) => {
    const byDay = toISODate(b.date).localeCompare(toISODate(a.date))
    return byDay !== 0 ? byDay : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

export function findDeposit(db: Database, id: string): SavingDeposit | undefined {
  return decodeDeposits(query(db, `${DEPOSIT_SELECT} AND id = ?`, [id]))[0]
}

export function addDeposit(db: Database, input: NewDeposit, _now: number): SavingDeposit {
  const [id = ''] = insertDeposits(db, [input])

  const created = findDeposit(db, id)
  if (created === undefined) throw new Error('deposit did not survive insert')
  return created
}

/** Write deposits through the engine, returning their ids in order. */
function insertDeposits(db: Database, inputs: readonly NewDeposit[]): readonly string[] {
  return insertRows(
    db,
    declared(db, 'saving_deposit'),
    inputs.map((input) => ({
      goal: input.goalId,
      date: toISODate(input.date),
      amount_minor: input.amount.minor,
      amount_currency: input.amount.currency,
      holding: input.holdingId,
      source_kind: input.sourceKind ?? 'MANUAL',
      source_key: input.sourceRefId ?? null,
      transfer_group_key: input.transferGroupKey ?? null,
      note: input.note ?? null,
    })),
  )
}

export function updateDeposit(db: Database, id: string, edit: DepositEdit, _now: number): void {
  const existing = findDeposit(db, id)
  if (existing === undefined) return

  const pick = <K extends keyof DepositEdit>(key: K, current: DepositEdit[K]): DepositEdit[K] =>
    key in edit ? edit[key] : current

  const amount = edit.amount ?? existing.amount

  updateRow(db, declared(db, 'saving_deposit'), id, {
    goal: edit.goalId ?? existing.goalId,
    date: toISODate(edit.date ?? existing.date),
    amount_minor: amount.minor,
    amount_currency: amount.currency,
    holding: edit.holdingId ?? existing.holdingId,
    note: pick('note', existing.note) ?? null,
  })
}

/**
 * Remove a deposit — and both legs of it, when it is half of a transfer.
 *
 * A transfer that lost one leg would move a goal's balance while claiming to
 * have moved nothing between places, which is the invariant `validateTransfer`
 * checks at entry. Deleting one side must not be able to create the state the
 * entry form refuses.
 */
export function deleteDeposit(db: Database, id: string, _now: number): void {
  const existing = findDeposit(db, id)
  if (existing === undefined) return

  const ids =
    existing.transferGroupKey === undefined
      ? [id]
      : query(db, 'SELECT id FROM fmt_saving_deposit WHERE transfer_group_key = ?', [
          existing.transferGroupKey,
        ]).map((row) => String(row['id']))
  deleteRows(db, declared(db, 'saving_deposit'), ids, allDeclared(db))
}

export interface NewTransfer {
  readonly goalId: string
  readonly date: LocalDate
  readonly amount: Money
  readonly fromHoldingId: string
  readonly toHoldingId: string
  readonly note?: string | undefined
}

/**
 * Move money between holdings: two legs, one key, netting to zero.
 *
 * Written here rather than as two `addDeposit` calls by a screen, because the
 * pair is the unit — a caller that wrote one leg and then failed would leave the
 * goal's balance changed by a move that was supposed to change nothing.
 */
export function recordTransfer(
  db: Database,
  input: NewTransfer,
  _now: number,
): readonly SavingDeposit[] {
  const key = newId()
  const magnitude = Math.abs(input.amount.minor)
  const shared = {
    goalId: input.goalId,
    date: input.date,
    sourceKind: 'MANUAL' as const,
    transferGroupKey: key,
    // Never a bare row: a file opened in a SQLite browser should say what these
    // two entries are. The movement lists drop this note, because a row that
    // already reads "moved between places" does not need it twice.
    note: input.note ?? 'Moved between holdings',
  }

  insertDeposits(db, [
    { ...shared, amount: money(-magnitude, input.amount.currency), holdingId: input.fromHoldingId },
    { ...shared, amount: money(magnitude, input.amount.currency), holdingId: input.toHoldingId },
  ])

  return decodeDeposits(
    query(db, `${DEPOSIT_SELECT} AND transfer_group_key = ? ORDER BY amount_minor`, [key]),
  )
}

// --- Deposits a plan proposes -----------------------------------------------

export class GoalHasNoHoldingError extends Error {
  constructor(readonly goalName: string) {
    super(
      `${goalName} has no default holding, so there is nowhere to record this deposit. Give the goal one and apply again.`,
    )
    this.name = 'GoalHasNoHoldingError'
  }
}

/**
 * The ref a plan's deposit is unique per: one per plan, per month, per bucket.
 *
 * The bucket rather than the goal, because two buckets in one plan may point at
 * the same goal on purpose — "house" and "house, from the bonus" — and keying on
 * the goal would make the second overwrite the first.
 */
export function planDepositRef(planId: string, period: YearMonth, bucketId: string): string {
  return `${planId}:${toYearMonthString(period)}:${bucketId}`
}

/**
 * Record — or correct — the deposit a split plan proposes for one bucket.
 *
 * Upserted on the ref above, so applying a plan twice moves a figure rather than
 * adding a second deposit. That is the mechanism the unique index enforces
 * (D-075); the splitter's own
 * "diffs against what is already there" (D-058) reads the other side of it
 * through `planDeposits`.
 *
 * **Dated the first of the month it plans**, not today: a plan applied to
 * September on the 28th of August is a claim about September, and dating it
 * today would put it in the wrong month's contribution bar.
 */
export function applyPlanDeposit(
  db: Database,
  input: {
    readonly planId: string
    readonly period: YearMonth
    readonly bucketId: string
    readonly goalId: string
    readonly amount: Money
  },
  _now: number,
): void {
  const goal = findGoal(db, input.goalId)
  if (goal === undefined) return

  const holdingId = goal.defaultHoldingId
  // The same refusal a payslip's deposit meets (`fedDeposits`), for the same reason: money has
  // to sit somewhere, and picking a holding on the user's behalf would put it
  // somewhere they never said.
  if (holdingId === undefined) throw new GoalHasNoHoldingError(goal.name)

  const ref = planDepositRef(input.planId, input.period, input.bucketId)
  const existing = decodeDeposits(
    query(db, `${DEPOSIT_SELECT} AND source_kind = 'FROM_PLAN' AND source_key = ?`, [ref]),
  )[0]

  if (existing !== undefined) {
    updateRow(db, declared(db, 'saving_deposit'), existing.id, {
      amount_minor: input.amount.minor,
      amount_currency: input.amount.currency,
      holding: holdingId,
    })
    return
  }

  insertDeposits(db, [
    {
      goalId: input.goalId,
      date: localDate(input.period.year, input.period.month, 1),
      amount: input.amount,
      holdingId,
      sourceKind: 'FROM_PLAN',
      sourceRefId: ref,
      note: `Planned for ${toYearMonthString(input.period)}`,
    },
  ])
}

/**
 * What a plan has already put into each goal for one month, keyed by **goal id**
 * — the shape `applyPlan` diffs against.
 *
 * Keyed by goal because that is what a suggestion names; two buckets pointing at
 * one goal therefore read as one figure here, which is the right answer to
 * "how much of this month's plan has already landed in this goal".
 */
export function planDeposits(
  db: Database,
  planId: string,
  period: YearMonth,
  currency: CurrencyCode,
): ReadonlyMap<string, Money> {
  const prefix = `${planId}:${toYearMonthString(period)}:`
  const rows = decodeDeposits(
    query(db, `${DEPOSIT_SELECT} AND source_kind = 'FROM_PLAN' AND source_key LIKE ?`, [
      `${prefix}%`,
    ]),
  )

  const byGoal = new Map<string, Money>()
  for (const row of rows) {
    if (row.amount.currency !== currency) continue
    const running = byGoal.get(row.goalId)
    byGoal.set(row.goalId, money((running?.minor ?? 0) + row.amount.minor, currency))
  }
  return byGoal
}

/**
 * Which holding each goal's money for one month actually landed in.
 *
 * **The deposit's own holding, not the goal's default**, which is the whole
 * point of asking: the default is where the *next* generated deposit would go,
 * and one already written may since have been moved. The trace view is about
 * where the money is (D-193).
 *
 * Matched by source ref rather than by date, because neither generated deposit
 * is dated inside the month it belongs to — a payroll deposit carries the
 * payment date, which is usually the month after the salary month, and a plan's
 * is dated the first of the month it plans.
 */
export function generatedDepositHoldings(
  db: Database,
  period: YearMonth,
  paycheckId: string | undefined,
  planId: string | undefined,
): ReadonlyMap<string, string> {
  const byGoal = new Map<string, string>()

  const collect = (clause: string, params: readonly string[]): void => {
    for (const row of decodeDeposits(query(db, `${DEPOSIT_SELECT} AND ${clause}`, [...params]))) {
      byGoal.set(row.goalId, row.holdingId)
    }
  }

  if (paycheckId !== undefined) {
    collect(`source_kind = 'FROM_PAYCHECK_DEDUCTION' AND source_key LIKE ?`, [`${paycheckId}:%`])
  }
  if (planId !== undefined) {
    collect(`source_kind = 'FROM_PLAN' AND source_key LIKE ?`, [
      `${planId}:${toYearMonthString(period)}:%`,
    ])
  }

  return byGoal
}

// --- Reading across everything ----------------------------------------------

/** How many complete months the total-spending figure averages over. */
export const SPENDING_WINDOW_MONTHS = 3

/**
 * The two monthly figures an emergency-fund multiplier can be a multiple of.
 *
 * Assembled here for the reason `fundDepositCheck` is (D-067): the floor comes
 * from `fixedExpenseBasis` — the only function allowed to produce it, because it
 * is the one that refuses to subtract a payroll deduction twice (D-053) — and
 * the comfortable figure comes from the ledger. A screen gathering them itself
 * could pair one month's fixed expenses with another month's spending, and the
 * result would look like an answer.
 *
 * **Both are about complete months.** The fixed-expense figure is taken for the
 * last complete month, and the spending figure is the mean of the last three,
 * divided by **the months that actually carry transactions** rather than by
 * three — a month the app was never shown is not a month of no spending, and
 * dividing by it would quietly halve the target (D-072's rule for the
 * contribution rate). Ending the window at today would report a fraction of a
 * month as a month, which is D-055's argument for the fixed-expense screen.
 */
export function monthlyExpenses(
  db: Database,
  asOf: LocalDate,
  currency: CurrencyCode,
): MonthlyExpenses {
  const lastComplete = addMonths(yearMonthOf(asOf), -1)

  const fixed = fixedExpenseBasis(listFixedExpenses(db), lastComplete, currency)
  // The buckets a person ticked count beside the fixed expenses (M28 F10): Groceries as
  // unavoidable as the rent. Ticked and given nothing this month adds nothing.
  const alongside = cushionBuckets(db, asOf, currency)
    .filter((bucket) => bucket.included)
    .map((bucket) => ({ name: bucket.name, amount: bucket.amount }))
  const extra = alongside.reduce((running, bucket) => running + bucket.amount.minor, 0)
  const fixedExpenses =
    fixed.subtracted.length === 0
      ? alongside.length === 0
        ? undefined
        : money(extra, currency)
      : money(fixed.total.minor + extra, currency)

  const wanted = new Set<string>()
  for (let back = 0; back < SPENDING_WINDOW_MONTHS; back += 1) {
    wanted.add(toYearMonthString(addMonths(lastComplete, -back)))
  }

  const months = monthlyTotals(db).filter(
    (total) => total.currency === currency && wanted.has(total.period) && total.outflowMinor > 0,
  )
  const totalSpending =
    months.length === 0
      ? undefined
      : money(
          Math.round(
            months.reduce((running, month) => running + month.outflowMinor, 0) / months.length,
          ),
          currency,
        )

  return { fixedExpenses, totalSpending, alongside }
}

/**
 * Everything the savings screens read, from one load of the rows.
 *
 * The same call for the goals list, the "where is my money" breakdown and the
 * totals — `savingsOverview` computes them in one pass so no two screens can
 * disagree. The funds are among the holdings (D-389), so they are in the split
 * once, as their rows, and on the locked side of it.
 */
export interface SavingsSummary extends SavingsOverview {
  readonly monthly: MonthlyExpenses
}

export function savingsSummary(
  db: Database,
  asOf: LocalDate,
  currency: CurrencyCode,
  options?: { readonly includeClosed?: boolean },
): SavingsSummary {
  const monthly = monthlyExpenses(db, asOf, currency)

  return {
    ...savingsOverview({
      goals: listGoals(db, { includeClosed: options?.includeClosed === true }),
      deposits: listDeposits(db),
      holdings: listHoldings(db, { includeArchived: true, includeFunds: true }),
      places: listHoldingPlaces(db, { includeArchived: true }),
      asOf,
      currency,
      monthly,
      goalFigures: goalFigures(db, currency),
      // A holding with a reading is worth it, whether or not a goal follows it (M30 F5).
      valuations: holdingValuations(db, currency),
    }),
    monthly,
  }
}

/**
 * Every fund as a row on the money map (D-177) — a fund is a holding in no
 * place (D-389), so it is this row rather than a place's line. The institution is resolved here because
 * `FundAccount` holds an id where the map wants a name, and a fund with no
 * reading yet is still a row — with no balance and no as-of date, which is the
 * honest way to say a fund exists and nobody has transcribed it.
 */
export function fundRows(db: Database, currency: CurrencyCode): readonly FundRow[] {
  return listFundsWithLatest(db).map((entry) => ({
    fundId: entry.fund.id,
    name: entry.fund.name,
    institution:
      entry.fund.institutionId === undefined
        ? undefined
        : findInstitutionById(db, entry.fund.institutionId)?.name,
    balance: entry.latest?.totalBalance ?? money(0, currency),
    asOf: entry.latest?.asOfDate,
  }))
}

/**
 * The money map: places with their holdings underneath, every fund as a row, and
 * the one liquidity split all of it adds up to.
 *
 * `savingsSummary` answers "how are the goals doing"; this answers "where is my
 * money, and how much of it should I believe" (D-176). They share the domain's
 * `liquiditySplit`, so the two screens cannot report a different total.
 */
export interface DocumentMoneyMap extends MoneyMap {
  /** Each holding with a reading: the day, what it printed, and its growth (M30 F5). */
  readonly worths: ReadonlyMap<string, HoldingWorth>
}

export function documentMoneyMap(db: Database, currency: CurrencyCode): DocumentMoneyMap {
  // **A holding with a reading is worth its latest reading** (M30 F5), whether or
  // not a goal follows it: before, a holding was Σ goal deposits, so a broker's
  // positions with their readings in and no goal showed 0.
  const worths = holdingWorths(db, currency)
  const map = moneyMap({
    deposits: listDeposits(db),
    holdings: listHoldings(db, { includeArchived: true, includeFunds: true }),
    places: listHoldingPlaces(db, { includeArchived: true }),
    funds: fundRows(db, currency),
    valuations: worthOf(worths),
    currency,
  })
  return { ...map, places: withStatements(db, map.places, currency), worths }
}

/**
 * **A bank or cash account's own place adds up to its statement** (M30 F7, D-376).
 *
 * Reported on a real document: *"everyday says reachable x and the cash in
 * everyday is 0. aren't they supposed to be the same?"* The place's Cash was the
 * goal deposits made into it, so with no goal it read 0 beside a statement that
 * said otherwise. Now the place's figure is the account's latest statement
 * (D-325), each goal saved there is a row with its part — the cushion split's
 * own parts (D-360), not a second reading of them — and its own Cash is what no
 * goal has taken. Any other holding there (a fixed deposit) is not in the
 * statement and is added to it, so the rows still add up to the place.
 *
 * Read on display only: the liquidity split above and every total still read
 * the deposits, so In the bank, Net worth and the cushion do not move. An
 * account with no statement balance keeps the deposits, which nothing else
 * counts (D-362).
 */
function withStatements(db: Database, places: readonly PlaceBalance[], currency: CurrencyCode): readonly PlaceBalance[] {
  const statements = new Map(
    accountBalances(db, currency).flatMap((one) =>
      one.statementBalance === undefined ? [] : [[one.accountId, { ...one, balance: one.statementBalance }] as const],
    ),
  )
  if (statements.size === 0) return places
  const parts = goalParts(db, currency)
  return places.map((row) => {
    const account = row.place?.accountId === undefined ? undefined : statements.get(row.place.accountId)
    if (account === undefined) return row
    const split = cushionSplit({ accounts: [{ ...account, counts: true }], parts, target: undefined, currency })
    const cash = row.holdings.find((held) => held.holding?.accountId === account.accountId)
    const others = row.holdings.filter((held) => held !== cash)
    const sum = (rows: readonly HoldingBalance[]): number => rows.reduce((total, held) => total + held.balance.minor, 0)
    const liquid = account.balance.minor + sum(others.filter((held) => held.isLiquid))
    const locked = sum(others.filter((held) => !held.isLiquid))
    return {
      ...row,
      balance: money(liquid + locked, currency),
      liquid: money(liquid, currency),
      locked: money(locked, currency),
      // The Cash's own figure is what is left; short, it keeps none and the check says so.
      holdings: row.holdings.map((held) =>
        held === cash && split.left !== undefined ? { ...held, balance: split.left } : held,
      ),
      statement: {
        balance: account.balance,
        cashHoldingId: cash?.holdingId,
        parts: split.parts,
        cash: split.left,
        short: split.check.kind === 'OVER' ? split.check.by : undefined,
      },
    }
  })
}

/** Each goal's money in each account: the net of its deposits into that account's own cash holding (D-360). */
export function goalParts(db: Database, currency: CurrencyCode): readonly GoalPartInput[] {
  const accountOf = new Map<string, string>()
  for (const holding of listHoldings(db, { includeArchived: true })) {
    if (holding.accountId !== undefined) accountOf.set(holding.id, holding.accountId)
  }
  if (accountOf.size === 0) return []
  const names = new Map(listGoals(db, { includeClosed: true }).map((goal) => [goal.id, goal.name]))
  const sums = new Map<string, GoalPartInput>()
  for (const deposit of listDeposits(db)) {
    const accountId = accountOf.get(deposit.holdingId)
    if (accountId === undefined || deposit.amount.currency !== currency) continue
    const key = `${deposit.goalId}\u0000${accountId}`
    const was = sums.get(key)
    sums.set(key, {
      goalId: deposit.goalId,
      goalName: names.get(deposit.goalId) ?? 'A goal this document no longer has',
      accountId,
      amount: money((was?.amount.minor ?? 0) + deposit.amount.minor, currency),
    })
  }
  return [...sums.values()]
}

/**
 * The holdings nobody has confirmed lately, for Home's attention list (D-176).
 *
 * A `RECORDED` holding nobody has counted in five months is the most likely
 * wrong figure in a document — nothing will ever arrive in the post to correct
 * it — so the app has to be the thing that asks.
 */
export function staleHoldings(
  db: Database,
  asOf: LocalDate,
  currency: CurrencyCode,
): readonly UnconfirmedHolding[] {
  // A reading is somebody counting it (M30 F5): its day stands as the last check.
  const worths = holdingWorths(db, currency)
  // A bank account's own Cash is what its statement leaves (M30 F7): the bank counts it, not a person.
  const inStatement = new Set(
    accountBalances(db, currency).flatMap((one) => (one.statementBalance === undefined ? [] : [one.accountId])),
  )
  const holdings = listHoldings(db)
    .filter((holding) => holding.accountId === undefined || !inStatement.has(holding.accountId))
    .map((holding) => {
      const read = worths.get(holding.id)?.asOf
      const day = read === undefined ? undefined : parseISODate(read)
      return day !== undefined && (holding.lastConfirmedAt === undefined || compareDates(day, holding.lastConfirmedAt) > 0)
        ? { ...holding, lastConfirmedAt: day }
        : holding
    })
  return unconfirmedHoldings(holdingBalances(listDeposits(db), holdings, currency, worthOf(worths)), asOf)
}

/** The worths as the valuations a balance takes: a reading replaces the sum (D-186). */
function worthOf(worths: ReadonlyMap<string, HoldingWorth>): ReadonlyMap<string, Money> {
  return new Map([...worths].map(([holdingId, one]) => [holdingId, one.worth]))
}

/** The totals and worked-out columns the pack declares on `saving_goal` (M36 U03). */
const GOAL_FIGURES = ['balance', 'opening', 'growth', 'liquid', 'put_in', 'progress'] as const

/** A goal with no row to read: nothing worked out. */
const NO_GOAL_FIGURES: GoalFigures = {
  balance: undefined,
  opening: undefined,
  growth: undefined,
  liquid: undefined,
  putIn: undefined,
  progress: undefined,
}

/**
 * **What the document works out about each goal** (M36 U03) — its declared
 * totals in one query, by goal id. A total of no deposits is zero in `currency`.
 *
 * **The declaration totals what a person typed; the feeds are added here**
 * (M36 U05, D-381). What a goal's feed brings is worked out on read and never
 * stored, so the declared `balance` cannot see it: a goal with fed deposits has
 * them added to its balance, growth and liquid — in one currency, or no figure,
 * as the declared sum refuses two — and its put-in and progress worked out
 * again from those, as the pack declares them.
 */
export function goalFigures(
  db: Database,
  currency: CurrencyCode,
  goalId?: string,
): ReadonlyMap<string, GoalFigures> {
  const read = declaredFigures(
    db,
    'saving_goal',
    GOAL_FIGURES,
    goalId === undefined ? '1 = 1' : 't.id = ?',
    goalId === undefined ? [] : [goalId],
  )
  const fed = fedDeposits(db).filter((one) => goalId === undefined || one.goalId === goalId)
  const liquid =
    fed.length === 0
      ? new Set<string>()
      : new Set(listHoldings(db, { includeArchived: true }).filter((one) => one.isLiquid).map((one) => one.id))
  const goals = fed.length === 0 ? new Map<string, SavingGoal>() : new Map(listGoals(db, { includeClosed: true }).map((one) => [one.id, one]))
  return new Map(
    [...read].map(([id, one]) => {
      const declared: GoalFigures = {
        balance: one.money('balance', currency),
        opening: one.money('opening', currency),
        growth: one.money('growth', currency),
        liquid: one.money('liquid', currency),
        putIn: one.money('put_in', currency),
        progress: one.number('progress'),
      }
      const brought = fed.filter((each) => each.goalId === id)
      return [id, brought.length === 0 ? declared : withFed(declared, brought, liquid, goals.get(id)?.targetAmount)]
    }),
  )
}

/** A goal's declared figures with what its feeds bring added (D-381). */
function withFed(
  declared: GoalFigures,
  fed: readonly SavingDeposit[],
  liquid: ReadonlySet<string>,
  target: Money | undefined,
): GoalFigures {
  const plus = (base: Money | undefined, deposits: readonly SavingDeposit[]): Money | undefined => {
    if (base === undefined) return undefined
    let minor = base.minor
    for (const one of deposits) {
      if (one.amount.currency !== base.currency) return undefined
      minor += one.amount.minor
    }
    return money(minor, base.currency)
  }
  const balance = plus(declared.balance, fed)
  const growth = plus(declared.growth, fed.filter((one) => one.sourceKind === 'GROWTH'))
  const putIn = balance === undefined || growth === undefined ? undefined : money(balance.minor - growth.minor, balance.currency)
  const progress =
    balance === undefined || target === undefined || target.currency !== balance.currency || target.minor === 0
      ? undefined
      : balance.minor / target.minor
  return {
    balance,
    opening: declared.opening,
    growth,
    liquid: plus(declared.liquid, fed.filter((one) => liquid.has(one.holdingId))),
    putIn,
    progress,
  }
}

/** One goal with everything derived about it — the goal detail screen's whole content. */
export function goalDetail(
  db: Database,
  goalId: string,
  asOf: LocalDate,
  currency: CurrencyCode,
): (GoalProgress & { readonly deposits: readonly SavingDeposit[] }) | undefined {
  const goal = findGoal(db, goalId)
  if (goal === undefined) return undefined

  const deposits = listDeposits(db, { goalId })
  const holdings = listHoldings(db, { includeArchived: true })
  const figures = goalFigures(db, currency, goalId).get(goalId)
  return {
    ...goalProgress({ goal, deposits, holdings, asOf, currency, figures: figures ?? NO_GOAL_FIGURES }),
    deposits,
  }
}

// --- Encoding and decoding --------------------------------------------------

/**
 * A rate and its basis, written as a pair or not at all.
 *
 * The one place the pairing is enforced. A rate with no basis could not be
 * rendered honestly — the screen would have to guess whether to say "as agreed"
 * or "an assumption" — and a basis with no rate is a claim about nothing.
 */
function returnColumns(
  basisPoints: number | undefined,
  basis: ReturnBasis | undefined,
): readonly [number | null, string | null] {
  if (basisPoints === undefined) return [null, null]
  return [basisPoints, basis ?? 'ASSUMED']
}

/** A goal's optional cells as the declaration names them. */
function goalColumns(
  goal: Pick<NewSavingGoal, 'targetAmount' | 'targetDate' | 'defaultHoldingId' | 'note'>,
): Record<string, string | number | null> {
  return {
    target_minor: goal.targetAmount?.minor ?? null,
    target_currency: goal.targetAmount?.currency ?? null,
    target_date: dateOrNull(goal.targetDate),
    default_holding: goal.defaultHoldingId ?? null,
    note: goal.note ?? null,
  }
}

function dateOrNull(date: LocalDate | undefined): string | null {
  return date === undefined ? null : toISODate(date)
}

const VALID_PLACE_KINDS: ReadonlySet<string> = new Set<string>(HOLDING_PLACE_KINDS)
const VALID_HOLDING_KINDS: ReadonlySet<string> = new Set<string>(HOLDING_KINDS)
const VALID_FUND_TYPES: ReadonlySet<string> = new Set<string>(FUND_TYPES)

/** A holding's fund type, when it is a fund this build knows (D-389). */
function fundTypeOf(value: unknown): FundType | undefined {
  return value != null && VALID_FUND_TYPES.has(String(value)) ? (String(value) as FundType) : undefined
}
const VALID_PROVENANCES: ReadonlySet<string> = new Set<string>(HOLDING_PROVENANCES)
const VALID_GOAL_KINDS: ReadonlySet<string> = new Set<string>(SAVING_GOAL_KINDS)
const VALID_SOURCE_KINDS: ReadonlySet<string> = new Set<string>(DEPOSIT_SOURCE_KINDS)
const VALID_RETURN_BASES: ReadonlySet<string> = new Set<string>(RETURN_BASES)

/**
 * Defensive, as everywhere else here: a `.emd` file is a real SQLite
 * database the user can open in any tool. A place of a kind this build has not
 * heard of is skipped rather than thrown — but note what that costs, and why it
 * is still right: its deposits then name a place the document does not have, and
 * the domain counts those as **locked**, which understates what is reachable
 * rather than overstating it.
 */
function decodePlaces(rows: readonly Record<string, unknown>[]): readonly HoldingPlace[] {
  const places: HoldingPlace[] = []
  for (const row of rows) {
    const kind = String(row['kind'])
    if (!VALID_PLACE_KINDS.has(kind)) continue

    places.push({
      id: String(row['id']),
      name: String(row['name']),
      kind: kind as HoldingPlaceKind,
      institution: text(row['institution']),
      note: text(row['note']),
      isArchived: Number(row['is_archived'] ?? 0) === 1,
      accountId: text(row['account']),
    })
  }
  return places
}

/**
 * A holding of an unrecognized kind or provenance is skipped, on the same terms
 * as a place: its deposits then name a holding this document does not have, and
 * the domain counts those as **locked**, which understates what is reachable
 * rather than overstating it.
 */
function decodeHoldings(rows: readonly Record<string, unknown>[]): readonly Holding[] {
  const holdings: Holding[] = []
  for (const row of rows) {
    const kind = String(row['kind'])
    if (!VALID_HOLDING_KINDS.has(kind)) continue
    const provenance = String(row['provenance'])
    if (!VALID_PROVENANCES.has(provenance)) continue

    const basisPoints = integer(row['expected_return_bp'])
    const basis = text(row['expected_return_basis'])

    holdings.push({
      id: String(row['id']),
      // An account's own cash in no place is in its account's own row (M36 U08).
      holdingPlaceId:
        text(row['holding_place_id']) ?? (text(row['account']) === undefined ? '' : accountWhereId(String(row['account']))),
      name: String(row['name']),
      kind: kind as HoldingKind,
      provenance: provenance as HoldingProvenance,
      lastConfirmedAt: date(row['last_confirmed_at']),
      isLiquid: Number(row['is_liquid'] ?? 0) === 1,
      expectedReturn:
        basisPoints === undefined
          ? undefined
          : {
              basisPoints,
              // A rate whose basis the file does not state is read as an
              // assumption. The other way round would put words in a bank's
              // mouth, and this is the direction that only ever understates the
              // app's confidence.
              basis:
                basis !== undefined && VALID_RETURN_BASES.has(basis)
                  ? (basis as ReturnBasis)
                  : 'ASSUMED',
            },
      termEndDate: date(row['term_end_date']),
      feeBasisPoints: integer(row['fee_bp']),
      note: text(row['note']),
      isArchived: Number(row['is_archived'] ?? 0) === 1,
      accountId: text(row['account']),
      ...(fundTypeOf(row['fund_type']) === undefined ? {} : { fundType: fundTypeOf(row['fund_type']) }),
    })
  }
  return holdings
}

function decodeGoals(rows: readonly Record<string, unknown>[]): readonly SavingGoal[] {
  const goals: SavingGoal[] = []
  for (const row of rows) {
    const kind = String(row['kind'])
    if (!VALID_GOAL_KINDS.has(kind)) continue

    const targetMinor = integer(row['target_amount_minor'])
    const targetCurrency = text(row['target_currency'])

    goals.push({
      id: String(row['id']),
      name: String(row['name']),
      kind: kind as SavingGoalKind,
      targetAmount:
        targetMinor === undefined || targetCurrency === undefined
          ? undefined
          : money(targetMinor, targetCurrency),
      targetDate: date(row['target_date']),
      defaultHoldingId: text(row['default_holding_id']),
      isClosed: Number(row['is_closed'] ?? 0) === 1,
      priority: Number(row['priority'] ?? 0),
      note: text(row['note']),
    })
  }
  return goals
}

/**
 * A deposit with no readable date is skipped: the date is what every ordering,
 * every window and the contribution rate are built on.
 *
 * Its amount is **not** skipped for being odd — a negative one is a withdrawal
 * and that is the whole design.
 */
function decodeDeposits(rows: readonly Record<string, unknown>[]): readonly SavingDeposit[] {
  const deposits: SavingDeposit[] = []
  for (const row of rows) {
    const when = date(row['date'])
    if (when === undefined) continue

    const sourceKind = String(row['source_kind'])

    deposits.push({
      id: String(row['id']),
      goalId: String(row['goal_id']),
      date: when,
      amount: money(Number(row['amount_minor'] ?? 0), String(row['currency'])),
      holdingId: String(row['holding_id']),
      sourceKind: VALID_SOURCE_KINDS.has(sourceKind)
        ? (sourceKind as DepositSourceKind)
        : 'MANUAL',
      sourceRefId: text(row['source_ref_id']),
      transferGroupKey: text(row['transfer_group_key']),
      note: text(row['note']),
    })
  }
  return deposits
}

function text(value: unknown): string | undefined {
  return value == null ? undefined : String(value)
}

function integer(value: unknown): number | undefined {
  return value == null ? undefined : Number(value)
}

function date(value: unknown): LocalDate | undefined {
  return value == null ? undefined : parseISODate(String(value))
}
