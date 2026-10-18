import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { exportDatabase, openDatabase } from '@/data/db/database.ts'
import { updateDeductionType } from '@/data/repositories/deductionTypeRepository.ts'
import { createFund } from '@/data/repositories/fundRepository.ts'
import { listPaychecksWithLines } from '@/data/repositories/paycheckRepository.ts'
import { createDeductionType } from '@/data/repositories/deductionTypeRepository.ts'
import { createDebt, listPayments } from '@/data/repositories/debtRepository.ts'
import {
  createGoal,
  createHolding,
  createHoldingPlace,
  listDeposits,
} from '@/data/repositories/savingsRepository.ts'
import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'

import { paychecksTool, recordPaychecksTool } from './paychecks.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'
import { listBackups } from '../backup.ts'

/**
 * An empty document, which is where a payslip conversation actually starts.
 *
 * The interesting fixture here is not a ledger — nothing in F04 reads one — it
 * is the **vocabulary**, which the ledger pack seeds into every document under
 * the ids migration 012 gave it (M25 U7). A slip cannot be written without
 * those ids, so the tests below quote them exactly as a conversation would
 * have to.
 */
async function fixture(options: { readonly withFund?: boolean } = {}): Promise<string> {
  const db = await createLedgerDatabase()
  const now = 1_700_000_000_000

  if (options.withFund === true) {
    const fund = createFund(db, { name: 'Menora pension', fundType: 'PENSION' }, now)
    // The link that turns a pension line into a fund's deposits — the screen's
    // and `set_deduction_types`' write, made here directly.
    updateDeductionType(db, 'ded:pension', { linkedFundId: fund.id }, now)
  }

  const path = join(await tempDir('emerald-paychecks-'), 'doc.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  return path
}

async function reopen(path: string) {
  return openDatabase(await readFile(path))
}

/** One ordinary Israeli slip: gross, net, and an itemization that reconciles. */
function slip(period: string, paymentDate: string, extra: Record<string, unknown> = {}) {
  return {
    period,
    payment_date: paymentDate,
    gross: 20_000,
    net: 14_000,
    lines: [
      { deduction_type_id: 'ded:income-tax', employee_amount: 3_200 },
      { deduction_type_id: 'ded:national-insurance', employee_amount: 700 },
      { deduction_type_id: 'ded:health-tax', employee_amount: 620 },
      { deduction_type_id: 'ded:pension', employee_amount: 1_200, employer_amount: 1_400 },
      { deduction_type_id: 'ded:study-fund', employee_amount: 280, employer_amount: 1_500 },
    ],
    ...extra,
  }
}

describe('paychecks', () => {
  it('says the document has none, and still hands over the ids a slip needs', async () => {
    // The empty answer is the one that matters most: a conversation that cannot
    // see the vocabulary cannot write a first slip, and the app has it as a
    // picker beside the form where a tool answer has to say it (D-111).
    const path = await fixture()
    const text = await paychecksTool.run({ path }, NO_CLIENT)

    expect(text).toContain('No paychecks recorded')
    expect(text).toContain('`record_paychecks`')
    expect(text).toContain('ded:pension')
    expect(text).toContain('קרן השתלמות')
  })

  it('reports the derived figures, the gaps and where each type pays into', async () => {
    const path = await fixture({ withFund: true })
    await recordPaychecksTool.run(
      { path, commit: true, paychecks: [slip('2026-01', '2026-02-10'), slip('2026-03', '2026-04-10')] },
      NO_CLIENT,
    )

    const text = await paychecksTool.run({ path }, NO_CLIENT)

    expect(text).toContain('2026-01')
    expect(text).toContain('2026-03')
    // Gross + both employer shares, which is the whole point of the column.
    expect(text).toContain('₪22,900.00')
    // A month with no slip is information, never a zero.
    expect(text).toContain('2026-02')
    expect(text).toMatch(/no paycheck at all/)
    // The link a fund finds its payslip lines through, reported where it exists.
    expect(text).toContain('fund: Menora pension')
    expect(text).toContain('#/paychecks/deductions')
  })

  it('prints the itemization only when asked', async () => {
    const path = await fixture()
    await recordPaychecksTool.run(
      { path, commit: true, paychecks: [slip('2026-01', '2026-02-10')] },
      NO_CLIENT,
    )

    expect(await paychecksTool.run({ path }, NO_CLIENT)).not.toContain('## Itemization')
    expect(await paychecksTool.run({ path, include_lines: true }, NO_CLIENT)).toContain(
      '## Itemization',
    )
  })
})

describe('record_paychecks', () => {
  it('dry-runs by default, writing nothing', async () => {
    const path = await fixture()
    const before = await readFile(path)

    const text = await recordPaychecksTool.run(
      { path, paychecks: [slip('2026-01', '2026-02-10')] },
      NO_CLIENT,
    )

    expect(text).toContain('Nothing has been written')
    expect(text).toContain('1 paycheck')
    expect(await readFile(path)).toEqual(before)

    const db = await reopen(path)
    expect(listPaychecksWithLines(db)).toEqual([])
    db.close()
  })

  it('shows whether the itemization reconciles, and never blocks on it', async () => {
    // docs/f04 is explicit: the delta is information, not an error. The app must
    // never argue with the slip, so a slip that does not add up is still written
    // — with the difference named, and the likely cause of the negative case
    // named too.
    const path = await fixture()

    const reconciling = await recordPaychecksTool.run(
      { path, paychecks: [slip('2026-01', '2026-02-10')] },
      NO_CLIENT,
    )
    expect(reconciling).toContain('to the agora')
    expect(reconciling).not.toContain('does not reconcile on')

    const short = await recordPaychecksTool.run(
      {
        path,
        paychecks: [
          {
            period: '2026-01',
            payment_date: '2026-02-10',
            gross: 20_000,
            net: 14_000,
            lines: [{ deduction_type_id: 'ded:income-tax', employee_amount: 3_200 }],
          },
        ],
      },
      NO_CLIENT,
    )
    expect(short).toContain('unexplained')
    expect(short).toContain('does not reconcile on')
    expect(short).toContain('ded:other')

    const over = await recordPaychecksTool.run(
      {
        path,
        paychecks: [
          {
            period: '2026-01',
            payment_date: '2026-02-10',
            gross: 20_000,
            net: 14_000,
            lines: [{ deduction_type_id: 'ded:income-tax', employee_amount: 9_000 }],
          },
        ],
      },
      NO_CLIENT,
    )
    expect(over).toContain('over-itemized')
    expect(over).toContain('employer share')
  })

  it('writes the batch on commit, with its lines, and copies the document first', async () => {
    const path = await fixture()

    const text = await recordPaychecksTool.run(
      {
        path,
        commit: true,
        paychecks: [slip('2026-01', '2026-02-10'), slip('2026-02', '2026-03-10')],
      },
      NO_CLIENT,
    )

    expect(text).toContain('Recorded 2 paychecks')
    expect(text).toContain('.bak')

    const backups = await listBackups(path)
    expect(backups.length).toBe(1)

    const db = await reopen(path)
    const saved = listPaychecksWithLines(db)
    expect(saved.length).toBe(2)
    expect(saved[0]?.lines.length).toBe(5)
    // Minor units, never a float: 20,000 shekels is 2,000,000 agorot.
    expect(saved[0]?.paycheck.gross.minor).toBe(2_000_000)
    expect(saved[0]?.paycheck.net.minor).toBe(1_400_000)
    // The employer share stays on the same line as the employee share (D-048).
    const pension = saved[0]?.lines.find((line) => line.deductionTypeId === 'ded:pension')
    expect(pension?.employeeAmount.minor).toBe(120_000)
    expect(pension?.employerAmount?.minor).toBe(140_000)
    db.close()
  })

  it('feeds the goals and the debts a slip pays into, as a screen does (M36 U01)', async () => {
    const db = await createLedgerDatabase()
    const now = 1_700_000_000_000
    const place = createHoldingPlace(db, { name: 'Bank', kind: 'CHECKING' }, now)
    const cash = createHolding(
      db,
      { holdingPlaceId: place.id, name: 'Cash', kind: 'CASH', provenance: 'RECORDED', isLiquid: true },
      now,
    )
    const goal = createGoal(db, { name: 'Hishtalmut', kind: 'LONG_TERM', defaultHoldingId: cash.id }, now)
    updateDeductionType(db, 'ded:study-fund', { linkedSavingGoalId: goal.id }, now)
    const debt = createDebt(
      db,
      {
        name: 'Employer advance',
        kind: 'PAYROLL_LOAN',
        principalAmount: money(1_000_000, 'ILS'),
        openedDate: localDate(2026, 1, 1),
      },
      now,
    )
    const loan = createDeductionType(
      db,
      { name: 'Loan repayment', kind: 'LOAN_REPAYMENT', linkedDebtId: debt.id },
      now,
    )
    const path = join(await tempDir('emerald-paychecks-'), 'doc.emd')
    await writeFile(path, exportDatabase(db))
    db.close()

    const written = slip('2026-06', '2026-07-01')
    await recordPaychecksTool.run(
      {
        path,
        commit: true,
        paychecks: [{ ...written, lines: [...written.lines, { deduction_type_id: loan.id, employee_amount: 800 }] }],
      },
      NO_CLIENT,
    )

    const after = await reopen(path)
    // The study-fund line, both shares, is a deposit on the goal it feeds.
    expect(listDeposits(after, { goalId: goal.id }).map((deposit) => deposit.amount.minor)).toEqual([178_000])
    // And the loan line is a payment on the debt it repays.
    expect(listPayments(after, debt.id)).toHaveLength(1)
    after.close()
  })

  it('refuses a deduction type the document does not have, and names the screen', async () => {
    const path = await fixture()

    const text = await recordPaychecksTool.run(
      {
        path,
        paychecks: [
          {
            period: '2026-01',
            payment_date: '2026-02-10',
            gross: 20_000,
            net: 19_000,
            lines: [{ deduction_type_id: 'ded:parking', employee_amount: 100 }],
          },
        ],
      },
      NO_CLIENT,
    )

    expect(text).toContain('Nothing to record')
    expect(text).toContain('ded:parking')
    expect(text).toContain('ded:other')
    expect(text).toContain('#/paychecks/deductions')
  })

  it('refuses what no payslip can be, using the domain’s own list', async () => {
    const path = await fixture()

    const swapped = await recordPaychecksTool.run(
      {
        path,
        paychecks: [{ period: '2026-01', payment_date: '2026-02-10', gross: 14_000, net: 20_000 }],
      },
      NO_CLIENT,
    )
    expect(swapped).toContain('look swapped')
    expect(swapped).toContain('Nothing to record')

    const negative = await recordPaychecksTool.run(
      {
        path,
        paychecks: [{ period: '2026-01', payment_date: '2026-02-10', gross: 20_000, net: -5 }],
      },
      NO_CLIENT,
    )
    expect(negative).toContain('typo')
  })

  it('warns about a second slip for a salary month rather than refusing it', async () => {
    // A 13th salary and a second job are both exactly this, so it is allowed —
    // but it is also what running the same batch twice looks like, and nothing
    // here deduplicates.
    const path = await fixture()
    await recordPaychecksTool.run(
      { path, commit: true, paychecks: [slip('2026-01', '2026-02-10')] },
      NO_CLIENT,
    )

    const text = await recordPaychecksTool.run(
      { path, paychecks: [slip('2026-01', '2026-02-10')] },
      NO_CLIENT,
    )

    expect(text).toContain('already have')
    expect(text).toContain('deduplicates')
    expect(text).toContain('1 paycheck** would be recorded')
  })

  it('names the funds a batch feeds, and the saving lines that feed nothing', async () => {
    const linked = await fixture({ withFund: true })
    const fed = await recordPaychecksTool.run(
      { path: linked, paychecks: [slip('2026-01', '2026-02-10')] },
      NO_CLIENT,
    )
    expect(fed).toContain('Menora pension')
    // The study fund still points at nothing, which is the failure worth saying.
    expect(fed).toContain('Study fund')
    expect(fed).toContain('at no fund')

    const bare = await fixture()
    const unfed = await recordPaychecksTool.run(
      { path: bare, paychecks: [slip('2026-01', '2026-02-10')] },
      NO_CLIENT,
    )
    expect(unfed).toContain('Pension, Study fund')
    expect(unfed).toContain('set_deduction_types')
  })

  it('teaches the shape rather than throwing a stack trace', async () => {
    const path = await fixture()

    await expect(recordPaychecksTool.run({ path, paychecks: [] }, NO_CLIENT)).rejects.toThrow(
      /non-empty array/,
    )
    await expect(
      recordPaychecksTool.run(
        { path, paychecks: [{ period: 'January', payment_date: '2026-02-10', gross: 1, net: 1 }] },
        NO_CLIENT,
      ),
    ).rejects.toThrow(/YYYY-MM/)
    await expect(
      recordPaychecksTool.run(
        { path, paychecks: [{ period: '2026-01', gross: 1, net: 1 }] },
        NO_CLIENT,
      ),
    ).rejects.toThrow(/payment_date/)
    await expect(
      recordPaychecksTool.run(
        {
          path,
          paychecks: [
            {
              period: '2026-01',
              payment_date: '2026-02-10',
              gross: 20_000,
              net: 14_000,
              lines: [{ deduction_type_id: 'ded:income-tax', employee_amount: -3_200 }],
            },
          ],
        },
        NO_CLIENT,
      ),
    ).rejects.toThrow(/magnitudes/)
  })
})
