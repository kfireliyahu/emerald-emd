/**
 * Splitter math — docs/packs/ledger/05-domain-rules-and-calculations.md ("Splitter math") and
 * docs/f05-paycheck-splitter.md.
 *
 * Pure functions over plain values: no database, no clock, no React. Written and
 * tested before the screen exists, as every milestone here has opened.
 *
 * Four things hold everywhere in this file:
 *
 * - **Percentages are of the splittable amount**, never of what is left after
 *   the fixed amounts. That is docs/05 step 4, and it is deliberate: it keeps a
 *   percentage stable when an unrelated fixed amount changes. The screen says so
 *   in one line.
 * - **Nothing is ever auto-corrected.** Percentages summing to 130% are allowed,
 *   a negative splittable amount is shown rather than clamped, and planning to
 *   spend more than you earn is a drawdown rather than an error (docs/f05's open
 *   question, settled here as it recommended).
 * - **The parts sum to the whole, exactly.** `distribute` is largest-remainder,
 *   so a plan at 100% lands on the splittable amount to the agora — which is
 *   F05's first acceptance criterion.
 * - **A rate is not money.** Allocations carry integer basis points, and the one
 *   place a percentage becomes an amount is integer multiplication and division
 *   inside `distribute` (D-003).
 */

import { money, sum, type CurrencyCode, type Money } from '@/core/money.ts'
import { distribute, distributeWithBuffer, ratioBasisPoints } from '@/core/percent.ts'
import type {
  Allocation,
  SplitBucket,
  SplitPlan,
} from '@/domain/model/plan.ts'
import type { Paycheck } from '@/domain/model/paycheck.ts'
import type { GoalFeed } from '@/domain/model/savings.ts'
import { averageNet, sortByPeriodDescending } from '@/domain/paycheck.ts'
import type { YearMonth } from '@/core/time.ts'

export interface ResolvedBasis {
  readonly amount: Money
  /** How many slips the figure is of. Zero when it came from a typed number. */
  readonly sampleSize: number
  /** Bonus months an average left out, so the screen can say "excluding 1". */
  readonly excluded: number
  /**
   * True when the plan asked for a paycheck that is not there.
   *
   * docs/f05: with no paycheck recorded the basis falls back to a typed amount
   * with a prompt to add one. The fallback is reported rather than silently
   * substituted — a plan built on a zero the user never typed is worse than an
   * empty screen that says why.
   */
  readonly unavailable: boolean
  /**
   * Set when there is no payslip and the figure is **the salary that came in**
   * instead (M31 U3): how many months of deposits it is of, and the newest.
   */
  readonly fromSalary?: { readonly months: number; readonly newest: YearMonth } | undefined
}

/** One month's salary deposits, as the bank shows them. */
export interface LandedSalary {
  readonly period: YearMonth
  readonly amount: Money
}

/**
 * What `basisKind` actually comes to, in shekels — the four rows of docs/f05's
 * basis table.
 *
 * **Every one of them is a net figure**, which is what settles F05's open
 * question about net versus gross: there is no basis kind that could produce a
 * gross, so percentages are of net by construction rather than by choice.
 *
 * `averageNet` answers `AVERAGE_LAST_N` — the one that already existed, with
 * bonus months excluded and its sample size reported. Nothing here re-derives
 * it.
 */
export function resolveBasis(
  plan: SplitPlan,
  paychecks: readonly Paycheck[],
  landed: readonly LandedSalary[] = [],
): ResolvedBasis {
  const resolved = resolveFromSlips(plan, paychecks)
  if (!resolved.unavailable || plan.basisKind === 'SPECIFIC_PAYCHECK') return resolved
  return fromLanded(plan, landed) ?? resolved
}

/**
 * **No payslip, so the salary that came in** (M31 U3): the newest month's
 * deposits for *my last paycheck*, the last few months' average for an average.
 * Said as such on screen, never passed off as a slip. Undefined with none.
 */
function fromLanded(plan: SplitPlan, landed: readonly LandedSalary[]): ResolvedBasis | undefined {
  const months = landed
    .filter((one) => one.amount.currency === plan.currency && one.amount.minor > 0)
    .sort((x, y) => y.period.year - x.period.year || y.period.month - x.period.month)
    .slice(0, plan.basisKind === 'AVERAGE_LAST_N' ? Math.max(1, plan.basisMonths ?? 3) : 1)
  const newest = months[0]
  if (newest === undefined) return undefined
  const total = months.reduce((n, one) => n + one.amount.minor, 0)
  return {
    amount: money(Math.round(total / months.length), plan.currency),
    sampleSize: 0,
    excluded: 0,
    unavailable: false,
    fromSalary: { months: months.length, newest: newest.period },
  }
}

function resolveFromSlips(plan: SplitPlan, paychecks: readonly Paycheck[]): ResolvedBasis {
  const none = { sampleSize: 0, excluded: 0 } as const

  if (plan.basisKind === 'CUSTOM_AMOUNT') {
    return {
      amount: plan.customAmount ?? money(0, plan.currency),
      ...none,
      unavailable: false,
    }
  }

  if (plan.basisKind === 'SPECIFIC_PAYCHECK') {
    const chosen = paychecks.find((paycheck) => paycheck.id === plan.basisPaycheckId)
    return chosen === undefined
      ? { amount: money(0, plan.currency), ...none, unavailable: true }
      : { amount: chosen.net, sampleSize: 1, excluded: 0, unavailable: false }
  }

  if (plan.basisKind === 'LAST_PAYCHECK') {
    const newest = sortByPeriodDescending(paychecks)[0]
    return newest === undefined
      ? { amount: money(0, plan.currency), ...none, unavailable: true }
      : { amount: newest.net, sampleSize: 1, excluded: 0, unavailable: false }
  }

  const average = averageNet(paychecks, plan.basisMonths ?? 3)
  return {
    amount: average.amount ?? money(0, plan.currency),
    sampleSize: average.sampleSize,
    excluded: average.excluded,
    unavailable: average.amount === undefined,
  }
}

