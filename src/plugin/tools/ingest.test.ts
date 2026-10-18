import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createDatabase, exportDatabase, openDatabase } from '@/data/db/database.ts'
import { createAccount } from '@/data/repositories/accountRepository.ts'
import { listMappings } from '@/data/repositories/importMappingRepository.ts'
import { listTransactions } from '@/data/repositories/transactionRepository.ts'

import { importStatementTool, statementPreviewTool } from './ingest.ts'
import { NO_CLIENT } from './tool.ts'
import { tempDir } from '../../testing/tempDir'
import { backupFolderFor, listBackups } from '../backup.ts'

const BANK = fileURLToPath(new URL('../../../fixtures/synthetic/bank-statement.csv', import.meta.url))

/**
 * The synthetic bank statement the importer's own tests read, which is the
 * point: this unit drives the app's pipeline rather than a second one, so it
 * should be exercised against the same file.
 */
interface Fixture {
  readonly path: string
  readonly accountId: string
}

async function fixture(): Promise<Fixture> {
  const db = await createLedgerDatabase()
  const account = createAccount(db, { name: 'Bank Leumi – עו״ש', kind: 'BANK' }, 1)
  const bytes = exportDatabase(db)
  db.close()

  const dir = await tempDir('emerald-ingest-')
  const path = join(dir, 'ledger.emd')
  await writeFile(path, bytes)
  return { path, accountId: account.id }
}

async function reopen(path: string) {
  return openDatabase(await readFile(path))
}


/** The columns a human would confirm for this file, by index. */
const BANK_COLUMNS = { 0: 'date', 2: 'merchant', 4: 'debit', 5: 'credit', 6: 'balance' }

describe('statement_preview', () => {
  it('reports the header row, the columns and what each one looks like', async () => {
    const { path } = await fixture()
    const text = await statementPreviewTool.run({ path, file: BANK }, NO_CLIENT)

    expect(text).toContain('bank-statement.csv')
    // The header is on row 5 — the file opens with four rows of preamble, which
    // is exactly the thing the app never assumes away.
    expect(text).toContain('Header on row 5')
    expect(text).toContain('תאריך')
    expect(text).toContain('משכורת יולי')
  })

  it('names the accounts it could import into', async () => {
    const { path } = await fixture()
    const text = await statementPreviewTool.run({ path, file: BANK }, NO_CLIENT)
    expect(text).toContain('Bank Leumi')
  })

  it('refuses a file the app cannot read, naming what it can', async () => {
    const { path } = await fixture()
    await expect(
      statementPreviewTool.run({ path, file: 'notes.txt' }, NO_CLIENT),
    ).rejects.toThrow(/\.xlsx, \.xls, \.csv/)
  })

  it('changes nothing', async () => {
    const { path } = await fixture()
    const before = await readFile(path)
    await statementPreviewTool.run({ path, file: BANK }, NO_CLIENT)
    expect(await readFile(path)).toEqual(before)
  })
})

