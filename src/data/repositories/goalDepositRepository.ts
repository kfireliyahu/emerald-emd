import type { Database } from 'sql.js'

import { money, type CurrencyCode, type Money } from '@/core/money.ts'
import { parseISODate, toISODate, toYearMonthString } from '@/core/time.ts'
import {
  costBasisCheck,
  sourceKindForOrigin,
  wantedDeposit,
  type CostBasisCheck,
  type FiledTransaction,
  type WantedDeposit,
} from '@/domain/goalDeposits.ts'
import { READING_GROWTH_PREFIX, readingGrowth } from '@/domain/holdingReadings.ts'
import type { DepositSourceKind, GoalFeed, SavingDeposit, SavingGoal } from '@/domain/model/savings.ts'
import { payrollSavingDeposits } from '@/domain/savings.ts'
import { query } from '../db/database.ts'
import { allDeclared, declared } from '../packs/ledger/tables.ts'
import { deleteRows, updateRow } from './formatRowRepository.ts'
import { countsCondition, heldCondition, isMovedKind } from './movedRepository.ts'
import type { CategoryKind } from './categoryRepository.ts'
import { findAccountById } from './accountRepository.ts'
import { listDeductionTypes } from './deductionTypeRepository.ts'
import { listPaychecksWithLines } from './paycheckRepository.ts'
import {
  findGoal,
  findHolding,
  GoalHasNoHoldingError,
  goalFigures,
  listGoals,
} from './savingsRepository.ts'
import { listHoldingReadings, rowsPutIn } from './holdingReadingRepository.ts'

/**
 * **A goal is fed by one source, and only one** (M28 U8, D-324; M30 U4, D-357).
 *
 * - **A Money moved category**: a transaction filed under it is a
 *   `FROM_TRANSACTION` deposit — the bank's side of money that left for the goal.
 * - **Its holding's own rows**: every row that names the goal's default holding
 *   — a buy or a sale inside an account with holdings (M30 U2) — is one.
 *   The transfer that brought the cash to that account feeds nothing: it is the
 *   same money, and the buys are where it became the goal's.
 *
 * **Never both, and one goal per category or holding**, so a row is a deposit
 * into one goal at most: a category feed reads no held row (D-355), and a
 * holding feed reads nothing else.
 *
 * **Filing is the only step, and nothing is stored** (M36 U05, D-381). What a
 * feed brings — a row filed under the category, a buy, a transfer, a payslip's
 * line, a reading's growth — is worked out on read by `fedDeposits`, and
 * `listDeposits` hands it out beside what a person typed. A row re-filed
 * elsewhere takes its deposit with it because there is nothing to take: until
 * M36 a sync after every write kept stored copies in step, and every place that
 * wrote without it was a balance that lagged.
 */

export class NotMoneyMovedCategoryError extends Error {
  constructor(readonly categoryName: string) {
    super(
      `"${categoryName}" is not a Money moved category. A goal reads its deposits from a category whose ` +
        'money went to something you own (a transfer or a saving), so a spending category cannot be one.',
    )
    this.name = 'NotMoneyMovedCategoryError'
  }
}

export class CategoryTakenError extends Error {
  constructor(
    readonly categoryName: string,
    readonly goalName: string,
  ) {
    super(`"${categoryName}" already feeds ${goalName}. One category per goal, so a transfer is never counted twice.`)
    this.name = 'CategoryTakenError'
  }
}

export class NoSuchCategoryError extends Error {
  constructor(readonly categoryId: string) {
    super(`No category with id ${categoryId}.`)
    this.name = 'NoSuchCategoryError'
  }
}

/** Why a goal cannot be fed by its holding's rows. */
export class HoldingFeedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HoldingFeedError'
  }
}

/** Goal id to the category that feeds it. A goal fed by its holding or its transfers reads no category. */
export function goalDepositCategories(db: Database): ReadonlyMap<string, string> {
  return new Map(
    query(
      db,
      `SELECT id, deposit_category FROM fmt_saving_goal
        WHERE deposit_category IS NOT NULL AND COALESCE(fed_by_holding, 0) = 0 AND COALESCE(fed_by_transfers, 0) = 0`,
    ).map((row) => [String(row['id']), String(row['deposit_category'])]),
  )
}

