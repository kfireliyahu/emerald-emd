/**
 * **Which of a format's columns a line or a card draws** (M37 U5, D-478) —
 * what may be chosen, what the view declares when nothing is, and a line's
 * columns once a choice is made. Pure, and no React: `show_format`'s text
 * answer says the same choice.
 */

import type { ColumnDeclaration, FormatDeclaration } from '@/domain/format/declaration.ts'
import type { BoardShape, LineShape } from '@/domain/format/view.ts'

export interface Choosable {
  readonly format: FormatDeclaration
  readonly columns: readonly ColumnDeclaration[]
  readonly drawn: readonly string[]
}

/**
 * A line's choice: every column but its name and what the view already draws
 * another way (`leaving`), and by default its declared lines and its state.
 */
export function lineChoosable(
  format: FormatDeclaration,
  shape: LineShape<ColumnDeclaration>,
  leaving: readonly ColumnDeclaration[] = [],
): Choosable {
  const columns = format.columns.filter((column) => column !== shape.name && !leaving.includes(column))
  const drawn = new Set([...shape.lines, ...(shape.state === undefined ? [] : [shape.state])])
  return { format, columns, drawn: columns.filter((column) => drawn.has(column)).map((column) => column.name) }
}

/** A board's cards: every column but the name and the lanes, and by default the ones it says `card` about. */
export function cardChoosable(format: FormatDeclaration, board: BoardShape<ColumnDeclaration>): Choosable {
  const columns = format.columns.filter((column) => column !== board.name && column !== board.lanes)
  return { format, columns, drawn: board.cards.map((column) => column.name) }
}

/**
 * What a line draws under a choice: its columns but the name and the state, in
 * the order declared, and whether its state is said beside its dot — the dot
 * itself always stays, since its tone is the row's. No choice is the view's own.
 */
export function chosenLines(
  format: FormatDeclaration,
  shape: LineShape<ColumnDeclaration>,
  chosen: readonly string[] | undefined,
  grouped = false,
): { readonly lines: readonly ColumnDeclaration[]; readonly state: boolean } {
  // **A line grouped by its state does not say it again** (M64 F19, D-632):
  // under *Ready to start* every row is planned. What a person chose stays.
  if (chosen === undefined) return { lines: shape.lines, state: !grouped }
  return {
    lines: format.columns.filter(
      (column) => column !== shape.name && column !== shape.state && chosen.includes(column.name),
    ),
    state: shape.state !== undefined && chosen.includes(shape.state.name),
  }
}

/**
 * **Whether a link's words are already in the row's name** (M64 F19, D-632): a
 * unit's milestone `M2` under its ref `M2 U3` says nothing new, so a line or a
 * card left at its view's own columns leaves it out. Whole words only: `M2` is
 * not in `M20 U1`. A column a person chose under *Columns* is drawn regardless.
 */
export function namedByRow(column: ColumnDeclaration, text: string, name: string): boolean {
  if (column.type !== 'link' && column.type !== 'links') return false
  const said = text.trim()
  return said !== '' && ` ${name.trim()} `.includes(` ${said} `)
}

/** A board's cards under a choice, in the order declared. */
export function chosenCards(
  format: FormatDeclaration,
  board: BoardShape<ColumnDeclaration>,
  chosen: readonly string[] | undefined,
): readonly ColumnDeclaration[] {
  if (chosen === undefined) return board.cards
  return format.columns.filter(
    (column) => column !== board.name && column !== board.lanes && chosen.includes(column.name),
  )
}
