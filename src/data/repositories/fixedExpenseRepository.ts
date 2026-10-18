/**
 * Fixed expenses in and out of SQLite — `FixedExpense` in docs/04-data-model.md,
 * the ledger pack's `fixed_expense` since M25 U7 (D-281).
 *
 * The math is `@/domain/fixedExpenses.ts` and knows nothing about SQL. What is
 * here is the three jobs the detector cannot do for itself: reading the rows it
 * groups, storing the answers the user gives, and remembering the merchants they
 * said no to.
 *
 * Two shapes worth knowing before reading further:
 *
 * - **Candidates are not stored.** `listExpenseObservations` hands the detector
 *   the ledger and the detector produces candidates every time. There is no
 *   candidate table and no cache, because a cached candidate is wrong the moment
 *   a statement is imported (docs/f09).
 * - **A dismissal is a setting, not a row** (D-053). One `app_setting` key holds
 *   the set of merchants the user has said no to, with when they said it.
 * - **What an expense is matched by is one of three columns**, the kind saying
 *   which: a merchant pattern, a category or a deduction type. The old table's
 *   one `match_ref` could name any of them, so it named each by an id nothing
 *   checked; `matchRef` is still whichever the kind names.
 *
 * Decoding is defensive, as everywhere else here: a `.emd` file is a
 * real SQLite database the user can open in any tool, and a row that no longer
 * makes sense is skipped rather than thrown.
 */

import type { Database } from 'sql.js'

import { money, type Money } from '@/core/money.ts'
import { addMonths, monthRange, parseISODate, toISODate, toYearMonthString, type LocalDate, type YearMonth } from '@/core/time.ts'
import { DEFAULT_WINDOW_MONTHS, detectFixedExpenses } from '@/domain/fixedExpenses.ts'
import {
  AMOUNT_VARIABILITIES,
  CADENCES,
  FIXED_EXPENSE_MATCH_KINDS,
  FIXED_EXPENSE_SOURCES,
  type AmountVariability,
  type Cadence,
  type ExpenseObservation,
  type FixedExpense,
  type FixedExpenseCandidate,
  type FixedExpenseMatchKind,
  type FixedExpenseSource,
} from '@/domain/model/fixed.ts'
import type { StoredValue } from '@/domain/format/row.ts'
import { query } from '../db/database.ts'
import { countsCondition, SPENDING } from './movedRepository.ts'
import { runRollup } from './formatRollupRepository.ts'
import { allDeclared, declared } from '../packs/ledger/tables.ts'
import { deleteRows, insertRows, updateRow } from './formatRowRepository.ts'
import { UNCATEGORIZED_ID } from './categoryRepository.ts'
import { removeExpenseRoles } from './planFixedRepository.ts'
import { readJsonSetting, writeSetting } from './settingsRepository.ts'

export interface NewFixedExpense {
  readonly name: string
  readonly categoryId?: string | undefined
  readonly matchKind: FixedExpenseMatchKind
  readonly matchRef?: string | undefined
  readonly expectedAmount: Money
  readonly amountVariability?: AmountVariability | undefined
  readonly cadence?: Cadence | undefined
  readonly dayOfMonthHint?: number | undefined
  readonly isDiscretionary?: boolean | undefined
  readonly source?: FixedExpenseSource | undefined
  readonly isActive?: boolean | undefined
  readonly startedAt?: LocalDate | undefined
  readonly endedAt?: LocalDate | undefined
}

export interface FixedExpenseEdit {
  readonly name?: string | undefined
  readonly categoryId?: string | undefined
  readonly matchKind?: FixedExpenseMatchKind | undefined
  readonly matchRef?: string | undefined
  readonly expectedAmount?: Money | undefined
  readonly amountVariability?: AmountVariability | undefined
  readonly cadence?: Cadence | undefined
  readonly dayOfMonthHint?: number | undefined
  readonly isDiscretionary?: boolean | undefined
  readonly source?: FixedExpenseSource | undefined
  readonly isActive?: boolean | undefined
  readonly startedAt?: LocalDate | undefined
  readonly endedAt?: LocalDate | undefined
}

