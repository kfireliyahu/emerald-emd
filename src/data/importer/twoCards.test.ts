import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { Database } from 'sql.js'
import { beforeEach, describe, expect, it } from 'vitest'

import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import type { DraftMapping } from '@/domain/model/importing.ts'
import { listAccounts } from '../repositories/accountRepository.ts'
import { saveMapping } from '../repositories/importMappingRepository.ts'
import { countTransactions, existingNaturalKeys } from '../repositories/transactionRepository.ts'
import { allParsed } from './apply.ts'
import { guessMapping } from './guess.ts'
import { statementRows } from './sections.ts'
import { readWorkbook, type SheetCell, type SheetTable, type SheetWorkbook } from './sheetTable.ts'
import { computeHeaderSignature } from './signature.ts'
import {
  cardsOf,
  cardsSentence,
  judgeSheet,
  readStatementWorkbook,
  sameLayoutSheets,
  sheetRows,
  sheetsFrom,
  writeSheets,
  type StatementSheet,
} from './statementBatch.ts'

/**
 * **A statement holding two cards becomes one account per card** — M59 U2,
 * D-578. Her file is not available (D-576), so both shapes a card export holds
 * two cards in are made up in `fixtures/synthetic/` and proved here: two
 * sections of one sheet, each with its card line and its header, and a sheet
 * per card.
 */
const fixture = (name: string): SheetWorkbook =>
  readWorkbook(name, new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../fixtures/synthetic/${name}`, import.meta.url)))))

const ONE_SHEET = 'two-cards-one-sheet.xlsx'
const TWO_SHEETS = 'two-cards-two-sheets.xlsx'

function sheetOf(workbook: SheetWorkbook, index = 0): SheetTable {
  const table = workbook.sheets[index]
  if (table === undefined) throw new Error('no sheet')
  return table
}

/** What the mapper starts from, and what a person who changes nothing reads with. */
function guessed(table: SheetTable): DraftMapping {
  const mapping = guessMapping(table)
  if (mapping === undefined) throw new Error('no header')
  return mapping
}

function read(fileName: string, table: SheetTable, mapping = guessed(table)): readonly StatementSheet[] {
  return sheetsFrom({
    id: fileName,
    fileName,
    fileHash: `hash:${fileName}`,
    table,
    mapping,
    mappingId: undefined,
    mappingName: undefined,
    boundAccountId: undefined,
  })
}

const parsedOf = (sheet: StatementSheet): number => allParsed(sheetRows(sheet)).length

describe('two cards on one sheet, each with its card line and header', () => {
  let db: Database
  beforeEach(async () => {
    db = await createLedgerDatabase()
  })

  it('is cut into one sheet per card, each read with its own header', () => {
    const sheets = read(ONE_SHEET, sheetOf(fixture(ONE_SHEET)))
    expect(sheets.map((sheet) => sheet.account.last4)).toEqual(['4821', '9356'])
    expect(sheets.map(parsedOf)).toEqual([4, 3])
    // Nothing of the second card's line or header is a row that failed.
    for (const sheet of sheets) expect(sheetRows(sheet).filter((row) => row.outcome.kind === 'error')).toEqual([])
    // A failed row still says the number the spreadsheet shows.
    expect(allParsed(sheetRows(sheets[1] as StatementSheet))[0]?.sourceRowRef).toBe('פירוט עסקאות!13')
  })

  it('says so before anything is written', () => {
    const sheets = read(ONE_SHEET, sheetOf(fixture(ONE_SHEET)))
    expect(cardsSentence(cardsOf(sheets))).toBe('2 cards: ••4821 · 4 rows, ••9356 · 3 rows')
    expect(countTransactions(db)).toBe(0)
  })

  it('each card adds up to the total printed under it', () => {
    for (const sheet of read(ONE_SHEET, sheetOf(fixture(ONE_SHEET)))) {
      expect(judgeSheet(db, sheet).reconciles).toBe(true)
    }
  })

  it('writes two accounts, each with its own rows', () => {
    writeSheets(db, read(ONE_SHEET, sheetOf(fixture(ONE_SHEET))).map((sheet) => ({ sheet, force: false })), 1)
    const accounts = listAccounts(db)
    expect(accounts.map((account) => account.last4).sort()).toEqual(['4821', '9356'])
    const by = (last4: string) => accounts.find((account) => account.last4 === last4)?.id ?? ''
    expect(existingNaturalKeys(db, by('4821')).size).toBe(4)
    expect(existingNaturalKeys(db, by('9356')).size).toBe(3)
  })

  it('the mapper previews every section with no failed row', () => {
    const table = sheetOf(fixture(ONE_SHEET))
    const rows = statementRows(table, guessed(table))
    expect(allParsed(rows)).toHaveLength(7)
    expect(rows.filter((row) => row.outcome.kind === 'error')).toEqual([])
  })

  it('a saved reader reads a later file of the same shape into the same two accounts', () => {
    const table = sheetOf(fixture(ONE_SHEET))
    const mapping = guessed(table)
    saveMapping(db, { name: 'Two cards', headerSignature: computeHeaderSignature(table, mapping.headerRowIndex), mapping, accountId: undefined }, 1)
    const first = readStatementWorkbook(db, { fileName: ONE_SHEET, fileHash: 'h1', workbook: fixture(ONE_SHEET), id: 'f1' })
    if (first.kind !== 'sheets') throw new Error('not read')
    expect(first.sheets.map((sheet) => sheet.account.last4)).toEqual(['4821', '9356'])
    writeSheets(db, first.sheets.map((sheet) => ({ sheet, force: false })), 2)

    // Next month's file: the same shape, read again — the same accounts, nothing new.
    const again = readStatementWorkbook(db, { fileName: ONE_SHEET, fileHash: 'h2', workbook: fixture(ONE_SHEET), id: 'f2' })
    if (again.kind !== 'sheets') throw new Error('not read')
    expect(again.sheets.map((sheet) => judgeSheet(db, sheet).state)).toEqual(['same', 'same'])
    expect(listAccounts(db)).toHaveLength(2)
  })
})

describe('two cards on two sheets', () => {
  let db: Database
  beforeEach(async () => {
    db = await createLedgerDatabase()
  })

  it('every sheet in the same layout is read, each sheet its own card', () => {
    const workbook = fixture(TWO_SHEETS)
    const first = sheetOf(workbook)
    const mapping = guessed(first)
    const others = sameLayoutSheets(workbook, first, mapping)
    expect(others.map((other) => other.table.name)).toEqual(['כרטיס 9356'])
    const sheets = [
      ...read(TWO_SHEETS, first, mapping),
      ...others.flatMap((other) => read(`${TWO_SHEETS}#2`, other.table, other.mapping)),
    ]
    expect(cardsSentence(cardsOf(sheets))).toBe('2 cards: ••4821 · 4 rows, ••9356 · 3 rows')
    writeSheets(db, sheets.map((sheet) => ({ sheet, force: false })), 1)
    const accounts = listAccounts(db)
    const by = (last4: string) => accounts.find((account) => account.last4 === last4)?.id ?? ''
    expect(existingNaturalKeys(db, by('4821')).size).toBe(4)
    expect(existingNaturalKeys(db, by('9356')).size).toBe(3)
  })

  it('a saved reader reads both sheets, never only the first', () => {
    const workbook = fixture(TWO_SHEETS)
    const first = sheetOf(workbook)
    const mapping = guessed(first)
    saveMapping(db, { name: 'Card', headerSignature: computeHeaderSignature(first, mapping.headerRowIndex), mapping, accountId: undefined }, 1)
    const found = readStatementWorkbook(db, { fileName: TWO_SHEETS, fileHash: 'h', workbook, id: 'f' })
    if (found.kind !== 'sheets') throw new Error('not read')
    expect(found.sheets.map((sheet) => sheet.account.last4)).toEqual(['4821', '9356'])
    expect(found.rest).toEqual([])
  })

  it('a sheet of transactions no reader knows waits rather than being dropped', () => {
    const workbook = fixture(TWO_SHEETS)
    const first = sheetOf(workbook)
    const mapping = guessed(first)
    saveMapping(db, { name: 'Card', headerSignature: computeHeaderSignature(first, mapping.headerRowIndex), mapping, accountId: undefined }, 1)
    // The second card's sheet in another layout: its columns in another order.
    const second = sheetOf(workbook, 1)
    const moved: SheetTable = { ...second, rows: second.rows.map((row) => [row[1], row[0], row[2], row[3]].map((cell) => cell ?? EMPTY)) }
    const found = readStatementWorkbook(db, { fileName: TWO_SHEETS, fileHash: 'h', workbook: { ...workbook, sheets: [first, moved] }, id: 'f' })
    if (found.kind !== 'sheets') throw new Error('not read')
    expect(found.sheets).toHaveLength(1)
    expect(found.rest.map((table) => table.name)).toEqual(['כרטיס 9356'])
  })
})