/**
 * Goal id to the account whose confirmed transfers feed it (M30 F4): the account whose own
 * Cash is the goal's default holding. One goal per account: should two ever say so (a
 * hand-edited file — the write refuses it), the first by id is fed, so a transfer is still
 * never counted twice. Only a bank or cash account's (D-355: a broker's cash is no feed).
 */
export function goalTransferFeeds(db: Database): ReadonlyMap<string, string> {
  const feeds = new Map<string, string>()
  const taken = new Set<string>()
  for (const row of query(
    db,
    `SELECT g.id, h.account
       FROM fmt_saving_goal g
       JOIN fmt_holding h ON h.id = g.default_holding
       JOIN fmt_account a ON a.id = h.account
      WHERE g.fed_by_transfers = 1 AND a.kind IN ('BANK', 'CASH')
      ORDER BY g.id`,
  )) {
    const accountId = String(row['account'])
    if (taken.has(accountId)) continue
    taken.add(accountId)
    feeds.set(String(row['id']), accountId)
  }
  return feeds
}

/**
 * Goal id to the holding whose rows feed it (M30 U4). One goal per holding: should two
 * ever say so (a hand-edited file — the write refuses it), the first by id is fed and the
 * second is not, so a row is still never counted twice.
 */
export function goalHoldingFeeds(db: Database): ReadonlyMap<string, string> {
  const feeds = new Map<string, string>()
  const taken = new Set<string>()
  for (const row of query(
    db,
    'SELECT id, default_holding FROM fmt_saving_goal WHERE fed_by_holding = 1 AND default_holding IS NOT NULL ORDER BY id',
  )) {
    const holdingId = String(row['default_holding'])
    if (taken.has(holdingId)) continue
    taken.add(holdingId)
    feeds.set(String(row['id']), holdingId)
  }
  return feeds
}

/**
 * **Which goals real money already feeds**, and what feeds each — the one "has a feed" check
 * (M28 F27). A goal in this map takes no deposit from a plan: its month's money arrives through
 * the feed, and a planned deposit beside it would count the same money twice.
 */
export function goalFeeds(db: Database): ReadonlyMap<string, GoalFeed> {
  const categories = goalDepositCategories(db)
  const holdings = goalHoldingFeeds(db)
  const transfers = goalTransferFeeds(db)
  if (categories.size === 0 && holdings.size === 0 && transfers.size === 0) return new Map()
  const feeds = new Map<string, GoalFeed>()
  for (const [goalId, categoryId] of categories) {
    feeds.set(goalId, { kind: 'CATEGORY', id: categoryId, name: findCategoryInfo(db, categoryId)?.name ?? categoryId })
  }
  for (const [goalId, holdingId] of holdings) {
    feeds.set(goalId, { kind: 'HOLDING', id: holdingId, name: findHolding(db, holdingId)?.name ?? holdingId })
  }
  for (const [goalId, accountId] of transfers) {
    feeds.set(goalId, { kind: 'TRANSFERS', id: accountId, name: findAccountById(db, accountId)?.name ?? accountId })
  }
  return feeds
}

export interface DepositCategoryInfo {
  readonly id: string
  readonly name: string
  readonly kind: CategoryKind
}

export function findCategoryInfo(db: Database, id: string): DepositCategoryInfo | undefined {
  const row = query(db, 'SELECT id, name, kind FROM fmt_category WHERE id = ?', [id])[0]
  return row === undefined
    ? undefined
    : { id: String(row['id']), name: String(row['name']), kind: String(row['kind']) as CategoryKind }
}

/**
 * Why a goal cannot read from this category, as the error that says so; undefined
 * when it can. The same judgement the write throws and the tool's dry run prints.
 */
export function depositCategoryProblem(db: Database, goal: SavingGoal, categoryId: string): Error | undefined {
  const category = findCategoryInfo(db, categoryId)
  if (category === undefined) return new NoSuchCategoryError(categoryId)
  if (!isMovedKind(category.kind)) return new NotMoneyMovedCategoryError(category.name)
  const taken = query(db, 'SELECT id FROM fmt_saving_goal WHERE deposit_category = ? AND id <> ?', [
    categoryId,
    goal.id,
  ])[0]
  if (taken !== undefined) {
    return new CategoryTakenError(category.name, findGoal(db, String(taken['id']))?.name ?? 'another goal')
  }
  // A deposit sits in a holding, and picking one for the person would put it somewhere they never said.
  if (goal.defaultHoldingId === undefined) return new GoalHasNoHoldingError(goal.name)
  return undefined
}

