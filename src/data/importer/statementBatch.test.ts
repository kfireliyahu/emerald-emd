import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'

import { createDatabase } from '@/data/db/database.ts'
import { installLedgerPack } from '@/data/packs/ledger/pack.ts'
import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import type { DraftMapping } from '@/domain/model/importing.ts'
import { createAccount, listAccounts } from '../repositories/accountRepository.ts'
import { saveMapping } from '../repositories/importMappingRepository.ts'
import { countTransactions } from '../repositories/transactionRepository.ts'
import { computeHeaderSignature } from './signature.ts'
import type { SheetCell, SheetTable } from './sheetTable.ts'
import { LEFT_OUT, summarize } from './apply.ts'
import {
  accountNameIn,
  correct,
  judgeSheet,
  sheetRows,
  monthsOf,
  readStatementWorkbook,
  sheetFrom,
  writeSheets,
  type StatementSheet,
} from './statementBatch.ts'

const s = (text: string): SheetCell => ({ kind: 'string', text, value: text })
const E: SheetCell = { kind: 'empty', text: '' }
const n = (value: number): SheetCell => ({ kind: 'number', text: value.toFixed(2), value })

/** A synthetic card statement: three rows, a printed total, and a row that may not read. */
function statement(third: SheetCell, printed = 180.5): SheetTable {
  return {
    name: 'Card 7781',
    columnCount: 5,
    rows: [
      [s('תאריך'), s('בית עסק'), s('סכום')],
      [s('03/08/2026'), s('Shufersal'), n(100)],
      [s('12/08/2026'), s('Paz'), n(0.5)],
      [s('14/08/2026'), s('Car insurance'), third],
      [E, E, E, s('סה"כ לחיוב'), n(printed)],
    ],
  }
}

const MAPPING: DraftMapping = {
  sheetName: 'Card 7781',
  headerRowIndex: 0,
  dataStartRowIndex: 1,
  columnRoles: new Map([
    [0, 'date'],
    [1, 'merchant'],
    [2, 'amount'],
  ]),
  amountConvention: 'POSITIVE_IS_CHARGE',
  dateOrders: new Map([['date', 'DMY']]),
  defaultCurrency: 'ILS',
}

describe('a statement read in a batch', () => {
  let db: Database
  let accountId: string

  beforeEach(async () => {
    db = await createLedgerDatabase()
    accountId = createAccount(db, { name: 'Card 7781', kind: 'CREDIT_CARD', last4: '7781' }, 1).id
    saveMapping(
      db,
      {
        name: 'Synthetic card',
        headerSignature: computeHeaderSignature(statement(n(80)), 0),
        mapping: MAPPING,
        accountId,
      },
      1,
    )
  })

  const read = (table: SheetTable): StatementSheet => {
    const found = readStatementWorkbook(db, {
      fileName: 'card-7781-2026-08.xlsx',
      fileHash: 'hash-1',
      workbook: { sheets: [table] } as never,
      id: 'f1',
    })
    if (found.kind !== 'sheets') throw new Error('not read')
    const sheet = found.sheets[0]
    if (sheet === undefined) throw new Error('no sheet')
    return sheet
  }

  it('is read by the saved mapping it fits, and goes to the account that mapping names', () => {
    const sheet = read(statement(n(80)))
    expect(sheet.mappingId).toBeDefined()
    expect(sheet.account.boundAccountId).toBe(accountId)
  })

  it('a layout nothing knows is a new layout, for the mapper', () => {
    const other: SheetTable = { name: 'x', columnCount: 2, rows: [[s('when'), s('what')]] }
    const found = readStatementWorkbook(db, {
      fileName: 'other.csv',
      fileHash: 'h',
      workbook: { sheets: [other] } as never,
      id: 'f2',
    })
    expect(found.kind).toBe('new-layout')
  })

  it('a sheet whose rows come to its printed total is ticked, and writes nothing until written', () => {
    const verdict = judgeSheet(db, read(statement(n(80))))
    expect(verdict.state).toBe('ok')
    expect(verdict.reconciles).toBe(true)
    expect(verdict.newRows).toBe(3)
    expect(countTransactions(db)).toBe(0)
  })

  it('a row that did not read leaves a gap, and typing what its cell says closes it', () => {
    const sheet = read(statement(s('#VALUE?')))
    const before = judgeSheet(db, sheet)
    // The printed total disagrees with the two rows that read, or the row is
    // missing entirely: either way the file asks for a look.
    expect(before.state).toBe('gap')

    const fixed = correct(sheet, 3, 2, '80.00')
    const after = judgeSheet(db, fixed)
    expect(after.state).toBe('ok')
    expect(after.failed).toHaveLength(0)
    expect(after.reconciles).toBe(true)
  })

  it('writes the ticked sheets, and a second read of the same file is already here', () => {
    const sheet = read(statement(n(80)))
    const written = writeSheets(db, [{ sheet, force: false }], 2)
    expect(written[0]?.result.imported).toBe(3)
    expect(countTransactions(db)).toBe(3)
    expect(monthsOf(judgeSheet(db, sheet).rows)).toEqual(['2026-08'])

    const again = judgeSheet(db, read(statement(n(80))))
    expect(again.state).toBe('same')
    expect(again.duplicates).toBe(3)
  })

  it('a sheet from the mapper names the account it would create without creating it', () => {
    const sheet = sheetFrom({
      id: 'm1',
      fileName: 'card-2290.xlsx',
      fileHash: 'h2',
      table: statement(n(80)),
      mapping: MAPPING,
      mappingId: undefined,
      mappingName: undefined,
      boundAccountId: undefined,
      kind: 'CREDIT_CARD',
    })
    expect(sheet.account.boundAccountId).toBeUndefined()
    expect(judgeSheet(db, sheet).accountId).toBeUndefined()
  })
})

