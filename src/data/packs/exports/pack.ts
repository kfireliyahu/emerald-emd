/**
 * **The exports pack** — M63 U3 (D-601).
 *
 * One format, `export`: a file a document's rows are written to, as a row. With
 * M63 U1 and U2 a project still listed its `emerald-mcp export` calls in a
 * script beside the document; the maintainer's pick was that saved exports are
 * rows of a format the document declares, seen and corrected in the app like
 * any table, and written from the command line, a conversation and the app.
 *
 * Built the way the development pack is: a `.format.md` beside this file, no
 * seeds and no code that writes — its rows go through `record_format_rows`,
 * `update_format_rows` and the sheet, and keeping it is `keep_packs` or the
 * Packs screen (`installDeclared`). What reads its rows into exports is
 * `saved.ts`, which imports nothing of Node, so the app's button (M63 U4) reads
 * them the way the command line does. **The engine touches none of it**:
 * `src/domain/format/` imports nothing from here (`boundary.test.ts`).
 */

import type { Database } from 'sql.js'

import { err, ok, type Result } from '@/core/result.ts'
import { readFormat as readFormatText, type ParsedFormat } from '@/domain/format/document.ts'
import { SEEDED_UNITS } from '@/domain/format/unit.ts'

import { readFormat } from '../../repositories/formatRepository.ts'
import { installDeclared, type DeclaredInstall } from '../declared.ts'
import { fitOf } from '../fit.ts'
import EXPORT from './formats/export.format.md?raw'

/** The pack's one format. */
export const EXPORT_FORMAT = 'export'

let parsed: Result<readonly ParsedFormat[], string> | undefined

/** The pack's declaration — one format, linking to nothing. */
export function exportsFormats(): Result<readonly ParsedFormat[], string> {
  parsed ??= parseExport()
  return parsed
}

function parseExport(): Result<readonly ParsedFormat[], string> {
  const read = readFormatText(EXPORT, SEEDED_UNITS, [])
  if (!read.ok) return err(`The exports pack's ${EXPORT_FORMAT}: ${read.error}`)
  return ok([read.value])
}

/** The names of the pack's formats. */
export function exportsFormatNames(): ReadonlySet<string> {
  return new Set([EXPORT_FORMAT])
}

/**
 * **Whether a document keeps it**: it declares `export`, in a shape that does
 * not clash with the pack's — so a person's own format of that name, with other
 * columns, is never read as saved exports.
 */
export function documentHasExports(db: Database): boolean {
  const held = readFormat(db, EXPORT_FORMAT)
  const formats = exportsFormats()
  const declaration = formats.ok ? formats.value[0]?.declaration : undefined
  return held !== undefined && declaration !== undefined && fitOf(held, declaration).clashes.length === 0
}

/** Keep it in a document: declare `export`, or complete the one it holds. Idempotent. */
export function installExportsPack(db: Database, now: number): Result<DeclaredInstall, string> {
  const formats = exportsFormats()
  if (!formats.ok) return formats
  return installDeclared(db, now, { title: 'The exports pack', formats: formats.value, views: [], renames: [] })
}
