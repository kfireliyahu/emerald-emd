/**
 * Guessing a mapping: which row is the header, and what each column means.
 *
 * Pipeline step 4 of docs/f01-card-statement-import.md. Everything here is a
 * hint. The user sees the result in the mapper, next to a live preview, and
 * corrects it — so being wrong is cheap and being silent is not (D-013).
 */

import type { ColumnRoleId } from '@/domain/model/columnRoles.ts'
import type { CurrencyCode } from '@/core/money.ts'
import { cleanText, containsHebrew, containsLetter } from '@/core/text.ts'
import { roleForHeader } from '@/data/reference/headerAliases.ts'
import {
  requiredRolesFor,
  type AmountConvention,
  type ColumnRole,
  type DateOrder,
  type DraftMapping,
} from '@/domain/model/importing.ts'
import { currenciesInText, inferDateOrder, parseAmountText, parseDateText } from './normalize.ts'
import type { SheetCell, SheetTable } from './sheetTable.ts'

/** How far down to look for a header. Both real files put it on row 4. */
export const HEADER_SEARCH_DEPTH = 20

/** Beyond this, a cell is prose, not a column name. */
const MAX_HEADER_CELL_LENGTH = 40

export interface HeaderCandidate {
  readonly rowIndex: number
  readonly score: number
  readonly aliasHits: number
}

/**
 * Score every row near the top on how much it looks like a row of column names,
 * and return the best.
 *
 * What a header row has: several short text cells, most of them recognisable
 * as column names, all of them different from each other. What it does not
 * have: numbers, dates, or the same value twice. Data rows fail on all three,
 * which is what separates them — a Max data row repeats `₪` and its amount,
 * and a Cal data row leads with a real date cell.
 */
export function scoreHeaderRow(row: readonly SheetCell[]): HeaderCandidate['score'] {
  let aliasHits = 0
  let labelCells = 0
  let typedCells = 0
  let filled = 0

  const seen = new Set<string>()
  let duplicates = 0

  for (const cell of row) {
    if (cell.kind === 'empty') continue
    filled += 1

    if (cell.kind === 'number' || cell.kind === 'date' || cell.kind === 'boolean') {
      typedCells += 1
      continue
    }

    const text = cleanText(cell.text)
    if (seen.has(text)) duplicates += 1
    else seen.add(text)

    if (containsLetter(text) && text.length <= MAX_HEADER_CELL_LENGTH) labelCells += 1
    if (roleForHeader(text) !== undefined) aliasHits += 1
  }

  if (filled < 2) return 0
  return aliasHits * 4 + labelCells - typedCells * 3 - duplicates * 2
}

export function detectHeaderRow(table: SheetTable): HeaderCandidate | undefined {
  let best: HeaderCandidate | undefined

  const depth = Math.min(HEADER_SEARCH_DEPTH, table.rows.length)
  for (let rowIndex = 0; rowIndex < depth; rowIndex++) {
    const row = table.rows[rowIndex]
    if (row === undefined) continue

    const score = scoreHeaderRow(row)
    if (score <= 0) continue

    const aliasHits = row.filter(
      (cell) => cell.kind === 'string' && roleForHeader(cell.text) !== undefined,
    ).length

    // Strictly greater, so the earliest of two equal rows wins. A repeated
    // header further down a multi-section sheet must not displace the first.
    if (best === undefined || score > best.score) best = { rowIndex, score, aliasHits }
  }

  return best
}

// --- Value-shape inference -------------------------------------------------

export type ValueShape = 'date' | 'amount' | 'text' | 'empty' | 'mixed'

/** A column has a shape when most of its filled cells agree. */
const SHAPE_THRESHOLD = 0.6

/**
 * What the values in a column look like, ignoring what the header called it.
 *
 * This is what makes an unknown format work, and it has to handle both of the
 * shapes real files use: Cal's real date cells and Max's dates-as-text.
 */
