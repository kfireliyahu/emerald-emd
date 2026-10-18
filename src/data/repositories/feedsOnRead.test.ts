import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { createAccount } from './accountRepository.ts'
import { createCategory, setCategoryManually } from './categoryRepository.ts'
import { updateDeductionType } from './deductionTypeRepository.ts'
import { setGoalFeed } from './goalDepositRepository.ts'
import { holdingWorths, recordHoldingReading } from './holdingReadingRepository.ts'
import { netWorth } from './netWorthRepository.ts'
import { createPaycheck } from './paycheckRepository.ts'
import { syncPayroll } from './payrollSyncRepository.ts'
import {
  addDeposit,
  cashHoldingOf,
  createGoal,
  createHolding,
  createHoldingPlace,
  documentMoneyMap,
  goalFigures,
  listDeposits,
  listGoals,
  listHoldings,
  savingsSummary,
  setPlaceAccount,
  setTransactionHolding,
} from './savingsRepository.ts'
import type { InsertableTransaction } from './transactionRepository.ts'
import { setTransferDecisions, suggestTransfers } from './transferPairRepository.ts'

const NOW = 1_755_000_000_000
const ils = (minor: number) => money(minor, 'ILS')
const AS_OF = localDate(2026, 8, 12)

/**
 * **M36 U05's done-test: every feed worked out on read gives the figures the
 * stored deposits gave.** One synthetic document with a goal of every feed —
 * a category, a holding with readings and a buy after the latest one, the
 * transfers into a bank account, a payslip line, a plan, a hand-typed deposit
 * with a typed gain — and every goal and holding figure the screens show,
 * captured before the change and held to after it.
 *
 * **What moved on purpose is `Spare`, and only `Spare`**: a holding a person
 * paid into by hand counts that money as put in, and what was put in after its
 * reading as part of its worth (D-381). Before, a ₪5,000 deposit and a ₪5,400
 * reading said ₪5,400 of growth, and the ₪300 a plan put in and the ₪50 gain
 * typed after the reading were in no worth. So `Spare` is ₪5,750 worth with
 * ₪5,300 put in and ₪450 growth, and every total it is in is ₪350 more —
 * `balances`, `liquidity`, `map` and `netWorth`. Every goal figure
 * and every deposit list is the same, to the agora.
 *
 * **And `netWorth` is the one net worth since M36 U07**: with no statement
 * balance in this document, what is set aside is inside none, so In the bank
 * keeps it and the figure is everything the holdings are worth.
 */
