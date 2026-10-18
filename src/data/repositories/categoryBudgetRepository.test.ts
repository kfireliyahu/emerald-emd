import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate, type LocalDate } from '@/core/time.ts'
import { starterBuckets, unplacedHeadings } from '@/domain/starterPlan.ts'
import { query } from '../db/database.ts'
import { createAccount } from './accountRepository.ts'
import { categoryBudgets, planInUse, setCategoryBudget, starterHeadings } from './categoryBudgetRepository.ts'
import { createCategory, listCategories, setCategoryManually } from './categoryRepository.ts'
import { planMonth } from './planMonthRepository.ts'
import { findSplitPlan, createSplitBucket, createSplitPlan, listSplitPlans, setPlanMonths } from './splitPlanRepository.ts'

const asOf = localDate(2026, 10, 3)
const month = { year: 2026, month: 10 }

async function seeded() {
  const db = await createLedgerDatabase()
  const category = listCategories(db).find((one) => !one.isSystem && one.parentId === undefined)
  if (category === undefined) throw new Error('the seed set stopped producing categories')
  const rest = createSplitBucket(db, { name: 'Everything else', targetKind: 'FREE' }, 1)
  const plan = createSplitPlan(
    db,
    {
      name: 'Default',
      currency: 'ILS',
      isDefault: true,
      basisKind: 'CUSTOM_AMOUNT',
      customAmount: money(1_000_000, 'ILS'),
      allocations: [{ bucketId: rest.id, mode: 'REMAINDER' }],
    },
    1,
  )
  return { db, category, plan }
}

describe('a category budget is its Plan bucket', () => {
  it('is nothing until a bucket points at the category', async () => {
    const { db, category } = await seeded()
    expect(categoryBudgets(db, asOf, 'ILS').has(category.id)).toBe(false)
  })

  it('setting it makes a bucket ahead of What is left, and reading gives the same figure', async () => {
    const { db, category, plan } = await seeded()
    expect(setCategoryBudget(db, asOf, 'ILS', category.id, 250_000, 2)).toBe('SET')
    expect(categoryBudgets(db, asOf, 'ILS').get(category.id)).toEqual(money(250_000, 'ILS'))
    const held = findSplitPlan(db, plan.id)
    expect(held?.allocations.map((one) => one.mode).sort()).toEqual(['FIXED_AMOUNT', 'REMAINDER'])
    // Typing it again changes nothing; a new figure moves the one bucket, not a second.
    expect(setCategoryBudget(db, asOf, 'ILS', category.id, 250_000, 3)).toBe('UNCHANGED')
    expect(setCategoryBudget(db, asOf, 'ILS', category.id, 300_000, 4)).toBe('SET')
    expect(categoryBudgets(db, asOf, 'ILS').get(category.id)?.minor).toBe(300_000)
    expect(findSplitPlan(db, plan.id)?.allocations).toHaveLength(2)
  })

  it('a bucket of nothing is no budget', async () => {
    const { db, category } = await seeded()
    setCategoryBudget(db, asOf, 'ILS', category.id, 250_000, 2)
    setCategoryBudget(db, asOf, 'ILS', category.id, 0, 3)
    expect(categoryBudgets(db, asOf, 'ILS').has(category.id)).toBe(false)
  })

  it('with no plan, makes the default one to hold it (M31 U3), and clearing one makes nothing', async () => {
    const db = await createLedgerDatabase()
    const category = listCategories(db).find((one) => !one.isSystem && one.kind === 'EXPENSE')
    expect(setCategoryBudget(db, asOf, 'ILS', category?.id ?? '', 0, 1)).toBe('UNCHANGED')
    expect(listSplitPlans(db)).toHaveLength(0)
    expect(setCategoryBudget(db, asOf, 'ILS', category?.id ?? '', 150_000, 2)).toBe('SET')
    expect(listSplitPlans(db)).toMatchObject([{ name: 'Default', isDefault: true }])
    expect(categoryBudgets(db, asOf, 'ILS').get(category?.id ?? '')).toEqual(money(150_000, 'ILS'))
  })

  it('reads the plan used for the month, and the default for any other', async () => {
    const { db, category, plan } = await seeded()
    setCategoryBudget(db, asOf, 'ILS', category.id, 250_000, 2)
    const bucket = createSplitBucket(db, { name: category.name, targetKind: 'CATEGORY', targetId: category.id }, 3)
    const other = createSplitPlan(
      db,
      {
        name: 'Lean',
        currency: 'ILS',
        basisKind: 'CUSTOM_AMOUNT',
        customAmount: money(1_000_000, 'ILS'),
        allocations: [{ bucketId: bucket.id, mode: 'FIXED_AMOUNT', amount: money(100_000, 'ILS') }],
      },
      3,
    )
    expect(planInUse(db, month)).toBe(plan.id)
    setPlanMonths(db, other.id, [month], [])
    expect(planInUse(db, month)).toBe(other.id)
    expect(categoryBudgets(db, asOf, 'ILS').get(category.id)?.minor).toBe(100_000)
    // Another month still reads the default plan's figure.
    expect(categoryBudgets(db, asOf, 'ILS', { year: 2026, month: 11 }).get(category.id)?.minor).toBe(250_000)
  })
})

