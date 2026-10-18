/**
 * Salary deposits against the payslips — docs/f06's step 12.
 *
 * The last of F06's pipeline to be built, and the one that closes the other half
 * of the double-counting problem: card settlements would double a month's
 * *spending*, and a salary deposit doubles a month's **income**, because the
 * payslip entered in F04 already counts as one.
 *
 * Three things worth knowing before reading further:
 *
 * - **The match is re-derived, never stored.** The rows come out of the ledger
 *   and the payslips out of `paycheck`, and `matchSalaries` is run over both
 *   every time anything asks — which is what makes order of entry not matter,
 *   exactly as `RowClass` does for settlements (D-060). Enter January's slip in
 *   March and the January deposit becomes a match with nothing to repair.
 * - **What is stored is the user's answer**, and it is an `app_setting` rather
 *   than a table (D-078). Nothing holds a foreign key to it, it is keyed on a
 *   month rather than on anything with an id, and it carries no state beyond
 *   which answer was given — D-053's shape, not D-061's.
 * - **The answer is read beside the match, never written onto the row** (M36
 *   U04). `salaryCoveredRefs` leaves out what a slip already counts and what
 *   the person answered is the slip arriving; `is_excluded_from_stats` is the
 *   person's own answer about a row, and a month's answer taken back never
 *   undoes it.
 */

import type { Database } from 'sql.js'

import type { CurrencyCode } from '@/core/money.ts'
import { toYearMonthString, yearMonthOf } from '@/core/time.ts'
import {
  matchSalaries,
  salaryDepositCounts,
  type SalaryDecision,
  type SalaryGroup,
} from '@/domain/bankImport.ts'
import type { SalaryBank } from '@/domain/model/statistics.ts'
import type { LandedSalary } from '@/domain/splitter.ts'
import { readSettlementPlan } from '../importer/settlementScan.ts'
import { query } from '../db/database.ts'
import { listPaychecks } from './paycheckRepository.ts'
import { readJsonSetting, writeSetting } from './settingsRepository.ts'

/** Where the answers live. One key, a month-to-answer map. */
export const SALARY_DECISIONS_KEY = 'salary.decisions'

export function readSalaryDecisions(db: Database): ReadonlyMap<string, SalaryDecision> {
  const stored = readJsonSetting(db, SALARY_DECISIONS_KEY) ?? {}
  const decisions = new Map<string, SalaryDecision>()
  for (const [period, value] of Object.entries(stored)) {
    if (value === 'EXCLUDED' || value === 'COUNTED') decisions.set(period, value)
  }
  return decisions
}

/**
 * Every month's salary deposits, matched against the payslips.
 *
 * The rows are classified by the same `planBankImport` the settlement scan uses,
 * over the same window of the ledger — one reading of what the bank rows are, so
 * a row cannot be a settlement to one screen and a salary to another.
 *
 * **A salary is what the text says or what the person filed** (D-317): the
 * employer in a real case pays through a clearing house whose name says
 * transfer, and the person had filed the deposit under Salary. The text alone never found it.
 */
export function salaryReconciliation(
  db: Database,
  currency: CurrencyCode = 'ILS',
): readonly SalaryGroup[] {
  return reconcile(db, currency).groups
}

interface Reconciliation {
  readonly groups: readonly SalaryGroup[]
  readonly paychecks: ReturnType<typeof listPaychecks>
  /** The months the bank statements hold any row in, `YYYY-MM`. */
  readonly bankMonths: ReadonlySet<string>
}

function reconcile(db: Database, currency: CurrencyCode): Reconciliation {
  const paychecks = listPaychecks(db)
  // Nothing to be paid by: a deposit with no slip anywhere is not a finding in a
  // document that keeps no slips, and the scan is the dear part of this.
  if (paychecks.length === 0) return { groups: [], paychecks, bankMonths: new Set() }

  const { plan, rows } = readSettlementPlan(db)
  if (rows.length === 0) return { groups: [], paychecks, bankMonths: new Set() }

  return {
    paychecks,
    bankMonths: new Set(rows.map((row) => toYearMonthString(yearMonthOf(row.date)))),
    groups: matchSalaries({
      rows: plan.rows,
      paychecks: paychecks.map((paycheck) => ({
        id: paycheck.id,
        period: paycheck.period,
        net: paycheck.net,
        paidOn: paycheck.paymentDate,
      })),
      currency,
      decisions: readSalaryDecisions(db),
      filedAsSalary: filedAsSalaryRefs(db),
    }),
  }
}