const SELECT = `SELECT id, name, category AS category_id, match_kind,
                       COALESCE(match_pattern, match_category, match_deduction) AS match_ref,
                       expected_minor, expected_currency AS currency, amount_variability, cadence,
                       day_of_month_hint, is_discretionary, source, is_active,
                       started AS started_at, ended AS ended_at
                  FROM fmt_fixed_expense
                 WHERE 1 = 1`

/** Which of the three columns a match kind names — none, for one matched by hand. */
const MATCH_COLUMN: Readonly<Partial<Record<FixedExpenseMatchKind, string>>> = {
  MERCHANT_PATTERN: 'match_pattern',
  CATEGORY: 'match_category',
  PAYCHECK_DEDUCTION: 'match_deduction',
}

/** Every fixed expense, dearest first — the order the F09 list reads in. */
export function listFixedExpenses(db: Database): readonly FixedExpense[] {
  return decodeAll(query(db, `${SELECT} ORDER BY ABS(expected_minor) DESC, name`))
}

export function findFixedExpense(db: Database, id: string): FixedExpense | undefined {
  return decodeAll(query(db, `${SELECT} AND id = ?`, [id]))[0]
}

/**
 * What a merchant pattern already covers, live rows only.
 *
 * The detector's `alreadyTracked`: a merchant the user has already confirmed
 * must not come back next month as a fresh suggestion.
 */
export function trackedMerchants(db: Database): readonly string[] {
  return query(
    db,
    `SELECT DISTINCT match_pattern FROM fmt_fixed_expense
      WHERE is_active = 1 AND match_kind = 'MERCHANT_PATTERN' AND match_pattern IS NOT NULL`,
  ).map((row) => String(row['match_pattern']))
}

export function createFixedExpense(
  db: Database,
  input: NewFixedExpense,
  _now: number,
): FixedExpense {
  const [id = ''] = insertRows(db, declared(db, 'fixed_expense'), [
    expenseColumns({
      name: input.name,
      categoryId: input.categoryId,
      matchKind: input.matchKind,
      matchRef: input.matchRef,
      expectedAmount: input.expectedAmount,
      amountVariability: input.amountVariability ?? 'FIXED',
      cadence: input.cadence ?? 'MONTHLY',
      dayOfMonthHint: input.dayOfMonthHint,
      isDiscretionary: input.isDiscretionary === true,
      source: input.source ?? 'USER_DEFINED',
      isActive: input.isActive !== false,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
    }),
  ])

  const created = findFixedExpense(db, id)
  if (created === undefined) throw new Error('fixed expense did not survive insert')
  return created
}

/** Change one in place. Fields left out are left alone. */
export function updateFixedExpense(
  db: Database,
  id: string,
  edit: FixedExpenseEdit,
  _now: number,
): void {
  const current = findFixedExpense(db, id)
  if (current === undefined) return

  const pick = <K extends keyof FixedExpenseEdit>(
    key: K,
    value: FixedExpenseEdit[K],
  ): FixedExpenseEdit[K] => (key in edit ? edit[key] : value)

  updateRow(
    db,
    declared(db, 'fixed_expense'),
    id,
    expenseColumns({
      name: edit.name ?? current.name,
      categoryId: pick('categoryId', current.categoryId),
      matchKind: edit.matchKind ?? current.matchKind,
      matchRef: pick('matchRef', current.matchRef),
      expectedAmount: edit.expectedAmount ?? current.expectedAmount,
      amountVariability: edit.amountVariability ?? current.amountVariability,
      cadence: edit.cadence ?? current.cadence,
      dayOfMonthHint: pick('dayOfMonthHint', current.dayOfMonthHint),
      isDiscretionary: edit.isDiscretionary ?? current.isDiscretionary,
      source: edit.source ?? current.source,
      isActive: edit.isActive ?? current.isActive,
      startedAt: pick('startedAt', current.startedAt),
      endedAt: pick('endedAt', current.endedAt),
    }),
  )
}

type ExpenseFields = { readonly [K in keyof NewFixedExpense]-?: NewFixedExpense[K] }

