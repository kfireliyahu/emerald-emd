/**
 * **A reader: how one file layout is read onto one format** — M26 U5.
 *
 * *"What are reading formats? Aren't they just formats?"* They are not, and the
 * shared word was the fault (D-284). A **format** is a kind of thing; a
 * **reader** is a saved mapping — which column of one layout of file is which
 * key of the format it feeds. A format has as many readers as there are
 * layouts it is read from: a card's `.xlsx` and a bank's `.csv` are two readers
 * of one `transaction`.
 *
 * A reader is not a table of its own. Every reading a person accepted is
 * already kept beside the rows it wrote (`format_intake`, D-226), so a reader is
 * those readings **grouped by the header they were made for**, the newest
 * standing for the group. A reader made again for the same layout replaces the
 * old one by being newer, which is how a wrong one is put right. Since M26 F1 a
 * reader can be **renamed** (the name is kept beside the readings, by
 * signature) and **forgotten** (its readings stop being offered; the rows they
 * wrote, and taking those back, are untouched).
 *
 * ## What "fits" proves, and what it does not (D-138)
 *
 * `fitReader` tries every reader and takes the one that fits, which is two
 * checks and no third: **the file's header is the reader's header, cell for
 * cell** (the signature, at the reader's header row or where the header is
 * guessed to be), and **the reading is still a valid one for the format as it
 * is now** (`readingProblems`, so a column dropped since is not a fit). A
 * **close** reader — most of the header shared, not all — is never used: it is
 * named, so the screen can say plainly that it does not fit and offer a new one.
 *
 * ## A column that moved is followed by its name (M26 F1)
 *
 * A signature is sorted, so a file whose columns were reordered has the same
 * one — and until F1 it fitted, and every binding read the column that now sat
 * at the old position: a date read as an amount, silently. A reader now keeps
 * the header **in the file's order** too (`headerCells`), and a file whose
 * columns moved is read by following each bound column to where its name went.
 * Where a name says nothing — an empty header cell, or a name two columns share
 * — it cannot be followed, and the reader is **close**, not a fit. A reader
 * made before the order was kept cannot tell a moved column from one that
 * stayed, so it is close too, and making it again is one *Use*.
 */

import type { FormatDeclaration } from './declaration.ts'
import {
  findHeaderRow,
  headerProblems,
  readingHeaderCells,
  readingProblems,
  readingSignature,
  signatureOverlap,
  type ReadTable,
  type Reading,
  type ReadingColumn,
  type ReadingHeaderCell,
} from './reading.ts'

/** One layout of file, and how it is read. */
export interface Reader {
  /** The header it was made for, as `readingSignature` writes one. Its identity. */
  readonly signature: string
  /** The newest accepted reading of a file with that header. */
  readonly reading: Reading
  /**
   * That file's header in its own order (`readingHeaderCells`) — what lets a
   * moved column be followed. Absent for a reading made before M26 F1.
   */
  readonly headerCells?: readonly string[] | undefined
  /** The name a person gave it (M26 F1), when they gave one. */
  readonly name?: string | undefined
  /** The files it has read, newest first, by name. */
  readonly files: readonly string[]
  readonly lastReadAt: number
}

/** A reading a person accepted, as much of it as a reader is made from. */
export interface AcceptedReading {
  readonly signature: string
  readonly reading: Reading
  readonly headerCells?: readonly string[] | undefined
  readonly fileName: string
  readonly readAt: number
}

/** Below this much of a header in common, a reader is not even close. */
const CLOSE = 0.5

export type ReaderFit =
  | {
      readonly kind: 'FITS'
      readonly reader: Reader
      /**
       * The reader's reading, at the header row the file actually has — and
       * with every bound column followed to where its name is in this file.
       */
      readonly reading: Reading
      /** Some column this reader reads is somewhere else in this file. */
      readonly moved: boolean
    }
  | {
      /** No reader fits; this one shares most of the header. Named, never used. */
      readonly kind: 'CLOSE'
      readonly reader: Reader
      readonly overlap: number
      readonly why: CloseWhy
    }
  | { readonly kind: 'NONE' }

/**
 * Why a close reader is not a fit, so a surface can say it in a sentence.
 *
 * - `HEADER` — the file's header is not the reader's.
 * - `OUTGROWN` — it is, but the format changed and the reading no longer works.
 * - `MOVED` — it is, reordered, and a moved column has no name to follow.
 * - `UNORDERED` — it is, but the reader was made before the order was kept,
 *   so whether a column moved cannot be told.
 */
export type CloseWhy = 'HEADER' | 'OUTGROWN' | 'MOVED' | 'UNORDERED'

/**
 * The readers a format has, from the readings accepted onto it — newest first.
 *
 * Grouped by signature: the newest reading of a header is the reader, and the
 * older ones are its history (their file names are kept, so a reader can say
 * what it has read).
 */
export function readersOf(
  readings: readonly AcceptedReading[],
  /** The names people gave, by signature (M26 F1). */
  names: ReadonlyMap<string, string> = new Map(),
): readonly Reader[] {
  const sorted = [...readings].sort((a, b) => b.readAt - a.readAt)
  const bySignature = new Map<string, { reader: Reader; files: string[] }>()
  for (const each of sorted) {
    const known = bySignature.get(each.signature)
    if (known === undefined) {
      const files = [each.fileName]
      bySignature.set(each.signature, {
        reader: {
          signature: each.signature,
          reading: each.reading,
          headerCells: each.headerCells,
          name: names.get(each.signature),
          files,
          lastReadAt: each.readAt,
        },
        files,
      })
    } else if (!known.files.includes(each.fileName)) {
      known.files.push(each.fileName)
    }
  }
  return [...bySignature.values()].map((each) => each.reader)
}

