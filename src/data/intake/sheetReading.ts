/**
 * **The seam: a spreadsheet, as the engine reads one** — M19 U5,
 * [D-226](../../../docs/09-decision-log.md).
 *
 * `src/domain/format/` may import neither the pack nor a parser — that is a
 * test, not a promise (`boundary.test.ts`, D-221) — and the file reader this app
 * already has is `sheetTable.ts`, which has read every statement since M2. Both
 * halves are right and neither may reach the other, so this is the third
 * resolution of the same problem `modelTask.ts` solved in U2c: **the meeting
 * point goes where neither side owns it.**
 *
 * It is thirty lines, and that is the whole cost of the boundary here. What it
 * does is drop the two cell kinds the engine has no use for — an error cell, and
 * the time of day on a date — and nothing else.
 *
 * `SheetJS` is not imported from the engine at all: `readWorkbook` stays where
 * it is, and what crosses is a rectangle of typed cells.
 */

import type { ReadCell, ReadTable } from '@/domain/format/reading.ts'
import type { SheetCell, SheetTable } from '../importer/sheetTable.ts'

/** A sheet as a table the engine can run a reading over. */
export function readTableOf(sheet: SheetTable): ReadTable {
  return {
    rows: sheet.rows.map((row) => row.map(readCellOf)),
    columnCount: sheet.columnCount,
  }
}

/**
 * One cell.
 *
 * **An error cell becomes empty and a date loses its time**, which are the two
 * places this conversion is lossy and both are deliberate. `#REF!` is not a
 * value of any column, and a spreadsheet date carrying 00:00:00 is a date —
 * D-004's *dates are date-only values* is the rule that has held since the first
 * commit, and the place it gets broken is a conversion like this one.
 */
export function readCellOf(cell: SheetCell): ReadCell {
  switch (cell.kind) {
    case 'string':
      return cell.value.trim() === '' ? { kind: 'empty', text: cell.text } : { kind: 'text', text: cell.value }
    case 'number':
      return { kind: 'number', text: cell.text, value: cell.value }
    case 'boolean':
      return { kind: 'boolean', text: cell.text, value: cell.value }
    case 'date':
      return {
        kind: 'date',
        text: cell.text,
        year: cell.value.year,
        month: cell.value.month,
        day: cell.value.day,
      }
    default:
      return { kind: 'empty', text: cell.text }
  }
}
