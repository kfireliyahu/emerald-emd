import type { Database } from 'sql.js'

import { money, type CurrencyCode, type Money } from '@/core/money.ts'
import { toISODate, type LocalDate } from '@/core/time.ts'
import { sourceKindForOrigin } from '@/domain/goalDeposits.ts'
import type {
  HoldingKind,
  HoldingPlaceKind,
  HoldingProvenance,
  SavingGoal,
  SavingGoalKind,
} from '@/domain/model/savings.ts'
import { validateGoal, type GoalProblem } from '@/domain/savings.ts'
import { inTransaction } from '../db/database.ts'
import { accountBalances } from './accountBalanceRepository.ts'
import { listAccounts } from './accountRepository.ts'
import {
  goalFeeds,
  holdingFeedProblem,
  setGoalFeed,
  transferFeedProblem,
  type GoalFeedChoice,
} from './goalDepositRepository.ts'
import { latestHoldingReading } from './holdingReadingRepository.ts'
import {
  addDeposit,
  createGoal,
  createHolding,
  createHoldingPlace,
  findGoal,
  findHolding,
  listDeposits,
  listGoals,
  listHoldingPlaces,
  listHoldings,
  updateGoal,
} from './savingsRepository.ts'

/**
 * **A goal asks one question: where is the money** (M30 F3, D-363).
 *
 * The goal form, its drawer and the deposit form called one thing three names —
 * where its deposits usually go, where it is kept, where it sits — and making a
 * goal for money already in the bank took seven steps on two screens with a dead
 * end. Now the answer is one of the document's holdings, listed by one name each,
 * and **the answer decides the rest**:
 *
 * - a bank account's own Cash (D-362), a broker's cash, or a place kept by hand asks
 *   *how much of it is already there*, which is a `Was already there` deposit;
 * - a holding bought by rows follows its rows (`fed_by_holding`, D-357), and its
 *   worth is its latest reading (D-358) — there is nothing to type;
 * - a place that does not exist yet is made in the same write, so cancelling the
 *   goal leaves no empty place behind.
 *
 * A Money moved category still feeds a goal, as the advanced choice, and replaces
 * the answer's own way: one source only, so nothing counts twice.
 *
 * **A bank account's answer can count the transfers into it** (M30 F4, D-364): ticked,
 * every confirmed transfer pair (D-356) arriving in the account is a deposit and one
 * leaving it a withdrawal. Off by default — a main account receives transfers that are
 * not for any goal — and a third feed beside the category and the holding's rows.
 */

/** How a choice's deposits are found once it is the answer. */
export type WhereWay = 'ALREADY_THERE' | 'FOLLOWS_ROWS'

/** Which part of the list a choice sits in. */
export type WhereGroup =
  | { readonly kind: 'BANK' }
  | { readonly kind: 'HELD'; readonly placeId: string; readonly placeName: string }
  | { readonly kind: 'BY_HAND' }

/** One answer to *Where is the money?*, as the list shows it. */
export interface WhereChoice {
  readonly holdingId: string
  readonly group: WhereGroup
  /** The one name: an account's name for its Cash, otherwise the holding's. */
  readonly name: string
  /** Beside the name, quieter: an account's last four, or the place a holding is at. */
  readonly detail: string | undefined
  readonly way: WhereWay
  /** What it holds now, and the day that is from; `recorded` for money nothing confirms. */
  readonly figure:
    | { readonly kind: 'ON'; readonly amount: Money; readonly on: string }
    | { readonly kind: 'RECORDED'; readonly amount: Money }
    | undefined
  /** Another goal follows its rows, so this one cannot (D-357): that goal's name. */
  readonly followedBy: string | undefined
  /** A bank account's Cash whose transfers another goal counts (M30 F4): that goal's name. */
  readonly transfersReadBy?: string | undefined
}

