import { describe, expect, it } from 'vitest'

import { money, sum } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import type { Allocation, SplitBucket, SplitPlan } from '@/domain/model/plan.ts'
import type { Paycheck } from '@/domain/model/paycheck.ts'
import {
  actualBasisFor,
  applyPlan,
  draggedTo,
  splitAllocation,
  effectiveTargetKind,
  orphanedBuckets,
  planVersusActual,
  redistribute,
  resolveBasis,
  splitPlan,
  monthsToReach,
  changedTo,
  tradedAt,
  withoutAllocation,
  type SplitResult,
} from './splitter.ts'

const ILS = 'ILS'
const NET = money(1_950_000, ILS)

/** What every bucket got, added up: the figure the balance is the complement of. */
const assignedTotal = (result: SplitResult, currency: string) =>
  sum(result.allocations.map((entry) => entry.amount), currency)
const none = { netOff: money(0, ILS), inSplit: money(0, ILS) }
const off = (minor: number) => ({ netOff: money(minor, ILS), inSplit: money(0, ILS) })
const inside = (minor: number) => ({ netOff: money(0, ILS), inSplit: money(minor, ILS) })

function plan(overrides?: Partial<SplitPlan>): SplitPlan {
  return {
    id: 'plan',
    name: 'Default',
    basisKind: 'LAST_PAYCHECK',
    basisPaycheckId: undefined,
    basisMonths: undefined,
    customAmount: undefined,
    currency: ILS,
    isDefault: true,
    ...overrides,
  }
}

function bucket(id: string, sortOrder: number, overrides?: Partial<SplitBucket>): SplitBucket {
  return {
    id,
    name: id,
    targetKind: 'FREE',
    targetId: undefined,
    color: undefined,
    sortOrder,
    isBuffer: false,
    ...overrides,
  }
}

function allocation(
  id: string,
  bucketId: string,
  overrides?: Partial<Allocation>,
): Allocation {
  return {
    id,
    planId: 'plan',
    bucketId,
    mode: 'PERCENTAGE',
    basisPoints: 0,
    amount: undefined,
    isLocked: false,
    ...overrides,
  }
}

/** 50/30/20 — docs/f05's own suggested starting template. */
function fiftyThirtyTwenty() {
  const buckets = [bucket('needs', 10), bucket('wants', 20), bucket('saving', 30)]
  const allocations = [
    allocation('a1', 'needs', { basisPoints: 5000 }),
    allocation('a2', 'wants', { basisPoints: 3000 }),
    allocation('a3', 'saving', { basisPoints: 2000 }),
  ]
  return { buckets, allocations }
}

