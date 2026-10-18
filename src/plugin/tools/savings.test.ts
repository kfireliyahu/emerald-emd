import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { exportDatabase, openDatabase } from '@/data/db/database.ts'
import {
  addDeposit,
  cashHoldingOf,
  createGoal,
  createHoldingPlace,
  listDeposits,
  listGoals,
  listHoldingPlaces,
  listHoldings,
  setPlaceAccount,
} from '@/data/repositories/savingsRepository.ts'
import { createAccount } from '@/data/repositories/accountRepository.ts'
import { createSession, setBalanceCheck, setSessionStatus } from '@/data/repositories/importSessionRepository.ts'
import { recordHoldingReading } from '@/data/repositories/holdingReadingRepository.ts'
import { insertTransactions } from '@/data/repositories/transactionRepository.ts'
import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'

import { goalProjectionTool, savingsTool } from './wealth.ts'
import { createSavingGoalsTool, recordDepositsTool } from './savings.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'
import { listBackups } from '../backup.ts'

async function fixture(): Promise<string> {
  const db = await createLedgerDatabase()
  const path = join(await tempDir('emerald-savings-'), 'doc.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  return path
}

async function reopen(path: string) {
  return openDatabase(await readFile(path))
}

/**
 * The holding every entry below lands in, named the way a model would name one:
 * by name, with the four facts creating it needs (D-175, D-176).
 */
const CHECKING = {
  name: 'Leumi current',
  kind: 'CASH',
  is_liquid: true,
  provenance: 'RECORDED',
  place: { name: 'Leumi', kind: 'CHECKING' },
}

/** A goal with somewhere to put money, which is the least a deposit needs. */
async function withGoal(path: string, name = 'New car'): Promise<void> {
  await createSavingGoalsTool.run(
    {
      path,
      commit: true,
      goals: [
        { name, kind: 'SHORT_TERM', target_amount: 60_000, default_holding: CHECKING },
      ],
    },
    NO_CLIENT,
  )
}

describe('create_goals', () => {
  it('dry-runs by default, writing nothing', async () => {
    const path = await fixture()
    const before = await readFile(path)

    const text = await createSavingGoalsTool.run(
      { path, goals: [{ name: 'New car', kind: 'SHORT_TERM', target_amount: 60_000 }] },
      NO_CLIENT,
    )

    expect(text).toContain('Nothing has been written')
    expect(text).toContain('1 goal** would be created')
    expect(await readFile(path)).toEqual(before)
  })

  it('creates goals and the places they name, and copies the document first', async () => {
    const path = await fixture()

    const text = await createSavingGoalsTool.run(
      {
        path,
        commit: true,
        goals: [
          {
            name: 'New car',
            kind: 'SHORT_TERM',
            target_amount: 60_000,
            target_date: '2027-06-01',
            default_holding: CHECKING,
          },
          { name: 'Someday', kind: 'LONG_TERM' },
        ],
      },
      NO_CLIENT,
    )

    expect(text).toContain('Created 2 goals')
    expect((await listBackups(path)).length).toBe(1)

    const db = await reopen(path)
    const goals = listGoals(db)
    expect(goals.length).toBe(2)
    // Minor units, never a float.
    expect(goals.find((one) => one.name === 'New car')?.targetAmount?.minor).toBe(6_000_000)
    // An open-ended goal is a real answer, not an error.
    expect(goals.find((one) => one.name === 'Someday')?.targetAmount).toBeUndefined()
    // A goal added today lands after the ones already there.
    expect(goals[0]?.priority).toBeLessThan(goals[1]?.priority ?? 0)
    // The place the holding named, created once beneath it.
    expect(listHoldingPlaces(db).map((one) => one.name)).toEqual(['Leumi'])
    expect(listHoldings(db).map((one) => one.name)).toEqual(['Leumi current'])
    db.close()
  })

  it('puts two new holdings at one new place named twice in the same call (M28 F10)', async () => {
    const path = await fixture()
    await createSavingGoalsTool.run(
      {
        path,
        commit: true,
        goals: [
          { name: 'Car', kind: 'SHORT_TERM', target_amount: 60_000, default_holding: CHECKING },
          {
            name: 'Trip',
            kind: 'SHORT_TERM',
            target_amount: 9_000,
            default_holding: { ...CHECKING, name: 'Leumi deposit', kind: 'DEPOSIT' },
          },
        ],
      },
      NO_CLIENT,
    )
    const db = await reopen(path)
    const places = listHoldingPlaces(db)
    expect(places.map((one) => one.name)).toEqual(['Leumi'])
    // Both holdings sit at the place that was made, not at its placeholder id.
    expect(listHoldings(db).map((one) => one.holdingPlaceId)).toEqual([places[0]?.id, places[0]?.id])
    db.close()
  })

  it('takes an emergency goal as an ordinary goal, aiming at an amount (M36 U09)', async () => {
    // Its months of expenses are the cushion's (D-360), so it aims at an amount like any goal.
    const path = await fixture()

    const good = await createSavingGoalsTool.run(
      { path, commit: true, goals: [{ name: 'Emergency fund', kind: 'EMERGENCY', target_amount: 50_000 }] },
      NO_CLIENT,
    )
    expect(good).toContain('Created 1 goal')

    const db = await reopen(path)
    expect(listGoals(db)[0]).toMatchObject({ kind: 'EMERGENCY', targetAmount: { minor: 5_000_000, currency: 'ILS' } })
    db.close()
  })

  it('takes a goal with no kind, as the goal form makes one (M36 U11)', async () => {
    const path = await fixture()
    await createSavingGoalsTool.run({ path, commit: true, goals: [{ name: 'A bike', target_amount: 3_000 }] }, NO_CLIENT)
    const db = await reopen(path)
    expect(listGoals(db)[0]).toMatchObject({ name: 'A bike', kind: 'EARMARKED' })
    db.close()
  })

  it('refuses a name it already has, and points at the tool that adds to it', async () => {
    const path = await fixture()
    await withGoal(path)

    const text = await createSavingGoalsTool.run(
      { path, goals: [{ name: 'new CAR', kind: 'SHORT_TERM' }] },
      NO_CLIENT,
    )

    expect(text).toContain('already exists')
    expect(text).toContain('`record_deposits`')
    expect(text).toContain('Nothing to create')
  })

  it('will not invent whether money is reachable', async () => {
    // Liquidity is the user's answer, not the kind's — an emergency fund in a
    // locked deposit is not an emergency fund.
    const path = await fixture()

    const text = await createSavingGoalsTool.run(
      {
        path,
        goals: [
          { name: 'New car', kind: 'SHORT_TERM', default_holding: { name: 'Some account' } },
        ],
      },
      NO_CLIENT,
    )

    expect(text).toContain('`is_liquid`')
    expect(text).toContain('Nothing to create')
  })

  it('takes the goal form’s answer: the money already there is one Was already there deposit (M30 F3)', async () => {
    const path = await fixture()
    const text = await createSavingGoalsTool.run(
      {
        path,
        commit: true,
        goals: [
          {
            name: 'Trip',
            kind: 'EARMARKED',
            target_amount: 12_000,
            default_holding: CHECKING,
            already_there: 5_000,
            already_there_on: '2026-10-05',
          },
        ],
      },
      NO_CLIENT,
    )
    expect(text).toContain('Created 1 goal')

    const db = await reopen(path)
    const goal = listGoals(db).find((one) => one.name === 'Trip')
    expect(listDeposits(db, { goalId: goal?.id }).map((one) => [one.sourceKind, one.amount.minor, one.date])).toEqual([
      ['OPENING_BALANCE', 5_000_00, { year: 2026, month: 10, day: 5 }],
    ])
    db.close()

    const nowhere = await createSavingGoalsTool.run(
      { path, goals: [{ name: 'Car', kind: 'SHORT_TERM', already_there: 100 }] },
      NO_CLIENT,
    )
    expect(nowhere).toContain('`already_there` needs a `default_holding`')
  })
})

describe('record_deposits', () => {
  it('records money in, and reports it through the read tool', async () => {
    const path = await fixture()
    await withGoal(path)

    const text = await recordDepositsTool.run(
      {
        path,
        commit: true,
        deposits: [
          { goal: 'New car', amount: 2_000, date: '2026-06-01', holding: CHECKING },
          { goal: 'New car', amount: 2_500, date: '2026-07-01', holding: CHECKING },
        ],
      },
      NO_CLIENT,
    )

    expect(text).toContain('Recorded 2 movements')

    const read = await savingsTool.run({ path }, NO_CLIENT)
    expect(read).toContain('₪4,500.00')
    expect(read).toContain('New car')
  })

  it('accepts a call shaped by its own schema, nothing more and nothing less (M28 F23)', async () => {
    // The schema required `holding_place` and defined `holding`, with unknown
    // fields refused, so a client that honoured it could not call the tool.
    const path = await fixture()
    await withGoal(path)
    const deposits = (recordDepositsTool.definition.inputSchema['properties'] as Record<string, unknown>)['deposits']
    const item = (deposits as { items: { properties: Record<string, unknown>; required: string[] } }).items
    const values: Record<string, unknown> = { goal: 'New car', amount: 1_200, date: '2026-06-01', holding: CHECKING }

    // Exactly the required fields, each one the schema defines and the tool reads.
    expect(Object.keys(values).sort()).toEqual([...item.required].sort())
    for (const name of item.required) expect(item.properties, name).toHaveProperty(name)

    const text = await recordDepositsTool.run({ path, commit: true, deposits: [values] }, NO_CLIENT)
    expect(text).toContain('Recorded 1 movement')
    const db = await reopen(path)
    expect(listDeposits(db).map((one) => one.amount.minor)).toEqual([120_000])
  })

  it('projects a goal by plain addition, and says there is no plan to read an amount from', async () => {
    const path = await fixture()
    await withGoal(path)

    const text = await goalProjectionTool.run({ path, months: 6 }, NO_CLIENT)

    expect(text).toContain('New car')
    expect(text).toContain('In 6')
    expect(text).toContain('no plan')
    expect(text).toContain('no interest is counted')
  })

  it('takes the direction from the mode, never from a minus sign', async () => {
    const path = await fixture()
    await withGoal(path)

    await expect(
      recordDepositsTool.run(
        {
          path,
          deposits: [
            { goal: 'New car', mode: 'WITHDRAWAL', amount: -500, date: '2026-06-01', holding: CHECKING },
          ],
        },
        NO_CLIENT,
      ),
    ).rejects.toThrow(/mode carries the direction/)

    await recordDepositsTool.run(
      {
        path,
        commit: true,
        deposits: [{ goal: 'New car', amount: 2_000, date: '2026-06-01', holding: CHECKING }],
      },
      NO_CLIENT,
    )
    await recordDepositsTool.run(
      {
        path,
        commit: true,
        deposits: [
          {
            goal: 'New car',
            mode: 'WITHDRAWAL',
            amount: 500,
            date: '2026-07-01',
            holding: CHECKING,
            note: 'Deposit on the car',
          },
        ],
      },
      NO_CLIENT,
    )

    const db = await reopen(path)
    const deposits = listDeposits(db)
    expect(deposits.map((one) => one.amount.minor).sort((a, b) => a - b)).toEqual([-50_000, 200_000])
    db.close()
  })

  it('makes a withdrawal say why, and never asks a loss to', async () => {
    // The price of modelling a withdrawal as a negative deposit — and the reason
    // a market fall is its own mode rather than a withdrawal with a note.
    const path = await fixture()
    await withGoal(path)

    const silent = await recordDepositsTool.run(
      {
        path,
        deposits: [
          { goal: 'New car', mode: 'WITHDRAWAL', amount: 500, date: '2026-07-01', holding: CHECKING },
        ],
      },
      NO_CLIENT,
    )
    expect(silent).toContain('has to say why')
    expect(silent).toContain('Nothing to record')

    const loss = await recordDepositsTool.run(
      {
        path,
        deposits: [
          { goal: 'New car', mode: 'LOSS', amount: 500, date: '2026-07-01', holding: CHECKING },
        ],
      },
      NO_CLIENT,
    )
    expect(loss).toContain('1 movement** would be recorded')
  })

  it('keeps an opening balance and a gain out of what was saved', async () => {
    const path = await fixture()
    await withGoal(path)

    const text = await recordDepositsTool.run(
      {
        path,
        commit: true,
        deposits: [
          { goal: 'New car', mode: 'OPENING', amount: 20_000, date: '2026-01-01', holding: CHECKING },
          { goal: 'New car', mode: 'GAIN', amount: 300, date: '2026-06-30', holding: CHECKING },
        ],
      },
      NO_CLIENT,
    )
    expect(text).toContain('Recorded 2 movements')

    const db = await reopen(path)
    const kinds = listDeposits(db).map((one) => one.sourceKind).sort()
    expect(kinds).toEqual(['GROWTH', 'OPENING_BALANCE'])
    db.close()

    // And the four ways money reached the goal still sum to the balance.
    const read = await savingsTool.run({ path }, NO_CLIENT)
    expect(read).toContain('₪20,300.00')
  })

  it('moves money between places without changing the balance', async () => {
    const path = await fixture()
    await withGoal(path)
    await recordDepositsTool.run(
      {
        path,
        commit: true,
        deposits: [{ goal: 'New car', amount: 10_000, date: '2026-06-01', holding: CHECKING }],
      },
      NO_CLIENT,
    )

    const text = await recordDepositsTool.run(
      {
        path,
        commit: true,
        deposits: [
          {
            goal: 'New car',
            mode: 'TRANSFER',
            amount: 4_000,
            date: '2026-07-01',
            holding: CHECKING,
            to_holding: { name: 'Fixed deposit', kind: 'DEPOSIT', is_liquid: false, provenance: 'TRANSCRIBED', place: { name: 'Leumi', kind: 'CHECKING' } },
          },
        ],
      },
      NO_CLIENT,
    )

    expect(text).toContain('Recorded 1 movement')
    expect(text).toContain('Fixed deposit')

    const db = await reopen(path)
    const total = listDeposits(db).reduce((sum, one) => sum + one.amount.minor, 0)
    expect(total).toBe(1_000_000)
    db.close()

    // The balance is unchanged and only what is reachable moved.
    const read = await savingsTool.run({ path }, NO_CLIENT)
    expect(read).toContain('| In the bank | ₪6,000.00 |')
    expect(read).toContain('| Net worth | ₪10,000.00 |')
    expect(read).toContain('| Locked | ₪4,000.00 |')
  })

  it('warns about taking out more than the goal holds, and still allows it', async () => {
    const path = await fixture()
    await withGoal(path)
    await recordDepositsTool.run(
      {
        path,
        commit: true,
        deposits: [{ goal: 'New car', amount: 1_000, date: '2026-06-01', holding: CHECKING }],
      },
      NO_CLIENT,
    )

    const text = await recordDepositsTool.run(
      {
        path,
        deposits: [
          {
            goal: 'New car',
            mode: 'WITHDRAWAL',
            amount: 5_000,
            date: '2026-07-01',
            holding: CHECKING,
            note: 'Paid the garage',
          },
        ],
      },
      NO_CLIENT,
    )

    expect(text).toContain('1 movement** would be recorded')
    expect(text).toContain('more than the goal holds')
  })

  it('sees a place an earlier entry in the same batch creates', async () => {
    // Found by driving the built server: a transfer created "PKM 6 months" and
    // the very next movement into it was refused for not existing. One call is
    // one unit of work, so the plan has to carry its own effects forward.
    const path = await fixture()
    await withGoal(path)

    const text = await recordDepositsTool.run(
      {
        path,
        commit: true,
        deposits: [
          { goal: 'New car', amount: 5_000, date: '2026-06-01', holding: CHECKING },
          {
            goal: 'New car',
            mode: 'TRANSFER',
            amount: 5_000,
            date: '2026-06-02',
            holding: CHECKING,
            to_holding: { name: 'PKM', kind: 'DEPOSIT', is_liquid: false, provenance: 'TRANSCRIBED', place: { name: 'Leumi', kind: 'CHECKING' } },
          },
          { goal: 'New car', mode: 'GAIN', amount: 40, date: '2026-06-30', holding: { name: 'PKM' } },
        ],
      },
      NO_CLIENT,
    )

    expect(text).toContain('Recorded 3 movements')
    expect(text).not.toContain('Refused')

    const db = await reopen(path)
    // One holding, not two, and the gain landed in it.
    expect(listHoldings(db).filter((one) => one.name === 'PKM').length).toBe(1)
    db.close()
  })

  it('judges a withdrawal against what the same batch already put in', async () => {
    // The other half of the same bug: an opening balance and a withdrawal in one
    // call had the withdrawal warned against an empty goal.
    const path = await fixture()
    await withGoal(path)

    const text = await recordDepositsTool.run(
      {
        path,
        deposits: [
          { goal: 'New car', mode: 'OPENING', amount: 18_000, date: '2026-01-01', holding: CHECKING },
          {
            goal: 'New car',
            mode: 'WITHDRAWAL',
            amount: 900,
            date: '2026-06-20',
            holding: CHECKING,
            note: 'Dentist',
          },
        ],
      },
      NO_CLIENT,
    )

    expect(text).toContain('2 movements** would be recorded')
    expect(text).not.toContain('more than the goal holds')
  })

  it('names a new place once, however many rows use it', async () => {
    const path = await fixture()

    const text = await createSavingGoalsTool.run(
      {
        path,
        goals: [
          { name: 'One', kind: 'SHORT_TERM', default_holding: CHECKING },
          { name: 'Two', kind: 'SHORT_TERM', default_holding: CHECKING },
        ],
      },
      NO_CLIENT,
    )

    // Marking both rows new reads as two places, and there is only ever one.
    expect(text.match(/\*\*new\*\*/g)?.length).toBe(1)
  })

  it('never creates a goal by accident', async () => {
    const path = await fixture()
    await withGoal(path)

    const text = await recordDepositsTool.run(
      { path, deposits: [{ goal: 'New Carr', amount: 100, date: '2026-06-01', holding: CHECKING }] },
      NO_CLIENT,
    )

    expect(text).toContain('`create_goals`')
    expect(text).toContain('split a balance in two')
    expect(text).toContain('Nothing to record')
  })

  it('teaches the shape rather than throwing a stack trace', async () => {
    const path = await fixture()

    await expect(recordDepositsTool.run({ path, deposits: [] }, NO_CLIENT)).rejects.toThrow(
      /non-empty array/,
    )
    await expect(
      recordDepositsTool.run({ path, deposits: [{ amount: 1, date: '2026-01-01' }] }, NO_CLIENT),
    ).rejects.toThrow(/needs a `goal`/)
    await expect(
      recordDepositsTool.run(
        { path, deposits: [{ goal: 'x', amount: 1, date: '2026-01-01' }] },
        NO_CLIENT,
      ),
    ).rejects.toThrow(/needs a `holding`/)
    await expect(
      recordDepositsTool.run(
        {
          path,
          deposits: [
            { goal: 'x', mode: 'TRANSFER', amount: 1, date: '2026-01-01', holding: CHECKING },
          ],
        },
        NO_CLIENT,
      ),
    ).rejects.toThrow(/to_holding/)
  })
})

/**
 * M30 F7: the tool lists a bank account's own Cash as what no goal has taken, and
 * an account with holdings' Cash as its cash line — its latest reading.
 */
describe('savings lists each account’s own Cash as the account has it', () => {
  const NOW = 1_755_000_000_000
  it('says Everyday Bank’s statement, the goal’s part and the Cash left, and the broker’s Cash at its reading', async () => {
    const db = await createLedgerDatabase()
    const everyday = createAccount(db, { name: 'Everyday Bank', kind: 'BANK' }, NOW)
    const session = 's-everyday'
    insertTransactions(
      db,
      [
        {
          id: 't-everyday', accountId: everyday.id, transactionDate: localDate(2026, 9, 30), chargeDate: undefined,
          billingPeriod: undefined, amount: money(-100, 'ILS'), direction: 'OUTFLOW', merchantRaw: 'x', merchantNormalized: 'x',
          providerCategory: undefined, cardLast4: undefined, reference: undefined, note: undefined, installment: undefined,
          foreign: undefined, naturalKey: 't-everyday', importSessionId: session, sourceRowRef: undefined,
        },
      ],
      1,
    )
    createSession(db, { id: session, accountId: everyday.id, mappingId: undefined, fileName: 'everyday.xlsx', fileHash: session, sheetName: undefined }, 1)
    setBalanceCheck(
      db,
      session,
      { kind: 'VERIFIED', order: 'OLDEST_FIRST', openingBalance: money(20_900_00 + 100, 'ILS'), closingBalance: money(20_900_00, 'ILS'), rowCount: 1 },
      1,
    )
    setSessionStatus(db, session, 'COMMITTED', 2)
    const cash = cashHoldingOf(db, everyday.id)
    const goal = createGoal(db, { name: 'Car', kind: 'EARMARKED', defaultHoldingId: cash?.id }, NOW)
    addDeposit(db, { goalId: goal.id, holdingId: cash?.id ?? '', date: localDate(2026, 9, 1), amount: money(5_000_00, 'ILS'), sourceKind: 'MANUAL' }, NOW)

    const broker = createAccount(db, { name: 'Broker', kind: 'HOLDINGS' }, NOW)
    const place = createHoldingPlace(db, { name: 'Broker', kind: 'INVESTMENT' }, NOW)
    setPlaceAccount(db, place.id, broker.id, NOW)
    recordHoldingReading(db, { holdingId: cashHoldingOf(db, broker.id)?.id ?? '', asOf: localDate(2026, 7, 31), value: money(95_94, 'ILS') }, {}, NOW)

    const path = join(await tempDir('emerald-savings-'), 'doc.emd')
    await writeFile(path, exportDatabase(db))
    db.close()
    const read = await savingsTool.run({ path }, NO_CLIENT)

    expect(read).toContain('| Everyday Bank | The statement | ₪20,900.00 |')
    expect(read).toContain('| Everyday Bank | Car | ₪5,000.00 |')
    expect(read).toContain('| Everyday Bank | Cash, not for any goal | ₪15,900.00 |')
    expect(read).toMatch(/\| Cash, not for any goal \| Everyday Bank \| ₪15,900\.00 \|/)
    expect(read).toMatch(/\| Cash \| Broker \| ₪95\.94 \|/)
  })
})