/**
 * Every holding a goal's money can be in, by one name each: the bank accounts
 * first, then each place with holdings, then what is kept by hand.
 * `goalId` is the goal being edited, so its own holding is never *followed by* it.
 */
export function whereChoices(db: Database, currency: CurrencyCode, goalId?: string): readonly WhereChoice[] {
  const places = new Map(listHoldingPlaces(db, { includeArchived: false }).map((place) => [place.id, place]))
  const accounts = new Map(listAccounts(db).map((account) => [account.id, account]))
  const balances = new Map(accountBalances(db, currency).map((balance) => [balance.accountId, balance]))
  const goals = new Map(listGoals(db, { includeClosed: true }).map((goal) => [goal.id, goal]))
  const followers = new Map<string, string>()
  const transferReaders = new Map<string, string>()
  for (const [id, feed] of goalFeeds(db)) {
    if (id === goalId) continue
    if (feed.kind === 'HOLDING') followers.set(feed.id, goals.get(id)?.name ?? 'another goal')
    if (feed.kind === 'TRANSFERS') transferReaders.set(feed.id, goals.get(id)?.name ?? 'another goal')
  }

  const bank: WhereChoice[] = []
  const held: WhereChoice[] = []
  const byHand: WhereChoice[] = []
  for (const holding of listHoldings(db, { includeArchived: false })) {
    const place = places.get(holding.holdingPlaceId)
    if (place === undefined) continue
    const ownAccount = holding.accountId === undefined ? undefined : accounts.get(holding.accountId)
    if (ownAccount !== undefined && (ownAccount.kind === 'BANK' || ownAccount.kind === 'CASH')) {
      const balance = balances.get(ownAccount.id)
      bank.push({
        holdingId: holding.id,
        group: { kind: 'BANK' },
        name: ownAccount.name,
        detail: ownAccount.last4 === undefined ? undefined : `···${ownAccount.last4}`,
        way: 'ALREADY_THERE',
        figure:
          balance?.statementBalance === undefined
            ? undefined
            : {
                kind: 'ON',
                amount: balance.statementBalance,
                on: balance.balanceTo === undefined ? '' : toISODate(balance.balanceTo),
              },
        followedBy: undefined,
        transfersReadBy: transferReaders.get(ownAccount.id),
      })
      continue
    }
    if (place.accountId !== undefined) {
      // A place an account's statements show: its cash is the account's, and every
      // other holding there is bought and sold by rows (D-355).
      const cash = holding.accountId !== undefined
      const reading = latestHoldingReading(db, holding.id)
      held.push({
        holdingId: holding.id,
        group: { kind: 'HELD', placeId: place.id, placeName: place.name },
        name: cash ? 'Cash' : holding.name,
        detail: `at ${place.name}`,
        way: cash ? 'ALREADY_THERE' : 'FOLLOWS_ROWS',
        figure:
          reading === undefined || reading.value.currency !== currency
            ? undefined
            : { kind: 'ON', amount: reading.value, on: reading.asOf },
        followedBy: cash ? undefined : followers.get(holding.id),
      })
      continue
    }
    const recorded = listDeposits(db, { holdingId: holding.id }).reduce(
      (sum, deposit) => sum + (deposit.amount.currency === currency ? deposit.amount.minor : 0),
      0,
    )
    const at = place.institution ?? (place.name === holding.name ? undefined : place.name)
    byHand.push({
      holdingId: holding.id,
      group: { kind: 'BY_HAND' },
      name: holding.name,
      detail: at === undefined ? undefined : `at ${at}`,
      way: 'ALREADY_THERE',
      figure: { kind: 'RECORDED', amount: money(recorded, currency) },
      followedBy: undefined,
    })
  }
  const heldOrder = (choice: WhereChoice): string =>
    `${choice.group.kind === 'HELD' ? choice.group.placeName : ''}\u0000${choice.name === 'Cash' ? '￿' : choice.name}`
  return [...bank, ...held.sort((a, b) => heldOrder(a).localeCompare(heldOrder(b))), ...byHand]
}