describe('import_statement', () => {
  it('makes the account a statement is for on a document that has none (D-313)', async () => {
    const db = await createLedgerDatabase()
    const dir = await tempDir('emerald-ingest-')
    const path = join(dir, 'new.emd')
    await writeFile(path, exportDatabase(db))
    db.close()

    const args = {
      path,
      file: BANK,
      new_account: { name: 'Bank – 7890', kind: 'BANK', last4: '7890' },
      columns: BANK_COLUMNS,
    }
    const dry = await importStatementTool.run(args, NO_CLIENT)
    expect(dry).toContain('Bank – 7890 (new)')

    const text = await importStatementTool.run({ ...args, commit: true, ignore_printed_total: true }, NO_CLIENT)
    expect(text).toContain('into Bank – 7890 (new), `account_id`')
    const after = await reopen(path)
    const { listAccounts } = await import('@/data/repositories/accountRepository.ts')
    const accounts = listAccounts(after)
    expect(accounts.map((one) => [one.name, one.last4])).toEqual([['Bank – 7890', '7890']])
    expect(listTransactions(after, {}, 500).length).toBeGreaterThan(0)
    // M30 F2: and its place, named as it, with its own cash — nothing for the person to do.
    const { cashHoldingOf, listHoldingPlaces } = await import('@/data/repositories/savingsRepository.ts')
    const id = accounts[0]?.id ?? ''
    expect(listHoldingPlaces(after).map((one) => [one.name, one.kind, one.accountId])).toEqual([['Bank – 7890', 'CHECKING', id]])
    expect(cashHoldingOf(after, id)).toMatchObject({ name: 'Cash', kind: 'CASH', isLiquid: true })
    after.close()
  })

  it('dry-runs by default and writes nothing', async () => {
    const { path, accountId } = await fixture()
    const before = await readFile(path)

    const text = await importStatementTool.run(
      { path, file: BANK, account_id: accountId, columns: BANK_COLUMNS },
      NO_CLIENT,
    )

    expect(text).toContain('new transactions')
    expect(text).toContain('Nothing has been written')
    expect(await readFile(path)).toEqual(before)
    expect(await listBackups(path)).toEqual([])
  })

  it('imports through the app’s own pipeline when committed', async () => {
    const { path, accountId } = await fixture()
    const text = await importStatementTool.run(
      { path, file: BANK, account_id: accountId, columns: BANK_COLUMNS, commit: true },
      NO_CLIENT,
    )

    expect(text).toContain('Imported')

    const db = await reopen(path)
    const rows = listTransactions(db)
    expect(rows.length).toBe(5)
    // Parsed by the real importer: Hebrew merchant, amount in minor units, the
    // date read with the file's own order.
    expect(rows.some((row) => row.merchantRaw.includes('משכורת'))).toBe(true)
    expect(rows.some((row) => row.amount.minor === -500000)).toBe(true)
    db.close()
  })

  it('is idempotent — the same statement twice adds nothing', async () => {
    // "Every import is idempotent" is a non-negotiable (docs/conventions.md).
    // It holds here because the plugin uses the same natural key, not because
    // it remembers what it did.
    const { path, accountId } = await fixture()
    const args = { path, file: BANK, account_id: accountId, columns: BANK_COLUMNS, commit: true }

    await importStatementTool.run(args, NO_CLIENT)
    const second = await importStatementTool.run(args, NO_CLIENT)

    expect(second).toContain('already there')

    const db = await reopen(path)
    expect(listTransactions(db).length).toBe(5)
    db.close()
  })

  it('says when a file’s rows are already in another account, and names the account to pass (M28 F11)', async () => {
    const { path, accountId } = await fixture()
    await importStatementTool.run(
      { path, file: BANK, account_id: accountId, columns: BANK_COLUMNS, commit: true },
      NO_CLIENT,
    )

    const plan = await importStatementTool.run(
      { path, file: BANK, new_account: { name: 'Second bank', kind: 'BANK' }, columns: BANK_COLUMNS },
      NO_CLIENT,
    )
    expect(plan).toContain('5 of these rows are already in Bank Leumi')
    expect(plan).toContain(accountId)
  })

  it('four files of two banks in one conversation make two accounts, each once (M28 F15)', async () => {
    const db = await createLedgerDatabase()
    const dir = await tempDir('emerald-ingest-')
    const path = join(dir, 'batch.emd')
    await writeFile(path, exportDatabase(db))
    db.close()

    const fixtureText = await readFile(BANK, 'utf8')
    const preamble = fixtureText.split(/\r?\n/).slice(0, 6).join('\n')
    const file = async (name: string, rows: readonly string[]): Promise<string> => {
      const at = join(dir, name)
      await writeFile(at, [preamble, ...rows].join('\n'))
      return at
    }
    const julyA = BANK
    const augustA = await file('a-august.csv', [
      '02/08/2026,02/08/2026,משכורת אוגוסט,0000112240,,"12,000.00","24,017.55"',
      '03/08/2026,03/08/2026,שכר דירה הוראת קבע,0000112241,"5,000.00",,"19,017.55"',
    ])
    const julyB = await file('b-july.csv', [
      '02/07/2026,02/07/2026,משכורת,0000900001,,"1,000.00","1,000.00"',
      '05/07/2026,05/07/2026,חשמל,0000900002,200.00,,800.00',
    ])
    const augustB = await file('b-august.csv', [
      '02/08/2026,02/08/2026,משכורת,0000900003,,"1,000.00","1,800.00"',
      '05/08/2026,05/08/2026,חשמל,0000900004,200.00,,"1,600.00"',
    ])
    const run = (args: Record<string, unknown>): Promise<string> =>
      importStatementTool.run({ path, columns: BANK_COLUMNS, ignore_printed_total: true, commit: true, ...args }, NO_CLIENT)

    // The first file of each bank makes its account, and says which id it is.
    const first = await run({ file: julyA, new_account: { name: 'Bank A', kind: 'BANK' } })
    const madeA = /`account_id` ([\w-]+)/.exec(first)?.[1]
    expect(madeA).toBeDefined()
    expect(first).toContain('The next file of this account')
    await run({ file: julyB, new_account: { name: 'Bank B', kind: 'BANK' } })
    // The next file of each lands there: by the id, or by the same account named again.
    const third = await run({ file: augustA, account_id: madeA })
    expect(third).not.toContain('The next file of this account')
    await run({ file: augustB, new_account: { name: 'Bank B', kind: 'BANK' } })

    const after = await reopen(path)
    const { listAccounts } = await import('@/data/repositories/accountRepository.ts')
    expect(listAccounts(after).map((one) => one.name).sort()).toEqual(['Bank A', 'Bank B'])
    expect(listTransactions(after, {}, 500)).toHaveLength(11)
    after.close()
  })

  it('takes a backup before it writes', async () => {
    const { path, accountId } = await fixture()
    const before = await readFile(path)
    await importStatementTool.run(
      { path, file: BANK, account_id: accountId, columns: BANK_COLUMNS, commit: true },
      NO_CLIENT,
    )

    const backups = await listBackups(path)
    expect(backups.length).toBe(1)
    expect(await readFile(join(backupFolderFor(path), backups[0] ?? ''))).toEqual(before)
  })

  it('remembers the mapping, so the next file of the shape needs no columns', async () => {
    const { path, accountId } = await fixture()
    await importStatementTool.run(
      {
        path,
        file: BANK,
        account_id: accountId,
        columns: BANK_COLUMNS,
        save_mapping_as: 'Example Bank – current account',
        commit: true,
      },
      NO_CLIENT,
    )

    const db = await reopen(path)
    expect(listMappings(db).map((one) => one.name)).toContain('Example Bank – current account')
    db.close()

    // And the saved mapping is now what recognises the file: no `columns`.
    const again = await importStatementTool.run(
      { path, file: BANK, account_id: accountId },
      NO_CLIENT,
    )
    expect(again).toContain('reader "Example Bank – current account"')
  })

  it('refuses a mapping missing a required role, naming which', async () => {
    const { path, accountId } = await fixture()
    await expect(
      importStatementTool.run(
        { path, file: BANK, account_id: accountId, columns: { 0: 'date' } },
        NO_CLIENT,
      ),
    ).rejects.toThrow(/merchant/)
  })

  it('refuses a role it does not have', async () => {
    const { path, accountId } = await fixture()
    await expect(
      importStatementTool.run(
        { path, file: BANK, account_id: accountId, columns: { 0: 'when' } },
        NO_CLIENT,
      ),
    ).rejects.toThrow(/must be one of/)
  })

  it('refuses an account it cannot find', async () => {
    const { path } = await fixture()
    await expect(
      importStatementTool.run({ path, file: BANK, account_id: 'nope' }, NO_CLIENT),
    ).rejects.toThrow(/No account with id nope/)
  })

  it('refuses an older document without importing or backing up', async () => {
    const db = await createDatabase(19)
    const bytes = exportDatabase(db)
    db.close()
    const dir = await tempDir('emerald-ingest-')
    const path = join(dir, 'old.emd')
    await writeFile(path, bytes)
    const before = await readFile(path)

    const text = await importStatementTool.run(
      { path, file: BANK, account_id: 'x', columns: BANK_COLUMNS, commit: true },
      NO_CLIENT,
    )

    expect(text).toContain('REFUSED')
    expect(await readFile(path)).toEqual(before)
    expect(await listBackups(path)).toEqual([])
  })
})

