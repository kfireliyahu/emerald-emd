/**
 * Recognising a file as one the user has already mapped: pipeline step 3 of
 * docs/f01-card-statement-import.md.
 *
 * A mapping stores a **header signature** — the normalized header cells, in
 * order. On import the file's own header is signed the same way and compared
 * against every saved mapping. Exact means "this is the same format, use it";
 * close means "the format moved, show the user what moved" (f01, "Matching a
 * file to a saved mapping").
 *
 * Pure TypeScript over `SheetTable`. No database here: the caller supplies the
 * candidates, which keeps this testable with no sql.js and keeps the repository
 * out of the importer's imports.
 */

import type { ColumnRoleId } from '@/domain/model/columnRoles.ts'
import { normalizeHeader } from '@/core/text.ts'
import type { DraftMapping } from '@/domain/model/importing.ts'
import { HEADER_SEARCH_DEPTH } from './guess.ts'
import type { SheetTable } from './sheetTable.ts'

/**
 * Versioned, so a stored signature from an older normalization can be told
 * apart from one this build would produce rather than silently mis-matching.
 */
const SIGNATURE_VERSION = 'fc1'

/**
 * ASCII unit separator. Deliberately not a character `cleanText` touches: it is
 * neither whitespace to `\s` nor one of the directional marks, so a header cell
 * can never contain one after normalization and can never split a signature.
 */
const SEPARATOR = '\u001f'

/** Below this share of unchanged columns, two headers are different formats, not a changed one. */
const CLOSE_ENOUGH = 0.7

/**
 * And below this many unchanged columns, the share means nothing. Two unrelated
 * three-column CSVs that both start with a date agree on 2 of 3 — 0.67 — and
 * calling that the same format would hand the user someone else's mapping.
 */
const MIN_COMMON_COLUMNS = 3

/**
 * The header row's cells, normalized, with trailing blanks dropped.
 *
 * `normalizeHeader` is the same function the alias table matches through, which
 * matters more here than anywhere: Cal writes `תאריך\r\nעסקה`, and a signature
 * that kept the line break would never match the same file twice if Excel ever
 * rewrote it. Trailing blanks go because they are an artifact of the sheet's
 * used range, not of the format.
 */
export function headerCellsOf(table: SheetTable, headerRowIndex: number): readonly string[] {
  const row = table.rows[headerRowIndex] ?? []
  const cells = row.map((cell) => (cell.kind === 'empty' ? '' : normalizeHeader(cell.text)))
  while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop()
  return cells
}

export function computeHeaderSignature(table: SheetTable, headerRowIndex: number): string {
  const cells = headerCellsOf(table, headerRowIndex)
  return [SIGNATURE_VERSION, String(cells.length), ...cells].join(SEPARATOR)
}

/** The cells back out of a signature, or undefined if it was written by a different version. */
export function headerCellsFromSignature(signature: string): readonly string[] | undefined {
  const parts = signature.split(SEPARATOR)
  if (parts[0] !== SIGNATURE_VERSION) return undefined

  const declared = Number(parts[1])
  const cells = parts.slice(2)
  if (!Number.isInteger(declared) || declared !== cells.length) return undefined
  return cells
}

/**
 * What moved between a saved header and the one in front of us.
 *
 * Both maps are between column *indices*, which is the whole point: a saved
 * mapping's roles are indices, and an inserted column shifts every one of them.
 */
export interface HeaderDifference {
  /** Saved column index → the column holding the same header now. */
  readonly currentForSaved: ReadonlyMap<number, number>
  /** Current columns with no counterpart in the saved header — added or renamed. */
  readonly changedColumns: ReadonlySet<number>
  /** Saved columns that are gone. Any role on one of these is dropped. */
  readonly droppedColumns: ReadonlySet<number>
  /** Unchanged columns as a share of the wider of the two headers. */
  readonly similarity: number
}

export type SignatureMatch =
  | { readonly kind: 'exact' }
  | ({ readonly kind: 'close' } & HeaderDifference)
  | { readonly kind: 'none' }

/**
 * Line the two headers up and report what changed.
 *
 * A longest-common-subsequence alignment rather than a column-by-column diff,
 * because the two changes f01 names behave differently: a *rename* changes one
 * column, but an *insert* shifts every column after it, and a positional diff
 * would report a one-column change as a fourteen-column one. The alignment
 * tells a shift apart from a change, which is what makes "highlight the changed
 * columns" mean anything.
 */
export function diffHeaders(
  saved: readonly string[],
  current: readonly string[],
): HeaderDifference {
  const currentForSaved = new Map<number, number>()
  for (const [savedIndex, currentIndex] of alignByLcs(saved, current)) {
    currentForSaved.set(savedIndex, currentIndex)
  }

  const matchedCurrent = new Set(currentForSaved.values())
  const changedColumns = new Set<number>()
  for (let index = 0; index < current.length; index++) {
    if (!matchedCurrent.has(index)) changedColumns.add(index)
  }

  const droppedColumns = new Set<number>()
  for (let index = 0; index < saved.length; index++) {
    if (!currentForSaved.has(index)) droppedColumns.add(index)
  }

  const widest = Math.max(saved.length, current.length)
  return {
    currentForSaved,
    changedColumns,
    droppedColumns,
    similarity: widest === 0 ? 0 : currentForSaved.size / widest,
  }
}

