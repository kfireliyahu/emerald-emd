import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { exportDatabase, openDatabase } from '@/data/db/database.ts'
import { createAccount } from '@/data/repositories/accountRepository.ts'
import { createCategory, setCategoryManually } from '@/data/repositories/categoryRepository.ts'
import { cushionReading } from '@/data/repositories/cushionRepository.ts'
import {
  cashHoldingOf,
  createGoal,
  createHolding,
  createHoldingPlace,
  listDeposits,
  listGoals,
  listHoldings,
  setPlaceAccount,
} from '@/data/repositories/savingsRepository.ts'
import { createSplitBucket, listSplitBuckets } from '@/data/repositories/splitPlanRepository.ts'
import { insertTransactions } from '@/data/repositories/transactionRepository.ts'
import { listTransferPairs, setTransferDecisions, suggestTransfers } from '@/data/repositories/transferPairRepository.ts'

import { createSavingGoalsTool } from './savings.ts'
import { setCushionTool, setGoalDepositCategoriesTool } from './goalDeposits.ts'
import { savingsTool } from './wealth.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

const CHECKING = {
  name: 'Leumi current',
  kind: 'CASH',
  is_liquid: true,
  provenance: 'RECORDED',
  place: { name: 'Leumi', kind: 'CHECKING' },
}

async function fixture(): Promise<string> {
  const db = await createLedgerDatabase()
  const account = createAccount(db, { name: 'Checking', kind: 'BANK' }, 1)
  const moved = createCategory(db, { name: 'To holiday', kind: 'TRANSFER' }, 1)
  createCategory(db, { name: 'Gadgets', kind: 'EXPENSE' }, 1)
  insertTransactions(
    db,
    [
      {
        id: 't1',
        accountId: account.id,
        transactionDate: localDate(2026, 9, 2),
        chargeDate: undefined,
        billingPeriod: undefined,
        amount: money(-213_100, 'ILS'),
        direction: 'OUTFLOW',
        merchantRaw: 'Transfer to savings',
        merchantNormalized: 'transfer to savings',
        providerCategory: undefined,
        cardLast4: undefined,
        reference: undefined,
        note: undefined,
        installment: undefined,
        foreign: undefined,
        naturalKey: 't1',
        importSessionId: undefined,
        sourceRowRef: undefined,
      },
    ],
    1,
  )
  setCategoryManually(db, 't1', moved, 1)
  const path = join(await tempDir('emerald-goaldeposits-'), 'doc.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  await createSavingGoalsTool.run(
    { path, commit: true, goals: [{ name: 'Holiday', kind: 'SHORT_TERM', target_amount: 8_000, default_holding: CHECKING }] },
    NO_CLIENT,
  )
  return path
}