/**
 * Each month's salary deposits, whatever the slips say: what take-home pay is
 * when there is no payslip (M31 U3). The same reading of the bank rows as the
 * reconciliation, without the slips to match them to.
 */
export function salaryLanded(db: Database, currency: CurrencyCode = 'ILS'): readonly LandedSalary[] {
  const { plan, rows } = readSettlementPlan(db)
  if (rows.length === 0) return []
  return matchSalaries({ rows: plan.rows, paychecks: [], currency, filedAsSalary: filedAsSalaryRefs(db) }).map(
    (group) => ({ period: group.period, amount: group.total }),
  )
}

/** Bank inflows the person filed under a category called Salary. */
function filedAsSalaryRefs(db: Database): ReadonlySet<string> {
  return new Set(
    query(
      db,
      `SELECT t.id
         FROM fmt_transaction t
         JOIN fmt_account a ON a.id = t.account
         JOIN fmt_category c ON c.id = t.category
        WHERE a.kind = 'BANK' AND t.amount_minor > 0 AND LOWER(c.name) = 'salary'`,
    ).map((row) => String(row['id'])),
  )
}

/**
 * The transactions a slip already counts for: salary deposits matched to a slip
 * and not kept by the person, and any the person answered is the slip arriving
 * (M36 U04, where that answer moved off the row). What every income figure
 * leaves out (D-317).
 */
export function salaryCoveredRefs(db: Database, currency: CurrencyCode = 'ILS'): ReadonlySet<string> {
  const covered = new Set<string>()
  for (const group of reconcile(db, currency).groups) {
    if (salaryDepositCounts(group)) continue
    for (const row of group.rows) covered.add(row.ref)
  }
  return covered
}

/**
 * Salary deposits with no slip behind them: counted, because they are the only
 * evidence the money came, and said so (D-317).
 */
export function salaryWithoutSlipRefs(db: Database, currency: CurrencyCode = 'ILS'): ReadonlySet<string> {
  const refs = new Set<string>()
  for (const group of reconcile(db, currency).groups) {
    if (group.verdict !== 'NO_PAYCHECK') continue
    for (const row of group.rows) refs.add(row.ref)
  }
  return refs
}

/**
 * What the bank says about each slip: the deposit that paid it agrees, differs
 * by a gap, never arrived, or could not be looked for (D-317).
 *
 * *Could not be looked for* is its own answer: a slip paid in a month the bank
 * statements do not cover has no deposit to find, and saying "no deposit" of it
 * would be the quiet wrongness this exists to stop. Keyed by slip id.
 */
export function slipBankStatus(
  db: Database,
  currency: CurrencyCode = 'ILS',
): ReadonlyMap<string, SalaryBank> {
  const { groups, paychecks, bankMonths } = reconcile(db, currency)
  const status = new Map<string, SalaryBank>()
  for (const group of groups) {
    if (group.paycheckId === undefined || group.net === undefined || group.difference === undefined) continue
    const landedOn = group.rows[group.rows.length - 1]?.date
    if (landedOn === undefined) continue
    status.set(
      group.paycheckId,
      group.verdict === 'MATCHED'
        ? { kind: 'AGREES', landed: group.total, landedOn, count: group.rows.length }
        : { kind: 'DIFFERS', landed: group.total, landedOn, count: group.rows.length, difference: group.difference },
    )
  }
  for (const paycheck of paychecks) {
    if (status.has(paycheck.id)) continue
    // The deposit lands on the pay date or a little after it: its month, or the next.
    const paid = yearMonthOf(paycheck.paymentDate)
    const covered = bankMonths.has(toYearMonthString(paid))
    status.set(paycheck.id, covered ? { kind: 'NO_DEPOSIT' } : { kind: 'UNCHECKED' })
  }
  return status
}

/**
 * Answer one month: either the deposit is the payslip arriving and should not be
 * counted twice, or it is money the payslips do not cover and should stay.
 *
 * Only the answer is written (M36 U04): `salaryCoveredRefs` reads it beside the
 * match, so taking it back puts the row back without touching what the person
 * said about the row itself.
 */
export function setSalaryDecision(
  db: Database,
  group: SalaryGroup,
  decision: SalaryDecision,
  now: number,
): void {
  const stored = { ...(readJsonSetting(db, SALARY_DECISIONS_KEY) ?? {}) }
  const key = toYearMonthString(group.period)

  if (decision === 'PENDING') delete stored[key]
  else stored[key] = decision

  writeSetting(db, SALARY_DECISIONS_KEY, JSON.stringify(stored), now)
}