function expenseColumns(expense: ExpenseFields): Record<string, StoredValue> {
  const column = MATCH_COLUMN[expense.matchKind]
  return {
    name: expense.name,
    category: expense.categoryId ?? null,
    match_kind: expense.matchKind,
    match_pattern: null,
    match_category: null,
    match_deduction: null,
    ...(column === undefined ? {} : { [column]: expense.matchRef ?? null }),
    expected_minor: expense.expectedAmount.minor,
    expected_currency: expense.expectedAmount.currency,
    amount_variability: expense.amountVariability ?? 'FIXED',
    cadence: expense.cadence ?? 'MONTHLY',
    day_of_month_hint: expense.dayOfMonthHint ?? null,
    is_discretionary: expense.isDiscretionary ? 1 : 0,
    source: expense.source ?? 'USER_DEFINED',
    is_active: expense.isActive ? 1 : 0,
    started: expense.startedAt === undefined ? null : toISODate(expense.startedAt),
    ended: expense.endedAt === undefined ? null : toISODate(expense.endedAt),
  }
}

/**
 * A category about to be removed or merged, taken off every expense that
 * names it — as filed, and as matched (M25 U7). Merged, both follow it into
 * the other category; removed, the filing is cleared and an expense matched by
 * it becomes one matched by hand, which is what it is once there is nothing to
 * match.
 */
export function refileFixedExpenses(db: Database, fromCategoryId: string, intoCategoryId?: string): void {
  const expenses = declared(db, 'fixed_expense')
  const into = intoCategoryId ?? null
  for (const row of query(db, 'SELECT id FROM fmt_fixed_expense WHERE category = ?', [fromCategoryId])) {
    updateRow(db, expenses, String(row['id']), { category: into })
  }
  for (const row of query(db, 'SELECT id FROM fmt_fixed_expense WHERE match_category = ?', [fromCategoryId])) {
    updateRow(
      db,
      expenses,
      String(row['id']),
      into === null ? { match_kind: 'MANUAL_ONLY', match_category: null } : { match_category: into },
    )
  }
}

/**
 * Stop projecting this one from a date, without losing what it was.
 *
 * docs/f09's "mark as ended" — a cancelled subscription. Separate from delete
 * because the history is still true: last March's Netflix charge happened.
 */
export function endFixedExpense(db: Database, id: string, endedAt: LocalDate, _now: number): void {
  updateRow(db, declared(db, 'fixed_expense'), id, { ended: toISODate(endedAt), is_active: 0 })
}

/** Remove one. **Removed, not soft-deleted**, since M25 U7 (D-266). */
export function deleteFixedExpense(db: Database, id: string, _now: number): void {
  // What plans said about it goes first, or the delete would be refused for a
  // link nobody can see (D-319).
  removeExpenseRoles(db, id)
  deleteRows(db, declared(db, 'fixed_expense'), [id], allDeclared(db))
}

/**
 * Turn a candidate into a fixed expense — **idempotently**, which is one of
 * F09's four acceptance criteria.
 *
 * Confirming the same merchant twice updates the row that already covers it
 * rather than adding a second. The lookup is on `MERCHANT_PATTERN` plus the
 * normalized merchant, which is the pair that decides whether two rows would
 * match the same future transactions — enforced here rather than by a unique
 * index, because one merchant legitimately billing for two things must stay
 * possible and a constraint error is not something a user can act on.
 *
 * `overrides` is what the review screen let the user change before agreeing:
 * the amount and the cadence, per docs/f09.
 */
export function confirmCandidate(
  db: Database,
  candidate: FixedExpenseCandidate,
  overrides: Partial<NewFixedExpense> | undefined,
  now: number,
): FixedExpense {
  const draft: NewFixedExpense = {
    name: candidate.merchantRaw === '' ? candidate.merchantNormalized : candidate.merchantRaw,
    categoryId: candidate.categoryId,
    matchKind: 'MERCHANT_PATTERN',
    matchRef: candidate.merchantNormalized,
    expectedAmount: candidate.medianAmount,
    amountVariability: candidate.amountVariability,
    cadence: candidate.suggestedCadence,
    dayOfMonthHint: candidate.dayOfMonthHint,
    source: 'DETECTED_CONFIRMED',
    startedAt: firstSeen(candidate),
    ...overrides,
  }

  const existing = query(
    db,
    `SELECT id FROM fmt_fixed_expense
      WHERE match_kind = 'MERCHANT_PATTERN' AND match_pattern = ?`,
    [candidate.merchantNormalized],
  )[0]

  if (existing === undefined) return createFixedExpense(db, draft, now)

  const id = String(existing['id'])
  updateFixedExpense(db, id, { ...draft, isActive: true }, now)

  const updated = findFixedExpense(db, id)
  if (updated === undefined) throw new Error('fixed expense did not survive update')
  return updated
}