/**
 * A card statement that states its own total, which the synthetic bank fixture
 * does not — it prints an opening balance, and `findPrintedTotal` is
 * deliberately narrow about what counts as a total. Written here rather than
 * added to `fixtures/synthetic/` because it exists to exercise one branch, and
 * the refusal it proves is this unit's headline acceptance criterion.
 */
const CARD_CSV = [
  'כרטיס אשראי לדוגמה,,',
  // Deliberately no total-ish word in the preamble: `findPrintedTotal` scans
  // there as well as in the trailing rows, and a preamble line reading
  // "עסקאות לחיוב ב-02/08/2026" gets read as a total of 2,026 (docs/08).
  'פירוט עסקאות,,',
  ',,',
  'תאריך עסקה,שם בית עסק,סכום חיוב',
  '03/07/2026,שופרסל דיל,120.50',
  '05/07/2026,פז יעלים,300.00',
  '11/07/2026,ארומה תל אביב,29.50',
  ',,',
  'סך הכל,,450.00',
].join('\n')

async function cardFile(): Promise<string> {
  const dir = await tempDir('emerald-card-')
  const file = join(dir, 'card-statement.csv')
  await writeFile(file, CARD_CSV, 'utf8')
  return file
}

const CARD_COLUMNS = { 0: 'date', 1: 'merchant', 2: 'amount' }