/**
 * One bucket's share of one plan, computed.
 *
 * Carries the allocation and the bucket rather than ids, because every caller —
 * the table, the stacked bar, the apply flow — needs all three together and
 * looking two of them up again is how a row ends up showing one bucket's name
 * over another's number.
 */
export interface ComputedAllocation {
  readonly allocation: Allocation
  readonly bucket: SplitBucket
  /** What this bucket gets. Negative is possible; see `PlanStatus`. */
  readonly amount: Money
  /** Its share of the splittable amount, in basis points. Undefined when there is nothing to divide. */
  readonly shareBasisPoints: number | undefined
}

export type PlanStatus =
  /** Every agora assigned. What a plan with a remainder bucket always is. */
  | 'EXACT'
  /** Something is left over. Neutral — the user is still thinking. */
  | 'UNALLOCATED'
  /**
   * More assigned than there is. Allowed and labelled, never corrected: docs/f05
   * calls this a drawdown, and planning to spend savings is a real thing people
   * do on purpose.
   */
  | 'OVER_ALLOCATED'

export interface SplitResult {
  /** The basis before anything is taken off the top. */
  readonly basis: Money
  /** What F09 says comes off the top. Zero when the mode is `NONE` — or when it is in the split. */
  readonly fixedExpenses: Money
  /**
   * The same total drawn **inside** the split instead, when the plan says so
   * (D-174). Undefined otherwise, which is the ordinary case.
   *
   * **Deliberately not an entry in `allocations`.** A synthetic row there would
   * be iterated by `applyPlan`, `planVersusActual` and `bucketActuals`, none of
   * which could look its bucket up — so it would read as a plan line with no
   * actuals rather than as what it is. It is a share of the bar and of the
   * balance, and nothing else.
   */
  readonly fixedShare: Money | undefined
  /** `basis − fixedExpenses`. **Negative is possible** and is shown, not clamped. */
  readonly splittable: Money
  readonly allocations: readonly ComputedAllocation[]
  /** `splittable − Σ allocations`. Zero whenever a `REMAINDER` allocation exists. */
  readonly balance: Money
  readonly status: PlanStatus
}

/**
 * The whole of docs/05's splitter math, in the order it specifies.
 *
 * `basis` and `fixedExpenses` are passed in rather than looked up: the basis
 * comes from `averageNet` or a paycheck or a typed number, and the fixed-expense
 * total comes from `fixedExpenseBasis` — which is the only function allowed to
 * decide what a payroll deduction contributes (D-053). Recomputing either here
 * would be a second answer to a question that already has one.
 */
/** What the plan's fixed expenses come to, by what each does to it (D-319). */
export interface FixedForSplit {
  /** Comes off the basis before anything is divided. */
  readonly netOff: Money
  /** A share of the split, ahead of the buckets. */
  readonly inSplit: Money
}

export function splitPlan(
  plan: SplitPlan,
  buckets: readonly SplitBucket[],
  allocations: readonly Allocation[],
  basis: Money,
  taken: FixedForSplit,
): SplitResult {
  const currency = plan.currency
  /**
   * **Two kinds of fixed expense, and a plan says which is which** (D-174,
   * D-319). One comes out of net before the split, so the percentages divide
   * what is left; the other is one share of the split, a stripe at its head.
   * The same money either way, and a different meaning for every percentage —
   * which is why the roles are the plan's and not a setting beside the theme.
   */
  const subtracted = taken.netOff
  const inSplit = taken.inSplit.minor !== 0
  const splittable = money(basis.minor - subtracted.minor, currency)

  const byId = new Map(buckets.map((bucket) => [bucket.id, bucket]))
  const resolved = allocations
    .filter((allocation) => byId.has(allocation.bucketId))
    .sort(byBucketOrder(byId))

  const fixed = resolved.filter((allocation) => allocation.mode === 'FIXED_AMOUNT')
  const percentage = resolved.filter((allocation) => allocation.mode === 'PERCENTAGE')
  // At most one, by unique index. `find` rather than a throw if a hand-edited
  // file holds two: the first wins and the second gets nothing, which is a
  // strange plan rather than an unopenable document.
  const remainder = resolved.find((allocation) => allocation.mode === 'REMAINDER')

  const amounts = new Map<string, Money>()

  for (const allocation of fixed) {
    amounts.set(allocation.id, allocation.amount ?? money(0, currency))
  }

  // Step 4: percentages apply to the splittable amount, not to what step 3 left.
  const weights = percentage.map((allocation) => allocation.basisPoints ?? 0)
  const pool = percentageTotal(splittable, weights)
  const bufferIndex = percentage.findIndex(
    (allocation) => byId.get(allocation.bucketId)?.isBuffer === true,
  )
  const shares =
    bufferIndex >= 0
      ? distributeWithBuffer(pool, weights, bufferIndex)
      : distribute(pool, weights)

  percentage.forEach((allocation, index) => {
    amounts.set(allocation.id, money(shares[index] ?? 0, currency))
  })

  const assignedBeforeRemainder = [...amounts.values()].reduce(
    (running, amount) => running + amount.minor,
    0,
  )

  // The fixed expenses that are a share of the split are spoken for before the
  // remainder is: what is left is left after them (D-319).
  const unassigned =
    splittable.minor - assignedBeforeRemainder - (inSplit ? taken.inSplit.minor : 0)

  if (remainder !== undefined) {
    // Step 5: whatever is left, **including when that is negative**. A remainder
    // bucket showing -₪300 is the honest rendering of a plan that over-commits;
    // clamping it to zero would hide the overage inside a balance of zero.
    amounts.set(remainder.id, money(unassigned, currency))
  }

  const computed: ComputedAllocation[] = []
  for (const allocation of resolved) {
    const bucket = byId.get(allocation.bucketId)
    const amount = amounts.get(allocation.id)
    if (bucket === undefined || amount === undefined) continue
    computed.push({
      allocation,
      bucket,
      amount,
      shareBasisPoints: ratioBasisPoints(amount, splittable),
    })
  }

  const share = inSplit ? taken.inSplit : undefined
  const assigned =
    computed.reduce((running, entry) => running + entry.amount.minor, 0) + (share?.minor ?? 0)
  const balance = money(splittable.minor - assigned, currency)

  return {
    basis,
    fixedExpenses: subtracted,
    fixedShare: share,
    splittable,
    allocations: computed,
    balance,
    status: statusOf(splittable, balance, remainder === undefined ? undefined : unassigned),
  }
}