export function inferColumnShape(cells: readonly SheetCell[]): ValueShape {
  let filled = 0
  let dateLike = 0
  let amountLike = 0
  let textLike = 0

  for (const cell of cells) {
    if (cell.kind === 'empty') continue
    filled += 1

    if (cell.kind === 'date') {
      dateLike += 1
      continue
    }
    if (cell.kind === 'number') {
      amountLike += 1
      continue
    }
    if (cell.kind !== 'string') continue

    // Order matters: `19-07-2026` must be tested as a date before it is
    // tested as anything else.
    if (parseDateText(cell.value, 'DMY') !== undefined || parseDateText(cell.value, 'YMD') !== undefined) {
      dateLike += 1
    } else if (containsLetter(cell.value)) {
      textLike += 1
    } else if (parseAmountText(cell.value) !== undefined) {
      amountLike += 1
    }
  }

  if (filled === 0) return 'empty'
  if (dateLike / filled >= SHAPE_THRESHOLD) return 'date'
  if (amountLike / filled >= SHAPE_THRESHOLD) return 'amount'
  if (textLike / filled >= SHAPE_THRESHOLD) return 'text'
  return 'mixed'
}

/** The cells of one column, over the data rows only. */
export function columnCells(table: SheetTable, columnIndex: number, fromRow: number): SheetCell[] {
  const cells: SheetCell[] = []
  for (let rowIndex = fromRow; rowIndex < table.rows.length; rowIndex++) {
    const cell = table.rows[rowIndex]?.[columnIndex]
    if (cell !== undefined) cells.push(cell)
  }
  return cells
}

// --- Putting a draft mapping together --------------------------------------

/**
 * Build a draft mapping for a sheet: header row, then roles by alias, then
 * value shape for whatever the aliases missed.
 *
 * Returns undefined only when no row in the sheet looks like a header at all.
 * A mapping that is missing a required role is still returned — the mapper
 * shows what it found and lets the user finish it, which is the whole point.
 */
export function guessMapping(
  table: SheetTable,
  options?: { readonly headerRowIndex?: number | undefined },
): DraftMapping | undefined {
  const forced = options?.headerRowIndex
  const headerRowIndex = forced ?? detectHeaderRow(table)?.rowIndex
  if (headerRowIndex === undefined) return undefined

  const headerRow = table.rows[headerRowIndex] ?? []
  const dataStartRowIndex = firstNonBlankRow(table, headerRowIndex + 1)

  const columnRoles = new Map<number, ColumnRole>()
  const taken = new Set<ColumnRole>()

  // 1. Header-name matching, which is the reliable signal when it fires.
  for (let column = 0; column < table.columnCount; column++) {
    const cell = headerRow[column]
    if (cell === undefined || cell.kind === 'empty') continue

    const role = roleForHeader(cell.text)
    if (role === undefined || taken.has(role)) continue

    columnRoles.set(column, role)
    taken.add(role)
  }

  // 2. Value-shape inference for the required roles the aliases missed.
  const shapes = new Map<number, ValueShape>()
  for (let column = 0; column < table.columnCount; column++) {
    shapes.set(column, inferColumnShape(columnCells(table, column, dataStartRowIndex)))
  }

  if (!taken.has('date')) {
    const column = firstUnassignedColumnWithShape(shapes, columnRoles, 'date')
    if (column !== undefined) {
      columnRoles.set(column, 'date')
      taken.add('date')
    }
  }

  if (!taken.has('amount')) {
    const column = firstUnassignedColumnWithShape(shapes, columnRoles, 'amount')
    if (column !== undefined) {
      columnRoles.set(column, 'amount')
      taken.add('amount')
    }
  }

  if (!taken.has('merchant')) {
    const column = mostTextualColumn(table, columnRoles, dataStartRowIndex)
    if (column !== undefined) {
      columnRoles.set(column, 'merchant')
      taken.add('merchant')
    }
  }

  return {
    sheetName: table.name,
    headerRowIndex,
    dataStartRowIndex,
    columnRoles,
    amountConvention: guessAmountConvention(table, columnRoles, dataStartRowIndex),
    dateOrders: guessDateOrders(table, columnRoles, dataStartRowIndex),
    defaultCurrency: guessDefaultCurrency(table, columnRoles, headerRowIndex, dataStartRowIndex),
  }
}

function firstNonBlankRow(table: SheetTable, from: number): number {
  for (let rowIndex = from; rowIndex < table.rows.length; rowIndex++) {
    const row = table.rows[rowIndex]
    if (row !== undefined && row.some((cell) => cell.kind !== 'empty')) return rowIndex
  }
  return from
}