describe('set_goal_deposit_categories', () => {
  it('dry-runs by default, then reads the bank deposits in on commit', async () => {
    const path = await fixture()
    const before = await readFile(path)
    const args = { path, goals: [{ goal: 'Holiday', category: 'To holiday' }] }

    const dry = await setGoalDepositCategoriesTool.run(args, NO_CLIENT)
    expect(dry).toContain('Nothing has been written')
    expect(dry).toContain('1 goal** would change')
    expect(await readFile(path)).toEqual(before)

    const done = await setGoalDepositCategoriesTool.run({ ...args, commit: true }, NO_CLIENT)
    expect(done).toContain('1 deposit read')

    const db = await openDatabase(await readFile(path))
    const [goal] = listGoals(db)
    const deposits = listDeposits(db, { goalId: goal?.id })
    expect(deposits.map((one) => [one.sourceKind, one.amount.minor])).toEqual([['FROM_TRANSACTION', 213_100]])
  })

  it('refuses a spending category in the dry run, and does not invite a commit', async () => {
    const path = await fixture()
    const text = await setGoalDepositCategoriesTool.run(
      { path, goals: [{ goal: 'Holiday', category: 'Gadgets' }] },
      NO_CLIENT,
    )
    expect(text).toContain('Nothing to change')
    expect(text).toContain('not a Money moved category')
    expect(text).not.toContain('commit: true')
  })

  it('gives a goal with no holding one, in the same entry that points it at the bank (M28 F23)', async () => {
    const path = await fixture()
    await createSavingGoalsTool.run({ path, commit: true, goals: [{ name: 'Car', kind: 'SHORT_TERM' }] }, NO_CLIENT)

    const bare = await setGoalDepositCategoriesTool.run({ path, goals: [{ goal: 'Car', category: 'To holiday' }] }, NO_CLIENT)
    expect(bare).toContain('Car has no default holding')
    expect(bare).toContain('`default_holding`')

    const done = await setGoalDepositCategoriesTool.run(
      { path, commit: true, goals: [{ goal: 'Car', category: 'To holiday', default_holding: 'Leumi · Leumi current' }] },
      NO_CLIENT,
    )
    expect(done).toContain('1 deposit read')

    const db = await openDatabase(await readFile(path))
    const car = listGoals(db).find((goal) => goal.name === 'Car')
    const holding = listHoldings(db).find((one) => one.name === 'Leumi current')
    expect(car?.defaultHoldingId).toBe(holding?.id)
    expect(listDeposits(db, { goalId: car?.id }).map((one) => one.holdingId)).toEqual([holding?.id])
  })

  it('sets and clears a default holding on its own, and refuses to clear one a bank feed needs', async () => {
    const path = await fixture()
    await createSavingGoalsTool.run({ path, commit: true, goals: [{ name: 'Car', kind: 'SHORT_TERM' }] }, NO_CLIENT)

    const set = await setGoalDepositCategoriesTool.run(
      { path, commit: true, goals: [{ goal: 'Car', default_holding: 'leumi current' }] },
      NO_CLIENT,
    )
    expect(set).toContain('Leumi · Leumi current')
    const unknown = await setGoalDepositCategoriesTool.run({ path, goals: [{ goal: 'Car', default_holding: 'Mattress' }] }, NO_CLIENT)
    expect(unknown).toContain('no holding called "Mattress"')

    await setGoalDepositCategoriesTool.run({ path, commit: true, goals: [{ goal: 'Car', default_holding: null }] }, NO_CLIENT)
    {
      const db = await openDatabase(await readFile(path))
      expect(listGoals(db).find((goal) => goal.name === 'Car')?.defaultHoldingId).toBeUndefined()
    }

    // Holiday reads the bank; with no holding its derived deposits would quietly go.
    await setGoalDepositCategoriesTool.run({ path, commit: true, goals: [{ goal: 'Holiday', category: 'To holiday' }] }, NO_CLIENT)
    const clear = await setGoalDepositCategoriesTool.run({ path, goals: [{ goal: 'Holiday', default_holding: null }] }, NO_CLIENT)
    expect(clear).toContain('Nothing to change')
    expect(clear).toContain('would be removed')

    await expect(setGoalDepositCategoriesTool.run({ path, goals: [{ goal: 'Car' }] }, NO_CLIENT)).rejects.toThrow(
      'default_holding',
    )
  })

  it('refuses a goal it does not know', async () => {
    const path = await fixture()
    const text = await setGoalDepositCategoriesTool.run(
      { path, goals: [{ goal: 'Yacht', category: 'To holiday' }] },
      NO_CLIENT,
    )
    expect(text).toContain('no goal called')
  })
})