/**
 * What the percentage allocations come to in total, before they are divided
 * among themselves.
 *
 * Rounded **once**, here, rather than once per bucket — which is what makes a
 * plan summing to exactly 100% land on the splittable amount exactly rather than
 * two agorot short of it. `distribute` then splits this figure by largest
 * remainder, and its parts sum to it by construction.
 */
function percentageTotal(splittable: Money, weights: readonly number[]): number {
  const totalBasisPoints = weights.reduce((running, weight) => running + weight, 0)
  if (totalBasisPoints === 0) return 0

  const scaled = splittable.minor * totalBasisPoints
  const negative = scaled < 0
  const magnitude = Math.floor((Math.abs(scaled) * 2 + 10_000) / 20_000)
  return negative ? -magnitude : magnitude
}

/**
 * What the balance indicator says.
 *
 * Without a `REMAINDER` allocation this is just the sign of the balance. With
 * one it cannot be, because a remainder always drives the balance to zero: a
 * plan assigning 130% of its basis would otherwise report as perfectly
 * balanced while its remainder bucket quietly held a negative number.
 *
 * So the remainder is judged by **which way it points**. A remainder with the
 * same sign as the splittable amount is money left to give away, which is what
 * a remainder bucket is for. One pointing the other way is a shortfall the
 * bucket cannot conjure — the other allocations took more than there was.
 *
 * That phrasing rather than "any negative amount" because the splittable amount
 * is itself negative when fixed expenses exceed the basis (docs/f05 says to show
 * that, not clamp it). Every share of a negative amount is negative, and a plan
 * that divides it exactly is exact — there is nothing over-allocated about
 * having no money.
 */
function statusOf(
  splittable: Money,
  balance: Money,
  remainderAmount: number | undefined,
): PlanStatus {
  if (remainderAmount !== undefined) {
    const opposed =
      (remainderAmount < 0 && splittable.minor >= 0) ||
      (remainderAmount > 0 && splittable.minor < 0)
    return opposed ? 'OVER_ALLOCATED' : 'EXACT'
  }

  if (balance.minor > 0) return 'UNALLOCATED'
  if (balance.minor < 0) return 'OVER_ALLOCATED'
  return 'EXACT'
}

function byBucketOrder(
  byId: ReadonlyMap<string, SplitBucket>,
): (a: Allocation, b: Allocation) => number {
  return (a, b) => {
    const first = byId.get(a.bucketId)
    const second = byId.get(b.bucketId)
    return (
      (first?.sortOrder ?? 0) - (second?.sortOrder ?? 0) ||
      (first?.name ?? '').localeCompare(second?.name ?? '') ||
      a.id.localeCompare(b.id)
    )
  }
}

export interface Redistribution {
  readonly allocations: readonly Allocation[]
  /** What the dragged slider actually got. Not always what was asked for. */
  readonly appliedBasisPoints: number
  /** True when the request could not be met in full — the UI says why. */
  readonly clamped: boolean
}

/**
 * Drag one slider; give back what it took, or take back what it gave —
 * docs/f05's locking and redistribution.
 *
 * Dragging takes from the other unlocked percentages **while they have anything
 * left to give**, so rebalancing inside a plan keeps its total where it was.
 * Once they are all at zero the drag keeps going and the plan over-allocates,
 * which the balance strip reports as a drawdown.
 *
 * **That last part is a deliberate departure from docs/f05**, which says the
 * drag is "clamped" when everything else is locked. Clamping to the pool makes
 * the pool a ceiling that can never be raised: three buckets summing to 49%
 * leave every one of them unable to pass 49, for ever, with nothing on screen
 * explaining why. That is a worse failure than an over-allocated plan, and it
 * contradicts the same note's stronger and more repeated rule — the app never
 * normalizes a plan to 100%, because people deliberately under- and
 * over-allocate while they think. The clamp that remains is the honest one: 0
 * and 100% of the basis, which is what a slider can express (D-059).
 *
 * Locked allocations and fixed amounts never move, which is F05's second
 * acceptance criterion and is untouched by any of this.
 *
 * The redistribution itself is one `distribute` call. The others must sum to
 * what the pool has left, proportionally to where they already are — which is
 * exactly what largest-remainder does, including keeping the total exact and
 * never letting a share go negative.
 */
