/**
 * One month's money, followed from the payslip to where it sits today — M17's
 * view, and the only screen in the app that reads the whole graph rather than
 * one edge of it (D-179).
 *
 * **A read over existing rows.** Nothing here writes, and nothing here is
 * stored: every row this produces is a join between things the app already
 * records. That was D-179's test for the view and it is the thing to keep true
 * — needing a column to draw an arrow means the *edge* is missing, and the fix
 * is to build the edge rather than to give the picture a table of its own.
 *
 * **It follows the money the app can follow and says so where it cannot.** The
 * honest half of this view is the half that stops: a pension line whose
 * deduction type names no fund, a goal with no holding to put a generated
 * deposit in, a plan that was never applied to the month. Each of those is a
 * missing link with a name, and naming it is more use than a chart that quietly
 * omits it. `TraceEnd` is therefore a union with four ways to arrive and one to
 * stop, and the screen writes the sentence from the `kind` — the same division
 * `attention` draws (docs/f12).
 *
 * Pure, like everything in `src/domain/`: plain values in, plain values out.
 */

import { add, money, sum, zero, type CurrencyCode, type Money } from '@/core/money.ts'
import type { YearMonth } from '@/core/time.ts'
import type { Debt } from '@/domain/model/debt.ts'
import type { FundAccount } from '@/domain/model/funds.ts'
import type { DeductionType, PaycheckWithLines } from '@/domain/model/paycheck.ts'
import type { SplitBucket } from '@/domain/model/plan.ts'
import type { Holding, HoldingPlace, SavingGoal } from '@/domain/model/savings.ts'
import type { SplitResult } from '@/domain/splitter.ts'

/** Which half of the month the row belongs to: before the net existed, or after. */
export type TraceStage = 'PAYROLL' | 'SPLIT'

/**
 * Why a chain stops. Each is a **link that is missing**, named so the screen can
 * say which one — never a diagnosis of the money.
 */
export type TraceBreak =
  /** A saving deduction whose type names no fund, goal or debt (`unlinkedSavingTypes`). */
  | 'DEDUCTION_NAMES_NOTHING'
  /** The goal is named and has no holding, so no deposit could be generated (F07). */
  | 'GOAL_HAS_NO_HOLDING'
  /** A plan proposed this and nobody accepted the suggestion, so nothing was written. */
  | 'NOT_APPLIED'
  /** No plan was applied to this month at all, so the whole net stops here. */
  | 'NO_PLAN_APPLIED'
  /** The plan assigned less than there was, and the rest was never given a destination. */
  | 'NOT_ASSIGNED'
  /** The bucket or deduction points at a goal, debt or fund the document no longer has. */
  | 'TARGET_MISSING'

/** Where a row's money ends up — four arrivals and one stop. */
export type TraceEnd =
  /** It is sitting in a holding, and the app can name where. */
  | {
      readonly kind: 'HOLDING'
      readonly holdingId: string
      readonly holdingName: string
      readonly placeName: string
    }
  /**
   * It reached a fund. The chain ends there on purpose: a fund's balance is a
   * transcribed snapshot rather than the sum of its deposits — F13's deliberate
   * exception to "balances are always derived" — so the money arrived, and the
   * figure it arrived into was not computed from it.
   */
  | { readonly kind: 'FUND'; readonly fundId: string; readonly fundName: string }
  /** It reduced what you owe. There is no holding for a repayment to sit in. */
  | { readonly kind: 'DEBT'; readonly debtId: string; readonly debtName: string }
  /** It was spent — a category's budget, the fixed-expense total, free money. */
  | { readonly kind: 'SPENT' }
  | { readonly kind: 'BROKEN'; readonly reason: TraceBreak }

export interface TraceRow {
  /** Stable within one trace, so the screen can key rows and draw one arrow each. */
  readonly id: string
  readonly stage: TraceStage
  /** What sent it: a deduction type's name, or a bucket's. */
  readonly via: string
  readonly amount: Money
  readonly end: TraceEnd
}

