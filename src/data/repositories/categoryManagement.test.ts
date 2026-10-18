import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'

import { fromMajorUnits } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { createAccount } from './accountRepository.ts'
import {
  CategoryInUseError,
  categoryDeleteTargets,
  categoryUsage,
  createCategory,
  deleteCategory,
  listCategories,
  mergeCategories,
  moveCategory,
  renameCategory,
  reparentCategory,
  setCategoryArchived,
  setCategoryManually,
  UNCATEGORIZED_ID,
  type Category,
} from './categoryRepository.ts'
import { createRule, listRules } from './categoryRuleRepository.ts'
import { createSplitBucket, listSplitBuckets } from './splitPlanRepository.ts'
import { listTransactions } from './transactionRepository.ts'

/**
 * The taxonomy operations of docs/f02, "Operations".
 *
 * Against the real seed set rather than a handful of invented rows: the seed
 * set is what every user starts from, and its shape — two levels, system
 * categories, groups — is what these operations have to survive.
 */
describe('managing the taxonomy', () => {
  let db: Database

  beforeEach(async () => {
    db = await createLedgerDatabase()
    const account = createAccount(db, { name: 'Card 1234', kind: 'CREDIT_CARD' }, 1)
    insertTransaction(
      db,
      {
        id: 'tx-1',
        accountId: account.id,
        transactionDate: localDate(2026, 7, 3),
        chargeDate: undefined,
        billingPeriod: undefined,
        amount: fromMajorUnits(-421.05, 'ILS'),
        direction: 'OUTFLOW',
        merchantRaw: 'שופרסל דיל 344',
        merchantNormalized: 'שופרסל דיל',
        providerCategory: undefined,
        cardLast4: undefined,
        reference: undefined,
        note: undefined,
        installment: undefined,
        foreign: undefined,
        naturalKey: 'key-1',
        importSessionId: undefined,
        sourceRowRef: undefined,
      },
      1,
    )
  })

  /** Live categories only — `listCategories` already hides archived and deleted ones. */
  const find = (id: string): Category | undefined =>
    listCategories(db).find((category) => category.id === id)

  // The system categories list last whatever their order, so they are left out.
  const topLevel = (): readonly Category[] =>
    listCategories(db).filter((category) => category.parentId === undefined && !category.isSystem)

  it('creates a category at the end of its siblings rather than re-sorting the list', () => {
    // The sort order is the user's, used identically in every picker and chart
    // legend. Re-sorting the list under them when they add one is not something
    // a list should do.
    const id = createCategory(db, { name: 'Ceramics', kind: 'EXPENSE' }, 1)
    expect(topLevel()[topLevel().length - 1]?.id).toBe(id)
  })

  it('renames without disturbing the transactions that point at it', () => {
    setCategoryManually(db, 'tx-1', 'cat:groceries', 1)
    renameCategory(db, 'cat:groceries', 'Food shopping', 2)

    expect(listTransactions(db)[0]?.categoryId).toBe('cat:groceries')
    expect(listTransactions(db)[0]?.categoryPath).toBe('Living → Food shopping')
  })

  describe('the three-level cap (M28 F29, D-348)', () => {
    // 002 capped depth with a BEFORE INSERT trigger, which was enough for a
    // table that only ever received seed rows. Reparenting is an UPDATE, so a
    // deeper level was one statement away until 005 closed it — and both
    // directions still matter at three.

    it('refuses to reparent under a category that is already three levels down', () => {
      expect(() => reparentCategory(db, 'cat:groceries', 'cat:electricity', 1)).toThrow(/3 levels at most/)
    })

    it('refuses a move whose subcategories would go past the third level', () => {
      // Utilities holds Electricity, Water and Gas; under Housing & Rent they
      // would be a fourth level.
      expect(() => reparentCategory(db, 'cat:utilities', 'cat:rent', 1)).toThrow(/would go past that/)
    })

    it('refuses to make a category its own parent, or a child of what is under it', () => {
      expect(() => reparentCategory(db, 'cat:groceries', 'cat:groceries', 1)).toThrow(/its own parent/)
      expect(() => reparentCategory(db, 'cat:living', 'cat:utilities', 1)).toThrow(/its own subcategories/)
    })

    it('refuses a parent of another kind, and a system one', () => {
      expect(() => reparentCategory(db, 'cat:salary', 'cat:groceries', 1)).toThrow(/its own kind/)
      expect(() => reparentCategory(db, 'cat:groceries', 'cat:uncategorized', 1)).toThrow(/system category/)
    })

    it('allows the moves that stay inside three levels, carrying what is under them', () => {
      reparentCategory(db, 'cat:groceries', 'cat:rent', 1)
      expect(find('cat:groceries')?.path).toBe('Living → Housing & Rent → Groceries')

      reparentCategory(db, 'cat:utilities', 'cat:transport', 2)
      expect(find('cat:water')?.path).toBe('Transport → Utilities → Water')

      reparentCategory(db, 'cat:groceries', undefined, 3)
      expect(find('cat:groceries')?.parentId).toBeUndefined()
    })
  })

  describe('deleting', () => {
    it('deletes one nothing depends on', () => {
      const id = createCategory(db, { name: 'Typo', kind: 'EXPENSE' }, 1)
      deleteCategory(db, id, 2)
      expect(find(id)).toBeUndefined()
    })

    it('refuses one that transactions point at, rather than rewriting history', () => {
      setCategoryManually(db, 'tx-1', 'cat:groceries', 1)
      expect(() => deleteCategory(db, 'cat:groceries', 2)).toThrow(CategoryInUseError)
      expect(find('cat:groceries')).toBeDefined()
    })

    it('refuses one that still has subcategories', () => {
      expect(() => deleteCategory(db, 'cat:utilities', 1)).toThrow(CategoryInUseError)
    })

    it('never deletes a system category', () => {
      // Uncategorized is where everything lands by default; removing it leaves
      // the app with nowhere to put a transaction.
      expect(() => deleteCategory(db, UNCATEGORIZED_ID, 1)).toThrow(CategoryInUseError)
    })

    describe('moving what uses it first (M28 F18, D-340)', () => {
      it('refuses one in use until it is told where everything goes', () => {
        setCategoryManually(db, 'tx-1', 'cat:groceries', 1)
        expect(() => deleteCategory(db, 'cat:groceries', 2)).toThrow(/still has 1 row\. Choose a category/)
      })

      it('moves its rows, rules, budget and children, then deletes it', () => {
        setCategoryManually(db, 'tx-1', 'cat:utilities', 1)
        const rule = createRule(db, { name: 'power', kind: 'CONTAINS', pattern: 'חשמל', targetCategoryId: 'cat:utilities' }, 1)
        createSplitBucket(db, { name: 'Bills', targetKind: 'CATEGORY', targetId: 'cat:utilities' }, 1)
        expect(categoryUsage(db, 'cat:utilities').budgets).toBe(1)

        deleteCategory(db, 'cat:utilities', 2, 'cat:rent')

        expect(find('cat:utilities')).toBeUndefined()
        const row = listTransactions(db)[0]
        expect(row?.categoryId).toBe('cat:rent')
        expect(row?.categorySource).toBe('MANUAL')
        expect(find('cat:electricity')?.parentId).toBe('cat:rent')
        expect(listRules(db).find((one) => one.id === rule.id)?.targetCategoryId).toBe('cat:rent')
        expect(listSplitBuckets(db).find((one) => one.name === 'Bills')?.targetId).toBe('cat:rent')
      })

      it('offers only live categories of the same kind, with room for the children that have to move', () => {
        const targets = categoryDeleteTargets(db, 'cat:utilities')
        expect(targets.length).toBeGreaterThan(0)
        expect(targets.every((one) => one.kind === 'EXPENSE' || one.kind === 'DEBT_PAYMENT')).toBe(true)
        // Its children go under the target, so it can be two levels down at most (M28 F29).
        expect(targets.every((one) => one.depth <= 2 && !one.isSystem)).toBe(true)
        expect(targets.some((one) => one.id === 'cat:rent')).toBe(true)
        expect(targets.some((one) => one.id === 'cat:electricity')).toBe(false)

        setCategoryManually(db, 'tx-1', 'cat:groceries', 1)
        expect(() => deleteCategory(db, 'cat:groceries', 2, 'cat:salary')).toThrow(/cannot take them/)
        expect(find('cat:groceries')).toBeDefined()
      })

      it('refuses, saying what uses it, when there is nowhere of its kind to move it', () => {
        const income = listCategories(db).filter((one) => one.kind === 'INCOME' && !one.isSystem)
        for (const one of income) if (one.id !== 'cat:salary') setCategoryArchived(db, one.id, true, 1)
        setCategoryManually(db, 'tx-1', 'cat:salary', 1)

        expect(categoryDeleteTargets(db, 'cat:salary')).toEqual([])
        expect(() => deleteCategory(db, 'cat:salary', 2, 'cat:groceries')).toThrow(/still has 1 row, and there is no other category/)
        expect(find('cat:salary')).toBeDefined()
      })

      it('counts a budget as use, so a delete no longer drops it quietly', () => {
        const id = createCategory(db, { name: 'Hobbies', kind: 'EXPENSE' }, 1)
        createSplitBucket(db, { name: 'Hobbies', targetKind: 'CATEGORY', targetId: id }, 1)
        expect(() => deleteCategory(db, id, 2)).toThrow(/1 Plan bucket/)
      })
    })

    it('says what is in the way, so the UI can offer merge or archive instead', () => {
      setCategoryManually(db, 'tx-1', 'cat:groceries', 1)
      expect(categoryUsage(db, 'cat:groceries').transactions).toBe(1)
      expect(categoryUsage(db, 'cat:utilities').subcategories).toBeGreaterThan(0)
      expect(categoryUsage(db, UNCATEGORIZED_ID).isSystem).toBe(true)
    })
  })

  describe('merging', () => {
    it('repoints the transactions and keeps a manual assignment manual', () => {
      // A merge changes what a category is called, not the fact that a human
      // chose it (D-009).
      setCategoryManually(db, 'tx-1', 'cat:groceries', 1)
      mergeCategories(db, 'cat:groceries', 'cat:restaurants', 2)

      const stored = listTransactions(db)[0]
      expect(stored?.categoryId).toBe('cat:restaurants')
      expect(stored?.categorySource).toBe('MANUAL')
      expect(find('cat:groceries')).toBeUndefined()
    })

    it('brings the subcategories along instead of orphaning them', () => {
      mergeCategories(db, 'cat:utilities', 'cat:rent', 1)
      expect(find('cat:electricity')?.parentId).toBe('cat:rent')
    })

    it('carries a heading’s two levels only where they fit in three, and never into its own (M28 F29)', () => {
      expect(() => mergeCategories(db, 'cat:living', 'cat:fuel', 1)).toThrow(/would go past that/)
      expect(() => mergeCategories(db, 'cat:living', 'cat:utilities', 1)).toThrow(/its own subcategories/)
      expect(find('cat:living')).toBeDefined()

      mergeCategories(db, 'cat:living', 'cat:transport', 2)
      expect(find('cat:gas')?.path).toBe('Transport → Utilities → Gas')
      expect(find('cat:living')).toBeUndefined()
    })

    it('refuses to merge a category into itself', () => {
      expect(() => mergeCategories(db, 'cat:groceries', 'cat:groceries', 1)).toThrow(/into itself/)
    })

    it('refuses to merge away a system category', () => {
      expect(() => mergeCategories(db, UNCATEGORIZED_ID, 'cat:groceries', 1)).toThrow(
        CategoryInUseError,
      )
    })

    it('leaves nothing half-done when it fails', () => {
      // Merging a parent into one of its own children would make that child its
      // own parent, which the triggers refuse — part-way through the merge,
      // after the transactions have already been repointed.
      setCategoryManually(db, 'tx-1', 'cat:utilities', 1)
      expect(() => mergeCategories(db, 'cat:utilities', 'cat:electricity', 2)).toThrow()

      expect(find('cat:utilities')).toBeDefined()
      expect(find('cat:electricity')?.parentId).toBe('cat:utilities')
      expect(listTransactions(db)[0]?.categoryId).toBe('cat:utilities')
    })
  })

  describe('reordering', () => {
    it('swaps a category with its neighbour', () => {
      const before = topLevel()
      const first = before[0]
      const second = before[1]
      expect(first).toBeDefined()
      expect(second).toBeDefined()

      moveCategory(db, second?.id ?? '', -1, 1)

      const after = topLevel()
      expect(after[0]?.id).toBe(second?.id)
      expect(after[1]?.id).toBe(first?.id)
    })

    it('does nothing at the ends of the list', () => {
      const before = listCategories(db).map((category) => category.id)
      moveCategory(db, before[0] ?? '', -1, 1)
      expect(listCategories(db).map((category) => category.id)).toEqual(before)
    })

    it('only reorders within one parent', () => {
      // Electricity is first under Utilities. Moving it up must not swap it
      // with whatever precedes it at the top level.
      const before = listCategories(db).map((category) => category.id)
      moveCategory(db, 'cat:electricity', -1, 1)
      expect(listCategories(db).map((category) => category.id)).toEqual(before)
    })
  })

  describe('archiving', () => {
    it('hides a category from the pickers without touching its history', () => {
      setCategoryManually(db, 'tx-1', 'cat:groceries', 1)
      setCategoryArchived(db, 'cat:groceries', true, 2)

      expect(find('cat:groceries')).toBeUndefined()
      expect(listTransactions(db)[0]?.categoryId).toBe('cat:groceries')
    })

    it('brings it back', () => {
      setCategoryArchived(db, 'cat:groceries', true, 1)
      setCategoryArchived(db, 'cat:groceries', false, 2)
      expect(find('cat:groceries')).toBeDefined()
    })
  })
})
