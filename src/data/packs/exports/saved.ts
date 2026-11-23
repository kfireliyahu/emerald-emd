/**
 * **A document's saved exports, read into what each one asks** — M63 U3 (D-601).
 *
 * Each `export` row becomes the `ExportAsk` the command line's flags would have
 * made: `columns` one per line, `match` one `column: value` per line (two lines
 * on one column are either, an empty value an empty cell), `nests` one per line
 * in the form `--nest` takes (`parseNest`, D-603). A row that cannot be read so
 * keeps its sentence beside its file, so whoever runs the exports reports it
 * and carries on with the others — never skips it.
 *
 * **Data, not Node**: the command line and the tool (`src/plugin/exportCommand.ts`)
 * read rows here, and so does the app's button (M63 U4). Whether a file is
 * inside the document's folder is the writer's question, asked where the file
 * is written.
 */

import type { Database } from 'sql.js'

import { err, ok, type Result } from '@/core/result.ts'
import { parseNest, type ExportAsk, type NestAsk } from '@/domain/format/export.ts'
import type { StoredValue } from '@/domain/format/row.ts'

import { readFormat } from '../../repositories/formatRepository.ts'
import { listRows } from '../../repositories/formatRowRepository.ts'
import { documentHasExports, EXPORT_FORMAT } from './pack.ts'

/** One saved export: the file it writes, and what it asks — or why its row cannot be read as one. */
export interface SavedExport {
  readonly id: string
  /** As the row holds it: relative to the document's folder. */
  readonly file: string
  readonly ask: Result<ExportAsk, string>
}

/** What a document with none is told — the command line, the tool and the app alike. */
export const NO_SAVED_EXPORTS =
  'This document has no saved exports. They are rows of the `export` format, which the exports pack declares: ' +
  'keep the pack (Settings › Packs, or `keep_packs` with `packs: ["exports"]`) and record a row for each file.'

/**
 * **Every saved export, by file** — or the sentence saying the document keeps
 * none: it does not declare `export`, or its own `export` is not the pack's. A
 * document that keeps the pack and has no rows is an empty list, and the
 * caller says `NO_SAVED_EXPORTS` then too.
 */
export function savedExports(db: Database): Result<readonly SavedExport[], string> {
  const declaration = readFormat(db, EXPORT_FORMAT)
  if (declaration === undefined) return err(NO_SAVED_EXPORTS)
  if (!documentHasExports(db)) {
    return err(
      `This document's own \`${EXPORT_FORMAT}\` format is not the exports pack's, so it holds no saved exports. ` +
        'Rename it, then keep the exports pack to save exports.',
    )
  }
  return ok(
    listRows(db, declaration, { order: 'file' }).map((row) => ({
      id: row.id,
      file: textOf(row.cells['file']),
      ask: askOf(row.cells),
    })),
  )
}

function textOf(value: StoredValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

function linesOf(value: StoredValue | undefined): readonly string[] {
  return textOf(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/** One row's cells, as the export it asks for — or the sentence saying which cell cannot be read. */
export function askOf(cells: Readonly<Record<string, StoredValue>>): Result<ExportAsk, string> {
  const format = textOf(cells['format']).trim()
  if (format === '') return err('it names no format.')
  const match = new Map<string, (string | null)[]>()
  for (const line of linesOf(cells['match'])) {
    const colon = line.indexOf(':')
    const column = colon < 0 ? '' : line.slice(0, colon).trim()
    if (column === '') return err(`its match line \`${line}\` is not \`column: value\`.`)
    const value = line.slice(colon + 1).trim()
    match.set(column, [...(match.get(column) ?? []), value === '' ? null : value])
  }
  const nest: NestAsk[] = []
  for (const line of linesOf(cells['nests'])) {
    const read = parseNest(line)
    if (!read.ok) return err(`its nest \`${line}\`: ${read.error}`)
    nest.push(read.value)
  }
  const columns = linesOf(cells['columns'])
  const order = textOf(cells['order']).trim()
  return ok({
    format,
    ...(match.size === 0
      ? {}
      : { match: Object.fromEntries([...match].map(([key, values]) => [key, values.length === 1 ? values[0] : values])) }),
    ...(order === '' ? {} : { order }),
    ...(cells['descending'] === 1 ? { descending: true } : {}),
    ...(columns.length === 0 ? {} : { columns }),
    ...(nest.length === 0 ? {} : { nest }),
  })
}