/**
 * Why a goal cannot be fed by the rows that name its default holding; undefined when it
 * can. The goal is judged as given, so the tool can judge one whose holding it is changing.
 */
export function holdingFeedProblem(db: Database, goal: SavingGoal): Error | undefined {
  if (goal.defaultHoldingId === undefined) return new GoalHasNoHoldingError(goal.name)
  const holding = findHolding(db, goal.defaultHoldingId)
  if (holding === undefined) return new HoldingFeedError('That holding no longer exists.')
  if (holding.accountId !== undefined) {
    return new HoldingFeedError(
      `${holding.name} is an account's own cash, and no row buys cash. Feed ${goal.name} from a category instead.`,
    )
  }
  const taken = query(
    db,
    'SELECT name FROM fmt_saving_goal WHERE fed_by_holding = 1 AND default_holding = ? AND id <> ?',
    [holding.id, goal.id],
  )[0]
  if (taken !== undefined) {
    return new HoldingFeedError(
      `${holding.name}'s rows already feed ${String(taken['name'])}. One goal per holding, so a buy is never counted twice.`,
    )
  }
  return undefined
}

/**
 * Why a goal cannot be fed by the transfers into its account (M30 F4); undefined when it can.
 * Its money has to be a bank or cash account's own Cash (D-362) — a broker's cash is no feed
 * (D-355), since the buys there are its holdings' — and one goal per account.
 */
export function transferFeedProblem(db: Database, goal: SavingGoal): Error | undefined {
  if (goal.defaultHoldingId === undefined) return new GoalHasNoHoldingError(goal.name)
  const holding = findHolding(db, goal.defaultHoldingId)
  if (holding === undefined) return new HoldingFeedError('That holding no longer exists.')
  const account = holding.accountId === undefined ? undefined : findAccountById(db, holding.accountId)
  if (account === undefined || (account.kind !== 'BANK' && account.kind !== 'CASH')) {
    return new HoldingFeedError(
      `${holding.name} is not a bank account's own cash, so no transfer arrives in it. Only a goal whose money ` +
        'is in a bank or cash account counts the transfers into it.',
    )
  }
  const taken = query(
    db,
    `SELECT g.name FROM fmt_saving_goal g JOIN fmt_holding h ON h.id = g.default_holding
      WHERE g.fed_by_transfers = 1 AND h.account = ? AND g.id <> ?`,
    [account.id, goal.id],
  )[0]
  if (taken !== undefined) {
    return new HoldingFeedError(
      `The transfers into ${account.name} already feed ${String(taken['name'])}. One goal per account, so a ` +
        'transfer is never counted twice.',
    )
  }
  return undefined
}

/** What a goal is fed by after a write: a category, its holding's rows, its account's transfers, or nothing. */
export type GoalFeedChoice =
  | { readonly kind: 'CATEGORY'; readonly categoryId: string }
  | { readonly kind: 'HOLDING' }
  | { readonly kind: 'TRANSFERS' }
  | undefined

/** The one judgement for any feed; undefined when the goal can take it. */
export function goalFeedProblem(db: Database, goal: SavingGoal, choice: GoalFeedChoice): Error | undefined {
  if (choice === undefined) return undefined
  if (choice.kind === 'CATEGORY') return depositCategoryProblem(db, goal, choice.categoryId)
  return choice.kind === 'HOLDING' ? holdingFeedProblem(db, goal) : transferFeedProblem(db, goal)
}

/**
 * Point a goal at one feed, or at none. Choosing one clears the other: a goal is
 * never fed twice. Returns how many deposits the feed now reads for it — worked
 * out on read, so there is nothing to bring in line (D-381).
 */
export function setGoalFeed(db: Database, goalId: string, choice: GoalFeedChoice, _now: number): number {
  const goal = findGoal(db, goalId)
  if (goal === undefined) throw new Error('No such goal')
  const problem = goalFeedProblem(db, goal, choice)
  if (problem !== undefined) throw problem

  const cells: Record<string, string | number | null> = {
    deposit_category: choice?.kind === 'CATEGORY' ? choice.categoryId : null,
    fed_by_holding: choice?.kind === 'HOLDING' ? 1 : null,
    fed_by_transfers: choice?.kind === 'TRANSFERS' ? 1 : null,
  }
  updateRow(db, declared(db, 'saving_goal'), goalId, cells)
  return fedDeposits(db).filter((one) => one.goalId === goalId && one.sourceKind === 'FROM_TRANSACTION').length
}

