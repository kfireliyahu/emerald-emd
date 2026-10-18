/**
 * Split plans, their buckets and their allocations — docs/04-data-model.md
 * ("Planning"), the ledger pack's `split_plan`, `split_bucket` and
 * `allocation` since M25 U7 (D-281).
 *
 * The math is `@/domain/splitter.ts` and knows nothing about SQL. What is here
 * is identity, ordering, and the two rules a `CHECK` constraint cannot express.
 *
 * Three shapes worth knowing before reading further:
 *
 * - **Buckets are shared across plans.** A plan owns its allocations, not its
 *   destinations; that is what makes two plans comparable.
 * - **A plan is loaded whole.** Six buckets and six allocations is the whole of
 *   it, and every figure on the splitter screen reads all of them.
 * - **Saving a plan replaces its allocations**, the way a payslip replaces its
 *   lines (012). Nothing outside the plan addresses an allocation, so there is
 *   no identity to preserve.
 * - **A bucket's target is three links, at most one set** (D-252), where the
 *   old table had a kind and an id. The kind still says which; `targetId` is
 *   whichever of the three it names.
 *
 * Decoding is defensive, as everywhere else here: a `.emd` file is a
 * real SQLite database the user can open in any tool, and a row that no longer
 * makes sense is skipped rather than thrown.
 */

import type { Database } from 'sql.js'

import { money, sum, type CurrencyCode, type Money } from '@/core/money.ts'
import {
  monthEnd,
  monthStart,
  toYearMonthString,
  type LocalDate,
  type YearMonth,
} from '@/core/time.ts'
import { subtreeOf } from '@/domain/categoryTree.ts'
import type { CategoryObservation, FixedLine } from '@/domain/model/statistics.ts'
import {
  ALLOCATION_MODES,
  BASIS_KINDS,
  BUCKET_SHARES,
  TARGET_KINDS,
  type Allocation,
  type AllocationMode,
  type BasisKind,
  type BucketShare,
  type SplitBucket,
  type SplitPlan,
  type TargetKind,
} from '@/domain/model/plan.ts'
import { isContribution } from '@/domain/savings.ts'
import { actualBasisFor, type BucketActual } from '@/domain/splitter.ts'
import type { StoredValue } from '@/domain/format/row.ts'
import { inTransaction, query } from '../db/database.ts'
import { allDeclared, declared } from '../packs/ledger/tables.ts'
import { deleteRows, insertRows, updateRow } from './formatRowRepository.ts'
import { listPayments } from './debtRepository.ts'
import { copyRoles, removePlanRoles } from './planFixedRepository.ts'
import { listDeposits } from './savingsRepository.ts'
import type { MovedLine } from './movedRepository.ts'
import { categoryObservations, monthlyReport } from './statisticsRepository.ts'

export interface NewAllocation {
  readonly bucketId: string
  readonly mode: AllocationMode
  readonly basisPoints?: number | undefined
  readonly amount?: Money | undefined
  readonly isLocked?: boolean | undefined
}

export interface NewSplitPlan {
  readonly name: string
  readonly currency: CurrencyCode
  readonly basisKind?: BasisKind | undefined
  readonly basisPaycheckId?: string | undefined
  readonly basisMonths?: number | undefined
  readonly customAmount?: Money | undefined
  readonly isDefault?: boolean | undefined
  readonly allocations?: readonly NewAllocation[] | undefined
}

export interface SplitPlanEdit {
  readonly name?: string | undefined
  readonly basisKind?: BasisKind | undefined
  readonly basisPaycheckId?: string | undefined
  readonly basisMonths?: number | undefined
  readonly customAmount?: Money | undefined
  /** Given, these become the plan's allocations. Omitted, the existing ones are left alone. */
  readonly allocations?: readonly NewAllocation[] | undefined
}

export interface NewSplitBucket {
  readonly name: string
  readonly targetKind?: TargetKind | undefined
  readonly targetId?: string | undefined
  readonly color?: string | undefined
  readonly isBuffer?: boolean | undefined
  readonly share?: BucketShare | undefined
}

