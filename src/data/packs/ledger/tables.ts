/**
 * The pack's own declarations, by name, for its repositories — M25 U2.
 *
 * **A write of a pack's row goes through the engine's row functions**
 * (`insertRows`, `updateRow`, `deleteRows`), never a bare `UPDATE`: those are
 * what release a seed a person edits and remember one a person removes
 * (D-264), and a repository that wrote around them would let the next build
 * put back a category somebody renamed. Reads are plain SQL against the
 * `fmt_` tables, which is what a pack's code is allowed (D-265).
 */

import type { Database } from 'sql.js'

import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import { listFormats, readFormat } from '../../repositories/formatRepository.ts'

export class LedgerMissingError extends Error {
  constructor(readonly format: string) {
    super(`This document does not keep a ledger — it declares no ${format}.`)
    this.name = 'LedgerMissingError'
  }
}

/** The document's declaration of one of the pack's formats. */
export function declared(db: Database, format: string): FormatDeclaration {
  const declaration = readFormat(db, format)
  if (declaration === undefined) throw new LedgerMissingError(format)
  return declaration
}

/** Every declaration the document has — what a delete checks links against. */
export function allDeclared(db: Database): readonly FormatDeclaration[] {
  return listFormats(db)
}

/** An instant column's spelling of a moment in milliseconds. */
export function instantOf(at: number): string {
  return new Date(at).toISOString()
}

/** Milliseconds from an instant column, or undefined for none. */
export function millisOf(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const at = Date.parse(value)
  return Number.isNaN(at) ? undefined : at
}