/**
 * The cadence anchor: the first day of the earliest month the candidate was
 * seen in. Day 1 rather than the charge's own day, because the anchor answers
 * "which months", never "which day" — that is `dayOfMonthHint`.
 */
function firstSeen(candidate: FixedExpenseCandidate): LocalDate | undefined {
  const first = candidate.months[0]
  return first === undefined
    ? undefined
    : { year: first.period.year, month: first.period.month, day: 1 }
}

const DISMISSAL_KEY = 'fixedExpenses.dismissed'

/**
 * Merchants the user has said no to, and when.
 *
 * One `app_setting` key rather than a table (D-053). A dismissal is respected
 * permanently until cleared (docs/f09), so the value is a set with a timestamp
 * per member — enough to say "dismissed in June" on the screen that clears it,
 * and nothing more, because there is nothing more to say.
 */
export function readDismissals(db: Database): ReadonlyMap<string, number> {
  const stored = readJsonSetting(db, DISMISSAL_KEY)
  const merchants = stored?.['merchants']
  if (typeof merchants !== 'object' || merchants === null || Array.isArray(merchants)) {
    return new Map()
  }

  const entries = new Map<string, number>()
  for (const [merchant, at] of Object.entries(merchants as Record<string, unknown>)) {
    if (merchant !== '') entries.set(merchant, typeof at === 'number' ? at : 0)
  }
  return entries
}

/** Just the keys — what `detectFixedExpenses` takes. */
export function dismissedMerchants(db: Database): readonly string[] {
  return [...readDismissals(db).keys()]
}

export function dismissMerchant(db: Database, merchantNormalized: string, now: number): void {
  const merchants = Object.fromEntries(readDismissals(db))
  merchants[merchantNormalized] = now
  writeSetting(db, DISMISSAL_KEY, JSON.stringify({ merchants }), now)
}

/** Undo a dismissal, so the merchant can be suggested again. */
export function clearDismissal(db: Database, merchantNormalized: string, now: number): void {
  const merchants = Object.fromEntries(readDismissals(db))
  if (!(merchantNormalized in merchants)) return
  delete merchants[merchantNormalized]
  writeSetting(db, DISMISSAL_KEY, JSON.stringify({ merchants }), now)
}

/**
 * The ledger as the detector reads it, over an inclusive date range.
 *
 * On the same date basis as everything else — charge date falling back to
 * transaction date (D-006) — so a month's candidates and a month's totals cannot
 * disagree about which month a row was in.
 *
 * Rows the user excluded from statistics are left out: a card settlement is not
 * a recurring bill, it is the same money as the rows beneath it, and offering it
 * as a fixed expense would suggest subtracting a whole statement from net.
 */
export function listExpenseObservations(
  db: Database,
  from: LocalDate,
  to: LocalDate,
): readonly ExpenseObservation[] {
  return decodeObservations(
    query(
      db,
      `${OBSERVATION_SELECT}
        AND COALESCE(t.charge_date, t.transaction_date) >= ?
        AND COALESCE(t.charge_date, t.transaction_date) <= ?
      ORDER BY basis_date`,
      [toISODate(from), toISODate(to)],
    ),
  )
}

/**
 * One merchant's charges, over the whole ledger — what the labeling queue's
 * promotion proposes from (docs/f06).
 *
 * **The same filters as the detector's read, and no window.** The same filters
 * because a card settlement is no more a bill when somebody points at it than
 * when the detector finds it; no window because the promotion is not detection —
 * the user has already said what this name is, and the only question left is
 * what to propose, which is better answered from every charge than from the last
 * three months. `proposeFixedExpense` is what reads this.
 */
export function merchantObservations(
  db: Database,
  merchantNormalized: string,
): readonly ExpenseObservation[] {
  return decodeObservations(
    query(db, `${OBSERVATION_SELECT} AND t.merchant_normalized = ? ORDER BY basis_date`, [
      merchantNormalized,
    ]),
  )
}