const EMPTY: SheetCell = { kind: 'empty', text: '' }
const s = (text: string): SheetCell => ({ kind: 'string', text, value: text })
const n = (value: number): SheetCell => ({ kind: 'number', text: value.toFixed(2), value })

describe('a card column holding two cards', () => {
  it('a mapped card column wins, and each card is a sheet of its own', async () => {
    const db = await createLedgerDatabase()
    const table: SheetTable = {
      name: 'עסקאות',
      columnCount: 4,
      rows: [
        [s('תאריך עסקה'), s('שם בית עסק'), s('סכום חיוב'), s('4 ספרות אחרונות של כרטיס האשראי')],
        [s('03/07/2026'), s('מאפיית הדוגמה'), n(42.5), s('4821')],
        [s('04/07/2026'), s('בית קפה לדוגמה'), n(36), s('9356')],
        [s('09/07/2026'), s('סופר לדוגמה'), n(318.9), s('4821')],
      ],
    }
    const mapping: DraftMapping = {
      sheetName: 'עסקאות',
      headerRowIndex: 0,
      dataStartRowIndex: 1,
      columnRoles: new Map([
        [0, 'date'],
        [1, 'merchant'],
        [2, 'amount'],
        [3, 'cardLast4'],
      ]),
      amountConvention: 'POSITIVE_IS_CHARGE',
      dateOrders: new Map([['date', 'DMY']]),
      defaultCurrency: 'ILS',
    }
    const sheets = read('max.xlsx', table, mapping)
    expect(cardsSentence(cardsOf(sheets))).toBe('2 cards: ••4821 · 2 rows, ••9356 · 1 row')
    writeSheets(db, sheets.map((sheet) => ({ sheet, force: false })), 1)
    expect(listAccounts(db).map((account) => account.last4).sort()).toEqual(['4821', '9356'])
  })
})

describe('a file holding one card', () => {
  it('is read as it always was: one sheet, the same table', () => {
    const workbook = fixture(TWO_SHEETS)
    const table = sheetOf(workbook)
    const sheets = read(TWO_SHEETS, table)
    expect(sheets).toHaveLength(1)
    expect(sheets[0]?.table).toBe(table)
    expect(sheets[0]?.id).toBe(TWO_SHEETS)
    expect(cardsSentence(cardsOf(sheets))).toBeUndefined()
  })
})
