import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { exportDatabase, openDatabase } from '@/data/db/database.ts'
import { createAccount } from '@/data/repositories/accountRepository.ts'
import {
  createHolding,
  createHoldingPlace,
  holdingQuantity,
  setPlaceAccount,
} from '@/data/repositories/savingsRepository.ts'
import { findTransactionById } from '@/data/repositories/transactionRepository.ts'

import { setTransactionHoldingsTool } from './transactionHoldings.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

async function fixture(): Promise<{ path: string; fund: string }> {
  const db = await createLedgerDatabase()
  const broker = createAccount(db, { name: 'Broker', kind: 'HOLDINGS' }, 1)
  const place = createHoldingPlace(db, { name: 'Broker place', kind: 'INVESTMENT' }, 1)
  setPlaceAccount(db, place.id, broker.id, 1)
  const fund = createHolding(
    db,
    { holdingPlaceId: place.id, name: 'Index fund', kind: 'SECURITY', provenance: 'RECORDED', isLiquid: true },
    1,
  )
  for (const [id, minor] of [
    ['buy', -1_000_00],
    ['sell', 300_00],
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
  const path = join(await tempDir('emerald-transaction-holdings-'), 'doc.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  return { path, fund: fund.id }
}

describe('set_transaction_holdings (M30 U2)', () => {
  it('dry-runs, then names a holding and a quantity on each row, and says what it holds', async () => {
    const { path, fund } = await fixture()
    const rows = [
      { transaction_id: 'buy', holding: 'Index fund', quantity: '12.5' },
      { transaction_id: 'sell', holding: fund, quantity: -2 },
    ]
    const before = await readFile(path)
    const preview = await setTransactionHoldingsTool.run({ path, rows }, NO_CLIENT)
    expect(preview).toContain('Nothing has been written')
    expect(Buffer.compare(before, await readFile(path))).toBe(0)

    const done = await setTransactionHoldingsTool.run({ path, rows, commit: true }, NO_CLIENT)
    expect(done).toContain('Named a holding on 2 rows')
    expect(done).toContain('10.5')

    const db = await openDatabase(new Uint8Array(await readFile(path)))
    expect(findTransactionById(db, 'buy')).toMatchObject({ holdingId: fund, quantityMicro: 12_500_000 })
    expect(holdingQuantity(db, fund)).toEqual({ kind: 'VALUE', quantityMicro: 10_500_000, rows: 2 })
    db.close()
  })

  it('refuses the whole batch when a row has no quantity or the holding is the account’s cash', async () => {
    const { path } = await fixture()
    const before = await readFile(path)
    const answer = await setTransactionHoldingsTool.run(
      {
        path,
        rows: [
          { transaction_id: 'buy', holding: 'Index fund' },
          { transaction_id: 'sell', holding: 'Cash', quantity: 1 },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(answer).toContain('needs a `quantity`')
    expect(answer).toContain('own cash')
    expect(Buffer.compare(before, await readFile(path))).toBe(0)
  })
})
