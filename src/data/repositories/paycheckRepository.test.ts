import type { Database } from 'sql.js'
import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { evaluateIdentity } from '@/domain/format/identity.ts'
import { reconciliationDelta, totalCompensation } from '@/domain/paycheck.ts'
import { exportDatabase, openDatabase } from '../db/database.ts'
import { declared } from '../packs/ledger/tables.ts'
import { createLedgerDatabase } from '../packs/ledger/testing.ts'
import { listFormats } from './formatRepository.ts'
import { indexOf, inputsWithAggregates } from './formatJoinRepository.ts'
import { readRow } from './formatRowRepository.ts'
import { listDeductionTypes } from './deductionTypeRepository.ts'
import {
  createPaycheck,
  deletePaycheck,
  findPaycheck,
  findPaychecksForPeriod,
  listPaychecks,
  listPaychecksWithLines,
  updatePaycheck,
  type NewPaycheck,
} from './paycheckRepository.ts'
import { createSplitPlan, findSplitPlan } from './splitPlanRepository.ts'

const ILS = 'ILS'

/** June's slip: ₪25,000 gross, ₪17,533 net, itemized down to the agora. */
function june(overrides?: Partial<NewPaycheck>): NewPaycheck {
  return {
    period: { year: 2026, month: 6 },
    paymentDate: localDate(2026, 7, 9),
    employerName: 'Acme',
    gross: money(2_500_000, ILS),
    net: money(1_753_300, ILS),
    lines: [
      { deductionTypeId: 'ded:income-tax', employeeAmount: money(341_250, ILS) },
      { deductionTypeId: 'ded:national-insurance', employeeAmount: money(106_200, ILS) },
      { deductionTypeId: 'ded:health-tax', employeeAmount: money(78_500, ILS) },
      {
        deductionTypeId: 'ded:pension',
        employeeAmount: money(150_000, ILS),
        employerAmount: money(162_500, ILS),
        basisAmount: money(2_500_000, ILS),
      },
      {
        deductionTypeId: 'ded:study-fund',
        employeeAmount: money(62_500, ILS),
        employerAmount: money(187_500, ILS),
      },
      {
        deductionTypeId: 'ded:severance',
        employeeAmount: money(0, ILS),
        employerAmount: money(208_333, ILS),
      },
      { deductionTypeId: 'ded:union-dues', employeeAmount: money(8_250, ILS), note: 'ועד עובדים' },
    ],
    ...overrides,
  }
}

async function withJune(): Promise<{ db: Database; id: string }> {
  const db = await createLedgerDatabase()
  const created = createPaycheck(db, june(), 1000)
  return { db, id: created.paycheck.id }
}