/**
 * Try every reader on this table, and take the one that fits.
 *
 * Readers are tried newest first, so of two that fit the one made last wins —
 * the rule that lets a person put a wrong reader right by making another. When
 * none fits, the closest is returned as `CLOSE` if it shares at least half the
 * header, so the surface can name what nearly fitted rather than apply it.
 */
export function fitReader(
  declaration: FormatDeclaration,
  readers: readonly Reader[],
  table: ReadTable,
  formats?: ReadonlyMap<string, FormatDeclaration>,
): ReaderFit {
  const guessed = findHeaderRow(table)
  let closest: { reader: Reader; overlap: number; why: CloseWhy } | undefined

  for (const reader of readers) {
    const rows = [...new Set([reader.reading.headerRow, guessed])]
    for (const headerRow of rows) {
      const overlap = signatureOverlap(readingSignature(table, headerRow), reader.signature)
      let why: CloseWhy = 'HEADER'
      if (overlap === 1) {
        const placed = placeColumns(reader, table, headerRow)
        if (placed.kind === 'PLACED') {
          if (problemsOf(declaration, placed.reading, table, formats) === 0) {
            return { kind: 'FITS', reader, reading: placed.reading, moved: placed.moved }
          }
          // A header that matches but whose reading no longer works is close,
          // not a fit: the format changed under it, and a new reader is the answer.
          why = 'OUTGROWN'
        } else {
          why = placed.kind
        }
      }
      const nearness = overlap === 1 ? 0.99 : overlap
      if (nearness >= CLOSE && (closest === undefined || nearness > closest.overlap)) {
        closest = { reader, overlap: nearness, why }
      }
    }
  }

  return closest === undefined ? { kind: 'NONE' } : { kind: 'CLOSE', ...closest }
}

type Placed =
  | { readonly kind: 'PLACED'; readonly reading: Reading; readonly moved: boolean }
  | { readonly kind: 'MOVED' }
  | { readonly kind: 'UNORDERED' }

/**
 * The reader's reading, with every position it reads followed to where that
 * column's header is in this file (M26 F1).
 *
 * A position whose header cell is the same here stays. One that is not is
 * followed by name, and only when the name is one column's in the reader's
 * header and one column's in this file's: an empty header cell, or a name two
 * columns share, gives nothing to follow, and the answer is `MOVED` rather
 * than a guess. A printed total's cell is followed the same way, by the header
 * of the column it sits in — and whatever it then reads is still checked
 * against the lines before anything is written.
 */
function placeColumns(reader: Reader, table: ReadTable, headerRow: number): Placed {
  const before = reader.headerCells
  if (before === undefined) return { kind: 'UNORDERED' }
  const now = readingHeaderCells(table, headerRow)

  let moved = false
  let lost = false
  const follow = (index: number): number => {
    const name = before[index] ?? ''
    if ((now[index] ?? '') === name) return index
    const there = indexesOf(now, name)
    if (name === '' || indexesOf(before, name).length !== 1 || there.length !== 1) {
      lost = true
      return index
    }
    moved = true
    return there[0] ?? index
  }

  const columns: ReadingColumn[] = reader.reading.columns.map((each) => ({
    ...each,
    index: follow(each.index),
  }))
  const header = reader.reading.header
  const cells: ReadingHeaderCell[] | undefined = header?.cells.map((each) => ({
    ...each,
    index: follow(each.index),
  }))
  if (lost) return { kind: 'MOVED' }

  return {
    kind: 'PLACED',
    moved,
    reading: {
      ...reader.reading,
      headerRow,
      columns,
      ...(header === undefined || cells === undefined ? {} : { header: { ...header, cells } }),
    },
  }
}

function indexesOf(cells: readonly string[], name: string): readonly number[] {
  return cells.flatMap((each, index) => (each === name ? [index] : []))
}

function problemsOf(
  declaration: FormatDeclaration,
  reading: Reading,
  table: ReadTable,
  formats: ReadonlyMap<string, FormatDeclaration> | undefined,
): number {
  const header = reading.header
  return (
    readingProblems(declaration, reading, table, formats).length +
    (header === undefined
      ? 0
      : headerProblems(declaration, header, formats?.get(header.format), table, formats).length)
  )
}

/** Why a reader that nearly fitted was not used, in a sentence (M26 F1). */
export function closeSentence(why: CloseWhy): string {
  switch (why) {
    case 'HEADER':
      return 'its header is not this file’s.'
    case 'OUTGROWN':
      return 'the format has changed since it was made, and its reading no longer works.'
    case 'MOVED':
      return 'this file has its columns in another order, and a column it reads has no header cell of its own to follow.'
    case 'UNORDERED':
      return 'it was made before Emerald kept the order of a file’s columns, so it cannot tell whether they moved. A reader made from this file replaces it.'
  }
}

/**
 * A reader's name, said the way a person would: the one they gave it, or the
 * file it last read.
 *
 * The file a person exported is the thing they recognise — *"card-2026-08.xlsx"*
 * says which layout this is better than any label the app could make up — so
 * that is the name until somebody gives another (M26 F1).
 */
export function readerName(reader: Reader): string {
  return reader.name ?? reader.files[0] ?? 'a file'
}

/**
 * A short, stable handle for a reader, from its signature — what a
 * conversation names one by, since a name is neither required nor unique.
 * FNV-1a, because it only has to tell a format's few readers apart.
 */
export function readerId(reader: Pick<Reader, 'signature'>): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < reader.signature.length; index += 1) {
    hash ^= reader.signature.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
