/**
 * M64 F12 (D-631): a year of the plan against what happened — each bucket's total against the sum
 * of what each month's plan gave it, January through the last month that is over.
 */
import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { planYear, planYearByKind } from '@/domain/planYear.ts'
import { createAccount } from './accountRepository.ts'
import { createCategory, setCategoryManually } from './categoryRepository.ts'
import { planYearAgainstActual } from './planMonthRepository.ts'
import { createSplitBucket, createSplitPlan } from './splitPlanRepository.ts'

const ILS = 'ILS'
const ils = (minor: number) => money(minor, ILS)
const NOW = 1_790_000_000_000

async function synthetic() {
  const db = await createLedgerDatabase()
  createAccount(db, { name: 'Bank', kind: 'BANK', last4: '1111' }, NOW)
  db.run("UPDATE fmt_account SET id = 'acc' WHERE last4 = '1111'")
  const food = createCategory(db, { name: 'Food shop', kind: 'EXPENSE' }, NOW)
  // ₪800 in January, ₪1,200 in February, ₪1,000 in March — and April is not over.
  for (const [month, minor] of [
    [1, 80_000],
    [2, 120_000],
    [3, 100_000],
    [4, 50_000],
  ] as const) {
    const id = `food-${String(month)}`
    insertTransaction(
      db,
      {
        id,
        accountId: 'acc',
        transactionDate: localDate(2026, month, 5),
        chargeDate: undefined,
        billingPeriod: undefined,
        amount: ils(-minor),
        direction: 'OUTFLOW',
        merchantRaw: 'shop',
        merchantNormalized: 'shop',
        providerCategory: undefined,
        cardLast4: undefined,
        reference: undefined,
        note: undefined,
        installment: undefined,
        foreign: undefined,
        naturalKey: id,
        importSessionId: undefined,
        sourceRowRef: undefined,
      },
      NOW,
    )
    setCategoryManually(db, id, food, NOW)
  }
  const bucket = createSplitBucket(db, { name: 'Food', targetKind: 'CATEGORY', targetId: food }, NOW)
  const spare = createSplitBucket(db, { name: 'Spare', targetKind: 'FREE' }, NOW)
  createSplitPlan(
    db,
    {
      name: 'Everyday',
      currency: ILS,
      isDefault: true,
      basisKind: 'CUSTOM_AMOUNT',
      customAmount: ils(2_000_000),
      allocations: [
        { bucketId: bucket.id, mode: 'FIXED_AMOUNT', amount: ils(100_000) },
        { bucketId: spare.id, mode: 'PERCENTAGE', basisPoints: 500 },
      ],
    },
    NOW,
  )
  return { db, bucket, spare }
}

describe('planYearAgainstActual (M64 F12)', () => {
  it('sums each bucket over the months that are over, and says which went over or under', async () => {
    const { db, bucket, spare } = await synthetic()
    const found = planYearAgainstActual(db, 2026, localDate(2026, 4, 10))
    expect(found?.through).toEqual({ year: 2026, month: 3 })
    const reading = found?.reading
    expect(reading?.months).toHaveLength(3)
    const food = reading?.lines.find((line) => line.bucket.id === bucket.id)
    expect(food?.planned).toEqual(ils(300_000))
    expect(food?.actual).toEqual(ils(300_000))
    expect(food?.months.map((one) => one.verdict)).toEqual(['UNDER', 'OVER', 'ON_PLAN'])
    expect([food?.over, food?.under]).toEqual([1, 1])
    // A free bucket is never measured: it stays out of both sums rather than reading as under.
    const free = reading?.lines.find((line) => line.bucket.id === spare.id)
    expect(free?.unmeasured).toBe(3)
    expect(free?.planned).toEqual(ils(0))
    expect(reading?.planned).toEqual(ils(300_000))
    expect(reading?.comparable).toBe(1)
    // A free bucket is neither spent nor put into anything: the categories are the whole year here.
    const kinds = reading === undefined ? undefined : planYearByKind(reading, ILS)
    expect(kinds?.spent?.variance).toEqual(ils(0))
    expect(kinds?.into).toBeUndefined()
    db.close()
  })

  it('reads a past year to December, and has nothing to read in January', async () => {
    const { db } = await synthetic()
    expect(planYearAgainstActual(db, 2026, localDate(2027, 2, 1))?.through).toEqual({ year: 2026, month: 12 })
    const january = planYearAgainstActual(db, 2026, localDate(2026, 1, 20))
    expect(january?.through).toBeUndefined()
    expect(january?.reading.months).toHaveLength(0)
    db.close()
  })

  it('leaves a month in another currency out of the sums', () => {
    const bucket = { id: 'b', name: 'Food' } as Parameters<typeof planYear>[0][number]['lines'][number]['bucket']
    const month = (m: number, currency: 'ILS' | 'USD') => ({
      period: { year: 2026, month: m },
      lines: [
        {
          bucket,
          planned: money(100, currency),
          actual: money(150, currency),
          basis: undefined,
          rowCount: 1,
          variance: money(50, currency),
          varianceBasisPoints: 5000,
          verdict: 'OVER' as const,
        },
      ],
      planned: money(100, currency),
      actual: money(150, currency),
      variance: money(50, currency),
      comparable: 1,
      withoutBasis: 0,
    })
    const year = planYear([month(2, 'ILS'), month(1, 'USD')], 'ILS')
    expect(year.months).toEqual([{ year: 2026, month: 2 }])
    expect(year.lines[0]?.actual).toEqual(ils(150))
    expect(year.variance).toEqual(ils(50))
  })
})
