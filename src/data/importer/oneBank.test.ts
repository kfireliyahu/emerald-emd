import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'

import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import type { DraftMapping } from '@/domain/model/importing.ts'
import { createAccount, listAccounts, mergeAccounts } from '../repositories/accountRepository.ts'
import { findMappingById, saveMapping } from '../repositories/importMappingRepository.ts'
import { countTransactions } from '../repositories/transactionRepository.ts'
import { defaultMappingName } from './mappingName.ts'
import { computeHeaderSignature } from './signature.ts'
import { readWorkbook, type SheetCell, type SheetTable } from './sheetTable.ts'
import {
  judgeBatch,
  judgeSheet,
  keepApart,
  pointAt,
  readStatementWorkbook,
  sheetFrom,
  writeSheets,
  type StatementSheet,
} from './statementBatch.ts'

/**
 * **Two exports of one bank are one account** — M28 F11.
 *
 * A bank's app export was read (a CSV, January to early August) and
 * then its website report (an xlsx, August to October). Same bank, same account,
 * a week of August in both — and two layouts: the CSV has five columns, the
 * report six, in another order, under a title block, with an address line under
 * the rows. A second reader was right. A second *account* was not, and its rows
 * of that August week were written twice. Synthetic figures throughout, shaped
 * like the two real files.
 */

const LRM = '‎'
const shekel = (amount: string): string => `"${LRM}₪${amount}"`

/** The app export: newest first, `06.8.2026`, `‎₪-170.00` with a thousands comma. */
const APP_EXPORT = [
  'תאריך,תיאור,אסמכתא,סכום,יתרה',
  `06.8.2026,העברה לדוגמה,63001,${shekel('-120.00')},${shekel('9,700.00')}`,
  `04.8.2026,שכר דירה לדוגמה,61002,${shekel('-4,000.00')},${shekel('9,820.00')}`,
  `03.8.2026,משכורת לדוגמה,55003,${shekel('12,000.00')},${shekel('13,820.00')}`,
  `20.7.2026,העברה לדוגמה,40004,${shekel('-120.00')},${shekel('1,820.00')}`,
  `10.7.2026,חיוב אשראי חודשי,30005,${shekel('-1,500.00')},${shekel('1,940.00')}`,
].join('\n')

const s = (text: string): SheetCell => ({ kind: 'string', text, value: text })
const n = (value: number): SheetCell => ({ kind: 'number', text: String(value), value })
const E: SheetCell = { kind: 'empty', text: '' }

/** The website report: a title block, six columns, and the bank's address under the rows. */
function websiteReport(rows: readonly (readonly [string, string, number, number, string])[]): SheetTable {
  return {
    name: '01.08.2026 - 01.10.2026',
    columnCount: 6,
    rows: [
      [s('דוח תנועות בחשבון'), E, E, E, E, E],
      [s('מספר סניף:'), s('000-000000/00'), E, E, E, E],
      [E, E, s('תקופת הדוח:'), s('01.08.2026 - 01.10.2026'), E, E],
      [E, E, E, E, E, E],
      [s('תאריך'), s('תיאור'), s('סכום'), s('מטבע'), s('יתרה'), s('אסמכתא')],
      ...rows.map(([date, what, amount, balance, ref]) => [s(date), s(what), n(amount), s('ILS'), n(balance), s(ref)]),
      [E, E, E, E, E, E],
      [s('רחוב לדוגמה 1, תל אביב | בנק הפועלים'), E, E, E, E, E],
    ],
  }
}

const AUGUST_ON: readonly (readonly [string, string, number, number, string])[] = [
  ['02/09/2026', 'משכורת לדוגמה', 12000, 21580, '70001'],
  ['14/08/2026', 'העברה לדוגמה', -120, 9580, '66002'],
  ['06/08/2026', 'העברה לדוגמה', -120, 9700, '63001'],
  ['04/08/2026', 'שכר דירה לדוגמה', -4000, 9820, '61002'],
  ['03/08/2026', 'משכורת לדוגמה', 12000, 13820, '55003'],
]

const REPORT_FILE = 'דוח תנועות בחשבון 01.01.26-01.03.26.xlsx'