export interface SplitBucketEdit {
  readonly name?: string | undefined
  readonly targetKind?: TargetKind | undefined
  readonly targetId?: string | undefined
  readonly color?: string | undefined
  /** Which of 50 / 30 / 20 it counts as; undefined for none of them (M31 U4). */
  readonly share?: BucketShare | undefined
}

/** A plan with everything the splitter needs to draw it. */
export interface PlanWithAllocations {
  readonly plan: SplitPlan
  readonly allocations: readonly Allocation[]
}

const SORT_STEP = 10

const PLAN_SELECT = `SELECT id, name, basis_kind, basis_paycheck AS basis_paycheck_id, basis_months,
                            custom_amount_minor, currency, is_default
                       FROM fmt_split_plan
                      WHERE 1 = 1`

const BUCKET_SELECT = `SELECT id, name, target_kind,
                 COALESCE(target_category, target_saving_goal, target_debt, target_holding, target_account) AS target_id,
                 color, sort_order, is_buffer, in_cushion, share
            FROM fmt_split_bucket
           WHERE 1 = 1`

/** Which of a bucket's links its kind names — none, for free money. */
const TARGET_COLUMN: Readonly<Partial<Record<TargetKind, string>>> = {
  CATEGORY: 'target_category',
  SAVING_GOAL: 'target_saving_goal',
  DEBT: 'target_debt',
  FUND: 'target_holding',
  ACCOUNT: 'target_account',
}

/** Every plan, the default first and the rest by name. */
export function listSplitPlans(db: Database): readonly SplitPlan[] {
  return decodePlans(query(db, `${PLAN_SELECT} ORDER BY is_default DESC, name`))
}

export function findSplitPlan(db: Database, id: string): PlanWithAllocations | undefined {
  const plan = decodePlans(query(db, `${PLAN_SELECT} AND id = ?`, [id]))[0]
  if (plan === undefined) return undefined
  return { plan, allocations: listAllocations(db, id, plan.currency) }
}

/**
 * The plan the splitter opens on: the one marked default, or the first there is.
 *
 * Never invents one. An empty document has no plan, and the screen's empty state
 * is where a first plan comes from — creating one as a side effect of looking is
 * the kind of thing that marks a file dirty for having been opened.
 */
export function defaultSplitPlan(db: Database): PlanWithAllocations | undefined {
  const plan = listSplitPlans(db)[0]
  return plan === undefined ? undefined : findSplitPlan(db, plan.id)
}

export function listAllocations(
  db: Database,
  planId: string,
  currency: CurrencyCode,
): readonly Allocation[] {
  return query(
    db,
    `SELECT id, plan AS plan_id, bucket AS bucket_id, mode, share AS basis_points, amount_minor,
            is_locked
       FROM fmt_allocation
      WHERE plan = ?`,
    [planId],
  ).map((row) => decodeAllocation(row, currency))
}

/** Every bucket in the document, in the order the splitter lists them. */
export function listSplitBuckets(db: Database): readonly SplitBucket[] {
  return decodeBuckets(query(db, `${BUCKET_SELECT} ORDER BY sort_order, name`))
}

export function createSplitPlan(db: Database, input: NewSplitPlan, _now: number): SplitPlan {
  let id = ''

  inTransaction(db, () => {
    // A second default would make "the plan the splitter opens on" a coin toss.
    if (input.isDefault === true) clearDefault(db)

    ;[id = ''] = insertRows(db, declared(db, 'split_plan'), [
      {
        ...planColumns({
          name: input.name,
          basisKind: input.basisKind ?? 'LAST_PAYCHECK',
          basisPaycheckId: input.basisPaycheckId,
          basisMonths: input.basisMonths,
          customAmount: input.customAmount,
          currency: input.currency,
        }),
        is_default: input.isDefault === true ? 1 : 0,
      },
    ])
    writeAllocations(db, id, input.currency, input.allocations ?? [])
  })

  const created = decodePlans(query(db, `${PLAN_SELECT} AND id = ?`, [id]))[0]
  if (created === undefined) throw new Error('split plan did not survive insert')
  return created
}

/**
 * Change a plan in place. Fields left out are left alone.
 *
 * `allocations` is the exception and is all-or-nothing: given, it becomes the
 * whole plan. That is what the splitter screen submits — every slider is on
 * screen at once, so there is no partial edit to express.
 */