describe('splitPlan', () => {
  it('splits a net paycheck by percentage, exactly', () => {
    const { buckets, allocations } = fiftyThirtyTwenty()
    const result = splitPlan(plan(), buckets, allocations, NET, none)

    expect(result.allocations.map((entry) => entry.amount)).toEqual([
      money(975_000, ILS),
      money(585_000, ILS),
      money(390_000, ILS),
    ])
    expect(result.balance).toEqual(money(0, ILS))
    expect(result.status).toBe('EXACT')
    expect(assignedTotal(result, ILS)).toEqual(NET)
  })

  it('lands on the whole amount even when the thirds do not divide', () => {
    // ₪1,000.01 in three equal shares. Rounded independently this is ₪1,000.02
    // or ₪999.99; largest-remainder makes it the figure that was split.
    const buckets = [bucket('a', 10), bucket('b', 20), bucket('c', 30)]
    const allocations = [
      allocation('a1', 'a', { basisPoints: 3333 }),
      allocation('a2', 'b', { basisPoints: 3333 }),
      allocation('a3', 'c', { basisPoints: 3334 }),
    ]

    const result = splitPlan(plan(), buckets, allocations, money(100_001, ILS), none)
    expect(assignedTotal(result, ILS)).toEqual(money(100_001, ILS))
    expect(result.status).toBe('EXACT')
  })

  it('takes fixed expenses off the top, and only when the mode says to', () => {
    const { buckets, allocations } = fiftyThirtyTwenty()
    const fixed = money(550_000, ILS)

    const noFixed = splitPlan(plan(), buckets, allocations, NET, none)
    expect(noFixed.splittable).toEqual(NET)
    expect(noFixed.fixedExpenses).toEqual(money(0, ILS))

    const on = splitPlan(plan(), buckets, allocations, NET, off(fixed.minor))
    expect(on.splittable).toEqual(money(1_400_000, ILS))
    expect(on.allocations[0]?.amount).toEqual(money(700_000, ILS))
    expect(assignedTotal(on, ILS)).toEqual(money(1_400_000, ILS))
  })

  it('applies percentages to the splittable amount, not to what the fixed amounts left', () => {
    // The deliberate choice in docs/05 step 4: ₪5,000 of rent as a fixed amount
    // must not make the 50% bucket mean 50% of what is left.
    const buckets = [bucket('rent', 10), bucket('needs', 20)]
    const allocations = [
      allocation('a1', 'rent', { mode: 'FIXED_AMOUNT', amount: money(500_000, ILS) }),
      allocation('a2', 'needs', { basisPoints: 5000 }),
    ]

    const result = splitPlan(plan(), buckets, allocations, NET, none)
    expect(result.allocations[1]?.amount).toEqual(money(975_000, ILS))
    // ₪19,500 − ₪5,000 − ₪9,750.
    expect(result.balance).toEqual(money(475_000, ILS))
    expect(result.status).toBe('UNALLOCATED')
  })

  it('gives a remainder allocation whatever is left', () => {
    const buckets = [bucket('needs', 10), bucket('fun', 20)]
    const allocations = [
      allocation('a1', 'needs', { basisPoints: 6000 }),
      allocation('a2', 'fun', { mode: 'REMAINDER' }),
    ]

    const result = splitPlan(plan(), buckets, allocations, NET, none)
    expect(result.allocations[1]?.amount).toEqual(money(780_000, ILS))
    expect(result.balance).toEqual(money(0, ILS))
    expect(result.status).toBe('EXACT')
  })

  it('reports over-allocation as over-allocation even when a remainder hides the balance', () => {
    // 130% assigned. The remainder bucket goes negative, the balance is zero,
    // and the status must still say what happened — this is the case a naive
    // "balance === 0 means exact" reading gets wrong.
    const buckets = [bucket('needs', 10), bucket('fun', 20)]
    const allocations = [
      allocation('a1', 'needs', { basisPoints: 13_000 }),
      allocation('a2', 'fun', { mode: 'REMAINDER' }),
    ]

    const result = splitPlan(plan(), buckets, allocations, NET, none)
    expect(result.allocations[1]?.amount).toEqual(money(-585_000, ILS))
    expect(result.balance).toEqual(money(0, ILS))
    expect(result.status).toBe('OVER_ALLOCATED')
  })

  it('allows a plan that spends more than it has — a drawdown, not an error', () => {
    const buckets = [bucket('needs', 10)]
    const allocations = [allocation('a1', 'needs', { basisPoints: 12_000 })]

    const result = splitPlan(plan(), buckets, allocations, NET, none)
    expect(result.allocations[0]?.amount).toEqual(money(2_340_000, ILS))
    expect(result.balance).toEqual(money(-390_000, ILS))
    expect(result.status).toBe('OVER_ALLOCATED')
  })

  it('shows a negative splittable amount rather than clamping it to zero', () => {
    const { buckets, allocations } = fiftyThirtyTwenty()
    const result = splitPlan(
      plan(),
      buckets,
      allocations,
      money(500_000, ILS),
      off(800_000),
    )

    expect(result.splittable).toEqual(money(-300_000, ILS))
    // The percentages still divide it, and still exactly. Dividing nothing
    // exactly is exact — there is nothing over-allocated about having no money.
    expect(assignedTotal(result, ILS)).toEqual(money(-300_000, ILS))
    expect(result.status).toBe('EXACT')
  })

  it('reads a remainder against the direction the splittable amount points', () => {
    const buckets = [bucket('needs', 10), bucket('fun', 20)]
    const withRemainder = (basisPoints: number) => [
      allocation('a1', 'needs', { basisPoints }),
      allocation('a2', 'fun', { mode: 'REMAINDER' }),
    ]

    // Nothing to split and half of it claimed: the remainder points the same
    // way, so the plan is coherent rather than over-committed.
    const short = splitPlan(
      plan(),
      buckets,
      withRemainder(5000),
      money(500_000, ILS),
      off(800_000),
    )
    expect(short.allocations[1]?.amount).toEqual(money(-150_000, ILS))
    expect(short.status).toBe('EXACT')

    // 150% of it claimed: the remainder now points the other way, which is the
    // shortfall no bucket can conjure.
    const over = splitPlan(
      plan(),
      buckets,
      withRemainder(15_000),
      money(500_000, ILS),
      off(800_000),
    )
    expect(over.allocations[1]?.amount).toEqual(money(150_000, ILS))
    expect(over.status).toBe('OVER_ALLOCATED')
  })

  it('sends the rounding agora to the buffer bucket instead of the first one', () => {
    // Three equal thirds of ₪1,000.01. Each floors to ₪333.30 and one agora is
    // left over; without a buffer the tie-break hands it to the first bucket.
    const allocations = [
      allocation('a1', 'a', { basisPoints: 3333 }),
      allocation('a2', 'b', { basisPoints: 3333 }),
      allocation('a3', 'fun', { basisPoints: 3333 }),
    ]
    const basis = money(100_001, ILS)

    const spread = splitPlan(
      plan(),
      [bucket('a', 10), bucket('b', 20), bucket('fun', 30)],
      allocations,
      basis,
      none,
    )
    expect(spread.allocations.map((entry) => entry.amount.minor)).toEqual([33_331, 33_330, 33_330])

    const buffered = splitPlan(
      plan(),
      [bucket('a', 10), bucket('b', 20), bucket('fun', 30, { isBuffer: true })],
      allocations,
      basis,
      none,
    )
    expect(buffered.allocations.map((entry) => entry.amount.minor)).toEqual([
      33_330, 33_330, 33_331,
    ])

    // Same total either way — the buffer moves an agora, it does not make one.
    expect(assignedTotal(buffered, ILS)).toEqual(assignedTotal(spread, ILS))
    // 99.99% of the basis is allocated, so ten agorot are genuinely unassigned.
    expect(buffered.balance).toEqual(money(10, ILS))
    expect(buffered.status).toBe('UNALLOCATED')
  })

  it('reads allocations in bucket order, whatever order they arrive in', () => {
    const buckets = [bucket('third', 30), bucket('first', 10), bucket('second', 20)]
    const allocations = [
      allocation('a1', 'third', { basisPoints: 1000 }),
      allocation('a2', 'first', { basisPoints: 1000 }),
      allocation('a3', 'second', { basisPoints: 1000 }),
    ]

    const result = splitPlan(plan(), buckets, allocations, NET, none)
    expect(result.allocations.map((entry) => entry.bucket.id)).toEqual([
      'first',
      'second',
      'third',
    ])
  })

  it('ignores an allocation whose bucket is not in the document', () => {
    const buckets = [bucket('needs', 10)]
    const allocations = [
      allocation('a1', 'needs', { basisPoints: 5000 }),
      allocation('a2', 'deleted', { basisPoints: 5000 }),
    ]

    const result = splitPlan(plan(), buckets, allocations, NET, none)
    expect(result.allocations).toHaveLength(1)
    expect(result.balance).toEqual(money(975_000, ILS))
  })

  it('has an answer for an empty plan', () => {
    const result = splitPlan(plan(), [], [], NET, none)
    expect(result.allocations).toEqual([])
    expect(result.balance).toEqual(NET)
    expect(result.status).toBe('UNALLOCATED')
  })

  it('reports each bucket its share of the splittable amount', () => {
    const { buckets, allocations } = fiftyThirtyTwenty()
    const result = splitPlan(plan(), buckets, allocations, NET, none)

    expect(result.allocations.map((entry) => entry.shareBasisPoints)).toEqual([5000, 3000, 2000])
  })
})