export interface MonthTrace {
  readonly period: YearMonth
  /** Undefined when no payslip covers this month, which is itself the finding. */
  readonly gross: Money | undefined
  readonly net: Money | undefined
  /** What payroll sent straight out of the gross, before the net existed. */
  readonly payroll: readonly TraceRow[]
  /** The plan applied to this month, by name. Undefined when none was. */
  readonly planName: string | undefined
  /** What the split did with the net. */
  readonly split: readonly TraceRow[]
  /**
   * The sum of the rows that arrive somewhere the app can name — a holding, a
   * fund, or the debt they paid down. The same rows `traceLandings` lists.
   */
  readonly followed: Money
  /** The sum of the rows that stop. The number the view exists to make visible. */
  readonly stopped: Money
}

/**
 * Everything the trace needs, gathered by the screen.
 *
 * Passed in rather than looked up, for the reason every other aggregate in this
 * folder is: this function is the *shape* of the graph, and one that goes and
 * finds its own inputs cannot be tested without a database.
 *
 * The deposits and payments arrive as **sets of what was written for this
 * month**, already resolved by their source ref — which the caller can do in SQL
 * and this cannot do at all, since a ref's shape belongs to the writer that
 * mints it.
 */
export interface MonthTraceInput {
  readonly period: YearMonth
  readonly currency: CurrencyCode
  readonly entry: PaycheckWithLines | undefined
  readonly types: readonly DeductionType[]
  readonly goals: readonly SavingGoal[]
  readonly debts: readonly Debt[]
  readonly funds: readonly FundAccount[]
  readonly holdings: readonly Holding[]
  readonly places: readonly HoldingPlace[]
  /** Which holding each goal's money from this month actually landed in, by goal id. */
  readonly landedByGoal: ReadonlyMap<string, string>
  /** Goal ids the plan wrote a `FROM_PLAN` deposit for this month. */
  readonly depositedByPlan: ReadonlySet<string>
  /** Debt ids the plan wrote a `FROM_PLAN` payment for this month. */
  readonly paidByPlan: ReadonlySet<string>
  /** The plan applied to this month and what it computes to, or nothing. */
  readonly plan: { readonly name: string; readonly result: SplitResult } | undefined
}

export function traceMonth(input: MonthTraceInput): MonthTrace {
  const nothing = zero(input.currency)

  const payroll = payrollRows(input)
  const split = splitRows(input)
  const rows = [...payroll, ...split]

  const stopped = rows.filter((row) => row.end.kind === 'BROKEN')
  // Everything that is neither stopped nor spent — which is exactly the set
  // `traceLandings` lists, and has to be: a headline that excluded the debt
  // repayment the last column names would be two answers to one question.
  const arrived = rows.filter((row) => row.end.kind !== 'BROKEN' && row.end.kind !== 'SPENT')

  return {
    period: input.period,
    gross: input.entry?.paycheck.gross,
    net: input.entry?.paycheck.net,
    payroll,
    planName: input.plan?.name,
    split,
    followed: totalOf(arrived, input.currency, nothing),
    stopped: totalOf(stopped, input.currency, nothing),
  }
}

/**
 * The deductions that were sent somewhere, one row per deduction type.
 *
 * **Employee plus employer**, which is what `payrollSavingDeposits` and
 * `expectedContributions` both put into a balance — the employer's share of a
 * pension is money that arrived, and a view showing only the employee half would
 * disagree with every figure downstream of it.
 *
 * A type with no destination is here too, and stops: that is
 * `unlinkedSavingTypes`' finding, arriving in the one place where the
 * consequence is visible as a gap in a picture rather than as a notice.
 */
function payrollRows(input: MonthTraceInput): readonly TraceRow[] {
  const entry = input.entry
  if (entry === undefined) return []

  const byType = new Map(input.types.map((type) => [type.id, type]))
  const perType = new Map<string, number>()

  for (const line of entry.lines) {
    const type = byType.get(line.deductionTypeId)
    if (type === undefined) continue
    const routed =
      type.linkedFundId !== undefined ||
      type.linkedSavingGoalId !== undefined ||
      type.linkedDebtId !== undefined
    // A type that goes nowhere earns a row only when it was *meant* to: an
    // income-tax line is not a broken link, it is tax.
    if (!routed && !type.countsAsSaving) continue

    const minor = line.employeeAmount.minor + (line.employerAmount?.minor ?? 0)
    perType.set(type.id, (perType.get(type.id) ?? 0) + minor)
  }

  const rows: TraceRow[] = []
  for (const [typeId, minor] of perType) {
    const type = byType.get(typeId)
    // A month whose lines cancel out sent nothing, and a row of zero says
    // something happened.
    if (type === undefined || minor === 0) continue

    rows.push({
      id: `payroll:${typeId}`,
      stage: 'PAYROLL',
      via: type.name,
      amount: money(minor, input.currency),
      end: payrollEnd(type, input),
    })
  }
  return rows
}

