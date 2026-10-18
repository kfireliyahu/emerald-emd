import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { exportDatabase, openDatabase } from '@/data/db/database.ts'
import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { createAccount } from '@/data/repositories/accountRepository.ts'
import { listTransferPairs, suggestTransfers } from '@/data/repositories/transferPairRepository.ts'

import { answerTransfersTool, transfersTool } from './transfers.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

async function fixture(): Promise<{ path: string; pairId: string }> {
  const db = await createLedgerDatabase()
  const bank = createAccount(db, { name: 'Checking', kind: 'BANK' }, 1)
  const broker = createAccount(db, { name: 'Broker', kind: 'HOLDINGS' }, 1)
  for (const [id, accountId, minor] of [
    ['out', bank.id, -2_000_00],
    ['in', broker.id, 2_000_00],
  ] as const) {
    insertTransaction(
      db,
      {
        id,
        accountId,
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
  suggestTransfers(db)
  const pairId = listTransferPairs(db)[0]?.id ?? ''
  const path = join(await tempDir('emerald-transfers-'), 'doc.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  return { path, pairId }
}

describe('transfers and answer_transfers (M30 U3)', () => {
  it('lists the undecided pair, dry-runs an answer, then writes it', async () => {
    const { path, pairId } = await fixture()
    const listed = await transfersTool.run({ path }, NO_CLIENT)
    expect(listed).toContain(pairId)
    expect(listed).toContain('Checking')
    expect(listed).toContain('Broker')

    const pairs = [{ pair_id: pairId, answer: 'transfer' }]
    const before = await readFile(path)
    const preview = await answerTransfersTool.run({ path, pairs }, NO_CLIENT)
    expect(preview).toContain('Nothing has been written')
    expect(Buffer.compare(before, await readFile(path))).toBe(0)

    const done = await answerTransfersTool.run({ path, pairs, commit: true }, NO_CLIENT)
    expect(done).toContain('Answered 1 pair')
    expect(done).toContain('No transfer is waiting')

    const db = await openDatabase(new Uint8Array(await readFile(path)))
    expect(listTransferPairs(db)[0]?.decision).toBe('PAIRED')
    db.close()
    expect(await transfersTool.run({ path, answer: 'transfer' }, NO_CLIENT)).toContain(pairId)
  })

  it('refuses the whole batch over an unknown pair', async () => {
    const { path, pairId } = await fixture()
    const before = await readFile(path)
    const answer = await answerTransfersTool.run(
      {
        path,
        pairs: [
          { pair_id: pairId, answer: 'transfer' },
          { pair_id: 'nope', answer: 'not_a_transfer' },
        ],
        commit: true,
      },
      NO_CLIENT,
    )
    expect(answer).toContain('no such pair')
    expect(Buffer.compare(before, await readFile(path))).toBe(0)
  })
})