describe('resolveBasis', () => {
  function paycheck(id: string, month: number, net: number, isIrregular = false): Paycheck {
    return {
      id,
      period: { year: 2026, month },
      paymentDate: localDate(2026, month, 9),
      employerName: 'Acme',
      gross: money(net + 550_000, ILS),
      net: money(net, ILS),
      depositedToAccountId: undefined,
      note: undefined,
      sourceKind: 'MANUAL',
      attachmentRef: undefined,
      isIrregular,
    }
  }

  const history = [
    paycheck('p1', 4, 1_900_000),
    paycheck('p2', 5, 2_000_000),
    paycheck('p3', 6, 1_950_000),
  ]

  it('takes the newest slip for LAST_PAYCHECK, whatever order they arrive in', () => {
    const result = resolveBasis(plan({ basisKind: 'LAST_PAYCHECK' }), [...history].reverse())
    expect(result.amount).toEqual(money(1_950_000, ILS))
    expect(result.sampleSize).toBe(1)
    expect(result.unavailable).toBe(false)
  })

  it('averages the last N, and says how many that was', () => {
    const result = resolveBasis(
      plan({ basisKind: 'AVERAGE_LAST_N', basisMonths: 3 }),
      history,
    )
    expect(result.amount).toEqual(money(1_950_000, ILS))
    expect(result.sampleSize).toBe(3)
  })

  it('leaves a bonus month out of the average and says so', () => {
    const withBonus = [...history, paycheck('p4', 7, 4_000_000, true)]
    const result = resolveBasis(
      plan({ basisKind: 'AVERAGE_LAST_N', basisMonths: 4 }),
      withBonus,
    )

    expect(result.sampleSize).toBe(3)
    expect(result.excluded).toBe(1)
    expect(result.amount).toEqual(money(1_950_000, ILS))
  })

  it('takes the one that was picked for SPECIFIC_PAYCHECK', () => {
    const result = resolveBasis(
      plan({ basisKind: 'SPECIFIC_PAYCHECK', basisPaycheckId: 'p1' }),
      history,
    )
    expect(result.amount).toEqual(money(1_900_000, ILS))
  })

  it('reports a missing paycheck rather than quietly splitting zero', () => {
    // docs/f05: with no paycheck the basis falls back to a typed amount *with a
    // prompt*. A plan built on a zero nobody typed is worse than an empty screen.
    for (const kind of ['LAST_PAYCHECK', 'AVERAGE_LAST_N', 'SPECIFIC_PAYCHECK'] as const) {
      const result = resolveBasis(plan({ basisKind: kind }), [])
      expect(result.unavailable).toBe(true)
      expect(result.amount).toEqual(money(0, ILS))
    }

    expect(
      resolveBasis(plan({ basisKind: 'SPECIFIC_PAYCHECK', basisPaycheckId: 'gone' }), history)
        .unavailable,
    ).toBe(true)
  })

  it('with no payslip, takes the salary that came in, and says so (M31 U3)', () => {
    const landed = [
      { period: { year: 2026, month: 5 }, amount: money(1_800_000, ILS) },
      { period: { year: 2026, month: 7 }, amount: money(2_100_000, ILS) },
      { period: { year: 2026, month: 6 }, amount: money(2_000_000, ILS) },
    ]
    const last = resolveBasis(plan({ basisKind: 'LAST_PAYCHECK' }), [], landed)
    expect(last).toMatchObject({ amount: money(2_100_000, ILS), unavailable: false, sampleSize: 0 })
    expect(last.fromSalary).toEqual({ months: 1, newest: { year: 2026, month: 7 } })

    const average = resolveBasis(plan({ basisKind: 'AVERAGE_LAST_N', basisMonths: 2 }), [], landed)
    expect(average.amount).toEqual(money(2_050_000, ILS))
    expect(average.fromSalary).toEqual({ months: 2, newest: { year: 2026, month: 7 } })

    // A slip wins whenever there is one, and a picked slip that is gone stays missing.
    expect(resolveBasis(plan({ basisKind: 'LAST_PAYCHECK' }), history, landed).fromSalary).toBeUndefined()
    expect(resolveBasis(plan({ basisKind: 'SPECIFIC_PAYCHECK', basisPaycheckId: 'gone' }), [], landed).unavailable).toBe(true)
  })

  it('takes a typed amount at face value, and never calls it unavailable', () => {
    const result = resolveBasis(
      plan({ basisKind: 'CUSTOM_AMOUNT', customAmount: money(2_500_000, ILS) }),
      [],
    )
    expect(result.amount).toEqual(money(2_500_000, ILS))
    expect(result.unavailable).toBe(false)
    // A plan that has not had a number typed into it yet is zero, not missing.
    expect(resolveBasis(plan({ basisKind: 'CUSTOM_AMOUNT' }), []).amount).toEqual(money(0, ILS))
  })
})

describe('redistribute', () => {
  const three = [
    allocation('a1', 'needs', { basisPoints: 5000 }),
    allocation('a2', 'wants', { basisPoints: 3000 }),
    allocation('a3', 'saving', { basisPoints: 2000 }),
  ]

  const pointsOf = (allocations: readonly Allocation[]): readonly number[] =>
    allocations.map((allocation) => allocation.basisPoints ?? 0)

  it('takes what it gives from the other unlocked percentages, proportionally', () => {
    const result = redistribute(three, 'a1', 6000)

    expect(result.appliedBasisPoints).toBe(6000)
    expect(result.clamped).toBe(false)
    // The other 5,000 basis points become 4,000, split 3:2 as they already were.
    expect(pointsOf(result.allocations)).toEqual([6000, 2400, 1600])
    // And the sum of the unlocked set is conserved.
    expect(pointsOf(result.allocations).reduce((a, b) => a + b, 0)).toBe(10_000)
  })

  it('never moves a locked allocation — F05 acceptance criterion', () => {
    const locked = [
      three[0]!,
      { ...three[1]!, isLocked: true },
      { ...three[2]!, isLocked: true },
    ]

    const result = redistribute(locked, 'a1', 1000)
    expect(pointsOf(result.allocations)).toEqual([1000, 3000, 2000])
    // Lowering the dragged one frees points that nothing else may take, so the
    // plan's total falls. That is correct: nothing else was allowed to move.
    expect(result.clamped).toBe(false)
  })

  it('over-allocates rather than refusing, when there is nothing left to take from', () => {
    const locked = [
      three[0]!,
      { ...three[1]!, isLocked: true },
      { ...three[2]!, isLocked: true },
    ]

    // Nothing unlocked to trade with. The drag still moves and the plan goes
    // over 100%, which the balance strip reports as a drawdown — clamping here
    // would make the current total a ceiling nobody could raise (D-059).
    const result = redistribute(locked, 'a1', 9000)
    expect(result.appliedBasisPoints).toBe(9000)
    expect(result.clamped).toBe(false)
    expect(pointsOf(result.allocations)).toEqual([9000, 3000, 2000])
  })

  it('lets a plan that adds up to less than 100% grow past its own total', () => {
    // The bug this rule exists for: three buckets summing to 49% used to leave
    // every one of them unable to pass 49, with nothing on screen saying why.
    const small = [
      allocation('a1', 'needs', { basisPoints: 4000 }),
      allocation('a2', 'wants', { basisPoints: 600 }),
      allocation('a3', 'saving', { basisPoints: 300 }),
    ]

    const result = redistribute(small, 'a1', 8000)
    expect(result.appliedBasisPoints).toBe(8000)
    expect(result.clamped).toBe(false)
    // The others gave everything they had, and the total rose from 49% to 80%.
    expect(pointsOf(result.allocations)).toEqual([8000, 0, 0])
  })

  it('still stops at a whole paycheck for one bucket', () => {
    const result = redistribute(three, 'a1', 15_000)
    expect(result.appliedBasisPoints).toBe(10_000)
    expect(result.clamped).toBe(true)
  })

  it('clamps at zero rather than going negative', () => {
    const result = redistribute(three, 'a1', -2000)
    expect(result.appliedBasisPoints).toBe(0)
    expect(result.clamped).toBe(true)
    expect(pointsOf(result.allocations)).toEqual([0, 6000, 4000])
  })

  it('leaves fixed amounts and remainders out of the trade entirely', () => {
    const mixed = [
      allocation('a1', 'needs', { basisPoints: 5000 }),
      allocation('a2', 'rent', { mode: 'FIXED_AMOUNT', amount: money(500_000, ILS) }),
      allocation('a3', 'fun', { mode: 'REMAINDER' }),
      allocation('a4', 'saving', { basisPoints: 2000 }),
    ]

    const result = redistribute(mixed, 'a1', 6000)
    expect(pointsOf(result.allocations)).toEqual([6000, 0, 0, 1000])
    expect(result.allocations[1]?.amount).toEqual(money(500_000, ILS))
    expect(result.allocations[2]?.mode).toBe('REMAINDER')
  })

  it('refuses to drag a locked slider, and changes nothing when it is asked to', () => {
    const locked = [{ ...three[0]!, isLocked: true }, three[1]!, three[2]!]
    const result = redistribute(locked, 'a1', 9000)

    expect(result.allocations).toEqual(locked)
    expect(result.appliedBasisPoints).toBe(5000)
    expect(result.clamped).toBe(true)
  })

  it('does nothing about an allocation that is not there', () => {
    const result = redistribute(three, 'nope', 5000)
    expect(result.allocations).toEqual(three)
    expect(result.clamped).toBe(false)
  })

  it('gives the freed points somewhere to go when the others are all at zero', () => {
    const zeroed = [
      allocation('a1', 'needs', { basisPoints: 10_000 }),
      allocation('a2', 'wants', { basisPoints: 0 }),
      allocation('a3', 'saving', { basisPoints: 0 }),
    ]

    const result = redistribute(zeroed, 'a1', 5000)
    expect(pointsOf(result.allocations)).toEqual([5000, 2500, 2500])
  })
})