/** What *+ New…* makes: a place without statements, holding one thing. */
export const NEW_PLACE_KINDS = ['CASH_AT_HOME', 'DEPOSIT', 'FUND', 'OTHER'] as const
export type NewPlaceKind = (typeof NEW_PLACE_KINDS)[number]

export interface NewPlaceAnswer {
  readonly kind: NewPlaceKind
  readonly name: string
  /** The bank or company, when there is one. */
  readonly institution?: string | undefined
  /** A deposit or fund locked until a day; reachable when there is none. */
  readonly lockedUntil?: LocalDate | undefined
}

/**
 * What each choice of *+ New…* is, in the words the money map uses: the place's
 * kind, its one holding's kind, and how its balance is known (D-176) — a deposit
 * or a fund is confirmed by a statement somebody could transcribe, cash at home by
 * nothing.
 */
export const MADE_AS: Readonly<
  Record<NewPlaceKind, { readonly place: HoldingPlaceKind; readonly holding: HoldingKind; readonly provenance: HoldingProvenance }>
> = {
  CASH_AT_HOME: { place: 'CASH', holding: 'CASH', provenance: 'RECORDED' },
  DEPOSIT: { place: 'DEPOSIT', holding: 'DEPOSIT', provenance: 'TRANSCRIBED' },
  FUND: { place: 'INVESTMENT', holding: 'FUND', provenance: 'TRANSCRIBED' },
  OTHER: { place: 'OTHER', holding: 'OTHER', provenance: 'RECORDED' },
}

/** Where the money is: a holding the document has, one to make, or not said yet. */
export type WhereAnswer =
  | { readonly kind: 'HOLDING'; readonly holdingId: string }
  | { readonly kind: 'NEW'; readonly place: NewPlaceAnswer }
  | undefined

/** The whole goal form, as one write. */
export interface GoalAnswer {
  /** The goal being edited; absent to make one. */
  readonly goalId?: string | undefined
  readonly name: string
  readonly kind: SavingGoalKind
  readonly targetAmount?: Money | undefined
  readonly targetDate?: LocalDate | undefined
  readonly note?: string | undefined
  readonly where: WhereAnswer
  /** *How much of it is already there?* — a `Was already there` deposit on `date`. */
  readonly alreadyThere?: { readonly amount: Money; readonly date: LocalDate } | undefined
  /** The advanced choice: a Money moved category feeds it instead of the answer's own way. */
  readonly categoryId?: string | undefined
  /**
   * *Transfers into <account> are for this goal* (M30 F4): a bank account's answer only, and
   * never beside a category — one source per goal.
   */
  readonly transfersIn?: boolean | undefined
  /** The splitter's order; a new goal goes last without one. The form never asks it. */
  readonly priority?: number | undefined
}

export class GoalAnswerError extends Error {
  constructor(
    message: string,
    /** What `validateGoal` said, when it was the one that refused. */
    readonly problems: readonly GoalProblem[] = [],
  ) {
    super(message)
    this.name = 'GoalAnswerError'
  }
}

/**
 * Why the answer cannot be written, in a sentence; `undefined` when it can. The
 * judgement the form shows, the tool's dry run prints and the write throws.
 */