const OBSERVATION_SELECT = `SELECT COALESCE(t.charge_date, t.transaction_date) AS basis_date,
            t.transaction_date,
            t.merchant_normalized, t.merchant_raw, t.amount_minor, t.amount_currency AS currency,
            t.category AS category_id
       FROM fmt_transaction t
      WHERE ${countsCondition('t')}
        AND t.amount_minor < 0
        AND t.merchant_normalized <> ''`

function decodeObservations(
  rows: readonly Record<string, unknown>[],
): readonly ExpenseObservation[] {
  const observations: ExpenseObservation[] = []
  for (const row of rows) {
    const date = parseISODate(String(row['basis_date']))
    if (date === undefined) continue

    const categoryId = row['category_id'] == null ? undefined : String(row['category_id'])
    // The day the shop charged, which a card line's charge date is not (M37 F2).
    const transactionDate =
      row['transaction_date'] == null ? undefined : parseISODate(String(row['transaction_date']))
    observations.push({
      merchantNormalized: String(row['merchant_normalized']),
      merchantRaw: String(row['merchant_raw'] ?? ''),
      date,
      transactionDate,
      amount: money(Number(row['amount_minor'] ?? 0), String(row['currency'])),
      // The system category means "not answered", not "filed under Uncategorized",
      // so a candidate must not propose it as the category to confirm into.
      categoryId: categoryId === UNCATEGORIZED_ID ? undefined : categoryId,
    })
  }
  return observations
}

/**
 * This month's actual charge for each merchant-matched fixed expense, as a
 * magnitude — the left-hand side of `monthVariance`.
 *
 * Only `MERCHANT_PATTERN` expenses can be answered from the ledger. A
 * `PAYCHECK_DEDUCTION` is answered by the payslip and a `MANUAL_ONLY` by
 * nothing, which is what having no entry in this map means.
 */
export function actualsByMerchant(
  db: Database,
  from: LocalDate,
  to: LocalDate,
): ReadonlyMap<string, Money> {
  const totals = new Map<string, Money>()

  for (const row of query(
    db,
    `SELECT t.merchant_normalized, t.amount_currency AS currency, SUM(ABS(t.amount_minor)) AS total
       FROM fmt_transaction t
      WHERE ${countsCondition('t')}
        AND t.amount_minor < 0
        AND COALESCE(t.charge_date, t.transaction_date) >= ?
        AND COALESCE(t.charge_date, t.transaction_date) <= ?
      GROUP BY t.merchant_normalized, t.amount_currency`,
    [toISODate(from), toISODate(to)],
  )) {
    const merchant = String(row['merchant_normalized'])
    // A merchant billing in two currencies has two rows and no total across
    // them — there is no rate (D-003). The first is kept and the screen shows
    // the charge; guessing a sum would be the error money integers exist to stop.
    if (totals.has(merchant)) continue
    totals.set(merchant, money(Number(row['total'] ?? 0), String(row['currency'])))
  }

  return totals
}

/**
 * The same question as `actualsByMerchant`, asked of a category.
 *
 * The other half of what the ledger can answer (`isLedgerMatched`). Without it a
 * `CATEGORY` expense would have no actual to compare against and would be
 * reported missing every month — the alert that cries wolf, which is the one
 * thing docs/f09's variance tracking must not become.
 *
 * Rolled up to the category named, not through its children: a fixed expense
 * pointing at `Utilities → Electricity` means that category, and folding in its
 * siblings would compare a bill against a group total.
 *
 * **It is the ledger's declared `transaction.spending`, by month and category**
 * (M36 U04) — so what a bill is compared against is what the Statistics screen
 * calls spent: not a card bill counted on the card, not a held line, not one
 * filed under Money moved. Whole months, from `from`'s to `to`'s, which is what
 * the Plan asks for.
 */