describe('orphaned buckets', () => {
  const known = new Set(['cat:groceries', 'fund:1'])

  it('finds the buckets whose target has gone', () => {
    const buckets = [
      bucket('a', 10, { targetKind: 'CATEGORY', targetId: 'cat:groceries' }),
      bucket('b', 20, { targetKind: 'CATEGORY', targetId: 'cat:deleted' }),
      bucket('c', 30, { targetKind: 'FREE' }),
      bucket('d', 40, { targetKind: 'FUND', targetId: 'fund:1' }),
      bucket('e', 50, { targetKind: 'SAVING_GOAL', targetId: undefined }),
    ]

    expect(orphanedBuckets(buckets, known).map((one) => one.id)).toEqual(['b', 'e'])
  })

  it('reads an orphan as FREE without rewriting it', () => {
    const gone = bucket('b', 20, { targetKind: 'CATEGORY', targetId: 'cat:deleted' })
    expect(effectiveTargetKind(gone, known)).toBe('FREE')
    // The stored row is untouched, so restoring the category restores the bucket.
    expect(gone.targetKind).toBe('CATEGORY')

    const live = bucket('a', 10, { targetKind: 'CATEGORY', targetId: 'cat:groceries' })
    expect(effectiveTargetKind(live, known)).toBe('CATEGORY')
  })

  it('still splits money for an orphaned bucket', () => {
    const buckets = [bucket('b', 10, { targetKind: 'CATEGORY', targetId: 'cat:deleted' })]
    const result = splitPlan(
      plan(),
      buckets,
      [allocation('a1', 'b', { basisPoints: 10_000 })],
      NET,
      none,
    )

    expect(result.allocations[0]?.amount).toEqual(NET)
    expect(result.status).toBe('EXACT')
  })
})

describe('applyPlan', () => {
  const period = { year: 2026, month: 7 }
  const known = new Set(['cat:groceries', 'cat:fun'])

  function planOver(buckets: readonly SplitBucket[]) {
    const allocations = buckets.map((bucket, index) =>
      allocation(`a${index}`, bucket.id, { basisPoints: 10_000 / buckets.length }),
    )
    return splitPlan(plan(), buckets, allocations, NET, none)
  }

  it('says nothing about a category bucket: its target is the bucket (D-327)', () => {
    const result = planOver([
      bucket('a', 10, { name: 'Groceries', targetKind: 'CATEGORY', targetId: 'cat:groceries' }),
      bucket('b', 20, { name: 'Fun', targetKind: 'CATEGORY', targetId: 'cat:fun' }),
    ])

    const applied = applyPlan(result, period, new Map(), known)
    expect(applied.suggestions).toEqual([])
  })

  it('says nothing about buckets that point nowhere', () => {
    const result = planOver([
      bucket('a', 10, { targetKind: 'FREE' }),
      bucket('b', 20, { targetKind: 'ACCOUNT', targetId: 'acct:1' }),
    ])

    const applied = applyPlan(result, period, new Map(), known)
    expect(applied.suggestions).toEqual([])
  })

  it('proposes a deposit for a goal and a payment for a debt', () => {
    const result = planOver([
      bucket('a', 10, { name: 'Emergency', targetKind: 'SAVING_GOAL', targetId: 'goal:1' }),
      bucket('b', 20, { name: 'Car loan', targetKind: 'DEBT', targetId: 'debt:1' }),
    ])

    const applied = applyPlan(result, period, new Map(), new Set(['goal:1', 'debt:1']))

    expect(applied.suggestions.map((one) => one.kind)).toEqual([
      'SAVING_DEPOSIT',
      'DEBT_PAYMENT',
    ])
    expect(applied.suggestions[0]?.targetId).toBe('goal:1')
    expect(applied.suggestions[1]?.targetId).toBe('debt:1')
    expect(applied.suggestions[1]?.period).toEqual(period)
    // Nothing said this debt is tracked, so nothing warns about it.
    expect(applied.suggestions[1]?.alsoDiscovered).toBe(false)
  })

  it('marks a debt payment the app would also have discovered, and still offers it', () => {
    const result = planOver([
      bucket('b', 20, { name: 'Mortgage', targetKind: 'DEBT', targetId: 'debt:1' }),
    ])

    const applied = applyPlan(
      result,
      period,
      new Map(),
      new Set(['debt:1']),
      new Set(['debt:1']),
    )

    // A warning, never a refusal: an extra payment off a tracked mortgage is a
    // real thing, and the app cannot tell it from the double (D-190).
    expect(applied.suggestions[0]?.alsoDiscovered).toBe(true)
    expect(applied.changes).toHaveLength(1)
  })

  it('never marks a goal or a category, whatever the debt set says', () => {
    const result = planOver([
      bucket('a', 10, { name: 'Emergency', targetKind: 'SAVING_GOAL', targetId: 'goal:1' }),
      bucket('c', 30, { name: 'Groceries', targetKind: 'CATEGORY', targetId: 'cat:groceries' }),
    ])

    const applied = applyPlan(
      result,
      period,
      new Map(),
      new Set(['goal:1', 'cat:groceries']),
      new Set(['goal:1', 'cat:groceries']),
    )

    expect(applied.suggestions.map((one) => one.alsoDiscovered)).toEqual([false])
  })

  it('writes nothing into a goal real money already feeds, and says what feeds it (M28 F27)', () => {
    const result = planOver([
      bucket('a', 10, { name: 'Holiday', targetKind: 'SAVING_GOAL', targetId: 'goal:fed' }),
      bucket('b', 20, { name: 'Laptop', targetKind: 'SAVING_GOAL', targetId: 'goal:plain' }),
    ])
    const feed = { kind: 'CATEGORY', id: 'cat:to-holiday', name: 'To holiday' } as const

    const applied = applyPlan(
      result,
      period,
      new Map(),
      new Set(['goal:fed', 'goal:plain']),
      new Set(),
      new Map([['goal:fed', feed]]),
    )

    // Shown, never hidden: the row is there and says what feeds it.
    expect(applied.suggestions.map((one) => [one.targetId, one.fedBy])).toEqual([
      ['goal:fed', feed],
      ['goal:plain', undefined],
    ])
    expect(applied.changes.map((one) => one.targetId)).toEqual(['goal:plain'])
  })

  it('diffs a payment this plan already made for the month', () => {
    const result = planOver([
      bucket('b', 20, { name: 'Car loan', targetKind: 'DEBT', targetId: 'debt:1' }),
    ])
    const already = applyPlan(result, period, new Map(), new Set(['debt:1']))
    const amount = already.suggestions[0]?.amount
    if (amount === undefined) throw new Error('no suggestion')

    const again = applyPlan(
      result,
      period,
      new Map([['debt:1', amount]]),
      new Set(['debt:1']),
    )

    expect(again.suggestions).toHaveLength(1)
    expect(again.suggestions[0]?.unchanged).toBe(true)
    expect(again.changes).toEqual([])
  })

  it('diffs a deposit this plan already made for the month', () => {
    const result = planOver([
      bucket('a', 10, { name: 'Emergency', targetKind: 'SAVING_GOAL', targetId: 'goal:1' }),
    ])
    const already = applyPlan(result, period, new Map(), new Set(['goal:1']))
    const amount = already.suggestions[0]?.amount

    const again = applyPlan(
      result,
      period,
      new Map([['goal:1', amount ?? money(0, ILS)]]),
      new Set(['goal:1']),
    )

    expect(again.suggestions[0]?.unchanged).toBe(true)
    expect(again.changes).toEqual([])
  })

  it('treats a bucket whose category is gone as pointing nowhere', () => {
    const result = planOver([
      bucket('a', 10, { targetKind: 'CATEGORY', targetId: 'cat:deleted' }),
    ])

    // `effectiveTargetKind` reads it as FREE, so applying does nothing to it —
    // the plan still splits money, it just no longer has anywhere to put it.
    expect(applyPlan(result, period, new Map(), known).suggestions).toEqual([])
  })

  it('carries the month it is about', () => {
    expect(applyPlan(planOver([]), period, new Map(), known).period).toEqual(period)
  })
})

