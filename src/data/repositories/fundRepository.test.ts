import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { createLedgerDatabase } from '../packs/ledger/testing.ts'
import { exportDatabase, openDatabase } from '../db/database.ts'
import {
  findDeductionType,
  listDeductionTypes,
  updateDeductionType,
} from './deductionTypeRepository.ts'
import {
  acknowledgeDepositGap,
  addSnapshot,
  createFund,
  deductionTypesForFund,
  deleteFund,
  deleteSnapshot,
  DuplicateSnapshotError,
  expectedContributionsFor,
  findFund,
  findSnapshot,
  fundDepositCheck,
  fundDepositChecks,
  fundAnalysis,
  latestSnapshot,
  listFundDeposits,
  listFunds,
  listFundsWithLatest,
  listSnapshots,
  replaceSnapshotDeposits,
  setFundArchived,
  snapshotProblems,
  updateFund,
  updateSnapshot,
} from './fundRepository.ts'
import { createPaycheck } from './paycheckRepository.ts'
import { readFormat } from './formatRepository.ts'
import { readRow } from './formatRowRepository.ts'
import { verdictsOf } from '@/domain/format/row.ts'

const ILS = 'ILS'
const ils = (minor: number) => money(minor, ILS)
const NOW = 1_755_000_000_000

async function empty(): Promise<Database> {
  return createLedgerDatabase()
}

async function withFund(): Promise<{ db: Database; fundId: string }> {
  const db = await empty()
  const fund = createFund(db, { name: 'Menora pension', fundType: 'PENSION' }, NOW)
  return { db, fundId: fund.id }
}

/** A payslip with a pension line and a severance line, both feeding the fund. */
function slip(db: Database, month: number): void {
  createPaycheck(
    db,
    {
      period: { year: 2026, month },
      paymentDate: localDate(2026, month, 28),
      employerName: 'Acme',
      gross: ils(2_000_000),
      net: ils(1_500_000),
      lines: [
        {
          deductionTypeId: 'ded:pension',
          employeeAmount: ils(50_000),
          employerAmount: ils(75_000),
        },
        { deductionTypeId: 'ded:severance', employeeAmount: ils(0), employerAmount: ils(83_333) },
      ],
    },
    NOW,
  )
}

describe('fund accounts', () => {
  it('creates and reads one back', async () => {
    const db = await empty()
    const created = createFund(
      db,
      {
        name: 'Menora pension',
        fundType: 'PENSION',
        employerName: 'Acme',
        policyNumber: '556677',
        firstDepositDate: localDate(2021, 4, 1),
        feeOnAccumulationBasisPoints: 22,
        feeOnDepositBasisPoints: 149,
      },
      NOW,
    )

    const found = findFund(db, created.id)
    expect(found?.name).toBe('Menora pension')
    expect(found?.fees.onAccumulationBasisPoints).toBe(22)
    expect(found?.fees.onDepositBasisPoints).toBe(149)
    expect(found?.firstDepositDate).toEqual(localDate(2021, 4, 1))
    expect(found?.status).toBe('ACTIVE')
  })

  it('puts the active funds first and the closed ones last', async () => {
    const db = await empty()
    createFund(db, { name: 'Closed one', fundType: 'PROVIDENT', status: 'CLOSED' }, NOW)
    createFund(db, { name: 'Old job', fundType: 'PENSION', status: 'DORMANT' }, NOW)
    createFund(db, { name: 'Current', fundType: 'PENSION' }, NOW)

    expect(listFunds(db).map((fund) => fund.name)).toEqual(['Current', 'Old job', 'Closed one'])
  })

  it('leaves archived funds out unless they are asked for', async () => {
    const { db, fundId } = await withFund()
    setFundArchived(db, fundId, true, NOW)

    expect(listFunds(db)).toHaveLength(0)
    expect(listFunds(db, { includeArchived: true })).toHaveLength(1)
  })

  it('clears a fee that is named and left empty, and keeps one that is not named', async () => {
    const db = await empty()
    const fund = createFund(
      db,
      {
        name: 'Menora',
        fundType: 'PENSION',
        feeOnAccumulationBasisPoints: 22,
        feeOnDepositBasisPoints: 149,
      },
      NOW,
    )

    updateFund(db, fund.id, { feeOnAccumulationBasisPoints: undefined }, NOW)

    const after = findFund(db, fund.id)
    expect(after?.fees.onAccumulationBasisPoints).toBeUndefined()
    // Not named in the edit, so untouched — "I do not know my fee" and "my fee
    // is zero" are different claims and neither is "leave it alone".
    expect(after?.fees.onDepositBasisPoints).toBe(149)
  })

  it('survives a save and reopen', async () => {
    const db = await empty()
    const fund = createFund(
      db,
      { name: 'Altshuler hishtalmut', fundType: 'STUDY_FUND', feeOnAccumulationBasisPoints: 60 },
      NOW,
    )
    addSnapshot(
      db,
      { fundAccountId: fund.id, asOfDate: localDate(2026, 6, 30), totalBalance: ils(4_500_000) },
      NOW,
    )

    const reopened = await openDatabase(exportDatabase(db))
    expect(findFund(reopened, fund.id)?.fees.onAccumulationBasisPoints).toBe(60)
    expect(latestSnapshot(reopened, fund.id)?.totalBalance).toEqual(ils(4_500_000))
  })
})

