/**
 * A statement keeps the days it covers — M28 F26.
 *
 * Two synthetic exports shaped like real ones: August to October read
 * first, with its period printed above the header and a running balance that
 * does not add up; January to August read after it, overlapping it by three
 * days, which it loses as duplicates. January's balance is then the one shown,
 * and it stands on 6 August — not on 30 July, where its surviving rows end.
 */

import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'

import { money } from '@/core/money.ts'
import { localDate } from '@/core/time.ts'
import { query } from '../db/database.ts'
import { accountBalances, setOpeningBalance } from '../repositories/accountBalanceRepository.ts'
import { createAccount } from '../repositories/accountRepository.ts'
import { acceptAllNew } from '../repositories/stagedRowRepository.ts'
import { applyMapping } from './apply.ts'
import { commitSession } from './commit.ts'
import { guessMapping } from './guess.ts'
import { findPrintedPeriod, spanOf } from './printedPeriod.ts'
import { readWorkbook, type SheetTable } from './sheetTable.ts'
import { stageImport } from './stage.ts'

const HEADER = 'תאריך,תיאור,אסמכתא,סכום,יתרה'

/** Opening ₪1,000.00 before 2 July; every balance below chains from it. */
const JAN_AUG = [
  HEADER,
  '06.8.2026,העברה לחגית,1,-170.00,13679.00',
  '04.8.2026,העברה למזל,2,-1300.00,13849.00',
  '03.8.2026,משכורת,3,14519.00,15149.00',
  '30.7.2026,העברה לחגית,4,-170.00,630.00',
  '02.7.2026,חשמל,5,-200.00,800.00',
].join('\n')

/** The same three August days, two September rows, and a balance that breaks on the last. */
const AUG_OCT = [
  'דוח תנועות בחשבון',
  ',,תקופת הדוח:,01.08.2026 - 01.10.2026',
  '',
  HEADER,
  '15.9.2026,העברה לחגית,9,-170.00,99999.00',
  '02.9.2026,משכורת,8,1000.00,14679.00',
  '06.8.2026,העברה לחגית,1,-170.00,13679.00',
  '04.8.2026,העברה למזל,2,-1300.00,13849.00',
  '03.8.2026,משכורת,3,14519.00,15149.00',
].join('\n')

/** The morning of 4 October 2026, local time — the day both were read. */
const READ_ON = new Date(2026, 9, 4, 9, 0).getTime()

function sheet(name: string, text: string): SheetTable {
  const found = readWorkbook(name, new TextEncoder().encode(text)).sheets[0]
  if (found === undefined) throw new Error(`${name} has no sheet`)
  return found
}

function read(db: Database, accountId: string, name: string, text: string, now: number): string {
  const table = sheet(name, text)
  const mapping = guessMapping(table)
  if (mapping === undefined) throw new Error(`${name} has no mapping`)
  const { sessionId } = stageImport(
    db,
    {
      accountId,
      fileName: name,
      fileHash: name,
      sheetName: table.name,
      rows: applyMapping(table, mapping),
      table,
      headerRowIndex: mapping.headerRowIndex,
    },
    now,
  )
  acceptAllNew(db, sessionId, now)
  commitSession(db, sessionId, now, { ignoreBalanceCheck: true })
  return sessionId
}

describe('the days a statement covers', () => {
  it('stands the older balance on its own last day, though its overlap was dropped', async () => {
    const db = await createLedgerDatabase()
    const bank = createAccount(db, { name: 'Checking', kind: 'BANK' }, 1)

    const aug = read(db, bank.id, 'aug-oct.csv', AUG_OCT, READ_ON)
    const jan = read(db, bank.id, 'jan-aug.csv', JAN_AUG, READ_ON + 60_000)

    const stored = query(
      db,
      'SELECT id, covers_from, covers_to, printed_from, printed_to, rows_duplicate FROM fmt_statement ORDER BY started',
    )
    expect(stored).toEqual([
      { id: aug, covers_from: '2026-08-03', covers_to: '2026-09-15', printed_from: '2026-08-01', printed_to: '2026-10-01', rows_duplicate: 0 },
      { id: jan, covers_from: '2026-07-02', covers_to: '2026-08-06', printed_from: null, printed_to: null, rows_duplicate: 3 },
    ])
    // January's own surviving rows end on 30 July — the derivation F24 used.
    expect(query(db, 'SELECT MAX(transaction_date) AS last FROM fmt_transaction WHERE statement = ?', [jan])).toEqual([
      { last: '2026-07-30' },
    ])

    setOpeningBalance(db, bank.id, { amount: money(100_000, 'ILS'), date: localDate(2026, 7, 1) }, READ_ON)
    const balance = accountBalances(db, 'ILS')[0]
    expect(balance?.statementBalance).toEqual(money(1_367_900, 'ILS'))
    expect(balance?.balanceTo).toEqual(localDate(2026, 8, 6))
    // August to October offered no balance that adds up, and ran to the period it printed.
    expect(balance?.newerWithoutBalance).toEqual({ fileName: 'aug-oct.csv', to: localDate(2026, 10, 1) })
    // What moved runs to 6 August, the three days August to October holds among it.
    expect(balance?.moved).toEqual(money(1_267_900, 'ILS'))
    expect(balance?.check).toEqual({ kind: 'ADDS_UP' })
  })

  it('falls back to the rows a statement owns when it was read before the days were kept', async () => {
    const db = await createLedgerDatabase()
    const bank = createAccount(db, { name: 'Checking', kind: 'BANK' }, 1)
    const jan = read(db, bank.id, 'jan-aug.csv', JAN_AUG, READ_ON)
    db.run('UPDATE fmt_statement SET covers_from = NULL, covers_to = NULL WHERE id = ?', [jan])

    expect(accountBalances(db, 'ILS')[0]?.balanceTo).toEqual(localDate(2026, 8, 6))
  })
})

describe('the period a statement prints', () => {
  const table = sheet('aug-oct.csv', AUG_OCT)
  const rows = { from: localDate(2026, 8, 3), to: localDate(2026, 9, 15) }

  it('reads the period printed above the header', () => {
    expect(findPrintedPeriod(table, 3, rows, localDate(2026, 10, 4))).toEqual({
      from: localDate(2026, 8, 1),
      to: localDate(2026, 10, 1),
    })
  })

  it('keeps nothing the rows or the day it was read disagree with', () => {
    // A row after the period it claims.
    expect(findPrintedPeriod(table, 3, { ...rows, to: localDate(2026, 10, 2) }, localDate(2026, 10, 4))).toBeUndefined()
    // A period still running when the file was read: the range asked for, not the days covered.
    expect(findPrintedPeriod(table, 3, rows, localDate(2026, 10, 1))).toBeUndefined()
    expect(findPrintedPeriod(table, 3, rows, localDate(2026, 9, 20))).toBeUndefined()
  })

  it('looks only above the header', () => {
    expect(findPrintedPeriod(table, 1, rows, localDate(2026, 10, 4))).toBeUndefined()
  })

  it('spans the days given, in any order', () => {
    expect(spanOf([localDate(2026, 8, 6), localDate(2026, 7, 2), localDate(2026, 7, 30)])).toEqual({
      from: localDate(2026, 7, 2),
      to: localDate(2026, 8, 6),
    })
    expect(spanOf([])).toBeUndefined()
  })
})