describe('actualBasisFor', () => {
  const known = new Set(['cat:groceries', 'goal:house', 'debt:car'])

  it('names one basis per kind, and none for the kind with nothing behind it', () => {
    const basisOf = (overrides: Partial<SplitBucket>) =>
      actualBasisFor(bucket('b', 10, overrides), known)

    expect(basisOf({ targetKind: 'CATEGORY', targetId: 'cat:groceries' })).toBe('CATEGORY_SPEND')
    expect(basisOf({ targetKind: 'SAVING_GOAL', targetId: 'goal:house' })).toBe('GOAL_DEPOSITS')
    expect(basisOf({ targetKind: 'DEBT', targetId: 'debt:car' })).toBe('DEBT_PAYMENTS')
    // A fund and an account are pointed at and not measured (D-319).
    expect(basisOf({ targetKind: 'FUND', targetId: 'fund:1' })).toBeUndefined()
    expect(basisOf({ targetKind: 'ACCOUNT', targetId: 'acct:1' })).toBeUndefined()
    expect(basisOf({ targetKind: 'FREE' })).toBeUndefined()
  })

  it('has nothing to measure once the target is gone', () => {
    // Not 'CATEGORY_SPEND against an id that resolves to nothing', which would
    // measure zero and report the plan as perfectly underspent.
    expect(actualBasisFor(bucket('b', 10, { targetKind: 'CATEGORY', targetId: 'cat:deleted' }), known)).toBeUndefined()
  })
})

describe('planVersusActual', () => {
  const period = { year: 2026, month: 7 }

  /** Three equal buckets of the same net, so every planned figure is ₪6,500. */
  function threeWays(overrides: readonly Partial<SplitBucket>[]) {
    const buckets = overrides.map((one, index) => bucket(`b${index}`, index * 10, one))
    const allocations = buckets.map((one, index) =>
      allocation(`a${index}`, one.id, { basisPoints: 3333 }),
    )
    return splitPlan(plan(), buckets, allocations, money(1_950_000, ILS), none)
  }

  const spend = (minor: number, rowCount = 1) =>
    ({ amount: money(minor, ILS), basis: 'CATEGORY_SPEND', rowCount }) as const

  it('subtracts the plan from what happened, per bucket', () => {
    const result = threeWays([
      { name: 'Groceries', targetKind: 'CATEGORY', targetId: 'cat:groceries' },
      { name: 'Fun', targetKind: 'CATEGORY', targetId: 'cat:fun' },
      { name: 'Rent', targetKind: 'CATEGORY', targetId: 'cat:rent' },
    ])
    const planned = result.allocations[0]?.amount.minor ?? 0

    const comparison = planVersusActual(
      result,
      period,
      new Map([
        ['b0', spend(planned - 20_000)],
        ['b1', spend(planned + 5_000)],
        ['b2', spend(planned)],
      ]),
      ILS,
    )

    expect(comparison.lines.map((line) => line.verdict)).toEqual(['UNDER', 'OVER', 'ON_PLAN'])
    expect(comparison.lines[0]?.variance).toEqual(money(-20_000, ILS))
    expect(comparison.lines[1]?.variance).toEqual(money(5_000, ILS))
    expect(comparison.lines[2]?.variance).toEqual(money(0, ILS))
  })

  it('keeps a measured zero, which is the most interesting line on the screen', () => {
    const result = threeWays([{ targetKind: 'CATEGORY', targetId: 'cat:groceries' }])
    const comparison = planVersusActual(result, period, new Map([['b0', spend(0, 0)]]), ILS)

    const line = comparison.lines[0]
    expect(line?.actual).toEqual(money(0, ILS))
    expect(line?.verdict).toBe('UNDER')
    expect(line?.rowCount).toBe(0)
    // Measured, so it counts: the plan set money aside and none of it went out.
    expect(comparison.comparable).toBe(1)
  })

  it('keeps an unmeasurable bucket out of both totals rather than scoring it zero', () => {
    const result = threeWays([
      { name: 'Groceries', targetKind: 'CATEGORY', targetId: 'cat:groceries' },
      { name: 'Fun money', targetKind: 'FREE' },
    ])
    const planned = result.allocations[0]?.amount.minor ?? 0

    const comparison = planVersusActual(result, period, new Map([['b0', spend(planned)]]), ILS)

    expect(comparison.lines[1]?.verdict).toBe('NO_BASIS')
    expect(comparison.lines[1]?.actual).toBeUndefined()
    expect(comparison.withoutBasis).toBe(1)
    // Both totals are over the comparable line only, which is the only way the
    // subtraction between them means anything.
    expect(comparison.planned).toEqual(money(planned, ILS))
    expect(comparison.actual).toEqual(money(planned, ILS))
    expect(comparison.variance).toEqual(money(0, ILS))
  })

  it('reports the variance as a share of the plan, and refuses to when there was none', () => {
    const buckets = [bucket('b0', 10, { targetKind: 'CATEGORY', targetId: 'cat:groceries' })]
    const allocations = [allocation('a0', 'b0', { mode: 'FIXED_AMOUNT', amount: money(100_000, ILS) })]
    const result = splitPlan(plan(), buckets, allocations, NET, none)

    expect(
      planVersusActual(result, period, new Map([['b0', spend(150_000)]]), ILS).lines[0]
        ?.varianceBasisPoints,
    ).toBe(5000)

    const nothingPlanned = splitPlan(
      plan(),
      buckets,
      [allocation('a0', 'b0', { mode: 'FIXED_AMOUNT', amount: money(0, ILS) })],
      NET,
      none,
    )
    // Undefined rather than infinity or zero: docs/f10's zero-versus-unknown
    // rule, one screen along (D-087).
    expect(
      planVersusActual(nothingPlanned, period, new Map([['b0', spend(150_000)]]), ILS).lines[0]
        ?.varianceBasisPoints,
    ).toBeUndefined()
  })

  it('carries the basis through, so the screen can say where a figure came from', () => {
    const result = threeWays([{ targetKind: 'SAVING_GOAL', targetId: 'goal:house' }])
    const comparison = planVersusActual(
      result,
      period,
      new Map([['b0', { amount: money(500_000, ILS), basis: 'GOAL_DEPOSITS' as const, rowCount: 2 }]]),
      ILS,
    )

    expect(comparison.lines[0]?.basis).toBe('GOAL_DEPOSITS')
    expect(comparison.lines[0]?.rowCount).toBe(2)
    expect(comparison.period).toEqual(period)
  })

  it('compares nothing at all without crashing', () => {
    const comparison = planVersusActual(threeWays([]), period, new Map(), ILS)
    expect(comparison.lines).toEqual([])
    expect(comparison.comparable).toBe(0)
    expect(comparison.variance).toEqual(money(0, ILS))
  })
})

