import { describe, expect, it } from 'vitest'

import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { readWorkbook, type SheetWorkbook } from '@/data/importer/sheetTable.ts'
import { computeHeaderSignature } from '@/data/importer/signature.ts'
import { sheetFrom } from '@/data/importer/statementBatch.ts'
import type { DraftMapping } from '@/domain/model/importing.ts'
import { createAccount } from '@/data/repositories/accountRepository.ts'
import { saveMapping } from '@/data/repositories/importMappingRepository.ts'
import type { StatementBatchState } from '@/state/statementBatch.ts'

import { readWaitingLayouts } from './statementIntake.ts'

/**
 * **A reader drawn for one file reads the files waiting behind it** — M28 F15.
 * Two months of one bank added together both wait on the mapper; once the
 * first is mapped, the second is read by its reader and goes where it goes.
 */
describe('the files waiting behind a mapped one', () => {
  const MAPPING: DraftMapping = {
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
  const csv = (name: string, rows: readonly string[]): SheetWorkbook =>
    readWorkbook(name, new TextEncoder().encode(['תאריך,תיאור,סכום', ...rows].join('\n')))

  it('reads a waiting file with the new reader, into the account the first one was pointed at', async () => {
    const db = await createLedgerDatabase()
    const chosen = createAccount(db, { name: 'Leumi', kind: 'BANK' }, 1)
    const july = csv('july.csv', ['01/07/2026,סופר לדוגמה,-250.00'])
    const august = csv('august.csv', ['02/08/2026,סופר לדוגמה,-260.00'])
    const julyTable = july.sheets[0]
    if (julyTable === undefined) throw new Error('no sheet')
    const saved = saveMapping(db, { name: 'july', headerSignature: computeHeaderSignature(julyTable, 0), mapping: MAPPING }, 1)

    // July, as the mapper hands it back with *Into Leumi* chosen: bound for this read only.
    const first = sheetFrom({
      id: 'july:0',
      fileName: 'july.csv',
      fileHash: 'july',
      table: julyTable,
      mapping: MAPPING,
      mappingId: saved.id,
      mappingName: saved.name,
      boundAccountId: chosen.id,
      kind: 'BANK',
    })
    const state: StatementBatchState = {
      owner: db,
      files: [
        { kind: 'sheet', id: 'july:0', fileName: 'july.csv', sheet: first },
        { kind: 'new-layout', id: 'aug', fileName: 'august.csv', workbook: august, fileHash: 'august' },
        { kind: 'failed', id: 'x', fileName: 'x.doc', message: 'no' },
      ],
      ticks: new Map(),
      forced: new Set(),
      mapping: undefined,
    }

    const next = readWaitingLayouts(db, state)
    expect(next.files.map((file) => file.kind)).toEqual(['sheet', 'sheet', 'failed'])
    const read = next.files[1]
    if (read?.kind !== 'sheet') throw new Error('August not read')
    expect(read.sheet.mappingId).toBe(saved.id)
    expect(read.sheet.account.boundAccountId).toBe(chosen.id)
  })

  it('leaves a file no reader fits waiting', async () => {
    const db = await createLedgerDatabase()
    const other = csv('other.csv', ['01/07/2026,x,-1.00'])
    const state: StatementBatchState = {
      owner: db,
      files: [{ kind: 'new-layout', id: 'o', fileName: 'other.csv', workbook: other, fileHash: 'o' }],
      ticks: new Map(),
      forced: new Set(),
      mapping: undefined,
    }
    expect(readWaitingLayouts(db, state).files[0]?.kind).toBe('new-layout')
  })
})