describe('set_cushion', () => {
  it('sets the months and makes no goal: the cushion is what is left in the bank (D-360)', async () => {
    const path = await fixture()
    const dry = await setCushionTool.run({ path, months: 3 }, NO_CLIENT)
    expect(dry).toContain('from no months to 3 months')
    expect(dry).toContain('Nothing has been written')

    await setCushionTool.run({ path, months: 3, commit: true }, NO_CLIENT)
    const again = await setCushionTool.run({ path, months: 5, commit: true }, NO_CLIENT)
    expect(again).toContain('5 months')
    expect(again).toContain('Checking has no statement balance')

    const db = await openDatabase(await readFile(path))
    expect(cushionReading(db, localDate(2026, 10, 3), 'ILS').months).toBe(5)
    expect(listGoals(db).filter((goal) => goal.kind === 'EMERGENCY')).toHaveLength(0)
  })

  it('ticks a bank account by name and answers with the split; a card never counts', async () => {
    const path = await fixture()
    {
      const db = await openDatabase(await readFile(path))
      createAccount(db, { name: 'Visa', kind: 'CREDIT_CARD' }, 1)
      await writeFile(path, exportDatabase(db))
    }
    const card = await setCushionTool.run({ path, accounts: [{ account: 'Visa', counts: true }] }, NO_CLIENT)
    expect(card).toContain('no bank account "Visa" can count')

    const text = await setCushionTool.run({ path, accounts: [{ account: 'checking', counts: true }], commit: true }, NO_CLIENT)
    expect(text).toContain('**Checking** counts as the bank')
    // Its statement printed no balance, so nothing can be said about the split.
    expect(text).toContain('**Unchecked:** Checking has no statement balance')
    const db = await openDatabase(await readFile(path))
    expect(cushionReading(db, localDate(2026, 10, 3), 'ILS').accounts.map((one) => [one.name, one.counts])).toEqual([['Checking', true]])
  })

  it('refuses a month count that cannot be a cushion', async () => {
    const path = await fixture()
    const text = await setCushionTool.run({ path, months: 0 }, NO_CLIENT)
    expect(text).toContain('Nothing to change')
  })

  it('counts a Plan bucket in the cushion by name, and refuses one it does not have (M28 F10)', async () => {
    const path = await fixture()
    {
      const db = await openDatabase(await readFile(path))
      createSplitBucket(db, { name: 'Groceries', targetKind: 'FREE' }, 1)
      await writeFile(path, exportDatabase(db))
    }
    const missing = await setCushionTool.run({ path, buckets: [{ bucket: 'Rent', counted: true }] }, NO_CLIENT)
    expect(missing).toContain('no bucket called "Rent"')

    const text = await setCushionTool.run({ path, buckets: [{ bucket: 'groceries', counted: true }], commit: true }, NO_CLIENT)
    expect(text).toContain('**Groceries** counts in the cushion')
    const db = await openDatabase(await readFile(path))
    expect(listSplitBuckets(db).find((one) => one.name === 'Groceries')?.inCushion).toBe(true)
  })
})

describe('set_goal_deposit_categories, fed by a holding (M30 U4)', () => {
  async function brokerFixture(): Promise<string> {
    const db = await createLedgerDatabase()
    const broker = createAccount(db, { name: 'Broker', kind: 'HOLDINGS' }, 1)
    const place = createHoldingPlace(db, { name: 'Broker place', kind: 'INVESTMENT' }, 1)
    setPlaceAccount(db, place.id, broker.id, 1)
    const fund = createHolding(
      db,
      { holdingPlaceId: place.id, name: 'World index', kind: 'SECURITY', provenance: 'RECORDED', isLiquid: true },
      1,
    )
    createGoal(db, { name: 'House', kind: 'LONG_TERM', defaultHoldingId: fund.id }, 1)
    createCategory(db, { name: 'To the broker', kind: 'TRANSFER' }, 1)
    insertTransaction(
      db,
      {
        id: 'buy',
        accountId: broker.id,
        transactionDate: localDate(2026, 9, 2),
        chargeDate: undefined,
        billingPeriod: undefined,
        amount: money(-600_000, 'ILS'),
        direction: 'OUTFLOW',
        merchantRaw: 'Buy',
        merchantNormalized: 'buy',
        providerCategory: undefined,
        cardLast4: undefined,
        reference: undefined,
        note: undefined,
        installment: undefined,
        foreign: undefined,
        naturalKey: 'buy',
        importSessionId: undefined,
        sourceRowRef: undefined,
        holdingId: fund.id,
        quantityMicro: 12_000_000,
      },
      1,
    )
    const path = join(await tempDir('emerald-holdingfeed-'), 'doc.emd')
    await writeFile(path, exportDatabase(db))
    db.close()
    return path
  }

  it('feeds a goal from the rows that name its holding, and savings says what they put in, unchecked', async () => {
    const path = await brokerFixture()
    const done = await setGoalDepositCategoriesTool.run(
      { path, commit: true, goals: [{ goal: 'House', from_holding: true }] },
      NO_CLIENT,
    )
    expect(done).toContain('the rows that name Broker place · World index')
    expect(done).toContain('1 deposit read')

    const db = await openDatabase(await readFile(path))
    const [goal] = listGoals(db)
    expect(listDeposits(db, { goalId: goal?.id }).map((one) => one.amount.minor)).toEqual([600_000])
    db.close()

    const savings = await savingsTool.run({ path }, NO_CLIENT)
    expect(savings).toContain('the rows that name World index: 1 row put in')
    expect(savings).toContain('unchecked: No reading of what it cost has been recorded yet.')
  })

  it('refuses a category and the holding together: one feed per goal', async () => {
    const path = await brokerFixture()
    await expect(
      setGoalDepositCategoriesTool.run(
        { path, goals: [{ goal: 'House', from_holding: true, category: 'To the broker' }] },
        NO_CLIENT,
      ),
    ).rejects.toThrow(/never two/)
  })
})