/**
 * D-174: the same money, shown as a share instead of as a subtraction.
 *
 * The tests are about what it does to the *percentages*, because that is the
 * part that makes this a stored fact about a plan rather than a display
 * preference.
 */
describe('fixed expenses in the split', () => {
  const fixed = money(400_000, ILS)

  it('leaves the whole net to divide, and takes its share out of the balance', () => {
    const offTop = splitPlan(
      plan(),
      [bucket('b1', 0)],
      [allocation('a1', 'b1', { mode: 'PERCENTAGE', basisPoints: 5_000 })],
      NET,
      off(fixed.minor),
    )
    const within = splitPlan(
      plan(),
      [bucket('b1', 0)],
      [allocation('a1', 'b1', { mode: 'PERCENTAGE', basisPoints: 5_000 })],
      NET,
      inside(fixed.minor),
    )

    // Off the top: half of what is left. In the split: half of the whole.
    expect(offTop.splittable).toEqual(money(NET.minor - fixed.minor, ILS))
    expect(offTop.allocations[0]?.amount).toEqual(money((NET.minor - fixed.minor) / 2, ILS))

    expect(within.splittable).toEqual(NET)
    expect(within.allocations[0]?.amount).toEqual(money(NET.minor / 2, ILS))

    // And the fixed total is still spoken for either way, so the balance is the
    // same money in both readings.
    expect(within.fixedShare).toEqual(fixed)
    expect(within.balance).toEqual(money(NET.minor - NET.minor / 2 - fixed.minor, ILS))
  })

  it('draws no share while no fixed expense is part of the split', () => {
    const result = splitPlan(
      plan(),
      [bucket('b1', 0)],
      [allocation('a1', 'b1', { mode: 'PERCENTAGE', basisPoints: 5_000 })],
      NET,
      none,
    )

    expect(result.fixedShare).toBeUndefined()
    expect(result.splittable).toEqual(NET)
    expect(result.fixedExpenses).toEqual(money(0, ILS))
  })

  it('keeps the share out of the allocations, where nothing could look it up', () => {
    // The reason it is its own field: `applyPlan` and `planVersusActual` walk
    // `allocations`, and a synthetic row with no bucket behind it would read as
    // a plan line whose actuals are always zero.
    const result = splitPlan(
      plan(),
      [bucket('b1', 0)],
      [allocation('a1', 'b1', { mode: 'PERCENTAGE', basisPoints: 5_000 })],
      NET,
      inside(fixed.minor),
    )

    expect(result.allocations).toHaveLength(1)
    expect(result.allocations[0]?.bucket.id).toBe('b1')
  })

  it('reports an over-allocation once the share no longer fits', () => {
    const result = splitPlan(
      plan(),
      [bucket('b1', 0)],
      [allocation('a1', 'b1', { mode: 'PERCENTAGE', basisPoints: 10_000 })],
      NET,
      inside(fixed.minor),
    )

    // The whole net to one bucket, and the fixed expenses still to pay.
    expect(result.status).toBe('OVER_ALLOCATED')
    expect(result.balance).toEqual(money(-fixed.minor, ILS))
  })
})

/**
 * D-174's other half: the bar as the control. A drag has only one unit — a
 * distance — and every allocation is written in some other one.
 */
describe('draggedTo', () => {
  const splittable = money(1_000_000, ILS)

  it('turns a distance into the percentage the allocation is written in', () => {
    const moved = draggedTo(
      [
        allocation('a1', 'b1', { mode: 'PERCENTAGE', basisPoints: 5_000 }),
        allocation('a2', 'b2', { mode: 'PERCENTAGE', basisPoints: 5_000 }),
      ],
      'a1',
      250_000,
      splittable,
    )

    expect(moved.find((one) => one.id === 'a1')?.basisPoints).toBe(2_500)
  })

  it('turns it into an amount where the allocation holds one', () => {
    const moved = draggedTo(
      [allocation('a1', 'b1', { mode: 'FIXED_AMOUNT', amount: money(100_000, ILS) })],
      'a1',
      250_000,
      splittable,
    )

    expect(moved[0]?.amount).toEqual(money(250_000, ILS))
    // Still a fixed amount: a drag moves an allocation, it does not change what
    // kind of allocation the user decided it was.
    expect(moved[0]?.mode).toBe('FIXED_AMOUNT')
  })

  it('will not move a remainder, which is defined as what is left', () => {
    const allocations = [allocation('a1', 'b1', { mode: 'REMAINDER' })]
    expect(draggedTo(allocations, 'a1', 250_000, splittable)).toBe(allocations)
  })

  it('refuses a drag when there is nothing to be a share of', () => {
    const allocations = [allocation('a1', 'b1', { mode: 'PERCENTAGE', basisPoints: 5_000 })]
    expect(draggedTo(allocations, 'a1', 250_000, money(0, ILS))).toBe(allocations)
  })

  it('leaves a locked row alone, because it goes through redistribute', () => {
    // The guard the row's own slider already had. A drag that could move a
    // locked bucket would be a second answer to a question with one.
    const moved = draggedTo(
      [
        allocation('a1', 'b1', { mode: 'PERCENTAGE', basisPoints: 5_000 }),
        allocation('a2', 'b2', { mode: 'PERCENTAGE', basisPoints: 5_000, isLocked: true }),
      ],
      'a1',
      250_000,
      splittable,
    )

    expect(moved.find((one) => one.id === 'a2')?.basisPoints).toBe(5_000)
  })
})

