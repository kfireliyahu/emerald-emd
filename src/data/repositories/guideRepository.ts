/**
 * What the ledger's document says about each step of its guide, and where the
 * guide stopped (M28 U9, D-330).
 *
 * **The checks are onboarding's checklist, become the steps' done-tests**
 * (choice a, B): "is there any transaction, any paycheck, any plan" are exactly
 * the questions a step needs to tick itself, so they are asked once, here, and
 * the line on Home, the dialog and `guide_status` all read this answer — the
 * three cannot disagree.
 *
 * **A done step names what it found** (S1): "Read 3 statements and 2 payslips,
 * August and September." A guide that only says "Done" is a guide that did not
 * look.
 *
 * The progress lives in the ledger's `setting`, where onboarding's did: it is a
 * fact about *this* file, and opening someone else's document should not tell
 * them where you stopped. Reads never write, so opening a document never marks
 * it dirty.
 */

import type { Database } from 'sql.js'

import { formatMoney, money, type CurrencyCode } from '@/core/money.ts'
import { plural } from '@/core/text.ts'
import {
  compareDates,
  compareYearMonths,
  formatMonthName,
  formatYearMonth,
  parseISODate,
  yearMonthOf,
  type LocalDate,
  type YearMonth,
} from '@/core/time.ts'
import { decodeGuideProgress, FRESH_GUIDE, QUIET_GUIDE, type GuideChecks, type GuideProgress } from '@/domain/guide.ts'
import { monthlyShare } from '@/domain/fixedExpenses.ts'

import { query } from '../db/database.ts'
import { accountBalances } from './accountBalanceRepository.ts'
import { listFixedExpenses } from './fixedExpenseRepository.ts'
import { merchantQueue } from './labelingQueueRepository.ts'
import { listSeeds } from './formatSeedRepository.ts'
import { cushionReading } from './cushionRepository.ts'
import { planMonth } from './planMonthRepository.ts'
import { readJsonSetting, writeSetting } from './settingsRepository.ts'
import { documentCurrency } from './statisticsRepository.ts'

const KEY = 'guide'

/**
 * Where this document's guide is. With nothing stored the answer comes from the
 * document: an empty one is new and is asked once; one that already holds work
 * was never asked and is not now — Help › Guide me still opens it.
 */
export function readGuideProgress(db: Database): GuideProgress {
  const stored = decodeGuideProgress(readJsonSetting(db, KEY))
  if (stored !== undefined) return stored
  return holdsWork(db) ? QUIET_GUIDE : FRESH_GUIDE
}

export function saveGuideProgress(db: Database, progress: GuideProgress, now: number): void {
  writeSetting(db, KEY, JSON.stringify(progress), now)
}

/**
 * Whether the document holds anything a person could lose: an account or a
 * transaction. What onboarding's first run used to answer for the tools that
 * take a backup only when there is something to back up.
 */
export function holdsWork(db: Database): boolean {
  const row = query(
    db,
    `SELECT EXISTS (SELECT 1 FROM fmt_account) AS accounts,
            EXISTS (SELECT 1 FROM fmt_transaction) AS transactions`,
  )[0]
  return Number(row?.['accounts'] ?? 0) === 1 || Number(row?.['transactions'] ?? 0) === 1
}

/** Each of the ledger's steps, answered by the document. */
export function ledgerGuideChecks(db: Database, asOf: LocalDate): GuideChecks {
  const currency = documentCurrency(db)
  const counts = query(
    db,
    `SELECT (SELECT COUNT(*) FROM fmt_transaction) AS transactions,
            (SELECT COUNT(*) FROM fmt_paycheck) AS paychecks,
            (SELECT COUNT(*) FROM fmt_statement WHERE status = 'COMMITTED') AS statements,
            (SELECT MIN(transaction_date) FROM fmt_transaction) AS first_tx,
            (SELECT MAX(transaction_date) FROM fmt_transaction) AS last_tx,
            (SELECT MIN(payment_date) FROM fmt_paycheck) AS first_pay,
            (SELECT MAX(payment_date) FROM fmt_paycheck) AS last_pay`,
  )[0]
  const transactions = Number(counts?.['transactions'] ?? 0)
  const paychecks = Number(counts?.['paychecks'] ?? 0)
  const statements = Number(counts?.['statements'] ?? 0)

  return {
    read: readCheck(transactions, paychecks, statements, [
      counts?.['first_tx'],
      counts?.['last_tx'],
      counts?.['first_pay'],
      counts?.['last_pay'],
    ]),
    categories: categoriesCheck(db),
    merchant: merchantCheck(db, transactions),
    fixed: fixedCheck(db, asOf, currency),
    split: splitCheck(db, asOf),
    opening: openingCheck(db, currency),
    cushion: cushionCheck(db, asOf, currency),
  }
}

function readCheck(transactions: number, paychecks: number, statements: number, dates: readonly unknown[]) {
  if (transactions === 0 && paychecks === 0) return { done: false }
  const parts = [
    statements > 0 ? plural(statements, 'statement') : transactions > 0 ? plural(transactions, 'transaction') : undefined,
    paychecks > 0 ? plural(paychecks, 'payslip') : undefined,
  ].filter((part): part is string => part !== undefined)
  const months = dates
    .map((value) => (typeof value === 'string' ? parseISODate(value) : undefined))
    .filter((date): date is LocalDate => date !== undefined)
    .map(yearMonthOf)
    .sort(compareYearMonths)
  const span = monthSpan(months[0], months[months.length - 1])
  return { done: true, says: `Read: ${parts.join(' and ')}${span === undefined ? '' : `, ${span}`}.` }
}

