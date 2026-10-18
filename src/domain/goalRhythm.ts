/**
 * Three small readings that make a goal's month easier to decide (M28 U8, S2, S3,
 * S5, S7). Pure: money and dates in, money and dates out, no clock.
 *
 * - **Planned against moved** (S2): what really left the bank for a goal in the
 *   last three full months, beside three times what Plan puts toward it.
 * - **Suggest a split** (S3): fills the goals' amounts by nearest date, inside what
 *   Plan has for goals. A suggestion is a list
 *   of figures with the reason for each; nothing here writes.
 * - **Is it still set aside?** (S5): a set-aside amount is a promise inside the
 *   bank, and a promise nobody has looked at in 90 days is asked about once.
 */

import { money, type CurrencyCode, type Money } from '@/core/money.ts'
import { addMonths, daysBetween, monthsBetween, toISODate, toYearMonthString, yearMonthOf, type LocalDate, type YearMonth } from '@/core/time.ts'
import { neededMonthly, type GoalLine } from '@/domain/goalPlan.ts'
import { originOf } from '@/domain/goalDeposits.ts'
import type { SavingDeposit } from '@/domain/model/savings.ts'

// --- S2: planned against moved ----------------------------------------------

/** The months the comparison looks at: the three full months before this one. */
export const MOVED_MONTHS = 3

/** First day of the month `from` back `MOVED_MONTHS` months, and of `from` itself (exclusive end). */
export function movedWindow(from: YearMonth): { readonly start: string; readonly end: string; readonly first: YearMonth; readonly last: YearMonth } {
  const first = addMonths(from, -MOVED_MONTHS)
  const last = addMonths(from, -1)
  return { start: `${toYearMonthString(first)}-01`, end: `${toYearMonthString(from)}-01`, first, last }
}

/**
 * What the bank moved into one goal in the window: the derived deposits only,
 * because a set-aside amount moves nothing and "was already there" is not a
 * month's movement. Signed, so a return of a transfer counts against it.
 */
export function movedIntoGoal(deposits: readonly SavingDeposit[], goalId: string, from: YearMonth, currency: CurrencyCode): Money {
  const { start, end } = movedWindow(from)
  let sum = 0
  for (const deposit of deposits) {
    if (deposit.goalId !== goalId || deposit.amount.currency !== currency) continue
    if (originOf(deposit.sourceKind) !== 'DERIVED') continue
    const date = toISODate(deposit.date)
    if (date >= start && date < end) sum += deposit.amount.minor
  }
  return money(sum, currency)
}

/**
 * Moved against planned, read so it cannot mislead (M28 U9's first task, found by F10).
 *
 * Three times the monthly amount is only what was planned if the goal was taking money for all
 * three months. A goal made last week, or one paused now, read as a large negative it never
 * earned. So:
 *
 * - **Paused** is not compared: the pause records the month it ends, not the month it began, so
 *   any count of planned months would be a guess.
 * - **The window starts with the goal.** A goal keeps no date of its own, so its first deposit
 *   of any kind stands in: the month of the earliest one. Months of the window before it were
 *   not planned. A goal with no deposit, or whose first one is this month, has nothing to
 *   compare yet.
 */
export type VersusPlan =
  | { readonly kind: 'PAUSED' }
  | { readonly kind: 'NOTHING_YET' }
  | { readonly kind: 'COMPARED'; readonly months: number; readonly planned: Money; readonly difference: Money }

export function versusPlan(
  deposits: readonly SavingDeposit[],
  goalId: string,
  from: YearMonth,
  monthly: Money,
  paused: boolean,
): VersusPlan {
  if (paused) return { kind: 'PAUSED' }
  const { first } = movedWindow(from)
  let began: YearMonth | undefined
  for (const deposit of deposits) {
    if (deposit.goalId !== goalId) continue
    const month = yearMonthOf(deposit.date)
    if (began === undefined || monthsBetween(month, began) > 0) began = month
  }
  if (began === undefined) return { kind: 'NOTHING_YET' }
  const start = monthsBetween(first, began) > 0 ? began : first
  const months = Math.min(MOVED_MONTHS, Math.max(0, monthsBetween(start, from)))
  if (months === 0) return { kind: 'NOTHING_YET' }
  const moved = movedIntoGoal(deposits, goalId, from, monthly.currency)
  const planned = money(monthly.minor * months, monthly.currency)
  return { kind: 'COMPARED', months, planned, difference: money(moved.minor - planned.minor, monthly.currency) }
}

// --- S5: still set aside? ----------------------------------------------------

export const SET_ASIDE_ASKS_AFTER_DAYS = 90