describe('createPaycheck', () => {
  it('stores the slip and its lines, and gives them back in order', async () => {
    const { db, id } = await withJune()

    const stored = findPaycheck(db, id)

    expect(stored?.paycheck).toMatchObject({
      period: { year: 2026, month: 6 },
      paymentDate: localDate(2026, 7, 9),
      employerName: 'Acme',
      gross: money(2_500_000, ILS),
      net: money(1_753_300, ILS),
      sourceKind: 'MANUAL',
      isIrregular: false,
    })
    expect(stored?.lines.map((line) => line.deductionTypeId)).toEqual([
      'ded:income-tax',
      'ded:national-insurance',
      'ded:health-tax',
      'ded:pension',
      'ded:study-fund',
      'ded:severance',
      'ded:union-dues',
    ])
    expect(stored?.lines[3]).toMatchObject({
      employeeAmount: money(150_000, ILS),
      employerAmount: money(162_500, ILS),
      basisAmount: money(2_500_000, ILS),
    })
    // No employer side at all is a different fact from an employer side of zero.
    expect(stored?.lines[0]?.employerAmount).toBeUndefined()
  })

  it('reconciles to zero through the domain, over rows that went to SQLite and back', async () => {
    const { db, id } = await withJune()
    const stored = findPaycheck(db, id)
    const types = listDeductionTypes(db)

    expect(stored).toBeDefined()
    if (stored === undefined) return
    expect(reconciliationDelta(stored, types)).toEqual(money(0, ILS))
    expect(totalCompensation(stored)).toEqual(money(3_058_333, ILS))
  })

  it('is proved by the pack’s own identity exactly when the delta is zero (D-281)', async () => {
    const db = await createLedgerDatabase()
    const exact = createPaycheck(db, june(), 1000).paycheck.id
    // ₪1 taken that no line accounts for: the entry screen's delta, and a failure.
    const short = createPaycheck(db, june({ net: money(1_753_200, ILS) }), 1000).paycheck.id
    const types = listDeductionTypes(db)
    const paycheck = declared(db, 'paycheck')
    const formats = indexOf(listFormats(db))
    const net = paycheck.identities.find((each) => each.name === 'net')
    if (net === undefined) throw new Error('the pack declares no net')

    const verdict = (id: string) => {
      const row = readRow(db, paycheck, id)
      if (row === undefined) throw new Error('bad fixture')
      return evaluateIdentity(net, inputsWithAggregates(db, paycheck, row, formats))
    }
    const delta = (id: string) => {
      const entry = findPaycheck(db, id)
      if (entry === undefined) throw new Error('bad fixture')
      return reconciliationDelta(entry, types)
    }

    expect(verdict(exact).kind).toBe('PROVED')
    expect(delta(exact)).toEqual(money(0, ILS))
    expect(verdict(short).kind).toBe('FAILED')
    expect(delta(short)).toEqual(money(100, ILS))
    const bare = createPaycheck(db, june({ lines: [] }), 1000).paycheck.id
    // A slip with no lines has itemized nothing: no line points at it, so the claim
    // has nothing to prove yet (D-465) — and the entry screen still offers all of
    // gross less net as one line.
    expect(verdict(bare)).toMatchObject({ kind: 'UNCHECKED', reason: expect.stringMatching(/nothing to prove/) })
    expect(delta(bare)).toEqual(money(746_700, ILS))
  })

  it('survives being saved to a file and opened again', async () => {
    const { db, id } = await withJune()

    const reopened = await openDatabase(exportDatabase(db))

    expect(findPaycheck(reopened, id)?.lines).toHaveLength(7)
    expect(findPaycheck(reopened, id)?.paycheck.gross).toEqual(money(2_500_000, ILS))
  })

  it('takes the line currency from the slip, so the two cannot drift', async () => {
    const db = await createLedgerDatabase()
    const created = createPaycheck(
      db,
      june({ gross: money(500_000, 'USD'), net: money(400_000, 'USD'), lines: [
        { deductionTypeId: 'ded:income-tax', employeeAmount: money(100_000, 'USD') },
      ] }),
      1000,
    )

    expect(created.lines[0]?.employeeAmount).toEqual(money(100_000, 'USD'))
  })
})

describe('listPaychecks', () => {
  it('is newest salary month first', async () => {
    const db = await createLedgerDatabase()
    createPaycheck(db, june({ period: { year: 2026, month: 4 }, lines: [] }), 1000)
    createPaycheck(db, june({ period: { year: 2026, month: 6 }, lines: [] }), 1000)
    createPaycheck(db, june({ period: { year: 2025, month: 12 }, lines: [] }), 1000)

    expect(listPaychecks(db).map((paycheck) => paycheck.period)).toEqual([
      { year: 2026, month: 6 },
      { year: 2026, month: 4 },
      { year: 2025, month: 12 },
    ])
  })

  it('pairs every slip with its own lines in two queries, empty ones included', async () => {
    const db = await createLedgerDatabase()
    createPaycheck(db, june(), 1000)
    createPaycheck(db, june({ period: { year: 2026, month: 5 }, lines: [] }), 1000)

    const entries = listPaychecksWithLines(db)

    expect(entries).toHaveLength(2)
    expect(entries[0]?.lines).toHaveLength(7)
    expect(entries[1]?.lines).toEqual([])
  })

  it('has nothing to say about an empty document', async () => {
    const db = await createLedgerDatabase()

    expect(listPaychecks(db)).toEqual([])
    expect(listPaychecksWithLines(db)).toEqual([])
    expect(findPaycheck(db, 'nope')).toBeUndefined()
  })
})

