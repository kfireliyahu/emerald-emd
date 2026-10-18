import { addMonths, compareYearMonths, toYearMonthString, type YearMonth } from '@/core/time.ts'

/**
 * **A month an account has no statement for** — M28 U5's second suggestion,
 * taken: a missing statement is a row of Home's *All months*, with Read, the
 * way a missing payslip is a row of Paychecks.
 *
 * Read off the rows rather than off the files: a month in which an account has
 * no transaction at all is a month nobody read its statement for. That is the
 * only evidence the document holds — a file's own period is not stored — and
 * it is the right evidence, because what the reader needs to know is that
 * *Went out* is short, which is a fact about rows.
 *
 * Two kinds of gap, and only two:
 *
 * - **Inside an account's run** — a month between its first and its last that
 *   has nothing in it. A card used every month for a year is not idle in March.
 * - **At the end, briefly** — the months after an account's last month up to
 *   the newest month the document holds, when the account went quiet no more
 *   than `RECENT` months ago. Longer than that is a card put away, and telling
 *   somebody every month forever that a closed card has no statement would be
 *   the app inventing a chore (the reason `missingPayslip` will not either).
 */
export interface AccountMonths {
  readonly accountId: string
  readonly name: string
  readonly last4: string | undefined
  /** Every month the account has a row in. Any order, repeats allowed. */
  readonly months: readonly YearMonth[]
}

export interface StatementGap {
  readonly accountId: string
  readonly name: string
  readonly last4: string | undefined
  readonly period: YearMonth
}

/** How long an account may be quiet at the end before it is a card put away. */
export const RECENT = 2

export function statementGaps(
  accounts: readonly AccountMonths[],
  newest: YearMonth | undefined,
): readonly StatementGap[] {
  const gaps: StatementGap[] = []
  for (const account of accounts) {
    const months = [...account.months].sort(compareYearMonths)
    const first = months[0]
    const last = months.at(-1)
    if (first === undefined || last === undefined) continue
    const has = new Set(months.map(toYearMonthString))

    let end = last
    if (newest !== undefined && compareYearMonths(newest, last) > 0) {
      if (compareYearMonths(addMonths(last, RECENT), newest) >= 0) end = newest
    }

    for (let at = addMonths(first, 1); compareYearMonths(at, end) <= 0; at = addMonths(at, 1)) {
      if (!has.has(toYearMonthString(at))) {
        gaps.push({ accountId: account.accountId, name: account.name, last4: account.last4, period: at })
      }
    }
  }
  return gaps.sort((a, b) => compareYearMonths(b.period, a.period) || a.name.localeCompare(b.name))
}
