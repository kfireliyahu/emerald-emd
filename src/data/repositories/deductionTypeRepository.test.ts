import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { createLedgerDatabase } from '../packs/ledger/testing.ts'
import {
  createDeductionType,
  deductionTypeUsage,
  deductionTypeUsageCounts,
  deleteDeductionType,
  DeductionTypeInUseError,
  findDeductionType,
  listDeductionTypes,
  reorderDeductionTypes,
  updateDeductionType,
} from './deductionTypeRepository.ts'
import { createPaycheck } from './paycheckRepository.ts'

describe('the built-in vocabulary', () => {
  it('is seeded by the pack, under the ids migration 012 gave it (M25 U7)', async () => {
    const db = await createLedgerDatabase()

    const types = listDeductionTypes(db)

    expect(types).toHaveLength(10)
    expect(types.every((type) => type.isBuiltIn)).toBe(true)
    expect(types.map((type) => type.id)).toEqual([
      'ded:income-tax',
      'ded:national-insurance',
      'ded:health-tax',
      'ded:pension',
      'ded:study-fund',
      'ded:severance',
      'ded:union-dues',
      'ded:meal-card',
      'ded:company-car',
      'ded:other',
    ])
  })

  it('names pension once, not once per side (D-048)', async () => {
    const db = await createLedgerDatabase()

    const names = listDeductionTypes(db).map((type) => type.name.toLowerCase())

    expect(names.filter((name) => name.includes('pension'))).toEqual(['pension'])
    expect(names.filter((name) => name.includes('study fund'))).toEqual(['study fund'])
    expect(names.some((name) => name.includes('employer'))).toBe(false)
  })

  it('carries the two flags that decide which side of the slip an amount is on', async () => {
    const db = await createLedgerDatabase()

    expect(findDeductionType(db, 'ded:income-tax')).toMatchObject({
      kind: 'TAX',
      reducesNet: true,
      countsAsSaving: false,
      hebrewName: 'מס הכנסה',
    })
    expect(findDeductionType(db, 'ded:pension')).toMatchObject({
      reducesNet: true,
      countsAsSaving: true,
    })
    // Employer-side only: severance accrues without ever touching net.
    expect(findDeductionType(db, 'ded:severance')).toMatchObject({
      reducesNet: false,
      countsAsSaving: true,
    })
    // Notional: inflates gross for tax without being cash.
    expect(findDeductionType(db, 'ded:company-car')).toMatchObject({
      reducesNet: false,
      countsAsSaving: false,
    })
  })
})

describe('createDeductionType', () => {
  it('adds the user’s own type at the end of the list', async () => {
    const db = await createLedgerDatabase()

    const parking = createDeductionType(db, { name: 'Parking', kind: 'OTHER_DEDUCTION' }, 1000)

    expect(parking.isBuiltIn).toBe(false)
    expect(parking.reducesNet).toBe(true)
    expect(listDeductionTypes(db).at(-1)?.id).toBe(parking.id)
  })
})

describe('updateDeductionType', () => {
  it('edits a built-in, because what an employer calls a line is a fact about this document', async () => {
    const db = await createLedgerDatabase()

    updateDeductionType(db, 'ded:pension', { hebrewName: 'פנסיה מקיפה', linkedFundId: 'fund-1' }, 2000)

    expect(findDeductionType(db, 'ded:pension')).toMatchObject({
      name: 'Pension',
      hebrewName: 'פנסיה מקיפה',
      linkedFundId: 'fund-1',
      countsAsSaving: true,
    })
  })

  it('unlinks when the key is named with nothing, and keeps what is not named', async () => {
    const db = await createLedgerDatabase()
    updateDeductionType(db, 'ded:study-fund', { linkedFundId: 'fund-2' }, 2000)

    updateDeductionType(db, 'ded:study-fund', { countsAsSaving: false }, 3000)
    expect(findDeductionType(db, 'ded:study-fund')).toMatchObject({
      linkedFundId: 'fund-2',
      countsAsSaving: false,
    })

    updateDeductionType(db, 'ded:study-fund', { linkedFundId: undefined }, 4000)
    expect(findDeductionType(db, 'ded:study-fund')?.linkedFundId).toBeUndefined()
  })

  it('does nothing to a type that is not there', async () => {
    const db = await createLedgerDatabase()

    expect(() => updateDeductionType(db, 'ded:nope', { name: 'x' }, 1000)).not.toThrow()
  })
})

