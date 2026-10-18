import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { fromMajorUnits } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { exportDatabase, openDatabase } from '@/data/db/database.ts'
import { createAccount, findAccountById } from '@/data/repositories/accountRepository.ts'
import { categoryBudgets } from '@/data/repositories/categoryBudgetRepository.ts'
import { createCategory, listCategories } from '@/data/repositories/categoryRepository.ts'
import { listSplitPlans } from '@/data/repositories/splitPlanRepository.ts'
import { readSkipped } from '@/data/repositories/labelingQueueRepository.ts'
import { findSettlementAlias } from '@/data/repositories/settlementAliasRepository.ts'
import { findTransactionById } from '@/data/repositories/transactionRepository.ts'

import { editCategoriesTool } from './categoryEdits.ts'
import {
  setCardPayersTool,
  setExcludedFromTotalsTool,
  setTransactionNotesTool,
  skipMerchantsTool,
} from './rows.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

const SHUFERSAL = 'שופרסל דיל'
const CAL_BILL = 'כאל חיוב'

async function fixture() {
  const db = await createLedgerDatabase()
  const now = 1_700_000_000_000
  const card = createAccount(db, { name: 'Cal – Visa 1234', kind: 'CREDIT_CARD' }, now)
  const bank = createAccount(db, { name: 'Checking', kind: 'BANK' }, now)
  const food = createCategory(db, { name: 'Test Food', kind: 'EXPENSE' }, now)
  const groceries = createCategory(db, { name: 'Test Groceries', kind: 'EXPENSE', parentId: food }, now)
  const spare = createCategory(db, { name: 'Test Spare', kind: 'EXPENSE' }, now)
  const rows = [
    { id: 'tx-1', merchant: SHUFERSAL, major: -100, account: card.id },
    { id: 'tx-bill', merchant: CAL_BILL, major: -1284.62, account: bank.id },
  ]
  for (const row of rows) {
    insertTransaction(
      db,
      {
        id: row.id,
        accountId: row.account,
        transactionDate: localDate(2026, 8, 3),
        chargeDate: localDate(2026, 8, 3),
        billingPeriod: { year: 2026, month: 8 },
        amount: fromMajorUnits(row.major, 'ILS'),
        direction: 'OUTFLOW',
        merchantRaw: row.merchant,
        merchantNormalized: row.merchant,
        providerCategory: undefined,
        cardLast4: undefined,
        reference: undefined,
        note: undefined,
        installment: undefined,
        foreign: undefined,
        naturalKey: row.id,
        importSessionId: undefined,
        sourceRowRef: undefined,
      },
      now,
    )
  }
  const bytes = exportDatabase(db)
  db.close()
  const dir = await tempDir('emerald-rows-')
  const path = join(dir, 'ledger.emd')
  await writeFile(path, bytes)
  return { path, card: card.id, bank: bank.id, food, groceries, spare }
}

const reopen = async (path: string) => openDatabase(await readFile(path))

describe('set_excluded_from_totals', () => {
  it('previews, then leaves a row out and counts it again', async () => {
    const { path } = await fixture()
    const before = await readFile(path)
    const args = { path, transaction_ids: ['tx-bill', 'nope'] }

    const dry = await setExcludedFromTotalsTool.run(args, NO_CLIENT)
    expect(dry).toContain('1 row would be left out of the totals')
    expect(dry).toContain('No transaction has the id nope')
    expect(dry).toContain('Nothing has been written')
    expect(Buffer.compare(before, await readFile(path))).toBe(0)

    await setExcludedFromTotalsTool.run({ ...args, commit: true }, NO_CLIENT)
    let db = await reopen(path)
    expect(findTransactionById(db, 'tx-bill')?.isExcludedFromStats).toBe(true)
    db.close()

    const again = await setExcludedFromTotalsTool.run(
      { ...args, excluded: false, commit: true },
      NO_CLIENT,
    )
    expect(again).toContain('counted in the totals again')
    db = await reopen(path)
    expect(findTransactionById(db, 'tx-bill')?.isExcludedFromStats).toBe(false)
    db.close()
  })
})

describe('set_transaction_notes', () => {
  it('writes a Hebrew note and clears it with an empty one', async () => {
    const { path } = await fixture()
    await setTransactionNotesTool.run(
      { path, notes: [{ transaction_id: 'tx-1', note: 'קנייה לשבת' }], commit: true },
      NO_CLIENT,
    )
    let db = await reopen(path)
    expect(findTransactionById(db, 'tx-1')?.note).toBe('קנייה לשבת')
    db.close()

    await setTransactionNotesTool.run(
      { path, notes: [{ transaction_id: 'tx-1', note: '' }], commit: true },
      NO_CLIENT,
    )
    db = await reopen(path)
    expect(findTransactionById(db, 'tx-1')?.note).toBeUndefined()
    db.close()
  })
})