async function document(): Promise<Database> {
  const db = await createLedgerDatabase()
  const main = createAccount(db, { name: 'Main', kind: 'BANK' }, NOW)
  const savings = createAccount(db, { name: 'Savings', kind: 'BANK', last4: '9876' }, NOW)
  const broker = createAccount(db, { name: 'Broker', kind: 'HOLDINGS' }, NOW)
  const brokerPlace = createHoldingPlace(db, { name: 'Broker place', kind: 'INVESTMENT' }, NOW)
  setPlaceAccount(db, brokerPlace.id, broker.id, NOW)
  const home = createHoldingPlace(db, { name: 'At home', kind: 'OTHER' }, NOW)
  const held = (placeId: string, name: string, kind: 'SECURITY' | 'CASH' | 'DEPOSIT', isLiquid = true) =>
    createHolding(db, { holdingPlaceId: placeId, name, kind, provenance: 'RECORDED', isLiquid }, NOW)
  const world = held(brokerPlace.id, 'World index', 'SECURITY')
  const box = held(home.id, 'Savings box', 'CASH')
  const fund = held(home.id, 'Study fund', 'DEPOSIT', false)
  const spare = held(home.id, 'Spare', 'DEPOSIT')
  const savingsCash = cashHoldingOf(db, savings.id)
  if (savingsCash === undefined) throw new Error('a bank account has its own Cash (D-362)')

  const row = (id: string, accountId: string, minor: number, month: number, day: number): InsertableTransaction => ({
    id,
    accountId,
    transactionDate: localDate(2026, month, day),
    chargeDate: undefined,
    billingPeriod: undefined,
    amount: ils(minor),
    direction: minor < 0 ? 'OUTFLOW' : 'INFLOW',
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

  // A holding's rows: two buys, a reading between them.
  const house = createGoal(db, { name: 'House', kind: 'LONG_TERM', defaultHoldingId: world.id, targetAmount: ils(20_000_00) }, NOW)
  insertTransaction(db, row('buy-1', broker.id, -6_000_00, 6, 6), NOW)
  insertTransaction(db, row('buy-2', broker.id, -1_000_00, 7, 10), NOW)
  setTransactionHolding(db, 'buy-1', { holdingId: world.id, quantityMicro: 12_000_000 }, NOW)
  setTransactionHolding(db, 'buy-2', { holdingId: world.id, quantityMicro: 2_000_000 }, NOW)
  recordHoldingReading(db, { holdingId: world.id, asOf: localDate(2026, 5, 31), value: ils(0) }, {}, NOW)
  recordHoldingReading(db, { holdingId: world.id, asOf: localDate(2026, 6, 30), value: ils(6_300_00) }, {}, NOW)
  setGoalFeed(db, house.id, { kind: 'HOLDING' }, NOW)

  // A category: two bank rows filed under a Money moved category.
  const school = createGoal(db, { name: 'School', kind: 'SHORT_TERM', defaultHoldingId: box.id }, NOW)
  const toBox = createCategory(db, { name: 'To the box', kind: 'SAVING' }, NOW)
  insertTransaction(db, row('box-1', main.id, -400_00, 6, 12), NOW)
  insertTransaction(db, row('box-2', main.id, -250_00, 7, 12), NOW)
  setCategoryManually(db, 'box-1', toBox, NOW)
  setCategoryManually(db, 'box-2', toBox, NOW)
  setGoalFeed(db, school.id, { kind: 'CATEGORY', categoryId: toBox }, NOW)

  // The transfers into a bank account, after what was already there.
  const trip = createGoal(db, { name: 'Trip', kind: 'SHORT_TERM', defaultHoldingId: savingsCash.id, targetAmount: ils(5_000_00) }, NOW)
  addDeposit(db, { goalId: trip.id, date: localDate(2026, 5, 1), amount: ils(700_00), holdingId: savingsCash.id, sourceKind: 'OPENING_BALANCE' }, NOW)
  for (const month of [6, 7]) {
    insertTransaction(db, row(`out-${String(month)}`, main.id, -1_000_00, month, 3), NOW)
    insertTransaction(db, row(`in-${String(month)}`, savings.id, 1_000_00, month, 3), NOW)
  }
  suggestTransfers(db)
  const pending = db.exec("SELECT id FROM fmt_transfer_pair WHERE user_decision = 'PENDING'")[0]?.values ?? []
  setTransferDecisions(db, pending.map(([id]) => ({ pairId: String(id), decision: 'PAIRED' as const })))
  setGoalFeed(db, trip.id, { kind: 'TRANSFERS' }, NOW)

  // A payslip line.
  const study = createGoal(db, { name: 'Study', kind: 'LONG_TERM', defaultHoldingId: fund.id }, NOW)
  updateDeductionType(db, 'ded:study-fund', { linkedSavingGoalId: study.id }, NOW)
  for (const month of [6, 7]) {
    createPaycheck(
      db,
      {
        period: { year: 2026, month },
        paymentDate: localDate(2026, month, 9),
        gross: ils(2_000_000),
        net: ils(1_500_000),
        lines: [{ deductionTypeId: 'ded:study-fund', employeeAmount: ils(60_000), employerAmount: ils(180_000) }],
      },
      NOW,
    )
  }

  // A plan's deposit, a hand-typed one, a typed gain — and a reading of a holding paid into by hand.
  const rainy = createGoal(db, { name: 'Rainy day', kind: 'EMERGENCY', defaultHoldingId: spare.id }, NOW)
  addDeposit(db, { goalId: rainy.id, date: localDate(2026, 6, 1), amount: ils(5_000_00), holdingId: spare.id }, NOW)
  addDeposit(db, { goalId: rainy.id, date: localDate(2026, 7, 1), amount: ils(300_00), holdingId: spare.id, sourceKind: 'FROM_PLAN', sourceRefId: 'plan:2026-07:bucket' }, NOW)
  addDeposit(db, { goalId: rainy.id, date: localDate(2026, 7, 2), amount: ils(50_00), holdingId: spare.id, sourceKind: 'GROWTH' }, NOW)
  recordHoldingReading(db, { holdingId: spare.id, asOf: localDate(2026, 6, 30), value: ils(5_400_00) }, {}, NOW)

  settle(db)
  return db
}

/** What a write sets off: the debts' half of a payslip, and nothing for a goal now. */
function settle(db: Database): void {
  syncPayroll(db, NOW)
}

/** Every figure a screen reads about goals and holdings, by name. */
function figures(db: Database) {
  const names = new Map(listHoldings(db, { includeArchived: true }).map((one) => [one.id, one.name]))
  const goals = listGoals(db, { includeClosed: true })
  const summary = savingsSummary(db, AS_OF, 'ILS')
  const worth = netWorth(db, AS_OF, 'ILS')
  const map = documentMoneyMap(db, 'ILS')
  return {
    goals: Object.fromEntries(
      goals.map((goal) => {
        const one = goalFigures(db, 'ILS', goal.id).get(goal.id)
        const progress = summary.goals.find((each) => each.goal.id === goal.id)
        return [
          goal.name,
          {
            balance: one?.balance?.minor,
            opening: one?.opening?.minor,
            growth: one?.growth?.minor,
            liquid: one?.liquid?.minor,
            putIn: one?.putIn?.minor,
            progress: one?.progress,
            shown: progress?.balance.minor,
            deposits: listDeposits(db, { goalId: goal.id })
              .map((each) => `${each.sourceKind} ${String(each.amount.minor)} ${names.get(each.holdingId) ?? '?'} ${String(each.date.year)}-${String(each.date.month)}-${String(each.date.day)}`)
              .sort(),
          },
        ]
      }),
    ),
    holdings: Object.fromEntries(
      [...holdingWorths(db, 'ILS')].map(([id, one]) => [
        names.get(id),
        { asOf: one.asOf, reading: one.reading.minor, worth: one.worth.minor, putIn: one.putIn?.minor, growth: one.growth?.minor },
      ]),
    ),
    balances: Object.fromEntries(summary.holdings.map((one) => [names.get(one.holdingId), one.balance.minor])),
    liquidity: { liquid: summary.liquidity.liquid.minor, locked: summary.liquidity.locked.minor, total: summary.liquidity.total.minor },
    inGoals: summary.inGoals.minor,
    netWorth: { worth: worth.worth.minor, inBank: worth.inBank.minor, held: worth.held.minor, locked: worth.locked.minor },
    map: map.places.map((one) => [one.place?.name, one.balance.minor]),
  }
}

describe('every feed, worked out on read (M36 U05)', () => {
  it('gives the goal and holding figures the stored deposits gave', async () => {
    const db = await document()
    // Nothing a feed brings is stored: the table holds what a person typed.
    const stored = db.exec('SELECT DISTINCT source_kind FROM fmt_saving_deposit ORDER BY 1')[0]?.values.flat()
    expect(stored).toEqual(['FROM_PLAN', 'GROWTH', 'MANUAL', 'OPENING_BALANCE'])
    expect(figures(db)).toMatchInlineSnapshot(`
      {
        "balances": {
          "Cash": 0,
          "Savings box": 65000,
          "Spare": 575000,
          "Study fund": 480000,
          "World index": 730000,
        },
        "goals": {
          "House": {
            "balance": 730000,
            "deposits": [
              "FROM_TRANSACTION 100000 World index 2026-7-10",
              "FROM_TRANSACTION 600000 World index 2026-6-6",
              "GROWTH 30000 World index 2026-6-30",
            ],
            "growth": 30000,
            "liquid": 730000,
            "opening": 0,
            "progress": 0.365,
            "putIn": 700000,
            "shown": 730000,
          },
          "Rainy day": {
            "balance": 535000,
            "deposits": [
              "FROM_PLAN 30000 Spare 2026-7-1",
              "GROWTH 5000 Spare 2026-7-2",
              "MANUAL 500000 Spare 2026-6-1",
            ],
            "growth": 5000,
            "liquid": 535000,
            "opening": 0,
            "progress": undefined,
            "putIn": 530000,
            "shown": 535000,
          },
          "School": {
            "balance": 65000,
            "deposits": [
              "FROM_TRANSACTION 25000 Savings box 2026-7-12",
              "FROM_TRANSACTION 40000 Savings box 2026-6-12",
            ],
            "growth": 0,
            "liquid": 65000,
            "opening": 0,
            "progress": undefined,
            "putIn": 65000,
            "shown": 65000,
          },
          "Study": {
            "balance": 480000,
            "deposits": [
              "FROM_PAYCHECK_DEDUCTION 240000 Study fund 2026-6-9",
              "FROM_PAYCHECK_DEDUCTION 240000 Study fund 2026-7-9",
            ],
            "growth": 0,
            "liquid": 0,
            "opening": 0,
            "progress": undefined,
            "putIn": 480000,
            "shown": 480000,
          },
          "Trip": {
            "balance": 270000,
            "deposits": [
              "FROM_TRANSACTION 100000 Cash 2026-6-3",
              "FROM_TRANSACTION 100000 Cash 2026-7-3",
              "OPENING_BALANCE 70000 Cash 2026-5-1",
            ],
            "growth": 0,
            "liquid": 270000,
            "opening": 70000,
            "progress": 0.54,
            "putIn": 270000,
            "shown": 270000,
          },
        },
        "holdings": {
          "Spare": {
            "asOf": "2026-06-30",
            "growth": 45000,
            "putIn": 530000,
            "reading": 540000,
            "worth": 575000,
          },
          "World index": {
            "asOf": "2026-06-30",
            "growth": 30000,
            "putIn": 700000,
            "reading": 630000,
            "worth": 730000,
          },
        },
        "inGoals": 2080000,
        "liquidity": {
          "liquid": 1640000,
          "locked": 480000,
          "total": 2120000,
        },
        "map": [
          [
            "At home",
            1120000,
          ],
          [
            "Broker place",
            730000,
          ],
          [
            "Main",
            0,
          ],
          [
            "Savings",
            270000,
          ],
        ],
        "netWorth": {
          "held": 730000,
          "inBank": 910000,
          "locked": 480000,
          "worth": 2120000,
        },
      }
    `)
  })
})
