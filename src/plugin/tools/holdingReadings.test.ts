import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { exportDatabase, openDatabase } from '@/data/db/database.ts'
import { createAccount } from '@/data/repositories/accountRepository.ts'
import { goalWorth, setGoalFeed } from '@/data/repositories/goalDepositRepository.ts'
import { listHoldingReadings } from '@/data/repositories/holdingReadingRepository.ts'
import {
  createGoal,
  createHolding,
  createHoldingPlace,
  setPlaceAccount,
  setTransactionHolding,
} from '@/data/repositories/savingsRepository.ts'

import { recordHoldingReadingsTool } from './holdingReadings.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

async function fixture(): Promise<{ path: string; fund: string; goal: string }> {
  const db = await createLedgerDatabase()
  const broker = createAccount(db, { name: 'Broker', kind: 'HOLDINGS' }, 1)
  const place = createHoldingPlace(db, { name: 'Broker place', kind: 'INVESTMENT' }, 1)
  setPlaceAccount(db, place.id, broker.id, 1)
  const fund = createHolding(
    db,
    { holdingPlaceId: place.id, name: 'Index fund', kind: 'SECURITY', provenance: 'TRANSCRIBED', isLiquid: true },
    1,
  )
  for (const [id, minor] of [
    ['in', 2_000_00],
    ['buy', -1_000_00],
  ] as const) {
    insertTransaction(
      db,
      {
        id,
        accountId: broker.id,
        transactionDate: localDate(2026, 6, 5),
        chargeDate: undefined,
        billingPeriod: undefined,
        amount: money(minor, 'ILS'),
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
      },
      1,
    )
  }
  setTransactionHolding(db, 'buy', { holdingId: fund.id, quantityMicro: 10_000_000 }, 1)
  const goal = createGoal(db, { name: 'Long run', kind: 'LONG_TERM', defaultHoldingId: fund.id }, 1)
  setGoalFeed(db, goal.id, { kind: 'HOLDING' }, 1)
  const path = join(await tempDir('emerald-holding-readings-'), 'doc.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  return { path, fund: fund.id, goal: goal.id }
}

describe('record_holding_readings (M30 U5)', () => {
  it('dry-runs, then records a reading, says what it proves, and the goal is worth it', async () => {
    const { path, fund, goal } = await fixture()
    const readings = [
      { holding: 'Index fund', as_of: '2026-06-30', value: 1_080, quantity: '10', cost_basis: 1_000, price: '108' },
      { holding: 'Cash', as_of: '2026-06-30', value: 1_000 },
    ]
    const before = await readFile(path)
    const preview = await recordHoldingReadingsTool.run({ path, readings }, NO_CLIENT)
    expect(preview).toContain('Nothing has been written')
    expect(Buffer.compare(before, await readFile(path))).toBe(0)

    const done = await recordHoldingReadingsTool.run({ path, readings, commit: true }, NO_CLIENT)
    expect(done).toContain('Wrote 2 readings')
    expect(done).toMatch(/Index fund \| 2026-06-30 \| ₪1,080.00 \| proved \| proved \| proved/)
    expect(done).toContain('Worth now')

    const db = await openDatabase(new Uint8Array(await readFile(path)))
    expect(listHoldingReadings(db, fund)).toHaveLength(1)
    expect(goalWorth(db, goal, 'ILS')).toEqual({ asOf: '2026-06-30', worth: money(1_080_00, 'ILS'), putIn: money(1_000_00, 'ILS') })
    db.close()

    // The same figures again change nothing.
    const again = await recordHoldingReadingsTool.run({ path, readings, commit: true }, NO_CLIENT)
    expect(again).toContain('Wrote 0 readings; 2 were already recorded.')
  })

  it('refuses the whole batch when a day already reads otherwise, until it says it corrects it', async () => {
    const { path } = await fixture()
    await recordHoldingReadingsTool.run(
      { path, readings: [{ holding: 'Index fund', as_of: '2026-06-30', value: 1_080 }], commit: true },
      NO_CLIENT,
    )
    const refused = await recordHoldingReadingsTool.run(
      { path, readings: [{ holding: 'Index fund', as_of: '2026-06-30', value: 1_090 }], commit: true },
      NO_CLIENT,
    )
    expect(refused).toContain('Nothing was written')
    expect(refused).toContain('correct: true')

    const corrected = await recordHoldingReadingsTool.run(
      { path, readings: [{ holding: 'Index fund', as_of: '2026-06-30', value: 1_090, correct: true }], commit: true },
      NO_CLIENT,
    )
    expect(corrected).toContain('Wrote 1 reading')
    expect(corrected).toContain('₪1,090.00')
  })
})