describe('findPaychecksForPeriod', () => {
  it('finds both slips of a month, because a 13th salary is allowed to share one', async () => {
    const db = await createLedgerDatabase()
    createPaycheck(db, june({ lines: [] }), 1000)
    createPaycheck(
      db,
      june({ lines: [], net: money(2_000_000, ILS), isIrregular: true }),
      1000,
    )

    expect(findPaychecksForPeriod(db, { year: 2026, month: 6 })).toHaveLength(2)
    expect(findPaychecksForPeriod(db, { year: 2026, month: 6 }, 'Acme')).toHaveLength(2)
    expect(findPaychecksForPeriod(db, { year: 2026, month: 6 }, 'Other')).toEqual([])
    expect(findPaychecksForPeriod(db, { year: 2026, month: 7 })).toEqual([])
  })
})

describe('updatePaycheck', () => {
  it('replaces the lines wholesale when they are given', async () => {
    const { db, id } = await withJune()

    updatePaycheck(
      db,
      id,
      {
        net: money(1_800_000, ILS),
        lines: [{ deductionTypeId: 'ded:other', employeeAmount: money(700_000, ILS) }],
      },
      2000,
    )

    const stored = findPaycheck(db, id)
    expect(stored?.paycheck.net).toEqual(money(1_800_000, ILS))
    expect(stored?.lines).toHaveLength(1)
    expect(stored?.lines[0]?.deductionTypeId).toBe('ded:other')
  })

  it('leaves the lines alone when they are not', async () => {
    const { db, id } = await withJune()

    updatePaycheck(db, id, { paymentDate: localDate(2026, 7, 10) }, 2000)

    const stored = findPaycheck(db, id)
    expect(stored?.lines).toHaveLength(7)
    expect(stored?.paycheck.paymentDate).toEqual(localDate(2026, 7, 10))
    expect(stored?.paycheck.employerName).toBe('Acme')
  })

  it('clears a field named with nothing, and keeps one not named', async () => {
    const { db, id } = await withJune()
    updatePaycheck(db, id, { note: 'first month' }, 2000)

    updatePaycheck(db, id, { isIrregular: true }, 3000)
    expect(findPaycheck(db, id)?.paycheck.note).toBe('first month')

    updatePaycheck(db, id, { note: undefined }, 4000)
    expect(findPaycheck(db, id)?.paycheck.note).toBeUndefined()
    expect(findPaycheck(db, id)?.paycheck.isIrregular).toBe(true)
  })

  it('does nothing to a slip that is not there', async () => {
    const db = await createLedgerDatabase()

    expect(() => updatePaycheck(db, 'nope', { note: 'x' }, 1000)).not.toThrow()
  })
})

describe('deletePaycheck', () => {
  it('takes the slip out of every list', async () => {
    const { db, id } = await withJune()

    deletePaycheck(db, id, 2000)

    expect(findPaycheck(db, id)).toBeUndefined()
    expect(listPaychecks(db)).toEqual([])
    expect(listPaychecksWithLines(db)).toEqual([])
    expect(findPaychecksForPeriod(db, { year: 2026, month: 6 })).toEqual([])
  })

  it('takes its lines with it, and leaves a plan based on it unavailable rather than rebased (D-281)', async () => {
    const { db, id } = await withJune()
    const plan = createSplitPlan(
      db,
      { name: 'June', currency: ILS, basisKind: 'SPECIFIC_PAYCHECK', basisPaycheckId: id },
      2000,
    )

    deletePaycheck(db, id, 2000)

    expect(db.exec('SELECT COUNT(*) FROM fmt_paycheck_line')[0]?.values[0]?.[0]).toBe(0)
    expect(findSplitPlan(db, plan.id)?.plan).toMatchObject({ basisKind: 'SPECIFIC_PAYCHECK' })
    expect(findSplitPlan(db, plan.id)?.plan.basisPaycheckId).toBeUndefined()
  })
})
