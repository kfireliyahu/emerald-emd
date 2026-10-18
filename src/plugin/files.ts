/**
 * A file a tool was handed, read off the disk: its bytes, its name, its hash,
 * and — for a workbook — the sheet asked for. `import_statement`,
 * `statement_preview`, `read_onto_format` and `record_holdings_statement` all
 * start here, so a file that cannot be read is refused in one wording.
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { readWorkbook, type SheetTable } from '@/data/importer/sheetTable.ts'

import { ToolInputError } from './tools/tool.ts'

/**
 * Lowercase hex SHA-256, of bytes or of text as UTF-8.
 *
 * The twin of `hashBytes` in `data/importer/naturalKey.ts`, by a different
 * route: `crypto.subtle` is asynchronous and the plugin has the file in hand.
 * Both are lowercase hex SHA-256, so "the same file" means the same thing
 * whichever half read it — which is the whole point of the record.
 */
export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

export interface FileRead {
  readonly bytes: Uint8Array
  /** The last part of the path, either separator. */
  readonly fileName: string
  readonly hash: string
}

/** The file's bytes, or a refusal that names it and says why it could not be read. */
export async function readFileOffered(file: string): Promise<FileRead> {
  let bytes: Uint8Array
  try {
    bytes = await readFile(file)
  } catch (error) {
    throw new ToolInputError(`Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return { bytes, fileName: file.split(/[\\/]/).pop() ?? file, hash: sha256Hex(bytes) }
}

export interface SheetRead {
  readonly sheet: SheetTable
  /** Every sheet's name, in the workbook's order. */
  readonly sheets: readonly string[]
  readonly fileName: string
  /** Of the whole file, not the sheet: the narrowest sameness asserted is the same file (D-226). */
  readonly hash: string
}

/** One sheet of a workbook — the named one, or the first — or a refusal naming the sheets it has. */
export async function readSheetOffered(file: string, sheetName: string | undefined): Promise<SheetRead> {
  const { bytes, fileName, hash } = await readFileOffered(file)
  const workbook = readWorkbook(fileName, bytes)
  const sheets = workbook.sheets.map((one) => one.name)
  const sheet =
    sheetName === undefined ? workbook.sheets[0] : workbook.sheets.find((one) => one.name === sheetName)
  if (sheet === undefined) {
    throw new ToolInputError(`No sheet called "${sheetName ?? ''}" in ${fileName}. It has: ${sheets.join(', ')}.`)
  }
  return { sheet, sheets, fileName, hash }
}