describe('deleting a fund', () => {
  it('takes its snapshots with it', async () => {
    const { db, fundId } = await withFund()
    addSnapshot(
      db,
      { fundAccountId: fundId, asOfDate: localDate(2026, 6, 30), totalBalance: ils(10_000_000) },
      NOW,
    )

    deleteFund(db, fundId, NOW)

    expect(findFund(db, fundId)).toBeUndefined()
    expect(listSnapshots(db, fundId)).toEqual([])
  })

  it('clears the deduction-type links that named it', async () => {
    const { db, fundId } = await withFund()
    updateDeductionType(db, 'ded:pension', { linkedFundId: fundId }, NOW)
    expect(deductionTypesForFund(db, fundId)).toHaveLength(1)

    deleteFund(db, fundId, NOW)

    // A link to a fund that is gone would keep producing expected contributions
    // for it, and the reconciliation would compare payslips against nothing.
    expect(findDeductionType(db, 'ded:pension')?.linkedFundId).toBeUndefined()
    expect(deductionTypesForFund(db, fundId)).toEqual([])
  })
})

describe('snapshots', () => {
  it('records a whole reading from a report', async () => {
    const { db, fundId } = await withFund()
    const created = addSnapshot(
      db,
      {
        fundAccountId: fundId,
        asOfDate: localDate(2026, 6, 30),
        totalBalance: ils(10_000_000),
        employeeComponent: ils(3_000_000),
        employerComponent: ils(5_000_000),
        severanceComponent: ils(2_000_000),
        depositsSincePrevious: ils(750_000),
        feesChargedSincePrevious: ils(11_000),
        returnSincePrevious: ils(320_000),
        note: 'H1 report',
      },
      NOW,
    )

    const found = findSnapshot(db, created.id)
    expect(found?.totalBalance).toEqual(ils(10_000_000))
    expect(found?.severanceComponent).toEqual(ils(2_000_000))
    expect(found?.depositsSincePrevious).toEqual(ils(750_000))
    expect(found?.depositGapAcknowledged).toBe(false)
  })

  it('tells a missing component from a component of zero', async () => {
    const { db, fundId } = await withFund()
    const created = addSnapshot(
      db,
      {
        fundAccountId: fundId,
        asOfDate: localDate(2026, 6, 30),
        totalBalance: ils(10_000_000),
        severanceComponent: ils(0),
      },
      NOW,
    )

    const found = findSnapshot(db, created.id)
    expect(found?.severanceComponent).toEqual(ils(0))
    expect(found?.employeeComponent).toBeUndefined()
  })

  it('keeps the negative movement a severance withdrawal is', async () => {
    const { db, fundId } = await withFund()
    const created = addSnapshot(
      db,
      {
        fundAccountId: fundId,
        asOfDate: localDate(2026, 6, 30),
        totalBalance: ils(6_000_000),
        depositsSincePrevious: ils(-4_000_000),
        note: 'severance withdrawn on leaving',
      },
      NOW,
    )

    expect(findSnapshot(db, created.id)?.depositsSincePrevious).toEqual(ils(-4_000_000))
  })

  it('refuses a second reading for a date the fund already has', async () => {
    const { db, fundId } = await withFund()
    addSnapshot(
      db,
      { fundAccountId: fundId, asOfDate: localDate(2026, 6, 30), totalBalance: ils(10_000_000) },
      NOW,
    )

    expect(() =>
      addSnapshot(
        db,
        { fundAccountId: fundId, asOfDate: localDate(2026, 6, 30), totalBalance: ils(10_100_000) },
        NOW,
      ),
    ).toThrow(DuplicateSnapshotError)
  })

  it('lets two funds share a date', async () => {
    const { db, fundId } = await withFund()
    const other = createFund(db, { name: 'Hishtalmut', fundType: 'STUDY_FUND' }, NOW)

    addSnapshot(
      db,
      { fundAccountId: fundId, asOfDate: localDate(2026, 6, 30), totalBalance: ils(10_000_000) },
      NOW,
    )
    addSnapshot(
      db,
      { fundAccountId: other.id, asOfDate: localDate(2026, 6, 30), totalBalance: ils(4_000_000) },
      NOW,
    )

    expect(listSnapshots(db, fundId)).toHaveLength(1)
    expect(listSnapshots(db, other.id)).toHaveLength(1)
  })

  it('frees a date once its reading is deleted', async () => {
    const { db, fundId } = await withFund()
    const first = addSnapshot(
      db,
      { fundAccountId: fundId, asOfDate: localDate(2026, 6, 30), totalBalance: ils(10_000_000) },
      NOW,
    )
    deleteSnapshot(db, first.id, NOW)

    expect(() =>
      addSnapshot(
        db,
        { fundAccountId: fundId, asOfDate: localDate(2026, 6, 30), totalBalance: ils(10_100_000) },
        NOW,
      ),
    ).not.toThrow()
  })

  it('corrects a transcription without clearing what was not named', async () => {
    const { db, fundId } = await withFund()
    const created = addSnapshot(
      db,
      {
        fundAccountId: fundId,
        asOfDate: localDate(2026, 6, 30),
        totalBalance: ils(10_000_000),
        depositsSincePrevious: ils(750_000),
        note: 'H1 report',
      },
      NOW,
    )

    updateSnapshot(db, created.id, { totalBalance: ils(10_500_000) }, NOW)

    const after = findSnapshot(db, created.id)
    expect(after?.totalBalance).toEqual(ils(10_500_000))
    expect(after?.depositsSincePrevious).toEqual(ils(750_000))
    expect(after?.note).toBe('H1 report')
  })

  it('refuses to move a reading onto a date the fund already has', async () => {
    const { db, fundId } = await withFund()
    addSnapshot(
      db,
      { fundAccountId: fundId, asOfDate: localDate(2026, 3, 31), totalBalance: ils(9_000_000) },
      NOW,
    )
    const second = addSnapshot(
      db,
      { fundAccountId: fundId, asOfDate: localDate(2026, 6, 30), totalBalance: ils(10_000_000) },
      NOW,
    )

    expect(() => updateSnapshot(db, second.id, { asOfDate: localDate(2026, 3, 31) }, NOW)).toThrow(
      DuplicateSnapshotError,
    )
  })

  it('reads the newest as the current balance, whatever order they went in', async () => {
    const { db, fundId } = await withFund()
    addSnapshot(
      db,
      { fundAccountId: fundId, asOfDate: localDate(2026, 6, 30), totalBalance: ils(10_000_000) },
      NOW,
    )
    addSnapshot(
      db,
      { fundAccountId: fundId, asOfDate: localDate(2026, 3, 31), totalBalance: ils(9_000_000) },
      NOW,
    )

    expect(latestSnapshot(db, fundId)?.totalBalance).toEqual(ils(10_000_000))
    expect(listSnapshots(db, fundId).map((one) => one.asOfDate.month)).toEqual([3, 6])
  })

  it('reverses an acknowledgement', async () => {
    const { db, fundId } = await withFund()
    const created = addSnapshot(
      db,
      { fundAccountId: fundId, asOfDate: localDate(2026, 6, 30), totalBalance: ils(10_000_000) },
      NOW,
    )

    acknowledgeDepositGap(db, created.id, true, NOW)
    expect(findSnapshot(db, created.id)?.depositGapAcknowledged).toBe(true)

    acknowledgeDepositGap(db, created.id, false, NOW)
    expect(findSnapshot(db, created.id)?.depositGapAcknowledged).toBe(false)
  })
})

