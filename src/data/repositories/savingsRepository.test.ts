import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { updateDeductionType } from './deductionTypeRepository.ts'
import { createPaycheck, listPaychecksWithLines, updatePaycheck } from './paycheckRepository.ts'
import {
  addDeposit,
  applyPlanDeposit,
  createGoal,
  confirmHolding,
  createHolding,
  createHoldingPlace,
  deleteHolding,
  findHolding,
  GoalHasNoHoldingError,
  HoldingInUseError,
  listHoldings,
  planDeposits,
  deleteDeposit,
  deleteGoal,
  deleteHoldingPlace,
  findGoal,
  goalDetail,
  GoalHasDepositsError,
  HoldingPlaceInUseError,
  listDeposits,
  listGoals,
  listHoldingPlaces,
  monthlyExpenses,
  recordTransfer,
  savingsSummary,
  updateGoal,
  updateHolding,
} from './savingsRepository.ts'

const ILS = 'ILS'
const ils = (minor: number) => money(minor, ILS)
const NOW = 1_755_000_000_000
const TODAY = localDate(2026, 8, 15)

/**
 * One bank, two holdings — the case the schema could not express before D-175:
 * reachable cash and a locked פק"מ at the same place.
 */
async function withPlaces(): Promise<{
  db: Database
  placeId: string
  checkingId: string
  pakamId: string
}> {
  const db = await createLedgerDatabase()
  const place = createHoldingPlace(
    db,
    { name: 'Hapoalim', kind: 'CHECKING', institution: 'Hapoalim' },
    NOW,
  )
  const checking = createHolding(
    db,
    {
      holdingPlaceId: place.id,
      name: 'Cash',
      kind: 'CASH',
      provenance: 'RECORDED',
      isLiquid: true,
    },
    NOW,
  )
  const pakam = createHolding(
    db,
    {
      holdingPlaceId: place.id,
      name: 'פק"מ',
      kind: 'DEPOSIT',
      provenance: 'TRANSCRIBED',
      isLiquid: false,
      expectedReturnBasisPoints: 400,
      expectedReturnBasis: 'CONTRACTUAL',
    },
    NOW,
  )
  return { db, placeId: place.id, checkingId: checking.id, pakamId: pakam.id }
}

describe('holdings', () => {
  it('round-trips a rate with the basis it was given', async () => {
    const { db, pakamId } = await withPlaces()

    const pakam = findHolding(db, pakamId)
    expect(pakam?.expectedReturn).toEqual({ basisPoints: 400, basis: 'CONTRACTUAL' })
    expect(pakam?.isLiquid).toBe(false)
    expect(pakam?.provenance).toBe('TRANSCRIBED')
  })

  it('clears the basis with the rate, never leaving one without the other', async () => {
    const { db, pakamId } = await withPlaces()

    updateHolding(db, pakamId, { expectedReturnBasisPoints: undefined }, NOW)

    expect(findHolding(db, pakamId)?.expectedReturn).toBeUndefined()
  })

  it('reads a rate with no stated basis as an assumption', async () => {
    const { db, pakamId } = await withPlaces()
    db.run('UPDATE fmt_holding SET expected_return_basis = NULL WHERE id = ?', [pakamId])

    expect(findHolding(db, pakamId)?.expectedReturn).toEqual({
      basisPoints: 400,
      basis: 'ASSUMED',
    })
  })

  it('lists reachable holdings first', async () => {
    const { db } = await withPlaces()
    expect(listHoldings(db).map((holding) => holding.isLiquid)).toEqual([true, false])
  })

  it('records that the balance was checked, and touches nothing else', async () => {
    const { db, checkingId } = await withPlaces()
    expect(findHolding(db, checkingId)?.lastConfirmedAt).toBeUndefined()

    confirmHolding(db, checkingId, TODAY, NOW)

    const holding = findHolding(db, checkingId)
    expect(holding?.lastConfirmedAt).toEqual(TODAY)
    expect(holding?.name).toBe('Cash')
  })

  it('refuses to delete a holding with money in it', async () => {
    const { db, checkingId } = await withPlaces()
    const goal = createGoal(db, { name: 'House', kind: 'EARMARKED' }, NOW)
    addDeposit(
      db,
      { goalId: goal.id, date: TODAY, amount: ils(100_000), holdingId: checkingId },
      NOW,
    )

    expect(() => deleteHolding(db, checkingId, NOW)).toThrow(HoldingInUseError)
    expect(listHoldings(db)).toHaveLength(2)
  })

  it('refuses to delete the place while any of its holdings holds money', async () => {
    const { db, placeId, checkingId } = await withPlaces()
    const goal = createGoal(db, { name: 'House', kind: 'EARMARKED' }, NOW)
    addDeposit(
      db,
      { goalId: goal.id, date: TODAY, amount: ils(100_000), holdingId: checkingId },
      NOW,
    )

    expect(() => deleteHoldingPlace(db, placeId, NOW)).toThrow(HoldingPlaceInUseError)
    expect(listHoldingPlaces(db)).toHaveLength(1)
  })

  it('takes its empty holdings with it, so none is left pointing at nothing', async () => {
    const { db, placeId } = await withPlaces()

    deleteHoldingPlace(db, placeId, NOW)

    expect(listHoldingPlaces(db)).toHaveLength(0)
    expect(listHoldings(db)).toHaveLength(0)
  })

  it('clears a goal default when the empty holding it named is deleted', async () => {
    const { db, checkingId } = await withPlaces()
    const goal = createGoal(
      db,
      { name: 'House', kind: 'EARMARKED', defaultHoldingId: checkingId },
      NOW,
    )

    deleteHolding(db, checkingId, NOW)

    expect(findGoal(db, goal.id)?.defaultHoldingId).toBeUndefined()
  })
})