/** D-174: splitting a slice keeps the plan's total exactly where it was. */
describe('splitAllocation', () => {
  it('halves a percentage and gives the rest to the new bucket', () => {
    const next = splitAllocation(
      [
        allocation('a1', 'b1', { mode: 'PERCENTAGE', basisPoints: 4_001 }),
        allocation('a2', 'b2', { mode: 'PERCENTAGE', basisPoints: 3_000 }),
      ],
      'a1',
      { id: 'a3', bucketId: 'b3' },
    )

    expect(next.map((one) => one.basisPoints)).toEqual([2_000, 2_001, 3_000])
    // The whole point: the plan claims exactly what it claimed before.
    expect(next.reduce((sum, one) => sum + (one.basisPoints ?? 0), 0)).toBe(7_001)
  })

  it('returns the new slice beside the one it came out of', () => {
    const next = splitAllocation(
      [
        allocation('a1', 'b1', { mode: 'PERCENTAGE', basisPoints: 4_000 }),
        allocation('a2', 'b2', { mode: 'PERCENTAGE', basisPoints: 3_000 }),
      ],
      'a1',
      { id: 'a3', bucketId: 'b3' },
    )
    expect(next.map((one) => one.id)).toEqual(['a1', 'a3', 'a2'])
  })

  it('halves an amount where the allocation holds one', () => {
    const next = splitAllocation(
      [allocation('a1', 'b1', { mode: 'FIXED_AMOUNT', amount: money(100_001, ILS) })],
      'a1',
      { id: 'a2', bucketId: 'b2' },
    )

    expect(next.map((one) => one.amount)).toEqual([money(50_000, ILS), money(50_001, ILS)])
  })

  it('will not split a remainder, which would be splitting everything else', () => {
    const allocations = [allocation('a1', 'b1', { mode: 'REMAINDER' })]
    expect(splitAllocation(allocations, 'a1', { id: 'a2', bucketId: 'b2' })).toBe(allocations)
  })

  it('never gives the new slice a lock the old one had', () => {
    const next = splitAllocation(
      [allocation('a1', 'b1', { mode: 'PERCENTAGE', basisPoints: 4_000, isLocked: true })],
      'a1',
      { id: 'a2', bucketId: 'b2' },
    )
    expect(next.map((one) => one.isLocked)).toEqual([true, false])
  })
})

/**
 * A divider between two neighbours (M28 U7, D-319): what one gains the other
 * gives, in the unit each is written in, and the pair never changes.
 */
describe('a divider trading between neighbours', () => {
  const SPLITTABLE = money(1_000_000, ILS)
  const options = { snap: 5000, room: 0 }

  it('trades basis points between two percentages, to the exact sum', () => {
    const before = [
      allocation('a1', 'a', { basisPoints: 3000 }),
      allocation('a2', 'b', { basisPoints: 2000 }),
    ]
    const after = tradedAt(before, 'a1', 400_000, SPLITTABLE, options)

    expect(after.map((one) => one.basisPoints)).toEqual([4000, 1000])
    expect((after[0]?.basisPoints ?? 0) + (after[1]?.basisPoints ?? 0)).toBe(5000)
  })

  it('trades a percentage against a fixed amount, converting the difference once', () => {
    const before = [
      allocation('a1', 'a', { basisPoints: 3000 }),
      allocation('a2', 'b', { mode: 'FIXED_AMOUNT', basisPoints: undefined, amount: money(200_000, ILS) }),
    ]
    const after = tradedAt(before, 'a1', 350_000, SPLITTABLE, options)

    expect(after[0]?.basisPoints).toBe(3500)
    expect(after[1]?.amount).toEqual(money(150_000, ILS))
  })

  it('cannot take more than the neighbour has', () => {
    const before = [
      allocation('a1', 'a', { basisPoints: 3000 }),
      allocation('a2', 'b', { basisPoints: 1000 }),
    ]
    const after = tradedAt(before, 'a1', 900_000, SPLITTABLE, options)

    expect(after.map((one) => one.basisPoints)).toEqual([4000, 0])
  })

  it('writes only the left one when a remainder is on the right: it is what is left', () => {
    const before = [
      allocation('a1', 'a', { basisPoints: 3000 }),
      allocation('a2', 'b', { mode: 'REMAINDER', basisPoints: undefined }),
    ]
    const after = tradedAt(before, 'a1', 500_000, SPLITTABLE, options)

    expect(after[0]?.basisPoints).toBe(5000)
    expect(after[1]).toEqual(before[1])
  })

  it('trades with the free money after the last bucket, and no more of it than there is', () => {
    const before = [allocation('a1', 'a', { basisPoints: 3000 })]
    const after = tradedAt(before, 'a1', 900_000, SPLITTABLE, { snap: 5000, room: 400_000 })

    expect(after[0]?.basisPoints).toBe(7000)
  })

  it('snaps the size it was asked for', () => {
    const before = [allocation('a1', 'a', { mode: 'FIXED_AMOUNT', basisPoints: undefined, amount: money(100_000, ILS) })]
    const after = tradedAt(before, 'a1', 123_400, SPLITTABLE, { snap: 5000, room: 500_000 })

    expect(after[0]?.amount).toEqual(money(125_000, ILS))
  })

  it('refuses when either side is locked, or the left one is a remainder', () => {
    const locked = [
      allocation('a1', 'a', { basisPoints: 3000 }),
      allocation('a2', 'b', { basisPoints: 2000, isLocked: true }),
    ]
    expect(tradedAt(locked, 'a1', 400_000, SPLITTABLE, options)).toBe(locked)
    expect(tradedAt(locked, 'a2', 400_000, SPLITTABLE, { snap: 1, room: 1_000_000 })).toBe(locked)

    const remainder = [allocation('a1', 'a', { mode: 'REMAINDER', basisPoints: undefined })]
    expect(tradedAt(remainder, 'a1', 400_000, SPLITTABLE, { snap: 1, room: 1_000_000 })).toBe(remainder)
  })
})

/**
 * F7: a change to bucket k never moves a bucket to its left; the difference is
 * taken from, or given to, the buckets to its right, next one first.
 */