function firstUnassignedColumnWithShape(
  shapes: ReadonlyMap<number, ValueShape>,
  assigned: ReadonlyMap<number, ColumnRole>,
  shape: ValueShape,
): number | undefined {
  for (const [column, columnShape] of shapes) {
    if (columnShape === shape && !assigned.has(column)) return column
  }
  return undefined
}

/**
 * The merchant column is the one carrying the most actual words — and, when
 * there is a tie, the one carrying Hebrew, since that is what a merchant name
 * looks like in these files.
 */
function mostTextualColumn(
  table: SheetTable,
  assigned: ReadonlyMap<number, ColumnRole>,
  dataStartRowIndex: number,
): number | undefined {
  let bestColumn: number | undefined
  let bestScore = 0

  for (let column = 0; column < table.columnCount; column++) {
    if (assigned.has(column)) continue

    let score = 0
    for (const cell of columnCells(table, column, dataStartRowIndex)) {
      if (cell.kind !== 'string') continue
      if (!containsLetter(cell.value)) continue
      score += 1 + (containsHebrew(cell.value) ? 1 : 0)
    }

    if (score > bestScore) {
      bestScore = score
      bestColumn = column
    }
  }

  return bestColumn
}

/**
 * Which way the amount column is signed, decided by the majority.
 *
 * Not by the presence of a negative: a refund in a positive-debit column is
 * negative, so a single negative value proves nothing. What separates the two
 * conventions is which sign the *ordinary* rows carry. A card statement whose
 * charges are positive is a debit column that the importer must negate; one
 * whose charges are already negative is signed and must be left alone.
 *
 * The bank convention is not decided by looking at values at all: a file with a
 * חובה column and a זכות column and no single amount column *is* split, and no
 * amount of counting signs would say so.
 */
function guessAmountConvention(
  table: SheetTable,
  columnRoles: ReadonlyMap<number, ColumnRole>,
  dataStartRowIndex: number,
): AmountConvention {
  const column = columnFor(columnRoles, 'amount')
  if (
    column === undefined &&
    columnFor(columnRoles, 'debit') !== undefined &&
    columnFor(columnRoles, 'credit') !== undefined
  ) {
    return 'SEPARATE_DEBIT_CREDIT'
  }
  if (column === undefined) return 'POSITIVE_IS_CHARGE'

  let positive = 0
  let negative = 0

  for (const cell of columnCells(table, column, dataStartRowIndex)) {
    const value =
      cell.kind === 'number'
        ? cell.value
        : cell.kind === 'string'
          ? parseAmountText(cell.value)
          : undefined
    if (value === undefined || value === 0) continue
    if (value > 0) positive += 1
    else negative += 1
  }

  return negative > positive ? 'SIGNED_SINGLE' : 'POSITIVE_IS_CHARGE'
}

/**
 * Where the app lands when the file says nothing about its currency.
 *
 * This is an app for Israeli statements and shekels are what its files are in,
 * so the fallback is not neutral and should not be: a wrong guess here is one
 * click to fix in the mapper, and the guess that is right almost every time is
 * worth more than one that abstains.
 */
const FALLBACK_CURRENCY: CurrencyCode = 'ILS'

/**
 * What the amounts in this sheet are denominated in.
 *
 * Only a default: a mapped `currency` column states it per row and wins there
 * (`parseRow`). This is what every other row is read as, and reading a dollar
 * statement as shekels is the kind of wrong that never surfaces — the numbers
 * are right, the labels are wrong, and every total downstream silently mixes
 * two currencies.
 *
 * The amount column's own text is the first and best evidence, because it is a
 * fact about the money rather than about the page: `$1,234.56`, `1,234.56 ₪`,
 * and — the case that matters, since it is how Cal writes every amount — a
 * plain number cell whose *number format* prints a ₪ in front of it. The
 * preamble is the fallback, since a statement usually says somewhere what it is
 * denominated in.
 *
 * Nothing else is read. A currency named in a note column or a foreign-amount
 * column is a fact about one row, and letting either vote would import an
 * entire shekel statement as dollars on the strength of one Amazon purchase.
 */