export function updateSplitPlan(
  db: Database,
  id: string,
  edit: SplitPlanEdit,
  _now: number,
): void {
  const existing = findSplitPlan(db, id)
  if (existing === undefined) return

  const current = existing.plan
  const pick = <K extends keyof SplitPlanEdit>(key: K, value: SplitPlanEdit[K]): SplitPlanEdit[K] =>
    key in edit ? edit[key] : value

  inTransaction(db, () => {
    updateRow(
      db,
      declared(db, 'split_plan'),
      id,
      planColumns({
        name: edit.name ?? current.name,
        basisKind: edit.basisKind ?? current.basisKind,
        basisPaycheckId: pick('basisPaycheckId', current.basisPaycheckId),
        basisMonths: pick('basisMonths', current.basisMonths),
        customAmount: pick('customAmount', current.customAmount),
        currency: current.currency,
      }),
    )

    if (edit.allocations !== undefined) {
      removeAllocations(db, query(db, 'SELECT id FROM fmt_allocation WHERE plan = ?', [id]))
      writeAllocations(db, id, current.currency, edit.allocations)
    }
  })
}

/** Exactly one plan is the default, and setting one clears the others. */
export function setDefaultPlan(db: Database, id: string, _now: number): void {
  inTransaction(db, () => {
    clearDefault(db)
    updateRow(db, declared(db, 'split_plan'), id, { is_default: 1 })
  })
}

/**
 * Copy a plan and its allocations — docs/f05's "save as", and how "Bonus month"
 * starts life as a variation of "Default" rather than as six sliders retyped.
 *
 * The copy is never the default: two defaults is the state `setDefaultPlan`
 * exists to prevent, and a duplicate is a draft rather than a promotion.
 */
export function duplicateSplitPlan(
  db: Database,
  id: string,
  name: string,
  now: number,
): SplitPlan | undefined {
  const existing = findSplitPlan(db, id)
  if (existing === undefined) return undefined

  const copy = createSplitPlan(
    db,
    {
      name,
      currency: existing.plan.currency,
      basisKind: existing.plan.basisKind,
      basisPaycheckId: existing.plan.basisPaycheckId,
      basisMonths: existing.plan.basisMonths,
      customAmount: existing.plan.customAmount,
      isDefault: false,
      allocations: existing.allocations.map((allocation) => ({
        bucketId: allocation.bucketId,
        mode: allocation.mode,
        basisPoints: allocation.basisPoints,
        amount: allocation.amount,
        isLocked: allocation.isLocked,
      })),
    },
    now,
  )
  copyRoles(db, id, copy.id)
  return copy
}

/**
 * Remove a plan and its allocations. **Removed, not soft-deleted**, since M25
 * U7: a declared row is there or it is not (D-266).
 */
export function deleteSplitPlan(db: Database, id: string, now: number): void {
  const wasDefault = findSplitPlan(db, id)?.plan.isDefault === true
  inTransaction(db, () => {
    removeAllocations(db, query(db, 'SELECT id FROM fmt_allocation WHERE plan = ?', [id]))
    removePlanRoles(db, id)
    // Its months go back to the default (M31 U4).
    const rows = query(db, 'SELECT id FROM fmt_plan_month WHERE plan = ?', [id]).map((row) => String(row['id']))
    if (rows.length > 0) deleteRows(db, declared(db, 'plan_month'), rows, allDeclared(db))
    deleteRows(db, declared(db, 'split_plan'), [id], allDeclared(db))
    // The default went: the first plan left, by name, takes over, so there is always one
    // to open (D-322). None left is a document with no plan, which Plan offers to start.
    if (wasDefault) {
      const next = listSplitPlans(db)[0]
      if (next !== undefined) setDefaultPlan(db, next.id, now)
    }
  })
}

// --- Which plan a month is on (M31 U4) ------------------------------------------

/**
 * **The months given a plan**, as `YYYY-MM` to the plan's id. A month that is not here is on the
 * default.
 */
export function listPlanMonths(db: Database): ReadonlyMap<string, string> {
  return new Map(
    query(db, 'SELECT month, plan FROM fmt_plan_month ORDER BY month').map(
      (row) => [String(row['month']), String(row['plan'])] as const,
    ),
  )
}