describe('the file has to add up to what it says it does', () => {
  it('says so when the file prints no total to check against', async () => {
    // The synthetic bank statement is this case: an opening balance is not a
    // total, and reading one as though it were would be worse than saying there
    // is nothing to check.
    const { path, accountId } = await fixture()
    const text = await importStatementTool.run(
      { path, file: BANK, account_id: accountId, columns: BANK_COLUMNS },
      NO_CLIENT,
    )
    expect(text).toContain('prints no total of its own')
  })

  it('reconciles when the mapping is right, and says where it read the figure', async () => {
    const { path, accountId } = await fixture()
    const file = await cardFile()

    const text = await importStatementTool.run(
      { path, file, account_id: accountId, columns: CARD_COLUMNS },
      NO_CLIENT,
    )

    expect(text).toContain('**Reconciles.**')
    expect(text).toContain('₪450.00')
    // A claim about the file names the cell it came out of, so the user can go
    // and look — `Sheet1!9` is the row the total is on.
    expect(text).toMatch(/read from Sheet1!\d+/)
  })

  it('refuses to commit a parse the file itself contradicts', async () => {
    // Mapping the date column as the amount parses without error and produces
    // figures the file says are wrong. The app colours that red and lets the
    // user decide, because they are looking at the table; from a conversation
    // nobody is, so this refuses (D-100).
    const { path, accountId } = await fixture()
    const file = await cardFile()
    const wrong = { 0: 'date', 1: 'merchant', 2: 'amount', 3: 'note' }

    const preview = await importStatementTool.run(
      { path, file, account_id: accountId, columns: wrong, header_row: 3 },
      NO_CLIENT,
    )
    expect(preview).toContain('Reconciles')

    // Now drop a row by starting the data one line late: the parse comes to
    // less than the file says, which is exactly the shape of a real mis-map.
    const short = await importStatementTool.run(
      { path, file, account_id: accountId, columns: CARD_COLUMNS, header_row: 4 },
      NO_CLIENT,
    )
    expect(short).toContain('**Does not reconcile.**')
    expect(short).toContain('refused by default')

    const refused = await importStatementTool.run(
      { path, file, account_id: accountId, columns: CARD_COLUMNS, header_row: 4, commit: true },
      NO_CLIENT,
    )
    expect(refused).toContain('does not add up to what it says it does')

    const db = await reopen(path)
    expect(listTransactions(db).length).toBe(0)
    db.close()
    // And no backup: the refusal happens before anything is copied, so a
    // rejected import does not leave a file behind meaning "nothing happened".
    expect(await listBackups(path)).toEqual([])
  })

  it('imports over the objection only when told to, explicitly', async () => {
    const { path, accountId } = await fixture()
    const file = await cardFile()

    const text = await importStatementTool.run(
      {
        path,
        file,
        account_id: accountId,
        columns: CARD_COLUMNS,
        header_row: 4,
        ignore_printed_total: true,
        commit: true,
      },
      NO_CLIENT,
    )

    expect(text).toContain('Imported')
    // And the answer still carries the disagreement rather than hiding it.
    expect(text).toContain('Does not reconcile')

    const db = await reopen(path)
    expect(listTransactions(db).length).toBeGreaterThan(0)
    db.close()
  })
})