/**
 * The deposit table a report prints, stored against the reading it came off
 * (D-153).
 */
describe('deposit rows', () => {
  /** A month of contributions, as a report's table lists it. */
  const row = (month: number, arrived: number) => ({
    employerName: 'מעבדות תוכנה',
    depositDate: localDate(2026, arrived, 4),
    salaryMonth: { year: 2026, month },
    employee: ils(150_000),
    employer: ils(175_000),
    severance: ils(75_000),
    total: undefined,
    salary: ils(2_000_000),
    note: undefined,
  })

  async function withReading(): Promise<{ db: Database; fundId: string; snapshotId: string }> {
    const { db, fundId } = await withFund()
    const snapshot = addSnapshot(
      db,
      {
        fundAccountId: fundId,
        asOfDate: localDate(2026, 6, 30),
        totalBalance: ils(2_462_100),
        depositsSincePrevious: ils(800_000),
      },
      NOW,
    )
    return { db, fundId, snapshotId: snapshot.id }
  }

  it('writes a reading’s table and reads it back in salary-month order', async () => {
    const { db, fundId, snapshotId } = await withReading()
    replaceSnapshotDeposits(db, snapshotId, fundId, [row(3, 4), row(1, 2), row(2, 3)], NOW)

    const stored = listFundDeposits(db, fundId)
    expect(stored.map((one) => one.salaryMonth?.month)).toEqual([1, 2, 3])
    expect(stored[0]?.employee?.minor).toBe(150_000)
    expect(stored[0]?.employerName).toBe('מעבדות תוכנה')
    expect(stored[0]?.snapshotId).toBe(snapshotId)
    // No total column on this table, so nothing was stored for one — the sum is
    // derived, never written (`fundDepositTotal`).
    expect(stored[0]?.total).toBeUndefined()
  })

  it('replaces a reading’s table whole rather than merging into it', async () => {
    const { db, fundId, snapshotId } = await withReading()
    replaceSnapshotDeposits(db, snapshotId, fundId, [row(1, 2), row(2, 3)], NOW)
    // Re-read with a corrected format: one row, and the other must go. A merge
    // could not remove a row that was never there.
    replaceSnapshotDeposits(db, snapshotId, fundId, [row(1, 2)], NOW + 1)

    expect(listFundDeposits(db, fundId).filter((one) => one.snapshotId === snapshotId)).toHaveLength(1)
  })

  it('keeps both readings’ rows when two reports overlap', async () => {
    const { db, fundId, snapshotId } = await withReading()
    const second = addSnapshot(
      db,
      {
        fundAccountId: fundId,
        asOfDate: localDate(2026, 9, 30),
        totalBalance: ils(3_000_000),
        depositsSincePrevious: ils(1_200_000),
      },
      NOW,
    )

    replaceSnapshotDeposits(db, snapshotId, fundId, [row(1, 2), row(2, 3)], NOW)
    // Q3 is year-to-date, so it restates Q2's rows and adds one (D-152).
    replaceSnapshotDeposits(db, second.id, fundId, [row(1, 2), row(2, 3), row(3, 4)], NOW)

    // Stored faithfully: five rows, because that is what the two documents say.
    expect(listFundDeposits(db, fundId)).toHaveLength(5)
    // And reconciled afterwards: three deposits, because that is what happened.
    expect(fundAnalysis(db, fundId)?.deposits).toHaveLength(3)
  })

  /**
   * A backfill: three years of quarterlies, each year-to-date, opened in the
   * order a person finds them in a drawer — newest first (D-164).
   *
   * The overlap is the point. Q4 restates every row Q1, Q2 and Q3 printed, so
   * twelve documents state one 36-month history 90 times over, and the only
   * thing standing between that and a fund that looks like it received three
   * times what it did is `distinctDeposits`. This is the volume the domain test
   * could not reach: it needs the store's ordering to be right as well as the
   * key.
   */
  it('reads three years of overlapping quarterlies down to one row per month', async () => {
    const { db, fundId } = await withFund()

    const quarters = [4, 3, 2, 1]
    const years = [2026, 2025, 2024]
    let stated = 0

    for (const year of years) {
      for (const quarter of quarters) {
        const through = quarter * 3
        const reading = addSnapshot(
          db,
          {
            fundAccountId: fundId,
            asOfDate: localDate(year, through, 30),
            totalBalance: ils(1_000_000 * quarter),
            depositsSincePrevious: ils(400_000 * quarter),
          },
          NOW,
        )
        // Year-to-date: every month of the year so far, every time.
        const rows = []
        for (let month = 1; month <= through; month += 1) {
          rows.push({
            ...row(month, month),
            salaryMonth: { year, month },
            depositDate: localDate(year, month === 12 ? 12 : month + 1, 4),
          })
        }
        replaceSnapshotDeposits(db, reading.id, fundId, rows, NOW)
        stated += rows.length
      }
    }

    // Every document kept whole: 1+2+…+12 twice over per quarter boundary.
    expect(stated).toBe(3 * (3 + 6 + 9 + 12))
    expect(listFundDeposits(db, fundId)).toHaveLength(stated)

    const analysis = fundAnalysis(db, fundId)
    // And thirty-six deposits, because that is what happened.
    expect(analysis?.deposits).toHaveLength(36)
    expect(new Set(analysis?.deposits.map((one) => one.salaryMonth?.year)).size).toBe(3)
  })

  it('credits a restated deposit to the earliest report that stated it', async () => {
    const { db, fundId } = await withFund()

    const q2 = addSnapshot(
      db,
      { fundAccountId: fundId, asOfDate: localDate(2026, 6, 30), totalBalance: ils(2_000_000) },
      NOW,
    )
    const q1 = addSnapshot(
      db,
      { fundAccountId: fundId, asOfDate: localDate(2026, 3, 31), totalBalance: ils(1_000_000) },
      NOW,
    )

    // Opened newest first, which is how a drawer of old reports comes out.
    replaceSnapshotDeposits(db, q2.id, fundId, [row(1, 2), row(2, 3)], NOW)
    replaceSnapshotDeposits(db, q1.id, fundId, [row(1, 2)], NOW + 1)

    const kept = fundAnalysis(db, fundId)?.deposits ?? []
    expect(kept).toHaveLength(2)
    // Q1 is the report closest in time to the deposit, whichever was read first.
    expect(kept[0]?.snapshotId).toBe(q1.id)
  })

  it('takes a reading’s rows with the reading', async () => {
    const { db, fundId, snapshotId } = await withReading()
    replaceSnapshotDeposits(db, snapshotId, fundId, [row(1, 2)], NOW)

    deleteSnapshot(db, snapshotId, NOW + 1)
    expect(listFundDeposits(db, fundId)).toEqual([])
  })

  it('takes them with the fund too', async () => {
    const { db, fundId, snapshotId } = await withReading()
    replaceSnapshotDeposits(db, snapshotId, fundId, [row(1, 2)], NOW)

    deleteFund(db, fundId, NOW + 1)
    expect(listFundDeposits(db, fundId)).toEqual([])
  })

  it('survives a save and a reopen', async () => {
    const { db, fundId, snapshotId } = await withReading()
    replaceSnapshotDeposits(db, snapshotId, fundId, [row(1, 2)], NOW)

    const reopened = await openDatabase(exportDatabase(db))
    const stored = listFundDeposits(reopened, fundId)
    expect(stored).toHaveLength(1)
    expect(stored[0]?.salaryMonth).toEqual({ year: 2026, month: 1 })
    expect(stored[0]?.depositDate).toEqual(localDate(2026, 2, 4))
  })
})

