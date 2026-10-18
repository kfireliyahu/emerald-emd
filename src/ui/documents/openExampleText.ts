/**
 * An **example** as text, whatever file it arrived as — M19 U2c.
 *
 * `openDocumentText.ts` is the path every *reading* takes: a payslip and a
 * pension report are the same file to a PDF reader, and four decisions' worth
 * of glyph handling live under it. An example is that plus one thing those
 * three screens have never needed, which is a **spreadsheet**: the dial D-215
 * describes runs from a photograph to a file that is already a table, and a
 * table somebody keeps in Excel is the most structured end of it.
 *
 * So this is a two-line wrapper and the second line is the interesting one. A
 * workbook becomes a few lines of pipe-separated text — the header and enough
 * rows to tell a date column from a reference — because what the model is being
 * asked is *what facts does this kind of thing have*, and nine hundred rows
 * answer that no better than five. `exampleExcerpt` caps it again on the way
 * into the prompt; this caps it here so a 40 MB workbook is never a 40 MB
 * string.
 *
 * **It stays out of `domain/format/`**, which imports nothing from a file
 * reader, a workbook or the DOM.
 */

import type { ReadStage } from '@/data/importer/pdfText.ts'
import { isSupportedFileName, readWorkbook, type SheetTable } from '@/data/importer/sheetTable.ts'
import { openDocumentText, type DocumentText } from '@/ui/documents/openDocumentText.ts'

/**
 * How many rows of a sheet are shown.
 *
 * The header plus a handful. A column's *kind* is visible in two rows and its
 * exceptions are not visible in two hundred — and this is a proposal a person
 * is about to read and correct, not a parse.
 */
export const EXAMPLE_SHEET_ROWS = 12

export async function openExampleText(
  file: File,
  onStage?: (stage: ReadStage) => void,
): Promise<DocumentText> {
  // A PDF is where the wait is — 1.7 MB of reader, sometimes a second pass and
  // four seconds of OCR a page — so its stages go straight through (D-171). A
  // workbook is read in one go and has none.
  if (!isSupportedFileName(file.name)) return openDocumentText(file, onStage)

  const bytes = new Uint8Array(await file.arrayBuffer())
  let sheet: SheetTable | undefined
  try {
    sheet = readWorkbook(file.name, bytes).sheets[0]
  } catch (error: unknown) {
    return { kind: 'problem', problem: `That spreadsheet could not be read: ${String(error)}` }
  }

  if (sheet === undefined || sheet.rows.length === 0) {
    return { kind: 'problem', problem: 'That spreadsheet has no rows in it.' }
  }

  return {
    kind: 'text',
    text: sheetExcerpt(sheet),
    notice: undefined,
    // No page to show: a spreadsheet has no layout to put beside a reading, and
    // nothing here is a reading anyway.
    source: undefined,
  }
}

/** The first rows of a sheet, one line each, as the cells print. */
export function sheetExcerpt(sheet: SheetTable): string {
  return sheet.rows
    .slice(0, EXAMPLE_SHEET_ROWS)
    .map((row) => row.map((cell) => cell.text.trim()).join(' | '))
    .filter((line) => line.replaceAll('|', '').trim() !== '')
    .join('\n')
}