/** The plan a month is on: the one it was given, else the default, else the first plan there is. */
export function planOnMonth(db: Database, month: YearMonth): string | undefined {
  return listPlanMonths(db).get(toYearMonthString(month)) ?? listSplitPlans(db)[0]?.id
}

/**
 * **Give months a plan, or put them back on the default** — the Plan screen's month checkboxes and
 * `plan_month`'s `months` (M31 U4). Giving a month the default plan is putting it back, since a
 * month nobody gave a plan is on the default; taking a month off a plan only does so when it is that
 * plan's. The row is kept when the plan is edited: a month's plan is a choice, not a stamp.
 */
export function setPlanMonths(
  db: Database,
  planId: string,
  give: readonly YearMonth[],
  takeBack: readonly YearMonth[],
): void {
  const isDefault = findSplitPlan(db, planId)?.plan.isDefault === true
  const format = declared(db, 'plan_month')
  inTransaction(db, () => {
    const held = new Map(
      query(db, 'SELECT id, month, plan FROM fmt_plan_month').map(
        (row) => [String(row['month']), { id: String(row['id']), plan: String(row['plan']) }] as const,
      ),
    )
    const remove: string[] = []
    for (const month of give) {
      const key = toYearMonthString(month)
      const row = held.get(key)
      if (isDefault) {
        if (row !== undefined) remove.push(row.id)
      } else if (row === undefined) {
        insertRows(db, format, [{ month: key, plan: planId }])
      } else if (row.plan !== planId) {
        updateRow(db, format, row.id, { plan: planId })
      }
    }
    for (const month of takeBack) {
      const row = held.get(toYearMonthString(month))
      if (row !== undefined && row.plan === planId) remove.push(row.id)
    }
    if (remove.length > 0) deleteRows(db, format, remove, allDeclared(db))
  })
}

export function createSplitBucket(
  db: Database,
  input: NewSplitBucket,
  _now: number,
): SplitBucket {
  let id = ''
  const last = query(db, 'SELECT MAX(sort_order) AS last FROM fmt_split_bucket')[0]?.['last']

  inTransaction(db, () => {
    if (input.isBuffer === true) clearBuffer(db)
    ;[id = ''] = insertRows(db, declared(db, 'split_bucket'), [
      {
        ...bucketColumns(input.name, input.targetKind ?? 'FREE', input.targetId, input.color),
        sort_order: Number(last ?? 0) + SORT_STEP,
        is_buffer: input.isBuffer === true ? 1 : 0,
        ...(input.share !== undefined ? { share: input.share } : {}),
      },
    ])
  })

  const created = decodeBuckets(query(db, `${BUCKET_SELECT} AND id = ?`, [id]))[0]
  if (created === undefined) throw new Error('split bucket did not survive insert')
  return created
}

export function updateSplitBucket(
  db: Database,
  id: string,
  edit: SplitBucketEdit,
  _now: number,
): void {
  const current = decodeBuckets(query(db, `${BUCKET_SELECT} AND id = ?`, [id]))[0]
  if (current === undefined) return

  const targetId = 'targetId' in edit ? edit.targetId : current.targetId
  const color = 'color' in edit ? edit.color : current.color

  updateRow(db, declared(db, 'split_bucket'), id, {
    ...bucketColumns(edit.name ?? current.name, edit.targetKind ?? current.targetKind, targetId, color),
    ...('share' in edit ? { share: edit.share ?? null } : {}),
  })
}

/**
 * Point every bucket aimed at a goal, a debt or a category that is about to be
 * removed at nothing — free money, which is what an allocation to a
 * destination that no longer exists is. The old table left the id dangling
 * and the splitter called the bucket orphaned; a link cannot dangle.
 */
export function unaimBuckets(
  db: Database,
  column: 'target_category' | 'target_saving_goal' | 'target_debt' | 'target_holding' | 'target_account',
  targetId: string,
): void {
  const buckets = declared(db, 'split_bucket')
  for (const row of query(db, `SELECT id FROM fmt_split_bucket WHERE ${column} = ?`, [targetId])) {
    updateRow(db, buckets, String(row['id']), { target_kind: 'FREE', [column]: null })
  }
}

