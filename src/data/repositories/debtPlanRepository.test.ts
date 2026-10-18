import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { debtStatus, leftAfter, monthsToPayOff, type DebtLine } from '@/domain/debtPlan.ts'
import { editGoalMonthly } from '@/domain/goalPlan.ts'
import { debtsAfter, debtsPlan } from './debtPlanRepository.ts'
import { createDebt, setDebtClosed } from './debtRepository.ts'
import { planMonth } from './planMonthRepository.ts'
import { createSplitBucket, createSplitPlan, updateSplitPlan } from './splitPlanRepository.ts'

const asOf = localDate(2026, 10, 3)
const ils = (minor: number) => money(minor, 'ILS')

async function seeded() {
  const db = await createLedgerDatabase()
  const car = createDebt(
    db,
    {
      name: 'Car loan',
      kind: 'BANK_LOAN',
      principalAmount: ils(1_000_000),
      openedDate: localDate(2026, 1, 1),
      monthlyPaymentAmount: ils(100_000),
    },
    1,
  )
  const extra = createSplitBucket(db, { name: 'Extra on car', targetKind: 'DEBT', targetId: car.id }, 1)
  const rest = createSplitBucket(db, { name: 'Everything else', targetKind: 'FREE' }, 1)
  createSplitPlan(
    db,
    {
      name: 'Default',
      currency: 'ILS',
      isDefault: true,
      basisKind: 'CUSTOM_AMOUNT',
      customAmount: ils(1_000_000),
      allocations: [
        { bucketId: extra.id, mode: 'FIXED_AMOUNT', amount: ils(50_000) },
        { bucketId: rest.id, mode: 'REMAINDER' },
      ],
    },
    1,
  )
  return { db, car, extra }
}

describe('plain addition over a debt', () => {
  const line: DebtLine = {
    debtId: 'd',
    name: 'Car',
    left: ils(1_000_000),
    payment: ils(100_000),
    paymentSource: 'STANDING_ORDER',
    extra: ils(50_000),
  }

  it('counts down by the payment and the extra, and stops at nothing', () => {
    expect(leftAfter(line, 2).minor).toBe(700_000)
    expect(leftAfter(line, 2, false).minor).toBe(800_000)
    expect(leftAfter(line, 100).minor).toBe(0)
    expect(monthsToPayOff(line)).toBe(7)
    expect(monthsToPayOff(line, false)).toBe(10)
    expect(monthsToPayOff({ ...line, payment: ils(0), extra: ils(0) })).toBeUndefined()
  })

  it('says how many months the extra saves', () => {
    expect(debtStatus(line, { year: 2026, month: 10 })).toEqual({
      kind: 'PAID_OFF',
      at: { year: 2027, month: 5 },
      sooner: 3,
    })
    expect(debtStatus({ ...line, left: ils(0) }, { year: 2026, month: 10 })).toEqual({ kind: 'PAID' })
    expect(debtStatus({ ...line, payment: ils(0), extra: ils(0) }, { year: 2026, month: 10 }).kind).toBe(
      'NO_PAYMENT',
    )
  })
})

describe('debtsPlan', () => {
  it('reads each debt with the standing order and the Plan bucket that points at it', async () => {
    const { db, car, extra } = await seeded()
    const read = debtsPlan(db, asOf, 'ILS')
    const [row] = read.rows
    expect(row?.line.debtId).toBe(car.id)
    expect(row?.line.paymentSource).toBe('STANDING_ORDER')
    expect(row?.line.payment.minor).toBe(100_000)
    expect(row?.line.extra.minor).toBe(50_000)
    expect(row?.bucketIds).toEqual([extra.id])
    expect(read.left.minor).toBe(1_000_000)
    expect(debtsAfter(read.rows, 2, 'ILS').minor).toBe(700_000)
    expect(row?.status.kind).toBe('PAID_OFF')
  })

  it('a typed extra goes through the same bucket Plan shows', async () => {
    const { db } = await seeded()
    const pm = planMonth(db, { month: { year: 2026, month: 10 }, asOf })
    const row = debtsPlan(db, asOf, 'ILS').rows[0]
    if (pm === undefined || row === undefined) throw new Error('seed')
    const edit = editGoalMonthly(
      pm.allocations,
      pm.buckets,
      row.line.debtId,
      80_000,
      pm.result.splittable,
      pm.result.allocations.map((one) => one.allocation.id),
      row.line.extra.minor,
      'DEBT',
    )
    if (edit.kind !== 'ALLOCATIONS') throw new Error('expected an allocation edit')
    updateSplitPlan(
      db,
      pm.plan.id,
      {
        allocations: edit.allocations.map((one) => ({
          bucketId: one.bucketId,
          mode: one.mode,
          basisPoints: one.basisPoints,
          amount: one.amount,
          isLocked: one.isLocked,
        })),
      },
      2,
    )
    expect(debtsPlan(db, asOf, 'ILS').rows[0]?.line.extra.minor).toBe(80_000)
    // A goal's bucket is not a debt's: the same call without the kind finds none.
    expect(
      editGoalMonthly(pm.allocations, pm.buckets, row.line.debtId, 1, pm.result.splittable, [], 0).kind,
    ).toBe('NEEDS_BUCKET')
  })

  it('leaves a closed debt out of the table and keeps it as history', async () => {
    const { db, car } = await seeded()
    setDebtClosed(db, car.id, true, 2)
    const read = debtsPlan(db, asOf, 'ILS')
    expect(read.rows).toEqual([])
    expect(read.closed).toHaveLength(1)
  })
})