export function redistribute(
  allocations: readonly Allocation[],
  allocationId: string,
  requestedBasisPoints: number,
): Redistribution {
  const target = allocations.find((allocation) => allocation.id === allocationId)

  // A locked slider is not draggable, and a fixed amount has no percentage to
  // drag. Both come back unchanged rather than throwing: the screen can disable
  // the control, and a disabled control that is somehow used must not corrupt a
  // plan.
  if (target === undefined || target.mode !== 'PERCENTAGE' || target.isLocked) {
    return {
      allocations,
      appliedBasisPoints: target?.basisPoints ?? 0,
      clamped: target !== undefined,
    }
  }

  const movable = allocations.filter(
    (allocation) =>
      allocation.id !== allocationId &&
      allocation.mode === 'PERCENTAGE' &&
      !allocation.isLocked,
  )

  const current = target.basisPoints ?? 0
  const pool = movable.reduce(
    (running, allocation) => running + (allocation.basisPoints ?? 0),
    current,
  )

  const applied = Math.max(0, Math.min(Math.round(requestedBasisPoints), BASIS_POINTS_PER_WHOLE))
  // The others give way — down to zero, and no further. Past that the plan
  // over-allocates rather than the drag refusing to move: see the note above.
  const shares = distribute(
    Math.max(0, pool - applied),
    movable.map((allocation) => allocation.basisPoints ?? 0),
  )
  const next = new Map(movable.map((allocation, index) => [allocation.id, shares[index] ?? 0]))

  return {
    allocations: allocations.map((allocation) => {
      if (allocation.id === allocationId) return { ...allocation, basisPoints: applied }
      const share = next.get(allocation.id)
      return share === undefined ? allocation : { ...allocation, basisPoints: share }
    }),
    appliedBasisPoints: applied,
    clamped: applied !== Math.round(requestedBasisPoints),
  }
}

/** A slider's ceiling. Past a whole paycheck in one bucket, use a fixed amount. */
const BASIS_POINTS_PER_WHOLE = 10_000

/**
 * Buckets whose target is gone — docs/f05's "bucket target archived/deleted".
 *
 * The plan still works: the allocation arithmetic never reads `targetKind` at
 * all, so an orphaned bucket splits money exactly as it did yesterday. What
 * changes is what applying the plan would do, which is why this is reported
 * rather than repaired. docs/f05 says the bucket "becomes `FREE` with a warning
 * badge"; it becomes `FREE` **in effect**, and the stored row is left alone so
 * that restoring the category from the recently-deleted view (M6.5) restores the
 * bucket with it.
 */
export function orphanedBuckets(
  buckets: readonly SplitBucket[],
  knownTargetIds: ReadonlySet<string>,
): readonly SplitBucket[] {
  return buckets.filter(
    (bucket) =>
      (bucket.targetKind === 'CATEGORY' ||
        bucket.targetKind === 'SAVING_GOAL' ||
        bucket.targetKind === 'DEBT' ||
        bucket.targetKind === 'FUND' ||
        bucket.targetKind === 'ACCOUNT') &&
      (bucket.targetId === undefined || !knownTargetIds.has(bucket.targetId)),
  )
}

/** What a bucket effectively is once its target has gone missing. */
export function effectiveTargetKind(
  bucket: SplitBucket,
  knownTargetIds: ReadonlySet<string>,
): SplitBucket['targetKind'] {
  return orphanedBuckets([bucket], knownTargetIds).length > 0 ? 'FREE' : bucket.targetKind
}

export type SuggestionKind =
  /** Create a deposit toward a saving goal. Needed F07, so M4 never produced one. */
  | 'SAVING_DEPOSIT'
  /** Record a payment against a debt. Needed F08 and schema 27 (D-190). */
  | 'DEBT_PAYMENT'

export interface Suggestion {
  readonly kind: SuggestionKind
  readonly bucket: SplitBucket
  /** Which category, goal or debt this would touch. */
  readonly targetId: string
  /** The period the suggestion is for. A deposit needs a date; a target does not. */
  readonly period: YearMonth
  /** What the plan says it should become. */
  readonly amount: Money
  /** What it is now, when it is already something. */
  readonly current: Money | undefined
  /**
   * True when the target already holds exactly this amount.
   *
   * docs/f05: applying the same plan twice to one month "diffs against what
   * already exists and only suggests the delta". Reported rather than filtered
   * so the screen can say "3 already match" instead of silently showing fewer
   * rows than the plan has buckets — a list that shrinks for unexplained
   * reasons is how a user stops trusting the count.
   */
  readonly unchanged: boolean
  /**
   * `DEBT_PAYMENT` only: this debt already gains payments without the plan.
   *
   * A merchant pattern, a category, an installment group or a payroll link —
   * `selfDiscoveringDebts` asks both sides. Accepting the row anyway is allowed
   * and sometimes right (an extra payment off a tracked mortgage is a real
   * thing), so this is carried to the panel as a sentence rather than used to
   * hide or disable anything (D-190). False for a goal: a goal that finds its
   * own money is `fedBy` instead, and that one is refused rather than warned.
   */
  readonly alsoDiscovered: boolean
  /**
   * `SAVING_DEPOSIT` only: real money already feeds this goal, so the plan writes
   * nothing for it (M28 F27). Its deposits arrive through the feed — the bank's
   * transfers filed under its category — and a planned deposit beside them is the
   * same month's money counted twice. Never in `changes`; the row says what feeds
   * it instead of offering to record anything.
   */
  readonly fedBy: GoalFeed | undefined
}

export interface ApplyPlan {
  readonly period: YearMonth
  readonly suggestions: readonly Suggestion[]
  /** The ones that would actually change something. What "Apply all" applies. */
  readonly changes: readonly Suggestion[]
}