describe('set_card_payers', () => {
  it('says a bank merchant pays a card, refuses a bank as the card, and takes it back', async () => {
    const { path, card, bank } = await fixture()

    const refused = await setCardPayersTool.run(
      { path, payments: [{ transaction_id: 'tx-bill', card_account_id: bank }] },
      NO_CLIENT,
    )
    expect(refused).toContain('is not a credit card')

    await setCardPayersTool.run(
      {
        path,
        payments: [{ transaction_id: 'tx-bill', card_account_id: card, counts: false }],
        commit: true,
      },
      NO_CLIENT,
    )
    let db = await reopen(path)
    expect(findSettlementAlias(db, CAL_BILL)?.cardAccountId).toBe(card)
    expect(findAccountById(db, card)?.excludeSettlementsFromStats).toBe(true)
    db.close()

    await setCardPayersTool.run(
      { path, payments: [{ transaction_id: 'tx-bill' }], commit: true },
      NO_CLIENT,
    )
    db = await reopen(path)
    expect(findSettlementAlias(db, CAL_BILL)).toBeUndefined()
    db.close()
  })
})

describe('skip_merchants', () => {
  it('sets a name aside and puts it back', async () => {
    const { path } = await fixture()
    await skipMerchantsTool.run({ path, merchants: [SHUFERSAL], commit: true }, NO_CLIENT)
    const db = await reopen(path)
    expect(readSkipped(db).has(SHUFERSAL)).toBe(true)
    db.close()
    const text = await skipMerchantsTool.run({ path, merchants: [SHUFERSAL], skip: false }, NO_CLIENT)
    expect(text).toContain('put back in the queue')
  })
})

describe('edit_categories', () => {
  it('renames, colours, targets and archives in one list, and says what it refuses', async () => {
    const { path, groceries, food, spare } = await fixture()
    const edits = [
      { category_id: groceries, name: 'Supermarkets', color: 'category-11' },
      { category_id: spare, archived: true },
      { category_id: spare, name: 'Test Food' },
      { category_id: food, parent_id: groceries },
    ]
    const dry = await editCategoriesTool.run({ path, edits }, NO_CLIENT)
    expect(dry).toContain('Supermarkets')
    expect(dry).toContain('there is already a category called Test Food')
    expect(dry).toContain('cannot go under one of its own subcategories')

    await editCategoriesTool.run({ path, edits, commit: true }, NO_CLIENT)
    const db = await reopen(path)
    const all = listCategories(db, { includeArchived: true })
    const changed = all.find((one) => one.id === groceries)
    expect(changed?.name).toBe('Supermarkets')
    expect(changed?.color).toBe('category-11')
    expect(all.find((one) => one.id === spare)?.isArchived).toBe(true)
    db.close()
  })

  it('merges a category into another, and refuses to mix a merge with other fields', async () => {
    const { path, groceries, spare } = await fixture()
    await expect(
      editCategoriesTool.run({ path, edits: [{ category_id: spare, name: 'x', delete: true }] }, NO_CLIENT),
    ).rejects.toThrow(/merges or deletes/)

    await editCategoriesTool.run(
      { path, edits: [{ category_id: spare, merge_into: groceries }], commit: true },
      NO_CLIENT,
    )
    const db = await reopen(path)
    expect(listCategories(db, { includeArchived: true }).some((one) => one.id === spare)).toBe(false)
    db.close()
  })
  it('deletes one in use only with move_to, and moves what uses it there first (M28 F18)', async () => {
    const { path, groceries, food, spare } = await fixture()
    await expect(
      editCategoriesTool.run({ path, edits: [{ category_id: spare, move_to: food }] }, NO_CLIENT),
    ).rejects.toThrow(/goes with `delete: true`/)

    const asked = await editCategoriesTool.run({ path, edits: [{ category_id: food, delete: true }] }, NO_CLIENT)
    expect(asked).toMatch(/still has 1 subcategory: name `move_to`/)
    expect(asked).toMatch(/can take them/)

    const dry = await editCategoriesTool.run({ path, edits: [{ category_id: food, delete: true, move_to: spare }] }, NO_CLIENT)
    expect(dry).toContain('delete, moving its 1 subcategory to Test Spare')
    await editCategoriesTool.run({ path, edits: [{ category_id: food, delete: true, move_to: spare }], commit: true }, NO_CLIENT)

    const db = await reopen(path)
    const all = listCategories(db, { includeArchived: true })
    expect(all.some((one) => one.id === food)).toBe(false)
    expect(all.find((one) => one.id === groceries)?.parentId).toBe(spare)
    db.close()
  })
})

describe('edit_categories monthly_target', () => {
  it('is the Plan bucket: with no plan, it makes the default one to hold it (M31 U3)', async () => {
    const { path, groceries } = await fixture()
    await editCategoriesTool.run({ path, edits: [{ category_id: groceries, monthly_target: 3000 }], commit: true }, NO_CLIENT)
    const db = await reopen(path)
    expect(listSplitPlans(db)).toMatchObject([{ name: 'Default', isDefault: true }])
    expect(categoryBudgets(db, localDate(2026, 10, 5), 'ILS').get(groceries)?.minor).toBe(300_000)
    db.close()
  })
})