describe('listFundsWithLatest', () => {
  it('names the funds with no reading rather than leaving them out', async () => {
    const { db, fundId } = await withFund()
    createFund(db, { name: 'Never entered', fundType: 'STUDY_FUND' }, NOW)
    addSnapshot(
      db,
      { fundAccountId: fundId, asOfDate: localDate(2026, 6, 30), totalBalance: ils(10_000_000) },
      NOW,
    )

    const entries = listFundsWithLatest(db)
    expect(entries).toHaveLength(2)
    expect(entries.filter((entry) => entry.latest === undefined)).toHaveLength(1)
  })
})

describe('expectedContributionsFor', () => {
  it('reads what the payslips say should have reached the fund', async () => {
    const { db, fundId } = await withFund()
    updateDeductionType(db, 'ded:pension', { linkedFundId: fundId }, NOW)
    updateDeductionType(db, 'ded:severance', { linkedFundId: fundId }, NOW)
    for (let month = 1; month <= 6; month += 1) slip(db, month)

    const contributions = expectedContributionsFor(db, fundId)

    expect(contributions).toHaveLength(6)
    expect(contributions[0]?.employee).toEqual(ils(50_000))
    expect(contributions[0]?.employer).toEqual(ils(75_000))
    expect(contributions[0]?.severance).toEqual(ils(83_333))
  })

  it('says nothing at all while no deduction type names the fund', async () => {
    const { db, fundId } = await withFund()
    for (let month = 1; month <= 6; month += 1) slip(db, month)

    expect(expectedContributionsFor(db, fundId)).toEqual([])
  })

  it('is the reverse of the link, asked from the fund side', async () => {
    const { db, fundId } = await withFund()
    updateDeductionType(db, 'ded:pension', { linkedFundId: fundId }, NOW)

    expect(deductionTypesForFund(db, fundId).map((type) => type.id)).toEqual(['ded:pension'])
    // And the vocabulary itself is untouched — the link lives on the type.
    expect(listDeductionTypes(db)).toHaveLength(10)
  })
})