const REPORT_MAPPING: DraftMapping = {
  sheetName: '01.08.2026 - 01.10.2026',
  headerRowIndex: 4,
  dataStartRowIndex: 5,
  columnRoles: new Map([
    [0, 'date'],
    [1, 'merchant'],
    [2, 'amount'],
    [3, 'currency'],
    [4, 'balance'],
    [5, 'reference'],
  ]),
  amountConvention: 'SIGNED_SINGLE',
  dateOrders: new Map([['date', 'DMY']]),
  defaultCurrency: 'ILS',
}

describe('two exports of one bank', () => {
  let db: Database
  let everyday: string

  beforeEach(async () => {
    db = await createLedgerDatabase()
    // The app export, read first, by a reader of its own, into the bank account.
    const csv = readWorkbook('everyday-bank.csv', new TextEncoder().encode(`﻿${APP_EXPORT}`))
    const table = csv.sheets[0]
    if (table === undefined) throw new Error('no sheet')
    everyday = createAccount(db, { name: 'Hapoalim', kind: 'BANK' }, 1).id
    const mapping: DraftMapping = {
      sheetName: table.name,
      headerRowIndex: 0,
      dataStartRowIndex: 1,
      columnRoles: new Map([
        [0, 'date'],
        [1, 'merchant'],
        [2, 'reference'],
        [3, 'amount'],
        [4, 'balance'],
      ]),
      amountConvention: 'SIGNED_SINGLE',
      dateOrders: new Map([['date', 'DMY']]),
      defaultCurrency: 'ILS',
    }
    const saved = saveMapping(
      db,
      { name: 'Hapoalim', headerSignature: computeHeaderSignature(table, 0), mapping, accountId: everyday },
      1,
    )
    const sheet = sheetFrom({
      id: 'csv',
      fileName: 'everyday-bank.csv',
      fileHash: 'csv',
      table,
      mapping,
      mappingId: saved.id,
      mappingName: saved.name,
      boundAccountId: everyday,
    })
    expect(judgeSheet(db, sheet).state).toBe('ok')
    writeSheets(db, [{ sheet, force: false }], 2)
    expect(countTransactions(db)).toBe(5)
  })

  /** The report, as the mapper hands it back the first time: a new layout, a new reader. */
  function fromTheMapper(table = websiteReport(AUGUST_ON)): StatementSheet {
    const name = defaultMappingName({ fileName: REPORT_FILE, table, headerRowIndex: 4 })
    const saved = saveMapping(
      db,
      { name, headerSignature: computeHeaderSignature(table, 4), mapping: REPORT_MAPPING },
      3,
    )
    return sheetFrom({
      id: 'xlsx',
      fileName: REPORT_FILE,
      fileHash: `xlsx-${String(table.rows.length)}`,
      table,
      mapping: REPORT_MAPPING,
      mappingId: saved.id,
      mappingName: saved.name,
      boundAccountId: undefined,
      kind: 'BANK',
    })
  }

  it('is genuinely two layouts: the report is not the reader the app export taught', () => {
    const found = readStatementWorkbook(db, {
      fileName: REPORT_FILE,
      fileHash: 'x',
      workbook: { sheets: [websiteReport(AUGUST_ON)] } as never,
      id: 'f',
    })
    expect(found.kind).toBe('new-layout')
  })

  it('names the report’s reader after the bank its footer names, never after its dates', () => {
    expect(defaultMappingName({ fileName: REPORT_FILE, table: websiteReport(AUGUST_ON), headerRowIndex: 4 })).toBe(
      'Hapoalim',
    )
    const bare: SheetTable = { name: 'x', columnCount: 1, rows: [[s('תאריך')]] }
    expect(defaultMappingName({ fileName: REPORT_FILE, table: bare, headerRowIndex: 0 })).toBe('דוח תנועות בחשבון')
    expect(
      defaultMappingName({ fileName: 'transaction-details_export_1700000000000.xlsx', table: bare, headerRowIndex: 0 }),
    ).toBe('transaction-details_export')
  })

  it('a row of one account reads to the same key under both readers, so the overlap is caught', () => {
    const sheet = { ...fromTheMapper(), account: { ...fromTheMapper().account, boundAccountId: everyday } }
    const verdict = judgeSheet(db, sheet)
    expect(verdict.accountId).toBe(everyday)
    expect(verdict.duplicates).toBe(3)
    expect(verdict.newRows).toBe(2)
  })

  it('a report whose rows are already in another account stops and says which, rather than making a second bank', () => {
    // Named for the file, as it was before this unit: the account the screen
    // would have made was a new one, and nothing said its rows were in Hapoalim.
    const named = fromTheMapper()
    const sheet = { ...named, account: { ...named.account, fallbackName: 'דוח תנועות בחשבון 01.01.26-01.03.26' } }
    const verdict = judgeSheet(db, sheet)
    expect(verdict.accountId).toBeUndefined()
    expect(verdict.state).toBe('elsewhere')
    expect(verdict.elsewhere?.accountId).toBe(everyday)
    expect(verdict.elsewhere?.rows).toBe(3)

    const into = pointAt(sheet, verdict.elsewhere ?? (undefined as never))
    const after = judgeSheet(db, into)
    expect(after.state).toBe('ok')
    expect(after.newRows).toBe(2)
    writeSheets(db, [{ sheet: into, force: false }], 4)
    expect(countTransactions(db)).toBe(7)
    expect(listAccounts(db).filter((account) => account.kind === 'BANK')).toHaveLength(1)
  })

  it('keep apart is the person’s say: it writes where it was going, overlap and all', () => {
    const named = fromTheMapper()
    const sheet = keepApart({ ...named, account: { ...named.account, fallbackName: 'Second account' } })
    const verdict = judgeSheet(db, sheet)
    expect(verdict.state).toBe('ok')
    expect(verdict.elsewhere?.accountId).toBe(everyday)
    writeSheets(db, [{ sheet, force: false }], 4)
    expect(listAccounts(db).filter((account) => account.kind === 'BANK')).toHaveLength(2)
  })

  it('a reader learns its account on first use, so next month’s export goes there with no overlap to go by', () => {
    const named = fromTheMapper()
    const sheet = { ...named, account: { ...named.account, boundAccountId: everyday } }
    writeSheets(db, [{ sheet, force: false }], 4)
    expect(sheet.mappingId).toBeDefined()
    expect(findMappingById(db, sheet.mappingId ?? '')?.accountId).toBe(everyday)

    const october = websiteReport([['05/10/2026', 'העברה לדוגמה', -120, 21460, '80001']])
    const found = readStatementWorkbook(db, { fileName: 'report-oct.xlsx', fileHash: 'oct', workbook: { sheets: [october] } as never, id: 'o' })
    if (found.kind !== 'sheets') throw new Error('not recognised')
    const next = found.sheets[0]
    if (next === undefined) throw new Error('no sheet')
    expect(next.account.boundAccountId).toBe(everyday)
    expect(judgeSheet(db, next).state).toBe('ok')
  })

  it('a re-read of a report its reader found by name is already written, not new', () => {
    const named = fromTheMapper()
    const sheet = keepApart({ ...named, account: { ...named.account, fallbackName: 'Report account' } })
    writeSheets(db, [{ sheet, force: false }], 4)
    // As in a document written before this unit: a reader with no account, whose
    // account is the one named after it.
    db.run('UPDATE fmt_import_mapping SET account = NULL WHERE id = ?', [sheet.mappingId ?? ''])
    const again = judgeSheet(db, { ...sheet, account: { ...sheet.account, separate: undefined } })
    expect(again.duplicates).toBe(5)
    expect(again.state).toBe('same')
  })

  it('merging the second bank into the first binds the reader that made it, so the next export does not make it again', () => {
    const named = fromTheMapper()
    const sheet = keepApart({ ...named, account: { ...named.account, fallbackName: 'Report account' } })
    writeSheets(db, [{ sheet, force: false }], 4)
    db.run('UPDATE fmt_import_mapping SET account = NULL WHERE id = ?', [sheet.mappingId ?? ''])
    const second = listAccounts(db).find((account) => account.name === 'Report account')
    if (second === undefined) throw new Error('no second account')

    mergeAccounts(db, second.id, everyday, 5)
    expect(countTransactions(db)).toBe(7)
    expect(findMappingById(db, sheet.mappingId ?? '')?.accountId).toBe(everyday)
  })

  it('one coincidence is not an account, and a transfer between two of one’s own accounts is not an overlap', () => {
    const report = websiteReport([
      ['14/08/2026', 'אחר', -50, 13530, '66009'],
      ['06/08/2026', 'העברה לדוגמה', -120, 13580, '63001'],
      ['04/08/2026', 'שכר דירה לדוגמה', 4000, 13700, '61002'],
    ])
    const named = fromTheMapper(report)
    const verdict = judgeSheet(db, { ...named, account: { ...named.account, fallbackName: 'Other bank' } })
    expect(verdict.elsewhere).toBeUndefined()
    expect(verdict.state).not.toBe('elsewhere')
  })
})