describe('a row the mapper could not read, skipped from that read (M55 U9)', () => {
  // The printed total line, with its word where the date is.
  const table: SheetTable = {
    name: 'Card 7781',
    columnCount: 3,
    rows: [
      [s('תאריך'), s('בית עסק'), s('סכום')],
      [s('03/08/2026'), s('Shufersal'), n(100)],
      [s('12/08/2026'), s('Paz'), n(0.5)],
      [s('סה"כ'), s('Total'), n(100.5)],
    ],
  }
  const of = (skipped?: ReadonlySet<number>): StatementSheet =>
    sheetFrom({
      id: 'f:Card 7781',
      fileName: 'card.xlsx',
      fileHash: 'h',
      table,
      mapping: MAPPING,
      mappingId: undefined,
      mappingName: undefined,
      boundAccountId: undefined,
      skipped,
    })

  it('fails as it stands', () => {
    expect(summarize(sheetRows(of()))).toEqual({ parsed: 2, errors: 1, skipped: 0 })
  })

  it('is left out and counted as skipped, and the rest read as they did', () => {
    const rows = sheetRows(of(new Set([3])))
    expect(summarize(rows)).toEqual({ parsed: 2, errors: 0, skipped: 1 })
    expect(rows[2]?.outcome).toEqual({ kind: 'skipped', reason: LEFT_OUT })
  })

  it('never leaves out a row that reads', () => {
    expect(summarize(sheetRows(of(new Set([1]))))).toEqual({ parsed: 2, errors: 1, skipped: 0 })
  })
})

/** **The account a statement makes is named in the document's language** — M60 U4, D-589 (D-587). */
describe('the card a statement makes in place', () => {
  const made = async (language: 'en' | 'he'): Promise<Database> => {
    const db = await createDatabase()
    const installed = installLedgerPack(db, 1, language)
    if (!installed.ok) throw new Error(installed.error)
    return db
  }
  const sheet = (): StatementSheet => {
    const read = sheetFrom({
      id: 'm1',
      fileName: 'card.xlsx',
      fileHash: 'h3',
      table: statement(n(80)),
      mapping: MAPPING,
      mappingId: undefined,
      mappingName: undefined,
      boundAccountId: undefined,
      kind: 'CREDIT_CARD',
    })
    return { ...read, account: { ...read.account, last4: '2290', fallbackName: 'Card 2290' } }
  }

  it('is Card 1234 in a document made in English, and כרטיס 1234 in one made in Hebrew', async () => {
    const english = await made('en')
    const hebrew = await made('he')
    expect(judgeSheet(english, sheet()).accountName).toBe('Card 2290')
    expect(judgeSheet(hebrew, sheet()).accountName).toBe('כרטיס 2290')
    writeSheets(hebrew, [{ sheet: sheet(), force: false }], 2)
    expect(listAccounts(hebrew).map((account) => account.name)).toContain('כרטיס 2290')
  })

  it('leaves a name the person gave alone', async () => {
    const hebrew = await made('he')
    expect(accountNameIn(hebrew, 'Everyday card', '2290')).toBe('Everyday card')
    expect(accountNameIn(hebrew, 'Card 2290', undefined)).toBe('Card 2290')
  })
})