describe('deleteDeductionType', () => {
  it('refuses a built-in outright', async () => {
    const db = await createLedgerDatabase()

    expect(() => deleteDeductionType(db, 'ded:income-tax', 1000)).toThrow(DeductionTypeInUseError)
    expect(findDeductionType(db, 'ded:income-tax')).toBeDefined()
  })

  it('refuses a type a paycheck still names, rather than rewriting what that slip said', async () => {
    const db = await createLedgerDatabase()
    const parking = createDeductionType(db, { name: 'Parking', kind: 'OTHER_DEDUCTION' }, 1000)
    createPaycheck(
      db,
      {
        period: { year: 2026, month: 6 },
        paymentDate: localDate(2026, 7, 9),
        gross: money(2_500_000, 'ILS'),
        net: money(2_490_000, 'ILS'),
        lines: [{ deductionTypeId: parking.id, employeeAmount: money(10_000, 'ILS') }],
      },
      1000,
    )

    expect(deductionTypeUsage(db, parking.id)).toBe(1)
    expect(() => deleteDeductionType(db, parking.id, 2000)).toThrow(DeductionTypeInUseError)
  })

  it('counts every type’s use in one query, and leaves unused ones out', async () => {
    const db = await createLedgerDatabase()
    createPaycheck(
      db,
      {
        period: { year: 2026, month: 6 },
        paymentDate: localDate(2026, 7, 9),
        gross: money(2_500_000, 'ILS'),
        net: money(2_100_000, 'ILS'),
        lines: [
          { deductionTypeId: 'ded:income-tax', employeeAmount: money(300_000, 'ILS') },
          { deductionTypeId: 'ded:pension', employeeAmount: money(100_000, 'ILS') },
        ],
      },
      1000,
    )
    createPaycheck(
      db,
      {
        period: { year: 2026, month: 7 },
        paymentDate: localDate(2026, 8, 9),
        gross: money(2_500_000, 'ILS'),
        net: money(2_200_000, 'ILS'),
        lines: [{ deductionTypeId: 'ded:income-tax', employeeAmount: money(300_000, 'ILS') }],
      },
      1000,
    )

    const counts = deductionTypeUsageCounts(db)

    expect(counts.get('ded:income-tax')).toBe(2)
    expect(counts.get('ded:pension')).toBe(1)
    expect(counts.get('ded:health-tax')).toBeUndefined()
  })

  it('removes an unused type the user added', async () => {
    const db = await createLedgerDatabase()
    const parking = createDeductionType(db, { name: 'Parking', kind: 'OTHER_DEDUCTION' }, 1000)

    deleteDeductionType(db, parking.id, 2000)

    expect(findDeductionType(db, parking.id)).toBeUndefined()
    expect(listDeductionTypes(db)).toHaveLength(10)
  })
})

describe('reorderDeductionTypes', () => {
  it('renumbers in tens, so a type can be dropped between two others', async () => {
    const db = await createLedgerDatabase()

    reorderDeductionTypes(db, ['ded:pension', 'ded:income-tax'], 1000)

    const types = listDeductionTypes(db)
    expect(types[0]?.id).toBe('ded:pension')
    expect(types[0]?.sortOrder).toBe(10)
    expect(types[1]?.id).toBe('ded:income-tax')
    expect(types[1]?.sortOrder).toBe(20)
  })
})
