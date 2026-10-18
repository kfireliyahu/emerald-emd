import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { exportDatabase, openDatabase } from '@/data/db/database.ts'
import { accountBalances } from '@/data/repositories/accountBalanceRepository.ts'
import { createAccount } from '@/data/repositories/accountRepository.ts'

import { setOpeningBalancesTool } from './accountBalances.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

async function fixture(): Promise<string> {
  const db = await createLedgerDatabase()
  createAccount(db, { name: 'Checking', kind: 'BANK' }, 1)
  createAccount(db, { name: 'Visa', kind: 'CREDIT_CARD' }, 1)
  const path = join(await tempDir('emerald-opening-'), 'doc.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  return path
}

const text = (answer: string): string => answer

describe('set_opening_balances', () => {
  it('dry-runs, then writes, and refuses a card', async () => {
    const path = await fixture()
    const accounts = [
      { account: 'Checking', amount: 12_500.5, date: '2026-01-01' },
      { account: 'Visa', amount: 1, date: '2026-01-01' },
      { account: 'Nowhere', amount: 1, date: '2026-01-01' },
    ]
    const before = await readFile(path)
    const preview = await setOpeningBalancesTool.run({ path, accounts }, NO_CLIENT)
    expect(text(preview)).toContain('would change')
    expect(Buffer.compare(before, await readFile(path))).toBe(0)

    const done = await setOpeningBalancesTool.run({ path, accounts, commit: true }, NO_CLIENT)
    expect(text(done)).toContain('Refused')
    expect(text(done)).toContain('not checked')

    const db = await openDatabase(new Uint8Array(await readFile(path)))
    const checking = accountBalances(db, 'ILS')[0]
    expect(checking?.opening).toEqual(money(1_250_050, 'ILS'))
    expect(checking?.openingDate).toEqual({ year: 2026, month: 1, day: 1 })
  })

  it('needs an amount and a date, or clear', async () => {
    const path = await fixture()
    await expect(
      setOpeningBalancesTool.run({ path, accounts: [{ account: 'Checking', amount: 5 }] }, NO_CLIENT),
    ).rejects.toThrow(/date/)
    const cleared = await setOpeningBalancesTool.run(
      { path, commit: true, accounts: [{ account: 'Checking', clear: true }] },
      NO_CLIENT,
    )
    expect(text(cleared)).toContain('Changed 1 account')
  })
})
