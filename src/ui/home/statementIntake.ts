import type { Database } from 'sql.js'

import { hashBytes } from '@/data/importer/naturalKey.ts'
import { isSupportedFileName, readWorkbook, SUPPORTED_EXTENSIONS } from '@/data/importer/sheetTable.ts'
import { readStatementWorkbook, type StatementSheet } from '@/data/importer/statementBatch.ts'
import { updateStatementBatch, type BatchFile, type StatementBatchState } from '@/state/statementBatch.ts'

/** What Paychecks reads: a payslip is a PDF, or the text of one (M28 U3). */
const PAYSLIP = /\.(pdf|txt)$/i

let counter = 0

/**
 * Add files to Home's batch and read each one — M28 U5.
 *
 * A spreadsheet is read by the saved mapping it fits and judged; one nothing
 * fits waits for the column mapper; a payslip is set aside for Paychecks, which
 * reads payslips; anything else says why it was not read. **Nothing is
 * written** — `writeSheets` is what Write calls.
 */
export async function addStatementFiles(db: Database, files: readonly File[]): Promise<void> {
  const placed = files.map((file) => ({ file, id: `f${String(++counter)}` }))
  updateStatementBatch(db, (state) => ({
    ...state,
    files: [
      ...state.files,
      ...placed.map(({ file, id }): BatchFile => ({ kind: 'reading', id, fileName: file.name })),
    ],
  }))

  for (const { file, id } of placed) {
    const read = await readOne(db, file, id)
    updateStatementBatch(db, (state) => ({
      ...state,
      files: state.files.flatMap((each) => (each.id === id ? read.map((one) => sameReaderSameAccount(state, one)) : [each])),
    }))
  }
}

/**
 * **A reader drawn for one file reads the files waiting behind it** — M28 F15.
 *
 * Four exports added at once are read before any reader exists, so two months
 * of one bank both wait on the mapper. Once the first is mapped, its reader
 * fits the second exactly; read it with that reader now, rather than mapping
 * the same columns twice — and the same reader names the same account, so the
 * second lands on the account the first is about to make.
 */
export function readWaitingLayouts(db: Database, state: StatementBatchState): StatementBatchState {
  if (!state.files.some((file) => file.kind === 'new-layout')) return state
  return {
    ...state,
    files: state.files.flatMap((file): readonly BatchFile[] => {
      if (file.kind !== 'new-layout') return [file]
      const found = readStatementWorkbook(db, { fileName: file.fileName, fileHash: file.fileHash, workbook: file.workbook, id: file.id })
      return found.kind === 'new-layout'
        ? [file]
        : found.sheets.map((sheet) => sameReaderSameAccount(state, { kind: 'sheet', id: sheet.id, fileName: file.fileName, sheet }))
    }),
  }
}

/**
 * A sheet read by a reader that another sheet of the batch was already read
 * with, for the same card or for none, goes where that one goes (M28 F15). A
 * reader learns its account on the first Write; until then the batch is where
 * the choice a person made for the first file is kept, and the second file is
 * the same layout of the same account.
 */
function sameReaderSameAccount(state: StatementBatchState, file: BatchFile): BatchFile {
  if (file.kind !== 'sheet' || file.sheet.mappingId === undefined || file.sheet.account.boundAccountId !== undefined) {
    return file
  }
  const earlier = state.files.find(
    (each): each is Extract<BatchFile, { kind: 'sheet' }> =>
      each.kind === 'sheet' &&
      each.sheet.mappingId === file.sheet.mappingId &&
      each.sheet.account.last4 === file.sheet.account.last4,
  )
  if (earlier === undefined) return file
  const sheet: StatementSheet = { ...file.sheet, account: { ...earlier.sheet.account, separate: undefined } }
  return { ...file, sheet }
}

async function readOne(db: Database, file: File, id: string): Promise<readonly BatchFile[]> {
  const fileName = file.name
  if (PAYSLIP.test(fileName)) return [{ kind: 'payslip', id, fileName, file }]
  if (!isSupportedFileName(fileName)) {
    return [
      {
        kind: 'failed',
        id,
        fileName,
        message: `Not a statement or a paycheck: ${SUPPORTED_EXTENSIONS.join(', ')} and PDF are read here.`,
      },
    ]
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const workbook = readWorkbook(fileName, bytes)
    // The hash is what "you already wrote this file" is answered by; a page
    // that cannot hash cannot say so, and the natural keys still stop a double.
    const fileHash = await hashBytes(bytes).catch(() => `unhashed:${fileName}:${String(bytes.length)}`)
    const found = readStatementWorkbook(db, { fileName, fileHash, workbook, id })
    if (found.kind === 'new-layout') return [{ kind: 'new-layout', id, fileName, workbook, fileHash }]
    return found.sheets.map((sheet): BatchFile => ({ kind: 'sheet', id: sheet.id, fileName, sheet }))
  } catch (cause) {
    return [{ kind: 'failed', id, fileName, message: cause instanceof Error ? cause.message : String(cause) }]
  }
}
