import type { Database } from 'sql.js'

import { money, type CurrencyCode, type Money } from '@/core/money.ts'
import { yearMonthOf, type LocalDate, type YearMonth } from '@/core/time.ts'
import { debtStatus, leftAfter, type DebtLine, type DebtStatus } from '@/domain/debtPlan.ts'
import { goalMonthlyFromPlan } from '@/domain/goalPlan.ts'
import { debtsSummary, type DebtRow } from './debtRepository.ts'
import { planMonth, type PlanMonth } from './planMonthRepository.ts'

/**
 * Debts as the deciding view reads them (M28 U8, D-325): each open debt with what
 * it takes each month, what Plan puts on top, and where plain addition leaves it.
 *
 * **A read, and it owns no table**, as `goalsPlan` is: the extra is the Plan
 * bucket that points at the debt, so this joins the debt's balance to the plan's
 * computed split, and the write is Plan's own (`updateSplitPlan`, `set_plan`).
 */
export interface DebtPlanRow {
  readonly row: DebtRow
  readonly line: DebtLine
  /** The buckets that point at this debt. None means no extra is going toward it. */
  readonly bucketIds: readonly string[]
  readonly status: DebtStatus
}

export interface DebtsPlan {
  readonly month: YearMonth
  readonly currency: CurrencyCode
  readonly rows: readonly DebtPlanRow[]
  readonly plan: PlanMonth | undefined
  readonly left: Money
  readonly payment: Money
  readonly extra: Money
  /** Open debts in another currency: left out, because nothing here can convert them. */
  readonly otherCurrency: number
  /** Closed debts, kept as history and offered no amount. */
  readonly closed: readonly DebtRow[]
  /** The summary's rows, all of them, for the card actions a row menu reaches. */
  readonly all: readonly DebtRow[]
}

export function debtsPlan(db: Database, asOf: LocalDate, currency: CurrencyCode): DebtsPlan {
  const month = yearMonthOf(asOf)
  const summary = debtsSummary(db, month, { currency })
  const plan = planMonth(db, { month, asOf, readings: false })

  const open = summary.rows.filter((row) => !row.debt.isClosed)
  const counted = open.filter((row) => row.debt.principalAmount.currency === currency)

  const rows = counted.map((row): DebtPlanRow => {
    const { amount, bucketIds } =
      plan === undefined
        ? { amount: money(0, currency), bucketIds: [] as readonly string[] }
        : goalMonthlyFromPlan(plan.result.allocations, row.debt.id, currency, 'DEBT')
    const standing = row.debt.monthlyPaymentAmount
    const observed =
      row.projection.kind === 'PROJECTED' || row.projection.kind === 'BEYOND_HORIZON'
        ? row.projection.monthlyPrincipal
        : undefined
    const payment = standing ?? observed ?? money(0, currency)
    const line: DebtLine = {
      debtId: row.debt.id,
      name: row.debt.name,
      // An unchecked balance has no figure to show as left; the row says so on the Debts screen.
      left: money(row.balance.kind === 'KNOWN' ? Math.max(0, row.balance.outstanding.minor) : 0, currency),
      payment,
      paymentSource:
        standing !== undefined ? 'STANDING_ORDER' : observed !== undefined ? 'OBSERVED' : 'NONE',
      extra: amount,
    }
    return { row, line, bucketIds, status: debtStatus(line, month) }
  })

  const total = (pick: (line: DebtLine) => number): Money =>
    money(
      rows.reduce((running, one) => running + pick(one.line), 0),
      currency,
    )

  return {
    month,
    currency,
    rows,
    plan,
    left: total((line) => line.left.minor),
    payment: total((line) => line.payment.minor),
    extra: total((line) => line.extra.minor),
    otherCurrency: open.length - counted.length,
    closed: summary.rows.filter((row) => row.debt.isClosed),
    all: summary.rows,
  }
}

/** What all the open debts leave after `months`, by plain addition. */
export function debtsAfter(
  rows: readonly DebtPlanRow[],
  months: number,
  currency: CurrencyCode,
): Money {
  return money(
    rows.reduce((running, one) => running + leftAfter(one.line, months).minor, 0),
    currency,
  )
}