/*
 * `notYetSupported` lived here until D-190 and is gone rather than empty.
 *
 * It held the buckets a plan described and could not write — `SAVING_GOAL`
 * until F07, then `DEBT` until schema 27 — so the screen could say what it was
 * not doing instead of quietly doing less than the plan. All three kinds that
 * name a target now write; the ones that do not (`FREE`, a fund, an account) never
 * belonged in it, because a plan is all they were ever meant to be. A field that
 * can only ever be empty is worse than no field: every caller keeps a branch for
 * a state the app cannot reach, and the next reader has to prove it is dead.
 */

/**
 * What applying this plan to a month would do — docs/f05's suggestion list.
 *
 * **Suggestions, never records.** This function returns a proposal and writes
 * nothing; the user confirms each or all, and only then does a repository run.
 * That is docs/06's confirmation-queue principle, and it is what makes the
 * automation in this app trustworthy rather than alarming.
 *
 * `currentTargets` is what each target already holds **for this period**, keyed
 * by target id: a category's monthly target, or what this plan has already
 * deposited into a goal for this month. One map because the question is one
 * question — "is this already done?" — and a second apply of the same plan then
 * produces `unchanged: true` rather than a list of no-ops, which is the "diffs
 * against what already exists" of docs/f05's edge-case table.
 *
 * **All three target kinds produce suggestions since schema 27** (D-190).
 * `DEBT` used to come back unwritten, because a plan that describes a payment
 * and silently does not make one is worse than a plan that says so; now it makes
 * one, and what it says instead is which debts the app was already going to find
 * a payment for on its own — `alsoDiscovered`, from `selfDiscoveringDebts`.
 *
 * **A goal real money already feeds is the exception, and it is refused rather
 * than warned** (M28 F27): its row comes back `fedBy` and out of `changes`, so
 * Use for the month writes nothing into it.
 */
export function applyPlan(
  result: SplitResult,
  period: YearMonth,
  currentTargets: ReadonlyMap<string, Money>,
  knownTargetIds: ReadonlySet<string>,
  /** Debts the document already discovers payments for. Empty is a fine answer. */
  selfDiscovering: ReadonlySet<string> = new Set(),
  /** Goals real money already feeds — `goalFeeds`. Empty is a fine answer. */
  feeds: ReadonlyMap<string, GoalFeed> = new Map(),
): ApplyPlan {
  const suggestions: Suggestion[] = []

  for (const entry of result.allocations) {
    const { bucket } = entry
    const kind = effectiveTargetKind(bucket, knownTargetIds)

    // FREE, a fund and an account are pure plan: nothing outside the splitter
    // reads them (D-319). A category is too: its target IS the bucket (D-327), so there is
    // nothing to copy and applying a plan writes nothing for one.
    if (
      (kind !== 'SAVING_GOAL' && kind !== 'DEBT') ||
      bucket.targetId === undefined
    ) {
      continue
    }

    const current = currentTargets.get(bucket.targetId)
    suggestions.push({
      kind: SUGGESTION_OF_TARGET[kind],
      bucket,
      targetId: bucket.targetId,
      period,
      amount: entry.amount,
      current,
      unchanged:
        current !== undefined &&
        current.minor === entry.amount.minor &&
        current.currency === entry.amount.currency,
      alsoDiscovered: kind === 'DEBT' && selfDiscovering.has(bucket.targetId),
      fedBy: kind === 'SAVING_GOAL' ? feeds.get(bucket.targetId) : undefined,
    })
  }

  return {
    period,
    suggestions,
    changes: suggestions.filter((suggestion) => !suggestion.unchanged && suggestion.fedBy === undefined),
  }
}

/**
 * The three target kinds that write something, and what each writes.
 *
 * A table rather than a chain of ternaries, because the mapping is the whole of
 * the difference and a fourth kind arriving should be a row here rather than a
 * condition someone has to find.
 */
const SUGGESTION_OF_TARGET: Readonly<Record<'SAVING_GOAL' | 'DEBT', SuggestionKind>> =
  {
    SAVING_GOAL: 'SAVING_DEPOSIT',
    DEBT: 'DEBT_PAYMENT',
  }

// --- Plan versus actual (docs/f05, "Plan vs actual") -----------------------

/**
 * Where a bucket's actual figure came from.
 *
 * Named rather than implied, because the four are not the same kind of claim and
 * a reader is owed the difference. Spending in a category is a fact about the
 * ledger; a deposit is a fact the user recorded; a fixed-expense total is the
 * app's own reconstruction. A comparison that printed all four as "actual" with
 * no provenance would be the drill-through problem D-088 solved, one layer up.
 */
export type ActualBasis =
  /** Outflow filed to the category, its subcategories rolled in. */
  | 'CATEGORY_SPEND'
  /** Contributions to the goal that month — `isContribution`, and only that (D-081). */
  | 'GOAL_DEPOSITS'
  /** Payments recorded against the debt that month. */
  | 'DEBT_PAYMENTS'

/** One bucket's actual, as the caller measured it. */
export interface BucketActual {
  readonly amount: Money
  readonly basis: ActualBasis
  /** How many rows the figure is of. Zero is a real answer: nothing happened. */
  readonly rowCount: number
}

export type VarianceVerdict =
  /** Spent, saved or paid less than the plan said. */
  | 'UNDER'
  /** More. */
  | 'OVER'
  /** To the agora. */
  | 'ON_PLAN'
  /**
   * Nothing to compare against — a `FREE` bucket, or one whose target is gone.
   * **Not zero** (D-087): "we did not measure" and "we measured nothing" are
   * different sentences and only one of them belongs in a total.
   */
  | 'NO_BASIS'

export interface VarianceLine {
  readonly bucket: SplitBucket
  readonly planned: Money
  /** Undefined only when the verdict is `NO_BASIS`. Zero otherwise is a real zero. */
  readonly actual: Money | undefined
  readonly basis: ActualBasis | undefined
  readonly rowCount: number
  /** `actual − planned`. Positive means more happened than was planned. */
  readonly variance: Money | undefined
  /** The variance as a share of the plan. Undefined when the plan said nothing. */
  readonly varianceBasisPoints: number | undefined
  readonly verdict: VarianceVerdict
}

