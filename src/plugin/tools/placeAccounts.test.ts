import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { exportDatabase, openDatabase } from '@/data/db/database.ts'
import { createAccount } from '@/data/repositories/accountRepository.ts'
import {
  cashHoldingOf,
  createHolding,
  createHoldingPlace,
  listHoldingPlaces,
} from '@/data/repositories/savingsRepository.ts'

import { setPlaceAccountsTool } from './placeAccounts.ts'
import { savingsTool } from './wealth.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

async function fixture(): Promise<string> {
  const db = await createLedgerDatabase()
  createAccount(db, { name: 'Broker', kind: 'HOLDINGS' }, 1)
  createAccount(db, { name: 'Checking', kind: 'BANK' }, 1)
  createAccount(db, { name: 'Visa', kind: 'CREDIT_CARD' }, 1)
  createHoldingPlace(db, { name: 'Broker place', kind: 'INVESTMENT' }, 1)
  const bank = createHoldingPlace(db, { name: 'The bank', kind: 'CHECKING' }, 1)
  createHolding(
    db,
    { holdingPlaceId: bank.id, name: 'Current account', kind: 'CASH', provenance: 'RECORDED', isLiquid: true },
    1,
  )
  const path = join(await tempDir('emerald-place-accounts-'), 'doc.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  return path
}

describe('set_place_accounts (M30 U1)', () => {
  it('dry-runs, then names each account and its cash in one call', async () => {
    const path = await fixture()
    const links = [
      { place: 'Broker place', account: 'Broker' },
      { place: 'The bank', account: 'Checking', cash_holding: 'Current account' },
    ]
    const before = await readFile(path)
    const preview = await setPlaceAccountsTool.run({ path, links }, NO_CLIENT)
    expect(preview).toContain('Cash — **new**')
    expect(preview).toContain('Nothing has been written')
    expect(Buffer.compare(before, await readFile(path))).toBe(0)

    const done = await setPlaceAccountsTool.run({ path, links, commit: true }, NO_CLIENT)
    expect(done).toContain('Linked 2 places, and made 1 cash holding.')

    const db = await openDatabase(new Uint8Array(await readFile(path)))
    const places = listHoldingPlaces(db)
    const broker = places.find((one) => one.name === 'Broker place')
    expect(broker?.accountId).toBeDefined()
    expect(cashHoldingOf(db, broker?.accountId ?? '')?.name).toBe('Cash')
    const bank = places.find((one) => one.name === 'The bank')
    expect(cashHoldingOf(db, bank?.accountId ?? '')?.name).toBe('Current account')
    db.close()

    const read = await savingsTool.run({ path }, NO_CLIENT)
    expect(read).toContain('Places and their accounts')
    expect(read).toContain('HOLDINGS')
  })

  it('refuses the whole batch when one entry cannot be written, and unlinks with null', async () => {
    const path = await fixture()
    const refused = await setPlaceAccountsTool.run(
      { path, commit: true, links: [{ place: 'Broker place', account: 'Broker' }, { place: 'The bank', account: 'Visa' }] },
      NO_CLIENT,
    )
    expect(refused).toContain('a card holds no money')
    expect(refused).toContain('Nothing was written')

    await setPlaceAccountsTool.run({ path, commit: true, links: [{ place: 'Broker place', account: 'Broker' }] }, NO_CLIENT)
    const unlinked = await setPlaceAccountsTool.run(
      { path, commit: true, links: [{ place: 'Broker place', account: null }] },
      NO_CLIENT,
    )
    expect(unlinked).toContain('unlinked 1 place')
  })

  it('shows the place and cash a bank account was made with, and nothing for the broker that has none yet', async () => {
    const path = await fixture()
    const read = await savingsTool.run({ path }, NO_CLIENT)
    // M30 F2: a bank account has its place and its own cash from the moment it is made.
    expect(read).toContain('Places and their accounts')
    expect(read).toMatch(/\| Checking \| Checking \| BANK \| Cash \|/)
    expect(read).not.toMatch(/\| Broker \|/)
  })
})