/**
 * **One batch makes its accounts once** — M28 F15.
 *
 * Four exports were added at once — two of one bank in two layouts, two
 * months of another — and the accounts the first two were about to make were
 * not there for the next two: the report could not find its rows in the CSV
 * that had not been written yet, and *Into* offered only accounts the document
 * already had. It took two passes. Here it takes one: every sheet is judged
 * against the sheets before it, and Write makes each account once.
 */
describe('four files of two banks in one batch', () => {
  const LEUMI_JULY = 'לאומי-יולי.csv'
  const LEUMI_AUGUST = 'לאומי-אוגוסט.csv'
  const APP_MAPPING: DraftMapping = {
    sheetName: '',
    headerRowIndex: 0,
    dataStartRowIndex: 1,
    columnRoles: new Map([
      [0, 'date'],
      [1, 'merchant'],
      [2, 'reference'],
      [3, 'amount'],
      [4, 'balance'],
    ]),
    amountConvention: 'SIGNED_SINGLE',
    dateOrders: new Map([['date', 'DMY']]),
    defaultCurrency: 'ILS',
  }
  const LEUMI_MAPPING: DraftMapping = {
    sheetName: '',
    headerRowIndex: 0,
    dataStartRowIndex: 1,
    columnRoles: new Map([
      [0, 'date'],
      [1, 'merchant'],
      [2, 'amount'],
    ]),
    amountConvention: 'SIGNED_SINGLE',
    dateOrders: new Map([['date', 'DMY']]),
    defaultCurrency: 'ILS',
  }
  const leumi = (rows: readonly string[]): string => ['תאריך,תיאור,סכום', ...rows].join('\n')

  let db: Database

  beforeEach(async () => {
    db = await createLedgerDatabase()
  })

  function csvTable(fileName: string, text: string): SheetTable {
    const table = readWorkbook(fileName, new TextEncoder().encode(`﻿${text}`)).sheets[0]
    if (table === undefined) throw new Error('no sheet')
    return table
  }

  /** A file read by a reader the mapper has just saved, as the batch holds it — nothing bound yet. */
  function mapped(id: string, fileName: string, table: SheetTable, mapping: DraftMapping, name: string) {
    const fitted = { ...mapping, sheetName: table.name }
    const saved = saveMapping(
      db,
      { name, headerSignature: computeHeaderSignature(table, fitted.headerRowIndex), mapping: fitted },
      1,
    )
    const sheet = sheetFrom({
      id,
      fileName,
      fileHash: id,
      table,
      mapping: fitted,
      mappingId: saved.id,
      mappingName: saved.name,
      boundAccountId: undefined,
      kind: 'BANK',
    })
    return { id, sheet }
  }

  /** The CSV and the report of one bank, two months of another — in the order they were added. */
  function theBatch(appName: string): { readonly id: string; readonly sheet: StatementSheet }[] {
    const july = csvTable(LEUMI_JULY, leumi(['01/07/2026,סופר לדוגמה,-250.00', '05/07/2026,דלק לדוגמה,-300.00']))
    const august = csvTable(LEUMI_AUGUST, leumi(['02/08/2026,סופר לדוגמה,-260.00', '09/08/2026,ספרים לדוגמה,-90.00']))
    const app = mapped('app', 'everyday-bank.csv', csvTable('everyday-bank.csv', APP_EXPORT), APP_MAPPING, appName)
    const first = mapped('july', LEUMI_JULY, july, LEUMI_MAPPING, 'Leumi')
    const report = mapped('report', REPORT_FILE, websiteReport(AUGUST_ON), REPORT_MAPPING, 'Hapoalim')
    // August's layout is July's, so July's reader reads it — as the batch reads
    // a waiting file once the first of its layout is mapped.
    const found = readStatementWorkbook(db, { fileName: LEUMI_AUGUST, fileHash: 'august', workbook: { sheets: [august] } as never, id: 'august' })
    if (found.kind !== 'sheets' || found.sheets[0] === undefined) throw new Error('August not recognised')
    return [app, first, report, { id: 'august', sheet: found.sheets[0] }]
  }

  const whenOk = (_: string, verdict: { readonly state: string }): boolean => verdict.state === 'ok'

  it('finds the report’s rows in the CSV above it before either is written, and Into makes them one account', () => {
    const batch = theBatch('Hapoalim app')
    const first = judgeBatch(db, batch, whenOk)
    expect(first.verdicts.get('app')?.state).toBe('ok')
    expect(first.verdicts.get('july')?.state).toBe('ok')
    // Two accounts on their way, neither in the document yet.
    expect(first.pending.map((each) => [each.name, each.accountId])).toEqual([
      ['Hapoalim app', undefined],
      ['Leumi', undefined],
    ])

    const report = first.verdicts.get('report')
    expect(report?.state).toBe('elsewhere')
    expect(report?.elsewhere?.accountName).toBe('Hapoalim app')
    expect(report?.elsewhere?.madeBy).toBe('everyday-bank.csv')
    expect(report?.elsewhere?.rows).toBe(3)

    // August goes where July goes, by its reader: nothing to say, same pass.
    const august = first.verdicts.get('august')
    expect(august?.state).toBe('ok')
    expect(august?.accountId).toBeUndefined()
    expect(august?.madeBy).toBe(LEUMI_JULY)

    // *Into Hapoalim app* — and no Write in between.
    const held = report?.elsewhere
    if (held === undefined) throw new Error('no overlap')
    const into = batch.map((each) => (each.id === 'report' ? { ...each, sheet: pointAt(each.sheet, held) } : each))
    const second = judgeBatch(db, into, whenOk)
    const joined = second.verdicts.get('report')
    expect(joined?.state).toBe('ok')
    expect(joined?.madeBy).toBe('everyday-bank.csv')
    expect(joined?.duplicates).toBe(3)
    expect(joined?.newRows).toBe(2)
    expect([...second.verdicts.values()].every((verdict) => verdict.state === 'ok')).toBe(true)

    writeSheets(db, into.map(({ sheet }) => ({ sheet, force: false })), 2)
    const banks = listAccounts(db).filter((account) => account.kind === 'BANK')
    expect(banks.map((account) => account.name).sort()).toEqual(['Hapoalim app', 'Leumi'])
    // 5 + 2 of Hapoalim (the shared August week once), 2 + 2 of Leumi.
    expect(countTransactions(db)).toBe(11)
  })

  it('two readers that name one bank alike are one account without asking', () => {
    const batch = theBatch('Hapoalim')
    const judged = judgeBatch(db, batch, whenOk)
    const report = judged.verdicts.get('report')
    expect(report?.state).toBe('ok')
    expect(report?.madeBy).toBe('everyday-bank.csv')
    expect(report?.duplicates).toBe(3)
    writeSheets(db, batch.map(({ sheet }) => ({ sheet, force: false })), 2)
    expect(listAccounts(db).filter((account) => account.kind === 'BANK')).toHaveLength(2)
    expect(countTransactions(db)).toBe(11)
  })

  it('a sheet left out sends nothing ahead, and a file pointed at its account makes it itself', () => {
    const batch = theBatch('Hapoalim app')
    const held = judgeBatch(db, batch, whenOk).verdicts.get('report')?.elsewhere
    if (held === undefined) throw new Error('no overlap')
    const into = batch.map((each) => (each.id === 'report' ? { ...each, sheet: pointAt(each.sheet, held) } : each))
    // The CSV unticked after the report was pointed at its account.
    const without = judgeBatch(db, into, (id, verdict) => id !== 'app' && verdict.state === 'ok')
    expect(without.pending.map((each) => each.madeBy)).toEqual([LEUMI_JULY, REPORT_FILE])
    writeSheets(db, into.filter((each) => each.id !== 'app').map(({ sheet }) => ({ sheet, force: false })), 2)
    expect(listAccounts(db).map((account) => account.name).sort()).toEqual(['Hapoalim app', 'Leumi'])
    expect(countTransactions(db)).toBe(9)
  })

  it('an account the document already has is still found the way it was', () => {
    const batch = theBatch('Hapoalim app')
    const app = batch[0]
    if (app === undefined) throw new Error('no app')
    writeSheets(db, [{ sheet: app.sheet, force: false }], 2)
    const judged = judgeBatch(db, batch, whenOk)
    expect(judged.verdicts.get('app')?.state).toBe('same')
    const report = judged.verdicts.get('report')
    expect(report?.state).toBe('elsewhere')
    expect(report?.elsewhere?.accountId).toBeDefined()
    expect(report?.elsewhere?.madeBy).toBeUndefined()
  })
})