function filedRows(db: Database, where: string, parameter: string): readonly FiledTransaction[] {
  return query(
    db,
    `SELECT id, transaction_date, amount_minor, amount_currency
       FROM fmt_transaction WHERE ${where} AND ${countsCondition()}`,
    [parameter],
  ).map((row) => ({
    id: String(row['id']),
    date: String(row['transaction_date']),
    minor: Number(row['amount_minor']),
    currency: String(row['amount_currency']) as CurrencyCode,
  }))
}

/**
 * The rows a feed reads. A category reads what was filed under it and is not held —
 * a buy filed under it is its holding's, and the end of a transfer that arrived where
 * things are held is the same money as the bank's end — and a holding reads the rows
 * that name it.
 */
function rowsOf(db: Database, feed: GoalFeed, claimed: ReadonlySet<string>): readonly FiledTransaction[] {
  if (feed.kind === 'CATEGORY') {
    return filedRows(db, `category = ? AND NOT ${heldCondition()}`, feed.id).filter((row) => !claimed.has(row.id))
  }
  return filedRows(db, 'holding = ?', feed.id)
}

/**
 * **The transfers a goal reads** (M30 F4): every confirmed pair (D-356) with an end on the
 * goal's account — arriving there is a deposit, leaving it a withdrawal — dated after the
 * latest *Was already there* the goal holds there, since that figure already counts every
 * transfer before it. Turned around so `wantedDeposit` turns them back: what arrived is put in.
 */
function transferRows(db: Database, goalId: string, accountId: string, holdingId: string): readonly FiledTransaction[] {
  const since = query(
    db,
    `SELECT MAX(date) AS since FROM fmt_saving_deposit
      WHERE goal = ? AND holding = ? AND source_kind = ?`,
    [goalId, holdingId, sourceKindForOrigin('ALREADY_THERE')],
  )[0]?.['since']
  const after = since === undefined || since === null ? null : String(since)
  return query(
    db,
    `SELECT t.id, t.transaction_date, t.amount_minor, t.amount_currency
       FROM fmt_transfer_pair p
       JOIN fmt_transaction t ON t.id IN (p.out_transaction, p.in_transaction)
      WHERE p.user_decision = 'PAIRED' AND t.account = ? AND ${countsCondition('t')}
        AND (? IS NULL OR t.transaction_date > ?)`,
    [accountId, after, after],
  ).map((row) => ({
    id: String(row['id']),
    date: String(row['transaction_date']),
    minor: -Number(row['amount_minor']),
    currency: String(row['amount_currency']) as CurrencyCode,
  }))
}

/** Both ends of every pair a goal's transfers read: no category counts them a second time. */
function claimedByTransfers(db: Database, rowIds: readonly string[]): ReadonlySet<string> {
  const claimed = new Set<string>()
  for (const id of rowIds) {
    const pair = query(
      db,
      'SELECT out_transaction, in_transaction FROM fmt_transfer_pair WHERE out_transaction = ? OR in_transaction = ?',
      [id, id],
    )[0]
    if (pair === undefined) continue
    claimed.add(String(pair['out_transaction']))
    claimed.add(String(pair['in_transaction']))
  }
  return claimed
}

/** The id a deposit worked out on read carries: never a stored row's, so no edit or delete takes it. */
export const FED_PREFIX = 'fed:'

/**
 * **The deposits a build before M36 U05 stored for a feed, removed** (D-381):
 * the rows `syncGoalFeeds` and `syncPayrollDeposits` kept, which `fedDeposits`
 * works out on read now and which would otherwise count twice. Nothing a person
 * typed is touched — a growth row typed by hand has no reading's key. Run on
 * every open (`bringUpToDate`); a document that has none changes nothing.
 */
export function dropStoredFeeds(db: Database): number {
  const ids = query(
    db,
    `SELECT id FROM fmt_saving_deposit
      WHERE source_kind IN ('FROM_TRANSACTION', 'FROM_PAYCHECK_DEDUCTION')
         OR (source_kind = 'GROWTH' AND COALESCE(source_key, '') LIKE '${READING_GROWTH_PREFIX}%')`,
  ).map((row) => String(row['id']))
  if (ids.length > 0) deleteRows(db, declared(db, 'saving_deposit'), ids, allDeclared(db))
  return ids.length
}