export interface PlanVersusActual {
  readonly period: YearMonth
  /** Every bucket the plan allocates to, in the plan's order. */
  readonly lines: readonly VarianceLine[]
  /** Σ planned **over the comparable lines only**, so it matches `actual`. */
  readonly planned: Money
  readonly actual: Money
  readonly variance: Money
  /** How many lines had a basis, and how many did not. The screen says both. */
  readonly comparable: number
  readonly withoutBasis: number
}

/**
 * Planned versus actual, per bucket — docs/f05's "closes the loop", and the last
 * thing that turns the splitter from a toy into a tool.
 *
 * The actuals are **passed in, keyed by bucket id**, for the reason every other
 * function in this file takes its inputs: measuring them means four different
 * queries against four different tables, and a pure function that could reach
 * them would not be pure. What this function owns is the arithmetic and, more
 * importantly, the bookkeeping about what is comparable.
 *
 * **A missing entry is `NO_BASIS`, and it stays out of both totals.** A `FREE`
 * bucket is a plan and nothing else — there is no ledger row anywhere that could
 * confirm or deny it — and scoring it as ₪0 actual would report every plan with
 * fun money in it as massively underspent. The two figures at the top of the
 * screen are therefore sums over the same set of lines, which is the only way
 * they can be subtracted from each other honestly.
 *
 * **A zero that was measured is kept.** A category with no transactions in the
 * month really did cost nothing, and that is the most interesting line on the
 * screen — the plan set aside money and none of it went out.
 *
 * **No tolerance band.** `ON_PLAN` means equal to the agora. A "close enough"
 * threshold would be a number this app invented, and the variance column already
 * says how close.
 *
 * **The verdict is not a judgement.** `OVER` on a groceries bucket and `OVER` on
 * an emergency-fund bucket are opposite news, and nothing here knows which is
 * which; docs/11 reserves colour for a problem, and the screen draws a bar and a
 * number rather than a verdict in red.
 */
export function planVersusActual(
  result: SplitResult,
  period: YearMonth,
  actuals: ReadonlyMap<string, BucketActual>,
  currency: CurrencyCode,
): PlanVersusActual {
  const lines = result.allocations.map((entry): VarianceLine => {
    const measured = actuals.get(entry.bucket.id)
    if (measured === undefined) {
      return {
        bucket: entry.bucket,
        planned: entry.amount,
        actual: undefined,
        basis: undefined,
        rowCount: 0,
        variance: undefined,
        varianceBasisPoints: undefined,
        verdict: 'NO_BASIS',
      }
    }

    const variance = money(measured.amount.minor - entry.amount.minor, currency)
    return {
      bucket: entry.bucket,
      planned: entry.amount,
      actual: measured.amount,
      basis: measured.basis,
      rowCount: measured.rowCount,
      variance,
      varianceBasisPoints: ratioBasisPoints(variance, entry.amount),
      verdict: variance.minor === 0 ? 'ON_PLAN' : variance.minor > 0 ? 'OVER' : 'UNDER',
    }
  })

  const comparable = lines.filter((line) => line.verdict !== 'NO_BASIS')
  const planned = sum(
    comparable.map((line) => line.planned),
    currency,
  )
  const actual = sum(
    comparable.map((line) => line.actual ?? money(0, currency)),
    currency,
  )

  return {
    period,
    lines,
    planned,
    actual,
    variance: money(actual.minor - planned.minor, currency),
    comparable: comparable.length,
    withoutBasis: lines.length - comparable.length,
  }
}

/**
 * Which basis a bucket's actual would come from, or undefined for the buckets
 * that have none.
 *
 * The caller's job is the four queries; this is the one place that says which of
 * them applies, so the screen and any future reader of this comparison cannot
 * disagree about it. `effectiveTargetKind` first, so a bucket whose category was
 * deleted is `NO_BASIS` rather than a query against an id that resolves to
 * nothing.
 */
export function actualBasisFor(
  bucket: SplitBucket,
  knownTargetIds: ReadonlySet<string>,
): ActualBasis | undefined {
  switch (effectiveTargetKind(bucket, knownTargetIds)) {
    case 'CATEGORY':
      return 'CATEGORY_SPEND'
    case 'SAVING_GOAL':
      return 'GOAL_DEPOSITS'
    case 'DEBT':
      return 'DEBT_PAYMENTS'
    // A fund and an account are pointed at and not measured (D-319), and FREE
    // is the one kind with nothing behind it, by design.
    case 'FUND':
    case 'ACCOUNT':
    case 'FREE':
      return undefined
  }
}

/**
 * One allocation moved to an amount, in the terms that allocation is written in
 * (D-174).
 *
 * A bar drag produces **minor units**, because that is the only unit a
 * horizontal distance has. What an allocation holds is a percentage or an
 * amount, and which one it holds is the user's earlier decision — so a drag
 * converts into that rather than changing what kind of allocation this is. A
 * `REMAINDER` is not moved at all: it is *defined* as what is left, and setting
 * it would be setting everything else.
 *
 * **Percentages go through `redistribute`**, so a locked row cannot move
 * however far the pointer went — the same guard the row's own slider gets,
 * rather than a second answer that happens to agree today.
 *
 * Here rather than in the screen because it is arithmetic about a plan, and
 * because the preview a person watches and the value that is committed have to
 * be produced by the same function or the bar lies about where it will land.
 */