describe('a change flows only to the right', () => {
  const S = money(1_000_000, ILS)
  const fixed = (id: string, minor: number, extra?: Partial<Allocation>) =>
    allocation(id, id, { mode: 'FIXED_AMOUNT', basisPoints: undefined, amount: money(minor, ILS), ...extra })
  // A percentage, then an amount, then a remainder: the shape of a real plan.
  const mixed = () => [
    allocation('p', 'p', { basisPoints: 3000 }),
    fixed('f', 200_000),
    allocation('r', 'r', { mode: 'REMAINDER', basisPoints: undefined }),
  ]

  it('typing a percentage leaves the buckets to its left alone', () => {
    const before = [
      allocation('a', 'a', { basisPoints: 2000 }),
      allocation('b', 'b', { basisPoints: 3000 }),
      allocation('c', 'c', { basisPoints: 1000 }),
    ]
    const after = changedTo(before, 'b', 4000, S, { overflow: true })
    expect(after.map((one) => one.basisPoints)).toEqual([2000, 4000, 0])
  })

  it('takes from the next bucket, then onward when it reaches zero', () => {
    const before = [
      allocation('a', 'a', { basisPoints: 1000 }),
      allocation('b', 'b', { basisPoints: 500 }),
      allocation('c', 'c', { basisPoints: 1000 }),
    ]
    const after = changedTo(before, 'a', 2000, S, { overflow: true })
    expect(after.map((one) => one.basisPoints)).toEqual([2000, 0, 500])
  })

  it('a percentage followed by an amount and a remainder: the amount gives, the remainder absorbs', () => {
    const after = changedTo(mixed(), 'p', 4000, S, { overflow: true })
    expect(after[0]?.basisPoints).toBe(4000)
    // 10% of 10,000.00 is 1,000.00 taken from the 2,000.00 amount.
    expect(after[1]?.amount).toEqual(money(100_000, ILS))
    expect(after[2]).toEqual(mixed()[2])
    // a bigger move empties the amount and the remainder takes the rest, unwritten
    const big = changedTo(mixed(), 'p', 6000, S, { overflow: true })
    expect(big[1]?.amount).toEqual(money(0, ILS))
    expect(big[2]).toEqual(mixed()[2])
  })

  it('an amount typed after a percentage never touches the percentage before it', () => {
    const after = changedTo(mixed(), 'f', 350_000, S, { overflow: true })
    expect(after[0]).toEqual(mixed()[0])
    expect(after[1]?.amount).toEqual(money(350_000, ILS))
    expect(after[2]).toEqual(mixed()[2])
  })

  it('shrinking gives the difference to the next bucket on the right, and a remainder just absorbs it', () => {
    const before = [
      fixed('a', 300_000),
      allocation('b', 'b', { basisPoints: 1000 }),
      allocation('r', 'r', { mode: 'REMAINDER', basisPoints: undefined }),
    ]
    const after = changedTo(before, 'a', 200_000, S, { overflow: true })
    expect(after[1]?.basisPoints).toBe(2000)
    const toRemainder = changedTo([before[1] as Allocation, before[2] as Allocation], 'b', 500, S, { overflow: true })
    expect(toRemainder[1]).toEqual(before[2])
  })

  it('skips a locked bucket and takes from the one after it', () => {
    const before = [
      allocation('a', 'a', { basisPoints: 1000 }),
      allocation('b', 'b', { basisPoints: 1000, isLocked: true }),
      allocation('c', 'c', { basisPoints: 1000 }),
    ]
    const after = changedTo(before, 'a', 1500, S, { overflow: true })
    expect(after.map((one) => one.basisPoints)).toEqual([1500, 1000, 500])
  })

  it('a typed figure keeps its precision, a half percent included', () => {
    const before = [allocation('a', 'a', { basisPoints: 1000 }), allocation('b', 'b', { basisPoints: 1000 })]
    const after = changedTo(before, 'a', 1250, S, { overflow: true })
    expect(after.map((one) => one.basisPoints)).toEqual([1250, 750])
    const odd = changedTo([fixed('f', 100_000), fixed('g', 100_000)], 'f', 123_457, S, { overflow: true })
    expect(odd[0]?.amount).toEqual(money(123_457, ILS))
    expect(odd[1]?.amount).toEqual(money(76_543, ILS))
  })

  it('a drag snaps a percentage to a whole percent and an amount to 50', () => {
    const percent = tradedAt(mixed(), 'p', 337_800, S, { snap: 5000, room: 0 })
    expect(percent[0]?.basisPoints).toBe(3400)
    const amount = tradedAt(mixed(), 'f', 213_400, S, { snap: 5000, room: 0 })
    expect(amount[1]?.amount).toEqual(money(215_000, ILS))
    expect(amount[0]).toEqual(mixed()[0])
  })

  it('a drag stops at what the right side and the free money can give; typing does not', () => {
    const before = [allocation('a', 'a', { basisPoints: 3000 }), allocation('b', 'b', { basisPoints: 1000 })]
    expect(tradedAt(before, 'a', 900_000, S, { snap: 5000, room: 100_000 }).map((one) => one.basisPoints)).toEqual([5000, 0])
    expect(changedTo(before, 'a', 9000, S, { overflow: true }).map((one) => one.basisPoints)).toEqual([9000, 0])
  })
})

describe('a goal at the rate a bucket gives it', () => {
  it('is whole months, reached when nothing is left, and nothing when nothing comes in', () => {
    expect(monthsToReach(money(1_000_000, ILS), money(250_000, ILS))).toBe(4)
    expect(monthsToReach(money(1_000_001, ILS), money(250_000, ILS))).toBe(5)
    expect(monthsToReach(money(0, ILS), money(250_000, ILS))).toBe('reached')
    expect(monthsToReach(money(-5, ILS), money(0, ILS))).toBe('reached')
    expect(monthsToReach(money(1_000_000, ILS), money(0, ILS))).toBeUndefined()
  })
})

describe('a remainder beside a share of the split', () => {
  it('takes what is left after the fixed expenses that are part of the split', () => {
    const result = splitPlan(
      plan(),
      [bucket('b1', 10), bucket('b2', 20)],
      [
        allocation('a1', 'b1', { basisPoints: 5_000 }),
        allocation('a2', 'b2', { mode: 'REMAINDER', basisPoints: undefined }),
      ],
      NET,
      { netOff: money(0, ILS), inSplit: money(400_000, ILS) },
    )

    expect(result.allocations[1]?.amount).toEqual(money(NET.minor / 2 - 400_000, ILS))
    expect(result.balance).toEqual(money(0, ILS))
    expect(result.status).toBe('EXACT')
  })
})

describe('withoutAllocation (D-322)', () => {
  const splittable = money(1_000_000, ILS)

  it('hands a percentage to a fixed amount to its right as money, in that bucket’s own unit', () => {
    const next = withoutAllocation(
      [allocation('a', 'a', { basisPoints: 2000 }), allocation('b', 'b', { mode: 'FIXED_AMOUNT', basisPoints: undefined, amount: money(100_000, ILS) })],
      'a',
      splittable,
    )
    expect(next.map((one) => one.id)).toEqual(['b'])
    expect(next[0]?.amount).toEqual(money(300_000, ILS))
  })

  it('lets a rest bucket absorb it, and a last bucket fall to the money not given a job', () => {
    const withRest = withoutAllocation(
      [allocation('a', 'a', { basisPoints: 2000 }), allocation('r', 'r', { mode: 'REMAINDER', basisPoints: undefined })],
      'a',
      splittable,
    )
    expect(withRest.map((one) => one.id)).toEqual(['r'])

    const last = withoutAllocation(
      [allocation('a', 'a', { basisPoints: 2000 }), allocation('b', 'b', { basisPoints: 1000 })],
      'b',
      splittable,
    )
    expect(last.map((one) => [one.id, one.basisPoints])).toEqual([['a', 2000]])
  })

  it('removes a locked bucket too, and skips a locked neighbour', () => {
    const next = withoutAllocation(
      [
        allocation('a', 'a', { basisPoints: 2000, isLocked: true }),
        allocation('b', 'b', { basisPoints: 1000, isLocked: true }),
        allocation('c', 'c', { basisPoints: 500 }),
      ],
      'a',
      splittable,
    )
    expect(next.map((one) => [one.id, one.basisPoints])).toEqual([
      ['b', 1000],
      ['c', 2500],
    ])
  })
})