export function guessDefaultCurrency(
  table: SheetTable,
  columnRoles: ReadonlyMap<number, ColumnRole>,
  headerRowIndex: number,
  dataStartRowIndex: number,
): CurrencyCode {
  const amountColumn = columnFor(columnRoles, 'amount')
  if (amountColumn !== undefined) {
    const stated = mostMentioned([
      // The header too: `סכום חיוב בדולר` names the currency of the column
      // under it, and a file whose amounts are bare numbers may say it nowhere
      // else.
      table.rows[headerRowIndex]?.[amountColumn]?.text ?? '',
      ...columnCells(table, amountColumn, dataStartRowIndex).map((cell) => cell.text),
    ])
    if (stated !== undefined) return stated
  }

  return mostMentioned(preambleTexts(table, headerRowIndex)) ?? FALLBACK_CURRENCY
}

/** Everything the file says above the header row: the prose a statement opens with. */
function preambleTexts(table: SheetTable, headerRowIndex: number): readonly string[] {
  const texts: string[] = []
  for (let rowIndex = 0; rowIndex < headerRowIndex; rowIndex++) {
    for (const cell of table.rows[rowIndex] ?? []) {
      if (cell.kind !== 'empty') texts.push(cell.text)
    }
  }
  return texts
}

/**
 * The currency named most often across some texts, or nothing if none is.
 *
 * A majority rather than the first hit, so one foreign row in a column of
 * shekels does not decide the column. A tie goes to whichever was named first,
 * which in a sheet that names two is the one the amounts start in.
 */
function mostMentioned(texts: readonly string[]): CurrencyCode | undefined {
  const counts = new Map<CurrencyCode, number>()
  for (const text of texts) {
    for (const code of currenciesInText(text)) counts.set(code, (counts.get(code) ?? 0) + 1)
  }

  let winner: CurrencyCode | undefined
  let best = 0
  for (const [code, count] of counts) {
    if (count > best) {
      winner = code
      best = count
    }
  }
  return winner
}

/** The two dates a transaction has, and the only roles a date order applies to. */
const DATE_ROLES = ['date', 'chargeDate'] as const satisfies readonly ColumnRole[]

function guessDateOrders(
  table: SheetTable,
  columnRoles: ReadonlyMap<number, ColumnRole>,
  dataStartRowIndex: number,
): Map<ColumnRole, DateOrder> {
  const orders = new Map<ColumnRole, DateOrder>()

  for (const role of DATE_ROLES) {
    const column = columnFor(columnRoles, role)
    if (column === undefined) continue

    const texts = columnCells(table, column, dataStartRowIndex)
      .filter((cell) => cell.kind === 'string')
      .map((cell) => cell.text)

    orders.set(role, inferDateOrder(texts))
  }

  return orders
}

export function columnFor(
  // The map may hold a role somebody added (D-213); `role` is one this build
  // knows, because every caller is asking for something it can read. A role the
  // map holds and nobody asks for is never read, which is the whole of
  // "named, not stored" on this path (D-211).
  columnRoles: ReadonlyMap<number, ColumnRoleId>,
  role: ColumnRole,
): number | undefined {
  for (const [column, assigned] of columnRoles) {
    if (assigned === role) return column
  }
  return undefined
}

/**
 * Which required roles a mapping is still missing. Empty means it can parse.
 *
 * Which roles those are depends on the amount convention: a bank mapping needs
 * `debit` and `credit` where a card mapping needs `amount`. Asking
 * `requiredRolesFor` rather than a constant is what stops this check and the
 * parse from disagreeing about what a mapping is allowed to leave out.
 */
export function missingRequiredRoles(mapping: DraftMapping): readonly ColumnRole[] {
  const assigned = new Set(mapping.columnRoles.values())
  return requiredRolesFor(mapping.amountConvention).filter((role) => !assigned.has(role))
}

/**
 * Assign a role to a column, or clear it with `undefined`.
 *
 * A role belongs to exactly one column, so assigning one takes it away from
 * whichever column had it. Without that, the user silently ends up with two
 * `amount` columns and the parser quietly uses whichever it finds first.
 */
export function withColumnRole(
  mapping: DraftMapping,
  column: number,
  role: ColumnRoleId | undefined,
): DraftMapping {
  const columnRoles = new Map(mapping.columnRoles)
  columnRoles.delete(column)

  if (role !== undefined) {
    for (const [existing, assigned] of columnRoles) {
      if (assigned === role) columnRoles.delete(existing)
    }
    columnRoles.set(column, role)
  }

  return { ...mapping, columnRoles }
}