describe('set_goal_deposit_categories and create_goals, fed by transfers (M30 F4)', () => {
  async function transferFixture(): Promise<{ readonly path: string; readonly cash: string }> {
    const db = await createLedgerDatabase()
    const main = createAccount(db, { name: 'Main', kind: 'BANK' }, 1)
    const savings = createAccount(db, { name: 'Savings', kind: 'BANK' }, 1)
    const row = (id: string, accountId: string, minor: number) => ({
      id,
      accountId,
      transactionDate: localDate(2026, 9, 2),
      chargeDate: undefined,
      billingPeriod: undefined,
      amount: money(minor, 'ILS'),
      direction: minor < 0 ? ('OUTFLOW' as const) : ('INFLOW' as const),
      merchantRaw: id,
      merchantNormalized: id,
      providerCategory: undefined,
      cardLast4: undefined,
      reference: undefined,
      note: undefined,
      installment: undefined,
      foreign: undefined,
      naturalKey: id,
      importSessionId: undefined,
      sourceRowRef: undefined,
    })
    insertTransaction(db, row('out', main.id, -100_000), 1)
    insertTransaction(db, row('in', savings.id, 100_000), 1)
    suggestTransfers(db)
    setTransferDecisions(
      db,
      listTransferPairs(db).map((pair) => ({ pairId: pair.id, decision: 'PAIRED' as const })),
    )
    const cash = cashHoldingOf(db, savings.id)?.id ?? ''
    const path = join(await tempDir('emerald-transferfeed-'), 'doc.emd')
    await writeFile(path, exportDatabase(db))
    db.close()
    return { path, cash }
  }

  it('makes a goal on the savings account that counts the confirmed transfer, in one call', async () => {
    const { path, cash } = await transferFixture()
    const done = await createSavingGoalsTool.run(
      {
        path,
        commit: true,
        goals: [{ name: 'Trip', kind: 'SHORT_TERM', default_holding: { id: cash }, from_transfers: true }],
      },
      NO_CLIENT,
    )
    expect(done).toContain('the transfers into Savings')
    const db = await openDatabase(await readFile(path))
    const [goal] = listGoals(db)
    expect(listDeposits(db, { goalId: goal?.id }).map((one) => one.amount.minor)).toEqual([100_000])
    db.close()
    const savings = await savingsTool.run({ path }, NO_CLIENT)
    expect(savings).toContain('the transfers into Savings')
  })

  it('points an existing goal at the transfers, and refuses it beside a category', async () => {
    const { path, cash } = await transferFixture()
    await createSavingGoalsTool.run(
      { path, commit: true, goals: [{ name: 'Trip', kind: 'SHORT_TERM', default_holding: { id: cash } }] },
      NO_CLIENT,
    )
    const done = await setGoalDepositCategoriesTool.run(
      { path, commit: true, goals: [{ goal: 'Trip', from_transfers: true }] },
      NO_CLIENT,
    )
    expect(done).toContain('the transfers into Savings')
    expect(done).toContain('1 deposit read')
    await expect(
      setGoalDepositCategoriesTool.run(
        { path, goals: [{ goal: 'Trip', from_transfers: true, category: 'Anything' }] },
        NO_CLIENT,
      ),
    ).rejects.toThrow(/never two/)
  })
})