describe('goals', () => {
  it('round-trips a target amount with its currency, and clears both together', async () => {
    const { db } = await withPlaces()
    const goal = createGoal(
      db,
      { name: 'House', kind: 'EARMARKED', targetAmount: ils(50_000_000) },
      NOW,
    )
    expect(findGoal(db, goal.id)?.targetAmount).toEqual(ils(50_000_000))

    updateGoal(db, goal.id, { targetAmount: undefined }, NOW)
    expect(findGoal(db, goal.id)?.targetAmount).toBeUndefined()
  })

  it('puts a new goal after the existing ones', async () => {
    const { db } = await withPlaces()
    createGoal(db, { name: 'First', kind: 'EARMARKED' }, NOW)
    createGoal(db, { name: 'Second', kind: 'EARMARKED' }, NOW)

    expect(listGoals(db).map((goal) => goal.name)).toEqual(['First', 'Second'])
  })

  it('refuses to delete a goal with deposits, and allows it once they are gone', async () => {
    const { db, checkingId } = await withPlaces()
    const house = createGoal(db, { name: 'House', kind: 'EARMARKED' }, NOW)
    const deposit = addDeposit(
      db,
      { goalId: house.id, date: TODAY, amount: ils(100_000), holdingId: checkingId },
      NOW,
    )

    expect(() => deleteGoal(db, house.id, NOW)).toThrow(GoalHasDepositsError)

    deleteDeposit(db, deposit.id, NOW)
    deleteGoal(db, house.id, NOW)

    expect(findGoal(db, house.id)).toBeUndefined()
  })

  it('clears a deduction type that named a deleted goal', async () => {
    const { db } = await withPlaces()
    const goal = createGoal(db, { name: 'Hishtalmut', kind: 'LONG_TERM' }, NOW)
    updateDeductionType(db, 'ded:study-fund', { linkedSavingGoalId: goal.id }, NOW)

    deleteGoal(db, goal.id, NOW)

    const rows = db.exec(
      "SELECT linked_saving_goal FROM fmt_deduction_type WHERE id = 'ded:study-fund'",
    )
    expect(rows[0]?.values[0]?.[0]).toBeNull()
  })
})

describe('deposits', () => {
  it('records a withdrawal as a negative deposit', async () => {
    const { db, checkingId } = await withPlaces()
    const goal = createGoal(db, { name: 'House', kind: 'EARMARKED' }, NOW)

    addDeposit(
      db,
      { goalId: goal.id, date: localDate(2026, 6, 1), amount: ils(100_000), holdingId: checkingId },
      NOW,
    )
    addDeposit(
      db,
      {
        goalId: goal.id,
        date: localDate(2026, 7, 1),
        amount: ils(-30_000),
        holdingId: checkingId,
        note: 'Boiler',
      },
      NOW,
    )

    const detail = goalDetail(db, goal.id, TODAY, ILS)
    expect(detail?.balance).toEqual(ils(70_000))
    expect(detail?.deposits).toHaveLength(2)
  })

  it('writes a transfer as two legs that net to zero', async () => {
    const { db, checkingId, pakamId } = await withPlaces()
    const goal = createGoal(db, { name: 'House', kind: 'EARMARKED' }, NOW)
    addDeposit(
      db,
      { goalId: goal.id, date: localDate(2026, 6, 1), amount: ils(500_000), holdingId: checkingId },
      NOW,
    )

    const legs = recordTransfer(
      db,
      {
        goalId: goal.id,
        date: localDate(2026, 7, 1),
        amount: ils(300_000),
        fromHoldingId: checkingId,
        toHoldingId: pakamId,
      },
      NOW,
    )

    expect(legs.map((leg) => leg.amount.minor)).toEqual([-300_000, 300_000])
    expect(legs[0]?.transferGroupKey).toBe(legs[1]?.transferGroupKey)

    const detail = goalDetail(db, goal.id, TODAY, ILS)
    // The move changed where the money is and not how much of it there is.
    expect(detail?.balance).toEqual(ils(500_000))
    expect(detail?.liquid).toEqual(ils(200_000))
    expect(detail?.locked).toEqual(ils(300_000))
  })

  it('takes both legs of a transfer when one is deleted', async () => {
    const { db, checkingId, pakamId } = await withPlaces()
    const goal = createGoal(db, { name: 'House', kind: 'EARMARKED' }, NOW)
    const legs = recordTransfer(
      db,
      {
        goalId: goal.id,
        date: TODAY,
        amount: ils(300_000),
        fromHoldingId: checkingId,
        toHoldingId: pakamId,
      },
      NOW,
    )

    deleteDeposit(db, legs[0]?.id ?? '', NOW)

    expect(listDeposits(db, { goalId: goal.id })).toEqual([])
  })
})