/** `September`, `August and September`, `June to September`, and the year only when it changes. */
export function monthSpan(first: YearMonth | undefined, last: YearMonth | undefined): string | undefined {
  if (first === undefined || last === undefined) return undefined
  if (compareYearMonths(first, last) === 0) return formatMonthName(first)
  const apart = (last.year - first.year) * 12 + (last.month - first.month)
  if (first.year !== last.year) return `${formatYearMonth(first)} to ${formatYearMonth(last)}`
  return `${formatMonthName(first)} ${apart === 1 ? 'and' : 'to'} ${formatMonthName(last)}`
}

/**
 * **A category is yours once the pack no longer holds it** (M28 F13). A starter
 * row is recorded `SEEDED` in `format_seed` until somebody edits it — a rename,
 * a colour, archiving — and the edit releases the record (D-264); a category a
 * person made never had one. So the rows without a `SEEDED` record are exactly
 * the ones made or changed here, and no second bookkeeping is needed.
 */
function categoriesCheck(db: Database) {
  const seeded = new Set(
    listSeeds(db)
      .filter((record) => record.format === 'category' && record.state === 'SEEDED')
      .map((record) => record.key),
  )
  const yours = query(db, 'SELECT name FROM fmt_category').filter(
    (row) => typeof row['name'] === 'string' && !seeded.has(row['name']),
  ).length
  if (yours === 0) return { done: false }
  return {
    done: true,
    says: `${String(yours)} ${yours === 1 ? 'category is' : 'categories are'} yours, made or changed since the starter list.`,
  }
}

/**
 * **Done when By merchant says nothing is left** (M28 F16) — the screen's own
 * queue, so a skipped shop counts as decided here exactly as it does there. The
 * step used to count every uncategorized row, and a person who skipped one shop
 * and filed the rest saw *Everything is filed* beside an unticked step.
 */
function merchantCheck(db: Database, transactions: number) {
  if (transactions === 0) return { done: false }
  const queue = merchantQueue(db)
  if (queue.waiting.length > 0) return { done: false }
  const skipped = queue.skipped.length
  return {
    done: true,
    says:
      skipped === 0
        ? 'Every merchant has a category.'
        : `Every merchant has a category or was skipped; ${plural(skipped, 'skipped shop')} ${skipped === 1 ? 'waits' : 'wait'} under Skipped.`,
  }
}

function fixedCheck(db: Database, asOf: LocalDate, currency: CurrencyCode) {
  const tracked = listFixedExpenses(db).filter(
    (expense) =>
      expense.isActive &&
      (expense.endedAt === undefined || compareDates(expense.endedAt, asOf) >= 0),
  )
  if (tracked.length === 0) return { done: false }
  const monthly = tracked
    .map(monthlyShare)
    .filter((share) => share.currency === currency)
    .reduce((sum, share) => sum + share.minor, 0)
  return {
    done: true,
    says: `Tracking ${plural(tracked.length, 'bill')}, ${formatMoney(money(monthly, currency))} a month.`,
  }
}

function splitCheck(db: Database, asOf: LocalDate) {
  const reading = planMonth(db, { month: yearMonthOf(asOf), asOf, readings: false })
  if (reading === undefined) return { done: false }
  const name = /plan$/i.test(reading.plan.name.trim()) ? reading.plan.name.trim() : `${reading.plan.name.trim()} plan`
  const everyShekel = reading.result.splittable.minor > 0 && reading.result.balance.minor === 0
  return {
    done: true,
    says: `${name}, ${plural(reading.allocations.length, 'bucket')}${everyShekel ? ', every shekel has a job' : ''}.`,
  }
}

function openingCheck(db: Database, currency: CurrencyCode) {
  const accounts = accountBalances(db, currency)
  if (accounts.length === 0 || accounts.some((account) => account.opening === undefined)) return { done: false }
  const only = accounts.length === 1 ? accounts[0] : undefined
  if (only !== undefined && only.opening !== undefined) {
    return {
      done: true,
      says:
        only.check.kind === 'ADDS_UP'
          ? `${only.name} adds up with an opening balance of ${formatMoney(only.opening)}.`
          : `${only.name} has an opening balance of ${formatMoney(only.opening)}.`,
    }
  }
  const adding = accounts.filter((account) => account.check.kind === 'ADDS_UP').length
  return {
    done: true,
    says: `${String(accounts.length)} accounts have an opening balance; ${String(adding)} of them add up.`,
  }
}

function cushionCheck(db: Database, asOf: LocalDate, currency: CurrencyCode) {
  const cushion = cushionReading(db, asOf, currency)
  if (cushion.months === undefined) return { done: false }
  const months = `${String(cushion.months)} ${cushion.months === 1 ? 'month' : 'months'} of bills`
  return {
    done: true,
    says:
      cushion.target === undefined
        ? `${months}; the amount follows once Plan has the bills.`
        : `${months}, ${formatMoney(cushion.target)}.`,
  }
}