/** Every bucket aimed at one account or fund, aimed at another instead — a merge's half. */
export function reaimBucketLink(
  db: Database,
  column: 'target_holding' | 'target_account',
  fromId: string,
  intoId: string,
): void {
  const buckets = declared(db, 'split_bucket')
  for (const row of query(db, `SELECT id FROM fmt_split_bucket WHERE ${column} = ?`, [fromId])) {
    updateRow(db, buckets, String(row['id']), { [column]: intoId })
  }
}

/**
 * Take a paycheck about to be removed off every plan based on it. The plan
 * keeps its kind and says its basis is unavailable, which is what the splitter
 * said of a plan whose slip was soft-deleted before M25 U7.
 */
export function unbasePlans(db: Database, paycheckId: string): void {
  const plans = declared(db, 'split_plan')
  for (const row of query(db, 'SELECT id FROM fmt_split_plan WHERE basis_paycheck = ?', [paycheckId])) {
    updateRow(db, plans, String(row['id']), { basis_paycheck: null })
  }
}

/** Every bucket aimed at one category, aimed at another instead — a merge's half. */
export function reaimBuckets(db: Database, fromCategoryId: string, intoCategoryId: string): void {
  const buckets = declared(db, 'split_bucket')
  for (const row of query(db, 'SELECT id FROM fmt_split_bucket WHERE target_category = ?', [fromCategoryId])) {
    updateRow(db, buckets, String(row['id']), { target_category: intoCategoryId })
  }
}

/** The order the splitter lists buckets in, re-normalized in tens as rules are. */
export function reorderSplitBuckets(
  db: Database,
  orderedIds: readonly string[],
  _now: number,
): void {
  const buckets = declared(db, 'split_bucket')
  inTransaction(db, () => {
    orderedIds.forEach((id, index) => {
      updateRow(db, buckets, id, { sort_order: (index + 1) * SORT_STEP })
    })
  })
}

/**
 * Remove a bucket, and every allocation pointing at it.
 *
 * Cascaded rather than refused, which is the opposite of what deleting a
 * category or a deduction type does — and the difference is what the rows mean.
 * A paycheck line naming a deduction type is a record of what a payslip said,
 * and deleting the type would rewrite history. An allocation is a plan for money
 * that has not moved yet, so a destination that no longer exists has nothing to
 * say and no history to lose.
 */
export function deleteSplitBucket(db: Database, id: string, _now: number): void {
  inTransaction(db, () => {
    removeAllocations(db, query(db, 'SELECT id FROM fmt_allocation WHERE bucket = ?', [id]))
    deleteRows(db, declared(db, 'split_bucket'), [id], allDeclared(db))
  })
}

/** How many plans allocate to each bucket — what deleting one has to say out loud. */
export function bucketUsageCounts(db: Database): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const row of query(
    db,
    'SELECT bucket AS bucket_id, COUNT(*) AS uses FROM fmt_allocation GROUP BY bucket',
  )) {
    counts.set(String(row['bucket_id']), Number(row['uses'] ?? 0))
  }
  return counts
}

function clearDefault(db: Database): void {
  const plans = declared(db, 'split_plan')
  for (const row of query(db, 'SELECT id FROM fmt_split_plan WHERE is_default = 1')) {
    updateRow(db, plans, String(row['id']), { is_default: 0 })
  }
}

function clearBuffer(db: Database): void {
  const buckets = declared(db, 'split_bucket')
  for (const row of query(db, 'SELECT id FROM fmt_split_bucket WHERE is_buffer = 1')) {
    updateRow(db, buckets, String(row['id']), { is_buffer: 0 })
  }
}

interface PlanFields {
  readonly name: string
  readonly basisKind: BasisKind
  readonly basisPaycheckId: string | undefined
  readonly basisMonths: number | undefined
  readonly customAmount: Money | undefined
  readonly currency: CurrencyCode
}