/** One set-aside deposit and the day it was last said to still be there. */
export interface SetAsideHeld {
  readonly depositId: string
  readonly goalId: string
  readonly date: LocalDate
  /** The later of the day it was set aside and the day somebody confirmed it. */
  readonly lastSaidOn: LocalDate
  readonly amount: Money
}

/** Whether a set-aside amount is old enough to ask about: more than 90 days since anyone said it was there. */
export function isStaleSetAside(held: SetAsideHeld, asOf: LocalDate): boolean {
  return held.amount.minor > 0 && daysBetween(held.lastSaidOn, asOf) > SET_ASIDE_ASKS_AFTER_DAYS
}

// --- S3: suggest a split -----------------------------------------------------

export interface SuggestionInput {
  readonly line: GoalLine
  /** A paused goal is left alone: its month goes back to Plan. */
  readonly paused: boolean
}

export type SuggestionReason =
  | 'ON_TIME' // the amount that gets it there on its date
  | 'A_YEAR' // no date, so a year's worth of the shortfall
  | 'WHAT_IS_LEFT' // wanted more than was left
  | 'REACHED'
  | 'NO_TARGET'
  | 'PAUSED'
  | 'NOTHING_LEFT'

export interface SuggestedAmount {
  readonly goalId: string
  readonly name: string
  /** What the goal gets each month under the suggestion. */
  readonly amount: Money
  /** What it would take to be on time, when that is more than it gets. */
  readonly wanted: Money
  readonly reason: SuggestionReason
}

export interface Suggestion {
  readonly amounts: readonly SuggestedAmount[]
  readonly pool: Money
  /** What the suggestion leaves of the pool for everything else. */
  readonly left: Money
}

/** A goal with no date is sized as a year of its shortfall: it has no deadline to size it by. */
const NO_DATE_MONTHS = 12

/**
 * Goals by nearest date — no kind of goal first since M36 U11: the cushion is Plan's,
 * and a goal that must come first is given the nearest date — each taking what it needs to
 * arrive on its date until the pool runs out. The pool is what Plan has for
 * goals: what they take now plus what Plan has left, and never less than nothing.
 * A goal the pool cannot fully cover gets what is left and says so; one with no
 * date is sized as a year; a reached goal, one with no target and a paused one
 * get nothing.
 */
export function suggestSplit(inputs: readonly SuggestionInput[], pool: Money, from: YearMonth): Suggestion {
  const { currency } = pool
  let room = Math.max(0, pool.minor)
  const ranked = [...inputs].sort((a, b) => {
    const ad = a.line.due
    const bd = b.line.due
    if (ad === undefined && bd === undefined) return a.line.name.localeCompare(b.line.name)
    if (ad === undefined) return 1
    if (bd === undefined) return -1
    return monthsBetween(bd, ad) || a.line.name.localeCompare(b.line.name)
  })

  const byGoal = new Map<string, SuggestedAmount>()
  for (const input of ranked) {
    const { line } = input
    const zero = money(0, currency)
    const none = (reason: SuggestionReason): SuggestedAmount => ({ goalId: line.goalId, name: line.name, amount: zero, wanted: zero, reason })
    if (input.paused) {
      byGoal.set(line.goalId, none('PAUSED'))
      continue
    }
    if (line.target === undefined) {
      byGoal.set(line.goalId, none('NO_TARGET'))
      continue
    }
    const shortfall = line.target.minor - line.balance.minor
    if (shortfall <= 0) {
      byGoal.set(line.goalId, none('REACHED'))
      continue
    }
    const dated = neededMonthly(line, from)
    const want = dated !== undefined ? dated.minor : Math.ceil(shortfall / NO_DATE_MONTHS)
    const give = Math.min(want, room)
    room -= give
    byGoal.set(line.goalId, {
      goalId: line.goalId,
      name: line.name,
      amount: money(give, currency),
      wanted: money(want, currency),
      reason: give === 0 ? 'NOTHING_LEFT' : give < want ? 'WHAT_IS_LEFT' : dated !== undefined ? 'ON_TIME' : 'A_YEAR',
    })
  }

  return {
    // The order a person reads them in: the goals' own order, not the order they were filled.
    amounts: inputs.map((input) => byGoal.get(input.line.goalId) as SuggestedAmount),
    pool,
    left: money(room, currency),
  }
}

export const SUGGESTION_WORDS: Readonly<Record<SuggestionReason, string>> = {
  ON_TIME: 'what gets it there on its date',
  A_YEAR: 'a year of what is missing, since it has no date',
  WHAT_IS_LEFT: 'all that is left, which is less than it needs',
  REACHED: 'already there',
  NO_TARGET: 'no target to size it by',
  PAUSED: 'paused',
  NOTHING_LEFT: 'nothing is left after the ones before it',
}