describe('payroll deposits', () => {
  async function withPayslips(): Promise<{ db: Database; goalId: string; placeId: string }> {
    const { db, checkingId } = await withPlaces()
    const goal = createGoal(
      db,
      { name: 'Hishtalmut', kind: 'LONG_TERM', defaultHoldingId: checkingId },
      NOW,
    )
    updateDeductionType(db, 'ded:study-fund', { linkedSavingGoalId: goal.id }, NOW)

    for (const month of [6, 7]) {
      createPaycheck(
        db,
        {
          period: { year: 2026, month },
          paymentDate: localDate(2026, month, 9),
          gross: ils(2_000_000),
          net: ils(1_500_000),
          lines: [
            {
              deductionTypeId: 'ded:study-fund',
              employeeAmount: ils(60_000),
              employerAmount: ils(180_000),
            },
          ],
        },
        NOW,
      )
    }

    return { db, goalId: goal.id, placeId: checkingId }
  }

  it('works out one deposit per payslip line, both sides counted, and stores none (D-381)', async () => {
    const { db, goalId } = await withPayslips()

    expect(db.exec('SELECT COUNT(*) FROM fmt_saving_deposit')[0]?.values[0]?.[0]).toBe(0)
    const deposits = listDeposits(db, { goalId })
    expect(deposits).toHaveLength(2)
    expect(deposits[0]?.amount).toEqual(ils(240_000))
    expect(deposits[0]?.sourceKind).toBe('FROM_PAYCHECK_DEDUCTION')
  })

  it('reads them exactly once however often it is asked', async () => {
    const { db, goalId } = await withPayslips()

    listDeposits(db, { goalId })
    expect(listDeposits(db, { goalId })).toHaveLength(2)
  })

  it('moves the figure when the paycheck is edited, rather than adding a row', async () => {
    const { db, goalId } = await withPayslips()

    const june = listPaychecksWithLines(db).find((entry) => entry.paycheck.period.month === 6)
    // Editing a slip rewrites its lines with new ids, which is exactly why the
    // deposit is keyed on the payslip and the goal rather than on a line.
    updatePaycheck(
      db,
      june?.paycheck.id ?? '',
      {
        lines: [
          {
            deductionTypeId: 'ded:study-fund',
            employeeAmount: ils(70_000),
            employerAmount: ils(210_000),
          },
        ],
      },
      NOW,
    )

    const deposits = listDeposits(db, { goalId })

    expect(deposits).toHaveLength(2)
    expect(deposits.map((deposit) => deposit.amount.minor).sort((a, b) => a - b)).toEqual([
      240_000, 280_000,
    ])
  })

  it('removes the deposits when the type stops feeding the goal', async () => {
    const { db, goalId } = await withPayslips()

    updateDeductionType(db, 'ded:study-fund', { linkedSavingGoalId: undefined }, NOW)
    expect(listDeposits(db, { goalId })).toEqual([])
  })

  it('will not guess where a deposit goes when the goal has no default place', async () => {
    const { db, goalId } = await withPayslips()
    updateGoal(db, goalId, { defaultHoldingId: undefined }, NOW)

    expect(listDeposits(db, { goalId })).toEqual([])
  })
})

