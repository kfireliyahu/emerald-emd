import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { exportDatabase, openDatabase } from '@/data/db/database.ts'
import { statementRowKey } from '@/data/importer/holdingStatement.ts'
import { createLedgerDatabase, insertTransaction } from '@/data/packs/ledger/testing.ts'
import { createAccount, listAccounts } from '@/data/repositories/accountRepository.ts'
import { listHoldingReadings, readingChecks } from '@/data/repositories/holdingReadingRepository.ts'
import { findCommittedFile } from '@/data/repositories/importSessionRepository.ts'
import { countTransactions } from '@/data/repositories/transactionRepository.ts'
import { createHolding, createHoldingPlace, holdingQuantity, listHoldings } from '@/data/repositories/savingsRepository.ts'
import { listTransferPairs } from '@/data/repositories/transferPairRepository.ts'

import { recordHoldingsStatementTool } from './holdingStatement.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'

/** A document with a bank, a broker place holding one fund already, and two statement files to hash. */
async function fixture(): Promise<{ path: string; march: string; half: string }> {
  const db = await createLedgerDatabase()
  const bank = createAccount(db, { name: 'Checking', kind: 'BANK' }, 1)
  const place = createHoldingPlace(db, { name: 'Broker', kind: 'INVESTMENT' }, 1)
  createHolding(db, { holdingPlaceId: place.id, name: 'Fund A', kind: 'FUND', provenance: 'RECORDED', isLiquid: true }, 1)
  insertTransaction(
    db,
    {
      id: 'bank-out',
      accountId: bank.id,
      transactionDate: localDate(2026, 3, 2),
      chargeDate: undefined,
      billingPeriod: undefined,
      amount: money(-1_000_00, 'ILS'),
      direction: 'OUTFLOW',
      merchantRaw: 'To broker',
      merchantNormalized: 'to broker',
      providerCategory: undefined,
      cardLast4: undefined,
      reference: undefined,
      note: undefined,
      installment: undefined,
      foreign: undefined,
      naturalKey: 'bank-out',
      importSessionId: undefined,
      sourceRowRef: undefined,
    },
    1,
  )
  const dir = await tempDir('emerald-holdings-statement-')
  const path = join(dir, 'doc.emd')
  await writeFile(path, exportDatabase(db))
  db.close()
  const march = join(dir, 'march.pdf')
  const half = join(dir, 'half.pdf')
  await writeFile(march, 'march statement')
  await writeFile(half, 'half-year statement')
  return { path, march, half }
}

/** March: a deposit, two buys (one into a holding the document lacks), a tax line that moves nothing, interest. */
const MARCH_ROWS = [
  { date: '2026-03-02', description: 'Deposit from bank', amount: 1000, cash_after: 1000 },
  { date: '2026-03-02', description: 'Buy Fund A', amount: -400, cash_after: 600, holding: 'Fund A', quantity: 10 },
  { date: '2026-03-02', description: 'Buy Index B', amount: -500.5, cash_after: 99.5, holding: 'Index B', quantity: '2' },
  { date: '2026-03-31', description: 'Tax owed', amount: 0, cash_after: 99.5 },
  { date: '2026-03-31', description: 'Interest', amount: 0.5, cash_after: 100 },
]

const MARCH = {
  new_account: 'Broker',
  as_of: '2026-03-31',
  rows: MARCH_ROWS,
  holdings: [
    { holding: 'Fund A', value: 410, quantity: 10, cost_basis: 400, price: 41 },
    { holding: 'Index B', value: 520, quantity: 2, cost_basis: 500.5, price: 260 },
  ],
  cash: 100,
}

async function counts(path: string) {
  const db = await openDatabase(new Uint8Array(await readFile(path)))
  const broker = listAccounts(db).find((one) => one.name === 'Broker')
  // The broker's holdings: the bank account has its own Cash too (M30 F2).
  const holdings = listHoldings(db, { includeArchived: true }).filter(
    (one) => one.accountId === undefined || one.accountId === broker?.id,
  )
  const result = {
    broker,
    // Every row but the bank's one.
    rows: countTransactions(db) - 1,
    statements: ['march statement', 'half-year statement'].filter(
      (text) => findCommittedFile(db, broker?.id ?? '', createHash('sha256').update(text).digest('hex')) !== undefined,
    ).length,
    holdings: holdings.map((one) => one.name).sort(),
    quantity: (name: string) => {
      const held = holdings.find((one) => one.name === name)
      return held === undefined ? undefined : holdingQuantity(db, held.id)
    },
    checks: holdings.flatMap((one) => listHoldingReadings(db, one.id).map((reading) => readingChecks(db, reading))),
    pairs: listTransferPairs(db).length,
  }
  return { ...result, close: () => db.close() }
}

