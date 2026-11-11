import type { DraftMapping } from '@/domain/model/importing.ts'
import { applyMapping, type ParsedRow } from './apply.ts'
import { scoreHeaderRow } from './guess.ts'
import { statedLast4In } from './mappingName.ts'
import { compareSignatures, computeHeaderSignature, fitMapping } from './signature.ts'
import type { SheetCell, SheetTable } from './sheetTable.ts'

/**
 * **A sheet that holds two cards is two sections** — M59 U2, D-578.
 *
 * A card export can print every card of an account on one sheet: a line naming
 * the card (`כרטיס ויזה 1234`), its header, its rows, its total — and then the
 * next card the same way. Read with one header to the end of the sheet, the
 * second card's line and header became rows that failed, and its rows were read
 * into the first card's account. So a sheet is cut where a header repeats or a
 * line states a card number, and each section is read with its own header.
 *
 * A section is the **same sheet with every row outside it empty and nothing
 * after it**: row `i` is still row `i + 1` of the file, so a failed row says the
 * number the person sees, and the printed total, the printed period and the
 * card number above the header are each looked for in the section alone.
 *
 * A sheet with one section comes back as it went in — the single-card file is
 * read exactly as it always was.
 */
export interface StatementSection {
  readonly table: SheetTable
  /** The mapping re-pointed at this section's own header. */
  readonly mapping: DraftMapping
  /** The card number its card line (or its preamble) states, when a sheet has more than one section. */
  readonly statedLast4: string | undefined
}

/** How far below a card line its header may be. */
const CARD_LINE_REACH = 3

/** A card line is a line: a few cells of prose, never a row of figures. */
const CARD_LINE_CELLS = 3

interface Boundary {
  /** The first row of the section: its card line, or its header. */
  readonly start: number
  readonly mapping: DraftMapping
}

export function statementSections(table: SheetTable, mapping: DraftMapping): readonly StatementSection[] {
  const signature = computeHeaderSignature(table, mapping.headerRowIndex)
  const parsedAt = new Set(
    applyMapping(table, mapping).flatMap((row) => (row.outcome.kind === 'parsed' ? [row.rowIndex] : [])),
  )

  const headerAt = (rowIndex: number): DraftMapping | undefined => {
    const row = table.rows[rowIndex]
    if (row === undefined || parsedAt.has(rowIndex) || scoreHeaderRow(row) <= 0) return undefined
    const comparison = compareSignatures(signature, computeHeaderSignature(table, rowIndex))
    if (comparison.kind === 'none') return undefined
    return fitMapping(mapping, table, rowIndex, comparison.kind === 'close' ? comparison.currentForSaved : undefined)
  }

  const boundaries: Boundary[] = [{ start: 0, mapping }]
  for (let rowIndex = mapping.dataStartRowIndex; rowIndex < table.rows.length; rowIndex++) {
    const repeated = headerAt(rowIndex)
    if (repeated !== undefined) {
      boundaries.push({ start: rowIndex, mapping: repeated })
      rowIndex = repeated.dataStartRowIndex - 1
      continue
    }
    if (parsedAt.has(rowIndex) || !isCardLine(table.rows[rowIndex])) continue

    // A card line: its section starts here, read with the header under it when
    // there is one and with the sheet's own columns when the rows simply go on.
    let header: DraftMapping | undefined
    for (let below = rowIndex + 1; below <= rowIndex + CARD_LINE_REACH && below < table.rows.length; below++) {
      header = headerAt(below)
      if (header !== undefined || parsedAt.has(below)) break
    }
    const sectionMapping = header ?? { ...mapping, headerRowIndex: rowIndex, dataStartRowIndex: rowIndex + 1 }
    boundaries.push({ start: rowIndex, mapping: sectionMapping })
    rowIndex = sectionMapping.dataStartRowIndex - 1
  }

  // A section is one only when a row of it reads: a card line under the last
  // row — a footer naming the card — is not a second card.
  const kept = boundaries.filter((boundary, index) => {
    if (index === 0) return true
    const end = boundaries[index + 1]?.start ?? table.rows.length
    for (let rowIndex = boundary.mapping.dataStartRowIndex; rowIndex < end; rowIndex++) {
      if (parsedAt.has(rowIndex)) return true
    }
    return false
  })
  if (kept.length < 2) return [{ table, mapping, statedLast4: undefined }]

  return kept.map((boundary, index) => {
    const end = kept[index + 1]?.start ?? table.rows.length
    const rows = table.rows
      .slice(0, end)
      .map((row, rowIndex): readonly SheetCell[] => (rowIndex < boundary.start ? [] : row))
    const section: SheetTable = { ...table, rows }
    return {
      table: section,
      mapping: boundary.mapping,
      statedLast4: statedLast4In(textOf(section, boundary.start, boundary.mapping.dataStartRowIndex)),
    }
  })
}

/**
 * Every row a mapping makes of a sheet, section by section — what the mapper
 * previews. A sheet of one section is `applyMapping` as it always was.
 */
export function statementRows(table: SheetTable, mapping: DraftMapping): readonly ParsedRow[] {
  const sections = statementSections(table, mapping)
  if (sections.length === 1) return applyMapping(table, mapping)
  return sections.flatMap((section) => applyMapping(section.table, section.mapping))
}

function isCardLine(row: readonly SheetCell[] | undefined): boolean {
  if (row === undefined) return false
  const filled = row.filter((cell) => cell.kind !== 'empty' && cell.text.trim() !== '')
  if (filled.length === 0 || filled.length > CARD_LINE_CELLS) return false
  return statedLast4In(filled.map((cell) => cell.text).join(' ')) !== undefined
}

/** The text of rows `from` to `to`, exclusive — a section's card line and header. */
function textOf(table: SheetTable, from: number, to: number): string {
  const parts: string[] = []
  for (let rowIndex = from; rowIndex < to; rowIndex++) {
    for (const cell of table.rows[rowIndex] ?? []) if (cell.kind !== 'empty') parts.push(cell.text)
  }
  return parts.join(' ')
}