export function compareSignatures(savedSignature: string, currentSignature: string): SignatureMatch {
  if (savedSignature === currentSignature) return { kind: 'exact' }

  const saved = headerCellsFromSignature(savedSignature)
  const current = headerCellsFromSignature(currentSignature)
  if (saved === undefined || current === undefined) return { kind: 'none' }

  const difference = diffHeaders(saved, current)
  if (difference.currentForSaved.size < MIN_COMMON_COLUMNS) return { kind: 'none' }
  if (difference.similarity < CLOSE_ENOUGH) return { kind: 'none' }
  return { kind: 'close', ...difference }
}

/**
 * The columns two headers keep in common, as saved-index → current-index pairs.
 *
 * Textbook LCS. Headers are a handful of columns wide, so the quadratic table
 * costs nothing and the alternative — a heuristic that guesses at insertions —
 * would be the thing that occasionally lies about which column changed.
 */
function alignByLcs(
  saved: readonly string[],
  current: readonly string[],
): readonly (readonly [number, number])[] {
  const rows = saved.length
  const columns = current.length

  // lengths[i][j] — the LCS of saved[i..] and current[j..]. One extra row and
  // column of zeroes so the recurrence needs no bounds checks.
  const lengths: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(columns + 1).fill(0))
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = columns - 1; j >= 0; j--) {
      const row = lengths[i]
      const next = lengths[i + 1]
      if (row === undefined || next === undefined) continue

      // A blank column never counts as common: two headers each padded with an
      // empty cell have not thereby got a column in common.
      const same = saved[i] === current[j] && saved[i] !== ''
      row[j] = same ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0)
    }
  }

  const pairs: (readonly [number, number])[] = []
  let i = 0
  let j = 0
  while (i < rows && j < columns) {
    if (saved[i] === current[j] && saved[i] !== '') {
      pairs.push([i, j])
      i += 1
      j += 1
      continue
    }
    if ((lengths[i + 1]?.[j] ?? 0) >= (lengths[i]?.[j + 1] ?? 0)) i += 1
    else j += 1
  }
  return pairs
}

// --- Matching a file against what is already saved --------------------------

/** The shape `matchSavedMapping` needs. The repository's `SavedMapping` satisfies it. */
export interface MappingCandidate {
  readonly headerSignature: string
  readonly mapping: DraftMapping
}

export interface MappingMatch<T extends MappingCandidate> {
  readonly candidate: T
  /** Where this file's header actually is, which is not necessarily where it was last time. */
  readonly headerRowIndex: number
  readonly comparison: Exclude<SignatureMatch, { kind: 'none' }>
  /** The saved mapping, re-pointed at this file. Ready to parse or to hand to the mapper. */
  readonly mapping: DraftMapping
}

/**
 * Find the saved mapping that best fits this sheet, if any.
 *
 * Every row near the top is signed, not just the one the guesser picks: the
 * preamble is prose that providers reword, and a statement that grew a line
 * above its header is the same format, not a new one. Signing all of them is
 * twenty cheap string joins and removes the guesser from the recognition path
 * entirely.
 */
export function matchSavedMapping<T extends MappingCandidate>(
  table: SheetTable,
  candidates: readonly T[],
): MappingMatch<T> | undefined {
  let best: MappingMatch<T> | undefined

  const depth = Math.min(HEADER_SEARCH_DEPTH, table.rows.length)
  for (let headerRowIndex = 0; headerRowIndex < depth; headerRowIndex++) {
    const signature = computeHeaderSignature(table, headerRowIndex)

    for (const candidate of candidates) {
      const comparison = compareSignatures(candidate.headerSignature, signature)
      if (comparison.kind === 'none') continue
      if (best !== undefined && rank(comparison) <= rank(best.comparison)) continue

      best = {
        candidate,
        headerRowIndex,
        comparison,
        mapping: fitMapping(
          candidate.mapping,
          table,
          headerRowIndex,
          comparison.kind === 'close' ? comparison.currentForSaved : undefined,
        ),
      }
      if (comparison.kind === 'exact') return best
    }
  }

  return best
}

function rank(comparison: Exclude<SignatureMatch, { kind: 'none' }>): number {
  return comparison.kind === 'exact' ? 2 : 1 + comparison.similarity
}

/**
 * A saved mapping, re-pointed at the file in front of it.
 *
 * Three things are the file's rather than the mapping's. The **sheet name**,
 * because Max's two sheets share one header and therefore one mapping — reusing
 * the saved name would label every row of the second sheet with the first
 * sheet's name. The **header row**, because that is where it was actually
 * found. And the **columns**, when a column moved: the saved roles are indices,
 * and an inserted column makes every index after it point one place to the left.
 */
export function fitMapping(
  saved: DraftMapping,
  table: SheetTable,
  headerRowIndex: number,
  currentForSaved?: ReadonlyMap<number, number> | undefined,
): DraftMapping {
  const columnRoles = new Map<number, ColumnRoleId>()
  for (const [column, role] of saved.columnRoles) {
    // A role whose column is gone is dropped rather than left pointing at
    // whatever now occupies that index. The mapper is about to open anyway.
    const moved = currentForSaved === undefined ? column : currentForSaved.get(column)
    if (moved !== undefined) columnRoles.set(moved, role)
  }

  // Keep the gap the user established between header and first data row — a
  // format with a units row under its header keeps it — but never let the data
  // start on or above the header itself.
  const gap = Math.max(1, saved.dataStartRowIndex - saved.headerRowIndex)

  return {
    ...saved,
    sheetName: table.name,
    headerRowIndex,
    dataStartRowIndex: headerRowIndex + gap,
    columnRoles,
    dateOrders: new Map(saved.dateOrders),
  }
}