describe('fundDepositCheck', () => {
  it('reconciles a fund whose employer pays a month late', async () => {
    const { db, fundId } = await withFund()
    updateDeductionType(db, 'ded:pension', { linkedFundId: fundId }, NOW)
    updateDeductionType(db, 'ded:severance', { linkedFundId: fundId }, NOW)
    for (let month = 1; month <= 6; month += 1) slip(db, month)

    addSnapshot(
      db,
      { fundAccountId: fundId, asOfDate: localDate(2026, 1, 31), totalBalance: ils(10_000_000) },
      NOW,
    )
    addSnapshot(
      db,
      {
        fundAccountId: fundId,
        asOfDate: localDate(2026, 7, 31),
        totalBalance: ils(11_500_000),
        depositsSincePrevious: ils(6 * (50_000 + 75_000 + 83_333)),
      },
      NOW,
    )

    const result = fundDepositCheck(db, fundId, ILS)
    expect(result?.kind).toBe('CHECKED')
    if (result?.kind !== 'CHECKED') return
    expect(result.status).toBe('WITHIN_TOLERANCE')
    expect(result.window.salaryFrom).toEqual({ year: 2026, month: 1 })
  })

  it('finds the money that never arrived', async () => {
    const { db, fundId } = await withFund()
    updateDeductionType(db, 'ded:pension', { linkedFundId: fundId }, NOW)
    updateDeductionType(db, 'ded:severance', { linkedFundId: fundId }, NOW)
    for (let month = 1; month <= 6; month += 1) slip(db, month)

    addSnapshot(
      db,
      { fundAccountId: fundId, asOfDate: localDate(2026, 1, 31), totalBalance: ils(10_000_000) },
      NOW,
    )
    addSnapshot(
      db,
      {
        fundAccountId: fundId,
        asOfDate: localDate(2026, 7, 31),
        totalBalance: ils(11_270_000),
        depositsSincePrevious: ils(6 * (50_000 + 75_000 + 83_333) - 230_000),
      },
      NOW,
    )

    const result = fundDepositCheck(db, fundId, ILS)
    expect(result?.kind === 'CHECKED' && result.status).toBe('DEPOSITS_MISSING')
    expect(result?.kind === 'CHECKED' && result.gap).toEqual(ils(230_000))
  })

  it('goes quiet once the gap is acknowledged, without changing the figures', async () => {
    const { db, fundId } = await withFund()
    updateDeductionType(db, 'ded:pension', { linkedFundId: fundId }, NOW)
    updateDeductionType(db, 'ded:severance', { linkedFundId: fundId }, NOW)
    for (let month = 1; month <= 6; month += 1) slip(db, month)

    addSnapshot(
      db,
      { fundAccountId: fundId, asOfDate: localDate(2026, 1, 31), totalBalance: ils(10_000_000) },
      NOW,
    )
    const closing = addSnapshot(
      db,
      {
        fundAccountId: fundId,
        asOfDate: localDate(2026, 7, 31),
        totalBalance: ils(11_270_000),
        depositsSincePrevious: ils(6 * (50_000 + 75_000 + 83_333) - 230_000),
      },
      NOW,
    )

    acknowledgeDepositGap(db, closing.id, true, NOW)

    const result = fundDepositCheck(db, fundId, ILS)
    expect(result?.kind === 'CHECKED' && result.status).toBe('ACKNOWLEDGED')
    expect(result?.kind === 'CHECKED' && result.gap).toEqual(ils(230_000))
  })

  it('says it has one point rather than reporting a zero gap', async () => {
    const { db, fundId } = await withFund()
    addSnapshot(
      db,
      { fundAccountId: fundId, asOfDate: localDate(2026, 6, 30), totalBalance: ils(10_000_000) },
      NOW,
    )

    expect(fundDepositCheck(db, fundId, ILS)?.kind).toBe('NEEDS_TWO_POINTS')
  })

  it('has nothing to say about a fund that is not there', async () => {
    const db = await empty()
    expect(fundDepositCheck(db, 'nope', ILS)).toBeUndefined()
  })

  it('answers for every fund in one pass, agreeing with the single-fund check', async () => {
    const { db, fundId } = await withFund()
    const quiet = createFund(db, { name: 'Old job', fundType: 'PENSION', status: 'DORMANT' }, NOW)
    updateDeductionType(db, 'ded:pension', { linkedFundId: fundId }, NOW)
    updateDeductionType(db, 'ded:severance', { linkedFundId: fundId }, NOW)
    for (let month = 1; month <= 6; month += 1) slip(db, month)

    addSnapshot(
      db,
      { fundAccountId: fundId, asOfDate: localDate(2026, 1, 31), totalBalance: ils(10_000_000) },
      NOW,
    )
    addSnapshot(
      db,
      {
        fundAccountId: fundId,
        asOfDate: localDate(2026, 7, 31),
        totalBalance: ils(11_270_000),
        depositsSincePrevious: ils(6 * (50_000 + 75_000 + 83_333) - 230_000),
      },
      NOW,
    )

    const checks = fundDepositChecks(db, ILS)

    expect(checks.size).toBe(2)
    expect(checks.get(fundId)).toEqual(fundDepositCheck(db, fundId, ILS))
    // The dormant fund has one reading fewer than a window needs, and says so.
    expect(checks.get(quiet.id)?.kind).toBe('NEEDS_TWO_POINTS')
  })
})