describe('deposits a plan proposes', () => {
  it('writes one deposit per plan, month and bucket, and moves it on a second apply', async () => {
    const { db, checkingId } = await withPlaces()
    const goal = createGoal(
      db,
      { name: 'House', kind: 'EARMARKED', defaultHoldingId: checkingId },
      NOW,
    )
    const shared = {
      planId: 'plan-1',
      period: { year: 2026, month: 9 },
      bucketId: 'bucket-1',
      goalId: goal.id,
    }

    applyPlanDeposit(db, { ...shared, amount: ils(200_000) }, NOW)
    applyPlanDeposit(db, { ...shared, amount: ils(250_000) }, NOW)

    const deposits = listDeposits(db, { goalId: goal.id })
    expect(deposits).toHaveLength(1)
    expect(deposits[0]?.amount).toEqual(ils(250_000))
    // Dated the month it plans, not the day it was applied.
    expect(deposits[0]?.date).toEqual(localDate(2026, 9, 1))
    expect(deposits[0]?.sourceKind).toBe('FROM_PLAN')
  })

  it('keeps two buckets pointing at one goal as two deposits', async () => {
    const { db, checkingId } = await withPlaces()
    const goal = createGoal(
      db,
      { name: 'House', kind: 'EARMARKED', defaultHoldingId: checkingId },
      NOW,
    )
    const period = { year: 2026, month: 9 }

    applyPlanDeposit(
      db,
      { planId: 'plan-1', period, bucketId: 'bucket-1', goalId: goal.id, amount: ils(200_000) },
      NOW,
    )
    applyPlanDeposit(
      db,
      { planId: 'plan-1', period, bucketId: 'bucket-2', goalId: goal.id, amount: ils(50_000) },
      NOW,
    )

    expect(listDeposits(db, { goalId: goal.id })).toHaveLength(2)
    // The diff the splitter reads is per goal, which is what a suggestion names.
    expect(planDeposits(db, 'plan-1', period, ILS).get(goal.id)).toEqual(ils(250_000))
  })

  it('refuses rather than guessing where the money sits', async () => {
    const { db } = await withPlaces()
    const goal = createGoal(db, { name: 'House', kind: 'EARMARKED' }, NOW)

    expect(() =>
      applyPlanDeposit(
        db,
        {
          planId: 'plan-1',
          period: { year: 2026, month: 9 },
          bucketId: 'bucket-1',
          goalId: goal.id,
          amount: ils(200_000),
        },
        NOW,
      ),
    ).toThrow(GoalHasNoHoldingError)
  })
})

describe('the summary', () => {
  it('reconciles liquid, locked and the total across goals and funds', async () => {
    const { db, checkingId, pakamId } = await withPlaces()
    const house = createGoal(db, { name: 'House', kind: 'EARMARKED' }, NOW)
    const car = createGoal(db, { name: 'Car', kind: 'EARMARKED' }, NOW)

    addDeposit(
      db,
      { goalId: house.id, date: localDate(2026, 6, 1), amount: ils(400_000), holdingId: checkingId },
      NOW,
    )
    addDeposit(
      db,
      { goalId: house.id, date: localDate(2026, 6, 2), amount: ils(1_000_000), holdingId: pakamId },
      NOW,
    )
    addDeposit(
      db,
      { goalId: car.id, date: localDate(2026, 6, 3), amount: ils(600_000), holdingId: checkingId },
      NOW,
    )

    const summary = savingsSummary(db, TODAY, ILS)

    expect(summary.inGoals).toEqual(ils(2_000_000))
    expect(summary.liquidity.liquid).toEqual(ils(1_000_000))
    expect(summary.liquidity.locked).toEqual(ils(1_000_000))
    expect(summary.liquidity.liquid.minor + summary.liquidity.locked.minor).toBe(
      summary.liquidity.total.minor,
    )
    // **Two cells, not three.** Both holdings are at the one bank, so the house
    // goal's cash and its פק"מ fold into a single figure — the matrix crosses
    // goals with *places*, and D-175 did not change that (D-176).
    expect(summary.cells).toHaveLength(2)
    expect(summary.holdings).toHaveLength(2)
    expect(summary.places).toHaveLength(1)
    expect(summary.places[0]?.liquid).toEqual(ils(1_000_000))
    expect(summary.places[0]?.locked).toEqual(ils(1_000_000))
  })

  it('answers nothing about a monthly figure it has no rows for', async () => {
    const { db } = await withPlaces()

    expect(monthlyExpenses(db, TODAY, ILS)).toEqual({
      fixedExpenses: undefined,
      totalSpending: undefined,
      alongside: [],
    })
  })

  it('survives an empty document', async () => {
    const db = await createLedgerDatabase()
    const summary = savingsSummary(db, TODAY, ILS)

    expect(summary.goals).toEqual([])
    expect(summary.liquidity.total).toEqual(ils(0))
  })
})