function payrollEnd(type: DeductionType, input: MonthTraceInput): TraceEnd {
  if (type.linkedFundId !== undefined) {
    const fund = input.funds.find((one) => one.id === type.linkedFundId)
    return fund === undefined
      ? { kind: 'BROKEN', reason: 'TARGET_MISSING' }
      : { kind: 'FUND', fundId: fund.id, fundName: fund.name }
  }

  if (type.linkedSavingGoalId !== undefined) return goalEnd(type.linkedSavingGoalId, input)

  if (type.linkedDebtId !== undefined) {
    const debt = input.debts.find((one) => one.id === type.linkedDebtId)
    return debt === undefined
      ? { kind: 'BROKEN', reason: 'TARGET_MISSING' }
      : { kind: 'DEBT', debtId: debt.id, debtName: debt.name }
  }

  return { kind: 'BROKEN', reason: 'DEDUCTION_NAMES_NOTHING' }
}

/**
 * Where a goal's money for this month ended up.
 *
 * `landedByGoal` is asked first and the goal's default holding second, because
 * the two can differ: the default is where the *next* generated deposit would
 * go, and one already written may since have been moved. What is on screen
 * should be where the money is.
 */
function goalEnd(goalId: string, input: MonthTraceInput): TraceEnd {
  const goal = input.goals.find((one) => one.id === goalId)
  if (goal === undefined) return { kind: 'BROKEN', reason: 'TARGET_MISSING' }

  const holdingId = input.landedByGoal.get(goalId) ?? goal.defaultHoldingId
  if (holdingId === undefined) return { kind: 'BROKEN', reason: 'GOAL_HAS_NO_HOLDING' }

  const holding = input.holdings.find((one) => one.id === holdingId)
  if (holding === undefined) return { kind: 'BROKEN', reason: 'TARGET_MISSING' }

  const place = input.places.find((one) => one.id === holding.holdingPlaceId)
  return {
    kind: 'HOLDING',
    holdingId: holding.id,
    holdingName: holding.name,
    placeName: place?.name ?? goal.name,
  }
}

/**
 * What the split did with the net — one row per bucket, plus the two amounts no
 * bucket holds.
 *
 * A bucket that names a goal or a debt is followed **only where the plan was
 * actually applied**: an allocation is a proposal until somebody accepts it, and
 * drawing the arrow anyway would make a plan nobody committed look like money
 * that moved. That is what `depositedByPlan` and `paidByPlan` decide, and they
 * are sets of what was *written* rather than of what was suggested.
 */
function splitRows(input: MonthTraceInput): readonly TraceRow[] {
  const net = input.entry?.paycheck.net
  const plan = input.plan

  if (plan === undefined) {
    if (net === undefined) return []
    return [
      {
        id: 'split:none',
        stage: 'SPLIT',
        via: 'The net',
        amount: net,
        end: { kind: 'BROKEN', reason: 'NO_PLAN_APPLIED' },
      },
    ]
  }

  const rows: TraceRow[] = []
  const { result } = plan

  // Off the top, and therefore never in a bucket. It is the bills, which are
  // spent by definition — a row that arrives nowhere and is not a broken link.
  if (result.fixedExpenses.minor !== 0) {
    rows.push({
      id: 'split:fixed',
      stage: 'SPLIT',
      via: 'Bills',
      amount: result.fixedExpenses,
      end: { kind: 'SPENT' },
    })
  }
  if (result.fixedShare !== undefined && result.fixedShare.minor !== 0) {
    rows.push({
      id: 'split:fixed-share',
      stage: 'SPLIT',
      via: 'Bills',
      amount: result.fixedShare,
      end: { kind: 'SPENT' },
    })
  }

  for (const computed of result.allocations) {
    if (computed.amount.minor === 0) continue
    rows.push({
      id: `split:${computed.bucket.id}`,
      stage: 'SPLIT',
      via: computed.bucket.name,
      amount: computed.amount,
      end: bucketEnd(computed.bucket, input),
    })
  }

  // What the plan left over. Real money with no destination, which is a missing
  // link rather than a rounding remark — and negative in a drawdown, where it is
  // not left over at all and is left out.
  if (result.balance.minor > 0) {
    rows.push({
      id: 'split:balance',
      stage: 'SPLIT',
      via: 'Not assigned',
      amount: result.balance,
      end: { kind: 'BROKEN', reason: 'NOT_ASSIGNED' },
    })
  }

  return rows
}