export function draggedTo(
  allocations: readonly Allocation[],
  id: string,
  minor: number,
  splittable: Money,
): readonly Allocation[] {
  const moved = allocations.find((allocation) => allocation.id === id)
  if (moved === undefined || moved.mode === 'REMAINDER') return allocations

  if (moved.mode === 'FIXED_AMOUNT') {
    return allocations.map((allocation) =>
      allocation.id === id
        ? { ...allocation, amount: money(minor, splittable.currency) }
        : allocation,
    )
  }

  // A share of nothing is not a share: with no splittable amount there is no
  // percentage a distance could mean, so the drag is refused rather than
  // dividing by zero.
  if (splittable.minor === 0) return allocations
  const basisPoints = Math.max(0, Math.round((minor / splittable.minor) * 10_000))
  return redistribute(allocations, id, basisPoints).allocations
}

/**
 * **A change flows only to the right** (M28 F7, refining D-319's neighbours
 * trading). Whatever makes bucket k a different size — a divider dragged, an
 * amount or a percentage typed — never moves a bucket to its left: the
 * difference is taken from the buckets after it, the next one first and then
 * onward when that one reaches zero, or given to the next one that can take it.
 *
 * - **A `REMAINDER` after it** is what is left, so it absorbs the rest and is
 *   not written; the walk stops there.
 * - **Locked buckets** are skipped over (they neither give nor take); a locked
 *   bucket, or a remainder, cannot itself be changed.
 * - **Past the last bucket** the free money gives, up to `room`. Dragging stops
 *   there; a typed figure (`overflow`) does not, because a plan may over-allocate
 *   while it is thought through (D-059).
 * - `value` is in the unit the bucket is written in — minor units for a fixed
 *   amount, basis points for a percentage — and is **not snapped**: a figure
 *   somebody typed keeps the precision they typed. Dragging snaps first
 *   (`tradedAt`).
 *
 * Each bucket changes in its own unit; two percentages trade basis points
 * exactly so the pair's sum is exact. `order` is the order the buckets are
 * shown in, which is what "to the right" means (the array's own order when
 * omitted).
 */
export function changedTo(
  allocations: readonly Allocation[],
  id: string,
  value: number,
  splittable: Money,
  options: { readonly room?: number; readonly overflow?: boolean; readonly order?: readonly string[] } = {},
): readonly Allocation[] {
  const left = allocations.find((each) => each.id === id)
  if (left === undefined || left.mode === 'REMAINDER' || left.isLocked) return allocations

  const currency = splittable.currency
  const percent = left.mode === 'PERCENTAGE'
  const sizeOf = (each: Allocation): number =>
    each.mode === 'FIXED_AMOUNT'
      ? (each.amount?.minor ?? 0)
      : Math.round(((each.basisPoints ?? 0) * splittable.minor) / 10_000)
  const bpOf = (minor: number): number =>
    splittable.minor === 0 ? 0 : Math.round((minor * 10_000) / splittable.minor)

  const unitBefore = percent ? (left.basisPoints ?? 0) : (left.amount?.minor ?? 0)
  const wantedUnit = Math.max(0, Math.min(Math.round(value), percent ? BASIS_POINTS_PER_WHOLE : Number.MAX_SAFE_INTEGER))
  const write = (each: Allocation, unit: number): Allocation =>
    percent ? { ...each, basisPoints: unit } : { ...each, amount: money(unit, currency) }
  if (wantedUnit === unitBefore) return allocations
  // A share of nothing has no size to trade: set it and leave the rest alone.
  if (percent && splittable.minor === 0) {
    return allocations.map((each) => (each.id === id ? write(each, wantedUnit) : each))
  }

  const beforeMinor = sizeOf(left)
  const delta = (percent ? Math.round((wantedUnit * splittable.minor) / 10_000) : wantedUnit) - beforeMinor
  const unitOfMinor = (minor: number): number => (percent ? bpOf(minor) : minor)

  const ids = options.order ?? allocations.map((each) => each.id)
  const from = ids.indexOf(id)
  const right = ids
    .slice(from + 1)
    .map((rightId) => allocations.find((each) => each.id === rightId))
    .filter((each): each is Allocation => each !== undefined && !each.isLocked)

  const changed = new Map<string, Allocation>()
  // How much of the move one neighbour carries, in its own unit; two
  // percentages carry the move itself so the pair adds up exactly.
  const shiftOf = (other: Allocation, minor: number): number =>
    other.mode === 'PERCENTAGE' && percent && Math.abs(minor) === Math.abs(delta)
      ? Math.abs(wantedUnit - unitBefore)
      : other.mode === 'PERCENTAGE'
        ? bpOf(minor)
        : minor

  let applied = delta
  if (delta > 0) {
    let need = delta
    for (const other of right) {
      if (other.mode === 'REMAINDER') {
        need = 0
        break
      }
      const take = Math.min(need, sizeOf(other))
      if (take <= 0) continue
      const kept =
        take === sizeOf(other)
          ? 0
          : other.mode === 'PERCENTAGE'
            ? Math.max(0, (other.basisPoints ?? 0) - shiftOf(other, take))
            : (other.amount?.minor ?? 0) - take
      changed.set(
        other.id,
        other.mode === 'PERCENTAGE' ? { ...other, basisPoints: kept } : { ...other, amount: money(kept, currency) },
      )
      need -= take
      if (need === 0) break
    }
    if (need > 0 && options.overflow !== true) applied = delta - Math.max(0, need - (options.room ?? 0))
  } else {
    const receiver = right[0]
    if (receiver !== undefined && receiver.mode !== 'REMAINDER') {
      const gain = -delta
      changed.set(
        receiver.id,
        receiver.mode === 'PERCENTAGE'
          ? { ...receiver, basisPoints: (receiver.basisPoints ?? 0) + shiftOf(receiver, gain) }
          : { ...receiver, amount: money((receiver.amount?.minor ?? 0) + gain, currency) },
      )
    }
  }

  const next = applied === delta ? wantedUnit : unitBefore + unitOfMinor(applied)
  if (changed.size === 0 && next === unitBefore) return allocations
  return allocations.map((each) => (each.id === id ? write(each, next) : (changed.get(each.id) ?? each)))
}