function planColumns(plan: PlanFields): Record<string, StoredValue> {
  return {
    name: plan.name,
    basis_kind: plan.basisKind,
    basis_paycheck: plan.basisPaycheckId ?? null,
    basis_months: plan.basisMonths ?? null,
    // A plan is in one currency, and its own figure is in it.
    ...moneyCells(
      'custom_amount',
      plan.customAmount === undefined ? undefined : money(plan.customAmount.minor, plan.currency),
    ),
    currency: plan.currency,
  }
}

/** A bucket's name, kind and target, the target in the one link its kind names. */
function bucketColumns(
  name: string,
  kind: TargetKind,
  targetId: string | undefined,
  color: string | undefined,
): Record<string, StoredValue> {
  const column = TARGET_COLUMN[kind]
  return {
    name,
    target_kind: kind,
    target_category: null,
    target_saving_goal: null,
    target_debt: null,
    target_holding: null,
    target_account: null,
    ...(column === undefined ? {} : { [column]: targetId ?? null }),
    color: color ?? null,
  }
}

function removeAllocations(db: Database, rows: readonly Record<string, unknown>[]): void {
  if (rows.length === 0) return
  deleteRows(
    db,
    declared(db, 'allocation'),
    rows.map((row) => String(row['id'])),
    allDeclared(db),
  )
}

/** The share goes in as the basis points it is stored as — a percentage to two places (D-257). */
function writeAllocations(
  db: Database,
  planId: string,
  currency: CurrencyCode,
  allocations: readonly NewAllocation[],
): void {
  if (allocations.length === 0) return
  insertRows(
    db,
    declared(db, 'allocation'),
    allocations.map((allocation) => ({
      plan: planId,
      bucket: allocation.bucketId,
      mode: allocation.mode,
      share: allocation.basisPoints ?? null,
      ...moneyCells(
        'amount',
        allocation.amount === undefined ? undefined : money(allocation.amount.minor, currency),
      ),
      is_locked: allocation.isLocked === true ? 1 : 0,
    })),
  )
}

/** A money column's two cells, both empty for no amount. */
function moneyCells(column: string, amount: Money | undefined): Record<string, StoredValue> {
  return {
    [`${column}_minor`]: amount === undefined ? null : amount.minor,
    [`${column}_currency`]: amount === undefined ? null : amount.currency,
  }
}

const VALID_BASIS_KINDS: ReadonlySet<string> = new Set<string>(BASIS_KINDS)
const VALID_TARGET_KINDS: ReadonlySet<string> = new Set<string>(TARGET_KINDS)
const VALID_MODES: ReadonlySet<string> = new Set<string>(ALLOCATION_MODES)
const VALID_SHARES: ReadonlySet<string> = new Set<string>(BUCKET_SHARES)

function decodePlans(rows: readonly Record<string, unknown>[]): readonly SplitPlan[] {
  return rows.map((row) => {
    const currency = String(row['currency'])
    const basisKind = String(row['basis_kind'])

    return {
      id: String(row['id']),
      name: String(row['name'] ?? ''),
      basisKind: VALID_BASIS_KINDS.has(basisKind) ? (basisKind as BasisKind) : 'LAST_PAYCHECK',
      basisPaycheckId:
        row['basis_paycheck_id'] == null ? undefined : String(row['basis_paycheck_id']),
      basisMonths: row['basis_months'] == null ? undefined : Number(row['basis_months']),
      customAmount:
        row['custom_amount_minor'] == null
          ? undefined
          : money(Number(row['custom_amount_minor']), currency),
      currency,
      isDefault: Number(row['is_default'] ?? 0) === 1,
    }
  })
}

function decodeBuckets(rows: readonly Record<string, unknown>[]): readonly SplitBucket[] {
  return rows.map((row) => {
    const stored = String(row['target_kind'])
    const targetKind: TargetKind = VALID_TARGET_KINDS.has(stored) ? (stored as TargetKind) : 'FREE'
    return {
      id: String(row['id']),
      name: String(row['name'] ?? ''),
      targetKind,
      targetId: row['target_id'] == null ? undefined : String(row['target_id']),
      color: row['color'] == null ? undefined : String(row['color']),
      sortOrder: Number(row['sort_order'] ?? 0),
      isBuffer: Number(row['is_buffer'] ?? 0) === 1,
      inCushion: Number(row['in_cushion'] ?? 0) === 1,
      share: VALID_SHARES.has(String(row['share'])) ? (String(row['share']) as BucketShare) : undefined,
    }
  })
}

