import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { fromMajorUnits } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { exportDatabase, openDatabase } from '@/data/db/database.ts'
import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { createDebt, listPayments } from '@/data/repositories/debtRepository.ts'
import { createDeductionType, findDeductionType, listDeductionTypes } from '@/data/repositories/deductionTypeRepository.ts'
import { createFund } from '@/data/repositories/fundRepository.ts'
import { createPaycheck } from '@/data/repositories/paycheckRepository.ts'
import { createGoal } from '@/data/repositories/savingsRepository.ts'

import { setDeductionTypesTool } from './deductionTypes.ts'
import { paychecksTool } from './paychecks.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

const NOW = 1_700_000_000_000
const ils = (major: number) => fromMajorUnits(major, 'ILS')

/** A synthetic document: a fund, a goal, a payroll loan, a repayment type and one slip. */
async function fixture(): Promise<{ path: string; fundId: string; goalId: string; debtId: string; loanTypeId: string }> {
  const db = await createLedgerDatabase()
  const fund = createFund(db, { name: 'Example pension', fundType: 'PENSION' }, NOW)
  const goal = createGoal(db, { name: 'Example goal', kind: 'LONG_TERM' }, NOW)
  const debt = createDebt(
    db,
    { name: 'Employer advance', kind: 'PAYROLL_LOAN', principalAmount: ils(10_000), openedDate: localDate(2026, 1, 1) },
    NOW,
  )
  const loanType = createDeductionType(db, { name: 'Advance repayment', kind: 'LOAN_REPAYMENT' }, NOW)
  createPaycheck(
    db,
    {
      period: { year: 2026, month: 6 },
      paymentDate: localDate(2026, 7, 1),
      gross: ils(20_000),
      net: ils(14_000),
      lines: [{ deductionTypeId: loanType.id, employeeAmount: ils(800) }],
    },
    NOW,
  )
  const path = join(await tempDir('emerald-deduction-types-'), 'doc.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  return { path, fundId: fund.id, goalId: goal.id, debtId: debt.id, loanTypeId: loanType.id }
}

async function reopen(path: string) {
  return openDatabase(new Uint8Array(await readFile(path)))
}

describe('set_deduction_types (M36 F1)', () => {
  it('dry-runs, then sets what several types pay into and count as in one call', async () => {
    const { path, fundId, debtId, loanTypeId } = await fixture()
    const types = [
      { type: 'ded:pension', pays_into: 'Example pension' },
      { type: 'Advance repayment', pays_into: 'Employer advance' },
      { type: 'ded:severance', counts_as: 'out_of_net_saving' },
    ]
    const before = await readFile(path)
    const preview = await setDeductionTypesTool.run({ path, types }, NO_CLIENT)
    expect(preview).toContain('fund: Example pension')
    expect(preview).toContain('Out of net, saving (set by hand)')
    expect(preview).toContain('Nothing has been written')
    expect(Buffer.compare(before, await readFile(path))).toBe(0)

    const done = await setDeductionTypesTool.run({ path, types, commit: true }, NO_CLIENT)
    expect(done).toContain('Set 3 deduction types.')
    expect(done).toContain('A fund finds its paycheck lines through this link')

    const db = await reopen(path)
    expect(findDeductionType(db, 'ded:pension')?.linkedFundId).toBe(fundId)
    expect(findDeductionType(db, loanTypeId)?.linkedDebtId).toBe(debtId)
    expect(findDeductionType(db, 'ded:severance')?.reducesNet).toBe(true)
    // The screen's sync after a link: the slip's repayment is a payment on the debt.
    expect(listPayments(db, debtId)).toHaveLength(1)
    db.close()

    // And `paychecks` says so, in the screen's words.
    const read = await paychecksTool.run({ path }, NO_CLIENT)
    expect(read).toContain('fund: Example pension')
    expect(read).toContain('debt: Employer advance')
    expect(read).toContain('Out of net, saving (set by hand)')
  })

  it('names one destination: a goal clears the fund, and null unlinks', async () => {
    const { path, goalId } = await fixture()
    await setDeductionTypesTool.run({ path, commit: true, types: [{ type: 'ded:study-fund', pays_into: 'Example pension' }] }, NO_CLIENT)
    await setDeductionTypesTool.run({ path, commit: true, types: [{ type: 'ded:study-fund', pays_into: goalId }] }, NO_CLIENT)
    let db = await reopen(path)
    expect(findDeductionType(db, 'ded:study-fund')?.linkedFundId).toBeUndefined()
    expect(findDeductionType(db, 'ded:study-fund')?.linkedSavingGoalId).toBe(goalId)
    db.close()

    await setDeductionTypesTool.run({ path, commit: true, types: [{ type: 'ded:study-fund', pays_into: null }] }, NO_CLIENT)
    db = await reopen(path)
    expect(findDeductionType(db, 'ded:study-fund')?.linkedSavingGoalId).toBeUndefined()
    db.close()
  })

  it('refuses a target of the wrong kind by name, and writes none of the batch', async () => {
    const { path } = await fixture()
    const before = await readFile(path)
    const types = [
      { type: 'ded:pension', pays_into: 'Example pension' },
      { type: 'ded:income-tax', pays_into: 'Example pension' },
      { type: 'ded:pension', counts_as: 'guess' },
      { type: 'ded:study-fund', pays_into: 'Employer advance' },
      { type: 'Parking', counts_as: 'out_of_net' },
      { type: 'ded:union-dues', pays_into: 'Nowhere' },
    ]
    const answer = await setDeductionTypesTool.run({ path, types, commit: true }, NO_CLIENT)
    expect(answer).toContain('does not count as saving, so it cannot pay into the fund Example pension')
    expect(answer).toContain('is not a loan repayment, so it cannot pay off the debt Employer advance')
    expect(answer).toContain('is named twice in this call')
    expect(answer).toContain('no deduction type called "Parking"')
    expect(answer).toContain('no fund, goal or debt called "Nowhere"')
    expect(answer).toContain('**Nothing was written**')
    expect(Buffer.compare(before, await readFile(path))).toBe(0)
  })

  it('takes a link a saving line could not, once the same entry says it counts as saving', async () => {
    const { path, fundId } = await fixture()
    const answer = await setDeductionTypesTool.run(
      { path, commit: true, types: [{ type: 'ded:union-dues', counts_as: 'out_of_net_saving', pays_into: 'Example pension' }] },
      NO_CLIENT,
    )
    expect(answer).toContain('Set 1 deduction type.')
    const db = await reopen(path)
    expect(findDeductionType(db, 'ded:union-dues')?.linkedFundId).toBe(fundId)
    expect(findDeductionType(db, 'ded:union-dues')?.countsAsSaving).toBe(true)
    db.close()
  })

  it('refuses an entry that says nothing to set, before opening the document', async () => {
    const { path } = await fixture()
    await expect(setDeductionTypesTool.run({ path, types: [{ type: 'ded:pension' }] }, NO_CLIENT)).rejects.toThrow(
      'says nothing to set',
    )
  })
})

describe('set_deduction_types makes, renames, orders and removes (M36 F2)', () => {
  it('makes the repayment type a payroll loan needs, links it and puts it first, in one call', async () => {
    const { path, debtId } = await fixture()
    const types = [{ name: 'Second advance', on_the_slip: 'Example slip label', kind: 'LOAN_REPAYMENT', pays_into: 'Employer advance' }]
    const before = await readFile(path)
    const preview = await setDeductionTypesTool.run({ path, types, order: ['Second advance'] }, NO_CLIENT)
    expect(preview).toContain('new: Loan repayment; on the paycheck: Example slip label')
    expect(preview).toContain('debt: Employer advance')
    expect(preview).toContain('**Order**: Second advance first')
    expect(Buffer.compare(before, await readFile(path))).toBe(0)

    const done = await setDeductionTypesTool.run({ path, types, order: ['Second advance'], commit: true }, NO_CLIENT)
    expect(done).toContain('Made 1 deduction type.')
    expect(done).toContain('Reordered the list.')
    const db = await reopen(path)
    const [first] = listDeductionTypes(db)
    expect(first?.name).toBe('Second advance')
    expect(first?.hebrewName).toBe('Example slip label')
    expect(first?.kind).toBe('LOAN_REPAYMENT')
    expect(first?.linkedDebtId).toBe(debtId)
    expect(first?.isBuiltIn).toBe(false)
    // The kind's guess, as the screen's Add gives it.
    expect(first?.reducesNet).toBe(true)
    expect(first?.countsAsSaving).toBe(false)
    db.close()
  })

  it('renames, clears what the slip calls it, and carries the guessed flags to a new kind', async () => {
    const { path, loanTypeId } = await fixture()
    await setDeductionTypesTool.run({ path, commit: true, types: [{ type: loanTypeId, on_the_slip: 'Example label' }] }, NO_CLIENT)
    const answer = await setDeductionTypesTool.run(
      {
        path,
        commit: true,
        types: [
          { type: 'Example label', name: 'Advance payback', on_the_slip: null },
          { type: 'ded:union-dues', kind: 'PENSION' },
        ],
      },
      NO_CLIENT,
    )
    expect(answer).toContain('renamed Advance payback; nothing on the paycheck')
    expect(answer).toContain('kind Pension')
    expect(answer).toContain('Set 2 deduction types.')
    const db = await reopen(path)
    expect(findDeductionType(db, loanTypeId)?.name).toBe('Advance payback')
    expect(findDeductionType(db, loanTypeId)?.hebrewName).toBeUndefined()
    expect(findDeductionType(db, 'ded:union-dues')?.kind).toBe('PENSION')
    expect(findDeductionType(db, 'ded:union-dues')?.countsAsSaving).toBe(true)
    db.close()
  })

  it('removes a type nothing uses, and refuses by name what the screen refuses, writing none of the batch', async () => {
    const { path } = await fixture()
    await setDeductionTypesTool.run({ path, commit: true, types: [{ name: 'Parking', kind: 'OTHER_DEDUCTION' }] }, NO_CLIENT)
    const before = await readFile(path)
    const refused = await setDeductionTypesTool.run(
      {
        path,
        commit: true,
        types: [
          { type: 'Parking', remove: true },
          { type: 'Advance repayment', remove: true },
          { type: 'ded:income-tax', remove: true },
          { type: 'ded:union-dues', name: 'pension' },
        ],
        order: ['Parking', 'Nowhere'],
      },
      NO_CLIENT,
    )
    expect(refused).toContain('1 stored paycheck line names Advance repayment; remove those lines first')
    expect(refused).toContain('is built in, and a built-in type is never removed')
    expect(refused).toContain('there is already a deduction type called pension')
    expect(refused).toContain('`order` names Parking, which this call removes')
    expect(refused).toContain('`order` names "Nowhere", and there is no such type')
    expect(refused).toContain('**Nothing was written**')
    expect(Buffer.compare(before, await readFile(path))).toBe(0)

    const done = await setDeductionTypesTool.run({ path, commit: true, types: [{ type: 'Parking', remove: true }] }, NO_CLIENT)
    expect(done).toContain('Removed 1 deduction type.')
    const db = await reopen(path)
    expect(listDeductionTypes(db).some((type) => type.name === 'Parking')).toBe(false)
    db.close()
  })

  it('frees a removed type’s name for a new one in the same call', async () => {
    const { path } = await fixture()
    await setDeductionTypesTool.run({ path, commit: true, types: [{ name: 'Parking', kind: 'OTHER_DEDUCTION' }] }, NO_CLIENT)
    const answer = await setDeductionTypesTool.run(
      { path, commit: true, types: [{ type: 'Parking', remove: true }, { name: 'Parking', kind: 'BENEFIT_IN_KIND' }] },
      NO_CLIENT,
    )
    expect(answer).toContain('Made 1 deduction type. Removed 1 deduction type.')
    const db = await reopen(path)
    expect(listDeductionTypes(db).find((type) => type.name === 'Parking')?.kind).toBe('BENEFIT_IN_KIND')
    db.close()
  })

  it('refuses a new type without a kind, and a removal that says more, before opening the document', async () => {
    const { path } = await fixture()
    await expect(setDeductionTypesTool.run({ path, types: [{ name: 'Parking' }] }, NO_CLIENT)).rejects.toThrow('needs a `name` and a `kind`')
    await expect(
      setDeductionTypesTool.run({ path, types: [{ type: 'Parking', remove: true, name: 'Other' }] }, NO_CLIENT),
    ).rejects.toThrow('takes nothing else')
    await expect(setDeductionTypesTool.run({ path }, NO_CLIENT)).rejects.toThrow('Give `types`')
  })
})