export function actualsByCategory(
  db: Database,
  from: LocalDate,
  to: LocalDate,
): ReadonlyMap<string, Money> {
  const transaction = declared(db, 'transaction')
  const spent = runRollup(db, transaction, SPENDING, allDeclared(db), {
    from: toISODate(from).slice(0, 7),
    to: toISODate(to).slice(0, 7),
  })
  // Per category and currency, across the months asked for.
  const sums = new Map<string, Map<string, number>>()
  for (const group of spent?.groups ?? []) {
    if (group.by === undefined || group.value.kind !== 'VALUE') continue
    const byCurrency = sums.get(group.by) ?? new Map<string, number>()
    for (const figure of group.value.figures) {
      if (figure.currency === undefined) continue
      byCurrency.set(figure.currency, (byCurrency.get(figure.currency) ?? 0) - figure.value)
    }
    sums.set(group.by, byCurrency)
  }

  // One currency per category, for the reason `actualsByMerchant` keeps one:
  // there is no rate in this document (D-003). The first by code is kept.
  const totals = new Map<string, Money>()
  for (const [categoryId, byCurrency] of sums) {
    const [first] = [...byCurrency.entries()].sort(([a], [b]) => a.localeCompare(b))
    if (first !== undefined) totals.set(categoryId, money(first[1], first[0]))
  }
  return totals
}

const VALID_MATCH_KINDS: ReadonlySet<string> = new Set<string>(FIXED_EXPENSE_MATCH_KINDS)
const VALID_CADENCES: ReadonlySet<string> = new Set<string>(CADENCES)
const VALID_VARIABILITIES: ReadonlySet<string> = new Set<string>(AMOUNT_VARIABILITIES)
const VALID_SOURCES: ReadonlySet<string> = new Set<string>(FIXED_EXPENSE_SOURCES)

function decodeAll(rows: readonly Record<string, unknown>[]): readonly FixedExpense[] {
  const expenses: FixedExpense[] = []
  for (const row of rows) {
    const expense = decode(row)
    if (expense !== undefined) expenses.push(expense)
  }
  return expenses
}

function decode(row: Record<string, unknown>): FixedExpense | undefined {
  const matchKind = String(row['match_kind'])
  // A row whose match kind is unreadable is a row nothing can decide the
  // subtraction rule for, and guessing that one is `MERCHANT_PATTERN` is the
  // guess that double-counts a payroll deduction.
  if (!VALID_MATCH_KINDS.has(matchKind)) return undefined

  const cadence = String(row['cadence'])
  const variability = String(row['amount_variability'])
  const source = String(row['source'])
  const dayHint = row['day_of_month_hint']

  return {
    id: String(row['id']),
    name: String(row['name'] ?? ''),
    categoryId: row['category_id'] == null ? undefined : String(row['category_id']),
    matchKind: matchKind as FixedExpenseMatchKind,
    matchRef: row['match_ref'] == null ? undefined : String(row['match_ref']),
    expectedAmount: money(Number(row['expected_minor'] ?? 0), String(row['currency'])),
    amountVariability: VALID_VARIABILITIES.has(variability)
      ? (variability as AmountVariability)
      : 'FIXED',
    cadence: VALID_CADENCES.has(cadence) ? (cadence as Cadence) : 'MONTHLY',
    dayOfMonthHint: dayHint == null ? undefined : Number(dayHint),
    isDiscretionary: Number(row['is_discretionary'] ?? 0) === 1,
    source: VALID_SOURCES.has(source) ? (source as FixedExpenseSource) : 'USER_DEFINED',
    isActive: Number(row['is_active'] ?? 0) === 1,
    startedAt: row['started_at'] == null ? undefined : parseISODate(String(row['started_at'])),
    endedAt: row['ended_at'] == null ? undefined : parseISODate(String(row['ended_at'])),
  }
}

/**
 * The charges that look like a bill over the months ending `endingAt` — the
 * detector over the ledger, minus what is tracked or was said not to be one.
 * One reading for Plan and for Home's waiting list (M31 U1), so the two cannot
 * disagree about what is waiting.
 */
export function billCandidates(
  db: Database,
  endingAt: YearMonth,
  windowMonths: number = DEFAULT_WINDOW_MONTHS,
): readonly FixedExpenseCandidate[] {
  const from = monthRange(toYearMonthString(addMonths(endingAt, -(windowMonths - 1))))?.from
  const to = monthRange(toYearMonthString(endingAt))?.to
  if (from === undefined || to === undefined) return []
  return detectFixedExpenses(listExpenseObservations(db, from, to), {
    endingAt,
    windowMonths,
    dismissed: dismissedMerchants(db),
    alreadyTracked: trackedMerchants(db),
  })
}