export function goalAnswerProblem(db: Database, answer: GoalAnswer): string | undefined {
  if (answer.name.trim() === '') return 'Give it a name.'
  if (answer.targetAmount !== undefined && answer.targetAmount.minor < 0) return 'A target cannot be negative.'
  const clash = listGoals(db, { includeClosed: true }).find(
    (goal) => goal.id !== answer.goalId && goal.name.trim().toLowerCase() === answer.name.trim().toLowerCase(),
  )
  if (clash !== undefined) return `There is already a goal called ${clash.name}.`
  if (answer.goalId !== undefined && findGoal(db, answer.goalId) === undefined) return 'That goal is not in this document.'
  if (answer.where?.kind === 'NEW' && answer.where.place.name.trim() === '') return 'Give the new place a name.'
  if (answer.where?.kind === 'HOLDING') {
    const holding = findHolding(db, answer.where.holdingId)
    if (holding === undefined || holding.isArchived) return 'That holding is not in this document.'
    if (answer.categoryId === undefined && wayOf(db, answer.where) === 'FOLLOWS_ROWS') {
      const goals = new Map(listGoals(db, { includeClosed: true }).map((goal) => [goal.id, goal.name]))
      for (const [id, feed] of goalFeeds(db)) {
        if (feed.kind === 'HOLDING' && feed.id === holding.id && id !== answer.goalId) {
          return `${goals.get(id) ?? 'Another goal'} already follows ${holding.name}'s rows. One goal per holding, so a buy is never counted twice.`
        }
      }
    }
  }
  if (answer.transfersIn === true) {
    if (answer.categoryId !== undefined) {
      return 'A goal counts its transfers or reads a category, never both, so nothing counts twice.'
    }
    if (answer.where?.kind !== 'HOLDING') return 'Only money in a bank account counts the transfers into it.'
    const goal = findGoal(db, answer.goalId ?? '')
    const refusal = transferFeedProblem(db, {
      ...(goal ?? blankGoal()),
      name: answer.name.trim(),
      defaultHoldingId: answer.where.holdingId,
    })
    if (refusal !== undefined) return refusal.message
  }
  if (answer.alreadyThere !== undefined) {
    if (answer.alreadyThere.amount.minor <= 0) return 'Type an amount above zero, or leave it empty.'
    if (answer.where === undefined) return 'Say where the money is before how much of it is there.'
    if (wayOf(db, answer.where) === 'FOLLOWS_ROWS') {
      return 'A holding bought by rows is followed, not typed: its rows are its deposits.'
    }
  }
  return undefined
}

/** A goal not written yet, judged by the feed it would take. */
function blankGoal(): SavingGoal {
  return {
    id: '',
    name: '',
    kind: 'EARMARKED',
    targetAmount: undefined,
    targetDate: undefined,
    defaultHoldingId: undefined,
    isClosed: false,
    priority: 0,
    note: undefined,
  }
}

/** How the answer's deposits are found: an existing holding's way, and a new place's is by hand. */
function wayOf(db: Database, where: WhereAnswer): WhereWay | undefined {
  if (where === undefined) return undefined
  if (where.kind === 'NEW') return 'ALREADY_THERE'
  const holding = findHolding(db, where.holdingId)
  if (holding === undefined) return undefined
  if (holding.accountId !== undefined) return 'ALREADY_THERE'
  const place = listHoldingPlaces(db, { includeArchived: true }).find((one) => one.id === holding.holdingPlaceId)
  return place?.accountId === undefined ? 'ALREADY_THERE' : 'FOLLOWS_ROWS'
}

/**
 * **The goal form, written once** (M30 F3): the goal, the place *+ New…* made, the
 * `Was already there` deposit and the feed, in one transaction — so a refusal at the
 * last step leaves nothing of the first. The screen and `create_goals` both
 * write through this.
 *
 * The feed follows the answer: a holding bought by rows feeds the goal by its rows;
 * anything else feeds it by nothing until the category in the fold says otherwise.
 */