/**
 * The done-test (M31 U3): statements and no payslip, and *Start with 50/30/20*
 * gives a working budget in one step — the buckets on the categories the money
 * went to, the take-home pay the salary that came in.
 */
describe('a first plan from statements alone', () => {
  const NOW = 1_755_000_000_000
  let serial = 0

  function row(db: Database, minor: number, date: LocalDate, name: string, categoryId: string): void {
    serial += 1
    const id = `r${String(serial)}`
    insertTransaction(
      db,
      {
        id,
        accountId: 'bank',
        transactionDate: date,
        chargeDate: undefined,
        billingPeriod: undefined,
        amount: money(minor, 'ILS'),
        direction: minor > 0 ? 'INFLOW' : 'OUTFLOW',
        merchantRaw: name,
        merchantNormalized: name,
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
    const stored = String(query(db, 'SELECT id FROM fmt_transaction WHERE natural_key = ?', [id])[0]?.['id'])
    setCategoryManually(db, stored, categoryId, NOW)
  }

  it('maps the buckets onto the categories and splits the salary that came in', async () => {
    const db = await createLedgerDatabase()
    createAccount(db, { name: 'Bank', kind: 'BANK', last4: '4321' }, NOW)
    db.run("UPDATE fmt_account SET id = 'bank' WHERE last4 = '4321'")
    const hobbies = createCategory(db, { name: 'Hobbies', kind: 'EXPENSE' }, NOW)
    for (const month of [7, 8, 9]) {
      row(db, 1_500_000, localDate(2026, month, 1), 'Acme payroll', 'cat:salary')
      row(db, -300_000, localDate(2026, month, 5), 'Supermarket', 'cat:groceries')
      row(db, -100_000, localDate(2026, month, 9), 'Fuel station', 'cat:fuel')
      row(db, -80_000, localDate(2026, month, 12), 'Cafe', 'cat:restaurants')
      row(db, -20_000, localDate(2026, month, 15), 'Model shop', hobbies)
    }

    const headings = starterHeadings(db, asOf, 'ILS')
    // One question, about the one heading the person made.
    expect(unplacedHeadings(headings).map((one) => one.name)).toEqual(['Hobbies'])

    const buckets = starterBuckets(headings, new Map([[hobbies, 'WANTS']]))
    const plan = createSplitPlan(
      db,
      {
        name: 'Default',
        currency: 'ILS',
        isDefault: true,
        allocations: buckets.map((entry) => ({
          bucketId: createSplitBucket(
            db,
            { name: entry.name, targetKind: entry.categoryId === undefined ? 'FREE' : 'CATEGORY', targetId: entry.categoryId },
            NOW,
          ).id,
          mode: 'PERCENTAGE' as const,
          basisPoints: entry.basisPoints,
        })),
      },
      NOW,
    )

    const month = planMonth(db, { planId: plan.id, month: { year: 2026, month: 10 }, asOf, readings: false })
    expect(month?.basis).toMatchObject({ amount: money(1_500_000, 'ILS'), unavailable: false })
    expect(month?.basis.fromSalary?.newest).toEqual({ year: 2026, month: 9 })

    const budgets = categoryBudgets(db, asOf, 'ILS')
    // Needs: Living 3,000 and Transport 1,000 a month share the half — 75% and 25% of ₪7,500.
    expect(budgets.get('cat:living')).toEqual(money(562_500, 'ILS'))
    expect(budgets.get('cat:transport')).toEqual(money(187_500, 'ILS'))
    // Wants: Lifestyle 800 and Hobbies 200 share the 30%.
    expect(budgets.get('cat:lifestyle')).toEqual(money(360_000, 'ILS'))
    expect(budgets.get(hobbies)).toEqual(money(90_000, 'ILS'))
    expect(budgets.get('cat:savings')).toEqual(money(300_000, 'ILS'))
  })
})