describe('snapshotProblems — the parts are the pack’s identity (D-280)', () => {
  async function reading(parts: {
    employee?: number
    employer?: number
    severance?: number
  }): Promise<ReturnType<typeof snapshotProblems>> {
    const { db, fundId } = await withFund()
    const at = (minor: number | undefined) => (minor === undefined ? undefined : ils(minor))
    return snapshotProblems(
      db,
      {
        id: 'new',
        fundAccountId: fundId,
        asOfDate: localDate(2026, 7, 31),
        totalBalance: ils(10_000_000),
        employeeComponent: at(parts.employee),
        employerComponent: at(parts.employer),
        severanceComponent: at(parts.severance),
        depositsSincePrevious: undefined,
        feesChargedSincePrevious: undefined,
        returnSincePrevious: undefined,
        depositGapAcknowledged: false,
        note: undefined,
      },
      [],
    )
  }

  it('refuses parts that do not make the total, as the identity’s verdict', async () => {
    const judged = await reading({ employee: 3_000_000, employer: 5_000_000, severance: 1_000_000 })
    expect(judged.parts?.kind).toBe('FAILED')
    expect(judged.problems).toContain('COMPONENTS_DISAGREE')
    expect(judged.partsSentence).toMatch(/^parts: failed/)
  })

  it('tolerates the shekel a report rounds by', async () => {
    const judged = await reading({ employee: 3_000_000, employer: 5_000_000, severance: 1_999_950 })
    expect(judged.parts?.kind).toBe('PROVED')
    expect(judged.problems).toEqual([])
  })

  it('says nothing against a report that left a part out — unchecked, not failed', async () => {
    const judged = await reading({ employee: 3_000_000, employer: 5_000_000 })
    expect(judged.parts?.kind).toBe('UNCHECKED')
    expect(judged.problems).toEqual([])
  })

  it('is the same verdict format_rows gives the stored row', async () => {
    const { db, fundId } = await withFund()
    const stored = addSnapshot(
      db,
      {
        fundAccountId: fundId,
        asOfDate: localDate(2026, 7, 31),
        totalBalance: ils(10_000_000),
        employeeComponent: ils(3_000_000),
        employerComponent: ils(5_000_000),
        severanceComponent: ils(1_000_000),
      },
      NOW,
    )
    const declaration = readFormat(db, 'holding_reading')
    const row = declaration === undefined ? undefined : readRow(db, declaration, stored.id)
    if (declaration === undefined || row === undefined) throw new Error('no row')
    expect(verdictsOf(declaration, row).find((each) => each.identity.name === 'parts')?.verdict.kind).toBe('FAILED')
    expect(snapshotProblems(db, stored, []).parts?.kind).toBe('FAILED')
  })
})


describe('a return the provider agreed to (M28 U8, S6)', () => {
  it('is kept with the fund, apart from anything assumed, and can be cleared', async () => {
    const db = await createLedgerDatabase()
    const fund = createFund(db, { name: 'Study', fundType: 'STUDY_FUND', agreedReturnBasisPoints: 450 }, 1)
    expect(findFund(db, fund.id)?.agreedReturnBasisPoints).toBe(450)
    updateFund(db, fund.id, { name: 'Study fund' }, 2)
    expect(findFund(db, fund.id)?.agreedReturnBasisPoints).toBe(450)
    updateFund(db, fund.id, { agreedReturnBasisPoints: undefined }, 3)
    expect(findFund(db, fund.id)?.agreedReturnBasisPoints).toBeUndefined()
  })
})
