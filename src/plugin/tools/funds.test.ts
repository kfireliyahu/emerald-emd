import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { exportDatabase, openDatabase } from '@/data/db/database.ts'
import { updateDeductionType } from '@/data/repositories/deductionTypeRepository.ts'
import {
  listFundDeposits,
  listFunds,
  listSnapshots,
} from '@/data/repositories/fundRepository.ts'

import { fundsTool, recordFundReadingsTool } from './funds.ts'
import { recordPaychecksTool } from './paychecks.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'
import { listBackups } from '../backup.ts'

async function fixture(): Promise<string> {
  const db = await createLedgerDatabase()
  const path = join(await tempDir('emerald-funds-'), 'doc.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  return path
}

async function reopen(path: string) {
  return openDatabase(await readFile(path))
}

/** One fund and two quarterly readings — the least a deposit check can run on. */
const TWO_QUARTERS = [
  {
    name: 'Menora pension',
    fund_type: 'PENSION',
    employer_name: 'Acme',
    fee_on_accumulation_basis_points: 50,
    fee_on_deposit_basis_points: 150,
    as_of_date: '2026-01-31',
    total_balance: 200_000,
  },
  {
    name: 'Menora pension',
    as_of_date: '2026-04-30',
    total_balance: 214_000,
    deposits_since_previous: 7_800,
    fees_charged_since_previous: 260,
    return_since_previous: 6_460,
  },
]

/**
 * Three salary months whose pension line feeds the fund.
 *
 * The link is made the way the app makes it, because that is the only way it
 * can be made: `DeductionType.linkedFundId` is F13's dependency and the
 * plugin deliberately does not write it.
 */
async function withPayslips(path: string, pensionPerMonth: number): Promise<void> {
  const db = await reopen(path)
  const fund = listFunds(db)[0]
  updateDeductionType(db, 'ded:pension', { linkedFundId: fund?.id }, Date.now())
  await writeFile(path, exportDatabase(db))
  db.close()

  await recordPaychecksTool.run(
    {
      path,
      commit: true,
      paychecks: ['2026-01', '2026-02', '2026-03'].map((period) => ({
        period,
        payment_date: `${period}-28`,
        gross: 20_000,
        net: 14_000,
        lines: [
          {
            deduction_type_id: 'ded:pension',
            employee_amount: pensionPerMonth / 2,
            employer_amount: pensionPerMonth / 2,
          },
        ],
      })),
    },
    NO_CLIENT,
  )
}

describe('funds', () => {
  it('says the document has none, and asks for the reports by name', async () => {
    const path = await fixture()
    const text = await fundsTool.run({ path }, NO_CLIENT)

    expect(text).toContain('No pension, hishtalmut or savings funds recorded')
    expect(text).toContain('`record_fund_readings`')
    expect(text).toContain('dormant funds from previous jobs')
    // The fund-manager ids, which `institution_id` is quoted back from.
    expect(text).toContain('inst:menora')
    expect(text).toContain('PROVIDENT_FOR_INVESTMENT')
  })

  it('reports the balance, the measured fee and what a dormant fund costs', async () => {
    const path = await fixture()
    await recordFundReadingsTool.run({ path, commit: true, readings: TWO_QUARTERS }, NO_CLIENT)

    const text = await fundsTool.run({ path }, NO_CLIENT)

    expect(text).toContain('Menora pension')
    expect(text).toContain('₪214,000.00')
    // ₪260 of fees on a ~₪207,000 average over three months, annualized: about
    // 0.50%, which is what the policy claims. Measured beside stated is the
    // whole argument of the fee panel.
    expect(text).toMatch(/0\.5\d*% measured, 0\.5% stated/)
    expect(text).toContain('No deduction type points at')
    expect(text).toContain('set_deduction_types')
  })

  it('answers the question the whole feature exists for', async () => {
    // ₪2,600 a month deducted over three salary months is ₪7,800 owed, and the
    // fund reports receiving exactly that. The lag is what makes it line up:
    // January's deduction arrives in February.
    const reconciling = await fixture()
    await recordFundReadingsTool.run(
      { path: reconciling, commit: true, readings: TWO_QUARTERS },
      NO_CLIENT,
    )
    await withPayslips(reconciling, 2_600)

    const good = await fundsTool.run({ path: reconciling }, NO_CLIENT)
    expect(good).toContain('reconciles')

    // The same fund, the same report, a bigger deduction on the slips: the gap
    // is the sentence people never get to see.
    const missing = await fixture()
    await recordFundReadingsTool.run(
      { path: missing, commit: true, readings: TWO_QUARTERS },
      NO_CLIENT,
    )
    await withPayslips(missing, 4_000)

    const bad = await fundsTool.run({ path: missing }, NO_CLIENT)
    expect(bad).toContain('missing')

    const detail = await fundsTool.run(
      { path: missing, fund_id: (await reopen(missing).then((db) => {
        const id = listFunds(db)[0]?.id
        db.close()
        return id
      })) ?? '' },
      NO_CLIENT,
    )
    expect(detail).toContain('is unaccounted for')
    expect(detail).toContain('payroll department')
    expect(detail).toContain('## The working, window by window')
    expect(detail).toContain('Read this as the working, not as a verdict')
    expect(detail).toContain('## Readings')
  })

  it('prints a surplus as a size, never as a minus sign', async () => {
    // Found by driving the built server. The gap is expected-minus-reported and
    // is negative when the fund received more, so "-₪3,320.00 — the fund
    // received more than the payslips show" put a minus in front of a sentence
    // that already carried the direction, and read as the opposite finding.
    const path = await fixture()
    await recordFundReadingsTool.run({ path, commit: true, readings: TWO_QUARTERS }, NO_CLIENT)
    await withPayslips(path, 1_000)

    const text = await fundsTool.run({ path }, NO_CLIENT)

    expect(text).toContain('more received than the paychecks show')
    expect(text).not.toContain('-₪')
  })

  it('refuses a fund id it does not have', async () => {
    const path = await fixture()
    await recordFundReadingsTool.run({ path, commit: true, readings: TWO_QUARTERS }, NO_CLIENT)

    await expect(fundsTool.run({ path, fund_id: 'nope' }, NO_CLIENT)).rejects.toThrow(
      /No fund with id nope/,
    )
  })
})

describe('record_fund_readings', () => {
  it('dry-runs by default, writing nothing', async () => {
    const path = await fixture()
    const before = await readFile(path)

    const text = await recordFundReadingsTool.run({ path, readings: TWO_QUARTERS }, NO_CLIENT)

    expect(text).toContain('Nothing has been written')
    expect(text).toContain('2 readings')
    expect(text).toContain('Would create')
    expect(await readFile(path)).toEqual(before)

    const db = await reopen(path)
    expect(listFunds(db)).toEqual([])
    db.close()
  })

  it('creates the fund once for the batch, however many readings name it', async () => {
    // Four quarterly reports are four entries naming one fund. A second
    // "Menora pension" would split the deposit check in half and make both
    // halves look wrong, which is worse than not recording anything.
    const path = await fixture()

    const text = await recordFundReadingsTool.run(
      { path, commit: true, readings: TWO_QUARTERS },
      NO_CLIENT,
    )

    expect(text).toContain('Recorded 2 readings')
    expect(text).toContain('created 1 fund: Menora pension')
    expect(text).toContain('.bak')
    expect((await listBackups(path)).length).toBe(1)

    const db = await reopen(path)
    const funds = listFunds(db)
    expect(funds.length).toBe(1)
    expect(funds[0]?.fundType).toBe('PENSION')
    // Basis points, never a decimal.
    expect(funds[0]?.fees.onAccumulationBasisPoints).toBe(50)

    const snapshots = listSnapshots(db, funds[0]?.id ?? '')
    expect(snapshots.length).toBe(2)
    expect(snapshots[1]?.totalBalance.minor).toBe(21_400_000)
    expect(snapshots[1]?.depositsSincePrevious?.minor).toBe(780_000)
    // An absent component is "the report did not say", not zero.
    expect(snapshots[1]?.employeeComponent).toBeUndefined()
    db.close()
  })

  it('says where the deposit check stands once the reading is in', async () => {
    const path = await fixture()
    await recordFundReadingsTool.run(
      { path, commit: true, readings: [TWO_QUARTERS[0] ?? {}] },
      NO_CLIENT,
    )
    await withPayslips(path, 2_600)

    const text = await recordFundReadingsTool.run(
      { path, commit: true, readings: [TWO_QUARTERS[1] ?? {}] },
      NO_CLIENT,
    )

    expect(text).toContain('Where the deposit check stands now')
    expect(text).toContain('reconciles')
  })

  it('adds a reading to a fund that already exists, by name', async () => {
    const path = await fixture()
    await recordFundReadingsTool.run(
      { path, commit: true, readings: [TWO_QUARTERS[0] ?? {}] },
      NO_CLIENT,
    )

    const text = await recordFundReadingsTool.run(
      { path, readings: [{ name: 'menora PENSION', as_of_date: '2026-07-31', total_balance: 221_000 }] },
      NO_CLIENT,
    )

    expect(text).toContain('1 reading** would be recorded')
    expect(text).not.toContain('Would create')
  })

  it('refuses to edit a fund it is only supposed to add a reading to', async () => {
    const path = await fixture()
    await recordFundReadingsTool.run(
      { path, commit: true, readings: [TWO_QUARTERS[0] ?? {}] },
      NO_CLIENT,
    )

    const text = await recordFundReadingsTool.run(
      {
        path,
        readings: [
          {
            name: 'Menora pension',
            fee_on_accumulation_basis_points: 30,
            as_of_date: '2026-07-31',
            total_balance: 221_000,
          },
        ],
      },
      NO_CLIENT,
    )

    expect(text).toContain('already exists, and this entry also describes it')
    expect(text).toContain('#/wealth')
    expect(text).toContain('Nothing to write')
  })

  it('refuses a second reading for a day the fund already has', async () => {
    const path = await fixture()
    await recordFundReadingsTool.run({ path, commit: true, readings: TWO_QUARTERS }, NO_CLIENT)

    const again = await recordFundReadingsTool.run(
      { path, readings: [{ name: 'Menora pension', as_of_date: '2026-04-30', total_balance: 9 }] },
      NO_CLIENT,
    )
    expect(again).toContain('already has a reading for that date')

    // And two entries in one batch for the same day, which the unique index
    // would otherwise catch only at commit.
    const fresh = await fixture()
    const collide = await recordFundReadingsTool.run(
      {
        path: fresh,
        readings: [
          { name: 'A', fund_type: 'STUDY_FUND', as_of_date: '2026-01-31', total_balance: 1_000 },
          { name: 'A', as_of_date: '2026-01-31', total_balance: 2_000 },
        ],
      },
      NO_CLIENT,
    )
    expect(collide).toContain('already has a reading for that date')
  })

  it('refuses components that do not add up, and says why a zero is not the fix', async () => {
    const path = await fixture()

    const text = await recordFundReadingsTool.run(
      {
        path,
        readings: [
          {
            name: 'Migdal hishtalmut',
            fund_type: 'STUDY_FUND',
            as_of_date: '2026-01-31',
            total_balance: 100_000,
            employee_component: 30_000,
            employer_component: 30_000,
            severance_component: 10_000,
          },
        ],
      },
      NO_CLIENT,
    )

    expect(text).toContain('do not add up')
    expect(text).toContain('the report did not say')
  })

  it('teaches the shape rather than throwing a stack trace', async () => {
    const path = await fixture()

    await expect(recordFundReadingsTool.run({ path, readings: [] }, NO_CLIENT)).rejects.toThrow(
      /non-empty array/,
    )
    await expect(
      recordFundReadingsTool.run({ path, readings: [{ total_balance: 1 }] }, NO_CLIENT),
    ).rejects.toThrow(/`fund_id` from `funds`, or a `name`/)
    await expect(
      recordFundReadingsTool.run(
        { path, readings: [{ name: 'X', fund_type: 'SUPERANNUATION' }] },
        NO_CLIENT,
      ),
    ).rejects.toThrow(/fund_type must be one of/)
    // The unit trap worth catching at the edge: a fee entered as 0.5 would be
    // stored as five hundredths of a basis point and quietly make every fee
    // figure a hundred times too small.
    await expect(
      recordFundReadingsTool.run(
        {
          path,
          readings: [{ name: 'X', fund_type: 'PENSION', fee_on_accumulation_basis_points: 0.5 }],
        },
        NO_CLIENT,
      ),
    ).rejects.toThrow(/basis points/)
    await expect(
      recordFundReadingsTool.run(
        { path, readings: [{ name: 'X', fund_type: 'PENSION', total_balance: 100 }] },
        NO_CLIENT,
      ),
    ).rejects.toThrow(/as_of_date/)
  })

  it('refuses a name it would have to create with no type to create it as', async () => {
    const path = await fixture()

    const text = await recordFundReadingsTool.run(
      { path, readings: [{ name: 'Some fund', as_of_date: '2026-01-31', total_balance: 1_000 }] },
      NO_CLIENT,
    )

    expect(text).toContain('would be created')
    expect(text).toContain('needs a `fund_type`')
    expect(text).toContain('Nothing to write')
  })
})

/**
 * The deposit table a report prints, through the conversation rather than
 * through the app's reader (D-153).
 *
 * The app derives this table off a page and proves it against the deposits
 * figure; here a model has read the page itself and is transcribing it, which is
 * how every other write in this plugin works. What both routes share is the rule
 * that makes the table worth having: **a row states the salary month it is
 * for**, and one that does not is refused rather than stored.
 */
describe('record_fund_readings with a deposit table', () => {
  const WITH_TABLE = [
    {
      name: 'Menora pension',
      fund_type: 'PENSION',
      as_of_date: '2026-06-30',
      total_balance: 24_621,
      deposits_since_previous: 12_000,
      deposits: [
        {
          salary_month: '2025-12',
          deposit_date: '2026-01-04',
          employer_name: 'מעבדות תוכנה',
          employee: 1_500,
          employer: 1_750,
          severance: 750,
        },
        {
          salary_month: '2026-01',
          deposit_date: '2026-02-04',
          employer_name: 'מעבדות תוכנה',
          employee: 1_500,
          employer: 1_750,
          severance: 750,
        },
        {
          salary_month: '2026-02',
          deposit_date: '2026-06-04',
          employer_name: 'מעבדות תוכנה',
          employee: 1_500,
          employer: 1_750,
          severance: 750,
        },
      ],
    },
  ]

  it('shows the months it would write before it writes them', async () => {
    const path = await fixture()
    const text = await recordFundReadingsTool.run({ path, readings: WITH_TABLE }, NO_CLIENT)

    expect(text).toContain('Nothing has been written')
    expect(text).toContain('3 deposits')
    // Named by month, not merely counted: a row for 2026-02 that arrived in
    // June is the thing a dry run has to be able to show.
    expect(text).toContain('2025-12')
    expect(text).toContain('2026-02')
  })

  it('writes them against the reading they came off', async () => {
    const path = await fixture()
    await recordFundReadingsTool.run({ path, commit: true, readings: WITH_TABLE }, NO_CLIENT)

    const db = await reopen(path)
    const fund = listFunds(db)[0]!
    const stored = listFundDeposits(db, fund.id)
    const snapshot = listSnapshots(db, fund.id)[0]

    expect(stored).toHaveLength(3)
    expect(stored.every((one) => one.snapshotId === snapshot?.id)).toBe(true)
    expect(stored.map((one) => one.salaryMonth?.month)).toEqual([12, 1, 2])
    expect(stored[0]?.employerName).toBe('מעבדות תוכנה')
    db.close()
  })

  it('refuses a row with no salary month rather than storing it', async () => {
    const path = await fixture()
    const before = await readFile(path)

    await expect(
      recordFundReadingsTool.run(
        {
          path,
          commit: true,
          readings: [{ ...WITH_TABLE[0], deposits: [{ employee: 1_500, employer: 1_750 }] }],
        },
        NO_CLIENT,
      ),
    ).rejects.toThrow('salary_month')

    // Refused before anything opened the document for writing: no rows, and no
    // backup either, which is the shape every other refusal in this plugin has.
    expect(await readFile(path)).toEqual(before)
  })

  it('reads the months back with the lag measured rather than assumed', async () => {
    const path = await fixture()
    await recordFundReadingsTool.run({ path, commit: true, readings: WITH_TABLE }, NO_CLIENT)
    // ₪4,000 a month against ₪4,000 deposited, so the amounts agree and what is
    // left to say is *when* they arrived.
    await withPayslips(path, 4_000)

    const db = await reopen(path)
    const fund = listFunds(db)[0]!
    db.close()

    const text = await fundsTool.run({ path, fund_id: fund.id }, NO_CLIENT)
    expect(text).toContain('Month by month')
    // February's money turned up in June: four months, not the assumed one.
    expect(text).toContain('4 months')
  })
})
