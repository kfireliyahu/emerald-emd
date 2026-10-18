import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { exportDatabase, openDatabase } from '@/data/db/database.ts'
import { unmatchedSettlements } from '@/data/importer/settlementScan.ts'
import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { createAccount } from '@/data/repositories/accountRepository.ts'
import { readNoPayMonths } from '@/data/repositories/paycheckRepository.ts'

import { countCardChargesTool, setNoPayMonthsTool } from './waiting.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

/** A bank statement with one charge for a card ending 9012, which the document has no statement of. */
async function fixture(): Promise<string> {
  const db = await createLedgerDatabase()
  const bank = createAccount(db, { name: 'Checking', kind: 'BANK' }, 1)
  insertTransaction(
    db,
    {
      id: 'orphan',
      accountId: bank.id,
      transactionDate: localDate(2026, 7, 10),
      chargeDate: undefined,
      billingPeriod: undefined,
      amount: money(-89_020, 'ILS'),
      direction: 'OUTFLOW',
      merchantRaw: 'כרטיס אשראי 9012',
      merchantNormalized: 'כרטיס אשראי',
      providerCategory: undefined,
      cardLast4: undefined,
      reference: undefined,
      note: undefined,
      installment: undefined,
      foreign: undefined,
      naturalKey: 'orphan',
      importSessionId: undefined,
      sourceRowRef: undefined,
    },
    1,
  )
  const path = join(await tempDir('emerald-waiting-'), 'doc.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  return path
}

async function reopen(path: string) {
  return openDatabase(new Uint8Array(await readFile(path)))
}

describe('the two answers Home’s waiting list added (M31 U1)', () => {
  it('lists a card charge with no statement, dry-runs counting it, then writes it', async () => {
    const path = await fixture()
    expect(await countCardChargesTool.run({ path }, NO_CLIENT)).toContain('9012')

    const before = await readFile(path)
    expect(await countCardChargesTool.run({ path, cards: ['9012'] }, NO_CLIENT)).toContain('Nothing has been written')
    expect(Buffer.compare(before, await readFile(path))).toBe(0)

    expect(await countCardChargesTool.run({ path, cards: ['9012'], commit: true }, NO_CLIENT)).toContain('Counted as spending: 1 card')
    const db = await reopen(path)
    expect(unmatchedSettlements(db)).toEqual([])
    db.close()
  })

  it('refuses a card with no waiting charge, and writes nothing', async () => {
    const path = await fixture()
    const before = await readFile(path)
    expect(await countCardChargesTool.run({ path, cards: ['1111'], commit: true }, NO_CLIENT)).toContain('No waiting payment for 1111')
    expect(Buffer.compare(before, await readFile(path))).toBe(0)
  })

  it('says a month had no pay, and takes it back', async () => {
    const path = await fixture()
    await setNoPayMonthsTool.run({ path, months: ['2026-07'], commit: true }, NO_CLIENT)
    let db = await reopen(path)
    expect(readNoPayMonths(db)).toEqual(new Set(['2026-07']))
    db.close()

    await setNoPayMonthsTool.run({ path, months: ['2026-07'], no_pay: false, commit: true }, NO_CLIENT)
    db = await reopen(path)
    expect(readNoPayMonths(db).size).toBe(0)
    db.close()
    await expect(setNoPayMonthsTool.run({ path, months: ['July'] }, NO_CLIENT)).rejects.toThrow('YYYY-MM')
  })
})
