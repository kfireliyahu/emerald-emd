import type { Database } from 'sql.js'

import { money, type CurrencyCode } from '@/core/money.ts'
import {
  addMonths,
  compareDates,
  parseISODate,
  toISODate,
  toYearMonthString,
  yearMonthOf,
  type LocalDate,
  type YearMonth,
} from '@/core/time.ts'
import { isStaleSetAside, type SetAsideHeld } from '@/domain/goalRhythm.ts'
import { query } from '../db/database.ts'
import { declared } from '../packs/ledger/tables.ts'
import { updateRow } from './formatRowRepository.ts'
import { addDeposit, findGoal } from './savingsRepository.ts'

/**
 * Pausing a goal and asking whether set-aside money is still there (M28 U8, S7
 * and S5). Two small writes on the goal and its deposits, each with the read
 * that makes it worth writing.
 *
 * **Pause is a month on the goal, not a delete.** `paused_until` is the month it
 * takes money again; until then the projection skips it and the Goals screen
 * gives its amount back to what is left. Plan's own bucket is untouched: the
 * person's split is theirs and a pause is a decision about one month.
 *
 * **A set-aside amount is a promise nobody can see.** It moves nothing, so
 * nothing in the bank ever contradicts it; asking once after 90 days is the only
 * check there is. Saying it is still there records the day; saying it is gone
 * writes the withdrawal a person would have typed, so the balance follows.
 */

export class MaxPauseError extends Error {
  constructor() {
    super('A goal can be paused for 1 to 12 months, or 0 to start it again.')
    this.name = 'MaxPauseError'
  }
}

export const MAX_PAUSE_MONTHS = 12

/** Goal id to the month it takes money again, for goals paused at all. */
export function pausedUntilByGoal(db: Database): ReadonlyMap<string, YearMonth> {
  const found = new Map<string, YearMonth>()
  for (const row of query(db, 'SELECT id, paused_until FROM fmt_saving_goal WHERE paused_until IS NOT NULL')) {
    const date = parseISODate(String(row['paused_until']))
    if (date !== undefined) found.set(String(row['id']), yearMonthOf(date))
  }
  return found
}

/**
 * Pause a goal for `months` months from this one, counting this month: 1 skips
 * this month only. 0 starts it again. Returns the month it takes money again,
 * or undefined when it is not paused.
 */
export function pauseGoal(db: Database, goalId: string, months: number, asOf: LocalDate): YearMonth | undefined {
  if (findGoal(db, goalId) === undefined) throw new Error('No such goal')
  if (!Number.isInteger(months) || months < 0 || months > MAX_PAUSE_MONTHS) throw new MaxPauseError()
  const until = months === 0 ? undefined : addMonths(yearMonthOf(asOf), months)
  updateRow(db, declared(db, 'saving_goal'), goalId, {
    paused_until: until === undefined ? null : `${toYearMonthString(until)}-01`,
  })
  return until
}

// --- S5 ---------------------------------------------------------------------

/**
 * What is still set aside in each goal, with the day it was last said to be
 * there. A withdrawal takes from the oldest set-aside amount first, so money a
 * person already took out (or said was gone) is not asked about again.
 */
export function setAsideHeld(db: Database): readonly SetAsideHeld[] {
  const rows = query(
    db,
    `SELECT id, goal, date, amount_minor, amount_currency, confirmed_on
       FROM fmt_saving_deposit
      WHERE source_kind IN ('MANUAL', 'FROM_PLAN')
      ORDER BY date, id`,
  )
  const positives: SetAsideHeld[] = []
  const owed = new Map<string, number>()
  for (const row of rows) {
    const date = parseISODate(String(row['date']))
    if (date === undefined) continue
    const goalId = String(row['goal'])
    const minor = Number(row['amount_minor'])
    const currency = String(row['amount_currency']) as CurrencyCode
    if (minor < 0) {
      owed.set(`${goalId}|${currency}`, (owed.get(`${goalId}|${currency}`) ?? 0) - minor)
      continue
    }
    const confirmed = row['confirmed_on'] === null ? undefined : parseISODate(String(row['confirmed_on']))
    positives.push({
      depositId: String(row['id']),
      goalId,
      date,
      lastSaidOn: confirmed !== undefined && compareDates(confirmed, date) > 0 ? confirmed : date,
      amount: money(minor, currency),
    })
  }
  const held: SetAsideHeld[] = []
  for (const one of positives) {
    const key = `${one.goalId}|${one.amount.currency}`
    const taken = Math.min(owed.get(key) ?? 0, one.amount.minor)
    owed.set(key, (owed.get(key) ?? 0) - taken)
    if (one.amount.minor - taken > 0) held.push({ ...one, amount: money(one.amount.minor - taken, one.amount.currency) })
  }
  return held
}

/** The set-aside amounts old enough to ask about, by goal. */
export function staleSetAside(db: Database, asOf: LocalDate): ReadonlyMap<string, readonly SetAsideHeld[]> {
  const byGoal = new Map<string, SetAsideHeld[]>()
  for (const held of setAsideHeld(db)) {
    if (!isStaleSetAside(held, asOf)) continue
    const list = byGoal.get(held.goalId) ?? []
    list.push(held)
    byGoal.set(held.goalId, list)
  }
  return byGoal
}

export interface SettledSetAside {
  readonly deposits: number
  readonly amount: ReturnType<typeof money> | undefined
}

/**
 * Settle a goal's stale set-aside amounts one way or the other. `STILL_THERE`
 * records today against each, so they are not asked about again for 90 days;
 * `GONE` withdraws each one in the holding it sat in, with the reason written,
 * so the balance stops counting money that is no longer set aside.
 */
export function settleSetAside(
  db: Database,
  goalId: string,
  answer: 'STILL_THERE' | 'GONE',
  asOf: LocalDate,
  now: number,
): SettledSetAside {
  const stale = staleSetAside(db, asOf).get(goalId) ?? []
  if (stale.length === 0) return { deposits: 0, amount: undefined }
  const holdings = new Map(
    query(db, 'SELECT id, holding FROM fmt_saving_deposit WHERE goal = ?', [goalId]).map((row) => [
      String(row['id']),
      String(row['holding']),
    ]),
  )
  let total = 0
  const currency = stale[0]?.amount.currency ?? 'ILS'
  for (const held of stale) {
    if (held.amount.currency !== currency) continue
    total += held.amount.minor
    if (answer === 'STILL_THERE') {
      updateRow(db, declared(db, 'saving_deposit'), held.depositId, { confirmed_on: toISODate(asOf) })
      continue
    }
    const holdingId = holdings.get(held.depositId)
    if (holdingId === undefined) continue
    addDeposit(
      db,
      {
        goalId,
        date: asOf,
        amount: money(-held.amount.minor, currency),
        holdingId,
        sourceKind: 'MANUAL',
        note: `No longer set aside (was set aside ${toISODate(held.date)})`,
      },
      now,
    )
  }
  return { deposits: stale.length, amount: money(total, currency) }
}