/**
 * **A bucket leaves the plan and its share goes to the bucket on its right**
 * (M28 F8, D-322) — in that bucket's own unit, by the same rule `changedTo`
 * applies. A `REMAINDER` on the right absorbs it; with nothing to take it
 * (the bucket was last, or everything to its right is locked) it falls to the
 * money not given a job. A locked bucket can still be removed: the lock keeps
 * a divider from moving it, and removing is the person's own say.
 */
export function withoutAllocation(
  allocations: readonly Allocation[],
  id: string,
  splittable: Money,
  options: { readonly order?: readonly string[] } = {},
): readonly Allocation[] {
  const leaving = allocations.find((each) => each.id === id)
  if (leaving === undefined) return allocations
  const handed =
    leaving.mode === 'REMAINDER'
      ? allocations
      : changedTo(
          allocations.map((each) => (each.id === id ? { ...each, isLocked: false } : each)),
          id,
          0,
          splittable,
          { overflow: true, ...(options.order === undefined ? {} : { order: options.order }) },
        )
  return handed.filter((each) => each.id !== id)
}

/**
 * **A divider moves bucket k, and only what is to its right gives way** (M28
 * U7, D-319; F7). The bar's and the ring's handle, pointer or arrow keys:
 * `leftMinor` is where the hand put the divider, **snapped to what the bucket
 * is written in** — a fixed amount to `snap` (₪50), a percentage to a whole
 * percent — and then `changedTo` does the rest, so a drag and a typed figure
 * are one rule with one difference, the snapping.
 *
 * A locked bucket, or a `REMAINDER` (it has no size of its own to move),
 * refuses. The same guard `redistribute` applies: a bar must not be the way
 * round it.
 */
export function tradedAt(
  allocations: readonly Allocation[],
  leftId: string,
  leftMinor: number,
  splittable: Money,
  options: { readonly snap?: number; readonly room: number; readonly order?: readonly string[] },
): readonly Allocation[] {
  const left = allocations.find((each) => each.id === leftId)
  if (left === undefined) return allocations
  if (left.mode === 'PERCENTAGE') {
    if (splittable.minor <= 0) return allocations
    const percent = Math.round((Math.max(0, leftMinor) / splittable.minor) * 100)
    return changedTo(allocations, leftId, percent * 100, splittable, options)
  }
  const snap = options.snap ?? 1
  return changedTo(allocations, leftId, Math.round(Math.max(0, leftMinor) / snap) * snap, splittable, options)
}

/**
 * One allocation halved, with the other half given to a new bucket (D-174).
 *
 * *"Split a slice into a new bucket"* — the second half of making the bar a
 * control. **The plan's total does not move**, which is the property that makes
 * "split" the right word: whatever the slice was, the two halves come to it,
 * and a plan that summed to 97% before still sums to 97% after.
 *
 * The remainder is left alone for `draggedTo`'s reason: it is what is left, so
 * halving it would be halving everything else.
 *
 * The odd agora — or the odd basis point — goes to the **new** bucket, which is
 * arbitrary and worth stating so nobody has to work out whether it was.
 *
 * The new allocation is returned **beside** the one it came out of. Where its
 * row then *appears* is the bucket's own sort order, which puts a newly created
 * bucket last exactly as it does for every other way of adding one — the list
 * on this screen is ordered by bucket, not by allocation, and this is not the
 * function to make an exception in.
 */
export function splitAllocation(
  allocations: readonly Allocation[],
  id: string,
  newAllocation: { readonly id: string; readonly bucketId: string },
): readonly Allocation[] {
  const source = allocations.find((allocation) => allocation.id === id)
  if (source === undefined || source.mode === 'REMAINDER') return allocations

  const half =
    source.mode === 'FIXED_AMOUNT'
      ? Math.floor((source.amount?.minor ?? 0) / 2)
      : Math.floor((source.basisPoints ?? 0) / 2)
  const whole =
    source.mode === 'FIXED_AMOUNT' ? (source.amount?.minor ?? 0) : (source.basisPoints ?? 0)

  const kept: Allocation =
    source.mode === 'FIXED_AMOUNT'
      ? { ...source, amount: money(half, source.amount?.currency ?? 'ILS') }
      : { ...source, basisPoints: half }

  const made: Allocation = {
    ...source,
    id: newAllocation.id,
    bucketId: newAllocation.bucketId,
    isLocked: false,
    ...(source.mode === 'FIXED_AMOUNT'
      ? { amount: money(whole - half, source.amount?.currency ?? 'ILS') }
      : { basisPoints: whole - half }),
  }

  const out: Allocation[] = []
  for (const allocation of allocations) {
    if (allocation.id !== id) {
      out.push(allocation)
      continue
    }
    out.push(kept, made)
  }
  return out
}

/**
 * How many whole months a goal needs at the rate a bucket gives it (M28 U7,
 * S4): `reached` when nothing is left, nothing when the bucket gives it
 * nothing. A rate is not a forecast — it is what the plan says, held still.
 */
export function monthsToReach(remaining: Money, monthly: Money): number | 'reached' | undefined {
  if (remaining.minor <= 0) return 'reached'
  if (monthly.minor <= 0) return undefined
  return Math.ceil(remaining.minor / monthly.minor)
}