describe('record_holdings_statement (M30 U6)', () => {
  it('keys a row by its value date, amount and the balance after it — not by how it was spelled', () => {
    const row = {
      date: localDate(2026, 3, 2),
      description: 'Buy Fund A',
      amount: money(-400_00, 'ILS'),
      cashAfter: money(600_00, 'ILS'),
      holding: undefined,
      quantityMicro: undefined,
    }
    expect(statementRowKey(row)).toBe(statementRowKey({ ...row, description: 'קניה Fund A' }))
    expect(statementRowKey(row)).not.toBe(statementRowKey({ ...row, cashAfter: money(500_00, 'ILS') }))
  })

  it('dry-runs a whole statement, then writes its rows and readings, and every check proves', async () => {
    const { path, march } = await fixture()
    const before = await readFile(path)
    const preview = await recordHoldingsStatementTool.run({ path, file: march, ...MARCH }, NO_CLIENT)
    expect(preview).toContain('Nothing has been written')
    expect(preview).toContain('The printed balances add up row by row')
    expect(preview).toContain('Index B (new)')
    expect(preview).toContain('left out: moves no cash')
    expect(preview).not.toContain('failed')
    expect(Buffer.compare(before, await readFile(path))).toBe(0)

    const done = await recordHoldingsStatementTool.run({ path, file: march, ...MARCH, commit: true }, NO_CLIENT)
    expect(done).toContain('Wrote 4 rows')
    expect(done).toContain('1 transfer between')
    expect(done).not.toContain('failed')

    const after = await counts(path)
    expect(after.broker?.kind).toBe('HOLDINGS')
    expect(after.rows).toBe(4)
    expect(after.statements).toBe(1)
    expect(after.holdings).toEqual(['Cash', 'Fund A', 'Index B'])
    expect(after.quantity('Index B')).toEqual({ kind: 'VALUE', quantityMicro: 2_000_000, rows: 1 })
    // Fund A and Index B each prove cost, quantity and price; the cash line proves against the rows.
    expect(after.checks).toHaveLength(3)
    for (const check of after.checks) {
      const kinds = [check.cost, check.quantity, check.price, check.cash].map((one) => one?.kind)
      expect(kinds).not.toContain('FAILED')
    }
    expect(after.checks.filter((one) => one.cash?.kind === 'PROVED')).toHaveLength(1)
    expect(after.checks.filter((one) => one.cost.kind === 'PROVED')).toHaveLength(2)
    expect(after.pairs).toBe(1)
    after.close()
  })

  it('adds only what an overlapping file adds, and nothing for the same file again', async () => {
    const { path, march, half } = await fixture()
    await recordHoldingsStatementTool.run({ path, file: march, ...MARCH, commit: true }, NO_CLIENT)
    const brokerId = (await counts(path)).broker?.id ?? ''

    const again = await recordHoldingsStatementTool.run(
      { path, file: march, account_id: brokerId, as_of: MARCH.as_of, rows: MARCH_ROWS, holdings: MARCH.holdings, cash: 100, commit: true },
      NO_CLIENT,
    )
    expect(again).toContain('Wrote 0 rows')
    expect(again).toContain('0 readings written')
    expect((await counts(path)).statements).toBe(1)

    // The half-year file repeats March, spelled differently, and adds April's buy.
    const halfRows = [
      ...MARCH_ROWS.map((row) => ({ ...row, description: `${row.description} (as the half-year spells it)` })),
      { date: '2026-04-05', description: 'Buy Index B', amount: -265, cash_after: -165, holding: 'Index B', quantity: 1 },
      { date: '2026-04-05', description: 'Deposit from bank', amount: 300, cash_after: 135 },
    ]
    const done = await recordHoldingsStatementTool.run(
      {
        path,
        file: half,
        account_id: brokerId,
        as_of: '2026-04-30',
        from: '2026-01-01',
        rows: halfRows,
        holdings: [
          { holding: 'Fund A', value: 415, quantity: 10, cost_basis: 400 },
          { holding: 'Index B', value: 790, quantity: 3, cost_basis: 765.5, price: 263.33 },
        ],
        cash: 135,
        commit: true,
      },
      NO_CLIENT,
    )
    expect(done).toContain('Wrote 2 rows')
    expect(done).toContain('4 were already there')
    expect(done).not.toContain('failed')
    const after = await counts(path)
    expect(after.rows).toBe(6)
    expect(after.statements).toBe(2)
    expect(after.quantity('Index B')).toEqual({ kind: 'VALUE', quantityMicro: 3_000_000, rows: 2 })
    after.close()
  })

  it('refuses the whole batch where the printed balances stop adding up', async () => {
    const { path, march } = await fixture()
    const before = await readFile(path)
    const misread = MARCH_ROWS.map((row, index) => (index === 2 ? { ...row, cash_after: 95.5 } : row))
    const answer = await recordHoldingsStatementTool.run(
      { path, file: march, ...MARCH, rows: misread, commit: true },
      NO_CLIENT,
    )
    expect(answer).toContain('stop adding up at row 3')
    expect(answer).toContain('Nothing was written')
    expect(Buffer.compare(before, await readFile(path))).toBe(0)
  })

  it('refuses a buy whose amount and quantity have the same sign, and a holding with no quantity', async () => {
    const { path, march } = await fixture()
    const rows = [
      { date: '2026-03-02', description: 'Deposit', amount: 1000, cash_after: 1000 },
      { date: '2026-03-03', description: 'Buy', amount: 400, cash_after: 1400, holding: 'Fund A', quantity: 10 },
      { date: '2026-03-04', description: 'Buy', amount: -400, cash_after: 1000, holding: 'Fund A' },
    ]
    const answer = await recordHoldingsStatementTool.run({ path, file: march, new_account: 'Broker', as_of: '2026-03-31', rows }, NO_CLIENT)
    expect(answer).toContain('Row 2: a buy takes cash out')
    expect(answer).toContain('Row 3: names a holding without a quantity')
    expect(answer).toContain('Refused')
  })

  it('will not write a statement into an account that has no holdings', async () => {
    const { path, march } = await fixture()
    const db = await openDatabase(new Uint8Array(await readFile(path)))
    const bankId = listAccounts(db).find((one) => one.name === 'Checking')?.id ?? ''
    db.close()
    const answer = await recordHoldingsStatementTool.run({ path, file: march, account_id: bankId, as_of: '2026-03-31', cash: 0 }, NO_CLIENT)
    expect(answer).toContain('is not an account with holdings')
  })
})