/**
 * Count a bucket among the months of expenses the cushion holds, or stop counting it (M28 F10).
 * A bucket is shared across plans, so this is a fact about the bucket and not about one plan.
 */
export function setBucketInCushion(db: Database, bucketId: string, inCushion: boolean, now: number): void {
  void now
  if (query(db, 'SELECT id FROM fmt_split_bucket WHERE id = ?', [bucketId]).length === 0) {
    throw new Error('There is no such bucket in this document.')
  }
  updateRow(db, declared(db, 'split_bucket'), bucketId, { in_cushion: inCushion ? 1 : 0 })
}

// --- Plan versus actual (docs/f05) ------------------------------------------

/**
 * What each bucket's destination actually did in one month — the right-hand
 * column of docs/f05's plan-vs-actual, measured.
 *
 * The arithmetic is `planVersusActual`; this is the four measurements it takes,
 * and the only interesting thing about them is **where each one comes from**:
 *
 * - A `CATEGORY` bucket reads the month's category breakdown **out of
 *   `monthlyReport`** — the same call the insights screen makes, not a query of
 *   its own. F05's third acceptance criterion is that these figures match F10's
 *   for the same month and category, and the only way to hold that is to read
 *   the same function rather than to write a query that ought to agree with it.
 *   The line is the **rolled** one, subcategories included, for D-088's reason:
 *   a plan that says "₪2,000 for Food" means Food and everything under it.
 * - A `SAVING_GOAL` bucket reads **contributions**, through `isContribution`
 *   (D-081). An opening balance and a market gain are real money in the goal and
 *   are not the user putting money in, and scoring a good quarter as a month
 *   where the plan was beaten by 8% is exactly the flattery that decision
 *   exists to stop.
 * - A `DEBT` bucket reads the payments recorded that month — **all of them**,
 *   including ones discovery found and nobody has reviewed. The review queue is
 *   about which debt a payment belongs to, not about whether the money left the
 *   account (D-084), and the count comes back so the screen can say how many
 *   rows the figure is of.
 *
 * A `FREE` bucket, and any bucket whose target has gone missing, is **absent
 * from the map**. That is not zero, and `planVersusActual` keeps it out of both
 * totals rather than reporting the plan as underspent by the whole of it.
 */
export interface MeasuredMonth {
  readonly period: YearMonth
  /**
   * Whether the ledger holds any row for this month.
   *
   * False is why the two ledger-backed bases are **absent** from the map rather
   * than measured at zero: a month nobody imported did not cost nothing, it is
   * unknown, and reporting it as a perfect underspend is the mistake D-087 named
   * and the cumulative curve already refuses to make. Deposits and payments are
   * measured either way — they are recorded by hand and do not need a statement.
   */
  readonly ledgerHasMonth: boolean
  readonly actuals: ReadonlyMap<string, BucketActual>
  /**
   * Each tracked fixed expense running in the month, against the charges the
   * ledger holds for it (D-322) — the report's own lines, so the comparison and
   * Home cannot disagree about what a bill cost.
   */
  readonly fixed: readonly FixedLine[]
}