/**
 * **Every deposit a feed brings, worked out on read** (M36 U05, D-381) — what
 * `syncGoalFeeds` and `syncPayrollDeposits` stored after every write until then:
 *
 * - **a goal's one feed** — the rows filed under its category, the rows naming
 *   its holding, the confirmed transfers into its account — one `FROM_TRANSACTION`
 *   each, keyed by the transaction;
 * - **a payslip's saving lines** linked to a goal, one `FROM_PAYCHECK_DEDUCTION`
 *   per slip and goal (D-075);
 * - **a reading's growth** for a goal fed by its holding: the reading less what
 *   went in by its day, one `GROWTH` per reading (D-358), so the goal's balance
 *   comes to its latest reading and what went in after it.
 *
 * A goal with no default holding takes none: the money has to sit somewhere.
 * Four cheap queries when nothing feeds, which is nearly always.
 */
export function fedDeposits(db: Database): readonly SavingDeposit[] {
  const categories = goalDepositCategories(db)
  const holdings = goalHoldingFeeds(db)
  const transfers = goalTransferFeeds(db)
  const types = listDeductionTypes(db).filter((type) => type.linkedSavingGoalId !== undefined)
  if (categories.size === 0 && holdings.size === 0 && transfers.size === 0 && types.length === 0) return []

  const goals = listGoals(db, { includeClosed: true })
  const holdingOf = new Map(
    goals.flatMap((goal) => (goal.defaultHoldingId === undefined ? [] : [[goal.id, goal.defaultHoldingId] as const])),
  )
  const out: SavingDeposit[] = []
  const fed = (goalId: string, kind: DepositSourceKind, one: WantedDeposit, note?: string): void => {
    const holdingId = holdingOf.get(goalId)
    const date = parseISODate(one.date)
    if (holdingId === undefined || date === undefined) return
    out.push({
      id: `${FED_PREFIX}${goalId}:${one.key}`,
      goalId,
      date,
      amount: money(one.minor, one.currency),
      holdingId,
      sourceKind: kind,
      sourceRefId: one.key,
      transferGroupKey: undefined,
      note,
    })
  }

  // The transfers first: a pair one of them reads is that goal's, and no category's as well.
  const transferred = new Map<string, readonly FiledTransaction[]>()
  for (const [goalId, accountId] of transfers) {
    const holdingId = holdingOf.get(goalId)
    if (holdingId !== undefined) transferred.set(goalId, transferRows(db, goalId, accountId, holdingId))
  }
  const claimed = claimedByTransfers(db, [...transferred.values()].flat().map((row) => row.id))
  for (const [goalId, rows] of transferred) for (const row of rows) fed(goalId, 'FROM_TRANSACTION', wantedDeposit(row))
  for (const [goalId, categoryId] of categories) {
    for (const row of rowsOf(db, { kind: 'CATEGORY', id: categoryId, name: '' }, claimed)) {
      fed(goalId, 'FROM_TRANSACTION', wantedDeposit(row))
    }
  }
  for (const [goalId, holdingId] of holdings) {
    for (const row of rowsOf(db, { kind: 'HOLDING', id: holdingId, name: '' }, claimed)) {
      fed(goalId, 'FROM_TRANSACTION', wantedDeposit(row))
    }
  }

  if (types.length > 0) {
    for (const one of payrollSavingDeposits(listPaychecksWithLines(db), types, goals)) {
      fed(
        one.goalId,
        'FROM_PAYCHECK_DEDUCTION',
        { key: one.sourceRefId, date: toISODate(one.date), minor: one.amount.minor, currency: one.amount.currency },
        `From the ${toYearMonthString(one.period)} payslip`,
      )
    }
  }

  for (const [goalId, holdingId] of holdings) {
    if (holdingOf.get(goalId) !== holdingId) continue
    for (const one of readingGrowthOf(db, goalId, holdingId, out)) fed(goalId, 'GROWTH', one)
  }
  return out
}

/**
 * **Growth is a reading less what went in by its day** (M30 U5, D-358): one per
 * reading of the holding a goal is fed by. What went in is the goal's deposits
 * there — what a person typed and what the feeds bring — and the currency is the
 * one they are in, else the latest reading's: a goal is one currency (D-003).
 */