function bucketEnd(bucket: SplitBucket, input: MonthTraceInput): TraceEnd {
  switch (bucket.targetKind) {
    case 'SAVING_GOAL': {
      if (bucket.targetId === undefined) return { kind: 'BROKEN', reason: 'TARGET_MISSING' }
      if (!input.depositedByPlan.has(bucket.targetId)) {
        return { kind: 'BROKEN', reason: 'NOT_APPLIED' }
      }
      return goalEnd(bucket.targetId, input)
    }
    case 'DEBT': {
      if (bucket.targetId === undefined) return { kind: 'BROKEN', reason: 'TARGET_MISSING' }
      if (!input.paidByPlan.has(bucket.targetId)) {
        return { kind: 'BROKEN', reason: 'NOT_APPLIED' }
      }
      const debt = input.debts.find((one) => one.id === bucket.targetId)
      return debt === undefined
        ? { kind: 'BROKEN', reason: 'TARGET_MISSING' }
        : { kind: 'DEBT', debtId: debt.id, debtName: debt.name }
    }
    // A category's target, the fixed-expense total and free money are all money
    // that leaves. None of them is a broken link, and calling them one would
    // bury the three that are.
    default:
      return { kind: 'SPENT' }
  }
}

/** The sum, skipping any row denominated in something else rather than throwing. */
function totalOf(rows: readonly TraceRow[], currency: CurrencyCode, fallback: Money): Money {
  const matching = rows.filter((row) => row.amount.currency === currency).map((row) => row.amount)
  return matching.length === 0 ? fallback : sum(matching, currency)
}

/**
 * Everything this month can be followed into, each named once.
 *
 * What the picture's last column lists, so it ends somewhere rather than in a
 * list of arrows — two deductions into one fund are one destination holding
 * their total, which is the sentence a person would say out loud.
 */
export interface TraceLanding {
  readonly kind: 'HOLDING' | 'FUND' | 'DEBT'
  readonly id: string
  readonly name: string
  /** The place, for a holding. Undefined for the other two, which have none. */
  readonly placeName: string | undefined
  readonly amount: Money
}

export function traceLandings(trace: MonthTrace, currency: CurrencyCode): readonly TraceLanding[] {
  const byId = new Map<string, TraceLanding>()

  for (const row of [...trace.payroll, ...trace.split]) {
    const end = row.end
    if (end.kind === 'BROKEN' || end.kind === 'SPENT') continue
    if (row.amount.currency !== currency) continue

    const landing: TraceLanding =
      end.kind === 'HOLDING'
        ? {
            kind: 'HOLDING',
            id: end.holdingId,
            name: end.holdingName,
            placeName: end.placeName,
            amount: row.amount,
          }
        : end.kind === 'FUND'
          ? {
              kind: 'FUND',
              id: end.fundId,
              name: end.fundName,
              placeName: undefined,
              amount: row.amount,
            }
          : {
              kind: 'DEBT',
              id: end.debtId,
              name: end.debtName,
              placeName: undefined,
              amount: row.amount,
            }

    const key = `${landing.kind}:${landing.id}`
    const existing = byId.get(key)
    byId.set(
      key,
      existing === undefined ? landing : { ...existing, amount: add(existing.amount, landing.amount) },
    )
  }

  return [...byId.values()]
}