export function bucketActuals(
  db: Database,
  buckets: readonly SplitBucket[],
  period: YearMonth,
  asOf: LocalDate,
  knownTargetIds: ReadonlySet<string>,
  options?: { readonly currency?: CurrencyCode },
): MeasuredMonth {
  const report = monthlyReport(db, period, asOf, options)
  const currency = report.split.fixed.currency
  // `summary` exists for a month that holds a payslip or a deposit and no
  // statement, so the test is the transaction count rather than the summary:
  // what a category's spending needs is the ledger, and only the ledger.
  const ledgerHasMonth = (report.summary?.transactionCount ?? 0) > 0
  const from = monthStart(period)
  const to = monthEnd(period)

  const actuals = new Map<string, BucketActual>()
  const observations = buckets.some((bucket) => bucket.targetKind === 'CATEGORY')
    ? categoryObservations(db, period, { currency })
    : []
  const tree = categoryTree(db)

  for (const bucket of buckets) {
    const basis = actualBasisFor(bucket, knownTargetIds)
    if (basis === undefined) continue
    if (!ledgerHasMonth && basis === 'CATEGORY_SPEND') continue

    // The other three all name a target, and `actualBasisFor` has already said
    // the id resolves — an orphaned bucket came back undefined above.
    const targetId = bucket.targetId
    if (targetId === undefined) continue

    if (basis === 'CATEGORY_SPEND') {
      // The category and everything under it (M28 F29, D-348): a bucket on
      // Living counts Groceries and Electricity, filed two levels below it.
      const measured = spendUnder(observations, report.moved, subtreeOf(tree, targetId), currency)
      actuals.set(bucket.id, {
        amount: measured?.amount ?? money(0, currency),
        basis,
        rowCount: measured?.rowCount ?? 0,
      })
      continue
    }

    if (basis === 'GOAL_DEPOSITS') {
      const contributions = listDeposits(db, { goalId: targetId, from, to }).filter(
        (deposit) => isContribution(deposit) && deposit.amount.currency === currency,
      )
      actuals.set(bucket.id, {
        amount: sum(
          contributions.map((deposit) => deposit.amount),
          currency,
        ),
        basis,
        rowCount: contributions.length,
      })
      continue
    }

    const payments = listPayments(db, targetId).filter(
      (payment) =>
        payment.amount.currency === currency &&
        payment.date.year === period.year &&
        payment.date.month === period.month,
    )
    actuals.set(bucket.id, {
      amount: sum(
        payments.map((payment) => payment.amount),
        currency,
      ),
      basis,
      rowCount: payments.length,
    })
  }

  return { period, ledgerHasMonth, actuals, fixed: report.split.lines }
}

/** Every category's id and parent — what `subtreeOf` reads. */
export function categoryTree(db: Database): readonly { readonly id: string; readonly parentId: string | undefined }[] {
  return query(db, 'SELECT id, parent FROM fmt_category').map((row) => ({
    id: String(row['id']),
    parentId: row['parent'] == null ? undefined : String(row['parent']),
  }))
}

/**
 * **What a budget on a category measures** (M28 F29, D-348): what was spent in
 * the category and in every category under it — `ids` is that subtree. A
 * category on the Money moved tab is moved and not spent (D-316), so it has no
 * outflow: what happened to it is the net that moved, never below nothing.
 * Undefined when nothing in the subtree moved at all; Plan reads that as zero
 * and Home leaves the line out.
 *
 * It was the breakdown's line for the category, which held its children only
 * when the parent had spending of its own — so a bucket on a heading nobody
 * files into directly measured nothing.
 */
export function spendUnder(
  observations: readonly CategoryObservation[],
  moved: readonly MovedLine[],
  ids: ReadonlySet<string>,
  currency: CurrencyCode,
): { readonly amount: Money; readonly rowCount: number } | undefined {
  const spent = observations.filter((one) => one.categoryId !== undefined && ids.has(one.categoryId))
  if (spent.length > 0) {
    return {
      amount: sum(spent.map((one) => one.outflow), currency),
      rowCount: spent.reduce((n, one) => n + one.transactionCount, 0),
    }
  }
  const went = moved.filter((one) => one.categoryId !== undefined && ids.has(one.categoryId))
  if (went.length === 0) return undefined
  return {
    amount: money(Math.max(0, went.reduce((n, one) => n + one.netMinor, 0)), currency),
    rowCount: went.reduce((n, one) => n + one.transactionCount, 0),
  }
}

function decodeAllocation(row: Record<string, unknown>, currency: CurrencyCode): Allocation {
  const mode = String(row['mode'])
  return {
    id: String(row['id']),
    planId: String(row['plan_id']),
    bucketId: String(row['bucket_id']),
    mode: VALID_MODES.has(mode) ? (mode as AllocationMode) : 'PERCENTAGE',
    basisPoints: row['basis_points'] == null ? undefined : Number(row['basis_points']),
    amount: row['amount_minor'] == null ? undefined : money(Number(row['amount_minor']), currency),
    isLocked: Number(row['is_locked'] ?? 0) === 1,
  }
}