function readingGrowthOf(
  db: Database,
  goalId: string,
  holdingId: string,
  fed: readonly SavingDeposit[],
): readonly WantedDeposit[] {
  const readings = listHoldingReadings(db, holdingId)
  if (readings.length === 0) return []
  const typed = query(
    db,
    'SELECT date, amount_minor, amount_currency, source_kind FROM fmt_saving_deposit WHERE goal = ? AND holding = ?',
    [goalId, holdingId],
  ).map((row) => ({
    date: String(row['date']),
    minor: Number(row['amount_minor']),
    currency: String(row['amount_currency']) as CurrencyCode,
    growth: String(row['source_kind']) === 'GROWTH',
  }))
  const brought = fed
    .filter((one) => one.goalId === goalId && one.holdingId === holdingId && one.sourceKind !== 'GROWTH')
    .map((one) => ({ date: toISODate(one.date), minor: one.amount.minor, currency: one.amount.currency, growth: false }))
  const putIn = [...typed, ...brought]
  const counts = new Map<string, number>()
  for (const one of putIn) if (!one.growth) counts.set(one.currency, (counts.get(one.currency) ?? 0) + 1)
  const common = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
  const currency = common ?? readings[readings.length - 1]?.value.currency
  if (currency === undefined) return []
  return readingGrowth(
    readings.map((one) => ({ id: one.id, asOf: one.asOf, value: one.value })),
    putIn,
    currency,
  )
}

// --- What a holding's rows put in -------------------------------------------

/** What the rows that name a holding put into it, and whether that is what it cost. */
export interface HoldingPutIn {
  /** How many rows name it, bought and sold. */
  readonly rows: number
  /** Their amounts summed and turned around: bought is put in, sold is taken back. */
  readonly putIn: Money
  /**
   * The latest reading that printed a cost, and what the rows put in by its day — the
   * figure the check compares (M30 U5). Absent until a reading prints a cost.
   */
  readonly reading?: { readonly asOf: string; readonly rows: number; readonly putIn: Money }
  readonly check: CostBasisCheck
}

/**
 * **A holding's rows, against the cost basis its latest reading printed** (M30 U4,
 * D-357; U5, D-358) — by the reading's own day, so a buy after it is not counted
 * against a cost that could not include it. `unchecked`, and why, until a reading
 * prints a cost: never a quiet `proved`.
 */
export function holdingPutIn(db: Database, holdingId: string, currency: CurrencyCode): HoldingPutIn {
  const all = rowsPutIn(db, holdingId, currency)
  const reading = [...listHoldingReadings(db, holdingId)].reverse().find((one) => one.costBasis !== undefined)
  if (reading === undefined) {
    return { rows: all.rows, putIn: all.putIn, check: costBasisCheck(all.putIn, undefined, all.otherCurrencies) }
  }
  const by = rowsPutIn(db, holdingId, currency, reading.asOf)
  return {
    rows: all.rows,
    putIn: all.putIn,
    reading: { asOf: reading.asOf, rows: by.rows, putIn: by.putIn },
    check: costBasisCheck(by.putIn, reading.costBasis, by.otherCurrencies),
  }
}

/** What a goal fed by its holding is worth, and what went in — the goal views' two figures (M30 U5). */
export interface GoalWorth {
  /** The day of the holding's latest reading. */
  readonly asOf: string
  /** The goal's balance: its latest reading, and what went in after its day at cost. */
  readonly worth: Money
  /** What the goal's deposits put in, growth left out. */
  readonly putIn: Money
}

/**
 * **A goal fed by its holding is worth its latest reading** (M30 U5, D-358), with
 * what went in beside it — a goal can go down, and that is true. Both are sums of
 * the goal's own deposits, the growth a reading derived among them, so this never
 * disagrees with the balance `goalProgress` reports. `undefined` for a goal not fed
 * by its holding, or whose holding has no reading in its currency yet.
 */
export function goalWorth(db: Database, goalId: string, currency: CurrencyCode): GoalWorth | undefined {
  const holdingId = goalHoldingFeeds(db).get(goalId)
  if (holdingId === undefined) return undefined
  const reading = [...listHoldingReadings(db, holdingId)].reverse().find((one) => one.value.currency === currency)
  if (reading === undefined) return undefined
  // The goal's own declared figures (M36 U03): `balance` and `put_in`, as the
  // document works them out — not a second sum here. Deposits in another
  // currency than the reading leave no one figure to show.
  const figures = goalFigures(db, currency, goalId).get(goalId)
  const worth = figures?.balance
  const putIn = figures?.putIn
  if (worth?.currency !== currency || putIn?.currency !== currency) return undefined
  return { asOf: reading.asOf, worth, putIn }
}
