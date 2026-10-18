/**
 * **A paste, as cells** — M26 U2.
 *
 * What a spreadsheet puts on the clipboard is tab-separated text, one line a
 * row, with a cell quoted when it holds a tab, a line break or a quote. A block
 * of plain text is the same thing with one column. This reads either into a
 * grid and lays the grid onto a sheet's drafts from the cell it was pasted in,
 * and checks nothing: every cell is still a string, and the batch goes through
 * `stageRows` like any other write, whole or not at all.
 */

import type { ColumnDeclaration } from './declaration.ts'
import { companionKeyOf } from './row.ts'
import type { RowDraft } from './rowDraft.ts'

/** Clipboard text as rows of cells. A trailing line break is not an empty row. */
export function gridOf(text: string): readonly (readonly string[])[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let at = 0

  // A cell is quoted only when it starts with a quote; one in the middle of a
  // cell is a character, as a spreadsheet writes it.
  const startsCell = (): boolean => cell === ''

  while (at < text.length) {
    const char = text[at] ?? ''
    if (quoted) {
      if (char === '"' && text[at + 1] === '"') {
        cell += '"'
        at += 2
        continue
      }
      if (char === '"') {
        quoted = false
        at += 1
        continue
      }
      cell += char
      at += 1
      continue
    }
    if (char === '"' && startsCell()) {
      quoted = true
      at += 1
      continue
    }
    if (char === '\t') {
      row.push(cell)
      cell = ''
      at += 1
      continue
    }
    if (char === '\r' || char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      at += char === '\r' && text[at + 1] === '\n' ? 2 : 1
      continue
    }
    cell += char
    at += 1
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

/**
 * The grid laid onto `drafts` from `row`, `column`: each cell into the declared
 * column it lands under, and a row of the grid past the last draft starting a
 * new one from `blank`. Cells past the last column are dropped — the count is
 * returned so the sheet can say so rather than lose them quietly.
 *
 * A money or quantity cell written with its code or unit (`12.90 ILS`,
 * `750 g`) is split into the figure and the companion; one without keeps the
 * companion the draft already carried.
 */
export function pasted(
  drafts: readonly RowDraft[],
  columns: readonly ColumnDeclaration[],
  grid: readonly (readonly string[])[],
  row: number,
  column: number,
  blank: RowDraft,
): { readonly drafts: readonly RowDraft[]; readonly touched: readonly number[]; readonly dropped: number } {
  const next = [...drafts]
  const touched: number[] = []
  let dropped = 0

  grid.forEach((cells, offset) => {
    if (cells.every((cell) => cell.trim() === '')) return
    const at = row + offset
    while (next.length <= at) next.push(blank)
    let draft: Record<string, string> = { ...(next[at] ?? blank) }
    cells.forEach((cell, across) => {
      const target = columns[column + across]
      if (target === undefined) {
        if (cell.trim() !== '') dropped += 1
        return
      }
      draft = { ...draft, ...fieldsOf(target, cell) }
    })
    next[at] = draft
    touched.push(at)
  })

  return { drafts: next, touched, dropped }
}

/** One pasted cell as the fields of the column it lands under. */
export function fieldsOf(column: ColumnDeclaration, text: string): Readonly<Record<string, string>> {
  const companion = companionKeyOf(column)
  const trimmed = text.trim()
  if (companion === undefined) return { [column.name]: text }

  const written =
    column.type === 'money'
      ? /^(-?[\d.,]+)\s*([A-Za-z]{3})$/.exec(trimmed) ?? /^([A-Za-z]{3})\s*(-?[\d.,]+)$/.exec(trimmed)
      : /^(-?[\d.]+)\s*([^\d\s.-]\S*)$/.exec(trimmed)
  if (written === null) return { [column.name]: trimmed }

  const [, first = '', second = ''] = written
  const figureFirst = /^-?[\d.,]+$/.test(first)
  // Left exactly as written: whether `1,234.50` is a figure is the coercion's
  // call, and dropping a comma here would turn a European `12,90` into 1290.
  const figure = figureFirst ? first : second
  const beside = figureFirst ? second : first
  return { [column.name]: figure, [companion]: column.type === 'money' ? beside.toUpperCase() : beside }
}