export function saveGoalAnswer(db: Database, answer: GoalAnswer, now: number): SavingGoal {
  const problem = goalAnswerProblem(db, answer)
  if (problem !== undefined) throw new GoalAnswerError(problem)

  return inTransaction(db, () => {
    const holdingId = answer.where === undefined ? undefined : holdingOf(db, answer.where, now)
    const existing = answer.goalId === undefined ? undefined : findGoal(db, answer.goalId)
    const fields = {
      name: answer.name.trim(),
      kind: answer.kind,
      targetAmount: answer.targetAmount,
      targetDate: answer.targetDate,
      defaultHoldingId: holdingId,
      ...(answer.priority === undefined ? {} : { priority: answer.priority }),
      note: answer.note?.trim() === '' ? undefined : answer.note?.trim(),
    }
    const problems = validateGoal({
      id: existing?.id ?? '',
      name: fields.name,
      kind: fields.kind,
      targetAmount: fields.targetAmount,
      targetDate: fields.targetDate,
      defaultHoldingId: holdingId,
      isClosed: false,
      priority: 0,
      note: fields.note,
    })
    if (problems.length > 0) throw new GoalAnswerError(`The goal cannot be kept: ${problems.join(', ')}.`, problems)

    let goalId: string
    if (existing === undefined) {
      goalId = createGoal(db, fields, now).id
    } else {
      updateGoal(db, existing.id, fields, now)
      goalId = existing.id
    }

    // The money already there first: the transfers it covers are not counted again (M30 F4).
    if (answer.alreadyThere !== undefined && holdingId !== undefined) {
      addDeposit(
        db,
        {
          goalId,
          date: answer.alreadyThere.date,
          amount: answer.alreadyThere.amount,
          holdingId,
          sourceKind: sourceKindForOrigin('ALREADY_THERE'),
        },
        now,
      )
    }

    const follows = answer.where !== undefined && wayOf(db, answer.where) === 'FOLLOWS_ROWS'
    const choice: GoalFeedChoice =
      answer.categoryId !== undefined
        ? { kind: 'CATEGORY', categoryId: answer.categoryId }
        : follows
          ? { kind: 'HOLDING' }
          : answer.transfersIn === true
            ? { kind: 'TRANSFERS' }
            : undefined
    if (choice?.kind === 'HOLDING') {
      const goal = findGoal(db, goalId)
      const refusal = goal === undefined ? undefined : holdingFeedProblem(db, goal)
      if (refusal !== undefined) throw new GoalAnswerError(refusal.message)
    }
    const current = goalFeeds(db).get(goalId)
    const same =
      (current === undefined && choice === undefined) ||
      (current?.kind === 'CATEGORY' && choice?.kind === 'CATEGORY' && current.id === choice.categoryId) ||
      (current?.kind === 'HOLDING' && choice?.kind === 'HOLDING' && current.id === holdingId) ||
      (current?.kind === 'TRANSFERS' && choice?.kind === 'TRANSFERS' && current.id === findHolding(db, holdingId ?? '')?.accountId)
    if (!same) setGoalFeed(db, goalId, choice, now)


    const saved = findGoal(db, goalId)
    if (saved === undefined) throw new Error('saving goal did not survive its answer')
    return saved
  })
}

/** The holding the answer names, made first when *+ New…* asked for one. */
function holdingOf(db: Database, where: NonNullable<WhereAnswer>, now: number): string {
  return where.kind === 'HOLDING' ? where.holdingId : makePlace(db, where.place, now)
}

/**
 * A place without statements, holding one thing, and that holding's id — what
 * *+ New…* makes for a goal and for a deposit's holding (M31 U6).
 */
export function makePlace(db: Database, answer: NewPlaceAnswer, now: number): string {
  const made = MADE_AS[answer.kind]
  const name = answer.name.trim()
  const institution = answer.institution?.trim()
  const place = createHoldingPlace(
    db,
    {
      name,
      kind: made.place,
      ...(institution === undefined || institution === '' ? {} : { institution }),
    },
    now,
  )
  const locked = answer.lockedUntil
  return createHolding(
    db,
    {
      holdingPlaceId: place.id,
      name,
      kind: made.holding,
      provenance: made.provenance,
      isLiquid: locked === undefined,
      ...(locked === undefined ? {} : { termEndDate: locked }),
    },
    now,
  ).id
}

